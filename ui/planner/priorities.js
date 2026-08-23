/**
 * What each settlement should be fed first. The picker is screen/settlement-controls.js and the
 * storage is ./priority-store.js; this is the meaning in between.
 */
import { forgetLoadedGame, storePriority, storedPriority } from './priority-store.js';

export const PRIORITY_OPTIONS = [
    { type: null },
    { type: 'YIELD_FOOD' },
    { type: 'YIELD_PRODUCTION' },
    { type: 'YIELD_HAPPINESS' },
    { type: 'YIELD_CULTURE' },
    { type: 'YIELD_SCIENCE' },
    { type: 'YIELD_GOLD' },
    { type: 'YIELD_DIPLOMACY' },
];

/** The name to show for a priority. */
export function priorityLabel(type) {
    if (!type) {
        return Locale.compose('LOC_NAJANE_COMMERCE_PRIORITY_BALANCED');
    }
    const definition = GameInfo.Yields.lookup(type);
    return Locale.compose(definition?.Name ?? type);
}

const priorityByCity = new Map();
export function cityKey(cityID) {
    return String(cityID.id);
}

/**
 * What "Balanced" RESOLVES TO - not a value that is stored or displayed. A city wants production;
 * a town wants food, because it turns production into gold rather than building with it.
 *
 * ⚠️ It used to be what `getPriority` returned for a settlement nobody had chosen for, so the
 * picker showed "Production" on a settlement the player had never touched - a choice they had not
 * made, presented as one they had.
 *
 * ⚠️ Not what Resource+ made it mean either: there a settlement with no priority took whichever
 * yield it had least of, which pulled every settlement towards the same shapeless middle.
 */
export const DEFAULT_CITY_PRIORITY = 'YIELD_PRODUCTION';
export const DEFAULT_TOWN_PRIORITY = 'YIELD_FOOD';

/** What the player chose, or null for Balanced - including "never chose anything". */
export function getPriority(cityID) {
    const key = cityKey(cityID);
    if (priorityByCity.has(key)) {
        return priorityByCity.get(key);
    }
    // Chosen in an earlier session? Take it, and keep it in memory from now on.
    const remembered = storedPriority(key);
    if (remembered !== undefined) {
        priorityByCity.set(key, remembered);
        return remembered;
    }
    return null;
}

/** The yield the scoring should feed this settlement first - never null. */
export function effectivePriority(cityID, isTown = undefined) {
    const chosen = getPriority(cityID);
    if (chosen) {
        return chosen;
    }
    const town = isTown === undefined ? !!Cities.get(cityID)?.isTown : !!isTown;
    return town ? DEFAULT_TOWN_PRIORITY : DEFAULT_CITY_PRIORITY;
}

/** Drops everything remembered about priorities, in memory and in storage. */
export function forgetPriorityMemory() {
    priorityByCity.clear();
    forgetLoadedGame();
}

export function setPriority(cityID, yieldType) {
    const key = cityKey(cityID);
    priorityByCity.set(key, yieldType);
    storePriority(key, yieldType);
}
