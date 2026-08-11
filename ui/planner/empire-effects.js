/**
 * What an empire resource is actually worth to THIS empire, right now.
 *
 * The Empire tab shows each resource's rule - "+1 Gold and Happiness in all settlements" -
 * which is the same sentence whether you hold one settlement or twenty. This works out the
 * total: twelve settlements make that line worth +12 Gold and +12 Happiness.
 *
 * How the numbers are reached
 * ---------------------------
 * Out of the modifier tables, the same way planner/effects.js reads them, because the
 * aggregation rule belongs to the EFFECT behind a resource rather than to the resource:
 *
 *   EFFECT_CITY_ADJUST_YIELD_PER_AVAILABLE_RESOURCE_TYPE   Gold, Silver, Wine, Furs...
 *   EFFECT_CITY_ADJUST_YIELD_PER_RESOURCE                  Ivory, Horses, Pearls...
 *       Both: Amount x copies held x settlements the modifier reaches.
 *
 *   EFFECT_UNIT_ADJUST_COMBAT_STRENGTH_PER_RESOURCE        Saltpeter, Coal, Oil, Rubber
 *       Amount x copies, across the whole army, capped.
 *
 *   EFFECT_CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_RESOURCE   Coal, Oil
 *       A percentage, Amount x copies, towards one kind of building.
 *
 * How far a city-wide effect reaches is narrowed by two separate things: the modifier's
 * COLLECTION (all cities, the capital only, the player) and then its requirements.
 *
 * ⚠️ The combat cap is NOT in the data. Every one of these resources says "(maximum +6)"
 * in its own description, but no modifier argument, global parameter or table carries the
 * number - the engine holds it. So it is a constant here, and if a patch changes the cap
 * this is the line that will be wrong. Everything else is read from the game.
 *
 * ⚠️ Effects this does not know how to total are left out rather than guessed at. The
 * card still carries the game's own description in its tooltip, so nothing goes missing -
 * it simply does not get a number of its own.
 */
import { collectionOf, effectTypeOf, forgetModifierIndex, modifierApplies, modifierRequirements, resourceModifiers } from './effects.js';
import { buildSettlements } from '../model/headless-model.js';
import { warn } from '../support/diagnostics.js';

/** See the note above: the engine's, not the data's. */
const COMBAT_STRENGTH_CAP = 6;

/*
 * Four suffixes live side by side in the same files, chosen modifier by modifier:
 *
 *   PER_RESOURCE                  62 uses
 *   PER_AVAILABLE_RESOURCE_TYPE   29 uses
 *   PER_RESOURCE_TYPE              3 uses
 *   PER_SLOTTED_RESOURCE           7 uses
 *
 * ⚠️ An earlier version of this file read those names as the counting rule and concluded
 * that the two carrying `_TYPE` pay once for the whole empire. Play says otherwise:
 * improving one more copy of Gold raised income by roughly the settlement count, which
 * that reading predicts should not happen at all.
 *
 * ⚠️ The same correction applies to PER_RESOURCE_TYPE, which was left flat for one round
 * longer than it should have been - Wine showed +10 Culture whether you held one bottle or
 * six. Nothing distinguishes it from the other three except its scope: it is the only one
 * that pays the PLAYER rather than each settlement, which is what the collection already
 * says. So: ALL FOUR scale with copies; whatever the naming distinguishes, it is not that.
 *
 * The lesson is bigger than the number: a name in the data is a hypothesis, and a
 * measurement in the running game outranks it.
 */
const PER_TYPE_YIELD = 'ADJUST_YIELD_PER_AVAILABLE_RESOURCE_TYPE';
const PER_TYPE_PLAYER_YIELD = 'PLAYER_ADJUST_YIELD_PER_RESOURCE_TYPE';
const PER_COPY_YIELD = 'ADJUST_YIELD_PER_RESOURCE';
const PER_COPY_COMBAT = 'ADJUST_COMBAT_STRENGTH_PER_RESOURCE';
const CONSTRUCTIBLE_PRODUCTION = 'ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_RESOURCE';

