/**
 * What a resource IS and what it DOES, read out of the game's data and never assumed. No view on
 * whether placing it anywhere would be a good idea - that is scoring.js.
 *
 * ⚠️ Answers are cached by type, and by age where the age can change them: the tables are
 * ITERATED rather than queried, so an uncached read is a full scan of GameInfo.
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
 * ⚠️ Built by asking `UI.getIcon` for every yield and indexing the answers. Resource+ pattern-
 * matched the string with /YIELD_[A-Z_]+/, which never matches - the icon for YIELD_HAPPINESS is
 * `blp:Yield_Happiness`, in mixed case - so every yield total it read came back 0.
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

/**
 * ⚠️ Cached by type, because the fast path here is not as fast as it looks.
 *
 * The headless model precomputes `yieldTypes` and most callers hit that first line - but a
 * resource whose list is EMPTY fails the `?.length` test and falls through, so every resource
 * that pays no yield used to re-scan `GameInfo.Resource_YieldChanges` from the top. That is a
 * full table scan per resource per settlement per planning pass, for the answer "none",
 * which is exactly the answer that cannot change.
 */
const resourceYieldTypeCache = new Map();

export function resourceYieldTypes(resource) {
    if (resource.yieldTypes?.length) {
        return resource.yieldTypes;
    }
    const type = resourceType(resource);
    const cached = resourceYieldTypeCache.get(type);
    if (cached !== undefined) {
        return cached;
    }
    const types = [];
    GameInfo.Resource_YieldChanges.forEach((change) => {
        if (change.ResourceType === type) {
            types.push(change.YieldType);
        }
    });
    resourceYieldTypeCache.set(type, types);
    return types;
}

/** Cowries pay science in a town and gold in a city; nothing else changes by place. */
export function effectiveResourceYieldTypes(resource, settlement) {
    if (resourceType(resource) === 'RESOURCE_COWRIE') {
        return settlement.settlementNameData?.isTown ? ['YIELD_SCIENCE'] : ['YIELD_GOLD'];
    }
    return resourceYieldTypes(resource);
}

/** What this resource does: flat amounts and percentages, keyed by the effect they come from. */
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
            // ⚠️ Through the index in effects.js: `GameInfo.Modifiers` and `DynamicModifiers` are
            // thousands of rows each, and this used to walk BOTH per modifier to join them.
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
 * ⚠️ Read from the effect rather than from a name list, and it is the whole reason such resources
 * sort last: production you can only spend on units is not production a settlement can build with.
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
 * ⚠️ An empire resource pays for being HELD and a treasure resource becomes treasure fleets. The
 * game's own screen drops both before building the pool (`commerce-screen-model.ts`, same two
 * class names, no age logic).
 *
 * ⚠️ A CLASS check and not a list, because which resources those are changes with the age: Gold is
 * EMPIRE in Antiquity and TREASURE in Exploration, Ivory becomes BONUS, Marble becomes EMPIRE only
 * in Modern. Each age's resources.xml rewrites the column.
 *
 * ⚠️ An exclusion rather than an allow-list, matching the game: a class a patch adds is then
 * offered for assignment rather than silently vanishing from the pool.
 */
const UNASSIGNABLE_CLASSES = new Set(['RESOURCECLASS_EMPIRE', 'RESOURCECLASS_TREASURE']);

/** Can this resource go into a settlement at all? */
export function isAssignableToSettlement(resource) {
    return !UNASSIGNABLE_CLASSES.has(resourceClassOf(resource));
}

/**
 * Did this COPY arrive over a trade route from another leader?
 *
 * ⚠️ The game's own test, from `getResourcePropsFromDefinition` - it is what draws the foreign
 * flag on the icon: `originCity.owner !== GameContext.localPlayerID`. The CURRENT owner, not
 * `originalOwner`: a city you have since captured stops being an import.
 *
 * ⚠️ A property of the COPY, not of the type - your own Silk and a bought Silk are the same type
 * and a different thing, which is why `groupByResourceType` keys on this too.
 *
 * Cached for one placement run: a city changing hands cannot happen mid-assignment.
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

/** Does this resource's bonus grow with the number of warehouses in the settlement? */
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

/** The largest amount this resource can pay for one yield anywhere, per effect group. */
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
 * How strongly a resource's CONDITIONAL bonus applies here. 0 means this is not a place the
 * resource is especially rewarded; higher is a better fit. Scoring lifts a resource onto its own
 * tier when this is above zero, so it has to mean "this is the good branch".
 *
 * ⚠️ Asked of the DATA, not of a table of names. Resource+ used a hand-written per-age table that
 * disagreed with the game - it returned "conditions met" for gypsum, kaolin and pearls when a
 * settlement was NOT the capital, the exact opposite of REQUIREMENT_CITY_IS_CAPITAL, and 31
 * conditional resources were missing from it altogether.
 *
 * ⚠️ But "has a gated bonus this settlement satisfies" is NOT enough, and asking only that sent
 * Fish to portless towns. The game writes an either/or bonus as TWO gated modifiers, one the
 * inverse of the other - `MOD_FISH_PORT_FOOD` +8 requires a port, `MOD_FISH_NON_PORT_FOOD` +4
 * requires none - so a portless settlement satisfies the CONSOLATION branch and was lifted onto
 * the conditional tier just as a port city is. Same shape for Furs, Pearls, Silk, Tobacco,
 * Truffles, Tin, Wild Game, Gypsum, Kaolin; see knowledge-base/27-resources.md.
 *
 * So the test is: a gated bonus applies here AND this settlement gets the best that resource can
 * pay for that yield anywhere. The consolation branch scores on its amount like any other.
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
