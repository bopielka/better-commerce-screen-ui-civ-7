/**
 * Right-click an assigned resource to send it back to the unassigned pool.
 * Shift + right-click sends back every resource of that same kind assigned to that
 * settlement.
 *
 * How it hooks in
 * ---------------
 * The Commerce screen is Solid.js (`ui-next`), so there is no `Controls.decorate`.
 * The framework's own mod hook is the component registry: register a component under
 * an existing name with a higher `overridePriority` and every render site switches to
 * it. To extend rather than replace, the original factory is captured at import time
 * and called at the end - the `ui-next` equivalent of a decorator.
 *
 * `CommerceResourcesContainer` is the right host: it is the Resources tab itself, so
 * it is mounted exactly when right-click should do something, and being inside the
 * screen's context provider it can reach the model.
 *
 * Why the work happens on a DOM event and not an engine action
 * ------------------------------------------------------------
 * The engine does NOT emit its `mousebutton-right` action while a modifier is held.
 * Traced with an input spy:
 *
 *   plain right-click:  dom mousedown button=2 shiftKey=false
 *                       engine-input mousebutton-right START ... FINISH
 *   Shift + right-click: dom mousedown button=2 shiftKey=true isShiftDown=true
 *                       (no engine-input at all)
 *
 * So anything listening only for `mousebutton-right` can never see a modified click -
 * which is why two earlier attempts at reading Shift both looked broken. Neither
 * `event.shiftKey` nor `Input.isShiftDown()` was at fault; the event we listened to
 * simply never arrived. Native DOM mouse events fire for both cases and carry the
 * modifier state, so they drive the feature.
 *
 * The engine action is still handled, for one reason only: a plain right-click is
 * `isCancelInput()`, and the panel closes the whole screen on it. That has to be
 * swallowed when the click was ours.
 *
 * Playing well with Resource+
 * ---------------------------
 * The Workshop mod Resource+ wraps this same component at overridePriority 1100.
 * Taking `existing + 100` instead of a hard-coded number means we end up outside
 * whoever is already there regardless of load order, and calling `originalFactory`
 * keeps their wrapper - and the game's own container - alive.
 */
