/**
 * The bridge between window-level input events and the Commerce screen's Solid model.
 *
 * `useCommerceScreenContext()` can only be called while a component is being set up,
 * so the wrapper in right-click-unassign.js calls it once and parks the result here.
 * Everything that runs later (an input handler on `window`) reads it from here.
 *
 * Also maps a screen point back to the resource under it. The screen exposes no id on
 * its DOM nodes, so the mapping goes: point -> settlement card -> index of the slot
 * within that card -> the same index in the model's slottedResources. The card is
 * matched by the settlement name the game writes into `data-name`, not by position,
 * so sorting and filtering the settlement list cannot desynchronise it.
 */
import { log } from '../support/diagnostics.js';

const CITY_CARD_PREFIX = 'city-resource-container-';
const CITY_CARD_SELECTOR = `[data-name^="${CITY_CARD_PREFIX}"]`;

/** The whole clickable settlement card, not just its resource area. */
const CITY_ACTIVATABLE_SUFFIX = '-city-resource-activatable';
const CITY_ACTIVATABLE_SELECTOR = `[data-name$="${CITY_ACTIVATABLE_SUFFIX}"]`;

/** One of these per rendered section of the unassigned pool (connected / disconnected). */
const POOL_SELECTOR = '[data-name="commerce-unassigned-resources"]';

/** The game gives every slotted resource an explicit size to work around a layout bug. */
const SLOT_SELECTOR = '.size-19';

let currentModel = null;

export function setCommerceModel(model) {
    currentModel = model;
}

export function clearCommerceModel(model) {
    // Only clear our own instance: the screen can be re-opened before the old one's
    // cleanup runs, and clearing unconditionally would blank the new model.
    if (currentModel === model) {
        currentModel = null;
    }
}

export function getCommerceModel() {
    return currentModel;
}

function settlementSections(model) {
    return model?.data?.resourceTabData?.slottedResourceSectionData ?? [];
}

/** Every settlement in the model, across its sections. */
export function allSettlements(model) {
    const settlements = [];
    for (const section of settlementSections(model)) {
        settlements.push(...(section.cityResources ?? []));
    }
    return settlements;
}

/**
 * Where a resource currently sits, or null if it is not assigned anywhere.
 *
 * Read fresh from the model rather than remembered: the model is rebuilt every time the
 * engine confirms anything, so a reference held across a wait is stale by definition.
 */
export function findSlottedResource(model, resourceValue) {
    for (const settlement of allSettlements(model)) {
        const resource = (settlement.slottedResources ?? []).find(
            (item) => item.resourceValue === resourceValue,
        );
        if (resource) {
            return { settlement, resource };
        }
    }
    return null;
}

function findSettlementByCardName(model, cardName) {
    for (const section of settlementSections(model)) {
        for (const settlement of section.cityResources ?? []) {
            const name = settlement.settlementNameData?.settlementName;
            if (name !== undefined && Locale.compose(name) === cardName) {
                return settlement;
            }
        }
    }
    return null;
}

/**
 * What slotted resource, if any, sits under this screen point?
 *
 * `elementsFromPoint` rather than `elementFromPoint` because the slot is covered by
 * the resource icon, its tooltip wrapper and the drag-and-drop overlay; the game's own
 * drag-and-drop resolves dropzones the same way.
 */
