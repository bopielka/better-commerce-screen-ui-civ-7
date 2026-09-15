/**
 * A second Commerce button in the HUD dock, immediately right of Resource Allocation: it opens
 * the same screen straight onto the Trade Routes tab.
 *
 * ⚠️ BUILT BY THE DOCK'S OWN `addButton`, not assembled by hand. That one call produces the whole
 * badge - ring, hover and active layers, audio refs, tooltip and the `action-activate` wiring -
 * so the new button is the same object as its neighbours and stays that way through a patch. Only
 * the artwork is ours, because a modifier class the game has never heard of has no icon rule.
 *
 * ⚠️ `addButton` APPENDS, so the button arrives at the far end of the dock and is moved into
 * place afterwards. Moved, never rebuilt: the dock is old-framework and owns these nodes.
 *
 * ⚠️ THE DOCK IS OLD-FRAMEWORK, which is the only reason any of this is possible -
 * `Controls.decorate` does nothing to a `ui-next` component. Same footing as
 * ./dock-resource-button.js, which decorates the same panel; both are registered once, because
 * `Controls.decorate` keeps a LIST and never de-duplicates.
 */
/*
 * ⚠️ IMPORTED, not global. `Controls`, `Players` and friends ARE globals in this scope and
 * `ContextManager` looks like it belongs to that set - it does not, and taking it for one threw
 * `ReferenceError: ContextManager is not defined` inside the click handler: the button did
 * nothing, and the tab request it had already filed was then spent by the NEXT screen opened.
 * Same trap as `PlotCoord` in engine/treasure-convoys.js.
 */
import ContextManager from '/core/ui/context-manager/context-manager.js';

import { COMMERCE_PANEL_CONTEXT } from './close-screen.js';
import { TAB_TRADE, requestTabOnOpen } from './open-on-tab.js';
import { ensureStyle } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const STYLE_ID = 'najane-dock-trade-style';

/** Ours on the button, the ring and the icon; `addButton` puts it on all three. */
const MODIFIER_CLASS = 'najane-dock-trade';

/** The two arrows - the same mark this mod already puts on the Trade Routes tab strip. */
const TRADE_ICON = 'blp:Action_Trade';

/**
 * ⚠️ Only the artwork. Size and position come from the dock's own `.ssb__button-icon`, and the
 * ring behind it from `.ssb__button-iconbg`, which carries `hud_sub_circle_bk` for every button
 * regardless of its modifier - so nothing here has to restate either.
 */
const STYLE = `
.ssb__button-icon.${MODIFIER_CLASS} {
    background-image: url("${TRADE_ICON}");
    /*
     * ⚠️ SMALLER THAN THE BOX IT SITS IN, and that is the point. The game's own "sub_*" marks are
     * drawn with their own margin baked into the artwork; "Action_Trade" fills its image edge to
     * edge, so at the shared "background-size: contain" it came out visibly larger than every
     * other button on the dock. The size is set here rather than by shrinking the element, so the
     * ring behind it keeps the size every other ring has.
     */
    background-size: 62%;
}
`;

/** Where the game's own resources button is, for the pass before the component publishes it. */
const RESOURCES_BUTTON_SELECTOR = '.resources';

function openTradeRoutes() {
    // ⚠️ The request is filed BEFORE the push: the screen reads it while it is being created.
    requestTabOnOpen(TAB_TRADE);
    try {
        ContextManager.push(COMMERCE_PANEL_CONTEXT, { singleton: true, createMouseGuard: true });
    } catch (error) {
        warn(`could not open the Commerce screen on the trade routes: ${error}`);
    }
}

class DockTradeButton {
    constructor(component) {
        this.component = component;
        this.Root = component.Root;
        this.button = null;
    }

    resourcesButton() {
        return this.component.resourcesButton
            ?? this.Root?.querySelector(RESOURCES_BUTTON_SELECTOR)
            ?? null;
    }

    beforeAttach() { }

    afterAttach() {
        ensureStyle(STYLE_ID, STYLE);
        try {
            this.addOnce();
        } catch (error) {
            warn(`could not add the trade routes button to the dock: ${error}`);
        }
    }

    addOnce() {
        // A dock re-attached without a detach would otherwise collect one button per attach.
        if (this.button?.isConnected) {
            return;
        }
        const neighbour = this.resourcesButton();
        if (!neighbour || typeof this.component.addButton !== 'function') {
            // Nothing to sit beside, or a dock that no longer builds its buttons this way.
            // One button missing is a feature that does nothing; it is not worth breaking the
            // dock over, so this only warns.
            warn('the dock has no resources button to sit beside; no trade routes button added');
            return;
        }
        this.button = this.component.addButton({
            tooltip: 'LOC_NAJANE_COMMERCE_DOCK_TRADE',
            modifierClass: MODIFIER_CLASS,
            callback: openTradeRoutes,
            class: 'tut-trade',
            audio: 'resources',
            focusedAudio: 'data-audio-focus-small',
        });
        // ⚠️ `nextSibling`, so it lands to the RIGHT of resources - `insertBefore(node, null)` is
        // an append, which is where it already was.
        neighbour.parentElement?.insertBefore(this.button, neighbour.nextSibling);
        log('trade routes dock button added');
    }

    beforeDetach() { }

    afterDetach() {
        this.button?.remove();
        this.button = null;
    }
}

let started = false;

// ⚠️ Registered once: `Controls.decorate` appends to a list and never de-duplicates.
export function startDockTradeButton() {
    if (started) {
        return;
    }
    started = true;
    try {
        Controls.decorate('panel-sub-system-dock', (component) => new DockTradeButton(component));
    } catch (error) {
        warn(`could not decorate the sub-system dock with a trade button: ${error}`);
    }
}
