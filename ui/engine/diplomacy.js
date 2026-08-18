/**
 * The one diplomatic action this mod ever proposes on the player's behalf: "Improve Trade
 * Relations" - the treaty that, if the other leader accepts, raises the Trade Route limit
 * with them by one. Nothing here guesses at the rules; every question is put to the engine,
 * the same way `ui/engine/merchant.js` never guesses at what a settlement can sell.
 *
 * ⚠️ Proposing it is NOT the same as it taking effect. `DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS`
 * is `Opposed="true"` in the game's own data - the other leader can refuse it, same as any
 * treaty. `canStart` only answers "may I ask", never "will they say yes". A request that goes
 * through spends the Influence regardless of the answer (`RejectionRefundsInfluence="true"` in
 * the data - refused, and it comes back - but not `false` while the request is in flight).
 *
 * ⚠️ `BaseDuration="0"` in the data, and it is not read from anywhere else here on purpose:
 * this mod does not know how many turns a reply takes and does not claim to. What it sends
 * for afterwards - a merchant, via `ui/engine/merchant-orders.js` - already retries opening
 * the route every turn on its own, which is the right way to wait for an uncertain outcome:
 * do the one thing that is certain (send the merchant), and let the part that depends on
 * someone else's answer resolve or not in its own time.
 */
import { warn } from '../support/diagnostics.js';

const IMPROVE_TRADE_RELATIONS = 'DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS';

/**
 * Leaders this mod has proposed to since the turn began, and the reason this file has any
 * memory at all.
 *
 * ⚠️ `Game.PlayerOperations.sendRequest` QUEUES the request; it does not perform it. For the
 * frame or two before the game core plays it back, `canStart` still answers "yes, you may
 * propose" - it is describing a game state the request has not reached yet. Redrawing in that
 * window (which is exactly what a click does) put the button back exactly as it was, bright
 * and priced, on an action that could no longer be taken: the player pressed it, nothing
 * appeared to happen, and pressing again did nothing either.
 *
 * So the answer is remembered on our side for the one window where the engine's is stale.
 * This is NOT second-guessing the rules - `BaseDuration="0"` means the action resolves at the
 * end of the turn it was proposed in, so "proposed this turn" is precisely the engine's own
 * `LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT`, said a few frames earlier. Once the core
 * has caught up the two agree, and this set is only still consulted because agreeing costs
 * nothing.
 *
 * ⚠️ Cleared on `LocalPlayerTurnBegin` - a refused proposal frees the action again, and the
 * turn boundary is where that happens whichever way it went.
 */
const proposedThisTurn = new Set();

try {
    engine.on('LocalPlayerTurnBegin', () => proposedThisTurn.clear());
} catch (error) {
    warn(`could not listen for the turn beginning: ${error}`);
}

function actionType() {
    return DiplomacyActionTypes[IMPROVE_TRADE_RELATIONS];
}

/**
 * A refusal reason this mod words differently, swapped BY KEY.
 *
 * The game's own `LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT` says the action is already
 * running and stops there, which is right for diplomacy in general - most projects run for
 * several turns, and there is no one answer to "until when". This one is not most projects:
 * `diplomacy-actions.xml` gives Improve Trade Relations `BaseDuration="0"`, so it resolves at
 * the end of the turn it was proposed in and the next attempt is a turn away, never longer.
 * On a trade route card that IS the whole question the player is asking, so it is said.
 *
 * ⚠️ Swapped as a KEY, before `Locale.compose` runs - never by matching the composed sentence.
 * `FailureReasons` comes back as keys precisely so that nothing downstream has to recognise a
 * translated string; doing it the other way would need one comparison per language and would
 * break the first time the game reworded its own text. See 12-localisation.md.
 *
 * ⚠️ Not an override of the game's key either. Defining that tag in this mod's own text files
 * would reword it everywhere in the game, on every diplomatic action, not just on this card.
 */
const REASON_OVERRIDES = {
    LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT: 'LOC_NAJANE_COMMERCE_IMPROVE_STARTED',
};

