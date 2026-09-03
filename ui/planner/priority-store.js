/**
 * Each settlement's chosen priority, across reloads.
 *
 * ⚠️ `UI.setOption` + `saveCheckpoint()`, storing a NUMBER - `localStorage` alone did not survive
 * a reload, and every use of setOption in the game itself passes a number. localStorage is kept
 * as a mirror.
 *
 * ⚠️ Keyed per game by `Configuration.getGame().gameSeed`: a settlement is identified by the
 * numeric part of its ComponentID, which is only unique within one game. Nothing is written into
 * the save - this mod declares AffectsSavedGames = 0.
 */
import { readSection, writeSection } from '../engine/mod-storage.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';
/** ⚠️ A section of the SHARED `modSettings` key - see engine/mod-storage.js for why. */
const SECTION = 'priorities';

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

let gameKey = null;
let reportedKey = false;

function currentGameKey() {
    if (gameKey !== null) {
        return gameKey;
    }
    try {
        const seed = Configuration.getGame()?.gameSeed;
        gameKey = seed === undefined || seed === null ? null : String(seed);
    } catch (error) {
        gameKey = null;
    }
    if (!reportedKey) {
        reportedKey = true;
        log(`priorities are filed under game seed ${gameKey ?? '(unavailable)'}`);
    }
    return gameKey;
}

function optionName(cityKey) {
    return `${MOD_ID}.priority.${currentGameKey()}.${cityKey}`;
}

function readFallback(cityKey) {
    return readSection(SECTION)?.[currentGameKey()]?.[cityKey];
}

function writeFallback(cityKey, code) {
    writeSection(SECTION, (all) => {
        const key = currentGameKey();
        all[key] ??= {};
        all[key][cityKey] = code;
    });
}

/**
 * Whether the store can be read at all yet.
 * ⚠️ Before the game seed is available every answer is "never chosen", and a caller that
 * remembers that would hide the real choices for the rest of the session. See `getPriority`.
 */
export function isPriorityStoreReady() {
    return currentGameKey() !== null;
}

/** @returns the stored priority, `null` for an explicit Balanced, or undefined if unset. */
export function storedPriority(cityKey) {
    if (currentGameKey() === null) {
        return undefined;
    }

    let code = null;
    try {
        code = UI.getOption('user', 'Mod', optionName(cityKey));
    } catch (error) {
        warn(`could not read the stored priority for ${cityKey}: ${error}`);
    }
    if (code == null) {
        code = readFallback(cityKey);
    }

    const index = Number(code) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= CODES.length) {
        return undefined;
    }
    return CODES[index];
}

export function storePriority(cityKey, yieldType) {
    if (currentGameKey() === null) {
        return;
    }
    const index = CODES.indexOf(yieldType ?? null);
    if (index < 0) {
        warn(`refusing to store an unknown priority "${yieldType}"`);
        return;
    }

    const code = index + 1;
    try {
        UI.setOption('user', 'Mod', optionName(cityKey), code);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the priority for ${cityKey}: ${error}`);
    }
    writeFallback(cityKey, code);
}

/** Called when a different game is loaded, so the next read uses that game's key. */
export function forgetLoadedGame() {
    gameKey = null;
    reportedKey = false;
}
