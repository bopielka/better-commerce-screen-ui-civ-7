/**
 * The switches in the button bar: "imports first" and, in the Modern age, "factories
 * first". Stacked, because two of them side by side would not fit beside three buttons.
 *
 * Only the controls are here; what each one means and where it is kept are in
 * planner/imports-first-setting.js and planner/factory-first-setting.js.
 *
 * Why controls on the screen rather than mod options: they are decisions about this empire
 * in this age, the kind of thing you change while looking at the board, not something you
 * set once in a menu and forget. The three that ARE set once - happiness priority, and the
 * two gathering switches - live in Options → Mods.
 *
 * ⚠️ Factories-first began beside the filters, in the screen's own header bar, and never
 * appeared there. Injecting into it, watching it and putting the switch back when it
 * vanished all failed silently - Solid owns that bar. They now go into
 * assign-all-buttons.js's bar, which this mod builds and therefore controls; this module
 * only makes the elements.
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
 * The switches, or null when there are none to show.
 *
 * Imports-first is offered in every age; factories-first only in the Modern age, because
 * factory resources only exist there. Imports goes on top, as the wider of the two rules.
 *
 * The caller decides where it goes and owns its lifetime; see assign-all-buttons.js.
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
 * No teardown of its own: the switches are created into assign-all-buttons.js's bar and go
 * when that bar goes. The module this replaced exported a stopFactoryFirst() that was never
 * called from anywhere - dead code in the one place that must not have any, the cleanup
 * path.
 */
