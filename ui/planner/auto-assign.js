/**
 * Assigning newly acquired resources by itself, with the Commerce screen closed. Off by default;
 * how far it goes is one four-step setting in ui/options/najane-commerce-options.js.
 *
 * ⚠️ Decides WHEN and nothing else - the work goes through run.js, the same entry points the
 * buttons use, so there is ONE "is a pass running" flag. Two flags meant an automatic pass could
 * start while Reassign All was halfway through emptying the empire.
 *
 * ⚠️ Only NEW resources are touched: what the player left unassigned they left on purpose. `known`
 * is seeded as soon as the game can answer, NOT on the first event - that swallowed it.
 *
 * ⚠️ There is no "resource acquired" event, so cheap ones are watched and each asks whether the
 * resource set grew or the empire gained room. The sweep behind them is the safety net; the event
 * list was wrong three times running and every gap looks identical to the player.
 *
 * ⚠️ A trigger that cannot be acted on yet is HELD, not dropped. Closing the screen raises no
 * engine event, so it asks again; returning early was the likeliest cause of "it does nothing".
 *
 * ⚠️ Triggers fire BEFORE the resource is in your hands - `ConstructibleBuildCompleted` means the
 * improvement finished. Hence the late-arrival retries.
 */
import { assignAll, isAssignmentInProgress, reassignAll } from './run.js';
import { isAssignableToSettlement } from './facts.js';
import { forgetPriorityMemory } from './priorities.js';
import { getCommerceModel } from '../model/screen-model.js';
import { onEngineEvent, onLocalPlayerEvent, stopEngineEvents } from '../engine/events.js';
import { heldResourceType } from '../engine/resource-types.js';

import CommerceOptions, {
    AutoAssignMode,
    CommerceOptionsChangedEventName,
} from '../options/najane-commerce-options.js';
import { log, warn } from '../support/diagnostics.js';

/**
 * Raised for EVERY player, several times a turn each, and there are hundreds in a late game.
 * They carry a `location`, so the plot is asked who owns it - the check
 * `panel-production-chooser.ts` makes on `ConstructibleAddedToMap`.
 *
 * ⚠️ The rest of the list below is deliberately NOT filtered. `CityTransfered` settles it: a
 * settlement changing hands is exactly when the owner on the payload is the ambiguous part, and
 * they are rare enough that leaving them alone is free.
 */
const PER_PLAYER_TRIGGER_EVENTS = [
    'ConstructibleBuildCompleted', // a tile improved onto a resource - or a building with slots
    /*
     * ⚠️ Not enough on its own: it announces something the PLAYER built. A resource can also
     * appear because the tile was improved by a Settler or handed over with a captured city.
     */
    'ConstructibleAddedToMap',
    'ConstructibleChanged',
];

const TRIGGER_EVENTS = [
    'TradeRouteAddedToMap', // a new route brings its payload
    'TradeRouteChanged',
    'ResourceCapChanged',
    'WonderCompleted', // the Colossus and friends carry resource slots
    'CityTransfered', // a settlement changing hands brings its resources with it
    'ConqueredSettlementIntegrated',
    'CityAddedToMap',
    'PlayerSettlementCapChanged',
    'LocalPlayerTurnBegin', // catch-all
];

/** Events arrive in bursts; one pass per burst is enough. */
const DEBOUNCE_MS = 400;

/** Covers the gap between "the improvement finished" and "the resource is in your hands". */
const LATE_ARRIVAL_DELAYS_MS = [600, 1500, 3000];

/** How long to keep trying to read the player's resources after the UI loads. */
const SEED_RETRY_MS = 1000;
const SEED_ATTEMPTS = 30;

/** How often to look again while something is in the way. One set comparison, only while
 *  blocked; see the ⚠️ on holding triggers at the top of the file. */
const BLOCKED_RETRY_MS = 1500;

/**
 * The safety net: look again every so often, whatever did or did not fire.
 * ⚠️ Added after the THIRD missing event. Costs one walk over the resources and one over the
 * cities, no `canStart` calls.
 */
const SWEEP_MS = 15000;

let known = null;
let knownCapacity = null;
let running = false;

/**
 * Whether a pass is in flight or about to be; the icon filter reads it to hide the icon before it
 * is drawn. ⚠️ `lastTriggerAt` exists because of event ORDER - the notification and these triggers
 * arrive in one burst and nothing promises which lands first.
 */
