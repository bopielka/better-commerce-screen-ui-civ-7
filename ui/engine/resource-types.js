/**
 * A resource the player holds -> its `ResourceType` and `ResourceClassType`, memoised.
 *
 * ⚠️ `GameInfo.Resources.lookup(...)` IS A DATABASE CALL. The placement loop rebuilds the board
 * before every resource it places, so a full empire rebuild made thousands of these for a
 * column in a static table.
 *
 * ⚠️ Answered THROUGH `lookup` and keyed on whatever hash the engine hands over, so a patch
 * that changes the shape breaks nothing. A failed lookup is remembered as null, or the
 * resources the tables do not describe are the ones asked about forever.
 *
 * In engine/ because model/headless-model.js needs the class check too, and model may not import
 * planner/.
 */
import { onGameDataStale } from '../support/game-data.js';
import { warn } from '../support/diagnostics.js';

const typeByHash = new Map();
const classByType = new Map();

// The resource tables are the age's own - and so is each resource's class; see
// support/game-data.js.
onGameDataStale(() => {
    typeByHash.clear();
    classByType.clear();
});

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

/** @returns the `ResourceClassType` of a `ResourceType`, or null. */
export function resourceClassFromType(type) {
    if (!type) {
        return null;
    }
    const cached = classByType.get(type);
    if (cached !== undefined) {
        return cached;
    }
    let resourceClass = null;
    try {
        resourceClass = GameInfo.Resources.lookup(type)?.ResourceClassType ?? null;
    } catch (error) {
        warn(`could not read the class of ${type}: ${error}`);
        resourceClass = null;
    }
    classByType.set(type, resourceClass);
    return resourceClass;
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

/** Can a resource of this type go into a settlement at all? An unknown type can. */
export function isAssignableResourceType(type) {
    return !UNASSIGNABLE_CLASSES.has(resourceClassFromType(type));
}
