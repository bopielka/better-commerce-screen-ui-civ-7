/**
 * Reading what a resource actually does, from the modifier tables.
 *
 * ⚠️ Indexed ONCE and answered from the index. `GameInfo.Modifiers` and `GameInfo.DynamicModifiers`
 * are thousands of rows each, and joining them per question is a full scan of both.
 */
import { warn } from '../support/diagnostics.js';

let argumentsByResource = null;
let requirementsByModifier = null;

/** Every modifier attached to a resource, however it is attached, with its arguments. */
function indexResourceModifiers() {
    if (argumentsByResource) {
        return argumentsByResource;
    }
    argumentsByResource = new Map();

    const argumentsByModifier = new Map();
    const modifierResource = new Map();

    GameInfo.ModifierArguments?.forEach((argument) => {
        if (!argumentsByModifier.has(argument.ModifierId)) {
            argumentsByModifier.set(argument.ModifierId, new Map());
        }
        argumentsByModifier.get(argument.ModifierId).set(argument.Name, argument.Value);
        // The direct link: the modifier names the resource it is about.
        if (argument.Name === 'ResourceType') {
            modifierResource.set(argument.ModifierId, argument.Value);
        }
    });

    // The indirect link, which most - but not all - modifiers also carry.
    GameInfo.ModifierMetadatas?.forEach((metadata) => {
        if (metadata.FieldName === 'ResourceType') {
            modifierResource.set(metadata.ModifierId ?? metadata.ModifierID, metadata.String);
        }
    });

    modifierResource.forEach((resourceType, modifierId) => {
        if (!argumentsByResource.has(resourceType)) {
            argumentsByResource.set(resourceType, new Map());
        }
        argumentsByResource.get(resourceType).set(modifierId, argumentsByModifier.get(modifierId) ?? new Map());
    });

    return argumentsByResource;
}

/** modifierId -> its subject requirements, the ones that describe the settlement. */
function indexRequirements() {
    if (requirementsByModifier) {
        return requirementsByModifier;
    }
    requirementsByModifier = new Map();

    const requirement = new Map();
    GameInfo.Requirements?.forEach((row) => {
        requirement.set(row.RequirementId, {
            type: row.RequirementType,
            inverse: !!row.Inverse,
            args: new Map(),
        });
    });
    GameInfo.RequirementArguments?.forEach((row) => {
        requirement.get(row.RequirementId)?.args.set(row.Name, row.Value);
    });

    const setRequirements = new Map();
    GameInfo.RequirementSetRequirements?.forEach((row) => {
        if (!setRequirements.has(row.RequirementSetId)) {
            setRequirements.set(row.RequirementSetId, []);
        }
        const entry = requirement.get(row.RequirementId);
        if (entry) {
            setRequirements.get(row.RequirementSetId).push(entry);
        }
    });

    const setType = new Map();
    GameInfo.RequirementSets?.forEach((row) => setType.set(row.RequirementSetId, row.RequirementSetType));

    GameInfo.Modifiers?.forEach((row) => {
        const setId = row.SubjectRequirementSetId;
        if (!setId || !setRequirements.has(setId)) {
            return;
        }
        requirementsByModifier.set(row.ModifierId, {
            all: setType.get(setId) !== 'REQUIREMENTSET_TEST_ANY',
            entries: setRequirements.get(setId),
        });
    });

    return requirementsByModifier;
}

/** Can this settlement satisfy one requirement? */
function meetsRequirement(entry, settlement, city) {
    const isTown = !!settlement.settlementNameData?.isTown;
    let met;

    switch (entry.type) {
        case 'REQUIREMENT_CITY_IS_CITY':
            met = !isTown;
            break;
        case 'REQUIREMENT_CITY_IS_TOWN':
            met = isTown;
            break;
        // A town has no build queue - this is the game's most common way of writing
        // "cities only", and the one that mattered most here.
        case 'REQUIREMENT_CITY_HAS_BUILD_QUEUE':
            met = !isTown;
            break;
        case 'REQUIREMENT_CITY_IS_CAPITAL':
            met = !!city?.isCapital;
            break;
        case 'REQUIREMENT_CITY_IS_DISTANT_LANDS':
            met = !!city?.isDistantLands;
            break;
        case 'REQUIREMENT_CITY_HAS_BUILDING':
            met = !!city?.Constructibles?.hasConstructible(entry.args.get('BuildingType'), false);
            break;
        default:
            return true;
    }

    return entry.inverse ? !met : met;
}

