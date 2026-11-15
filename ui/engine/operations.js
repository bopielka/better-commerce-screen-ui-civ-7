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
 *
 * ⚠️ An OFF-MAP resource is named by `ID` (+ `Flags` when assigning), as the game's model does;
 * its value is not a plot, so `Location` alone names a different resource. See
 * ./resource-identity.js. Every function here takes `isOffMap` third for that reason.
 */
import { warn } from '../support/diagnostics.js';

const ASSIGN = () => PlayerOperationTypes.ASSIGN_RESOURCE;

function assignArgs(cityID, resourceValue, isOffMap = false) {
    const args = {
        Location: GameplayMap.getLocationFromIndex(resourceValue),
        City: cityID.id,
    };
    if (isOffMap) {
        args.Flags = true;
        args.ID = resourceValue;
    }
    return args;
}

// ⚠️ On-map args are exactly what shipped before off-map support; only an off-map one gains a field.
function unassignArgs(cityID, resourceValue, isOffMap = false) {
    const args = {
        Location: GameplayMap.getLocationFromIndex(resourceValue),
        City: cityID.id,
        Action: PlayerOperationParameters.Deactivate,
    };
    if (isOffMap) {
        args.ID = resourceValue;
    }
    return args;
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
export function assignRefusalReasons(cityID, resourceValue, isOffMap = false) {
    try {
        const result = Game.PlayerOperations.canStart(
            GameContext.localPlayerID,
            ASSIGN(),
            assignArgs(cityID, resourceValue, isOffMap),
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
export function canAssign(cityID, resourceValue, isOffMap = false) {
    return canStart(assignArgs(cityID, resourceValue, isOffMap), `resource ${resourceValue} can be assigned`);
}

/** Sends without re-checking; callers ask canAssign first. */
export function requestAssign(cityID, resourceValue, isOffMap = false) {
    return send(assignArgs(cityID, resourceValue, isOffMap), `assigning resource ${resourceValue}`);
}

//#endregion

//#region releasing
export function canUnassign(cityID, resourceValue, isOffMap = false) {
    if (!cityID || resourceValue === undefined || resourceValue === -1) {
        return false;
    }
    return canStart(unassignArgs(cityID, resourceValue, isOffMap), `resource ${resourceValue} can be unassigned`);
}

/** Sends without re-checking; callers ask canUnassign first. */
export function requestUnassign(cityID, resourceValue, isOffMap = false) {
    return send(unassignArgs(cityID, resourceValue, isOffMap), `unassigning resource ${resourceValue}`);
}

/** Empties one settlement in a single operation, rather than one resource at a time. */
export function requestClearSettlement(cityID) {
    return checkedSend(clearArgs(cityID), 'clearing a settlement');
}
//#endregion
