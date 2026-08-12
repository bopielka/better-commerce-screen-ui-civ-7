/**
 * Automatic resource assignment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORIGIN: this is a port of the assignment engine from the Steam Workshop mod
 * **Resource+** (`brads-assign-all-resources`, id 3756000777) by **Br4d**, at the
 * request of this mod's author, so that the buttons here behave identically to that
 * mod's. The scoring constants, the ordering rules, the conditional-bonus table and
 * the overall shape of `bestAssignment` are Br4d's work, not ours.
 *
 * Br4d has given permission for this port.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * What it does, in order of preference:
 *   0. rescue unhappiness first - see rescueScore. This tier is NOT Br4d's; it sits
 *      above everything below and it is the whole reason this file diverges;
 *   0b. factory resources into the factories that can be filled with them, when
 *      "factories first" is switched on for the age - see factoryFirstScore;
 *   1. camels - they bring two extra slots with them, so placing them early makes
 *      room for everything after;
 *   2. resources whose stronger, conditional criteria are met in that settlement
 *      (the age-specific table in conditionalBoostStrength);
 *   3. single-yield resources before multi-yield ones, and resources that only make
 *      units cheaper to build after everything else - see givesUnitProductionBonus;
 *   4. within all of that, settlements matching their priority share the actual yield
 *      gain as evenly as they can, and how well a resource serves that priority is the
 *      dominant term - so a resource giving +1 production is only reached for once every
 *      resource giving more of it has been placed. Llamas, +1 production alongside +3
 *      happiness, are the case that makes this visible.
 *   4b. when nothing is left that serves a city's priority, production comes next - ahead
 *      of a resource whose conditional bonus merely happens to apply - see
 *      PRODUCTION_FALLBACK_SCORE_BASE;
 *   5. a resource carrying production is nudged away from towns, which turn production
 *      into gold rather than building with it - see TOWN_PRODUCTION_PENALTY;
 *   6. turtles and silk are gathered into the city that makes the most culture on its
 *      own, and jade into a different city that makes the most gold - see HOARD_TARGETS.
 *      This outranks the conditional tier but never a settlement's own priority.
 *
 * A settlement with no priority chosen counts as wanting production if it is a city and
 * food if it is a town - see DEFAULT_CITY_PRIORITY.
 *
 * Resource+'s per-resource locks are NOT ported - this mod has no lock UI, so the
 * lock set is always empty and "reassign" clears everything unlocked, which is
 * everything.
 */
import { canAssign } from '../engine/operations.js';
import { modifierApplies } from './effects.js';
import { allSettlements, pooledResources } from '../model/screen-model.js';
import { isFactoryFirstEnabled } from './factory-first-setting.js';
import { cityKey, getPriority } from './priorities.js';
import {
    HAPPINESS_YIELD,
    PRODUCTION_YIELD,
    conditionalBoostStrength,
    effectiveResourceYieldTypes,
    givesUnitProductionBonus,
    resourceClassOf,
    resourceType,
    resourceYieldEffects,
    resourceYieldTypes,
    scalesWithWarehouses,
    yieldTypeFromIcon,
} from './facts.js';

/**
 * Above everything else, including camels: no settlement should sit on negative
 * happiness. See rescueScore for what this tier does and why it levels rather than
 * maximises.
 */
const HAPPINESS_RESCUE_BASE = 10000000000;
/**
 * How much a town is docked for wanting a resource that carries production.
 *
 * A town turns its production into gold instead of building with it, so production is
 * worth less there than in a city - even when the resource also brings something a town
 * does want. Cotton is the case that prompted this: +2 food and +2 production, which
 * matched a town's food priority and a city's production priority equally well, and the
 * tie was being settled by nothing in particular.
 *
 * Half of one priority-boost step (those are worth 1000000 each). Enough that a city
 * always wins an otherwise equal contest, small enough that a town wanting the resource
 * distinctly more - a bigger boost on its own priority - still gets it.
 */
const TOWN_PRODUCTION_PENALTY = 500000;

/**
 * What a settlement falls back to when nothing left serves its chosen priority.
 *
 * Without this the leftovers were ordered by little more than the settlement's weakest
 * yield, so a culture-focused city that had run out of culture resources took whatever
 * happened to come up. Production is the sensible second choice, and this weight is small
 * enough to stay under the 100000 a priority match is worth - the fallback can never
 * outrank an actual match - while dominating the noise that decided it before.
 */
