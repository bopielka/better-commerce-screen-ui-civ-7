/**
 * Where this mod's things go on the Commerce screen: the selectors, and the one spot every
 * tab hangs a summary in.
 *
 * ⚠️ THE SELECTORS ARE THE MOST FRAGILE THING IN THIS MOD - they are the game's DOM, not
 * ours, and a patch can move any of them. `[data-name="TabList"]` had four private copies
 * and `screen-resource-allocation` had five, so "check whether the tab strip still matches"
 * meant finding all of them first. One copy each is not tidiness here; it is the difference
 * between a one-line repair and a hunt.
 *
 * Selectors used by ONE module stay in that module. These are the ones more than one needs.
 */

/**
 * The Commerce screen's own element.
 *
 * ⚠️ Still named for resource allocation even though the screen, its folder and its model
 * were all renamed to Commerce - the old `ui/resource-allocation/` files still ship and lose
 * on priority, but the element kept the name. See close-screen.js.
 */
export const COMMERCE_SCREEN_SELECTOR = 'screen-resource-allocation';

/** The tab strip: Resources / Trade Routes / Empire / Treasure / Factory. */
export const TAB_LIST_SELECTOR = '[data-name="TabList"]';

/** One card on the Trade Routes tab. */
export const TRADE_CARD_SELECTOR = '.trade-route-card';

/**
 * The class this mod puts on a trade route card's title row.
 *
 * ⚠️ Here because the two modules that need it cannot pass it between themselves.
 * `trade-routes.js` marks the row and `trade-buy-merchant.js` hangs the button stack in it,
 * but trade-routes imports trade-buy-merchant, so taking the constant the other way round
 * would close the cycle. It used to be written out twice with a comment apologising for it.
 */
export const TRADE_HEAD_CLASS = 'najane-trade-head';

/**
 * The row the tab strip sits in, which is where every summary this mod adds goes.
 *
 * ⚠️ It belongs to the SCREEN, not to any one tab. That is the whole reason the helpers
 * below exist: a tab can be left and re-entered, and its `onMount` will happily add a second
 * summary beside the first unless something takes the old one away.
 */
export function commerceTabRow() {
    return document.querySelector(TAB_LIST_SELECTOR)?.parentElement ?? null;
}

/**
 * Puts one summary in the tab row, replacing whatever this mod put there before.
 *
 * Three tabs had their own four-line copy of this, and one of the three had drifted into
 * building its bar before checking that there was a row to put it in.
 *
 * @param className  the class this tab's summary carries; also what identifies it for removal.
 * @param build      called only once there is somewhere to put the result.
 */
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
