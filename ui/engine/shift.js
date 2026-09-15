/**
 * Is Shift currently held?
 *
 * ⚠️ `Input.isShiftDown()` asks the engine, as the game's own tooltip-manager does. Tracking
 * DOM keydown/keyup instead NEVER reported Shift as held - this UI does not deliver modifier
 * state through DOM keyboard events.
 *
 * ⚠️ No DOM fallback: core's tooltip-manager calls `Input.isShiftDown()` unguarded, so a build
 * without it has no working tooltips either, and a fallback costs window capture listeners on
 * every key and click of the session.
 */
import { log, warn } from '../support/diagnostics.js';

let reportedSource = false;
let reportedFailure = false;

export function isShiftHeld() {
    try {
        if (typeof Input?.isShiftDown === 'function') {
            const held = Input.isShiftDown();
            if (!reportedSource) {
                reportedSource = true;
                log('shift state comes from Input.isShiftDown()');
            }
            return held;
        }
    } catch (error) {
        // ⚠️ Once: `hover-highlight.js` asks on every frame of mouse movement.
        if (!reportedFailure) {
            reportedFailure = true;
            warn(`Input.isShiftDown() failed; Shift reads as not held: ${error}`);
        }
        return false;
    }
    if (!reportedFailure) {
        reportedFailure = true;
        warn('Input.isShiftDown() is unavailable; Shift reads as not held');
    }
    return false;
}
