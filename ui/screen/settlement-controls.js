/**
 * Three controls on every settlement card, level with its name:
 *
 *   - a priority picker - which yield this settlement should be fed first;
 *   - a quick-assign button - fill this settlement, and only this one, from the pool;
 *   - an unassign button - empty it again.
 *
 * The first two are ports of Resource+'s controls, including their look; see
 * planner/scoring.js for the attribution note. The third is the game's own per-settlement
 * "return all resources", which normally sits alone on the far side of the card - it is
 * hidden there and reissued here, so all three actions are in one place.
 *
 * The card is Solid-rendered and is rebuilt whenever the model changes, so the controls
 * are re-injected from a MutationObserver rather than placed once.
 */
import { getCommerceModel, settlementCards } from '../model/screen-model.js';
import { PRIORITY_OPTIONS, getPriority, priorityLabel, setPriority } from '../planner/priorities.js';
import { quickAssignSettlement } from '../planner/run.js';
import { unassignSettlement } from '../engine/unassign.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { appendAll, bindActivatable, clearChildren, ensureStyle, makeElement } from '../support/dom.js';
import { watchCommerceScreen } from './screen-observer.js';
import { iconBackground } from './icons.js';
import { log, warn } from '../support/diagnostics.js';

const CONTROL_CLASS = 'najane-priority-control';
const OPEN_CLASS = 'najane-priority-open';
const STYLE_ID = 'najane-settlement-controls-style';
const HIDDEN_CLASS = 'najane-control-hidden';

/** The game's own per-settlement "return all resources": an fxs-image-button on the card. */
const RETURN_BUTTON_SELECTOR = '.fxs-image-button';

/** The card's own header row. Utility classes - the only handle the game offers here. */
const CARD_HEADER_SELECTOR = '.flex.flex-row.flex-wrap.relative.w-full.justify-between';

/** Our own classes on that header, so the rules below only touch this screen. */
const HEADER_CLASS = 'najane-card-header';
/** The header's name block: banner, settlement name, pills. Marked in JS - see below. */
const NAME_CLASS = 'najane-card-name';
/** Holds our three controls and the game's cog, so the four cannot be separated. */
const ACTIONS_CLASS = 'najane-card-actions';

/**
 * Whose teardown owns the framed tooltips on these controls.
 *
 * ⚠️ Its own scope, never the default. These are torn down whenever the Resources tab is left,
 * which is sooner than the screen's own teardown - and disposing the DEFAULT scope to clean up
 * after them would take every other tab's tooltips with it. Same rule, same reason as the
 * treasure tab's; see `disposeFramedTooltips`.
 */
const TOOLTIP_SCOPE = 'settlement-controls';

/**
 * The game's factory display (cog + current factory resource), FactoryTypeDisplay.
 *
 * It is the header's last child under `justify-between`, which is why it sits against the
 * far edge - and why it is the first thing to wrap onto a second line on a settlement
 * carrying a lot of pills. Matched by its inner black pill, since the outer element's
 * classes are as generic as they come.
 */
const FACTORY_DISPLAY_INNER_SELECTOR = '.bg-black.rounded-lg';

/** This mod's replacement for it: one button, the same one the rest of the header uses. */
const FACTORY_BUTTON_CLASS = 'najane-card-factory-clear';

/** Every string is a localisation key; see text/en_us/InGameText.xml. */
const PRIORITY_TOOLTIP = 'LOC_NAJANE_COMMERCE_PRIORITY_TOOLTIP';
const PRIORITY_CURRENT = 'LOC_NAJANE_COMMERCE_PRIORITY_CURRENT';
const PRIORITY_OPTION_TOOLTIP = 'LOC_NAJANE_COMMERCE_PRIORITY_OPTION_TOOLTIP';
const PRIORITY_BALANCED_TOOLTIP = 'LOC_NAJANE_COMMERCE_PRIORITY_BALANCED_TOOLTIP';
const QUICK_ASSIGN = 'LOC_NAJANE_COMMERCE_QUICK_ASSIGN';
const QUICK_ASSIGN_TOOLTIP = 'LOC_NAJANE_COMMERCE_QUICK_ASSIGN_TOOLTIP';

