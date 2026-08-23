/**
 * Hiding "Resource Assignments Available" when there is nothing you could do about it.
 *
 * The row in `notification.xml` is HIGH severity with `ExpiresEndOfTurn="False"`, so once raised
 * it holds the turn button until acted on. ⚠️ What RAISES it is engine-side and appears nowhere
 * in the data - the two triggers are observed in play, and an earlier guess at them reached a
 * player-facing tooltip before anyone checked.
 *
 * ⚠️ The test is whether any UNASSIGNED resource would be ACCEPTED anywhere - not "are there free
 * slots", which was the first version and almost never fired, and not "can nothing be done",
 * which would be untrue since the player can always rearrange.
 *
 * ⚠️ TWO places draw this notification and they do not share a source. The notification TRAIN
 * takes only non-blocking notifications; the ICON in the end-turn ring (`panel-action`) reads
 * `Game.Notifications.getIdsForPlayer` directly and takes only blocking ones. This one blocks,
 * so suppressing it in the model removed it from a list it was never in. The way to the icon is
 * `panel-action`'s own `getNotificationInfo`: returning null for an id hides it. `panel-action`
 * is an old-framework component, so its prototype can be wrapped.
 *
 * ⚠️ Nothing is dismissed and turn blocking is untouched - this only declines to draw.
 */
import { PanelAction } from '/base-standard/ui/action/panel-action.js';

import { canAssign } from '../engine/operations.js';
import { grantsBonusSlots } from '../engine/resource-slots.js';
import { isAutoAssignPending, isAutoAssignRunning } from '../planner/auto-assign.js';
import { isAssignableToSettlement, resourceClassOf } from '../planner/facts.js';
import { settlementHasFactory } from '../model/headless-model.js';
import { isAssignmentInProgress } from '../planner/run.js';
import CommerceOptions, {
    AutoAssignMode,
    CommerceOptionsChangedEventName,
} from '../options/najane-commerce-options.js';
import { onLocalPlayerEvent } from '../engine/events.js';
import { heldResourceType } from '../engine/resource-types.js';
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';

const NOTIFICATION_TYPE = 'NOTIFICATION_ASSIGN_NEW_RESOURCES';

/** ⚠️ `Game.getHash` is a lookup, and this was being asked inside `refreshActionButton`. */
let notificationHash = null;

function hiddenNotificationType() {
    if (notificationHash === null) {
        notificationHash = Game.getHash(NOTIFICATION_TYPE);
    }
    return notificationHash;
}
const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';
/**
 * ⚠️ Cannot go into a Town at all, and the engine's refusal for that pair carries no reason -
 * `place.js` records the same thing where it explains why a pass placed nothing. Asking about
 * it anyway is the most expensive call in this mod spent on an answer written in the pedia:
 * "City Resources must be assigned to a City with available Resource Capacity"
 * (LOC_PEDIA_CONCEPTS_CITY_RESOURCES_TOOLTIP).
 */
const CITY_RESOURCE_CLASS = 'RESOURCECLASS_CITY';

/**
 * Whether this mod may decline to draw the notification at all.
 *
 * ⚠️ Needs automatic assignment ON as well as the checkbox: with it off the mod places nothing
 * for you, so the prompt is telling you something you still have to act on.
 */
function suppressionEnabled() {
    return CommerceOptions.skipAssignPrompt && CommerceOptions.autoAssignMode !== AutoAssignMode.Off;
}

/** The element whose ring holds the icon; see the note at the top of this file. */
const ACTION_PANEL = 'panel-action';

/**
 * ⚠️ `panel-action` does NOT listen for resource events - its refresh is driven by notification
 * and unit events - so without these the icon keeps whatever it decided last, which after an
 * automatic pass is always "show".
 */
/**
 * The ones that can change the ANSWER, and therefore throw the cached one away.
 *
 * ⚠️ The two city events are here because nothing else covers them. Taking or losing a
 * settlement changes which settlements have room, which is half of what the answer is made
 * of, and it raises none of the resource events above.
 */
const BOARD_EVENTS = [
    'ResourceAssigned',
    'ResourceUnassigned',
    'ResourceCapChanged',
    'CityTransfered',
    'CityAddedToMap',
];

/**
 * The ones that change only WHETHER TO ASK, and must not throw the answer away.
 *
 * ⚠️ `NotificationAdded` used to sit in the list above, and that is what made the cache
 * almost worthless. A notification appearing cannot change whether a resource you hold would
 * be accepted somewhere - but it fires constantly, and every one of them threw away an answer
 * that `anythingCanBePlaced` then had to work out again from scratch: in the worst case one
 * `canStart` per unassigned resource per settlement with room, several times a second, for
 * the whole game. The re-check it asks for is still worth doing; the forgetting was not.
 */
