/**
 * A tab strip inside each trade route section: what should be at the front of the list.
 *
 * A tab FILTERS and then orders - pick Production and the section shows only routes carrying a
 * resource that pays Production, most first. Balanced filters nothing and orders by total count.
 *
 * ⚠️ Only tabs there is something to filter by are drawn, built from the routes projected this
 * turn: a tab that hides every card is worse than no tab.
 *
 * ⚠️ NOTHING HERE MOVES A CARD. The cards are Solid's, rendered by a `For` over the model's array;
 * reordering those nodes by hand makes Solid's record a lie and the next reconcile dies on
 * `insertBefore ... is not a child of this node`. Ordering sorts THE MODEL'S ARRAY, as the game's
 * own sort dropdown does; filtering hides the card with a style.
 *
 * ⚠️ Each section keeps its OWN choice - the two answer different questions.
 *
 * ⚠️ THE STRIP IS A COPY OF THE GAME'S TAB BAR, NOT AN INSTANCE OF IT: the classes are lifted from
 * `core/ui-next/components/tab.js`, so it is the same object on screen without mounting a Solid
 * component into a tree this mod does not own.
 *
 * ⚠️ And it deliberately does NOT carry `data-name="TabList"`. Three modules find the screen's
 * real strip by exactly that attribute, and `querySelector` takes the FIRST match in the document.
 */
