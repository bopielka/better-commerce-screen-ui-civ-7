/**
 * What each settlement should be fed first.
 *
 * A priority is the player's answer to "what is this settlement for", chosen from the
 * picker on its card. It is the dominant term in the scoring - see scoring.js - and it
 * outlives the session, so this module is also the in-memory half of the store in
 * priority-store.js: read once from there, kept here, written back on every change.
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

/**
 * The name to show for a priority.
 *
 * Every yield already has a translated name in the game's own data, so only "Balanced"
 * needs a string of ours - one line of translation instead of eight per language.
 */
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
 * What "Balanced" means.
 *
 * A city wants production. A town wants food: it turns its production into gold rather
 * than building with it, so production would be steering it nowhere, while food is what
 * a town grows on.
 *
 * ⚠️ This is what Balanced RESOLVES TO, not a value that gets stored or displayed. It used
 * to be what `getPriority` returned for a settlement nobody had chosen for, which meant the
 * picker on the card showed "Production" on a settlement the player had never touched - a
 * choice they had not made, presented as one they had.
 *
 * Balanced also no longer means what Resource+ made it mean. There, a settlement with no
 * priority took whichever yield it had least of, which pulled every settlement towards the
 * same shapeless middle. City-production / town-food is a stance instead of an average, and
 * it is the one the rest of the scoring is built around.
 */
export const DEFAULT_CITY_PRIORITY = 'YIELD_PRODUCTION';
export const DEFAULT_TOWN_PRIORITY = 'YIELD_FOOD';

/**
 * What the player chose, or null for Balanced - including "never chose anything".
 *
 * Read by the picker, which needs the player's own answer and not an interpretation of it.
 * The scoring wants `effectivePriority` instead.
 */
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

/**
 * The yield the scoring should feed this settlement first - never null.
 *
 * @param isTown pass it when the caller already knows; looked up otherwise.
 */
export function effectivePriority(cityID, isTown = undefined) {
    const chosen = getPriority(cityID);
    if (chosen) {
        return chosen;
    }
    const town = isTown === undefined ? !!Cities.get(cityID)?.isTown : !!isTown;
    return town ? DEFAULT_TOWN_PRIORITY : DEFAULT_CITY_PRIORITY;
}

/**
 * Drops everything remembered about priorities, in memory and in the cached file.
 *
 * Called when a game is loaded. Settlements are identified by the numeric part of their
 * ComponentID, which means the same key is a different city in a different campaign - so
 * carrying the in-memory map across a load would apply one game's choices to another's
 * cities.
 */
export function forgetPriorityMemory() {
    priorityByCity.clear();
    forgetLoadedGame();
}

export function setPriority(cityID, yieldType) {
    const key = cityKey(cityID);
    priorityByCity.set(key, yieldType);
    storePriority(key, yieldType);
}
