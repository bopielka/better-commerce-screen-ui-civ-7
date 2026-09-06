/**
 * What the empire's assigned resources earn per turn towards the Economic Victory.
 *
 * ⚠️ Every rate is read from `GameInfo.VictoryScorings`, never written as a number here - these are
 * exactly the values a balance patch moves, and a hardcoded one goes on looking right while being
 * wrong.
 *
 * ⚠️ SLOTTED_BONUS, SLOTTED_CITY and IMPORTED_RESOURCES pay in a CITY only; SLOTTED_FACTORY pays in
 * either. That asymmetry is why the three are counted separately rather than as one walk.
 *
 * ⚠️ EVERY ONE OF THEM CARRIES `RequiresActivation="true"` AND PAYS NOTHING UNTIL A PROGRESSION
 * TREE NODE SWITCHES IT ON. This file handed out the table's rate whatever the player had
 * researched, so a turn-one empire was promised GDP it could not earn. See `trackerRequirement`.
 */
import { ConstructibleHasTagType } from '/base-standard/ui/utilities/utilities-tags.js';

import { isImportedResource, resourceClassOf } from './facts.js';
import { buildSettlements } from '../model/headless-model.js';
import { onGameDataStale } from '../support/game-data.js';
import { warn } from '../support/diagnostics.js';

const SCORING = {
    bonus: 'VICTORY_TRACKER_SLOTTED_BONUS',
    city: 'VICTORY_TRACKER_SLOTTED_CITY',
    imported: 'VICTORY_TRACKER_IMPORTED_RESOURCES',
    factory: 'VICTORY_TRACKER_SLOTTED_FACTORY',
    goldBuildings: 'VICTORY_TRACKER_GOLD_BUILDINGS_ANTIQUITY',
};

/** The tag the gold-building tracker counts; its row carries it as `Data`. */
const GOLD_BUILDING_TAG = 'GOLD';
/** ⚠️ A TAG, not a column: `<Row Type="BUILDING_PALACE" Tag="AGELESS"/>`. */
const AGELESS_TAG = 'AGELESS';

const BONUS_CLASS = 'RESOURCECLASS_BONUS';
const CITY_CLASS = 'RESOURCECLASS_CITY';
const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

let rates = null;

/**
 * What a tracker still needs before it pays anything, or null once it does.
 *
 * ⚠️ A tracker with NO node in this age is NOT locked. `GameInfo` only ever holds the age being
 * played, and from Exploration onwards every civilization's trait activates the four antiquity
 * trackers outright - there is no node to find, and "no node" must therefore mean "already on".
 *
 * ⚠️ THE `TrackerName` ARGUMENT IS THE MARKER, and it is enough on its own: across Base and
 * every DLC it appears on `EFFECT_PLAYER_ACTIVATE_VICTORY_POINT_TRACKER` and on nothing else.
 * Resolving each candidate's effect properly would be a scan of the 12k-row `Modifiers` table to
 * learn what one argument name already says.
 *
 * ⚠️ Cleared with the rest of the age's data: `ProgressionTreeNodeUnlocks` is the AGE's table.
 */
let nodesByTracker = null;

onGameDataStale(() => {
    nodesByTracker = null;
});

/**
 * ⚠️ One pass over `ModifierArguments` - ~39k rows - keeping two small maps out of it, so the
 * cost is the iteration and nothing else. Built once per age, on the first GDP read.
 */
