/**
 * The bridge between window-level input events and the Commerce screen's Solid model: what is
 * under the cursor, and what the model says about it.
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

/**
 * Controls this mod hangs ON a slot, which must not be mistaken FOR one.
 * ⚠️ A hit test that returned the padlock instead of the resource under it made Shift-click
 * unusable on any locked resource.
 */
const OVERLAY_ATTRIBUTE = 'data-najane-overlay';

// ⚠️ Matched on its VALUE, never as a bare `[data-najane-overlay]`: an attribute selector without
// one would also match elements another feature marks for an unrelated reason.
const OVERLAY_SELECTOR = `[${OVERLAY_ATTRIBUTE}="true"]`;

/** The elements under a point, with this mod's own overlays taken out. */
function hitTestElements(x, y) {
    const hits = Array.from(document.elementsFromPoint(x, y) ?? []);
    const withoutOverlays = hits.filter((element) => !element.closest?.(OVERLAY_SELECTOR));
    return withoutOverlays.length > 0 ? withoutOverlays : hits;
}

let currentModel = null;

/**
 * ⚠️ `settlementCards` is the busiest function here - two features call it on every pass over the
 * DOM - and it composed every name each time just to match a `data-name` attribute.
 * `Locale.compose` is a call into the game for a string that cannot change while a screen is open.
 */
const nameByCity = new Map();

export function setCommerceModel(model) {
    currentModel = model;
    nameByCity.clear();
}

export function clearCommerceModel(model) {
    // Only clear our own instance: the screen can be re-opened before the old one's
    // cleanup runs, and clearing unconditionally would blank the new model.
    if (currentModel === model) {
        currentModel = null;
        nameByCity.clear();
    }
}

function settlementName(cityID) {
    const key = `${cityID?.owner}:${cityID?.id}`;
    const cached = nameByCity.get(key);
    if (cached !== undefined) {
        return cached;
    }
    const city = Cities.get(cityID);
    const name = city ? Locale.compose(city.name) : null;
    nameByCity.set(key, name);
    return name;
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

/** Where a resource currently sits, or null if it is not assigned anywhere. */
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

/** What slotted resource, if any, sits under this screen point? */
export function findSlottedResourceAtPoint(x, y) {
    const model = currentModel;
    if (!model) {
        return null;
    }

    let slotElement = null;
    let cardElement = null;
    for (const element of hitTestElements(x, y)) {
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

/** The settlement whose card is under this point - anywhere on the card, not just a slot. */
export function findSettlementAtPoint(x, y) {
    const model = currentModel;
    if (!model) {
        return null;
    }

    let cardElement = null;
    for (const element of hitTestElements(x, y)) {
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

/** Every settlement card on screen, paired with its model entry. */
export function settlementCards() {
    const model = currentModel;
    if (!model) {
        return [];
    }

    const byName = new Map();
    for (const section of settlementSections(model)) {
        for (const settlement of section.cityResources ?? []) {
            const name = settlementName(settlement.cityID);
            if (name !== null) {
                byName.set(name, settlement);
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

/** The pool sections in the order the DOM renders them. */
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

/** Every unassigned resource the model holds. */
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
 * ⚠️ The pool is maintained purely DIFFERENTIALLY and cannot heal itself: the model splices one
 * resource per event, and two events in the same tick produce one splice. The settlement cards
 * re-read live state and do heal, which is why only this half needs repairing.
 *
 * ⚠️ Written into the model's store rather than the DOM - the rows are Solid's.
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
    for (const element of hitTestElements(x, y)) {
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
