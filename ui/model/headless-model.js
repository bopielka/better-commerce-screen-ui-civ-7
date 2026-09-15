/**
 * The settlement and resource data the planner needs, built WITHOUT the Commerce screen - read
 * straight from the engine, in the shape the screen's model would have handed over.
 *
 * ⚠️ This is what lets automatic assignment run with the screen shut, and what keeps the planner
 * from importing anything under ui/screen/. It imports nothing above engine/ itself.
 */
import { ConstructibleHasTagType } from '/base-standard/ui/utilities/utilities-tags.js';

import { isFactoryAge } from '../engine/age.js';
import { heldResourceType, isAssignableResourceType, resourceTypeFromHash } from '../engine/resource-types.js';

import { onGameDataStale } from '../support/game-data.js';
import { DIAGNOSTICS, warn } from '../support/diagnostics.js';

/**
 * Which yields a resource counts as affecting, exactly as the screen's model works it out - from
 * `GameInfo.TypeTags`, so a resource tagged PRODUCTION affects production however it does it.
 */
const YIELD_BY_TAG = new Map([
    ['FOOD', 'YIELD_FOOD'],
    ['PRODUCTION', 'YIELD_PRODUCTION'],
    ['GOLD', 'YIELD_GOLD'],
    ['SCIENCE', 'YIELD_SCIENCE'],
    ['CULTURE', 'YIELD_CULTURE'],
    ['HAPPINESS', 'YIELD_HAPPINESS'],
]);

let yieldTypesByResource = null;

/**
 * ⚠️ THE SAME ARRAY EVERY TIME, and it must not be mutated. This is asked once per slotted
 * resource per settlement per placement, and building a fresh array from the Set each time was
 * thousands of throwaway allocations for a full empire.
 */
const yieldTypeListByResource = new Map();

function yieldTypesFor(resourceType) {
    const listed = yieldTypeListByResource.get(resourceType);
    if (listed) {
        return listed;
    }
    if (!yieldTypesByResource) {
        yieldTypesByResource = new Map();
        GameInfo.Resources.forEach((resource) => yieldTypesByResource.set(resource.ResourceType, new Set()));
        GameInfo.TypeTags.forEach((typeTag) => {
            const yields = yieldTypesByResource.get(typeTag.Type);
            const yieldType = YIELD_BY_TAG.get(typeTag.Tag);
            if (yields && yieldType) {
                yields.add(yieldType);
            }
        });
    }
    const list = Object.freeze([...(yieldTypesByResource.get(resourceType) ?? [])]);
    yieldTypeListByResource.set(resourceType, list);
    return list;
}

function resourceTypeOf(resourceValue) {
    try {
        const instance = Game.Resources.getResourceOnPlot(resourceValue);
        return resourceTypeFromHash(instance.resource);
    } catch (error) {
        return null;
    }
}

/**
 * What every yield of a settlement currently stands at.
 *
 * ⚠️ Cached per settlement per RUN, and dropped for the one settlement a placement lands in -
 * the same rule and the same lifetime as `factoryByCity` below. `buildSettlements()` runs
 * once per placement, so this was `getYields()` plus one `GameInfo.Yields[index]` per yield per
 * settlement, multiplied by the size of the empire twice over.
 */
const yieldsByCity = new Map();

/**
 * ⚠️ THE BACKSTOP, not the invalidation. What actually drops an entry is a placement landing in
 * that settlement. But `buildSettlements()` is also called from outside a run - the screen's bulk
 * actions end in `verifyScreenMatchesEngine` - and nothing tells this cache that a turn has passed.
 * A placement loop is microseconds between iterations, so a second still collapses a whole run.
 */
const YIELD_CACHE_MS = 1000;
let yieldsReadAt = 0;

function cityYieldTotals(city) {
    if (Date.now() - yieldsReadAt > YIELD_CACHE_MS) {
        yieldsByCity.clear();
        yieldsReadAt = Date.now();
    }
    const key = String(city.id.id);
    const cached = yieldsByCity.get(key);
    if (cached) {
        return cached;
    }

    const totals = new Map();
    try {
        const yields = city.Yields?.getYields();
        yields?.forEach((entry, index) => {
            const definition = GameInfo.Yields[index];
            if (definition) {
                totals.set(definition.YieldType, Number(entry.value) || 0);
            }
        });
    } catch (error) {
        warn(`could not read yields for a settlement: ${error}`);
    }
    yieldsByCity.set(key, totals);
    return totals;
}

/**
 * How many warehouses a settlement has. Cached per RUN, and kept when a placement lands: assigning
 * a resource cannot build one, and re-counting walked every constructible of that settlement.
 */
const warehousesByCity = new Map();

