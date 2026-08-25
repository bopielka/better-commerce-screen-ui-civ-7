/**
 * Right-click an assigned resource to send it back to the pool; Shift + right-click sends back
 * every resource of that kind in that settlement.
 *
 * ⚠️ HOW IT HOOKS IN: the screen is Solid, so there is no `Controls.decorate`. Register under the
 * existing component name with a higher `overridePriority` and every render site switches; the
 * original factory is captured at import time and called at the end.
 *
 * ⚠️ THE WORK HAPPENS ON A DOM EVENT, NOT AN ENGINE ACTION: the engine does not emit
 * `mousebutton-right` while a modifier is held, so Shift + right-click gives only the DOM event.
 * Neither `event.shiftKey` nor `Input.isShiftDown()` was ever at fault.
 *
 * The engine action is still handled for one reason: a plain right-click is `isCancelInput()` and
 * the panel closes the screen on it, so it must be swallowed when the click was ours.
 *
 * ⚠️ `overridePriority` is `existing + 100`, not a fixed number: Resource+ wraps the same component
 * at 1100, and calling `originalFactory` keeps its wrapper alive whatever the load order.
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
import { startResourceLocks, stopResourceLocks } from './resource-locks-ui.js';
import { startTabIcons } from './tab-icons.js';
import { isShiftHeld } from '../engine/shift.js';
import { log, warn } from '../support/diagnostics.js';

const COMPONENT_NAME = 'CommerceResourcesContainer';
const RIGHT_CLICK_ACTION = 'mousebutton-right';
const RIGHT_BUTTON = 2;

// The engine action arrives after the DOM mouseup that did the work; anything within this window
// is the tail of our own click.
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

    // Unassigning is a sequence of engine round-trips, not one call.
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

    // The press: nothing happens yet, but one that lands on a resource is swallowed so the card
    // underneath does not treat it as a selection.
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

    // Only suppression - the work is done by the time this arrives. Listening in capture so it is
    // stopped before the panel sees it.
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
        startResourceLocks();
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
        stopResourceLocks();
        clearCommerceModel(model);
    });

    return originalFactory(props);
}

ComponentRegistry.register({
    name: COMPONENT_NAME,
    overridePriority,
    createInstance: CommerceResourcesContainerWithRightClickUnassign,
});
