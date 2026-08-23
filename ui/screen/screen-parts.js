/**
 * Where this mod's things go on the Commerce screen: the selectors more than one module needs, and
 * the one spot every tab hangs a summary in.
 *
 * ⚠️ THE SELECTORS ARE THE MOST FRAGILE THING IN THIS MOD - they are the game's DOM, not ours, and
 * a patch can move any of them. `[data-name="TabList"]` had four private copies and
 * `screen-resource-allocation` five, so "check whether the tab strip still matches" meant finding
 * them all first. Selectors used by ONE module stay in that module.
 */

/** ⚠️ Still named for resource allocation though the screen, folder and model say Commerce. */
export const COMMERCE_SCREEN_SELECTOR = 'screen-resource-allocation';

/** The tab strip: Resources / Trade Routes / Empire / Treasure / Factory. */
export const TAB_LIST_SELECTOR = '[data-name="TabList"]';

/** One card on the Trade Routes tab. */
export const TRADE_CARD_SELECTOR = '.trade-route-card';

/**
 * The class this mod puts on a trade route card's title row.
 * ⚠️ Here because trade-routes.js marks the row and trade-buy-merchant.js hangs its stack in it,
 * and trade-routes imports trade-buy-merchant - so the constant cannot travel the other way.
 */
export const TRADE_HEAD_CLASS = 'najane-trade-head';

/**
 * The row the tab strip sits in, where every summary this mod adds goes.
 * ⚠️ It belongs to the SCREEN, not to any one tab - which is why the helpers below exist: a tab
 * can be left and re-entered, and its `onMount` will happily add a second summary beside the first.
 */
export function commerceTabRow() {
    return document.querySelector(TAB_LIST_SELECTOR)?.parentElement ?? null;
}

/** Puts one summary in the tab row, replacing whatever this mod put there before. */
export function showTabSummary(className, build) {
    const row = commerceTabRow();
    if (!row) {
        return;
    }
    hideTabSummary(className);
    row.appendChild(build());
}

export function hideTabSummary(className) {
    document.querySelectorAll(`.${className}`).forEach((bar) => bar.remove());
}
