/**
 * "Do not touch my resources": putting back what the GAME slotted on its own.
 *
 * ⚠️ The game assigns a newly improved resource to the settlement that improved it as soon as that
 * settlement has a free slot. Nothing in the UI asks first, and the player never sees the choice.
 * This mode undoes exactly that: the resource goes back to the unassigned pool and waits.
 *
 * ⚠️ IT READS THE BOARD; IT DOES NOT TRUST AN EVENT. The first version hung on `ResourceAssigned`
 * and did nothing in play - the engine slots these without raising it, or raises it somewhere this
 * cannot see. What is checked now is STATE: anything slotted that the player has not been seen to
 * slot is put back. The events are only cues to look.
 *
 * ⚠️ `approved` IS THE WHOLE SAFETY MECHANISM. It holds the resource values the player is known to
 * have placed, and it is filled from three places: the first look when the game loads, every
 * assignment made with the Commerce screen open, and the grace windows. A resource that is not in
 * it and is nonetheless sitting in a settlement was put there by the engine.
 *
 * ⚠️ THE GRACE WINDOWS ARE NOT TIDINESS. A captured settlement and an age transition hand over
 * resources ALREADY slotted; treating those as "the game touched my resources" would empty a city
 * the player has just taken - a loss they cannot undo. They ADOPT rather than skip, so what
 * arrives with them is approved once and never fought over.
 *
 * ⚠️ It lives beside auto-assign.js rather than under engine/ because it reads the SAME setting -
 * Hands off is the fifth point on that one dropdown - and has to ask whether the screen is open.
 */
import { canUnassign, requestUnassign } from '../engine/operations.js';
import { getCommerceModel } from '../model/screen-model.js';
import { isAssignmentInProgress } from './run.js';
import { onEngineEvent, onEngineEvents, onLocalPlayerEvent, stopEngineEvents } from '../engine/events.js';
import { waitForEngineEvent } from '../engine/wait.js';

import CommerceOptions, {
    AutoAssignMode,
    CommerceOptionsChangedEventName,
} from '../options/najane-commerce-options.js';
import { log, warn } from '../support/diagnostics.js';

const UNASSIGNED_EVENT = 'ResourceUnassigned';

/**
 * Cues to look at the board - the same list auto-assign.js watches, and for the same reason: a
 * resource arrives by improving a tile, by trade route, or with a settlement.
 * ⚠️ `ResourceAssigned` is in here as a CUE, not as the mechanism; see the header.
 * ⚠️ Filtered and unfiltered exactly as in auto-assign.js, which records why each is which.
 */
const PER_PLAYER_TRIGGER_EVENTS = [
    'ConstructibleBuildCompleted',
    'ConstructibleAddedToMap',
    'ConstructibleChanged',
    'ResourceAssigned',
    'ResourceCapChanged',
    'CityAddedToMap',
];

const TRIGGER_EVENTS = [
    'TradeRouteAddedToMap',
    'TradeRouteChanged',
    'WonderCompleted',
    'LocalPlayerTurnBegin',
];

/** Events that hand over resources ALREADY slotted; see the header. */
const BULK_ARRIVAL_EVENTS = ['CityTransfered', 'ConqueredSettlementIntegrated', 'GameAgeEnded'];
const BULK_GRACE_MS = 5000;

/** Loading a save is not something that happened in the game, and neither is switching this on. */
const SETTLE_IN_MS = 5000;

/** Events arrive in bursts; one look per burst is enough. */
const DEBOUNCE_MS = 400;

/**
 * ⚠️ `ConstructibleBuildCompleted` means the IMPROVEMENT finished, not that the resource is in
 * your hands yet. Same delays, and the same reason, as auto-assign.js.
 */
const LATE_ARRIVAL_DELAYS_MS = [600, 1500, 3000];

/**
 * The safety net behind an event list that has already been wrong once here.
 * ⚠️ One walk over the settlements, no `canStart` calls.
 */
const SWEEP_MS = 15000;

/**
 * ⚠️ THE MODE MUST NOT BE READ AT LOAD. `CommerceOptions.autoAssignMode` memoises what
 * `UI.getOption` gives it, so a read before the game can answer caches the default for the whole
 * session - and here that decides whether the watcher is installed at all. Same retry, and the
 * same reason, as `seedWithRetries` in auto-assign.js.
 */
const READY_RETRY_MS = 1000;
const READY_ATTEMPTS = 30;

