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
            // ⚠️ Through the cache, like `settlementCards`: this used to be a `Cities.get` and a
            // `Locale.compose` per settlement per HIT TEST, and the hit test runs off the mouse.
            if (settlementName(settlement.cityID) === name) {
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

function cityKeyOf(cityID) {
    return String(cityID?.id ?? '');
}

/**
 * Puts the screen's copy of the board back the way the engine has it.
 *
 * ⚠️ BOTH HALVES ARE DIFFERENTIAL AND NEITHER HEALS. `commerce-screen-model.js` turns
 * `ResourceAssigned` and `ResourceUnassigned` into `createSignal()`s holding only the LATEST
 * payload, and each effect splices ONE resource - so two of either in the same engine tick produce
 * one splice. `availableSlots` and the yield deltas are re-read from the engine and do heal; the
 * list of tiles on a card does NOT, and neither does the pool.
 *
 * ⚠️ Entries are MOVED, never rebuilt. A tile carries `resourceProps`, `yieldTypes` and a swap
 * memo that only the screen knows how to make, and a missed pair is missed TOGETHER - both halves
 * live in one effect - so the object the card is missing is still sitting in the pool.
 *
 * ⚠️ An entry with nowhere to go is LEFT WHERE IT IS. Showing a resource in the wrong place is a
 * display fault the player can undo; making it vanish is not.
 *
 * @param assignedTo resourceValue -> cityID, read from the engine.
 * @returns `{ moved, returned, dropped }` - tiles put onto a card, put back into the pool, and
 *          duplicates discarded.
 */
export function reconcileScreenWithEngine(assignedTo) {
    const model = currentModel;
    if (!model) {
        return { moved: 0, returned: 0, dropped: 0 };
    }

    const cards = new Map();
    for (const settlement of allSettlements(model)) {
        cards.set(cityKeyOf(settlement.cityID), settlement);
    }
    const poolSubsections = [];
    for (const section of model.data?.resourceTabData?.availableResourceSectionData ?? []) {
        for (const subsection of section.subSections ?? []) {
            if (subsection.resourceSlotData) {
                poolSubsections.push(subsection);
            }
        }
    }

    /** resourceValue -> `{ entry, list }`, taken out of wherever the screen had it wrong. */
    const orphans = new Map();

    // ⚠️ Backwards through every list: splicing shifts everything after the index.
    for (const settlement of cards.values()) {
        const slotted = settlement.slottedResources;
        if (!slotted) {
            continue;
        }
        for (let index = slotted.length - 1; index >= 0; index--) {
            const entry = slotted[index];
            const belongsTo = assignedTo.get(entry.resourceValue);
            if (belongsTo && cityKeyOf(belongsTo) === cityKeyOf(settlement.cityID)) {
                continue;
            }
            slotted.splice(index, 1);
            orphans.set(entry.resourceValue, { entry, list: slotted });
        }
    }
    for (const subsection of poolSubsections) {
        const slots = subsection.resourceSlotData;
        for (let index = slots.length - 1; index >= 0; index--) {
            const entry = slots[index];
            if (!assignedTo.has(entry.resourceValue)) {
                continue;
            }
            slots.splice(index, 1);
            orphans.set(entry.resourceValue, { entry, list: slots });
        }
    }

    let moved = 0;
    for (const [resourceValue, cityID] of assignedTo) {
        const settlement = cards.get(cityKeyOf(cityID));
        const slotted = settlement?.slottedResources;
        if (!slotted || slotted.some((entry) => entry.resourceValue === resourceValue)) {
            continue;
        }
        const orphan = orphans.get(resourceValue);
        if (!orphan) {
            continue;
        }
        orphans.delete(resourceValue);
        orphan.entry.cityID = settlement.cityID;
        slotted.push(orphan.entry);
        moved++;
    }

    let returned = 0;
    let dropped = 0;
    for (const [resourceValue, { entry, list }] of orphans) {
        /*
         * ⚠️ The engine HAS this one placed and the card already showed it, so this copy is a
         * duplicate the pool failed to splice out - the one case where discarding an entry is
         * right. Everything below is a resource the engine holds nowhere.
         */
        if (assignedTo.has(resourceValue)) {
            dropped++;
            continue;
        }
        const home = poolSubsectionFor(poolSubsections, entry.resourceType);
        /*
         * ⚠️ Put back where it came from when no subsection will take it. Showing a resource in
         * the wrong place is a display fault the player can undo; dropping it would delete the
         * only tile on screen for something the engine still says they own.
         */
        if (!home) {
            list.push(entry);
            continue;
        }
        entry.cityID = undefined;
        home.resourceSlotData.push(entry);
        returned++;
    }

    refreshAvailableSlots(cards);
    return { moved, returned, dropped };
}

/** ⚠️ The pool's subsections are keyed by resource CLASS, which is a lookup, so it is memoised. */
const classByResourceType = new Map();

function poolSubsectionFor(subsections, resourceType) {
    if (!resourceType) {
        return null;
    }
    let className = classByResourceType.get(resourceType);
    if (className === undefined) {
        try {
            className = GameInfo.Resources.lookup(resourceType)?.ResourceClassType ?? null;
        } catch (error) {
            className = null;
        }
        classByResourceType.set(resourceType, className);
    }
    return className ? subsections.find((subsection) => subsection.type === className) ?? null : null;
}

/**
 * ⚠️ Re-read for EVERY settlement, not just the one the last event named - which is all the model
 * itself does. A card whose event was swallowed keeps the free-slot count from before it.
 */
function refreshAvailableSlots(cards) {
    for (const settlement of cards.values()) {
        try {
            const resources = Cities.get(settlement.cityID)?.Resources;
            if (!resources) {
                continue;
            }
            const free = Math.max(0, (resources.getAssignedResourcesCap() ?? 0)
                - (resources.getAssignedResources()?.length ?? 0));
            if ((settlement.availableSlots?.length ?? -1) !== free) {
                settlement.availableSlots = Array.from({ length: free }, (_, index) => index);
            }
        } catch (error) {
            // A settlement the engine will not describe is one this pass leaves alone.
        }
    }
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