const PRODUCTION_FALLBACK_WEIGHT = 1000;

/**
 * "Factories first", unless the player has switched it off: fill the settlements that have
 * a factory with factory resources before placing anything else. On by default - factory
 * resources are the most valuable thing in the age and have nowhere else to go.
 *
 * Below the happiness rescue, which was named the overriding priority and stays that way -
 * an empire in revolt is not helped by a well-fed factory. Above everything else, which is
 * what "first" means here.
 */
const FACTORY_FIRST_SCORE_BASE = 5000000000;
const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

const CAMEL_SCORE_BASE = 1000000000;
const SPECIALIZED_CONDITIONAL_SCORE_BASE = 850000000;
const SPECIALIZED_SCORE_BASE = 700000000;
/**
 * A settlement whose priority nothing can serve takes production instead.
 *
 * This has to be a tier of its own, not a tiebreak. It started as a term inside
 * scorePair, which only ordered resources that had already landed on the same tier - so a
 * culture-focused city with no culture resources left still took pearls, because a
 * conditional bonus outranks a plain one, and the production sitting in the pool never
 * got a look in.
 *
 * Above conditional, below a real priority match and below the gathering rule. Cities
 * only: production in a town turns into gold rather than buildings, so a town falls back
 * the old way.
 */
const PRODUCTION_FALLBACK_SCORE_BASE = 550000000;

const CONDITIONAL_SCORE_BASE = 500000000;
const SINGLE_YIELD_SCORE_BASE = 100000000;
const MULTI_YIELD_SCORE_BASE = 50000000;
const FALLBACK_YIELD_SCORE_BASE = 10000000;

/**
 * Below everything: resources whose whole point is making units cheaper to build -
 * military, civilian or religious alike. Worth having, but never at the cost of a slot
 * that could carry a yield.
 */
const UNIT_PRODUCTION_SCORE_BASE = 1000000;

/**
 * Gathering certain resources into one settlement each.
 *
 * Turtles and silk are worth more together than spread out, so they all go to whichever
 * city already produces the most culture on its own; jade goes the same way for gold, but
 * to a different city, so the two piles do not compete for the same slots.
 *
 * This sits below the priority tier on purpose: a settlement takes what it was told to
 * prioritise first, and only what is left over gets gathered up like this. It sits above
 * the conditional tier, so gathering beats the generic "this bonus applies here" rule -
 * including, deliberately, the warehouse rule that would otherwise scatter turtles.
 *
 * Unlike everything else in this file these are resource names, because that is what was
 * asked for: a judgement about three specific resources, not a property of the data.
 */
const HOARD_SCORE_BASE = 600000000;
const HOARD_CULTURE_FIRST = 10000000;
const HOARD_TARGETS = {
    RESOURCE_TURTLES: 'YIELD_CULTURE',
    RESOURCE_SILK: 'YIELD_CULTURE',
    RESOURCE_JADE: 'YIELD_GOLD',
};

//#region eligibility
const eligibilityCache = new Map();

/** @param cityID the settlement whose answers are now stale, or null for all of them. */
export function forgetEligibility(cityID = null) {
    if (!cityID) {
        eligibilityCache.clear();
        return;
    }
    const suffix = `:${cityKey(cityID)}`;
    for (const key of [...eligibilityCache.keys()]) {
        if (key.endsWith(suffix)) {
            eligibilityCache.delete(key);
        }
    }
}

function canAssignCached(resourceValue, cityID) {
    const key = assignmentPairKey(resourceValue, cityID);
    let answer = eligibilityCache.get(key);
    if (answer === undefined) {
        answer = canAssign(cityID, resourceValue);
        eligibilityCache.set(key, answer);
    }
    return answer;
}
//#endregion

/** Finishing a factory that is already running outranks opening another one. */
const FACTORY_CONTINUE_BONUS = 3000000000;
/** How much one more spare copy of a kind is worth when choosing what to start with. */
const FACTORY_STOCK_WEIGHT = 10000000;
/** Past this, more copies stop making a difference; keeps the tier under the rescue. */
const FACTORY_STOCK_CAP = 40;