import { onCleanup, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { useAudio } from '/core/ui-next/services/audio-support.js';
import { InputEngineEventName } from '/core/ui/input/input-support.js';
import { CommerceResourcesContainer } from '/base-standard/ui-next/screens/commerce/commerce-screen-resources-tab.js';
import { useCommerceScreenContext } from '/base-standard/ui-next/screens/commerce/commerce-screen-model.js';

import { clearCommerceModel, findSlottedResourceAtPoint, setCommerceModel } from '../model/screen-model.js';
import { unassignAllOfTypeInSettlement, unassignOne } from '../engine/unassign.js';
import { refreshHighlight, startHoverHighlight, stopHoverHighlight } from './hover-highlight.js';
import { startBulkAssign, stopBulkAssign } from './bulk-assign.js';
import { startShiftClick, stopShiftClick } from './shift-click.js';
import { startLayout, stopLayout } from './layout.js';
import { startAssignAllButtons, stopAssignAllButtons } from './assign-all-buttons.js';
import { startSettlementControls, stopSettlementControls } from './settlement-controls.js';
import { startTabIcons } from './tab-icons.js';
import { isShiftHeld } from '../engine/shift.js';
import { log, warn } from '../support/diagnostics.js';

const COMPONENT_NAME = 'CommerceResourcesContainer';
const RIGHT_CLICK_ACTION = 'mousebutton-right';
const RIGHT_BUTTON = 2;

/**
 * The engine action arrives after the DOM mouseup that did the work. Anything within
 * this window belongs to the same physical click and must not close the screen.
 */
const SAME_CLICK_WINDOW_MS = 400;

// Whatever is registered when this module is imported: the game's container, or
// another mod's wrapper around it.
const originalFactory = CommerceResourcesContainer.factory;
const overridePriority = (CommerceResourcesContainer.overridePriority ?? 0) + 100;

function CommerceResourcesContainerWithRightClickUnassign(props) {
    const model = useCommerceScreenContext();

    // useAudio reads a Solid context, so it has to be resolved during setup rather
    // than inside the input handlers that run later.
    let playSlottingSound = null;
    try {
        playSlottingSound = useAudio('CommerceScreen/ResourceSlotting');
    } catch (error) {
        warn(`could not resolve the resource-slotting audio trigger: ${error}`);
    }

    function playUnassignSound() {
        try {
            playSlottingSound?.('dropUnassign');
        } catch (error) {
            warn(`unassign sound failed: ${error}`);
        }
    }

    let handledClickAt = 0;

    function unassignAt(x, y, wantsBulk) {
        const hit = findSlottedResourceAtPoint(x, y);
        if (!hit) {
            return false;
        }

        const { settlement, resource: slottedResource } = hit;
        log(
            `right-click on ${slottedResource.resourceType} (value ${slottedResource.resourceValue})` +
                `${wantsBulk ? ' -> all of this kind in this settlement' : ''}`,
        );

        // A resource that is about to leave its slot must not stay selected.
        if (model.selectedResource().resourceValue === slottedResource.resourceValue) {
            model.deselectSelectedResource();
        }

        // Unassigning is a sequence of engine round-trips, not one call - a resource
        // that carries slots needs its companions to actually land before it can go.
        // The click itself is answered immediately; the work reports back when done.
        const work = wantsBulk
            ? unassignAllOfTypeInSettlement(settlement, slottedResource.resourceType)
            : unassignOne(settlement, slottedResource);

        work.then((released) => {
            if (released > 0) {
                playUnassignSound();
            }
            // The card has been rebuilt with different slots; the marks went with it.
            refreshHighlight();
        }).catch((error) => warn(`unassign sequence failed: ${error}`));

        return true;
    }

    /**
     * The press. Nothing happens yet, but a press that lands on a resource is swallowed
     * so the screen's own handlers cannot start selecting or dragging it - that is what
     * made Shift + right-click look like it was "selecting" the resource.
     */
    function onMouseDown(event) {
        if (event.button !== RIGHT_BUTTON) {
            return;
        }
        if (!findSlottedResourceAtPoint(event.clientX, event.clientY)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    }

    /** The release acts. */
    function onMouseUp(event) {
        if (event.button !== RIGHT_BUTTON) {
            return;
        }
        let handled = false;
        try {
            handled = unassignAt(event.clientX, event.clientY, event.shiftKey || isShiftHeld());
        } catch (error) {
            warn(`right-click handling failed: ${error}`);
        }
        if (!handled) {
            // Right-clicking anywhere else keeps its normal meaning - closing the screen.
            return;
        }
        handledClickAt = Date.now();
        event.preventDefault();
        event.stopPropagation();
    }

    /**
     * Only suppression - the work is already done by the time this arrives. Listening in
     * the capture phase on `window` means this runs before the event reaches the panel,
     * whose handler treats a right-click as "cancel" and would close the whole screen.
     */
    function onEngineInput(event) {
        if (event.detail?.name !== RIGHT_CLICK_ACTION) {
            return;
        }
        if (Date.now() - handledClickAt > SAME_CLICK_WINDOW_MS) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    onMount(() => {
        setCommerceModel(model);
        window.addEventListener('mousedown', onMouseDown, true);
        window.addEventListener('mouseup', onMouseUp, true);
        window.addEventListener(InputEngineEventName, onEngineInput, true);
        startHoverHighlight();
        startBulkAssign(model);
        startShiftClick();
        startLayout();
        startAssignAllButtons();
        startSettlementControls();
        // No stop counterpart on purpose - see the note in tab-icons.js.
        startTabIcons();
        log(`right-click unassign active (overridePriority ${overridePriority})`);
    });

    onCleanup(() => {
        window.removeEventListener('mousedown', onMouseDown, true);
        window.removeEventListener('mouseup', onMouseUp, true);
        window.removeEventListener(InputEngineEventName, onEngineInput, true);
        stopHoverHighlight();
        stopBulkAssign(model);
        stopShiftClick();
        stopLayout();
        stopAssignAllButtons();
        stopSettlementControls();
        clearCommerceModel(model);
    });

    return originalFactory(props);
}

ComponentRegistry.register({
    name: COMPONENT_NAME,
    overridePriority,
    createInstance: CommerceResourcesContainerWithRightClickUnassign,
});
