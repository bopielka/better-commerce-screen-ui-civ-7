/**
 * Hiding "Resource Assignments Available" when there is nothing you could do about it.
 *
 * The game raises `NOTIFICATION_ASSIGN_NEW_RESOURCES` when a resource reaches the player's
 * pool, or when a settlement gains a slot. Its row in `notification.xml` is HIGH severity
 * with `ExpiresEndOfTurn="False"`, so once raised it holds the turn button until it is
 * acted on - including when there is nothing that could be done about it.
 *
 * ⚠️ Those two triggers are OBSERVED IN PLAY, not read from the data. The row carries the
 * severity and the expiry; what raises it is engine-side and appears nowhere in
 * `notification.xml`. An earlier version of this note asserted the condition was simply
 * "you have unassigned resources", which was an inference and wrong - and it had already
 * been copied into a player-facing tooltip before anyone checked.
 *
 * ⚠️ Not that nothing CAN be done - the player can always open the screen and rearrange
 * what is already assigned, swapping one resource for another. That is why the test below
 * is whether any UNASSIGNED resource can go anywhere: the case where rearranging would be
 * for its own sake. Saying "you cannot act on this" would be untrue.
 *
 * With this, it is not shown while nothing you hold could legally be placed anywhere. It
 * comes back the moment that changes.
 *
 * ⚠️ The test is NOT "are there free slots". That was the first version and it almost never
 * fired: one spare slot in one town anywhere in the empire was enough to bring the nag
 * back, and there usually is one. What matters is whether any (resource, settlement) pair
 * would actually be accepted - a settlement can have room and still refuse everything you
 * are holding, which is exactly when the notification is at its most useless.
 *
 * TWO places draw it, and they do not share a source
 * --------------------------------------------------
 * ⚠️ This is the whole reason the first attempt did nothing visible.
 *
 *   1. The notification TRAIN (`panel-notification-train`) reads `NotificationModel`, and
 *      only takes notifications that do NOT block turn advancement - see its
 *      `isSoftNotification` check.
 *   2. The ICON in the ring around the end-turn button (`panel-action`) reads
 *      `Game.Notifications.getIdsForPlayer` DIRECTLY and takes only the ones that DO
 *      block turn advancement.
 *
 * This notification blocks, so it is drawn by the second and ignored by the first.
 * Suppressing it in the model - which is what a notification handler can do - therefore
 * removed it from a list it was never in. The icon the player actually sees comes from
 * `panel-action`, and the way to that one is its own `getNotificationInfo`: the list is
 * built by mapping every id through it and dropping the nulls, so returning null for a
 * notification hides its icon.
 *
 * `panel-action` is an OLD-framework component (`Controls.define`), so unlike the ui-next
 * screens its class is exported and its prototype can be wrapped.
 *
 * ⚠️ Nothing is dismissed, cancelled or acknowledged, and turn blocking is untouched -
 * that is decided by the engine, not by whether an icon is drawn. This only declines to
 * draw it, which keeps the mod's promise that no game state is changed.
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
import { log, warn } from '../support/diagnostics.js';

const NOTIFICATION_TYPE = 'NOTIFICATION_ASSIGN_NEW_RESOURCES';
const FACTORY_CLASS = 'RESOURCECLASS_FACTORY';

/**
 * Whether this mod may decline to draw the notification at all.
 *
 * TWO conditions, and either one alone turns the whole thing off - in which case the game
 * behaves exactly as it does without this mod: nothing is wrapped away, the icon is drawn,
 * and the turn button blocks as the engine intends.
 *
 * 1. ⚠️ The player's own switch. Hiding a prompt the game raised is the most intrusive thing
 *    in this file, so it is worth being able to say no to outright.
 *
 * 2. ⚠️ Automatic assignment must be doing something. The justification for hiding
 *    "Resource Assignments Available" is that the mod has already assigned the resources -
 *    sending the player to a screen where the work is done is the nag, not the notification
 *    itself. With automatic assignment Off the mod assigns nothing on its own, so the
 *    notification is telling the player something true and actionable and taking it away
 *    would remove a prompt they still need.
 */
function suppressionEnabled() {
    return CommerceOptions.skipAssignPrompt && CommerceOptions.autoAssignMode !== AutoAssignMode.Off;
}

/** The element whose ring holds the icon; see the note at the top of this file. */
const ACTION_PANEL = 'panel-action';

/**
 * Events after which the answer may have changed.
 *
 * ⚠️ `panel-action` does NOT listen for these - its own refresh is driven by notification
 * and unit events - so without this the icon would keep whatever it decided last, which
 * after an automatic pass is always "show", since that is what we answer mid-pass.
 */
