/**
 * The placement loop: one resource at a time, re-planned after each. ONE loop for both paths -
 * the buttons, and the automatic placement that runs with the screen shut.
 *
 * ⚠️ IT DOES NOT GO THROUGH THE SCREEN'S MODEL, and that is MEASURED: driving the screen cost
 * 30.7 s for 111 resources, of which 1.6 s was deciding anything. Each model call mutates a Solid
 * store and re-renders. This talks to the engine and reads the engine back.
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
    forgetSettlementFacts,
    rebuildSettlement,
} from '../model/headless-model.js';
import { bestAssignment, forgetEligibility, forgetSettlementScores, startPlacementRun } from './scoring.js';
import { isFactoryFirstEnabled } from './factory-first-setting.js';
import { isImportedResource, resourceClassOf, resourceType } from './facts.js';
import { allSettlements, getCommerceModel, reconcileScreenWithEngine } from '../model/screen-model.js';
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

/**
 * Waits for the engine to have actually taken the assignment.
 *
 * ⚠️ NOT the `ResourceAssigned` event: it fires for every player, so an AI assigning something on
 * the far side of the map would release the loop early. Asking the settlement cannot be confused.
 *
 * ⚠️ Polled every few ms rather than once a frame: the operation is processed on the engine's own
 * tick, and a frame-aligned check can miss it by most of a frame - 16ms per resource, for nothing.
 *
 * ⚠️ The interval only starts DOUBLING once the first 50ms are gone, and that split is the point:
 * each poll is a call into the engine plus the settlement's whole resource list. Inside the window
 * an assignment normally lands in, the timing is exactly what it was; past it, an assignment the
 * engine is slow with is asked about a dozen times rather than five hundred.
 */
const CONFIRM_POLL_MS = 4;
const CONFIRM_FAST_WINDOW_MS = 50;
const CONFIRM_POLL_CEILING_MS = 32;
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
        let wait = CONFIRM_POLL_MS;
        const check = () => {
            if (landed()) {
                resolve(true);
                return;
            }
            if (Date.now() - started >= CONFIRM_TIMEOUT_MS) {
                resolve(false);
                return;
            }
            setTimeout(check, wait);
            if (Date.now() - started >= CONFIRM_FAST_WINDOW_MS) {
                wait = Math.min(wait * 2, CONFIRM_POLL_CEILING_MS);
            }
        };
        check();
    });
}

/**
 * One frame for the Commerce screen, when it happens to be open.
 *
 * ⚠️ NOT USED TO PACE THE LOOP ANY MORE, and that was a dead end worth recording. The screen loses
 * events whatever speed this runs at - the engine delivers `ResourceAssigned` in bursts on its own
 * tick and the model's signal holds only the LATEST payload - so a frame per placement bought a
 * hundred-odd redraws and still let the display drift. The board is reconciled ONCE at the end
 * instead; see `verifyScreenMatchesEngine`.
 */
