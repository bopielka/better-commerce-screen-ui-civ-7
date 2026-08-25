/**
 * Automatic resource assignment.
 *
 * ⚠️ ORIGIN, AND KEEP THIS NOTE: a port of the assignment engine from the Steam Workshop mod
 * **Resource+** (`brads-assign-all-resources`, id 3756000777) by **Br4d**, with permission. The
 * scoring constants, the ordering rules, the conditional-bonus table and the shape of
 * `bestAssignment` are Br4d's work. Resource+'s per-resource locks are NOT ported.
 *
 * Tiers, best first:
 *   0.  rescue unhappiness - NOT Br4d's, sits above everything, and is why this file diverges.
 *       How far it goes is the player's: happiness-setting.js.
 *   0b. factory resources into factories that can be filled, when "factories first" is on.
 *   1.  camels - they bring two slots with them, so placing them early makes room.
 *   1b. imported resources into CITIES, when "imports first" is on: double towards the Economic
 *       Victory and worth nothing in a town.
 *   2.  resources whose conditional criteria are met there (conditionalBoostStrength).
 *   3.  single-yield before multi-yield; unit-production-only resources last.
 *   4.  within all of that, settlements matching their priority share the yield gain evenly, and
 *       how well a resource serves that priority dominates.
 *   4b. when nothing serves a city's priority, production comes next.
 *   5.  a resource carrying production is nudged away from towns, which turn it into gold.
 *   6.  culture gathered into one city, gold into another - outranks the conditional tier but
 *       never a settlement's own priority. Either pile can be switched off.
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
    yieldTypeFromIcon,
} from './facts.js';
import { DIAGNOSTICS, log } from '../support/diagnostics.js';

/** Above everything else, including camels: no settlement should sit on negative happiness. */
const HAPPINESS_RESCUE_BASE = 10000000000;
/**
 * How much a town is docked for a resource carrying production: a town turns production into
 * gold rather than building with it, so the same resource is worth less there.
 */
const TOWN_PRODUCTION_PENALTY = 500000;

/** What a settlement falls back to when nothing left serves its chosen priority. */
const PRODUCTION_FALLBACK_WEIGHT = 1000;

/** "Factories first" unless switched off: fill the settlements that have a factory. */
const FACTORY_FIRST_SCORE_BASE = 5000000000;
const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

const CAMEL_SCORE_BASE = 1000000000;

/**
 * "Imports first", when asked for: everything that arrived over a trade route goes into CITIES
 * before anything of your own.
 *
 * ⚠️ Cities only. Towards the Economic Victory a slotted resource is worth +1 GDP and an imported
 * one +1 more - but only in a city; in a town it is worth nothing at all.
 */
const IMPORT_FIRST_SCORE_BASE = 900000000;
/** Keeps the four ranks below apart, and the whole tier under CAMEL_SCORE_BASE. */
const IMPORT_RANK_WEIGHT = 10000000;

const SPECIALIZED_CONDITIONAL_SCORE_BASE = 850000000;
const SPECIALIZED_SCORE_BASE = 700000000;
/**
 * A settlement whose priority nothing can serve takes production instead - ahead of a resource
 * whose conditional bonus merely happens to apply there.
 */
const PRODUCTION_FALLBACK_SCORE_BASE = 550000000;

const CONDITIONAL_SCORE_BASE = 500000000;
const SINGLE_YIELD_SCORE_BASE = 100000000;
const MULTI_YIELD_SCORE_BASE = 50000000;
const FALLBACK_YIELD_SCORE_BASE = 10000000;

/** Below everything: resources whose only effect is making units cheaper to build. */
const UNIT_PRODUCTION_SCORE_BASE = 1000000;

/**
 * Building a culture settlement and a gold settlement without being asked.
 *
 * A +10% Culture resource in a settlement making 12 Culture is worth about a point; gathered
 * where the yield is already largest they compound. Outranks the conditional tier and never a
 * settlement's own priority. Both piles are switchable; see hoard-setting.js.
 */
