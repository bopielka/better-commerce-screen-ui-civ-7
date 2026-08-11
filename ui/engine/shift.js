/**
 * Is Shift currently held?
 *
 * `Input.isShiftDown()` asks the engine directly. The game's own tooltip code uses it
 * the same way (core/ui/tooltips/tooltip-manager.js shortens the tooltip delay while
 * Shift is down), so it is answerable at any moment - no event plumbing, no state to
 * keep in sync, and it works in every input context.
 *
 * The first attempt here tracked DOM keydown/keyup instead. It never once reported
 * Shift as held: this UI does not deliver the engine's modifier state through DOM
 * keyboard events. The DOM listeners are kept only as a fallback in case
 * Input.isShiftDown is missing from some build - they cost nothing when unused.
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
