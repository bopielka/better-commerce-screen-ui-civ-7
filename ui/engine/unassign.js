/**
 * Returning assigned resources to the unassigned pool.
 *
 * ⚠️ Removing a slot-granting resource (a camel) SHRINKS the settlement's capacity, so others may
 * have to leave first or the settlement would end up holding more than it can. Companions are
 * pulled from a queue one at a time and only for as long as the engine keeps refusing; see
 * engine/resource-slots.js.
 *
 * ⚠️ Locks are obeyed here, which is the whole point of them: this is what the bulk buttons call.
 */
import {
    canAssign,
    canUnassign,
    requestClearSettlement,
    requestUnassign,
    unassignIfAllowed,
} from './operations.js';
import { companionCandidates } from './resource-slots.js';
import { isResourceLocked } from './resource-locks.js';
import { waitForEngineEvent } from './wait.js';
import { log, warn } from '../support/diagnostics.js';

const UNASSIGNED_EVENT = 'ResourceUnassigned';

/**
 * Waits for the releases already sent to have actually been PROCESSED, empire-wide.
 *
 * ⚠️ WHY THIS EXISTS: `requestClearSettlement` empties a settlement in ONE operation but the
 * engine raises one `ResourceUnassigned` per resource, and `waitForEngineEvent` returns on the
 * FIRST of them. So "unassign everything" came back with the tail of the clears still in flight;
 * the placement loop that follows it read a board where those resources were neither in the pool
 * nor placeable, emptied the pool it could see, and stopped - and the releases landed afterwards,
 * leaving resources unassigned with room all over the empire. That was "reassign all does not
 * assign everything".
 *
 * ⚠️ Counted, not evented: the count the engine reports cannot be confused by another player, and
 * we know exactly what it should end at - whatever is locked.
 *
 * ⚠️ Same escalating poll as `awaitAssignment` in planner/place.js, and for the same reason: each
 * poll is one call per settlement. The first 50ms are checked tightly, after that ever less often.
 */
const DRAIN_POLL_MS = 4;
const DRAIN_FAST_WINDOW_MS = 50;
const DRAIN_POLL_CEILING_MS = 32;
const DRAIN_TIMEOUT_MS = 3000;

/** How many resources the local player holds slotted right now, or -1 if the engine would not say. */
function totalAssigned() {
    try {
        const cities = Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? [];
        let total = 0;
        for (const city of cities) {
            total += city.Resources?.getAssignedResources()?.length ?? 0;
        }
        return total;
    } catch (error) {
        warn(`could not count the empire's assigned resources: ${error}`);
        return -1;
    }
}

function awaitReleasesLanded(expectedRemaining) {
    return new Promise((resolve) => {
        const started = Date.now();
        let wait = DRAIN_POLL_MS;
        const check = () => {
            const left = totalAssigned();
            if (left < 0 || left <= expectedRemaining) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= DRAIN_TIMEOUT_MS) {
                warn(
                    `${left} resource(s) were still assigned ${DRAIN_TIMEOUT_MS}ms after everything ` +
                        `was released (${expectedRemaining} locked); laying out what there is`,
                );
                resolve(false);
                return;
            }
            setTimeout(check, wait);
            if (Date.now() - started >= DRAIN_FAST_WINDOW_MS) {
                wait = Math.min(wait * 2, DRAIN_POLL_CEILING_MS);
            }
        };
        check();
    });
}

function trySend(resource) {
    return (
        canUnassign(resource.cityID, resource.resourceValue) &&
        requestUnassign(resource.cityID, resource.resourceValue)
    );
}

/**
 * Releases one resource, pulling companions out of `queue` only for as long as the engine keeps
 * refusing it. @returns how many were released in total, this one included.
 */
async function releaseOne(resource, queue) {
    if (trySend(resource)) {
        return 1;
    }

    let released = 0;
    while (queue.length > 0) {
        const companion = queue.shift();
        if (!trySend(companion)) {
            continue;
        }
        released++;
        log(`freed ${companion.resourceType} to make room for ${resource.resourceType}`);
        await waitForEngineEvent(UNASSIGNED_EVENT);

        if (trySend(resource)) {
            return released + 1;
        }
    }

    warn(
        `could not unassign ${resource.resourceType} (value ${resource.resourceValue}) - ` +
            `the engine still refuses it after freeing ${released} slot(s)`,
    );
    return released;
}

async function release(settlement, doomed) {
    const queue = companionCandidates(settlement, doomed);
    let released = 0;
    for (const resource of doomed) {
        const count = await releaseOne(resource, queue);
        released += count;
        /*
         * ⚠️ Only when something was actually SENT. A release the engine refused raises no event,
         * so waiting for one was a full timeout spent on a message that could not arrive - once
         * per resource, and these are chained.
         */
        if (count > 0) {
            await waitForEngineEvent(UNASSIGNED_EVENT);
        }
    }
    return released;
}

