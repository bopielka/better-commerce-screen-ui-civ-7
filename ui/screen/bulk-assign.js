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
import { grantsBonusSlots } from '../engine/resource-slots.js';
import { canAssign, requestAssign } from '../engine/operations.js';
import { waitForEngineEvent } from '../engine/wait.js';
import { isShiftHeld } from '../engine/shift.js';
import { log, warn } from '../support/diagnostics.js';

const ASSIGNED_EVENT = 'ResourceAssigned';

function resourceTypeOf(model, resourceValue) {
    return pooledResources(model).find((resource) => resource.resourceValue === resourceValue)?.resourceType;
}

/**
 * Keeps assigning unassigned resources of `resourceType` to `cityID` until the engine
 * refuses one or there are none left.
 *
 * @param alreadySent the resource the player assigned themselves - queued, so still
 *        listed as unassigned by the model, and it must not be sent twice.
 */
async function fillWithMore(model, cityID, resourceType, alreadySent) {
    // Snapshot before the first wait: the model repopulates underneath us.
    const candidates = pooledResources(model).filter(
        (resource) => resource.resourceType === resourceType && resource.resourceValue !== alreadySent,
    );
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

let patchedModel = null;
let originalSlotSelectedResource = null;

export function startBulkAssign(model) {
    if (patchedModel === model || typeof model?.slotSelectedResource !== 'function') {
        return;
    }
    patchedModel = model;
    originalSlotSelectedResource = model.slotSelectedResource;

    model.slotSelectedResource = (cityID, targetResourceValue) => {
        // The selection is cleared by the original call, so read it first.
        const selected = model.selectedResource?.();
        const assignedValue = selected?.resourceValue;
        const wantsBulk = isShiftHeld() && targetResourceValue === undefined;

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

        if (!wantsBulk || assignedValue === undefined || assignedValue === -1) {
            return;
        }
        const resourceType = resourceTypeOf(model, assignedValue);
        if (!resourceType) {
            return;
        }
        fillWithMore(model, cityID, resourceType, assignedValue).catch((error) =>
            warn(`bulk assign failed: ${error}`),
        );
    };
}

export function stopBulkAssign(model) {
    if (patchedModel !== model) {
        return;
    }
    model.slotSelectedResource = originalSlotSelectedResource;
    patchedModel = null;
    originalSlotSelectedResource = null;
}
