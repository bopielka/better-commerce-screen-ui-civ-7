/**
 * The stack of buttons on a trade route card: buy a merchant, go and look at it - and on a card
 * blocked by nothing but the trade limit, propose the treaty that would open a slot and buy the
 * merchant anyway.
 *
 * The gold button is one click for: buy a merchant in the settlement the route is measured from,
 * walk it to the other empire, open the route the moment the engine allows it (the last step is
 * engine/merchant-orders.js). The limit-blocked variant proposes "Improve Trade Relations"
 * (engine/diplomacy.js) first and sends the merchant regardless of the answer.
 *
 * ⚠️ THE TREATY CAN BE REFUSED - proposing is not the same as it taking effect. The merchant goes
 * anyway because it already knows how to wait: merchant-orders.js retries every turn, whoever the
 * slot ends up coming from.
 *
 * ⚠️ A button appears ONLY where this mod can promise something. A card blocked by distance or
 * already running gets no button rather than a dark one - the reason is written across it.
 *
 * ⚠️ Nothing asks for confirmation, deliberately: the price is on the button before it is
 * pressed. What must never happen is buying without the price visible, which is why an
 * unaffordable button goes dark rather than hidden.
 *
 * It sits at the right-hand end of the card's TITLE ROW; the portrait keeps the corner and the
 * resources have the row below. The row is Solid's, so a redraw takes the stack and the tab's
 * observer puts it back.
 */
import { RaiseDiplomacyEvent } from '/base-standard/ui/diplomacy/diplomacy-events.js';