const RECHECK_ONLY_EVENTS = [
    // The notification itself: it is raised after the resource lands, so without this the
    // first chance to dismiss it would be whatever happened next.
    'NotificationAdded',
];

/** Long enough for a burst of assignments to become one refresh. */
const RECHECK_DELAY_MS = 400;

let attached = false;
let recheckTimer = null;
/** True while `refreshActionButton` is on the stack; see scheduleRecheck. */
let refreshing = false;

/**
 * Could anything the player holds actually be placed somewhere?
 *
 * Settlements with room are tried first and it stops at the first accepted pair, so the normal
 * case costs one call. The expensive case is "no" - which is also when the notification is about
 * to be hidden for the rest of the turn.
 *
 * ⚠️ Full settlements are skipped rather than asked: `canAssign` goes through
 * `Game.PlayerOperations.canStart`, the most expensive call in this mod.
 *
 * ⚠️ A PURE question about the board, with no view on timing. It used to answer "yes" while a
 * pass was pending, which leaked: the dismissal path asks the same question and was told "yes"
 * during the grace window, so it never dismissed anything.
 */
let cachedAnswer = null;
let cachedAt = 0;

/**
 * How long an answer stays good WITHOUT anything having happened.
 *
 * ⚠️ This is the safety net, not the invalidation. What actually throws the answer away is
 * `forgetPlaceability`, wired to every event that can change it - see `BOARD_EVENTS`. At 250ms
 * this timer was doing the invalidating instead, which meant the most expensive call in this
 * mod ran four times a second forever while the board sat still. Long enough now to be the
 * backstop it was meant to be.
 */
const ANSWER_CACHE_MS = 3000;

export function forgetPlaceability() {
    cachedAnswer = null;
}

/**
 * Whether any unassigned resource of ours would actually be accepted somewhere.
 *
 * ⚠️ Exported for `dock-resource-button.js`, which pulses the HUD button on this answer. The
 * cache below is what makes that safe to call from an event handler: several engine
 * events arrive together on a turn boundary and this is the most expensive call in the mod.
 */
export function anythingCanBePlaced() {
    if (cachedAnswer !== null && Date.now() - cachedAt < ANSWER_CACHE_MS) {
        return cachedAnswer;
    }
    const answer = computeAnythingCanBePlaced();
    cachedAnswer = answer;
    cachedAt = Date.now();
    return answer;
}

function computeAnythingCanBePlaced() {
    try {
        const player = Players.get(GameContext.localPlayerID);
        const cities = player?.Cities?.getCities() ?? [];

        const withRoom = [];
        const assigned = new Set();
        for (const city of cities) {
            const resources = city.Resources;
            if (!resources) {
                continue;
            }
            const slotted = resources.getAssignedResources() ?? [];
            for (const resource of slotted) {
                assigned.add(resource.value);
            }
            if ((resources.getAssignedResourcesCap() ?? 0) - slotted.length > 0) {
                // The factory and town answers are carried along; see the notes where they
                // are used. Both are read here so the pair loop below asks nothing twice.
                withRoom.push({
                    cityID: city.id,
                    hasFactory: settlementHasFactory(resources),
                    isTown: !!city.isTown,
                });
            }
        }

        /*
         * Unassigned is the player's list minus what the settlements report; there is no accessor.
         * ⚠️ Empire and treasure resources are dropped exactly as the game's own pool drops them -
         * keeping them meant asking `canAssign` about pairs the engine was always going to refuse.
         * The type is resolved ONCE here and carried.
         */
        // ⚠️ The type is resolved ONCE here and carried, not looked up again by each of the
        // two loops below. All three used to run the same lookup over the same list.
        const unassigned = [];
        for (const resource of player?.Resources?.getResources() ?? []) {
            if (assigned.has(resource.value)) {
                continue;
            }
            const resourceType = heldResourceType(resource);
            if (!isAssignableToSettlement({ resourceType, resourceValue: resource.value })) {
                continue;
            }
            // ⚠️ Shaped so `resourceClassOf` can read it: it looks for `resourceType` first and
            // falls back to `resourceValue`, which the old shape did not carry.
            unassigned.push({ value: resource.value, resourceValue: resource.value, resourceType });
        }

        /*
         * ⚠️ A camel is always placeable, full empire or not: it carries two slots of its own.
         * Asked of `BonusResourceSlots`, a schema column, never of a resource name.
         */
        for (const { resourceType } of unassigned) {
            if (resourceType && grantsBonusSlots(resourceType)) {
                return true;
            }
        }

        if (withRoom.length === 0) {
            return false;
        }
        for (const resource of unassigned) {
            /*
             * ⚠️ A factory resource needs a settlement WITH A FACTORY and the engine does not say
             * so - `canAssign` accepts the pair and the resource then sits somewhere that cannot
             * run it. Same answer as the planner's, from the same function, deliberately.
             */
            const resourceClass = resource.resourceType ? resourceClassOf(resource) : null;
            const needsFactory = resourceClass === FACTORY_CLASS;
            // ⚠️ A City resource against a Town is a refusal the data already knows about;
            // see CITY_RESOURCE_CLASS.
            const needsCity = resourceClass === CITY_RESOURCE_CLASS;

            for (const settlement of withRoom) {
                if (needsFactory && !settlement.hasFactory) {
                    continue;
                }
                if (needsCity && settlement.isTown) {
                    continue;
                }
                if (canAssign(settlement.cityID, resource.value)) {
                    return true;
                }
            }
        }
    } catch (error) {
        // Cannot tell - show the notification. Hiding one the player should have seen is
        // the worse of the two failures.
        warn(`could not work out whether anything can be assigned: ${error}`);
        return true;
    }
    return false;
}

