/**
 * Tidying the Trade Routes tab.
 *
 * A card carried its destination in a sentence under the title and the other leader's gold at
 * the bottom. Both become one line:
 *
 *     [hex] [sea]  MEKKA -> BOGDAN                      [leader]
 *
 * The routes that cannot be started are split in two - only the trade limit blocks them, or they
 * are out of range - because those are different news.
 *
 * ⚠️ The destination is NOT parsed out of that sentence. `domainString` is already composed and
 * translated, and taking it apart would break in every language that words it differently. The
 * route is looked up through `Trade.projectPossibleTradeRoutes` - the same call the model uses -
 * which carries `domain` and `nearestCityId` as data.
 */
import { onCleanup, onMount, untrack } from '/core/vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { TradeRouteCard } from '/base-standard/ui-next/screens/commerce/trade-route-card.js';

import { MerchantOrdersChangedEventName, merchantsOrderedTo } from '../engine/merchant-orders.js';
import { TradeQueueChangedEventName, isTradeActionQueued } from '../engine/trade-queue.js';
import { disposeFramedTooltips } from './framed-tooltip.js';
import {
    RELATIONSHIP_FOOTER_STYLE,
    startRelationshipFooter,
    stopRelationshipFooter,
} from './relationship-trade-footer.js';
import { ensureScreenLayout } from './layout.js';
import { startTabIcons } from './tab-icons.js';
import {
    BUY_STACK_CLASS,
    BUY_STYLE,
    LEADER_LINK_CLASS,
    TradeCapacityChangedEventName,
    canRaiseLimitLater,
    decorateBuyMerchant,
    decorateLeaderLink,
    forgetBuyStacks,
    forgetMerchantOffers,
    markMerchantStateStale,
    releaseDiscardedStacks,
} from './trade-buy-merchant.js';
import {
    SORT_STYLE,
    ensureSortTabs,
    removeSortTabs,
    removeSortTabsFrom,
    routeScorer,
    setSortRoutes,
    startSortTabs,
} from './trade-sort-tabs.js';
import { CLASS as SUMMARY_CLASS, STYLE as SUMMARY_STYLE, hideTradeSummary, showTradeSummary } from './trade-summary.js';
import { onEngineEvent, stopEngineEvents } from '../engine/events.js';
import { watchCommerceScreen } from './screen-observer.js';
import { gameIcon } from './icons.js';
import { TRADE_CARD_SELECTOR as CARD_SELECTOR, TRADE_HEAD_CLASS as HEAD_CLASS } from './screen-parts.js';
import { appendAll, bindActivatable, ensureStyle, makeElement, setTooltip } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

/** The row the cards wrap within; the tab measures it to decide their width. */
const CARD_ROW_SELECTOR = '.trade-route-cards-row';
/** The card title. The row holding it is its parent - see trade-route-card.js, _tmpl$. */
const TITLE_SELECTOR = '.font-title';

/** The corner of the card holding the leader portrait and the relationship badge. */
const LEADER_CORNER_SELECTOR = '.absolute.top-1.right-1';

/** The tooltip behind that portrait. The game names it; see relationship-tooltip.js. */
const RELATIONSHIP_TOOLTIP_SELECTOR = '[data-name="Relationship-Tooltip"]';

const CLASS = 'najane-trade-destination';

// HEAD_CLASS lives in screen-parts.js: this module applies it and trade-buy-merchant.js hangs
// its stack in that row, and this module imports that one - so the constant cannot travel back.

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

/** The two prose lines, matched by the classes the card's own templates carry. */
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
 *
 * The floor is also a CEILING here, because the frame has no maximum of its own: the agenda
 * description is a full sentence and without one it ran the tooltip across the cards it was
 * opened from.
 */
${RELATIONSHIP_TOOLTIP_SELECTOR} {
    min-width: 24rem;
    max-width: 24rem;
}

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
let unwatch = null;
let routesByCityName = null;
/**
 * The same entries keyed by the target settlement.
 *
 * ⚠️ The by-NAME map is what a card can be matched on - a card carries its title and nothing else.
 * The SECTION pass works on the model's route data, which carries `cityID` and no name we could
 * trust, so it needs the other key. One index, filled by the same walk.
 */
let routesByTarget = null;

/** Leaders we could sign a route with right now; filled by the same pass as the map. */
let startableLeaders = null;

/** The resources a projected route would deliver, as type names. */
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
    routesByTarget = new Map();
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
                // The two ends as ids rather than names, for the buy-and-send button.
                targetCityId: route.targetCityId,
                nearestCityId: route.nearestCityId,
                // Whose settlement it is - trade capacity is counted per LEADER.
                leaderId: target.owner,
                startable: status.includes(TradeRouteStatus.SUCCESS),
                established: status.includes(TradeRouteStatus.ALREADY_EXISTS),
                // What the route would actually bring, as resource type names.
                resources: importedResourceTypes(route),
            };
            routesByCityName.set(Locale.compose(target.name), entry);
            routesByTarget.set(targetKey(route.targetCityId), entry);
            // SUCCESS means every criterion is met - the route only needs signing.
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
 * Our mark on the section this mod adds, so re-entering the tab does not add a second one.
 *
 * ⚠️ A marker rather than a count: `commerce-screen-model.js` builds `tradeRouteTabData` ONCE per
 * screen-open, but the tab BODY re-mounts every time the player comes back to this tab, and this
 * function runs on each of those against the same data.
 */
