/**
 * A setting the player changes, remembered between sessions.
 *
 * Five modules had grown their own copy of this - factories-first, imports-first, the two
 * gathering switches, the happiness-priority dropdown and treasure auto-return - and the
 * copies were not quite the same. Each had its own `restore`, its own `UI.setOption` call,
 * its own `Configuration.getUser().saveCheckpoint()`, its own `try`/`catch` and its own
 * custom event, and every one of those is a place where the next one written differs from
 * the last by accident.
 *
 * What the callers keep is the part that is actually theirs: the option name, the default,
 * and what the value MEANS. What they hand over is the plumbing.
 *
 * ⚠️ THE OFFSET IS THE WHOLE REASON THIS IS NOT A ONE-LINER, and it has bitten this mod
 * twice. `UI.getOption` answers **0** for an option that was never set, which is
 * indistinguishable from an option deliberately set to 0. With a default of "off" that is
 * harmless; the moment a default becomes "on" - or the moment 0 is a legitimate choice, as
 * it is for the happiness dropdown's "Never" - the two have to be told apart. So nothing
 * here stores a raw value: a switch stores 1 for off and 2 for on, and a choice stores its
 * index plus one. 0 always and only means "the player has never touched this".
 *
 * ⚠️ Written to BOTH `UI.setOption` and the checkpoint. `saveCheckpoint` is what makes the
 * value survive the game being closed; without it the option is remembered for the session
 * and forgotten on exit, which reads to a player as a switch that does not stick.
 *
 * ⚠️ `window.dispatchEvent` from `engine/` is a deliberate exception to the layer rule, and
 * an existing one: `treasure-return-setting.js` lived here and did this before the plumbing
 * was shared. A setting has to be able to announce itself to whatever is drawing it, and
 * the alternative - a second copy of this file in `planner/` for the settings that happen to
 * live there - is how it got to five copies in the first place.
 */
import { log, warn } from '../support/diagnostics.js';

/** Never touched. Not a value; the absence of one. */
const UNSET = 0;
const STORED_OFF = 1;
const STORED_ON = 2;

/** Choices are stored one higher than their value, so that 0 stays free to mean UNSET. */
const CHOICE_OFFSET = 1;

function readRaw(option, label) {
    try {
        return Number(UI.getOption('user', 'Mod', option));
    } catch (error) {
        warn(`could not read the ${label} setting: ${error}`);
        return UNSET;
    }
}

function writeRaw(option, label, stored) {
    try {
        UI.setOption('user', 'Mod', option, stored);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the ${label} setting: ${error}`);
    }
}

function announce(changedEventName) {
    if (!changedEventName) {
        return;
    }
    try {
        window.dispatchEvent(new CustomEvent(changedEventName));
    } catch (error) {
        warn(`could not announce ${changedEventName}: ${error}`);
    }
}

/**
 * An on/off setting.
 *
 * @param option            the full `UI.setOption` key, including the mod id.
 * @param defaultValue      what "never touched" means.
 * @param label             how this reads in the log and in a failure warning.
 * @param changedEventName  dispatched on `window` after a change, or omitted for none.
 *
 * @returns `{ isOn(), set(value) }`. The value is read from the game once, on the first
 *          question asked, and held in memory afterwards - the callers ask this on every
 *          planning pass, and an option read is not free.
 */
export function storedSwitch({ option, defaultValue = true, label, changedEventName = null }) {
    let value = null;

    return {
        isOn() {
            if (value === null) {
                const stored = readRaw(option, label);
                value = stored === STORED_OFF || stored === STORED_ON ? stored === STORED_ON : defaultValue;
            }
            return value;
        },
        set(next) {
            value = !!next;
            writeRaw(option, label, value ? STORED_ON : STORED_OFF);
            announce(changedEventName);
            log(`${label}: ${value ? 'on' : 'off'}`);
        },
    };
}

/**
 * A setting with more than two states.
 *
 * @param values    every value that may be stored; anything else falls back to the default.
 * @param describe  turns a value into words for the log. Optional.
 *
 * @returns `{ get(), set(value) }`.
 */
export function storedChoice({ option, values, defaultValue, label, changedEventName = null, describe = null }) {
    let value = null;

    return {
        get() {
            if (value === null) {
                const stored = readRaw(option, label) - CHOICE_OFFSET;
                value = values.includes(stored) ? stored : defaultValue;
            }
            return value;
        },
        set(next) {
            const chosen = Number(next);
            value = values.includes(chosen) ? chosen : defaultValue;
            writeRaw(option, label, value + CHOICE_OFFSET);
            announce(changedEventName);
            log(`${label}: ${describe ? describe(value) : value}`);
        },
    };
}