let subscriptions = [];
let sweepTimer = null;
let scheduled = null;
let lateArrivalTimers = [];
let pendingTrigger = '';
let pendingSweep = false;
let attachedAt = 0;
let bulkArrivalAt = 0;
let started = false;
let checking = false;

/** Resource values the player is known to have placed. Null until the board can be read. */
let approved = null;

/**
 * Values already returned this turn, so a game that slots one straight back cannot turn this into
 * a fight. ⚠️ Cleared on the local turn: next turn is a fresh case of the same thing.
 */
const pushedBack = new Set();

/** One at a time: `sendRequest` only queues, so a burst has to be walked. */
const queue = [];
let draining = false;

function handsOff() {
    return CommerceOptions.autoAssignMode === AutoAssignMode.HandsOff;
}

function withinGrace() {
    const now = Date.now();
    return now - attachedAt < SETTLE_IN_MS || now - bulkArrivalAt < BULK_GRACE_MS;
}

/** resourceValue -> the settlement holding it, for every slotted resource the player owns. */
function slottedByValue() {
    const byValue = new Map();
    try {
        for (const city of Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? []) {
            for (const resource of city.Resources?.getAssignedResources() ?? []) {
                byValue.set(resource.value, city.id);
            }
        }
    } catch (error) {
        warn(`could not read which resources are slotted: ${error}`);
    }
    return byValue;
}

/** Everything slotted right now counts as the player's. */
function adopt(why) {
    approved = new Set(slottedByValue().keys());
    log(`hands off: ${approved.size} slotted resource(s) taken as yours (${why})`);
}

/** ⚠️ For the log line only - a name this cannot read must not stop the resource coming back. */
function nameOf(resourceValue) {
    try {
        const resource = Game.Resources.getResourceOnPlot(resourceValue);
        const definition = GameInfo.Resources.lookup(resource?.resource);
        if (definition) {
            return Locale.compose(definition.Name);
        }
    } catch (error) {
        // Deliberately quiet: see above.
    }
    return `resource ${resourceValue}`;
}

async function drain() {
    if (draining) {
        return;
    }
    draining = true;
    try {
        while (queue.length > 0) {
            const { cityID, resourceValue, resourceName } = queue.shift();
            if (pushedBack.has(resourceValue)) {
                // Returned once already and the game put it straight back. Leaving it is the
                // safe failure; taking it out again for ever is not.
                warn(`${resourceName} was slotted again after being returned; leaving it this turn`);
                continue;
            }
            if (!canUnassign(cityID, resourceValue)) {
                warn(`the game slotted ${resourceName} and the engine will not let it out again`);
                continue;
            }
            if (!requestUnassign(cityID, resourceValue)) {
                continue;
            }
            pushedBack.add(resourceValue);
            await waitForEngineEvent(UNASSIGNED_EVENT);
            /*
             * ⚠️ `warn`, not `log`. This is the mod changing the board without being asked, and
             * `log` ships switched off - a player reporting "it does nothing" would have no line
             * to send. One line per resource returned, and only in this mode.
             */
            warn(`hands off: returned ${resourceName} to the pool - the game slotted it, not you`);
        }
    } catch (error) {
        warn(`returning a resource the game slotted failed: ${error}`);
    } finally {
        draining = false;
    }
}

function check(trigger, { isRetry = false, isSweep = false } = {}) {
    if (!handsOff() || checking) {
        return;
    }
    checking = true;
    try {
        if (approved === null) {
            adopt('first look');
            return;
        }
        /*
         * ⚠️ ADOPT rather than skip. The player is looking at the board, or one of this mod's own
         * passes is running, or a settlement has just changed hands - everything slotted is
         * theirs. Skipping would leave it unapproved and rip it out the moment the screen closes,
         * which is the one thing this mode must never do.
         */
        if (getCommerceModel() || isAssignmentInProgress() || withinGrace()) {
            adopt(trigger);
            return;
        }

        const slotted = slottedByValue();
        const doomed = [];
        for (const [resourceValue, cityID] of slotted) {
            if (!approved.has(resourceValue)) {
                doomed.push({ cityID, resourceValue, resourceName: nameOf(resourceValue) });
            }
        }

        // Everything still in a settlement and not on its way out is the board as it stands.
        const returning = new Set(doomed.map((entry) => entry.resourceValue));
        approved = new Set([...slotted.keys()].filter((value) => !returning.has(value)));

        if (doomed.length === 0) {
            // ⚠️ The improvement finishes before the resource lands; look again shortly. A retry
            // never arms retries, or they never stop - and nor does the sweep, which is not an
            // improvement finishing.
            if (!isRetry && !isSweep) {
                scheduleLateArrivalChecks(trigger);
            }
            return;
        }
        clearLateArrivalChecks();
        queue.push(...doomed);
        drain();
    } catch (error) {
        warn(`the hands-off check failed: ${error}`);
    } finally {
        checking = false;
    }
}

