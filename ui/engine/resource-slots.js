/**
 * Resources that carry their own slots (camels grant two).
 *
 * ⚠️ Read from `BonusResourceSlots`, a schema column, never by name - so it covers anything DLC
 * or another mod gives the property.
 *
 * The consequence for unassigning: taking one out shrinks the settlement's capacity, so others
 * may have to leave first.
 */
import { onGameDataStale } from '../support/game-data.js';

const bonusSlotsByType = new Map();
let indexed = false;

// `BonusResourceSlots` is read out of the age's resource table; see support/game-data.js.
onGameDataStale(() => {
    bonusSlotsByType.clear();
    indexed = false;
});

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
 * ⚠️ A QUEUE TO DRAW FROM, not a list to remove: the caller pulls one at a time and stops the
 * moment the engine accepts what it actually wanted gone. That is what keeps a settlement from
 * losing more than the situation demands.
 *
 * Ordered from the END of the settlement's list backwards - most recently slotted first, which
 * is what the player expects to lose. Slot-granting resources are never candidates (that would
 * cascade), and the queue is capped at the number of slots actually going away.
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
