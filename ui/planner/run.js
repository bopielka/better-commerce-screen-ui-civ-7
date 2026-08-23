/**
 * What the buttons do: Assign All, Reassign All, Unassign All, quick assign - and the automatic
 * path in auto-assign.js, so everything that rearranges the empire shares one guard and one log.
 *
 * Placing is place.js, emptying is engine/unassign.js. What is left here is the framing.
 */
import { unassignEverySettlement } from '../engine/unassign.js';
import { buildSettlements } from '../model/headless-model.js';
import { forgetEligibility, settlementHappiness } from './scoring.js';
import { placeResources } from './place.js';
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

let assignmentInProgress = false;

export function isAssignmentInProgress() {
    return assignmentInProgress;
}

/** Empties everything, then forgets what was remembered about a board that has moved on. */
async function clearEmpire() {
    const cleared = await unassignEverySettlement();
    // Every settlement has room again, so nothing remembered about them still holds.
    forgetEligibility();
    return cleared;
}

/**
 * Guards every entry point: only one of these loops may run at a time.
 *
 * ⚠️ `model` is optional. The automatic path has no Commerce screen and therefore no model,
 * and it used to keep its own copy of this guard - which meant a pass could start while a
 * button was still running. There is nothing to deselect and nothing to wait for when the
 * screen is shut, so the two conditions are simply skipped.
 *
 * ⚠️ Hands back whatever the work returned - for the placing entry points, HOW MANY resources
 * landed - and `false` when it refused to start or threw. Answering a plain "did it start"
 * is not enough: auto-assign.js only forgets a newly acquired resource once something has
 * actually been placed, and a run that started and placed nothing would otherwise look like
 * success and swallow the arrival.
 */
/**
 * How long a run may take before it is reported even with diagnostics off.
 *
 * ⚠️ `warn`, not `log`, and that is the point. A pass that takes half a minute is indis-
 * tinguishable from the game having hung, and the automatic path runs from
 * `LocalPlayerTurnBegin` - so what the player sees is "the turn takes a minute to load", with
 * nothing anywhere saying what did it. Every entry point goes through here, so one line here
 * covers all four; the breakdown of WHERE the time went is in place.js and needs diagnostics.
 */
const SLOW_RUN_MS = 5000;

async function runExclusively(model, work, label = 'assignment') {
    if (assignmentInProgress) {
        return false;
    }
    if (model && !model.isSlottingAvailable) {
        return false;
    }
    assignmentInProgress = true;
    const startedAt = Date.now();
    try {
        model?.deselectSelectedResource?.();
        return await work();
    } catch (error) {
        warn(`assignment run failed: ${error}`);
        return false;
    } finally {
        assignmentInProgress = false;
        const took = Date.now() - startedAt;
        if (took >= SLOW_RUN_MS) {
            warn(
                `${label} took ${(took / 1000).toFixed(1)}s` +
                    (model ? '' : ' with the Commerce screen closed') +
                    '; turn on diagnostics for the breakdown',
            );
        }
    }
}

/**
 * Reports what the rescue tier is looking at, so a wrong reading shows up in the log rather
 * than as a mysterious layout.
 *
 * ⚠️ Diagnostics only - nothing depends on it, and it is checked here rather than inside
 * `log` because the walk over every settlement is the expensive part, not the printing.
 * Read from the game rather than from the screen's model so the automatic path gets the
 * same figures; if these disagree with the settlement cards, the fault is in
 * headless-model.js and not in the scoring.
 */
function logHappinessState() {
    if (!DIAGNOSTICS) {
        return;
    }
    const unhappy = buildSettlements()
        .map((settlement) => ({
            name: settlement.settlementNameData?.settlementName ?? '',
            isTown: !!settlement.settlementNameData?.isTown,
            happiness: settlementHappiness(settlement),
        }))
        .filter((entry) => entry.happiness < 0);

    if (unhappy.length === 0) {
        log('happiness: every settlement is at zero or above');
        return;
    }
    log(
        'happiness deficits: ' +
            unhappy
                .map((entry) => `${entry.name}${entry.isTown ? ' (town)' : ''} ${entry.happiness}`)
                .join(', '),
    );
}

/**
 * Fills everything that is free, best first.
 *
 * @param model  the Commerce screen's model, or null when the screen is shut.
 * @param scope  the resource values that may be placed, or null for the whole pool.
 * @param label  what to call this in the log.
 * @returns how many resources were placed, or false if the run never started.
 */
export function assignAll(model = null, { scope = null, label = 'assign all' } = {}) {
    return runExclusively(
        model,
        async () => {
            logHappinessState();
            const placed = await placeResources({ scope, label });
            logHappinessState();
            return placed;
        },
        label,
    );
}

/** Empties every settlement, then lays the whole empire out again. */
export function reassignAll(model = null, { label = 'reassign all' } = {}) {
    return runExclusively(
        model,
        async () => {
            const cleared = await clearEmpire();
            log(`${label}: ${cleared} unassigned, laying them out again`);
            logHappinessState();
            return placeResources({ label });
        },
        label,
    );
}

/** Empties every settlement and leaves it at that. */
export function unassignAll(model = null) {
    return runExclusively(
        model,
        async () => {
            const cleared = await clearEmpire();
            log(`unassign all: ${cleared} released`);
            return cleared;
        },
        'unassign all',
    );
}

export function quickAssignSettlement(model, cityID) {
    return runExclusively(
        model,
        () => placeResources({ targetCityID: cityID, label: 'quick assign' }),
        'quick assign',
    );
}