/** How many spare copies of each factory resource the pool still holds. */
function factoryStockByType(groups) {
    const stock = new Map();
    if (!isFactoryFirstEnabled()) {
        return stock;
    }
    for (const [type, group] of groups) {
        if (resourceClassOf(group[0]) === FACTORY_CLASS) {
            stock.set(type, group.length);
        }
    }
    return stock;
}

/** Which factory resource a settlement is already running, if any. */
function factoryTypeInSettlement(settlement) {
    for (const slotted of settlement.slottedResources ?? []) {
        if (resourceClassOf(slotted) === FACTORY_CLASS) {
            return resourceType(slotted);
        }
    }
    return null;
}

/**
 * The score for putting a factory resource in a settlement that has a factory, or null
 * when that is not what this pair is.
 *
 * ⚠️ The game's rule decides the shape of this, and it is not what the first version
 * assumed: "Only one type of Factory Resource can be assigned to a Settlement at a time.
 * You can assign multiple copies of the same Factory Resource to a Settlement, so it pays
 * to be efficient!" (LOC_PEDIA_CONCEPTS_FACTORY_RESOURCES_TOOLTIP).
 *
 * So spreading one apiece - which is what this did at first, by analogy with the happiness
 * rescue - is the worst thing to do. It commits every factory to a different kind, and
 * then every spare copy has exactly one settlement it may go to. With more kinds than
 * factories, most of the pool becomes unplaceable and only a handful get assigned.
 *
 * Instead: keep feeding a factory that is already running, and when starting an empty one,
 * start it on the kind with the most copies waiting - the kind that can fill it.
 */
function factoryFirstScore(resource, settlement, factoryStock, scoreContext) {
    if (!isFactoryFirstEnabled()) {
        return null;
    }
    if (!settlement.factoryResourceData?.hasFactory || resourceClassOf(resource) !== FACTORY_CLASS) {
        return null;
    }
    const type = resourceType(resource);
    const running = factoryTypeInSettlement(settlement);
    // A second kind in the same settlement is not allowed; the engine refuses it too.
    if (running && running !== type) {
        return null;
    }
    const stock = Math.min(factoryStock.get(type) ?? 0, FACTORY_STOCK_CAP);
    return (
        FACTORY_FIRST_SCORE_BASE +
        (running === type ? FACTORY_CONTINUE_BONUS : 0) +
        stock * FACTORY_STOCK_WEIGHT +
        scorePair(resource, settlement, scoreContext)
    );
}

//#region scoring
function settlementYieldTotal(settlement, yieldType) {
    return settlementYieldTotals(settlement).get(yieldType) ?? 0;
}

/**
 * Every yield this settlement currently produces.
 *
 * The screen's model only carries these as a list of icon URLs with numbers beside them,
 * so that path has to map each icon back to the yield it came from. Data built by
 * headless-model.js hands over the map directly - see the note there about what building
 * the screen's shape cost.
 */
function settlementYieldTotals(settlement) {
    if (settlement.yieldTotals instanceof Map) {
        return settlement.yieldTotals;
    }
    const totals = new Map();
    (settlement.yieldDeltas ?? []).forEach((delta) => {
        const yieldType = yieldTypeFromIcon(delta.yieldIconSrc);
        if (yieldType) {
            totals.set(yieldType, Number(delta.yieldTotal) || 0);
        }
    });
    return totals;
}

/**
 * Both of these hold for the length of ONE planning pass and are emptied at the start of
 * the next, because everything they describe is read off a board that the pass is about
 * to change.
 *
 * Within a pass the same figures are asked for again and again: `estimatedYieldBoosts`
 * for the priority yield, then for production, then for happiness, and `scorePair` from
 * as many as four branches of the same decision - all of them for the same pair, and all
 * of them returning the same number. Keyed by resource TYPE, since two copies of a
 * resource score identically.
 */
const boostsThisPass = new Map();
const scoresThisPass = new Map();

function startPlanningPass() {
    boostsThisPass.clear();
    scoresThisPass.clear();
}

function passKey(resource, settlement) {
    return `${resourceType(resource) ?? `#${String(resource.resourceValue)}`}:${cityKey(settlement.cityID)}`;
}

