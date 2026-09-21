/**
 * Returning assigned resources to the unassigned pool.
 *
 * ⚠️ Removing a slot-granting resource (a camel) SHRINKS the settlement's capacity, so others may
 * have to leave first or the settlement would end up holding more than it can. Two mechanisms,
 * for two different shapes of `doomed`:
 *   - a SINGLE resource (`unassignOne`, `freeRoomForMove`): a companion is pulled from a queue
 *     one at a time, only for as long as the engine keeps refusing - see `companionCandidates`
 *     in engine/resource-slots.js.
 *   - a BULK list (`unassignSettlement`, `unassignEverySettlement`): `slotGrantingLast` sorts
 *     camels to the end, so their own bulk-mates leave first and make the room naturally -
 *     `companionCandidates` has too little left to draw from once almost everything in the
 *     settlement is doomed at once (2026-09-20 bug report).
 *
 * ⚠️ Locks are obeyed here, which is the whole point of them: this is what the bulk buttons call.
 */
import { canAssign, canUnassign, requestClearSettlement, requestUnassign } from './operations.js';
import { companionCandidates, grantsBonusSlots } from './resource-slots.js';
import { isResourceLocked } from './resource-locks.js';
import { heldResourceType } from './resource-types.js';
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
 * Confirms a resource has actually left, polling the settlement directly - the same reason
 * `place.js`'s `awaitAssignment` does not trust `ResourceAssigned`. Same cadence, mirrored.
 *
 * ⚠️ THE EVENT IS NOT ENOUGH ON ITS OWN (2026-09-21 bug report). `waitForEngineEvent` resolved
 * for every release in a bulk batch, yet `getAssignedResources()` still reported the ORIGINAL
 * full count once the loop reached a camel at the end - `ResourceUnassigned` can fire before the
 * settlement's own state has actually caught up, not merely "fires for every player" the way
 * `ResourceAssigned` does. A camel's `canUnassign` reads that state directly (removing it must
 * not overflow the settlement), so it is exactly the case this staleness broke - a regular
 * resource's `canUnassign` never depends on it, which is why nothing noticed sooner.
 */
const RELEASE_POLL_MS = 4;
const RELEASE_FAST_WINDOW_MS = 50;
const RELEASE_POLL_CEILING_MS = 32;
const RELEASE_TIMEOUT_MS = 2000;

/** Polls `settlement`'s CURRENT assigned count down to `expected`, once, instead of per-resource. */
function awaitSettlementDropTo(cityID, expected) {
    return new Promise((resolve) => {
        const started = Date.now();
        const settled = () => {
            try {
                return (Cities.get(cityID)?.Resources?.getAssignedResources()?.length ?? 0) <= expected;
            } catch (error) {
                return true;
            }
        };
        let wait = RELEASE_POLL_MS;
        const check = () => {
            if (settled()) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= RELEASE_TIMEOUT_MS) {
                resolve(false);
                return;
            }
            setTimeout(check, wait);
            if (Date.now() - started >= RELEASE_FAST_WINDOW_MS) {
                wait = Math.min(wait * 2, RELEASE_POLL_CEILING_MS);
            }
        };
        setTimeout(check, wait);
    });
}

function awaitReleased(cityID, resourceValue) {
    return new Promise((resolve) => {
        const started = Date.now();
        const gone = () => {
            try {
                return !(Cities.get(cityID)?.Resources?.getAssignedResources() ?? []).some(
                    (resource) => resource.value === resourceValue,
                );
            } catch (error) {
                return true;
            }
        };
        let wait = RELEASE_POLL_MS;
        const check = () => {
            if (gone()) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= RELEASE_TIMEOUT_MS) {
                resolve(false);
                return;
            }
            setTimeout(check, wait);
            if (Date.now() - started >= RELEASE_FAST_WINDOW_MS) {
                wait = Math.min(wait * 2, RELEASE_POLL_CEILING_MS);
            }
        };
        setTimeout(check, wait);
    });
}

/**
 * Releases one SLOT-GRANTING resource, pulling companions out of `queue` only for as long as the
 * engine keeps refusing it. @returns how many were released in total, this one included.
 */
async function releaseOne(resource, queue) {
    if (trySend(resource)) {
        await awaitReleased(resource.cityID, resource.resourceValue);
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
        await awaitReleased(companion.cityID, companion.resourceValue);

        if (trySend(resource)) {
            await awaitReleased(resource.cityID, resource.resourceValue);
            return released + 1;
        }
    }

    warn(
        `could not unassign ${resource.resourceType} (value ${resource.resourceValue}) - ` +
            `the engine still refuses it after freeing ${released} slot(s)`,
    );
    return released;
}