const RECHECK_EVENTS = [
    'ResourceAssigned',
    'ResourceUnassigned',
    'ResourceCapChanged',
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
 * Settlements with room are tried first and the search stops at the first pair the engine
 * accepts, so in the normal case - where plenty can be placed - this costs one call. The
 * expensive case is the one where the answer is "no", and that is also the case where the
 * notification is about to be hidden for the rest of the turn.
 *
 * ⚠️ Settlements with no free slot are skipped entirely rather than asked. `canAssign`
 * goes through `Game.PlayerOperations.canStart`, which is the single most expensive call
 * in this mod (see the assignment loop), and a full settlement cannot take anything.
 *
 * ⚠️ A PURE question about the board, with no view on timing. It used to answer "yes" while
 * an assignment pass was pending, which is a display policy rather than a fact - and that
 * leaked: the dismissal below asks the same question and was told "yes, something can be
 * placed" during the pass's grace window, so it never dismissed anything. The timing
 * policy now lives only where it belongs, in the icon filter.
 */
let cachedAnswer = null;
let cachedAt = 0;

/** How long an answer stays good. Long enough to cover a burst of refreshes, no longer. */
const ANSWER_CACHE_MS = 250;

export function forgetPlaceability() {
    cachedAnswer = null;
}

/**
 * Whether any unassigned resource of ours would actually be accepted somewhere.
 *
 * ⚠️ Exported for `dock-resource-button.js`, which pulses the HUD button on this answer. The
 * 250ms cache below is what makes that safe to call from an event handler: several engine
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
                // The factory answer is carried along; see the note where it is used.
                withRoom.push({ cityID: city.id, hasFactory: settlementHasFactory(resources) });
            }
        }

        /*
         * Unassigned is the player's list minus what the settlements report; there is no
         * accessor for it. Same subtraction the planner does.
         *
         * ⚠️ Empire and treasure resources are dropped, exactly as the game's own pool drops
         * them - they are never assigned to a settlement. Keeping them meant asking
         * `canAssign` about every one of them against every settlement with room, which is
         * the most expensive call in this mod, for pairs the engine was always going to
         * refuse. It could not change the answer, only how long it took to reach it.
         */
        const unassigned = [];
        for (const resource of player?.Resources?.getResources() ?? []) {
            if (assigned.has(resource.value)) {
                continue;
            }
            const resourceType = GameInfo.Resources.lookup(resource.uniqueResource?.resource)?.ResourceType ?? null;
            if (!isAssignableToSettlement({ resourceType, resourceValue: resource.value })) {
                continue;
            }
            unassigned.push(resource);
        }

        /*
         * ⚠️ A camel is always placeable, full empire or not.
         *
         * It carries two slots of its own, so it can be put into a settlement that has no
         * room by making room - which is what this mod's own camel handling does. Counting
         * free slots alone would hide the icon while the one resource that could fix the
         * shortage is sitting in the pool.
         *
         * Asked of the data rather than of a resource name: `BonusResourceSlots` is a
         * schema column, so anything a patch or another mod gives the property is covered.
         */
        for (const resource of unassigned) {
            const type = GameInfo.Resources.lookup(resource.uniqueResource?.resource)?.ResourceType;
            if (type && grantsBonusSlots(type)) {
                return true;
            }
        }

        if (withRoom.length === 0) {
            return false;
        }
        for (const resource of unassigned) {
            /*
             * ⚠️ A factory resource needs a settlement WITH A FACTORY, and the engine does
             * not say so: `canAssign` accepts the pair and the resource then sits in a
             * settlement that cannot run it. So the icon kept being offered for a haul of
             * factory resources while every settlement with a free slot lacked a factory -
             * "you can act on this" for an action worth nothing.
             *
             * Same answer as the planner's, from the same function, deliberately: two
             * definitions of "has a factory" is how the screen and the engine come to
             * disagree.
             */
            const type = GameInfo.Resources.lookup(resource.uniqueResource?.resource)?.ResourceType;
            const needsFactory = type && resourceClassOf({ resourceType: type }) === FACTORY_CLASS;

            for (const settlement of withRoom) {
                if (needsFactory && !settlement.hasFactory) {
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
 * Asks the panel to work its icons out again, once nothing is being placed any more.
 *
 * Reschedules rather than deciding while a pass is running: the whole point of the guard
 * in `anythingCanBePlaced` is that a mid-pass board is not worth reading, so a refresh
 * taken then would only bake in the same non-answer.
 */
function scheduleRecheck() {
    // ⚠️ Not while a refresh is running. The refresh calls the filter, and anything the
    // filter asks for here would schedule the next refresh - a loop that repaints the
    // panel's icons on a timer and shows up as flicker.
    if (recheckTimer !== null || refreshing) {
        return;
    }
    recheckTimer = setTimeout(() => {
        recheckTimer = null;
        // ⚠️ `isAutoAssignRunning`, not `isAutoAssignPending`: the grace window that makes
        // the filter hide EARLY would make this wait for it to expire every time, adding a
        // second of delay to an icon that should already be back.
        if (isAutoAssignRunning() || isAssignmentInProgress()) {
            scheduleRecheck();
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
 * ⚠️ DEAD END, recorded so it is not tried again: dismissing this notification.
 *
 * `Game.Notifications.dismiss(id)` runs and is accepted - the log showed "dismissed 1" -
 * but the notification is back within the second. Its row in `notification.xml` carries
 * `AutoNotify="True"`, so the engine puts it back on its own.
 *
 * ⚠️ What exactly it re-checks is NOT knowable from the data, and guessing at it is how a
 * wrong claim reached a player-facing tooltip. All that is established here is the
 * behaviour: dismissing does not stick.
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
        if (!blockerId || Game.Notifications.getType(blockerId) !== Game.getHash(NOTIFICATION_TYPE)) {
            return false;
        }
        return !anythingCanBePlaced();
    } catch (error) {
        warn(`could not read the end-turn blocker: ${error}`);
        return false;
    }
}

/**
 * Runs `body` with the game answering "nothing blocks the turn".
 *
 * Rather than reproduce what the panel does when nothing blocks, the game is asked the
 * question differently: `getEndTurnBlockingType` stands in for the duration of one call,
 * so the untouched original takes its own no-blocker path. Restored in `finally`, so
 * nothing outside that call ever sees the substitute.
 *
 * @returns the body's result, and whether the substitution actually took
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
 * Stops the main action button from presenting an action that cannot be taken - and from
 * acting on it when clicked.
 *
 * ⚠️ TWO methods, because the panel asks the same question twice for two different
 * purposes. Wrapping only the first is what produced a button reading "End Turn" that
 * opened the Commerce screen when clicked:
 *
 *   refreshActionButton  what the button LOOKS like
 *   tryEndTurn           what pressing it DOES - `canEndTurn` re-reads the blocker, and
 *                        on finding one calls `activateBlockingNotification` instead of
 *                        ending the turn
 *
 * ⚠️ It also settles the safety question. `canEndTurn` is a UI method reading a UI-facing
 * query, and ending the turn is `GameContext.sendTurnComplete()` - so with the blocker
 * out of the way the turn genuinely ends. The hold was the panel's, not the engine's, and
 * nothing the engine enforces is being worked around.
 *
 * Measured in game: 140 resources in the pool, 0 of 18 settlements with a free slot. The
 * notification is factually right and completely useless, and the game still promotes it
 * to the main button once every other action is done.
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
 * Wraps the action panel's own filter.
 *
 * `refreshActionButton` maps every notification id through `getNotificationInfo` and keeps
 * the ones that come back non-null. Returning null is therefore the panel's own way of
 * saying "not this one", and costs nothing else: the slot logic, the animations and the
 * turn-blocking machinery all carry on as they were.
 *
 * The panel refreshes on `NotificationAdded`, `NotificationUpdated`, `LocalPlayerTurnBegin`
 * and unit events, so the icon comes back on its own once something is placeable again -
 * no extra event handling needed here.
 */
export function startAssignNotification() {
    if (attached) {
        return;
    }
    try {
        const hiddenType = Game.getHash(NOTIFICATION_TYPE);
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
             * A pass is running or on its way: HIDE, rather than draw something that is
             * wrong a second later. Never the last word - the re-check below asks again
             * once nothing is being placed.
             *
             * ⚠️ Deliberately does NOT ask for a re-check from here. This runs FROM a
             * refresh, so doing so is a loop: refresh -> filter -> re-check -> refresh,
             * every few hundred ms, re-running the panel's slot animations each time.
             * That was the flicker. The resource events drive it instead.
             */
            if (isAutoAssignPending() || isAssignmentInProgress()) {
                log('an assignment pass is running or due; holding the assign icon back');
                return null;
            }
            const placeable = anythingCanBePlaced();
            /*
             * ⚠️ Probe, not logic. `panel-action` draws this notification twice over: as a
             * slot icon (which this filter controls) and, when it is what blocks the end of
             * the turn, on the main action button - and that one is fetched straight from
             * `findEndTurnBlocking`, never through here. Knowing which of the two we are
             * looking at is the difference between hiding a nag and hiding the reason the
             * turn will not end.
             */
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
            return placeable ? info : null;
        };
        for (const name of RECHECK_EVENTS) {
            try {
                engine.on(name, () => {
                    forgetPlaceability();
                    scheduleRecheck();
                });
            } catch (error) {
                warn(`could not listen for ${name}: ${error}`);
            }
        }
        // Switching automatic assignment on or off changes whether the icon may be hidden
        // at all, and no engine event follows an options change - so without this the
        // player would not see the difference until something else happened to refresh it.
        window.addEventListener(CommerceOptionsChangedEventName, () => {
            forgetPlaceability();
            scheduleRecheck();
        });
        wrapActionButton();
        attached = true;
        log(`assign action icon filter installed (type hash ${hiddenType})`);
    } catch (error) {
        warn(`could not install the assign action icon filter: ${error}`);
    }
}
