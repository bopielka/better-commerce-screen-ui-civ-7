/**
 * The stack of buttons in a trade route card's corner: buy a merchant, go and look at it - and
 * on a card blocked by nothing but the trade limit, propose the treaty that would open a slot
 * and buy the merchant anyway.
 *
 * A card in "Available trade routes" says a route is there for the taking, and then leaves
 * the player to close the screen, find a settlement, open its production list, buy a
 * merchant, find it on the map, walk it several turns, and remember what it was for. The gold
 * button is that sequence in one click:
 *
 *     buy a merchant in the settlement the route is measured from
 *     walk it to the other empire's settlement
 *     open the route the moment the engine will allow it       ← ui/engine/merchant-orders.js
 *
 * A card blocked ONLY by the trade limit gets a variant of the same button, showing an
 * Influence cost alongside the Gold one:
 *
 *     propose "Improve Trade Relations" with that leader     ← ui/engine/diplomacy.js
 *     buy a merchant and send it regardless of the answer
 *     open the route the moment a slot exists, whoever it came from
 *
 * ⚠️ THE TREATY CAN BE REFUSED. Proposing it is not the same as it taking effect - see the
 * file note in diplomacy.js. The merchant is sent anyway because it already knows how to wait
 * for an uncertain outcome: `merchant-orders.js` retries opening the route every turn on its
 * own, whether the slot comes from this treaty, a later one, or nothing this mod did at all.
 *
 * A locate button appears whenever a merchant is actually on either errand: it closes the
 * screen and takes the player to it, which is the one thing they cannot do from here and the
 * first thing they want once they wonder where it has got to.
 *
 * ⚠️ Nowhere else. On a card blocked by distance, or already running, the merchant would
 * arrive to nothing this mod can promise, so those cards keep no button at all rather than a
 * dark one - the reason is already written across them.
 *
 * ⚠️ Nothing here asks for confirmation, and that is deliberate: the game's own production
 * list buys with one click too, and the price is on the button before it is pressed. What
 * this must never do is buy WITHOUT the price being visible, which is why a button goes dark
 * rather than hidden when it cannot be afforded.
 *
 * Where it sits
 * -------------
 * Inside the card's top-right corner, the box holding the leader's portrait, which this mod
 * turns around (row-reverse) so an appended child lands to the LEFT of the portrait. The
 * buttons are stacked in a column there. The corner is Solid's and a redraw takes the stack
 * with it; the tab's observer puts it back, the same way as everything else this mod adds to
 * these cards.
 */
import ContextManager from '/core/ui/context-manager/context-manager.js';
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
    tradeCapacityWith,
} from '../engine/merchant.js';
import {
    merchantsBoundFor,
    merchantsBoundForPlayer,
    orderMerchantTo,
} from '../engine/merchant-orders.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { bindActivatable, clearChildren, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

export const BUY_CLASS = 'najane-trade-buy';

/** The column the two buttons live in; what the tab's teardown removes. */
export const BUY_STACK_CLASS = `${BUY_CLASS}-stack`;

const STACK_CLASS = BUY_STACK_CLASS;
const LOCATE_CLASS = `${BUY_CLASS}-locate`;
const WARN_CLASS = `${BUY_CLASS}-warn`;
const IMPROVE_CLASS = `${BUY_CLASS}-improve`;
/** Our mark on a leader portrait that has been wired to diplomacy. */
export const LEADER_LINK_CLASS = 'najane-trade-leader-link';

/** The corner of the card holding the leader portrait; see trade-routes.js. */
const LEADER_CORNER_SELECTOR = '.absolute.top-1.right-1';
const CARD_SELECTOR = '.trade-route-card';

/** The game's own map pin, the one the culture victory tab drops on the map. */
const LOCATE_ICON = 'blp:culture_pin_major';

/** The game's own attention mark; `misc-icons.xml`, ID "ATTENTION". */
const WARN_ICON = 'blp:fonticon_attention';

/**
 * Whose teardown owns these tooltips; the Trade Routes tab disposes its own and no others.
 *
 * ⚠️ One scope PER CARD, under the tab's own. The stack is rebuilt whenever the state changes,
 * and a framed tooltip left mounted around a discarded element floats off to the top-left
 * corner of the screen - which is what a click on the buy button did until this existed. The
 * tab's teardown passes the bare scope and takes every card's with it; see
 * `disposeFramedTooltips`.
 *
 * ⚠️ SERIAL PER STACK, NOT THE TARGET SETTLEMENT'S ID - which is what this used to key on, and
 * it was wrong. `projectPossibleTradeRoutes` returns one route PER PAIRING, so every settlement
 * of ours within reach of the same foreign settlement gets its own card, all of them naming the
 * SAME target. Keyed by that target they shared one scope, and a scope is a disposal bucket:
 * each card's rebuild called `disposeFramedTooltips` on the bucket and took its neighbours'
 * freshly mounted tooltips down with its own stale one. Only the last card rendered for a given
 * settlement kept a working tooltip; every earlier one went dead, which read on screen as "the
 * tooltips stopped working on that leader's cards" - one leader, because the several cards
 * pointing at one settlement are necessarily all that leader's.
 *
 * A serial also means a discarded stack's scope can never be reused, so a card Solid throws
 * away leaks its bucket until the tab's teardown sweeps the prefix - never onto a live card.
 */
