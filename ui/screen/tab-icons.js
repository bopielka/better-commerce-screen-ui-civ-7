/**
 * Icons instead of words on the tab strip, with the original label as the tooltip.
 *
 * Tabs render in the order they are declared and nothing on a tab element says which one
 * it is, so position is the identity here - and which tab sits in which position depends
 * on the age. See tabIcons().
 *
 * The BLP names are the game's own, read out of base-standard/data/icons/. Two of them
 * are already used by this very screen (`restype_empire_v2` and the treasure icon appear
 * on the Empire tab's cards), and the same set is what Trade Chooser Improvements draws
 * its resource-class filters from.
 *
 * The label is read for the tooltip and then its text nodes are removed. Collapsing them
 * with `font-size: 0` was the first attempt and it did nothing: tab labels carry
 * `font-fit-shrink`, which is `coh-font-fit-mode: shrink` - the engine sizes that text
 * itself and ignores the declared size. The rule is kept anyway, since it costs nothing
 * and covers a label that reappears before the observer gets to it.
 */
import { ensureStyle, makeElement } from '../support/dom.js';
import { isFactoryAge, isExplorationAge } from '../engine/age.js';
import { log, warn } from '../support/diagnostics.js';

const ICON_CLASS = 'najane-tab-icon';
const ICONIFIED_CLASS = 'najane-tab-iconified';
const STYLE_ID = 'najane-tab-icons-style';

const TAB_LIST_SELECTOR = '[data-name="TabList"]';
const TAB_ITEM_SELECTOR = '[data-name="TabListItem"]';

const RESOURCES_ICON = 'blp:radial_resources'; // the green resource leaf
const TRADE_ICON = 'blp:Action_Trade'; // the two arrows
const EMPIRE_ICON = 'blp:restype_empire_v2'; // the orange hexagon
const TREASURE_ICON = 'blp:restype_treasure_v3'; // the gold chest
const FACTORY_ICON = 'blp:restype_factory_v2'; // the cog

/**
 * The icons in the order the tabs render, which depends on the age.
 *
 * Position is the only identity a tab element has, and the fourth slot is not the same
 * tab in every age: Treasure exists in Exploration, the Factory tab this mod adds exists
 * in Modern, and neither exists in Antiquity. A fixed array would have put a treasure
 * chest on the factory tab.
 */
function tabIcons() {
    const icons = [RESOURCES_ICON, TRADE_ICON, EMPIRE_ICON];
    if (isExplorationAge()) {
        icons.push(TREASURE_ICON);
    }
    if (isFactoryAge()) {
        icons.push(FACTORY_ICON);
    }
    return icons;
}

/**
 * What each tab is actually for, in the same order as the icons.
 *
 * The tab's own title is not it. "Resources" does not say that the tab holds city and
 * bonus resources rather than all of them, and the Empire tab holds treasure resources too
 * once the Exploration age reclassifies them - a difference the title never mentions.
 *
 * `null` keeps the tab's own name, which is already exactly right for trade routes.
 */
function tabTooltips() {
    const keys = [
        'LOC_NAJANE_COMMERCE_TAB_RESOURCES',
        null,
        isExplorationAge() ? 'LOC_NAJANE_COMMERCE_TAB_EMPIRE_TREASURE' : 'LOC_NAJANE_COMMERCE_TAB_EMPIRE',
    ];
    if (isExplorationAge()) {
        keys.push('LOC_NAJANE_COMMERCE_TAB_TREASURE');
    }
    if (isFactoryAge()) {
        keys.push('LOC_NAJANE_COMMERCE_TAB_FACTORY');
    }
    return keys;
}

const STYLE = `
.${ICONIFIED_CLASS} {
    /* Belt and braces - the text nodes are removed too, see stripLabel. */
    font-size: 0;
}
.${ICON_CLASS} {
    width: 2rem;
    height: 2rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
`;

let observer = null;
let observedList = null;
let styleElement = null;
let applying = false;

const TEXT_NODE = 3;

