/**
 * The small round "?" that carries an explanation in its tooltip.
 *
 * Used wherever this screen does something a player cannot discover by looking: the Shift
 * shortcuts on the Resources tab, and what a click on a treasure card actually does. Both
 * are cases where a sentence on screen would be read once and then be in the way forever,
 * so it goes behind a mark instead.
 *
 * Shared rather than copied because a second one that looked slightly different would read
 * as a different kind of control.
 */
import { appendWithFramedTooltip } from './framed-tooltip.js';
import { makeElement } from '../support/dom.js';

export const HELP_CLASS = 'najane-assign-help';

export const HELP_STYLE = `
/*
 * Round and small, so it reads as a footnote to whatever it sits beside rather than as
 * another button.
 */
.${HELP_CLASS} {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    min-width: 2.4rem;
    height: 2.4rem;
    margin-right: 0;
    padding: 0;
    border: 0.12rem solid #9f8b65;
    border-radius: 1.2rem;
    color: #e5d2ac;
    background: rgba(21, 27, 39, 0.94);
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-size: 1.1rem;
    text-align: center;
}
.${HELP_CLASS}:hover { background: rgba(77, 67, 55, 0.98); }
/* Pass-through, so the mark keeps its own round box in the row. */
.${HELP_CLASS}-mount { display: flex; flex: 0 0 auto; }
`;

/**
 * Not clickable - just a label with a tooltip.
 *
 * ⚠️ Returns a WRAPPER, not the mark: the framed tooltip has to enclose its trigger. The
 * shortcut list this carries is four thoughts separated by blank lines, which is exactly
 * what the framed form is for - each becomes its own card instead of one wall of text.
 *
 * ⚠️ Pass a `scope` wherever the mark is torn down before the screen is - a tab that comes
 * and goes. Left on the default, its tooltip is only disposed by the screen's own teardown,
 * and a caller that removes the element sooner strands the frame; disposing the DEFAULT scope
 * to work around that would take every other tab's tooltips with it. See the note on
 * `disposeFramedTooltips`.
 */
export function makeHelpMark(tooltipKey, labelKey, scope = undefined) {
    const mark = makeElement('div', HELP_CLASS, { 'aria-label': Locale.compose(labelKey) });
    mark.textContent = '?';

    const mount = makeElement('div', `${HELP_CLASS}-mount`);
    appendWithFramedTooltip(mount, mark, { title: labelKey, text: Locale.compose(tooltipKey), scope });
    return mount;
}
