/**
 * The one place that asks the engine to assign or release a resource.
 *
 * All of it is one player operation, ASSIGN_RESOURCE, told apart by its arguments:
 * `Action: Deactivate` releases, `Action: Clear` empties a settlement, no Action assigns.
 * Mirrors the game's own commerce-screen-model.ts.
 *
 * ⚠️ Everything touching PlayerOperations belongs here. Three modules had grown their own
 * `canAssign` differing only in argument order - which is how two of them come to disagree.
 *
 * ⚠️ `sendRequest` only QUEUES; chained operations must wait in between. See ./wait.js.
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

/**
 * WHY the engine would refuse, in its own words - `canStart` returns FailureReasons as
 * localisation keys. Diagnostics only, but it is the difference between "nothing could be
 * placed" and knowing what to do about it.
 */
export function assignRefusalReasons(cityID, resourceValue) {
    try {
        const result = Game.PlayerOperations.canStart(
            GameContext.localPlayerID,
            ASSIGN(),
            assignArgs(cityID, resourceValue),
            false,
        );
        if (result.Success) {
            return [];
        }
        return (result.FailureReasons ?? []).map((reason) => {
            try {
                return Locale.compose(reason);
            } catch (error) {
                return reason;
            }
        });
    } catch (error) {
        return [`could not ask: ${error}`];
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
