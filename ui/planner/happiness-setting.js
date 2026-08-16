/**
 * How hard the planner works to keep settlements out of negative happiness.
 *
 * The rescue tier sits above every other consideration in scoring.js - above factories,
 * above camels, above a settlement's own priority - so it is the single largest thing this
 * mod does to a layout, and until now the player had no say in it. Some players want an
 * unhappy town left alone; some do not want the rule at all.
 *
 * The value lives here rather than in ui/options/ for the same reason factory-first's does:
 * the assignment engine has to be able to ask the question with the Commerce screen closed
 * and without importing anything that pulls in the options screen. The dropdown in
 * ui/options/najane-commerce-options.js writes to this module.
 */
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Append only, and note that these are NOT what gets stored - see below.
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

/**
 * ⚠️ Stored offset by one, because an option that was never set reads back as 0 - exactly
 * like an option deliberately set to 0, which here would be "Never". The default is
 * AllSettlements, so the two have to be told apart. Same trap, same fix, as
 * factory-first-setting.js and priority-store.js.
 */
const OPTION = `${MOD_ID}.happinessPriorityMode`;
const STORED_OFFSET = 1;

export const HappinessPriorityChangedEventName = 'najane-commerce-happiness-priority-changed';

const MODES = [HappinessPriorityMode.Never, HappinessPriorityMode.CitiesOnly, HappinessPriorityMode.AllSettlements];

let mode = null;

function restore() {
    try {
        const stored = Number(UI.getOption('user', 'Mod', OPTION)) - STORED_OFFSET;
        if (MODES.includes(stored)) {
            return stored;
        }
    } catch (error) {
        warn(`could not read the happiness-priority setting: ${error}`);
    }
    // Never touched: rescue everything. An empire in revolt is the one situation where
    // overriding what the player asked each settlement for is worth it, so that stays the
    // default; the setting is there to opt out of it.
    return HappinessPriorityMode.AllSettlements;
}

export function happinessPriorityMode() {
    if (mode === null) {
        mode = restore();
    }
    return mode;
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
    const next = Number(value);
    mode = MODES.includes(next) ? next : HappinessPriorityMode.AllSettlements;
    try {
        UI.setOption('user', 'Mod', OPTION, mode + STORED_OFFSET);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the happiness-priority setting: ${error}`);
    }
    window.dispatchEvent(new CustomEvent(HappinessPriorityChangedEventName));
    log(`happiness priority: ${['never', 'cities only', 'all settlements'][mode]}`);
}