const UNDERWAY_SECTION_MARK = 'najaneUnderwaySection';

/**
 * The targets that were lifted into that section, so its ROW can be recognised later.
 *
 * ⚠️ The section is a fact about the DATA and the row is a fact about the DOM, with nothing
 * joining them - the container renders one row per section and names neither. Keyed by the target
 * settlement, which both sides carry.
 */
const underwayTargets = new Set();

/**
 * The targets that are blocked by NOTHING BUT the trade limit, lifted into the available section.
 *
 * ⚠️ They belong there because they are a decision, not a dead end (user's instruction,
 * 2026-09-10): a slot can be bought with Influence, and the card offers exactly that. "Unavailable"
 * is now only what no amount of diplomacy fixes - out of range.
 *
 * Rebuilt by every sync from `liftedRoutes`, below.
 */
const limitBlockedTargets = new Set();

/**
 * The model's route objects `liftLimitBlocked` has moved into "available".
 *
 * ⚠️ REMEMBERED PER ROUTE, not per sync: a later sync over the same data - an errand changing, the
 * tab re-entered - finds a lifted route already in "available", where the lift never sees it, and
 * rebuilding the set from new lifts alone dropped the "one trade slot away" header. A WeakSet: the
 * store hands back the same proxy per object, and the next screen-open brings new objects.
 */
const liftedRoutes = new WeakSet();

/**
 * ⚠️ THE OWNER IS PART OF THE KEY. A `ComponentID`'s `id` is unique only WITHIN one player, so
 * three different empires' settlements came back as 65536 and any set keyed on it alone treated
 * them as one place. Seen in UI.log as Gao, Ostia and Parsa all reporting `cityID=65536`.
 */
function targetKey(id) {
    if (id === undefined || id === null) {
        return '';
    }
    return typeof id === 'object' ? `${id.owner}:${id.id}` : String(id);
}

/**
 * Whether a merchant of ours is already spoken for this route's target.
 * ⚠️ The ORDER, not whether it is travelling: a merchant standing AT the target waiting for
 * a trade slot is not travelling any more, and the route is still very much being established.
 */
function routeIsUnderway(route) {
    try {
        const city = Cities.get(route?.cityID);
        if (!city) {
            return false;
        }
        /*
         * ⚠️ TWO WAYS IN, and both are "something is already happening about this route": a
         * merchant carrying an order for it, or a request queued against it that has not found its
         * merchant yet. A queued route with no merchant yet is still not one the player is being
         * asked to start (user's instruction, 2026-09-10).
         */
        return merchantsOrderedTo(city).length > 0 || isTradeActionQueued(city);
    } catch (error) {
        warn(`could not tell whether a trade route is under way: ${error}`);
        return false;
    }
}

/**
 * The tab data currently on screen, so the split can be redone when an errand starts or is called
 * off. ⚠️ Held for the life of the SCREEN, not of this module: `commerce-screen-model.js` builds
 * this object once per screen-open and the next opening brings a different one.
 */
let tradeTabData = null;

/** Availability, as `commerce-screen-model.js` stamps it on every route. */
const AVAILABILITY_AVAILABLE = 2;

function underwaySectionIn(sections) {
    return sections.find((section) => section?.[UNDERWAY_SECTION_MARK]) ?? null;
}

function makeUnderwaySection() {
    return {
        tradeRoutes: [],
        collapsibleContainerData: {
            titleText: Locale.compose('LOC_NAJANE_COMMERCE_GROUP_UNDERWAY'),
            centerTitle: true,
        },
        emptyDescription: '',
        [UNDERWAY_SECTION_MARK]: true,
    };
}

/** The route entry this mod holds for one of the model's routes, or null. */
function entryForRoute(route) {
    routeInfo();
    return routesByTarget?.get(targetKey(route?.cityID)) ?? null;
}

/**
 * Moves the routes that only the trade limit holds back out of "unavailable" and into "available",
 * after the ones that need nothing.
 *
 * ⚠️ A DECISION, NOT A DEAD END (user's instruction, 2026-09-10). A slot can be bought with
 * Influence and the card carries that price; burying such a route under "unavailable" - a heading
 * that also starts out collapsed - hid the one thing the player could act on. What is left under
 * that heading is only what no amount of diplomacy fixes.
 *
 * ⚠️ Moved in the DATA, before Solid renders it, exactly like the underway section; and ordered
 * BELOW the untouched ones by `applyFilterAndHeaders`, which reads `limitBlockedTargets`.
 */