/**
 * Which units a combat bonus reaches.
 *
 * ⚠️ The unit-class tags have no name anywhere in the game's data - nothing displays them,
 * so nothing translates them. The resource descriptions spell the classes out in prose,
 * written by hand per resource. These keys are therefore the mod's own; see
 * text/<locale>/InGameText.xml.
 *
 * ⚠️ LIGHT and HEAVY are NAVAL classes, which is not obvious from the tag and was wrong
 * here at first - "light" and "heavy" on their own read as land units. Checked against
 * age-modern/data/units.xml: UNIT_CLASS_LIGHT is the cruiser, destroyer and ironclad;
 * UNIT_CLASS_HEAVY is the battleship, dreadnought and frigate. The game's own descriptions
 * say "light naval units" for exactly this reason.
 */
const UNIT_CLASS_NAMES = {
    UNIT_CLASS_AIRCRAFT: 'LOC_NAJANE_COMMERCE_UNITS_AIRCRAFT',
    UNIT_CLASS_CAVALRY: 'LOC_NAJANE_COMMERCE_UNITS_CAVALRY',
    UNIT_CLASS_HEAVY: 'LOC_NAJANE_COMMERCE_UNITS_HEAVY',
    UNIT_CLASS_INFANTRY: 'LOC_NAJANE_COMMERCE_UNITS_INFANTRY',
    UNIT_CLASS_LIGHT: 'LOC_NAJANE_COMMERCE_UNITS_LIGHT',
    UNIT_CLASS_NAVAL: 'LOC_NAJANE_COMMERCE_UNITS_NAVAL',
    UNIT_CLASS_RANGED: 'LOC_NAJANE_COMMERCE_UNITS_RANGED',
    UNIT_CLASS_SIEGE: 'LOC_NAJANE_COMMERCE_UNITS_SIEGE',
};

/** Naval and its two halves; see the note in unitClassesOf. */
const NAVAL_CLASS = 'UNIT_CLASS_NAVAL';
const NAVAL_SUBDIVISIONS = ['UNIT_CLASS_LIGHT', 'UNIT_CLASS_HEAVY'];

let unitsByClass = null;

/** Which units carry each named class, in the age being played. */
function indexUnitClasses() {
    if (unitsByClass) {
        return unitsByClass;
    }
    unitsByClass = new Map();
    try {
        const units = new Set();
        GameInfo.Units?.forEach((unit) => units.add(unit.UnitType));
        GameInfo.TypeTags?.forEach((row) => {
            // TypeTags carries tags for everything; only unit rows matter here.
            if (!UNIT_CLASS_NAMES[row.Tag] || !units.has(row.Type)) {
                return;
            }
            if (!unitsByClass.has(row.Tag)) {
                unitsByClass.set(row.Tag, new Set());
            }
            unitsByClass.get(row.Tag).add(row.Type);
        });
    } catch (error) {
        warn(`could not index unit classes: ${error}`);
    }
    return unitsByClass;
}

/**
 * The only condition on these resources that is about the player rather than a settlement.
 *
 * Three modifiers carry it - furs and tea pay gold during a Celebration and nothing
 * outside one. Every other requirement in the resource data is city-level (handled by the
 * shared evaluator) or a unit tag.
 */
const GOLDEN_AGE_REQUIREMENT = 'REQUIREMENT_PLAYER_IS_IN_GOLDEN_AGE';

function inGoldenAge() {
    try {
        return !!Players.get(GameContext.localPlayerID)?.Happiness?.isInGoldenAge();
    } catch (error) {
        return false;
    }
}

/**
 * Whether a modifier's player-level condition holds right now.
 *
 * @returns { conditional, active } - conditional says the bonus comes and goes, active
 *          says whether it is being paid at this moment.
 */
function playerCondition(modifierId) {
    for (const entry of modifierRequirements(modifierId)?.entries ?? []) {
        if (entry.type !== GOLDEN_AGE_REQUIREMENT) {
            continue;
        }
        const met = entry.inverse ? !inGoldenAge() : inGoldenAge();
        return { conditional: true, active: met };
    }
    return { conditional: false, active: true };
}

