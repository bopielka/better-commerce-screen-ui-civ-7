/**
 * Subscribing to engine events without paying for everybody else's turn.
 *
 * ⚠️ THE ENGINE'S EVENTS ARE NOT ABOUT YOU. `UnitMoved`, `UnitMoveComplete`,
 * `UnitMovementPointsChanged`, `ConstructibleChanged` and the rest are raised for EVERY
 * player, and in a late game the AI raises thousands of them between one of your turns and
 * the next. Every one of those crosses into this mod's JavaScript, and what this mod did
 * with most of them was walk the player's whole unit list to conclude that nothing had
 * happened. That is the single largest thing this mod ever cost a frame.
 *
 * The game's own components do not work that way. `panel-action.ts` opens `onUnitMoved` with
 *
 *     if (data.unit.owner !== GameContext.localPlayerID) { return; }
 *
 * and `panel-production-chooser.ts` does the same for a constructible by asking the plot who
 * owns it. This module is that check, written once, so no listener here has to remember it.
 *
 * ⚠️ An UNKNOWN owner is never filtered out. Not every payload carries one, and dropping an
 * event because we could not name its owner would trade a performance problem for a
 * correctness one - the failure mode this mod's own history is full of, where a missing
 * trigger looks exactly like a feature that does nothing.
 *
 * Every subscription hands back a handle, and `stopEngineEvents` takes a list of them away
 * again. `engine.off` needs the SAME function reference that was registered, which is why
 * nothing here takes an inline arrow and forgets it - see the leak fixed in
 * screen/assign-all-buttons.js.
 */
import { warn } from '../support/diagnostics.js';

/**
 * Which player an event is about, or **null** when the payload does not say.
 *
 * The field names are the game's own, taken from the payload types its components read:
 *
 *   `unit`           ComponentID - every `Unit*` event (`panel-action.ts`)
 *   `constructible`  ComponentID - `ConstructibleBuildCompleted` (`tutorial-items-*.ts`)
 *   `cityID`/`city`  ComponentID - the city events
 *   `player`         a plain id - `ResourceUnassigned` and friends
 *   `location`       no owner at all, so the PLOT is asked who owns it, which is what
 *                    `panel-production-chooser.ts` does for `ConstructibleAddedToMap`
 */
function eventOwner(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    const direct =
        data.unit?.owner ??
        data.constructible?.owner ??
        data.cityID?.owner ??
        data.city?.owner ??
        data.player ??
        data.owner;
    if (typeof direct === 'number') {
        return direct;
    }
    const location = data.location;
    if (location && typeof location.x === 'number' && typeof location.y === 'number') {
        try {
            const owningCity = GameplayMap.getOwningCityFromXY(location.x, location.y);
            if (typeof owningCity?.owner === 'number') {
                return owningCity.owner;
            }
        } catch (error) {
            return null;
        }
    }
    return null;
}

/** Whether this payload is about somebody else. Unknown counts as ours; see the header. */
export function isSomeoneElses(data) {
    const owner = eventOwner(data);
    return owner !== null && owner !== GameContext.localPlayerID;
}

/**
 * @returns a handle for `stopEngineEvents`, or null if the engine refused the subscription.
 */
export function onEngineEvent(name, handler) {
    try {
        engine.on(name, handler);
        return { name, handler };
    } catch (error) {
        warn(`could not listen for ${name}: ${error}`);
        return null;
    }
}

/** The same, with everybody else's events dropped before the handler is ever called. */
export function onLocalPlayerEvent(name, handler) {
    return onEngineEvent(name, (data) => {
        if (isSomeoneElses(data)) {
            return;
        }
        handler(data);
    });
}

/** Subscribes to a list of names at once and hands back one list of handles. */
export function onEngineEvents(names, handler, { localPlayerOnly = true } = {}) {
    const subscribe = localPlayerOnly ? onLocalPlayerEvent : onEngineEvent;
    const handles = [];
    for (const name of names) {
        const handle = subscribe(name, handler);
        if (handle) {
            handles.push(handle);
        }
    }
    return handles;
}

/** Takes every handle in the list off again, and empties it. */
export function stopEngineEvents(handles) {
    if (!handles) {
        return;
    }
    for (const handle of handles) {
        try {
            engine.off(handle.name, handle.handler);
        } catch (error) {
            warn(`could not stop listening for ${handle.name}: ${error}`);
        }
    }
    handles.length = 0;
}