/**
 * The settlement's own City object, remembered against the settlement it came from.
 *
 * ⚠️ `Cities.get` is a call into the game and this was one per REQUIREMENT per (resource,
 * settlement) pair - the planner scores hundreds of pairs and re-plans after every placement.
 *
 * ⚠️ A WeakMap keyed on the settlement OBJECT, which is what scopes it: the planner rebuilds
 * every settlement before each placement, so an entry cannot outlive the board it describes.
 * A plain property would not do - some callers hand over the screen's Solid store objects, and
 * writing to one of those wakes the effects reading it.
 */
const cityBySettlement = new WeakMap();

function cityOf(settlement) {
    let city = cityBySettlement.get(settlement);
    if (city === undefined) {
        city = Cities.get(settlement.cityID) ?? null;
        cityBySettlement.set(settlement, city);
    }
    return city;
}

/** Would this modifier actually do anything in this settlement? */
export function modifierApplies(modifierId, settlement) {
    const requirements = indexRequirements().get(modifierId);
    if (!requirements) {
        return true;
    }
    try {
        const city = cityOf(settlement);
        const results = requirements.entries.map((entry) => meetsRequirement(entry, settlement, city));
        return requirements.all ? results.every(Boolean) : results.some(Boolean);
    } catch (error) {
        warn(`could not evaluate requirements for ${modifierId}: ${error}`);
        return true;
    }
}

/** Is this modifier gated on anything at all? */
export function modifierIsConditional(modifierId) {
    return indexRequirements().has(modifierId);
}

/** The requirements a modifier is gated on: `{ all, entries: [{ type, inverse, args }] }`. */
export function modifierRequirements(modifierId) {
    return indexRequirements().get(modifierId) ?? null;
}

/** All modifiers attached to this resource type: Map<modifierId, Map<argName, value>>. */
export function resourceModifiers(resourceType) {
    return indexResourceModifiers().get(resourceType) ?? new Map();
}

/*
 * What a modifier DOES, and to whom. Here rather than beside either caller: the empire and
 * factory totals both need it, and neither owns the other's index.
 *
 * ⚠️ BUILT ONCE AND KEPT. `GameInfo.Modifiers` joined to `GameInfo.DynamicModifiers` is static
 * schema, thousands of rows each. The Empire and Factory tabs used to drop it per render "for a
 * fresh reading", re-scanning both tables and taking the planner's copy with it; what actually
 * moves between visits is which resources the player HOLDS, read elsewhere.
 */
let effectTypeByModifier = null;
let collectionByModifier = null;

function indexModifiers() {
    if (effectTypeByModifier) {
        return;
    }
    effectTypeByModifier = new Map();
    collectionByModifier = new Map();
    try {
    // ⚠️ BOTH the effect and the collection come from DynamicModifiers, keyed by ModifierType -
    // the Modifiers row carries the type, not the effect.
        const byModifierType = new Map();
        GameInfo.DynamicModifiers?.forEach((entry) => {
            byModifierType.set(entry.ModifierType, {
                effect: entry.EffectType ?? '',
                collection: entry.CollectionType ?? '',
            });
        });
        GameInfo.Modifiers?.forEach((entry) => {
            const dynamic = byModifierType.get(entry.ModifierType);
            if (!dynamic) {
                return;
            }
            effectTypeByModifier.set(entry.ModifierId, dynamic.effect);
            collectionByModifier.set(entry.ModifierId, dynamic.collection);
        });
    } catch (error) {
        warn(`could not index modifier effects: ${error}`);
    }
}

/** modifierId -> the EffectType behind it, indexed once. */
export function effectTypeOf(modifierId) {
    indexModifiers();
    return effectTypeByModifier.get(modifierId) ?? '';
}

/**
 * Who the modifier is applied to - and it is NOT always every settlement. A collection of
 * "the capital" or "the player" changes what a per-settlement total means.
 */
export function collectionOf(modifierId) {
    indexModifiers();
    return collectionByModifier.get(modifierId) ?? '';
}
