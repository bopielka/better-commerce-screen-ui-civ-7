/**
 * What a resource IS and what it DOES - read out of the game's data, never assumed.
 *
 * Everything here answers a question about a resource type alone (or a type in a given
 * settlement), with no notion of whether placing it there would be a good idea; that
 * judgement lives in scoring.js. Split out because the two change for different reasons:
 * these follow the game's data, the scoring follows what the player asked for.
 *
 * Answers are cached by type, and by age where the age can change them - the tables are
 * iterated rather than queried, so an uncached read is a full scan of GameInfo.
 */
import { effectTypeOf, modifierApplies, modifierIsConditional, resourceModifiers } from './effects.js';

export const HAPPINESS_YIELD = 'YIELD_HAPPINESS';
export const PRODUCTION_YIELD = 'YIELD_PRODUCTION';

const resourceYieldEffectCache = new Map();
const resourceTypeCache = new Map();

//#region resource introspection
let yieldTypeByIcon = null;

/**
 * Which yield a `yieldIconSrc` belongs to.
 *
 * The model writes `url(${UI.getIcon(type, "YIELD")})`, so the map is built by asking
 * the same function for every yield and indexing the answers. Resource+ pattern-matched
 * the string instead, with /YIELD_[A-Z_]+/ - and that never matches, because the icon
 * for YIELD_HAPPINESS is `blp:Yield_Happiness`, in mixed case. Every yield total read
 * that way came back as 0, which is why the happiness rescue did nothing at all.
 */
export function yieldTypeFromIcon(iconSource) {
    if (!yieldTypeByIcon) {
        yieldTypeByIcon = new Map();
        GameInfo.Yields.forEach((yieldDefinition) => {
            yieldTypeByIcon.set(
                `url(${UI.getIcon(yieldDefinition.YieldType, 'YIELD')})`,
                yieldDefinition.YieldType,
            );
        });
    }
    return yieldTypeByIcon.get(String(iconSource)) ?? null;
}

export function resourceType(resource) {
    if (resource.resourceType) {
        return resource.resourceType;
    }
    const cacheKey = String(resource.resourceValue);
    if (resourceTypeCache.has(cacheKey)) {
        return resourceTypeCache.get(cacheKey);
    }
    try {
        const instance = Game.Resources.getResourceOnPlot(resource.resourceValue);
        const type = GameInfo.Resources.lookup(instance.resource)?.ResourceType ?? null;
        resourceTypeCache.set(cacheKey, type);
        return type;
    } catch (error) {
        resourceTypeCache.set(cacheKey, null);
        return null;
    }
}

export function resourceYieldTypes(resource) {
    if (resource.yieldTypes?.length) {
        return resource.yieldTypes;
    }
    const type = resourceType(resource);
    const types = [];
    GameInfo.Resource_YieldChanges.forEach((change) => {
        if (change.ResourceType === type) {
            types.push(change.YieldType);
        }
    });
    return types;
}

/** Cowries pay science in a town and gold in a city; nothing else changes by place. */
export function effectiveResourceYieldTypes(resource, settlement) {
    if (resourceType(resource) === 'RESOURCE_COWRIE') {
        return settlement.settlementNameData?.isTown ? ['YIELD_SCIENCE'] : ['YIELD_GOLD'];
    }
    return resourceYieldTypes(resource);
}

/**
 * What this resource actually does, read out of the modifier tables rather than assumed:
 * flat amounts and percentages both, keyed by the effect they come from so that two
 * variants of the same effect are not counted twice.
 */
