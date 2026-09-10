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

// ⚠️ `GameInfo` holds the age being played; the bands are read from it and belong to that age.
onEngineEvent('GameAgeEnded', () => { hostileCeiling = undefined; });

/**
 * Whether this mod has already proposed to this leader since the turn began.
 *
 * ⚠️ Exported so the SCREEN can tell "not yet, but soon" from "not ever". A refusal for having
 * proposed already clears with the turn; a refusal because the two are hostile does not, and a
 * card must not offer to wait for something waiting will not bring.
 */
export function hasProposedThisTurn(leaderId) {
    return proposedThisTurn.has(leaderId);
}

/**
 * The relationship band below which this mod stops offering to raise the trade limit.
 * ⚠️ The NAME is hardcoded, the NUMBER is not: the band's edge lives in
 * `DiplomacyPlayerRelationships` (`-2` today) and is balance data this mod has no business
 * carrying. Same footing as the action name at the top of this file.
 */
const HOSTILE_RELATIONSHIP = 'PLAYER_RELATIONSHIP_HOSTILE';

let hostileCeiling;

function hostileBandCeiling() {
    if (hostileCeiling !== undefined) {
        return hostileCeiling;
    }
    hostileCeiling = null;
    try {
        for (const row of GameInfo.DiplomacyPlayerRelationships ?? []) {
            if (row.DiplomacyPlayerRelationshipType === HOSTILE_RELATIONSHIP) {
                const ceiling = Number(row.MaxRelationship);
                hostileCeiling = Number.isFinite(ceiling) ? ceiling : null;
                break;
            }
        }
    } catch (error) {
        warn(`could not read the relationship bands: ${error}`);
    }
    return hostileCeiling;
}

/**
 * The `[icon:...]` markup for the relationship band the treaty needs, or ''.
 *
 * ⚠️ DERIVED, NOT NAMED. The band required is the one that begins where "hostile" ends, so it is
 * found by matching `MinRelationship` against the hostile ceiling rather than by writing
 * "unfriendly" down - which would be wrong the moment the bands are rebalanced.
 *
 * ⚠️ `[icon:TYPE]` is the game's own markup in composed text, and the relationship icons are
 * registered under exactly these type names (`relationship-icons.xml`). An id the build does not
 * know renders as nothing, which is why this is safe to prepend blind.
 */
export function requiredRelationshipIcon() {
    const ceiling = hostileBandCeiling();
    if (ceiling === null) {
        return '';
    }
    try {
        for (const row of GameInfo.DiplomacyPlayerRelationships ?? []) {
            if (Number(row.MinRelationship) === ceiling) {
                return `[icon:${row.DiplomacyPlayerRelationshipType}] `;
            }
        }
    } catch (error) {
        return '';
    }
    return '';
}

/**
 * Whether relations with this leader rule the treaty out entirely.
 *
 * ⚠️ NOT A REFUSAL THAT A TURN CLEARS. Short Influence and "already proposed this turn" both pass
 * with the turn; hostility does not, and a card must not offer to wait for it.
 *
 * ⚠️ WAR IS DELIBERATELY NOT ASKED ABOUT HERE (user's instruction, 2026-09-10: Prussia can trade
 * while at war). Whether a war stops a route is a CIV ABILITY, and the engine already accounts for
 * it - `projectPossibleTradeRoutes` reports `AT_WAR` in a route's status only where it actually
 * blocks, and `unavailableGroupFor` reads that. A war test here would overrule the one thing that
 * knows about the exceptions.
 */
export function relationshipBlocksTrade(leaderId) {
    try {
        const diplomacy = Players.get(GameContext.localPlayerID)?.Diplomacy;
        if (!diplomacy) {
            return false;
        }
        const level = Number(diplomacy.getRelationshipLevel?.(leaderId));
        const ceiling = hostileBandCeiling();
        return Number.isFinite(level) && ceiling !== null && level < ceiling;
    } catch (error) {
        // Cannot tell - assume it is not blocked, which only means the old behaviour.
        return false;
    }
}

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
