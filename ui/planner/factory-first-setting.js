/**
 * The "factories first" setting: whether factory resources are placed before anything
 * else. On unless the player turns it off.
 *
 * The setting lives here and the checkbox that changes it lives in screen/factory-first.js.
 * They started as one module, which meant the planner imported a UI widget in order to
 * ask a yes/no question - so nothing in the assignment engine could be reasoned about
 * without the screen, and the automatic path (which runs with the screen closed) pulled
 * in the whole button bar behind it.
 *
 * It persists through the same numeric `UI.setOption` channel the mod's options use: a
 * switch on the screen that forgot itself every time the screen closed would be worse
 * than no switch.
 */
import { isFactoryAge } from '../engine/age.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Three states, not two, and NOT the plain 0/1 an earlier version stored.
 *
 * An option that was never set reads back as 0, exactly like an option deliberately set
 * to zero - the same trap priority-store.js works around. With the default being "off"
 * that did not matter; now that it is "on", "never touched" and "switched off" have to be
 * told apart, so the stored value is offset by one and 0 means untouched.
 *
 * A different option name from the 0/1 one, so an old value cannot be read as a new one.
 */
const OPTION = `${MOD_ID}.factoryFirstChoice`;
const STORED_OFF = 1;
const STORED_ON = 2;

export const FactoryFirstChangedEventName = 'najane-commerce-factory-first-changed';

let enabled = null;

function restore() {
    try {
        const stored = Number(UI.getOption('user', 'Mod', OPTION));
        if (stored === STORED_OFF || stored === STORED_ON) {
            return stored === STORED_ON;
        }
    } catch (error) {
        warn(`could not read the factories-first switch: ${error}`);
    }
    // Never touched: on. Factory resources are the most valuable thing in the age and
    // they can only go where a factory is, so placing them first is what a player wants
    // by default; the switch is there to turn that off, not to opt into it.
    return true;
}

export function isFactoryFirstEnabled() {
    if (enabled === null) {
        enabled = restore();
    }
    return enabled && isFactoryAge();
}

export function setFactoryFirstEnabled(value) {
    enabled = !!value;
    try {
        UI.setOption('user', 'Mod', OPTION, enabled ? STORED_ON : STORED_OFF);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the factories-first switch: ${error}`);
    }
    window.dispatchEvent(new CustomEvent(FactoryFirstChangedEventName));
    log(`factories first: ${enabled ? 'on' : 'off'}`);
}