const TOOLTIP_SCOPE = 'trade-routes';

let stackSerial = 0;

function scopeForStack(stack) {
    if (!stack.dataset.najaneScope) {
        stack.dataset.najaneScope = `${TOOLTIP_SCOPE}:${++stackSerial}`;
    }
    return stack.dataset.najaneScope;
}

/** The screen this sits on, by the name its frame is registered under. See ScreenFrame. */
const COMMERCE_PANEL_CONTEXT = 'screen-resource-allocation';

export const BUY_STYLE = `
/*
 * The portrait's corner, turned around so the buttons sit to its left. It is a flex-col of
 * two children, the second of which - the relationship plaque - this mod already hides, so
 * reversing the row costs nothing and needs no wrapper of our own.
 */
${CARD_SELECTOR} ${LEADER_CORNER_SELECTOR} {
    flex-direction: row-reverse;
    /* The buttons sit level with the middle of the portrait rather than hanging off its top. */
    align-items: center;
}
.${STACK_CLASS} {
    display: flex;
    flex-direction: column;
    /* Centred on each other: the price is wider than the pin, and a ragged edge showed it. */
    align-items: center;
    justify-content: center;
    margin-right: 0.4rem;
}
.${BUY_CLASS},
.${LOCATE_CLASS} {
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
.${LOCATE_CLASS} {
    margin-top: 0.25rem;
    padding: 0.15rem 0.3rem;
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
.${BUY_CLASS}:hover,
.${LOCATE_CLASS}:hover {
    border-color: #e5d2ac;
    background: rgba(37, 47, 66, 0.92);
}
.${BUY_CLASS}:focus,
.${LOCATE_CLASS}:focus {
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
.${LOCATE_CLASS}__icon {
    width: 1.35rem;
    height: 1.35rem;
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
.${LOCATE_CLASS} { color: #9fd7a0; border-color: rgba(159, 215, 160, 0.55); }
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
.${IMPROVE_CLASS}__icon {
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

/**
 * The purchase decision, cached for as long as the tab's route list is.
 *
 * ⚠️ Cached because `canStartQuery` is not cheap and the decorator runs from a
 * MutationObserver. Asking the engine what a merchant costs once per settlement per card per
 * DOM mutation is exactly the shape of the pass that used to cost this mod thirty seconds.
 */
const siteCache = new Map();

/**
 * Bumped whenever the answers go stale. A stack carries the generation it was built for, so a
 * decorate pass can tell "already there and still true" from "already there and wrong"
 * without asking the engine anything.
 */
let generation = 0;

/** Target settlements with a purchase in flight; see `buyAndSend`. */
const busyTargets = new Set();

/**
 * The "Improve Trade Relations" offer, cached per LEADER rather than per settlement - it is
 * the same proposal whichever of that leader's cities the card is about.
 *
 * ⚠️ Cleared on the same schedule as the merchant site cache and for the same reason: it
 * calls `canStart` under the hood, which is not free, and the decorator runs from a
 * MutationObserver.
 */
const tradeRelationsCache = new Map();

export function forgetMerchantOffers() {
    siteCache.clear();
    tradeRelationsCache.clear();
    // The prices themselves live one layer down, and the two go stale together.
    forgetEngineOffers();
    generation++;
}

/**
 * The prices are still good; what a merchant is DOING has changed.
 *
 * Used when an order is given, finished, or dropped because the merchant carrying it died -
 * see `MerchantOrdersChangedEventName`. Bumping the generation without clearing the caches
 * makes the next pass rebuild the buttons and ask the engine nothing.
 */
export function markMerchantStateStale() {
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

function goldIcon() {
    try {
        return UI.getIcon('YIELD_GOLD', 'YIELD');
    } catch (error) {
        return null;
    }
}

function influenceIcon() {
    try {
        return UI.getIcon('YIELD_DIPLOMACY', 'YIELD');
    } catch (error) {
        return null;
    }
}

/**
 * Whether a merchant bought now would find a trade slot when it arrives.
 *
 * ⚠️ Counted PER LEADER and including the merchants already walking. Capacity is a per-leader
 * figure, and the card's own status was decided by a projection made before anyone set off:
 * with one slot free and a merchant already on its way to one of Amina's cities, every other
 * card of hers still says "available" and would happily sell a second merchant into a slot
 * that is already spoken for.
 *
 * The card carrying the merchant that is already walking is not warned about - it is the one
 * that will get the slot - and its button is disabled anyway.
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

/**
 * Buys, waits for the unit, and files its standing order.
 *
 * ⚠️ Asynchronous from end to end, because `sendRequest` only queues: the merchant does not
 * exist in the same tick the purchase is sent. See `purchaseAndCollectMerchant`.
 *
 * ⚠️ The in-flight flag is kept per TARGET SETTLEMENT rather than on the button. The stack is
 * rebuilt from scratch whenever anything changes, so a flag living on the element would be
 * thrown away mid-purchase and let a second click through.
 */
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
    /*
     * ⚠️ Redrawn here, not left to the observer. A click is not a DOM mutation, so nothing
     * else wakes the observer up and the button would stay bright and clickable for as long
     * as the purchase took.
     */
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
 * Proposes "Improve Trade Relations" with the leader, then buys and sends a merchant anyway.
 *
 * ⚠️ The two steps are independent operations - a treaty proposal and a city purchase - and
 * neither waits on the other. The merchant does not need the treaty to have resolved to be
 * bought or to walk; it only needs it resolved to actually SIGN the route once it arrives,
 * which `merchant-orders.js` already retries on its own for as long as that takes. So this
 * fires the proposal, does not wait to see whether it is accepted, and goes straight on to
 * the purchase - waiting would only delay the one part of this that is not in question.
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
 * ⚠️ `ContextManager.pop` with the frame's own panel context, then the game's own
 * `RaiseDiplomacyEvent` on `window` - the diplomacy manager listens for it, so this needs no
 * import of the manager itself. The screen has to go first: the hub is an interface mode over
 * the map, not a panel that can open behind an open screen.
 */
function openDiplomacyWith(leaderId) {
    try {
        ContextManager.pop(COMMERCE_PANEL_CONTEXT);
    } catch (error) {
        warn(`could not close the Commerce screen: ${error}`);
    }
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

/**
 * The warning under the price: this leader has no slot left for what you are about to buy.
 *
 * ⚠️ It does not disable anything. Relations can change while a merchant walks, capacity can
 * be raised, and a player who wants to gamble on that is entitled to - the mod's job here is
 * to make sure the gamble is a choice rather than a surprise.
 *
 * Clicking it closes the screen and opens diplomacy with that leader, which is where the
 * capacity actually comes from.
 */
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
 * The warning under the price, turned into the fix it warns about: propose "Improve Trade
 * Relations" with this leader right from the card the warning is on, instead of only linking
 * to diplomacy and leaving the player to find the same action themselves there.
 *
 * ⚠️ Proposes the treaty ONLY - it never also buys a merchant. This card already has its own
 * gold button for that, immediately above; the two stay separate actions here because buying
 * is already on offer on this exact card, unlike the limit-blocked flow where nothing else on
 * the card can buy at all and the two have to be bundled into one click.
 *
 * ⚠️ Re-renders its own stack right after proposing, rather than waiting for the next decorate
 * pass - `proposeTradeRelations` is not async like a purchase, so there is nothing to wait
 * FOR; the price and readiness for a second attempt are already known.
 */
function buildWarnButton(stack, route, warning, targetCity, scope) {
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
            forgetMerchantOffers();
            renderAvailableStack(stack, route, targetCity);
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
    /*
     * One errand per settlement at a time. A second merchant bought while the first is still
     * walking is almost always a misread of the card - and if the first one drowns, the order
     * is dropped and this button comes back on its own; see `pruneOrders` in
     * ui/engine/merchant-orders.js.
     */
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
 * ⚠️ `ContextManager.pop` with the frame's own panel context - the same call the screen's
 * close button makes (`ScreenFrame`, the ContextManager close handler). Leaving the screen
 * open and moving the camera behind it is what the treasure cards already do, and the "?" on
 * that tab exists because players could not tell it had happened.
 */
function buildLocateButton(unit, targetCity, scope) {
    const button = makeElement('div', LOCATE_CLASS);
    const icon = makeElement('div', `${LOCATE_CLASS}__icon`);
    icon.style.backgroundImage = `url(${LOCATE_ICON})`;
    button.appendChild(icon);

    bindActivatable(button, () => {
        try {
            ContextManager.pop(COMMERCE_PANEL_CONTEXT);
        } catch (error) {
            warn(`could not close the Commerce screen: ${error}`);
        }
        focusUnitOnMap(unit);
    });

    const mount = makeElement('div', `${LOCATE_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: 'LOC_NAJANE_COMMERCE_SHOW_MERCHANT',
        text: Locale.compose('LOC_NAJANE_COMMERCE_SHOW_MERCHANT_TOOLTIP'),
    });
    return mount;
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

