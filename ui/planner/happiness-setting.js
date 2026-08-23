/**
 * How hard the planner works to keep settlements out of negative happiness.
 *
 * The rescue tier sits above every other consideration in scoring.js - above factories,
 * above camels, above a settlement's own priority - so it is the single largest thing this
 * mod does to a layout, and until it was made a setting the player had no say in it. Some
 * players want an unhappy town left alone; some do not want the rule at all.
 *
 * The value lives here rather than in ui/options/ for the same reason factory-first's does:
 * the assignment engine has to be able to ask the question with the Commerce screen closed
 * and without importing anything that pulls in the options screen. The dropdown in
 * ui/options/najane-commerce-options.js writes to this module.
 */
import { storedChoice } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Append only, and note that these are NOT what gets stored - see engine/stored-setting.js
 * for why a choice is stored one higher than its value. "Never" is 0, which is exactly the
 * number `UI.getOption` answers for an option nobody has ever set.
 *
 *   Never            the rescue tier does not run at all; happiness is just another yield
 *   CitiesOnly       cities are rescued, towns are left where they fall
 *   AllSettlements   cities first as a class, then towns - the original behaviour
 */
export const HappinessPriorityMode = {
    Never: 0,
    CitiesOnly: 1,
    AllSettlements: 2,
};

export const HappinessPriorityChangedEventName = 'najane-commerce-happiness-priority-changed';

const MODES = [HappinessPriorityMode.Never, HappinessPriorityMode.CitiesOnly, HappinessPriorityMode.AllSettlements];
const MODE_NAMES = ['never', 'cities only', 'all settlements'];

/*
 * Never touched: rescue everything. An empire in revolt is the one situation where overriding
 * what the player asked each settlement for is worth it, so that stays the default; the
 * setting is there to opt out of it.
 */
const setting = storedChoice({
    option: `${MOD_ID}.happinessPriorityMode`,
    values: MODES,
    defaultValue: HappinessPriorityMode.AllSettlements,
    label: 'happiness priority',
    changedEventName: HappinessPriorityChangedEventName,
    describe: (mode) => MODE_NAMES[mode] ?? String(mode),
});

export function happinessPriorityMode() {
    return setting.get();
}

/** Whether the rescue tier runs at all. */
export function isHappinessRescueEnabled() {
    return happinessPriorityMode() !== HappinessPriorityMode.Never;
}

/** Whether a town may be rescued once no city needs it. */
export function townsMayBeRescued() {
    return happinessPriorityMode() === HappinessPriorityMode.AllSettlements;
}

export function setHappinessPriorityMode(value) {
    setting.set(value);
}
