/**
 * The Treasure Convoys tab: three columns, and no settlements that were never in the race - the
 * game lists every settlement, including homeland ones that cannot generate treasure at all.
 */
import { createComponent, onCleanup, onMount } from '/core/vendor/solid-js/dist/solid.js';
import { commerceTabRow } from './screen-parts.js';
import { L10n } from '/core/ui-next/components/l10n.js';
import { TreasureResourceContainer } from '/base-standard/ui-next/screens/commerce/commerce-screen-treasure-tab.js';

import { HELP_CLASS, HELP_STYLE, makeHelpMark } from './help-mark.js';
import { SWITCH_CLASS, SWITCH_STYLE, makeSwitch } from './switch-control.js';
import {
    isTreasureAutoReturnEnabled,
    setTreasureAutoReturnEnabled,
} from '../engine/treasure-return-setting.js';
import { disposeFramedTooltips } from './framed-tooltip.js';
import { appendAll, ensureStyle, makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/** The tab strip; its parent is the positioned row this tab hangs its "?" in. */

const STYLE_ID = 'najane-treasure-tab-style';

/** Holds the "?" and the auto-return switch together at the left end of the tab row. */
const LEFT_ROW_CLASS = 'najane-treasure-controls';

/** ⚠️ Its OWN scope: these controls are torn down every time the tab is left. */
const TOOLTIP_SCOPE = 'treasure-tab';

/** The card's outer element. Only these cards exist while this tab is the one open. */
const CARD_SELECTOR = '.focusable-card-activatable';
/** The panel inside it, recognised by the fixed size the game gives it. */
const PANEL_SELECTOR = '.w-128.min-h-64';

const STYLE = `
${CARD_SELECTOR} {
    box-sizing: border-box;
    display: flex;
    width: 33.3333%;
    /*
     * The gap between columns, and it lives INSIDE the third - as padding on a border-box -
     * so the three still add up to the full width. As a margin it would push the third card
     * onto the next row, which is why the frame's own mr-6 had to go.
     */
    padding: 0 0.45rem;
}
${PANEL_SELECTOR} {
    box-sizing: border-box !important;
    width: 100% !important;
    margin-right: 0 !important;
}
${HELP_STYLE}
${SWITCH_STYLE}
/*
 * The same anchor the other tabs use for their own left-hand additions - the tab row is
 * positioned, and the tab strip is centred in it, so the left end is free.
 *
 * ⚠️ ONE positioned row holding both, rather than two absolute elements at two hand-picked
 * offsets. The "?" is a fixed 2.4rem, but the switch beside it is a translated caption whose
 * width is not knowable from here - it is half again as long in German as in English - so a
 * left offset computed for one language would either overlap the mark or leave a gap in the
 * others. A flex row lays them out from the same left edge in every language.
 */
.${LEFT_ROW_CLASS} {
    position: absolute;
    left: 2rem;
    top: 0.15rem;
    z-index: 20;
    display: flex;
    flex-direction: row;
    /* The switch is 1.15rem tall and the mark 2.4rem; this centres it against the mark. */
    align-items: center;
    pointer-events: auto;
}
/* Inside the row now, so it drops the absolute positioning it carries on other tabs. */
.${LEFT_ROW_CLASS} .${HELP_CLASS} { position: static; }
.${LEFT_ROW_CLASS} .${SWITCH_CLASS}-mount { margin-left: 0.9rem; }
`;

/**
 * The two controls at the left end of the tab row: the "?" explaining what a click on a card does,
 * and the auto-return switch. They go in the tab ROW, which belongs to the screen rather than to
 * this tab, so leaving and re-entering must not leave a second copy behind.
 */
function showTabControls() {
    const row = commerceTabRow();
    if (!row || row.querySelector(`.${LEFT_ROW_CLASS}`)) {
        return;
    }
    const controls = makeElement('div', LEFT_ROW_CLASS);
    // ⚠️ `appendAll`, not `appendChild`: `makeHelpMark` answers with nothing when this mod's
    // tooltips are switched off, and a mark that hovers to nothing is worse than none.
    appendAll(
        controls,
        makeHelpMark(
            'LOC_NAJANE_COMMERCE_TREASURE_CLICK_TOOLTIP',
            'LOC_NAJANE_COMMERCE_TREASURE_CLICK',
            TOOLTIP_SCOPE,
        ),
    );
    controls.appendChild(
        makeSwitch({
            label: 'LOC_NAJANE_COMMERCE_TREASURE_AUTO_RETURN',
            tooltip: 'LOC_NAJANE_COMMERCE_TREASURE_AUTO_RETURN_TOOLTIP',
            isOn: isTreasureAutoReturnEnabled,
            setOn: setTreasureAutoReturnEnabled,
            scope: TOOLTIP_SCOPE,
        }),
    );
    row.appendChild(controls);
}

function hideTabControls() {
    // ⚠️ Before the elements go, and only OUR scope. A frame outliving the control it is
    // anchored to is drawn in the top-left corner of the screen; see `TOOLTIP_SCOPE`.
    disposeFramedTooltips(TOOLTIP_SCOPE);
    document.querySelectorAll(`.${LEFT_ROW_CLASS}`).forEach((element) => element.remove());
}

/** What a convoy is worth, as two figures instead of a sentence. */
function convoySummary(fleet) {
    try {
        const resources = Cities.get(fleet.cityID)?.Resources;
        const gold = resources?.getProducedTreasureFleetGold() ?? 0;
        const gdp = resources?.getProducedTreasureFleetGDP() ?? 0;
        return L10n.Stylize({
            text: `+${gold} [icon:YIELD_GOLD]   +${gdp} [icon:ECONOMIC_VP]`,
            'data-tooltip-content': Locale.compose('LOC_NAJANE_COMMERCE_TREASURE_ON_ARRIVAL'),
        });
    } catch (error) {
        warn(`could not summarise a treasure convoy: ${error}`);
        return fleet.treasureFleetText;
    }
}

/**
 * Drops homeland settlements from the "not generating" list - they never could, so listing them as
 * a shortfall is noise.
 */
export function withoutHomelandIdlers(treasureTabData) {
    const sections = treasureTabData?.sections;
    if (!sections) {
        return treasureTabData;
    }
    return {
        ...treasureTabData,
        sections: sections.map((section) => {
            const fleets = (section.generatingConvoys === false
                ? (section.fleets ?? []).filter((fleet) => fleet.isDistantLand)
                : section.fleets ?? []
            ).map((fleet) => ({ ...fleet, treasureFleetText: convoySummary(fleet) }));
            return { ...section, fleets };
        }),
    };
}

export const TreasureConvoysContainer = (props) => {
    let styleElement = null;

    onMount(() => {
        styleElement = ensureStyle(STYLE_ID, STYLE);
        showTabControls();
    });
    // Scoped by lifetime rather than by selector: the rules above are written for these
    // cards and would reach others, so they exist only while this tab does.
    onCleanup(() => {
        hideTabControls();
        styleElement?.remove();
        styleElement = null;
    });

    return createComponent(TreasureResourceContainer, props);
};
