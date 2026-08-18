/**
 * The "send Treasure Convoys home by themselves" setting. On unless the player turns it off.
 *
 * The setting lives here and the checkbox that changes it lives in screen/treasure-tab.js,
 * for the same reason factories-first is split that way: the mechanism in
 * ./treasure-convoys.js runs with the Commerce screen CLOSED - a convoy sails for many turns
 * after the screen it was started from is gone - so it must be able to ask this question
 * without importing a widget to do it.
 *
 * ⚠️ In `engine/`, not `planner/`, where the other two switches are. The consumer is an
 * engine module, and engine may only import `support` (see 02-architecture.md); a setting
 * kept a layer above the code that reads it could not be read at all.
 */
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Three states, not two - the same reasoning as factory-first-setting.js, and it applies
 * here for the same reason: the default is ON, so "never touched" and "switched off" must be
 * told apart. An option that was never set reads back as 0, so the stored value is offset by
 * one and 0 means untouched.
 */
const OPTION = `${MOD_ID}.treasureAutoReturnChoice`;
const STORED_OFF = 1;
const STORED_ON = 2;

export const TreasureAutoReturnChangedEventName = 'najane-commerce-treasure-auto-return-changed';

let enabled = null;

function restore() {
    try {
        const stored = Number(UI.getOption('user', 'Mod', OPTION));
        if (stored === STORED_OFF || stored === STORED_ON) {
            return stored === STORED_ON;
        }
    } catch (error) {
        warn(`could not read the treasure auto-return switch: ${error}`);
    }
    /*
     * Never touched: on. A loaded convoy has exactly one thing it is for - reaching the
     * homeland and unloading - and every turn it sits still is that reward not collected.
     * There is no strategy in steering it, only the bookkeeping of remembering it exists,
     * which is what this takes over. The switch is there to turn that off, not to opt in.
     */
    return true;
}

export function isTreasureAutoReturnEnabled() {
    if (enabled === null) {
        enabled = restore();
    }
    return enabled;
}

export function setTreasureAutoReturnEnabled(value) {
    enabled = !!value;
    try {
        UI.setOption('user', 'Mod', OPTION, enabled ? STORED_ON : STORED_OFF);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the treasure auto-return switch: ${error}`);
    }
    window.dispatchEvent(new CustomEvent(TreasureAutoReturnChangedEventName));
    log(`treasure convoys return by themselves: ${enabled ? 'on' : 'off'}`);
}
