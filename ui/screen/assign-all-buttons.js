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
import { assignAll, isAssignmentInProgress, reassignAll } from '../planner/run.js';
import { getCommerceModel } from '../model/screen-model.js';
import { createFactoryFirstToggle } from './factory-first.js';
import { HELP_CLASS, HELP_STYLE, makeHelpMark } from './help-mark.js';
import { appendAll, bindActivatable, ensureStyle, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const BAR_CLASS = 'najane-assign-bar';
const BUTTON_CLASS = 'najane-assign-button';
const HIDDEN_CLASS = 'najane-hidden';
const STYLE_ID = 'najane-assign-buttons-style';

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
        run: async (model) => {
            model.deselectSelectedResource();
            model.clearAllResources();
        },
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

.${HIDDEN_CLASS} { display: none; }
${HELP_STYLE}
`;

let bar = null;
let styleElement = null;
let observer = null;

function makeButton({ label, busy, tooltip, run }) {
    const idleLabel = Locale.compose(label);
    const busyLabel = Locale.compose(busy);
    // font-fit-shrink is the game's own class: it scales the text down to fit the box.
    const button = makeElement('div', `${BUTTON_CLASS} font-fit-shrink`, {
        'data-tooltip-content': Locale.compose(tooltip),
        'aria-label': idleLabel,
    });
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
    return button;
}

/**
 * The tab row is `relative`, so absolute placement inside it stays put without any
 * measuring. The tab strip itself is centred in that row, which leaves the left end free.
 */
function tabRow() {
    return document.querySelector('[data-name="TabList"]')?.parentElement ?? null;
}

function injectBar() {
    const row = tabRow();
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
    // Modern age only, so this is null in the other two. It rides in this bar rather than
    // in the screen's own header - see the note at the top of factory-first.js.
    const factoryFirst = createFactoryFirstToggle();
    if (factoryFirst) {
        bar.appendChild(factoryFirst);
    }
    row.appendChild(bar);
    return true;
}

/**
 * Hides the game's own "unassign all", which sits at the very bottom of the settlement
 * column, past everything the player has to scroll through. The button in the bar above
 * calls the same `model.clearAllResources()`.
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
    observer = new MutationObserver(() => {
        if (inject()) {
            observer?.disconnect();
            observer = null;
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopAssignAllButtons() {
    observer?.disconnect();
    observer = null;
    bar?.remove();
    bar = null;
    document.querySelectorAll(`.${HELP_CLASS}`).forEach((mark) => mark.remove());
    document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((element) => element.classList.remove(HIDDEN_CLASS));
    styleElement?.remove();
    styleElement = null;
}