const STYLE = `
/*
 * The header keeps its four controls together on one line.
 *
 * Two earlier attempts failed and are worth not repeating. Absolute placement with a
 * hard-coded gap for the cog knew nothing about how wide the pills were, so the controls
 * either sat far from the cog or overlapped the pills. Placing them in the flow with
 * "margin-left: auto" and trusting the header's own "justify-between" to pull the cog
 * along did not work either - the cog stayed at the far edge.
 *
 * So the adjacency is no longer left to the header: our controls AND the cog go into a
 * container of ours, which cannot lay them out any other way.
 */
.${HEADER_CLASS} { flex-wrap: nowrap; }
/*
 * The name block gives way first: the pills wrap within it, where there is room in the
 * vertical, instead of pushing the controls off the right-hand edge of the card.
 *
 * ⚠️ Marked from JS rather than matched with ":first-child". The name is wrapped in an
 * Activatable while no resource is selected, so which element is first - and what classes
 * it carries - depends on what the player is doing.
 */
.${NAME_CLASS} {
    flex: 0 1 auto;
    min-width: 0;
    flex-wrap: wrap;
    overflow: hidden;
}
.${HEADER_CLASS} .text-xs.text-accent-1 { flex-wrap: wrap; }

.${ACTIONS_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: center;
    margin-left: auto;
}
/* The cog, once moved in here. Keeps its size; spaced off our own controls. */
.${ACTIONS_CLASS} > .h-10 {
    flex: 0 0 auto;
    margin-left: 0.75rem;
}

/*
 * "Return the factory resources", as ONE button instead of a row.
 *
 * The game draws this as a factory icon, then a black pill holding the current factory
 * resource's icon and a return button - three things wide, in a header that is already the
 * first place to wrap onto a second line. All three say the same thing, and the header
 * already has a return button of its own that says it in one.
 *
 * ⚠️ The images are the GAME'S OWN return button, the same pair "FactoryTypeDisplay" and the
 * settlement's own "return all" both use - so this reads as that button rather than as a new
 * kind of control. The factory mark rides in the corner, the way the padlock does on an
 * assigned resource (see resource-locks-ui.js) and for the same reason: it says which button
 * this is without taking a place in the row.
 */
.${FACTORY_BUTTON_CLASS} {
    position: relative;
    box-sizing: border-box;
    display: flex;
    flex: 0 0 auto;
    /* .size-7, the size the game gives this button; see the ImageButton in factory-type-display. */
    width: 1.5555555556rem;
    height: 1.5555555556rem;
    background-image: url("blp:resource_return_button_default.png");
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: auto;
}
.${FACTORY_BUTTON_CLASS}:hover {
    background-image: url("blp:resource_return_button_hover.png");
}
.${FACTORY_BUTTON_CLASS}:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
.${FACTORY_BUTTON_CLASS}__mark {
    position: absolute;
    top: -0.3rem;
    right: -0.3rem;
    width: 1rem;
    height: 1rem;
    background-image: url("blp:restype_factory_v2.png");
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    /* The badge is decoration; the click belongs to the button underneath it. */
    pointer-events: none;
}

.${CONTROL_CLASS} {
    /* Not static: the menu below is positioned against this, not against the header. */
    position: relative;
    z-index: 40;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: flex-end;
    color: #e5d2ac;
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-weight: 500;
    font-size: 0.9rem;
    pointer-events: auto;
}

/*
 * ⚠️ NO FRAME AND NO RESTING BACKGROUND, to match the factory button beside them.
 *
 * These three used to be boxed - a border and a filled panel each - which was fine while they
 * were the only things this mod put in the header. The factory button that replaced the
 * game's own display is the game's artwork and nothing else, so the boxed three suddenly read
 * as a different family of control sitting next to it. The box goes; the icons stay exactly
 * as they were.
 *
 * ⚠️ HOVER IS BRIGHTNESS, NOT A PANEL. The factory button beside them highlights by swapping
 * to a brighter copy of its own artwork, and lighting an olive panel behind an icon is a
 * different gesture entirely - which is what made the two sets look unrelated even after the
 * frames came off. These have no second image to swap to, so the icon itself is brightened,
 * which is the same thing said the only way it can be said here.
 *
 * "filter: brightness" is the one animated/visual filter PROVEN to work in this renderer from
 * a stylesheet this mod injects - Holistic QoL+ ships it, and the dock button's pulse uses it.
 * The radius went with the panel it used to shape.
 */
.${CONTROL_CLASS}__trigger,
.${CONTROL_CLASS}__quick,
.${CONTROL_CLASS}__unassign {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 2.5rem;
    background: transparent;
    pointer-events: auto;
}
/*
 * Pass-through, so each control keeps its own place in the row. The framed tooltip wraps the
 * button in a mount, and without this the mount would be the flex item instead of the button.
 */
.${CONTROL_CLASS}__trigger-mount,
.${CONTROL_CLASS}__quick-mount,
.${CONTROL_CLASS}__unassign-mount { display: flex; flex: 0 0 auto; }
.${FACTORY_BUTTON_CLASS}-mount { display: flex; flex: 0 0 auto; margin-left: 0.75rem; }

.${CONTROL_CLASS}__trigger { width: 4.25rem; padding: 0.25rem 0.45rem; }
.${CONTROL_CLASS}__quick,
.${CONTROL_CLASS}__unassign { width: 2.5rem; margin-left: 0.5rem; }
.${CONTROL_CLASS}__trigger:hover,
.${CONTROL_CLASS}__quick:hover,
.${CONTROL_CLASS}__unassign:hover { filter: brightness(1.45); }

.${CONTROL_CLASS}__arrow {
    width: 0;
    height: 0;
    margin-left: 0.35rem;
    border-left: 0.34rem solid transparent;
    border-right: 0.34rem solid transparent;
    border-top: 0.42rem solid #e5d2ac;
    pointer-events: none;
}

.${CONTROL_CLASS}__menu {
    position: absolute;
    top: 2.65rem;
    right: 3rem;
    z-index: 41;
    display: none;
    box-sizing: border-box;
    width: 12rem;
    padding: 0.3rem;
    border: 0.1rem solid #9f8b65;
    border-radius: 0.18rem;
    background: rgba(12, 17, 26, 0.99);
}
.${OPEN_CLASS} { z-index: 100; }
.${OPEN_CLASS} .${CONTROL_CLASS}__menu { display: flex; flex-direction: row; flex-wrap: wrap; }

.${CONTROL_CLASS}__option {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 25%;
    min-height: 3rem;
    padding: 0.35rem;
    color: #e5d2ac;
    background: rgba(21, 27, 39, 0.98);
}
.${CONTROL_CLASS}__option:hover { background: rgba(77, 67, 55, 0.98); }

.${CONTROL_CLASS}__icon-host {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 1.65rem;
    pointer-events: none;
}
.${CONTROL_CLASS}__yield-icon,
.${CONTROL_CLASS}__quick-icon,
.${CONTROL_CLASS}__unassign-icon {
    width: 1.65rem;
    height: 1.65rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
.${CONTROL_CLASS}__balanced {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.55rem;
}
.${HIDDEN_CLASS} { display: none; }
.${CONTROL_CLASS}__mini {
    width: 0.58rem;
    height: 0.58rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
.${CONTROL_CLASS}__trigger:focus,
.${CONTROL_CLASS}__quick:focus,
.${CONTROL_CLASS}__unassign:focus,
.${CONTROL_CLASS}__option:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
`;

