/**
 * Each settlement's chosen priority, kept IN THE SAVE (engine/save-store.js), so a loaded save
 * holds exactly the priorities it was saved with. Planner layer: only the planner reads it.
 *
 * ⚠️ A settlement is identified by the numeric part of its ComponentID, which is only unique
 * within one game - safe here because the save itself is per game. The old seed-keyed
 * `modSettings` section `priorities` is migrated once; see save-store.js.
 */
import { savedMap, writeSaved } from '../engine/save-store.js';
import { log, warn } from '../support/diagnostics.js';

/** The store's name in the save, and the `modSettings` section it is migrated out of once. */
const STORE = 'priorities';
const STORE_OPTIONS = { legacySection: 'priorities' };

/**
 * Stored as an index into this list PLUS ONE, so 0/null/undefined all mean "never chosen" and
 * cannot be confused with Balanced at index 0. ⚠️ Append only.
 */
const CODES = [
    null, // Balanced
    'YIELD_FOOD',
    'YIELD_PRODUCTION',
    'YIELD_HAPPINESS',
    'YIELD_CULTURE',
    'YIELD_SCIENCE',
    'YIELD_GOLD',
    'YIELD_DIPLOMACY',
];

let reported = false;

function priorities() {
    const map = savedMap(STORE, STORE_OPTIONS);
    if (!reported && map) {
        reported = true;
        log(`priorities read from the save: ${map.size} settlement(s)`);
    }
    return map;
}

/**
 * Whether the store can be read at all yet.
 * ⚠️ Before the save can be reached every answer is "never chosen", and a caller that
 * remembers that would hide the real choices for the rest of the session. See `getPriority`.
 */
export function isPriorityStoreReady() {
    return priorities() !== null;
}

/** @returns the stored priority, `null` for an explicit Balanced, or undefined if unset. */
export function storedPriority(cityKey) {
    const index = Number(priorities()?.get(String(cityKey))) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= CODES.length) {
        return undefined;
    }
    return CODES[index];
}

export function storePriority(cityKey, yieldType) {
    const index = CODES.indexOf(yieldType ?? null);
    if (index < 0) {
        warn(`refusing to store an unknown priority "${yieldType}"`);
        return;
    }
    if (!writeSaved(STORE, cityKey, index + 1, STORE_OPTIONS)) {
        warn(`could not save the priority for ${cityKey}`);
    }
}

/**
 * Called when a different game is loaded. The store itself is dropped by engine/save-store.js;
 * this only re-arms the one-time report.
 */
export function forgetLoadedGame() {
    reported = false;
}