/**
 * Frees enough room in the settlement a resource is LEAVING for the move to be allowed.
 * ⚠️ Moving a camel out shrinks the old settlement by two, so the engine refuses the move outright
 * unless there is already room to absorb that - which is why dragging a camel out of a full
 * settlement silently did nothing.
 */
export async function freeRoomForMove(sourceSettlement, slottedResource, targetCityID) {
    if (canAssign(targetCityID, slottedResource.resourceValue)) {
        return true;
    }

    const queue = companionCandidates(sourceSettlement, [slottedResource]);
    while (queue.length > 0) {
        const companion = queue.shift();
        if (!trySend(companion)) {
            continue;
        }
        log(`freed ${companion.resourceType} to let ${slottedResource.resourceType} move out`);
        await waitForEngineEvent(UNASSIGNED_EVENT);

        if (canAssign(targetCityID, slottedResource.resourceValue)) {
            return true;
        }
    }

    warn(`could not make room to move ${slottedResource.resourceType} out of its settlement`);
    return false;
}

/** One resource, plus anything that turns out to have to leave with it. */
export function unassignOne(settlement, slottedResource) {
    return release(settlement, [slottedResource]);
}

/** Empties ONE settlement, sparing anything the player has locked. */
export async function unassignSettlement(cityID) {
    const city = Cities.get(cityID);
    const assigned = city?.Resources?.getAssignedResources() ?? [];
    if (assigned.length === 0) {
        return 0;
    }
    const doomed = assigned.filter((resource) => !isResourceLocked(cityID, resource.value));
    if (doomed.length === 0) {
        log('every resource in this settlement is locked; nothing returned');
        return 0;
    }

    let cleared = 0;
    if (doomed.length === assigned.length && requestClearSettlement(cityID)) {
        cleared = assigned.length;
    } else {
        for (const resource of doomed) {
            if (unassignIfAllowed(cityID, resource.value)) {
                cleared++;
            } else {
                warn(`failed to request unassign for resource ${resource.value}`);
            }
        }
    }
    // ⚠️ Nothing went to the engine, so nothing is coming back; see `release`.
    if (cleared > 0) {
        await waitForEngineEvent(UNASSIGNED_EVENT);
    }
    log(`returned ${cleared} resource(s) from one settlement (${assigned.length - doomed.length} locked)`);
    return cleared;
}

export async function unassignEverySettlement() {
    let cleared = 0;
    /** What is meant to still be slotted when this is done: the locked resources, and nothing else. */
    let locked = 0;
    const cities = Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? [];

    for (const city of cities) {
        const assigned = city.Resources?.getAssignedResources() ?? [];
        if (assigned.length === 0) {
            continue;
        }

        /*
         * ⚠️ THE BULK CLEAR IS ONLY SAFE WHERE NOTHING IS LOCKED. `requestClearSettlement` takes a
         * settlement and no list - it empties the lot and cannot be asked to spare anything - so a
         * settlement holding a locked resource is emptied one at a time instead.
         */
        const doomed = assigned.filter((resource) => !isResourceLocked(city.id, resource.value));
        locked += assigned.length - doomed.length;

        if (doomed.length === 0) {
            // Every resource here is locked. Nothing to do, and nothing to wait for - the
            // wait below is for an event this settlement is no longer going to raise.
            continue;
        }

        let sent = 0;
        if (doomed.length === assigned.length && requestClearSettlement(city.id)) {
            sent = assigned.length;
        } else {
            for (const resource of doomed) {
                if (unassignIfAllowed(city.id, resource.value)) {
                    sent++;
                } else {
                    warn(`failed to request unassign for resource ${resource.value}`);
                }
            }
        }
        cleared += sent;
        // ⚠️ Only when something was actually sent, and these are chained one per settlement -
        // a whole empire of refusals used to cost the full timeout apiece. See `release`.
        if (sent > 0) {
            await waitForEngineEvent(UNASSIGNED_EVENT);
        }
    }

    // ⚠️ Last, and it is not optional: everything above waits for ONE event per settlement, and a
    // cleared settlement raises one per resource. See `awaitReleasesLanded`.
    if (cleared > 0) {
        await awaitReleasesLanded(locked);
    }

    return cleared;
}

/** Every resource of one kind in one settlement, plus anything that has to leave with them. */
export async function unassignAllOfTypeInSettlement(settlement, resourceType) {
    if (!settlement || !resourceType) {
        return 0;
    }
    const doomed = (settlement.slottedResources ?? []).filter(
        (resource) => resource.resourceType === resourceType,
    );
    const released = await release(settlement, doomed);
    log(`unassign all "${resourceType}" in this settlement: ${released} released (${doomed.length} of that kind)`);
    return released;
}
