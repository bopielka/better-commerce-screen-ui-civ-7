/**
 * Layout tidy-up for the Commerce screen.
 *
 *   1. the tab strip gets wider and shorter, so "Trade Routes" fits on one line;
 *   2. the standing instruction line above the panel is dropped, keeping one gap's
 *      worth of breathing room where it used to be;
 *   3. the filter and sort dropdowns lose a third of their height.
 *
 * Two stylesheets, on purpose. The tab strip belongs to the whole screen, so its rules
 * are attached once and scoped by the `screen-resource-allocation` element - which only
 * exists while the screen is open, so nothing leaks. Everything else belongs to the
 * Resources tab and is attached and removed with it, which keeps the other three tabs
 * untouched by construction rather than by selector.
 *
 * ⚠️ The unassigned-resource yield totals used to be restyled as badges here. Removed:
 * the row they live in is built from `getUnassignedResourceYieldBonus`, which is zero for
 * every yield unless something specifically pays you for leaving resources unassigned. For
 * almost every game the row is empty, so the styling had nothing to apply to and the
 * feature was invisible - it was not broken, there was simply nothing there.
 */
import { log, warn } from '../support/diagnostics.js';
import { ensureStyle } from '../support/dom.js';

const SCREEN = 'screen-resource-allocation';
const SCREEN_STYLE_ID = 'najane-commerce-screen-style';
const TAB_STYLE_ID = 'najane-commerce-tab-style';
const FILTER_SLOT_SELECTOR = '[data-name="filter-and-sort"]';

/** The tab's instruction line. Utility classes, so verified at runtime - see checkDescription. */
const DESCRIPTION_SELECTOR = `${SCREEN} .text-base.w-full.text-center.my-4`;


/**
 * The tab strip.
 *
 * The game asks for w-187 (41.5555rem) and min-h-16 (3.5555rem); at that width a
 * two-word tab title wraps and the strip grows tall enough for two lines. Wider and
 * shorter fixes both - the decorative bar and end caps are `absolute inset-0` inside
 * this element, so they follow it.
 *
 * It is also pushed to the right, out of `self-center`, to clear the three buttons that
 * sit at the left of the same row. Both sides are sized in rem, and this UI scales rem
 * with the resolution, so the gap between them stays proportional instead of closing up
 * on smaller screens.
 *
 *   left edge   2rem + three 10.5rem buttons + gaps  ≈ 35rem
 *   right edge  30rem strip + 6rem margin            ≈ 36rem
 *
 * 30rem is enough because the tabs carry icons rather than words (tab-icons.js). Widen
 * this again if they ever go back to text.
 */
const TAB_STYLE = `
${SCREEN} [data-name="TabList"] {
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

/*
 * Dropdown height comes from three places at once: the class the screen passes in
 * (min-h-14, 3.1111rem), the component's own min-h-10 on the same element, and the
 * open-arrow's min-h-12. Overriding only the first one left them nearly as tall, so all
 * three are pinned to the game's own min-h-8.
 */
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
 * Waits for the tab's header bar to exist, then checks the one selector that is guesswork.
 *
 * It cannot be found in onMount: `CommerceScreenBaseTabContent` renders the tab's content
 * inside a `ThrobberSuspense`, so at mount time it is still a placeholder. Looking once
 * found nothing every time, so the search runs from a broad observer and stops as soon as
 * it succeeds.
 *
 * Everything this module does is CSS; the only thing that needs the DOM is confirming
 * that the instruction line's selector still matches exactly one element, since that one
 * is built from the game's utility classes rather than a `data-name`.
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
 * The rules that belong to the whole screen rather than to one tab: the tab strip, and
 * the standing instruction line every tab opens with.
 *
 * Put in once and never taken out - they are scoped to the screen element, which is
 * itself transient. Exported because the Trade Routes tab needs them too, and it must not
 * depend on the player having visited the Resources tab first.
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

    const screen = document.querySelector(SCREEN) ?? document.body;
    observer = new MutationObserver(() => tryAttachToHeaderBar());
    observer.observe(screen, { childList: true, subtree: true });
}

export function stopLayout() {
    observer?.disconnect();
    observer = null;
    styleElement?.remove();
    styleElement = null;
}