let unwatch = null;
let styleElement = null;
/** Kept so the listener can be taken off again; see the note in startSettlementControls. */
let onDocumentClick = null;

/** Balanced has no single icon, so it is drawn as a cluster of all the yield icons. */
function renderPriorityIcon(host, yieldType) {
    clearChildren(host);
    if (yieldType) {
        const icon = makeElement('div', `${CONTROL_CLASS}__yield-icon`);
        icon.style.backgroundImage = iconBackground(yieldType, 'YIELD');
        host.appendChild(icon);
        return;
    }
    const cluster = makeElement('div', `${CONTROL_CLASS}__balanced`);
    for (const option of PRIORITY_OPTIONS) {
        if (!option.type) {
            continue;
        }
        const mini = makeElement('div', `${CONTROL_CLASS}__mini`);
        mini.style.backgroundImage = iconBackground(option.type, 'YIELD');
        cluster.appendChild(mini);
    }
    host.appendChild(cluster);
}

/**
 * ⚠️ This mod's wording, not the game's `LOC_COMMERCE_UNASSIGN_RESOURCES`.
 *
 * That key reads "Return all assignments from the city of Berlin" - a sentence about
 * *assignments* rather than about resources, and phrased unlike anything else on this screen.
 * The button bar at the top says "Assign all" / "Unassign all" and explains itself in a
 * tooltip underneath; this is the same action for one settlement, so it says so the same way.
 * The general rule of reusing the game's own strings is worth breaking exactly where the
 * game's own string is the odd one out.
 */
