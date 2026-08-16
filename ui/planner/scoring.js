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
 *      above everything below and it is the whole reason this file diverges. How far it
 *      goes - not at all, cities only, or everything - is the player's, see
 *      happiness-setting.js;
 *   0b. factory resources into the factories that can be filled with them, when
 *      "factories first" is switched on for the age - see factoryFirstScore;
 *   1. camels - they bring two extra slots with them, so placing them early makes
 *      room for everything after;
 *   1b. resources that arrived over a trade route from another leader, into CITIES, when
 *      "imports first" is switched on - they are worth double towards the Economic
 *      Victory and nothing at all in a town. See importFirstScore;
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
 *   6. everything paying culture is gathered into the city that makes the most culture on
 *      its own, and everything paying gold into a different city that makes the most gold -
 *      see hoardScore. This outranks the conditional tier but never a settlement's own
 *      priority, and either pile can be switched off; see hoard-setting.js.
 *
 * "Balanced" - which is what every settlement is until the player says otherwise - means
 * production in a city and food in a town, NOT "whatever it has least of". See
 * DEFAULT_CITY_PRIORITY and the note in priorities.js.
 *
 * Resource+'s per-resource locks are NOT ported - this mod has no lock UI, so the
 * lock set is always empty and "reassign" clears everything unlocked, which is
 * everything.
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

/**
 * "Imports first", when the player asks for it: everything that arrived over a trade route
 * from another leader goes into a CITY before anything of ours is placed at all.
 *
 * Off by default, and it is a bet on one victory condition. Towards the Economic Victory a
 * resource slotted in a city is worth +1 GDP a turn and an imported one is worth +1 more on
 * top of that - double - and neither pays anything in a town. Chasing any other victory the
 * same rule just hands your cities whatever the trade network happens to supply.
 *
 * ⚠️ Above the priority tiers on purpose, which is the whole point and also the whole cost.
 * A culture city that has run out of imported culture must not start on OUR culture while
 * an imported resource is still homeless somewhere else - the import is worth double
 * wherever it lands, and ours is worth the same wherever it lands, so ours can wait. Once
 * every import is placed the ordinary order takes over untouched.
 *
 * ⚠️ Below camels, which are not a priority and do not compete with this: a camel brings two
 * slots with it, so placing one first can only ever mean MORE imports fit.
 *
 * ⚠️ Cities only. An import in a town earns nothing towards the tracker, so there is nothing
 * to promote - it falls back to the ordinary rules like any other resource.
 */
const IMPORT_FIRST_SCORE_BASE = 900000000;
/** Keeps the four ranks below apart, and the whole tier under CAMEL_SCORE_BASE. */
const IMPORT_RANK_WEIGHT = 10000000;

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
 * Building a culture settlement and a gold settlement, without being asked to.
 *
 * Culture-paying resources are worth more together than spread out - several of them are
 * percentages, and a percentage of a big number beats the same percentage of six small
 * ones - so they all go to whichever city already makes the most culture on its own. Gold
 * goes the same way, to a DIFFERENT city, so the two piles do not compete for slots.
 *
 * This sits below the priority tier on purpose: a settlement takes what it was told to
 * prioritise first, and only what is left over gets gathered up like this. It sits above
 * the conditional tier, so gathering beats the generic "this bonus applies here" rule -
 * including, deliberately, the warehouse rule that would otherwise scatter turtles.
 *
 * ⚠️ Which resources these are is read from the data, not from a list of names. It started
 * as three names - turtles, silk, jade - which is how it was first asked for, and that left
 * every other culture resource in the age out of the pile it obviously belonged in: mangos,
 * flax, wine and incense all pay culture and were being scattered. "Whatever pays this
 * yield here" needs no maintenance when a patch or a DLC adds another one.
 *
 * Both piles are switchable; see hoard-setting.js.
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
/**
 * Best fit, once two settlements would take the same number of copies: prefer the snugger
 * one and leave the roomier factory for a kind with more copies behind it.
 *
 * Far below FACTORY_STOCK_WEIGHT on purpose - it settles ties, it never overrules how many
 * copies would land.
 */