/**
 * Whether a constructible type is a warehouse, keyed by the type the engine hands over.
 * ⚠️ `GameInfo.Constructibles.lookup` used to be asked once per constructible per settlement; the
 * answer belongs to the type and the age, so it is reset with the age's data below.
 */
const warehouseByConstructibleType = new Map();

/** Whether a settlement can run a factory. Cached per run, and re-read where a placement lands. */
const factoryByCity = new Map();

/**
 * ⚠️ Composed only with DIAGNOSTICS on, and then once per settlement per RUN. Every reader is a
 * diagnostics log, and a full empire rebuild composed several hundred strings for a log that
 * ships switched off. A placement cannot rename a settlement, so it keeps its entry.
 */
const nameByCity = new Map();

function settlementNameOf(city) {
    const key = String(city.id.id);
    const cached = nameByCity.get(key);
    if (cached !== undefined) {
        return cached;
    }
    let name = '';
    try {
        name = Locale.compose(city.name);
    } catch (error) {
        name = '';
    }
    nameByCity.set(key, name);
    return name;
}

/**
 * Everything remembered about a settlement between placements.
 * @param cityID the settlement a placement landed in - only what a placement can change is
 *   re-read: its yields and its factory state - or nothing to re-read everything, warehouses and
 *   names included.
 */
export function forgetSettlementFacts(cityID = null) {
    if (!cityID) {
        warehousesByCity.clear();
        factoryByCity.clear();
        nameByCity.clear();
        yieldsByCity.clear();
        return;
    }
    const key = String(cityID.id);
    factoryByCity.delete(key);
    yieldsByCity.delete(key);
}

/**
 * Whether the screen would draw a factory cog on this settlement.
 * ⚠️ The same two questions the screen asks: two definitions of "has a factory" is how the screen
 * and the planner come to disagree. The age goes first because it is cached, and outside the
 * Modern Age it is the whole answer.
 */
export function settlementHasFactory(cityResources) {
    try {
        if (!isFactoryAge() || !cityResources.isTreasureConstructiblePrereqMet?.()) {
            return false;
        }
        return (
            cityResources.getNumFactoryResources() === 0 ||
            GameInfo.Resources.lookup(cityResources.getFactoryResource()) != null
        );
    } catch (error) {
        warn(`could not tell whether a settlement has a factory: ${error}`);
        return false;
    }
}

function countWarehouses(city) {
    const key = String(city.id.id);
    const cached = warehousesByCity.get(key);
    if (cached !== undefined) {
        return cached;
    }

    let warehouseCount = 0;
    try {
        city.Constructibles?.getIds().forEach((constructibleId) => {
            const constructible = Constructibles.getByComponentID(constructibleId);
            if (!constructible) {
                return;
            }
            let isWarehouse = warehouseByConstructibleType.get(constructible.type);
            if (isWarehouse === undefined) {
                const definition = GameInfo.Constructibles.lookup(constructible.type);
                isWarehouse = !!definition && ConstructibleHasTagType(definition.ConstructibleType, 'WAREHOUSE');
                warehouseByConstructibleType.set(constructible.type, isWarehouse);
            }
            if (isWarehouse) {
                warehouseCount++;
            }
        });
    } catch (error) {
        warn(`could not read buildings for a settlement: ${error}`);
    }

    warehousesByCity.set(key, warehouseCount);
    return warehouseCount;
}

function hasFactoryCached(city) {
    const key = String(city.id.id);
    let hasFactory = factoryByCity.get(key);
    if (hasFactory === undefined) {
        hasFactory = settlementHasFactory(city.Resources);
        factoryByCity.set(key, hasFactory);
    }
    return hasFactory;
}

/** Shared rather than allocated per resource; nothing may mutate it. */
const EMPTY_YIELD_TYPES = Object.freeze([]);

/** One settlement, shaped like the screen's own data. */
function settlementFrom(city) {
    const assigned = city.Resources.getAssignedResources() ?? [];
    const capacity = city.Resources.getAssignedResourcesCap() ?? assigned.length;

    return {
        cityID: city.id,
        settlementNameData: {
            settlementName: DIAGNOSTICS ? settlementNameOf(city) : undefined,
            isTown: city.isTown,
            warehouseCount: countWarehouses(city),
        },
        factoryResourceData: { hasFactory: hasFactoryCached(city) },
        yieldTotals: cityYieldTotals(city),
        slottedResources: assigned.map((resource) => {
            const type = heldResourceType(resource);
            return {
                resourceValue: resource.value,
                resourceType: type,
                cityID: city.id,
                yieldTypes: type ? yieldTypesFor(type) : EMPTY_YIELD_TYPES,
            };
        }),
        /*
         * The planner only ever reads the length of this - and the screen's own model, which the
         * planner also reads, carries a real array here.
         * ⚠️ NOT `.fill(0)`: the zeroes were never read, and filling is what makes the engine
         * materialise the elements. One of these is built per settlement per placement.
         */
        availableSlots: new Array(Math.max(0, capacity - assigned.length)),
    };
}

