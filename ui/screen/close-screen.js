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

import { COMMERCE_SCREEN_SELECTOR } from './screen-parts.js';
import { warn } from '../support/diagnostics.js';

/**
 * The screen this sits on, by the name its frame is registered under. See ScreenFrame.
 *
 * ⚠️ The same string as the element's tag, and not a coincidence: `factory-tab.js` passes it
 * to `ScreenFrame` as `panelContext`, which is what registers it under that name. One
 * definition, in screen-parts.js, so a rename cannot move one of the two and leave the other.
 */
export const COMMERCE_PANEL_CONTEXT = COMMERCE_SCREEN_SELECTOR;

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
