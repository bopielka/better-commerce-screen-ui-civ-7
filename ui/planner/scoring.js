/**
 * Automatic resource assignment.
 *
 * ⚠️ ORIGIN, AND KEEP THIS NOTE: a port of the assignment engine from the Steam Workshop mod
 * **Resource+** (`brads-assign-all-resources`, id 3756000777) by **Br4d**, with permission. The
 * conditional-bonus table and several scoring ideas below are Br4d's work, reshaped into jobs;
 * Resource+'s per-resource locks are NOT ported.
 *
 * ⚠️ JOBS, NOT ONE MAGNITUDE TOWER (user's instruction, 2026-09-20, replacing an earlier version
 * of this file where every tier was one giant score compared by a stack of huge constants).
 * `bestAssignment` tries each job below IN ORDER and returns the first one that finds a pair;
 * every job scores and orders ONLY its own candidates, so nothing needs a constant sized to
 * out-rank a job it has never heard of. Every job still makes ONE decision per call - place.js's
 * loop re-reads the board and calls again, so happiness still "levels out" and nothing here is a
 * batch.
 *
 * Jobs, in order:
 *   1. rescue unhappiness, to at least +1 - NOT Br4d's. `townsMayBeRescued` decides who is
 *      eligible; a camel that opens room for a rescue resource is part of this job.
 *   2. factory resources into factories that can be filled, when "factories first" is on.
 *   3. the culture pile, 4. the gold pile - ONE settlement holds each role and is filled to
 *      capacity before the role moves on. The role is whichever CITY has that focus set
 *      explicitly, if any do; otherwise the best natural producer is picked automatically. A
 *      camel opens room in the role-holder once it is full and something is still waiting.
 *   5. every other explicit focus, shared EVENLY between the cities that chose it - a camel
 *      opens room here too, the same way.
 *   6. imported resources into CITIES, when "imports first" is on - double towards the Economic
 *      Victory and worth nothing in a town. ⚠️ AFTER every explicitly focused city (jobs 3-5,
 *      user's instruction, 2026-09-20) - a city the player told what to make gets first claim
 *      on an import too, and imports only sweep up what none of them wanted.
 *   7. a camel with no job above to do, placed wherever it does the most good right now.
 *   8. any city with room left, focus or not (2026-09-21, user's instruction: an empty slot is
 *      worse than one filled with something off-focus) - production when nothing else fits, then
 *      whatever conditional bonus or plain yield applies. ⚠️ A focused city's own priority still
 *      wins here first (`effectivePriority` does not stop returning it), so this job only ever
 *      reaches what job 5 left behind; job order, not a filter, is what gives focus first claim.
 *   9. every TOWN with an explicit focus that is not the culture or gold pile - the same
 *      function as job 5, run again over `towns` instead of `cities` (2026-09-21, user's
 *      instruction: towns deserve the same "focus first" step cities get before their own catch-all).
 *   10. every town with room left, focus or not - same shape as job 8, only once every town above
 *      has nothing left to want.
 *
 * ⚠️ "Balanced" means production in a city and food in a town, NOT "whatever it has least of".
 */
import { canAssign } from '../engine/operations.js';
import { modifierApplies } from './effects.js';
import { allSettlements, pooledResources } from '../model/screen-model.js';
import { isFactoryFirstEnabled } from './factory-first-setting.js';
import { isHappinessRescueEnabled, townsMayBeRescued } from './happiness-setting.js';
import { isImportsFirstEnabled } from './imports-first-setting.js';
import { isCultureGatheringEnabled, isGoldGatheringEnabled } from './hoard-setting.js';
import { cityKey, effectivePriority, getPriority } from './priorities.js';
import {
    HAPPINESS_YIELD,
    PRODUCTION_YIELD,
    conditionalBoostStrength,
    effectiveResourceYieldTypes,
    forgetImportOrigins,
    givesUnitProductionBonus,
    isImportedResource,
    resourceClassOf,
    resourceType,
    resourceYieldEffects,
    resourceYieldTypes,
    scalesWithWarehouses,
} from './facts.js';
import { onGameDataStale } from '../support/game-data.js';
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

/** How far the happiness job goes: every settlement it may touch ends at +1 or better. */
const HAPPINESS_TARGET = 1;

/**
 * How much a town is docked for a resource carrying production: a town turns production into
 * gold rather than building with it, so the same resource is worth less there. Still needed
 * inside jobs 8/9 even though cities are their own jobs now - it is a VALUATION fact, not a
 * city-over-town rule (that is the job order itself).
 */
const TOWN_PRODUCTION_PENALTY = 500000;

/** What a settlement falls back to when nothing left serves its chosen priority. */
const PRODUCTION_FALLBACK_WEIGHT = 1000;

const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';
export const CAMEL_RESOURCE_TYPE = 'RESOURCE_CAMELS';

/** Keeps the four import ranks apart within job 6. */
const IMPORT_RANK_WEIGHT = 10000000;

/** Sub-tiers within jobs 8/9 (cities, and towns) - ordering WITHIN one job only. */
const SPECIALIZED_CONDITIONAL_SCORE_BASE = 850000000;
const SPECIALIZED_SCORE_BASE = 700000000;
const PRODUCTION_FALLBACK_SCORE_BASE = 550000000;
const CONDITIONAL_SCORE_BASE = 500000000;
const SINGLE_YIELD_SCORE_BASE = 100000000;
const MULTI_YIELD_SCORE_BASE = 50000000;
const FALLBACK_YIELD_SCORE_BASE = 10000000;
/** Below everything else in jobs 8/9: resources whose only effect is making units cheaper. */
const UNIT_PRODUCTION_SCORE_BASE = 1000000;

const CULTURE_YIELD = 'YIELD_CULTURE';
const GOLD_YIELD = 'YIELD_GOLD';

