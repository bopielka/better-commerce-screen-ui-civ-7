/**
 * What the factory resources are actually doing for you.
 *
 * The Modern age has eight of them - Coffee, Citrus, Cotton, Cocoa, Tea, Kaolin, Quinine,
 * Tin - and every one is a percentage that only exists once the resource sits in a
 * settlement with a Factory. Unassigned, they do nothing at all.
 *
 * That is the whole reason this file is not `empire-effects.js` with a different filter.
 * An empire resource pays for being HELD, so the interesting number is per copy. A factory
 * resource pays for being SLOTTED, so the only number worth showing is the total from the
 * copies actually in factories - and, separately, what the ones sitting in the pool would
 * add if you moved them.
 *
 * The five effect shapes
 * ---------------------
 * None of them is one `empire-effects.js` already handles, which is why the placeholder
 * tab could not simply reuse it:
 *
 *   ADJUST_PLAYER_YIELD_PER_SLOTTED_RESOURCE          Cocoa, Tea, Kaolin  - % of a yield
 *   CITY_ADJUST_UNIT_PRODUCTION_PER_SLOTTED_RESOURCE  Citrus, Cotton      - % towards units
 *   CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_SLOTTED  Coffee              - % towards builds
 *   CITY_ADJUST_GROWTH_PER_RESOURCE                   Tin                 - % growth rate
 *   UNIT_ADJUST_HEAL_PER_RESOURCE                     Quinine             - flat HP
 *
 * ⚠️ Two of them carry the number in a `Percent` argument rather than `Amount`, and the
 * constructible one names a `ConstructibleClass` rather than a `ConstructibleType`. Code
 * written against the empire-resource shapes reads every one of these as zero.
 *
 * ⚠️ These do not multiply by the number of settlements. `PER_SLOTTED_RESOURCE` and
 * `GlobalSlots` both mean the empire's slotted copies are counted once and the percentage
 * then applies wherever the collection says - so four Coffee is +20% in every settlement,
 * not +20% per settlement. This is the opposite of how the empire resources aggregate,
 * and getting it backwards would inflate the figures by the size of the empire.
 */
import { effectTypeOf, resourceModifiers } from './effects.js';
import { warn } from '../support/diagnostics.js';

export const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

const PLAYER_YIELD_PERCENT = 'ADJUST_PLAYER_YIELD_PER_SLOTTED_RESOURCE';
const UNIT_PRODUCTION_PERCENT = 'ADJUST_UNIT_PRODUCTION_PER_SLOTTED_RESOURCE';
const CONSTRUCTIBLE_PERCENT = 'ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_SLOTTED_RESOURCE';
const GROWTH_PERCENT = 'ADJUST_GROWTH_PER_RESOURCE';
const UNIT_HEAL = 'ADJUST_HEAL_PER_RESOURCE';

/** The game words these in prose; the tab needs a short label per domain and class. */
const DOMAIN_LABELS = {
    DOMAIN_LAND: 'LOC_NAJANE_COMMERCE_FACTORY_LAND_UNITS',
    DOMAIN_SEA: 'LOC_NAJANE_COMMERCE_FACTORY_SEA_UNITS',
};
const CONSTRUCTIBLE_LABELS = {
    BUILDING: 'LOC_NAJANE_COMMERCE_FACTORY_BUILDINGS',
    WONDER: 'LOC_NAJANE_COMMERCE_FACTORY_WONDERS',
};

/** `Amount` on three of the five, `Percent` on the other two. */
function numberOf(argumentsMap) {
    const amount = Number(argumentsMap.get('Amount'));
    if (Number.isFinite(amount) && amount !== 0) {
        return amount;
    }
    const percent = Number(argumentsMap.get('Percent'));
    return Number.isFinite(percent) ? percent : 0;
}

/**
 * What `count` slotted copies of this resource are worth.
 *
 * @param resourceType e.g. RESOURCE_COFFEE
 * @param count        copies sitting in a factory - 0 gives the shape with zero amounts,
 *                     which is what the unassigned section needs to say "this would give"
 * @returns [{ kind, amount, perCopy, yieldType?, towards?[] }]
 */