export function findSlottedResourceAtPoint(x, y) {
    const model = currentModel;
    if (!model) {
        return null;
    }

    let slotElement = null;
    let cardElement = null;
    for (const element of document.elementsFromPoint(x, y)) {
        slotElement ??= element.closest?.(SLOT_SELECTOR) ?? null;
        cardElement ??= element.closest?.(CITY_CARD_SELECTOR) ?? null;
        if (slotElement && cardElement) {
            break;
        }
    }
    if (!slotElement || !cardElement) {
        return null;
    }

    const slotElements = Array.from(cardElement.querySelectorAll(SLOT_SELECTOR));
    const slotIndex = slotElements.indexOf(slotElement);
    if (slotIndex < 0) {
        return null;
    }

    const cardName = cardElement.getAttribute('data-name')?.slice(CITY_CARD_PREFIX.length) ?? '';
    const settlement = findSettlementByCardName(model, cardName);
    if (!settlement) {
        log(`no settlement in the model matches the card "${cardName}"`);
        return null;
    }

    const slottedResource = settlement.slottedResources?.[slotIndex];
    if (!slottedResource) {
        // Empty slots are rendered separately and are not .size-19, so reaching this
        // means the DOM and the model disagree - worth knowing about.
        log(`card "${cardName}" has no model resource at slot ${slotIndex}`);
        return null;
    }

    // slotElements is handed back so callers can address the hovered resource's
    // siblings by index without querying the card a second time.
    return {
        entries: settlement.slottedResources ?? [],
        resource: slottedResource,
        settlement,
        slotIndex,
        cardElement,
        slotElements,
    };
}

/**
 * The settlement whose card is under this screen point - anywhere on the card, not just
 * on a resource slot.
 *
 * The card's own activatable carries `data-name="<settlement name>-city-resource-activatable"`,
 * and that name is `Locale.compose(Cities.get(cityID).name)`. Recomputing it the same
 * way is what guarantees the match; the model's `settlementNameData` is not used here
 * because nothing promises it is the same string.
 */
export function findSettlementAtPoint(x, y) {
    const model = currentModel;
    if (!model) {
        return null;
    }

    let cardElement = null;
    for (const element of document.elementsFromPoint(x, y)) {
        cardElement = element.closest?.(CITY_ACTIVATABLE_SELECTOR) ?? null;
        if (cardElement) {
            break;
        }
    }
    if (!cardElement) {
        return null;
    }

    const name = cardElement.getAttribute('data-name')?.slice(0, -CITY_ACTIVATABLE_SUFFIX.length) ?? '';
    for (const section of settlementSections(model)) {
        for (const settlement of section.cityResources ?? []) {
            const city = Cities.get(settlement.cityID);
            if (city && Locale.compose(city.name) === name) {
                return { settlement, cardElement };
            }
        }
    }

    log(`no settlement in the model matches the card "${name}"`);
    return null;
}

/**
 * Every settlement card currently on screen, paired with its model entry.
 *
 * Matched by name rather than by position so that sorting and filtering the settlement
 * list cannot pair a card with the wrong settlement.
 */
export function settlementCards() {
    const model = currentModel;
    if (!model) {
        return [];
    }

    const byName = new Map();
    for (const section of settlementSections(model)) {
        for (const settlement of section.cityResources ?? []) {
            const city = Cities.get(settlement.cityID);
            if (city) {
                byName.set(Locale.compose(city.name), settlement);
            }
        }
    }

    const pairs = [];
    for (const cardElement of document.querySelectorAll(CITY_ACTIVATABLE_SELECTOR)) {
        const name = cardElement.getAttribute('data-name')?.slice(0, -CITY_ACTIVATABLE_SUFFIX.length) ?? '';
        const settlement = byName.get(name);
        if (settlement) {
            pairs.push({ settlement, cardElement });
        }
    }
    return pairs;
}

function availableSections(model) {
    return model?.data?.resourceTabData?.availableResourceSectionData ?? [];
}

/**
 * The pool sections in the order the DOM renders them.
 *
 * A section whose every subsection is empty renders no container at all, so it must be
 * skipped here too or the Nth container would be matched against the wrong section.
 */
function renderedPoolSections(model) {
    return availableSections(model).filter((section) =>
        (section.subSections ?? []).some((sub) => (sub.resourceSlotData ?? []).length > 0),
    );
}

/** One section's resources, flattened the way its container lays out its .size-19 slots. */
function flattenPoolSection(section) {
    const flat = [];
    for (const sub of section.subSections ?? []) {
        const slots = sub.resourceSlotData ?? [];
        // An empty subsection renders neither its heading nor any slot.
        if (slots.length > 0) {
            flat.push(...slots);
        }
    }
    return flat;
}

