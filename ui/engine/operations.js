/**
 * The one place that knows how to ask the engine to assign or release a resource.
 *
 * Every one of these is the same player operation, ASSIGN_RESOURCE, told apart only by
 * its arguments - `Action: Deactivate` releases one, `Action: Clear` empties a whole
 * settlement, and no Action at all assigns. Mirrors `assignResource` and
 * `unassignResource` in the game's commerce-screen-model.ts.
 *
 * ⚠️ Everything that talks to PlayerOperations belongs here. This module already said so
 * and three other modules had grown their own copies anyway - the planner, the unassign
 * sequence and this file each had a `canAssign` differing only in argument order, which
 * is exactly how two of them come to disagree about what a refusal means.
 *
 * ⚠️ `sendRequest` only QUEUES. The game state - and so the answer `canStart` gives about
 * the next operation - does not change until the engine has processed it, so anything
 * chaining operations must wait in between; see ./wait.js.
 */
import { warn } from '../support/diagnostics.js';

const ASSIGN = () => PlayerOperationTypes.ASSIGN_RESOURCE;

function assignArgs(cityID, resourceValue) {
    return {
        Location: GameplayMap.getLocationFromIndex(resourceValue),
        City: cityID.id,
    };
}

function unassignArgs(cityID, resourceValue) {
    return {
        ...assignArgs(cityID, resourceValue),
        Action: PlayerOperationParameters.Deactivate,
    };
}

function clearArgs(cityID) {
    return {
        ResourceType: ResourceTypes.NO_RESOURCE,
        City: cityID.id,
        Action: PlayerOperationParameters.Clear,
    };
}

function canStart(args, what) {
    try {
        return !!Game.PlayerOperations.canStart(GameContext.localPlayerID, ASSIGN(), args, false).Success;
    } catch (error) {
        warn(`checking whether ${what} failed: ${error}`);
        return false;
    }
}

function send(args, what) {
    try {
        Game.PlayerOperations.sendRequest(GameContext.localPlayerID, ASSIGN(), args);
        return true;
    } catch (error) {
        warn(`${what} failed: ${error}`);
        return false;
    }
}

/** Sends only if the engine agrees, so a refusal is reported rather than swallowed. */
function checkedSend(args, what) {
    return canStart(args, what) && send(args, what);
}

//#region assigning
export function canAssign(cityID, resourceValue) {
    return canStart(assignArgs(cityID, resourceValue), `resource ${resourceValue} can be assigned`);
}

/** Sends without re-checking; callers ask canAssign first. */
export function requestAssign(cityID, resourceValue) {
    return send(assignArgs(cityID, resourceValue), `assigning resource ${resourceValue}`);
}
//#endregion

//#region releasing
export function canUnassign(cityID, resourceValue) {
    if (!cityID || resourceValue === undefined || resourceValue === -1) {
        return false;
    }
    return canStart(unassignArgs(cityID, resourceValue), `resource ${resourceValue} can be unassigned`);
}

/** Sends without re-checking; callers ask canUnassign first. */
export function requestUnassign(cityID, resourceValue) {
    return send(unassignArgs(cityID, resourceValue), `unassigning resource ${resourceValue}`);
}

/** Checks and sends in one go, for callers with nothing to decide in between. */
export function unassignIfAllowed(cityID, resourceValue) {
    return checkedSend(unassignArgs(cityID, resourceValue), `unassigning resource ${resourceValue}`);
}

/** Empties one settlement in a single operation, rather than one resource at a time. */
export function requestClearSettlement(cityID) {
    return checkedSend(clearArgs(cityID), 'clearing a settlement');
}
//#endregion
