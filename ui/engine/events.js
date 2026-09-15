/**
 * Every `engine.on` this mod makes, and the "is this event even mine?" filter.
 *
 * ⚠️ Engine events are raised for EVERY player - `UnitMoved` and friends arrive in thousands per
 * AI turn - so an unfiltered handler runs thousands of times to conclude somebody else's scout
 * moved. Same check `panel-action.ts` opens `onUnitMoved` with. An UNKNOWN owner is never filtered
 * out: a dropped trigger looks exactly like a feature that does nothing.
 *
 * ⚠️ ONE engine subscription per event name, however many listeners want it. The owner is resolved
 * at most once per event, lazily.
 *
 * ⚠️ The HANDLE is the identity, not the function: `engine.off` only ever sees the shared
 * dispatcher, so a listener that must be removable has to keep its handle.
 */
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

const OWNER_ON_ID = new Set(['NotificationAdded']);

/**
 * Which player an event is about, or null when the payload does not say.
 *
 * Field names are the game's own: `unit` / `constructible` / `cityID` / `city` are
 * ComponentIDs, `player` is a plain id, and a payload carrying only `location` is answered by
 * asking the plot who owns it - what `panel-production-chooser.ts` does.
 */
function eventOwner(name, data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    // ⚠️ `NotificationAdded` carries its owner only on `id` - what `panel-action` and the
    // notification-train model read - and without this every AI notification passed as ours.
    // Scoped by name: in other payloads `id` need not be about a player.
    if (OWNER_ON_ID.has(name) && typeof data.id?.owner === 'number') {
        return data.id.owner;
    }
    const direct =
        data.unit?.owner ??
        data.constructible?.owner ??
        data.cityID?.owner ??
        data.city?.owner ??
        // ⚠️ `ResourceUnassigned` names the settlement the resource LEFT and nothing else, so
        // without this its owner came from the resource's PLOT - which for an import is somebody
        // else's land, and the event was filtered out as theirs.
        data.targetCity?.owner ??
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
function isSomeoneElses(name, data) {
    const owner = eventOwner(name, data);
    return owner !== null && owner !== GameContext.localPlayerID;
}

/**
 * name -> `{ listeners, dispatch }`, listeners in subscription order.
 * ⚠️ `listeners` is REPLACED on every change, never mutated: `deliver` iterates it directly, so a
 * handler that subscribes or unsubscribes mid-dispatch cannot disturb the loop, and no event -
 * thousands per AI turn - pays for a copy.
 */
const byName = new Map();

// Counted only with diagnostics on; see logEventStats.
const counts = DIAGNOSTICS ? new Map() : null;
const millis = DIAGNOSTICS ? new Map() : null;

function now() {
    return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

function deliver(entry, name, data) {
    // ⚠️ `mine` starts as "not asked yet", so a name whose listeners are all unfiltered never
    // calls eventOwner - which for a location-only payload is a map query.
    let mine = null;
    const listeners = entry.listeners;
    for (let i = 0; i < listeners.length; i++) {
        const listener = listeners[i];
        if (listener.localOnly) {
            if (mine === null) {
                mine = !isSomeoneElses(name, data);
            }
            if (!mine) {
                continue;
            }
        }
        try {
            listener.handler(data);
        } catch (error) {
            warn(`a handler for ${name} failed: ${error}`);
        }
    }
}

function subscribe(name, handler, localOnly) {
    let entry = byName.get(name);
    if (!entry) {
        entry = { listeners: [], dispatch: null };
        entry.dispatch = (data) => {
            if (!DIAGNOSTICS) {
                deliver(entry, name, data);
                return;
            }
            const started = now();
            deliver(entry, name, data);
            counts.set(name, (counts.get(name) ?? 0) + 1);
            millis.set(name, (millis.get(name) ?? 0) + (now() - started));
        };
        try {
            engine.on(name, entry.dispatch);
        } catch (error) {
            warn(`could not listen for ${name}: ${error}`);
            return null;
        }
        byName.set(name, entry);
    }
    const listener = { name, handler, localOnly };
    entry.listeners = [...entry.listeners, listener];
    return listener;
}

/**
 * @returns a handle for `stopEngineEvents`, or null if the engine refused the subscription.
 */
export function onEngineEvent(name, handler) {
    return subscribe(name, handler, false);
}

/** The same, with everybody else's events dropped before the handler is ever called. */
export function onLocalPlayerEvent(name, handler) {
    return subscribe(name, handler, true);
}

/** Subscribes to a list of names at once and hands back one list of handles. */
export function onEngineEvents(names, handler, { localPlayerOnly = true } = {}) {
    const handles = [];
    for (const name of names) {
        const handle = subscribe(name, handler, localPlayerOnly);
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
        const entry = byName.get(handle?.name);
        if (!entry) {
            continue;
        }
        if (entry.listeners.includes(handle)) {
            entry.listeners = entry.listeners.filter((listener) => listener !== handle);
        }
        // Nobody left behind the dispatcher, so the whole subscription goes.
        if (entry.listeners.length === 0) {
            try {
                engine.off(handle.name, entry.dispatch);
            } catch (error) {
                warn(`could not stop listening for ${handle.name}: ${error}`);
            }
            byName.delete(handle.name);
        }
    }
    handles.length = 0;
}

/**
 * Per event name: how many arrived since the last call and how many ms this mod spent on them.
 * Diagnostics only, and the first measurement to take when the report is "the game runs slowly".
 */
export function logEventStats() {
    if (!DIAGNOSTICS || counts.size === 0) {
        return;
    }
    const rows = [...counts]
        .map(([name, count]) => ({ name, count, ms: millis.get(name) ?? 0 }))
        .sort((a, b) => b.ms - a.ms);
    const total = rows.reduce((sum, row) => sum + row.ms, 0);
    log(
        `engine events since the last report: ${Math.round(total)}ms total - ` +
            rows.map((row) => `${row.name} x${row.count} ${Math.round(row.ms)}ms`).join(', '),
    );
    counts.clear();
    millis.clear();
}
