/**
 * Left-clicking with Shift held.
 *
 * ⚠️ The engine WITHHOLDS its mouse actions while a modifier is held, and `Activatable` fires
 * `onActivate` from the engine's `mousebutton-left` action - so with Shift down the whole screen
 * stops responding to clicks. That is why Shift-assigning worked when dragging but not clicking.
 *
 * The fix is to do what Activatable would have done, from the native DOM event, and only while
 * Shift is held. Each branch calls the same model method the corresponding Activatable calls.
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
     * ⚠️ NOT `event.shiftKey` ALONE. In this build the native mouse events carry `shiftKey: false`
     * with Shift plainly held - traced in UI.log - while `Input.isShiftDown()` said true throughout.
     * That is why the Shift highlight kept working while Shift-clicking did nothing: the highlight
     * asks `isShiftHeld()`, this asked the event. The flag is kept as the first term because it
     * costs nothing and was true on an earlier build.
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
