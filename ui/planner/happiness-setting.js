/**
 * How hard the planner works to keep settlements out of negative happiness.
 *
 * The rescue tier sits above every other consideration in scoring.js, so it is the largest
 * single thing this mod does to a layout - hence a setting. Here rather than in ui/options/ so
 * the engine can ask it with the Commerce screen closed; the dropdown writes to this module.
 */
import { storedChoice } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Append only, and NOT what gets stored - a choice is stored one higher; see
 * engine/stored-setting.js. "Never" is 0, which is what `UI.getOption` answers for unset.
 */
export const HappinessPriorityMode = {
    Never: 0,
    CitiesOnly: 1,
    AllSettlements: 2,
};

export const HappinessPriorityChangedEventName = 'najane-commerce-happiness-priority-changed';

const MODES = [HappinessPriorityMode.Never, HappinessPriorityMode.CitiesOnly, HappinessPriorityMode.AllSettlements];
const MODE_NAMES = ['never', 'cities only', 'all settlements'];

// Never touched: rescue everything. An empire in revolt is worth overriding the player for.
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
