/**
 * Layout tidy-up for the Commerce screen: a wider, shorter tab strip so "Trade Routes" fits on one
 * line, the standing instruction line dropped, and a third off the dropdown height.
 *
 * Two stylesheets on purpose. The tab strip belongs to the whole screen, so its rules are attached
 * once and scoped by the `screen-resource-allocation` element, which only exists while the screen
 * is open. Everything else belongs to the Resources tab and goes with it, which keeps the other
 * tabs untouched by construction rather than by selector.
 */
import { COMMERCE_SCREEN_SELECTOR, TAB_LIST_SELECTOR } from './screen-parts.js';
import { log, warn } from '../support/diagnostics.js';
import { ensureStyle } from '../support/dom.js';

const SCREEN_STYLE_ID = 'najane-commerce-screen-style';
const TAB_STYLE_ID = 'najane-commerce-tab-style';
const FILTER_SLOT_SELECTOR = '[data-name="filter-and-sort"]';

/** The tab's instruction line. Utility classes, so verified at runtime - see checkDescription. */
const DESCRIPTION_SELECTOR = `${COMMERCE_SCREEN_SELECTOR} .text-base.w-full.text-center.my-4`;

/**
 * The tab strip. The game asks for w-187/min-h-16, at which a two-word title wraps and the strip
 * grows to two lines; wider and shorter fixes both, and the decorative bar and end caps are
 * `absolute inset-0` inside it so they follow.
 *
 * It is also pushed right, out of `self-center`, to clear the buttons at the left of the same row.
 * Both sides are in rem and this UI scales rem with resolution, so the gap stays proportional.
 * 30rem is enough only because the tabs carry icons rather than words - widen it if that changes.
 */
const TAB_STYLE = `
${COMMERCE_SCREEN_SELECTOR} ${TAB_LIST_SELECTOR} {
    width: 30rem;
    min-height: 2.6666666667rem;
    align-self: flex-end;
    margin-right: 6rem;
}

/*
 * Every tab opens with a line of standing instructions. They are the same every time and
 * say nothing the screen does not show, so they go - on all four tabs, not just this one.
 * These rules live in the screen's stylesheet rather than the tab's for exactly that
 * reason: the tab's is taken down when the Resources tab unmounts, and the line came
 * straight back on Trade Routes.
 */
${DESCRIPTION_SELECTOR} {
    display: none;
}

/*
 * The panel used to sit below that line, with a my-4 margin above and below it. Hiding
 * the text closed the gap completely and the panel ended up touching the tabs, so one
 * margin's worth is given back to the panel itself.
 */
${DESCRIPTION_SELECTOR} + div {
    margin-top: 0.8888888889rem;
}
`;

/* Dropdown height comes from three places at once, so all three are overridden. */
const TAB_CONTENT_STYLE = `
${FILTER_SLOT_SELECTOR} .dropdown__container {
    min-height: 1.7777777778rem;
}
${FILTER_SLOT_SELECTOR} .dropdown__open-arrow {
    min-height: 1.7777777778rem;
}
`;

let styleElement = null;
let observer = null;

function checkDescription() {
    const matches = document.querySelectorAll(DESCRIPTION_SELECTOR).length;
    if (matches !== 1) {
        // Not fatal - the worst case is the line staying visible, or one line too many
        // disappearing - but it means the selector needs revisiting.
        warn(`the description selector matched ${matches} elements, expected 1`);
    }
}

/**
 * Waits for the tab's header bar, then checks the one selector that is guesswork.
 * ⚠️ The instruction line is matched by utility classes, which a patch can renumber - so it is
 * verified at runtime and a miss is logged rather than silently doing nothing.
 */
function tryAttachToHeaderBar() {
    if (!document.querySelector(FILTER_SLOT_SELECTOR)?.parentElement) {
        return false;
    }
    observer?.disconnect();
    observer = null;
    checkDescription();
    log('layout adjustments applied');
    return true;
}

/**
 * The rules that belong to the whole screen rather than to one tab. Exported because the Trade
 * Routes tab needs them too and must not depend on the Resources tab having been visited first.
 */
export function ensureScreenLayout() {
    ensureStyle(TAB_STYLE_ID, TAB_STYLE);
}

export function startLayout() {
    if (styleElement) {
        return;
    }
    ensureScreenLayout();
    styleElement = ensureStyle(SCREEN_STYLE_ID, TAB_CONTENT_STYLE);

    if (tryAttachToHeaderBar()) {
        return;
    }

    const screen = document.querySelector(COMMERCE_SCREEN_SELECTOR) ?? document.body;
    observer = new MutationObserver(() => tryAttachToHeaderBar());
    observer.observe(screen, { childList: true, subtree: true });
}

export function stopLayout() {
    observer?.disconnect();
    observer = null;
    styleElement?.remove();
    styleElement = null;
}
