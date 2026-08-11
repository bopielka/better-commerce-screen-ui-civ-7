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
import { modifierApplies, modifierIsConditional, resourceModifiers } from './effects.js';
import { warn } from '../support/diagnostics.js';

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
        const modifier = GameInfo.Modifiers?.find((entry) => entry.ModifierId === modifierId);
        const dynamicModifier = GameInfo.DynamicModifiers?.find(
            (entry) => entry.ModifierType === modifier?.ModifierType,
        );
        const percentValue = String(argumentsMap.get('PercentMultiplier')).toLowerCase();
        effects.push({
            // Carried so the settlement can be asked whether this one applies to it.
            modifierId,
            yieldType,
            amount,
            percent: percentValue === 'true' || percentValue === '1',
            effectType: dynamicModifier?.EffectType ?? modifierId,
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
        const modifier = GameInfo.Modifiers?.find((entry) => entry.ModifierId === modifierId);
        const dynamicModifier = GameInfo.DynamicModifiers?.find(
            (entry) => entry.ModifierType === modifier?.ModifierType,
        );
        if (String(dynamicModifier?.EffectType ?? '').includes('ADJUST_UNIT_PRODUCTION')) {
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
 * How strongly a resource's *conditional* bonus applies in this settlement.
 *
 * 0 means the resource brings nothing here that it would not bring anywhere; anything
 * higher means this settlement meets a condition the resource rewards, and the bigger
 * the number the better the fit.
 *
 * Resource+ answered this from a hand-written table of resource names per age, and the
 * table disagreed with the data: it returned "conditions met" for gypsum, kaolin and
 * pearls when a settlement was NOT the capital, while the game gates those bonuses on
 * REQUIREMENT_CITY_IS_CAPITAL - the opposite. The same inversion ran through the
 * distant-lands entries for spices, sugar, tea and cocoa, and 31 conditional resources
 * were missing from the table altogether.
 *
 * So the question is put to the data instead: does this resource have a gated bonus that
 * this settlement actually satisfies?
 */
export function conditionalBoostStrength(resource, settlement) {
    // Warehouse-scaling resources are worth one multiple of their bonus per warehouse,
    // so the count is the strength - and steers them to where the warehouses are.
    if (scalesWithWarehouses(resource)) {
        return settlement.settlementNameData?.warehouseCount ?? 0;
    }

    for (const effect of resourceYieldEffects(resource)) {
        if (effect.modifierId && modifierIsConditional(effect.modifierId) && modifierApplies(effect.modifierId, settlement)) {
            return 1;
        }
    }
    return 0;
}
