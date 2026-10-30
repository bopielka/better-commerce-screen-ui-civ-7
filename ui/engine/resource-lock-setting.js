/**
 * Whether the resource padlocks exist at all - the Options switch, split from the locks.
 *
 * ⚠️ In its own module because ui/options/ loads in SHELL scope: a settings module it imports may
 * reach no further than stored-setting.js, and ./resource-locks.js opens the save
 * (./save-store.js), which does not exist in the main menu.
 */
import { storedSwitch } from './stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * Raised when a lock changes, so anything drawing one repaints without a DOM mutation.
 * ⚠️ Declared above `allowedSetting`, which is handed it at module evaluation.
 */
export const ResourceLocksChangedEventName = 'najane-commerce-resource-locks-changed';

// ⚠️ The option name is the compatibility surface: players' stored choices live under it.
const allowedSetting = storedSwitch({
    option: `${MOD_ID}.resourceLockingAllowed`,
    defaultValue: true,
    label: 'resource locking allowed',
    changedEventName: ResourceLocksChangedEventName,
});

/**
 * ⚠️ Switched off means GONE, not inert: a padlock still drawn but doing nothing is worse than
 * either state.
 */
export function isResourceLockingAllowed() {
    return allowedSetting.isOn();
}

export function setResourceLockingAllowed(value) {
    allowedSetting.set(value);
}