/**
 * Fills the stack for a route that is available NOW: the gold button, and a locate or a
 * capacity warning underneath it.
 *
 * ⚠️ Rebuilt rather than patched. The tooltips are the game's framed ones, which are Solid
 * components built around the button when it is created - there is no "set the text" on one.
 * A rebuild is cheap and only happens when the generation says something changed.
 */
function renderAvailableStack(stack, route, targetCity) {
    const site = siteFor(route, targetCity);
    const heading = merchantsBoundFor(targetCity);

    // ⚠️ Before the elements go. The frames are anchored to them; orphaned, they stay on
    // screen in the top-left corner. See `disposeFramedTooltips`.
    const scope = scopeForStack(stack);
    disposeFramedTooltips(scope);
    clearChildren(stack);
    stack.appendChild(buildBuyButton(stack, route, targetCity, site, heading.length, scope));
    /*
     * The slot under the price holds whichever of the two applies, and never both: a warning
     * is only raised when no merchant of ours is walking to this settlement, which is exactly
     * when there is nothing to fly the camera to.
     */
    const warning = capacityWarning(route, targetCity);
    if (heading.length > 0) {
        stack.appendChild(buildLocateButton(heading[0], targetCity, scope));
    } else if (warning) {
        stack.appendChild(buildWarnButton(stack, route, warning, targetCity, scope));
    }
    stack.dataset.najaneGeneration = String(generation);
}

