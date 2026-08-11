/**
 * While Shift is held, hovering a resource marks every resource of that same kind in
 * the same group - a preview of what Shift is about to do in bulk.
 *
 * Both sides of the screen are covered, and each means something different:
 *   - a resource assigned to a settlement -> its kin in that settlement, all of which
 *     Shift + right-click would release;
 *   - a resource in the unassigned pool    -> its kin in the pool, which Shift-assigning
 *     would send into the settlement together.
 *
 * The screen is Solid.js and rebuilds its DOM whenever the model changes, so the marks
 * are not stored anywhere: every recompute clears whatever carries the class and marks
 * the current set again. That makes a stale mark impossible to keep, at the price of
 * one querySelectorAll per recompute.
 *
 * Cost when Shift is not held is a boolean test per mousemove - see scheduleRecompute.
 */
import { findAvailableResourceAtPoint, findSlottedResourceAtPoint } from '../model/screen-model.js';
import { isShiftHeld } from '../engine/shift.js';
import { warn } from '../support/diagnostics.js';
import { ensureStyle } from '../support/dom.js';

const MARK_CLASS = 'najane-kin-highlight';
const STYLE_ID = 'najane-commerce-highlight-style';

/**
 * The same optical enlargement the game already gives a hovered resource. Its own
 * markup carries `hover\:scale-125` on the draggable, so 1.25 is not a taste decision -
 * it is the figure the screen uses, and matching it makes the preview read as "these
 * are all hovered" rather than as a new kind of decoration.
 *
 * `.framed-resource` is the target because it is rendered in both branches of
 * DraggableResource; `.draggable-resource` only exists while the resource is
 * interactive, which is not the case for every slot.
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

/**
 * Does the screen already enlarge this slot on hover by itself?
 *
 * `.draggable-resource` is the element carrying `hover\:scale-125`, and it is only
 * rendered while the resource is interactive - DraggableResource falls back to a plain
 * wrapper otherwise. So this is a real question, not a constant.
 */
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
    // Nothing is marked and Shift is up: there is no work to do and no state to fix.
    if (!isShiftHeld() && !marked) {
        return;
    }
    if (frame !== null) {
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