function liftLimitBlocked(sections, underwaySection) {
    const available = sections.find((entry) => entry !== underwaySection && entry !== sections[0]);
    const unavailable = sections[sections.length - 1];
    if (!available || !unavailable || available === unavailable) {
        return;
    }
    const staying = [];
    const lifted = [];
    for (const route of unavailable.tradeRoutes ?? []) {
        const entry = entryForRoute(route);
        /*
         * ⚠️ ONLY WHERE THE LIMIT CAN ACTUALLY BE RAISED (user's instruction, 2026-09-10). Held
         * back by the limit is a decision the player can buy their way out of - unless the two are
         * hostile, when the treaty is shut and no turn opens it. Such a route is genuinely
         * unavailable and stays under that heading.
         */
        if (entry && unavailableGroupFor(entry) === 'limit' && canRaiseLimitLater(entry.leaderId)) {
            lifted.push(route);
            liftedRoutes.add(route);
        } else {
            staying.push(route);
        }
    }
    if (lifted.length > 0) {
        unavailable.tradeRoutes.splice(0, unavailable.tradeRoutes.length, ...staying);
        available.tradeRoutes.push(...lifted);
    }
    // This sync's lifts and every earlier one still in "available"; see `liftedRoutes`.
    for (const route of available.tradeRoutes ?? []) {
        if (liftedRoutes.has(route)) {
            limitBlockedTargets.add(targetKey(route?.cityID));
        }
    }
}

/**
 * Puts every route where its errand says it belongs: those with a merchant coming into a section
 * of their own, between the running routes and the ones that could be started, and those without
 * back among the ones that could be started.
 *
 * ⚠️ THE DATA IS MOVED, NEVER THE CARD. Moving a card between two `<For>`s by hand is the one
 * thing `reconcileArrays` cannot survive; moving a ROUTE between the arrays they render from is
 * ordinary work - Solid drops the card from one and builds a fresh one in the other, which is
 * exactly what it does whenever the tab's data changes anyway.
 *
 * ⚠️ Called again whenever an order or a queued request changes, so cancelling an errand puts the
 * route back where it came from without closing the screen.
 *
 * ⚠️ Splices IN PLACE and moves the model's own route objects, never copies: a copy would give
 * Solid new identities and rebuild every card in the section rather than the one that moved.
 */
function syncUnderwaySection(tabData) {
    const sections = tabData?.tradeRouteSections;
    if (!Array.isArray(sections) || sections.length === 0) {
        return;
    }
    underwayTargets.clear();
    limitBlockedTargets.clear();

    let section = underwaySectionIn(sections);
    const underway = [];
    const returning = [];

    // ⚠️ The FIRST section is the routes already running - established, not being established.
    for (const other of sections) {
        if (other === section || other === sections[0]) {
            continue;
        }
        const staying = [];
        for (const route of other?.tradeRoutes ?? []) {
            (routeIsUnderway(route) ? underway : staying).push(route);
        }
        if (staying.length !== (other?.tradeRoutes?.length ?? 0)) {
            other.tradeRoutes.splice(0, other.tradeRoutes.length, ...staying);
        }
    }
    for (const route of section?.tradeRoutes ?? []) {
        (routeIsUnderway(route) ? underway : returning).push(route);
    }

    for (const route of underway) {
        underwayTargets.add(targetKey(route?.cityID));
    }

    // Back where the model put them, by the availability it stamped on each one.
    for (const route of returning) {
        const home = route?.availability === AVAILABILITY_AVAILABLE
            ? sections.find((entry) => entry !== section && entry !== sections[0])
            : sections[sections.length - 1];
        home?.tradeRoutes?.push(route);
    }

    liftLimitBlocked(sections, section);

    if (underway.length === 0) {
        // ⚠️ Taken out rather than left empty: an ornate section bar over nothing reads as a bug.
        if (section) {
            sections.splice(sections.indexOf(section), 1);
        }
        return;
    }
    if (!section) {
        /*
         * ⚠️ FILLED BEFORE IT IS HANDED OVER, and this is not tidiness. `tradeRouteSections` is a
         * Solid store: what `splice` puts in is the store's OWN wrapper around the object, not the
         * object itself. Writing to the local one afterwards writes somewhere nothing renders - the
         * section appeared empty and the route that created it was lost on the next pass.
         */
        const fresh = makeUnderwaySection();
        fresh.tradeRoutes = underway.slice();
        sections.splice(1, 0, fresh);
        return;
    }
    // ⚠️ `section` here came OUT of the store, so writing through it is writing to the store.
    section.tradeRoutes.splice(0, section.tradeRoutes.length, ...underway);
}

/** Redoes the split against the data on screen; safe to call when there is no screen. */
function refreshUnderwaySection() {
    if (!tradeTabData) {
        return;
    }
    try {
        untrack(() => syncUnderwaySection(tradeTabData));
    } catch (error) {
        warn(`could not re-sort the trade route sections: ${error}`);
    }
}

/**
 * Drops the criteria a route already MEETS from the list under its card.
 *
 * ⚠️ Only the failing ones are news (user's instruction, 2026-09-10). "In range ✓" and "at peace ✓"
 * are three lines of card telling the player nothing they were asking about; what they came for is
 * the one line in red.
 *
 * ⚠️ Filtered in the DATA and IN PLACE, like the sections: the list is a `<For>` over
 * `tradeRoute.statuses`, so removing entries is ordinary work for it, while hiding the rows by
 * style would leave the black band sized for lines nobody can see.
 *
 * ⚠️ `isNegative` is the game's own mark for "this one is not met" - `CommerceCriteriaDisplay`
 * paints exactly that red and gives it the failure icon.
 */
function hideMetCriteria(tabData) {
    for (const section of tabData?.tradeRouteSections ?? []) {
        for (const route of section?.tradeRoutes ?? []) {
            const statuses = route?.statuses;
            if (!Array.isArray(statuses) || statuses.length === 0) {
                continue;
            }
            const failing = statuses.filter((status) => status?.isNegative);
            if (failing.length !== statuses.length) {
                statuses.splice(0, statuses.length, ...failing);
            }
        }
    }
}

