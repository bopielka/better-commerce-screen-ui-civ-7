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
    hasProposedThisTurn,
    influenceBalance,
    proposeTradeRelations,
    relationshipBlocksTrade,
    requiredRelationshipIcon,
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
    merchantsOrderedTo,
    nearestIdleMerchant,
    orderMerchantTo,
} from '../engine/merchant-orders.js';
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { forgetLeaderHover, noteLeaderHover } from './relationship-trade-footer.js';
import {
    cancelTradeAction,
    isTradeActionQueued,
    queueTradeAction,
} from '../engine/trade-queue.js';
import { ICON_BUTTON_CLASS, ICON_BUTTON_STYLE, makeIconButton } from './icon-button.js';
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
/** The same, for the queued hourglass and the X that cancels it. */
const QUEUE_ROW_CLASS = `${BUY_CLASS}-queue-row`;

/**
 * The amber a waiting mark is lit in.
 * ⚠️ Better City UI's own `.najane-city-wait-on` colour (user's instruction, 2026-09-10), so one
 * hourglass means one thing across both mods.
 */
const QUEUED_COLOUR = '#f6ce55';

/**
 * How every hourglass in this file is tinted.
 *
 * ⚠️ ONE FILTER, STATED ONCE (user's instruction, 2026-09-10). It was written three times - white
 * on the gold button, white on the limit button, amber once queued - so the same mark meant
 * "later" in two different colours depending on which control it sat in. The game's art is grey;
 * `fxs-color-tint` is the engine's own filter for recolouring icon art.
 */
