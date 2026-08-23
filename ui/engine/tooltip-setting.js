/**
 * Whether this mod draws any tooltips of its own. Off by default.
 *
 * ⚠️ Covers ONLY what this mod draws - the game's own are not ours to take away. Three things:
 * the framed tooltips (screen/framed-tooltip.js), the `data-tooltip-content` this mod hangs on
 * elements (support/dom.js, `setTooltip`), and the extended resource tooltip
 * (screen/resource-tooltip.js). The round "?" marks go with them - a mark only carries a
 * tooltip.
 *
 * ⚠️ In engine/ because ui/options/ loads in SHELL scope: a settings module it imports may
 * reach no further than stored-setting.js, and anything under ui/screen/ pulls in Solid.
 */
import { storedSwitch } from './stored-setting.js';

const MOD_ID = 'better-commerce-screen-ui';

/** Raised on `window` when the switch is thrown; see the entry point. */
export const TooltipSettingChangedEventName = 'najane-commerce-tooltips-changed';

const setting = storedSwitch({
    option: `${MOD_ID}.hideTooltips`,
    // Never touched: show them. See the note at the top.
    defaultValue: false,
    label: "hide this mod's tooltips",
    changedEventName: TooltipSettingChangedEventName,
});

export function areModTooltipsHidden() {
    return setting.isOn();
}

export function setModTooltipsHidden(value) {
    setting.set(value);
}