const FACTORY_LEFTOVER_WEIGHT = 1000;

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
 *
 * ⚠️ How many copies would actually LAND, not how many are waiting. Weighing the raw stock
 * left the choice of settlement to scorePair, which is about yields and priorities and
 * knows nothing about how many slots are free - so the most plentiful kind could be started
 * in the smallest factory. Two factories with 3 and 10 free slots, Coffee x10 and Cocoa x3:
 * starting Coffee in the 3-slot one places 3, then the 10-slot one continues on Coffee for
 * the remaining 7 and Cocoa never goes anywhere - 10 placed where 13 would fit. Scoring
 * min(stock, free slots) sends Coffee to the roomy factory and leaves the small one for
 * Cocoa, which is the whole 13.
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
    // Matching specializations balance their estimated realized yield gains.
    // Percentage resources use the settlement's current yield, not their raw rate.
    //
    // ⚠️ There is no "no priority" case any more. `effectivePriority` resolves Balanced to
    // production in a city and food in a town, so every settlement is always asking for
    // something. The branch that used to sit here gave an unprioritised settlement a flat
    // 10000 and ordered its candidates by the settlement's WEAKEST affected yield - the
    // Resource+ reading of "balanced", which quietly pulled every such settlement towards
    // whatever it happened to be worst at.
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
    // "Cities only" means a town's deficit is not a reason to run the tier at all, so it
    // is left out of the reading rather than filtered later - otherwise every pass in an
    // empire with one unhappy town would walk the whole board for a rescue it will refuse.
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
 * The one culture settlement and the one gold settlement, chosen ONCE for a whole run.
 *
 * ⚠️ Exactly ONE settlement holds each role at a time. The gold pile used to have no target
 * at all: it scored every city that was not the culture city, weighted by that city's own
 * gold, which is "spread gold around, richest first" and not "build a gold settlement". The
 * cost was visible in play - Jade would take a slot in the CAPITAL at the gathering tier
 * (600 000 000) while Silk, which was not the capital's pile, could only reach the
 * conditional tier (500 000 000) there and stayed in the pool.
 *
 * ⚠️ But the role is a ROLE, not a fixed settlement: when the city holding it runs out of
 * room, the next-best city takes over. A culture city with two free slots would otherwise
 * take two culture resources and let the remaining twelve scatter under the ordinary rules -
 * the very thing the option exists to prevent, merely delayed by two slots.
 *
 * The ranking is settled once per run and only "which of them still has room" moves; see
 * hoardRanking for why re-ranking every pass is not safe.
 *
 * Cities only - several of the resources involved need a build queue to pay out anything,
 * and a town would be gathering yields it cannot use.
 *
 * ⚠️ Only KEYS are cached. The settlement objects are rebuilt from the board before every
 * pass, so anything held across passes must be a `cityKey` and not an object.
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

/**
 * Cities ordered by how much of each yield they make on their own, best first.
 *
 * ⚠️ Ranked ONCE per run and then held. `bareYield` subtracts the estimated contribution of
 * what is slotted, so the culture city's own bare culture FALLS as its pile grows - and with
 * percentage resources the estimate is taken off a total those same resources inflated.
 * Re-ranked every pass, the leader could hand the role over to a rival partway through and
 * leave the pile split between two settlements, which is the one outcome this tier exists to
 * avoid. Ranking once fixes the order; only "which of them has room" is allowed to move.
 */
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

/**
 * Which settlement currently holds each role: the highest-ranked city that still has room.
 *
 * ⚠️ The role moves on when the settlement holding it fills up. Without that, a culture city
 * with two free slots took two culture resources and the remaining twelve fell back to the
 * ordinary rules and scattered - which is the behaviour the option is there to prevent, just
 * delayed by two slots. The RANKING is fixed for the run, so this only ever walks down a
 * settled order; it cannot reshuffle itself mid-run.
 *
 * ⚠️ The gold role skips whichever settlement currently holds the culture role, so the two
 * piles never compete for the same slots - and that check is against the CURRENT holder, not
 * the one picked at the start, so handing the culture role on also frees the city it left.
 */
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