function letTheScreenCatchUp() {
    if (!getCommerceModel()) {
        return null;
    }
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Guard against a runaway loop: high enough to cover a whole empire twice over. */
const MAX_PLACEMENTS = 300;

/**
 * How long the carried board may be trusted before it is read in full again.
 *
 * ⚠️ WHAT KEEPS THE SCORES HONEST IS OBJECT IDENTITY, not this number: a settlement's cached
 * scores are dropped exactly when its object is replaced - by a placement landing there, or by
 * the full read below. Between the two, the planner scores the same objects it scored last time
 * and gets the same numbers.
 *
 * ⚠️ THE NUMBER MATCHES `YIELD_CACHE_MS` in headless-model.js on purpose, and that is about how
 * STALE the board may be rather than about consistency: that cache already froze an untouched
 * settlement's yields for a second at a time, and a run is not allowed to get staler than the
 * model it was reading before.
 *
 * ⚠️ Wall-clock, not a count of placements: a run's placements are microseconds apart when the
 * engine is quick and a second apart when it is not.
 */
const FULL_READ_EVERY_MS = 1000;

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
    forgetSettlementFacts();
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

    /*
     * ⚠️ THE BOARD IS CARRIED, NOT REBUILT. Reading every settlement before every placement was
     * two engine calls per settlement plus a whole object graph, multiplied by the size of the
     * empire - to reflect a change in ONE settlement. What is re-read is that settlement; the
     * pool loses the copy that landed.
     *
     * ⚠️ This does NOT batch the decisions - each one is still made against the board the
     * previous one left behind, which is the rule at the top of this file. It changes how the
     * board is READ, not when it is read.
     */
    let settlements = null;
    let available = null;
    let lastFullReadAt = 0;

    const inScope = (resource) =>
        (scope === null || scope.has(resource.resourceValue)) && !refused.has(resource.resourceValue);

    while (placed < MAX_PLACEMENTS) {
        let mark = Date.now();
        /*
         * ⚠️ THE BACKSTOP, and it is why the whole read is still here. The carried board only
         * knows what this loop did; anything else moving the empire underneath it - the engine
         * releasing a companion, another mod - would otherwise stay invisible for the rest of
         * the run. Once a second it costs one old-style pass.
         *
         * ⚠️ The planner's per-settlement scores go with it, and that pairing is load-bearing:
         * they are kept between placements precisely because the yields behind them are frozen
         * until this line runs. See `forgetSettlementScores`.
         */
        if (settlements === null || Date.now() - lastFullReadAt >= FULL_READ_EVERY_MS) {
            settlements = buildSettlements();
            available = buildAvailableResources(settlements).filter(inScope);
            forgetSettlementScores();
            lastFullReadAt = Date.now();
        }
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
            available = available.filter(inScope);
            continue;
        }
        if (!requestAssign(plan.settlement.cityID, plan.resource.resourceValue)) {
            break;
        }

        placed++;
        // Only this settlement's answers changed: it has one fewer free slot, or two more
        // if that was a camel. Every other settlement's remain valid and are kept.
        forgetEligibility(plan.settlement.cityID);
        forgetSettlementFacts(plan.settlement.cityID);
        // The same rule for the scores, and for the same reason.
        forgetSettlementScores(plan.settlement.cityID);
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
        const landed = await awaitAssignment(plan.settlement.cityID, plan.resource.resourceValue);
        if (!landed) {
            // Accepted but never arrived: stop asking for this one rather than choosing it
            // again on every pass for the rest of the run.
            refused.add(plan.resource.resourceValue);
            placed--;
            warn(`the engine took ${plan.resource.resourceType} but it never arrived; skipping it`);
        }
        waitingMs += Date.now() - mark;

        // ⚠️ AFTER the confirmation, never before: this reads the settlement back out of the
        // engine, and before the assignment lands the engine still describes the old board.
        mark = Date.now();
        settlements = rebuildSettlement(settlements, plan.settlement.cityID);
        available = landed
            ? available.filter((resource) => resource.resourceValue !== plan.resource.resourceValue)
            : available.filter(inScope);
        boardMs += Date.now() - mark;
    }

    // ⚠️ Whenever ANYTHING is left, not only when the run placed nothing. Gated here, not inside
    // `log`: the walk and up to eight `canStart` calls are the expensive part.
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
 * Puts the screen back the way the game has it - ONCE, after the run.
 *
 * ⚠️ THIS IS THE ONLY THING KEEPING THE DISPLAY HONEST. Both halves of the screen's board are
 * maintained differentially and neither heals; see `reconcileScreenWithEngine`. Pacing the loop to
 * one frame per placement was the earlier attempt and did not work - the losses happen inside the
 * engine's own tick.
 *
 * ⚠️ Two frames first, so the model has processed whatever it did receive; reconciling on top of a
 * half-applied burst would undo work that was about to land anyway.
 *
 * ⚠️ Exported for screen/bulk-assign.js too: anything driving the engine directly leaves the
 * screen to be put right afterwards.
 */
export async function verifyScreenMatchesEngine() {
    const model = getCommerceModel();
    if (!model) {
        return;
    }
    await letTheScreenCatchUp();
    await letTheScreenCatchUp();
    try {
        const assignedTo = new Map();
        for (const settlement of buildSettlements()) {
            for (const resource of settlement.slottedResources) {
                assignedTo.set(resource.resourceValue, settlement.cityID);
            }
        }

        const { moved, returned, dropped } = reconcileScreenWithEngine(assignedTo);
        if (moved > 0 || returned > 0 || dropped > 0) {
            log(
                `screen reconciled: ${moved} tile(s) put on a settlement, ${returned} back in the ` +
                    `pool, ${dropped} duplicate(s) discarded`,
            );
        }

        const onScreen = allSettlements(model).reduce(
            (total, settlement) => total + (settlement.slottedResources?.length ?? 0),
            0,
        );
        if (onScreen !== assignedTo.size) {
            warn(
                `the Commerce screen shows ${onScreen} assigned resource(s) but the game has ` +
                    `${assignedTo.size}; the assignment is correct and the screen is behind - ` +
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
 * ⚠️ ONE settlement per resource: the reasons repeat, and asking all of them would multiply this
 * mod's most expensive call by the size of the empire for a log line.
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
        // ⚠️ Cities counted separately, because that is usually the answer: "3 in the pool, 7 of
        // 15 have room" meant the three were CITY resources and all seven with room were TOWNS.
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

/** One line on the factories at the start of a run. Diagnostics only: "factories first placed
 *  nothing" has three causes that look identical from outside. */
function logFactoryState() {
    /*
     * ⚠️ DIAGNOSTICS FIRST, and it was missing. "Factories first" ships ON, so this used to build
     * the whole board - every settlement, every resource in the pool - at the start of every run,
     * to feed a `log()` that does nothing with diagnostics off. Gated here rather than inside
     * `log` because the walk is the expensive part, exactly as in `logHappinessState`.
     */
    if (!DIAGNOSTICS || !isFactoryFirstEnabled()) {
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