function estimatedYieldBoosts(resource, settlement) {
    const key = passKey(resource, settlement);
    let boosts = boostsThisPass.get(key);
    if (boosts === undefined) {
        boosts = computeYieldBoosts(resource, settlement);
        boostsThisPass.set(key, boosts);
    }
    return boosts;
}

function computeYieldBoosts(resource, settlement) {
    const applicableYields = new Set(effectiveResourceYieldTypes(resource, settlement));
    const groupedEffects = new Map();
    for (const effect of resourceYieldEffects(resource)) {
        if (!applicableYields.has(effect.yieldType)) {
            continue;
        }
        // A bonus gated on being a city, a capital, distant lands or having a certain
        // building is worth nothing where that is not true - and crediting it there is
        // how a town ended up "wanting" Jade for gold it would never see.
        if (effect.modifierId && !modifierApplies(effect.modifierId, settlement)) {
            continue;
        }
        const key = `${effect.yieldType}:${effect.effectType}`;
        if (!groupedEffects.has(key)) {
            groupedEffects.set(key, []);
        }
        const currentYield = settlementYieldTotal(settlement, effect.yieldType);
        groupedEffects.get(key).push({
            yieldType: effect.yieldType,
            value: effect.percent ? (currentYield * effect.amount) / 100 : effect.amount,
        });
    }

    const boosts = new Map();
    const conditionalStrength = conditionalBoostStrength(resource, settlement);
    groupedEffects.forEach((candidates) => {
        const values = candidates.map((candidate) => candidate.value);
        let value = conditionalStrength > 0 ? Math.max(...values) : Math.min(...values);
        if (conditionalStrength > 0 && scalesWithWarehouses(resource)) {
            value *= conditionalStrength;
        }
        const yieldType = candidates[0].yieldType;
        boosts.set(yieldType, (boosts.get(yieldType) ?? 0) + value);
    });
    return boosts;
}

function estimatedTotalBoost(resource, settlement) {
    let total = 0;
    estimatedYieldBoosts(resource, settlement).forEach((value) => {
        total += Math.max(0, value);
    });
    return total;
}

function buildScoreContext(settlements) {
    const yieldTotalsByCity = new Map();
    const specializedLoadsByCityYield = new Map();
    settlements.forEach((settlement) => {
        const key = cityKey(settlement.cityID);
        const loads = new Map();
        yieldTotalsByCity.set(key, settlementYieldTotals(settlement));
        for (const resource of settlement.slottedResources) {
            estimatedYieldBoosts(resource, settlement).forEach((value, yieldType) => {
                loads.set(yieldType, (loads.get(yieldType) ?? 0) + Math.max(0, value));
            });
        }
        specializedLoadsByCityYield.set(key, loads);
    });
    return { yieldTotalsByCity, specializedLoadsByCityYield };
}

function specializedYieldLoad(settlement, yieldType, scoreContext = null) {
    if (scoreContext) {
        return scoreContext.specializedLoadsByCityYield.get(cityKey(settlement.cityID))?.get(yieldType) ?? 0;
    }
    let total = 0;
    for (const resource of settlement.slottedResources) {
        total += Math.max(0, estimatedYieldBoosts(resource, settlement).get(yieldType) ?? 0);
    }
    return total;
}

function positiveYieldBoost(resource, settlement, yieldType) {
    return Math.max(0, estimatedYieldBoosts(resource, settlement).get(yieldType) ?? 0);
}

function settlementResourceCapacity(settlement) {
    const city = Cities.get(settlement.cityID);
    const capacity = city?.Resources?.getAssignedResourcesCap();
    if (capacity !== undefined) {
        return capacity;
    }
    return (settlement.slottedResources?.length ?? 0) + (settlement.availableSlots?.length ?? 0);
}

export function assignmentPairKey(resourceValue, cityID) {
    return `${String(resourceValue)}:${cityKey(cityID)}`;
}

function scorePair(resource, settlement, scoreContext = null) {
    const key = passKey(resource, settlement);
    const cached = scoresThisPass.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const score = computePairScore(resource, settlement, scoreContext);
    scoresThisPass.set(key, score);
    return score;
}

