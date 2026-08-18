/**
 * Shift while assigning: keep filling the settlement with the same kind of resource.
 *
 * Where this hooks in
 * -------------------
 * The screen offers two ways to assign - drag and drop, and point and click - but both
 * end at the same call:
 *
 *   city Activatable onActivate -> model.slotSelectedResource(cityID)
 *   ghost slot       onActivate -> model.slotSelectedResource(cityID)
 *   DragAndDrop      onDragDrop -> model.slotSelectedResource(cityID)
 *
 * So the model's own method is wrapped, once, and both routes are covered. The model is
 * a `createMutable` store, so the property can simply be reassigned and put back on
 * cleanup.
 *
 * A call carrying `targetResourceValue` is a swap between two resources, not an
 * assignment into a free slot, and is left alone.
 *
 * How many is "as many as possible"
 * ---------------------------------
 * Not computed. Free slots are not counted and capacity is not modelled: the loop just
 * keeps asking `canStart` and stops the first time the engine says no. That is also why
 * it copes with camels, which bring two extra slots with them and make room for more
 * than were free when the player clicked.
 *
 * Each step waits for the previous one to land - `sendRequest` only queues, so asking
 * `canStart` in the same tick would still be answering about the old state.
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

/**
 * The other resources Shift should carry along, and where they are coming from.
 *
 * ⚠️ WORKED OUT BEFORE THE MOVE IS SENT, because the model is about to change underneath us:
 * the original call clears the selection and repopulates both the pool and the settlement.
 *
 * ⚠️ THE POOL IS ONLY ONE OF THE THREE SOURCES, which is what this used to assume. Shift only
 * ever bulked "pool to settlement" because both the type lookup and the candidate list came
 * from `pooledResources`, so a resource picked up from a settlement was not found there, the
 * type came back undefined, and the wrapper bailed out having moved exactly one. A resource
 * already slotted somewhere is bulked from ITS settlement instead.
 *
 * @returns {{resourceType: string, candidates: object[]}|null}
 */
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

/**
 * Keeps assigning unassigned resources of `resourceType` to `cityID` until the engine
 * refuses one or there are none left.
 *
 * ⚠️ `candidates` is a SNAPSHOT taken before the first wait, by `planBulk`. The model
 * repopulates underneath this loop, and the resource the player moved themselves is already
 * queued - still listed where it was - so it is excluded when the list is built rather than
 * re-derived here.
 */
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
    /*
     * ⚠️ The screen is put back in step afterwards, and it is not optional. This loop talks to
     * the engine directly instead of going through the model's own handlers, so the model's
     * differential bookkeeping never runs for these moves - the settlement cards heal
     * themselves from live state, but the unassigned pool is maintained purely by addition and
     * removal and cannot. Left alone it keeps drawing resources in places they no longer are.
     */
    await verifyScreenMatchesEngine();
    return assigned;
}


/**
 * Is this a move that the engine will refuse for lack of room in the settlement being
 * left behind? Only slot-carrying resources can be, and only when actually moving
 * between settlements - a swap trades places and changes no capacity.
 */
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

/**
 * Makes room in the source settlement, then performs the move.
 *
 * The selection is re-made rather than assumed: freeing companions rebuilds the model,
 * and whatever was selected before does not survive that.
 */
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

/**
 * Returns the rest of one kind to the pool, one at a time.
 *
 * The mirror image of `fillWithMore`, and asynchronous for the same reason: `sendRequest`
 * only queues, so asking `canUnassign` about the next one in the same tick would still be
 * answering about the board before this one left.
 */
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
    /*
     * Shift while returning a resource to the pool: send the rest of its kind back with it.
     *
     * ⚠️ A SECOND METHOD HAD TO BE WRAPPED. `slotSelectedResource` is where a resource lands
     * somewhere, and wrapping it covers "pool to settlement" and "settlement to settlement" -
     * but taking one OUT to the pool never goes through it. That is `unslotSelectedResource`,
     * and until it was wrapped Shift moved exactly one resource in that direction, however
     * many of its kind were sitting beside it.
     */
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
