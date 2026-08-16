/**
 * Returning assigned resources to the unassigned pool.
 *
 * This mirrors the game's own `unassignResource` in commerce-screen-model.ts exactly:
 * the ASSIGN_RESOURCE player operation with Action = Deactivate. Going through
 * PlayerOperations rather than poking the model means the engine stays the single
 * source of truth and the screen refreshes itself through the ResourceUnassigned
 * event it already listens for.
 *
 * The model's own `unslotSelectedResource()` is deliberately not used: it works on
 * whatever is currently selected, so driving it would mean selecting each resource
 * first, and for the bulk case that would push the selection signal through one
 * change per resource.
 *
 * Why this is asynchronous
 * ------------------------
 * `sendRequest` only queues the operation. Asking `canStart` about a second resource in
 * the same tick still sees the old state. A resource that carries slots (a camel) can
 * therefore not be removed in one pass: its companions have to actually land first.
 * The first attempt at this fired everything at once, and the result was exactly that -
 * the companions went, the camel stayed, and the next click charged two more companions
 * for a removal that no longer needed any.
 *
 * So each step waits for the engine to confirm before deciding the next one, and the
 * decision is made by asking `canStart` rather than by arithmetic: companions are pulled
 * one at a time and only until the resource the player actually clicked is accepted.
 */
import {
    canAssign,
    canUnassign,
    requestClearSettlement,
    requestUnassign,
    unassignIfAllowed,
} from './operations.js';
import { companionCandidates } from './resource-slots.js';
import { waitForEngineEvent } from './wait.js';
import { log, warn } from '../support/diagnostics.js';

const UNASSIGNED_EVENT = 'ResourceUnassigned';

function trySend(resource) {
    return (
        canUnassign(resource.cityID, resource.resourceValue) &&
        requestUnassign(resource.cityID, resource.resourceValue)
    );
}

/**
 * Releases one resource, pulling companions out of `queue` only for as long as the
 * engine keeps refusing it.
 *
 * @returns how many resources were released in total, this one included.
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
        released += await releaseOne(resource, queue);
        await waitForEngineEvent(UNASSIGNED_EVENT);
    }
    return released;
}

/**
 * Frees enough room in the settlement a resource is LEAVING for it to be allowed to go.
 *
 * Moving a camel out shrinks the old settlement's capacity by two, so the engine refuses
 * the move outright unless there is already room to absorb that - which is why dragging a
 * camel out of a full settlement silently did nothing. Same treatment as unassigning one:
 * companions are released from the end of the source's list, one at a time, and only for
 * as long as the engine keeps refusing.
 *
 * @returns true if the move is now allowed.
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
 * Empties every settlement the local player owns.
 *
 * ⚠️ The ONE implementation of this. There were three - the Reassign All button, the
 * automatic rebuild and the Unassign All button - and they had already drifted: one counted
 * resources and one counted settlements, one had a fallback and one did not, and only two
 * of them waited for the engine. Three answers to "did that work?" for one action.
 *
 * The operation is the game's own: `clearAllResources` in commerce-screen-model.ts walks
 * the player's cities and sends ASSIGN_RESOURCE with `Action: Clear` for each, which is
 * exactly what `requestClearSettlement` sends. Two things are added on top, and both are
 * needed here and not there:
 *
 *   - a wait between settlements, because `sendRequest` only QUEUES. The game does not
 *     plan anything afterwards; this mod immediately lays the empire out again, and
 *     planning against a board that has not emptied yet places resources that are about to
 *     be released;
 *   - a per-resource fallback for when the engine refuses the bulk form, so a settlement it
 *     will not clear in one go is still emptied rather than silently skipped.
 *
 * Read straight from the game rather than from the Commerce screen's model, so the same
 * call works with the screen shut.
 *
 * @returns how many resources were released.
 */
export async function unassignEverySettlement() {
    let cleared = 0;
    const cities = Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? [];

    for (const city of cities) {
        const assigned = city.Resources?.getAssignedResources() ?? [];
        if (assigned.length === 0) {
            continue;
        }

        if (requestClearSettlement(city.id)) {
            cleared += assigned.length;
        } else {
            for (const resource of assigned) {
                if (unassignIfAllowed(city.id, resource.value)) {
                    cleared++;
                } else {
                    warn(`failed to request unassign for resource ${resource.value}`);
                }
            }
        }
        await waitForEngineEvent(UNASSIGNED_EVENT);
    }

    return cleared;
}

/**
 * Every resource of one kind (RESOURCE_JADE, RESOURCE_CAMELS, ...) assigned to one
 * settlement, plus anything that turns out to have to leave with them. Other
 * settlements keep theirs.
 */
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
