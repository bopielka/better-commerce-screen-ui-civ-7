/**
 * Whether the planner builds a culture settlement and a gold settlement of its own accord.
 *
 * Left to the ordinary rules, resources that pay culture end up wherever a slot happened to
 * be free, and a +10% Culture resource in a settlement making 12 Culture is worth about a
 * point. Gathered into the one settlement that already makes the most of that yield, the
 * same resources compound. See the gathering tier in scoring.js.
 *
 * It is a strategy rather than a fact about the data, and not everyone plays that way -
 * hence two switches. They are separate because the two piles are independent: gathering
 * culture is worth doing whether or not gold is being gathered, and the gold pile
 * deliberately avoids the culture pile's settlement, which only matters when both are on.
 *
 * Here rather than in ui/options/ for the reason given at the top of happiness-setting.js.
 */
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/** One event for both: anything drawing them draws them together. */
export const HoardSettingChangedEventName = 'najane-commerce-hoard-changed';

/*
 * Never touched: on, both of them. Concentrating these yields is worth more than spreading
 * them, and the switches are there to decline that, not to opt into it.
 */
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
