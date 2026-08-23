/**
 * The "imports first" and (Modern age) "factories first" switches in the button bar, stacked.
 * What they mean and where they are kept is in planner/{imports,factory}-first-setting.js.
 *
 * On the screen rather than in mod options because they are decisions about this empire in this
 * age. The set-once ones live in Options → Mods.
 *
 * ⚠️ They cannot go in the screen's own header bar - Solid owns it, and injecting there failed
 * silently. They go into the bar assign-all-buttons.js builds.
 */
import { isFactoryFirstEnabled, setFactoryFirstEnabled } from '../planner/factory-first-setting.js';
import { isImportsFirstEnabled, setImportsFirstEnabled } from '../planner/imports-first-setting.js';
import { SWITCH_STYLE, makeSwitch } from './switch-control.js';
import { ensureStyle, makeElement } from '../support/dom.js';
import { isFactoryAge } from '../engine/age.js';
import { log } from '../support/diagnostics.js';

const COLUMN_CLASS = 'najane-assign-switches';
const STYLE_ID = 'najane-assign-switches-style';

const STYLE = `
.${COLUMN_CLASS} {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    /* Centred against the 2.4rem buttons, so one switch or two both sit level with them. */
    justify-content: center;
    height: 2.4rem;
    margin-left: 1.1rem;
    pointer-events: auto;
}
${SWITCH_STYLE}
`;

/**
 * The switches, or null when there are none to show. Factories-first only in the Modern age.
 * The caller owns where it goes and its lifetime; see assign-all-buttons.js.
 */
export function createAssignSwitches() {
    ensureStyle(STYLE_ID, STYLE);
    const column = makeElement('div', COLUMN_CLASS);

    column.appendChild(
        makeSwitch({
            label: 'LOC_NAJANE_COMMERCE_IMPORTS_FIRST',
            tooltip: 'LOC_NAJANE_COMMERCE_IMPORTS_FIRST_TOOLTIP',
            isOn: isImportsFirstEnabled,
            setOn: setImportsFirstEnabled,
        }),
    );

    if (isFactoryAge()) {
        column.appendChild(
            makeSwitch({
                label: 'LOC_NAJANE_COMMERCE_FACTORY_FIRST',
                tooltip: 'LOC_NAJANE_COMMERCE_FACTORY_FIRST_TOOLTIP',
                isOn: isFactoryFirstEnabled,
                setOn: setFactoryFirstEnabled,
            }),
        );
    }

    log(`assignment switches created (${column.childElementCount})`);
    return column;
}

/**
 * No teardown of its own: the switches go when assign-all-buttons.js's bar goes. The module this
 * replaced exported a stop function nobody called - dead code on a cleanup path.
 */
