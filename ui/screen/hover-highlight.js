/**
 * While Shift is held, hovering a resource marks every resource of that same kind - a preview of
 * what Shift-click is about to move.
 *
 * ⚠️ Recomputed on a frame, not on every mousemove, and skipped entirely when Shift is up and
 * nothing is marked: this is a global `mousemove` listener.
 */
import { findAvailableResourceAtPoint, findSlottedResourceAtPoint } from '../model/screen-model.js';
import { isShiftHeld } from '../engine/shift.js';
import { warn } from '../support/diagnostics.js';
import { ensureStyle } from '../support/dom.js';

const MARK_CLASS = 'najane-kin-highlight';
const STYLE_ID = 'najane-commerce-highlight-style';

/**
 * The same optical enlargement the game gives a hovered resource, so the marked ones read as the
 * same kind of thing rather than as a second highlight.
 */
const STYLE = `
.${MARK_CLASS} .framed-resource {
    transform: scale(1.25);
}
`;

let mouseX = 0;
let mouseY = 0;
let frame = null;
let marked = false;
let active = false;

function clearMarks() {
    if (!marked) {
        return;
    }
    marked = false;
    for (const element of document.querySelectorAll(`.${MARK_CLASS}`)) {
        element.classList.remove(MARK_CLASS);
    }
}

/** Does the screen already enlarge this slot itself? Marking it too multiplies the transforms. */
function isEnlargedByTheGame(slotElement) {
    return slotElement.querySelector('.draggable-resource') !== null;
}

function recompute() {
    frame = null;
    if (!isShiftHeld()) {
        clearMarks();
        return;
    }

    // A settlement card and the unassigned pool never overlap, so whichever answers
    // is the group the cursor is in.
    const hit = findSlottedResourceAtPoint(mouseX, mouseY) ?? findAvailableResourceAtPoint(mouseX, mouseY);
    if (!hit) {
        clearMarks();
        return;
    }

    clearMarks();
    const { entries, resource: hovered, slotElements, slotIndex } = hit;
    const kind = hovered.resourceType;

    entries.forEach((resource, index) => {
        if (resource.resourceType !== kind) {
            return;
        }
        // Both containers render one .size-19 per resource, in model order, so the
        // index maps straight across - the same assumption the click handling makes.
        const element = slotElements[index];
        if (!element || (index === slotIndex && isEnlargedByTheGame(element))) {
            // Marking the hovered resource as well would multiply the two transforms
            // (1.25 x 1.25) and leave it visibly bigger than its own kind.
            return;
        }
        element.classList.add(MARK_CLASS);
        marked = true;
    });
}

function scheduleRecompute() {
    /*
     * ⚠️ THE FRAME GUARD COMES FIRST, and the order is the point. `isShiftHeld` asks the ENGINE,
     * and this runs off `mousemove` - so the question was being put across the boundary sixty to
     * a hundred times a second while the cursor moved over the screen. A pass is already
     * scheduled, and `recompute` asks again for itself, so there is nothing to learn here.
     */
    if (frame !== null) {
        return;
    }
    // Nothing is marked and Shift is up: there is no work to do and no state to fix.
    if (!isShiftHeld() && !marked) {
        return;
    }
    frame = requestAnimationFrame(() => {
        try {
            recompute();
        } catch (error) {
            frame = null;
            warn(`highlight recompute failed: ${error}`);
        }
    });
}

function onMouseMove(event) {
    mouseX = event.clientX;
    mouseY = event.clientY;
    scheduleRecompute();
}

/** Shift going down or up changes the answer without the mouse having moved. */
function onModifierChange() {
    scheduleRecompute();
}

export function startHoverHighlight() {
    if (active) {
        return;
    }
    active = true;
    ensureStyle(STYLE_ID, STYLE);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onModifierChange, true);
    window.addEventListener('keyup', onModifierChange, true);
    window.addEventListener('blur', onModifierChange);
}

export function stopHoverHighlight() {
    if (!active) {
        return;
    }
    active = false;
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('keydown', onModifierChange, true);
    window.removeEventListener('keyup', onModifierChange, true);
    window.removeEventListener('blur', onModifierChange);
    if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
    }
    clearMarks();
    document.getElementById(STYLE_ID)?.remove();
}

/** The DOM is rebuilt after an unassign; whatever was marked is gone with it. */
export function refreshHighlight() {
    marked = false;
    scheduleRecompute();
}
