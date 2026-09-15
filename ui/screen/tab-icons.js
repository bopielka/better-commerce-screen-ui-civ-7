/**
 * Icons instead of words on the tab strip, with the original label as the tooltip - the strip is
 * 30rem wide (layout.js) and five worded tabs do not fit.
 *
 * ⚠️ Attached to the tab STRIP, not to any tab: the strip outlives the Resources tab that starts
 * this, so tearing the icons down on that tab's cleanup would put the words back the moment the
 * player switched to Trade Routes.
 */
import { appendWithFramedTooltip, disposeFramedTooltips } from './framed-tooltip.js';
import { watchCommerceScreen } from './screen-observer.js';
import { COMMERCE_SCREEN_SELECTOR, TAB_LIST_SELECTOR } from './screen-parts.js';
import { ensureStyle, makeElement } from '../support/dom.js';
import { isFactoryAge, isExplorationAge } from '../engine/age.js';
import { log, warn } from '../support/diagnostics.js';

const ICON_CLASS = 'najane-tab-icon';
const ICONIFIED_CLASS = 'najane-tab-iconified';
const STYLE_ID = 'najane-tab-icons-style';

const TAB_ITEM_SELECTOR = '[data-name="TabListItem"]';

/**
 * The sliding underline beneath the active tab, and the item it is under.
 *
 * ⚠️ IT IS POSITIONED FROM A MEASUREMENT TAKEN ONCE. `TabList` sets its `left` and `width` from
 * `getBoundingClientRect` inside an effect that wakes only when the ACTIVE TAB changes - swapping
 * a word for an icon changes every item's width and wakes nothing, so the underline stayed where
 * the words had been. Visible as a bar sitting crooked under the strip.
 *
 * ⚠️ The selected item is the one carrying `text-secondary`; `TabListItem` toggles exactly that
 * class on `selected`, and the alternative - an index - would be wrong in the ages where the tab
 * list is a different length.
 */
const INDICATOR_SELECTOR = '.img-tab-selection-indicator';
const SELECTED_ITEM_SELECTOR = `${TAB_ITEM_SELECTOR}.text-secondary`;

/**
 * ⚠️ One pending realignment however many callers ask: each extra frame read two rects after the
 * previous one's writes, in the same frame, for the same answer.
 */
let realignFrame = null;

/**
 * Puts the underline back under the tab it belongs to, after the icons have changed the widths.
 *
 * ⚠️ On the NEXT FRAME: the icon has only just been appended, so the layout the widths come from
 * has not been done yet and every rect would still be the one the words produced.
 *
 * ⚠️ The same two inline properties `TabList` writes itself, so when its own effect next runs it
 * simply overwrites these with the same answer. Nothing is left fighting.
 */
function realignIndicator() {
    if (realignFrame !== null) {
        return;
    }
    realignFrame = requestAnimationFrame(() => {
        realignFrame = null;
        try {
            const list = document.querySelector(TAB_LIST_SELECTOR);
            const indicator = list?.querySelector(INDICATOR_SELECTOR);
            const selected = list?.querySelector(SELECTED_ITEM_SELECTOR);
            if (!list || !indicator || !selected) {
                return;
            }
            const listRect = list.getBoundingClientRect();
            const itemRect = selected.getBoundingClientRect();
            if (!itemRect.width) {
                return;
            }
            indicator.style.left = `${itemRect.left - listRect.left}px`;
            indicator.style.width = `${itemRect.width}px`;
        } catch (error) {
            warn(`could not realign the tab indicator: ${error}`);
        }
    });
}

/**
 * ⚠️ One scope PER TAB, and never the default one. The strip is rebuilt tab by tab, and a framed
 * tooltip left mounted around a discarded element floats to the top-left corner of the screen.
 * Disposing the DEFAULT scope to avoid that would take every other tab's tooltips with it.
 */
const TOOLTIP_SCOPE = 'tab-icons';

const RESOURCES_ICON = 'blp:radial_resources'; // the green resource leaf
const TRADE_ICON = 'blp:Action_Trade'; // the two arrows
const EMPIRE_ICON = 'blp:restype_empire_v2'; // the orange hexagon
const TREASURE_ICON = 'blp:restype_treasure_v3'; // the gold chest
const FACTORY_ICON = 'blp:restype_factory_v2'; // the cog

/** The icons in the order the tabs render, which depends on the age. */
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

/** One short line per tab saying what is ON that screen. */
function tabDescriptions() {
    const keys = [
        'LOC_NAJANE_COMMERCE_TAB_RESOURCES_DESC',
        'LOC_NAJANE_COMMERCE_TAB_TRADE_DESC',
        isExplorationAge()
            ? 'LOC_NAJANE_COMMERCE_TAB_EMPIRE_TREASURE_DESC'
            : 'LOC_NAJANE_COMMERCE_TAB_EMPIRE_DESC',
    ];
    if (isExplorationAge()) {
        keys.push('LOC_NAJANE_COMMERCE_TAB_TREASURE_DESC');
    }
    if (isFactoryAge()) {
        keys.push('LOC_NAJANE_COMMERCE_TAB_FACTORY_DESC');
    }
    return keys;
}

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
/*
 * ⚠️ The icon is INTERACTIVE now, where it used to be "pointer-events: none".
 *
 * A framed tooltip is opened by its trigger receiving "mouseover", and an element that takes
 * no pointer events never receives one - so the icon had to become the thing the cursor is
 * actually over. Activating the tab still works: the click lands on the icon and bubbles to
 * the tab item, whose Activatable is listening there, exactly as it did when the label was
 * text. Nothing here binds or stops the event.
 */
