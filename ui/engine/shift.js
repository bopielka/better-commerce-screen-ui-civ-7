/**
 * Is Shift currently held?
 *
 * ⚠️ `Input.isShiftDown()` asks the engine, as the game's own tooltip-manager does. Tracking
 * DOM keydown/keyup instead NEVER reported Shift as held - this UI does not deliver modifier
 * state through DOM keyboard events. The DOM listeners survive only as a fallback.
 */
import { log, warn } from '../support/diagnostics.js';

let domHeld = false;
let reportedSource = false;

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
        warn(`Input.isShiftDown() failed, falling back to DOM key events: ${error}`);
    }
    if (!reportedSource) {
        reportedSource = true;
        log('shift state falls back to DOM key events - Input.isShiftDown() unavailable');
    }
    return domHeld;
}

function noteModifiersFrom(event) {
    if (event && typeof event.shiftKey === 'boolean') {
        domHeld = event.shiftKey;
    }
}

window.addEventListener('keydown', noteModifiersFrom, true);
window.addEventListener('keyup', noteModifiersFrom, true);
window.addEventListener('mousedown', noteModifiersFrom, true);

// A key released while the window is unfocused never delivers its keyup.
window.addEventListener('blur', () => {
    domHeld = false;
});
