/**
 * The "send Treasure Convoys home by themselves" setting. On unless the player turns it off.
 *
 * The setting lives here and the checkbox that changes it lives in screen/treasure-tab.js,
 * for the same reason factories-first is split that way: the mechanism in
 * ./treasure-convoys.js runs with the Commerce screen CLOSED - a convoy sails for many turns
 * after the screen it was started from is gone - so it must be able to ask this question
 * without importing a widget to do it.
 *
 * ⚠️ In `engine/`, not `planner/`, where the other switches are. The consumer is an engine
 * module, and engine may only import `support` and its own folder (see 02-architecture.md);
 * a setting kept a layer above the code that reads it could not be read at all.
 */
import { storedSwitch } from './stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const TreasureAutoReturnChangedEventName = 'najane-commerce-treasure-auto-return-changed';

/*
 * Never touched: on. A loaded convoy has exactly one thing it is for - reaching the homeland
 * and unloading - and every turn it sits still is that reward not collected. There is no
 * strategy in steering it, only the bookkeeping of remembering it exists, which is what this
 * takes over. The switch is there to turn that off, not to opt in.
 */
const setting = storedSwitch({
    option: `${MOD_ID}.treasureAutoReturnChoice`,
    defaultValue: true,
    label: 'treasure convoys return by themselves',
    changedEventName: TreasureAutoReturnChangedEventName,
});

export function isTreasureAutoReturnEnabled() {
    return setting.isOn();
}

export function setTreasureAutoReturnEnabled(value) {
    setting.set(value);
}
