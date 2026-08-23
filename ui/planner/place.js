/**
 * The placement loop: one resource at a time, re-planned after each. ONE loop for both paths -
 * the buttons, and the automatic placement that runs with the screen shut.
 *
 * ⚠️ IT DOES NOT GO THROUGH THE SCREEN'S MODEL, and that is measured. The first version drove the
 * screen (`clickAvailableResource` / `slotSelectedResource` / `deselectSelectedResource`, then
 * poll the model): 111 resources cost 30.7 s of which only 1.6 s was deciding anything. Each of
 * the three model calls mutates a Solid store and re-renders, so every resource paid for three
 * redraws it had no use for, plus a fourth it then waited on.
 *
 * So this talks to the engine and reads the engine back. The screen still redraws - it listens to
 * the same events - but nothing here waits for it.
 *
 * ⚠️ Do not "optimise" this into a batch. Each choice is made against the board the previous one
 * left behind; that is what makes the happiness rescue level out and the factories fill one kind
 * at a time.
 */
import { assignRefusalReasons, canAssign, requestAssign } from '../engine/operations.js';
import {
    buildAvailableResources,
    buildHeadlessModel,
    buildSettlements,
    forgetSettlementBuildings,
} from '../model/headless-model.js';
import { bestAssignment, forgetEligibility, startPlacementRun } from './scoring.js';
import { isFactoryFirstEnabled } from './factory-first-setting.js';
import { isImportedResource, resourceClassOf, resourceType } from './facts.js';
import { allSettlements, getCommerceModel, pruneAssignedFromPool } from '../model/screen-model.js';
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

/**
 * Waits for the engine to have actually taken the assignment.
 *
 * ⚠️ NOT the `ResourceAssigned` event: it fires for every player, so an AI assigning something on
 * the far side of the map would release the loop early. Asking the settlement cannot be confused.
 *
 * ⚠️ Polled every few ms rather than once a frame: the operation is processed on the engine's own
 * tick, and a frame-aligned check can miss it by most of a frame - 16ms per resource, for nothing.
 */
const CONFIRM_POLL_MS = 4;
const CONFIRM_TIMEOUT_MS = 2000;

function awaitAssignment(cityID, resourceValue) {
    return new Promise((resolve) => {
        const started = Date.now();
        const landed = () => {
            try {
                return (Cities.get(cityID)?.Resources?.getAssignedResources() ?? []).some(
                    (resource) => resource.value === resourceValue,
                );
            } catch (error) {
                return false;
            }
        };
        const check = () => {
            if (landed()) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= CONFIRM_TIMEOUT_MS) {
                resolve(false);
                return;
            }
            setTimeout(check, CONFIRM_POLL_MS);
        };
        check();
    });
}

/**
 * Letting the Commerce screen keep up, when it happens to be open.
 *
 * ⚠️ The screen updates INCREMENTALLY and CAN MISS EVENTS. `commerce-screen-model.ts` turns
 * `ResourceAssigned` into a plain `createSignal()`, which holds only the LATEST payload, and the
 * effect reading it splices that one resource in - so two events in the same tick produce one
 * splice. This loop provokes exactly that by polling every 4ms and moving on before the event is
 * delivered. Leaving the screen and coming back shows the correct layout, which is what makes it
 * look like an assignment bug when it is a display one.
 *
 * ⚠️ There is no way to ask the screen to rebuild - `updateSlottedResources()` is private. So the
 * fix is not to refresh afterwards but not to outrun it: one frame per placement is enough.
 * ⚠️ Only while the screen is OPEN; the automatic path runs at full speed.
 */
