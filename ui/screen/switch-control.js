/**
 * The checkbox-and-caption used for a yes/no setting, by assign-switches.js and treasure-tab.js.
 *
 * ⚠️ It must NOT impose a layout - the two callers sit on very different rows. It produces a row
 * that sizes to its content; where that goes is the caller's business.
 *
 * ⚠️ The dimensions are the button bar's and are deliberately small: two of these stack inside
 * one 2.4rem button there.
 */
import { appendWithFramedTooltip } from './framed-tooltip.js';
import { appendAll, bindActivatable, makeElement } from '../support/dom.js';

export const SWITCH_CLASS = 'najane-assign-switch';

export const SWITCH_STYLE = `
.${SWITCH_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    /*
     * Two rows have to live inside the height of one button, so these are deliberately
     * smaller than the bar's other text. Anything taller and the second switch pushes the
     * bar past the tab strip it is sitting in - see layout.js for that budget.
     */
    height: 1.15rem;
    white-space: nowrap;
    color: #e5d2ac;
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-size: 0.78rem;
    text-transform: uppercase;
}
.${SWITCH_CLASS}__box {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.05rem;
    height: 1.05rem;
    margin-right: 0.4rem;
    border: 0.1rem solid #9f8b65;
    border-radius: 0.16rem;
    background: rgba(21, 27, 39, 0.94);
    font-size: 0.8rem;
    line-height: 1;
}
.${SWITCH_CLASS}__box:hover { background: rgba(77, 67, 55, 0.98); }
/* Pass-through, so the switch keeps its own 1.15rem row inside whatever holds it. */
.${SWITCH_CLASS}-mount { display: flex; flex: 0 0 auto; }
.${SWITCH_CLASS}__box:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
`;

/**
 * ⚠️ Returns a WRAPPER, not the row: the framed tooltip has to enclose its trigger.
 *
 * ⚠️ The tick is repainted from `isOn()` after every click rather than tracked here, so a setting
 * that refuses to change shows what is stored rather than what was clicked.
 */
export function makeSwitch({ label, tooltip, isOn, setOn, scope = undefined }) {
    const text = Locale.compose(label);
    const element = makeElement('div', SWITCH_CLASS, { 'aria-label': text });

    const box = makeElement('div', `${SWITCH_CLASS}__box`);
    const paint = () => (box.textContent = isOn() ? '✓' : '');
    paint();
    bindActivatable(box, () => {
        setOn(!isOn());
        paint();
    });

    // font-fit-shrink is the game's own class: it scales the text down to fit the box.
    const caption = makeElement('div', 'font-fit-shrink');
    caption.textContent = text;
    appendAll(element, box, caption);

    const mount = makeElement('div', `${SWITCH_CLASS}-mount`);
    appendWithFramedTooltip(mount, element, { title: label, text: Locale.compose(tooltip), scope });
    return mount;
}
