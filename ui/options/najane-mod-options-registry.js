/**
 * One contiguous block of settings for every Najane mod, however they are loaded.
 *
 * ⚠️ THIS FILE IS SHARED VERBATIM BY THREE MODS - Better City UI, Better Specialists UI and
 * Better Commerce Screen UI. Keep the copies identical; the whole mechanism is a handshake
 * between them through one object on `globalThis`.
 *
 * ⚠️ WHY IT EXISTS. The options screen builds its rows by iterating `Options.data` - a Map, so in
 * insertion order - and `screen-options-category.js` creates a group's heading the first time an
 * option asks for it. So the ON-SCREEN ORDER IS THE ORDER `Options.addOption` WAS CALLED IN, and
 * nothing else. Each mod adding its own options from its own init callback therefore interleaves
 * with every other mod that does the same, and the Najane headings ended up scattered down the
 * tab with other mods' headings between them - which is exactly what this fixes.
 *
 * ⚠️ THE TRICK IS THE TIMING. `Options.init()` runs EVERY registered init callback in one pass,
 * and it only runs when the options screen opens - by which time every mod has long since loaded.
 * So the first Najane callback to fire can safely add the options of ALL of them, in one
 * uninterrupted burst. Whichever mod that is does not matter; `sort` fixes the running order.
 *
 * ⚠️ `sort` IS A FIXED CONTRACT, not a preference. It has to be the same in all three copies or
 * the sections change places depending on which mod happens to load first:
 *     10 specialists · 20 city · 30 commerce
 *
 * ⚠️ Nothing here touches the game at import time, so it is safe in SHELL scope - where the
 * options screen also lives, and where there is no game.
 */

import { Options } from '/core/ui/options/model-options.js';

/**
 * ⚠️ A BARE GLOBAL, on purpose. Three separate mods cannot import each other, and the mod loader
 * gives them no other way to meet. The shape is deliberately trivial - `{ entries: [] }` - so a
 * newer copy of this file and an older one still understand each other rather than one of them
 * replacing the object and dropping the other's registrations on the floor.
 */
const KEY = 'najaneModOptions';

function shared() {
    const existing = globalThis[KEY];
    if (existing && Array.isArray(existing.entries)) {
        return existing;
    }
    const created = { entries: [] };
    globalThis[KEY] = created;
    return created;
}

/**
 * @param sort    the fixed running order above. Same value in every copy of this file.
 * @param probeId the id of the first option `add` registers - see `flushNajaneOptions`.
 * @param add     adds this mod's options, in its own internal order.
 */
export function registerNajaneOptions({ sort, probeId, add }) {
    shared().entries.push({ sort, probeId, add });
}

/**
 * Adds every registered mod's options, once per init cycle.
 *
 * ⚠️ THE GUARD IS A PROBE, not a boolean, and that is what makes it survive `reInitOptions()` -
 * which CLEARS `Options.data` and re-arms the same callbacks. A flag would be stuck true and the
 * settings would come back empty the second time the screen was opened. Asking whether an option
 * we added is still registered answers "has this cycle been done" without having to be told.
 *
 * ⚠️ Being called three times over would be harmless anyway: `addOption` is a `Map.set` by id, and
 * re-setting an existing key does not move it. The guard is for the wasted work, not for safety.
 */
export function flushNajaneOptions() {
    const registry = shared();
    try {
        if (registry.probeId && Options.data?.has(registry.probeId)) {
            return;
        }
    } catch (error) {
        // If the model cannot be read, fall through and add - empty settings are the worse failure.
    }

    const entries = [...registry.entries].sort((first, second) => first.sort - second.sort);
    for (const entry of entries) {
        try {
            entry.add();
        } catch (error) {
            // ⚠️ One mod's settings failing must not cost the other two theirs.
            console.error(`[najane-mods] could not add a mod's options: ${error}`);
        }
    }
    registry.probeId = entries[0]?.probeId ?? null;
}
