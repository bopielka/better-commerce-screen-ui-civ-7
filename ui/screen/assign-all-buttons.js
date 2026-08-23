/**
 * "Assign All", "Reassign All" and "Unassign All", to the left of the tab strip, plus the GDP
 * readout and the assign switches. What the buttons DO is planner/run.js.
 *
 * ⚠️ This bar is the one container on this screen the mod owns outright, which is why
 * assign-switches.js hangs its switches in it rather than in the screen's own header.
 */
import { assignAll, isAssignmentInProgress, reassignAll, unassignAll } from '../planner/run.js';
import { gdpPerTurn } from '../planner/gdp.js';
import { isFactoryAge } from '../engine/age.js';
import { onEngineEvents, stopEngineEvents } from '../engine/events.js';
import { getCommerceModel } from '../model/screen-model.js';
import { createAssignSwitches } from './assign-switches.js';
import { HELP_CLASS, HELP_STYLE, makeHelpMark } from './help-mark.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { watchCommerceScreen } from './screen-observer.js';
import { commerceTabRow } from './screen-parts.js';
import { appendAll, bindActivatable, ensureStyle, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const BAR_CLASS = 'najane-assign-bar';
const BUTTON_CLASS = 'najane-assign-button';
const HIDDEN_CLASS = 'najane-hidden';
const STYLE_ID = 'najane-assign-buttons-style';
const GDP_CLASS = 'najane-assign-gdp';

/** The game's own font icon for economic victory points; see factory-resources.js. */
const GDP_ICON = 'blp:fi_victorypoint_economic_64';

const SLOTTED_CONTAINER_SELECTOR = '[data-name="slotted-resource-container"]';

// The game's own "unassign all" sits at the bottom of the settlement column, past the fold.
const ORIGINAL_UNASSIGN_SELECTOR = '.self-end';

/** Every string is a localisation key; see text/en_us/InGameText.xml. */
const BUTTONS = [
    {
        label: 'LOC_NAJANE_COMMERCE_ASSIGN_ALL',
        busy: 'LOC_NAJANE_COMMERCE_ASSIGN_ALL_BUSY',
        tooltip: 'LOC_NAJANE_COMMERCE_ASSIGN_ALL_TOOLTIP',
        run: (model) => assignAll(model),
    },
    {
        label: 'LOC_NAJANE_COMMERCE_REASSIGN_ALL',
        busy: 'LOC_NAJANE_COMMERCE_REASSIGN_ALL_BUSY',
        tooltip: 'LOC_NAJANE_COMMERCE_REASSIGN_ALL_TOOLTIP',
        run: (model) => reassignAll(model),
    },
    {
        label: 'LOC_NAJANE_COMMERCE_UNASSIGN_ALL',
        busy: 'LOC_NAJANE_COMMERCE_UNASSIGN_ALL_BUSY',
        tooltip: 'LOC_NAJANE_COMMERCE_UNASSIGN_ALL_TOOLTIP',
    // ⚠️ Not `model.clearAllResources()`, which is what this used to call: that one knows nothing
    // about resource locks and sweeps a padlocked resource away with the rest.
        run: (model) => unassignAll(model),
    },
];

const STYLE = `
.${BAR_CLASS} {
    position: absolute;
    left: 2rem;
    /* Vertically centred against the 2.6667rem tab strip; see layout.js for the
       horizontal budget that keeps these two from meeting. */
    top: 0.15rem;
    z-index: 20;
    display: flex;
    flex-direction: row;
    align-items: center;
    pointer-events: auto;
}
.${BUTTON_CLASS} {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    /*
     * Equal width, so none of the three reads as the primary action - which means the
     * box cannot grow to fit a longer label. "Assigning..." is longer than "Assign All",
     * and in Polish longer still, so the label spilled past the border and the middle
     * button broke onto a second line. Text is kept on one line and allowed to shrink
     * instead; the shrinking is the game's own coh-font-fit-mode, applied through the
     * font-fit-shrink class the buttons carry.
     */
    width: 10.5rem;
    min-height: 2.4rem;
    white-space: nowrap;
    overflow: hidden;
    margin-right: 0.6rem;
    padding: 0.35rem 0.8rem;
    border: 0.12rem solid #9f8b65;
    border-radius: 0.22rem;
    color: #e5d2ac;
    background: rgba(21, 27, 39, 0.94);
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-weight: 500;
    font-size: 0.95rem;
    text-transform: uppercase;
    text-align: center;
}
.${BUTTON_CLASS}:hover { background: rgba(77, 67, 55, 0.98); }
.${BUTTON_CLASS}:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
.${BUTTON_CLASS}--busy { opacity: 0.55; }

/* The tooltip wrapper is a pass-through: the button keeps its own box. */
.${BUTTON_CLASS}-mount { display: flex; flex: 0 0 auto; }

/*
 * The GDP figure, shaped like the game's own victory-point readouts: the number, then the
 * icon. No label - the icon is the label, and the tooltip says the rest.
 */
.${GDP_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    height: 2.4rem;
    margin-left: 1.1rem;
    color: #e5d2ac;
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-size: 1rem;
    white-space: nowrap;
    pointer-events: auto;
}
.${GDP_CLASS}__icon {
    width: 1.6rem;
    height: 1.6rem;
    margin-left: 0.3rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}

.${HIDDEN_CLASS} { display: none; }
${HELP_STYLE}
`;

let bar = null;
let styleElement = null;
let unwatch = null;
/**
 * ⚠️ Kept so they can be taken off again. They used not to be: `startX` ran on every visit to the
 * Resources tab and added four more listeners, `stopX` removed none, and the pile kept firing long
 * after the screen was closed.
 */
let gdpSubscriptions = [];
/** The GDP readout, kept so it can be rebuilt when the board changes. */
let gdpMount = null;
let gdpTimer = null;

/** Events after which the figure is out of date. */
// ⚠️ Every one is raised for EVERY player. An AI assigning a resource cannot change your GDP.
const GDP_EVENTS = ['ResourceAssigned', 'ResourceUnassigned', 'ResourceCapChanged', 'ConstructibleBuildCompleted'];
const GDP_REFRESH_MS = 400;

function refreshGdpSoon() {
    if (gdpTimer !== null) {
        return;
    }
    gdpTimer = setTimeout(() => {
        gdpTimer = null;
    // ⚠️ `parentNode.replaceChild`, NOT `gdpMount.replaceWith` - this DOM has no `replaceWith`.
        const parent = gdpMount?.parentNode;
        if (!parent) {
            return;
        }
        try {
            const replacement = makeGdpTotal();
            parent.replaceChild(replacement, gdpMount);
            gdpMount = replacement;
        } catch (error) {
            warn(`could not refresh the GDP figure: ${error}`);
        }
    }, GDP_REFRESH_MS);
}

function makeButton({ label, busy, tooltip, run }) {
    const idleLabel = Locale.compose(label);
    const busyLabel = Locale.compose(busy);
    // font-fit-shrink is the game's own class: it scales the text down to fit the box.
    const button = makeElement('div', `${BUTTON_CLASS} font-fit-shrink`, { 'aria-label': idleLabel });
    button.textContent = idleLabel;

    bindActivatable(button, async () => {
        const model = getCommerceModel();
        if (!model || isAssignmentInProgress()) {
            return;
        }
        button.classList.add(`${BUTTON_CLASS}--busy`);
        button.textContent = busyLabel;
        try {
            await run(model);
        } catch (error) {
            warn(`${label} failed: ${error}`);
        } finally {
            button.classList.remove(`${BUTTON_CLASS}--busy`);
            button.textContent = idleLabel;
        }
    });
    // The framed tooltip wraps the button, so the caller is handed a mount point rather
    // than the button itself; see framed-tooltip.js.
    const mount = makeElement('div', `${BUTTON_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, { title: label, text: Locale.compose(tooltip) });
    return mount;
}

/**
 * What every assigned resource is earning per turn, in one figure.
 * ⚠️ Rebuilt rather than edited: the tooltip breaks the same number down by source, so editing
 * only the total would leave it disagreeing with itself.
 */
function makeGdpTotal() {
    const { fromCities, fromImports, fromFactories, fromBuildings, total } = gdpPerTurn();

    const readout = makeElement('div', GDP_CLASS);
    const value = makeElement('div', 'font-fit-shrink');
    value.textContent = `+${total}`;
    const icon = makeElement('div', `${GDP_CLASS}__icon`);
    icon.style.backgroundImage = `url(${GDP_ICON})`;
    appendAll(readout, value, icon);

    const cards = [
        Locale.compose('LOC_NAJANE_COMMERCE_GDP_FROM_CITIES', fromCities),
        Locale.compose('LOC_NAJANE_COMMERCE_GDP_FROM_IMPORTS', fromImports),
    ];
    if (isFactoryAge()) {
        cards.push(Locale.compose('LOC_NAJANE_COMMERCE_GDP_FROM_FACTORIES', fromFactories));
    }
    cards.push(Locale.compose('LOC_NAJANE_COMMERCE_GDP_FROM_BUILDINGS', fromBuildings));

    const mount = makeElement('div', `${BUTTON_CLASS}-mount`);
    appendWithFramedTooltip(mount, readout, {
        title: 'LOC_NAJANE_COMMERCE_GDP_TOTAL',
        text: cards.join('[N][N]'),
    });
    return mount;
}

function injectBar() {
    // The tab row is `relative`, so absolute placement inside it stays put without measuring.
    const row = commerceTabRow();
    if (!row) {
        return false;
    }
    if (row.querySelector(`.${BAR_CLASS}`)) {
        return true;
    }

    bar = makeElement('div', BAR_CLASS);
    appendAll(
        bar,
        ...BUTTONS.map(makeButton),
        makeHelpMark('LOC_NAJANE_COMMERCE_SHORTCUTS_TOOLTIP', 'LOC_NAJANE_COMMERCE_SHORTCUTS'),
    );
    gdpMount = makeGdpTotal();
    bar.appendChild(gdpMount);
    // They ride in this bar rather than the screen's own header; see assign-switches.js.
    bar.appendChild(createAssignSwitches());
    row.appendChild(bar);
    return true;
}

/**
 * Hides the game's own "unassign all", whose job the bar has taken over.
 * ⚠️ HIDDEN, NEVER REMOVED - it is Solid's and comes back with every redraw.
 */
function hideOriginalUnassign() {
    const container = document.querySelector(SLOTTED_CONTAINER_SELECTOR);
    if (!container) {
        return false;
    }
    const original = container.querySelector(ORIGINAL_UNASSIGN_SELECTOR);
    if (!original) {
        log('the original unassign-all row was not found, so it stays where it is');
        return true;
    }
    original.classList.add(HIDDEN_CLASS);
    return true;
}

function inject() {
    // Both, or neither - the observer keeps running until the screen has settled.
    return injectBar() && hideOriginalUnassign();
}

export function startAssignAllButtons() {
    styleElement = ensureStyle(STYLE_ID, STYLE);
    stopEngineEvents(gdpSubscriptions);
    gdpSubscriptions = onEngineEvents(GDP_EVENTS, refreshGdpSoon);

    if (inject()) {
        return;
    }
    /*
     * The tab row may not exist yet - the content renders behind a Suspense boundary. This watcher
     * unsubscribes as soon as the bar is in, because the bar does not need re-injecting: nothing
     * that mutates on every pass needs one.
     */
    unwatch = watchCommerceScreen(() => {
        if (inject()) {
            unwatch?.();
            unwatch = null;
        }
    });
}

export function stopAssignAllButtons() {
    unwatch?.();
    unwatch = null;
    stopEngineEvents(gdpSubscriptions);
    if (gdpTimer !== null) {
        clearTimeout(gdpTimer);
        gdpTimer = null;
    }
    gdpMount = null;
    // Every framed tooltip owns a Solid root created outside the tree; see framed-tooltip.js.
    disposeFramedTooltips();
    bar?.remove();
    bar = null;
    document.querySelectorAll(`.${HELP_CLASS}`).forEach((mark) => mark.remove());
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => element.classList.remove(HIDDEN_CLASS));
    styleElement?.remove();
    styleElement = null;
}
