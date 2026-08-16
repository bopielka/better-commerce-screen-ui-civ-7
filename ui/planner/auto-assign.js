/**
 * Assigning newly acquired resources by itself, with the Commerce screen closed.
 *
 * Improve a tile, bring a resource in on a trade route or take an enemy settlement and the
 * haul normally sits unassigned until you remember to go and place it. With this on, it is
 * placed the moment it arrives, using the same ordering "Assign All" uses.
 *
 * How far it goes is one setting with four steps - off, the new resource only, everything
 * unassigned, or a full rebuild of the empire. See ui/options/najane-commerce-options.js.
 *
 * Off by default, and deliberately so: it acts on the player's behalf without being asked
 * and shows nothing while doing it.
 *
 * ⚠️ This module decides WHEN, and nothing else. The work goes through run.js, the same
 * entry points the buttons use.
 *
 * It used to place resources itself, calling `placeResources` directly and keeping its own
 * "is a pass running" flag beside run.js's. Two flags meant two answers: an automatic pass
 * could start while Reassign All was halfway through emptying the empire, and the two then
 * planned against each other's half-finished board. It also grew its own copy of "empty
 * every settlement", which drifted from the button's - see engine/unassign.js.
 *
 * Only NEW resources are touched
 * ------------------------------
 * Not everything that happens to be unassigned - a player who left something out did that
 * on purpose. Every resource the player owns is remembered; only values that were not there
 * last time are candidates, so a save full of deliberately unassigned resources is left
 * alone.
 *
 * That remembering happens as soon as the game is far enough along to ask, NOT on the first
 * event. Seeding on the first event meant the first thing that ever happened was swallowed
 * to build the list - and since the player usually turns the option on and then goes and
 * does something, the first thing that happened was exactly the thing they were waiting to
 * see work.
 *
 * When it runs
 * ------------
 * There is no "resource acquired" engine event - checked against the engine's own event
 * names, the closest are `ResourceAddedToMap` (a resource appearing on the MAP, not in your
 * hands) and `ResourceAssigned`. So a spread of cheap events is watched and two questions
 * are asked on each: has the set of resources grown, and has the empire's room for them?
 *
 * ⚠️ And behind all of them, a periodic sweep - because the event list was wrong three times
 * running. The engine's event surface is not documented, the names that exist are not the
 * names one would guess, and every gap looks identical to the player: the feature does
 * nothing. The events make it feel instant; the sweep makes it CORRECT. See SWEEP_MS.
 *
 * ⚠️ A trigger that cannot be acted on yet is HELD, not dropped. The Commerce screen being
 * open, a button mid-run or a pass already in flight all mean "not now", and closing the
 * screen raises no engine event - so the check asks again every second and a half until the
 * way is clear. Returning early instead is the likeliest reason for "automatic assignment
 * does nothing at all": the workflow that produces it is the ordinary one, where the player
 * is in the Commerce screen when the resource lands.
 *
 * ⚠️ The trigger fires BEFORE the resource is in your hands.
 * `ConstructibleBuildCompleted` announces that the improvement finished; the resource shows
 * up in `player.Resources.getResources()` a moment later. A single debounced look therefore
 * finds nothing new and, without the retries below, the pass would sit out until the next
 * `LocalPlayerTurnBegin` - i.e. next turn. A player who improves a tile and immediately
 * opens the screen sees nothing happen and reasonably concludes the option is broken.
 */
import { assignAll, isAssignmentInProgress, reassignAll } from './run.js';
import { isAssignableToSettlement } from './facts.js';
import { forgetPriorityMemory } from './priorities.js';
import { getCommerceModel } from '../model/screen-model.js';

import CommerceOptions, { AutoAssignMode } from '../options/najane-commerce-options.js';
import { log, warn } from '../support/diagnostics.js';

/**
 * ⚠️ Two kinds of trigger, and the second half was missing.
 *
 * The first four say "you may have gained a resource". The rest say "the empire may have
 * gained somewhere to PUT one" - a captured settlement, a wonder or a building carrying
 * resource slots, a new settlement. Without those, a Marketplace or a Colossus finished
 * while the pool was full changed nothing until the next turn began, and a resource that
 * had failed to place sat there with room now waiting for it.
 *
 * `LocalPlayerTurnBegin` remains the catch-all behind all of it.
 */
