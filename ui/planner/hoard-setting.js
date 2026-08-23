/**
 * Whether the planner gathers culture, and gold, each into one settlement of its own accord.
 *
 * A +10% Culture resource in a settlement making 12 Culture is worth about a point; gathered
 * into the settlement already making the most of that yield they compound. See the gathering
 * tier in scoring.js.
 *
 * Two switches, because the piles are independent - and the gold pile deliberately avoids the
 * culture pile's settlement, which only matters when both are on. Here rather than in
 * ui/options/ for the reason at the top of happiness-setting.js.
 */
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/** One event for both: anything drawing them draws them together. */
export const HoardSettingChangedEventName = 'najane-commerce-hoard-changed';

// Never touched: on, both. The switches decline gathering, they do not opt into it.
const cultureSetting = storedSwitch({
    option: `${MOD_ID}.gatherCulture`,
    defaultValue: true,
    label: 'gather culture into one settlement',
    changedEventName: HoardSettingChangedEventName,
});

const goldSetting = storedSwitch({
    option: `${MOD_ID}.gatherGold`,
    defaultValue: true,
    label: 'gather gold into one settlement',
    changedEventName: HoardSettingChangedEventName,
});

export function isCultureGatheringEnabled() {
    return cultureSetting.isOn();
}

export function isGoldGatheringEnabled() {
    return goldSetting.isOn();
}

export function setCultureGatheringEnabled(value) {
    cultureSetting.set(value);
}

export function setGoldGatheringEnabled(value) {
    goldSetting.set(value);
}
