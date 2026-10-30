/**
 * Per-game state that must load back EXACTLY as it was saved: written INTO THE SAVE FILE through
 * the game's own `Catalog` (core/ui/utilities/utility-serialize.js), i.e. dynamic properties of the
 * local player. Engine layer: merchant orders and the trade queue run with the screen closed, and
 * planner/ (settlement priorities) may import downwards. Resource locks live here too.
 *
 * ⚠️ NEVER import this from anything ui/options/ reaches: it opens the game's save, and the options
 * screen also loads in SHELL scope, where there is no game.
 *
 * ⚠️ IN THE SAVE, NOT IN localStorage (user's instruction, 2026-10-30). A store keyed by the game
 * seed cannot tell two saves of one game apart - the seed survives a reload, so a route planned
 * later leaked into an older save. Same move, same reason, as najane-recurring-diplomacy.
 *
 * ⚠️ ONE PROPERTY PER STORE, holding the whole map as `key=value,key=value`. A `SerialObject` can
 * never drop a key, so one key per merchant would grow the save with every unit id ever ordered.
 * Keys must therefore contain neither '=' nor ','; values are positive integers.
 *
 * ⚠️ A PLAYER-CATALOG WRITE IS QUEUED: a read in the same frame still returns the old value. So a
 * store is read from the save ONCE and served from memory after that - this module is its only
 * writer, so memory is always at least as new as the save.
 */
import { Catalog } from '/core/ui/utilities/utility-serialize.js';
import { currentGameKey, readSection, writeSection } from './mod-storage.js';
import { onGameDataStale } from '../support/game-data.js';
import { warn } from '../support/diagnostics.js';

const CATALOG_NAME = 'NajaneBetterCommerce';
const CATALOG_VERSION = 1;
const OBJECT_ID = 'state';

/** `{ playerId, catalog, object }` for the local player, opened on first use. */
let opened = null;

/** store name -> Map<string, number>, read from the save once per game. */
const maps = new Map();

/**
 * ⚠️ Dropped on `GameStarted` / `GameAgeEnded`: another game may be loaded into the same session,
 * with the same local player id, and the old catalog's listener would go on hearing its commits.
 */
onGameDataStale(() => {
    try {
        opened?.catalog.dispose();
    } catch (error) {
        // A listener that cannot be removed only costs a filtered no-op per property change.
    }
    opened = null;
    maps.clear();
});

/** ⚠️ NULL IS NEVER CACHED: before the local player exists, a later call must try again. */
function stateObject() {
    const playerId = GameContext.localPlayerID;
    if (opened?.playerId === playerId) {
        return opened.object;
    }
    try {
        const player = Players.get(playerId);
        if (!player) {
            return null;
        }
        const catalog = new Catalog({ name: CATALOG_NAME, version: CATALOG_VERSION, player });
        opened = { playerId, catalog, object: catalog.getObject(OBJECT_ID) };
        maps.clear();
        return opened.object;
    } catch (error) {
        warn(`could not open this mod's store in the save: ${error}`);
        return null;
    }
}

function parse(raw) {
    const map = new Map();
    if (typeof raw !== 'string' || raw.length === 0) {
        return map;
    }
    for (const pair of raw.split(',')) {
        const [key, value] = pair.split('=');
        const number = Number(value);
        if (key && Number.isFinite(number) && number !== 0) {
            map.set(key, number);
        }
    }
    return map;
}

/**
 * Carries this game's entries out of the old seed-keyed `localStorage` section, then deletes them
 * there. ⚠️ Only into a save that has none of its own: an older save loaded first after the update
 * gets the in-flight orders once; from then on every save holds exactly what it was saved with.
 */
function adoptLegacy(legacySection, map, object, name) {
    const game = currentGameKey();
    if (!legacySection || game === null) {
        return;
    }
    const legacy = readSection(legacySection)?.[game];
    if (!legacy || typeof legacy !== 'object') {
        return;
    }
    if (map.size === 0) {
        for (const [key, value] of Object.entries(legacy)) {
            if (Number(value) > 0) {
                map.set(String(key), Number(value));
            }
        }
        if (map.size > 0) {
            write(object, name, map);
        }
    }
    writeSection(legacySection, (all) => {
        delete all[game];
    });
}

function write(object, name, map) {
    try {
        object.write(name, [...map].map(([key, value]) => `${key}=${value}`).join(','));
        return true;
    } catch (error) {
        warn(`could not write ${name} into the save: ${error}`);
        return false;
    }
}

/**
 * The live map of one store, or null while the save cannot be reached yet.
 * ⚠️ Read-only for callers; change it through `writeSaved`, which is what reaches the save.
 * @param legacySection the `modSettings` section this store used to live in, migrated once.
 */
export function savedMap(name, { legacySection = null } = {}) {
    const object = stateObject();
    if (!object) {
        return null;
    }
    let map = maps.get(name);
    if (map) {
        return map;
    }
    let raw;
    try {
        raw = object.read(name);
    } catch (error) {
        warn(`could not read ${name} from the save: ${error}`);
        return null;
    }
    map = parse(raw);
    maps.set(name, map);
    adoptLegacy(legacySection, map, object, name);
    return map;
}

/**
 * Sets one entry; a value of 0 (or anything not positive) removes it.
 * @returns false when the save could not be reached, so the caller can refuse the action.
 */
export function writeSaved(name, key, value, options) {
    const map = savedMap(name, options);
    if (!map) {
        return false;
    }
    const id = String(key);
    const number = Number(value);
    if (number > 0) {
        if (map.get(id) === number) {
            return true;
        }
        map.set(id, number);
    } else if (!map.delete(id)) {
        return true;
    }
    return write(opened.object, name, map);
}
