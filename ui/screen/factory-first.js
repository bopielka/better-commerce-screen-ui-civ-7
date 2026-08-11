/**
 * The "factories first" checkbox, shown after the "?" in the button bar in the Modern age.
 *
 * Only the control is here; what it means and where it is kept are in
 * planner/factory-first-setting.js.
 *
 * Why a control on the screen rather than a mod option: it is a decision about this
 * empire in this age, the kind of thing you change while looking at the board, not
 * something you set once in a menu and forget.
 *
 * ⚠️ It began beside the filters, in the screen's own header bar, and never appeared
 * there. Injecting into it, watching it and putting the switch back when it vanished all
 * failed silently - Solid owns that bar. It now goes into assign-all-buttons.js's bar,
 * which this mod builds and therefore controls; this module only makes the element.
 */
import {
    isFactoryFirstEnabled,
    setFactoryFirstEnabled,
} from '../planner/factory-first-setting.js';
import { appendAll, bindActivatable, ensureStyle, makeElement } from '../support/dom.js';
import { isFactoryAge } from '../engine/age.js';
import { log } from '../support/diagnostics.js';

const CLASS = 'najane-factory-first';
const STYLE_ID = 'najane-factory-first-style';

const STYLE = `
.${CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    /* Level with the 2.4rem buttons it follows, and clear of the "?" before it. */
    height: 2.4rem;
    margin-left: 1.1rem;
    white-space: nowrap;
    color: #e5d2ac;
    font-family: "TitleFont", "TitleFont-JP", "TitleFont-KR", "TitleFont-SC", "TitleFont-TC";
    font-size: 0.9rem;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: auto;
}
.${CLASS}__box {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    margin-right: 0.5rem;
    border: 0.12rem solid #9f8b65;
    border-radius: 0.18rem;
    background: rgba(21, 27, 39, 0.94);
    font-size: 1.1rem;
    line-height: 1;
}
.${CLASS}__box:hover { background: rgba(77, 67, 55, 0.98); }
.${CLASS}__box:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
`;

let styleElement = null;

function paint(box) {
    box.textContent = isFactoryFirstEnabled() ? '✓' : '';
}

/**
 * The switch itself, or null outside the Modern age - factory resources only exist there.
 *
 * The caller decides where it goes and owns its lifetime; see assign-all-buttons.js.
 */
export function createFactoryFirstToggle() {
    if (!isFactoryAge()) {
        return null;
    }
    styleElement = ensureStyle(STYLE_ID, STYLE);

    const label = Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_FIRST');
    const element = makeElement('div', CLASS, {
        'data-tooltip-content': Locale.compose('LOC_NAJANE_COMMERCE_FACTORY_FIRST_TOOLTIP'),
        'aria-label': label,
    });

    const box = makeElement('div', `${CLASS}__box`);
    paint(box);
    bindActivatable(box, () => {
        setFactoryFirstEnabled(!isFactoryFirstEnabled());
        paint(box);
    });

    // font-fit-shrink is the game's own class: it scales the text down to fit the box.
    const text = makeElement('div', 'font-fit-shrink');
    text.textContent = label;
    log('factories-first switch created');
    return appendAll(element, box, text);
}

/**
 * No teardown of its own: the switch is created into assign-all-buttons.js's bar and
 * goes when that bar goes. An exported stopFactoryFirst() existed and was never called
 * from anywhere - dead code in the one place that must not have any, the cleanup path.
 */