/**
 * Asks the panel to work its icons out again, once nothing is being placed any more. A mid-pass
 * board is not worth reading, so a refresh taken then would bake in the same non-answer.
 */
function scheduleRecheck({ force = false } = {}) {
    /*
     * ⚠️ With suppression off the filter returns the game's own answer untouched, so refreshing to
     * hear it again is a repaint bought for nothing. `force` is for the options change only:
     * switching suppression OFF is exactly when a hidden icon has to come back, and also when the
     * test above has just turned false.
     */
    if (!force && !suppressionEnabled()) {
        return;
    }
    // ⚠️ Not while a refresh is running: the refresh calls the filter, and anything the filter
    // asks for here is a loop that repaints the icons on a timer. That was the flicker.
    if (recheckTimer !== null || refreshing) {
        return;
    }
    recheckTimer = setTimeout(() => {
        recheckTimer = null;
        // ⚠️ `isAutoAssignRunning`, not `isAutoAssignPending`: the grace window would make this
        // wait for it to expire every time.
        if (isAutoAssignRunning() || isAssignmentInProgress()) {
            // Carries `force` with it, or a refresh asked for by the options change could
            // still be dropped by the test above on the way round again.
            scheduleRecheck({ force });
            return;
        }
        refreshing = true;
        try {
            document
                .querySelector(ACTION_PANEL)
                ?.component?.refreshActionButton?.(GameContext.localPlayerID);
        } catch (error) {
            warn(`could not refresh the action panel: ${error}`);
        } finally {
            refreshing = false;
        }
    }, RECHECK_DELAY_MS);
}

/*
 * ⚠️ DEAD END, recorded so it is not tried again: `Game.Notifications.dismiss(id)` runs and is
 * accepted, but the notification is back within the second - its row carries `AutoNotify="True"`.
 * What exactly it re-checks is NOT knowable from the data; guessing at it is how a wrong claim
 * reached a player-facing tooltip.
 */

/**
 * Is this notification the thing blocking the end of the turn, with nothing to be done?
 */
function blockingPointlessly(playerID) {
    if (!suppressionEnabled()) {
        return false;
    }
    try {
        const type = Game.Notifications.getEndTurnBlockingType(playerID);
        if (type === EndTurnBlockingTypes.NONE) {
            return false;
        }
        const blockerId = Game.Notifications.findEndTurnBlocking(playerID, type);
        if (!blockerId || Game.Notifications.getType(blockerId) !== hiddenNotificationType()) {
            return false;
        }
        return !anythingCanBePlaced();
    } catch (error) {
        warn(`could not read the end-turn blocker: ${error}`);
        return false;
    }
}

/**
 * Runs `body` with the game answering "nothing blocks the turn": `getEndTurnBlockingType` stands
 * in for the duration of one call, so the untouched original takes its own no-blocker path.
 * Restored in `finally`, and verified - if the engine object refuses the substitution the
 * original runs normally rather than half-changing something.
 */
function withoutOurBlocker(body) {
    const realGetType = Game.Notifications.getEndTurnBlockingType;
    try {
        Game.Notifications.getEndTurnBlockingType = () => EndTurnBlockingTypes.NONE;
        if (Game.Notifications.getEndTurnBlockingType() !== EndTurnBlockingTypes.NONE) {
            // The engine object refused the substitution; better to behave normally than
            // to half-change something.
            Game.Notifications.getEndTurnBlockingType = realGetType;
            warn('could not stand in for getEndTurnBlockingType; leaving the turn button alone');
            return body();
        }
        return body();
    } finally {
        Game.Notifications.getEndTurnBlockingType = realGetType;
    }
}

