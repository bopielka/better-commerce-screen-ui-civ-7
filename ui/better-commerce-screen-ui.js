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

// Both run with the screen closed, so they start here rather than from a component.
import { startAutoAssign } from './planner/auto-assign.js';
import { startAssignNotification } from './screen/assign-notification.js';

import { log } from './support/diagnostics.js';

startAutoAssign();
startAssignNotification();
log('loaded');