export function resourceYieldEffects(resource) {
    const type = resourceType(resource);
    if (!type) {
        return [];
    }
    const cacheKey = `${String(Game.age)}:${type}`;
    if (resourceYieldEffectCache.has(cacheKey)) {
        return resourceYieldEffectCache.get(cacheKey);
    }

    const effects = [];
    resourceModifiers(type).forEach((argumentsMap, modifierId) => {
        const yieldType = argumentsMap.get('YieldType');
        const amount = Number(argumentsMap.get('Amount'));
        if (!yieldType || !Number.isFinite(amount)) {
            return;
        }
        const percentValue = String(argumentsMap.get('PercentMultiplier')).toLowerCase();
        effects.push({
            // Carried so the settlement can be asked whether this one applies to it.
            modifierId,
            yieldType,
            amount,
            percent: percentValue === 'true' || percentValue === '1',
            // ⚠️ Through the index in effects.js, not by scanning the tables. Both
            // `GameInfo.Modifiers` and `GameInfo.DynamicModifiers` are thousands of rows and
            // this used to walk BOTH of them, once per modifier, to join them on
            // `ModifierType` - the join `indexModifiers` already builds once for everybody.
            effectType: effectTypeOf(modifierId) || modifierId,
        });
    });

    if (!effects.length) {
        GameInfo.Resource_YieldChanges.forEach((change) => {
            if (change.ResourceType === type) {
                effects.push({
                    modifierId: null,
                    yieldType: change.YieldType,
                    amount: Number(change.YieldChange) || 0,
                    percent: false,
                    effectType: 'RESOURCE_YIELD_CHANGE',
                });
            }
        });
    }

    resourceYieldEffectCache.set(cacheKey, effects);
    return effects;
}

const unitProductionCache = new Map();

/**
 * Does this resource exist to speed up building units - of any kind?
 *
 * Read out of the modifier tables, not from a list of resource names: any
 * `*_ADJUST_UNIT_PRODUCTION_*` effect attached to the resource counts, whether it is
 * qualified or not. The qualifiers that do appear are only there to narrow which units
 * benefit, and none of them changes the answer:
 *
 *   no qualifier at all                -> every unit          (Truffles, Salt)
 *   Domain = DOMAIN_LAND / DOMAIN_SEA  -> combat units        (Cotton, Hardwood, Citrus)
 *   UnitClass = UNIT_CLASS_NON_COMBAT  -> settlers and such   (Hardwood, modern)
 *   UnitTag  = UNIT_CLASS_RELIGIOUS    -> missionaries        (Incense)
 *
 * The first attempt required a qualifier to be present and missed Truffles and Salt
 * entirely, which is how a truffle kept beating jade to a slot.
 */
export function givesUnitProductionBonus(resource) {
    const type = resourceType(resource);
    if (!type) {
        return false;
    }
    const cacheKey = `${String(Game.age)}:${type}`;
    if (unitProductionCache.has(cacheKey)) {
        return unitProductionCache.get(cacheKey);
    }

    let feedsUnits = false;
    resourceModifiers(type).forEach((_argumentsMap, modifierId) => {
        if (feedsUnits) {
            return;
        }
        // Same index as above, and the same reason: two full table scans per modifier.
        if (effectTypeOf(modifierId).includes('ADJUST_UNIT_PRODUCTION')) {
            feedsUnits = true;
        }
    });

    unitProductionCache.set(cacheKey, feedsUnits);
    return feedsUnits;
}

const resourceClassCache = new Map();

export function resourceClassOf(resource) {
    const type = resourceType(resource);
    if (!type) {
        return null;
    }
    if (!resourceClassCache.has(type)) {
        resourceClassCache.set(type, GameInfo.Resources.lookup(type)?.ResourceClassType ?? null);
    }
    return resourceClassCache.get(type);
}

