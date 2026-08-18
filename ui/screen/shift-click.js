/**
 * Left-clicking with Shift held.
 *
 * The screen's `Activatable` - which is what makes resources and settlement cards
 * clickable - fires `onActivate` from the engine's `mousebutton-left` action:
 *
 *     if (inputEvent.detail.name == "mousebutton-left" || ...) props.onActivate?.()
 *
 * and the engine withholds its mouse actions while a modifier is held (the same thing
 * that made Shift + right-click look broken, see right-click-unassign.js). So with
 * Shift down the whole screen simply stops responding to clicks - which is why
 * Shift-assigning worked when dragging but not when clicking.
 *
 * The fix is to do what Activatable would have done, from the native DOM event, and
 * only while Shift is held. Without Shift nothing here runs and the screen behaves
 * exactly as the game wrote it.
 *
 * Each branch calls the same model method the corresponding Activatable calls, so the
 * result is the game's own behaviour - including bulk-assign.js, which is layered on
 * `slotSelectedResource` and therefore applies to this route too.
 */
import {
    findAvailableResourceAtPoint,
    findSettlementAtPoint,
    findSlottedResourceAtPoint,
    getCommerceModel,
} from '../model/screen-model.js';
import { isShiftHeld } from '../engine/shift.js';
import { log, warn } from '../support/diagnostics.js';

const LEFT_BUTTON = 0;

/** Farther than this between press and release and it was a drag, which handles itself. */
const DRAG_THRESHOLD_PX = 6;

let active = false;
let pressX = 0;
let pressY = 0;
let pressed = false;

function onMouseDown(event) {
    if (event.button !== LEFT_BUTTON) {
        return;
    }
    pressed = true;
    pressX = event.clientX;
    pressY = event.clientY;
}

function wasDrag(event) {
    return (
        !pressed ||
        Math.abs(event.clientX - pressX) > DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - pressY) > DRAG_THRESHOLD_PX
    );
}

function activateAt(x, y) {
    const model = getCommerceModel();
    if (!model) {
        return;
    }

    // Resources first: they sit inside the settlement card, so the card would swallow
    // a click meant for one of them.
    const resource = findSlottedResourceAtPoint(x, y)?.resource ?? findAvailableResourceAtPoint(x, y)?.resource;
    if (resource) {
        if (!model.isSlottingAvailable) {
            return;
        }
        if (resource.cityID) {
            model.clickSlottedResource({ resourceValue: resource.resourceValue, cityID: resource.cityID });
        } else {
            model.clickAvailableResource({ resourceValue: resource.resourceValue });
        }
        log(`shift + click selected ${resource.resourceType}`);
        return;
    }

    const settlement = findSettlementAtPoint(x, y)?.settlement;
    if (settlement) {
        model.slotSelectedResource(settlement.cityID);
    }
}

function onMouseUp(event) {
    if (event.button !== LEFT_BUTTON) {
        return;
    }
    const dragged = wasDrag(event);
    pressed = false;

    /*
     * ⚠️ NOT `event.shiftKey` ALONE. In this build the native mouse events carry
     * `shiftKey: false` even with Shift plainly held - traced in UI.log, every mousedown and
     * mouseup, while `Input.isShiftDown()` said true throughout. That is why the Shift
     * highlight kept working while Shift-clicking did nothing: the highlight asks
     * `isShiftHeld()`, this asked the event, and only one of the two was being told.
     *
     * The engine's answer is the one to trust, and `isShiftHeld` already falls back to DOM key
     * events if it is ever unavailable. The event's own flag is kept as the first term because
     * it costs nothing and was observed to be true on an earlier build (see the input spy
     * transcript in 03-platform-notes.md) - the same belt-and-braces `resources-tab.js` has
     * always used for right-click unassign, which is precisely why that path never broke.
     */
    if (!(event.shiftKey || isShiftHeld()) || dragged) {
        return;
    }
    try {
        activateAt(event.clientX, event.clientY);
    } catch (error) {
        warn(`shift + click handling failed: ${error}`);
    }
}

export function startShiftClick() {
    if (active) {
        return;
    }
    active = true;
    pressed = false;
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
}

export function stopShiftClick() {
    if (!active) {
        return;
    }
    active = false;
    pressed = false;
    window.removeEventListener('mousedown', onMouseDown, true);
    window.removeEventListener('mouseup', onMouseUp, true);
}
