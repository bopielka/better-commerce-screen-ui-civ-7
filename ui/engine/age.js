/**
 * Which age the game is in, worked out once.
 *
 * ⚠️ `Database.makeHash` is a lookup, not a constant, and the planner asks this for every
 * resource-settlement pair it scores. The age cannot change mid-game, so the cache is safe.
 *
 * In engine/ rather than beside the Factory tab: three modules across two layers ask it, and
 * the planner may not import a screen module.
 */
import { onGameDataStale } from '../support/game-data.js';

let modernAge = null;

export function isFactoryAge() {
    if (modernAge === null) {
        try {
            modernAge = Game.age === Database.makeHash('AGE_MODERN');
        } catch (error) {
            return false;
        }
    }
    return modernAge;
}

/** ⚠️ Cached too: tab-icons.js asks this six times on every pass of its observer. */
let explorationAge = null;

/*
 * ⚠️ THE ONE CACHE HERE THAT THE AGE ITSELF INVALIDATES. Both answers are "which age is this",
 * so an age transition inverts them - and every other cache in the mod that is keyed by age
 * trusts these two. See support/game-data.js.
 */
onGameDataStale(() => {
    modernAge = null;
    explorationAge = null;
});

export function isExplorationAge() {
    if (explorationAge === null) {
        try {
            explorationAge = Game.age === Database.makeHash('AGE_EXPLORATION');
        } catch (error) {
            return false;
        }
    }
    return explorationAge;
}
