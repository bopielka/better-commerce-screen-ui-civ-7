/**
 * Making an injected element clickable.
 *
 * ⚠️ The screen's own `Activatable` reacts to the engine's `mousebutton-left` action, which a
 * plain injected div never receives. Native DOM events do arrive, so this mod wires those - and
 * stops them, or the settlement card underneath treats the click as "assign here".
 */
import { areModTooltipsHidden } from '../engine/tooltip-setting.js';

const REPEAT_GUARD_MS = 150;

export function bindActivatable(element, activate) {
    if (!element.getAttribute('role')) {
        element.setAttribute('role', 'button');
    }
    if (!element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '0');
    }
    element.setAttribute('data-activatable', 'true');

    let lastActivation = 0;
    const run = (event) => {
        event.stopPropagation();
        const now = Date.now();
        // A click can arrive twice (mouse and touch); the second one is not a second press.
        if (now - lastActivation < REPEAT_GUARD_MS) {
            event.preventDefault?.();
            return;
        }
        lastActivation = now;
        activate(event);
        // Let focus go again if anything did put it here.
        element.blur?.();
    };

    element.addEventListener('click', run);
    element.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        // ⚠️ Keep the press from moving DOM focus here. The screen lights up the surroundings of
        // whatever holds focus - which is why clicking the priority picker used to wash the
        // filters, the card and the picker itself in yellow.
        event.preventDefault();
    });
    element.addEventListener('mouseup', (event) => event.stopPropagation());
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            run(event);
        }
    });
}

/** ⚠️ This DOM has no `replaceChildren` - calling it throws. Empty containers by hand. */
export function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

/**
 * ⚠️ Only the older `appendChild` can be relied on here, and a falsy child is SKIPPED rather
 * than appended: `makeHelpMark` answers null when this mod's tooltips are off, and every caller
 * of it appends through here.
 */
export function appendAll(parent, ...children) {
    for (const child of children) {
        if (!child) {
            continue;
        }
        parent.appendChild(child);
    }
    return parent;
}

/** Puts a stylesheet in the document once, under an id, and hands the element back. */
export function ensureStyle(id, css) {
    const existing = document.getElementById(id);
    if (existing) {
        return existing;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    return style;
}

/**
 * ⚠️ The mark is what makes `removeModTooltips` safe. Some of these hang on the GAME's own
 * elements - the trade-route card title - so stripping every `data-tooltip-content` on the
 * screen would take the game's own with them.
 */
const TOOLTIP_ATTRIBUTE = 'data-tooltip-content';
const TOOLTIP_ANCHOR_ATTRIBUTE = 'data-tooltip-anchor';
const TOOLTIP_MARK = 'data-najane-tooltip';

/**
 * Hangs one of this mod's plain tooltips on an element, or nothing when they are switched off.
 *
 * ⚠️ THE ONE DOOR for `data-tooltip-content`. It was written out at a dozen call sites across ten
 * files - a dozen places to remember the setting in.
 */
export function setTooltip(element, text, { anchor = null } = {}) {
    if (!element || areModTooltipsHidden()) {
        return;
    }
    if (text === null || text === undefined || text === '') {
        return;
    }
    element.setAttribute(TOOLTIP_ATTRIBUTE, text);
    element.setAttribute(TOOLTIP_MARK, 'true');
    if (anchor) {
        element.setAttribute(TOOLTIP_ANCHOR_ATTRIBUTE, anchor);
    }
}

/**
 * Takes them off again where they already are, so throwing the switch does something at once.
 * The framed ones cannot be undone this way; see screen/framed-tooltip.js.
 */
export function removeModTooltips() {
    for (const element of document.querySelectorAll(`[${TOOLTIP_MARK}]`)) {
        element.removeAttribute(TOOLTIP_ATTRIBUTE);
        element.removeAttribute(TOOLTIP_ANCHOR_ATTRIBUTE);
        element.removeAttribute(TOOLTIP_MARK);
    }
}

/** ⚠️ `data-tooltip-*` goes through `setTooltip`, so a builder obeys the switch without knowing. */
export function makeElement(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    element.className = className;
    for (const [name, value] of Object.entries(attributes)) {
        if (name === TOOLTIP_ATTRIBUTE) {
            setTooltip(element, value);
            continue;
        }
        if (name === TOOLTIP_ANCHOR_ATTRIBUTE && areModTooltipsHidden()) {
            continue;
        }
        element.setAttribute(name, value);
    }
    return element;
}
