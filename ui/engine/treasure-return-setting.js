/**
 * The "send Treasure Convoys home by themselves" setting. On unless turned off.
 *
 * ⚠️ In engine/, not planner/, and separate from the checkbox in screen/treasure-tab.js:
 * ./treasure-convoys.js runs with the Commerce screen closed and engine may not import
 * upwards, so a setting kept above its reader could not be read at all.
 */
import { storedSwitch } from './stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const TreasureAutoReturnChangedEventName = 'najane-commerce-treasure-auto-return-changed';

// Never touched: on. The switch is there to opt out, not in.
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
