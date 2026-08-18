/**
 * Better Commerce Screen UI by Najane - entry point.
 *
 * The .modinfo lists only this file; everything else is pulled in by import, which
 * also fixes the order (a module always runs before the module importing it).
 */
import './screen/resources-tab.js';
// Replaces CommerceScreen outright, so it must load whether or not the
// Resources tab is ever opened.
import './screen/factory-tab.js';
// Wraps the trade route card, which is its own tab and its own mount.
import './screen/trade-routes.js';

// All six run with the screen closed, so they start here rather than from a component.
import { startMerchantOrders } from './engine/merchant-orders.js';
import { startTreasureConvoys } from './engine/treasure-convoys.js';
import { startResourceLockUpkeep } from './engine/resource-locks.js';
import { startAutoAssign } from './planner/auto-assign.js';
import { startAssignNotification } from './screen/assign-notification.js';
import { startDockResourceButton } from './screen/dock-resource-button.js';

import { BUILD_STAMP } from './support/build-stamp.js';
import { log, warn } from './support/diagnostics.js';

startAutoAssign();
startAssignNotification();
// A merchant bought from the Trade Routes tab walks for several turns after that screen has
// been closed; its standing order is looked after here rather than by the tab.
startMerchantOrders();
// A Treasure Convoy sails for many turns after the Treasure tab has been closed, so its
// errand is looked after here too.
startTreasureConvoys();
// The HUD's Resource Allocation button: coloured when the screen is unlocked, pulsing when
// something in the pool would actually go somewhere. Nothing to do with the screen being open.
startDockResourceButton();
// A lock belongs to a resource IN a settlement, so it has to be dropped when the resource
// leaves - including when something other than this screen moves it.
startResourceLockUpkeep();
/*
 * ⚠️ `warn`, not `log`, and it carries the build stamp.
 *
 * The game loads these scripts ONCE, at startup or on returning to the main menu, so a
 * deploy made during a session changes the files on disk and nothing else - the game keeps
 * running what it loaded, with no sign of it from inside the game. One round of debugging
 * has already gone into a fix that was deployed and simply not running. This line makes the
 * running build's identity the first thing in the log, and `warn` keeps it there even with
 * diagnostics switched off for release.
 */
warn(`loaded, build ${BUILD_STAMP}`);
log('diagnostics are on');
