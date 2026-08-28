/**
 * A resource the player holds -> its `ResourceType`, memoised.
 *
 * ⚠️ `GameInfo.Resources.lookup(...)` IS A DATABASE CALL. The placement loop rebuilds the board
 * before every resource it places, so a full empire rebuild made thousands of these for a
 * column in a static table.
 *
 * ⚠️ Answered THROUGH `lookup` and keyed on whatever hash the engine hands over, so a patch
 * that changes the shape breaks nothing. A failed lookup is remembered as null, or the
 * resources the tables do not describe are the ones asked about forever.
 */
import { onGameDataStale } from '../support/game-data.js';

const typeByHash = new Map();

// The resource tables are the age's own; see support/game-data.js.
onGameDataStale(() => typeByHash.clear());

/** @returns the `ResourceType` string for a resource hash, or null. */
export function resourceTypeFromHash(hash) {
    if (hash === undefined || hash === null) {
        return null;
    }
    const cached = typeByHash.get(hash);
    if (cached !== undefined) {
        return cached;
    }
    let type = null;
    try {
        type = GameInfo.Resources.lookup(hash)?.ResourceType ?? null;
    } catch (error) {
        type = null;
    }
    typeByHash.set(hash, type);
    return type;
}

/**
 * The same, for an entry out of `player.Resources.getResources()` or
 * `city.Resources.getAssignedResources()` - both carry it as `uniqueResource.resource`.
 */
export function heldResourceType(held) {
    return resourceTypeFromHash(held?.uniqueResource?.resource);
}
