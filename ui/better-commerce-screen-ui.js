/**
 * Better Commerce Screen UI by Najane - entry point.
 *
 * The .modinfo lists only this file; everything else is pulled in by import, which
 * also fixes the order (a module always runs before the module importing it).
 */
import './screen/resources-tab.js';
// Replaces CommerceScreen outright, so it loads whether or not the Resources tab is opened.
import './screen/factory-tab.js';
// Wraps the trade route card - its own tab and its own mount.
import './screen/trade-routes.js';

// All six run with the screen CLOSED, so they start here rather than from a component.
import { startMerchantOrders } from './engine/merchant-orders.js';
import { startTreasureConvoys } from './engine/treasure-convoys.js';
import { startResourceLockUpkeep } from './engine/resource-locks.js';
import { startAutoAssign } from './planner/auto-assign.js';
import { startAssignNotification } from './screen/assign-notification.js';
import { startDockResourceButton } from './screen/dock-resource-button.js';

import { logEventStats, onEngineEvent } from './engine/events.js';
import { TooltipSettingChangedEventName } from './engine/tooltip-setting.js';
import { removeModTooltips } from './support/dom.js';
import { BUILD_STAMP } from './support/build-stamp.js';
import { DIAGNOSTICS, log, warn } from './support/diagnostics.js';

startAutoAssign();
startAssignNotification();
// A merchant walks for turns after the tab is shut; its standing order is looked after here.
startMerchantOrders();
// Same for a convoy at sea.
startTreasureConvoys();
// The HUD dock button: coloured when unlocked, pulsing when something in the pool would fit.
startDockResourceButton();
// A lock belongs to a resource IN a settlement, so it drops when the resource leaves.
startResourceLockUpkeep();
/*
 * ⚠️ The options menu opens OVER the Commerce screen, so this is thrown with the screen up as
 * often as not. Only the plain tooltips can be undone where they stand; a framed one mounts its
 * trigger inside its own Solid root, so disposing it would take the button with it.
 */
window.addEventListener(TooltipSettingChangedEventName, removeModTooltips);

// ⚠️ Diagnostics only, and the first measurement to take when the report is "the game runs
// slowly". Nothing is counted and this listener is not installed with diagnostics off.
if (DIAGNOSTICS) {
    onEngineEvent('LocalPlayerTurnBegin', logEventStats);
}

/*
 * ⚠️ `warn`, not `log`, and it carries the build stamp. Scripts load ONCE, so a deploy made
 * mid-session changes the files and nothing else - a fix can be deployed and simply not be
 * running, with no sign of it from inside the game. This line names the running build.
 */
warn(`loaded, build ${BUILD_STAMP}`);
log('diagnostics are on');
