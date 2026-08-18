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
import { onCleanup, onMount, untrack } from '/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { TradeRouteCard } from '/base-standard/ui-next/screens/commerce/trade-route-card.js';

import { MerchantOrdersChangedEventName } from '../engine/merchant-orders.js';
import { disposeFramedTooltips } from './framed-tooltip.js';
import { ensureScreenLayout } from './layout.js';
import {
    BUY_STACK_CLASS,
    BUY_STYLE,
    LEADER_LINK_CLASS,
    TradeCapacityChangedEventName,
    decorateBuyMerchant,
    decorateLeaderLink,
    forgetMerchantOffers,
    markMerchantStateStale,
} from './trade-buy-merchant.js';
import {
    SORT_STYLE,
    compareRoutes,
    ensureSortTabs,
    matchesFilter,
    removeSortTabs,
    setSortRoutes,
    startSortTabs,
} from './trade-sort-tabs.js';
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

/** The ScrollArea viewport the sections scroll inside; see `markSectionsContainer`. */
const SCROLL_CLASS = 'najane-trade-scroll';
/** The two sub-groups this mod adds under the unavailable routes. */
const GROUP_CLASS = 'najane-trade-group';
/** Our mark on a card the filter is hiding. */
const HIDDEN_CARD_CLASS = 'najane-trade-filtered';

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
/*
 * ⚠️ Up and down ONLY. The ScrollArea's viewport carries the game's own "overflow-auto", which
 * is both axes - so the tab could be dragged sideways, and the whole section drifted left and
 * right under the cursor. The cards already add up to exactly the width of the row, so there
 * was never anything out there worth reaching: the scroll range came from single elements
 * overhanging their line (the group header's margins, fixed below) and from sub-pixel rounding
 * on three columns of 33.3333%, which no arithmetic here can rule out on every screen width.
 *
 * Locking the axis fixes the drift at the source rather than chasing the last fraction of a
 * pixel. The vertical axis is untouched, so the tab still scrolls the way it always did, and
 * the ScrollArea's own track - a SIBLING of this element, not an overlay - is unaffected.
 */
