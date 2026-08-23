/**
 * The settlement and resource data the planner needs, built without the Commerce screen.
 *
 * Everything the scoring reads normally comes from `CommerceScreenModel`, which only
 * exists while that screen is open. Auto-assignment has to work with the screen closed,
 * so the same shapes are rebuilt straight from the game: the fields are named to match
 * `CommerceCityResourceData` and `ResourceSlotData` exactly, so planner/scoring.js cannot
 * tell the difference and needs no branch for it.
 *
 * ⚠️ Every field the planner reads must be built the way the model builds it, not merely
 * present. `yieldTypes` was the one that got away with being an empty array for a while,
 * and it silently changed the outcome rather than breaking anything.
 *
 * Only the fields the planner actually reads are filled in. Anything to do with drag and
 * drop, focus or display is left out - if the planner ever starts reading one of those,
 * it will come back as undefined rather than wrong, which is the failure mode to want.
 */
import { ConstructibleHasTagType } from '/base-standard/ui/utilities/utilities-tags.js';

import { isFactoryAge } from '../engine/age.js';
import { heldResourceType, resourceTypeFromHash } from '../engine/resource-types.js';
import { isAssignableToSettlement } from '../planner/facts.js';

import { warn } from '../support/diagnostics.js';

/**
 * Which yields a resource counts as affecting, exactly as the screen's model works it out.
 *
 * This is NOT the same as the resource's yield changes: the model reads it from
 * `GameInfo.TypeTags`, so a resource tagged PRODUCTION affects production whether or not
 * it has a flat production yield. Leaving this empty - which the first version of this
 * file did - made the planner fall back to `Resource_YieldChanges`, so it judged every
 * resource on its base yields alone and produced a different layout here than the same
 * algorithm produced with the screen open. Six tags, no influence, matching the model.
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
 * ⚠️ NOT `CityYields.getCityYieldDetails`, which is what this used to call. That builds
 * the breakdown the yield tooltip shows - a nested tree of base values, modifier steps and
 * localised labels - and every one of those was thrown away here to keep one number per
 * yield. Rebuilt for all settlements before every single resource, it was most of the
 * planning time: 4.7 seconds of a 13 second run.
 *
 * `city.Yields.getYields()` is the array that utility reads before it decorates it, indexed
 * to match `GameInfo.Yields`.
 */
function cityYieldTotals(city) {
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
    return totals;
}

/**
 * What a settlement has built, and whether it can run a factory.
 *
 * Cached for the length of a placement run: this walks every constructible in every
 * settlement, and a run re-reads all of them before every single resource. Buildings do
 * not go up while resources are being assigned, so the walk only has to happen once -
 * except for the settlement that just took something, whose factory state can change.
 */
const buildingsByCity = new Map();

/**
 * Settlement names, which cost a `Locale.compose` each and are read for DIAGNOSTICS ONLY.
 *
 * ⚠️ Composed once per settlement per run instead of once per settlement per PLACEMENT. The
 * planner reads `settlementName` in exactly four places and every one of them is behind
 * `DIAGNOSTICS` - the log line naming the tier that won a resource, the "nothing fits"
 * explanation, and the happiness report. A full empire rebuild composed several hundred
 * strings for a log that ships switched off.
 *
 * Cleared with the buildings, because both describe a board that a new run has to re-read.
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

/** @param cityID the settlement to re-read next time, or nothing to re-read them all. */
export function forgetSettlementBuildings(cityID = null) {
    if (!cityID) {
        buildingsByCity.clear();
        nameByCity.clear();
        return;
    }
    buildingsByCity.delete(String(cityID.id));
    nameByCity.delete(String(cityID.id));
}

/**
 * Whether the screen would draw a factory cog on this settlement.
 *
 * ⚠️ Copied from the game's own `populateFactoryResourceDataForCity`, NOT worked out from
 * "does it have BUILDING_FACTORY" - which is what this used to do, and which disagreed
 * with the screen. The two paths have to answer this identically or "factories first"
 * means one thing with the screen open and another with it shut.
 *
 * Exported because `assign-notification.js` needs the same answer and must not grow its own:
 * two definitions of "has a factory" is precisely the shape of bug this file exists to avoid.
 * It takes `city.Resources` rather than the city so that callers who already hold the
 * component do not have to look it up again.
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
 *
 * Worked out by subtraction: the player's full list minus everything the settlements report
 * as assigned. There is no "unassigned" accessor to ask.
 *
 * ⚠️ Empire and treasure resources are then dropped, because the game's own pool drops them -
 * see `isAssignableToSettlement`. Leaving them in was a real difference between the two
 * paths, and it is the sort this file exists to prevent: with the Commerce screen OPEN the
 * planner reads the game's model, which had already filtered them out, and with the screen
 * SHUT it read this list, which had not.
 *
 * They can never be placed, so nothing was ever assigned wrongly - the engine refuses each
 * one and the loop sets it aside. What it cost was worse than wasted `canAssign` calls:
 * acquiring, say, Gold in Antiquity gave auto-assign a "new resource" it could never place,
 * and since it only forgets an arrival after a pass that placed something, that arrival was
 * retried on every trigger for the rest of the game. The pool figure in "nothing could be
 * placed: N in the pool" was inflated by them too.
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

/**
 * A stand-in for the screen's model, carrying only what the planner reads.
 *
 * `isSlottingAvailable` is true because the planner waits on it before each step; with
 * the screen closed there is nothing to wait for.
 */
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
