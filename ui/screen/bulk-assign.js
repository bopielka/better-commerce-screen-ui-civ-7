/**
 * Shift while assigning: keep filling the settlement with the same kind of resource until it runs
 * out of room or the pool runs out of copies. Shift while returning one sends the rest of its kind
 * back with it.
 *
 * ⚠️ It works in every direction - pool to settlement, settlement to settlement, settlement to
 * pool. An earlier version only did the first, which read as the shortcut being broken.
 */
import { findSlottedResource, pooledResources } from '../model/screen-model.js';
import { freeRoomForMove } from '../engine/unassign.js';
import { verifyScreenMatchesEngine } from '../planner/place.js';
import { grantsBonusSlots } from '../engine/resource-slots.js';
import { canAssign, canUnassign, requestAssign, requestUnassign } from '../engine/operations.js';
import { waitForEngineEvent } from '../engine/wait.js';
import { isShiftHeld } from '../engine/shift.js';
import { log, warn } from '../support/diagnostics.js';

const ASSIGNED_EVENT = 'ResourceAssigned';
const UNASSIGNED_EVENT = 'ResourceUnassigned';

function resourceTypeOf(model, resourceValue) {
    return pooledResources(model).find((resource) => resource.resourceValue === resourceValue)?.resourceType;
}

/** The other resources Shift should carry along, and where they are coming from. */
function planBulk(model, selected, targetCityID) {
    const value = selected?.resourceValue;
    if (value === undefined || value === -1) {
        return null;
    }

    // Slotted somewhere: take its companions out of that settlement.
    if (selected.cityID) {
        // Dropping a resource back into the settlement it already sits in moves nothing.
        if (String(selected.cityID.id) === String(targetCityID?.id)) {
            return null;
        }
        const source = findSlottedResource(model, value);
        const resourceType = source?.resource?.resourceType;
        if (!resourceType) {
            return null;
        }
        return {
            resourceType,
            candidates: (source.settlement.slottedResources ?? []).filter(
                (resource) => resource.resourceType === resourceType && resource.resourceValue !== value,
            ),
        };
    }

    // Unassigned: the pool, as before.
    const resourceType = resourceTypeOf(model, value);
    if (!resourceType) {
        return null;
    }
    return {
        resourceType,
        candidates: pooledResources(model).filter(
            (resource) => resource.resourceType === resourceType && resource.resourceValue !== value,
        ),
    };
}

/** Keeps assigning copies of `resourceType` to `cityID` until the engine refuses. */
async function fillWithMore(model, cityID, resourceType, candidates) {
    if (candidates.length === 0) {
        return 0;
    }

    // The player's own assignment is still in flight; nothing can be judged until it lands.
    await waitForEngineEvent(ASSIGNED_EVENT);

    let assigned = 0;
    for (const candidate of candidates) {
        if (!canAssign(cityID, candidate.resourceValue)) {
            // Out of room - or this particular resource is not allowed here.
            break;
        }
        if (!requestAssign(cityID, candidate.resourceValue)) {
            break;
        }
        assigned++;
        await waitForEngineEvent(ASSIGNED_EVENT);
    }

    log(`bulk assign "${resourceType}": ${assigned} more assigned (${candidates.length} were available)`);
    // ⚠️ The screen is put back in step afterwards, and it is not optional: this loop talks to the
    // engine directly, so the pool is left holding rows for resources that have since been placed.
    await verifyScreenMatchesEngine();
    return assigned;
}

/** Is this a move the engine will refuse for lack of room in the settlement being LEFT? */
function needsRoomFreed(model, selected, targetCityID, targetResourceValue) {
    if (targetResourceValue !== undefined || !selected?.cityID || !targetCityID) {
        return null;
    }
    if (selected.cityID.id === targetCityID.id) {
        return null;
    }
    const found = findSlottedResource(model, selected.resourceValue);
    if (!found || !grantsBonusSlots(found.resource.resourceType)) {
        return null;
    }
    return found;
}

/** Makes room in the source settlement, then performs the move. */
async function moveAfterFreeingRoom(model, source, resource, targetCityID, originalSlot) {
    if (!(await freeRoomForMove(source.settlement, source.resource, targetCityID))) {
        return;
    }
    const stillThere = findSlottedResource(model, resource.resourceValue);
    if (!stillThere) {
        return;
    }
    model.deselectSelectedResource();
    model.clickSlottedResource({
        resourceValue: stillThere.resource.resourceValue,
        cityID: stillThere.settlement.cityID,
    });
    originalSlot.call(model, targetCityID);
}

