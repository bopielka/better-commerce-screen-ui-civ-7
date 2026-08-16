/**
 * What the empire's assigned resources earn per turn towards the Economic Victory.
 *
 * The Factory tab already showed this for factory resources alone. It is the same currency
 * everywhere, though, and the other two sources are invisible - so the figure that answers
 * "what is all of this worth" did not exist anywhere on the screen.
 *
 * ⚠️ Every rate is read from `GameInfo.VictoryScorings`, never written as a number here.
 * These are exactly the kind of value a balance patch moves, and a hardcoded one would go
 * on looking right while being wrong.
 *
 *   VICTORY_TRACKER_SLOTTED_BONUS       1   a Bonus resource in a CITY
 *   VICTORY_TRACKER_SLOTTED_CITY        1   a City resource in a CITY
 *   VICTORY_TRACKER_IMPORTED_RESOURCES  1   ADDITIONAL, for one that came over a trade route
 *   VICTORY_TRACKER_SLOTTED_FACTORY     3   a Factory resource, city or town alike
 *
 * ⚠️ The first three pay in a CITY only - "assigned to a City (not a Town)", in the game's
 * own words - while the factory one pays in either. That asymmetry is the whole reason the
 * three are counted separately rather than as one walk with one rate.
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

/** The `AGE_*` type of the age being played, for comparing against a building's `Age`. */
function currentAgeType() {
    try {
        return GameInfo.Ages.lookup(Game.age)?.AgeType ?? null;
    } catch (error) {
        warn(`could not read the current age: ${error}`);
        return null;
    }
}

/**
 * Gold buildings that actually pay, in this city.
 *
 * ⚠️ Counted by TAG, not by a list of names - `VICTORY_TRACKER_GOLD_BUILDINGS_*` carries
 * `Data="GOLD"` and the game tags its buildings with it, so a DLC building is covered
 * without this knowing it exists. Note the tag is shared with RESOURCES (Jade, Silver,
 * Camels…); looking the id up in `GameInfo.Constructibles` is what keeps those out.
 *
 * ⚠️ "Of the current age", which the tracker means literally: a Market pays in Antiquity
 * and stops paying in Exploration. Without this the figure kept counting every gold
 * building the empire had ever built and drifted further from the truth each age.
 *
 * ⚠️ Except the AGELESS ones, which pay in every age. That is a TypeTag - `<Row
 * Type="BUILDING_PALACE" Tag="AGELESS"/>` - and NOT a column on the constructible, so it
 * has to be asked for the same way the gold tag is.
 */
function goldBuildings(city, ageType) {
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