/**
 * Classes that never go into a settlement slot at all.
 *
 * ⚠️ An empire resource pays its bonus for being HELD and a treasure resource turns into
 * treasure fleets; neither is ever assigned anywhere. The game's own Commerce screen drops
 * both before it builds the unassigned pool - `commerce-screen-model.ts`, same two class
 * names, no age logic:
 *
 *     if (playerResource.ResourceClassType == "RESOURCECLASS_EMPIRE" ||
 *         playerResource.ResourceClassType == "RESOURCECLASS_TREASURE") return;
 *
 * ⚠️ Which resources those ARE changes with the age, and that is exactly why this is a class
 * check and not a list. Gold is `EMPIRE` in Antiquity and `TREASURE` in Exploration; Ivory is
 * `EMPIRE` in Antiquity and `BONUS` in Exploration; Marble becomes `EMPIRE` only in Modern.
 * Each age's `resources.xml` rewrites the column with `<Update>` rows, so reading
 * `ResourceClassType` out of the loaded database already gives the answer for the age being
 * played.
 *
 * ⚠️ Written as an exclusion rather than an allow-list, matching the game: a class a patch or
 * a DLC adds is then offered for assignment rather than silently vanishing from the pool.
 */
const UNASSIGNABLE_CLASSES = new Set(['RESOURCECLASS_EMPIRE', 'RESOURCECLASS_TREASURE']);

/** Can this resource go into a settlement at all? */
export function isAssignableToSettlement(resource) {
    return !UNASSIGNABLE_CLASSES.has(resourceClassOf(resource));
}

/**
 * Did this copy arrive over a trade route from another leader?
 *
 * ⚠️ The game's own test, copied from `getResourcePropsFromDefinition` in
 * commerce-screen-model.ts - it is what draws the foreign leader's flag on the resource
 * icon:
 *
 *     if (originCity.owner !== GameContext.localPlayerID) { ...import flag... }
 *
 * The CURRENT owner, not `originalOwner`. The model reads `originalOwner` too, but only to
 * pick the colours of the flag; a city you have since captured stops being an import.
 *
 * ⚠️ This is a property of the COPY, not of the resource type - your own Silk and a Silk
 * bought from a neighbour are the same type and a different thing. That is why
 * `groupByResourceType` has to key on this as well; see the note there.
 *
 * Cached for the length of a placement run, keyed by resource value. A city changing hands
 * changes the answer, which cannot happen while resources are being assigned, and the cache
 * is dropped at the start of every run.
 */
const importOriginCache = new Map();

export function forgetImportOrigins() {
    importOriginCache.clear();
}

export function isImportedResource(resource) {
    const key = String(resource.resourceValue);
    let imported = importOriginCache.get(key);
    if (imported === undefined) {
        try {
            const originCity = Cities.get(Game.Resources.getOriginCity(resource.resourceValue));
            imported = !!originCity && originCity.owner !== GameContext.localPlayerID;
        } catch (error) {
            // Cannot tell: treat it as ours. Over-reporting imports would promote a
            // resource a whole tier on a guess.
            imported = false;
        }
        importOriginCache.set(key, imported);
    }
    return imported;
}

const warehouseScalingCache = new Map();

/**
 * Does this resource's bonus grow with the number of warehouses in the settlement?
 *
 * Such a resource is worth far more where warehouses are many, so it should be steered
 * there rather than dropped in the first settlement with a free slot.
 *
 * Read from the data: these are `EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD_PER_RESOURCE`
 * modifiers carrying `Tag = WAREHOUSE`. Resource+ named a single resource here - turtles -
 * and so missed Clay (production) and Crabs (food), which scale exactly the same way.
 */
export function scalesWithWarehouses(resource) {
    const type = resourceType(resource);
    if (!type) {
        return false;
    }
    const cacheKey = `${String(Game.age)}:${type}`;
    if (warehouseScalingCache.has(cacheKey)) {
        return warehouseScalingCache.get(cacheKey);
    }

    let scales = false;
    resourceModifiers(type).forEach((argumentsMap) => {
        scales = scales || argumentsMap.get('Tag') === 'WAREHOUSE';
    });

    warehouseScalingCache.set(cacheKey, scales);
    return scales;
}

/**
 * The largest amount this resource can pay for one yield ANYWHERE, per effect group.
 *
 * Read with no settlement in mind: every variant counts, including the ones gated on a
 * condition this settlement does not meet. It is the yardstick `conditionalBoostStrength`
 * measures a settlement against - "is this the good branch, or the consolation one".
 *
 * Keyed the same way `computeYieldBoosts` groups its effects (`yieldType:effectType`), so
 * the two can be compared entry by entry. Percentages are compared as rates: a 10% and a
 * 15% variant of the same effect differ by the number in the data, which is what the
 * branch is choosing between.
 */
