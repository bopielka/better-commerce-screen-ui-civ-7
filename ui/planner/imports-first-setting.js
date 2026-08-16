/**
 * The "imports first" setting: whether resources that arrived over a trade route from
 * another leader are placed into cities before anything of your own.
 *
 * OFF unless the player turns it on, which is the opposite of factories-first and
 * deliberate. This is a bet on one victory condition: towards the Economic Victory a
 * resource slotted in a city is worth +1 GDP per turn
 * (`VICTORY_TRACKER_SLOTTED_BONUS` / `VICTORY_TRACKER_SLOTTED_CITY`) and an imported one is
 * worth +1 more on top of that (`VICTORY_TRACKER_IMPORTED_RESOURCES`) - double. Chasing any
 * other victory, the same rule just hands your cities whatever the trade network happens to
 * supply instead of what you told them to specialise in.
 *
 * ⚠️ Unlike factories-first this is NOT age-gated. Imported resources exist in every age,
 * and so does the tracker that pays for them.
 *
 * The setting lives here and the checkbox lives in ui/screen/assign-switches.js, for the
 * reason given at the top of factory-first-setting.js: the planner must be able to ask this
 * question with the Commerce screen closed, without importing a widget to do it.
 */
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * Three states, not two, matching factory-first-setting.js.
 *
 * The default here is OFF, so "never touched" and "switched off" happen to mean the same
 * thing and the offset is not strictly needed - but storing 0 for "off" is exactly the
 * shape that broke when factories-first later defaulted to on, and the cost of writing it
 * safely now is one constant.
 */
const OPTION = `${MOD_ID}.importsFirstChoice`;
const STORED_OFF = 1;
const STORED_ON = 2;

export const ImportsFirstChangedEventName = 'najane-commerce-imports-first-changed';

let enabled = null;

function restore() {
    try {
        const stored = Number(UI.getOption('user', 'Mod', OPTION));
        if (stored === STORED_OFF || stored === STORED_ON) {
            return stored === STORED_ON;
        }
    } catch (error) {
        warn(`could not read the imports-first switch: ${error}`);
    }
    return false;
}

export function isImportsFirstEnabled() {
    if (enabled === null) {
        enabled = restore();
    }
    return enabled;
}

export function setImportsFirstEnabled(value) {
    enabled = !!value;
    try {
        UI.setOption('user', 'Mod', OPTION, enabled ? STORED_ON : STORED_OFF);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the imports-first switch: ${error}`);
    }
    window.dispatchEvent(new CustomEvent(ImportsFirstChangedEventName));
    log(`imports first: ${enabled ? 'on' : 'off'}`);
}