function computePairScore(resource, settlement, scoreContext = null) {
    const affectedYields = new Set(effectiveResourceYieldTypes(resource, settlement));
    const priority = getPriority(settlement.cityID);
    const cityYieldTotals =
        scoreContext?.yieldTotalsByCity.get(cityKey(settlement.cityID)) ?? settlementYieldTotals(settlement);
    const yieldTotals = [];
    affectedYields.forEach((yieldType) => {
        if (cityYieldTotals.has(yieldType)) {
            yieldTotals.push(cityYieldTotals.get(yieldType));
        }
    });

    const weakestAffectedYield = yieldTotals.length ? Math.min(...yieldTotals) : 0;
    const isTown = !!settlement.settlementNameData?.isTown;
    const openSlots = settlement.availableSlots?.length ?? 0;
    const actualBoost = estimatedTotalBoost(resource, settlement);
    const specializedLoad =
        priority && affectedYields.has(priority) ? specializedYieldLoad(settlement, priority, scoreContext) : 0;

    // Matching specializations balance their estimated realized yield gains.
    // Percentage resources use the settlement's current yield, not their raw rate.
    const servesPriority = !!priority && affectedYields.has(priority);
    const priorityBonus = priority ? (servesPriority ? 100000 : 0) : 10000;
    const distributionScore = servesPriority ? -specializedLoad * 100 : -weakestAffectedYield;

    // Second choice when the priority cannot be served: whatever brings production.
    const productionFallback =
        servesPriority || priority === PRODUCTION_YIELD
            ? 0
            : positiveYieldBoost(resource, settlement, PRODUCTION_YIELD) * PRODUCTION_FALLBACK_WEIGHT;

    return (
        priorityBonus +
        distributionScore +
        productionFallback +
        actualBoost * 10 +
        (isTown ? 0.25 : 0) +
        openSlots * 0.001
    );
}

/**
 * How far below zero each settlement's happiness sits right now.
 *
 * Read fresh on every pass. That is what makes the rescue level out instead of dumping
 * everything into one settlement: each assignment is chosen against the deficits left
 * after the previous one landed, so the worst settlement is fed only until it stops
 * being the worst, and then the next one takes over.
 */
/** The happiness a settlement currently produces, as the scoring reads it. */
export function settlementHappiness(settlement) {
    return settlementYieldTotal(settlement, HAPPINESS_YIELD);
}

function happinessDeficits(settlements) {
    const deficits = new Map();
    let worstCity = 0;
    let worstAnywhere = 0;

    for (const settlement of settlements) {
        const deficit = Math.max(0, -settlementYieldTotal(settlement, HAPPINESS_YIELD));
        deficits.set(cityKey(settlement.cityID), deficit);
        worstAnywhere = Math.max(worstAnywhere, deficit);
        if (!settlement.settlementNameData?.isTown) {
            worstCity = Math.max(worstCity, deficit);
        }
    }

    // Cities come first as a whole class: while any city is unhappy, no town is even
    // considered for rescue, however far below zero it may be.
    return { deficits, worstAnywhere, townsAreEligible: worstCity === 0 };
}

/**
 * The score for a pair while any settlement is unhappy, or null if this pair does not
 * help with that.
 *
 * `deficit * 1000` dominates, so the most unhappy settlement is always served first.
 * The tie-break is `min(boost, deficit)` - credit for how much of the hole a resource
 * actually fills, with no reward for overshooting it, because the goal is zero and not
 * a maximum.
 *
 * A camel scores here too, one point lower, but only in a settlement that is unhappy
 * AND full: it fixes nothing itself, it just opens the two slots that a happiness
 * resource then needs. Pointless if no happiness resource is left, hence the flag.
 */
function rescueScore(resource, settlement, deficit, isCamel, happinessResourceExists, townsAreEligible) {
    if (deficit <= 0) {
        return null;
    }
    if (settlement.settlementNameData?.isTown && !townsAreEligible) {
        return null;
    }
    const hasRoom = (settlement.availableSlots?.length ?? 0) > 0;
    const boost = positiveYieldBoost(resource, settlement, HAPPINESS_YIELD);

    if (boost > 0 && hasRoom) {
        return HAPPINESS_RESCUE_BASE + deficit * 1000 + Math.min(boost, deficit) * 10;
    }
    if (isCamel && !hasRoom && happinessResourceExists) {
        return HAPPINESS_RESCUE_BASE + deficit * 1000 - 1;
    }
    return null;
}