const TRIGGER_EVENTS = [
    'ConstructibleBuildCompleted', // a tile improved onto a resource - or a building with slots
    /*
     * ⚠️ `ConstructibleBuildCompleted` is not enough on its own: it announces something the
     * PRODUCTION QUEUE finished. An improvement that appears because the city expanded onto
     * the tile is added to the map without ever being built, and raises only these two. That
     * gap is exactly the case a player tests with - improve a tile, look at the screen - and
     * it produced no trigger at all.
     */
    'ConstructibleAddedToMap',
    'ConstructibleChanged',
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

/**
 * How long to keep looking after a trigger that found nothing new.
 *
 * Covers the gap between "the improvement finished" and "the resource is in your hands"
 * without polling all turn: a few cheap set comparisons, then it gives up and leaves the
 * next trigger to it.
 */
const LATE_ARRIVAL_DELAYS_MS = [600, 1500, 3000];

/** How long to keep trying to read the player's resources after the UI loads. */
const SEED_RETRY_MS = 1000;
const SEED_ATTEMPTS = 30;

/**
 * How often to look again while something is in the way.
 *
 * ⚠️ A trigger that arrives while the Commerce screen is open used to be DROPPED, and that is
 * the single likeliest reason for "automatic assignment does nothing". The workflow that
 * produces it is the ordinary one: the player is in the Commerce screen, empties the empire,
 * improves a tile, and the arrival lands while the screen is still up. `check` returned
 * early, nothing rescheduled it, and CLOSING the screen raises no engine event - so the pass
 * waited for the next turn, or for the next acquisition, and to the player it simply never
 * happened.
 *
 * Closing the screen is not something this module can be told about without reaching into
 * the screen, so it asks again instead. The cost is one set comparison per interval, and
 * only while blocked.
 */
const BLOCKED_RETRY_MS = 1500;

/**
 * The safety net: look again every so often, whatever did or did not fire.
 *
 * ⚠️ Added after the THIRD time an event turned out to be missing from the list above. The
 * engine's event surface is not documented, the names that exist are not the names one would
 * guess, and every gap presents identically to the player - the feature simply does nothing.
 * Chasing them one at a time is a losing game: each fix is right and the next gap is still
 * out there.
 *
 * So the events stay - they make it feel instant - and this makes it CORRECT. Whatever we
 * failed to hear, the pass happens within this interval.
 *
 * Cheap enough to justify: one walk over the player's resources and one over the cities, no
 * `canStart` calls, and it stops at the first comparison when nothing has changed. Sweeps are
 * silent when they find nothing, or the log would fill with them.
 */
const SWEEP_MS = 15000;

let known = null;
let knownCapacity = null;
let running = false;

/**
 * Whether a pass is in flight, or about to be.
 *
 * Read by the action-icon filter, and the reason it can hide the icon BEFORE it is ever
 * drawn rather than a second afterwards: if a pass is coming, whatever is unassigned right
 * now says nothing about what will be unassigned when it finishes.
 *
 * ⚠️ `lastTriggerAt` is here because of event ORDER. The engine raises the notification and
 * the events this watcher listens for in the same burst, and nothing promises which lands
 * first - so "is a pass scheduled" can still be false at the moment the notification is
 * offered. Treating a trigger from the last moment as pending closes that window; the
 * penalty for being wrong is one late re-check, which happens anyway.
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
 * The resources the player owns that this module could ever do anything about.
 *
 * ⚠️ Empire and treasure resources are left out. They are never assigned to a settlement -
 * see `isAssignableToSettlement` - so acquiring one is not an event this watcher can act on.
 * Counting them was worse than pointless: improving a Gold tile in Antiquity produced a
 * "newly acquired resource", the pass that followed could place nothing, and because an
 * arrival is only forgotten after a pass that placed SOMETHING, that same arrival was
 * retried on every trigger for the rest of the game.
 */
function currentResourceValues() {
    const player = Players.get(GameContext.localPlayerID);
    const values = new Set();
    for (const resource of player?.Resources?.getResources() ?? []) {
        const resourceType = GameInfo.Resources.lookup(resource.uniqueResource?.resource)?.ResourceType ?? null;
        if (!isAssignableToSettlement({ resourceType, resourceValue: resource.value })) {
            continue;
        }
        values.add(resource.value);
    }
    return values;
}

/**
 * How many resource slots the empire has in total, and how many are filled.
 *
 * `capacity` is the cheap half of "is there anywhere to put something now that there was not
 * before" - buildings and wonders that carry slots raise it, so does taking a settlement.
 * `assigned` turns the owned-resource count into "is anything sitting unassigned", without
 * building the whole board.
 *
 * One walk over the cities for both, because they are always wanted together.
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

async function check(trigger, { isRetry = false, quiet = false } = {}) {
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
    /*
     * ⚠️ Blocked, not cancelled. Both of these used to `return` and the trigger was gone for
     * good - see the note on BLOCKED_RETRY_MS for why that is the likeliest cause of
     * "automatic assignment does nothing at all".
     */
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
         * ⚠️ New room is a reason to run, but NOT in "the new resource only".
         *
         * A Marketplace does not hand the player a resource, so in that mode there is
         * genuinely nothing new to place and the resources sitting in the pool are ones
         * the player left there. The other two modes are explicitly about the pool, so
         * more room is exactly their cue.
         *
         * A resource that arrived and could not be placed is covered either way: `known`
         * is only advanced after a pass that placed something, so it stays in `fresh`
         * until it lands.
         */
        const actOnRoom = roomGrew && mode !== AutoAssignMode.NewOnly;

        /*
         * ⚠️ EVERY mode still waits for something to actually happen. What the modes differ
         * in is SCOPE - how much of the pool an arrival is a cue to tidy - not in when they
         * run.
         *
         * "Place everything unassigned" briefly meant "any time anything is in the pool",
         * added while chasing arrivals that were being missed. It was the wrong fix for the
         * right complaint: the arrivals were being lost to gaps in the event list, and those
         * are fixed above. What it left behind was a mode that emptied the pool on load and
         * again every fifteen seconds, which is not a cue - nothing happened - and which
         * quietly overrode "a player who left something out did that on purpose", the one
         * principle this whole module is built on.
         */
        if (fresh.size === 0 && !actOnRoom) {
            if (!quiet) {
                log(
                    `${trigger}: nothing to do (${current.size} resources owned, ` +
                        `${assigned} assigned, ${capacity} slots)`,
                );
            }
            // ⚠️ `known` is deliberately NOT updated here. It already equals `current`,
            // and leaving it alone keeps the retry below comparing against the same
            // baseline.
            // ⚠️ Only a real trigger arms these. A retry that armed more retries would
            // never stop - three become nine become twenty-seven, all turn long.
            if (!isRetry) {
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
         * ⚠️ Only now, and only if something landed.
         *
         * Updating it before the work meant a pass that placed nothing still swallowed the
         * arrival: the next trigger saw no new resources and did nothing, so one badly
         * timed event could cost the player the whole feature until their next acquisition.
         *
         * `assignAll` answers how many landed, or `false` if it refused to start at all -
         * and `> 0` is false for both of those, which is the point.
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
let lateArrivalTimers = [];
let blockedTimer = null;
let blockedLogged = false;

/**
 * Asks again shortly, because something was in the way rather than because nothing was found.
 *
 * ⚠️ Logged once per WAIT, not once per retry. Guarding on `blockedTimer` alone is not
 * enough - the timer is null again by the time the retry runs, so every attempt logged and a
 * player sitting in the Commerce screen for half a minute produced fifteen identical lines.
 * `blockedLogged` is cleared when the wait ends, in `clearBlockedRetry`.
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
 * Looks again shortly after a trigger that found nothing.
 *
 * Not a poll: a fixed handful of follow-ups, cancelled the moment anything is found, and
 * cancelled again by the next real trigger. Each one costs a set comparison over the
 * player's resources, which is the same work the trigger itself does.
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

function scheduleCheck(trigger, quiet = false) {
    clearLateArrivalChecks();
    // A real trigger supersedes whatever we were waiting to retry.
    clearBlockedRetry();
    lastTriggerAt = Date.now();
    pendingTrigger = trigger;
    if (scheduled !== null) {
        // ⚠️ Merging into a window that is already open, so a LOUD trigger wins: a sweep
        // landing on top of a real event must not silence that event's report.
        pendingQuiet = pendingQuiet && quiet;
        return;
    }
    pendingQuiet = quiet;
    scheduled = setTimeout(() => {
        scheduled = null;
        check(pendingTrigger, { quiet: pendingQuiet });
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

export function startAutoAssign() {
    if (attached) {
        return;
    }
    attached = true;

    // A different game may have been loaded since last time; whatever was remembered
    // about the previous one's settlements does not apply to this one.
    forgetPriorityMemory();

    // The mod's scripts load before the game is necessarily ready to answer, so this
    // keeps asking rather than waiting for something to happen.
    seedWithRetries(SEED_ATTEMPTS);
    for (const name of TRIGGER_EVENTS) {
        try {
            engine.on(name, () => scheduleCheck(name));
        } catch (error) {
            warn(`could not listen for ${name}: ${error}`);
        }
    }
    // The safety net behind all of them; see SWEEP_MS.
    setInterval(() => scheduleCheck('periodic check', true), SWEEP_MS);
    log(`auto-assign watcher attached (${TRIGGER_EVENTS.length} events, sweeping every ${SWEEP_MS / 1000}s)`);
}