/**
 * Every unassigned resource the model holds.
 *
 * ⚠️ NOT the same list as `renderedPoolSections` builds, and the difference used to be
 * hidden behind one name exported from two modules: this is what the model says, while
 * that one is what the DOM renders, in DOM order, with empty sections dropped so that
 * the Nth container lines up with the Nth section. Only the hit-testing below wants the
 * second one; everything else wants this.
 */
export function pooledResources(model) {
    const resources = [];
    for (const section of model?.data?.resourceTabData?.availableResourceSectionData ?? []) {
        for (const subsection of section.subSections ?? []) {
            resources.push(...(subsection.resourceSlotData ?? []));
        }
    }
    return resources;
}

/**
 * Deletes rows from the screen's unassigned pool for resources the game has since assigned.
 *
 * ⚠️ The pool list is maintained PURELY DIFFERENTIALLY, and that is why it heals less well
 * than the settlement cards. On `ResourceAssigned`, `commerce-screen-model.ts` splices the
 * one resource named in that event's payload out of `availableResourceSectionData` - and
 * that is the only thing that ever removes a row. The settlement side of the same handler
 * re-reads `getAssignedResources()` and rewrites `availableSlots` and `yieldDeltas` from
 * live state, so a missed event there is repaired by the next one; the pool has no such
 * path, so a missed event leaves a row behind **for as long as the screen stays open**.
 *
 * Events do get missed: `createEngineEvent` is a plain `createSignal()` holding only the
 * latest payload, and this mod assigns fast enough to deliver two in a tick. Pacing the loop
 * makes that rare rather than impossible.
 *
 * ⚠️ Removal only - deliberately. Deleting a row the game already accounted for is safe and
 * needs nothing but the resource value. Putting a row BACK would mean building a
 * `ResourceSlotData` complete with `resourceProps` and its `canSwapWithSelectedResource`
 * memo, which is reimplementing the model's own builder and would rot the first time it
 * changes. The opposite direction does not need it anyway: unassigning goes through the
 * model's update gate, which accumulates its events in an array instead of a signal.
 *
 * @param assignedValues resource values the game currently has slotted somewhere.
 * @returns how many stale rows were removed.
 */
export function pruneAssignedFromPool(assignedValues) {
    const model = currentModel;
    if (!model) {
        return 0;
    }
    let removed = 0;
    for (const section of model.data?.resourceTabData?.availableResourceSectionData ?? []) {
        for (const subsection of section.subSections ?? []) {
            const slots = subsection.resourceSlotData;
            if (!slots) {
                continue;
            }
            // Backwards, because splicing shifts everything after the index.
            for (let index = slots.length - 1; index >= 0; index--) {
                if (assignedValues.has(slots[index].resourceValue)) {
                    slots.splice(index, 1);
                    removed++;
                }
            }
        }
    }
    return removed;
}

/** The unassigned resource under this screen point, if any. */
export function findAvailableResourceAtPoint(x, y) {
    const model = currentModel;
    if (!model) {
        return null;
    }

    let slotElement = null;
    let poolElement = null;
    for (const element of document.elementsFromPoint(x, y)) {
        slotElement ??= element.closest?.(SLOT_SELECTOR) ?? null;
        poolElement ??= element.closest?.(POOL_SELECTOR) ?? null;
        if (slotElement && poolElement) {
            break;
        }
    }
    if (!slotElement || !poolElement) {
        return null;
    }

    const slotElements = Array.from(poolElement.querySelectorAll(SLOT_SELECTOR));
    const slotIndex = slotElements.indexOf(slotElement);
    if (slotIndex < 0) {
        return null;
    }

    const containers = Array.from(document.querySelectorAll(POOL_SELECTOR));
    const section = renderedPoolSections(model)[containers.indexOf(poolElement)];
    if (!section) {
        log('no pool section in the model matches this container');
        return null;
    }

    const entries = flattenPoolSection(section);
    const resource = entries[slotIndex];
    if (!resource) {
        log(`the unassigned pool has no model resource at slot ${slotIndex}`);
        return null;
    }

    return { entries, resource, slotIndex, cardElement: poolElement, slotElements };
}
