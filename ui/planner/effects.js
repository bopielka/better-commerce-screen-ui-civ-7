/**
 * Reading what a resource actually does, from the modifier tables.
 *
 * Two things here that the ported Resource+ code got wrong, both found by auditing every
 * resource in every age against the game's data:
 *
 * 1. **Not every resource modifier is registered in `ModifierMetadatas`.** Resource+
 *    looked there only. Nickel (Modern) and one of Gypsum's (Antiquity) are linked
 *    solely by the modifier's own `ResourceType` argument, so they were invisible -
 *    Nickel scored as a resource that does nothing at all.
 *
 * 2. **Modifiers carry requirements, and most of them mean "cities only".** 29 resource
 *    modifiers are gated on `REQUIREMENT_CITY_HAS_BUILD_QUEUE`, which a town does not
 *    have. Jade's +10 gold, Silk's +10 culture, Lapis Lazuli's +4 production - all of it
 *    was being credited to towns, where none of it happens. Others split by settlement
 *    type outright: Tin gives +2 production in a city and +4 in a town, Wild Game +2 and
 *    +4, and taking the smaller of the two (which is what happens when both look
 *    applicable) understated both.
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

/**
 * Can this settlement satisfy one requirement?
 *
 * Anything not understood counts as satisfied. Being too eager costs a slightly wrong
 * score; being too strict would silently drop a resource from consideration entirely,
 * which is much worse and much harder to notice.
 */
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

/** Would this modifier actually do anything in this settlement? */
export function modifierApplies(modifierId, settlement) {
    const requirements = indexRequirements().get(modifierId);
    if (!requirements) {
        return true;
    }
    try {
        const city = Cities.get(settlement.cityID);
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

/**
 * The requirements a modifier is gated on, as data: `{ all, entries: [{ type, inverse, args }] }`.
 *
 * Exposed because a requirement is sometimes the most interesting thing about an effect -
 * "+1 combat strength" says far less than which units it reaches, and that is carried by
 * a REQUIREMENT_UNIT_TAG_MATCHES rather than by any argument of the modifier itself.
 */
export function modifierRequirements(modifierId) {
    return indexRequirements().get(modifierId) ?? null;
}

/** All modifiers attached to this resource type: Map<modifierId, Map<argName, value>>. */
export function resourceModifiers(resourceType) {
    return indexResourceModifiers().get(resourceType) ?? new Map();
}


/*
 * ---------------------------------------------------------------------------------------
 * What a modifier DOES, and to whom.
 *
 * Lives here rather than beside either of its callers: the empire-resource totals and the
 * factory-resource totals both need it, and neither is the natural owner of the other's
 * index.
 * ---------------------------------------------------------------------------------------
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
        /*
         * ⚠️ BOTH the effect and the collection come from DynamicModifiers, keyed by
         * ModifierType - `Modifiers` rows carry neither. Reading CollectionType off a
         * Modifiers row returns undefined every time, which is what silently disabled the
         * capital-only handling: furs give +3 Happiness in the CAPITAL, and the total was
         * being multiplied by the whole empire.
         */
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
 * Who the modifier is applied to - and it is NOT always every settlement.
 *
 * ⚠️ Reading only the requirements is not enough; the collection is a separate thing and
 * it narrows the reach on its own. Furs give +3 Happiness through
 * COLLECTION_ALL_CAPITAL_CITIES - the capital, once - and counting that in every
 * settlement multiplied the figure by the size of the empire.
 *
 * Resource modifiers use four: ALL_CITIES (115), ALL_UNITS (10), ALL_PLAYERS (10),
 * ALL_CAPITAL_CITIES (6).
 */
export function collectionOf(modifierId) {
    indexModifiers();
    return collectionByModifier.get(modifierId) ?? '';
}

/** Called when a tab is opened, so a fresh reading is taken each time. */
export function forgetModifierIndex() {
    effectTypeByModifier = null;
    collectionByModifier = null;
}
