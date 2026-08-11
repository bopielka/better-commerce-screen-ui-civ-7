/**
 * Tidying the Trade Routes tab.
 *
 * A route card carried its destination in a sentence under the title - "Delivered to
 * settlement Bogdan by Sea" - and, at the bottom, how much gold the other leader would
 * make. Both are lines of prose where the eye wants a shape. The title now says the whole
 * thing on one line, and the prose goes:
 *
 *     [hex] [sea]  MEKKA -> BOGDAN                      [leader]
 *
 * The routes that cannot be started are also split in two - the ones only the trade limit
 * blocks, and the ones out of range - because those are different news.
 *
 * Where the destination comes from
 * --------------------------------
 * NOT from parsing that sentence. The model hands the card `domainString`, already
 * composed and translated, and taking it apart again would break in every language that
 * words it differently. The route is looked up instead through
 * `Trade.projectPossibleTradeRoutes`, the same call the model itself uses, which carries
 * `domain` and `nearestCityId` as data.
 *
 * The icons are the game's own `TRADE_ROUTE_LAND` / `TRADE_ROUTE_SEA`, the pair the trade
 * route chooser draws (base-standard/data/icons/trade-icons.xml).
 */
import { onCleanup, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { TradeRouteCard } from '/base-standard/ui-next/screens/commerce/trade-route-card.js';

import { ensureScreenLayout } from './layout.js';
import { CLASS as SUMMARY_CLASS, STYLE as SUMMARY_STYLE, hideTradeSummary, showTradeSummary } from './trade-summary.js';
import { appendAll, bindActivatable, ensureStyle, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const CARD_SELECTOR = '.trade-route-card';
/** The row the cards wrap within; the tab measures it to decide their width. */
const CARD_ROW_SELECTOR = '.trade-route-cards-row';
/** The card title. The row holding it is its parent - see trade-route-card.js, _tmpl$. */
const TITLE_SELECTOR = '.font-title';

/** The corner of the card holding the leader portrait and the relationship badge. */
const LEADER_CORNER_SELECTOR = '.absolute.top-1.right-1';

/** The tooltip behind that portrait. The game names it; see relationship-tooltip.js. */
const RELATIONSHIP_TOOLTIP_SELECTOR = '[data-name="Relationship-Tooltip"]';

const CLASS = 'najane-trade-destination';
/** Our mark on the card's title row, applied from JS - see decorate. */
const HEAD_CLASS = 'najane-trade-head';
/** Our mark on the game's own route-name element. */
const NAME_CLASS = 'najane-trade-name';
const MAX_REMEASURE_ATTEMPTS = 40;

/** Air between the longest name and the portrait, in the same pixels as the measurement. */
const PORTRAIT_CLEARANCE = 10;

/** Our mark on the element the rows wrap inside; applied in updateMeasuredLayout. */
const ROWS_CLASS = 'najane-trade-rows';
/** The two sub-groups this mod adds under the unavailable routes. */
const GROUP_CLASS = 'najane-trade-group';

const MEASURED_STYLE_ID = 'najane-trade-routes-measured';

let measuredStyle = null;
let measuredRowWidth = 0;
const STYLE_ID = 'najane-trade-routes-style';

/**
 * The two prose lines, matched by the classes the card's own templates carry.
 *
 * `[class="mt-2"]` is an exact-attribute match on purpose: the yields line is a bare
 * `<div class=mt-2>`, while the relationship badge in the corner also has `mt-2` among
 * several other classes and must stay.
 */
const STYLE = `
${CARD_SELECTOR} p.mt-1.mr-13 { display: none; }
${CARD_SELECTOR} [class="mt-2"] { display: none; }

/*
 * The relationship badge under the leader's portrait - the "+10" on its own little
 * plaque. The number is already in the tooltip behind the portrait, in words, with every
 * term that adds up to it.
 */
${CARD_SELECTOR} ${LEADER_CORNER_SELECTOR} > .size-12 { display: none; }

/*
 * The relationship tooltip, which opened barely wider than one word per line.
 *
 * Nothing caps it: the frame carries min-w-48 and no maximum. What kept it narrow is that
 * every row inside is "w-full", and a child sized in percent contributes nothing to its
 * parent's natural width - so the frame fell back to the min-w-72 on its content, about
 * 16rem, and every reason for the relationship wrapped over three lines. Raising the floor
 * is enough; the rows then fill whatever they are given.
 */
${RELATIONSHIP_TOOLTIP_SELECTOR} { min-width: 30rem; }

/*
 * The whole line on one row: route name, arrow, destination, domain icon. The strip the
 * portrait occupies is kept clear by a padding-right written from a real measurement - see
 * updateMeasuredLayout - so the names truncate before reaching it rather than running
 * underneath, and the tooltip set in decorate() carries the full line.
 */
.${HEAD_CLASS} {
    flex-wrap: nowrap;
    overflow: hidden;
    pointer-events: auto;
}
/*
 * The line ends where the portrait begins.
 *
 * The destination takes every pixel left over and truncates there, so the ellipsis lands
 * hard against the portrait instead of at some share of the row. Capping both names at a
 * percentage - which is where this went first - cut them short with space still going
 * spare.
 *
 * ⚠️ An element only draws an ellipsis when IT is the one out of room. Relying on the row
 * to clip them produced no ellipsis at all, so each name overflows within itself.
 */
.${NAME_CLASS} {
    flex: 0 1 auto;
    min-width: 3rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.${CLASS} {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: row;
    align-items: center;
    overflow: hidden;
}
.${CLASS} > .font-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
/*
 * Every card in a row the same height; the WIDTH is written by updateMeasuredLayout.
 *
 * ⚠️ !important is not decoration here. The tab measures the container and writes width
 * and margin-right straight onto each card as INLINE styles (see checkForWrap in
 * commerce-screen-trade-tab.js), and an inline style beats a class rule. The measuring
 * keeps running and keeps being overruled, which is harmless - it settles because the
 * widths it measures no longer change.
 *
 * The row is items-start by default, so a short card sat at the top of a tall row with a
 * gap under it. Stretching the row and letting the frame fill its card is what squares
 * the bottom edges off.
 */
${CARD_ROW_SELECTOR} {
    /* Cards in one line match heights. */
    align-items: stretch !important;
    /*
     * Air before the next section's header. Once the sections stopped being stretched apart
     * they sat almost flush, and a header a few pixels under the previous section's cards
     * does not read as a divider at all.
     */
    margin-bottom: 1.4rem;
}
/*
 * ⚠️ The empty band inside a section belongs to the element the SECTIONS wrap inside.
 *
 * That element is "flex flex-row flex-wrap flex-auto": flex-auto makes it fill the scroll
 * area, and the default align-content of stretch then shares its spare height out among
 * the lines - one line per section. So each section is stretched taller than its cards and
 * the slack shows up under them. It is the same reason a fresh screen shows two rows and
 * then settles to one while keeping the height: the stretch was measured before the cards
 * were resized.
 */
.${ROWS_CLASS} {
    align-content: flex-start !important;
    /*
     * ⚠️ And it must not grow. The element carries flex-auto, so it took the section's full
     * height and left a band of empty space under a single row of cards; align-content
     * alone only decided where in that band the cards sat.
     */
    flex: 0 0 auto !important;
}
${CARD_SELECTOR} {
    box-sizing: border-box !important;
    display: flex !important;
    align-items: stretch;
    /*
     * A third of the row, as a percentage - NOT a measured pixel width.
     *
     * The measured version was correct but arrived late: it is written when the decorator
     * runs, so cards drew at the game's own width first and only snapped into three columns
     * once something disturbed the DOM - hovering a card was enough, which is exactly what
     * it looked like. A percentage is right from the first frame.
     *
     * It is only even now because the frame inside has its margin zeroed below; that margin
     * was the real unevenness, not the arithmetic.
     */
    width: 33.3333% !important;
    margin-right: 0 !important;
    /*
     * ⚠️ flex-grow OFF. A width alone did not hold: as a flex item the card could still be
     * stretched by leftover space in its line, which is why the last column came out wider
     * than the other two however carefully the width was computed.
     */
    flex-grow: 0 !important;
    flex-shrink: 0 !important;
    /* The gap lives inside the box, so the columns still add up to the full width. */
    padding: 0 0.3rem;
}
/*
 * ⚠️ THE PANEL IS THE CHILD, NOT THE CARD. This is why every attempt to even the columns
 * up by sizing ".trade-route-card" did nothing visible.
 *
 * trade-route-card.js splits off only "tradeRoute", "autoFocus", "class" and "onFocus",
 * and spreads the REST onto the CardFrame. The style prop is not in that list, so the
 * width and margin-right the tab computes land on the frame - the bordered box the player
 * sees - while .trade-route-card is only the Activatable wrapped around it and is never
 * sized by the game at all.
 *
 * So the frame is what has to be pinned: full width of the card, and no margin. That
 * margin was the visible unevenness - the tab gives every card 12px of it except the last
 * in each row, which is exactly how much wider the third column looked.
 *
 * Width, not height: an explicit height made its own mt-2/mb-2 push past the bottom and
 * rows ended up touching. Stretching leaves those margins to space the rows.
 */
${CARD_SELECTOR} > * {
    flex: 1 1 auto;
    width: 100% !important;
    margin-right: 0 !important;
    margin-left: 0 !important;
}

/*
 * The two sub-groups under the unavailable routes. Full width, so each starts its own line
 * in the wrapping row it lives in, and each collapses on its own.
 */
.${GROUP_CLASS} {
    box-sizing: border-box;
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    width: 100%;
}
.${GROUP_CLASS}__header {
    padding: 0.35rem 0.6rem;
    margin: 0.5rem 0.3rem 0.2rem 0.3rem;
    border-radius: 0.2rem;
    background: rgba(21, 27, 39, 0.75);
    color: #b39e80;
    font-size: 0.95rem;
    text-transform: uppercase;
    pointer-events: auto;
}
.${GROUP_CLASS}__header:hover { color: #e5d2ac; }
.${GROUP_CLASS}__body {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: stretch;
    align-content: flex-start;
    width: 100%;
}
.${GROUP_CLASS}--collapsed > .${GROUP_CLASS}__body { display: none; }

.${CLASS}__arrow {
    flex: 0 0 auto;
    margin: 0 0.5rem;
    opacity: 0.75;
}
.${CLASS}__icon {
    flex: 0 0 auto;
    width: 1.7rem;
    height: 1.7rem;
    margin-right: 0.5rem;
    pointer-events: auto;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
`;

let styleElement = null;
let observer = null;
let routesByCityName = null;
/** Leaders we could sign a route with right now; filled by the same pass as the map. */
let startableLeaders = null;

/**
 * Every projected route, keyed by the name on the card.
 *
 * Cached because the projection is real work - it is what the model runs to build this
 * whole tab - and a tab full of cards would otherwise run it once per card.
 */
function routeInfo() {
    if (routesByCityName) {
        return routesByCityName;
    }
    routesByCityName = new Map();
    startableLeaders = new Set();
    try {
        const trade = Players.get(GameContext.localPlayerID)?.Trade;
        const options = TradeRouteSearchOptions.INCLUDE_FAILED + TradeRouteSearchOptions.EXTENDED_STATUS;
        trade?.projectPossibleTradeRoutes(options)?.forEach((route) => {
            const target = Cities.get(route.targetCityId);
            const recipient = Cities.get(route.nearestCityId);
            if (!target || !recipient) {
                return;
            }
            const status = route.status ?? [];
            routesByCityName.set(Locale.compose(target.name), {
                isLand: route.domain === DomainType.DOMAIN_LAND,
                recipient: Locale.compose(recipient.name),
                status,
            });
            // SUCCESS means every criterion is met - the route only needs signing. The
            // summary above the tabs uses this to tell free capacity apart from capacity
            // with nothing in reach.
            if (status.includes(TradeRouteStatus.SUCCESS) && target.owner !== undefined) {
                startableLeaders.add(target.owner);
            }
        });
    } catch (error) {
        warn(`could not read the trade routes: ${error}`);
    }
    return routesByCityName;
}

/** Routes change when one is signed or a settlement changes hands. */
export function forgetTradeRoutes() {
    routesByCityName = null;
    startableLeaders = null;
    summaryShown = false;
}

let summaryShown = false;

/**
 * Puts the total above the tabs, or leaves the one already there alone.
 *
 * ⚠️ Idempotent on purpose. This runs from the observer callback, and an append that
 * happens every pass is itself a mutation - the shape that froze the game once already.
 * Rebuilt only when the routes changed, or when the screen dropped the element from a row
 * it owns and rebuilds on its own schedule.
 */
function refreshSummary() {
    if (summaryShown && document.querySelector(`.${SUMMARY_CLASS}`)) {
        return;
    }
    routeInfo();
    showTradeSummary(startableLeaders ?? new Set());
    summaryShown = true;
}

function domainIcon(isLand) {
    try {
        return UI.getIcon(isLand ? 'TRADE_ROUTE_LAND' : 'TRADE_ROUTE_SEA');
    } catch (error) {
        return null;
    }
}

function decorate(card) {
    const title = card.querySelector(TITLE_SELECTOR);
    const row = title?.parentElement;
    if (!row) {
        return;
    }

    const name = (title.textContent ?? '').trim();
    const route = routeInfo().get(name);
    if (!route) {
        // A card whose route the projection does not list - leave it as the game drew it
        // rather than showing half a title.
        return;
    }

    /*
     * Marked every pass, not once: the class and the tooltip are ours but the row is
     * Solid's, and a redraw takes both with it.
     *
     * ⚠️ The tooltip goes on the TEXT, not on the row. On the row it also answered for the
     * icons, so hovering the domain icon showed the route name instead of what that icon
     * means.
     */
    row.classList.add(HEAD_CLASS);
    title.classList.add(NAME_CLASS);
    const fullLine = `${name} → ${route.recipient}`;
    if (title.getAttribute('data-tooltip-content') !== fullLine) {
        title.setAttribute('data-tooltip-content', fullLine);
    }

    if (row.querySelector(`.${CLASS}`)) {
        return;
    }

    /*
     * The domain icon goes next to the settlement's own icon at the head of the line,
     * where it reads as another mark on the route rather than as punctuation in the
     * middle of it. Index 1: straight after that icon, before the name.
     */
    const icon = makeElement('div', `${CLASS}__icon`, {
        'data-tooltip-content': Locale.compose(
            route.isLand ? 'LOC_NAJANE_COMMERCE_ROUTE_LAND' : 'LOC_NAJANE_COMMERCE_ROUTE_SEA',
        ),
    });
    const iconUrl = domainIcon(route.isLand);
    if (iconUrl) {
        icon.style.backgroundImage = `url(${iconUrl})`;
    }
    row.insertBefore(icon, row.children[1] ?? null);

    const element = makeElement('div', CLASS);
    const arrow = makeElement('div', `${CLASS}__arrow`);
    arrow.textContent = '→';

    // The game's own class for the card's name, so both ends of the route are one
    // typeface and one case rather than a title followed by body text.
    const destination = makeElement('div', 'font-title', { 'data-tooltip-content': fullLine });
    destination.textContent = route.recipient;

    appendAll(element, arrow, destination);
    row.appendChild(element);
}

let remeasureFrame = null;
let remeasureAttempts = 0;

function scheduleRemeasure() {
    if (remeasureFrame !== null || remeasureAttempts >= MAX_REMEASURE_ATTEMPTS) {
        return;
    }
    remeasureAttempts++;
    remeasureFrame = requestAnimationFrame(() => {
        remeasureFrame = null;
        updateMeasuredLayout();
        decorateAll();
    });
}

/**
 * The one number that cannot be written as a stylesheet constant: how much room the title
 * row has before it reaches the leader's portrait.
 *
 * ⚠️ Both looked up from the CARD, not from the row's parent. The title row is wrapped in
 * an Activatable, so its parent holds nothing but the row itself - searching there for the
 * portrait found nothing and no width was ever written.
 *
 * ⚠️ Writes to a stylesheet in <head>, never to the cards, so it cannot feed the
 * MutationObserver watching them. And only when a figure actually changes, so a resize
 * settles instead of oscillating.
 */
/**
 * Finds the element the sections wrap inside and marks it.
 *
 * ⚠️ Found by walking up until an ancestor carries BOTH flex-wrap and flex-auto, rather
 * than by counting levels. Two earlier attempts marked a parent one or two steps short -
 * a ".trade-route-cards-row" is the body of ONE section, and between it and the container
 * sit the CollapsibleContainer's own wrappers, which are not the same depth for every
 * section. The distinctive pair of classes is; see the ScrollArea in
 * commerce-screen-trade-tab.js.
 */
function markSectionsContainer(row) {
    let node = row?.parentElement;
    while (node && node !== document.body) {
        if (node.classList?.contains('flex-wrap') && node.classList?.contains('flex-auto')) {
            node.classList.add(ROWS_CLASS);
            return node;
        }
        node = node.parentElement;
    }
    return null;
}

function updateMeasuredLayout() {
    const container = document.querySelector(CARD_ROW_SELECTOR);
    if (!container) {
        return;
    }
    markSectionsContainer(container);

    const sampleCard = document.querySelector(CARD_SELECTOR);
    const sample = sampleCard?.querySelector(`.${HEAD_CLASS}`);
    const portrait = sampleCard?.querySelector(LEADER_CORNER_SELECTOR);
    let rowWidth = measuredRowWidth;
    if (sample && portrait) {
        const rowLeft = sample.getBoundingClientRect().left;
        const portraitLeft = portrait.getBoundingClientRect().left;
        const room = Math.floor(portraitLeft - rowLeft - PORTRAIT_CLEARANCE);
        if (room > 0) {
            rowWidth = room;
        } else {
            scheduleRemeasure();
        }
    } else {
        scheduleRemeasure();
    }

    if (rowWidth === measuredRowWidth) {
        return;
    }
    measuredRowWidth = rowWidth;

    measuredStyle = ensureStyle(MEASURED_STYLE_ID, '');
    // Only the title row is measured now; the card's width is a percentage in the static
    // sheet, which needs no measuring and cannot arrive late.
    measuredStyle.textContent = rowWidth > 0 ? `.${HEAD_CLASS} { width: ${rowWidth}px; }` : '';
}

let decorating = false;

/**
 * ⚠️ Re-entrancy guard. Everything in here can touch the DOM, and the observer that calls
 * it watches the DOM - without this, one careless mutation is an infinite loop rather than
 * a wasted pass. The individual steps are written not to mutate when there is nothing to
 * do; this is the backstop for when one of them stops being.
 */
/**
 * Splits the unavailable routes into the two reasons worth telling apart.
 *
 * "Unavailable" lumps together routes that need a different empire and routes that need
 * nothing but one more trade capacity - which are very different pieces of news. The first
 * group is the one to act on.
 *
 * ⚠️ The status names do not read the way they mean. The model treats
 * `TradeRouteStatus.NEED_MORE_FRIENDSHIP` as "trade capacity with this player is used up"
 * (see the LOC_COMMERCE_TRADE_STATUS_CAPACITY block in commerce-screen-model.js) and
 * `DISTANCE` as out of range. Taken at face value the first would have been sorted as a
 * diplomacy problem.
 */
function unavailableGroupFor(route) {
    const status = route.status ?? [];
    const blockedByRange = status.includes(TradeRouteStatus.DISTANCE);
    const blockedByLimit = status.includes(TradeRouteStatus.NEED_MORE_FRIENDSHIP);

    if (blockedByRange) {
        return 'range';
    }
    // Only when nothing else is in the way: a route that is both over the limit and at war
    // is not "just one more slot away", which is the whole point of this group.
    if (blockedByLimit && !status.includes(TradeRouteStatus.AT_WAR)) {
        return 'limit';
    }
    return null;
}

/**
 * The two groups, in a fixed order: what only the limit blocks first, out of range after.
 *
 * Both are created the first time either is needed, so the order on screen is this one
 * rather than whichever kind of card happened to come first in the list.
 */
const GROUPS = [
    { kind: 'limit', labelKey: 'LOC_NAJANE_COMMERCE_BLOCKED_LIMIT' },
    { kind: 'range', labelKey: 'LOC_NAJANE_COMMERCE_BLOCKED_RANGE' },
];

function groupContainer(row, kind) {
    for (const group of GROUPS) {
        if (row.querySelector(`.${GROUP_CLASS}--${group.kind}`)) {
            continue;
        }
        const element = makeElement('div', `${GROUP_CLASS} ${GROUP_CLASS}--${group.kind}`);
        const header = makeElement('div', `${GROUP_CLASS}__header font-title`);
        header.textContent = Locale.compose(group.labelKey);
        // Its own collapse, like the sections around it.
        bindActivatable(header, () => element.classList.toggle(`${GROUP_CLASS}--collapsed`));

        const body = makeElement('div', `${GROUP_CLASS}__body`);
        appendAll(element, header, body);
        row.appendChild(element);
    }
    return row.querySelector(`.${GROUP_CLASS}--${kind} > .${GROUP_CLASS}__body`);
}

function groupUnavailable() {
    let grouped = 0;
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        const name = (card.querySelector(TITLE_SELECTOR)?.textContent ?? '').trim();
        const route = routeInfo().get(name);
        if (!route) {
            continue;
        }
        /*
         * ⚠️ Which cards are unavailable is decided from the ROUTE STATUS, not from the
         * "disabled" class on the card. That class is set on the CardFrame through Solid's
         * classList prop, and looking for it on the card's first child found nothing -
         * which is why no groups appeared at all. The status is the same source the tab
         * itself sorts these sections by.
         */
        const status = route.status ?? [];
        if (status.includes(TradeRouteStatus.SUCCESS) || status.includes(TradeRouteStatus.ALREADY_EXISTS)) {
            continue;
        }

        const kind = unavailableGroupFor(route);
        if (!kind) {
            continue;
        }
        // The section this card belongs to - still correct once it has been moved, because
        // the groups live inside that same section.
        const section = card.closest?.(CARD_ROW_SELECTOR) ?? card.parentElement;
        if (!section) {
            continue;
        }
        const body = groupContainer(section, kind);
        if (!body) {
            continue;
        }
        // Only when it is not already there - moving a node is a childList mutation and the
        // observer watching these would call this again. See quirk 57.
        if (card.parentElement !== body) {
            body.appendChild(card);
            grouped++;
        }
    }
    if (grouped > 0) {
        log(`unavailable trade routes: ${grouped} card(s) sorted into groups`);
    }
}

function decorateAll() {
    if (decorating) {
        return;
    }
    decorating = true;
    try {
        updateMeasuredLayout();
        for (const card of document.querySelectorAll(CARD_SELECTOR)) {
            try {
                decorate(card);
            } catch (error) {
                warn(`decorating a trade route card failed: ${error}`);
            }
        }
        try {
            groupUnavailable();
        } catch (error) {
            warn(`grouping the unavailable routes failed: ${error}`);
        }
        try {
            refreshSummary();
        } catch (error) {
            warn(`totalling the trade routes failed: ${error}`);
        }
    } finally {
        decorating = false;
    }
}

export function startTradeRoutes() {
    remeasureAttempts = 0;
    measuredRowWidth = 0;
    summaryShown = false;
    // Carries the rule that hides the instruction line; this tab can be the first one
    // opened, so it cannot wait for the Resources tab to put it there.
    ensureScreenLayout();
    styleElement = ensureStyle(STYLE_ID, `${STYLE}
${SUMMARY_STYLE}`);
    if (observer) {
        return;
    }
    // Cards are Solid's and are rebuilt whenever the tab's data changes, so this stays
    // attached and puts the destination back - the pattern settlement-controls.js uses.
    decorateAll();
    // The title row cannot be measured until the cards have been laid out; ask for a pass
    // on the next frame rather than waiting for something to disturb the DOM.
    scheduleRemeasure();
    observer = new MutationObserver(() => decorateAll());
    observer.observe(document.body, { childList: true, subtree: true });
    log('trade route cards decorated');
}

export function stopTradeRoutes() {
    observer?.disconnect();
    observer = null;
    /*
     * ⚠️ Only the elements this mod created. The group containers under the unavailable
     * routes are deliberately left alone: they hold the GAME's cards, and removing a
     * container would take those with it. Solid rebuilds that section on the next visit,
     * groups and all.
     */
    document.querySelectorAll(`.${CLASS}`).forEach((element) => element.remove());
    hideTradeSummary();
    styleElement?.remove();
    styleElement = null;
    measuredStyle?.remove();
    measuredStyle = null;
    measuredRowWidth = 0;
    forgetTradeRoutes();
}

/**
 * Hooking in: the tab container itself is a plain exported function, but the CARD is
 * registered - so wrapping the card is the only mount signal this tab offers.
 *
 * The count is what tells us the tab has gone. It is checked a frame later because a
 * rebuild unmounts the old cards around the same time it mounts the new ones, and the
 * order between the two is not ours to rely on - deciding at the moment the count hits
 * zero would tear the decoration down in the middle of a redraw.
 */
const ROUTE_EVENTS = ['TradeRouteAddedToMap', 'TradeRouteChanged', 'LocalPlayerTurnBegin'];

const originalFactory = TradeRouteCard.factory;
const overridePriority = (TradeRouteCard.overridePriority ?? 0) + 100;

let liveCards = 0;
let listening = false;

function listenForRouteChanges() {
    if (listening) {
        return;
    }
    listening = true;
    for (const name of ROUTE_EVENTS) {
        try {
            engine.on(name, forgetTradeRoutes);
        } catch (error) {
            warn(`could not listen for ${name}: ${error}`);
        }
    }
}

function TradeRouteCardWithDestination(props) {
    onMount(() => {
        liveCards++;
        listenForRouteChanges();
        startTradeRoutes();
    });

    onCleanup(() => {
        liveCards--;
        requestAnimationFrame(() => {
            if (liveCards <= 0) {
                liveCards = 0;
                stopTradeRoutes();
            }
        });
    });

    return originalFactory(props);
}

ComponentRegistry.register({
    name: 'TradeRouteCard',
    overridePriority,
    createInstance: TradeRouteCardWithDestination,
});
