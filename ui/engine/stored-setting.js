/**
 * A setting the player changes, remembered between sessions. Callers keep the option name, the
 * default and what the value MEANS; the plumbing is here.
 *
 * ⚠️ THE OFFSET IS THE WHOLE REASON THIS IS NOT A ONE-LINER, and it has bitten this mod twice.
 * `UI.getOption` answers 0 for an option that was never set, which is indistinguishable from one
 * deliberately set to 0 - harmless while every default is "off", fatal the moment a default is
 * "on" or 0 is a legitimate choice (the happiness dropdown's "Never"). So nothing here stores a
 * raw value: a switch stores 1 for off and 2 for on, a choice its index plus one.
 *
 * ⚠️ `UI.setOption('user', 'Mod', ...)` DOES NOT REACH THE DISK: on 2026-09-30 no key of this mod
 * was in UserOptions.txt or anywhere else in the profile, while the `modSettings` mirror was in
 * LocalStorage.sqlite. With no mirror, every switch here fell back to its default on each start
 * (player report: happiness priority and both gathering switches). The mirror is what persists;
 * the option is still written and read first, in case a game version starts keeping it.
 *
 * ⚠️ `window.dispatchEvent` from engine/ is a deliberate exception to the layer rule: a setting has
 * to be able to announce itself to whatever is drawing it.
 */
import { readSection, writeSection } from './mod-storage.js';
import { log, warn } from '../support/diagnostics.js';

/** ⚠️ A section of the SHARED `modSettings` key - see ./mod-storage.js for why. */
const SECTION = 'settings';

/** Never touched. Not a value; the absence of one. */
const UNSET = 0;
const STORED_OFF = 1;
const STORED_ON = 2;

/** Choices are stored one higher than their value, so that 0 stays free to mean UNSET. */
const CHOICE_OFFSET = 1;

/** ⚠️ Asked once per setting per session - the callers memoise - so the JSON parse is not hot. */
function readRaw(option, label) {
    let fromOption = UNSET;
    try {
        fromOption = Number(UI.getOption('user', 'Mod', option)) || UNSET;
    } catch (error) {
        warn(`could not read the ${label} setting: ${error}`);
    }
    const fromMirror = Number(readSection(SECTION)[option]) || UNSET;
    return fromOption !== UNSET ? fromOption : fromMirror;
}

function writeRaw(option, label, stored) {
    try {
        UI.setOption('user', 'Mod', option, stored);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the ${label} setting: ${error}`);
    }
    writeSection(SECTION, (settings) => {
        settings[option] = stored;
    });
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
 * An on/off setting. @returns `{ isOn(), set(value) }` - the value is read from the game once, on
 * the first question asked, because the callers ask on every planning pass.
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

/** A setting with more than two states. @returns `{ get(), set(value) }`. */
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