/**
 * ⚠️ ORDINARY RESOURCES NEVER NEED TO WAIT FOR EACH OTHER (2026-09-21 bug report: confirming
 * every single release individually - correct after the previous fix - made a bulk unassign
 * crawl, one resource at a time, for a settlement that used to clear in one breath). Removing an
 * ordinary resource only ever FREES room, so no other ordinary resource's `canUnassign` depends
 * on it having actually landed yet; they can all be sent back to back with no wait in between.
 * Only a SLOT-GRANTING one changes that - see `awaitReleased`'s own note - so the wait is spent
 * ONCE, right before those, rather than after every resource on the way there.
 */
async function release(settlement, doomed) {
    const queue = companionCandidates(settlement, doomed);
    const slotGranting = doomed.filter((resource) => grantsBonusSlots(resource.resourceType));
    const ordinary = doomed.filter((resource) => !grantsBonusSlots(resource.resourceType));

    let released = 0;
    for (const resource of ordinary) {
        if (trySend(resource)) {
            released++;
        }
    }

    if (slotGranting.length === 0) {
        return released;
    }

    if (released > 0) {
        await awaitSettlementDropTo(settlement.cityID, settlement.slottedResources.length - released);
    }
    for (const resource of slotGranting) {
        released += await releaseOne(resource, queue);
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

/**
 * Shapes a raw `getAssignedResources()` entry the way `release()`/`companionCandidates` expect -
 * `resourceValue` and `cityID`, not `value`, and a real `resourceType` rather than none.
 * `engine/` may not import `model/headless-model.js`, which builds the same shape for the
 * screen - this is the same conversion, kept local to stay under the layer rule.
 */
function toReleaseShape(cityID, resource) {
    return { resourceValue: resource.value, resourceType: heldResourceType(resource), cityID };
}

/**
 * A bulk `doomed` list, slot-granting resources (camels) moved to the END.
 *
 * ⚠️ WHY, ON TOP OF `companionCandidates` (2026-09-20 bug report). That queue is a reserve drawn
 * from whatever is NOT in `doomed` - fine for `unassignOne`, where almost the whole settlement
 * qualifies as a reserve, but a bulk clear dooms nearly everything TOGETHER, so once locked
 * resources are (correctly) excluded there is often no reserve left at all. `release()` still
 * works here because it processes `doomed` one at a time: a camel ordered last is only tried
 * once its own bulk-mates have already left and made room on their own, no reserve needed. A
 * camel sorted first - the settlement's own slot order - was tried while everything else was
 * still assigned, found no room, and had nothing left in the queue to free it either.
 */
function slotGrantingLast(doomed) {
    return [...doomed].sort(
        (a, b) => Number(grantsBonusSlots(a.resourceType)) - Number(grantsBonusSlots(b.resourceType)),
    );
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

    let cleared;
    if (doomed.length === assigned.length && requestClearSettlement(cityID)) {
        cleared = assigned.length;
        // ⚠️ Nothing went through `release()`, so nothing is coming back that way.
        await waitForEngineEvent(UNASSIGNED_EVENT);
    } else {
        /*
         * ⚠️ THROUGH `release()`, NOT A PLAIN PER-RESOURCE LOOP (2026-09-20 bug report). A camel
         * among `doomed` shrinks the settlement's capacity the moment it leaves, so the engine
         * refuses it outright unless something else has already gone first - `release()`, with
         * camels ordered last (`slotGrantingLast`), is what lets that happen naturally.
         */
        const settlement = { cityID, slottedResources: assigned.map((resource) => toReleaseShape(cityID, resource)) };
        const doomedShaped = slotGrantingLast(doomed.map((resource) => toReleaseShape(cityID, resource)));
        cleared = await release(settlement, doomedShaped);
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

        if (doomed.length === assigned.length && requestClearSettlement(city.id)) {
            cleared += assigned.length;
            // ⚠️ Only when something was actually sent, and these are chained one per settlement -
            // a whole empire of refusals used to cost the full timeout apiece. See `release`.
            await waitForEngineEvent(UNASSIGNED_EVENT);
        } else {
            // ⚠️ Same reasoning as `unassignSettlement` - camels ordered last so their own
            // bulk-mates make room naturally, through `release()` rather than the plain loop
            // this replaced (2026-09-20 bug report: camels left stuck in a settlement that also
            // held a locked resource).
            const settlement = {
                cityID: city.id,
                slottedResources: assigned.map((resource) => toReleaseShape(city.id, resource)),
            };
            const doomedShaped = slotGrantingLast(doomed.map((resource) => toReleaseShape(city.id, resource)));
            cleared += await release(settlement, doomedShaped);
        }
    }

    // ⚠️ Last, and it is not optional: everything above waits for ONE event per settlement (the
    // bulk-clear branch) or per resource (the `release()` branch), and a cleared settlement can
    // still have releases in flight either way. See `awaitReleasesLanded`.
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
