/**
 * Three trade figures at the foot of the game's own relationship tooltip - the one behind a
 * leader's portrait on a trade route card: the limit with that leader, the routes already
 * running, and this mod's merchants on their way there.
 *
 * In screen/ because it decorates a tooltip that only exists while a screen is drawing it, and it
 * reads the two engine modules downwards.
 *
 * ⚠️ DECORATED FROM THE OUTSIDE, NOT OVERRIDDEN. `RelationshipTooltip` is a registered component
 * and could be replaced the way `TradeRouteCard` is - but that tooltip is the same one the
 * diplomacy ribbon and the leader panel use, so an override would put trade numbers on every
 * leader portrait in the game. The DOM is decorated instead, and only while this tab is open.
 *
 * ⚠️ The tooltip does NOT mount inside the Commerce screen, so the screen's shared observer
 * cannot see it: `core/ui-next/components/tooltip.js` portals every tooltip into
 * `#uinext-tooltips`. This module therefore keeps an observer of its own, started and handed back
 * with the tab.
 *
 * ⚠️ WHICH leader the tooltip is about is not written anywhere in its DOM. It is remembered from
 * the portrait the pointer entered; `decorateLeaderLink` in trade-buy-merchant.js reports it.
 */
import { merchantsBoundForPlayer } from '../engine/merchant-orders.js';
import { tradeCapacityWith } from '../engine/merchant.js';
import { appendAll, makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/** Where every tooltip in the game is portalled to; see the ⚠️ above. */
const TOOLTIP_ROOT_ID = 'uinext-tooltips';

/** The game names its own frame; the same selector the tab's stylesheet already uses. */
const FRAME_SELECTOR = '[data-name="Relationship-Tooltip"]';

/**
 * The frame's own "hold TAB to hide" row, which `Tooltip.Frame` renders AFTER the children it was
 * given - so it is the last thing in the frame and the footer belongs above it.
 *
 * ⚠️ FOUND BY WALKING THE CHILDREN, NOT BY A SELECTOR. `:scope > ...` is the natural way to write
 * this and it does not work in this renderer - the footer silently stopped appearing at all. A
 * classList test uses no selector engine and cannot be refused.
 *
 * ⚠️ These are `Tooltip.InspectHint`'s own classes; it carries no name of its own. A miss degrades
 * to appending at the very end, which is where this started - it does not break.
 */
const HINT_CLASSES = ['uppercase', 'text-accent-3'];

function hideHintIn(frame) {
    for (const child of frame.children) {
        if (HINT_CLASSES.every((name) => child.classList.contains(name))) {
            return child;
        }
    }
    return null;
}

const CLASS = 'najane-relationship-trade';

export const RELATIONSHIP_FOOTER_STYLE = `
.${CLASS} {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin-top: 0.6rem;
    padding-top: 0.6rem;
    /* The frame's own hairline, so the block reads as a footer rather than as more prose. */
    border-top: 0.06rem solid rgba(229, 210, 172, 0.35);
}
.${CLASS}__row {
    display: flex;
    flex-direction: row;
    /* No align-items: this renderer rejects "baseline" (UI.log: Unable to parse declaration). */
    justify-content: space-between;
    width: 100%;
}
.${CLASS}__label {
    color: #b39e80;
    font-size: 0.85rem;
    margin-right: 1.2rem;
}
.${CLASS}__value {
    color: #ffffff;
    font-size: 0.9rem;
    white-space: nowrap;
}
/* Nothing on the road is the ordinary case; it should not shout. */
.${CLASS}__value--quiet { color: #b39e80; }
`;

/**
 * The leader whose portrait the pointer is over, or null.
 * ⚠️ Cleared on the way out, so a tooltip opened by something else on the screen is never given
 * somebody else's numbers.
 */
let hoveredLeaderId = null;

export function noteLeaderHover(leaderId) {
    hoveredLeaderId = leaderId ?? null;
}

export function forgetLeaderHover() {
    hoveredLeaderId = null;
}

function row(labelKey, value, quiet = false) {
    const line = makeElement('div', `${CLASS}__row`);
    const label = makeElement('div', `${CLASS}__label`);
    label.textContent = Locale.compose(labelKey);
    const amount = makeElement('div', `${CLASS}__value${quiet ? ` ${CLASS}__value--quiet` : ''}`);
    amount.textContent = String(value);
    appendAll(line, label, amount);
    return line;
}

function buildFooter(leaderId) {
    const { capacity, used } = tradeCapacityWith(leaderId);
    const heading = merchantsBoundForPlayer(leaderId).length;

    const block = makeElement('div', CLASS);
    appendAll(
        block,
        row('LOC_NAJANE_COMMERCE_RELATIONSHIP_LIMIT', capacity),
        row('LOC_NAJANE_COMMERCE_RELATIONSHIP_ACTIVE', used),
        row('LOC_NAJANE_COMMERCE_RELATIONSHIP_ON_THE_WAY', heading, heading === 0),
    );
    return block;
}

/**
 * ⚠️ ADDED, NEVER REARRANGED. Solid's own nodes in this frame are left exactly where they are;
 * one foreign node goes in above the hide hint. `insertBefore(node, null)` is an append, so the
 * fallback needs no branch of its own.
 */
function decorateFrame(frame) {
    if (hoveredLeaderId === null || frame.querySelector(`.${CLASS}`)) {
        return;
    }
    // `insertBefore(node, null)` is an append, so the fallback needs no branch of its own.
    frame.insertBefore(buildFooter(hoveredLeaderId), hideHintIn(frame));
}

let observer = null;
let tooltipRoot = null;

/**
 * ⚠️ Every tooltip on this tab lands under the root, framed buttons included, so this wakes on each
 * one shown or hidden: nothing to do without a hovered portrait, and the query stays in the root.
 */
function pass() {
    if (hoveredLeaderId === null || !tooltipRoot) {
        return;
    }
    for (const frame of tooltipRoot.querySelectorAll(FRAME_SELECTOR)) {
        try {
            decorateFrame(frame);
        } catch (error) {
            warn(`could not add the trade figures to a relationship tooltip: ${error}`);
        }
    }
}

export function startRelationshipFooter() {
    if (observer) {
        return;
    }
    const root = document.getElementById(TOOLTIP_ROOT_ID);
    if (!root) {
        // No tooltip layer means no tooltip to decorate; nothing to warn about.
        return;
    }
    tooltipRoot = root;
    observer = new MutationObserver(pass);
    observer.observe(root, { childList: true, subtree: true });
    // The tooltip may already be open when the tab arrives.
    pass();
}

/** ⚠️ Handed back with the tab: this watches a root OUTSIDE the Commerce screen, so an observer
 *  left running would go on waking for every tooltip in the game. */
export function stopRelationshipFooter() {
    observer?.disconnect();
    observer = null;
    tooltipRoot = null;
    hoveredLeaderId = null;
    document.querySelectorAll(`.${CLASS}`).forEach((block) => block.remove());
}