/** The tags a combat modifier is gated on, straight from its requirements. */
function taggedClasses(modifierId) {
    const tags = [];
    for (const entry of modifierRequirements(modifierId)?.entries ?? []) {
        if (entry.type !== 'REQUIREMENT_UNIT_TAG_MATCHES') {
            continue;
        }
        for (const tag of String(entry.args.get('Tag') ?? '').split(',')) {
            if (UNIT_CLASS_NAMES[tag.trim()]) {
                tags.push(tag.trim());
            }
        }
    }
    return tags;
}

/**
 * Every unit class the bonus actually reaches - including ones the modifier never names.
 *
 * ⚠️ Unit classes OVERLAP. A battleship is SIEGE and NAVAL and HEAVY and RANGED all at
 * once. So saltpeter, written as RANGED + SIEGE, reaches every heavy warship in the age -
 * which is why the game's own description for it talks about heavy naval units, and why
 * listing only the two named tags left a player looking at a battleship unable to tell
 * whether it was included. It was.
 *
 * A class is listed when EVERY unit in it is covered. Naval is not added to saltpeter, for
 * instance, because light warships are naval and are not reached - the test is containment,
 * not overlap, so nothing is ever claimed that is not true of the whole class.
 */
function unitClassesOf(modifierId) {
    const tags = taggedClasses(modifierId);
    if (tags.length === 0) {
        return [];
    }
    const byClass = indexUnitClasses();

    const covered = new Set();
    for (const tag of tags) {
        for (const unit of byClass.get(tag) ?? []) {
            covered.add(unit);
        }
    }

    const wholeClasses = [];
    for (const tag of Object.keys(UNIT_CLASS_NAMES)) {
        const units = byClass.get(tag);
        if (!units || units.size === 0) {
            continue;
        }
        let whole = true;
        for (const unit of units) {
            if (!covered.has(unit)) {
                whole = false;
                break;
            }
        }
        if (whole) {
            wholeClasses.push(tag);
        }
    }

    /*
     * "All naval, siege" - not "heavy naval, light naval, all naval, siege".
     *
     * LIGHT and HEAVY are subdivisions of NAVAL (checked below rather than assumed), so
     * once the whole of NAVAL is covered, naming the halves as well is noise. In an age
     * where only some warships are reached, NAVAL is not listed and the halves stay - which
     * is the whole point of them, since "heavy naval" then says something "ranged" does not.
     *
     * Deliberately NOT a general "drop any class contained in another": in the Modern age
     * every heavy warship happens to be ranged as well, so that rule would quietly delete
     * "heavy naval" from saltpeter - the one class a player checking their battleship is
     * looking for. Containment between roles is a coincidence of one age's roster;
     * containment within naval is a taxonomy.
     */
    const listed = new Set(wholeClasses);
    const navalUnits = byClass.get(NAVAL_CLASS);
    if (listed.has(NAVAL_CLASS) && navalUnits) {
        for (const half of NAVAL_SUBDIVISIONS) {
            const units = byClass.get(half);
            if (units && [...units].every((unit) => navalUnits.has(unit))) {
                listed.delete(half);
            }
        }
    }

    const names = Object.keys(UNIT_CLASS_NAMES)
        .filter((tag) => listed.has(tag))
        .map((tag) => Locale.compose(UNIT_CLASS_NAMES[tag]));

    // Fall back to the named tags if the unit tables could not be read.
    return names.length ? names : tags.map((tag) => Locale.compose(UNIT_CLASS_NAMES[tag]));
}

/** What a production bonus is spent on, in the game's own words. */
function constructibleName(constructibleType) {
    try {
        return Locale.compose(GameInfo.Constructibles.lookup(constructibleType)?.Name ?? constructibleType);
    } catch (error) {
        return null;
    }
}

/**
 * How many settlements a modifier actually reaches.
 *
 * Both narrowings apply: the collection says WHICH settlements are in scope at all, and
 * the requirements - "in the homeland", "cities only" - then filter those, through the
 * same evaluator the assignment scoring uses.
 */
function settlementsReached(modifierId, settlements) {
    const collection = collectionOf(modifierId);
    let inScope = settlements;

    if (collection.includes('CAPITAL')) {
        inScope = settlements.filter((settlement) => isCapital(settlement));
    } else if (collection.includes('PLAYER')) {
        // A player-level effect lands once, not once per settlement.
        return 1;
    }
    return inScope.filter((settlement) => modifierApplies(modifierId, settlement)).length;
}

