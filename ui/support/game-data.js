/**
 * "The game's data has been replaced" - one place to say it, and one place to hear it.
 *
 * ⚠️ WHY THIS EXISTS: `GameInfo` holds `core` + `base-standard` + THE AGE BEING PLAYED. An age
 * transition replaces the resource, unit and modifier tables underneath every index built from
 * them, which from that moment is both WRONG and dead weight - and this mod builds several,
 * the largest of them thousands of objects. Each cache registers its own reset beside itself;
 * the entry point is what raises the event.
 *
 * ⚠️ In `support/` so that any layer may register: this is a plain callback list and knows
 * nothing about the game.
 *
 * ⚠️ Belt and braces, not the only defence. Whether the UI scripts survive an age transition at
 * all is unverified, and the caches that can afford it are still keyed by `Game.age` as well.
 */
import { warn } from './diagnostics.js';

const resets = new Set();

/** @returns a function that unregisters, for a cache that does not live for the session. */
export function onGameDataStale(reset) {
    resets.add(reset);
    return () => resets.delete(reset);
}

/** Drops everything read out of `GameInfo`. Safe to call when nothing has changed. */
export function forgetGameData() {
    for (const reset of Array.from(resets)) {
        try {
            reset();
        } catch (error) {
            warn(`a cache refused to reset after an age change: ${error}`);
        }
    }
}
