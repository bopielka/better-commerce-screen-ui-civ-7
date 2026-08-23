/**
 * The one diplomatic action this mod ever proposes on the player's behalf: "Improve Trade
 * Relations", which raises the Trade Route limit with a leader by one if they accept. Every
 * question is put to the engine; nothing here guesses at the rules.
 *
 * ⚠️ Proposing is NOT the same as it taking effect. The action is `Opposed="true"` in the data -
 * the other leader can refuse - and `canStart` only answers "may I ask", never "will they say
 * yes". The Influence is spent while the request is in flight either way.
 *
 * ⚠️ This mod does not know how many turns a reply takes and does not claim to. What it sends for
 * afterwards - a merchant - already retries every turn on its own, which is the right way to wait
 * for an uncertain outcome.
 */
import { onEngineEvent } from './events.js';
import { warn } from '../support/diagnostics.js';

const IMPROVE_TRADE_RELATIONS = 'DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS';

/**
 * Leaders this mod has proposed to since the turn began, and the reason this file has any memory.
 *
 * ⚠️ `sendRequest` QUEUES. For the frame or two before the core plays it back, `canStart` still
 * answers "yes, you may propose" - it describes a state the request has not reached. Redrawing in
 * that window, which is exactly what a click does, put the button back bright and priced on an
 * action that could no longer be taken.
 *
 * NOT second-guessing the rules: `BaseDuration="0"` means the action resolves at the end of the
 * turn it was proposed in, so "proposed this turn" is the engine's own
 * `LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT`, said a few frames earlier.
 */
const proposedThisTurn = new Set();

// Through the shared dispatcher, so this is not a fifth separate `engine.on` for a name
// five modules here already listen for; see engine/events.js.
onEngineEvent('LocalPlayerTurnBegin', () => proposedThisTurn.clear());

function actionType() {
    return DiplomacyActionTypes[IMPROVE_TRADE_RELATIONS];
}

/**
 * A refusal reason this mod words differently, swapped BY KEY.
 * ⚠️ By key, never by matching composed text: the composed string is translated and would match
 * nothing in any other language.
 */
const REASON_OVERRIDES = {
    LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT: 'LOC_NAJANE_COMMERCE_IMPROVE_STARTED',
};

/** What proposing "Improve Trade Relations" with `leaderId` looks like right now. */
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
    // ⚠️ Our own answer wins WHILE A REQUEST IS IN FLIGHT, and only then; see proposedThisTurn.
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
    // ⚠️ Already localisation KEYS, not composed text - the same shape the game passes around.
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

/** The same arguments for `canStart` and `sendRequest` - the game's own "quick start" shape. */
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
 * Sends the proposal, re-checking `canStart` itself rather than trusting the offer it was handed:
 * that offer may have been built a frame or more ago.
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