function isCapital(settlement) {
    try {
        return !!Cities.get(settlement.cityID)?.isCapital;
    } catch (error) {
        return false;
    }
}

/**
 * The totals for one resource type.
 *
 * @param resourceType e.g. RESOURCE_GOLD
 * @param copies       how many of it the player holds
 * @returns [{ kind: 'yield'|'combat'|'percent', yieldType, amount, isPercent }]
 */
export function empireEffectTotals(resourceType, copies, settlements = null) {
    const reachable = settlements ?? buildSettlements();
    const totals = [];

    /** Two modifiers granting the same yield are one line, not two. */
    const byKey = new Map();
    const add = (key, entry) => {
        const existing = byKey.get(key);
        if (existing) {
            existing.amount += entry.amount;
            existing.perCopy += entry.perCopy;
            existing.scales = existing.scales || entry.scales;
            return;
        }
        byKey.set(key, entry);
        totals.push(entry);
    };

    resourceModifiers(resourceType).forEach((argumentsMap, modifierId) => {
        const effect = effectTypeOf(modifierId);
        const amount = Number(argumentsMap.get('Amount'));
        if (!Number.isFinite(amount) || amount === 0) {
            return;
        }
        const yieldType = argumentsMap.get('YieldType');
        // A bonus that only pays during a Celebration is still worth showing, but it is
        // not income today - see playerCondition and how the summary uses this.
        const { conditional, active } = playerCondition(modifierId);

        if ((effect.includes(PER_TYPE_YIELD) || effect.includes(PER_TYPE_PLAYER_YIELD) || effect.includes(PER_COPY_YIELD)) && yieldType) {
            /*
             * All three count copies - see the note on the suffixes above for why the names
             * suggest otherwise. What still differs is REACH, and that comes from the
             * collection rather than the effect: a settlement-scoped bonus pays once per
             * settlement it reaches, a player-scoped one pays once, full stop.
             */
            const each = amount * settlementsReached(modifierId, reachable);
            add(`yield:${yieldType}:${active}`, {
                kind: 'yield',
                yieldType,
                amount: each * copies,
                perCopy: each,
                scales: true,
                conditional,
                active,
            });
            return;
        }

        if (effect.includes(PER_COPY_COMBAT)) {
            const units = unitClassesOf(modifierId);
            /*
             * ⚠️ Keyed by which units it reaches, NOT by "combat". Two combat modifiers on
             * one resource are two separate bonuses - a siege unit does not also collect
             * the one written for destroyers - so merging them into a single line both
             * added up numbers that never add up and silently kept only the first
             * modifier's unit list. No resource in the shipped data has two, but the next
             * patch or the next mod is a poor thing to be relying on.
             */
            add(`combat:${units.join('|')}`, {
                kind: 'combat',
                amount: Math.min(amount * copies, COMBAT_STRENGTH_CAP),
                perCopy: amount,
                scales: true,
                capped: amount * copies > COMBAT_STRENGTH_CAP,
                units,
                conditional,
                active,
            });
            return;
        }

        /*
         * A percentage towards building something - coal's rail stations and ports, oil's
         * factories. PER_RESOURCE, so it scales with copies; the `Empire = true` argument
         * says WHICH copies are counted - the whole empire's, rather than the ones assigned
         * to the settlement being built in.
         */
        if (effect.includes(CONSTRUCTIBLE_PRODUCTION)) {
            const building = constructibleName(argumentsMap.get('ConstructibleType'));
            const entry = byKey.get(`percent:${amount}`);
            if (entry) {
                if (building && !entry.towards.includes(building)) {
                    entry.towards.push(building);
                }
                return;
            }
            add(`percent:${amount}`, {
                kind: 'percent',
                amount: amount * copies,
                perCopy: amount,
                scales: true,
                towards: building ? [building] : [],
                conditional,
                active,
            });
        }
    });

    return totals;
}

/** Called when the tab is opened, so a fresh reading is taken each time. */
export function forgetEmpireEffects() {
    forgetModifierIndex();
    unitsByClass = null;
}