/**
 * Wraps a control in a framed tooltip and hands back the mount to put in the row.
 *
 * ⚠️ Two of these because the frame takes localisation KEYS for its heading, which is right
 * for a fixed label - but the unassign button's heading carries a settlement name and is
 * therefore already composed. `framedText` is the same thing for a string that has been
 * composed already; passing composed text as a key would print the sentence back as a tag.
 */
function framed(button, className, labelKey, tooltipKey) {
    const mount = makeElement('div', `${className}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope: TOOLTIP_SCOPE,
        title: labelKey,
        text: Locale.compose(tooltipKey),
    });
    return mount;
}

function framedText(button, className, label, text) {
    const mount = makeElement('div', `${className}-mount`);
    appendWithFramedTooltip(mount, button, { scope: TOOLTIP_SCOPE, title: label, text });
    return mount;
}

function unassignLabel(settlement) {
    const city = Cities.get(settlement.cityID);
    return Locale.compose('LOC_NAJANE_COMMERCE_SETTLEMENT_UNASSIGN', Locale.compose(city?.name ?? ''));
}

function unassignTooltip(settlement) {
    const city = Cities.get(settlement.cityID);
    return Locale.compose('LOC_NAJANE_COMMERCE_SETTLEMENT_UNASSIGN_TOOLTIP', Locale.compose(city?.name ?? ''));
}

function closeMenus(except = null) {
    for (const open of document.querySelectorAll(`.${OPEN_CLASS}`)) {
        if (open !== except) {
            open.classList.remove(OPEN_CLASS);
        }
    }
}

function createControl(settlement) {
    const selected = PRIORITY_OPTIONS.find((option) => option.type === getPriority(settlement.cityID))
        ?? PRIORITY_OPTIONS[0];

    const currentLabel = (type) => Locale.compose(PRIORITY_CURRENT, priorityLabel(type));

    const control = makeElement('div', CONTROL_CLASS);

    const trigger = makeElement('div', `${CONTROL_CLASS}__trigger`, {
        title: currentLabel(selected.type),
        'aria-label': currentLabel(selected.type),
    });
    const triggerIcon = makeElement('div', `${CONTROL_CLASS}__icon-host`);
    renderPriorityIcon(triggerIcon, selected.type);
    appendAll(trigger, triggerIcon, makeElement('div', `${CONTROL_CLASS}__arrow`));
    bindActivatable(trigger, () => {
        const willOpen = !control.classList.contains(OPEN_CLASS);
        closeMenus(control);
        control.classList.toggle(OPEN_CLASS, willOpen);
    });

    const menu = makeElement('div', `${CONTROL_CLASS}__menu`);
    for (const option of PRIORITY_OPTIONS) {
        const label = priorityLabel(option.type);
        const item = makeElement('div', `${CONTROL_CLASS}__option`, {
            title: label,
            'aria-label': label,
            'data-tooltip-content': option.type
                ? Locale.compose(PRIORITY_OPTION_TOOLTIP, label)
                : Locale.compose(PRIORITY_BALANCED_TOOLTIP),
            });
        const icon = makeElement('div', `${CONTROL_CLASS}__icon-host`);
        renderPriorityIcon(icon, option.type);
        item.appendChild(icon);
        bindActivatable(item, () => {
            setPriority(settlement.cityID, option.type);
            log(`priority for ${unassignLabel(settlement)}: ${label}`);
            renderPriorityIcon(triggerIcon, option.type);
            trigger.setAttribute('title', currentLabel(option.type));
            trigger.setAttribute('aria-label', currentLabel(option.type));
            control.classList.remove(OPEN_CLASS);
        });
        menu.appendChild(item);
    }

    const unassign = makeElement('div', `${CONTROL_CLASS}__unassign`, {
        title: unassignLabel(settlement),
        'aria-label': unassignLabel(settlement),
    });
    const unassignIcon = makeElement('div', `${CONTROL_CLASS}__unassign-icon`);
    unassignIcon.style.backgroundImage = 'url(blp:resource_return_button_default.png)';
    unassign.appendChild(unassignIcon);
    bindActivatable(unassign, () => {
        closeMenus();
        /*
         * ⚠️ This mod's own clear, not the model's `clearAllResources`. That one does not know
         * locks exist, so a padlocked resource - safe from "Unassign all" - was swept away by
         * this smaller button instead. See `unassignSettlement`.
         */
        getCommerceModel()?.deselectSelectedResource?.();
        unassignSettlement(settlement.cityID).catch((error) =>
            warn(`returning a settlement's resources failed: ${error}`),
        );
    });

    const quick = makeElement('div', `${CONTROL_CLASS}__quick`, {
        title: Locale.compose(QUICK_ASSIGN),
        'aria-label': Locale.compose(QUICK_ASSIGN),
        'data-tooltip-anchor': 'left',
    });
    const quickIcon = makeElement('div', `${CONTROL_CLASS}__quick-icon`);
    quickIcon.style.backgroundImage = iconBackground('RADIAL_RESOURCES') || 'url(blp:resource_slot_select)';
    quick.appendChild(quickIcon);
    bindActivatable(quick, () => {
        closeMenus();
        const model = getCommerceModel();
        if (model) {
            quickAssignSettlement(model, settlement.cityID);
        }
    });

    // The card beneath treats a press as "assign here"; these controls are not that.
    control.addEventListener('engine-input', (event) => event.stopPropagation());
    /*
     * ⚠️ Each one wrapped in the game's FRAMED tooltip, the same as the button bar at the top
     * of the screen - a heading over an inset card, rather than the bare box a plain
     * `data-tooltip-content` draws. These are the same three actions the bar offers, scoped to
     * one settlement, so they should not arrive looking like a different kind of control.
     *
     * The wrapper is what goes into the row, not the button: see `appendWithFramedTooltip`.
     */
    appendAll(
        control,
        // Its heading is the settlement's CURRENT priority, so it is already composed.
        framedText(trigger, `${CONTROL_CLASS}__trigger`, currentLabel(selected.type),
            Locale.compose(PRIORITY_TOOLTIP)),
        framed(quick, `${CONTROL_CLASS}__quick`, QUICK_ASSIGN, QUICK_ASSIGN_TOOLTIP),
        framedText(unassign, `${CONTROL_CLASS}__unassign`, unassignLabel(settlement), unassignTooltip(settlement)),
        menu,
    );
    return control;
}