/** Returns the rest of one kind to the pool, one at a time. */
async function releaseMore(cityID, resourceType, candidates) {
    // The player's own removal is still in flight; nothing can be judged until it lands.
    await waitForEngineEvent(UNASSIGNED_EVENT);

    let released = 0;
    for (const candidate of candidates) {
        if (!canUnassign(cityID, candidate.resourceValue)) {
            continue;
        }
        if (!requestUnassign(cityID, candidate.resourceValue)) {
            break;
        }
        released++;
        await waitForEngineEvent(UNASSIGNED_EVENT);
    }

    log(`bulk unassign "${resourceType}": ${released} more returned (${candidates.length} were beside it)`);
    // Same reason as in `fillWithMore`: the pool cannot heal itself.
    await verifyScreenMatchesEngine();
    return released;
}

let patchedModel = null;
let originalSlotSelectedResource = null;
let originalUnslotSelectedResource = null;

export function startBulkAssign(model) {
    if (patchedModel === model || typeof model?.slotSelectedResource !== 'function') {
        return;
    }
    // ⚠️ The screen can be reopened before the old one's cleanup runs, and the handles below hold
    // ONE model's methods - so the previous model is unwrapped here or it keeps our wrapper for
    // good and its own `stopBulkAssign` walks away from it.
    if (patchedModel) {
        stopBulkAssign(patchedModel);
    }
    patchedModel = model;
    originalSlotSelectedResource = model.slotSelectedResource;

    model.slotSelectedResource = (cityID, targetResourceValue) => {
        // The selection is cleared by the original call, so read it first.
        const selected = model.selectedResource?.();
        const wantsBulk = isShiftHeld() && targetResourceValue === undefined;
        // Also before: `planBulk` reads a model the original call is about to rewrite.
        const plan = wantsBulk ? planBulk(model, selected, cityID) : null;

        // Moving a camel out of a settlement it does not fit out of: make room first,
        // then let the original do the move. Same rule as unassigning one by right-click.
        const cramped = needsRoomFreed(model, selected, cityID, targetResourceValue);
        if (cramped) {
            moveAfterFreeingRoom(model, cramped, cramped.resource, cityID, originalSlotSelectedResource).catch(
                (error) => warn(`moving a slot-carrying resource failed: ${error}`),
            );
            return;
        }

        originalSlotSelectedResource.call(model, cityID, targetResourceValue);

        if (!plan) {
            return;
        }
        fillWithMore(model, cityID, plan.resourceType, plan.candidates).catch((error) =>
            warn(`bulk assign failed: ${error}`),
        );
    };

    if (typeof model.unslotSelectedResource !== 'function') {
        // ⚠️ Left null rather than holding a non-function, so the teardown below cannot put
        // one back onto the model in place of the method it is meant to restore.
        originalUnslotSelectedResource = null;
        return;
    }
    originalUnslotSelectedResource = model.unslotSelectedResource;
/** Shift while returning a resource to the pool: send the rest of its kind back with it. */
    model.unslotSelectedResource = () => {
        const selected = model.selectedResource?.();
        const source = isShiftHeld() && selected?.cityID
            ? findSlottedResource(model, selected.resourceValue)
            : null;
        const resourceType = source?.resource?.resourceType;
        const companions = resourceType
            ? (source.settlement.slottedResources ?? []).filter(
                (resource) =>
                    resource.resourceType === resourceType
                    && resource.resourceValue !== selected.resourceValue,
            )
            : [];

        originalUnslotSelectedResource.call(model);

        if (companions.length === 0) {
            return;
        }
        releaseMore(source.settlement.cityID, resourceType, companions).catch((error) =>
            warn(`bulk unassign failed: ${error}`),
        );
    };
}

export function stopBulkAssign(model) {
    if (patchedModel !== model) {
        return;
    }
    model.slotSelectedResource = originalSlotSelectedResource;
    // ⚠️ Both, or the second wrapper outlives the screen it was made for.
    if (originalUnslotSelectedResource) {
        model.unslotSelectedResource = originalUnslotSelectedResource;
    }
    patchedModel = null;
    originalSlotSelectedResource = null;
    originalUnslotSelectedResource = null;
}
