/**
 * What an empire resource is actually worth to THIS empire, right now.
 *
 * The Empire tab shows the rule - "+1 Gold and Happiness in all settlements" - which reads the
 * same whether you hold one settlement or twenty. This works out the total.
 *
 * Read out of the modifier tables, because the aggregation rule belongs to the EFFECT rather than
 * to the resource:
 *   ADJUST_YIELD_PER_AVAILABLE_RESOURCE_TYPE / ADJUST_YIELD_PER_RESOURCE
 *       Amount x copies held x settlements the modifier reaches.
 *   UNIT_ADJUST_COMBAT_STRENGTH_PER_RESOURCE   Amount x copies across the army, capped.
 *   CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_RESOURCE   a percentage towards one building kind.
 * How far a city-wide effect reaches is narrowed by the modifier's COLLECTION and then by its
 * requirements.
 *
 * ⚠️ The combat cap is NOT in the data. Every one of these resources says "(maximum +6)" in its
 * description but no argument, parameter or table carries it - the engine holds it. If a patch
 * changes the cap, the constant here is the line that will be wrong.
 *
 * ⚠️ Effects this cannot total are LEFT OUT rather than guessed at. The card still carries the
 * game's own description in its tooltip, so nothing goes missing - it just gets no number.
 */
import { collectionOf, effectTypeOf, modifierApplies, modifierRequirements, resourceModifiers } from './effects.js';
import { buildSettlements } from '../model/headless-model.js';
import { warn } from '../support/diagnostics.js';
import { onGameDataStale } from '../support/game-data.js';

/** See the note above: the engine's, not the data's. */
const COMBAT_STRENGTH_CAP = 6;

/*
 * ⚠️ ALL FOUR SUFFIXES SCALE WITH COPIES - `PER_RESOURCE`, `PER_AVAILABLE_RESOURCE_TYPE`,
 * `PER_RESOURCE_TYPE`, `PER_SLOTTED_RESOURCE`. Reading the `_TYPE` names as "once for the whole
 * empire" is wrong: measured in play, one more copy of Gold raised income by the settlement count.
 * What distinguishes PER_RESOURCE_TYPE is its SCOPE - it pays the PLAYER, which the collection
 * already says.
 */
const PER_TYPE_YIELD = 'ADJUST_YIELD_PER_AVAILABLE_RESOURCE_TYPE';
const PER_TYPE_PLAYER_YIELD = 'PLAYER_ADJUST_YIELD_PER_RESOURCE_TYPE';
const PER_COPY_YIELD = 'ADJUST_YIELD_PER_RESOURCE';
const PER_COPY_COMBAT = 'ADJUST_COMBAT_STRENGTH_PER_RESOURCE';
const CONSTRUCTIBLE_PRODUCTION = 'ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_RESOURCE';
/** A percentage towards UNIT production rather than a building - Hardwood, as of this writing. */
const UNIT_PRODUCTION = 'ADJUST_UNIT_PRODUCTION_PER_RESOURCE';

/** Which units a combat bonus reaches. */
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

// The unit tables are the age's own; see support/game-data.js.
onGameDataStale(() => {
    unitsByClass = null;
});

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

/** The only condition on these resources that is about the player rather than a settlement. */
const GOLDEN_AGE_REQUIREMENT = 'REQUIREMENT_PLAYER_IS_IN_GOLDEN_AGE';

function inGoldenAge() {
    try {
        return !!Players.get(GameContext.localPlayerID)?.Happiness?.isInGoldenAge();
    } catch (error) {
        return false;
    }
}

/** Whether a modifier's player-level condition holds right now. */
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
 * Every unit class the bonus reaches, including ones the modifier never names - a requirement on
 * "all naval" covers the light and heavy classes under it.
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

/** "All naval, siege" - the covering class swallows the ones beneath it. */
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

/** ⚠️ Named as an ARGUMENT rather than as a requirement, unlike everything else here. */
const DOMAIN_UNIT_NAMES = {
    DOMAIN_SEA: UNIT_CLASS_NAMES.UNIT_CLASS_NAVAL,
};

/** Argument values `UnitClass` can carry that are not also combat-modifier tags. */
const PRODUCTION_UNIT_CLASS_NAMES = {
    UNIT_CLASS_NON_COMBAT: 'LOC_NAJANE_COMMERCE_UNITS_CIVILIAN',
};

function unitProductionTargetName(argumentsMap) {
    const domainKey = DOMAIN_UNIT_NAMES[argumentsMap.get('Domain')];
    if (domainKey) {
        return Locale.compose(domainKey);
    }
    const classKey = PRODUCTION_UNIT_CLASS_NAMES[argumentsMap.get('UnitClass')];
    return classKey ? Locale.compose(classKey) : null;
}

/** What a production bonus is spent on, in the game's own words. */
function constructibleName(constructibleType) {
    try {
        return Locale.compose(GameInfo.Constructibles.lookup(constructibleType)?.Name ?? constructibleType);
    } catch (error) {
        return null;
    }
}

/** How many settlements a modifier actually reaches. */
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

/** The totals for one resource type. */
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
        // ⚠️ `Percent`, not `Amount`, for this one effect.
        const amount = Number(argumentsMap.get('Amount') ?? argumentsMap.get('Percent'));
        if (!Number.isFinite(amount) || amount === 0) {
            return;
        }
        const yieldType = argumentsMap.get('YieldType');
        // A bonus that only pays during a Celebration is still worth showing, but it is
        // not income today - see playerCondition and how the summary uses this.
        const { conditional, active } = playerCondition(modifierId);

        if ((effect.includes(PER_TYPE_YIELD) || effect.includes(PER_TYPE_PLAYER_YIELD) || effect.includes(PER_COPY_YIELD)) && yieldType) {
        // All three count copies; see the suffix note at the top.
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
    // ⚠️ Keyed by which units it reaches, NOT by "combat": two combat modifiers on different
    // classes are two separate bonuses, not one counted twice.
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

/** A percentage towards building something - coal's rail stations and ports, oil's. */
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
            return;
        }

/** A percentage towards producing a KIND OF UNIT rather than a building. */
        if (effect.includes(UNIT_PRODUCTION)) {
            const target = unitProductionTargetName(argumentsMap);
            const entry = byKey.get(`percent:${amount}`);
            if (entry) {
                if (target && !entry.towards.includes(target)) {
                    entry.towards.push(target);
                }
                return;
            }
            add(`percent:${amount}`, {
                kind: 'percent',
                amount: amount * copies,
                perCopy: amount,
                scales: true,
                towards: target ? [target] : [],
                conditional,
                active,
            });
        }
    });

    return totals;
}

/**
 * Called when the tab is opened, so a fresh reading is taken each time.
 * ⚠️ THE ARMY, and nothing else. The modifier index this file reads through is static schema and
 * is built once for the session; see the note on it in effects.js.
 */
export function forgetEmpireEffects() {
    unitsByClass = null;
}