/**
 * Stops the main action button presenting an action that cannot be taken - and from acting on it
 * when clicked.
 *
 * ⚠️ TWO methods, because the panel asks the same question twice: `refreshActionButton` decides
 * what the button LOOKS like, `tryEndTurn` what pressing it DOES. Wrapping only the first
 * produced a button reading "End Turn" that opened the Commerce screen.
 *
 * ⚠️ The turn genuinely ends: `canEndTurn` is a UI method reading a UI-facing query. The hold was
 * the panel's, not the engine's.
 */
function wrapActionButton() {
    const wrap = (name, callWithPlayer) => {
        const original = PanelAction?.prototype?.[name];
        if (typeof original !== 'function') {
            warn(`panel-action has no ${name}; the main action cannot be suppressed`);
            return;
        }
        PanelAction.prototype[name] = function (...args) {
            const playerID = callWithPlayer ? args[0] : GameContext.localPlayerID;
            if (!blockingPointlessly(playerID)) {
                return original.apply(this, args);
            }
            log(`${name}: assign notification is the only blocker and nothing can be placed`);
            return withoutOurBlocker(() => original.apply(this, args));
        };
    };
    wrap('refreshActionButton', true);
    wrap('tryEndTurn', false);
}

/**
 * Wraps the panel's own filter. `refreshActionButton` maps every notification id through
 * `getNotificationInfo` and keeps the non-nulls, so returning null is the panel's own way of
 * saying "not this one" - the slot logic, animations and turn blocking carry on untouched.
 */
export function startAssignNotification() {
    if (attached) {
        return;
    }
    try {
        const hiddenType = hiddenNotificationType();
        const original = PanelAction?.prototype?.getNotificationInfo;
        if (typeof original !== 'function') {
            // Loud, not quiet: if this ever fails the feature silently does nothing, which
            // is exactly the failure that is hardest to notice.
            warn(
                `panel-action exposes no getNotificationInfo (PanelAction is ${typeof PanelAction}); ` +
                    'the assign icon cannot be hidden',
            );
            return;
        }
        PanelAction.prototype.getNotificationInfo = function (notificationId) {
            const info = original.call(this, notificationId);
            if (info?.type !== hiddenType || !suppressionEnabled()) {
                return info;
            }
            /*
             * A pass is running or due: HIDE rather than draw something wrong a second later.
             * ⚠️ Deliberately does NOT ask for a re-check from here - this runs FROM a refresh, so
             * that is a loop. The resource events drive it instead.
             */
            if (isAutoAssignPending() || isAssignmentInProgress()) {
                log('an assignment pass is running or due; holding the assign icon back');
                return null;
            }
            const placeable = anythingCanBePlaced();
            /*
             * ⚠️ Probe, not logic, and gated on DIAGNOSTICS because the three engine calls are the
             * expensive part. `panel-action` draws this twice over - as a slot icon (this filter)
             * and, when it blocks the turn, on the main button, fetched from `findEndTurnBlocking`
             * and never through here.
             */
            if (DIAGNOSTICS) {
                let blocking = 'unknown';
                try {
                    const playerID = GameContext.localPlayerID;
                    const type = Game.Notifications.getEndTurnBlockingType(playerID);
                    const blockerId = Game.Notifications.findEndTurnBlocking(playerID, type);
                    blocking = `endTurnBlockingType=${type} blockerIsThisOne=${
                        blockerId ? Game.Notifications.getType(blockerId) === hiddenType : false
                    }`;
                } catch (error) {
                    blocking = `could not read: ${error}`;
                }
                log(`assign icon offered: anything placeable = ${placeable}; ${blocking}`);
            }
            return placeable ? info : null;
        };
        for (const name of BOARD_EVENTS) {
            onLocalPlayerEvent(name, () => {
                forgetPlaceability();
                scheduleRecheck();
            });
        }
        for (const name of RECHECK_ONLY_EVENTS) {
            onLocalPlayerEvent(name, () => scheduleRecheck());
        }
        // Switching automatic assignment on or off changes whether the icon may be hidden
        // at all, and no engine event follows an options change - so without this the
        // player would not see the difference until something else happened to refresh it.
        window.addEventListener(CommerceOptionsChangedEventName, () => {
            forgetPlaceability();
            scheduleRecheck({ force: true });
        });
        wrapActionButton();
        attached = true;
        log(`assign action icon filter installed (type hash ${hiddenType})`);
    } catch (error) {
        warn(`could not install the assign action icon filter: ${error}`);
    }
}
