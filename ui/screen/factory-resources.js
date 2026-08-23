/**
 * The Factory Resources tab, built on the Empire tab's shape with two differences the mechanic
 * forces: four equal columns (nothing here lists unit classes, so the cards are narrower), and no
 * "one copy / all copies" pair - a factory resource pays nothing for being held, so one copy is
 * not a number the player can act on.
 *
 * Hence two sections. The second is the whole reason to open the tab: the game will let a Modern
 * empire sit on six unslotted Coffee without ever saying what that costs.
 *
 * The arithmetic is planner/factory-effects.js, including why these totals do NOT multiply by the
 * number of settlements.
 */
import { createComponent, onCleanup, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { hideTabSummary, showTabSummary } from './screen-parts.js';
import { iconBackground, resourceClassBackground, yieldIcon } from './icons.js';
import { template } from '/core/vendor/solid-js/web/dist/web.js';
import { CommerceScreenBaseTabContent } from '/base-standard/ui-next/screens/commerce/commerce-screen-base-tab-content.js';

import { absoluteWorth, factoryHoldings, gdpPerSlottedResource, sumFactoryTotals } from '../planner/factory-effects.js';
import { forgetModifierIndex } from '../planner/effects.js';
import { PRODUCTION_YIELD } from '../planner/facts.js';
import { appendWithResourceTooltip, resourceTooltipProps } from './resource-tooltip.js';
import { appendAll, clearChildren, ensureStyle, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const CLASS = 'najane-factory';
const STYLE_ID = 'najane-factory-tab-style';

/** The GDP line, which lives in the screen's tab row rather than in this tab. */
const SUMMARY_CLASS = 'najane-factory-summary';
/** The game's own font icon for GDP - the one its texts write as [icon:ECONOMIC_VP]. */
const GDP_ICON = 'blp:fi_victorypoint_economic_64';
const TOOLTIP_TEXT_SELECTOR = '#tooltip-root-content > div';

/** The font icons the game uses for these two in its own resource descriptions. */
const GROWTH_ICON = 'blp:fi_growth_rate_64';
const HEAL_ICON = 'blp:fi_action_heal_64';

const STYLE = `
.${CLASS}-list {
    display: flex;
    flex-direction: column;
    width: 100%;
}
.${CLASS}-section { display: flex; flex-direction: column; width: 100%; }
.${CLASS}-section + .${CLASS}-section { margin-top: 1.1rem; }
.${CLASS}-section__head {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    padding: 0 0.4rem 0.35rem 0.4rem;
}
.${CLASS}-section__title {
    margin-right: 1rem;
    color: #e5d2ac;
    font-size: 1.1rem;
    text-transform: uppercase;
    white-space: nowrap;
}
/* What the section adds up to, on the heading line rather than in a card of its own. */
.${CLASS}-section__totals {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    color: #ffffff;
    font-size: 1.05rem;
}
/* The idle section's totals are hypothetical, and are drawn as the lesser statement. */
.${CLASS}-section__totals--would { opacity: 0.8; }
.${CLASS}-section__note {
    width: 100%;
    padding: 0 0.4rem;
    color: #8d7f6a;
    font-size: 0.9rem;
}
.${CLASS}-section__empty {
    padding: 0.2rem 0.4rem 0.6rem 0.4rem;
    color: #b39e80;
    font-size: 0.95rem;
}

/*
 * Four equal columns. The padding is the gap between cards - there is no gap property to
 * set here - so it is half of it on each side of every card.
 */
.${CLASS}-cards {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: flex-start;
    width: 100%;
}
.${CLASS}-card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 25%;
    padding: 0.35rem 0.4rem;
}
.${CLASS}-card__inner {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 100%;
    /*
     * Fills the card, so cards in the same row draw the same height. The row already
     * stretches the CARD - that is the flex default - but the card is only a spacer; the
     * frame the player sees is this element inside it, and it was sizing to its own text.
     */
    flex: 1 1 auto;
    padding: 0.6rem 0.7rem 0.7rem 0.7rem;
}
/* Idle stock is not a loss yet, but it is not working either - drawn as the quieter card. */
.${CLASS}-card--idle .${CLASS}-card__inner { opacity: 0.78; }
/*
 * Everything in a card is centred, head to legend - as on the Empire tab.
 *
 * ⚠️ No wrapper around the figures here, and none needed: a factory resource has ONE row
 * of them rather than a "one copy / all copies" pair, so there is no second row for it to
 * line up with. That wrapper exists on the Empire tab for exactly that reason.
 */
.${CLASS}-card__head {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
}
.${CLASS}-card__icon {
    position: relative;
    width: 2.6rem;
    height: 2.6rem;
    margin-right: 0.7rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: auto;
}
/* Bottom edge, centred - where the unassigned pool puts the same mark. */
.${CLASS}-card__badge {
    position: absolute;
    bottom: -0.35rem;
    left: 50%;
    width: 1.35rem;
    height: 1.35rem;
    margin-left: -0.675rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
.${CLASS}-card__title {
    color: #e5d2ac;
    font-size: 1.15rem;
    text-transform: uppercase;
    text-align: center;
}
/*
 * One line, always: the words after each number truncate rather than push the row onto a
 * second line, which would make the cards in a row different heights.
 */
.${CLASS}-card__totals {
    display: flex;
    flex-direction: row;
    /*
     * Wraps rather than clips. Everything left on this row is a number - the words moved
     * to the legend below - so there is nothing here that may be dropped, and a second
     * line costs less than a figure the player cannot read.
     */
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    margin-top: 0.5rem;
    color: #ffffff;
    font-size: 1.05rem;
}
.${CLASS}-total {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex: 0 1 auto;
    /* Without this a flex item refuses to shrink below its content, and nothing truncates. */
    min-width: 0;
    margin-right: 0.7rem;
}
/* The number itself never shrinks; it is the whole point of the line. */
.${CLASS}-total > div:first-child { flex: 0 0 auto; }
/* Separation between totals, not after the last one - that would shift the row left. */
.${CLASS}-total:last-child { margin-right: 0; }
.${CLASS}-total__icon {
    width: 1.4rem;
    height: 1.4rem;
    margin-left: 0.15rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
/* Words following a number, on the section headings where there is room for them inline. */
.${CLASS}-total__note {
    margin-left: 0.35rem;
    color: #b39e80;
    font-size: 0.92rem;
}
/* A worked-out number, not a caption - it reads closer to the figure it follows. */
.${CLASS}-total__estimate {
    margin-left: 0.4rem;
    color: #d8c9ae;
    font-size: 0.98rem;
    white-space: nowrap;
}

/*
 * What each number is FOR, on its own line under the numbers - see the same block in
 * empire-tab.js for why it is not inline beside the number.
 */
.${CLASS}-card__legend {
    display: flex;
    flex-direction: column;
    margin-top: 0.4rem;
}
.${CLASS}-card__legend-item {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: center;
    margin-top: 0.15rem;
    color: #b39e80;
    font-size: 0.92rem;
}
.${CLASS}-card__legend-icon {
    flex: 0 0 auto;
    width: 1.15rem;
    height: 1.15rem;
    margin-top: 0.1rem;
    margin-right: 0.35rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
/* Without this a flex item refuses to shrink below its content, and nothing wraps. */
.${CLASS}-card__legend-text { min-width: 0; text-align: center; }

/*
 * The GDP line sits in the tab row, to the left of the tabs - the same anchor the Empire
 * tab's income line and the Trade tab's route total use. They never collide because only
 * one tab is ever open.
 */
.${SUMMARY_CLASS} {
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
.${SUMMARY_CLASS}__label {
    margin-right: 0.9rem;
    color: #e5d2ac;
    text-transform: uppercase;
    white-space: nowrap;
}
.${SUMMARY_CLASS}__icon {
    width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.15rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}

/* Plain-text tooltips render into a bare div, which collapses newlines like any HTML. */
${TOOLTIP_TEXT_SELECTOR} { white-space: pre-wrap; }

`;

/** What the slotted resources earn towards the economic legacy path, above the tabs. */
function buildSummary(slotted) {
    const rate = gdpPerSlottedResource();
    const bar = makeElement('div', SUMMARY_CLASS, {
        'data-tooltip-content': Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_GDP_TOOLTIP', rate, slotted),
    });

    const label = makeElement('div', `${SUMMARY_CLASS}__label font-title`);
    label.textContent = `${Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_GDP')}:`;
    bar.appendChild(label);

    const value = makeElement('div', '');
    value.textContent = `+${rate * slotted}`;
    bar.appendChild(value);

    const icon = makeElement('div', `${SUMMARY_CLASS}__icon`);
    icon.style.backgroundImage = `url(${GDP_ICON})`;
    bar.appendChild(icon);
    return bar;
}

/** Puts the GDP line in the tab row. */
function showSummary(slotted) {
    showTabSummary(SUMMARY_CLASS, () => buildSummary(slotted));
}

function hideSummary() {
    hideTabSummary(SUMMARY_CLASS);
}

/** The mark saying this is a factory resource - the same one the unassigned pool draws. */
function classBadge(resourceType) {
    const background = resourceClassBackground(resourceType);
    if (!background) {
        return null;
    }
    const badge = makeElement('div', `${CLASS}-card__badge`);
    badge.style.backgroundImage = background;
    return badge;
}

/** The icon for one total. */
function iconFor(total) {
    switch (total.kind) {
        case 'yieldPercent':
            return yieldIcon(total.yieldType);
        case 'growthPercent':
            return GROWTH_ICON;
        case 'heal':
            return HEAL_ICON;
        default:
            return yieldIcon(PRODUCTION_YIELD);
    }
}

/** Only healing is a flat number; everything else on this tab is a percentage. */
function valueText(total) {
    return total.kind === 'heal' ? `+${total.amount}` : `+${total.amount}%`;
}

function labelFor(total) {
    if (total.kind === 'growthPercent') {
        return Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_GROWTH');
    }
    if (total.kind === 'heal') {
        return Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_HEAL');
    }
    return (total.towards ?? []).map((key) => Locale.compose(key)).join(', ');
}

/**
 * The percentage turned into the number the player would have worked out by hand.
 * ⚠️ The percentage alone says nothing about what it is a percentage OF, which on this
 * tab is the whole point.
 */
function estimateElement(total, applied, isIdle) {
    if (total.kind !== 'yieldPercent' || !total.yieldType) {
        return null;
    }
    const { worth, net } = absoluteWorth(total.yieldType, total.amount, applied);
    if (!worth) {
        return null;
    }
    const yieldName = Locale.compose(GameInfo.Yields?.lookup(total.yieldType)?.Name ?? total.yieldType);
    const tooltip = Locale.compose(
        isIdle ? 'LOC_NAJANE_COMMERCE_FACTORY_ESTIMATE_WOULD' : 'LOC_NAJANE_COMMERCE_FACTORY_ESTIMATE_NOW',
        worth,
        yieldName,
        net,
    );
    const element = makeElement('div', `${CLASS}-total__estimate`, { 'data-tooltip-content': tooltip });
    element.textContent = `≈ +${worth}`;
    return element;
}

function totalElement(total, applied = 0, isIdle = false, { withLabel = true, withEstimate = true } = {}) {
    const element = makeElement('div', `${CLASS}-total`);
    const value = makeElement('div', '');
    value.textContent = valueText(total);
    element.appendChild(value);

    const source = iconFor(total);
    if (source) {
        const icon = makeElement('div', `${CLASS}-total__icon`);
        icon.style.backgroundImage = `url(${source})`;
        element.appendChild(icon);
    }

    const estimate = withEstimate ? estimateElement(total, applied, isIdle) : null;
    if (estimate) {
        element.appendChild(estimate);
    }

    const label = withLabel ? labelFor(total) : '';
    if (label) {
        const note = makeElement('div', `${CLASS}-total__note`);
        note.textContent = label;
        element.appendChild(note);
    }
    return element;
}

/** One line per bonus that needs words, keyed by the icon beside its number. */
function legendFor(totals) {
    const labelled = totals.filter((total) => labelFor(total));
    if (!labelled.length) {
        return null;
    }
    const icons = labelled.map(iconFor);
    const ambiguous = new Set(icons).size !== icons.length;

    const legend = makeElement('div', `${CLASS}-card__legend`);
    for (let index = 0; index < labelled.length; index++) {
        const total = labelled[index];
        const item = makeElement('div', `${CLASS}-card__legend-item`);
        if (icons[index]) {
            const icon = makeElement('div', `${CLASS}-card__legend-icon`);
            icon.style.backgroundImage = `url(${icons[index]})`;
            item.appendChild(icon);
        }
        const text = makeElement('div', `${CLASS}-card__legend-text`);
        text.textContent = ambiguous ? `${valueText(total)}  ${labelFor(total)}` : labelFor(total);
        item.appendChild(text);
        legend.appendChild(item);
    }
    return legend;
}

/** The card's tooltip: the game's wording, where the copies are, and where they came from. */
function whereLines(holding) {
    const lines = [];
    if (holding.cities?.length) {
        lines.push(`${Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_IN_SETTLEMENTS')}:`, '');
        for (const city of holding.cities) {
            lines.push(`        ${city.name}: ${city.count}`);
        }
    }

/** A leader per block: their name and total, then their settlements indented beneath. */
    const origins = [];
    for (const [leaderId, byCity] of holding.origins ?? new Map()) {
        const leader = Players.get(leaderId);
        if (!leader) {
            continue;
        }
/** The leader's own total, so the heading answers the question the list under it raises. */
        const cities = [...byCity.values()];
        const fromLeader = cities.reduce((sum, city) => sum + city.count, 0);
        if (origins.length) {
            origins.push('');
        }
        origins.push(`[B]${Locale.compose(leader.name)}: ${fromLeader}[/B]`);
        for (const city of cities) {
            origins.push(
                `        ${Locale.compose('LOC_COMMERCE_EMPIRE_ORIGIN_CITY_CONTRIBUTION_COUNTER', city.count, city.name)}`,
            );
        }
    }
    if (origins.length) {
        if (lines.length) {
            lines.push('');
        }
        lines.push(`${Locale.compose('LOC_COMMERCE_EMPIRE_RESOURCES_ORIGIN_TITLE')}:`, '', ...origins);
    }
    return lines;
}

/** Where the copies sit, then one card per leader they came from. */
function originGroups(holding) {
    const groups = [];
    if (holding.cities?.length) {
        groups.push({
            title: Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_IN_SETTLEMENTS'),
            lines: holding.cities.map((city) => `${city.name}: ${city.count}`),
        });
    }
    for (const [leaderId, byCity] of holding.origins ?? new Map()) {
        const leader = Players.get(leaderId);
        if (!leader) {
            continue;
        }
        const cities = [...byCity.values()];
        const total = cities.reduce((sum, city) => sum + city.count, 0);
        groups.push({
            leaderId,
            title: `${Locale.compose(leader.name)}: ${total}`,
            lines: cities.map((city) =>
                Locale.compose('LOC_COMMERCE_EMPIRE_ORIGIN_CITY_CONTRIBUTION_COUNTER', city.count, city.name),
            ),
        });
    }
    return groups;
}

/** The plain-text tooltip, used only when the game's own component will not mount. */
function tooltipFor(holding) {
    const description = holding.definition?.Tooltip;
    const lines = description ? [Locale.compose(description), ''] : [];
    return [...lines, ...whereLines(holding)].join('\n');
}

function cardFor(holding, isIdle, applied) {
    const card = makeElement('div', `${CLASS}-card${isIdle ? ` ${CLASS}-card--idle` : ''}`);
    // The game's own card background, so these read as the same object as the other tabs'.
    const inner = makeElement('div', `${CLASS}-card__inner card-frame-bg`);

    const head = makeElement('div', `${CLASS}-card__head`);
    const icon = makeElement('div', `${CLASS}-card__icon`);
    icon.style.backgroundImage = iconBackground(holding.type, 'RESOURCE');
    const badge = classBadge(holding.type);
    if (badge) {
        icon.appendChild(badge);
    }

    const title = makeElement('div', `${CLASS}-card__title font-title`);
    // The count in the same font as the name, as on the Empire tab - it is part of the
    // name of the thing here, not an annotation on it.
    title.textContent = `${Locale.compose(holding.definition?.Name ?? holding.type)} [${holding.count}]`;

/** The game's own framed tooltip, as on the Empire tab. */
    appendWithResourceTooltip(
        head,
        icon,
        resourceTooltipProps(holding.type),
        tooltipFor(holding),
        originGroups(holding),
    );
    head.appendChild(title);
    inner.appendChild(head);

    // Almost every factory resource has exactly ONE bonus, so its words fit on the same line.
    const inline = holding.totals.length === 1;
    const totals = makeElement('div', `${CLASS}-card__totals`);
    for (const total of holding.totals) {
        totals.appendChild(
            totalElement(total, applied.get(total.yieldType) ?? 0, isIdle, { withLabel: inline }),
        );
    }
    inner.appendChild(totals);

    if (!inline) {
        const legend = legendFor(holding.totals);
        if (legend) {
            inner.appendChild(legend);
        }
    }

    card.appendChild(inner);
    return card;
}

/** The section's own line of totals. */
function totalsRow(totals, isWould) {
    const row = makeElement('div', `${CLASS}-section__totals${isWould ? ` ${CLASS}-section__totals--would` : ''}`);
    for (const total of totals) {
        row.appendChild(totalElement(total, 0, isWould, { withEstimate: false }));
    }
    return row;
}

function sectionFor({ titleKey, emptyKey, noteKey, holdings, isIdle, applied }) {
    const section = makeElement('div', `${CLASS}-section`);

    const head = makeElement('div', `${CLASS}-section__head`);
    const title = makeElement('div', `${CLASS}-section__title font-title`);
    title.textContent = Locale.compose(titleKey);
    head.appendChild(title);

    const summed = sumFactoryTotals(holdings.map((holding) => holding.totals));
    if (summed.length) {
        head.appendChild(totalsRow(summed, isIdle));
    }
    section.appendChild(head);

    if (noteKey && holdings.length) {
        const note = makeElement('div', `${CLASS}-section__note`);
        note.textContent = Locale.compose(noteKey);
        section.appendChild(note);
    }

    if (holdings.length === 0) {
        const empty = makeElement('div', `${CLASS}-section__empty`);
        empty.textContent = Locale.compose(emptyKey);
        section.appendChild(empty);
        return section;
    }

    const cards = makeElement('div', `${CLASS}-cards`);
    for (const holding of holdings) {
        cards.appendChild(cardFor(holding, isIdle, applied));
    }
    section.appendChild(cards);
    return section;
}

function render(host) {
    clearChildren(host);
    // A fresh reading each time the tab is opened - resources move between visits.
    forgetModifierIndex();

    const { working, idle } = factoryHoldings();

/** The percentage per yield ALREADY in the empire's figures - every slotted copy counted. */
    const applied = new Map();
    for (const total of sumFactoryTotals(working.map((holding) => holding.totals))) {
        if (total.kind === 'yieldPercent' && total.yieldType) {
            applied.set(total.yieldType, total.amount);
        }
    }

    appendAll(
        host,
        sectionFor({
            titleKey: 'LOC_NAJANE_COMMERCE_FACTORY_WORKING',
            emptyKey: 'LOC_NAJANE_COMMERCE_FACTORY_WORKING_EMPTY',
            holdings: working,
            isIdle: false,
            applied,
        }),
        sectionFor({
            titleKey: 'LOC_NAJANE_COMMERCE_FACTORY_IDLE',
            emptyKey: 'LOC_NAJANE_COMMERCE_FACTORY_IDLE_EMPTY',
            noteKey: 'LOC_NAJANE_COMMERCE_FACTORY_IDLE_NOTE',
            holdings: idle,
            isIdle: true,
            applied,
        }),
    );
    showSummary(working.reduce((sum, holding) => sum + holding.count, 0));
    log(`factory tab: ${working.length} kind(s) working, ${idle.length} idle`);
}

const listTemplate = template(`<div class="najane-factory-list"></div>`);

export const FactoryResourcesContainer = () =>
    createComponent(CommerceScreenBaseTabContent, {
        title: 'LOC_RESOURCECLASS_FACTORY_NAME',
        description: 'LOC_NAJANE_COMMERCE_FACTORY_DESCRIPTION',
        get children() {
            const host = listTemplate();
    // Left in place on cleanup, as on the Empire tab: every selector is prefixed, so nothing of
    // the game's is touched.
            ensureStyle(STYLE_ID, STYLE);
            onCleanup(hideSummary);
            onMount(() => {
                try {
                    render(host);
                } catch (error) {
                    warn(`building the factory tab failed: ${error}`);
                }
            });
            return host;
        },
    });