const HOARD_SCORE_BASE = 600000000;
const HOARD_CULTURE_FIRST = 10000000;
const CULTURE_YIELD = 'YIELD_CULTURE';
const GOLD_YIELD = 'YIELD_GOLD';

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
/** How much one more copy that would actually FIT is worth when choosing what to start. */
const FACTORY_STOCK_WEIGHT = 10000000;
/** Past this, more copies stop making a difference; keeps the tier under the rescue. */
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
    const freeSlots = settlement.availableSlots?.length ?? 0;
    const wouldLand = Math.min(stock, freeSlots);
    const leftover = Math.max(0, freeSlots - stock);
    return (
        FACTORY_FIRST_SCORE_BASE +
        (running === type ? FACTORY_CONTINUE_BONUS : 0) +
        wouldLand * FACTORY_STOCK_WEIGHT -
        leftover * FACTORY_LEFTOVER_WEIGHT +
        scorePair(resource, settlement, scoreContext)
    );
}

//#region scoring
function settlementYieldTotal(settlement, yieldType) {
    return settlementYieldTotals(settlement).get(yieldType) ?? 0;
}

/** Every yield this settlement currently produces. */
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
 * ⚠️ Both hold for ONE planning pass and are emptied at the start of the next: they describe a
 * board that the last placement has already moved on.
 */
const boostsThisPass = new Map();
const scoresThisPass = new Map();
/**
 * ⚠️ The third one, and it was the one missing. `conditionalBoostStrength` walks every effect of
 * the resource through `modifierApplies`, and the main loop asked it for EVERY pair - while its
 * two neighbours above were already answered from a cache.
 */
const conditionalsThisPass = new Map();

function startPlanningPass() {
    boostsThisPass.clear();
    scoresThisPass.clear();
    conditionalsThisPass.clear();
}