//#region keys
/**
 * The settlement's key, worked out ONCE per settlement OBJECT.
 *
 * ⚠️ `cityKey` builds a string, and the scoring asks for one several times per (resource kind x
 * settlement) pair - for every placement in the run. A full empire made hundreds of thousands of
 * them for nothing.
 *
 * ⚠️ A WeakMap keyed on the OBJECT is what scopes it, the same argument as `cityBySettlement` in
 * effects.js: the planner rebuilds every settlement before each placement, and a rebuilt
 * settlement gets a fresh entry. The VALUE is stable across rebuilds, so anything comparing keys
 * across passes - the gathering ranking - still matches.
 */
const keyBySettlement = new WeakMap();

function settlementKey(settlement) {
    let key = keyBySettlement.get(settlement);
    if (key === undefined) {
        key = cityKey(settlement.cityID);
        keyBySettlement.set(settlement, key);
    }
    return key;
}

/** What the caches here key a resource by: its KIND, since the loop scores kinds, not copies. */
function resourceKey(resource) {
    return resourceType(resource) ?? `#${String(resource.resourceValue)}`;
}
//#endregion

//#region eligibility
/**
 * ⚠️ NESTED cityKey -> resourceValue -> answer, and the nesting is the point: dropping one
 * settlement's answers used to walk every key in the cache looking for a matching suffix, once
 * per placement - `pool x settlements` string comparisons and a copy of the key list, to
 * invalidate one settlement.
 */
const eligibilityByCity = new Map();

/** @param cityID the settlement whose answers are now stale, or null for all of them. */
export function forgetEligibility(cityID = null) {
    if (!cityID) {
        eligibilityByCity.clear();
        return;
    }
    eligibilityByCity.delete(cityKey(cityID));
}

function canAssignCached(resourceValue, cityID, key) {
    let byResource = eligibilityByCity.get(key);
    if (!byResource) {
        byResource = new Map();
        eligibilityByCity.set(key, byResource);
    }
    let answer = byResource.get(resourceValue);
    if (answer === undefined) {
        answer = canAssign(cityID, resourceValue);
        byResource.set(resourceValue, answer);
    }
    return answer;
}

/** The first copy of this kind that this settlement may actually take, if any. */
function assignableCopy(group, settlement, blockedPairs, key) {
    for (const resource of group) {
        // ⚠️ The pair key is only built when there is something to look up in - the normal case
        // is an empty set, and this runs per copy per settlement per placement.
        if (blockedPairs.size > 0
            && blockedPairs.has(assignmentPairKey(resource.resourceValue, settlement.cityID))) {
            continue;
        }
        if (canAssignCached(resource.resourceValue, settlement.cityID, key)) {
            return resource;
        }
    }
    return null;
}
//#endregion

/** Finishing a factory that is already running outranks opening another one. */
const FACTORY_CONTINUE_BONUS = 3000000000;
/** How much one more copy that would actually FIT is worth when choosing what to start. */
const FACTORY_STOCK_WEIGHT = 10000000;
/** Past this, more copies stop making a difference. */
const FACTORY_STOCK_CAP = 40;
/** Tie-break once two settlements would take the same number of copies: prefer the snugger. */
const FACTORY_LEFTOVER_WEIGHT = 1000;

/**
 * How many spare copies of each factory resource the pool holds - what decides which kind an
 * empty factory is started on. See factoryFirstScore for why the count matters.
 */
