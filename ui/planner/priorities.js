/**
 * What each settlement should be fed first. The picker is screen/settlement-controls.js and the
 * storage is ./priority-store.js; this is the meaning in between.
 */
import { forgetLoadedGame, isPriorityStoreReady, storePriority, storedPriority } from './priority-store.js';

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
 * ⚠️ A database lookup and a compose, and the picker asks it for all eight options on every
 * settlement card it builds. Neither answer can change while the game runs.
 */
const labelByType = new Map();

export function priorityLabel(type) {
    const key = type ?? '';
    let label = labelByType.get(key);
    if (label === undefined) {
        label = type
            ? Locale.compose(GameInfo.Yields.lookup(type)?.Name ?? type)
            : Locale.compose('LOC_NAJANE_COMMERCE_PRIORITY_BALANCED');
        labelByType.set(key, label);
    }
    return label;
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

/**
 * What the player chose, or null for Balanced - including "never chose anything".
 *
 * ⚠️ "NOBODY CHOSE ONE" IS REMEMBERED TOO, and that is a performance fix. It used to fall
 * through, so every settlement without a priority - the normal case - cost a `UI.getOption` on
 * every call. The scoring asks this once per (resource kind x settlement) pair and plans a fresh
 * pass for every resource it places, so a full empire made tens of thousands of them.
 *
 * ⚠️ But only once the store can actually be READ; see `isPriorityStoreReady`.
 */
export function getPriority(cityID) {
    const key = cityKey(cityID);
    if (priorityByCity.has(key)) {
        return priorityByCity.get(key);
    }
    // Chosen in an earlier session? Take it, and keep it in memory from now on.
    const remembered = storedPriority(key) ?? null;
    if (isPriorityStoreReady()) {
        priorityByCity.set(key, remembered);
    }
    return remembered;
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