function scheduleLateArrivalChecks(trigger) {
    clearLateArrivalChecks();
    lateArrivalTimers = LATE_ARRIVAL_DELAYS_MS.map((delay) =>
        setTimeout(() => check(`${trigger} (+${delay}ms)`, { isRetry: true }), delay),
    );
}

function clearLateArrivalChecks() {
    for (const timer of lateArrivalTimers) {
        clearTimeout(timer);
    }
    lateArrivalTimers = [];
}

function scheduleCheck(trigger, isSweep = false) {
    if (!handsOff()) {
        return;
    }
    // ⚠️ Not for a sweep: it arms no retries, so clearing would cancel a real trigger's.
    if (!isSweep) {
        clearLateArrivalChecks();
    }
    pendingTrigger = trigger;
    if (scheduled !== null) {
        // ⚠️ A real trigger merged with a sweep keeps its late-arrival retries.
        pendingSweep = pendingSweep && isSweep;
        return;
    }
    pendingSweep = isSweep;
    scheduled = setTimeout(() => {
        scheduled = null;
        check(pendingTrigger, { isSweep: pendingSweep });
    }, DEBOUNCE_MS);
}

/**
 * The player's own assignment, approved the moment it happens.
 *
 * ⚠️ O(1) and NOT debounced. A player who assigns and shuts the screen inside the debounce window
 * would otherwise have the debounced check run with the screen already closed - and find their own
 * assignment unapproved. @returns whether this one was the player's.
 */
function noteIfMine(data) {
    if (!getCommerceModel() && !isAssignmentInProgress()) {
        return false;
    }
    try {
        const location = data?.location;
        if (location) {
            approved?.add(GameplayMap.getIndexFromLocation(location));
        }
    } catch (error) {
        warn(`could not note an assignment as yours: ${error}`);
    }
    return true;
}

function onResourceAssigned(data) {
    if (noteIfMine(data)) {
        return;
    }
    scheduleCheck('ResourceAssigned');
}

function attachWatchers() {
    if (subscriptions.length > 0 || sweepTimer !== null) {
        return;
    }
    attachedAt = Date.now();
    const handles = [];
    for (const name of PER_PLAYER_TRIGGER_EVENTS) {
        const handler = name === 'ResourceAssigned' ? onResourceAssigned : () => scheduleCheck(name);
        const handle = onLocalPlayerEvent(name, handler);
        if (handle) {
            handles.push(handle);
        }
    }
    for (const name of TRIGGER_EVENTS) {
        const handle = onEngineEvent(name, () => scheduleCheck(name));
        if (handle) {
            handles.push(handle);
        }
    }
    handles.push(
        ...onEngineEvents(BULK_ARRIVAL_EVENTS, () => {
            bulkArrivalAt = Date.now();
        }, { localPlayerOnly: false }),
    );
    const turnHandle = onEngineEvent('LocalPlayerTurnBegin', () => pushedBack.clear());
    if (turnHandle) {
        handles.push(turnHandle);
    }
    subscriptions = handles;
    sweepTimer = setInterval(() => scheduleCheck('periodic check', true), SWEEP_MS);
    // The first look adopts the board rather than treating it as the engine's work.
    check('watcher started');
    warn('hands off: resources the game slots by itself will be returned to the pool');
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
    if (scheduled !== null) {
        clearTimeout(scheduled);
        scheduled = null;
    }
    clearLateArrivalChecks();
    queue.length = 0;
    pushedBack.clear();
    approved = null;
    log('hands-off watcher detached');
}

function applyMode() {
    if (handsOff()) {
        attachWatchers();
        return;
    }
    detachWatchers();
}

function whenReadable(attemptsLeft) {
    if (Players.get(GameContext.localPlayerID)?.Resources || attemptsLeft <= 0) {
        applyMode();
        return;
    }
    setTimeout(() => whenReadable(attemptsLeft - 1), READY_RETRY_MS);
}

export function startHandsOff() {
    if (started) {
        return;
    }
    started = true;
    // ⚠️ Installed whatever the mode is: no engine event follows an options change, so turning
    // this on has to start the watcher there and then.
    window.addEventListener(CommerceOptionsChangedEventName, applyMode);
    whenReadable(READY_ATTEMPTS);
}
