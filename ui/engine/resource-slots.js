/**
 * Resources that carry their own slots.
 *
 * Camels grant a settlement two extra resource slots - in the database, not in code:
 *
 *     <Row ResourceType="RESOURCE_CAMELS" ... BonusResourceSlots="2" .../>
 *
 * `BonusResourceSlots` is a schema column defaulting to 0, so reading it covers every
 * resource that ever gains the property, including ones added by DLC or other mods.
 * Nothing here mentions camels by name on purpose.
 *
 * The consequence for unassigning: taking such a resource out shrinks the settlement's
 * capacity, so other resources may have to leave first or the settlement would end up
 * holding more than it can.
 */
const bonusSlotsByType = new Map();
let indexed = false;

function indexBonusSlots() {
    if (indexed) {
        return;
    }
    indexed = true;
    // GameInfo tables are iterated, not queried; the screen's own model builds its
    // resource lookups the same way.
    GameInfo.Resources.forEach((resource) => {
        const bonus = resource.BonusResourceSlots ?? 0;
        if (bonus > 0) {
            bonusSlotsByType.set(resource.ResourceType, bonus);
        }
    });
}

/** How many extra slots this resource type grants its settlement (0 for most). */
export function bonusSlotsFor(resourceType) {
    indexBonusSlots();
    return bonusSlotsByType.get(resourceType) ?? 0;
}

export function grantsBonusSlots(resourceType) {
    return bonusSlotsFor(resourceType) > 0;
}

/**
 * Resources that could be released to make room, best candidate first.
 *
 * This is a *queue to draw from*, not a list to remove - the caller pulls one at a time
 * and stops the moment the engine accepts the resource it actually wanted to remove.
 * That is what keeps the settlement from losing more than the situation demands.
 *
 * Order is from the END of the settlement's list backwards: the most recently slotted
 * resources go first, which is what the player expects to lose.
 *
 * Resources that grant slots themselves are never candidates - removing one would
 * shrink capacity again and turn this into a cascade. The queue is capped at the number
 * of slots actually going away, so a misjudgement cannot strip the settlement.
 *
 * @param settlement CommerceCityResourceData
 * @param doomed the resources the player asked to unassign
 */
export function companionCandidates(settlement, doomed) {
    const slotsLost = doomed.reduce((total, resource) => total + bonusSlotsFor(resource.resourceType), 0);
    if (slotsLost === 0) {
        return [];
    }

    const alreadyGoing = new Set(doomed.map((resource) => resource.resourceValue));
    const candidates = [];

    const slotted = settlement.slottedResources ?? [];
    for (let i = slotted.length - 1; i >= 0 && candidates.length < slotsLost; i--) {
        const candidate = slotted[i];
        if (alreadyGoing.has(candidate.resourceValue) || grantsBonusSlots(candidate.resourceType)) {
            continue;
        }
        candidates.push(candidate);
    }

    return candidates;
}
