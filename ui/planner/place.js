/**
 * The placement loop: one resource at a time, re-planned after each.
 *
 * ONE loop for both paths - the buttons on the screen and the automatic placement that
 * runs with the screen shut. They used to be two, and the screen's version was slower for
 * a reason worth writing down.
 *
 * Why it does not go through the screen's model
 * ---------------------------------------------
 * The first version drove the screen: `clickAvailableResource`, `slotSelectedResource`,
 * `deselectSelectedResource`, then poll the model until the resource showed up in its new
 * home. Measured over 111 resources, that cost 30.7 seconds - and only 1.6s of it was
 * deciding anything:
 *
 *     assigned 111 resource(s) in 30663ms (1610ms planning, 16346ms waiting, 276ms each)
 *
 * The 12.7 seconds unaccounted for there were the three model calls: each one mutates a
 * Solid store and re-renders the screen, so every resource paid for three full redraws it
 * had no use for. The 16.3s of waiting was the fourth redraw - the one the assignment
 * itself causes - because the loop was waiting for the SCREEN to catch up before it could
 * plan again.
 *
 * So this talks to the engine and reads the engine back: the operation goes straight to
 * PlayerOperations, the wait asks the settlement itself whether the resource has arrived,
 * and the next plan is made from the game state rather than from the rendered screen. The
 * screen still redraws - it listens for the engine's events - but nothing here waits for
 * it to finish.
 *
 * ⚠️ Do not "optimise" this into a batch. Each choice is made against the board the
 * previous one left behind; that is what makes the happiness rescue level out and the
 * factories fill one kind at a time.
 */
import { assignRefusalReasons, canAssign, requestAssign } from '../engine/operations.js';
import {
    buildAvailableResources,
    buildHeadlessModel,
    buildSettlements,
    forgetSettlementBuildings,
} from '../model/headless-model.js';
import { bestAssignment, forgetEligibility } from './scoring.js';
import { isFactoryFirstEnabled } from './factory-first-setting.js';
import { resourceClassOf, resourceType } from './facts.js';
import { log, warn } from '../support/diagnostics.js';

/**
 * Waits for the engine to have actually taken the assignment.
 *
 * NOT the `ResourceAssigned` event: that fires for every player, so an AI assigning
 * something on the far side of the map would release this loop early and the next plan
 * would be made against a board that had not changed yet. Asking the settlement directly
 * cannot be confused by anyone else's turn.
 *
 * Checked every few milliseconds rather than once a frame. The operation is processed on
 * the engine's own tick, and a frame-aligned check can miss it by most of a frame - which
 * is 16ms lost on every resource, for nothing.
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
 * Guards against a runaway loop if the engine keeps accepting but nothing changes.
 * High enough to cover a whole empire twice over.
 */
const MAX_PLACEMENTS = 300;

/** How many refusals to spell out when a pass places nothing; the rest repeat. */
const EXPLAIN_SAMPLE = 8;

const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

/**
 * Places as much as it can, best first.
 *
 * @param scope        the resource values that may be placed, or null for anything free.
 * @param targetCityID restrict placement to one settlement, or null for all of them.
 * @param label        what to call this in the log.
 * @returns how many resources were placed.
 */
export async function placeResources({ scope = null, targetCityID = null, label = 'assign' } = {}) {
    // Whatever was remembered describes a board that has since moved on.
    forgetEligibility();
    forgetSettlementBuildings();

    // A pair the engine refuses is set aside rather than retried, or the loop would
    // choose it again every pass and never finish.
    const refused = new Set();

    logFactoryState();

    const startedAt = Date.now();
    let boardMs = 0;
    let choosingMs = 0;
    let waitingMs = 0;
    let placed = 0;

    while (placed < MAX_PLACEMENTS) {
        let mark = Date.now();
        const settlements = buildSettlements();
        const available = buildAvailableResources(settlements).filter(
            (resource) =>
                (scope === null || scope.has(resource.resourceValue)) && !refused.has(resource.resourceValue),
        );
        boardMs += Date.now() - mark;

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
        if (plan.rescue) {
            log(`happiness rescue: ${plan.resource.resourceType} -> ${settlementName(plan.settlement.cityID)}`);
        }

        mark = Date.now();
        if (!(await awaitAssignment(plan.settlement.cityID, plan.resource.resourceValue))) {
            // Accepted but never arrived: stop asking for this one rather than choosing it
            // again on every pass for the rest of the run.
            refused.add(plan.resource.resourceValue);
            placed--;
            warn(`the engine took ${plan.resource.resourceType} but it never arrived; skipping it`);
        }
        waitingMs += Date.now() - mark;
    }

    if (placed === 0) {
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
                `${waitingMs}ms waiting for the engine, ${Math.round(total / placed)}ms each)`,
        );
    }
    return placed;
}

function settlementName(cityID) {
    try {
        return Locale.compose(Cities.get(cityID)?.name ?? '');
    } catch (error) {
        return '';
    }
}

/**
 * Says, per resource, why the engine will not take it anywhere.
 *
 * ⚠️ Diagnostics only, and only when a pass placed NOTHING - which is the case worth
 * explaining. "nothing could be placed" on its own says the pass failed but not what the
 * player is supposed to do about it, and that is the same gap the game's own notification
 * leaves: it insists resources can be assigned while every settlement refuses them.
 *
 * One settlement per resource is enough. The reasons are properties of the pair, but the
 * common ones - no room, wrong class, not connected - repeat across every settlement, and
 * asking all of them would multiply the most expensive call in this mod by the size of
 * the empire for the sake of a log line.
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
        log(
            `nothing could be placed: ${available.length} in the pool, ` +
                `${withRoom.length} of ${settlements.length} settlement(s) have room` +
                (refused.size ? `, ${refused.size} set aside after the engine refused them` : ''),
        );

        if (withRoom.length === 0) {
            // Nothing to ask about: with no room anywhere, every refusal is the same one
            // and listing the pool would say it once per resource.
            log('  every settlement is at capacity - no algorithm can place any of these');
            return;
        }

        const target = withRoom[0];
        const where = settlementName(target.cityID);
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
 * One line on the state of the factories, at the start of a run.
 *
 * ⚠️ Diagnostics only. "Factories first placed nothing" has three quite different causes -
 * no factory resources in the pool, no settlement with a factory, or every such settlement
 * already full - and from the outside they look identical. Printing the three counts costs
 * one pass over the board and tells them apart at a glance.
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