/** Every settlement of the local player, shaped like the screen's own data. */
export function buildSettlements() {
    const player = Players.get(GameContext.localPlayerID);
    const cities = player?.Cities?.getCities() ?? [];
    const settlements = [];

    for (const city of cities) {
        if (!city.Resources) {
            continue;
        }
        settlements.push(settlementFrom(city));
    }

    return settlements;
}

/**
 * The same settlements as `buildSettlements()`, carrying only `cityID` and
 * `settlementNameData.isTown` - what planner/effects.js `modifierApplies` and the Empire tab's
 * totals read. ⚠️ Any other field is undefined here: a reader of one needs the full board.
 */
export function buildSettlementRefs() {
    const player = Players.get(GameContext.localPlayerID);
    const cities = player?.Cities?.getCities() ?? [];
    const refs = [];

    for (const city of cities) {
        if (!city.Resources) {
            continue;
        }
        refs.push({ cityID: city.id, settlementNameData: { isTown: city.isTown } });
    }

    return refs;
}

/**
 * The same board with ONE settlement re-read from the engine.
 *
 * ⚠️ WHAT THIS SAVES: `buildSettlements` is two calls into the engine per settlement plus a fresh
 * object graph, and the placement loop ran it before every resource it placed - the whole empire,
 * to reflect a change in one settlement. Everything else is handed back BY REFERENCE, which also
 * keeps the planner's per-settlement caches warm.
 *
 * ⚠️ This reads the engine, so it must run after the assignment has actually landed - and it drops
 * that settlement's per-placement facts itself, immediately before reading. The caller's wait
 * yields to timers, and a `buildSettlements()` from outside the run in that window caches the
 * yields from before the assignment landed.
 */
export function rebuildSettlement(settlements, cityID) {
    const key = String(cityID?.id);
    let replacement = null;
    if (cityID) {
        forgetSettlementFacts(cityID);
    }
    try {
        const city = Cities.get(cityID);
        if (city?.Resources) {
            replacement = settlementFrom(city);
        }
    } catch (error) {
        warn(`could not re-read a settlement after a placement: ${error}`);
    }
    if (!replacement) {
        return settlements;
    }
    return settlements.map((settlement) =>
        String(settlement.cityID?.id) === key ? replacement : settlement,
    );
}

/**
 * The local player's resources that are not assigned anywhere and COULD be.
 * ⚠️ Empire and treasure classes are dropped exactly as the game's own pool drops them; see
 * engine/resource-types.js.
 */
export function buildAvailableResources(settlements) {
    const player = Players.get(GameContext.localPlayerID);
    const all = player?.Resources?.getResources() ?? [];

    const assigned = new Set();
    for (const settlement of settlements) {
        for (const resource of settlement.slottedResources) {
            assigned.add(resource.resourceValue);
        }
    }

    const available = [];
    for (const resource of all) {
        const value = resource.value;
        if (assigned.has(value)) {
            continue;
        }
        const type = heldResourceType(resource) ?? resourceTypeOf(value);
        const entry = {
            resourceValue: value,
            resourceType: type,
            cityID: undefined,
            yieldTypes: type ? yieldTypesFor(type) : EMPTY_YIELD_TYPES,
        };
        if (!isAssignableResourceType(type)) {
            continue;
        }
        available.push(entry);
    }
    return available;
}

/**
 * A stand-in for the screen's model, carrying only what the planner reads: the two sections
 * `allSettlements` and `pooledResources` walk. The placement loop sends the player operations
 * itself, so none of the model's selection methods is ever asked of this.
 */
export function buildHeadlessModel(prebuiltSettlements, prebuiltAvailable) {
    const settlements = prebuiltSettlements ?? buildSettlements();
    const available = prebuiltAvailable ?? buildAvailableResources(settlements);

    return {
        data: {
            resourceTabData: {
                slottedResourceSectionData: [{ cityResources: settlements }],
                availableResourceSectionData: [{ subSections: [{ resourceSlotData: available }] }],
            },
        },
    };
}

/*
 * ⚠️ `GameInfo.TypeTags` and the settlement facts below it describe the age being played; see
 * support/game-data.js.
 */
onGameDataStale(() => {
    yieldTypesByResource = null;
    yieldTypeListByResource.clear();
    warehouseByConstructibleType.clear();
    forgetSettlementFacts();
});