const TRIGGER_GRACE_MS = 1500;

export function isAutoAssignRunning() {
    return running;
}

export function isAutoAssignPending() {
    if (CommerceOptions.autoAssignMode === AutoAssignMode.Off) {
        return false;
    }
    // `blockedTimer` counts too: a pass that is waiting for the screen to close is still a
    // pass that is coming, and the icon should not claim otherwise in the meantime.
    return (
        running ||
        scheduled !== null ||
        blockedTimer !== null ||
        Date.now() - lastTriggerAt < TRIGGER_GRACE_MS
    );
}
let scheduled = null;
let attached = false;
let lastTriggerAt = 0;

/**
 * The resources the player owns that this module could act on.
 * ⚠️ Empire and treasure resources are left out: they never go into a settlement, so one arriving
 * produced a pass that placed nothing - and an arrival is only forgotten after something lands,
 * so it was retried forever.
 */
function currentResourceValues() {
    const player = Players.get(GameContext.localPlayerID);
    const values = new Set();
    for (const resource of player?.Resources?.getResources() ?? []) {
        const resourceType = heldResourceType(resource);
        if (!isAssignableToSettlement({ resourceType, resourceValue: resource.value })) {
            continue;
        }
        values.add(resource.value);
    }
    return values;
}

/**
 * Total capacity and how much of it is filled - the cheap half of "is there anywhere to put
 * something now that there was not before". One walk over the cities for both.
 */
function readBoardCounts() {
    let capacity = 0;
    let assigned = 0;
    for (const city of Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? []) {
        capacity += city.Resources?.getAssignedResourcesCap() ?? 0;
        assigned += city.Resources?.getAssignedResources()?.length ?? 0;
    }
    return { capacity, assigned };
}

/**
 * ⚠️ `options` is carried whole, not destructured into three names: `retryWhenUnblocked` hands
 * these straight back, and it was passing a bare `options` this function never declared - a
 * ReferenceError from a timer, so the BLOCKED_RETRY_MS mechanism never ran at all.
 */
async function check(trigger, options = {}) {
    const { isRetry = false, quiet = false, isSweep = false } = options;
    if (running) {
        // Our own pass is in flight. Whatever raised this may be news it has not seen, so
        // ask again once it is done rather than dropping it.
        retryWhenUnblocked(trigger, options, `${trigger}: a pass is already in flight, waiting`);
        return;
    }
    const mode = CommerceOptions.autoAssignMode;
    if (mode === AutoAssignMode.Off) {
        log(`${trigger}: automatic assignment is switched off (Options -> Mods)`);
        return;
    }
    // ⚠️ Blocked, not cancelled. Both used to `return` and the trigger was gone for good.
    if (getCommerceModel()) {
        retryWhenUnblocked(trigger, options, `${trigger}: the Commerce screen is open, waiting`);
        return;
    }
    if (isAssignmentInProgress()) {
        retryWhenUnblocked(trigger, options, `${trigger}: an assignment is already running, waiting`);
        return;
    }

    // Past every guard, so whatever we were waiting for has cleared.
    blockedLogged = false;

    running = true;
    try {
        const current = currentResourceValues();
        const { capacity, assigned } = readBoardCounts();
        if (known === null) {
            // Seeding should have happened long before this; if it somehow did not, do it
            // now rather than treat every resource the player owns as newly acquired.
            known = current;
            knownCapacity = capacity;
            warn(`${trigger}: arrived before the resource list was ready, seeding now`);
            return;
        }

        const fresh = new Set();
        for (const value of current) {
            if (!known.has(value)) {
                fresh.add(value);
            }
        }
        const roomGrew = knownCapacity !== null && capacity > knownCapacity;
        knownCapacity = capacity;

        /*
         * ⚠️ New room is a reason to run, but NOT in "the new resource only": a Marketplace hands
         * you nothing, so in that mode the pool holds resources the player left there on purpose.
         */
        const actOnRoom = roomGrew && mode !== AutoAssignMode.NewOnly;

        /*
         * ⚠️ EVERY mode waits for something to happen; the modes differ in SCOPE, not in when they
         * run. "Place everything unassigned" briefly meant "any time anything is in the pool",
         * which emptied the pool on load and again every fifteen seconds - overriding the one
         * principle this module is built on.
         */
        if (fresh.size === 0 && !actOnRoom) {
            if (!quiet) {
                log(
                    `${trigger}: nothing to do (${current.size} resources owned, ` +
                        `${assigned} assigned, ${capacity} slots)`,
                );
            }
            // ⚠️ `known` is deliberately NOT updated: it already equals `current`, and leaving it
            // keeps the retries comparing against the same baseline. Only a real trigger arms
            // them - a retry arming retries never stops - and not the sweep either.
            if (!isRetry && !isSweep) {
                scheduleLateArrivalChecks(trigger, quiet);
            }
            return;
        }
        clearLateArrivalChecks();

        const why =
            fresh.size > 0 ? `${fresh.size} newly acquired resource(s)` : 'more room for resources';

        if (mode === AutoAssignMode.RebuildEverything) {
            log(`${trigger}: ${why} - rebuilding the whole empire`);
            known = current;
            await reassignAll(null, { label: 'auto reassign' });
            return;
        }

        const everything = mode === AutoAssignMode.EverythingUnassigned;
        log(`${trigger}: ${why}` + (everything ? ' - placing everything unassigned' : ''));
        const placed = await assignAll(null, {
            scope: everything ? null : fresh,
            label: 'auto assign',
        });

        /*
         * ⚠️ Only now, and only if something landed. Updating before the work meant a pass that
         * placed nothing still swallowed the arrival. `assignAll` answers how many landed, or
         * `false` if it refused to start - `> 0` is false for both, which is the point.
         */
        if (placed > 0) {
            known = current;
        } else {
            log(`${trigger}: nothing was placed, leaving the arrival for the next pass`);
        }
    } catch (error) {
        warn(`auto-assign pass failed: ${error}`);
    } finally {
        running = false;
    }
}