let injecting = false;

function injectControls() {
    // Our own appendChild is a childList mutation and would call this again.
    if (injecting) {
        return;
    }
    injecting = true;
    try {
        injectControlsOnce();
    } finally {
        injecting = false;
    }
}

/**
 * Hides the settlement's own "return all resources" button, whose job the card's new
 * controls have taken over.
 *
 * ⚠️ Not simply the first `.fxs-image-button` in the card. On a settlement with a factory
 * the FactoryTypeDisplay in the header contains one too, and being in the header it comes
 * first - so that version hid the factory's button and left the settlement's on screen,
 * which is the opposite of what was wanted. Anything inside the header is the factory's.
 */
function hideSettlementReturnButton(cardElement, header) {
    for (const button of cardElement.querySelectorAll(RETURN_BUTTON_SELECTOR)) {
        if (!header.contains(button)) {
            button.classList.add(HIDDEN_CLASS);
        }
    }
}

/**
 * One button that empties the settlement of its factory resources.
 *
 * ⚠️ Offered only where the game offers it: this is built solely for a card that HAS a factory
 * display, so a settlement without a factory - or in an age that has none - never sees it. The
 * engine is asked to do the work through the model's own `clearFactoryResources`, the same
 * call the button this replaces made, so nothing here reimplements what the game does with it.
 */