/**
 * The score for gathering this resource here, or null if this is not one of the two target
 * settlements or the resource pays nothing towards that settlement's pile.
 *
 * ⚠️ "Pays the yield" is asked of THIS settlement, not of the resource in the abstract:
 * silk pays culture in a city and nothing in a town, and a resource that would contribute
 * nothing here has no business being gathered here.
 *
 * The settlement's own yield is still part of the score, so a strong pile outranks a weak
 * one when both roles are competing for the same resource.
 */
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

/**
 * The available pool, one entry per kind of resource.
 *
 * Copies of a kind score identically - the scoring reads the resource's type and nothing
 * else about the individual copy - so scoring all of them is repeated work, and with a
 * large pool most of the pool is copies. One representative is scored and the others come
 * along as substitutes for when the engine refuses that particular one.
 *
 * ⚠️ "Identically" stopped being true of the type alone when imports-first arrived. Whether
 * a copy came over a trade route is a property of the COPY: your own Silk and a Silk bought
 * from a neighbour are the same type and worth different amounts of GDP. Grouped on type
 * alone, one representative would answer for both and every copy in the group would be
 * scored as whatever the first one happened to be. So the key carries it, and the invariant
 * holds again.
 */
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
 * The score for putting an imported resource into a city, or null when that is not what
 * this pair is.
 *
 * The four ranks, best first - they decide the ORDER imports are placed in, not whether
 * they are placed, because every one of them outranks everything that is not an import:
 *
 *   3  it serves what the player told this city to make
 *   2  it brings production - the second choice everywhere else in this file too
 *   1  the city has no specialisation of its own, so nothing is being displaced
 *   0  a specialised city, and this helps neither its priority nor its production
 *
 * ⚠️ Rank 3 is measured against the player's EXPLICIT choice, not `effectivePriority`. A
 * settlement left on Balanced has not asked for anything, so an import landing there
 * displaces no plan and belongs at rank 1 - that is what "fill the unspecialised cities
 * next" means. Resolving Balanced to production here would collapse ranks 3, 2 and 1 into
 * one for every city the player never touched.
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
     * ⚠️ The whole empire, then the filter - not the other way round.
     *
     * Quick-assigning one settlement must not make that settlement the culture city by
     * default, and `buildScoreContext` has to cover every settlement the gathering targets
     * are compared across, or `bareYield` reads a missing entry as "contributes nothing"
     * and hands the pile to whichever city happens to be outside the filter.
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

            const conditionalStrength = conditionalBoostStrength(resource, settlement);
            const priority = effectivePriority(settlement.cityID, settlement.settlementNameData?.isTown);
            const priorityBoost = positiveYieldBoost(resource, settlement, priority);

            // Nothing here serves what this city asked for, but it does bring production.
            const productionBoost = positiveYieldBoost(resource, settlement, PRODUCTION_YIELD);
            const fallsBackToProduction =
                priorityBoost <= 0 &&
                priority !== PRODUCTION_YIELD &&
                productionBoost > 0 &&
                !settlement.settlementNameData?.isTown;

            /*
             * ⚠️ Every branch names the tier it came from, and the name rides along on the
             * winning plan so place.js can log it.
             *
             * This is diagnostics, but it earned its keep: "why did Tin end up in my
             * culture capital instead of Silk" is not answerable from the board - the same
             * outcome can come from the import tier, the production fallback, a happiness
             * rescue, or from the resource simply having been there before the run. Three
             * rounds of reasoning from screenshots settled none of them.
             */
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

            // A military-production resource goes to the back of the queue whatever else
            // it would have scored - but it can still be pulled forward by the happiness
            // rescue, which outranks everything.
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

            /*
             * Gathering never overrides a settlement's own priority, and imports-first
             * never overrides a camel, so all three are COMPARED rather than chained:
             * whichever reads stronger wins. Chaining `importFirst ?? ordinary` would have
             * pushed an imported camel down off its own tier and cost the two slots it
             * brings - which is the opposite of what imports-first wants.
             */
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