/**
 * Takes the "where did this come from" marks off the resources on a trade card: the import banner
 * tinted with the other empire's colours, and the "Origin:" line in the resource's tooltip.
 *
 * ⚠️ BOTH ANSWER A QUESTION THE CARD ALREADY ANSWERS (user's instruction, 2026-09-13). Every
 * resource on one of these cards is imported, and from the settlement written across the top of
 * the card; the banner therefore tinted all of them the same and the line repeated the title.
 *
 * ⚠️ TAKEN OFF THE DATA, NOT HIDDEN IN CSS. `FramedResource` draws the banner only under a
 * `Show` on `importFlag`, and the game's `ResourceTooltip` draws the origin line only under a
 * `Show` on `resourceOrigin` - so clearing the two props removes both at the source. The banner
 * carries no class of its own and the tooltip is portalled out of the card entirely, which leaves
 * style rules nothing dependable to aim at.
 *
 * ⚠️ Safe to mutate: `incomingResources` holds objects the model builds fresh per route in
 * `getResourceProps`, not shared ones. Cost is one more walk of the list the criteria pass above
 * already walks, and only when the tab data is rebuilt.
 */
function stripResourceOrigins(tabData) {
    for (const section of tabData?.tradeRouteSections ?? []) {
        for (const route of section?.tradeRoutes ?? []) {
            for (const resource of route?.incomingResources ?? []) {
                resource.importFlag = undefined;
                resource.resourceOrigin = undefined;
            }
        }
    }
}

/**
 * The tab's data on its way into the tab: sections split and lifted, met criteria and origin marks
 * dropped, and every section opened - the model draws "unavailable trade routes" closed, which
 * made sense for a list nobody could act on and hides the groups and sort strip this mod puts on it.
 *
 * ⚠️ The DATA is changed, not the DOM. `CollapsibleContainer` reads `initiallyCollapsed` once
 * into a signal at creation, and clicking from script would mean forging the engine's own input
 * event - `Activatable` ignores DOM clicks.
 *
 * ⚠️ Written in place and only when it differs: the sections are entries in the model's store, so
 * replacing them with copies would give Solid new identities and rebuild every card.
 */
export function prepareTradeTabData(tabData) {
    // ⚠️ Untracked: this reads out of a mutable store and writes back, from inside the tab's own
    // reactive scope. Tracking it would make the write wake the read.
    untrack(() => {
        for (const section of tabData?.tradeRouteSections ?? []) {
            const collapsible = section?.collapsibleContainerData;
            if (collapsible?.initiallyCollapsed) {
                collapsible.initiallyCollapsed = false;
            }
        }
        tradeTabData = tabData;
        syncUnderwaySection(tabData);
        hideMetCriteria(tabData);
        stripResourceOrigins(tabData);
    });
    return tabData;
}

/** Routes change when one is signed or a settlement changes hands. */
function forgetTradeRoutes() {
    routesByCityName = null;
    routesByTarget = null;
    startableLeaders = null;
    summaryShown = false;
    // What a merchant costs and where it can be bought changes with the same events - a
    // route signed, gold spent, a settlement lost.
    forgetMerchantOffers();
}

/**
 * ⚠️ THE ENGINE ANSWERS "YOU CANNOT AFFORD THIS" WRONGLY AS THE SCREEN OPENS, and answers it
 * correctly a moment later. Measured in UI.log on every card at once: `cost=830 gold=1027
 * canBuy=false funds=true`. Opening the tab a second time in the same turn was already right,
 * which is what says the question - not the caches - is what was early.
 *
 * ⚠️ A wall-clock delay, not a frame count: a frame-based wait stretches exactly when the game is
 * busy, which is precisely when the screen is opening. One shot per visit, handed back with the
 * tab so a screen closed inside the window leaves nothing behind.
 */
const OFFER_RECHECK_MS = 400;

let offerRecheck = null;

function scheduleOfferRecheck() {
    if (offerRecheck !== null) {
        return;
    }
    offerRecheck = setTimeout(() => {
        offerRecheck = null;
        forgetMerchantOffers();
        scheduleDecorate();
    }, OFFER_RECHECK_MS);
}

function stopOfferRecheck() {
    if (offerRecheck === null) {
        return;
    }
    clearTimeout(offerRecheck);
    offerRecheck = null;
}

let summaryShown = false;

/** Puts the total above the tabs, or leaves the one already there alone. */
function refreshSummary() {
    if (summaryShown && document.querySelector(`.${SUMMARY_CLASS}`)) {
        return;
    }
    routeInfo();
    showTradeSummary(startableLeaders ?? new Set());
    summaryShown = true;
}

const domainIcon = (isLand) => gameIcon(isLand ? 'TRADE_ROUTE_LAND' : 'TRADE_ROUTE_SEA');

