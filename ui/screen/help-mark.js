/**
 * The small round "?" that carries an explanation in its tooltip, used where this screen does
 * something a player cannot discover by looking. Shared so a second one cannot look slightly
 * different and read as a different kind of control.
 */
import { appendWithFramedTooltip } from './framed-tooltip.js';
import { areModTooltipsHidden } from '../engine/tooltip-setting.js';
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
 * ⚠️ Returns a WRAPPER, not the mark: the framed tooltip has to enclose its trigger.
 * ⚠️ Pass a `scope` wherever the mark is torn down before the screen is, or its tooltip is only
 * disposed by the screen's own teardown and a caller removing the element sooner strands the frame.
 */
export function makeHelpMark(tooltipKey, labelKey, scope = undefined) {
    /*
     * ⚠️ NOTHING AT ALL, not a mark without a tooltip.
     *
     * This control is a tooltip and nothing else - it is not clickable, and the "?" is only
     * the handle you hover. Drawn with the explanations switched off it would be a button
     * that does nothing, which is worse than the blank space it leaves. Callers append it
     * through `appendAll`, which skips what is not there.
     */
    if (areModTooltipsHidden()) {
        return null;
    }
    const mark = makeElement('div', HELP_CLASS, { 'aria-label': Locale.compose(labelKey) });
    mark.textContent = '?';

    const mount = makeElement('div', `${HELP_CLASS}-mount`);
    appendWithFramedTooltip(mount, mark, { title: labelKey, text: Locale.compose(tooltipKey), scope });
    return mount;
}