import {
    influenceBalance,
    proposeTradeRelations,
    tradeRelationsOffer,
} from '../engine/diplomacy.js';
import {
    focusUnitOnMap,
    forgetMerchantOffers as forgetEngineOffers,
    goldBalance,
    purchaseAndCollectMerchant,
    purchaseSite,
    stopMerchant,
    turnsUntilRouteOpens,
    tradeCapacityWith,
} from '../engine/merchant.js';
import {
    clearMerchantOrder,
    forgetMerchantState,
    merchantsBoundFor,
    merchantsBoundForPlayer,
    nearestIdleMerchant,
    orderMerchantTo,
} from '../engine/merchant-orders.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { ICON_BUTTON_STYLE, makeIconButton } from './icon-button.js';
import { closeCommerceScreen } from './close-screen.js';
import { yieldIcon } from './icons.js';
import { TRADE_HEAD_CLASS } from './screen-parts.js';
import { bindActivatable, clearChildren, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

/**
 * Raised when this mod proposes "Improve Trade Relations"; listened for by screen/trade-routes.js.
 *
 * ⚠️ An EVENT rather than a direct call: what goes stale when a limit moves is never one button -
 * every card of that leader carries the same warning, and so do the group headers and the total.
 * Reopening the screen to fix it blacked out the whole screen for a button on one card.
 *
 * ⚠️ Declared by the module that RAISES it, like `MerchantOrdersChangedEventName`. trade-routes.js
 * already imports from here, so listening costs no new dependency - and importing the redraw the
 * other way would make the two circular.
 */
export const TradeCapacityChangedEventName = 'najane-trade-capacity-changed';

function announceTradeCapacityChange() {
    try {
        window.dispatchEvent(new CustomEvent(TradeCapacityChangedEventName));
    } catch (error) {
        warn(`could not announce the trade capacity change: ${error}`);
    }
}

export const BUY_CLASS = 'najane-trade-buy';

/** The column the two buttons live in; what the tab's teardown removes. */
export const BUY_STACK_CLASS = `${BUY_CLASS}-stack`;

const STACK_CLASS = BUY_STACK_CLASS;
const LOCATE_CLASS = `${BUY_CLASS}-locate`;
const WARN_CLASS = `${BUY_CLASS}-warn`;
const IMPROVE_CLASS = `${BUY_CLASS}-improve`;
/** "Send the merchant you already have" - the plus beside the price. */
const SEND_CLASS = `${BUY_CLASS}-send`;
/** The limit-blocked variant: it carries a price, so it is not a small square. */
const SEND_WIDE_CLASS = `${BUY_CLASS}-send-wide`;
/** "Call that merchant off" - the X beside the locate pin. */
const CANCEL_CLASS = `${BUY_CLASS}-cancel`;
/** Holds the pin and the X side by side. */
const ERRAND_ROW_CLASS = `${BUY_CLASS}-errand-row`;

/** The green of the "send a spare merchant" plus - the game's own positive colour. */
const SEND_PLUS_COLOUR = '#9ad48f';

/**
 * ⚠️ And its size, for the same reason as its colour. The priced button inherits 0.95rem from
 * the rule it shares with the gold button, so the two pluses came out visibly different - the
 * bare one larger. They are one offer written two ways; the mark that identifies it is the
 * same mark, so neither its colour nor its size may be stated twice.
 */
const SEND_PLUS_SIZE = '1.15rem';
/** Holds the price and the plus side by side, so the plus reads as an alternative to it. */
const PRICE_ROW_CLASS = `${BUY_CLASS}-price-row`;
/** Our mark on a leader portrait that has been wired to diplomacy. */
export const LEADER_LINK_CLASS = 'najane-trade-leader-link';

/** The corner of the card holding the leader portrait; see trade-routes.js. */
const LEADER_CORNER_SELECTOR = '.absolute.top-1.right-1';

/** The card's title row, marked by trade-routes.js. The buttons hang on the END of it. */
const HEAD_SELECTOR = `.${TRADE_HEAD_CLASS}`;

/** The game's own map pin, the one the culture victory tab drops on the map. */
const LOCATE_ICON = 'blp:culture_pin_major';

/**
 * The game's own cancel mark - `unit-commands.xml` gives exactly this icon to
 * `UNITCOMMAND_CANCEL`, which is the command this button sends.
 */
const CANCEL_ICON = 'blp:Action_Cancel.png';

/** The game's own attention mark; `misc-icons.xml`, ID "ATTENTION". */
const WARN_ICON = 'blp:fonticon_attention';

/**
 * Whose teardown owns these tooltips; the tab disposes its own and no others.
 *
 * ⚠️ One scope PER CARD, under the tab's. A framed tooltip left mounted around a discarded
 * element floats to the top-left corner of the screen - which is what a click on the buy button
 * did until this existed.
 *
 * ⚠️ SERIAL PER STACK, NOT THE TARGET SETTLEMENT'S ID. `projectPossibleTradeRoutes` returns one
 * route PER PAIRING, so several cards name the same target; keyed by that they shared one
 * disposal bucket and each rebuild took its neighbours' fresh tooltips down with its own stale
 * one. On screen that read as "the tooltips stopped working on that leader's cards".
 */
const TOOLTIP_SCOPE = 'trade-routes';

let stackSerial = 0;

function scopeForStack(stack) {
    if (!stack.dataset.najaneScope) {
        stack.dataset.najaneScope = `${TOOLTIP_SCOPE}:${++stackSerial}`;
    }
    return stack.dataset.najaneScope;
}

export const BUY_STYLE = `
${ICON_BUTTON_STYLE}
/*
 * ⚠️ THE STACK IS IN THE TITLE ROW NOW, not in the portrait's corner, and that is what puts
 * the card into three plain pieces instead of two overlapping ones:
 *
 *     [ domain icon  route -> destination        prices ]   <- the title row
 *     [ resources                                       ]   <- below it, its own row
 *                                          [ portrait ]      <- the corner, on the right
 *
 * The corner is "position: absolute" and always was; with only the portrait left in it, it
 * reads as a right-hand column and stops being something the other rows have to dodge. The
 * title row is given an explicit width that stops short of it - see "updateMeasuredLayout" in
 * trade-routes.js - and the resources row carries the game's own "mr-13" for the same purpose.
 *
 * Nothing is MOVED to achieve this: the corner, the title row and the resources row are all
 * Solid's, in the order Solid rendered them, and only this mod's own stack changes parent.
 * See the ⚠️ on "positionGroupHeader" for what moving one of Solid's nodes costs.
 */
.${STACK_CLASS} {
    display: flex;
    /* Last in the title row, and the destination before it takes the slack, so it sits right. */
    flex: 0 0 auto;
    flex-direction: column;
    /* Centred on each other: the price is wider than the pin, and a ragged edge showed it. */
    align-items: center;
    justify-content: center;
    /* Two buttons make the stack taller than the text beside it; this centres it on the row. */
    align-self: center;
    margin-left: 0.5rem;
}
/*
 * The price and the plus, side by side. The plus is an ALTERNATIVE to paying, not a second
 * step after it, so it belongs on the same line rather than under it.
 */
.${PRICE_ROW_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    /*
     * ⚠️ STRETCH, not centre. The price button takes its height from its own contents - an
     * icon and a number - and no figure written here could match that in every language and at
     * every UI scale. Stretching hands the plus whatever height the price turned out to be, so
     * the two are equal by construction rather than by a number that happens to agree today.
     */
    align-items: stretch;
}
/*
 * "Use the merchant you already have."
 *
 * ⚠️ Sized and framed like the locate pin rather than like the price, because it is the same
 * kind of thing: one action, no number. It only ever appears when a spare merchant exists, so
 * it is never a dark button explaining why it cannot be pressed - if there is nothing to send,
 * there is nothing here at all.
 */
.${SEND_CLASS} {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.7rem;
    min-width: 1.7rem;
    /* Height comes from the price button beside it; see the note on the row above. */
    margin-left: 0.3rem;
    padding: 0;
    border: 0.08rem solid rgba(179, 158, 128, 0.55);
    border-radius: 0.25rem;
    background: rgba(21, 27, 39, 0.82);
    color: ${SEND_PLUS_COLOUR};
    font-size: ${SEND_PLUS_SIZE};
    line-height: 1;
    pointer-events: auto;
}
.${SEND_CLASS}:hover { filter: brightness(1.45); }
/*
 * The limit-blocked variant: a plus AND the Influence price of raising the limit.
 *
 * ⚠️ It goes on its OWN ROW under the price button rather than beside it - the title row it
 * would otherwise share is already carrying a route name that truncates, and a second price
 * on that line would put every card's name into an ellipsis.
 *
 * Everything about its SIZE comes from the rules above, which it was added to: the same
 * padding, border and font as the gold button, and the same 1.35rem icon as the two prices on
 * the improve button. Restating those numbers here is how it came out visibly smaller than the
 * button it sits under.
 */
/*
 * The pin and the X are one pair: "where is it" and "call it off". Side by side, because they
 * are two halves of the same question about the same merchant - and both only exist while
 * there IS one on its way.
 */
.${ERRAND_ROW_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    /* Clear of the price button directly above, which it otherwise sat flush against. */
    margin-top: 0.3rem;
}
/*
 * ⚠️ Everything about its SIZE comes from the shared rule above and from an icon the same
 * 1.35rem as the pin's. It was first written as a text glyph with a padding of its own, and
 * came out both taller than the pin and empty - "✕" is not in these fonts, and nothing draws
 * a character the font does not have.
 */
/*
 * ⚠️ SYMMETRIC PADDING, unlike every other button here - and that is the whole of what made
 * these two look wrong.
 *
 * The shared rule above is written for a button holding an icon AND a number, so it is
 * deliberately lopsided: 0.25rem before the icon, 0.4rem after the digits. On a button that is
 * nothing but an icon, that lopsidedness IS the icon being off-centre - which is exactly how
 * the cancel mark read. Both of these carry one icon and nothing else, so both get an equal
 * margin on each side.
 *
 * The vertical padding and the icon size are left as the priced button's, which is what makes
 * all three the same height: height here is 0.15rem + 1.35rem + 0.15rem in every case, and no
 * figure needs to be kept in step by hand.
 */

.${CANCEL_CLASS} { margin-left: 0.3rem; }

.${SEND_WIDE_CLASS} { margin-top: 0.25rem; }
.${SEND_WIDE_CLASS}__plus {
    margin-right: 0.3rem;
    color: ${SEND_PLUS_COLOUR};
    font-size: ${SEND_PLUS_SIZE};
    line-height: 1;
}
.${SEND_WIDE_CLASS}__cost { pointer-events: none; }
.${SEND_WIDE_CLASS}--blocked { opacity: 0.45; }
.${SEND_WIDE_CLASS}:hover { filter: brightness(1.45); }
/* Passes the row's stretch through to the button, which is this mount's only child. */

/*
 * ⚠️ EVERY mount, in one rule, and this is not tidiness - it is the fix for buttons that sat
 * crooked next to each other.
 *
 * A framed tooltip hands back a wrapper rather than the button (see "appendWithFramedTooltip"),
 * so what actually sits in a row here is always the mount. Three of the six had this rule and
 * three did not, which meant the pin was a BLOCK in the same flex row as a FLEX cancel button:
 * two different ways of seating a child, and a couple of pixels of difference in where each
 * one landed. Listing them together is what stops the next mount being forgotten.
 */

/* Every mount that is NOT an icon button; the icon buttons carry their own, see icon-button.js. */
.${BUY_CLASS}-mount,
.${WARN_CLASS}-mount,
.${IMPROVE_CLASS}-mount,
.${SEND_WIDE_CLASS}-mount { display: flex; flex: 0 0 auto; }
/* The bare plus is the one exception: it shares a row with the price and matches its height. */
.${SEND_CLASS}-mount { display: flex; flex: 0 0 auto; align-items: stretch; }

.${BUY_CLASS},
.${SEND_WIDE_CLASS} {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    padding: 0.15rem 0.4rem 0.15rem 0.25rem;
    border: 0.08rem solid rgba(179, 158, 128, 0.55);
    border-radius: 0.25rem;
    background: rgba(21, 27, 39, 0.82);
    color: #e5d2ac;
    font-size: 0.95rem;
    line-height: 1;
    white-space: nowrap;
    /* The card underneath is an Activatable; without this the click never reaches us. */
    pointer-events: auto;
}
/* The portrait answers to a click now; say so before it is clicked. */
.${LEADER_LINK_CLASS} { cursor: pointer; pointer-events: auto; }
/*
 * Under the price, in the same slot the map pin uses - the two are never both there. Row, not
 * centred-square, now that it can carry a second icon and a number as well as the mark - the
 * Influence price of fixing the thing it is warning about.
 */
.${WARN_CLASS} {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    margin-top: 0.25rem;
    padding: 0.15rem 0.3rem;
    border: 0.08rem solid rgba(224, 168, 88, 0.75);
    border-radius: 0.25rem;
    background: rgba(52, 36, 16, 0.85);
    color: #e5d2ac;
    font-size: 0.9rem;
    line-height: 1;
    pointer-events: auto;
}
.${WARN_CLASS}:hover { border-color: #ffca7a; background: rgba(78, 54, 22, 0.92); }
.${WARN_CLASS}:focus {
    outline: 0.12rem solid #ffca7a;
    outline-offset: 0.08rem;
}
/*
 * The fix is not always on offer - see buildWarnButton - and when it is not, the button
 * still opens diplomacy on a click. Dimmed rather than the sharper "--blocked" amber-on-dark
 * the other buttons use, since clicking this one is never actually inert.
 */
.${WARN_CLASS}--blocked { opacity: 0.7; }
.${WARN_CLASS}__icon {
    width: 1.3rem;
    height: 1.3rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
/*
 * Air before the Influence icon and its price, given its own class rather than a structural
 * selector - matching the same choice on IMPROVE_CLASS above, for the same reason: this
 * renderer has no proven support for one.
 */
.${WARN_CLASS}__influence-icon { margin-left: 0.3rem; }
.${WARN_CLASS}__cost { margin-left: 0.15rem; pointer-events: none; }
.${BUY_CLASS}:hover {
    border-color: #e5d2ac;
    background: rgba(37, 47, 66, 0.92);
}
.${BUY_CLASS}:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
.${BUY_CLASS}__icon {
    width: 1.5rem;
    height: 1.5rem;
    margin-right: 0.15rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
.${BUY_CLASS}__cost { pointer-events: none; }
/*
 * Dark, not gone. A price that cannot be paid is still the answer to "what would this cost",
 * and the tooltip says which of the reasons it is.
 */
.${BUY_CLASS}--blocked {
    opacity: 0.45;
    border-color: rgba(179, 158, 128, 0.3);
}
.${BUY_CLASS}--blocked:hover {
    border-color: rgba(179, 158, 128, 0.3);
    background: rgba(21, 27, 39, 0.82);
}
/* A merchant already walking there. The card says so on the button itself. */
.${BUY_CLASS}--sent { color: #9fd7a0; border-color: rgba(159, 215, 160, 0.55); }
/*
 * ⚠️ Colour ONLY. Everything about this button's geometry belongs to icon-button.js, and the
 * three rules that used to live here - a margin, a padding, and a shared hover - are exactly
 * what kept it sitting lower than the button beside it long after the component was supposed
 * to have made that impossible. A leftover rule outlives the reasoning that put it there.
 */
.${LOCATE_CLASS} { border-color: rgba(159, 215, 160, 0.55); }
/* A purchase in flight: the unit does not exist yet, so a second click must not land. */
.${BUY_CLASS}--busy { opacity: 0.45; }

/*
 * The propose-and-buy button on a limit-blocked card. Same shape as the gold one, but wide
 * enough for two prices - it is otherwise the same class, so --blocked/--busy above already
 * apply to it unchanged.
 */
.${IMPROVE_CLASS} {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    padding: 0.15rem 0.4rem 0.15rem 0.25rem;
    border: 0.08rem solid rgba(179, 158, 128, 0.55);
    border-radius: 0.25rem;
    background: rgba(21, 27, 39, 0.82);
    color: #e5d2ac;
    font-size: 0.95rem;
    line-height: 1;
    white-space: nowrap;
    pointer-events: auto;
}
.${IMPROVE_CLASS}:hover { border-color: #e5d2ac; background: rgba(37, 47, 66, 0.92); }
.${IMPROVE_CLASS}:focus { outline: 0.12rem solid #e5d2ac; outline-offset: 0.08rem; }
.${IMPROVE_CLASS}--blocked { opacity: 0.45; border-color: rgba(179, 158, 128, 0.3); }
.${IMPROVE_CLASS}--blocked:hover {
    border-color: rgba(179, 158, 128, 0.3);
    background: rgba(21, 27, 39, 0.82);
}
.${IMPROVE_CLASS}--busy { opacity: 0.45; }
.${IMPROVE_CLASS}__icon,
.${SEND_WIDE_CLASS}__icon {
    width: 1.35rem;
    height: 1.35rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
.${IMPROVE_CLASS}__cost { pointer-events: none; }
/* Air between the two prices - given its own class rather than a structural selector, which
   this renderer has no proven support for; see the ⚠️ on widestCornerCard in trade-routes.js. */
.${IMPROVE_CLASS}__influence-cost { margin-right: 0.5rem; }
`;

/** The purchase decision, cached for as long as the tab's route list is. */
const siteCache = new Map();

/** Bumped when the answers go stale; a stack carries the generation it was built for. */
let generation = 0;

/** Target settlements with a purchase in flight; see `buyAndSend`. */
const busyTargets = new Set();

/**
 * The "Improve Trade Relations" offer, cached per LEADER rather than per settlement - it is a
 * property of the pairing, and several cards can name the same leader.
 */
const tradeRelationsCache = new Map();

/**
 * How many turns a merchant still needs, per (merchant, destination).
 *
 * ⚠️ `turnsUntilRouteOpens` is a FULL PATHFINDER QUERY - see MAX_PATH_PROBES in merchant.js. It is
 * bounded by the number of merchants under an order rather than by the number of cards, because
 * only a card with one already walking to it draws this. But a redraw repeats it for nothing, and
 * the cards redraw on every generation bump.
 */
const arrivalCache = new Map();

function turnsUntilArrival(unit, targetCity) {
    const key = `${String(unit?.id?.id ?? '')}:${cityKey(targetCity)}`;
    let turns = arrivalCache.get(key);
    if (turns === undefined) {
        turns = turnsUntilRouteOpens(unit, targetCity.location);
        arrivalCache.set(key, turns);
    }
    return turns;
}

export function forgetMerchantOffers() {
    siteCache.clear();
    tradeRelationsCache.clear();
    // The prices themselves live one layer down, and the two go stale together.
    forgetEngineOffers();
    markMerchantStateStale();
}

/** The prices are still good; what a merchant is DOING has changed. */
export function markMerchantStateStale() {
    // ⚠️ The engine layer's reading of what every merchant is doing goes with it - a card asks
    // three questions that all come out of that one walk. See `merchantStates`.
    forgetMerchantState();
    arrivalCache.clear();
    generation++;
}

function cityKey(city) {
    return String(city?.id?.id ?? '');
}

function siteFor(route, targetCity) {
    const key = cityKey(targetCity);
    if (!siteCache.has(key)) {
        siteCache.set(key, purchaseSite(route.nearestCityId, targetCity));
    }
    return siteCache.get(key);
}

function improveOfferFor(leaderId) {
    if (!tradeRelationsCache.has(leaderId)) {
        tradeRelationsCache.set(leaderId, tradeRelationsOffer(leaderId));
    }
    return tradeRelationsCache.get(leaderId);
}

const goldIcon = () => yieldIcon('YIELD_GOLD');
const influenceIcon = () => yieldIcon('YIELD_DIPLOMACY');

/**
 * Whether a merchant bought now would find a trade slot when it arrives.
 *
 * ⚠️ Asked of the LEADER, not the settlement: the trade limit is per leader, so a slot spent on
 * one of their settlements is spent for all of them.
 */
function capacityWarning(route, targetCity) {
    const leaderId = route?.leaderId;
    if (leaderId === undefined || merchantsBoundFor(targetCity).length > 0) {
        return null;
    }
    const { capacity, used } = tradeCapacityWith(leaderId);
    const pending = merchantsBoundForPlayer(leaderId).length;
    if (pending === 0 || used + pending < capacity) {
        return null;
    }
    return { leaderId, capacity, used, pending };
}

function leaderName(leaderId) {
    try {
        return Locale.compose(Players.get(leaderId)?.leaderName ?? '');
    } catch (error) {
        return '';
    }
}

function warningText(warning) {
    return Locale.compose(
        'LOC_NAJANE_COMMERCE_TRADE_FULL_TOOLTIP',
        leaderName(warning.leaderId),
        warning.capacity,
        warning.used + warning.pending,
    );
}

/**
 * What the gold button's tooltip says.
 *
 * ⚠️ One state, one answer. While a merchant is on its way the button does nothing, so the
 * tooltip says only that - the sentence describing the purchase it would make is about an
 * action that is not on offer, and reading both together says the mod is confused about what
 * the button does.
 */
function buyTooltip(site, targetCity, onTheWay, warning) {
    const target = Locale.compose(targetCity.name ?? '');
    if (onTheWay > 0) {
        return Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_ON_THE_WAY', onTheWay, target);
    }
    if (site?.offer?.canBuy) {
        const offered = Locale.compose(
            'LOC_NAJANE_COMMERCE_BUY_MERCHANT_TOOLTIP',
            Locale.compose(site.offer.definition.Name),
            Locale.compose(site.city?.name ?? ''),
            site.offer.cost,
            target,
        );
        // ⚠️ A blank line, not a full stop: the framed tooltip turns each paragraph into its
        // own card, so the warning arrives as a separate card rather than as more prose.
        return warning ? `${offered}[N][N]${warningText(warning)}` : offered;
    }
    if (site?.offer?.insufficientFunds) {
        return Locale.compose(
            'LOC_NAJANE_COMMERCE_BUY_MERCHANT_FUNDS',
            site.offer.cost,
            Math.floor(goldBalance()),
        );
    }
    // Everything else the engine can refuse for - a settlement in unrest, a merchant this age
    // does not field yet - reads the same way from here: not now.
    return Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_BLOCKED');
}

/** Buys, waits for the unit, and files its standing order. */
/**
 * The one thing both buttons eventually do: buy a merchant at `site` and send it to
 * `targetCity`. Shared so the two flows cannot drift apart on what "send a merchant" means.
 */
async function purchaseAndSend(site, targetCity) {
    const merchant = await purchaseAndCollectMerchant(site.city.id, site.offer.definition);
    if (!merchant) {
        warn('the merchant did not turn up after the purchase; no order was given');
        return;
    }
    orderMerchantTo(merchant, targetCity);
    log(`${Locale.compose(site.offer.definition.Name)} bought in `
        + `${Locale.compose(site.city.name ?? '')}, heading for ${Locale.compose(targetCity.name ?? '')}`);
}

async function buyAndSend(stack, route, targetCity) {
    const key = cityKey(targetCity);
    const site = siteFor(route, targetCity);
    if (!site?.offer?.canBuy || busyTargets.has(key) || merchantsBoundFor(targetCity).length > 0) {
        return;
    }
    busyTargets.add(key);
    markMerchantStateStale();
    // ⚠️ Redrawn here, not left to the observer: a click is not a DOM mutation, so nothing else
    // would notice.
    renderAvailableStack(stack, route, targetCity);
    try {
        await purchaseAndSend(site, targetCity);
    } catch (error) {
        warn(`buying and sending a merchant failed: ${error}`);
    } finally {
        busyTargets.delete(key);
        // Gold has been spent and the next merchant costs more than this one did.
        forgetMerchantOffers();
        renderAvailableStack(stack, route, targetCity);
    }
}

/**
 * Proposes "Improve Trade Relations", then buys and sends a merchant regardless of the answer.
 * ⚠️ `mayMove: false` - see the note where it is passed.
 */
async function improveAndSend(stack, route, targetCity, offer) {
    const key = cityKey(targetCity);
    const site = siteFor(route, targetCity);
    const ready = offer?.canStart && site?.offer?.canBuy;
    if (!ready || busyTargets.has(key) || merchantsBoundFor(targetCity).length > 0) {
        return;
    }
    busyTargets.add(key);
    markMerchantStateStale();
    // Same reasoning as `buyAndSend`: the click has to redraw its own button.
    renderImproveStack(stack, route, targetCity);
    try {
        if (proposeTradeRelations(route.leaderId, offer)) {
            log(`proposed Improve Trade Relations with ${leaderName(route.leaderId)}`);
        } else {
            warn(`proposing Improve Trade Relations with ${leaderName(route.leaderId)} was refused at the door`);
        }
        await purchaseAndSend(site, targetCity);
    } catch (error) {
        warn(`proposing trade relations and sending a merchant failed: ${error}`);
    } finally {
        busyTargets.delete(key);
        // Influence and gold have both been spent; the next attempt of either costs more.
        forgetMerchantOffers();
        renderImproveStack(stack, route, targetCity);
    }
}

/**
 * Closes this screen and opens diplomacy with a leader.
 *
 * ⚠️ `closeCommerceScreen` (see close-screen.js), then the game's own `RaiseDiplomacyEvent`
 * on `window` - the diplomacy manager listens for it, so this needs no import of the manager
 * itself. The screen has to go first: the hub is an interface mode over the map, not a panel
 * that can open behind an open screen.
 */
function openDiplomacyWith(leaderId) {
    closeCommerceScreen();
    try {
        window.dispatchEvent(new RaiseDiplomacyEvent(leaderId));
    } catch (error) {
        warn(`could not open diplomacy with player ${leaderId}: ${error}`);
    }
}

/**
 * The leader's portrait, made a way in to diplomacy with them.
 *
 * The portrait is the one thing on the card that is unmistakably about the other empire, and
 * on every card it did nothing at all. The relationship tooltip behind it is left exactly as
 * it was - this only adds the click.
 *
 * ⚠️ On every card, not only the ones that can be traded with now: "who is this and can I fix
 * it" is the question a blocked card raises hardest.
 */
export function decorateLeaderLink(card, route) {
    const corner = card.querySelector(LEADER_CORNER_SELECTOR);
    const portrait = corner?.firstElementChild;
    const leaderId = route?.leaderId;
    if (!portrait || leaderId === undefined || portrait.classList.contains(STACK_CLASS)) {
        return;
    }
    if (portrait.classList.contains(LEADER_LINK_CLASS)) {
        return;
    }
    portrait.classList.add(LEADER_LINK_CLASS);
    bindActivatable(portrait, () => openDiplomacyWith(leaderId));
}

/** The warning under the price: this leader has no slot left for what you are about to buy. */
/**
 * The second half of the warning's tooltip: what clicking it actually does.
 *
 * ⚠️ Cascades the same way `improveTooltip` does, for the same reason - the treaty is not
 * always on offer, and the player should see WHY before pressing, not after. Unlike that
 * button, this one always has a fallback action: open diplomacy, exactly what it did before
 * this feature existed. So every non-ready branch ends by saying so, and only the ready
 * branch is a one-click fix on its own.
 */
function warnActionText(warning, offer) {
    const leader = leaderName(warning.leaderId);
    if (offer?.canStart && offer.cost <= influenceBalance()) {
        return Locale.compose('LOC_NAJANE_COMMERCE_TRADE_FULL_PROPOSE', leader, offer.cost);
    }
    const openLine = Locale.compose('LOC_NAJANE_COMMERCE_TRADE_FULL_OPEN', leader);
    if (!offer) {
        return openLine;
    }
    if (!offer.canStart) {
        const reason = offer.reasons.join(' ');
        return reason ? `${reason}[N]${openLine}` : openLine;
    }
    // canStart, but Influence is short.
    return `${Locale.compose('LOC_NAJANE_COMMERCE_IMPROVE_FUNDS', offer.cost, Math.floor(influenceBalance()))}[N]${openLine}`;
}

/**
 * The warning turned into the fix it warns about: propose "Improve Trade Relations" from the
 * card, without leaving the screen.
 *
 * ⚠️ It goes dark once used - the proposal can only be made once per turn per leader, and a
 * button that stayed bright and priced made the feature look broken.
 */
function buildWarnButton(warning, scope) {
    const offer = improveOfferFor(warning.leaderId);
    const ready = Boolean(offer?.canStart) && offer.cost <= influenceBalance();

    const button = makeElement('div', WARN_CLASS);
    button.classList.toggle(`${WARN_CLASS}--blocked`, !ready);

    const icon = makeElement('div', `${WARN_CLASS}__icon`);
    icon.style.backgroundImage = `url(${WARN_ICON})`;
    button.appendChild(icon);

    if (offer) {
        const influenceIconEl = makeElement('div', `${WARN_CLASS}__icon ${WARN_CLASS}__influence-icon`);
        const url = influenceIcon();
        if (url) {
            influenceIconEl.style.backgroundImage = `url(${url})`;
        }
        button.appendChild(influenceIconEl);
        const cost = makeElement('div', `${WARN_CLASS}__cost`);
        cost.textContent = String(offer.cost);
        button.appendChild(cost);
    }

    bindActivatable(button, () => {
        if (ready && proposeTradeRelations(warning.leaderId, offer)) {
            log(`proposed Improve Trade Relations with ${leaderName(warning.leaderId)}`);
            // Prices, the offer itself and the capacity behind the warning all moved; the
            // generation bump inside this is what makes the redraw below rebuild the stacks.
            forgetMerchantOffers();
            announceTradeCapacityChange();
            return;
        }
        // Not ready, or the fresh canStart inside proposeTradeRelations disagreed with the
        // cached offer this button was drawn from - either way, the fallback this button has
        // always offered.
        openDiplomacyWith(warning.leaderId);
    });

    const mount = makeElement('div', `${WARN_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_TRADE_FULL',
        text: `${warningText(warning)}[N][N]${warnActionText(warning, offer)}`,
    });
    return mount;
}

function buildBuyButton(stack, route, targetCity, site, onTheWay, scope) {
    const busy = busyTargets.has(cityKey(targetCity));
    const ready = Boolean(site?.offer?.canBuy) && onTheWay === 0 && !busy;

    const button = makeElement('div', BUY_CLASS);
/** One errand per settlement at a time; a second merchant would arrive to a spent slot. */
    button.classList.toggle(`${BUY_CLASS}--blocked`, !ready);
    button.classList.toggle(`${BUY_CLASS}--sent`, onTheWay > 0);
    button.classList.toggle(`${BUY_CLASS}--busy`, busy);

    const icon = makeElement('div', `${BUY_CLASS}__icon`);
    const url = goldIcon();
    if (url) {
        icon.style.backgroundImage = `url(${url})`;
    }
    button.appendChild(icon);

    const cost = makeElement('div', `${BUY_CLASS}__cost`);
    cost.textContent = site?.offer ? String(site.offer.cost) : '-';
    button.appendChild(cost);

    bindActivatable(button, () => {
        if (!ready) {
            return;
        }
        buyAndSend(stack, route, targetCity);
    });

    const mount = makeElement('div', `${BUY_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_BUY_MERCHANT',
        text: buyTooltip(site, targetCity, onTheWay, capacityWarning(route, targetCity)),
    });
    return mount;
}

/**
 * Closes the screen and puts the camera on the merchant.
 *
 * ⚠️ `closeCommerceScreen` (see close-screen.js) - the same call the screen's own close
 * button makes. Leaving the screen open and moving the camera behind it is what the treasure
 * cards already do, and the "?" on that tab exists because players could not tell it had
 * happened.
 */
/**
 * Sends a merchant you already own instead of buying one - one left over from an earlier age,
 * say. The plus disappears everywhere the moment it is spoken for.
 */
function buildSendSpareButton(targetCity, spare, scope) {
    const button = makeElement('div', SEND_CLASS);
    button.textContent = '+';

    bindActivatable(button, () => {
        // Re-asked at the click: the screen may have been sitting open while this merchant
        // was given something else to do.
        const live = nearestIdleMerchant(targetCity);
        if (!live) {
            return;
        }
        if (orderMerchantTo(live, targetCity)) {
            log(`sent a spare merchant to ${Locale.compose(targetCity.name ?? '')}`);
            markMerchantStateStale();
        }
    });

    const mount = makeElement('div', `${SEND_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_SEND_SPARE',
        text: Locale.compose('LOC_NAJANE_COMMERCE_SEND_SPARE_TOOLTIP', Locale.compose(targetCity.name ?? '')),
    });
    return mount;
}

/** Raise the trade limit, then send the merchant you already have. */
/**
 * Calls a merchant off the errand this mod gave it: stops the journey and drops the order,
 * without leaving the screen. It keeps its remaining movement.
 */
function buildCancelErrandButton(unit, targetCity, scope) {
    return makeIconButton({
        icon: CANCEL_ICON,
        /*
         * Red, as an action that undoes something should be. The game's mark is pale, so it is
         * flattened first and then tinted - the same three-step filter Ready or Not uses to
         * recolour the golden-age ring, which is where this idiom is known to work.
         */
        tint: 'grayscale(1) brightness(1.7) fxs-color-tint(#e0564a)',
        title: 'LOC_NAJANE_COMMERCE_CANCEL_ERRAND',
        text: Locale.compose('LOC_NAJANE_COMMERCE_CANCEL_ERRAND_TOOLTIP', Locale.compose(targetCity.name ?? '')),
        scope,
        className: CANCEL_CLASS,
        onActivate: () => {
            stopMerchant(unit);
            clearMerchantOrder(unit.id);
            log(`called a merchant off its errand to ${Locale.compose(targetCity.name ?? '')}`);
            // `clearMerchantOrder` announces the change; the tab redraws every card off that.
            markMerchantStateStale();
        },
    });
}

/** The pin and the X together; see `.${ERRAND_ROW_CLASS}`. */
function errandRow(unit, targetCity, scope) {
    const row = makeElement('div', ERRAND_ROW_CLASS);
    row.appendChild(buildLocateButton(unit, targetCity, scope));
    row.appendChild(buildCancelErrandButton(unit, targetCity, scope));
    return row;
}

function buildSendSpareImproveButton(stack, route, targetCity, offer, scope) {
    const affordable = Boolean(offer?.canStart) && offer.cost <= influenceBalance();

    const button = makeElement('div', SEND_WIDE_CLASS);
    button.classList.toggle(`${SEND_WIDE_CLASS}--blocked`, !affordable);

    const plus = makeElement('div', `${SEND_WIDE_CLASS}__plus`);
    plus.textContent = '+';
    button.appendChild(plus);

    const icon = makeElement('div', `${SEND_WIDE_CLASS}__icon`);
    const url = influenceIcon();
    if (url) {
        icon.style.backgroundImage = `url(${url})`;
    }
    button.appendChild(icon);
    const cost = makeElement('div', `${SEND_WIDE_CLASS}__cost`);
    cost.textContent = offer ? String(offer.cost) : '-';
    button.appendChild(cost);

    bindActivatable(button, () => {
        if (!affordable) {
            return;
        }
        // Both re-asked at the click: the screen may have sat open while either changed.
        const live = nearestIdleMerchant(targetCity);
        const fresh = improveOfferFor(route.leaderId);
        if (!live || !fresh?.canStart) {
            return;
        }
        if (proposeTradeRelations(route.leaderId, fresh)) {
            log(`proposed Improve Trade Relations with ${leaderName(route.leaderId)}`);
            announceTradeCapacityChange();
        }
        /*
         * ⚠️ `mayMove: false`. `sendRequest` only QUEUES, so for a moment afterwards the engine
         * still reports the old trade capacity and refuses the route - and a merchant with movement
         * reads that refusal as "too far" and walks off for a journey the treaty was about to make
         * unnecessary. Standing still costs nothing; the order is retried every turn.
         */
        if (orderMerchantTo(live, targetCity, { mayMove: false })) {
            log(`a spare merchant will open the route to ${Locale.compose(targetCity.name ?? '')} once the limit rises`);
        }
        forgetMerchantOffers();
        renderImproveStack(stack, route, targetCity);
    });

    const mount = makeElement('div', `${SEND_WIDE_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_SEND_SPARE_IMPROVE',
        text: Locale.compose(
            'LOC_NAJANE_COMMERCE_SEND_SPARE_IMPROVE_TOOLTIP',
            leaderName(route.leaderId) || Locale.compose(targetCity.name ?? ''),
            offer?.cost ?? 0,
            Locale.compose(targetCity.name ?? ''),
        ),
    });
    return mount;
}

/**
 * The price button, with the plus beside it when a spare merchant exists.
 *
 * ⚠️ Returns the price button UNWRAPPED when there is nothing spare, so a card that cannot
 * offer this keeps exactly the markup it had before the feature existed.
 */
function priceRow(priceMount, targetCity, heading, scope) {
    // One errand per settlement: a card already waiting on a merchant is not asking for another.
    const spare = heading > 0 ? null : nearestIdleMerchant(targetCity);
    if (!spare) {
        return priceMount;
    }
    const row = makeElement('div', PRICE_ROW_CLASS);
    row.appendChild(priceMount);
    row.appendChild(buildSendSpareButton(targetCity, spare, scope));
    return row;
}

function buildLocateButton(unit, targetCity, scope) {
    // ⚠️ A SECOND PARAGRAPH, not a second control: the framed tooltip turns a blank line into its
    // own card, so one tooltip carries both thoughts.
    const turns = turnsUntilArrival(unit, targetCity);
    const where = Locale.compose('LOC_NAJANE_COMMERCE_SHOW_MERCHANT_TOOLTIP');
    const when = turns === null
        ? ''
        : `[N][N]${Locale.compose('LOC_NAJANE_COMMERCE_ARRIVES_TOOLTIP', turns)}`;

    return makeIconButton({
        icon: LOCATE_ICON,
        title: 'LOC_NAJANE_COMMERCE_SHOW_MERCHANT',
        text: `${where}${when}`,
    // ⚠️ The bare number, not "3 turns": Polish alone needs three forms of the word, and the game
    // has no plural machinery reachable from here.
        label: turns === null ? null : String(turns),
        scope,
        className: LOCATE_CLASS,
        onActivate: () => {
            closeCommerceScreen();
            focusUnitOnMap(unit);
        },
    });
}

/**
 * What the propose-and-buy button's tooltip says.
 *
 * ⚠️ One state, one answer, same rule as `buyTooltip`. While a merchant is on its way this
 * button does nothing either, so the tooltip says only that.
 *
 * The two costs are shown even when one of them is what is blocking the button - the whole
 * point of pricing before pressing is that the player sees both numbers whether or not they
 * can currently afford them.
 */
function improveTooltip(leaderId, offer, site, targetCity, onTheWay) {
    const target = Locale.compose(targetCity.name ?? '');
    if (onTheWay > 0) {
        return Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_ON_THE_WAY', onTheWay, target);
    }

    const leader = leaderName(leaderId);
    const opening = Locale.compose(
        'LOC_NAJANE_COMMERCE_IMPROVE_AND_BUY_TOOLTIP',
        leader || target,
        offer?.cost ?? 0,
        site?.offer?.cost ?? 0,
        target,
    );

    if (!offer) {
        // The action does not exist for this pairing at all - a different age, say.
        return `${opening}[N][N]${Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_BLOCKED')}`;
    }
    if (!offer.canStart) {
        const reason = offer.reasons.join(' ') || Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_BLOCKED');
        return `${opening}[N][N]${reason}`;
    }
    if (offer.cost > influenceBalance()) {
        return `${opening}[N][N]${Locale.compose(
            'LOC_NAJANE_COMMERCE_IMPROVE_FUNDS',
            offer.cost,
            Math.floor(influenceBalance()),
        )}`;
    }
    if (!site?.offer?.canBuy) {
        return `${opening}[N][N]${
            site?.offer?.insufficientFunds
                ? Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_FUNDS', site.offer.cost, Math.floor(goldBalance()))
                : Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_BLOCKED')
        }`;
    }
    return opening;
}

function buildImproveButton(stack, route, targetCity, site, offer, onTheWay, scope) {
    const busy = busyTargets.has(cityKey(targetCity));
    const ready = Boolean(offer?.canStart) && offer.cost <= influenceBalance()
        && Boolean(site?.offer?.canBuy) && onTheWay === 0 && !busy;

    const button = makeElement('div', IMPROVE_CLASS);
    button.classList.toggle(`${IMPROVE_CLASS}--blocked`, !ready);
    button.classList.toggle(`${BUY_CLASS}--sent`, onTheWay > 0);
    button.classList.toggle(`${IMPROVE_CLASS}--busy`, busy);

    const influenceIconEl = makeElement('div', `${IMPROVE_CLASS}__icon`);
    const influenceUrl = influenceIcon();
    if (influenceUrl) {
        influenceIconEl.style.backgroundImage = `url(${influenceUrl})`;
    }
    button.appendChild(influenceIconEl);
    const influenceCost = makeElement('div', `${IMPROVE_CLASS}__cost ${IMPROVE_CLASS}__influence-cost`);
    influenceCost.textContent = offer ? String(offer.cost) : '-';
    button.appendChild(influenceCost);

    const goldIconEl = makeElement('div', `${IMPROVE_CLASS}__icon`);
    const goldUrl = goldIcon();
    if (goldUrl) {
        goldIconEl.style.backgroundImage = `url(${goldUrl})`;
    }
    button.appendChild(goldIconEl);
    const goldCost = makeElement('div', `${IMPROVE_CLASS}__cost`);
    goldCost.textContent = site?.offer ? String(site.offer.cost) : '-';
    button.appendChild(goldCost);

    bindActivatable(button, () => {
        if (!ready) {
            return;
        }
        improveAndSend(stack, route, targetCity, offer);
    });

    const mount = makeElement('div', `${IMPROVE_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_IMPROVE_AND_BUY',
        text: improveTooltip(route.leaderId, offer, site, targetCity, onTheWay),
    });
    return mount;
}

/** The stack for a route available NOW: the gold button, plus a locate or a cancel. */
function renderAvailableStack(stack, route, targetCity) {
    const site = siteFor(route, targetCity);
    const heading = merchantsBoundFor(targetCity);

    // ⚠️ Before the elements go. The frames are anchored to them; orphaned, they stay on
    // screen in the top-left corner. See `disposeFramedTooltips`.
    const scope = scopeForStack(stack);
    disposeFramedTooltips(scope);
    clearChildren(stack);
    // ⚠️ No price at all while a merchant is already walking here: a second one sent to a slot
    // the first will take is money thrown away.
    if (heading.length === 0) {
        stack.appendChild(priceRow(
            buildBuyButton(stack, route, targetCity, site, heading.length, scope),
            targetCity, heading.length, scope,
        ));
    }
    // The slot under the price holds one of the two, never both.
    const warning = capacityWarning(route, targetCity);
    if (heading.length > 0) {
        stack.appendChild(errandRow(heading[0], targetCity, scope));
    } else if (warning) {
        stack.appendChild(buildWarnButton(warning, scope));
    }
    stack.dataset.najaneGeneration = String(generation);
}

/** The stack for a route blocked by NOTHING but the trade limit. */
function renderImproveStack(stack, route, targetCity) {
    const site = siteFor(route, targetCity);
    const offer = improveOfferFor(route.leaderId);
    const heading = merchantsBoundFor(targetCity);

    const scope = scopeForStack(stack);
    disposeFramedTooltips(scope);
    clearChildren(stack);
    stack.appendChild(buildImproveButton(stack, route, targetCity, site, offer, heading.length, scope));
    // ⚠️ Its OWN ROW under the price, not beside it like the plus on an available card: this
    // button carries two prices and there is no width left on the title row.
    if (heading.length === 0 && offer && nearestIdleMerchant(targetCity)) {
        stack.appendChild(buildSendSpareImproveButton(stack, route, targetCity, offer, scope));
    }
    if (heading.length > 0) {
        stack.appendChild(errandRow(heading[0], targetCity, scope));
    }
    stack.dataset.najaneGeneration = String(generation);
}

/** Puts the buttons on the card, or brings the ones already there up to date. */
/**
 * Puts the stack at the END of the title row, and puts it back there on every pass - the row is
 * Solid's and a redraw discards whatever this mod added.
 */
function keepLast(head, stack) {
    if (head.lastElementChild !== stack) {
        head.appendChild(stack);
    }
}

export function decorateBuyMerchant(card, route, unavailableGroup = null) {
    // ⚠️ The TITLE ROW, not the portrait's corner - the portrait owns that.
    const head = card.querySelector(HEAD_SELECTOR);
    const mode = route?.startable ? 'available' : (unavailableGroup === 'limit' ? 'improve' : null);
    if (!head || !mode) {
        // A card in neither state keeps no stack - already running, out of range, or blocked
        // by something a treaty cannot fix (being at war, say).
        const stale = card.querySelector(`.${STACK_CLASS}`);
        if (stale) {
    // ⚠️ Disposed before it goes: a framed tooltip outliving its anchor draws in the corner.
            disposeFramedTooltips(scopeForStack(stale));
            stale.remove();
        }
        return;
    }

    const targetCity = Cities.get(route.targetCityId);
    if (!targetCity) {
        return;
    }
    const render = mode === 'available' ? renderAvailableStack : renderImproveStack;

    const existing = head.querySelector(`.${STACK_CLASS}`);
    if (existing) {
    // ⚠️ Both checked: the generation covers a price or an order changing, the mode covers the
    // card changing what kind of card it is.
        if (existing.dataset.najaneGeneration !== String(generation) || existing.dataset.najaneMode !== mode) {
            render(existing, route, targetCity);
            existing.dataset.najaneMode = mode;
        }
        keepLast(head, existing);
        return;
    }

    const stack = makeElement('div', STACK_CLASS);
    /*
     * ⚠️ THE CARD BENEATH MUST NOT SEE THESE PRESSES, and stopping the DOM click is not enough:
     * the card is an Activatable and reacts to the engine's `engine-input` action, which arrives
     * separately. Both have to be stopped.
     */
    stack.addEventListener('engine-input', (event) => event.stopPropagation());
    render(stack, route, targetCity);
    stack.dataset.najaneMode = mode;
    keepLast(head, stack);
}