function decorate(card) {
    const title = card.querySelector(TITLE_SELECTOR);
    const row = title?.parentElement;
    if (!row) {
        return;
    }

    const name = (title.textContent ?? '').trim();
    const route = routeInfo().get(name);
    // Filed for `applyFilterAndHeaders`, which walks the same cards straight after this.
    routeByCardThisPass?.set(card, route ?? null);
    if (!route) {
        // A card whose route the projection does not list - leave it as the game drew it
        // rather than showing half a title.
        return;
    }

    // Marked every pass, not once: the class and the tooltip are ours but the row is Solid's and
    // comes back without them.
    row.classList.add(HEAD_CLASS);
    title.classList.add(NAME_CLASS);
    const reasons = route.startable || route.established ? [] : blockedReasons(route);
    const fullLine = reasons.length
        ? `${name} → ${route.recipient}[N][N]${reasons.join('[N][N]')}`
        : `${name} → ${route.recipient}`;
    if (title.getAttribute('data-tooltip-content') !== fullLine) {
        setTooltip(title, fullLine);
    }

    // ⚠️ Before the "already decorated" check, and AFTER the row is marked - the stack hangs on
    // the title row and is found by that mark.
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

    // The domain icon goes beside the settlement's own icon at the head of the line.
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
        // `decorateAll` measures first thing.
        decorateAll();
    });
}

/** Finds the element the sections wrap inside and marks it. */
function markSectionsContainer(row) {
    let node = row?.parentElement;
    let sections = null;
    while (node && node !== document.body) {
        if (!sections && node.classList?.contains('flex-wrap') && node.classList?.contains('flex-auto')) {
            node.classList.add(ROWS_CLASS);
            sections = node;
        } else if (sections && node.classList?.contains('overflow-auto')) {
            // The ScrollArea's viewport - the element that actually scrolls.
            node.classList.add(SCROLL_CLASS);
            return sections;
        }
        node = node.parentElement;
    }
    return sections;
}

/**
 * The title row and portrait of the first card that is drawn at all, or null.
 *
 * ⚠️ NEVER A CARD THIS TAB HIDES. A filtered card is "display: none", measures 0, and preferring
 * one (a collapsed "one trade slot away" group) re-measured for 40 frames with a full pass each and
 * wrote no title width at all. Any drawn card will do: the stack is in the TITLE ROW and the corner
 * holds only the portrait, so every card gives the same room. A loop, not ":has()", which this
 * renderer has no proven support for.
 */
function firstMeasurableCard() {
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
        if (card.classList.contains(HIDDEN_CARD_CLASS)) {
            continue;
        }
        const head = card.querySelector(`.${HEAD_CLASS}`);
        const portrait = head ? card.querySelector(LEADER_CORNER_SELECTOR) : null;
        if (portrait) {
            return { head, portrait };
        }
    }
    return null;
}

/**
 * The one number that cannot be a stylesheet constant: how much room the title row has before it
 * reaches the portrait, so it is measured.
 */
