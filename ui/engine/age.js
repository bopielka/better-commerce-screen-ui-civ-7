/**
 * Which age the game is in.
 *
 * `Database.makeHash` is a lookup, not a constant, so the answer is worked out once and
 * kept: the planner asks this for every resource-settlement pair it scores, which is
 * hundreds of thousands of hashes over one "Assign All". The age cannot change while the
 * game is running, so caching it is safe by construction.
 *
 * It lives here rather than beside the Factory tab that first needed it because three
 * modules across two layers ask the question, and the planner asking a screen module
 * meant the assignment engine could not be loaded without the UI behind it.
 */
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

export function isExplorationAge() {
    try {
        return Game.age === Database.makeHash('AGE_EXPLORATION');
    } catch (error) {
        return false;
    }
}