/**
 * What proposing "Improve Trade Relations" with `leaderId` looks like right now.
 *
 * ⚠️ Asked through `Game.Diplomacy.getProjectDataForUI`, the same call the diplomacy hub
 * itself makes to build its own list (`DiplomacyManager.queryAvailableProjectData`) - not
 * reconstructed from the raw tables. Every rule the game enforces here - once proposed the
 * next attempt costs more, blocked for a spell after a refusal, requires having met them, not
 * at war - already comes back as `canStart` and `reasons`; none of it is re-derived.
 *
 * @returns null when the age or the pairing does not offer this action at all - a different
 *          case from "offered, but not right now".
 */
export function tradeRelationsOffer(leaderId) {
    const type = actionType();
    if (type === undefined || leaderId === undefined || leaderId === null) {
        return null;
    }

    let project = null;
    try {
        const projects = Game.Diplomacy?.getProjectDataForUI(
            GameContext.localPlayerID,
            leaderId,
            DiplomacyActionTargetTypes.NO_DIPLOMACY_TARGET,
            DiplomacyActionGroups.NO_DIPLOMACY_ACTION_GROUP,
            -1,
            DiplomacyActionTargetTypes.NO_DIPLOMACY_TARGET,
        ) ?? [];
        project = projects.find((entry) => entry.actionType === type) ?? null;
    } catch (error) {
        warn(`could not read the trade relations offer for player ${leaderId}: ${error}`);
        return null;
    }
    if (!project) {
        return null;
    }

    const cost = project.targetList1?.find((entry) => entry.targetID === leaderId)?.costYieldD ?? 0;
    const args = operationArgs(project, leaderId);
    let result = { Success: false };
    try {
        result = Game.PlayerOperations.canStart(GameContext.localPlayerID, project.operationType, args, false);
    } catch (error) {
        warn(`could not check the trade relations offer for player ${leaderId}: ${error}`);
    }
    /*
     * ⚠️ Our own answer wins WHILE A REQUEST IS IN FLIGHT, and only then. See
     * `proposedThisTurn`: the engine has not been told yet, so its "yes" is about a game state
     * that no longer exists. The reason given is the engine's own for this case, through the
     * same override table, so a player never sees two different sentences for one situation.
     */
    if (proposedThisTurn.has(leaderId)) {
        result = {
            Success: false,
            FailureReasons: ['LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT'],
        };
    }

    return {
        project,
        args,
        cost,
        canStart: result.Success === true,
        // ⚠️ Already localisation KEYS, not composed text - the same shape
        // `assignRefusalReasons` reads in ui/engine/operations.js. Composed here, once, so
        // nothing above has to know that.
        reasons: (result.FailureReasons ?? []).map((reason) => {
            const key = REASON_OVERRIDES[reason] ?? reason;
            try {
                return Locale.compose(key);
            } catch (error) {
                return key;
            }
        }),
    };
}

/**
 * The same arguments for `canStart` and for `sendRequest` - the game's own "quick start" of a
 * project asks for nothing more than this; see `clickQuickStartActionItem` in
 * panel-diplomacy-actions.js, which this mirrors.
 */
function operationArgs(project, leaderId) {
    return {
        Amount: 1,
        Player1: GameContext.localPlayerID,
        Player2: leaderId,
        ID: leaderId,
        Type: project.actionType,
    };
}

export function influenceBalance() {
    try {
        return Players.get(GameContext.localPlayerID)?.DiplomacyTreasury?.diplomacyBalance ?? 0;
    } catch (error) {
        return 0;
    }
}

/**
 * Sends the proposal. Re-checks `canStart` itself rather than trusting the offer it was handed
 * - the offer may have been read a render pass ago, and Influence spent on something else
 * since would make it stale.
 *
 * @returns true once the request is queued - not once it is answered. See the file note.
 */
export function proposeTradeRelations(leaderId, offer) {
    if (!offer?.project) {
        return false;
    }
    try {
        if (!Game.PlayerOperations.canStart(
            GameContext.localPlayerID,
            offer.project.operationType,
            offer.args,
            false,
        ).Success) {
            return false;
        }
        Game.PlayerOperations.sendRequest(GameContext.localPlayerID, offer.project.operationType, offer.args);
        // Before anything redraws: the request is queued, and until the core plays it back
        // `canStart` will keep saying this is still on offer. See `proposedThisTurn`.
        proposedThisTurn.add(leaderId);
        return true;
    } catch (error) {
        warn(`proposing Improve Trade Relations with player ${leaderId} failed: ${error}`);
        return false;
    }
}