function updateMeasuredLayout() {
    const container = document.querySelector(CARD_ROW_SELECTOR);
    if (!container) {
        return;
    }
    markSectionsContainer(container);

    // ⚠️ Measured between the title row and the PORTRAIT, which owns the corner - not to the edge
    // of the card.
    const measurable = firstMeasurableCard();
    const sample = measurable?.head;
    const portrait = measurable?.portrait;
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
 * ⚠️ NOT A DEBOUNCE - THE FIX FOR A CRASH. A MutationObserver callback runs as a MICROTASK and so
 * does Solid's effect queue; decorating straight from the observer inserted nodes mid-render and
 * Solid's next `reconcileArrays` threw `NotFoundError: Failed to execute 'insertBefore'`. On
 * screen: a first visit with no portraits and none of this mod's buttons, both back on the
 * second. rAF runs after the microtask queue has drained.
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

/** Splits the unavailable routes into the two reasons worth telling apart. */
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
 * ⚠️ Three fixed strings, and `decorate` asked the game to compose them again for every blocked
 * card on every pass over the screen. None of them takes an argument.
 */
const reasonText = new Map();

function reason(key) {
    let text = reasonText.get(key);
    if (text === undefined) {
        text = Locale.compose(key);
        reasonText.set(key, text);
    }
    return text;
}

/**
 * Why a route cannot be started, in the game's OWN words - the FailureReasons `canStart` returns
 * are localisation keys the game shows elsewhere. Nothing here invents a reason.
 */
function blockedReasons(route) {
    const status = route.status ?? [];
    const reasons = [];
    if (status.includes(TradeRouteStatus.NEED_MORE_FRIENDSHIP)) {
        reasons.push(reason('LOC_COMMERCE_TRADE_STATUS_CAPACITY_TOOLTIP'));
    }
    if (status.includes(TradeRouteStatus.DISTANCE)) {
        reasons.push(reason('LOC_COMMERCE_TRADE_STATUS_IN_RANGE_TOOLTIP'));
    }
    if (status.includes(TradeRouteStatus.AT_WAR)) {
        reasons.push(reason('LOC_COMMERCE_TRADE_STATUS_AT_PEACE_TOOLTIP'));
    }
    return reasons;
}

/**
 * The runs each section is split into, in the order they are drawn.
 *
 * ⚠️ NO `underway` GROUP: routes with a merchant coming have a SECTION of their own - see
 * `syncUnderwaySection` - and a group as well would put the same cards under two headings.
 */
const GROUPS_BY_SECTION = {
    // ⚠️ The limit group lives in AVAILABLE now; see `liftLimitBlocked`.
    available: [{ kind: 'limit', labelKey: 'LOC_NAJANE_COMMERCE_BLOCKED_LIMIT' }],
    unavailable: [{ kind: 'range', labelKey: 'LOC_NAJANE_COMMERCE_BLOCKED_RANGE' }],
};

/** The header that names a group, positioned in front of that group's first card. */
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

/**
 * The route entry behind a card, found by its title.
 *
 * ⚠️ ONCE PER CARD PER PASS. `decorate` and `applyFilterAndHeaders` each walk every card on the
 * screen, and both used to run this lookup - two `querySelector` calls and two map reads per card
 * per frame in which the screen changed. The pass map is set up and dropped by `decorateAll`.
 */
let routeByCardThisPass = null;

function cardRoute(card) {
    const cached = routeByCardThisPass?.get(card);
    if (cached !== undefined) {
        return cached;
    }
    const name = (card.querySelector(TITLE_SELECTOR)?.textContent ?? '').trim();
    const route = routeInfo().get(name) ?? null;
    routeByCardThisPass?.set(card, route);
    return route;
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
 * ⚠️ `all` AND `limit` SHARE A SECTION, so they may not share a base - the limit-blocked cards
 * have to fall below the ones that need nothing.
 */
const GROUP_ORDER = { all: 100, limit: 1100, range: 2100, other: 3100 };

/**
 * Hides what the tab is not asking to see, orders what is left, and names each group.
 *
 * ⚠️ ORDERED WITH `order`, THE FLEX PROPERTY. Both alternatives are traps:
 *   moving a card    breaks Solid's record of where its nodes are; the next reconcile throws
 *                    `insertBefore ... is not a child of this node`.
 *   sorting the array  the tab has its own `createEffect` that READS and re-sorts those arrays,
 *                    so writing wakes it, it sorts back, the observer fires again - and the game
 *                    hangs on opening the screen.
 *
 * `order` is a style on a flex item, so Solid's DOM is untouched and its effect has nothing to
 * react to. If the renderer ignores it the cards stay in the game's order - a failure this
 * feature can afford. Filtering is a class that hides the card, for the same reason.
 */
function applyFilterAndHeaders() {
    for (const row of document.querySelectorAll(CARD_ROW_SELECTOR)) {
        const cards = Array.from(row.querySelectorAll(CARD_SELECTOR));
        const entries = cards.map(cardRoute);
        const kind = sectionKindOf(entries.filter(Boolean));
        if (!kind) {
            continue;
        }
        /*
         * ⚠️ NO SORT STRIP ON THE "BEING ESTABLISHED" SECTION (user's instruction, 2026-09-10).
         * The strip answers "what should be at the front of the list of things I could start",
         * and nothing in that section is something to start - each one already has a merchant
         * walking to it. A filter there could only hide errands in progress.
         */
        const isUnderwayRow = entries.some(
            (entry) => entry && underwayTargets.has(targetKey(entry.targetCityId)),
        );
        if (isUnderwayRow) {
            removeSortTabsFrom(row);
            row.querySelectorAll(`.${GROUP_CLASS}`).forEach((header) => header.remove());
            continue;
        }
        ensureSortTabs(row, kind);
        const scorer = routeScorer(kind);

        // One bucket per group, so a group's cards are ordered among themselves and the
        // headers keep their runs apart. The available section has the one bucket.
        const buckets = new Map();
        cards.forEach((card, index) => {
            const route = entries[index];
            let group = null;
            if (route) {
                group = kind === 'unavailable'
                    ? unavailableGroupFor(route)
                    // ⚠️ Read from the SET the section pass filled, not from the status again: a
                    // card sits in this run because it was MOVED here, and that is the only place
                    // that decision was taken.
                    : (limitBlockedTargets.has(targetKey(route.targetCityId)) ? 'limit' : null);
            }
            const hidden = Boolean(route)
                && (!scorer.matches(route) || (group !== null && collapsedGroups.has(group)));
            card.classList.toggle(HIDDEN_CARD_CLASS, hidden);

            // ⚠️ The available section's bucket is `all`, not `limit` - naming it `limit` would hide
            // every available card whenever the limit filter was on.
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
                    ? scorer.compare(first.route, second.route)
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

        const groups = GROUPS_BY_SECTION[kind] ?? [];
        if (groups.length === 0) {
            row.querySelectorAll(`.${GROUP_CLASS}`).forEach((header) => header.remove());
            continue;
        }
        for (const group of groups) {
            const items = buckets.get(group.kind) ?? [];
            const collapsed = collapsedGroups.has(group.kind);
            if (items.length === 0) {
                row.querySelector(`.${GROUP_CLASS}--${group.kind}`)?.remove();
                continue;
            }
            // A collapsed group keeps its header - it is the only way back.
            positionGroupHeader(row, group, items[0].card, GROUP_ORDER[group.kind] - 1, collapsed);
        }
    }
}

/**
 * Puts the cards in `wanted` order inside their own row.
 *
 * ⚠️ WITHIN THE ROW ONLY, and that is the whole safety argument. `reconcileArrays` only ever
 * references its own nodes or their `nextSibling`, so as long as each card is still A CHILD OF
 * THE SAME ROW every `insertBefore` it makes still finds its target. Moving a card into a
 * container of this mod's own is what threw `insertBefore ... is not a child of this node`.
 *
 * Written back from the END, so the run keeps its place among the row's other children.
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

/**
 * ⚠️ Re-entrancy guard: everything here touches the DOM, and the observer that calls it is watching
 * that DOM.
 *
 * ⚠️ Nothing after the teardown (`unwatch` is null only then): a frame queued before it redrew the
 * summary onto whichever tab came next and refilled the projection the teardown had just dropped.
 */
function decorateAll() {
    if (decorating || unwatch === null) {
        return;
    }
    decorating = true;
    routeByCardThisPass = new Map();
    try {
        updateMeasuredLayout();
        const cards = document.querySelectorAll(CARD_SELECTOR);
        // ⚠️ Only with cards found IN the document, and before any stack is built; see the function.
        if (cards.length > 0) {
            try {
                releaseDiscardedStacks();
            } catch (error) {
                warn(`releasing discarded buy stacks failed: ${error}`);
            }
        }
        for (const card of cards) {
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
        // Held for the pass only: the cards are Solid's and come back as different elements.
        routeByCardThisPass = null;
    }
}

/**
 * ⚠️ THE GUARD COMES FIRST. This runs on every card's mount and all of it is once-per-visit work;
 * below the setup it cost N icon passes, N queued frames and N stylesheet strings per tab.
 */
function startTradeRoutes() {
    if (unwatch) {
        return;
    }
    remeasureAttempts = 0;
    measuredRowWidth = 0;
    summaryShown = false;
    // Carries the rule that hides the instruction line; this tab can be the first one
    // opened, so it cannot wait for the Resources tab to put it there.
    ensureScreenLayout();
    /*
     * ⚠️ SAME REASON: a screen opened straight onto this tab (the dock button) must not depend on
     * the Resources tab having run it. The screen's own onMount in factory-tab.js starts it too;
     * a second call on a strip already iconified only re-runs the pass.
     */
    startTabIcons();
    styleElement = ensureStyle(STYLE_ID, `${STYLE}
${SUMMARY_STYLE}
${BUY_STYLE}
${SORT_STYLE}
${RELATIONSHIP_FOOTER_STYLE}`);
    // Which tab is in force outlives one visit to the tab; what it needs handing over is how
    // to read a card and how to redraw once the player picks a different one.
    startSortTabs({ onChange: scheduleDecorate });
    // ⚠️ Its own observer, on a root outside this screen; see relationship-trade-footer.js.
    startRelationshipFooter();
    // ⚠️ The prices the engine gives at this instant are not to be trusted; see the note above.
    scheduleOfferRecheck();
    // Cards are Solid's and are rebuilt whenever the tab's data changes, so this stays watching.
    scheduleDecorate();
    // The title row cannot be measured until the cards have been laid out; ask for a pass
    // on the next frame rather than waiting for something to disturb the DOM.
    scheduleRemeasure();
    // ⚠️ `decorateAll` directly: the shared watcher already runs its subscribers from a rAF, so
    // going through this module's own frame as well would add a second frame to every redraw.
    unwatch = watchCommerceScreen(decorateAll);
    // ⚠️ Not a DOM mutation: a merchant lost at sea changes what a card should say and disturbs
    // nothing on screen.
    window.addEventListener(MerchantOrdersChangedEventName, onOrdersChanged);
    // ⚠️ Same, one layer up: a trade limit raised by this mod's own button.
    window.addEventListener(TradeCapacityChangedEventName, onCapacityChanged);
    // ⚠️ Same footing as an order changing: it is not a DOM mutation, so nothing else notices.
    window.addEventListener(TradeQueueChangedEventName, onOrdersChanged);
    log('trade route cards decorated');
}

function onOrdersChanged() {
    markMerchantStateStale();
    /*
     * ⚠️ BEFORE the redraw, not after: which SECTION a card belongs to is decided in the data, and
     * the redraw only decorates whatever Solid has already built from it. An errand starting or
     * being called off is exactly when that answer changes.
     */
    refreshUnderwaySection();
    /*
     * ⚠️ THE SAME TRAP AS `onCapacityChanged`, and for the same reason: the click that changed the
     * order has only QUEUED its requests, so a redraw on the next frame asks the engine about a
     * merchant it has not moved yet and a route it has not signed yet - and faithfully redraws the
     * card exactly as it was. The pass after `GameCoreEventPlaybackComplete` is the one that sees
     * the signed route or the merchant under way.
     *
     * ⚠️ The projection goes too, not just the merchant state: in the Modern age the order is
     * signed and cleared within the click, so what changed is `startable`, which lives in the
     * projection cache.
     */
    awaitingCore = true;
    watchForCorePlayback();
    onRoutesChanged();
}

/** Everything read from the projection is stale; read it again and redraw. */
function onRoutesChanged() {
    forgetTradeRoutes();
    if (liveCards > 0) {
        scheduleDecorate();
    }
}

/**
 * ⚠️ TWO passes, and the second is the one that matters. `sendRequest` QUEUES, so everything the
 * engine can be asked straight afterwards still describes the state from BEFORE it - a redraw on
 * the next frame faithfully redraws the old numbers, which is what "I clicked and nothing
 * changed" looked like. The first pass is still worth doing for what this mod knows on its own
 * side. `GameCoreEventPlaybackComplete` is the game's own signal for the second.
 */
let awaitingCore = false;

function onCapacityChanged() {
    awaitingCore = true;
    watchForCorePlayback();
    onRoutesChanged();
}

function onCorePlaybackComplete() {
    if (!awaitingCore) {
        return;
    }
    awaitingCore = false;
    stopWatchingForCorePlayback();
    onRoutesChanged();
}

function stopTradeRoutes() {
    unwatch?.();
    unwatch = null;
    stopRelationshipFooter();
    stopOfferRecheck();
    // Nothing is drawing a route any more, so nothing needs telling that one changed.
    stopListeningForRouteChanges();
    stopWatchingForCorePlayback();
    awaitingCore = false;
    if (decorateFrame !== null) {
        cancelAnimationFrame(decorateFrame);
        decorateFrame = null;
    }
    if (remeasureFrame !== null) {
        cancelAnimationFrame(remeasureFrame);
        remeasureFrame = null;
    }
    remeasureAttempts = 0;
    window.removeEventListener(MerchantOrdersChangedEventName, onOrdersChanged);
    window.removeEventListener(TradeCapacityChangedEventName, onCapacityChanged);
    window.removeEventListener(TradeQueueChangedEventName, onOrdersChanged);
    // ⚠️ Only the elements this mod created - the game owns the rest of what is on screen.
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
    // ⚠️ By SCOPE: the unscoped call takes down every tooltip on the screen, including the ones
    // the Resources tab has just built.
    disposeFramedTooltips('trade-routes');
    forgetBuyStacks();
    hideTradeSummary();
    // ⚠️ The model builds fresh tab data for the next opening; holding this one would re-sort a
    // structure nothing is rendering any more.
    tradeTabData = null;
    underwayTargets.clear();
    limitBlockedTargets.clear();
    styleElement?.remove();
    styleElement = null;
    measuredStyle?.remove();
    measuredStyle = null;
    measuredRowWidth = 0;
    forgetTradeRoutes();
    // The sort strip's copy of the route entries, which `forgetTradeRoutes` does not reach.
    setSortRoutes([]);
}

/*
 * ⚠️ The two diplomacy events are here for ONE reason: a proposed "Improve Trade Relations"
 * resolving. Nothing narrower exists - only "something about a diplomatic pairing changed".
 *
 * ⚠️ THESE REDRAW, THEY DO NOT RE-SECTION. `commerce-screen-model.js` builds `tradeRouteTabData`
 * once per screen-open; only this mod's own order and queue changes move a route between sections
 * (`onOrdersChanged`), and a route signed or a limit raised any other way keeps its section until
 * the screen is reopened.
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

/**
 * ⚠️ HANDED BACK WHEN THE TAB GOES. These used to be taken once and kept for the session: a flag
 * said "already listening" and nothing ever cleared it, so after one visit to this tab five
 * UNFILTERED subscriptions - `TradeRouteChanged` and `DiplomacyQueueChanged` are raised for every
 * player in the game - went on throwing away caches nothing was going to read.
 */
let routeSubscriptions = [];

function listenForRouteChanges() {
    if (routeSubscriptions.length > 0) {
        return;
    }
    // Through the shared dispatcher; `LocalPlayerTurnBegin` alone has five subscribers across
    // this mod and used to be five separate `engine.on` calls. See engine/events.js.
    for (const name of ROUTE_EVENTS) {
        const handle = onEngineEvent(name, onRoutesChanged);
        if (handle) {
            routeSubscriptions.push(handle);
        }
    }
}

function stopListeningForRouteChanges() {
    stopEngineEvents(routeSubscriptions);
}

/**
 * ⚠️ Subscribed only while something is waiting for it. `GameCoreEventPlaybackComplete` means
 * "the core finished playing back what it was given" and fires constantly; it was subscribed once
 * and left, with a flag inside the handler to make it cheap - and cheap is not free when the
 * callback runs several times a second all game. The window it exists for is a few hundred ms.
 */
let corePlaybackSubscription = null;

function watchForCorePlayback() {
    if (corePlaybackSubscription) {
        return;
    }
    corePlaybackSubscription = onEngineEvent('GameCoreEventPlaybackComplete', onCorePlaybackComplete);
}

function stopWatchingForCorePlayback() {
    if (!corePlaybackSubscription) {
        return;
    }
    const handles = [corePlaybackSubscription];
    corePlaybackSubscription = null;
    stopEngineEvents(handles);
}

/**
 * The end-of-tab check, one for the whole tab.
 * ⚠️ Not one per card: every card's frame ran in the same frame, each saw the count at zero, and the
 * whole teardown - eight document-wide queries - ran once per card.
 */
let teardownFrame = null;

/**
 * Hooking in: the tab container is a plain exported function, so wrapping the CARD is the only
 * mount signal this tab offers. The count is checked a frame later because a rebuild unmounts the
 * old cards around the same time it mounts the new ones.
 */
function TradeRouteCardWithDestination(props) {
    onMount(() => {
        liveCards++;
        listenForRouteChanges();
        startTradeRoutes();
    });

    onCleanup(() => {
        liveCards--;
        if (teardownFrame !== null) {
            return;
        }
        teardownFrame = requestAnimationFrame(() => {
            teardownFrame = null;
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
