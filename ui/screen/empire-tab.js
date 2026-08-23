/**
 * The Empire Resources tab, rebuilt.
 *
 * The game's version gives each resource a card the size of a poster: the rule in full
 * prose, a "SOURCE" divider, and a row of leader portraits. Five resources fill the screen
 * and none of them answers the question actually being asked - what is this worth to me?
 *
 * This one is a three-column list. Each card is a title line and a total:
 *
 *     [icon] SALTPETER [10]
 *     +6 (combat)
 *
 * The prose and the origins move into the tooltip on the icon, where they are available
 * without being in the way. What the totals mean, and why they are not simply the number
 * in the description multiplied by the count, is in planner/empire-effects.js.
 *
 * Worked out when the tab is opened, once. These figures move only when settlements or
 * resources do, and both of those close this screen to happen.
 *
 * ⚠️ Rendered imperatively rather than reactively, and deliberately: nothing here changes
 * while the tab is open, so a Solid render tree would be machinery guarding a value that
 * cannot move. The one-shot build below is the whole of it.
 */
import { createComponent, onCleanup, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { hideTabSummary, showTabSummary } from './screen-parts.js';
import { resourceClassBackground, yieldIcon } from './icons.js';
import { template } from '/core/vendor/solid-js/web/dist/web.js';
import { CommerceScreenBaseTabContent } from '/base-standard/ui-next/screens/commerce/commerce-screen-base-tab-content.js';
import { useCommerceScreenContext } from '/base-standard/ui-next/screens/commerce/commerce-screen-model.js';

import { empireEffectTotals, forgetEmpireEffects } from '../planner/empire-effects.js';
import { buildSettlements } from '../model/headless-model.js';
import { appendWithResourceTooltip, resourceTooltipProps } from './resource-tooltip.js';
import { appendAll, clearChildren, ensureStyle, makeElement } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const CLASS = 'najane-empire';
const PRODUCTION_YIELD = 'YIELD_PRODUCTION';

/**
 * Where the tooltip controller puts plain text.
 *
 * ⚠️ `#tooltip-root-content`, by id - NOT `.tooltip__content`, which was the first guess
 * and matched nothing. The manager is handed two elements from root-game.html,
 * `tooltipRootElement: #tooltip-root` and `tooltipContentElement: #tooltip-root-content`,
 * and the text goes into a bare div appended to the second one.
 */
const TOOLTIP_TEXT_SELECTOR = '#tooltip-root-content > div';
const STYLE_ID = 'najane-empire-tab-style';

/** The summary line, which lives in the screen's tab row rather than in this tab. */
const SUMMARY_CLASS = 'najane-empire-summary';

/** The combat font icon the game itself uses in narrative rewards. */
const COMBAT_ICON = 'blp:fi_nar_rew_combat_64';

/** Shown on a total the game caps; see empire-effects.js. */
const CAPPED_TOOLTIP = 'LOC_NAJANE_COMMERCE_EMPIRE_CAPPED';

/** Shown on a bonus that only pays during a Celebration, while one is not running. */
const CELEBRATION_TOOLTIP = 'LOC_NAJANE_COMMERCE_EMPIRE_CELEBRATION_ONLY';

const STYLE = `
.${CLASS}-list {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    width: 100%;
}
/*
 * Two areas, and the first one sizes itself.
 *
 * The first holds every resource whose bonus is combat strength - those carry a list of
 * unit classes and need the room. The rest are a number and an icon and fit in far less,
 * so they share what is left, three to a row.
 *
 * ⚠️ The first area used to be a flat 33.3%, which was wrong in both directions: with one
 * short combat resource it reserved a third of the screen for a line of text a quarter
 * that wide, and with none at all it left a third of the screen blank. A flex basis of
 * auto with no width set makes its base size the widest thing in it - which is the whole
 * point, since what is IN it varies by age, by civilisation and by language.
 *
 * The bounds are what keep that honest: never so narrow that a card reads as a scrap,
 * never so wide that it starves the other three columns, and a shrink factor of 1 so a
 * very long unit-class list gives way rather than overflowing.
 *
 * The padding is the gap between cards - there is no gap property to set here - so it is
 * half of it on each side of every card.
 */
.${CLASS}-combat {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    min-width: 17rem;
    max-width: 45%;
}
.${CLASS}-rest {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-content: flex-start;
    /* Takes whatever the first area did not; the zero minimum lets it actually shrink. */
    flex: 1 1 0;
    min-width: 0;
}
.${CLASS}-combat > .${CLASS}-card { width: 100%; }
.${CLASS}-rest > .${CLASS}-card { width: 33.3333%; }
.${CLASS}-card {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
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
/*
 * Everything in a card is centred, head to legend - but the figures are centred as a PAIR
 * rather than a row at a time. See the note in cardFor for why.
 */
.${CLASS}-card__figures {
    display: flex;
    /* A row OF COLUMNS - one per figure, plus the labels. See figuresBlock. */
    flex-direction: row;
    align-items: flex-start;
    /* Sizes to its columns and centres that, instead of filling the card. */
    align-self: center;
    max-width: 100%;
    margin-top: 0.5rem;
    color: #ffffff;
    font-size: 1.05rem;
}
.${CLASS}-card__figures-col {
    display: flex;
    flex-direction: column;
    /* Never shrinks: its width IS the alignment, and a squeezed column breaks it. */
    flex: 0 0 auto;
}
/*
 * Every cell is the same height and centres what is in it.
 *
 * ⚠️ Without this the columns drift apart vertically, because each cell was only as tall
 * as its own content: a figure carries a 1.5rem icon, a label carries text, and the "all"
 * row is bold - three different heights across a block that has to read as two straight
 * lines. The height is the icon's, so the tallest thing in a row sets it and everything
 * beside it centres against that instead of sitting at the top of the band.
 */
.${CLASS}-card__figures-col > * {
    display: flex;
    align-items: center;
    min-height: 1.7rem;
}
.${CLASS}-card__figures-col + .${CLASS}-card__figures-col { margin-left: 0.9rem; }
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
 * One copy's worth reads as the smaller fact; the empire's total is the answer.
 *
 * ⚠️ Emphasis only - no margins here. The two rows used to carry different top margins,
 * which on its own was enough to stop the label lining up with the figures beside it. The
 * gap between the rows belongs to the row, not to how loudly it is written.
 */
.${CLASS}-cell--one { opacity: 0.75; font-size: 0.98rem; }
.${CLASS}-cell--all { font-weight: bold; }
.${CLASS}-card__figures-col > * + * { margin-top: 0.25rem; }
/*
 * What each number is FOR, on its own line under the numbers.
 *
 * ⚠️ It used to sit inline beside each number, repeated in both the "one" and "all" rows.
 * That is where the space went: the same words twice, on a line already holding two
 * numbers and two icons, in a card a ninth of the screen wide. Truncating them was worse
 * than useless - "+6 (sword)" with no words does not say WHICH units, which is the only
 * thing that line is for.
 *
 * On its own line it has the whole card, is written once instead of twice, and is allowed
 * to WRAP rather than truncate. Nothing is hidden and nothing needs measuring.
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
.${CLASS}-card__note {
    margin-top: 0.3rem;
    color: #8d7f6a;
    font-size: 0.88rem;
    text-align: center;
}
/*
 * Fixed width, text at its left edge: that is what makes "One" and "All" start together
 * AND the figures after them line up, without either row knowing about the other.
 */
/*
 * No fixed width any more: the label sits in a column of its own, and the column is
 * already exactly as wide as the longer of the two labels. Pinning it as well would only
 * pad the block out to a width nothing in it needs.
 */
.${CLASS}-card__label {
    color: #b39e80;
    font-weight: normal;
}
.${CLASS}-total {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex: 0 1 auto;
    /* Without this a flex item refuses to shrink below its content, and nothing truncates. */
    min-width: 0;
    margin-right: 0.9rem;
}
/* The number itself never shrinks; it is the whole point of the line. */
.${CLASS}-total > div:first-child { flex: 0 0 auto; }
/* Separation between totals, not after the last one - that would shift the row left. */
.${CLASS}-total:last-child { margin-right: 0; }
/* Inside a card the gap belongs to the column, so the figure itself carries none. */
.${CLASS}-card__figures .${CLASS}-total { margin-right: 0; }
.${CLASS}-total__icon {
    width: 1.5rem;
    height: 1.5rem;
    margin-left: 0.25rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
}
.${CLASS}-total--capped { color: #e5d2ac; }
/* Real, but not being paid right now - and so not counted in the summary above. */
.${CLASS}-total--inactive { opacity: 0.45; }

/*
 * When nothing could be totalled, the game's own sentence stands in - better than an empty
 * space under the title. planner/empire-effects.js says which effects can be added up.
 */
.${CLASS}-card__fallback {
    margin-top: 0.4rem;
    color: #b39e80;
    font-size: 0.95rem;
    text-align: center;
    /* Stylized text turns [N] into a real newline, not a <br> - see the note above
       descriptionFor. Without this the line collapses to a space like any HTML whitespace. */
    white-space: pre-wrap;
}

/*
 * The summary sits in the tab row, which is a positioned element the game maintains - the
 * same anchor the Assign All buttons use on the Resources tab, so the two never collide
 * because only one tab is ever open.
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
    pointer-events: none;
}
.${SUMMARY_CLASS}__label {
    margin-right: 0.9rem;
    color: #e5d2ac;
    text-transform: uppercase;
    white-space: nowrap;
}
/*
 * Tighter than the same totals inside a card, and only here.
 *
 * A card gives one total a whole row, so the spacing there is separating lines. This is a
 * single run of seven or eight of them, where the card's spacing reads as seven separate
 * things rather than one income figure - and the yield icons carry their own transparent
 * margin, so the drawn gap is wider than the rule says.
 */
.${SUMMARY_CLASS} .${CLASS}-total { margin-right: 0.5rem; }
.${SUMMARY_CLASS} .${CLASS}-total__icon {
    width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.1rem;
}

/* Plain-text tooltips render into a bare div, which collapses newlines like any HTML. */
${TOOLTIP_TEXT_SELECTOR} { white-space: pre-wrap; }
`;

/**
 * The class badge for a resource, or null if the game has no icon for its class.
 *
 * The class is read from the resource itself rather than from the tab's `isTreasure` flag,
 * because the two are not the same question: the same resource is an empire resource in one
 * age and a treasure one in the next, and the game keeps a third class for treasure coming
 * from distant lands.
 */
function classBadge(resource) {
    const background = resourceClassBackground(resource?.type);
    if (!background) {
        return null;
    }
    const badge = makeElement('div', `${CLASS}-card__badge`);
    badge.style.backgroundImage = background;
    return badge;
}

/**
 * The card's tooltip: the game's own wording, then where the resource comes from.
 *
 * ⚠️ Line breaks need BOTH a newline character and `white-space: pre-wrap` on the tooltip
 * - see TOOLTIP_TEXT_SELECTOR. Two attempts failed for the same underlying reason: the
 * renderer does `element.innerHTML = Locale.stylize(content)` into a bare div, so a newline
 * collapses to a space the way any whitespace does in HTML, and the game's own `[N]` marker
 * resolves to that same newline rather than to a <br>. Nothing about the text can force the
 * break; the CSS has to allow it.
 *
 * The origins are rebuilt from `resourceOriginData` rather than taken from the model's
 * ready-made `tooltips`, because those were already stylised into one blob per leader -
 * fine where the game puts them, unusable once they have to be laid out differently.
 */
function descriptionFor(resource) {
    return (resource.description ?? []).map((key) => Locale.compose(key));
}

/**
 * Where the copies came from: a leader per line, that leader's settlements indented
 * beneath - a run of names separated by commas stops being readable at about three.
 *
 * Returned as lines rather than a string because the two tooltips need different
 * separators: the game's component stylises its text, so it wants the game's own `[N]`,
 * while the plain-text fallback needs a real newline. See TOOLTIP_TEXT_SELECTOR.
 */
function originLines(resource) {
    const origins = [];
    for (const originData of resource.resourceOriginData ?? []) {
        const leader = Players.get(originData.leaderId);
        if (!leader) {
            continue;
        }
        origins.push(`${Locale.compose(leader.name)}:`);
        for (const city of Object.values(originData.resourceOriginCities ?? {})) {
            origins.push(
                `        ${Locale.compose(
                    'LOC_COMMERCE_EMPIRE_ORIGIN_CITY_CONTRIBUTION_COUNTER',
                    city.contributionCount,
                    city.localisedName,
                )}`,
            );
        }
    }
    return origins;
}

/**
 * One card per leader for the tooltip: their face, their total, and their settlements.
 *
 * The same data `originLines` lays out as text, shaped for the framed tooltip instead - the
 * leader's own total in the heading, because with eight settlements listed "how many come
 * from this one leader" is arithmetic the reader should not have to do.
 */
function originGroups(resource) {
    const groups = [];
    for (const originData of resource.resourceOriginData ?? []) {
        const leader = Players.get(originData.leaderId);
        if (!leader) {
            continue;
        }
        const cities = Object.values(originData.resourceOriginCities ?? {});
        const total = cities.reduce((sum, city) => sum + (city.contributionCount ?? 0), 0);
        groups.push({
            leaderId: originData.leaderId,
            title: `${Locale.compose(leader.name)}: ${total}`,
            lines: cities.map((city) =>
                Locale.compose(
                    'LOC_COMMERCE_EMPIRE_ORIGIN_CITY_CONTRIBUTION_COUNTER',
                    city.contributionCount,
                    city.localisedName,
                ),
            ),
        });
    }
    return groups;
}

/** The plain-text tooltip, used only when the game's own component will not mount. */
function tooltipFor(resource) {
    const lines = descriptionFor(resource);
    const origins = originLines(resource);
    if (origins.length) {
        lines.push('', `${Locale.compose('LOC_COMMERCE_EMPIRE_RESOURCES_ORIGIN_TITLE')}:`, '', ...origins);
    }
    return lines.join('\n');
}

/** The icon standing for what a total affects; the legend line repeats it as its key. */
function iconFor(total) {
    return total.kind === 'combat' ? COMBAT_ICON : yieldIcon(total.kind === 'percent' ? PRODUCTION_YIELD : total.yieldType);
}

/** The words saying what a total is for, or '' when the number speaks for itself. */
function labelFor(total) {
    return total.kind === 'combat' ? (total.units ?? []).join(', ') : (total.towards ?? []).join(', ');
}

function totalElement(total, useOneCopy) {
    const element = makeElement('div', `${CLASS}-total`);
    const value = makeElement('div', '');
    const shown = useOneCopy ? total.perCopy : total.amount;
    value.textContent = total.kind === 'percent' ? `+${shown}%` : `+${shown}`;
    element.appendChild(value);

    const icon = makeElement('div', `${CLASS}-total__icon`);
    const source = iconFor(total);
    if (source) {
        icon.style.backgroundImage = `url(${source})`;
        element.appendChild(icon);
    }

    if (total.active === false) {
        element.classList.add(`${CLASS}-total--inactive`);
        element.setAttribute('data-tooltip-content', Locale.compose(CELEBRATION_TOOLTIP));
    }

    if (total.capped && !useOneCopy) {
        element.classList.add(`${CLASS}-total--capped`);
        // The description says so too; this is the same fact where the number is.
        element.setAttribute('data-tooltip-content', Locale.compose(CAPPED_TOOLTIP));
    }
    return element;
}

/** One line of totals, optionally labelled and read as a single copy's worth. */
/**
 * The figures, built as COLUMNS rather than as two rows.
 *
 * ⚠️ This is the whole trick, and it is not decoration: laid out as rows, the second
 * figure starts wherever the first one happened to end, so "+18" above "+144" pushed
 * everything after it out of line and no two plus signs sat under each other.
 *
 * A column per figure fixes it by construction. Each column is as wide as its widest
 * cell, both cells start at the column's left edge, and the plus signs line up whatever
 * the numbers are - no measuring, no guessed widths, nothing to re-tune when a bonus
 * reaches four digits.
 *
 * CSS grid would express this directly. Deliberately not used: `display: grid` appears
 * nowhere in the entire shipped game, so nothing says this renderer implements it, and
 * this layout is not the place to find out.
 */
function figuresBlock(computed, scales) {
    const block = makeElement('div', `${CLASS}-card__figures`);
    const lines = scales
        ? [
              { useOneCopy: true, labelKey: 'LOC_NAJANE_COMMERCE_EMPIRE_ONE' },
              { useOneCopy: false, labelKey: 'LOC_NAJANE_COMMERCE_EMPIRE_ALL' },
          ]
        : [{ useOneCopy: false, labelKey: null }];

    // One copy's worth reads as the smaller fact; the empire's total is the answer.
    const emphasis = (line) =>
        line.labelKey ? ` ${CLASS}-cell--${line.useOneCopy ? 'one' : 'all'}` : '';

    if (lines[0].labelKey) {
        const labels = makeElement('div', `${CLASS}-card__figures-col`);
        for (const line of lines) {
            const label = makeElement('div', `${CLASS}-card__label${emphasis(line)}`);
            label.textContent = `${Locale.compose(line.labelKey)}:`;
            labels.appendChild(label);
        }
        block.appendChild(labels);
    }

    for (const total of computed) {
        const column = makeElement('div', `${CLASS}-card__figures-col`);
        for (const line of lines) {
            const cell = totalElement(total, line.useOneCopy);
            for (const name of emphasis(line).trim().split(' ').filter(Boolean)) {
                cell.classList.add(name);
            }
            column.appendChild(cell);
        }
        block.appendChild(column);
    }
    return block;
}

/**
 * One line per bonus that needs words, keyed by the icon beside its number.
 *
 * ⚠️ The icon alone is only a key while the icons DIFFER. Two production percentages in
 * one card would both show the production icon and the reader could not tell which line
 * belonged to which number, so in that case the figure goes into the line as well. Coal
 * and Oil - a percentage plus a combat bonus - do not hit this, but nothing in the data
 * promises that.
 */
function legendFor(computed) {
    const labelled = computed.filter((total) => labelFor(total));
    if (!labelled.length) {
        return null;
    }
    const icons = labelled.map(iconFor);
    const ambiguous = new Set(icons).size !== icons.length;

    const legend = makeElement('div', `${CLASS}-card__legend`);
    labelled.forEach((total, index) => {
        const item = makeElement('div', `${CLASS}-card__legend-item`);
        if (icons[index]) {
            const icon = makeElement('div', `${CLASS}-card__legend-icon`);
            icon.style.backgroundImage = `url(${icons[index]})`;
            item.appendChild(icon);
        }
        const text = makeElement('div', `${CLASS}-card__legend-text`);
        const label = labelFor(total);
        const shown = total.kind === 'percent' ? `+${total.amount}%` : `+${total.amount}`;
        text.textContent = ambiguous ? `${shown}  ${label}` : label;
        item.appendChild(text);
        legend.appendChild(item);
    });
    return legend;
}

function cardFor(resource, settlements, computed) {
    const card = makeElement('div', `${CLASS}-card`);
    // The game's own card background, so these read as the same object as the trade cards.
    const inner = makeElement('div', `${CLASS}-card__inner card-frame-bg`);

    const head = makeElement('div', `${CLASS}-card__head`);
    const icon = makeElement('div', `${CLASS}-card__icon`);
    if (resource.iconSrc) {
        icon.style.backgroundImage = resource.iconSrc;
    }
    /*
     * The little badge that says whether this is an empire resource or a treasure one -
     * the same mark the unassigned pool puts on its slots. The game builds it as
     * `url(blp:${UI.getIconBLP(classType)})` from the resource's class; see
     * getResourcePropsFromDefinition in commerce-screen-model.js.
     */
    const badge = classBadge(resource);
    if (badge) {
        icon.appendChild(badge);
    }

    // One element, so the count is in the settlement name's own typeface rather than
    // whatever a second element happened to inherit.
    const title = makeElement('div', `${CLASS}-card__title font-title`);
    title.textContent = `${Locale.compose(resource.title)} [${resource.amount}]`;
    /*
     * The game's own framed tooltip, so a resource looks the same object here as it does in
     * the unassigned pool. The origins go into its "Origin:" line, which is the one free
     * text slot it has - the game puts a single city name there, and there is more to say
     * about a pile gathered from several leaders.
     */
    appendWithResourceTooltip(
        head,
        icon,
        resourceTooltipProps(resource.type, { description: descriptionFor(resource).join('[N]') }),
        tooltipFor(resource),
        originGroups(resource),
    );
    head.appendChild(title);

    /*
     * Both readings whenever the bonus grows with copies - including at one copy, where
     * they read the same. The rows were hidden in that case at first, on the grounds that
     * an identical pair says nothing; shown, they say something else, which is that this
     * resource is worth stockpiling and what the next copy would be worth. The cards also
     * stop changing shape as the empire grows.
     *
     * A bonus that does NOT grow with copies still gets a single line, with the note under
     * it saying so - there the two rows would claim a distinction the game does not make.
     */
    const scales = computed.some((total) => total.scales);
    appendAll(inner, head);
    if (computed.length) {
        // The whole block is centred as one; see figuresBlock for how the columns inside
        // keep the plus signs under each other.
        inner.appendChild(figuresBlock(computed, scales));
        if (!scales && resource.amount > 1) {
            // Why this card has one line where its neighbours have two. Worth saying: it
            // is the difference between a resource worth stockpiling and one that is not.
            const note = makeElement('div', `${CLASS}-card__note`);
            note.textContent = Locale.compose('LOC_NAJANE_COMMERCE_EMPIRE_NO_SCALING');
            inner.appendChild(note);
        }
    }
    const legend = legendFor(computed);
    if (legend) {
        inner.appendChild(legend);
    }
    if (computed.length === 0) {
        /*
         * Nothing this module knows how to add up - say what the game says instead.
         *
         * ⚠️ `Locale.stylize`, set as `innerHTML` - NOT `Locale.compose` into `textContent`.
         * A resource's own description carries the game's markup (`[icon:...]`,
         * `[TIP:...]...[/tip]`), and `compose` only resolves the localisation key; it does
         * not touch that markup at all. Read into `textContent` it printed as literal
         * bracketed text instead of an icon and a tooltip - reported as "missing labels on
         * Hardwood", back when this effect had no branch in empire-effects.js and fell all
         * the way through to here. `innerHTML = Locale.stylize(...)` is the same call the
         * game's own tooltip renderer makes for exactly this kind of text; see the note on
         * `descriptionFor` for why the CSS also needs `white-space: pre-wrap`.
         *
         * The strings come from GameInfo.Types/LOC_* keys the game ships, never from a
         * player, so there is nothing here for that HTML to inject.
         */
        const fallback = makeElement('div', `${CLASS}-card__fallback`);
        fallback.innerHTML = Locale.stylize(descriptionFor(resource).join('[N]'));
        inner.appendChild(fallback);
    }
    card.appendChild(inner);
    return card;
}

/**
 * What every empire resource adds up to, by yield.
 *
 * Only yields. Combat strength is left out because it is not income and does not add up -
 * "+6 to siege units" and "+3 to cavalry" are not +9 of anything. Percentages towards
 * buildings are left out for the same reason.
 */
function summariseYields(perResource) {
    const byYield = new Map();
    for (const totals of perResource) {
        for (const total of totals) {
            // A Celebration-only bonus is income during a Celebration and not otherwise;
            // adding it in at all times would overstate the empire's actual income.
            if (total.kind !== 'yield' || !total.yieldType || total.active === false) {
                continue;
            }
            byYield.set(total.yieldType, (byYield.get(total.yieldType) ?? 0) + total.amount);
        }
    }
    return byYield;
}

/** The line above the tabs: everything the empire's resources are worth per turn. */
function buildSummary(byYield) {
    const bar = makeElement('div', SUMMARY_CLASS);
    const label = makeElement('div', `${SUMMARY_CLASS}__label font-title`);
    label.textContent = `${Locale.compose('LOC_NAJANE_COMMERCE_EMPIRE_INCOME')}:`;
    bar.appendChild(label);

    for (const [yieldType, amount] of byYield) {
        if (!amount) {
            continue;
        }
        const entry = makeElement('div', `${CLASS}-total`);
        const value = makeElement('div', '');
        value.textContent = `+${amount}`;
        entry.appendChild(value);

        const icon = makeElement('div', `${CLASS}-total__icon`);
        const source = yieldIcon(yieldType);
        if (source) {
            icon.style.backgroundImage = `url(${source})`;
            entry.appendChild(icon);
        }
        bar.appendChild(entry);
    }
    return bar;
}

/**
 * Puts the summary in the tab row, to the left of the tabs.
 *
 * That row belongs to the screen rather than to this tab, so it is emptied of ours first:
 * a tab can be left and re-entered, and the row would otherwise collect a summary per
 * visit. Removed again on cleanup - see the container below.
 */
function showSummary(byYield) {
    showTabSummary(SUMMARY_CLASS, () => buildSummary(byYield));
}

export function hideSummary() {
    hideTabSummary(SUMMARY_CLASS);
}

function render(host, model) {
    clearChildren(host);
    forgetEmpireEffects();

    const resources = model?.data?.empireTabData?.empireResourceData ?? [];
    // Read once for the whole tab: the totals all measure against the same empire.
    const settlements = buildSettlements();

    /*
     * Two containers, not one flowing list: everything with a combat bonus goes down the
     * first column and the rest fill the other three. A single wrapping list cannot do
     * that - it places cards in the order they come and the combat ones land wherever
     * they happen to fall.
     */
    const combatColumn = makeElement('div', `${CLASS}-combat`);
    const restColumns = makeElement('div', `${CLASS}-rest`);
    appendAll(host, combatColumn, restColumns);

    const perResource = [];
    for (const resource of resources) {
        try {
            const computed = empireEffectTotals(resource.type, resource.amount, settlements);
            perResource.push(computed);
            const isCombat = computed.some((total) => total.kind === 'combat');
            const column = isCombat ? combatColumn : restColumns;
            column.appendChild(cardFor(resource, settlements, computed));
        } catch (error) {
            warn(`could not build a card for ${resource?.type}: ${error}`);
        }
    }
    showSummary(summariseYields(perResource));
    log(`empire tab: ${resources.length} resource(s) totalled`);
}

const listTemplate = template(`<div class="najane-empire-list"></div>`);

export const EmpireResourcesContainer = () => {
    const model = useCommerceScreenContext();

    return createComponent(CommerceScreenBaseTabContent, {
        title: 'LOC_COMMERCE_EMPIRE_RESOURCE_TITLE',
        description: 'LOC_COMMERCE_EMPIRE_RESOURCES_DESCRIPTION',
        get children() {
            const host = listTemplate();
            ensureStyle(STYLE_ID, STYLE);
            onCleanup(hideSummary);
            onMount(() => {
                try {
                    render(host, model);
                } catch (error) {
                    warn(`building the empire tab failed: ${error}`);
                }
            });
            return host;
        },
    });
};