/**
 * A settlement's own yield, without what its assigned resources contribute.
 *
 * Not `baseYields` from the model: that is a snapshot taken when the screen opened, so it
 * still includes whatever was assigned at the time. Subtracting the estimated
 * contribution of what is slotted now gets closer to "what this settlement produces by
 * itself", using the same estimator the rest of the scoring trusts.
 */
function bareYield(settlement, yieldType, scoreContext) {
    return settlementYieldTotal(settlement, yieldType) - specializedYieldLoad(settlement, yieldType, scoreContext);
}

/**
 * Which settlement each pile goes to.
 *
 * Cities only - jade and silk both need a build queue to pay out at all, and the request
 * was for cities. The gold pile explicitly avoids the culture pile's city.
 */
function hoardTargets(settlements, scoreContext) {
    const cities = settlements.filter((settlement) => !settlement.settlementNameData?.isTown);
    const pool = cities.length > 0 ? cities : settlements;

    let cultureCity = null;
    for (const settlement of pool) {
        if (!cultureCity || bareYield(settlement, 'YIELD_CULTURE', scoreContext) >
            bareYield(cultureCity, 'YIELD_CULTURE', scoreContext)) {
            cultureCity = settlement;
        }
    }
    return { pool, cultureCityKey: cultureCity ? cityKey(cultureCity.cityID) : null };
}

/**
 * The score for gathering this resource here, or null if it is not one of the gathered
 * ones or this is not a settlement it may go to.
 *
 * The settlement's own yield is part of the score rather than a hard target, so the
 * intended city wins by having the most of it - and if that city is full, the next
 * best by the same measure takes over without any special case.
 */
function hoardScore(resource, settlement, targets, scoreContext) {
    const wanted = HOARD_TARGETS[resourceType(resource)];
    if (!wanted || !targets.pool.includes(settlement)) {
        return null;
    }
    // Culture and gold must not end up in the same settlement.
    if (wanted === 'YIELD_GOLD' && cityKey(settlement.cityID) === targets.cultureCityKey) {
        return null;
    }
    const first = wanted === 'YIELD_CULTURE' ? HOARD_CULTURE_FIRST : 0;
    return HOARD_SCORE_BASE + first + bareYield(settlement, wanted, scoreContext) * 100;
}

/**
 * The available pool, one entry per kind of resource.
 *
 * Every copy of a resource scores identically - nothing in the scoring reads anything but
 * the resource's type - so scoring all of them is repeated work, and with a large pool
 * most of the pool is copies. One representative is scored and the others come along as
 * substitutes for when the engine refuses that particular one.
 */
function groupByResourceType(resources) {
    const groups = new Map();
    for (const resource of resources) {
        // A resource whose type cannot be read is its own group rather than being lumped
        // in with every other unreadable one.
        const key = resourceType(resource) ?? `#${String(resource.resourceValue)}`;
        const group = groups.get(key);
        if (group) {
            group.push(resource);
        } else {
            groups.set(key, [resource]);
        }
    }
    return groups;
}

/** The first copy of this kind that this settlement may actually take, if any. */
function assignableCopy(group, settlement, blockedPairs) {
    for (const resource of group) {
        if (blockedPairs.has(assignmentPairKey(resource.resourceValue, settlement.cityID))) {
            continue;
        }
        if (canAssignCached(resource.resourceValue, settlement.cityID)) {
            return resource;
        }
    }
    return null;
}

