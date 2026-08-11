/**
 * Assigning newly acquired resources by itself, with the Commerce screen closed.
 *
 * Improve a tile or bring a resource in on a trade route and it normally sits unassigned
 * until you remember to go and place it. With this on, it is placed the moment it arrives,
 * using the same ordering "Assign All" uses.
 *
 * How far it goes is one setting with four steps - off, the new resource only, everything
 * unassigned, or a full rebuild of the empire. See ui/options/najane-commerce-options.js.
 *
 * Off by default, and deliberately so: it acts on the player's behalf without being asked
 * and shows nothing while doing it. See ui/options/najane-commerce-options.js.
 *
 * Only NEW resources are touched
 * ------------------------------
 * Not everything that happens to be unassigned - a player who left something out did that
 * on purpose. Every resource the player owns is remembered; only values that were not
 * there last time are candidates, so a save full of deliberately unassigned resources is
 * left alone.
 *
 * That remembering happens as soon as the game is far enough along to ask, NOT on the
 * first event. Seeding on the first event meant the first thing that ever happened was
 * swallowed to build the list - and since the player usually turns the option on and then
 * goes and does something, the first thing that happened was exactly the thing they were
 * waiting to see work.
 *
 * When it runs
 * ------------
 * There is no "resource acquired" engine event, so several cheap ones are watched and the
 * question - has the set grown? - is asked on each. `LocalPlayerTurnBegin` is the safety
 * net that catches anything the others miss.
 */
import { settlementHappiness } from './scoring.js';
import { forgetPriorityMemory } from './priorities.js';
import { placeResources } from './place.js';
import { requestClearSettlement } from '../engine/operations.js';
import { getCommerceModel } from '../model/screen-model.js';
import { buildSettlements } from '../model/headless-model.js';

import { waitForEngineEvent } from '../engine/wait.js';
import CommerceOptions, { AutoAssignMode } from '../options/najane-commerce-options.js';
import { log, warn } from '../support/diagnostics.js';

const TRIGGER_EVENTS = [
    'ConstructibleBuildCompleted', // a tile improved onto a resource
    'TradeRouteAddedToMap', // a new route brings its payload
    'TradeRouteChanged',
    'ResourceCapChanged',
    'LocalPlayerTurnBegin', // catch-all
];

/** Events arrive in bursts; one pass per burst is enough. */
const DEBOUNCE_MS = 400;

/** How long to keep trying to read the player's resources after the UI loads. */
const SEED_RETRY_MS = 1000;
const SEED_ATTEMPTS = 30;

let known = null;
let running = false;
let scheduled = null;
let attached = false;

function currentResourceValues() {
    const player = Players.get(GameContext.localPlayerID);
    const values = new Set();
    for (const resource of player?.Resources?.getResources() ?? []) {
        values.add(resource.value);
    }
    return values;
}


/**
 * Empties every settlement, then lays the whole empire out again.
 *
 * The widest of the behaviours, and the only one that moves resources the player had
 * already placed - which is why it is its own option rather than a shade of the others.
 */
async function reassignEverything() {
    let cleared = 0;
    for (const settlement of buildSettlements()) {
        if ((settlement.slottedResources?.length ?? 0) === 0) {
            continue;
        }
        if (requestClearSettlement(settlement.cityID)) {
            cleared++;
            await waitForEngineEvent('ResourceUnassigned');
        }
    }
    log(`cleared ${cleared} settlement(s) before laying everything out again`);
    await placeResources({ label: 'auto reassign' });
}

/**
 * What the planner sees for happiness, in its own words.
 *
 * Worth logging because this path builds its data by hand: if these figures disagree with
 * the settlement cards on screen, the fault is in headless-model.js and not in the
 * scoring.
 */
function logHappinessState() {
    const unhappy = buildSettlements()
        .map((settlement) => ({
            name: settlement.settlementNameData.settlementName,
            isTown: settlement.settlementNameData.isTown,
            happiness: settlementHappiness(settlement),
        }))
        .filter((entry) => entry.happiness < 0);

    log(
        unhappy.length === 0
            ? 'happiness: every settlement is at zero or above'
            : 'happiness deficits: ' +
                  unhappy.map((e) => `${e.name}${e.isTown ? ' (town)' : ''} ${e.happiness}`).join(', '),
    );
}

async function check(trigger) {
    if (running) {
        return;
    }
    const mode = CommerceOptions.autoAssignMode;
    if (mode === AutoAssignMode.Off) {
        log(`${trigger}: automatic assignment is switched off (Options -> Mods)`);
        return;
    }
    // The player is looking at the screen and may be mid-drag; leave it alone.
    if (getCommerceModel()) {
        log(`${trigger}: skipped, the Commerce screen is open`);
        return;
    }

    running = true;
    try {
        const current = currentResourceValues();
        if (known === null) {
            // Seeding should have happened long before this; if it somehow did not, do it
            // now rather than treat every resource the player owns as newly acquired.
            known = current;
            warn(`${trigger}: arrived before the resource list was ready, seeding now`);
            return;
        }

        const fresh = new Set();
        for (const value of current) {
            if (!known.has(value)) {
                fresh.add(value);
            }
        }
        known = current;

        if (fresh.size === 0) {
            log(`${trigger}: nothing new (${current.size} resources owned)`);
            return;
        }
        logHappinessState();

        if (mode === AutoAssignMode.RebuildEverything) {
            log(`${trigger}: ${fresh.size} newly acquired resource(s) - rebuilding the whole empire`);
            await reassignEverything();
            return;
        }

        const everything = mode === AutoAssignMode.EverythingUnassigned;
        log(
            `${trigger}: ${fresh.size} newly acquired resource(s)` +
                (everything ? ' - placing everything unassigned' : ''),
        );
        await placeResources({ scope: everything ? null : fresh, label: 'auto assign' });
    } catch (error) {
        warn(`auto-assign pass failed: ${error}`);
    } finally {
        running = false;
    }
}

let pendingTrigger = '';

function scheduleCheck(trigger) {
    pendingTrigger = trigger;
    if (scheduled !== null) {
        return;
    }
    scheduled = setTimeout(() => {
        scheduled = null;
        check(pendingTrigger);
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
    log(`remembering ${known.size} resources already owned`);
    return true;
}

function seedWithRetries(attemptsLeft) {
    if (trySeed() || attemptsLeft <= 0) {
        if (known === null) {
            warn('gave up waiting for the resource list; the first event will seed instead');
        }
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
    log('auto-assign watcher attached');
}
