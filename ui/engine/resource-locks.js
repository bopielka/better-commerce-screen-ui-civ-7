/**
 * Resources pinned where they are, so a bulk rearrangement leaves them alone: this resource, in
 * this settlement, stays. Same unit of locking and same padlock as **Resource+**, deliberately.
 *
 * ⚠️ STORED IN THE SAVE (./save-store.js), unlike Resource+'s: the button they guard is the one
 * you press without looking, and a loaded save must hold exactly the locks it was saved with.
 * Both halves of the key are game state: `resourceValue` is the resource's PLOT INDEX, and a
 * settlement's component id.
 *
 * ⚠️ In engine/, not screen/, because engine/unassign.js must obey it. The padlock itself is
 * screen/resource-locks-ui.js; the Options switch is ./resource-lock-setting.js, which is what
 * ui/options/ imports - this module may not be reached from shell scope.
 */
import { onLocalPlayerEvent } from './events.js';
import { isResourceLockingAllowed, ResourceLocksChangedEventName } from './resource-lock-setting.js';
import { savedMap, writeSaved } from './save-store.js';
import { log, warn } from '../support/diagnostics.js';

export {
    isResourceLockingAllowed,
    ResourceLocksChangedEventName,
    setResourceLockingAllowed,
} from './resource-lock-setting.js';

/** The store's name in the save. Entry = 1 while locked; an unlocked pair has no entry. */
const STORE = 'resourceLocks';
const LOCKED = 1;

/**
 * ⚠️ Keyed by SETTLEMENT AND RESOURCE together, not by either alone: locking a resource TYPE would
 * pin every copy of it, and locking a settlement would pin whatever happened to be in it.
 * ⚠️ '.' as the separator: the save store keeps the map as `key=value,...`.
 */
function lockKey(cityID, resourceValue) {
    const city = cityID?.id ?? cityID;
    return `${String(city)}.${String(resourceValue)}`;
}

/** Asked for every padlock on every injector pass and by unassign.js per assigned resource. */
function readLock(key) {
    return savedMap(STORE)?.has(key) ?? false;
}

export function isResourceLocked(cityID, resourceValue) {
    return isResourceLockingAllowed() && readLock(lockKey(cityID, resourceValue));
}

function announce() {
    try {
        window.dispatchEvent(new CustomEvent(ResourceLocksChangedEventName));
    } catch (error) {
        // Nothing here depends on the announcement; the padlock repaints on its own click.
    }
}

/** @returns the new state, so a caller can repaint without asking again. */
export function toggleResourceLock(cityID, resourceValue) {
    const key = lockKey(cityID, resourceValue);
    const nowLocked = !readLock(key);
    if (!writeSaved(STORE, key, nowLocked ? LOCKED : 0)) {
        warn('could not save a resource lock');
        return readLock(key);
    }
    log(`resource ${resourceValue} in settlement ${cityID?.id ?? cityID}: ${nowLocked ? 'locked' : 'unlocked'}`);
    announce();
    return nowLocked;
}

/** Takes the lock off a placement that no longer exists. */
function clearResourceLock(cityID, resourceValue) {
    const key = lockKey(cityID, resourceValue);
    // ⚠️ Only when it was actually locked. This runs on every unassignment in the game,
    // including the hundreds a "Reassign all" fires, and each write reaches the save.
    if (!readLock(key)) {
        return;
    }
    writeSaved(STORE, key, 0);
    log(`lock dropped: resource ${resourceValue} left settlement ${cityID?.id ?? cityID}`);
    announce();
}

let upkeepStarted = false;

/**
 * Watches for resources leaving settlements, so their locks go with them.
 * ⚠️ From the entry point rather than at import: this module is also imported by the options
 * screen, which loads in SHELL scope where there is no game and no engine events.
 */
export function startResourceLockUpkeep() {
    if (upkeepStarted) {
        return;
    }
    upkeepStarted = true;
    // ⚠️ The same "is it mine" test this used to make by hand, except it is now made once for all
    // four listeners on this name.
    onLocalPlayerEvent('ResourceUnassigned', (data) => {
        // ⚠️ `targetCity` is the settlement it LEFT - the same field the game's own model reads.
        const city = data?.targetCity;
        const location = data?.location;
        if (!city || !location) {
            return;
        }
        clearResourceLock(city, GameplayMap.getIndexFromLocation(location));
    });
}
