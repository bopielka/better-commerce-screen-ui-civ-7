/**
 * Resources pinned where they are, so a bulk rearrangement leaves them alone.
 *
 * "Unassign all" and "Reassign all" empty the whole empire before doing anything else, which
 * is what makes them useful and is also the one thing you cannot ask them to do halfway.
 * There is usually a handful of placements that were not the planner's idea and are not up
 * for debate - the Camels holding a settlement's slots open, the resource put somewhere for
 * an adjacency the planner cannot see - and without a way to say so the choice is between
 * rebuilding those by hand every time and never using the buttons at all.
 *
 * A lock says: this resource, in this settlement, stays. Everything else is fair game.
 *
 * The mechanism is the one **Resource+** arrived at (`br4d-resource-lock`), deliberately - a
 * player who has used one mod should not have to learn a second idea. Same unit of locking
 * (a resource in a settlement, not a resource type and not a settlement), same padlock in the
 * corner of the tile, same rule that the bulk clear may only be used on a settlement holding
 * nothing locked.
 *
 * ⚠️ THESE SURVIVE A RELOAD, which is where this parts company with Resource+ - a lock that
 * quietly evaporated when the save was loaded again would be worse than no lock, because the
 * button it guards against is the one you press without looking.
 *
 * ⚠️ And it needs NO key list to do it, which is the whole reason this is short.
 * `UI.setOption` takes a number and cannot be enumerated, so merchant-orders.js carries a
 * `localStorage` mirror purely to be able to list its keys again - it has to find orders
 * belonging to units that no longer exist. Nothing here ever asks "which pairs are locked":
 * every question is about a pair already in hand, so each is a direct lookup by name and the
 * mirror is not needed. See `isResourceLocked`.
 *
 * ⚠️ Keyed by the game's seed, like every other per-game thing this mod stores: a settlement
 * id means a different settlement in the next campaign. Both halves of the key survive a
 * save - `resourceValue` is the resource's PLOT INDEX (see `assignArgs` in operations.js) and
 * a settlement's component id is part of the game state.
 *
 * ⚠️ In `engine/`, not `screen/`, because `engine/unassign.js` is what has to obey it and
 * engine may only import `support` (see 02-architecture.md). The padlock itself lives in
 * screen/resource-locks-ui.js.
 */
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/**
 * ⚠️ Three states, not two - the same reasoning as factory-first-setting.js. The default is
 * ON, so "never touched" and "switched off" have to be told apart, and an option that was
 * never set reads back as 0.
 */
const ALLOWED_OPTION = `${MOD_ID}.resourceLockingAllowed`;
const STORED_OFF = 1;
const STORED_ON = 2;

/**
 * ⚠️ Offset the same way, and for the same reason: an option that was never written reads
 * back as 0, so "unlocked" cannot be 0 or it would be indistinguishable from "never asked".
 */
const STORED_UNLOCKED = 1;
const STORED_LOCKED = 2;

let allowed = null;

/**
 * Whether the padlocks exist at all.
 *
 * ⚠️ Read by BOTH sides and enforced in this module rather than at each call site. Switched
 * off it has to mean two things at once - no padlock to click, and no lock having any effect
 * on a bulk clear - and the second is the one that would be quietly forgotten if every caller
 * had to remember it. `isResourceLocked` below answers "no" outright while this is off, so
 * `unassign.js` needs no knowledge of the option whatsoever.
 *
 * The locks themselves are NOT discarded when it is switched off: turning the option back on
 * during the same session restores what was pinned, rather than silently losing it.
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

/**
 * Raised whenever a lock is added or removed, so anything drawing one can repaint without
 * polling. The padlock repaints itself on click; this is for everything else.
 */
export const ResourceLocksChangedEventName = 'najane-commerce-resource-locks-changed';

/**
 * ⚠️ Keyed by SETTLEMENT AND RESOURCE together, not by either alone.
 *
 * The same resource type appears many times over an empire and the player means one of them;
 * a whole settlement is too coarse to be useful, since the case this exists for is usually
 * one placement in a settlement whose other slots should still be rebuilt. `resourceValue` is
 * the resource's own identity in the pool - the same value `canAssign` and the model's
 * `slottedResources` use - so a locked resource that is somehow moved anyway is no longer
 * matched, which is the right way round: the lock protects a placement, not a resource.
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
 * ⚠️ Read through to storage ONCE per key, then answered from memory.
 *
 * This is asked for every padlock on every pass of the injector's `MutationObserver`, which
 * is far too often to be touching the options store - and it is also the call `unassign.js`
 * makes about every assigned resource in the empire. The first question about a pair reaches
 * storage; every later one does not.
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

/**
 * Takes the lock off a placement that no longer exists.
 *
 * ⚠️ A lock protects a RESOURCE IN A SETTLEMENT, so once the resource leaves that settlement
 * there is nothing left for it to protect and it has to go. Kept, it would lie in wait: put
 * the resource back into the same settlement later and it would arrive already pinned,
 * without the padlock ever having been clicked - and the player would find "Unassign all"
 * skipping something they never asked it to skip.
 */
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
 *
 * ⚠️ Started from the entry point rather than at import. This module is also imported by the
 * options screen, which loads in SHELL scope where there is no game and no engine events to
 * subscribe to.
 */
export function startResourceLockUpkeep() {
    if (upkeepStarted) {
        return;
    }
    upkeepStarted = true;
    try {
        engine.on('ResourceUnassigned', (data) => {
            if (data?.player !== undefined && data.player !== GameContext.localPlayerID) {
                return;
            }
            /*
             * ⚠️ `targetCity` is the settlement it LEFT - the same field the game's own model
             * reads to find the card to take it off. The plot index is the resource's identity
             * here, exactly as it is in the lock key.
             */
            const city = data?.targetCity;
            const location = data?.location;
            if (!city || !location) {
                return;
            }
            clearResourceLock(city, GameplayMap.getIndexFromLocation(location));
        });
    } catch (error) {
        warn(`could not watch for unassigned resources: ${error}`);
    }
}