export function factoryEffectTotals(resourceType, count) {
    const totals = [];
    /** Coffee's two modifiers are one line - the same +5%, towards two different things. */
    const byKey = new Map();
    const add = (key, entry) => {
        const existing = byKey.get(key);
        if (existing) {
            for (const towards of entry.towards ?? []) {
                if (!existing.towards.includes(towards)) {
                    existing.towards.push(towards);
                }
            }
            return;
        }
        byKey.set(key, entry);
        totals.push(entry);
    };

    resourceModifiers(resourceType).forEach((argumentsMap, modifierId) => {
        const effect = effectTypeOf(modifierId);
        const each = numberOf(argumentsMap);
        if (!each) {
            return;
        }
        const base = { amount: each * count, perCopy: each, towards: [] };

        if (effect.includes(PLAYER_YIELD_PERCENT)) {
            const yieldType = argumentsMap.get('YieldType');
            add(`yield:${yieldType}`, { ...base, kind: 'yieldPercent', yieldType });
            return;
        }
        if (effect.includes(UNIT_PRODUCTION_PERCENT)) {
            const label = DOMAIN_LABELS[argumentsMap.get('Domain')];
            add(`units:${each}`, { ...base, kind: 'unitPercent', towards: label ? [label] : [] });
            return;
        }
        if (effect.includes(CONSTRUCTIBLE_PERCENT)) {
            const label = CONSTRUCTIBLE_LABELS[argumentsMap.get('ConstructibleClass')];
            add(`builds:${each}`, { ...base, kind: 'constructiblePercent', towards: label ? [label] : [] });
            return;
        }
        if (effect.includes(GROWTH_PERCENT)) {
            add(`growth:${each}`, { ...base, kind: 'growthPercent' });
            return;
        }
        if (effect.includes(UNIT_HEAL)) {
            add(`heal:${each}`, { ...base, kind: 'heal' });
        }
    });

    return totals;
}

/**
 * Adds up totals across resources, keeping the ones that cannot be added apart.
 *
 * "+9% Science" and "+20% towards Buildings" are not +29% of anything, so the key is the
 * kind and what it is aimed at. Two resources that both raise Science do combine.
 */
export function sumFactoryTotals(perResource) {
    const byKey = new Map();
    for (const totals of perResource) {
        for (const total of totals) {
            const key = `${total.kind}:${total.yieldType ?? ''}:${(total.towards ?? []).join('|')}`;
            const existing = byKey.get(key);
            if (existing) {
                existing.amount += total.amount;
                continue;
            }
            byKey.set(key, { ...total, towards: [...(total.towards ?? [])] });
        }
    }
    return [...byKey.values()].filter((total) => total.amount !== 0);
}

/**
 * What the empire actually makes of a yield per turn - the figure in the top panel.
 */
function netYield(yieldType) {
    try {
        const type = YieldTypes[yieldType];
        return Players.get(GameContext.localPlayerID)?.Stats?.getNetYield(type) ?? 0;
    } catch (error) {
        warn(`could not read the net ${yieldType}: ${error}`);
        return 0;
    }
}

/**
 * Roughly what a percentage bonus is worth in whole numbers.
 *
 * "+30% Science" is meaningless without knowing your Science. This turns it into the
 * figure the player would have to work out by hand.
 *
 * ⚠️ It is an ESTIMATE and is labelled as one. The catch is that the net yield ALREADY
 * INCLUDES whatever factory resources are slotted, so the naive `net × percent` overstates
 * the answer - a 30% bonus is 30% of the yield BEFORE itself, not after. Dividing by
 * `100 + applied` backs the slotted bonus out again:
 *
 *     before = net / (1 + applied/100)
 *     worth  = before × percent/100  =  net × percent / (100 + applied)
 *
 * That is exact if the game multiplies its percentages and close if it adds them together
 * with percentages from other sources, which is not knowable from here - hence "about".
 *
 * @param percent the bonus being valued
 * @param applied the factory percentage for this yield that is ALREADY in the net figure
 */
export function absoluteWorth(yieldType, percent, applied) {
    const net = netYield(yieldType);
    if (!net || !percent) {
        return { worth: 0, net: 0 };
    }
    return { worth: Math.round((net * percent) / (100 + applied)), net: Math.round(net) };
}

/**
 * The GDP a slotted factory resource is worth per turn, from the game's own scoring table.
 *
 * Factory resources are the Modern economic legacy path's main engine, and the rate is a
 * row in `VictoryScorings` rather than a modifier - which is why it does not appear
 * anywhere in the effect totals this file otherwise computes.
 *
 * ⚠️ Read from the table rather than written as a 3 here. It is exactly the kind of number
 * a balance patch moves, and a hardcoded one would go on looking right while being wrong.
 *
 * ⚠️ NOT the whole story for every civ: America's Industrial Park quarter carries a second
 * row worth +1 more per resource in the settlement holding it. Detecting that needs a walk
 * over each settlement's plots for a civ-specific case, so the tooltip says so instead of
 * the number quietly being low.
 */