/**
 * Softens a SHOUTED label for tooltip use.
 *
 * Two of the tab names are stored in capitals in the localisation itself - the English
 * source for the trade tab is literally "TRADE ROUTES" - which reads as shouting once it
 * is out of the tab strip and inside a tooltip. Anything already mixed-case is left
 * exactly as it is, and so is any script without letter case at all, where uppercase and
 * lowercase are the same string.
 */
function softenCaps(text) {
    if (text !== text.toUpperCase() || text === text.toLowerCase()) {
        return text;
    }
    const lowered = Locale.toLower(text);
    return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/**
 * Takes the words out of a tab, returning what they said.
 *
 * Only bare text nodes are touched - the icon this mod adds is an element, and so is
 * anything else the tab might hold. Solid does not re-render these labels once built
 * (the titles are static strings), but the observer covers it if that ever changes.
 */
function stripLabel(item) {
    let label = '';
    for (const node of Array.from(item.childNodes)) {
        if (node.nodeType !== TEXT_NODE) {
            continue;
        }
        label += node.nodeValue ?? '';
        item.removeChild(node);
    }
    return label.trim();
}

function applyIcons() {
    const list = document.querySelector(TAB_LIST_SELECTOR);
    if (!list) {
        return false;
    }
    const items = Array.from(list.querySelectorAll(TAB_ITEM_SELECTOR));
    if (items.length === 0) {
        return false;
    }
    const icons = tabIcons();
    const tooltips = tabTooltips();

    items.forEach((item, index) => {
        const icon = icons[index];
        if (!icon) {
            // More tabs than we have icons for - leave that one as text rather than
            // guessing, so a future tab is merely unstyled and not blank.
            return;
        }

        // The label is taken out either way - the icon replaces it - but what the tooltip
        // then says is ours, except where the tab's own name already says it best.
        const label = softenCaps(stripLabel(item));
        const key = tooltips[index];
        const tooltip = key ? Locale.compose(key) : label;
        if (tooltip) {
            item.setAttribute('data-tooltip-content', tooltip);
            item.setAttribute('aria-label', tooltip);
        }
        if (item.querySelector(`.${ICON_CLASS}`)) {
            // Already ours; the label above was a stray that came back.
            return;
        }

        const iconElement = makeElement('div', ICON_CLASS);
        iconElement.style.backgroundImage = `url(${icon})`;
        item.appendChild(iconElement);
        item.classList.add(ICONIFIED_CLASS);
    });

    return true;
}

function run() {
    // Appending the icon is a childList change on the very tree being watched.
    if (applying) {
        return false;
    }
    applying = true;
    try {
        return applyIcons();
    } catch (error) {
        warn(`applying tab icons failed: ${error}`);
        return false;
    } finally {
        applying = false;
    }
}

/**
 * Deliberately has no counterpart in the tab's cleanup.
 *
 * The tab strip belongs to the whole screen, not to the Resources tab that starts this;
 * tearing the icons down when that tab unmounts would put the words back the moment the
 * player switched to Trade Routes. Instead the watcher is attached to the tab strip
 * itself, so when the screen closes and that element is discarded the observer stops
 * receiving anything - and reopening the screen re-attaches to the new one.
 */
export function startTabIcons() {
    styleElement = ensureStyle(STYLE_ID, STYLE);

    const list = document.querySelector(TAB_LIST_SELECTOR);
    if (!list) {
        // The screen's content is behind a Suspense boundary and may not be built yet.
        // Watch broadly, just long enough to catch the strip appearing.
        if (!observer) {
            observer = new MutationObserver(() => {
                if (document.querySelector(TAB_LIST_SELECTOR)) {
                    observer?.disconnect();
                    observer = null;
                    startTabIcons();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        }
        return;
    }

    if (observedList === list) {
        run();
        return;
    }

    observer?.disconnect();
    observedList = list;
    if (run()) {
        log('tab icons applied');
    }
    // Switching tabs re-renders the items, which drops our icon - so keep watching.
    observer = new MutationObserver(run);
    observer.observe(list, { childList: true, subtree: true });
}

/**
 * There is deliberately no stopTabIcons(): the tab strip outlives any single tab, and
 * the icons are re-applied by the observer whenever it is rebuilt. One existed, was never
 * called, and would have removed the icons from a strip that was still on screen.
 */
