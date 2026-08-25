/**
 * What the empire's assigned resources earn per turn towards the Economic Victory.
 *
 * ⚠️ Every rate is read from `GameInfo.VictoryScorings`, never written as a number here - these are
 * exactly the values a balance patch moves, and a hardcoded one goes on looking right while being
 * wrong.
 *
 * ⚠️ SLOTTED_BONUS, SLOTTED_CITY and IMPORTED_RESOURCES pay in a CITY only; SLOTTED_FACTORY pays in
 * either. That asymmetry is why the three are counted separately rather than as one walk.
 */
import { ConstructibleHasTagType } from '/base-standard/ui/utilities/utilities-tags.js';

import { isImportedResource, resourceClassOf } from './facts.js';
import { buildSettlements } from '../model/headless-model.js';
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
 * @returns { fromCities, fromImports, fromFactories, fromBuildings, total } - GDP per turn.
 */
export function gdpPerTurn() {
    let fromCities = 0;
    let fromImports = 0;
    let fromFactories = 0;
    let fromBuildings = 0;

    try {
        for (const settlement of buildSettlements()) {
            const isTown = !!settlement.settlementNameData?.isTown;
            for (const resource of settlement.slottedResources ?? []) {
                const className = resourceClassOf(resource);
                if (className === FACTORY_CLASS) {
                    fromFactories += rateFor(SCORING.factory);
                    continue;
                }
                if (isTown) {
                    continue;
                }
                if (className === BONUS_CLASS) {
                    fromCities += rateFor(SCORING.bonus);
                } else if (className === CITY_CLASS) {
                    fromCities += rateFor(SCORING.city);
                } else {
                    continue;
                }
                // ⚠️ ADDITIONAL, not instead of: an imported resource pays both trackers,
                // which is what makes one worth double its home-grown equivalent.
                if (isImportedResource(resource)) {
                    fromImports += rateFor(SCORING.imported);
                }
            }
        }
    } catch (error) {
        warn(`could not total the GDP from assigned resources: ${error}`);
    }

    try {
        const ageType = currentAgeType();
        for (const city of Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? []) {
            fromBuildings += goldBuildings(city, ageType) * rateFor(SCORING.goldBuildings);
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
    };
}