function conditionalStrengthOf(resource, settlement) {
    const key = passKey(resource, settlement);
    let strength = conditionalsThisPass.get(key);
    if (strength === undefined) {
        strength = conditionalBoostStrength(resource, settlement);
        conditionalsThisPass.set(key, strength);
    }
    return strength;
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
    const priority = effectivePriority(settlement.cityID, settlement.settlementNameData?.isTown);
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
/** Matching specialisations balance their estimated realised yield gains. */
    const servesPriority = affectedYields.has(priority);
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

/** The happiness a settlement currently produces, as the scoring reads it. */
export function settlementHappiness(settlement) {
    return settlementYieldTotal(settlement, HAPPINESS_YIELD);
}

/**
 * @see happiness-setting.js - the player decides whether this tier runs, and for whom.
 */
function happinessDeficits(settlements) {
    const deficits = new Map();
    let worstCity = 0;
    let worstAnywhere = 0;

    if (!isHappinessRescueEnabled()) {
        return { deficits, worstAnywhere: 0, townsAreEligible: false };
    }
    // "Cities only": a town's deficit is not a reason to run the tier at all.
    const townsCount = townsMayBeRescued();

    for (const settlement of settlements) {
        const isTown = !!settlement.settlementNameData?.isTown;
        const deficit = Math.max(0, -settlementYieldTotal(settlement, HAPPINESS_YIELD));
        deficits.set(cityKey(settlement.cityID), deficit);
        if (!isTown) {
            worstCity = Math.max(worstCity, deficit);
            worstAnywhere = Math.max(worstAnywhere, deficit);
        } else if (townsCount) {
            worstAnywhere = Math.max(worstAnywhere, deficit);
        }
    }

    // Cities come first as a whole class: while any city is unhappy, no town is even
    // considered for rescue, however far below zero it may be.
    return { deficits, worstAnywhere, townsAreEligible: townsCount && worstCity === 0 };
}

/**
 * The score for a pair while any settlement is unhappy, or null when this pair does not help.
 * Cities as a class before towns, worst deficit first.
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

/** A settlement's own yield, without what its assigned resources contribute. */
function bareYield(settlement, yieldType, scoreContext) {
    return settlementYieldTotal(settlement, yieldType) - specializedYieldLoad(settlement, yieldType, scoreContext);
}

/**
 * The one culture settlement and the one gold settlement, chosen ONCE for a whole run.
 *
 * ⚠️ Exactly ONE holds each role. Scoring every non-culture city weighted by its own gold is
 * "spread gold around", not "build a gold settlement".
 *
 * ⚠️ But it is a ROLE, not a fixed settlement: when the holder runs out of room the next-best city
 * takes over. ⚠️ Only KEYS are cached - the settlement objects are rebuilt before every pass.
 */
let hoardRankingThisRun = null;
let lastLoggedTargets = '';

/** Called at the start of a placement run; the board has moved on since the last one. */
export function startPlacementRun() {
    hoardRankingThisRun = null;
    lastLoggedTargets = '';
    // A captured city changes whose resources are imports, and that can only happen
    // between runs.
    forgetImportOrigins();
}

/** Cities ordered by how much of each yield they make on their own, best first. */
function hoardRanking(settlements, scoreContext) {
    if (hoardRankingThisRun) {
        return hoardRankingThisRun;
    }
    const cities = settlements.filter((settlement) => !settlement.settlementNameData?.isTown);
    const pool = cities.length > 0 ? cities : settlements;

    const rankedBy = (yieldType) =>
        [...pool]
            .sort((a, b) => bareYield(b, yieldType, scoreContext) - bareYield(a, yieldType, scoreContext))
            .map((settlement) => cityKey(settlement.cityID));

    hoardRankingThisRun = {
        culture: isCultureGatheringEnabled() ? rankedBy(CULTURE_YIELD) : [],
        gold: isGoldGatheringEnabled() ? rankedBy(GOLD_YIELD) : [],
    };
    return hoardRankingThisRun;
}

/** Which settlement holds each role: the highest-ranked city that still has room. */
function hoardTargets(settlements, scoreContext) {
    const ranking = hoardRanking(settlements, scoreContext);
    const byKey = new Map(settlements.map((settlement) => [cityKey(settlement.cityID), settlement]));
    const hasRoom = (key) => (byKey.get(key)?.availableSlots?.length ?? 0) > 0;

    const cultureCityKey = ranking.culture.find(hasRoom) ?? null;
    const goldCityKey = ranking.gold.find((key) => key !== cultureCityKey && hasRoom(key)) ?? null;

    const targets = { cultureCityKey, goldCityKey };
    logHoardTargets(byKey, targets);
    return targets;
}

/** One line whenever the pair changes, so a role being handed on is visible in the log. */
function logHoardTargets(byKey, targets) {
    if (!DIAGNOSTICS) {
        return;
    }
    const name = (key) =>
        key ? byKey.get(key)?.settlementNameData?.settlementName ?? `#${key}` : 'none (full or off)';
    const line = `gathering: culture -> ${name(targets.cultureCityKey)}, gold -> ${name(targets.goldCityKey)}`;
    if (line !== lastLoggedTargets) {
        lastLoggedTargets = line;
        log(line);
    }
}

/** The score for gathering this resource here, or null if this is not one of the two piles. */
function hoardScore(resource, settlement, targets, scoreContext) {
    const key = cityKey(settlement.cityID);

    if (key === targets.cultureCityKey && positiveYieldBoost(resource, settlement, CULTURE_YIELD) > 0) {
        return HOARD_SCORE_BASE + HOARD_CULTURE_FIRST + bareYield(settlement, CULTURE_YIELD, scoreContext) * 100;
    }
    if (key === targets.goldCityKey && positiveYieldBoost(resource, settlement, GOLD_YIELD) > 0) {
        return HOARD_SCORE_BASE + bareYield(settlement, GOLD_YIELD, scoreContext) * 100;
    }
    return null;
}

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

/**
 * The score for an imported resource in a city, or null when that is not what this pair is.
 * ⚠️ Cities only, for the reason on IMPORT_FIRST_SCORE_BASE.
 */
function importFirstScore(resource, settlement, scoreContext) {
    if (!isImportsFirstEnabled() || settlement.settlementNameData?.isTown) {
        return null;
    }
    if (!isImportedResource(resource)) {
        return null;
    }

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
    return IMPORT_FIRST_SCORE_BASE + rank * IMPORT_RANK_WEIGHT + scorePair(resource, settlement, scoreContext);
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
    /*
     * ⚠️ The whole empire, then the filter - not the other way round. Quick-assigning one
     * settlement must not make it the culture city by default, and `buildScoreContext` has to
     * cover every settlement the gathering targets are compared across.
     */
    const everySettlement = allSettlements(model);
    const scoreContext = buildScoreContext(everySettlement);
    const settlements = everySettlement.filter(
        (settlement) => !targetCityID || cityKey(settlement.cityID) === cityKey(targetCityID),
    );

    const targets = hoardTargets(everySettlement, scoreContext);
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

            const conditionalStrength = conditionalStrengthOf(resource, settlement);
            const priority = effectivePriority(settlement.cityID, settlement.settlementNameData?.isTown);
            const priorityBoost = positiveYieldBoost(resource, settlement, priority);

            // Nothing here serves what this city asked for, but it does bring production.
            const productionBoost = positiveYieldBoost(resource, settlement, PRODUCTION_YIELD);
            const fallsBackToProduction =
                priorityBoost <= 0 &&
                priority !== PRODUCTION_YIELD &&
                productionBoost > 0 &&
                !settlement.settlementNameData?.isTown;

    // ⚠️ Every branch names the tier it came from, and the name rides along to the log line in
    // place.js - "why did Tin end up there" has at least four possible answers.
            let normalScore;
            let normalTier;
            if (camel) {
                normalScore = CAMEL_SCORE_BASE - settlementResourceCapacity(settlement) * 10000;
                normalTier = 'camel';
            } else if (priorityBoost > 0) {
                normalScore =
                    (conditionalStrength > 0 ? SPECIALIZED_CONDITIONAL_SCORE_BASE : SPECIALIZED_SCORE_BASE) +
                    priorityBoost * 1000000 -
                    specializedYieldLoad(settlement, priority, scoreContext) * 10000 +
                    scorePair(resource, settlement, scoreContext);
                normalTier = conditionalStrength > 0 ? `priority+conditional ${priority}` : `priority ${priority}`;
            } else if (fallsBackToProduction) {
                normalScore =
                    PRODUCTION_FALLBACK_SCORE_BASE +
                    productionBoost * 1000 +
                    scorePair(resource, settlement, scoreContext);
                normalTier = `production fallback (wanted ${priority})`;
            } else if (conditionalStrength > 0) {
                normalScore =
                    CONDITIONAL_SCORE_BASE +
                    scorePair(resource, settlement, scoreContext) +
                    conditionalStrength * 1000;
                normalTier = 'conditional';
            } else {
                normalScore = yieldCountPriority + scorePair(resource, settlement, scoreContext);
                normalTier = 'plain yield';
            }

            // A military-production resource goes to the back of the queue whatever else fits.
            let ordinary = normalScore;
            let tier = normalTier;
            if (givesUnitProductionBonus(resource)) {
                ordinary = UNIT_PRODUCTION_SCORE_BASE + scorePair(resource, settlement, scoreContext);
                tier = 'unit production';
            }

            // Production belongs in cities. Note this is a nudge, not a ban: a town can
            // still take the resource when no city wants it more.
            if (
                settlement.settlementNameData?.isTown &&
                positiveYieldBoost(resource, settlement, PRODUCTION_YIELD) > 0
            ) {
                ordinary -= TOWN_PRODUCTION_PENALTY;
                tier += ' -town penalty';
            }

            // Gathering never overrides a settlement's own priority, and imports-first outranks
            // gathering.
            const hoard = hoardScore(resource, settlement, targets, scoreContext);
            if (hoard !== null && hoard > ordinary) {
                ordinary = hoard;
                tier = 'gathering';
            }
            const importFirst = importFirstScore(resource, settlement, scoreContext);
            if (importFirst !== null && importFirst > ordinary) {
                ordinary = importFirst;
                tier = 'imports first';
            }

            // Unhappiness outranks every other consideration; anything that does not
            // address it falls back to the ordinary order.
            const factoryFirst = factoryFirstScore(resource, settlement, factoryStock, scoreContext);
            let score = ordinary;
            if (factoryFirst !== null) {
                score = factoryFirst;
                tier = 'factories first';
            }
            if (rescue !== null) {
                score = rescue;
                tier = 'happiness rescue';
            }

            if (!best || score > best.score) {
                best = { resource, settlement, score, tier, rescue: rescue !== null };
            }
        }
    }
    return best;
}
//#endregion
