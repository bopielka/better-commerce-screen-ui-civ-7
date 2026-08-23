/**
 * Turning a resource the player holds into its `ResourceType`, without asking the database
 * the same question over and over.
 *
 * ⚠️ `GameInfo.Resources.lookup(...)` IS A DATABASE CALL, and this exact line -
 *
 *     GameInfo.Resources.lookup(resource.uniqueResource?.resource)?.ResourceType
 *
 * - was written out in six places, three of them walking the same list one after another.
 * The placement loop rebuilds the board before every single resource it places, so a full
 * empire rebuild made thousands of these calls for an answer that is a column in a static
 * table and cannot change while the game is running.
 *
 * ⚠️ Answered THROUGH `lookup`, not by pre-building a map of every row. The hash is what the
 * engine hands over today; keying the memo on whatever arrives, and resolving it through the
 * call that always resolved it, means a patch that changes the shape breaks nothing here.
 *
 * ⚠️ A failed lookup is remembered too - as null. Otherwise a resource the tables do not
 * describe is the one that gets asked about on every pass, forever.
 */

const typeByHash = new Map();

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
 * The same, for an entry as the engine hands it over.
 *
 * That is anything out of `player.Resources.getResources()` or
 * `city.Resources.getAssignedResources()` - both carry the resource as
 * `uniqueResource.resource`, which is the unwrapping the game's own
 * `trade-routes-model.js` does to draw its icons.
 */
export function heldResourceType(held) {
    return resourceTypeFromHash(held?.uniqueResource?.resource);
}
