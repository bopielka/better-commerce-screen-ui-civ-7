/**
 * The ONE place in this mod that touches `localStorage`, and the one key it is allowed to use.
 *
 * ⚠️ `modSettings` IS A SHARED CONVENTION WITH TEETH, and breaking it does not hurt us - it wipes
 * OTHER MODS' settings. Several published mods run this on every save of their own:
 *
 *     if (localStorage.length > 1) { localStorage.clear(); }
 *
 * (verified in bz-city-hall's `ui/options/mod-options.js` and in Leugi's `core/settings.js`, and
 * reported in the wild against City Hall, Memento Editor, More Diplo Ribbon, Policy Yields
 * Preview, Enhanced Town Focus Info and Advanced Options Menu Tweaks). So a SECOND top-level key -
 * any second key, ours included - makes the next mod that saves anything erase the whole store,
 * `modSettings` and every mod inside it.
 *
 * ⚠️ THIS MOD USED TO WRITE TWO OF THEM: `najane-commerce-priorities` and
 * `najane-commerce-merchant-orders`. Its options screen was always well behaved and used
 * `modSettings`; these two stores were not, which was enough to pull the trigger on their own.
 * Everything now lives under `modSettings['better-commerce-screen-ui']`.
 *
 * ⚠️ READ, MERGE, WRITE BACK - never `setItem('modSettings', ours)`. The object belongs to every
 * mod at once; replacing it is the same destruction by another route.
 *
 * ⚠️ Still only a MIRROR. `UI.setOption` + `saveCheckpoint()` remains the durable channel; this
 * exists because `UI.getOption` came back null for every read in UI.log on 2026-08-27. Losing what
 * is here must always mean "back to the default", never a broken state.
 */

const SHARED_KEY = 'modSettings';

/** ⚠️ Our namespace inside the shared object. The mod id, so no other mod can collide with it. */
const MOD_ID = 'better-commerce-screen-ui';

/**
 * The three keys this mod used to own, and must now clean up after.
 *
 * ⚠️ REMOVING THEM IS THE HALF THAT MATTERS. Migrating the values across is a courtesy to players
 * who already have settings; deleting the old keys is what actually stops the wipe, because a
 * leftover key goes on making `localStorage.length > 1` for ever.
 */
const LEGACY_KEYS = {
    priorities: 'najane-commerce-priorities',
    merchantOrders: 'najane-commerce-merchant-orders',
};

function readShared() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SHARED_KEY) || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

/**
 * ⚠️ Migration runs ONCE per session, lazily, on the first read or write - not at import time.
 * This module is reachable from `ui/options/`, which loads in SHELL scope where there is no game;
 * nothing here may do work before somebody asks.
 */
let migrated = false;

function migrate() {
    if (migrated) {
        return;
    }
    migrated = true;
    try {
        let carried = null;
        for (const [section, key] of Object.entries(LEGACY_KEYS)) {
            const raw = localStorage.getItem(key);
            if (raw === null) {
                continue;
            }
            try {
                const value = JSON.parse(raw);
                if (value && typeof value === 'object') {
                    carried ??= {};
                    carried[section] = value;
                }
            } catch (error) {
                // A key we cannot parse is a key not worth carrying - but still worth removing.
            }
            localStorage.removeItem(key);
        }
        if (!carried) {
            return;
        }
        const shared = readShared();
        const mine = shared[MOD_ID] ?? {};
        // ⚠️ The new home WINS on a clash. If both exist, the shared one was written later.
        for (const [section, value] of Object.entries(carried)) {
            mine[section] ??= value;
        }
        shared[MOD_ID] = mine;
        localStorage.setItem(SHARED_KEY, JSON.stringify(shared));
    } catch (error) {
        // A migration that cannot run costs the old settings, never correctness.
    }
}

/**
 * One section of this mod's namespace: `priorities` or `merchantOrders`.
 * @returns a plain object, never null - the caller may read straight through it.
 */
export function readSection(section) {
    migrate();
    try {
        const value = readShared()[MOD_ID]?.[section];
        return value && typeof value === 'object' ? value : {};
    } catch (error) {
        return {};
    }
}

/**
 * Change one section in place.
 *
 * ⚠️ THE WHOLE READ-MERGE-WRITE IS HERE so no caller can get it wrong: `update` is handed the
 * CURRENT section and mutates it, and everything outside `modSettings[MOD_ID][section]` is carried
 * across untouched - every other mod's data included.
 *
 * @param update `(section) => void`
 */
export function writeSection(section, update) {
    migrate();
    try {
        const shared = readShared();
        const mine = shared[MOD_ID] ?? {};
        const current = mine[section] && typeof mine[section] === 'object' ? mine[section] : {};
        update(current);
        mine[section] = current;
        shared[MOD_ID] = mine;
        localStorage.setItem(SHARED_KEY, JSON.stringify(shared));
    } catch (error) {
        // The mirror is a bonus; a failure here is not worth a warning per write.
    }
}
