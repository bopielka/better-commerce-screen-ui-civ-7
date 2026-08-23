/**
 * "Imports first": whether resources arrived over a trade route go into cities before your own.
 *
 * OFF by default, unlike factories-first, because it is a bet on one victory condition: towards
 * Economic Victory a slotted resource is worth +1 GDP and an imported one +1 more
 * (`VICTORY_TRACKER_IMPORTED_RESOURCES`) - double. Chasing anything else it just hands your
 * cities whatever the trade network supplies.
 *
 * ⚠️ NOT age-gated, unlike factories-first: imports and their tracker exist in every age.
 */
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const ImportsFirstChangedEventName = 'najane-commerce-imports-first-changed';

// ⚠️ Three-state even though the default is OFF: storing 0 for "off" is the shape that broke
// when factories-first later defaulted to on.
const setting = storedSwitch({
    option: `${MOD_ID}.importsFirstChoice`,
    defaultValue: false,
    label: 'imports first',
    changedEventName: ImportsFirstChangedEventName,
});

export function isImportsFirstEnabled() {
    return setting.isOn();
}

export function setImportsFirstEnabled(value) {
    setting.set(value);
}