const bestBoostCache = new Map();

function bestBoostsAnywhere(resource) {
    const type = resourceType(resource);
    if (!type) {
        return new Map();
    }
    const cacheKey = `${String(Game.age)}:${type}`;
    let best = bestBoostCache.get(cacheKey);
    if (best === undefined) {
        best = new Map();
        for (const effect of resourceYieldEffects(resource)) {
            const key = `${effect.yieldType}:${effect.effectType}`;
            best.set(key, Math.max(best.get(key) ?? -Infinity, effect.amount));
        }
        bestBoostCache.set(cacheKey, best);
    }
    return best;
}

/**
 * How strongly a resource's *conditional* bonus applies in this settlement.
 *
 * 0 means this settlement is not a place the resource is especially rewarded in; anything
 * higher means it is, and the bigger the number the better the fit. Scoring lifts a
 * resource onto its own tier when this is above zero, so it has to mean "this is the good
 * branch" and nothing weaker.
 *
 * Resource+ answered this from a hand-written table of resource names per age, and the
 * table disagreed with the data: it returned "conditions met" for gypsum, kaolin and
 * pearls when a settlement was NOT the capital, while the game gates those bonuses on
 * REQUIREMENT_CITY_IS_CAPITAL - the opposite. The same inversion ran through the
 * distant-lands entries for spices, sugar, tea and cocoa, and 31 conditional resources
 * were missing from the table altogether. So the question is put to the data instead.
 *
 * ⚠️ But "has a gated bonus this settlement satisfies" is not enough on its own, and
 * asking only that is what sent Fish to portless towns. The game writes an either/or
 * bonus as TWO gated modifiers, one of them the inverse of the other:
 *
 *     MOD_FISH_PORT_FOOD      +8 Food   requires BUILDING_PORT
 *     MOD_FISH_NON_PORT_FOOD  +4 Food   requires NOT BUILDING_PORT
 *
 * A settlement without a port therefore satisfies a gated bonus - the consolation one -
 * and Fish was lifted onto the conditional tier there just as it is in a port city. In a
 * food-hungry town that put Fish at +4 above Sugar at a flat +8, which is the wrong way
 * round by a factor of two. The same shape covers Furs, Pearls, Silk, Tobacco and
 * Truffles in Modern, and Tin, Wild Game, Gypsum and Kaolin earlier on; see
 * knowledge-base/27-resources.md for the full list per age.
 *
 * So the test is: a gated bonus applies here AND what this settlement gets out of it is
 * the best that resource can pay for that yield anywhere. The consolation branch scores
 * on its actual amount like any ordinary resource, which is all it ever deserved.
 */
export function conditionalBoostStrength(resource, settlement) {
    // Warehouse-scaling resources are worth one multiple of their bonus per warehouse,
    // so the count is the strength - and steers them to where the warehouses are.
    if (scalesWithWarehouses(resource)) {
        return settlement.settlementNameData?.warehouseCount ?? 0;
    }

    const best = bestBoostsAnywhere(resource);
    const hereByGroup = new Map();
    const gatedHere = new Set();
    for (const effect of resourceYieldEffects(resource)) {
        if (!effect.modifierId || !modifierApplies(effect.modifierId, settlement)) {
            continue;
        }
        const key = `${effect.yieldType}:${effect.effectType}`;
        hereByGroup.set(key, Math.max(hereByGroup.get(key) ?? -Infinity, effect.amount));
        if (modifierIsConditional(effect.modifierId)) {
            gatedHere.add(key);
        }
    }

    for (const key of gatedHere) {
        if ((hereByGroup.get(key) ?? -Infinity) >= (best.get(key) ?? Infinity)) {
            return 1;
        }
    }
    return 0;
}
