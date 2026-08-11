/**
 * Remembering each settlement's chosen priority across reloads.
 *
 * Where it goes
 * -------------
 * `UI.setOption("user", "Mod", …)` followed by `Configuration.getUser().saveCheckpoint()` -
 * the same channel the mod's options use, and the one that demonstrably survives a
 * restart. The first attempt at this used `localStorage` alone and did not come back
 * after a reload; note that every use of `UI.setOption` in the game itself passes a
 * NUMBER, so priorities are stored as a small integer rather than as JSON.
 *
 * `localStorage` is kept as a second write, mirroring the options module: harmless if it
 * works, ignored if it does not.
 *
 * Not the save file: this mod declares `AffectsSavedGames = 0`, and writing into a save
 * would make that a lie and tie the save to having the mod installed.
 *
 * Keyed per game
 * --------------
 * A settlement is identified by the numeric part of its ComponentID, which is only unique
 * within one game - the same number is a different city in the next campaign. Every entry
 * is therefore filed under `Configuration.getGame().gameSeed`, fixed for the life of a
 * game and different between games.
 */
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';
const STORAGE_KEY = 'najane-commerce-priorities';

/**
 * Stored as an index into this list, plus one - so that 0, null and undefined all mean
 * "never chosen" and cannot be confused with Balanced, which is the entry at index 0.
 *
 * ⚠️ Append only. Reordering would silently reinterpret everything already stored.
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
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return all?.[currentGameKey()]?.[cityKey];
    } catch (error) {
        return undefined;
    }
}

function writeFallback(cityKey, code) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const key = currentGameKey();
        all[key] ??= {};
        all[key][cityKey] = code;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (error) {
        // The primary channel is UI.setOption; this one is a bonus.
    }
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