function createFactoryClearButton(settlement) {
    const button = makeElement('div', FACTORY_BUTTON_CLASS, {
        'aria-label': Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_CLEAR'),
    });
    button.appendChild(makeElement('div', `${FACTORY_BUTTON_CLASS}__mark`));

    bindActivatable(button, () => {
        try {
            getCommerceModel()?.clearFactoryResources?.(settlement.cityID);
            log('cleared the factory resources of one settlement');
        } catch (error) {
            warn(`clearing the factory resources failed: ${error}`);
        }
    });
    return framed(
        button, FACTORY_BUTTON_CLASS,
        'LOC_NAJANE_COMMERCE_FACTORY_CLEAR', 'LOC_NAJANE_COMMERCE_FACTORY_CLEAR_TOOLTIP',
    );
}

function injectControlsOnce() {
    for (const { settlement, cardElement } of settlementCards()) {
        const header = cardElement.querySelector(CARD_HEADER_SELECTOR);
        if (!header) {
            continue;
        }
        // Every pass, not once: the card is rebuilt and brings all of this back.
        hideSettlementReturnButton(cardElement, header);
        header.classList.add(HEADER_CLASS);

        let actions = header.querySelector(`.${ACTIONS_CLASS}`);
        if (!actions) {
            actions = makeElement('div', ACTIONS_CLASS);
            header.appendChild(actions);
        }
        // Whatever the header put first is the name block; see the note on NAME_CLASS.
        for (const child of header.children) {
            if (child !== actions) {
                child.classList.add(NAME_CLASS);
                break;
            }
        }

        if (!actions.querySelector(`.${CONTROL_CLASS}`)) {
            actions.appendChild(createControl(settlement));
        }

        /*
         * The game's factory display goes, and one button of ours takes its place.
         *
         * ⚠️ HIDDEN, NEVER REMOVED. It is Solid's, and it comes back with every redraw of the
         * card; removing it would be a node Solid still believes it owns. Hiding is idempotent
         * and survives the rebuild, which is the same rule `hideSettlementReturnButton` above
         * already follows.
         */
        const factoryDisplay = header.querySelector(FACTORY_DISPLAY_INNER_SELECTOR)?.parentElement;
        if (factoryDisplay) {
            factoryDisplay.classList.add(HIDDEN_CLASS);
            if (!actions.querySelector(`.${FACTORY_BUTTON_CLASS}-mount`)) {
                actions.appendChild(createFactoryClearButton(settlement));
            }
        }
    }
}

export function startSettlementControls() {
    if (unwatch) {
        return;
    }
    styleElement = ensureStyle(STYLE_ID, STYLE);

    /*
     * ⚠️ Kept in a variable and removed in `stopSettlementControls`. An inline arrow could
     * not be, so every visit to the Resources tab left another one behind and the whole pile
     * ran on every click anywhere in the game for the rest of the session.
     */
    onDocumentClick = () => closeMenus();
    document.addEventListener('click', onDocumentClick);

    const run = () => {
        try {
            injectControls();
        } catch (error) {
            warn(`injecting settlement controls failed: ${error}`);
        }
    };
    run();
    // One observer for the whole screen, batched to a frame; see screen-observer.js.
    unwatch = watchCommerceScreen(run);
}

export function stopSettlementControls() {
    unwatch?.();
    unwatch = null;
    if (onDocumentClick) {
        document.removeEventListener('click', onDocumentClick);
        onDocumentClick = null;
    }
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((control) => control.remove());
    document.querySelectorAll(`.${FACTORY_BUTTON_CLASS}-mount`).forEach((mount) => mount.remove());
    /*
     * ⚠️ Before the elements go, and only OUR scope. A framed tooltip outliving the control it
     * is anchored to is drawn in the top-left corner of the screen; see `TOOLTIP_SCOPE`.
     */
    disposeFramedTooltips(TOOLTIP_SCOPE);
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((el) => el.classList.remove(HIDDEN_CLASS));
    document.querySelectorAll(`.${HEADER_CLASS}`).forEach((el) => el.classList.remove(HEADER_CLASS));
    document.querySelectorAll(`.${NAME_CLASS}`).forEach((el) => el.classList.remove(NAME_CLASS));
    // The cog stays inside it, so this container is emptied into the header, not removed.
    document.querySelectorAll(`.${ACTIONS_CLASS}`).forEach((actions) => {
        while (actions.firstChild) {
            actions.parentElement?.appendChild(actions.firstChild);
        }
        actions.remove();
    });
    styleElement?.remove();
    styleElement = null;
}