import { isFactoryAge } from '../engine/age.js';
import { grantsBonusSlots } from '../engine/resource-slots.js';
import { resourceClassOf, resourceYieldTypes } from '../planner/facts.js';
import { PRIORITY_OPTIONS } from '../planner/priorities.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { iconBackground, resourceIcon, yieldIcon } from './icons.js';
import { appendAll, bindActivatable, makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

export const SORT_CLASS = 'najane-trade-sort';

const BAR_CLASS = `${SORT_CLASS}__bar`;
const ITEM_CLASS = `${SORT_CLASS}__item`;
const ICON_CLASS = `${SORT_CLASS}__icon`;
const INDICATOR_CLASS = `${SORT_CLASS}__indicator`;
const ACTIVE_CLASS = `${SORT_CLASS}__item--active`;
const CARD_CLASS = 'trade-route-card';

// ⚠️ Both classes, not just EMPIRE: planner/facts.js already treats the two as one kind, and
// which resources fall in which changes with the age.
const EMPIRE_CLASS_TYPES = ['RESOURCECLASS_EMPIRE', 'RESOURCECLASS_TREASURE'];
const FACTORY_CLASS_TYPE = 'RESOURCECLASS_FACTORY';

/** The same two BLPs the tab strip uses for these; see tab-icons.js. */
const EMPIRE_ICON = 'blp:restype_empire_v2';
const FACTORY_ICON = 'blp:restype_factory_v2';

/** How many frames the selection indicator may wait for a layout before giving up. */
const MAX_INDICATOR_ATTEMPTS = 20;

/** Whose teardown owns these tooltips - one scope per strip, under the tab's own. */
const TOOLTIP_SCOPE = 'trade-routes';

function tooltipScopeFor(section) {
    return `${TOOLTIP_SCOPE}:strip:${section}`;
}

export const SORT_STYLE = `
/*
 * The same air above as below. The strip is the first thing inside the section, so with no
 * top margin it sat flush against the ribbon and read as part of it rather than as a control
 * standing between the ribbon and the cards.
 */
.${SORT_CLASS} {
    box-sizing: border-box;
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    justify-content: center;
    width: 100%;
    margin: 0.7rem 0;
}
/*
 * The bar sizes to its tabs instead of stretching, which is the one thing this cannot copy
 * from the screen's own strip: that one spans a whole screen and has five words in it, while
 * this one sits above a row of cards and holds five icons.
 */
.${BAR_CLASS} {
    flex: 0 0 auto;
    min-height: 3.2rem;
}
/*
 * The mount is the flex item on the bar and the tab fills it, because the framed tooltip
 * wraps the trigger it is given - see buildStrip. Sizing only the tab would leave the two
 * different sizes and put the selection indicator under neither of them.
 */
.${ITEM_CLASS}-mount {
    display: flex;
    flex: 0 0 auto;
    width: 4.2rem;
    align-self: stretch;
}
.${ITEM_CLASS}-mount > * {
    display: flex;
    flex: 1 1 auto;
}
.${ITEM_CLASS} {
    flex: 1 1 auto;
    pointer-events: auto;
}
.${ITEM_CLASS}:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: -0.12rem;
}
.${ICON_CLASS} {
    width: 2rem;
    height: 2rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
/*
 * Balanced has no icon of its own - the same problem the settlement priority picker has, and
 * the same answer: all the yields at once, in miniature. The cluster is rebuilt here rather
 * than imported from settlement-controls.js because that module's stylesheet only exists
 * while the Resources tab does, and this strip lives on a different tab.
 */
.${SORT_CLASS}__cluster {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    width: 2.2rem;
    height: 1.8rem;
    pointer-events: none;
}
.${SORT_CLASS}__mini {
    width: 0.68rem;
    height: 0.68rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
`;

/** The resource that carries its own slots - camels, in the ages that have them. */
let slotResource;

function slotGrantingResource() {
    if (slotResource !== undefined) {
        return slotResource;
    }
    slotResource = null;
    try {
        for (const resource of GameInfo.Resources) {
            if ((resource.BonusResourceSlots ?? 0) > 0) {
                slotResource = resource;
                break;
            }
        }
    } catch (error) {
        warn(`could not find the slot-granting resource: ${error}`);
    }
    return slotResource;
}

/** The tabs, in the order they are drawn. */
function tabs() {
    const yieldTab = (yieldType) => ({
        key: yieldType,
        title: GameInfo.Yields.lookup(yieldType)?.Name ?? yieldType,
        icon: () => yieldIcon(yieldType),
        tooltip: () => Locale.compose(
            'LOC_NAJANE_COMMERCE_SORT_YIELD',
            Locale.compose(GameInfo.Yields.lookup(yieldType)?.Name ?? yieldType),
        ),
        count: (resources) => resources.filter((type) => yieldsOf(type).includes(yieldType)).length,
    });

    const list = [
        {
            key: 'balanced',
            title: 'LOC_NAJANE_COMMERCE_PRIORITY_BALANCED',
            cluster: true,
            tooltip: () => Locale.compose('LOC_NAJANE_COMMERCE_SORT_BALANCED'),
            count: (resources) => resources.length,
        },
        yieldTab('YIELD_FOOD'),
        yieldTab('YIELD_PRODUCTION'),
        yieldTab('YIELD_GOLD'),
        yieldTab('YIELD_SCIENCE'),
        yieldTab('YIELD_CULTURE'),
        // Influence is `YIELD_DIPLOMACY` in the data; the name the player reads comes from the
        // yield's own definition, so this needs no string of ours.
        yieldTab('YIELD_DIPLOMACY'),
    ];

    // Camels, and only in an age that has them.
    const slots = slotGrantingResource();
    if (slots && !isFactoryAge()) {
        list.push({
            key: 'slots',
            title: slots.Name,
            icon: () => resourceIcon(slots.ResourceType),
            tooltip: () => Locale.compose(
                'LOC_NAJANE_COMMERCE_SORT_RESOURCE',
                Locale.compose(slots.Name),
            ),
            count: (resources) => resources.filter((type) => grantsBonusSlots(type)).length,
        });
    }

    list.push({
        key: 'empire',
        title: 'LOC_NAJANE_COMMERCE_TAB_EMPIRE',
        icon: () => EMPIRE_ICON,
        tooltip: () => Locale.compose('LOC_NAJANE_COMMERCE_SORT_EMPIRE'),
        count: (resources) => resources.filter((type) => EMPIRE_CLASS_TYPES.includes(classOf(type))).length,
    });

    // Factory Resources exist as a class in every age's data, but only the Modern age has
    // anywhere to put them - the same test the Factory tab and the tab icons use.
    if (isFactoryAge()) {
        list.push({
            key: 'factory',
            title: 'LOC_NAJANE_COMMERCE_TAB_FACTORY',
            icon: () => FACTORY_ICON,
            tooltip: () => Locale.compose('LOC_NAJANE_COMMERCE_SORT_FACTORY'),
            count: (resources) => resources.filter((type) => classOf(type) === FACTORY_CLASS_TYPE).length,
        });
    }
    return list;
}

/* Cached per resource TYPE: this asks about every resource on every card. */
const yieldCache = new Map();
const classCache = new Map();

function yieldsOf(resourceTypeName) {
    if (!yieldCache.has(resourceTypeName)) {
        let types = [];
        try {
            types = resourceYieldTypes({ resourceType: resourceTypeName }) ?? [];
        } catch (error) {
            warn(`could not read what ${resourceTypeName} pays: ${error}`);
        }
        yieldCache.set(resourceTypeName, types);
    }
    return yieldCache.get(resourceTypeName);
}

function classOf(resourceTypeName) {
    if (!classCache.has(resourceTypeName)) {
        let className = null;
        try {
            className = resourceClassOf({ resourceType: resourceTypeName });
        } catch (error) {
            warn(`could not read the class of ${resourceTypeName}: ${error}`);
        }
        classCache.set(resourceTypeName, className);
    }
    return classCache.get(resourceTypeName);
}

/** Every route the tab is drawing this turn, so the strip can leave out what nobody has. */
let knownRoutes = [];
const offeredCache = new Map();

export function setSortRoutes(routes) {
    knownRoutes = routes ?? [];
    offeredCache.clear();
}

/** Which strip a route belongs under; the same three sections the tab draws. */
function sectionOfRoute(route) {
    if (route?.established) {
        return 'established';
    }
    return route?.startable ? 'available' : 'unavailable';
}

/** The tabs worth drawing in ONE section: balanced, plus what a route there can be sorted by. */
function offeredTabs(section) {
    if (offeredCache.has(section)) {
        return offeredCache.get(section);
    }
    const mine = knownRoutes.filter((route) => sectionOfRoute(route) === section);
    const list = tabs().filter((tab) => tab.key === DEFAULT_KEY
        || mine.some((route) => tab.count(route.resources ?? []) > 0));
    offeredCache.set(section, list);
    return list;
}

/** The tab in force, PER SECTION - see the header for why the two do not share one. */
const DEFAULT_KEY = 'balanced';
const activeKeyBySection = new Map();

function activeKeyFor(section) {
    return activeKeyBySection.get(section) ?? DEFAULT_KEY;
}

    // ⚠️ Falls back to Balanced when the chosen tab is no longer on offer: what is in reach
    // changes between turns, and a tab hiding every card looks like a broken screen.
function activeTabFor(section) {
    const list = offeredTabs(section);
    return list.find((tab) => tab.key === activeKeyFor(section)) ?? list[0];
}

let onChange = () => {};

/**
 * @param options.onChange called after a tab is picked, to redraw the sections
 */
export function startSortTabs(options) {
    onChange = options.onChange;
}

/** What the tab in force counts in this route, and how much the route carries in all. */
function scoreOf(route, section) {
    const resources = route?.resources ?? [];
    try {
        return { counted: activeTabFor(section).count(resources), total: resources.length };
    } catch (error) {
        warn(`could not score a trade route: ${error}`);
        return { counted: 0, total: 0 };
    }
}

/** Is this route one the section's tab is asking to see at all? */
export function matchesFilter(route, section) {
    if (!route) {
        return true;
    }
    if (activeTabFor(section).key === DEFAULT_KEY) {
        return true;
    }
    return scoreOf(route, section).counted > 0;
}

/** The order the section's routes belong in: most of what the tab counts first. */
export function compareRoutes(first, second, section) {
    const a = scoreOf(first, section);
    const b = scoreOf(second, section);
    return (b.counted - a.counted) || (b.total - a.total);
}

function renderIcon(host, tab) {
    if (!tab.cluster) {
        const icon = makeElement('div', ICON_CLASS);
        try {
            icon.style.backgroundImage = `url(${tab.icon()})`;
        } catch (error) {
            warn(`could not draw the ${tab.key} sort icon: ${error}`);
        }
        host.appendChild(icon);
        return;
    }

    const cluster = makeElement('div', `${SORT_CLASS}__cluster`);
    for (const option of PRIORITY_OPTIONS) {
        if (!option.type) {
            continue;
        }
        const mini = makeElement('div', `${SORT_CLASS}__mini`);
        mini.style.backgroundImage = iconBackground(option.type, 'YIELD');
        cluster.appendChild(mini);
    }
    host.appendChild(cluster);
}

/** Slides the little brass marker under the tab in force. */
function positionIndicator(bar, attempt = 0) {
    const indicator = bar.querySelector(`.${INDICATOR_CLASS}`);
    const active = bar.querySelector(`.${ACTIVE_CLASS}`);
    if (!indicator || !active) {
        return;
    }
    const barRect = bar.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    if (itemRect.width <= 0) {
        if (attempt < MAX_INDICATOR_ATTEMPTS) {
            requestAnimationFrame(() => positionIndicator(bar, attempt + 1));
        }
        return;
    }
    indicator.style.left = `${itemRect.left - barRect.left}px`;
    indicator.style.width = `${itemRect.width}px`;
}

function paintSelection(bar) {
    if (!bar) {
        return;
    }
    const section = bar.dataset.najaneSortSection ?? '';
    const active = activeKeyFor(section);
    for (const item of bar.querySelectorAll(`.${ITEM_CLASS}`)) {
        const selected = item.dataset.najaneSortKey === active;
        item.classList.toggle(ACTIVE_CLASS, selected);
        item.classList.toggle('text-secondary', selected);
        item.classList.toggle('text-accent-1', !selected);
    }
    positionIndicator(bar);
}

/** Every strip on screen. Each paints from its own section's choice. */
function paintAll() {
    for (const bar of document.querySelectorAll(`.${BAR_CLASS}`)) {
        paintSelection(bar);
    }
}

function pick(section, key) {
    if (activeKeyFor(section) === key) {
        return;
    }
    activeKeyBySection.set(section, key);
    paintAll();
    try {
        onChange();
    } catch (error) {
        warn(`re-sorting the trade routes failed: ${error}`);
    }
}

function buildStrip(section) {
    const host = makeElement('div', SORT_CLASS);
    const bar = makeElement(
        'div',
        `${BAR_CLASS} flex flex-row items-stretch relative uppercase font-title `
        + 'text-base text-accent-2 tracking-150 px-4',
    );

    // The three pieces of the game's own bar: the ground, and an end cap at either side.
    appendAll(
        bar,
        makeElement('div', 'absolute inset-0 img-tab-bar'),
        makeElement('div', 'absolute -left-1 img-tab-end-cap pointer-events-none left-border'),
        makeElement('div', 'absolute -right-1 rotate-y-180 img-tab-end-cap pointer-events-none right-border'),
    );

    for (const tab of offeredTabs(section)) {
        const item = makeElement(
            'div',
            `${ITEM_CLASS} relative flex items-center justify-center text-center cursor-pointer`,
            { 'aria-label': Locale.compose(tab.title) },
        );
        item.dataset.najaneSortKey = tab.key;
        renderIcon(item, tab);
        bindActivatable(item, () => pick(section, tab.key));

/** The game's framed tooltip, as on the Resources tab buttons: a titled heading over a card. */
        const mount = makeElement('div', `${ITEM_CLASS}-mount`);
        appendWithFramedTooltip(mount, item, {
            scope: tooltipScopeFor(section),
            title: tab.title,
            text: tab.tooltip(),
        });
        bar.appendChild(mount);
    }

    bar.appendChild(makeElement(
        'div',
        `${INDICATOR_CLASS} absolute bottom-0 left-0 img-tab-selection-indicator bg-no-repeat `
        + 'bg-center min-h-6 bg-contain transition-left duration-150',
    ));

    bar.dataset.najaneSortSection = section;
    bar.dataset.najaneSortTabs = offeredTabs(section).map((tab) => tab.key).join(',');
    host.appendChild(bar);
    paintSelection(bar);
    return host;
}

/** Gives a section its strip, or brings the one it has up to date. */
export function ensureSortTabs(row, section) {
    const existing = row.querySelector(`.${SORT_CLASS}`);
    const wanted = offeredTabs(section).map((tab) => tab.key).join(',');
    if (existing) {
        const bar = existing.querySelector(`.${BAR_CLASS}`);
    // Rebuilt when the row has been reused for the other section.
        if (bar?.dataset.najaneSortSection !== section || bar?.dataset.najaneSortTabs !== wanted) {
            // The frames are anchored to the tabs about to be discarded.
            disposeFramedTooltips(tooltipScopeFor(bar?.dataset.najaneSortSection ?? section));
            existing.remove();
        } else {
            if (existing !== row.firstChild) {
                // A card the game inserted ahead of it; put the strip back on top.
                row.insertBefore(existing, row.firstChild);
            }
            paintSelection(bar);
            return;
        }
    }
    row.insertBefore(buildStrip(section), row.firstChild ?? null);
}

export function removeSortTabs() {
    document.querySelectorAll(`.${SORT_CLASS}`).forEach((strip) => strip.remove());
}
