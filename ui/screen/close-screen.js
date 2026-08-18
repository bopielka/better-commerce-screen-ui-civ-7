/**
 * Closing the Commerce screen, by the one name the game knows it under.
 *
 * ⚠️ The element is still `screen-resource-allocation` even though the directory and every
 * component say `commerce`; see 26-commerce-screen.md. Kept here rather than in whichever
 * file happened to need it first, because three separate buttons close this screen and none
 * of them should own that name.
 *
 * ⚠️ There is deliberately no `reopenCommerceScreen` beside this. Popping and re-pushing does
 * rebuild the screen's model - it is the only thing that does - but the whole screen goes
 * black and comes back, which is far too much for anything a button on one card can be
 * asking for. Everything this mod draws on a card redraws in place instead; see
 * `TradeCapacityChangedEventName` in trade-buy-merchant.js.
 */
import ContextManager from '/core/ui/context-manager/context-manager.js';

import { warn } from '../support/diagnostics.js';

/** The screen this sits on, by the name its frame is registered under. See ScreenFrame. */
export const COMMERCE_PANEL_CONTEXT = 'screen-resource-allocation';

/**
 * ⚠️ `ContextManager.pop` with the frame's own panel context - the same call the screen's own
 * close button makes (`ScreenFrame`, the ContextManager close handler).
 */
export function closeCommerceScreen() {
    try {
        ContextManager.pop(COMMERCE_PANEL_CONTEXT);
        return true;
    } catch (error) {
        warn(`could not close the Commerce screen: ${error}`);
        return false;
    }
}
