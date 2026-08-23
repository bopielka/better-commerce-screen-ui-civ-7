/**
 * A small square button that is nothing but an icon - locate, cancel, and the plus that sends a
 * spare merchant.
 *
 * ⚠️ FIXED dimensions, written out as one number rather than assembled: everywhere else in this
 * mod a size is inherited or measured, and the point of this module is that the number cannot
 * drift between the buttons that have to line up with each other.
 */
import { appendWithFramedTooltip } from './framed-tooltip.js';
import { bindActivatable, makeElement } from '../support/dom.js';

export const ICON_BUTTON_CLASS = 'najane-icon-button';

/**
 * ⚠️ The height matches the priced buttons on the same cards - 0.15rem of padding above and
 * below a 1.35rem icon - so a row of these sits level with a row carrying a price. It is
 * written out as one number rather than assembled from those three, because the point of this
 * module is that the number cannot drift.
 */
export const ICON_BUTTON_STYLE = `
.${ICON_BUTTON_CLASS} {
    box-sizing: border-box;
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: 2.05rem;
    height: 1.65rem;
    /* No padding: the icon is centred by the flexbox, which cannot be lopsided. */
    padding: 0;
    border: 0.08rem solid rgba(179, 158, 128, 0.55);
    border-radius: 0.25rem;
    background: rgba(21, 27, 39, 0.82);
    /* The card underneath is an Activatable; without this the click never reaches us. */
    pointer-events: auto;
}
.${ICON_BUTTON_CLASS}:hover { filter: brightness(1.45); }
/*
 * With a figure beside the icon - "3 turns away" and the like.
 *
 * ⚠️ The WIDTH gives way, never the height. A button that grew taller to fit a number would
 * un-level the row it shares, which is the one thing this module exists to prevent; the height
 * above is deliberately the only fixed dimension that matters.
 */
.${ICON_BUTTON_CLASS}--labelled {
    width: auto;
    min-width: 2.05rem;
    padding: 0 0.35rem;
}
.${ICON_BUTTON_CLASS}__label {
    margin-left: 0.25rem;
    color: #e5d2ac;
    font-size: 0.95rem;
    line-height: 1;
    pointer-events: none;
}
.${ICON_BUTTON_CLASS}__icon {
    width: 1.35rem;
    height: 1.35rem;
    background-position: center;
    background-repeat: no-repeat;
    background-size: contain;
    pointer-events: none;
}
/*
 * ⚠️ The mount needs this as much as the button does. A framed tooltip hands back a wrapper
 * rather than the button, so the wrapper is what actually sits in the row - and a wrapper left
 * as a plain block beside a flex one is exactly how these came to sit crooked.
 */
.${ICON_BUTTON_CLASS}-mount {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
}
`;

/**
 * @param icon   a `blp:` url for the picture.
 * @param scope  which teardown owns the tooltip; see disposeFramedTooltips.
 */
export function makeIconButton({
    icon, tint = null, title, text, scope, onActivate, className = '', label = null,
}) {
    const classes = [ICON_BUTTON_CLASS, className, label === null ? '' : `${ICON_BUTTON_CLASS}--labelled`];
    const button = makeElement('div', classes.filter(Boolean).join(' '));

    const iconElement = makeElement('div', `${ICON_BUTTON_CLASS}__icon`);
    iconElement.style.backgroundImage = `url(${icon})`;
    if (tint) {
        iconElement.style.filter = tint;
    }
    button.appendChild(iconElement);

    if (label !== null) {
        const labelElement = makeElement('div', `${ICON_BUTTON_CLASS}__label`);
        labelElement.textContent = label;
        button.appendChild(labelElement);
    }

    bindActivatable(button, onActivate);

    const mount = makeElement('div', `${ICON_BUTTON_CLASS}-mount`);
    appendWithFramedTooltip(mount, button, { scope, title, text });
    return mount;
}