function letTheScreenCatchUp() {
    if (!getCommerceModel()) {
        return null;
    }
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Guard against a runaway loop: high enough to cover a whole empire twice over. */
const MAX_PLACEMENTS = 300;

/** How many refusals to spell out when a pass places nothing; the rest repeat. */
const EXPLAIN_SAMPLE = 8;

const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';
/** Cannot go into a town at all; see the note in explainWhyNothingFits. */
const CITY_RESOURCE_CLASS = 'RESOURCECLASS_CITY';

/**
 * Places as much as it can, best first.
 * @returns how many resources were placed.
 */
export async function placeResources({ scope = null, targetCityID = null, label = 'assign' } = {}) {
    // Whatever was remembered describes a board that has since moved on.
    forgetEligibility();
    forgetSettlementBuildings();
    // The culture and gold settlements are chosen once here and held for the whole run;
    // see the note on hoardTargets for why they must not be re-picked every pass.
    startPlacementRun();

    // A pair the engine refuses is set aside rather than retried, or the loop would
    // choose it again every pass and never finish.
    const refused = new Set();

    logFactoryState();

    const startedAt = Date.now();
    let boardMs = 0;
    let choosingMs = 0;
    let waitingMs = 0;
    let placed = 0;
    /** What the last pass saw still sitting in the pool - see the note by the summary. */
    let leftInPool = 0;

    while (placed < MAX_PLACEMENTS) {
        let mark = Date.now();
        const settlements = buildSettlements();
        const available = buildAvailableResources(settlements).filter(
            (resource) =>
                (scope === null || scope.has(resource.resourceValue)) && !refused.has(resource.resourceValue),
        );
        boardMs += Date.now() - mark;
        leftInPool = available.length;

        mark = Date.now();
        const plan = available.length
            ? bestAssignment(buildHeadlessModel(settlements, available), targetCityID)
            : null;
        choosingMs += Date.now() - mark;

        if (!plan) {
            // Nothing left that fits anywhere; the rest stays unassigned.
            break;
        }
        if (!canAssign(plan.settlement.cityID, plan.resource.resourceValue)) {
            refused.add(plan.resource.resourceValue);
            continue;
        }
        if (!requestAssign(plan.settlement.cityID, plan.resource.resourceValue)) {
            break;
        }

        placed++;
        // Only this settlement's answers changed: it has one fewer free slot, or two more
        // if that was a camel. Every other settlement's remain valid and are kept.
        forgetEligibility(plan.settlement.cityID);
        forgetSettlementBuildings(plan.settlement.cityID);
        // ⚠️ One line per placement, naming the TIER that won it: "why did Tin end up in my
        // culture capital instead of Silk" has at least four possible answers and the board looks
        // the same in all of them.
        if (DIAGNOSTICS) {
            log(
                `  ${plan.resource.resourceType}${isImportedResource(plan.resource) ? ' [import]' : ''}` +
                    ` -> ${settlementName(plan.settlement.cityID)} (${plan.tier})`,
            );
        }

        mark = Date.now();
        if (!(await awaitAssignment(plan.settlement.cityID, plan.resource.resourceValue))) {
            // Accepted but never arrived: stop asking for this one rather than choosing it
            // again on every pass for the rest of the run.
            refused.add(plan.resource.resourceValue);
            placed--;
            warn(`the engine took ${plan.resource.resourceType} but it never arrived; skipping it`);
        }
        // One frame, and only with the screen open; see letTheScreenCatchUp.
        await letTheScreenCatchUp();
        waitingMs += Date.now() - mark;
    }

    // ⚠️ Explained whenever ANYTHING is left, not only when the run placed nothing - "it placed
    // most of them and left three" is the case a player actually reports. Gated here rather than
    // inside `log`: the walk and up to eight `canStart` calls are the expensive part.
    // ⚠️ Gated here, not inside `log`: the walk and up to eight `canStart` calls are the
    // expensive part, and `canStart` is the most expensive call in this mod.
    if (leftInPool > 0 && DIAGNOSTICS) {
        explainWhyNothingFits(scope, refused);
    }
    if (placed >= MAX_PLACEMENTS) {
        warn(`stopped after ${MAX_PLACEMENTS} assignments in one pass; anything left is still unassigned`);
    }
    if (placed > 0) {
        const total = Date.now() - startedAt;
        log(
            `${label}: ${placed} resource(s) in ${total}ms ` +
                `(${boardMs}ms reading the board, ${choosingMs}ms choosing, ` +
                `${waitingMs}ms waiting for the engine, ${Math.round(total / placed)}ms each)` +
                // Says outright that the run finished rather than stalled.
                (leftInPool > 0 ? `, ${leftInPool} left unplaceable` : ', pool empty'),
        );
    }
    // Last, so the warning reads after the summary it is about.
    await verifyScreenMatchesEngine();
    return placed;
}

/**
 * Brings the screen back into line with the game, and says so if it could not.
 *
 * ⚠️ BOTH halves, because they fail differently. The settlement cards heal themselves - their
 * handler re-reads live state on every event - so comparing only the assigned count reported "all
 * good" while the pool on the left still showed a resource that had been placed. The pool is
 * maintained purely differentially and cannot heal, so it is REPAIRED here rather than reported.
 *
 * ⚠️ Exported for screen/bulk-assign.js too: anything driving the engine directly leaves the pool
 * to be repaired afterwards.
 */
export async function verifyScreenMatchesEngine() {
    const model = getCommerceModel();
    if (!model) {
        return;
    }
    await letTheScreenCatchUp();
    await letTheScreenCatchUp();
    try {
        const settlements = buildSettlements();
        const assignedValues = new Set();
        for (const settlement of settlements) {
            for (const resource of settlement.slottedResources) {
                assignedValues.add(resource.resourceValue);
            }
        }

        const ghosts = pruneAssignedFromPool(assignedValues);
        if (ghosts > 0) {
            log(`removed ${ghosts} resource(s) the screen still showed as unassigned after placing them`);
        }

        const onScreen = allSettlements(model).reduce(
            (total, settlement) => total + (settlement.slottedResources?.length ?? 0),
            0,
        );
        if (onScreen !== assignedValues.size) {
            warn(
                `the Commerce screen shows ${onScreen} assigned resource(s) but the game has ` +
                    `${assignedValues.size}; the assignment is correct and the screen is behind - ` +
                    'reopen the screen to see the real layout',
            );
        }
    } catch (error) {
        warn(`could not reconcile the screen with the game: ${error}`);
    }
}

function settlementName(cityID) {
    try {
        return Locale.compose(Cities.get(cityID)?.name ?? '');
    } catch (error) {
        return '';
    }
}

/**
 * Says, per resource, why the engine will not take it anywhere. Diagnostics only.
 *
 * ⚠️ One settlement per resource is enough: the common reasons repeat across every settlement, and
 * asking all of them would multiply the most expensive call in this mod by the size of the empire
 * for the sake of a log line.
 */
function explainWhyNothingFits(scope, refused) {
    try {
        const settlements = buildSettlements();
        const available = buildAvailableResources(settlements).filter(
            (resource) => scope === null || scope.has(resource.resourceValue),
        );
        if (available.length === 0) {
            log('nothing to place: the pool is empty');
            return;
        }

        const withRoom = settlements.filter((settlement) => settlement.availableSlots?.length);
        /*
         * ⚠️ Cities counted separately, because that is the answer most of the time. "3 in the
         * pool, 7 of 15 settlements have room" reads like a bug in this mod; what it meant was
         * that the three left were CITY resources and all seven with room were TOWNS.
         */
        const citiesWithRoom = withRoom.filter((settlement) => !settlement.settlementNameData?.isTown);

        const byClass = new Map();
        for (const resource of available) {
            const className = resourceClassOf(resource) ?? 'UNKNOWN';
            byClass.set(className, (byClass.get(className) ?? 0) + 1);
        }
        const poolByClass = [...byClass]
            .map(([className, count]) => `${className.replace('RESOURCECLASS_', '')} x${count}`)
            .join(', ');

        log(
            `${available.length} left in the pool (${poolByClass}), ` +
                `${withRoom.length} of ${settlements.length} settlement(s) have room, ` +
                `${citiesWithRoom.length} of those are cities` +
                (refused.size ? `, ${refused.size} set aside after the engine refused them` : ''),
        );

        const cityClassLeft = byClass.get(CITY_RESOURCE_CLASS) ?? 0;
        if (cityClassLeft > 0 && citiesWithRoom.length === 0) {
            log(
                `  ${cityClassLeft} City resource(s) left and no CITY has room - ` +
                    'a City resource cannot go into a Town, so these cannot be placed at all',
            );
        }

        if (withRoom.length === 0) {
            // Nothing to ask about: with no room anywhere, every refusal is the same one
            // and listing the pool would say it once per resource.
            log('  every settlement is at capacity - no algorithm can place any of these');
            return;
        }

        // ⚠️ A city if there is one, because asking a town about a city resource produces a
        // refusal with no reason attached - which is what "no reason given" was.
        const target = citiesWithRoom[0] ?? withRoom[0];
        const where = `${settlementName(target.cityID)}${target.settlementNameData?.isTown ? ' (town)' : ''}`;
        // A handful is a sample, not a census: the reasons repeat, and the pool can hold
        // over a hundred resources.
        const sample = available.slice(0, EXPLAIN_SAMPLE);
        for (const resource of sample) {
            const reasons = assignRefusalReasons(target.cityID, resource.resourceValue);
            log(`  ${resource.resourceType} -> ${where}: ${reasons.join(' | ') || 'no reason given'}`);
        }
        if (available.length > sample.length) {
            log(`  ...and ${available.length - sample.length} more`);
        }
    } catch (error) {
        warn(`could not explain why nothing fits: ${error}`);
    }
}

/**
 * One line on the state of the factories at the start of a run. Diagnostics only: "factories
 * first placed nothing" has three quite different causes that look identical from outside.
 */
function logFactoryState() {
    if (!isFactoryFirstEnabled()) {
        return;
    }
    try {
        const settlements = buildSettlements();
        const pool = buildAvailableResources(settlements).filter(
            (resource) => resourceClassOf(resource) === FACTORY_CLASS,
        );
        const withFactory = settlements.filter((s) => s.factoryResourceData?.hasFactory);
        const withRoom = withFactory.filter((s) => s.availableSlots?.length);

        const kinds = new Map();
        for (const resource of pool) {
            const type = resourceType(resource);
            kinds.set(type, (kinds.get(type) ?? 0) + 1);
        }
        log(
            `factories first: ${pool.length} factory resource(s) in the pool ` +
                `(${[...kinds].map(([type, n]) => `${type} x${n}`).join(', ') || 'none'}), ` +
                `${withFactory.length} settlement(s) with a factory, ${withRoom.length} of those with room`,
        );
    } catch (error) {
        warn(`could not summarise the factory state: ${error}`);
    }
}