function factoryStockByType(groups) {
    const stock = new Map();
    if (!isFactoryFirstEnabled()) {
        return stock;
    }
    for (const group of groups.values()) {
        if (resourceClassOf(group[0]) !== FACTORY_CLASS) {
            continue;
        }
        const type = resourceType(group[0]);
        stock.set(type, (stock.get(type) ?? 0) + group.length);
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
 * The score for a factory resource in a settlement with a factory, or null.
 *
 * ⚠️ THE GAME'S RULE DECIDES THE SHAPE: only ONE type of factory resource per settlement
 * (LOC_PEDIA_CONCEPTS_FACTORY_RESOURCES_TOOLTIP). Spreading one apiece is therefore the worst
 * thing to do - every factory commits to a different kind and most of the pool becomes
 * unplaceable. Keep feeding a running factory; start an empty one on the kind with most copies.
 *
 * ⚠️ Weighed by how many would actually LAND - min(stock, free slots) - not by raw stock. With
 * 3 and 10 free slots and Coffee x10, Cocoa x3, starting Coffee in the 3-slot one places 10
 * where 13 would fit.
 */
function factoryFirstScore(resource, settlement, factoryStock, scoreContext) {
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
    const freeSlots = settlement.availableSlots?.length ?? 0;
    const wouldLand = Math.min(stock, freeSlots);
    const leftover = Math.max(0, freeSlots - stock);
    return (
        (running === type ? FACTORY_CONTINUE_BONUS : 0) +
        wouldLand * FACTORY_STOCK_WEIGHT -
        leftover * FACTORY_LEFTOVER_WEIGHT +
        scorePair(resource, settlement, scoreContext)
    );
}

//#region scoring primitives
/**
 * What a settlement currently produces of one yield.
 * ⚠️ `yieldTotals` is the Map model/headless-model.js builds; every settlement scored here comes
 * from there. The screen's model carries no such field, which is one more reason placement must
 * not go through it (place.js).
 */
function settlementYieldTotal(settlement, yieldType) {
    return settlement.yieldTotals.get(yieldType) ?? 0;
}

/**
 * ⚠️ All three are keyed cityKey -> resource KIND, and the outer level is what makes the
 * invalidation cheap: `forgetSettlementScores` drops ONE settlement, because a placement moves
 * one settlement's board and nobody else's. Clearing all three per placement made the planner
 * re-score every pair in the empire for every resource it placed.
 */
const boostsThisPass = new Map();
const scoresThisPass = new Map();
/**
 * ⚠️ The third one, and it was the one missing. `conditionalBoostStrength` walks every effect of
 * the resource through `modifierApplies`, and the main loop asked it for EVERY pair - while its
 * two neighbours above were already answered from a cache.
 */
const conditionalsThisPass = new Map();

function clearPlanningCaches() {
    boostsThisPass.clear();
    scoresThisPass.clear();
    conditionalsThisPass.clear();
}

/** This settlement's shelf in one of the caches above, made on demand. */
function bucketFor(cache, settlement) {
    const key = settlementKey(settlement);
    let bucket = cache.get(key);
    if (!bucket) {
        bucket = new Map();
        cache.set(key, bucket);
    }
    return bucket;
}

/**
 * What the placement that just landed made stale.
 *
 * ⚠️ ONE SETTLEMENT, NOT THE BOARD, and that is the difference between
 * O(placements x kinds x settlements) and O(placements x kinds). A placement changes the
 * settlement it landed in - its free slots, its yields, the factory kind it is running.
 *
 * ⚠️ WHY THE REST IS SAFE TO KEEP, and it is not "because a resource only pays where it sits" -
 * that could not be verified from the data. It is that everything a cached score is computed
 * from is FROZEN for the other settlements anyway: their yield totals come from the cache in
 * headless-model.js, which a placement loop cannot outrun, and their buildings and warehouses
 * cannot change while the loop is running. Recomputing would return the same number.
 *
 * ⚠️ Which makes the placement loop's periodic FULL re-read the other half of this: it drops
 * these caches at the same time and on the same clock as those yield totals. Break that pairing
 * and this cache starts describing a board the loop has re-read since. See place.js.
 *
 * @param cityID the settlement the placement landed in, or null to drop everything.
 */
export function forgetSettlementScores(cityID = null) {
    if (!cityID) {
        clearPlanningCaches();
        return;
    }
    const key = cityKey(cityID);
    boostsThisPass.delete(key);
    scoresThisPass.delete(key);
    conditionalsThisPass.delete(key);
}

/**
 * Which yields this resource actually pays HERE, as a set.
 *
 * ⚠️ ONE Set per (kind, town-or-city) rather than one per pair per pass: only Cowries answer
 * differently in a town, and `computePairScore` and `computeYieldBoosts` each built a fresh one
 * for every pair, for every placement.
 *
 * ⚠️ THE SET IS SHARED - never mutate what this hands back.
 */
const affectedYieldsByKind = new Map();

function affectedYields(resource, settlement) {
    const key = resourceKey(resource);
    let both = affectedYieldsByKind.get(key);
    if (!both) {
        both = { town: null, city: null };
        affectedYieldsByKind.set(key, both);
    }
    const where = settlement.settlementNameData?.isTown ? 'town' : 'city';
    let yields = both[where];
    if (!yields) {
        yields = new Set(effectiveResourceYieldTypes(resource, settlement));
        both[where] = yields;
    }
    return yields;
}

/** How many distinct yields a KIND pays anywhere; sorts single-yield before multi-yield. */
const yieldCountByKind = new Map();

function distinctYieldCount(resource) {
    const key = resourceKey(resource);
    let count = yieldCountByKind.get(key);
    if (count === undefined) {
        count = new Set(resourceYieldTypes(resource)).size;
        yieldCountByKind.set(key, count);
    }
    return count;
}

// What a resource pays and where it pays it are the age's own; see support/game-data.js.
onGameDataStale(() => {
    affectedYieldsByKind.clear();
    yieldCountByKind.clear();
});

function conditionalStrengthOf(resource, settlement) {
    const bucket = bucketFor(conditionalsThisPass, settlement);
    const key = resourceKey(resource);
    let strength = bucket.get(key);
    if (strength === undefined) {
        strength = conditionalBoostStrength(resource, settlement);
        bucket.set(key, strength);
    }
    return strength;
}

function estimatedYieldBoosts(resource, settlement) {
    const bucket = bucketFor(boostsThisPass, settlement);
    const key = resourceKey(resource);
    let boosts = bucket.get(key);
    if (boosts === undefined) {
        boosts = computeYieldBoosts(resource, settlement);
        bucket.set(key, boosts);
    }
    return boosts;
}

function computeYieldBoosts(resource, settlement) {
    const applicableYields = affectedYields(resource, settlement);
    const groupedEffects = new Map();
    for (const effect of resourceYieldEffects(resource)) {
        if (!applicableYields.has(effect.yieldType)) {
            continue;
        }
// A bonus gated on being a city, a capital, distant lands or a named constructible.
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
    const conditionalStrength = conditionalStrengthOf(resource, settlement);
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
    const specializedLoadsByCityYield = new Map();
    settlements.forEach((settlement) => {
        const loads = new Map();
        for (const resource of settlement.slottedResources) {
            estimatedYieldBoosts(resource, settlement).forEach((value, yieldType) => {
                loads.set(yieldType, (loads.get(yieldType) ?? 0) + Math.max(0, value));
            });
        }
        specializedLoadsByCityYield.set(settlementKey(settlement), loads);
    });
    return { specializedLoadsByCityYield };
}

function specializedYieldLoad(settlement, yieldType, scoreContext) {
    return scoreContext.specializedLoadsByCityYield.get(settlementKey(settlement))?.get(yieldType) ?? 0;
}

function positiveYieldBoost(resource, settlement, yieldType) {
    return Math.max(0, estimatedYieldBoosts(resource, settlement).get(yieldType) ?? 0);
}

function settlementResourceCapacity(settlement) {
    let capacity;
    try {
        capacity = Cities.get(settlement.cityID)?.Resources?.getAssignedResourcesCap();
    } catch (error) {
        warn(`could not read a settlement's resource capacity: ${error}`);
    }
    if (capacity !== undefined) {
        return capacity;
    }
    return (settlement.slottedResources?.length ?? 0) + (settlement.availableSlots?.length ?? 0);
}

export function assignmentPairKey(resourceValue, cityID) {
    return `${String(resourceValue)}:${cityKey(cityID)}`;
}

/**
 * Ties within jobs 2, 5, 6, 8 and 9: how well a resource serves what THIS settlement is asking
 * for, shared as evenly as possible with others asking for the same thing.
 */
function scorePair(resource, settlement, scoreContext) {
    const bucket = bucketFor(scoresThisPass, settlement);
    const key = resourceKey(resource);
    const cached = bucket.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const score = computePairScore(resource, settlement, scoreContext);
    bucket.set(key, score);
    return score;
}

function computePairScore(resource, settlement, scoreContext) {
    const affected = affectedYields(resource, settlement);
    const priority = effectivePriority(settlement.cityID, settlement.settlementNameData?.isTown);
    const cityYieldTotals = settlement.yieldTotals;
    const yieldTotals = [];
    affected.forEach((yieldType) => {
        if (cityYieldTotals.has(yieldType)) {
            yieldTotals.push(cityYieldTotals.get(yieldType));
        }
    });

    const weakestAffectedYield = yieldTotals.length ? Math.min(...yieldTotals) : 0;
    const isTown = !!settlement.settlementNameData?.isTown;
    const openSlots = settlement.availableSlots?.length ?? 0;
    const actualBoost = estimatedTotalBoost(resource, settlement);
/** Matching specialisations balance their estimated realised yield gains. */
    const servesPriority = affected.has(priority);
    const specializedLoad = servesPriority ? specializedYieldLoad(settlement, priority, scoreContext) : 0;
    const priorityBonus = servesPriority ? 100000 : 0;
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
//#endregion

/** The happiness a settlement currently produces, as the scoring reads it. */
export function settlementHappiness(settlement) {
    return settlementYieldTotal(settlement, HAPPINESS_YIELD);
}

//#region job 1: happiness rescue
/**
 * @see happiness-setting.js - the player decides whether this job runs, and for whom.
 * Deficit is measured against HAPPINESS_TARGET, not zero - see the constant.
 */
function happinessDeficits(settlements) {
    const deficits = new Map();
    let worstCity = 0;
    let worstAnywhere = 0;

    if (!isHappinessRescueEnabled()) {
        return { deficits, worstAnywhere: 0, townsAreEligible: false };
    }
    // "Cities only": a town's deficit is not a reason to run this job at all.
    const townsCount = townsMayBeRescued();

    for (const settlement of settlements) {
        const isTown = !!settlement.settlementNameData?.isTown;
        const deficit = Math.max(0, HAPPINESS_TARGET - settlementYieldTotal(settlement, HAPPINESS_YIELD));
        deficits.set(settlementKey(settlement), deficit);
        if (!isTown) {
            worstCity = Math.max(worstCity, deficit);
            worstAnywhere = Math.max(worstAnywhere, deficit);
        } else if (townsCount) {
            worstAnywhere = Math.max(worstAnywhere, deficit);
        }
    }

    // Cities come first as a whole class: while any city is below target, no town is even
    // considered for rescue, however far below it may be.
    return { deficits, worstAnywhere, townsAreEligible: townsCount && worstCity === 0 };
}

/**
 * The score for a pair while any settlement is below HAPPINESS_TARGET, or null when this pair
 * does not help. Cities as a class before towns, worst deficit first.
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
        return deficit * 1000 + Math.min(boost, deficit) * 10;
    }
    // ⚠️ A camel is worth one point LESS than a real happiness resource in the SAME spot, so it
    // is only chosen when nothing else is left this call - it opens room, it does not itself
    // fix anything.
    if (isCamel && !hasRoom && happinessResourceExists) {
        return deficit * 1000 - 1;
    }
    return null;
}

function tryHappinessJob(groups, settlements, blockedPairs) {
    const { deficits, worstAnywhere, townsAreEligible } = happinessDeficits(settlements);
    if (worstAnywhere <= 0) {
        return null;
    }
    // ⚠️ The Set is asked first, and it is the same answer: a boost is only ever computed for a
    // yield in it. Without it every kind was scored in every settlement - full ones included.
    const happinessResourceExists = [...groups.values()].some((group) =>
        settlements.some(
            (settlement) =>
                affectedYields(group[0], settlement).has(HAPPINESS_YIELD) &&
                positiveYieldBoost(group[0], settlement, HAPPINESS_YIELD) > 0,
        ),
    );

    let best = null;
    for (const group of groups.values()) {
        const representative = group[0];
        const camel = resourceType(representative) === CAMEL_RESOURCE_TYPE;
        for (const settlement of settlements) {
            // ⚠️ A camel is RESOURCECLASS_CITY - it can never go into a town, room or no room
            // (user correction, 2026-09-21; see the note on `camelOpensRoomFor`). Skipped outright
            // rather than left for `assignableCopy` to find out from the engine.
            if (camel && settlement.settlementNameData?.isTown) {
                continue;
            }
            // A camel makes its own room, so a full CITY is not a reason to skip it.
            if (!camel && !settlement.availableSlots?.length) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs, settlementKey(settlement));
            if (!resource) {
                continue;
            }
            const score = rescueScore(
                resource,
                settlement,
                deficits.get(settlementKey(settlement)) ?? 0,
                camel,
                happinessResourceExists,
                townsAreEligible,
            );
            if (score !== null && (!best || score > best.score)) {
                best = { resource, settlement, score, tier: 'happiness rescue' };
            }
        }
    }
    return best;
}
//#endregion

//#region job 2: factories first
function tryFactoryJob(groups, settlements, factoryStock, scoreContext, blockedPairs) {
    if (!isFactoryFirstEnabled()) {
        return null;
    }
    let best = null;
    for (const group of groups.values()) {
        if (resourceClassOf(group[0]) !== FACTORY_CLASS) {
            continue;
        }
        for (const settlement of settlements) {
            if (!settlement.factoryResourceData?.hasFactory || !settlement.availableSlots?.length) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs, settlementKey(settlement));
            if (!resource) {
                continue;
            }
            const score = factoryFirstScore(resource, settlement, factoryStock, scoreContext);
            if (score !== null && (!best || score > best.score)) {
                best = { resource, settlement, score, tier: 'factories first' };
            }
        }
    }
    return best;
}
//#endregion

//#region job 6: imports first
/**
 * Rank within job 6: serving the settlement's own explicit choice beats bringing production,
 * which beats an unspecialised settlement, which beats displacing a settlement's real plan.
 *
 * ⚠️ Rank 3 is measured against the player's EXPLICIT choice (`getPriority`), not
 * `effectivePriority`. A settlement left on Balanced has not asked for anything, so an import
 * landing there displaces no plan and belongs at rank 1.
 *
 * ⚠️ Rank 3 rarely fires now that job 6 runs AFTER jobs 3-5, which already place anything
 * matching a settlement's own explicit focus for as long as it has room; job 6 only ever reaches
 * that settlement once it is full, and skips it too (same room check as jobs 3-5). Kept rather
 * than removed - a rank that costs nothing to leave covered is not worth deleting on a guess.
 */
function importFirstScore(resource, settlement, scoreContext) {
    const chosen = getPriority(settlement.cityID);
    let rank;
    if (chosen && positiveYieldBoost(resource, settlement, chosen) > 0) {
        rank = 3;
    } else if (positiveYieldBoost(resource, settlement, PRODUCTION_YIELD) > 0) {
        rank = 2;
    } else if (!chosen) {
        rank = 1;
    } else {
        rank = 0;
    }
    return rank * IMPORT_RANK_WEIGHT + scorePair(resource, settlement, scoreContext);
}

/** Cities only, for the reason on job 6's header: an import is worth nothing in a town. */
function tryImportJob(groups, cities, scoreContext, blockedPairs) {
    if (!isImportsFirstEnabled()) {
        return null;
    }
    let best = null;
    for (const group of groups.values()) {
        if (!isImportedResource(group[0])) {
            continue;
        }
        for (const settlement of cities) {
            if (!settlement.availableSlots?.length) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs, settlementKey(settlement));
            if (!resource) {
                continue;
            }
            const score = importFirstScore(resource, settlement, scoreContext);
            if (!best || score > best.score) {
                best = { resource, settlement, score, tier: 'imports first' };
            }
        }
    }
    return best;
}
//#endregion

//#region shared: the camel that opens room, and the piles it can feed
function findCamelGroup(groups) {
    for (const group of groups.values()) {
        if (resourceType(group[0]) === CAMEL_RESOURCE_TYPE) {
            return group;
        }
    }
    return null;
}

/**
 * A camel to place into `settlement` so it can take more of `yieldType`, or null.
 *
 * ⚠️ Universal across every focused job (user's instruction, 2026-09-20) - not only the culture
 * and gold piles. Only fires once the settlement is already FULL and something that still pays
 * this yield is waiting elsewhere in the pool; a settlement with room is served by the job's own
 * ordinary scoring instead.
 *
 * ⚠️ A CAMEL IS A CITY RESOURCE (`ResourceClassType="RESOURCECLASS_CITY"`) - it can never be
 * assigned to a town, room or no room (user correction, 2026-09-21; the game's own drag
 * validation in `commerce-screen-resources-tab.js` refuses any `RESOURCECLASS_CITY` resource
 * dropped on a town with a generic, class-wide message, not a Camel-specific one). A town is
 * refused before the engine is even asked, both because that is the rule and because asking the
 * engine a question the data already answers wastes a call every time this job reaches job 9's
 * town list.
 */
function camelOpensRoomFor(camelGroup, groups, settlement, yieldType, blockedPairs) {
    if (!camelGroup || settlement.settlementNameData?.isTown || (settlement.availableSlots?.length ?? 0) > 0) {
        return null;
    }
    const stillWaiting = [...groups.values()].some(
        (group) => group !== camelGroup && positiveYieldBoost(group[0], settlement, yieldType) > 0,
    );
    if (!stillWaiting) {
        return null;
    }
    return assignableCopy(camelGroup, settlement, blockedPairs, settlementKey(settlement));
}

/** Cities in `candidates` ranked by how much of `yieldType` they already make, best first. */
function rankByYield(candidates, yieldType, scoreContext) {
    return [...candidates]
        .sort((a, b) => bareYield(b, yieldType, scoreContext) - bareYield(a, yieldType, scoreContext))
        .map((settlement) => settlementKey(settlement));
}

/** A settlement's own yield, without what its assigned resources contribute. */
function bareYield(settlement, yieldType, scoreContext) {
    return settlementYieldTotal(settlement, yieldType) - specializedYieldLoad(settlement, yieldType, scoreContext);
}
//#endregion

//#region jobs 3 and 4: the culture pile and the gold pile
/**
 * ⚠️ ONE settlement holds each role, filled to capacity before the role moves on - unlike job 5,
 * which shares a shared focus EVENLY. The two piles alone concentrate rather than spread,
 * because their bonuses are largely PERCENTAGE effects that compound where the base yield is
 * already highest (user's instruction, 2026-09-20, matching the reasoning this file already had
 * for the automatic case). See the header for the full list of these two jobs.
 *
 * ⚠️ Ranking is settled ONCE per run and only who currently has room moves - see
 * `pileRankingThisRun` and `startPlacementRun`. Re-ranking every call let the leader hand the
 * role to a rival partway through and split the pile between two settlements.
 */
const pileRankingThisRun = new Map();
const lastLoggedPileTarget = new Map();

/** One line whenever a pile's target changes, so a handover is visible in the log. */
function logPileTarget(tierLabel, byKey, targetKey) {
    if (!DIAGNOSTICS) {
        return;
    }
    const name = targetKey
        ? (byKey.get(targetKey)?.settlementNameData?.settlementName ?? `#${targetKey}`)
        : 'none (full or off)';
    const line = `${tierLabel} -> ${name}`;
    if (lastLoggedPileTarget.get(tierLabel) !== line) {
        lastLoggedPileTarget.set(tierLabel, line);
        log(line);
    }
}

/** Tries every non-camel candidate against ONE target settlement; the first fit wins. */
function tryOrdinaryPileFit(groups, target, yieldType, blockedPairs) {
    const key = settlementKey(target);
    for (const group of groups.values()) {
        if (resourceType(group[0]) === CAMEL_RESOURCE_TYPE) {
            continue;
        }
        if (!(positiveYieldBoost(group[0], target, yieldType) > 0)) {
            continue;
        }
        const resource = assignableCopy(group, target, blockedPairs, key);
        if (resource) {
            return resource;
        }
    }
    return null;
}

/**
 * @param yieldType CULTURE_YIELD or GOLD_YIELD.
 * @param hosts candidate settlements for the role - cities, or towns when the empire has none
 *   (see `pileHosts` in `bestAssignment`).
 * @param automaticEnabled the player's switch for the UNREQUESTED version of this pile
 *   (hoard-setting.js) - irrelevant once a settlement asks for this focus explicitly, because
 *   that is an instruction, not a guess.
 */
function tryPileJob(yieldType, tierLabel, groups, hosts, scoreContext, blockedPairs, automaticEnabled) {
    const focused = hosts.filter((settlement) => getPriority(settlement.cityID) === yieldType);
    const explicit = focused.length > 0;
    if (!explicit && !automaticEnabled) {
        return null;
    }
    const candidates = explicit ? focused : hosts;
    if (candidates.length === 0) {
        return null;
    }

    let ranking = pileRankingThisRun.get(yieldType);
    if (!ranking) {
        ranking = rankByYield(candidates, yieldType, scoreContext);
        pileRankingThisRun.set(yieldType, ranking);
    }
    const byKey = new Map(candidates.map((settlement) => [settlementKey(settlement), settlement]));

    /*
     * ⚠️ THE BEST PRODUCER GETS FIRST REFUSAL ON EVERY COPY, even once it is full - a camel
     * opening two more slots there beats moving to a worse producer while one is still available
     * (user's instruction, 2026-09-20, fixing a bug: the earlier version moved to the next
     * candidate WITH ROOM before ever trying a camel on the best one, so two Silk copies split
     * across two cities instead of a camel keeping both in the first). Only once the best
     * producer can take nothing more - full with no camel able to help, or nothing left pays
     * this yield anywhere - does the role move on.
     */
    const bestKey = ranking[0];
    const bestSettlement = bestKey ? byKey.get(bestKey) : null;
    const camelGroup = findCamelGroup(groups);
    if (bestSettlement) {
        const resource = tryOrdinaryPileFit(groups, bestSettlement, yieldType, blockedPairs);
        if (resource) {
            logPileTarget(tierLabel, byKey, bestKey);
            return {
                resource,
                settlement: bestSettlement,
                score: bareYield(bestSettlement, yieldType, scoreContext),
                tier: tierLabel,
            };
        }
        const camelResource = camelOpensRoomFor(camelGroup, groups, bestSettlement, yieldType, blockedPairs);
        if (camelResource) {
            logPileTarget(tierLabel, byKey, bestKey);
            return { resource: camelResource, settlement: bestSettlement, score: 1, tier: `${tierLabel} (camel)` };
        }
    }

    // The best producer has nothing left to take: hand the role to the next candidate with room.
    const targetKey =
        ranking.find((key) => key !== bestKey && (byKey.get(key)?.availableSlots?.length ?? 0) > 0) ?? null;
    logPileTarget(tierLabel, byKey, targetKey);
    if (!targetKey) {
        return null;
    }
    const target = byKey.get(targetKey);
    const resource = tryOrdinaryPileFit(groups, target, yieldType, blockedPairs);
    return resource
        ? { resource, settlement: target, score: bareYield(target, yieldType, scoreContext), tier: tierLabel }
        : null;
}
//#endregion

//#region jobs 5 and 9: every other explicit focus
/**
 * Settlements with an explicit focus that is not the culture or gold pile - those go through
 * jobs 3/4. Shared by job 5 (`settlements` = cities) and job 9 (`settlements` = towns, 2026-09-21,
 * user's instruction: towns deserve the same "focus first" treatment cities get, ahead of their
 * own catch-all) - the logic does not care which settlement class it is handed, since
 * `effectivePriority` already returns the explicit choice regardless of the `isTown` it is passed.
 */
function tryFocusedSettlementsJob(groups, settlements, scoreContext, blockedPairs, tierLabel) {
    const focused = settlements.filter((settlement) => {
        const priority = getPriority(settlement.cityID);
        return priority !== null && priority !== CULTURE_YIELD && priority !== GOLD_YIELD;
    });
    if (focused.length === 0) {
        return null;
    }

    let best = null;
    for (const group of groups.values()) {
        if (resourceType(group[0]) === CAMEL_RESOURCE_TYPE) {
            continue;
        }
        for (const settlement of focused) {
            if (!settlement.availableSlots?.length) {
                continue;
            }
            const priority = effectivePriority(settlement.cityID, false);
            if (!(positiveYieldBoost(group[0], settlement, priority) > 0)) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs, settlementKey(settlement));
            if (!resource) {
                continue;
            }
            const score = scorePair(resource, settlement, scoreContext);
            if (!best || score > best.score) {
                best = { resource, settlement, score, tier: tierLabel };
            }
        }
    }
    if (best) {
        return best;
    }

    // Nothing fits with room to spare: a camel may still open room in a full settlement that is
    // waiting on a resource matching its own chosen focus.
    const camelGroup = findCamelGroup(groups);
    if (!camelGroup) {
        return null;
    }
    for (const settlement of focused) {
        const priority = effectivePriority(settlement.cityID, false);
        const resource = camelOpensRoomFor(camelGroup, groups, settlement, priority, blockedPairs);
        if (resource) {
            return { resource, settlement, score: 1, tier: `${tierLabel} (camel)` };
        }
    }
    return null;
}
//#endregion

//#region job 7: the camel with nowhere more important to go
/**
 * ⚠️ Runs AFTER jobs 1-6, deliberately - a camel used here first would starve job 3/4/5's own
 * "open room for the focus that wants it" need, which is a more specific, more useful use of the
 * same resource. Smaller-capacity settlements are preferred: two open slots matter more,
 * proportionally, in a settlement that has fewer of them.
 *
 * ⚠️ CITIES ONLY (user correction, 2026-09-21 - a camel is `RESOURCECLASS_CITY`, so it can never
 * go into a town; see the note on `camelOpensRoomFor`). Filtered here, before `settlements` is
 * even walked, rather than relying on the engine to refuse every town in turn.
 *
 * ⚠️ Job 9 (a TOWN's own explicit focus) runs AFTER this one, unlike jobs 3/4/5 - so a camel this
 * job hands to some unfocused city is one job 9 can no longer use to open room for a focused town.
 * Accepted, not fixed: towns are strictly after cities in every job that routes by explicit focus
 * (see divergence 16 in the docs), and moving job 9 ahead of this one would put a town's focus
 * ahead of job 8's cities, which the ordering exists to prevent.
 */
function tryGenericCamelJob(groups, settlements, blockedPairs) {
    const camelGroup = findCamelGroup(groups);
    if (!camelGroup) {
        return null;
    }
    let best = null;
    for (const settlement of settlements) {
        if (settlement.settlementNameData?.isTown) {
            continue;
        }
        const resource = assignableCopy(camelGroup, settlement, blockedPairs, settlementKey(settlement));
        if (!resource) {
            continue;
        }
        const score = -settlementResourceCapacity(settlement);
        if (!best || score > best.score) {
            best = { resource, settlement, score, tier: 'camel' };
        }
    }
    return best;
}
//#endregion

//#region jobs 8 and 9: cities, and towns
/**
 * Shared by jobs 8 and 9. ⚠️ Job 8 hands in EVERY city with room, focus or not (2026-09-21,
 * user's instruction) - `effectivePriority` still returns a focused city's own priority rather
 * than Balanced, so this only ever fills what job 5 left behind: anything matching a focus was
 * already claimed there, since job 5 runs earlier in `buildJobs` and job order is what gives
 * focus first claim, not a filter on which cities reach this function.
 * `TOWN_PRODUCTION_PENALTY` only ever fires for job 9's own settlements.
 */
function tryOrdinaryJob(groups, settlements, scoreContext, blockedPairs, tierPrefix) {
    let best = null;
    for (const group of groups.values()) {
        const representative = group[0];
        if (resourceType(representative) === CAMEL_RESOURCE_TYPE) {
            continue;
        }
        // ⚠️ Once per KIND, on its first settlement: every copy in a group has the group's type,
        // and `distinctYieldCount` is cached, but the branch it feeds is still worth hoisting.
        const yieldCount = distinctYieldCount(representative);
        const yieldCountPriority =
            yieldCount === 1
                ? SINGLE_YIELD_SCORE_BASE
                : yieldCount > 1
                  ? MULTI_YIELD_SCORE_BASE
                  : FALLBACK_YIELD_SCORE_BASE;
        let unitProduction = null;

        for (const settlement of settlements) {
            if (!settlement.availableSlots?.length) {
                continue;
            }
            const resource = assignableCopy(group, settlement, blockedPairs, settlementKey(settlement));
            if (!resource) {
                continue;
            }

            const isTown = !!settlement.settlementNameData?.isTown;
            const conditionalStrength = conditionalStrengthOf(resource, settlement);
            const priority = effectivePriority(settlement.cityID, isTown);
            const priorityBoost = positiveYieldBoost(resource, settlement, priority);
            // Cities only: production in a town turns into gold rather than buildings.
            const productionBoost = positiveYieldBoost(resource, settlement, PRODUCTION_YIELD);
            const fallsBackToProduction =
                priorityBoost <= 0 && priority !== PRODUCTION_YIELD && productionBoost > 0 && !isTown;

            let score;
            let tier;
            if (priorityBoost > 0) {
                score =
                    (conditionalStrength > 0 ? SPECIALIZED_CONDITIONAL_SCORE_BASE : SPECIALIZED_SCORE_BASE) +
                    priorityBoost * 1000000 -
                    specializedYieldLoad(settlement, priority, scoreContext) * 10000 +
                    scorePair(resource, settlement, scoreContext);
                tier = conditionalStrength > 0 ? `priority+conditional ${priority}` : `priority ${priority}`;
            } else if (fallsBackToProduction) {
                score =
                    PRODUCTION_FALLBACK_SCORE_BASE +
                    productionBoost * 1000 +
                    scorePair(resource, settlement, scoreContext);
                tier = `production fallback (wanted ${priority})`;
            } else if (conditionalStrength > 0) {
                score = CONDITIONAL_SCORE_BASE + scorePair(resource, settlement, scoreContext) + conditionalStrength * 1000;
                tier = 'conditional';
            } else {
                score = yieldCountPriority + scorePair(resource, settlement, scoreContext);
                tier = 'plain yield';
            }

            if (unitProduction === null) {
                unitProduction = givesUnitProductionBonus(resource);
            }
            if (unitProduction) {
                score = UNIT_PRODUCTION_SCORE_BASE + scorePair(resource, settlement, scoreContext);
                tier = 'unit production';
            }

            if (isTown && productionBoost > 0) {
                score -= TOWN_PRODUCTION_PENALTY;
                tier += ' -town penalty';
            }

            if (!best || score > best.score) {
                best = { resource, settlement, score, tier: `${tierPrefix}: ${tier}` };
            }
        }
    }
    return best;
}
//#endregion

/** The available pool, one entry per KIND of resource - the loop scores kinds, not copies. */
function groupByResourceType(resources) {
    const groups = new Map();
    for (const resource of resources) {
        // A resource whose type cannot be read is its own group rather than being lumped
        // in with every other unreadable one.
        const type = resourceType(resource) ?? `#${String(resource.resourceValue)}`;
        const key = `${type}|${isImportedResource(resource) ? 'import' : 'ours'}`;
        const group = groups.get(key);
        if (group) {
            group.push(resource);
        } else {
            groups.set(key, [resource]);
        }
    }
    return groups;
}

/** Called at the start of a placement run; the board has moved on since the last one. */
export function startPlacementRun() {
    pileRankingThisRun.clear();
    lastLoggedPileTarget.clear();
    // The board this run scores is not the one the last run left behind.
    clearPlanningCaches();
    // A captured city changes whose resources are imports. facts.js also drops these when a
    // settlement changes hands; this keeps every run honest should that event list miss one.
    forgetImportOrigins();
}

/**
 * The ten jobs, in order, by key - built fresh per call since several close over this call's
 * `groups`/`settlements`/etc. ⚠️ THE ONE PLACE THE ORDER IS WRITTEN DOWN: `bestAssignment`'s own
 * `??` chain below reads this array, and so does `JOB_LIST` - change the order here and both
 * follow, rather than three lists that can drift apart.
 */
function buildJobs({ groups, settlements, cities, towns, pileHosts, scoreContext, factoryStock, blockedPairs }) {
    return [
        { key: 'happiness', run: () => tryHappinessJob(groups, settlements, blockedPairs) },
        { key: 'factory', run: () => tryFactoryJob(groups, settlements, factoryStock, scoreContext, blockedPairs) },
        {
            key: 'culturePile',
            run: () =>
                tryPileJob(
                    CULTURE_YIELD, 'culture pile', groups, pileHosts, scoreContext, blockedPairs,
                    isCultureGatheringEnabled(),
                ),
        },
        {
            key: 'goldPile',
            run: () =>
                tryPileJob(
                    GOLD_YIELD, 'gold pile', groups, pileHosts, scoreContext, blockedPairs,
                    isGoldGatheringEnabled(),
                ),
        },
        {
            key: 'focusedCities',
            run: () => tryFocusedSettlementsJob(groups, cities, scoreContext, blockedPairs, 'priority focus'),
        },
        { key: 'imports', run: () => tryImportJob(groups, cities, scoreContext, blockedPairs) },
        { key: 'camel', run: () => tryGenericCamelJob(groups, settlements, blockedPairs) },
        { key: 'cities', run: () => tryOrdinaryJob(groups, cities, scoreContext, blockedPairs, 'city') },
        {
            key: 'focusedTowns',
            run: () =>
                tryFocusedSettlementsJob(groups, towns, scoreContext, blockedPairs, 'priority focus (town)'),
        },
        { key: 'towns', run: () => tryOrdinaryJob(groups, towns, scoreContext, blockedPairs, 'town') },
    ];
}

/**
 * Every job's key and a short label, in run order - for anything that needs to name or list them
 * rather than run `bestAssignment` itself. ⚠️ DEV-PANEL ONLY CONSUMER TODAY: `screen/dev-panel.js`
 * uses this to offer each job on its own button, through `runOnlyJob` in `run.js`.
 */
export const JOB_LIST = [
    { key: 'happiness', label: '1. Happiness rescue' },
    { key: 'factory', label: '2. Factories first' },
    { key: 'culturePile', label: '3. Culture pile' },
    { key: 'goldPile', label: '4. Gold pile' },
    { key: 'focusedCities', label: '5. Other explicit focus' },
    { key: 'imports', label: '6. Imports first' },
    { key: 'camel', label: '7. Generic camel' },
    { key: 'cities', label: '8. Cities' },
    { key: 'focusedTowns', label: '9. Towns with explicit focus' },
    { key: 'towns', label: '10. Towns' },
];

/**
 * Tries every job in order and returns the first placement any of them finds, or null.
 *
 * @param onlyJob a `JOB_LIST` key to try ALONE instead of the full order - for the dev panel's
 *   per-job buttons. Anything else the loop does (board re-reads, confirmation, refusal handling)
 *   is unchanged; only which job(s) get asked narrows.
 *
 * ⚠️ NOTHING IS CLEARED HERE. What the caches hold is per settlement, and the only caller is the
 * placement loop, which says which settlement the last placement moved -
 * `forgetSettlementScores` in place.js, beside `forgetEligibility`. `startPlacementRun` empties
 * them for a run that is starting.
 */
export function bestAssignment(model, targetCityID = null, blockedPairs = new Set(), { onlyJob = null } = {}) {
    const groups = groupByResourceType(pooledResources(model));
    /*
     * ⚠️ The whole empire, then the filter - not the other way round. Quick-assigning one
     * settlement must not make it the culture city by default, and `buildScoreContext` has to
     * cover every settlement the gathering targets are compared across.
     */
    const everySettlement = allSettlements(model);
    const scoreContext = buildScoreContext(everySettlement);
    const settlements = everySettlement.filter(
        (settlement) => !targetCityID || settlementKey(settlement) === cityKey(targetCityID),
    );
    if (settlements.length === 0 || groups.size === 0) {
        return null;
    }

    const cities = settlements.filter((settlement) => !settlement.settlementNameData?.isTown);
    const towns = settlements.filter((settlement) => settlement.settlementNameData?.isTown);
    const factoryStock = factoryStockByType(groups);
    // ⚠️ An empire with no cities at all still gets a culture/gold pile, built from its towns -
    // matches the game asking for a settlement to gather in, not specifically a city, when there
    // is no city to ask instead.
    const pileHosts = cities.length > 0 ? cities : towns;

    const jobs = buildJobs({ groups, settlements, cities, towns, pileHosts, scoreContext, factoryStock, blockedPairs });

    if (onlyJob) {
        return jobs.find((job) => job.key === onlyJob)?.run() ?? null;
    }
    for (const job of jobs) {
        const plan = job.run();
        if (plan) {
            return plan;
        }
    }
    return null;
}