const FACTORY_GDP_SCORING = 'VICTORY_TRACKER_SLOTTED_FACTORY';

export function gdpPerSlottedResource() {
    try {
        for (const scoring of GameInfo.VictoryScorings ?? []) {
            if (scoring.ScoringId === FACTORY_GDP_SCORING) {
                return Number(scoring.Points) || 0;
            }
        }
    } catch (error) {
        warn(`could not read the GDP rate for factory resources: ${error}`);
    }
    return 0;
}

/**
 * Which copies are in a factory, and where.
 *
 * ⚠️ A settlement may run only ONE kind of factory resource at a time, but any number of
 * copies of that kind - which is why one `getFactoryResource()` plus one count per
 * settlement is the whole picture, and why the counts have to be summed across settlements
 * rather than read from any single one.
 *
 * @returns Map<resourceType, { count, cities: [{ name, count }] }>
 */
export function slottedFactoryResources() {
    const byType = new Map();
    try {
        const cities = Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? [];
        for (const city of cities) {
            const resources = city.Resources;
            if (!resources) {
                continue;
            }
            const count = resources.getNumFactoryResources() ?? 0;
            const type = resources.getFactoryResource();
            const definition = count > 0 && type !== undefined ? GameInfo.Resources.lookup(type) : null;
            if (!definition) {
                continue;
            }
            const entry = byType.get(definition.ResourceType) ?? { count: 0, cities: [] };
            entry.count += count;
            entry.cities.push({ name: Locale.compose(city.name), count });
            byType.set(definition.ResourceType, entry);
        }
    } catch (error) {
        warn(`could not read the slotted factory resources: ${error}`);
    }
    return byType;
}

/**
 * Every factory resource the player holds, whether slotted or not, and where each came
 * from.
 *
 * ⚠️ One entry from `getResources()` is ONE COPY, not one kind - the game's own empire-tab
 * builder counts them the same way. The origin is looked up per copy, which is the only
 * reason the counts in the tooltip can be per settlement.
 *
 * @returns Map<resourceType, { total, definition, origins: Map<leaderId, Map<cityId, {name, count}>> }>
 */
export function heldFactoryResources() {
    const byType = new Map();
    try {
        Players.get(GameContext.localPlayerID)?.Resources?.getResources()?.forEach((resource) => {
            const definition = GameInfo.Resources.lookup(resource.uniqueResource?.resource);
            if (definition?.ResourceClassType !== FACTORY_CLASS) {
                return;
            }
            const entry = byType.get(definition.ResourceType) ?? { total: 0, definition, origins: new Map() };
            entry.total += 1;
            recordOrigin(entry.origins, resource.value);
            byType.set(definition.ResourceType, entry);
        });
    } catch (error) {
        warn(`could not read the held factory resources: ${error}`);
    }
    return byType;
}

/** Which settlement, under which leader, this one copy came from. */
function recordOrigin(origins, resourceValue) {
    try {
        const cityID = Game.Resources.getOriginCity(resourceValue);
        const city = Cities.get(cityID);
        if (!city) {
            return;
        }
        const byCity = origins.get(city.owner) ?? new Map();
        const existing = byCity.get(cityID.id);
        if (existing) {
            existing.count += 1;
        } else {
            byCity.set(cityID.id, { name: Locale.compose(city.name), count: 1 });
        }
        origins.set(city.owner, byCity);
    } catch (error) {
        warn(`could not read where a factory resource came from: ${error}`);
    }
}

/**
 * The tab's whole data set: what is working, and what is sitting idle.
 *
 * Unassigned is held minus slotted rather than a separate reading, so the two sections
 * always account for exactly the copies you own - a resource cannot appear in both with
 * counts that do not add up.
 */
export function factoryHoldings() {
    const slotted = slottedFactoryResources();
    const held = heldFactoryResources();
    const working = [];
    const idle = [];

    for (const [type, { total, definition, origins }] of held) {
        const inFactories = slotted.get(type);
        const count = Math.min(inFactories?.count ?? 0, total);
        if (count > 0) {
            working.push({
                type,
                definition,
                origins,
                count,
                cities: inFactories?.cities ?? [],
                totals: factoryEffectTotals(type, count),
            });
        }
        const spare = total - count;
        if (spare > 0) {
            idle.push({ type, definition, origins, count: spare, totals: factoryEffectTotals(type, spare) });
        }
    }

    const byCountDesc = (a, b) => b.count - a.count;
    return { working: working.sort(byCountDesc), idle: idle.sort(byCountDesc) };
}
