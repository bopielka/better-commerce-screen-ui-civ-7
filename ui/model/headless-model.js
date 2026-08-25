/**
 * The settlement and resource data the planner needs, built WITHOUT the Commerce screen - read
 * straight from the engine, in the shape the screen's model would have handed over.
 *
 * ⚠️ This is what lets automatic assignment run with the screen shut, and what keeps the planner
 * from importing anything under ui/screen/.
 */
import { ConstructibleHasTagType } from '/base-standard/ui/utilities/utilities-tags.js';

import { isFactoryAge } from '../engine/age.js';
import { heldResourceType, resourceTypeFromHash } from '../engine/resource-types.js';
import { isAssignableToSettlement } from '../planner/facts.js';

import { warn } from '../support/diagnostics.js';

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

function yieldTypesFor(resourceType) {
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
    return [...(yieldTypesByResource.get(resourceType) ?? [])];
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
 * the same rule and the same lifetime as `buildingsByCity` beside it. `buildSettlements()` runs
 * once per placement, so this was `getYields()` plus one `GameInfo.Yields[index]` per yield per
 * settlement, multiplied by the size of the empire twice over.
 */
const yieldsByCity = new Map();

/**
 * ⚠️ THE BACKSTOP, not the invalidation. What actually drops an entry is a placement landing in
 * that settlement. But `buildSettlements()` is also called from outside a run - the Empire tab,
 * the Factory tab, the GDP total - and nothing tells this cache that a turn has passed since.
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

/** What a settlement has built, and whether it can run a factory. Cached per run. */
const buildingsByCity = new Map();

/**
 * ⚠️ Composed once per settlement per RUN, not per placement. Every reader is behind DIAGNOSTICS,
 * and a full empire rebuild composed several hundred strings for a log that ships switched off.
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
 * Everything remembered about a settlement between placements: its buildings, its name and its
 * yields.
 * @param cityID the settlement to re-read next time, or nothing to re-read them all.
 */
export function forgetSettlementFacts(cityID = null) {
    if (!cityID) {
        buildingsByCity.clear();
        nameByCity.clear();
        yieldsByCity.clear();
        return;
    }
    const key = String(cityID.id);
    buildingsByCity.delete(key);
    nameByCity.delete(key);
    yieldsByCity.delete(key);
}

/**
 * Whether the screen would draw a factory cog on this settlement.
 * ⚠️ The same two questions the screen asks, in the same order: two definitions of "has a factory"
 * is how the screen and the planner come to disagree.
 */
export function settlementHasFactory(cityResources) {
    try {
        if (!cityResources.isTreasureConstructiblePrereqMet?.() || !isFactoryAge()) {
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

function countBuildings(city) {
    const key = String(city.id.id);
    const cached = buildingsByCity.get(key);
    if (cached) {
        return cached;
    }

    let warehouseCount = 0;
    let hasRail = false;
    try {
        city.Constructibles?.getIds().forEach((constructibleId) => {
            const constructible = Constructibles.getByComponentID(constructibleId);
            const definition = constructible && GameInfo.Constructibles.lookup(constructible.type);
            if (!definition) {
                return;
            }
            if (ConstructibleHasTagType(definition.ConstructibleType, 'WAREHOUSE')) {
                warehouseCount++;
            }
            if (definition.ConstructibleType === 'BUILDING_RAIL_STATION') {
                hasRail = true;
            }
        });
    } catch (error) {
        warn(`could not read buildings for a settlement: ${error}`);
    }

    const counts = { warehouseCount, hasRail, hasFactory: settlementHasFactory(city.Resources) };
    buildingsByCity.set(key, counts);
    return counts;
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
        const assigned = city.Resources.getAssignedResources() ?? [];
        const capacity = city.Resources.getAssignedResourcesCap() ?? assigned.length;
        const buildings = countBuildings(city);

        settlements.push({
            cityID: city.id,
            isDistantLands: city.isDistantLands,
            settlementNameData: {
                settlementName: settlementNameOf(city),
                isTown: city.isTown,
                warehouseCount: buildings.warehouseCount,
                hasRail: buildings.hasRail,
            },
            factoryResourceData: { hasFactory: buildings.hasFactory },
            yieldTotals: cityYieldTotals(city),
            slottedResources: assigned.map((resource) => {
                const type = heldResourceType(resource);
                return {
                    resourceValue: resource.value,
                    resourceType: type,
                    cityID: city.id,
                    yieldTypes: type ? yieldTypesFor(type) : [],
                };
            }),
            // The planner only ever reads the length of this.
            availableSlots: new Array(Math.max(0, capacity - assigned.length)).fill(0),
        });
    }

    return settlements;
}

/**
 * The local player's resources that are not assigned anywhere and COULD be.
 * ⚠️ Empire and treasure classes are dropped exactly as the game's own pool drops them; see
 * planner/facts.js.
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
            yieldTypes: type ? yieldTypesFor(type) : [],
        };
        if (!isAssignableToSettlement(entry)) {
            continue;
        }
        available.push(entry);
    }
    return available;
}

/** A stand-in for the screen's model, carrying only what the planner reads. */
export function buildHeadlessModel(prebuiltSettlements, prebuiltAvailable) {
    const settlements = prebuiltSettlements ?? buildSettlements();
    const available = prebuiltAvailable ?? buildAvailableResources(settlements);

    return {
        isSlottingAvailable: true,
        data: {
            resourceTabData: {
                slottedResourceSectionData: [{ cityResources: settlements }],
                availableResourceSectionData: [{ subSections: [{ resourceSlotData: available }] }],
                unslottedBonuses: [],
            },
        },
        // The planner drives assignment through these; here they only need to not throw,
        // because auto-assign sends the player operations itself.
        selectedResource: () => ({ resourceValue: -1, cityID: undefined }),
        clickAvailableResource: () => {},
        slotSelectedResource: () => {},
        deselectSelectedResource: () => {},
        setLastSlottedResourceValues: () => {},
    };
}
