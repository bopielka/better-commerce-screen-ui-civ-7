/**
 * Reading what a resource actually does, from the modifier tables.
 *
 * ⚠️ Indexed ONCE and answered from the index. `GameInfo.Modifiers` and `GameInfo.DynamicModifiers`
 * are thousands of rows each, and joining them per question is a full scan of both.
 *
 * ⚠️ EVERY INDEX HERE IS RESTRICTED TO THE MODIFIERS ATTACHED TO A RESOURCE, which is all any
 * caller has ever asked about. The game's data carries ~12k `<Modifier>` elements, ~39k arguments
 * and ~15k requirements against a few hundred resource ones: indexing all of it and keeping it
 * measured 6.8 MB of retained heap on tables that size, against effectively nothing for these.
 * An id from outside that set still answers correctly - the full index is then built on demand,
 * and in practice never is. Do not "simplify" that fallback away: without it a new call site
 * would silently read "no effect, no requirements".
 */
import { onGameDataStale } from '../support/game-data.js';
import { warn } from '../support/diagnostics.js';

let argumentsByResource = null;
let argumentsByModifier = null;
let requirementsByModifier = null;
let requirementsCoverEverything = false;

/** Every modifier attached to a resource, however it is attached, with its arguments. */
function indexResourceModifiers() {
    if (argumentsByResource) {
        return argumentsByResource;
    }
    argumentsByResource = new Map();
    argumentsByModifier = new Map();

    const modifierResource = new Map();

    /*
     * ⚠️ TWO PASSES OVER `ModifierArguments`, AND THAT IS THE CHEAP ORDER. Collecting the
     * arguments of every modifier first meant one `Map` allocated per modifier in the game -
     * tens of thousands of rows, of which a few hundred were kept. The first pass allocates
     * nothing; the second fills only the maps that survive.
     */
    GameInfo.ModifierArguments?.forEach((argument) => {
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

    // Created up front, so a modifier linked only by its metadata still answers with an empty map.
    modifierResource.forEach((resourceType, modifierId) => {
        const argumentsMap = new Map();
        argumentsByModifier.set(modifierId, argumentsMap);
        let byModifier = argumentsByResource.get(resourceType);
        if (!byModifier) {
            byModifier = new Map();
            argumentsByResource.set(resourceType, byModifier);
        }
        byModifier.set(modifierId, argumentsMap);
    });

    GameInfo.ModifierArguments?.forEach((argument) => {
        argumentsByModifier.get(argument.ModifierId)?.set(argument.Name, argument.Value);
    });

    return argumentsByResource;
}

/** Whether this modifier is one of the resource ones every index here is built for. */
function isResourceModifier(modifierId) {
    indexResourceModifiers();
    return argumentsByModifier.has(modifierId);
}

/**
 * modifierId -> its subject requirements, the ones that describe the settlement.
 *
 * @param everything false to index only the resource modifiers - the whole requirement graph is
 *        thousands of `{type, inverse, args}` objects and lives for the session.
 */
function indexRequirements(everything = false) {
    if (requirementsByModifier && (requirementsCoverEverything || !everything)) {
        return requirementsByModifier;
    }
    requirementsByModifier = new Map();
    requirementsCoverEverything = everything;

    // Which modifiers are being indexed, and which requirement sets they name.
    indexResourceModifiers();
    const wanted = everything ? null : argumentsByModifier;
    const setByModifier = new Map();
    const wantedSets = new Set();
    GameInfo.Modifiers?.forEach((row) => {
        if (!row.SubjectRequirementSetId || (wanted && !wanted.has(row.ModifierId))) {
            return;
        }
        setByModifier.set(row.ModifierId, row.SubjectRequirementSetId);
        wantedSets.add(row.SubjectRequirementSetId);
    });
    if (setByModifier.size === 0) {
        return requirementsByModifier;
    }

    // ⚠️ The requirement ids are collected BEFORE anything is allocated for them, so a
    // requirement no resource modifier uses costs nothing.
    const wantedRequirements = new Set();
    const setRequirementIds = new Map();
    GameInfo.RequirementSetRequirements?.forEach((row) => {
        if (!wantedSets.has(row.RequirementSetId)) {
            return;
        }
        if (!setRequirementIds.has(row.RequirementSetId)) {
            setRequirementIds.set(row.RequirementSetId, []);
        }
        setRequirementIds.get(row.RequirementSetId).push(row.RequirementId);
        wantedRequirements.add(row.RequirementId);
    });

    const requirement = new Map();
    GameInfo.Requirements?.forEach((row) => {
        if (!wantedRequirements.has(row.RequirementId)) {
            return;
        }
        requirement.set(row.RequirementId, {
            type: row.RequirementType,
            inverse: !!row.Inverse,
            args: new Map(),
        });
    });
    GameInfo.RequirementArguments?.forEach((row) => {
        requirement.get(row.RequirementId)?.args.set(row.Name, row.Value);
    });

    const setType = new Map();
    GameInfo.RequirementSets?.forEach((row) => {
        if (wantedSets.has(row.RequirementSetId)) {
            setType.set(row.RequirementSetId, row.RequirementSetType);
        }
    });

    // ⚠️ A set with no readable requirement rows still produces an ENTRY, with no entries in it:
    // `modifierIsConditional` means "is gated on anything at all", and dropping it here would
    // answer no for a modifier the game does gate.
    setRequirementIds.forEach((requirementIds, setId) => {
        const entries = [];
        for (const requirementId of requirementIds) {
            const entry = requirement.get(requirementId);
            if (entry) {
                entries.push(entry);
            }
        }
        setRequirementIds.set(setId, entries);
    });
    setByModifier.forEach((setId, modifierId) => {
        const entries = setRequirementIds.get(setId);
        if (!entries) {
            return;
        }
        requirementsByModifier.set(modifierId, {
            all: setType.get(setId) !== 'REQUIREMENTSET_TEST_ANY',
            entries,
        });
    });

    return requirementsByModifier;
}

/** The requirement index, widened to the whole game only if something outside resources asks. */
function requirementsFor(modifierId) {
    const answer = indexRequirements().get(modifierId);
    if (answer !== undefined || requirementsCoverEverything || isResourceModifier(modifierId)) {
        return answer;
    }
    return indexRequirements(true).get(modifierId);
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
    const requirements = requirementsFor(modifierId);
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
    return requirementsFor(modifierId) !== undefined;
}

/** The requirements a modifier is gated on: `{ all, entries: [{ type, inverse, args }] }`. */
export function modifierRequirements(modifierId) {
    return requirementsFor(modifierId) ?? null;
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
 *
 * ⚠️ ONE map to the DynamicModifiers row, not two maps of copied strings: there are 26 such rows
 * in the whole game, so every modifier sharing a type shares one object. Restricted to resource
 * modifiers like the indexes above, with the same widening fallback.
 */
let dynamicByModifier = null;
let dynamicCoversEverything = false;

function indexModifiers(everything = false) {
    if (dynamicByModifier && (dynamicCoversEverything || !everything)) {
        return dynamicByModifier;
    }
    dynamicByModifier = new Map();
    dynamicCoversEverything = everything;
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
        indexResourceModifiers();
        GameInfo.Modifiers?.forEach((entry) => {
            if (!everything && !argumentsByModifier.has(entry.ModifierId)) {
                return;
            }
            const dynamic = byModifierType.get(entry.ModifierType);
            if (dynamic) {
                dynamicByModifier.set(entry.ModifierId, dynamic);
            }
        });
    } catch (error) {
        warn(`could not index modifier effects: ${error}`);
    }
    return dynamicByModifier;
}

/** The DynamicModifiers row behind a modifier, widening the index if the id is not a resource one. */
function dynamicFor(modifierId) {
    const answer = indexModifiers().get(modifierId);
    if (answer !== undefined || dynamicCoversEverything || isResourceModifier(modifierId)) {
        return answer;
    }
    return indexModifiers(true).get(modifierId);
}

/** modifierId -> the EffectType behind it, indexed once. */
export function effectTypeOf(modifierId) {
    return dynamicFor(modifierId)?.effect ?? '';
}

/**
 * Who the modifier is applied to - and it is NOT always every settlement. A collection of
 * "the capital" or "the player" changes what a per-settlement total means.
 */
export function collectionOf(modifierId) {
    return dynamicFor(modifierId)?.collection ?? '';
}

/**
 * Drops every index here.
 *
 * ⚠️ THE AGE IS WHY. `GameInfo` holds `core` + `base-standard` + THE AGE BEING PLAYED, so an age
 * transition replaces the modifier tables under these maps - the old age's answers would be kept
 * and handed out, and its objects with them. See support/game-data.js for who calls this.
 */
export function forgetModifierIndexes() {
    argumentsByResource = null;
    argumentsByModifier = null;
    requirementsByModifier = null;
    requirementsCoverEverything = false;
    dynamicByModifier = null;
    dynamicCoversEverything = false;
}

onGameDataStale(forgetModifierIndexes);