/**
 * Fills the stack for a route blocked by NOTHING but the trade limit: the propose-and-buy
 * button, and a locate button underneath it once a merchant is actually walking - which can
 * happen here too, on the rare turn a slot opens up and closes again before the projection
 * catches up. See the file note for why there is no warning variant here: the warning exists
 * to catch a SECOND purchase on a card that still reads as open; a limit-blocked card never
 * reads that way to begin with.
 */
function renderImproveStack(stack, route, targetCity) {
    const site = siteFor(route, targetCity);
    const offer = improveOfferFor(route.leaderId);
    const heading = merchantsBoundFor(targetCity);

    const scope = scopeForStack(stack);
    disposeFramedTooltips(scope);
    clearChildren(stack);
    stack.appendChild(buildImproveButton(stack, route, targetCity, site, offer, heading.length, scope));
    if (heading.length > 0) {
        stack.appendChild(buildLocateButton(heading[0], targetCity, scope));
    }
    stack.dataset.najaneGeneration = String(generation);
}

/**
 * Puts the buttons in the card's corner, or brings the ones already there up to date.
 *
 * @param card            the `.trade-route-card` element
 * @param route           the entry this mod keeps for it - see `routeInfo()` in trade-routes.js
 * @param unavailableGroup 'limit' | 'range' | null - which reason the route is unavailable
 *                         for, from `unavailableGroupFor` in trade-routes.js. Only that module
 *                         has the route's full status list; this is handed the answer rather
 *                         than a second copy of the question.
 */
export function decorateBuyMerchant(card, route, unavailableGroup = null) {
    const corner = card.querySelector(LEADER_CORNER_SELECTOR);
    const mode = route?.startable ? 'available' : (unavailableGroup === 'limit' ? 'improve' : null);
    if (!corner || !mode) {
        // A card in neither state keeps no stack - already running, out of range, or blocked
        // by something a treaty cannot fix (being at war, say).
        const stale = corner?.querySelector(`.${STACK_CLASS}`);
        if (stale) {
            // ⚠️ Disposed before it goes, like every other place a stack is discarded. A
            // framed tooltip outliving the element it is anchored to is what draws an empty
            // frame in the top-left corner; see `disposeFramedTooltips`.
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

    const existing = corner.querySelector(`.${STACK_CLASS}`);
    if (existing) {
        /*
         * ⚠️ Both checked. The generation covers a price or an order changing; the mode
         * covers the route ITSELF changing state, which normally comes with Solid rebuilding
         * the card from scratch (a fresh element, no stale stack to find here at all) - this
         * is the belt for the rare pass where it does not.
         */
        if (existing.dataset.najaneGeneration !== String(generation) || existing.dataset.najaneMode !== mode) {
            render(existing, route, targetCity);
            existing.dataset.najaneMode = mode;
        }
        return;
    }

    const stack = makeElement('div', STACK_CLASS);
    render(stack, route, targetCity);
    stack.dataset.najaneMode = mode;
    // ⚠️ Appended, not inserted: the corner is turned around in CSS, so the last child is
    // the leftmost one on screen. Inserting first would put the stack under the portrait.
    corner.appendChild(stack);
}