.${ICON_CLASS} {
    width: 2rem;
    height: 2rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: auto;
}
.${ICON_CLASS}-mount { display: flex; flex: 0 0 auto; }
`;

let observer = null;
/** Live only while waiting for the tab strip to be rendered; see startTabIcons. */
let unwatchBootstrap = null;
let observedList = null;
let applying = false;

const TEXT_NODE = 3;

/** Softens a SHOUTED label for tooltip use - the strip shouts, a tooltip should not. */
function softenCaps(text) {
    if (text !== text.toUpperCase() || text === text.toLowerCase()) {
        return text;
    }
    const lowered = Locale.toLower(text);
    return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}

/** Takes the words out of a tab, returning what they said. */
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

/** @returns whether an icon was put in - the only change that moves the tabs' widths. */
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
    let tooltips = null;
    let descriptions = null;
    let appended = false;

    items.forEach((item, index) => {
        const icon = icons[index];
        if (!icon) {
            // More tabs than we have icons for - leave that one as text rather than
            // guessing, so a future tab is merely unstyled and not blank.
            return;
        }

        // The label is taken out either way - the icon replaces it.
        const stripped = stripLabel(item);
        if (item.querySelector(`.${ICON_CLASS}`)) {
            // ⚠️ Already ours, so its aria-label was written when the icon went in and the label
            // was a stray that came back. Nothing is composed: this runs on every strip mutation.
            return;
        }

        // What the tooltip says is ours, except where the tab's own name already says it best.
        tooltips ??= tabTooltips();
        descriptions ??= tabDescriptions();
        const label = softenCaps(stripped);
        const key = tooltips[index];
        const tooltip = key ? Locale.compose(key) : label;
        if (tooltip) {
            // ⚠️ No `data-tooltip-content` any more - the framed tooltip below replaces it, and
            // leaving this would draw a second, plain tooltip alongside the frame.
            item.setAttribute('aria-label', tooltip);
        }

        const iconElement = makeElement('div', ICON_CLASS);
        iconElement.style.backgroundImage = `url(${icon})`;

    // ⚠️ The FRAMED tooltip, as everywhere else in this mod - not `data-tooltip-content`, which
    // draws a bare box beside controls that draw a frame.
        const scope = `${TOOLTIP_SCOPE}:${index}`;
        disposeFramedTooltips(scope);
        const mount = makeElement('div', `${ICON_CLASS}-mount`);
    // ⚠️ Heading = the tab's NAME, body = what is on it. Never the same words twice.
        const description = descriptions[index];
        appendWithFramedTooltip(mount, iconElement, {
            scope,
            title: key ?? tooltip,
            text: description ? Locale.compose(description) : tooltip,
        });
        item.appendChild(mount);
        item.classList.add(ICONIFIED_CLASS);
        appended = true;
    });

    return appended;
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
 * ⚠️ Deliberately has no counterpart in the tab's cleanup; see the header. The watcher is attached
 * to the strip itself, so reopening the screen re-attaches; the screen's own cleanup lets go of the
 * closed one through `releaseTabIcons`.
 */
export function startTabIcons() {
    ensureStyle(STYLE_ID, STYLE);

    const list = document.querySelector(TAB_LIST_SELECTOR);
    if (!list) {
        /*
         * The content is behind a Suspense boundary and may not be built yet, so wait for the
         * strip. ⚠️ On the SHARED screen watcher, and it gives up when the screen goes away: its
         * own `document.body` observer had only one way out - finding the strip - so closing the
         * screen early left it watching the whole HUD for the rest of the session.
         */
        if (!unwatchBootstrap) {
            unwatchBootstrap = watchCommerceScreen(() => {
                if (!document.querySelector(COMMERCE_SCREEN_SELECTOR)) {
                    unwatchBootstrap?.();
                    unwatchBootstrap = null;
                    return;
                }
                if (document.querySelector(TAB_LIST_SELECTOR)) {
                    unwatchBootstrap?.();
                    unwatchBootstrap = null;
                    startTabIcons();
                }
            });
        }
        return;
    }
    if (unwatchBootstrap) {
        unwatchBootstrap();
        unwatchBootstrap = null;
    }

    if (observedList === list) {
        run();
        realignIndicator();
        return;
    }

    observer?.disconnect();
    observedList = list;
    if (run()) {
        log('tab icons applied');
    }
    // ⚠️ Every time, not only on the first pass: switching tabs re-renders the items, and the
    // observer below re-applies the icons - which moves the widths again.
    realignIndicator();
    // Switching tabs re-renders the items, which drops our icon - so keep watching. Realigned only
    // when an icon went back in, the one change here that moves the widths.
    observer = new MutationObserver(() => {
        if (run()) {
            realignIndicator();
        }
    });
    observer.observe(list, { childList: true, subtree: true });
}

/**
 * Lets go of the strip of a screen that has CLOSED: its watcher, and the tooltip roots built for its
 * icons, which live outside Solid's tree and held the whole closed screen until the next opening.
 *
 * ⚠️ Only a strip already OUT OF THE DOCUMENT, and only from the SCREEN's cleanup (factory-tab.js),
 * never a tab's - nothing live is stripped. A screen reopened first has made its own strip
 * `observedList` and is left alone. `=== false` keeps everything on an engine without `isConnected`.
 */
export function releaseTabIcons() {
    if (unwatchBootstrap && !document.querySelector(COMMERCE_SCREEN_SELECTOR)) {
        unwatchBootstrap();
        unwatchBootstrap = null;
    }
    if (!observedList || observedList.isConnected !== false) {
        return;
    }
    observer?.disconnect();
    observer = null;
    observedList = null;
    disposeFramedTooltips(TOOLTIP_SCOPE);
}

/** ⚠️ No stopTabIcons(): one existed, was never called, and would have stripped a live strip. */
