/**
 * How many trade routes you are running and how many more you could, above the tabs.
 *
 * ⚠️ Counted per LEADER, because that is how the game counts it: the limit is a property of the
 * pairing, not of your empire, so one number for the whole screen would be a different fact.
 */
import { makeElement, setTooltip } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';
import { hideTabSummary, showTabSummary } from './screen-parts.js';

export const CLASS = 'najane-trade-summary';
/** Plain-text tooltips render into a bare div, which collapses newlines like any HTML. */
const TOOLTIP_TEXT_SELECTOR = '#tooltip-root-content > div';

export const STYLE = `
/*
 * The same anchor and offsets as the Empire tab's income line - see empire-tab.js. Kept as
 * a separate rule rather than shared because the two tabs load independently and neither
 * may assume the other's stylesheet is present.
 */
.${CLASS} {
    position: absolute;
    left: 2rem;
    top: 0.15rem;
    z-index: 20;
    display: flex;
    flex-direction: row;
    align-items: center;
    color: #ffffff;
    font-size: 1.05rem;
}
.${CLASS}__label {
    margin-right: 0.9rem;
    color: #e5d2ac;
    text-transform: uppercase;
    white-space: nowrap;
}
.${CLASS}__count { white-space: nowrap; }
.${CLASS}__free {
    margin-left: 0.7rem;
    color: #b39e80;
    font-size: 0.92rem;
    white-space: nowrap;
}
/* Nothing free: the count is the whole story, and a coloured one says so at a glance. */
.${CLASS}--full .${CLASS}__count { color: #e5d2ac; }

${TOOLTIP_TEXT_SELECTOR} { white-space: pre-wrap; }
`;

/** Every leader we could trade with, and how much room is left with each. */
function partners() {
    const localID = GameContext.localPlayerID;
    const local = Players.get(localID);
    const trade = local?.Trade;
    if (!trade) {
        return [];
    }
    const diplomacy = local.Diplomacy;
    const found = [];
    for (const player of Players.getAlive()) {
        if (!player?.isMajor || player.id === localID) {
            continue;
        }
        if (diplomacy && !diplomacy.hasMet(player.id)) {
            continue;
        }
        const used = trade.countPlayerTradeRoutesTo(player.id) ?? 0;
        const capacity = trade.getTradeCapacityFromPlayer(player.id) ?? 0;
        found.push({
            id: player.id,
            name: Locale.compose(player.leaderName),
            used,
            free: Math.max(0, capacity - used),
            capacity,
        });
    }
    return found;
}

/** `\t` indents under a heading the way the resource tooltips already do. */
function leaderLines(list) {
    return list.map((partner) => `\t${partner.name}: ${partner.free}`);
}

function tooltipFor(list, startable) {
    const used = list.reduce((sum, partner) => sum + partner.used, 0);
    const capacity = list.reduce((sum, partner) => sum + partner.capacity, 0);
    const lines = [Locale.compose('LOC_NAJANE_COMMERCE_TRADE_TOOLTIP_USED', used, capacity)];

    if (list.length === 0) {
        lines.push('', Locale.compose('LOC_NAJANE_COMMERCE_TRADE_TOOLTIP_NOBODY'));
        return lines.join('\n');
    }

    // Room with this leader AND somewhere of theirs we can actually reach.
    const now = list.filter((partner) => partner.free > 0 && startable.has(partner.id));
    const blocked = list.filter((partner) => partner.free > 0 && !startable.has(partner.id));

    if (now.length === 0 && blocked.length === 0) {
        lines.push('', Locale.compose('LOC_NAJANE_COMMERCE_TRADE_TOOLTIP_FULL'));
        return lines.join('\n');
    }
    if (now.length > 0) {
        lines.push('', Locale.compose('LOC_NAJANE_COMMERCE_TRADE_TOOLTIP_OPEN_NOW'), ...leaderLines(now));
    }
    if (blocked.length > 0) {
        lines.push('', Locale.compose('LOC_NAJANE_COMMERCE_TRADE_TOOLTIP_OUT_OF_REACH'), ...leaderLines(blocked));
    }
    return lines.join('\n');
}

function build(list, startable) {
    const used = list.reduce((sum, partner) => sum + partner.used, 0);
    const capacity = list.reduce((sum, partner) => sum + partner.capacity, 0);
    const free = Math.max(0, capacity - used);

    const bar = makeElement('div', `${CLASS}${free === 0 ? ` ${CLASS}--full` : ''}`);
    setTooltip(bar, tooltipFor(list, startable));

    const label = makeElement('div', `${CLASS}__label font-title`);
    label.textContent = `${Locale.compose('LOC_NAJANE_COMMERCE_TRADE_ROUTES_LABEL')}:`;
    bar.appendChild(label);

    const count = makeElement('div', `${CLASS}__count`);
    count.textContent = `${used} / ${capacity}`;
    bar.appendChild(count);

    if (free > 0) {
        const spare = makeElement('div', `${CLASS}__free`);
        spare.textContent = Locale.compose('LOC_NAJANE_COMMERCE_TRADE_SLOTS_FREE', free);
        bar.appendChild(spare);
    }
    return bar;
}

/** Puts the summary in the tab row, to the left of the tabs. */
export function showTradeSummary(startable = new Set()) {
    try {
        // Replaces rather than adds: the row belongs to the screen, not to this tab, so a
        // tab left and re-entered would otherwise collect one summary per visit.
        showTabSummary(CLASS, () => build(partners(), startable));
    } catch (error) {
        warn(`could not total the trade routes: ${error}`);
    }
}

export function hideTradeSummary() {
    hideTabSummary(CLASS);
}
