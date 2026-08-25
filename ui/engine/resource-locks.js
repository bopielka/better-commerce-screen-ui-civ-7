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
import { onLocalPlayerEvent } from './events.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

// ⚠️ Three states, not two - same zero trap as factory-first-setting.js. The default is on.
const ALLOWED_OPTION = `${MOD_ID}.resourceLockingAllowed`;
const STORED_OFF = 1;
const STORED_ON = 2;

// ⚠️ Offset the same way: an option never written reads back as 0.
const STORED_UNLOCKED = 1;
const STORED_LOCKED = 2;

let allowed = null;

/**
 * Whether the padlocks exist at all.
 * ⚠️ Switched off means GONE, not inert: a padlock still drawn but doing nothing is worse than
 * either state.
 */
export function isResourceLockingAllowed() {
    if (allowed === null) {
        try {
            const stored = Number(UI.getOption('user', 'Mod', ALLOWED_OPTION));
            allowed = stored === STORED_OFF ? false : true;
        } catch (error) {
            warn(`could not read the resource-locking option: ${error}`);
            allowed = true;
        }
    }
    return allowed;
}

export function setResourceLockingAllowed(value) {
    allowed = !!value;
    try {
        UI.setOption('user', 'Mod', ALLOWED_OPTION, allowed ? STORED_ON : STORED_OFF);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the resource-locking option: ${error}`);
    }
    log(`resource locking: ${allowed ? 'allowed' : 'off'}`);
    announce();
}

/** Raised when a lock changes, so anything drawing one repaints without a DOM mutation. */
export const ResourceLocksChangedEventName = 'najane-commerce-resource-locks-changed';

/**
 * ⚠️ Keyed by SETTLEMENT AND RESOURCE together, not by either alone: locking a resource TYPE would
 * pin every copy of it, and locking a settlement would pin whatever happened to be in it.
 */
const locked = new Set();

/** Keys already looked up in storage this session, so each is read from disk at most once. */
const known = new Set();

let gameKey = null;

function currentGameKey() {
    if (gameKey !== null) {
        return gameKey;
    }
    try {
        const seed = Configuration.getGame()?.gameSeed;
        gameKey = seed === undefined || seed === null ? null : String(seed);
    } catch (error) {
        gameKey = null;
    }
    return gameKey;
}

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
 */
function readLock(key) {
    if (known.has(key)) {
        return locked.has(key);
    }
    known.add(key);
    if (currentGameKey() === null) {
        return false;
    }
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
export function clearResourceLock(cityID, resourceValue) {
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
}