function indexTrackerNodes() {
    if (nodesByTracker) {
        return nodesByTracker;
    }
    nodesByTracker = new Map();
    try {
        const trackerOf = new Map();
        const attachesOf = new Map();
        GameInfo.ModifierArguments?.forEach((argument) => {
            if (argument.Name === 'TrackerName') {
                trackerOf.set(argument.ModifierId, argument.Value);
            } else if (argument.Name === 'ModifierId') {
                attachesOf.set(
                    argument.ModifierId,
                    String(argument.Value).split(',').map((id) => id.trim()),
                );
            }
        });

        GameInfo.ProgressionTreeNodeUnlocks?.forEach((unlock) => {
            if (unlock.TargetKind !== 'KIND_MODIFIER') {
                return;
            }
            /*
             * ⚠️ ONE LEVEL OF ATTACHMENT. The Wheel's node names a modifier that ATTACHES the two
             * doing the activating, so reading the node's own modifier alone finds neither of
             * them. Nothing in the data nests deeper.
             */
            for (const id of [unlock.TargetType, ...(attachesOf.get(unlock.TargetType) ?? [])]) {
                const tracker = trackerOf.get(id);
                if (!tracker) {
                    continue;
                }
                const node = describeNode(unlock.ProgressionTreeNodeType);
                if (!node) {
                    continue;
                }
                const nodes = nodesByTracker.get(tracker) ?? [];
                nodes.push(node);
                nodesByTracker.set(tracker, nodes);
            }
        });
    } catch (error) {
        warn(`could not work out which nodes unlock the victory trackers: ${error}`);
        nodesByTracker = new Map();
    }
    return nodesByTracker;
}

/** The node's name and which tree it is in, both resolved once rather than per read. */
function describeNode(nodeType) {
    try {
        const definition = GameInfo.ProgressionTreeNodes.lookup(nodeType);
        if (!definition) {
            return null;
        }
        const tree = GameInfo.ProgressionTrees.lookup(definition.ProgressionTree);
        return {
            type: nodeType,
            name: Locale.compose(definition.Name ?? nodeType),
            isCivic: tree?.SystemType === 'SYSTEM_CULTURE',
        };
    } catch (error) {
        warn(`could not read the progression tree node ${nodeType}: ${error}`);
        return null;
    }
}

function nodeUnlocked(node) {
    try {
        const player = Players.get(GameContext.localPlayerID);
        const library = node.isCivic ? player?.Culture : player?.Techs;
        return !!library?.isNodeUnlocked(node.type);
    } catch (error) {
        // ⚠️ Unknown counts as UNLOCKED. Claiming a tracker is locked hides points the player
        // may well be earning, which is the worse of the two errors.
        warn(`could not check whether ${node.type} is unlocked: ${error}`);
        return true;
    }
}

/** @returns what still has to be researched before `scoringId` pays anything, or null. */
export function trackerRequirement(scoringId) {
    const nodes = indexTrackerNodes().get(scoringId);
    if (!nodes?.length) {
        return null;
    }
    if (nodes.some(nodeUnlocked)) {
        return null;
    }
    return nodes.map((node) => node.name).join(', ');
}

function rateFor(scoringId) {
    if (!rates) {
        rates = new Map();
        try {
            for (const scoring of GameInfo.VictoryScorings ?? []) {
                rates.set(scoring.ScoringId, Number(scoring.Points) || 0);
            }
        } catch (error) {
            warn(`could not read the victory scoring rates: ${error}`);
        }
    }
    return rates.get(scoringId) ?? 0;
}

/** Two trackers feed one line, and in the data as it stands one node unlocks both. */
function mergeRequirements(first, second) {
    if (!first || !second) {
        return first ?? second ?? null;
    }
    return first === second ? first : `${first}, ${second}`;
}

/**
 * The `AGE_*` type of the age being played, for comparing against a building's `Age`.
 * ⚠️ Memoised on the same reasoning as `isFactoryAge` in engine/age.js: the age cannot change
 * without the UI being reloaded, and `GameInfo.Ages.lookup` is a database call.
 */
let ageType;

function currentAgeType() {
    if (ageType === undefined) {
        try {
            ageType = GameInfo.Ages.lookup(Game.age)?.AgeType ?? null;
        } catch (error) {
            warn(`could not read the current age: ${error}`);
            ageType = null;
        }
    }
    return ageType;
}

