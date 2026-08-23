/**
 * What the factory resources are actually doing for you.
 *
 * Every one of the eight is a percentage that only exists once the resource sits in a settlement
 * with a Factory. Unassigned they do nothing - which is why this is not empire-effects.js with a
 * different filter: an empire resource pays for being HELD, a factory resource for being SLOTTED.
 *
 * Five effect shapes, none of them one empire-effects.js handles:
 *   ADJUST_PLAYER_YIELD_PER_SLOTTED_RESOURCE          Cocoa, Tea, Kaolin  - % of a yield
 *   CITY_ADJUST_UNIT_PRODUCTION_PER_SLOTTED_RESOURCE  Citrus, Cotton      - % towards units
 *   CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_SLOTTED  Coffee              - % towards builds
 *   CITY_ADJUST_GROWTH_PER_RESOURCE                   Tin                 - % growth rate
 *   UNIT_ADJUST_HEAL_PER_RESOURCE                     Quinine             - flat HP
 *
 * ⚠️ Two carry the number in `Percent` rather than `Amount`, and the constructible one names a
 * `ConstructibleClass` rather than a `ConstructibleType`. Code written against the empire shapes
 * reads every one of these as zero.
 *
 * ⚠️ These do NOT multiply by the number of settlements. `PER_SLOTTED_RESOURCE` and `GlobalSlots`
 * count the empire's slotted copies once and apply the percentage wherever the collection says -
 * four Coffee is +20% in every settlement, not +20% per settlement. The opposite of how empire
 * resources aggregate, and getting it backwards inflates every figure by the size of the empire.
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

/** What `count` slotted copies of this resource are worth. */
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

/** Adds up totals across resources, keeping apart the ones that cannot be added. */
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
 * Roughly what a percentage bonus is worth in whole numbers - a bare "+20%" says nothing about
 * what it is 20% of. ⚠️ An estimate, and labelled as one on screen: the game applies these against
 * bases this cannot see in full.
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
 * ⚠️ Read from `GameInfo.VictoryScorings`, never written as a number here.
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

/** Which copies are in a factory, and where. */
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

/** Every factory resource the player holds, slotted or not, and where each came from. */
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

/** The tab's whole data set: what is working, and what is sitting idle. */
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