.${SCROLL_CLASS} {
    overflow-x: hidden !important;
}
.${ROWS_CLASS} {
    align-content: flex-start !important;
    /*
     * Belt for the axis lock above: nothing in here may propose a line wider than the row.
     * Without it a card whose content refuses to shrink can still stretch the flex line, and a
     * hidden overflow then CLIPS it rather than scrolling to it - which would hide the right
     * edge of the third column instead of drifting.
     */
    max-width: 100% !important;
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
 * The header that names a group of unavailable routes. Full width, so it starts its own line
 * in the wrapping row and the cards it names flow underneath it.
 *
 * ⚠️ NO SIDE MARGIN, AND THE INSET IS PADDING INSTEAD. "box-sizing: border-box" covers padding
 * and border, never margin - so "width: 100%" plus 0.3rem of margin on each side is 0.6rem
 * WIDER than the row it sits in, and that overhang was enough to make the whole tab scrollable
 * sideways: one over-wide child anywhere gives the scroll area something to scroll to.
 *
 * ⚠️ AND NOT "calc(100% - 0.6rem)" EITHER, which is what this tried first and is why the header
 * came out shrunk to the width of its own text, sitting in the first column with cards beside
 * it. This renderer is not a browser: it takes calc() over lengths, but nowhere in the game's
 * own stylesheets does a calc() mix a PERCENTAGE with a length, and mixing them here had the
 * whole declaration dropped - leaving the element at flex-basis auto, hence content-width.
 *
 * The padding absorbs the inset instead: 0.6rem of padding plus 0.3rem of margin put the text
 * 0.9rem from the edge, so 0.9rem of padding and no margin leaves the text exactly where it
 * was. Only the bar's background reaches 0.3rem further each way, out to the row's own edge.
 */
.${GROUP_CLASS} {
    box-sizing: border-box;
    flex: 0 0 auto;
    width: 100%;
    padding: 0.35rem 0.9rem;
    margin: 0.5rem 0 0.2rem 0;
    border-radius: 0.2rem;
    background: rgba(21, 27, 39, 0.75);
    color: #b39e80;
    font-size: 0.95rem;
    text-transform: uppercase;
    pointer-events: auto;
}
.${GROUP_CLASS}:hover { color: #e5d2ac; }
.${GROUP_CLASS}--collapsed { opacity: 0.65; }

/*
 * A card the tab is not asking to see. Hidden, never moved - see the ⚠️ on
 * positionGroupHeader for what moving one costs.
 */
${CARD_SELECTOR}.${HIDDEN_CARD_CLASS} { display: none !important; }

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
/**
 * The resources a projected route would deliver, as type names.
 *
 * ⚠️ `importPayloads` carries the resource as `uniqueResource.resource`, a hash - the same
 * unwrapping the game's own `trade-routes-model.js` does to draw the icons on the card.
 */
function importedResourceTypes(route) {
    const types = [];
    for (const payload of route.importPayloads ?? []) {
        const definition = GameInfo.Resources.lookup(payload.uniqueResource?.resource);
        if (definition?.ResourceType) {
            types.push(definition.ResourceType);
        }
    }
    return types;
}

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
            const entry = {
                isLand: route.domain === DomainType.DOMAIN_LAND,
                recipient: Locale.compose(recipient.name),
                status,
                /*
                 * The two ends of the route as ids rather than names, for the button that
                 * buys a merchant: `targetCityId` is the other empire's settlement, and
                 * `nearestCityId` is the settlement of ours the route is measured from -
                 * which is also the one the merchant is bought in. See trade-buy-merchant.js.
                 */
                targetCityId: route.targetCityId,
                nearestCityId: route.nearestCityId,
                /*
                 * Whose settlement it is. Trade capacity is counted per LEADER, so the buy
                 * button needs the owner as well as the settlement - see trade-buy-merchant.js.
                 */
                leaderId: target.owner,
                startable: status.includes(TradeRouteStatus.SUCCESS),
                established: status.includes(TradeRouteStatus.ALREADY_EXISTS),
                /*
                 * What the route would actually bring, as resource type names - the figure
                 * the sort tabs order the cards by. Read here rather than off the card,
                 * because the card draws icons and the tabs need to know what each icon IS.
                 */
                resources: importedResourceTypes(route),
            };
            routesByCityName.set(Locale.compose(target.name), entry);
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
    // Which tabs are worth offering depends on what is actually in reach this turn.
    setSortRoutes(Array.from(routesByCityName.values()));
    return routesByCityName;
}

/**
 * Opens the sections that the model asks to be drawn closed.
 *
 * Only one does: "unavailable trade routes" carries `initiallyCollapsed` in
 * `commerce-screen-model.js`. That made sense for a list nobody could act on, but this mod
 * splits it into "one trade slot away" and "out of range" - the first of which is the next
 * thing to work towards - and puts a sort strip on it. A section that has to be opened before
 * any of that is visible is a section most players will never see.
 *
 * ⚠️ The DATA is changed, not the DOM. `CollapsibleContainer` reads `initiallyCollapsed` once,
 * into a signal, when it is created; by the time there is an element to click, the flag has
 * already been read and clicking it from script would mean forging the engine's own input
 * event - `Activatable` ignores DOM clicks.
 *
 * ⚠️ Written in place, and only when it differs. The sections are entries in the model's
 * store: replacing them with copies would give Solid new identities on every read and rebuild
 * every card in the tab.
 *
 * Called from the screen's own transcription, which is where the tab's data passes through
 * this mod - see factory-tab.js.
 */
export function prepareTradeTabData(tabData) {
    /*
     * ⚠️ Untracked. This reads a value out of a mutable store and writes it back, and it runs
     * inside the tab's own render - which is exactly the shape that makes a computation
     * invalidate itself. It settles after one extra pass even without this, but the same shape
     * one layer over already hung the game once, and this costs nothing.
     */
    untrack(() => {
        for (const section of tabData?.tradeRouteSections ?? []) {
            const collapsible = section?.collapsibleContainerData;
            if (collapsible?.initiallyCollapsed) {
                collapsible.initiallyCollapsed = false;
            }
        }
    });
    return tabData;
}

/** Routes change when one is signed or a settlement changes hands. */
export function forgetTradeRoutes() {
    routesByCityName = null;
    startableLeaders = null;
    summaryShown = false;
    // What a merchant costs and where it can be bought changes with the same events - a
    // route signed, gold spent, a settlement lost.
    forgetMerchantOffers();
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
    const reasons = route.startable || route.established ? [] : blockedReasons(route);
    const fullLine = reasons.length
        ? `${name} → ${route.recipient}[N][N]${reasons.join('[N][N]')}`
        : `${name} → ${route.recipient}`;
    if (title.getAttribute('data-tooltip-content') !== fullLine) {
        title.setAttribute('data-tooltip-content', fullLine);
    }

    /*
     * ⚠️ Before the "already decorated" check below, not after it, and AFTER the row has been
     * marked above - the stack hangs on the title row and is found by that mark.
     */
    try {
        decorateBuyMerchant(card, route, unavailableGroupFor(route));
    } catch (error) {
        warn(`adding the buy-a-merchant button failed: ${error}`);
    }
    // Every card, including the ones nothing can be bought on: the portrait is the way to
    // diplomacy with that leader.
    try {
        decorateLeaderLink(card, route);
    } catch (error) {
        warn(`linking the leader portrait failed: ${error}`);
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
    let sections = null;
    while (node && node !== document.body) {
        if (!sections && node.classList?.contains('flex-wrap') && node.classList?.contains('flex-auto')) {
            node.classList.add(ROWS_CLASS);
            sections = node;
        } else if (sections && node.classList?.contains('overflow-auto')) {
            /*
             * The ScrollArea's viewport - the element that actually scrolls, "flex flex-col
             * flex-auto overflow-auto w-full" in core/ui-next/components/scroll-area.js. Found
             * by walking up from OUR sections container rather than by selector, so this only
             * ever marks the Trade Routes tab's own scroll area and never another tab's.
             */
            node.classList.add(SCROLL_CLASS);
            return sections;
        }
        node = node.parentElement;
    }
    return sections;
}

/**
 * A card with the buttons in its corner, or any card if none has them.
 *
 * ⚠️ Written as a loop rather than as `:has(...)`. This renderer is not a browser - it has no
 * `replaceChildren` and no CSS grid - and a selector it does not implement would silently
 * match nothing, which here means the measurement quietly going back to being wrong.
 */
function widestCornerCard() {
    /*
     * ⚠️ The "improve" stack (propose-and-buy, two prices) is wider than the plain "available"
     * one (one price) - so a card carrying THAT is preferred when one exists, not just any
     * card that happens to carry a stack. Picking the first stack found regardless of kind
     * would under-measure the row on a screen with both a startable and a limit-blocked card,
     * and the title on the limit-blocked one would run back under its own wider button - the
     * exact overlap this measurement exists to prevent.
     */
    let anyStack = null;
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        const stack = card.querySelector(`.${BUY_STACK_CLASS}`);
        if (!stack) {
            continue;
        }
        if (stack.dataset.najaneMode === 'improve') {
            return card;
        }
        anyStack ??= card;
    }
    return anyStack ?? document.querySelector(CARD_SELECTOR);
}

function updateMeasuredLayout() {
    const container = document.querySelector(CARD_ROW_SELECTOR);
    if (!container) {
        return;
    }
    markSectionsContainer(container);

    /*
     * ⚠️ What is measured is the room between the title row and the PORTRAIT, and since the
     * buttons moved into the title row itself that is now the same distance on every card -
     * the corner holds nothing but the portrait. The sample below therefore no longer has to
     * be a card that carries buttons; it is kept because picking a card that HAS them is
     * still the safest sample, and because the buttons sitting inside the measured width is
     * exactly what makes the name truncate rather than run under them.
     */
    const sampleCard = widestCornerCard();
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
let decorateFrame = null;

/**
 * Every pass through this mod's DOM work waits for the next FRAME.
 *
 * ⚠️ THIS IS NOT A DEBOUNCE, IT IS THE FIX FOR A CRASH. A `MutationObserver` callback runs as a
 * MICROTASK, and so does Solid's own effect queue - the two interleave. Decorating straight
 * from the observer therefore inserted and moved nodes IN THE MIDDLE of a render Solid had
 * begun and not yet finished, and its next `reconcileArrays` found the DOM in a state its own
 * bookkeeping did not describe:
 *
 *     Error: NotFoundError: Failed to execute 'insertBefore' on 'Node':
 *     The node before which the new node is to be inserted is not a child of this node.
 *
 * On screen that read as a first visit to the tab with no leader portraits and none of this
 * mod's buttons, both of them back on the second visit - the render had died halfway and the
 * next one started from a clean DOM. `requestAnimationFrame` runs after the microtask queue
 * has drained, so by the time any of this touches the DOM, Solid has finished with it.
 *
 * The screen is not reactive to our work either way, so a frame of delay costs nothing.
 */
function scheduleDecorate() {
    if (decorateFrame !== null) {
        return;
    }
    decorateFrame = requestAnimationFrame(() => {
        decorateFrame = null;
        decorateAll();
    });
}

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
 * Why a route cannot be started, in the game's OWN words.
 *
 * Not written here - read out of `CommerceScreenText.xml`, the same three explanations the
 * game's own card overlay shows on hover (`CommerceCriteriaDisplay`, fed by
 * `getTradeRouteDataFromTradeRoute` in commerce-screen-model.js): capacity, range, at war.
 * `route.status` only ever carries a flag when the criterion is a REAL block - a civ trait
 * that waives one keeps its status flag out of the array rather than adding it and marking it
 * inapplicable - so there is no "inapplicable" case to account for here.
 *
 * ⚠️ Composed, never stylized. This is set on the plain `data-tooltip-content` attribute,
 * whose own renderer stylizes it - see the note on `TOOLTIP_TEXT_SELECTOR` in
 * trade-summary.js, which also supplies the `white-space: pre-wrap` this needs for the line
 * breaks between reasons to actually break. Stylizing it here too would double-process the
 * `[STYLE:...]` markup the "at war" reason carries.
 *
 * Ordered the same way the game orders its own overlay: capacity, then range, then war.
 */
function blockedReasons(route) {
    const status = route.status ?? [];
    const reasons = [];
    if (status.includes(TradeRouteStatus.NEED_MORE_FRIENDSHIP)) {
        reasons.push(Locale.compose('LOC_COMMERCE_TRADE_STATUS_CAPACITY_TOOLTIP'));
    }
    if (status.includes(TradeRouteStatus.DISTANCE)) {
        reasons.push(Locale.compose('LOC_COMMERCE_TRADE_STATUS_IN_RANGE_TOOLTIP'));
    }
    if (status.includes(TradeRouteStatus.AT_WAR)) {
        reasons.push(Locale.compose('LOC_COMMERCE_TRADE_STATUS_AT_PEACE_TOOLTIP'));
    }
    return reasons;
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

/**
 * The header that names a group, positioned in front of that group's first card.
 *
 * ⚠️ IT IS THE HEADER THAT MOVES, NEVER A CARD. The cards belong to Solid's `For` over the
 * model's array; taking one out of that row - which is what this code used to do, into a
 * container of its own per group - makes Solid's record of where its nodes are a lie, and the
 * next reconcile dies on "insertBefore ... is not a child of this node" and takes the rest of
 * the screen's rendering down with it. That crash is in UI.log, twice. The grouping is now
 * done by ORDERING the model's array (see applyFilterAndOrder) and dropping a header in front
 * of each run; the only node this mod moves is its own.
 */
function positionGroupHeader(row, group, firstCard, order, collapsed) {
    let header = row.querySelector(`.${GROUP_CLASS}--${group.kind}`);
    if (!header) {
        header = makeElement('div', `${GROUP_CLASS} ${GROUP_CLASS}--${group.kind} font-title`);
        header.textContent = Locale.compose(group.labelKey);
        // Its own collapse, like the sections around it.
        bindActivatable(header, () => {
            if (collapsedGroups.has(group.kind)) {
                collapsedGroups.delete(group.kind);
            } else {
                collapsedGroups.add(group.kind);
            }
            scheduleDecorate();
        });
    }
    header.classList.toggle(`${GROUP_CLASS}--collapsed`, collapsed);
    // The ordering is what actually puts it in front of its run; the DOM position is a
    // fallback for a renderer that turns out not to implement `order`.
    const value = String(order);
    if (header.style.order !== value) {
        header.style.order = value;
    }
    // Only when it is not already there: moving a node is a childList mutation and the
    // observer watching these would call this again.
    if (header.nextSibling !== firstCard || header.parentElement !== row) {
        row.insertBefore(header, firstCard);
    }
}

function removeGroupHeaders() {
    document.querySelectorAll(`.${GROUP_CLASS}`).forEach((header) => header.remove());
}

/** Groups the player has clicked shut. Kept for the session, like the sort tabs. */
const collapsedGroups = new Set();

/** The route entry behind a card, found the same way `decorate` finds it: by its title. */
function cardRoute(card) {
    const name = (card.querySelector(TITLE_SELECTOR)?.textContent ?? '').trim();
    return routeInfo().get(name) ?? null;
}

/** Where a route belongs in the unavailable section: limit first, then range, then the rest. */
function groupRank(route) {
    const kind = unavailableGroupFor(route);
    return kind === 'limit' ? 0 : (kind === 'range' ? 1 : 2);
}

function sectionKindOf(entries) {
    if (entries.length === 0 || entries.every((entry) => entry.established)) {
        return null;
    }
    return entries.some((entry) => entry.startable) ? 'available' : 'unavailable';
}

/**
 * The place in the ordering each group's cards start at.
 *
 * Plain numbers with room between them: the header of a group takes the value below its
 * cards, and the run has a thousand places to itself, which is more routes than a game has
 * leaders.
 */
const GROUP_ORDER = { all: 100, limit: 100, range: 1100, other: 2100 };

/**
 * Hides what the tab is not asking to see, orders what is left, and names each group.
 *
 * ⚠️ ORDERED WITH `order`, THE FLEX PROPERTY - not by moving the cards and NOT by sorting the
 * model's array either. Both were tried and both are traps:
 *
 *   moving a card       breaks Solid's record of where its nodes are; the next reconcile
 *                       throws `insertBefore ... is not a child of this node` and takes the
 *                       screen's rendering down with it. See the ⚠️ above.
 *   sorting the array   the tab has a `createEffect` of its own that READS and re-sorts those
 *                       arrays (`tradeRouteSection.tradeRoutes.sort(sortFunction())`). Writing
 *                       to them wakes it, it sorts them back, that is a DOM change, the
 *                       observer calls this again - and the game hangs on opening the screen.
 *
 * `order` touches neither. It is a style on a flex item, so Solid's DOM is left exactly as
 * Solid built it and the game's effect has nothing to react to. If this renderer turned out
 * not to implement it the cards would simply stay in the game's own order - the filter would
 * still work - which is the failure this feature can afford.
 *
 * Filtering is a class that hides the card, for the same reason.
 */
function applyFilterAndHeaders() {
    for (const row of document.querySelectorAll(CARD_ROW_SELECTOR)) {
        const cards = Array.from(row.querySelectorAll(CARD_SELECTOR));
        const entries = cards.map(cardRoute);
        const kind = sectionKindOf(entries.filter(Boolean));
        if (!kind) {
            continue;
        }
        ensureSortTabs(row, kind);

        // One bucket per group, so a group's cards are ordered among themselves and the
        // headers keep their runs apart. The available section has the one bucket.
        const buckets = new Map();
        cards.forEach((card, index) => {
            const route = entries[index];
            const group = route && kind === 'unavailable' ? unavailableGroupFor(route) : null;
            const hidden = Boolean(route)
                && (!matchesFilter(route, kind) || (group !== null && collapsedGroups.has(group)));
            card.classList.toggle(HIDDEN_CARD_CLASS, hidden);

            /*
             * ⚠️ The available section's one bucket is called `all`, not `limit`. Named `limit`
             * it collided with the group of that name below, and the "blocked only by the
             * trade limit" header was planted in the middle of the AVAILABLE section.
             */
            const bucket = group ?? (kind === 'unavailable' ? 'other' : 'all');
            if (!buckets.has(bucket)) {
                buckets.set(bucket, []);
            }
            buckets.get(bucket).push({ card, route, hidden });
        });

        const wanted = [];
        for (const bucket of ['all', 'limit', 'range', 'other']) {
            const items = buckets.get(bucket);
            if (!items) {
                continue;
            }
            const base = GROUP_ORDER[bucket] ?? GROUP_ORDER.other;
            items.sort((first, second) => {
                // The hidden ones fall to the back; among the rest, what the tab counts.
                if (first.hidden !== second.hidden) {
                    return first.hidden ? 1 : -1;
                }
                return first.route && second.route
                    ? compareRoutes(first.route, second.route, kind)
                    : 0;
            });
            items.forEach((item, position) => {
                const order = String(base + position);
                // Written only on a change: this runs from the observer, and a style write is
                // cheap but a layout pass is not.
                if (item.card.style.order !== order) {
                    item.card.style.order = order;
                }
                wanted.push(item.card);
            });
        }
        reorderCards(row, cards, wanted);

        // Only the unavailable section is split into groups; the available one is one list,
        // and a header left in it from an earlier pass has to go.
        if (kind !== 'unavailable') {
            row.querySelectorAll(`.${GROUP_CLASS}`).forEach((header) => header.remove());
            continue;
        }
        for (const group of GROUPS) {
            const items = buckets.get(group.kind) ?? [];
            const collapsed = collapsedGroups.has(group.kind);
            if (items.length === 0) {
                row.querySelector(`.${GROUP_CLASS}--${group.kind}`)?.remove();
                continue;
            }
            /*
             * A collapsed group keeps its header - it is the only way back - and so does a
             * group the filter has emptied, so the player can see that it is there and why.
             */
            positionGroupHeader(row, group, items[0].card, GROUP_ORDER[group.kind] - 1, collapsed);
        }
    }
}

/**
 * Puts the cards in `wanted` order inside their own row.
 *
 * ⚠️ WITHIN THE ROW ONLY, and that distinction is the whole safety argument. The crash this
 * tab caused once - `insertBefore ... is not a child of this node`, thrown by Solid's
 * `reconcileArrays` - happens when a node Solid is tracking has left the parent it was
 * rendered into. Read that algorithm: every reference it takes is one of its own nodes or that
 * node's `nextSibling`, so as long as each card is still A CHILD OF THE SAME ROW, every
 * `insertBefore` and `replaceChild` it makes still finds its target. Moving a card into a
 * container of this mod's own is what broke it, and nothing does that any more.
 *
 * ⚠️ The caller also writes `order` on each card, and this is the belt to that pair of braces:
 * `order` appears nowhere in the shipped game, and the routes did not visibly reorder while it
 * was the only mechanism - so this renderer very likely ignores it. The style stays because it
 * costs nothing and is the right answer if it is ever honoured.
 *
 * Written back from the END, before whatever followed the last card, so the run keeps its place
 * among the row's other children - the sort strip and the group headers.
 */
function reorderCards(row, current, wanted) {
    if (wanted.length < 2 || wanted.every((card, index) => card === current[index])) {
        return;
    }
    let reference = current[current.length - 1].nextSibling;
    for (let index = wanted.length - 1; index >= 0; index--) {
        row.insertBefore(wanted[index], reference);
        reference = wanted[index];
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
            applyFilterAndHeaders();
        } catch (error) {
            warn(`filtering the trade routes failed: ${error}`);
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
${SUMMARY_STYLE}
${BUY_STYLE}
${SORT_STYLE}`);
    // Which tab is in force outlives one visit to the tab; what it needs handing over is how
    // to read a card and how to redraw once the player picks a different one.
    startSortTabs({ onChange: scheduleDecorate });
    if (observer) {
        return;
    }
    // Cards are Solid's and are rebuilt whenever the tab's data changes, so this stays
    // attached and puts the destination back - the pattern settlement-controls.js uses.
    // ⚠️ Scheduled, not called: this runs from a component's onMount, which is Solid still
    // rendering. See scheduleDecorate.
    scheduleDecorate();
    // The title row cannot be measured until the cards have been laid out; ask for a pass
    // on the next frame rather than waiting for something to disturb the DOM.
    scheduleRemeasure();
    observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, { childList: true, subtree: true });
    /*
     * ⚠️ The buttons cannot wait for a DOM mutation for this one. A merchant lost at sea
     * changes what a card should say and disturbs nothing on screen, so the observer never
     * fires and the card would keep offering to wait for a merchant that has drowned.
     */
    window.addEventListener(MerchantOrdersChangedEventName, onOrdersChanged);
    /*
     * ⚠️ Same reason, one layer up: a trade limit raised by this mod's own button disturbs
     * nothing on screen either - the cards are the game's and it has no idea anything
     * happened - so the observer never fires and every warning drawn from that limit would
     * keep saying the old number.
     */
    window.addEventListener(TradeCapacityChangedEventName, onCapacityChanged);
    log('trade route cards decorated');
}

function onOrdersChanged() {
    markMerchantStateStale();
    scheduleDecorate();
}

/**
 * Everything read from the projection is stale; read it again and redraw.
 *
 * ⚠️ The redraw is the half that was missing. `forgetTradeRoutes` alone only empties the
 * caches, which fixes the NEXT pass - and on a screen whose cards are all the game's, there
 * may not be a next pass for a long time. Nothing else was going to disturb the DOM.
 *
 * ⚠️ Guarded on the tab being open. These listeners outlive one visit (see
 * `listenForRouteChanges`), and `refreshSummary` would otherwise try to plant a total above
 * tabs that are no longer on screen.
 */
function onRoutesChanged() {
    forgetTradeRoutes();
    if (liveCards > 0) {
        scheduleDecorate();
    }
}

/**
 * ⚠️ TWO passes, not one, and the second is the one that matters.
 *
 * `Game.PlayerOperations.sendRequest` QUEUES the request. Everything the engine can be asked
 * straight afterwards - the trade capacity with that leader, what the next proposal costs,
 * whether one may be made at all - still describes the game state from BEFORE it, and stays
 * that way until the game core has played the operation back. A redraw on the next frame is
 * inside that window, so it faithfully redraws the old numbers: which is exactly what "I
 * clicked and nothing changed" looked like.
 *
 * The first pass is still worth doing - what this mod knows on its own side (that a proposal
 * is now in flight, so the button must go dark) is true immediately; see `proposedThisTurn`
 * in ui/engine/diplomacy.js. The second lands when the core catches up and brings the engine's
 * own answers with it.
 *
 * ⚠️ `GameCoreEventPlaybackComplete` is the game's OWN signal for this. `panel-diplomacy-actions.js`
 * does not refresh when a diplomacy event fires either - it sets a flag and refreshes on this
 * event, for the same reason.
 */
let awaitingCore = false;

function onCapacityChanged() {
    awaitingCore = true;
    onRoutesChanged();
}

function onCorePlaybackComplete() {
    if (!awaitingCore) {
        return;
    }
    awaitingCore = false;
    onRoutesChanged();
}

export function stopTradeRoutes() {
    observer?.disconnect();
    observer = null;
    if (decorateFrame !== null) {
        cancelAnimationFrame(decorateFrame);
        decorateFrame = null;
    }
    window.removeEventListener(MerchantOrdersChangedEventName, onOrdersChanged);
    window.removeEventListener(TradeCapacityChangedEventName, onCapacityChanged);
    /*
     * ⚠️ Only the elements this mod created. The group containers under the unavailable
     * routes are deliberately left alone: they hold the GAME's cards, and removing a
     * container would take those with it. Solid rebuilds that section on the next visit,
     * groups and all.
     */
    document.querySelectorAll(`.${CLASS}`).forEach((element) => element.remove());
    document.querySelectorAll(`.${BUY_STACK_CLASS}`).forEach((element) => element.remove());
    document.querySelectorAll(`.${LEADER_LINK_CLASS}`)
        .forEach((portrait) => portrait.classList.remove(LEADER_LINK_CLASS));
    removeSortTabs();
    removeGroupHeaders();
    document.querySelectorAll(CARD_SELECTOR).forEach((card) => {
        card.classList.remove(HIDDEN_CARD_CLASS);
        card.style.order = '';
    });
    // The buttons and the sort tabs both hang the game's framed tooltip off elements outside
    // Solid's tree, and those reactive roots have to be disposed by hand. ⚠️ By SCOPE: the
    // unscoped call takes down every tooltip on the screen, including the ones the Resources
    // tab has just built.
    disposeFramedTooltips('trade-routes');
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
/*
 * ⚠️ `DiplomacyEventEnded` and `DiplomacyQueueChanged` are here for ONE reason: a proposed
 * "Improve Trade Relations" treaty resolving. Listened for the same way
 * `panel-diplomacy-actions.js` itself does (`onDiplomacyEventEnded`/`onDiplomacyQueueChanged`
 * both just set a refresh flag), because nothing narrower exists to ask "did MY trade
 * capacity with THAT leader just change" - only "something about a diplomatic pairing did".
 *
 * ⚠️ THIS DOES NOT MOVE A ROUTE BETWEEN SECTIONS. `onRoutesChanged` clears THIS MOD's own
 * `routesByCityName` cache AND redraws everything this mod put on the tab, so `route.status`
 * - read live from `Trade.projectPossibleTradeRoutes` - is correct again, and this mod's OWN
 * buttons, group headers and total all say the new thing straight away. The CARD ITSELF stays
 * wherever the game drew it: `commerce-screen-model.js` builds `tradeRouteTabData` exactly
 * ONCE, when the screen's model is created, and nothing in the base game ever rebuilds it
 * again for the life of that one screen-open - not on any event, not on a timer. Moving the
 * card to reflect the new capacity would mean moving it between two different `<For>`s over
 * two different arrays, which is the one thing `reconcileArrays` cannot survive being done
 * to it from outside Solid; see the ⚠️ on `reorderCards`. The only way the CARD'S OWN section
 * updates is the same one the player already found: close the screen and open it again - and
 * that is the player's decision, not something to do to them on a click.
 */
const ROUTE_EVENTS = [
    'TradeRouteAddedToMap',
    'TradeRouteChanged',
    'LocalPlayerTurnBegin',
    'DiplomacyEventEnded',
    'DiplomacyQueueChanged',
];

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
            engine.on(name, onRoutesChanged);
        } catch (error) {
            warn(`could not listen for ${name}: ${error}`);
        }
    }
    /*
     * ⚠️ Not in ROUTE_EVENTS, because it does not mean "something about the routes changed" -
     * it means "the game core has finished playing back what it was given", which fires
     * constantly and about everything. It is listened for only to close the window described
     * on `onCapacityChanged`, and the flag there is what keeps it from costing anything the
     * rest of the time.
     */
    try {
        engine.on('GameCoreEventPlaybackComplete', onCorePlaybackComplete);
    } catch (error) {
        warn(`could not listen for GameCoreEventPlaybackComplete: ${error}`);
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