let pendingTrigger = '';
let pendingQuiet = false;
let pendingSweep = false;
let lateArrivalTimers = [];
let blockedTimer = null;
let blockedLogged = false;

/**
 * Asks again shortly, because something was in the way rather than because nothing was found.
 * ⚠️ Logged once per WAIT, not per retry: the timer is null again by the time the retry runs.
 */
function retryWhenUnblocked(trigger, options, message) {
    if (blockedTimer !== null) {
        return;
    }
    if (!blockedLogged) {
        blockedLogged = true;
        log(message);
    }
    blockedTimer = setTimeout(() => {
        blockedTimer = null;
        check(trigger, options);
    }, BLOCKED_RETRY_MS);
}

function clearBlockedRetry() {
    if (blockedTimer !== null) {
        clearTimeout(blockedTimer);
        blockedTimer = null;
    }
    blockedLogged = false;
}

/**
 * Looks again shortly after a trigger that found nothing. Not a poll: a fixed handful, cancelled
 * the moment anything is found or the next real trigger arrives.
 */
function scheduleLateArrivalChecks(trigger, quiet) {
    clearLateArrivalChecks();
    lateArrivalTimers = LATE_ARRIVAL_DELAYS_MS.map((delay) =>
        setTimeout(() => check(`${trigger} (+${delay}ms)`, { isRetry: true, quiet }), delay),
    );
}

function clearLateArrivalChecks() {
    for (const timer of lateArrivalTimers) {
        clearTimeout(timer);
    }
    lateArrivalTimers = [];
}

function scheduleCheck(trigger, quiet = false, isSweep = false) {
    // ⚠️ The watchers are detached while the setting is Off, so normally nothing reaches this.
    // What still can is the sweep's own timer, between the player switching it off and
    // `detachWatchers` running.
    if (CommerceOptions.autoAssignMode === AutoAssignMode.Off) {
        return;
    }
    clearLateArrivalChecks();
    // A real trigger supersedes whatever we were waiting to retry.
    clearBlockedRetry();
    lastTriggerAt = Date.now();
    pendingTrigger = trigger;
    if (scheduled !== null) {
        // ⚠️ Merging into a window that is already open, so a LOUD trigger wins: a sweep
        // landing on top of a real event must not silence that event's report - and a real
        // event landing on top of a sweep keeps its late-arrival retries.
        pendingQuiet = pendingQuiet && quiet;
        pendingSweep = pendingSweep && isSweep;
        return;
    }
    pendingQuiet = quiet;
    pendingSweep = isSweep;
    scheduled = setTimeout(() => {
        scheduled = null;
        check(pendingTrigger, { quiet: pendingQuiet, isSweep: pendingSweep });
    }, DEBOUNCE_MS);
}

