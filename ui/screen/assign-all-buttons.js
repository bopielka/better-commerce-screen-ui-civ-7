/**
 * "Assign All" and "Reassign All", side by side to the left of the tab strip.
 *
 * The behaviour is Resource+'s - see planner/scoring.js for the attribution note. The
 * placement is not: that mod measures the resource column every frame and pins its
 * buttons over it with `position: fixed`. These sit inside the tab row, which is a
 * positioned element the game already maintains, so they move with the layout instead
 * of chasing it.
 *
 * They live in the tab row rather than in the Resources tab body because they are
 * screen-level actions. They are still only mounted while the Resources tab is open,
 * since that is the only tab where they mean anything.
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

/**
 * The game's own "unassign all" sits at the very bottom of the settlement column, past
 * everything the player has to scroll through. `self-end` is what marks it out from the
 * settlement sections around it.
 */
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
        /*
         * ⚠️ Not `model.clearAllResources()`, which is what this used to call.
         *
         * That is the game's own bulk clear, and it sends exactly the operation this one
         * sends - but it fires every settlement's Clear in a single tick and never waits.
         * With nothing planned afterwards that is fine for the game and it was fine here
         * too, right up until it became the odd one out: three buttons that all empty the
         * empire, two of them through the planner's path and one straight into the model,
         * reporting nothing and answering "did that work?" differently. One path now, in
         * engine/unassign.js, which still sends the game's own operation.
         */
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
 * The engine subscriptions, kept so they can be taken off again.
 *
 * ⚠️ THEY USED NOT TO BE, and that is a leak that grew for the whole session: `startX` ran on
 * every visit to the Resources tab and added four more listeners, `stopX` removed none, and
 * the pile kept firing on every resource ANY player assigned long after the screen had been
 * closed. `engine.off` needs the same function reference that was registered, which is what
 * these handles carry - see engine/events.js.
 */
let gdpSubscriptions = [];
/** The GDP readout, kept so it can be rebuilt when the board changes. */
let gdpMount = null;
let gdpTimer = null;

/**
 * Events after which the figure is out of date.
 *
 * ⚠️ Debounced, and rebuilt rather than edited in place. A run places one resource at a
 * time and fires one event each - fifty-odd for a full empire - so without the debounce the
 * readout would be rebuilt fifty times in four seconds. The tooltip carries the same
 * numbers broken down by source, so editing only the total would leave it disagreeing with
 * itself the moment it was opened.
 */
/*
 * ⚠️ Every one of these is raised for EVERY player, not for you. An AI assigning a resource
 * on the far side of the map cannot change your empire's GDP, so those are dropped before
 * the handler is reached - see `onEngineEvents` in engine/events.js.
 */
const GDP_EVENTS = ['ResourceAssigned', 'ResourceUnassigned', 'ResourceCapChanged', 'ConstructibleBuildCompleted'];
const GDP_REFRESH_MS = 400;

function refreshGdpSoon() {
    if (gdpTimer !== null) {
        return;
    }
    gdpTimer = setTimeout(() => {
        gdpTimer = null;
        /*
         * ⚠️ `parentNode.replaceChild`, NOT `gdpMount.replaceWith`.
         *
         * This engine's DOM is Coherent's, not a browser's, and it does not implement the
         * ChildNode convenience methods - `replaceWith` threw `is not a function` on every
         * single refresh, so the figure never moved. `isConnected` is avoided for the same
         * reason: a live parent is the check that is safe to rely on here.
         */
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
 *
 * ⚠️ No label, deliberately: this sits in a row that is already three buttons, a help mark
 * and two switches wide, and the game writes its own victory-point readouts the same way -
 * the number and the icon, with the words in the tooltip.
 *
 * The three sources are broken out there because they are not one rule: resources in a
 * CITY pay 1, an imported one pays 1 more on top, and a factory resource pays 3 in a city
 * or a town alike. The factory card is left out entirely outside the Modern age, where
 * there is nothing to say.
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
    /*
     * The tab row is `relative`, so absolute placement inside it stays put without any
     * measuring. The tab strip itself is centred in that row, which leaves the left end free.
     */
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
    // "Imports first" in every age, "factories first" stacked under it in the Modern age.
    // They ride in this bar rather than in the screen's own header - see the note at the
    // top of assign-switches.js.
    bar.appendChild(createAssignSwitches());
    row.appendChild(bar);
    return true;
}

/**
 * Hides the game's own "unassign all", which sits at the very bottom of the settlement
 * column, past everything the player has to scroll through. The button in the bar above
 * sends the same operation, through engine/unassign.js.
 *
 * The original is hidden rather than moved: it is a `ConfirmationDialog` wrapping an
 * icon button, and relocating a Solid-managed subtree would fight whatever re-renders it.
 *
 * ⚠️ The confirmation prompt is lost along the way. That matches its new neighbours -
 * "Reassign All" already clears everything without asking.
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
     * The tab row may not exist yet - the screen's content renders behind a Suspense
     * boundary. Watch until it does, then stop watching.
     *
     * No re-entrancy guard here on purpose: inject() appends the bar only when it is
     * missing, and the observer is disconnected in the same breath. Anything that DOES
     * mutate on every pass needs one - see the freeze described in trade-routes.js.
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
