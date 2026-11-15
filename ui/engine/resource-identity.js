/**
 * Which resource a record names: its value AND whether it is off-map.
 *
 * ⚠️ A plain `value` is ambiguous. An on-map resource's value is its PLOT INDEX; an off-map one's
 * is an id from its own sequence (`offMapId`), so the two can be equal. Game 1.5.1 added
 * `DoesMatchResource` to its own model for exactly this. Every Set/Map of resources keys on
 * `copyKey`, and every comparison goes through `sameCopy`.
 *
 * ⚠️ An on-map key is the bare value, unchanged: the save's resource locks and anything else
 * keyed before off-map handling existed still read without migration.
 *
 * Accepts both shapes: an engine entry (`value`, `isOffMap`, `uniqueResource`) and this mod's or
 * the screen's record (`resourceValue`, `isOffMap`). In engine/ because everything above uses it.
 */
import { warn } from '../support/diagnostics.js';

/** The game's own sentinel for "no off-map id" in operation args and event payloads. */
export const INVALID_OFF_MAP_ID = -1;

function valueOf(resource) {
    return resource?.resourceValue ?? resource?.value;
}

export function isOffMap(resource) {
    return resource?.isOffMap === true;
}

export function copyKeyOf(resourceValue, offMap) {
    return offMap ? `o${resourceValue}` : resourceValue;
}

export function copyKey(resource) {
    return copyKeyOf(valueOf(resource), isOffMap(resource));
}

export function sameCopy(a, b) {
    return valueOf(a) === valueOf(b) && isOffMap(a) === isOffMap(b);
}

/**
 * The resource an event payload names (`ResourceAssigned` / `ResourceUnassigned`), as a record.
 * ⚠️ An off-map payload carries the id in `offMapId` and a location that is not a plot.
 */
export function copyFromEvent(data) {
    const offMapId = data?.offMapId ?? INVALID_OFF_MAP_ID;
    if (offMapId !== INVALID_OFF_MAP_ID) {
        return { resourceValue: offMapId, isOffMap: true };
    }
    if (!data?.location) {
        return null;
    }
    return { resourceValue: GameplayMap.getIndexFromLocation(data.location), isOffMap: false };
}

/** The resource hash behind a value, for a caller holding no engine entry. */
export function resourceHashOf(resourceValue, offMap) {
    try {
        if (offMap) {
            return Players.get(GameContext.localPlayerID)?.Resources
                ?.getOffMapUniqueResourceFromId(resourceValue)?.uniqueResource?.resource;
        }
        return Game.Resources.getResourceOnPlot(resourceValue)?.resource;
    } catch (error) {
        return undefined;
    }
}

/**
 * The settlement a copy came from, or null.
 * ⚠️ `Game.Resources.getOriginCity` takes a PLOT index; asked about an off-map id it names
 * whatever settlement owns that plot. Off-map copies have their own accessor, and may have none.
 */
export function originCityOf(resourceValue, offMap) {
    try {
        if (offMap) {
            return Players.get(GameContext.localPlayerID)?.Resources?.getOffMapResourceOriginCity(resourceValue) ?? null;
        }
        return Game.Resources.getOriginCity(resourceValue) ?? null;
    } catch (error) {
        warn(`could not read where resource ${copyKeyOf(resourceValue, offMap)} came from: ${error}`);
        return null;
    }
}
