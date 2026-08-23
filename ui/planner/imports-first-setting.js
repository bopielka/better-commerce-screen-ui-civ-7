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
import { storedSwitch } from '../engine/stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

export const ImportsFirstChangedEventName = 'najane-commerce-imports-first-changed';

/*
 * ⚠️ Stored through the three-state channel even though the default is OFF, so "never
 * touched" and "switched off" happen to mean the same thing here and the offset is not
 * strictly needed. Storing 0 for "off" is exactly the shape that broke when factories-first
 * later defaulted to on, and the cost of writing it safely now is nothing.
 */
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
