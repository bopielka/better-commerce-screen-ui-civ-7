/**
 * What the buttons on the screen do: Assign All, Reassign All, and a settlement's own
 * quick assign.
 *
 * The placing itself is place.js, shared with the automatic path - see the note there for
 * why none of this goes through the screen's model. What is left here is the framing: one
 * run at a time, empty before refilling, and a line in the log saying what happened.
 */
import { requestClearSettlement, unassignIfAllowed } from '../engine/operations.js';
import { waitForEngineEvent } from '../engine/wait.js';
import { buildSettlements } from '../model/headless-model.js';
import { allSettlements } from '../model/screen-model.js';
import { forgetEligibility, settlementHappiness } from './scoring.js';
import { placeResources } from './place.js';
import { log, warn } from '../support/diagnostics.js';

const UNASSIGNED_EVENT = 'ResourceUnassigned';

let assignmentInProgress = false;

export function isAssignmentInProgress() {
    return assignmentInProgress;
}

/**
 * Empties every settlement.
 *
 * One Clear per settlement beats one Deactivate per resource; the per-resource path is
 * the fallback for when the engine refuses the bulk form. Read from the game rather than
 * from the screen, for the same reason as everything in place.js.
 */
async function unassignEverything() {
    let cleared = 0;

    for (const settlement of buildSettlements()) {
        const values = (settlement.slottedResources ?? []).map((resource) => resource.resourceValue);
        if (values.length === 0) {
            continue;
        }

        if (requestClearSettlement(settlement.cityID)) {
            cleared += values.length;
        } else {
            for (const value of values) {
                if (unassignIfAllowed(settlement.cityID, value)) {
                    cleared++;
                } else {
                    warn(`failed to request unassign for resource ${value}`);
                }
            }
        }
        await waitForEngineEvent(UNASSIGNED_EVENT);
    }

    // Every settlement has room again, so nothing remembered about them still holds.
    forgetEligibility();
    return cleared;
}

/** Guards every entry point: only one of these loops may run at a time. */
async function runExclusively(model, work) {
    if (assignmentInProgress || !model.isSlottingAvailable) {
        return false;
    }
    assignmentInProgress = true;
    try {
        model.deselectSelectedResource?.();
        await work();
    } catch (error) {
        warn(`assignment run failed: ${error}`);
    } finally {
        assignmentInProgress = false;
    }
    return true;
}

/** Reports what the rescue tier is looking at, so a wrong reading shows up in the log. */
function logHappinessState(model) {
    const unhappy = allSettlements(model)
        .map((settlement) => ({
            name: Locale.compose(Cities.get(settlement.cityID)?.name ?? ''),
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

export function assignAll(model) {
    return runExclusively(model, async () => {
        logHappinessState(model);
        await placeResources({ label: 'assign all' });
        logHappinessState(model);
    });
}

export function reassignAll(model) {
    return runExclusively(model, async () => {
        const cleared = await unassignEverything();
        log(`reassign all: ${cleared} unassigned, laying them out again`);
        await placeResources({ label: 'reassign all' });
    });
}

export function quickAssignSettlement(model, cityID) {
    return runExclusively(model, async () => {
        await placeResources({ targetCityID: cityID, label: 'quick assign' });
    });
}