export function bestAssignment(model, targetCityID = null, blockedPairs = new Set()) {
    let best = null;
    // ⚠️ Must come first: what these hold describes the board as it was before the last
    // assignment landed.
    startPlanningPass();
    const groups = groupByResourceType(pooledResources(model));
    const settlements = allSettlements(model).filter(
        (settlement) => !targetCityID || cityKey(settlement.cityID) === cityKey(targetCityID),
    );
    const scoreContext = buildScoreContext(settlements);

    const targets = hoardTargets(settlements, scoreContext);
    const factoryStock = factoryStockByType(groups);
    const { deficits, worstAnywhere, townsAreEligible } = happinessDeficits(settlements);
    const rescueNeeded = worstAnywhere > 0;
    const happinessResourceExists =
        rescueNeeded &&
        [...groups.values()].some((group) =>
            settlements.some((settlement) => positiveYieldBoost(group[0], settlement, HAPPINESS_YIELD) > 0),
        );

    for (const group of groups.values()) {
        const representative = group[0];
        const camel = resourceType(representative) === 'RESOURCE_CAMELS';
        const yieldCount = new Set(resourceYieldTypes(representative)).size;
        const yieldCountPriority =
            yieldCount === 1
                ? SINGLE_YIELD_SCORE_BASE
                : yieldCount > 1
                  ? MULTI_YIELD_SCORE_BASE
                  : FALLBACK_YIELD_SCORE_BASE;
        for (const settlement of settlements) {
            // A camel makes its own room, so a full settlement is not a reason to skip it.
            if (!camel && !settlement.availableSlots?.length) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs);
            if (!resource) {
                continue;
            }
            const rescue = rescueNeeded
                ? rescueScore(
                      resource,
                      settlement,
                      deficits.get(cityKey(settlement.cityID)) ?? 0,
                      camel,
                      happinessResourceExists,
                      townsAreEligible,
                  )
                : null;

            const conditionalStrength = conditionalBoostStrength(resource, settlement);
            const priority = getPriority(settlement.cityID);
            const priorityBoost = priority ? positiveYieldBoost(resource, settlement, priority) : 0;

            // Nothing here serves what this city asked for, but it does bring production.
            const productionBoost = positiveYieldBoost(resource, settlement, PRODUCTION_YIELD);
            const fallsBackToProduction =
                !!priority &&
                priorityBoost <= 0 &&
                priority !== PRODUCTION_YIELD &&
                productionBoost > 0 &&
                !settlement.settlementNameData?.isTown;

            const normalScore = camel
                ? CAMEL_SCORE_BASE - settlementResourceCapacity(settlement) * 10000
                : priorityBoost > 0
                  ? (conditionalStrength > 0 ? SPECIALIZED_CONDITIONAL_SCORE_BASE : SPECIALIZED_SCORE_BASE) +
                    priorityBoost * 1000000 -
                    specializedYieldLoad(settlement, priority, scoreContext) * 10000 +
                    scorePair(resource, settlement, scoreContext)
                  : fallsBackToProduction
                    ? PRODUCTION_FALLBACK_SCORE_BASE +
                      productionBoost * 1000 +
                      scorePair(resource, settlement, scoreContext)
                    : conditionalStrength > 0
                      ? CONDITIONAL_SCORE_BASE +
                        scorePair(resource, settlement, scoreContext) +
                        conditionalStrength * 1000
                      : yieldCountPriority + scorePair(resource, settlement, scoreContext);

            // A military-production resource goes to the back of the queue whatever else
            // it would have scored - but it can still be pulled forward by the happiness
            // rescue, which outranks everything.
            const ordinaryBase = givesUnitProductionBonus(resource)
                ? UNIT_PRODUCTION_SCORE_BASE + scorePair(resource, settlement, scoreContext)
                : normalScore;

            // Production belongs in cities. Note this is a nudge, not a ban: a town can
            // still take the resource when no city wants it more.
            const productionInATown =
                settlement.settlementNameData?.isTown &&
                positiveYieldBoost(resource, settlement, PRODUCTION_YIELD) > 0;
            const ordinary = productionInATown ? ordinaryBase - TOWN_PRODUCTION_PENALTY : ordinaryBase;

            // Gathering never overrides a settlement's own priority, so the two are
            // compared rather than chained: whichever reads stronger wins.
            const hoard = hoardScore(resource, settlement, targets, scoreContext);
            const placed = hoard === null ? ordinary : Math.max(ordinary, hoard);

            const factoryFirst = factoryFirstScore(resource, settlement, factoryStock, scoreContext);

            // Unhappiness outranks every other consideration; anything that does not
            // address it falls back to the ordinary order.
            const score = rescue ?? factoryFirst ?? placed;
            if (!best || score > best.score) {
                best = { resource, settlement, score, rescue: rescue !== null };
            }
        }
    }
    return best;
}
//#endregion