const WAIT_ICON_FILTER = `fxs-color-tint(${QUEUED_COLOUR})`;

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
 * The game's own plain hourglass, and the same one Better City UI puts on a purchase that has to
 * wait (user's instruction, 2026-09-10).
 *
 * ⚠️ NOT `hud_turn-timer`: that mark means "turns" elsewhere on this screen, and one icon saying
 * two things is worse than an extra icon.
 */
const WAIT_ICON = 'fs://game/HourGlass.png';

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
/*
 * ⚠️ ONE RULE FOR BOTH, and that is the point: the two buttons make the same offer - "raise the
 * limit and send the merchant you already have" - so the mark that identifies that offer may not
 * be stated twice and drift apart, which is what happened to its colour and size once already.
 */
.${SEND_WIDE_CLASS}__plus,
.${WARN_CLASS}__plus {
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
/*
 * The hourglass. Flattened and tinted the same three-step way the cancel mark is - the game's
 * art is pale and would read as disabled against the amber frame.
 *
 * ⚠️ SMALLER THAN THE BOX IT SHARES WITH THE INFLUENCE MARK, and for the same reason as the dock
 * button's own icon: the game's yield marks are drawn with a margin baked into the artwork, while
 * "HourGlass.png" fills its image edge to edge - so at the shared "contain" it came out visibly
 * larger than the globe beside it. The box keeps its size; only the artwork inside shrinks, so
 * the two marks stay on the same baseline.
 */
.${WARN_CLASS}__icon.${WARN_CLASS}__wait-icon {
    filter: ${WAIT_ICON_FILTER};
    /*
     * ⚠️ WRITTEN AS A COMPOUND SELECTOR, and that is what makes it apply at all. The element wears
     * both classes; at one class each, the two rules tie on specificity and the LATER one wins -
     * and ".__icon", with its "background-size: contain", is the later one. Stated as a single
     * class this rule was simply overruled and the hourglass never shrank.
     */
    background-size: 74%;
}
/*
 * Already queued: lit, so the card says at a glance that the mark has been made.
 *
 * ⚠️ THE SAME AMBER BETTER CITY UI LIGHTS ITS OWN HOURGLASS WITH (user's instruction,
 * 2026-09-10) - border, wash and icon tint all taken from ".najane-city-wait-on" there, so the
 * two mods say "queued" in one colour rather than two.
 *
 * ⚠️ NOT green: green belongs to the plus, which acts NOW. An amber mark is a thing waiting.
 */
.${WARN_CLASS}--queued {
    border-color: ${QUEUED_COLOUR};
    background: rgba(246, 206, 85, 0.28);
}
.${WARN_CLASS}--queued:hover { border-color: ${QUEUED_COLOUR}; }
.${WARN_CLASS}--queued .${WARN_CLASS}__icon.${WARN_CLASS}__wait-icon {
    filter: ${WAIT_ICON_FILTER};
}
/* Queued, and there is nothing left to press: the X beside it is what undoes it. */
.${WARN_CLASS}--queued { cursor: default; }
/*
 * The hourglass and its cancel mark side by side; same arrangement as the errand row.
 *
 * ⚠️ LEVELLED BY STRETCHING, NOT BY A NUMBER. The two are built by different means - the
 * hourglass is a priced button sized by its content, the X is a fixed-size icon button - and they
 * came out different heights. Working out the taller one by hand would mean adding up a padding
 * and a border that this engine does not treat as "border-box" reliably, and pinning the result
 * would drift the moment either side changed. So the row stretches and the icon button gives up
 * its fixed height for this one placement: whichever is taller sets the row, which is what
 * "match the bigger one" actually means.
 */
.${QUEUE_ROW_CLASS} {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: flex-end;
    /*
     * ⚠️ THE SPACING MOVES UP TO THE ROW, and the hourglass gives up its own. Its "margin-top"
     * sits INSIDE the flex line, so the row came out that much taller than the button - and the X,
     * stretching to the row, ended up taller than the thing it stands beside. Carried here, the
     * row is exactly as tall as the hourglass and the X matches it.
     */
    margin-top: 0.25rem;
}
.${QUEUE_ROW_CLASS} .${WARN_CLASS} {
    margin-top: 0;
}
/*
 * Air between the three marks. The hourglass carries a price and reads as a block; without a gap
 * the pin sat flush against it and the two read as one wide control.
 *
 * ⚠️ On every child AFTER the first rather than as a gap on the row, because the row's children
 * are mounts of different kinds - a priced button and two framed-tooltip wrappers - and only the
 * spacing between them is wanted, never before the first or after the last.
 */
.${QUEUE_ROW_CLASS} > * + * {
    margin-left: 0.3rem;
}
.${QUEUE_ROW_CLASS} .${ICON_BUTTON_CLASS} {
    height: auto;
    align-self: stretch;
}
/* The mount is the flex item; the button only fills what the mount is given. */
.${QUEUE_ROW_CLASS} .${ICON_BUTTON_CLASS}-mount {
    align-items: stretch;
}
/*
 * The map pin, brought in to match the marks around it.
 *
 * ⚠️ TWO CLASSES DEEP ON PURPOSE. ".__icon" carries "background-size: contain" and a rule at one
 * class would tie with it on specificity and lose to whichever comes later in the sheet - exactly
 * how the hourglass rule was silently overruled. Same reason the artwork needs shrinking at all:
 * the game's own marks carry a margin inside the image, this one fills it edge to edge.
 */
.${LOCATE_CLASS} .${ICON_BUTTON_CLASS}__icon {
    background-size: 78%;
}
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
 * The hourglass INSIDE the gold button, on a card whose only obstacle is the money.
 *
 * ⚠️ ONE BUTTON, NOT TWO (user's instruction, 2026-09-10). "Buy it now" and "buy it when you can"
 * are two readings of the same price; a second control beside it read as a second cost.
 *
 * ⚠️ Same shrink as everywhere else this artwork is used: the game's own marks carry a margin
 * inside the image and "HourGlass.png" fills it edge to edge, so at the shared "contain" it comes
 * out larger than the gold coin beside it. Stated as a compound selector because ".__icon" sets
 * "background-size" too and the two would otherwise tie on specificity.
 */
.${BUY_CLASS}__icon.${BUY_CLASS}__wait-icon {
    margin-right: 0;
    margin-left: 0.35rem;
    background-size: 74%;
    filter: ${WAIT_ICON_FILTER};
}
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
/* ⚠️ Compound selector: ".__icon" sets background-size too, and one class each would tie. */
.${IMPROVE_CLASS}__icon.${IMPROVE_CLASS}__wait-icon {
    margin-left: 0.35rem;
    background-size: 74%;
    filter: ${WAIT_ICON_FILTER};
}
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

/**
 * Whether the treaty that would open a trade slot could be proposed LATER, if not now.
 *
 * ⚠️ THE DIFFERENCE BETWEEN "NOT YET" AND "NOT EVER", and the card must not offer to wait for the
 * second. Two refusals clear with the turn - the Influence is short, or this mod has already
 * proposed to this leader this turn. Anything else is structural: hostile relations, or war. No
 * number of turns fixes those, and a route so blocked is not one to plan (user's instruction,
 * 2026-09-10).
 *
 * ⚠️ Derived from what the engine already answers rather than from a relationship threshold. The
 * hostile band is `-30..-2` in `diplomacy-actions.xml`, and pinning that number here would be a
 * balance constant this mod has no business carrying.
 */
function treatyCanComeLater(leaderId, offer) {
    if (!offer) {
        return false;
    }
    /*
     * ⚠️ ASKED FIRST, AND THAT ORDER IS THE FIX. "Short of Influence" was tested before this and
     * answered yes on its own - so a hostile pairing that the player also could not afford came out
     * as "wait and it will happen", and the route was lifted into the available section. Hostility
     * is not a price; it has to rule the answer out before any price is considered.
     */
    if (relationshipBlocksTrade(leaderId)) {
        return false;
    }
    if (offer.canStart) {
        return true;
    }
    return offer.cost > influenceBalance() || hasProposedThisTurn(leaderId);
}

/**
 * Whether the trade limit with this leader could be raised at all, now or later.
 *
 * ⚠️ Exported for the SECTION pass: a route held back only by the limit belongs among the
 * available ones because it is a decision - but not while the two are hostile, when the limit is
 * simply shut. See `liftLimitBlocked` in trade-routes.js.
 */
export function canRaiseLimitLater(leaderId) {
    return treatyCanComeLater(leaderId, improveOfferFor(leaderId));
}

/**
 * The engine's refusal, with the relationship icon in front of it where relations are the refusal.
 *
 * ⚠️ ONLY THERE. The reasons list also carries "you cannot afford it" and the like, and a
 * relationship mark in front of those would name the wrong obstacle.
 */
function refusalText(leaderId, offer) {
    const reason = offer?.reasons?.join(' ') ?? '';
    if (!reason || !relationshipBlocksTrade(leaderId)) {
        return reason;
    }
    /*
     * ⚠️ AFTER the sentence, not before it (user's instruction, 2026-09-10). The line NAMES the
     * level it wants and the mark belongs to that name; in front it read as a bullet on the whole
     * sentence. Appended rather than spliced in beside the word: the sentence is the game's own and
     * is worded differently in every language, so there is no position inside it to aim at.
     */
    const icon = requiredRelationshipIcon().trim();
    return icon ? `${reason} ${icon}` : reason;
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
    log(() => `${Locale.compose(site.offer.definition.Name)} bought in `
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
            log(() => `proposed Improve Trade Relations with ${leaderName(route.leaderId)}`);
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
    /*
     * ⚠️ The relationship tooltip carries no leader in its DOM, and it is portalled out of this
     * screen entirely - so which leader it is about can only be learned on the way in. See
     * screen/relationship-trade-footer.js.
     */
    portrait.addEventListener('mouseenter', () => noteLeaderHover(leaderId));
    portrait.addEventListener('mouseleave', forgetLeaderHover);
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
function warnActionText(warning, offer, targetCity = null) {
    const leader = leaderName(warning.leaderId);
    if (offer?.canStart && offer.cost <= influenceBalance()) {
        // ⚠️ The sentence has to match the MARK on the button: a green plus promises a merchant
        // is sent, so where one will be, the tooltip is the one that says so. Same string the
        // limit-blocked card's own send button uses - it is the same offer.
        return targetCity && nearestIdleMerchant(targetCity)
            ? Locale.compose(
                'LOC_NAJANE_COMMERCE_SEND_SPARE_IMPROVE_TOOLTIP',
                leader,
                offer.cost,
                Locale.compose(targetCity.name ?? ''),
            )
            : Locale.compose('LOC_NAJANE_COMMERCE_TRADE_FULL_PROPOSE', leader, offer.cost);
    }
    const openLine = Locale.compose('LOC_NAJANE_COMMERCE_TRADE_FULL_OPEN', leader);
    if (!offer) {
        return openLine;
    }
    if (!offer.canStart) {
        const reason = refusalText(warning.leaderId, offer);
        return reason ? `${reason}[N]${openLine}` : openLine;
    }
    // canStart, but Influence is short.
    return `${Locale.compose('LOC_NAJANE_COMMERCE_IMPROVE_FUNDS', offer.cost, Math.floor(influenceBalance()))}[N]${openLine}`;
}

/**
 * The warning turned into the fix it warns about: propose "Improve Trade Relations" from the
 * card, without leaving the screen - and, where there is one standing idle, send the merchant
 * into the slot the treaty opens.
 *
 * ⚠️ THE MARK STATES WHICH OF THE TWO IT IS. A green plus is a promise to SEND something, so it
 * is drawn only where both halves are actually on offer - a treaty that can be afforded and a
 * spare merchant to send. Everything else keeps the attention mark, because then the button
 * really is only a warning with a proposal behind it.
 *
 * ⚠️ It goes dark once used - the proposal can only be made once per turn per leader, and a
 * button that stayed bright and priced made the feature look broken.
 */
/**
 * What the hourglass promises, in the order the pass will actually try it: the treaty, then a
 * spare merchant, then a bought one.
 *
 * ⚠️ The GOLD price is named only where a merchant would have to be bought. Naming it while a
 * spare is standing idle would promise a cost the pass will not pay.
 */
function queueActionText(leaderId, offer, targetCity, site, queued, limitBlocked) {
    const city = Locale.compose(targetCity?.name ?? '');
    if (queued) {
        // ⚠️ Says only what is waiting. What UNDOES it is the X beside it, and that button's own
        // tooltip is where "click to cancel" belongs.
        return Locale.compose('LOC_NAJANE_COMMERCE_QUEUE_WAITING_TOOLTIP', city);
    }
    /*
     * ⚠️ THE TREATY IS NAMED ONLY WHERE THE LIMIT IS WHAT BLOCKS IT. With a slot already free the
     * plan is nothing but "buy a merchant and send it", and promising a treaty - with a price
     * attached - would be an Influence cost the pass will never pay.
     */
    if (!limitBlocked) {
        return Locale.compose(
            'LOC_NAJANE_COMMERCE_QUEUE_TOOLTIP_MERCHANT',
            site?.offer?.cost ?? 0,
            city,
        );
    }
    const leader = leaderName(leaderId);
    const cost = offer?.cost ?? 0;
    if (nearestIdleMerchant(targetCity)) {
        return Locale.compose('LOC_NAJANE_COMMERCE_QUEUE_TOOLTIP_SPARE', leader, cost, city);
    }
    return site?.offer
        ? Locale.compose('LOC_NAJANE_COMMERCE_QUEUE_TOOLTIP_BUY', leader, cost, site.offer.cost, city)
        : Locale.compose('LOC_NAJANE_COMMERCE_QUEUE_TOOLTIP_SPARE', leader, cost, city);
}

/**
 * @param leaderId whose limit this is about - passed separately because `warning` is absent on a
 *        card that is queued but no longer short of a slot.
 */
function buildWarnButton(leaderId, warning, targetCity, site, limitBlocked, scope) {
    const offer = improveOfferFor(leaderId);
    const ready = Boolean(offer?.canStart) && offer.cost <= influenceBalance();
    // ⚠️ Asked whatever `ready` says: with no merchant to send, the button is a PLAN rather than an
    // action, and that is decided below on this very answer.
    const spare = nearestIdleMerchant(targetCity);
    // ⚠️ Asked of the SETTLEMENT, not the leader: the request is "send one THERE", and asked of
    // the leader it lit the button on every card that leader owns.
    const queued = isTradeActionQueued(targetCity);

    /*
     * THE TWO THINGS THAT CAN BE IN THE WAY, named separately because the card reads differently
     * for each: the trade limit, and simply having no merchant to send.
     */
    const canGetMerchantNow = Boolean(spare) || Boolean(site?.offer?.canBuy);

    /*
     * ⚠️ NOTHING TO ADD, and returning null is the honest answer. The route can be started on this
     * click - the price row and the plus beside it already offer exactly that - so a third control
     * here would be a second way to say the same thing.
     */
    if (!queued && !limitBlocked && canGetMerchantNow) {
        return null;
    }

    /*
     * ⚠️ ANYTHING THAT CANNOT BE FINISHED ON THIS CLICK BUT COULD BE FINISHED LATER IS A WAIT,
     * not a refusal - so the button offers to do it then (engine/trade-queue.js). Three ways in,
     * and the last two were both missed at different times:
     *   - the treaty cannot be proposed yet (already proposed this turn, or Influence short);
     *   - the treaty is affordable but every merchant is spoken for;
     *   - the limit is fine and the only thing missing is a merchant and the gold for one.
     *
     * ⚠️ Where the LIMIT is what blocks it, an offer that does not EXIST is still only a warning:
     * at war, or a pairing the action does not apply to, no amount of waiting helps and the
     * fallback is diplomacy.
     */
    const canWait = limitBlocked
        ? (treatyCanComeLater(leaderId, offer) && (!ready || !spare))
        : true;

    const button = makeElement('div', WARN_CLASS);
    button.classList.toggle(`${WARN_CLASS}--blocked`, !ready && !canWait);
    button.classList.toggle(`${WARN_CLASS}--queued`, queued);

    if (limitBlocked && spare && ready) {
        const plus = makeElement('div', `${WARN_CLASS}__plus`);
        plus.textContent = '+';
        button.appendChild(plus);
    } else if (canWait) {
        const icon = makeElement('div', `${WARN_CLASS}__icon ${WARN_CLASS}__wait-icon`);
        icon.style.backgroundImage = `url(${WAIT_ICON})`;
        button.appendChild(icon);
    } else {
        const icon = makeElement('div', `${WARN_CLASS}__icon`);
        icon.style.backgroundImage = `url(${WARN_ICON})`;
        button.appendChild(icon);
    }

    /*
     * ⚠️ THE INFLUENCE PRICE ONLY WHERE THE TREATY WILL BE PROPOSED. With a trade slot standing
     * free the plan never touches diplomacy, and a cost printed on the button is a bill the pass
     * will not send - "0/2 routes used" beside "110 Influence" is simply wrong.
     */
    if (offer && limitBlocked) {
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
        /*
         * The waiting states first: this button is the one control for them, so the same press
         * both files the request and takes it back. Nothing here spends anything - the spending
         * happens when the turn turns, and both prices are on the button before it is pressed.
         */
        if (canWait) {
            /*
             * ⚠️ A SECOND PRESS DOES NOTHING, deliberately (user's instruction, 2026-09-10). It
             * used to toggle, which made one control mean "do it" and "undo it" depending on a
             * state the player had to read off the border first. The X beside it undoes it.
             */
            if (!queued) {
                queueTradeAction(targetCity);
            }
            // `queueTradeAction` announces; the tab redraws off that.
            return;
        }
        if (ready && proposeTradeRelations(leaderId, offer)) {
            log(() => `proposed Improve Trade Relations with ${leaderName(leaderId)}`);
            /*
             * ⚠️ Re-asked at the click, and `mayMove: false`. The merchant may have been given
             * something else to do while the screen sat open; and `sendRequest` only QUEUES, so
             * for a moment the engine still reports the old limit and refuses the route - which a
             * merchant with movement in hand reads as "too far" and walks off for nothing. The
             * order is retried when the turn begins, by which time the treaty has resolved.
             */
            const live = nearestIdleMerchant(targetCity);
            if (live && orderMerchantTo(live, targetCity, { mayMove: false })) {
                log(() => `a spare merchant will open the route to ${Locale.compose(targetCity.name ?? '')} once the limit rises`);
            }
            // Prices, the offer itself and the capacity behind the warning all moved; the
            // generation bump inside this is what makes the redraw below rebuild the stacks.
            forgetMerchantOffers();
            announceTradeCapacityChange();
            return;
        }
        // Not ready, or the fresh canStart inside proposeTradeRelations disagreed with the
        // cached offer this button was drawn from - either way, the fallback this button has
        // always offered.
        openDiplomacyWith(leaderId);
    });

    const mount = makeElement('div', `${WARN_CLASS}-mount`);
    const waitTitle = queued ? 'LOC_NAJANE_COMMERCE_QUEUE_WAITING' : 'LOC_NAJANE_COMMERCE_QUEUE';
    appendWithFramedTooltip(mount, button, {
        scope,
        title: canWait ? waitTitle : 'LOC_NAJANE_COMMERCE_TRADE_FULL',
        text: canWait
            /*
             * ⚠️ The capacity sentence only where there IS a warning. A card queued after the slot
             * came free still shows the hourglass - the request is still waiting on Influence -
             * and telling the player their limit is full would be a plain lie.
             */
            ? [warning ? warningText(warning) : '',
                queueActionText(leaderId, offer, targetCity, site, queued, limitBlocked)]
                .filter(Boolean).join('[N][N]')
            : `${warningText(warning)}[N][N]${warnActionText(warning, offer, targetCity)}`,
    });
    return mount;
}

/**
 * @param canPlan whether pressing this while it is unaffordable should QUEUE the purchase instead
 *        of doing nothing - see `renderAvailableStack`.
 */
function buildBuyButton(stack, route, targetCity, site, onTheWay, canPlan, scope) {
    const busy = busyTargets.has(cityKey(targetCity));
    const ready = Boolean(site?.offer?.canBuy) && onTheWay === 0 && !busy;
    /*
     * ⚠️ ONLY THE FUNDS. Everything else the engine refuses a purchase for - a settlement in
     * unrest, an age that does not field merchants yet - is not something waiting fixes, and an
     * hourglass on those would promise a turn that never comes.
     */
    const waitingForGold = canPlan && !ready && !busy && onTheWay === 0
        && Boolean(site?.offer?.insufficientFunds);


    const button = makeElement('div', BUY_CLASS);
    /*
     * ⚠️ FULLY LIT WHILE IT ANSWERS A CLICK (user's instruction, 2026-09-10). `--blocked` is the
     * "nothing to press" look; wearing any part of it while the hourglass invites a press gives a
     * control that reads as disabled and is not. Dimming only the price was still wrong - it made
     * this one number pale where every other card shows it in the same amber.
     */
/** One errand per settlement at a time; a second merchant would arrive to a spent slot. */
    button.classList.toggle(`${BUY_CLASS}--blocked`, !ready && !waitingForGold);
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

    if (waitingForGold) {
        const wait = makeElement('div', `${BUY_CLASS}__icon ${BUY_CLASS}__wait-icon`);
        wait.style.backgroundImage = `url(${WAIT_ICON})`;
        button.appendChild(wait);
    }

    bindActivatable(button, () => {
        if (ready) {
            buyAndSend(stack, route, targetCity);
            return;
        }
        if (waitingForGold) {
            queueTradeAction(targetCity);
        }
    });

    const mount = makeElement('div', `${BUY_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        /*
         * ⚠️ The card is never QUEUED here - a queued card draws no price row at all, and its
         * hourglass lives on the errand row with the X that cancels it. So this is only ever the
         * offer, never the "already waiting" state.
         */
        title: waitingForGold ? 'LOC_NAJANE_COMMERCE_QUEUE' : 'LOC_NAJANE_COMMERCE_BUY_MERCHANT',
        text: waitingForGold
            ? queueActionText(route.leaderId, null, targetCity, site, false, false)
            : buyTooltip(site, targetCity, onTheWay, capacityWarning(route, targetCity)),
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
            log(() => `sent a spare merchant to ${Locale.compose(targetCity.name ?? '')}`);
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
            log(() => `called a merchant off its errand to ${Locale.compose(targetCity.name ?? '')}`);
            // `clearMerchantOrder` announces the change; the tab redraws every card off that.
            markMerchantStateStale();
        },
    });
}

/**
 * Calls off a queued request. The same mark, the same tint and the same shape as the X that calls
 * a merchant off its errand (user's instruction, 2026-09-10) - it undoes the same kind of thing.
 */
function buildCancelQueueButton(targetCity, scope) {
    return makeIconButton({
        icon: CANCEL_ICON,
        tint: 'grayscale(1) brightness(1.7) fxs-color-tint(#e0564a)',
        title: 'LOC_NAJANE_COMMERCE_QUEUE_CANCEL',
        text: Locale.compose('LOC_NAJANE_COMMERCE_QUEUE_CANCEL_TOOLTIP', Locale.compose(targetCity.name ?? '')),
        scope,
        className: CANCEL_CLASS,
        onActivate: () => {
            cancelTradeAction(targetCity);
            log(() => `cancelled the queued trade action for ${Locale.compose(targetCity.name ?? '')}`);
            // `cancelTradeAction` announces; the tab redraws every card off that.
        },
    });
}

/** The waiting hourglass, the pin that finds its merchant, and the X that calls it off. */
function queueRow(leaderId, warning, targetCity, site, limitBlocked, scope) {
    const row = makeElement('div', QUEUE_ROW_CLASS);
    // ⚠️ Never null here: the request IS queued, and `buildWarnButton` only declines on a card
    // that has nothing waiting on it.
    row.appendChild(buildWarnButton(leaderId, warning, targetCity, site, limitBlocked, scope));
    /*
     * ⚠️ `merchantsOrderedTo`, NOT `merchantsBoundFor`. A queued request sends its merchant on the
     * first turn and only proposes the treaty once the Influence is there, so the merchant is
     * often standing AT the target waiting for the limit to rise - not travelling, and invisible
     * to the question the errand row asks. It is still the merchant the player wants to find.
     */
    const sent = merchantsOrderedTo(targetCity)[0];
    if (sent) {
        row.appendChild(buildLocateButton(sent, targetCity, scope));
    }
    row.appendChild(buildCancelQueueButton(targetCity, scope));
    return row;
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
            log(() => `proposed Improve Trade Relations with ${leaderName(route.leaderId)}`);
            announceTradeCapacityChange();
        }
        /*
         * ⚠️ `mayMove: false`. `sendRequest` only QUEUES, so for a moment afterwards the engine
         * still reports the old trade capacity and refuses the route - and a merchant with movement
         * reads that refusal as "too far" and walks off for a journey the treaty was about to make
         * unnecessary. Standing still costs nothing; the order is retried every turn.
         */
        if (orderMerchantTo(live, targetCity, { mayMove: false })) {
            log(() => `a spare merchant will open the route to ${Locale.compose(targetCity.name ?? '')} once the limit rises`);
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
function priceRow(priceMount, targetCity, heading, warning, extra, scope) {
    /*
     * One errand per settlement: a card already waiting on a merchant is not asking for another.
     *
     * ⚠️ AND NONE AT ALL WHERE THE SLOT IS ALREADY SPOKEN FOR. The limit is counted per LEADER,
     * so "one route possible, one merchant on the way" leaves nothing to send a second merchant
     * into - and offering it anyway sent one across the map for a slot it could never have. That
     * is exactly what `capacityWarning` already measures; the plus now answers to it too.
     */
    const spare = heading > 0 || warning ? null : nearestIdleMerchant(targetCity);
    if (!spare && !extra) {
        return priceMount;
    }
    const row = makeElement('div', PRICE_ROW_CLASS);
    row.appendChild(priceMount);
    if (spare) {
        row.appendChild(buildSendSpareButton(targetCity, spare, scope));
    }
    /*
     * ⚠️ BESIDE THE GOLD, not on a row of its own (user's instruction, 2026-09-10). Where the only
     * thing missing is the money, "buy it now" and "buy it when you can" are two readings of the
     * same price and belong on the same line.
     */
    if (extra) {
        row.appendChild(extra);
    }
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
        const reason = refusalText(leaderId, offer)
            || Locale.compose('LOC_NAJANE_COMMERCE_BUY_MERCHANT_BLOCKED');
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

/**
 * ⚠️ ONE BUTTON, WITH OR WITHOUT THE HOURGLASS (user's instruction, 2026-09-10) - the same rule the
 * gold button follows. It carries both prices; a second control beside it carrying one of them
 * again read as a third cost.
 */
function buildImproveButton(stack, route, targetCity, site, offer, onTheWay, scope) {
    const busy = busyTargets.has(cityKey(targetCity));
    const ready = Boolean(offer?.canStart) && offer.cost <= influenceBalance()
        && Boolean(site?.offer?.canBuy) && onTheWay === 0 && !busy;
    /*
     * ⚠️ WAITING, NOT REFUSED, wherever the offer EXISTS but one of the two prices is out of reach
     * this turn - or every merchant is spoken for. All of those change when the turn does, and the
     * queue does the whole errand: merchant first, treaty when the Influence is there.
     */
    const canWait = !ready && !busy && onTheWay === 0
        && treatyCanComeLater(route.leaderId, offer)
        && (Boolean(site?.offer) || Boolean(nearestIdleMerchant(targetCity)));

    const button = makeElement('div', IMPROVE_CLASS);
    // ⚠️ Fully lit while it answers a click; see the same note on the gold button.
    button.classList.toggle(`${IMPROVE_CLASS}--blocked`, !ready && !canWait);
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

    if (canWait) {
        const wait = makeElement('div', `${IMPROVE_CLASS}__icon ${IMPROVE_CLASS}__wait-icon`);
        wait.style.backgroundImage = `url(${WAIT_ICON})`;
        button.appendChild(wait);
    }

    bindActivatable(button, () => {
        if (ready) {
            improveAndSend(stack, route, targetCity, offer);
            return;
        }
        if (canWait) {
            queueTradeAction(targetCity);
        }
    });

    const mount = makeElement('div', `${IMPROVE_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, {
        scope,
        title: canWait ? 'LOC_NAJANE_COMMERCE_QUEUE' : 'LOC_NAJANE_COMMERCE_IMPROVE_AND_BUY',
        text: canWait
            ? queueActionText(route.leaderId, offer, targetCity, site, false, true)
            : improveTooltip(route.leaderId, offer, site, targetCity, onTheWay),
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
    // ⚠️ Read BEFORE the price row, not after it: the plus in that row is now suppressed by the
    // very same warning, so the two cannot be worked out in the other order.
    const warning = capacityWarning(route, targetCity);
    // ⚠️ And a queued card offers no price either: the request already has a merchant, or is about
    // to buy one, so a second bought here would be money spent on a slot that is spoken for.
    const queued = isTradeActionQueued(targetCity);
    /*
     * ⚠️ No price at all while a merchant is already walking here: a second one sent to a slot the
     * first will take is money thrown away.
     *
     * ⚠️ AND NONE WHERE THE LEADER HAS NO SLOT LEFT EITHER. The limit is counted per LEADER, so
     * "limit 2, two merchants already sent" leaves nothing for a third to open - and a gold price
     * on that card offers to buy one anyway. What remains on such a card is the influence button,
     * which is the only thing that can actually change the answer.
     */
    /*
     * ⚠️ WHERE THE ONLY OBSTACLE IS THE MONEY, THE PLAN IS THE GOLD BUTTON ITSELF (user's
     * instruction, 2026-09-10) - it grows an hourglass instead of standing beside a second
     * control. "Buy it now" and "buy it when you can" are two readings of one price, and two
     * buttons read as two costs.
     *
     * ⚠️ Not where a merchant is already standing idle: the green plus in this same row is the
     * thing to press then, and it costs nothing.
     */
    const canPlanTheBuy = heading.length === 0 && !warning && !queued
        && !nearestIdleMerchant(targetCity);

    if (heading.length === 0 && !warning && !queued) {
        stack.appendChild(priceRow(
            buildBuyButton(stack, route, targetCity, site, heading.length, canPlanTheBuy, scope),
            targetCity, heading.length, warning, null, scope,
        ));
    }
    // The slot under the price holds one of the two, never both.
    /*
     * ⚠️ QUEUED WINS OVER "ON THE WAY", and that order is the whole point. A queued request sends
     * its merchant on the first turn, so the card would otherwise flip to the ordinary errand row
     * the moment it set off - and a merchant fetched by the queue became indistinguishable from
     * one the player sent by hand, with the treaty still owed and nothing on the card saying so.
     * The hourglass stays until the request is finished with.
     *
     * ⚠️ The X is a SIBLING of the hourglass, not a second press on it: a queued request is undone
     * the same way a merchant is called off its errand, by the same mark in the same place.
     */
    if (queued) {
        stack.appendChild(queueRow(route.leaderId, warning, targetCity, site, Boolean(warning), scope));
    } else if (heading.length > 0) {
        stack.appendChild(errandRow(heading[0], targetCity, scope));
    } else if (warning) {
        /*
         * ⚠️ ITS OWN CONTROL ONLY WHERE THE LIMIT IS THE OBSTACLE, because only then does it carry
         * a SECOND price - the Influence for the treaty - which has no business inside a button
         * showing a gold cost. Where the money is the only thing missing, the gold button above is
         * the plan; see `canPlanTheBuy`.
         */
        const plan = buildWarnButton(route.leaderId, warning, targetCity, site, true, scope);
        if (plan) {
            stack.appendChild(plan);
        }
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
    const queued = isTradeActionQueued(targetCity);
    if (!queued) {
        stack.appendChild(buildImproveButton(stack, route, targetCity, site, offer, heading.length, scope));
    }
    // ⚠️ Its OWN ROW under the price, not beside it like the plus on an available card: this
    // button carries two prices and there is no width left on the title row.
    if (!queued && heading.length === 0 && offer && nearestIdleMerchant(targetCity)) {
        stack.appendChild(buildSendSpareImproveButton(stack, route, targetCity, offer, scope));
    }
    /*
     * ⚠️ NO SEPARATE PLAN BUTTON HERE. The improve button above carries both prices and grows its
     * own hourglass when neither can be paid yet; a second control repeating one of those prices
     * read as a third cost. The queued state is the exception - then the price is gone and what
     * remains is the hourglass with the X that calls it off.
     */
    if (queued) {
        stack.appendChild(queueRow(route.leaderId, null, targetCity, site, true, scope));
    } else if (heading.length > 0) {
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