/** @returns true once the player exists and its resources can be read. */
function trySeed() {
    if (known !== null) {
        return true;
    }
    const player = Players.get(GameContext.localPlayerID);
    if (!player?.Resources) {
        return false;
    }
    known = currentResourceValues();
    knownCapacity = readBoardCounts().capacity;
    log(`remembering ${known.size} resources already owned and ${knownCapacity} slots`);
    return true;
}

function seedWithRetries(attemptsLeft) {
    if (trySeed() || attemptsLeft <= 0) {
        /*
         * ⚠️ THE MODE IS READ HERE, NOT AT LOAD. `CommerceOptions.autoAssignMode` memoises what
         * `UI.getOption` gives it, so reading before the game can answer caches Off for the whole
         * session - and that now decides whether the watcher is installed at all. This retry loop
         * already waits for the game to be readable.
         */
        applyAutoAssignMode();
        if (known === null) {
            warn('gave up waiting for the resource list; the first event will seed instead');
            return;
        }
        /*
         * One quiet look once the game is readable. Seeding has just recorded everything the
         * player owns, so nothing counts as newly acquired and this finds nothing to do -
         * which is the point: LOADING A SAVE IS NOT AN EVENT. Nothing happened in the game,
         * and a pool the player left full is a pool they left full. It stays here only to
         * catch a capacity reading that changed between seeding and now.
         */
        scheduleCheck('game loaded', true);
        return;
    }
    setTimeout(() => seedWithRetries(attemptsLeft - 1), SEED_RETRY_MS);
}

let subscriptions = [];
let sweepTimer = null;

/**
 * ⚠️ NOTHING IS LISTENED FOR WHILE THE SETTING IS OFF, AND OFF IS THE DEFAULT. This used to
 * attach unconditionally and answer "switched off" inside `check` - after a dozen subscriptions
 * had each woken a debounce and the sweep had fired all game. Attaching on the option instead is
 * exact rather than merely cheaper: there is no path from an engine event into this module.
 */
function attachWatchers() {
    if (subscriptions.length > 0 || sweepTimer !== null) {
        return;
    }
    subscriptions = [];
    for (const name of PER_PLAYER_TRIGGER_EVENTS) {
        const handle = onLocalPlayerEvent(name, () => scheduleCheck(name));
        if (handle) {
            subscriptions.push(handle);
        }
    }
    for (const name of TRIGGER_EVENTS) {
        const handle = onEngineEvent(name, () => scheduleCheck(name));
        if (handle) {
            subscriptions.push(handle);
        }
    }
    // The safety net behind all of them; see SWEEP_MS.
    sweepTimer = setInterval(() => scheduleCheck('periodic check', true, true), SWEEP_MS);
    log(
        `auto-assign watcher attached (${TRIGGER_EVENTS.length + PER_PLAYER_TRIGGER_EVENTS.length} events, ` +
            `sweeping every ${SWEEP_MS / 1000}s)`,
    );
}

function detachWatchers() {
    if (subscriptions.length === 0 && sweepTimer === null) {
        return;
    }
    stopEngineEvents(subscriptions);
    if (sweepTimer !== null) {
        clearInterval(sweepTimer);
        sweepTimer = null;
    }
    clearLateArrivalChecks();
    clearBlockedRetry();
    if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
    }
    log('auto-assign watcher detached: automatic assignment is switched off');
}

function applyAutoAssignMode() {
    if (CommerceOptions.autoAssignMode === AutoAssignMode.Off) {
        detachWatchers();
        return;
    }
    attachWatchers();
}

export function startAutoAssign() {
    if (attached) {
        return;
    }
    attached = true;

    // A different game may have been loaded since last time; whatever was remembered
    // about the previous one's settlements does not apply to this one.
    forgetPriorityMemory();

    // ⚠️ The only thing installed unconditionally: no engine event follows an options change, so
    // turning the setting on has to start the watcher there and then.
    window.addEventListener(CommerceOptionsChangedEventName, applyAutoAssignMode);

    /*
     * ⚠️ Seeded whatever the mode is. `known` has to describe the board as it was when the game
     * loaded, not when the player happened to switch the option on - otherwise everything
     * acquired while it was Off is silently reclassified as "always been there".
     */
    seedWithRetries(SEED_ATTEMPTS);
}