/**
 * How many paying gold buildings each settlement has.
 *
 * ⚠️ THE WALK IS THE COST: every constructible of every settlement, and each one is a
 * `Constructibles.getByComponentID` plus a `GameInfo.Constructibles.lookup`. `gdpPerTurn` is
 * rebuilt on a 400ms debounce after any resource event, so an assignment run with the screen
 * open did this from scratch dozens of times over while nothing about the buildings changed.
 *
 * ⚠️ Wall-clock, because there is no event this module hears. Buildings change on the scale of
 * turns; the burst of refreshes this exists to collapse is over in a second.
 */
const goldBuildingsByCity = new Map();
const BUILDINGS_CACHE_MS = 2000;
let buildingsReadAt = 0;

/** Gold buildings that actually pay, in this city. */
function goldBuildings(city, ageType) {
    if (Date.now() - buildingsReadAt > BUILDINGS_CACHE_MS) {
        goldBuildingsByCity.clear();
        buildingsReadAt = Date.now();
    }
    const key = String(city.id.id);
    const cached = goldBuildingsByCity.get(key);
    if (cached !== undefined) {
        return cached;
    }

    let count = 0;
    try {
        city.Constructibles?.getIds().forEach((id) => {
            const constructible = Constructibles.getByComponentID(id);
            const definition = constructible && GameInfo.Constructibles.lookup(constructible.type);
            if (!definition) {
                return;
            }
            const type = definition.ConstructibleType;
            if (!ConstructibleHasTagType(type, GOLD_BUILDING_TAG)) {
                return;
            }
            if (ConstructibleHasTagType(type, AGELESS_TAG) || definition.Age === ageType) {
                count++;
            }
        });
    } catch (error) {
        warn(`could not count gold buildings: ${error}`);
    }
    goldBuildingsByCity.set(key, count);
    return count;
}

/**
 * @returns { fromCities, fromImports, fromFactories, fromBuildings, total, locked } - GDP per
 *          turn, with `locked` naming what each line is still waiting to be researched.
 */
export function gdpPerTurn() {
    let fromCities = 0;
    let fromImports = 0;
    let fromFactories = 0;
    let fromBuildings = 0;

    const locked = {
        bonus: trackerRequirement(SCORING.bonus),
        city: trackerRequirement(SCORING.city),
        imported: trackerRequirement(SCORING.imported),
        factory: trackerRequirement(SCORING.factory),
        goldBuildings: trackerRequirement(SCORING.goldBuildings),
    };
    // A locked tracker pays nothing, so it must not be counted as if it did.
    const paying = (key) => (locked[key] ? 0 : rateFor(SCORING[key]));

    try {
        for (const settlement of buildSettlements()) {
            const isTown = !!settlement.settlementNameData?.isTown;
            for (const resource of settlement.slottedResources ?? []) {
                const className = resourceClassOf(resource);
                if (className === FACTORY_CLASS) {
                    fromFactories += paying('factory');
                    continue;
                }
                if (isTown) {
                    continue;
                }
                if (className === BONUS_CLASS) {
                    fromCities += paying('bonus');
                } else if (className === CITY_CLASS) {
                    fromCities += paying('city');
                } else {
                    continue;
                }
                // ⚠️ ADDITIONAL, not instead of: an imported resource pays both trackers,
                // which is what makes one worth double its home-grown equivalent.
                if (isImportedResource(resource)) {
                    fromImports += paying('imported');
                }
            }
        }
    } catch (error) {
        warn(`could not total the GDP from assigned resources: ${error}`);
    }

    try {
        const ageType = currentAgeType();
        for (const city of Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? []) {
            fromBuildings += goldBuildings(city, ageType) * paying('goldBuildings');
        }
    } catch (error) {
        warn(`could not total the GDP from gold buildings: ${error}`);
    }

    return {
        fromCities,
        fromImports,
        fromFactories,
        fromBuildings,
        total: fromCities + fromImports + fromFactories + fromBuildings,
        /** Per LINE of the tooltip rather than per tracker: the cities line is fed by two. */
        locked: {
            cities: mergeRequirements(locked.bonus, locked.city),
            imports: locked.imported,
            factories: locked.factory,
            buildings: locked.goldBuildings,
        },
    };
}
