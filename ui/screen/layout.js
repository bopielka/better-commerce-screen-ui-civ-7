/**
 * Layout tidy-up for the Commerce screen.
 *
 *   1. the tab strip gets wider and shorter, so "Trade Routes" fits on one line;
 *   2. the standing instruction line above the panel is dropped, keeping one gap's
 *      worth of breathing room where it used to be;
 *   3. the unassigned-resource yield totals become badges, the same rounded translucent
 *      pills Drongo's Top Panel puts around the yields in the top-left corner;
 *   4. the filter and sort dropdowns lose a third of their height.
 *
 * Two stylesheets, on purpose. The tab strip belongs to the whole screen, so its rules
 * are attached once and scoped by the `screen-resource-allocation` element - which only
 * exists while the screen is open, so nothing leaks. Everything else belongs to the
 * Resources tab and is attached and removed with it, which keeps the other three tabs
 * untouched by construction rather than by selector.
 *
 * Marks are applied by JavaScript rather than written as selectors on the game's utility
 * classes wherever the structure allows it, because those classes are layout, not
 * identity, and change without warning. `data-name` attributes are the exception - the
 * game sets them deliberately.
 */
import { Icon } from '/core/ui/utilities/utilities-image.js';

import { getCommerceModel } from '../model/screen-model.js';
import { log, warn } from '../support/diagnostics.js';
import { ensureStyle } from '../support/dom.js';

const SCREEN = 'screen-resource-allocation';
const SCREEN_STYLE_ID = 'najane-commerce-screen-style';
const TAB_STYLE_ID = 'najane-commerce-tab-style';
const BADGE_CLASS = 'najane-yield-badge';
const FILTER_SLOT_SELECTOR = '[data-name="filter-and-sort"]';

/** The tab's instruction line. Utility classes, so verified at runtime - see checkDescription. */
const DESCRIPTION_SELECTOR = `${SCREEN} .text-base.w-full.text-center.my-4`;

/**
 * Lifted from Drongo's Top Panel (ui/diplo-ribbon/css-constants.js) so the badges here
 * read as the same object as the ones up there. Its geometry is the game's own min-h-8,
 * 1.7777rem; the tints are that mod's.
 */
const YIELD_TINTS = {
    YIELD_GOLD: 'rgba(255, 235, 75, 0.3)',
    YIELD_HAPPINESS: 'rgba(253, 175, 50, 0.3)',
    YIELD_SCIENCE: 'rgba(50, 151, 255, 0.3)',
    YIELD_CULTURE: 'rgba(197, 75, 255, 0.3)',
    YIELD_PRODUCTION: 'rgba(204, 118, 52, 0.34)',
    YIELD_DIPLOMACY: 'rgba(88, 192, 231, 0.3)',
};
const DEFAULT_TINT = 'rgba(228, 228, 228, 0.3)';

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

function buildTabContentStyle() {
    const tints = Object.entries(YIELD_TINTS)
        .map(([type, colour]) => `.${BADGE_CLASS}--${type} { background-color: ${colour}; }`)
        .join('\n');

    return `
.${BADGE_CLASS} {
    box-sizing: border-box;
    align-items: center;
    height: 1.7777777778rem;
    min-height: 1.7777777778rem;
    border-radius: 0.4444444444rem;
    padding-left: 0.3333333333rem;
    padding-right: 0.5555555556rem;
    margin: 0.1666666667rem;
    color: #FFFFFF;
    background-color: ${DEFAULT_TINT};
    background-clip: padding-box;
}

${tints}

/*
 * Dropdown height comes from three places at once: the class the screen passes in
 * (min-h-14, 3.1111rem), the component's own min-h-10 on the same element, and the
 * open-arrow's min-h-12. Overriding only the first one left them nearly as tall, so
 * all three are pinned to min-h-8 - the height of the badges above.
 */
${FILTER_SLOT_SELECTOR} .dropdown__container {
    min-height: 1.7777777778rem;
}
${FILTER_SLOT_SELECTOR} .dropdown__open-arrow {
    min-height: 1.7777777778rem;
}
`;
}

let styleElement = null;
let observer = null;
let headerBar = null;

/** iconSrc back to the yield it came from, using the game's own icon lookup. */
function yieldTypeByIconSrc() {
    const map = new Map();
    GameInfo.Yields.forEach((yieldDefinition) => {
        map.set(`url(${Icon.getYieldIcon(yieldDefinition.YieldType)})`, yieldDefinition.YieldType);
    });
    return map;
}

/**
 * The row of unassigned-yield totals.
 *
 * Found structurally from the filter slot rather than by class: the header bar is that
 * slot's parent, its first block is the "unassigned" column, and the totals are the last
 * thing in it. See the headerBar prop in commerce-screen-resources-tab.tsx.
 */
function findBonusRow() {
    const leftBlock = headerBar?.firstElementChild;
    return leftBlock?.lastElementChild ?? null;
}

function applyBadges() {
    const model = getCommerceModel();
    const bonuses = model?.data?.resourceTabData?.unslottedBonuses ?? [];
    const row = findBonusRow();
    if (!row || bonuses.length === 0) {
        return;
    }

    const byIcon = yieldTypeByIconSrc();
    const entries = Array.from(row.children);
    if (entries.length !== bonuses.length) {
        // The row is mid-rebuild; the observer will call again once it settles.
        return;
    }

    entries.forEach((element, index) => {
        const yieldType = byIcon.get(bonuses[index].iconSrc);
        element.classList.add(BADGE_CLASS);
        if (yieldType) {
            element.classList.add(`${BADGE_CLASS}--${yieldType}`);
        }
    });
}

function checkDescription() {
    const matches = document.querySelectorAll(DESCRIPTION_SELECTOR).length;
    if (matches !== 1) {
        // Not fatal - the worst case is the line staying visible, or one line too many
        // disappearing - but it means the selector needs revisiting.
        warn(`the description selector matched ${matches} elements, expected 1`);
    }
}

/**
 * Narrows the observer onto the header bar once it exists.
 *
 * The header bar cannot be found in onMount: `CommerceScreenBaseTabContent` renders the
 * tab's content inside a `ThrobberSuspense`, so at mount time it is still a placeholder.
 * The first attempt at this looked once, found nothing, and logged "could not find the
 * header bar" every time. So the search runs from a broad observer and narrows down when
 * it succeeds.
 */
function tryAttachToHeaderBar() {
    const filterSlot = document.querySelector(FILTER_SLOT_SELECTOR);
    if (!filterSlot?.parentElement) {
        return false;
    }
    headerBar = filterSlot.parentElement;

    observer?.disconnect();
    checkDescription();
    applyBadges();

    // childList only, and applyBadges only ever adds classes - an attribute mutation.
    // That is what keeps this from feeding itself; see the note in trade-routes.js about
    // what happens when an observer's callback mutates childList on every pass.
    observer = new MutationObserver(() => applyBadges());
    observer.observe(headerBar, { childList: true, subtree: true });
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
    styleElement = ensureStyle(SCREEN_STYLE_ID, buildTabContentStyle());

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
    headerBar = null;
    styleElement?.remove();
    styleElement = null;
}
