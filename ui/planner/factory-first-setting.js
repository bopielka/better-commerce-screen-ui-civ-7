/**
 * "Factories first": whether factory resources are placed before anything else. On by default.
 *
 * Split from its checkbox in screen/assign-switches.js so the planner can ask a yes/no question
 * without importing a UI widget - the automatic path runs with the screen closed.
 *
 * ⚠️ A different option name from the plain 0/1 one an earlier version wrote, so an old value
 * cannot be read as a new one. See engine/stored-setting.js for the zero trap.
 */
import { isFactoryAge } from '../engine/age.js';
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const FactoryFirstChangedEventName = 'najane-commerce-factory-first-changed';

// Never touched: on. The switch is there to turn that off, not to opt into it.
const setting = storedSwitch({
    option: `${MOD_ID}.factoryFirstChoice`,
    defaultValue: true,
    label: 'factories first',
    changedEventName: FactoryFirstChangedEventName,
});

/** ⚠️ Age-gated as well as switched: there are no factories before the Modern age. */
export function isFactoryFirstEnabled() {
    return setting.isOn() && isFactoryAge();
}

export function setFactoryFirstEnabled(value) {
    setting.set(value);
}
