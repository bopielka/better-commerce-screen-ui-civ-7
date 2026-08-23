/**
 * The "factories first" setting: whether factory resources are placed before anything
 * else. On unless the player turns it off.
 *
 * The setting lives here and the checkbox that changes it lives in screen/assign-switches.js.
 * They started as one module, which meant the planner imported a UI widget in order to
 * ask a yes/no question - so nothing in the assignment engine could be reasoned about
 * without the screen, and the automatic path (which runs with the screen closed) pulled
 * in the whole button bar behind it.
 *
 * It persists through the same numeric `UI.setOption` channel the mod's options use: a
 * switch on the screen that forgot itself every time the screen closed would be worse
 * than no switch. The plumbing for that is engine/stored-setting.js, which is also where
 * the note on why "never touched" cannot be stored as 0 now lives.
 *
 * ⚠️ A different option name from the plain 0/1 one an earlier version wrote, so an old
 * value cannot be read as a new one.
 */
import { isFactoryAge } from '../engine/age.js';
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const FactoryFirstChangedEventName = 'najane-commerce-factory-first-changed';

/*
 * Never touched: on. Factory resources are the most valuable thing in the age and they can
 * only go where a factory is, so placing them first is what a player wants by default; the
 * switch is there to turn that off, not to opt into it.
 */
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
