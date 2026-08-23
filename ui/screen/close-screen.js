/**
 * Closing the Commerce screen, by the one name the game knows it under.
 *
 * ⚠️ There is deliberately no `reopenCommerceScreen`. Popping and re-pushing is the only thing
 * that rebuilds the screen's model, but the whole screen goes black and back - far too much for
 * a button on one card. Everything this mod draws redraws in place instead.
 */
import ContextManager from '/core/ui/context-manager/context-manager.js';

import { COMMERCE_SCREEN_SELECTOR } from './screen-parts.js';
import { warn } from '../support/diagnostics.js';

/**
 * ⚠️ The same string as the element tag, and not a coincidence: factory-tab.js passes it to
 * `ScreenFrame` as `panelContext`, which is what registers it under that name.
 */
export const COMMERCE_PANEL_CONTEXT = COMMERCE_SCREEN_SELECTOR;

// The same call the screen's own close button makes (ScreenFrame's ContextManager handler).
export function closeCommerceScreen() {
    try {
        ContextManager.pop(COMMERCE_PANEL_CONTEXT);
        return true;
    } catch (error) {
        warn(`could not close the Commerce screen: ${error}`);
        return false;
    }
}
