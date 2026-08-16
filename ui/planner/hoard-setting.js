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
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Three states each, not two: 0 means "never touched" and both default to ON, so
 * "untouched" and "switched off" have to be distinguishable. Same trap as
 * factory-first-setting.js.
 */
const STORED_OFF = 1;
const STORED_ON = 2;

const CULTURE_OPTION = `${MOD_ID}.gatherCulture`;
const GOLD_OPTION = `${MOD_ID}.gatherGold`;

export const HoardSettingChangedEventName = 'najane-commerce-hoard-changed';

let culture = null;
let gold = null;

function restore(option) {
    try {
        const stored = Number(UI.getOption('user', 'Mod', option));
        if (stored === STORED_OFF || stored === STORED_ON) {
            return stored === STORED_ON;
        }
    } catch (error) {
        warn(`could not read ${option}: ${error}`);
    }
    // Never touched: on. Concentrating these yields is worth more than spreading them, and
    // the switch is there to decline that, not to opt into it.
    return true;
}

function persist(option, value) {
    try {
        UI.setOption('user', 'Mod', option, value ? STORED_ON : STORED_OFF);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save ${option}: ${error}`);
    }
    window.dispatchEvent(new CustomEvent(HoardSettingChangedEventName));
}

export function isCultureGatheringEnabled() {
    if (culture === null) {
        culture = restore(CULTURE_OPTION);
    }
    return culture;
}

export function isGoldGatheringEnabled() {
    if (gold === null) {
        gold = restore(GOLD_OPTION);
    }
    return gold;
}

export function setCultureGatheringEnabled(value) {
    culture = !!value;
    persist(CULTURE_OPTION, culture);
    log(`gather culture into one settlement: ${culture ? 'on' : 'off'}`);
}

export function setGoldGatheringEnabled(value) {
    gold = !!value;
    persist(GOLD_OPTION, gold);
    log(`gather gold into one settlement: ${gold ? 'on' : 'off'}`);
}
