/**
 * Resources pinned where they are, so a bulk rearrangement leaves them alone: this resource, in
 * this settlement, stays. Same unit of locking and same padlock as **Resource+**, deliberately.
 *
 * ⚠️ THESE SURVIVE A RELOAD, unlike Resource+'s: the button they guard is the one you press
 * without looking.
 *
 * ⚠️ And it needs NO key list. Nothing here asks "which pairs are locked" - every question is
 * about a pair already in hand - so the localStorage mirror merchant-orders.js needs is not.
 *
 * ⚠️ Keyed by the game seed. Both halves survive a save: `resourceValue` is the resource's PLOT
 * INDEX and a settlement's component id is game state.
 *
 * ⚠️ In engine/, not screen/, because engine/unassign.js must obey it. The padlock itself is
 * screen/resource-locks-ui.js.
 */
import { onEngineEvent, onLocalPlayerEvent } from './events.js';
import { currentGameKey } from './mod-storage.js';
import { storedSwitch } from './stored-setting.js';
import { log, warn } from '../support/diagnostics.js';

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

// ⚠️ Offset the same way as engine/stored-setting.js: an option never written reads back as 0.
const STORED_UNLOCKED = 1;
const STORED_LOCKED = 2;

/**
 * Whether the padlocks exist at all.
 * ⚠️ Switched off means GONE, not inert: a padlock still drawn but doing nothing is worse than
 * either state.
 */
export function isResourceLockingAllowed() {
    return allowedSetting.isOn();
}

export function setResourceLockingAllowed(value) {
    allowedSetting.set(value);
}

/**
 * ⚠️ Keyed by SETTLEMENT AND RESOURCE together, not by either alone: locking a resource TYPE would
 * pin every copy of it, and locking a settlement would pin whatever happened to be in it.
 */
const locked = new Set();

/**
 * Keys already looked up in storage this session, so each is read from disk at most once.
 * ⚠️ Emptied with `locked` on `GameStarted` (see startResourceLockUpkeep): settlement ids and plot
 * indices are recycled between games.
 */
const known = new Set();

function lockKey(cityID, resourceValue) {
    const city = cityID?.id ?? cityID;
    return `${String(city)}:${String(resourceValue)}`;
}

function optionName(key) {
    return `${MOD_ID}.resourceLock.${currentGameKey()}.${key}`;
}

/**
 * ⚠️ Read through to storage ONCE per key, then answered from memory. This is asked for every
 * padlock on every pass of the injector, and it is also what unassign.js asks about every assigned
 * resource in the empire.
 *
 * ⚠️ NOT remembered before the seed is readable: that "unlocked" would stand for the session.
 */
function readLock(key) {
    if (known.has(key)) {
        return locked.has(key);
    }
    if (currentGameKey() === null) {
        return false;
    }
    known.add(key);
    try {
        if (Number(UI.getOption('user', 'Mod', optionName(key))) === STORED_LOCKED) {
            locked.add(key);
            return true;
        }
    } catch (error) {
        warn(`could not read a resource lock: ${error}`);
    }
    return false;
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
    if (nowLocked) {
        locked.add(key);
    } else {
        locked.delete(key);
    }
    known.add(key);

    if (currentGameKey() !== null) {
        try {
            UI.setOption('user', 'Mod', optionName(key), nowLocked ? STORED_LOCKED : STORED_UNLOCKED);
            Configuration.getUser().saveCheckpoint();
        } catch (error) {
            warn(`could not save a resource lock: ${error}`);
        }
    }

    log(`resource ${resourceValue} in settlement ${cityID?.id ?? cityID}: ${nowLocked ? 'locked' : 'unlocked'}`);
    announce();
    return nowLocked;
}

/** Takes the lock off a placement that no longer exists. */
function clearResourceLock(cityID, resourceValue) {
    const key = lockKey(cityID, resourceValue);
    // ⚠️ Only when it was actually locked. This runs on every unassignment in the game,
    // including the hundreds a "Reassign all" fires, and each write is a saveCheckpoint.
    if (!readLock(key)) {
        return;
    }
    locked.delete(key);
    if (currentGameKey() !== null) {
        try {
            UI.setOption('user', 'Mod', optionName(key), STORED_UNLOCKED);
            Configuration.getUser().saveCheckpoint();
        } catch (error) {
            warn(`could not clear a resource lock: ${error}`);
        }
    }
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
    // ⚠️ `GameStarted` only, not `GameAgeEnded`: a lock toggled while storage was unreadable
    // lives in memory alone and would be lost to a re-read.
    onEngineEvent('GameStarted', () => {
        known.clear();
        locked.clear();
    });
}
