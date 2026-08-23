/**
 * The standing order a bought merchant carries: "go to that settlement and open the route".
 *
 * A purchase is one click, but the journey is several turns, and the trade route itself can
 * only be signed once the merchant is close enough. Something therefore has to remember, on
 * every turn in between, where this merchant was going - and try the command again the
 * moment it becomes legal, rather than leaving the player to notice.
 *
 * The shape is the one Holistic QoL+ arrived at for the same problem (its "merchant route
 * continuation" patch), and it is worth saying why it is that shape:
 *
 *   1. An order is (merchant, target settlement). It is stored, not held in a closure, so it
 *      survives the Commerce screen being closed - the journey outlives the screen.
 *   2. Every pass tries to SIGN first and only walks when signing is refused. Distance is not
 *      computed anywhere: `canStart` is the only thing that knows how far is close enough,
 *      and the rules differ between ages and between land and sea.
 *   3. The order is dropped the moment the route is signed or the merchant is gone.
 *
 * ⚠️ THE ATTEMPT CAP IS NOT A TIDINESS MEASURE - WITHOUT IT THE GAME FREEZES. The engine
 * answers a move request it cannot honour by firing `UnitOperationsCleared` /
 * `UnitOperationDeactivated`, which is exactly what this module listens for. A merchant that
 * cannot reach its target therefore re-requests, is refused, is woken by its own refusal, and
 * the cascade never ends. Holistic QoL+ documents the same freeze. Three tries per unit per
 * turn is the ceiling; a deliberate click resets it.
 *
 * Where the order is kept
 * -----------------------
 * `UI.setOption("user", "Mod", …)` with a NUMBER - the plot index of the target settlement,
 * plus one so that zero can mean "no order". Same channel, same reasoning and same per-game
 * keying as `ui/planner/priority-store.js`; see the note there for why `localStorage` alone
 * was not enough. Nothing is written into the save: this mod declares AffectsSavedGames = 0.
 */
import {
    approachLocations,
    canSignRoute,
    isMerchant,
    localMerchants,
    moveMerchant,
    hasSpentItsTurn,
    readMerchants,
    routesOpenFromAnywhere,
    signRoute,
    unitKey,
} from './merchant.js';
import { onEngineEvent, onLocalPlayerEvent } from './events.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';
const STORAGE_KEY = 'najane-commerce-merchant-orders';

/**
 * Raised whenever the set of standing orders changes - one given, one finished, or one dropped
 * because the merchant carrying it is gone. Anything showing the state of an order (the button
 * on a trade route card) redraws on this rather than on a timer.
 */
export const MerchantOrdersChangedEventName = 'najane-merchant-orders-changed';

/** See the ⚠️ at the top of the file. This number is the difference between a working
 *  mod and a hung game. */
const ATTEMPTS_PER_TURN = 3;

/** Long enough for a queued request to have landed, short enough to feel immediate. */
const PROCESS_DELAY_MS = 160;

/**
 * These only ever ask "can the route be signed now?" - see `processOrders`.
 *
 * ⚠️ EVERY ONE OF THEM IS RAISED FOR EVERY PLAYER IN THE GAME. `UnitMoved` fires once per
 * tile per unit, so a late-game AI turn raises thousands of them, and each used to wake a
 * pass that walked the player's entire unit list to conclude that none of it was about a
 * merchant of ours. They are subscribed through `onLocalPlayerEvent`, which drops everybody
 * else's before this module is reached - the same check `panel-action.ts` opens its own
 * `onUnitMoved` with. See engine/events.js.
 */
const SIGN_EVENTS = [
    'UnitMoved',
    'UnitMoveComplete',
    'UnitOperationsCleared',
    'UnitOperationDeactivated',
    'UnitRemovedFromMap',
];

/**
 * The passes that are allowed to set a merchant walking.
 *
 * ⚠️ `UnitMovementPointsChanged` IS ONE OF THEM, and without it the whole thing deadlocks in
 * the ages where merchants must travel. `LocalPlayerTurnBegin` fires BEFORE the engine hands
 * the units their movement back - traced in UI.log:
 *
 *     turn begins   order=1546 moves=0 mayMove=true    <- the only pass that may move
 *     a tick later  order=1546 moves=5 mayMove=false   <- movement is back, may not move
 *
 * So the one pass permitted to travel always saw a merchant with nothing to travel on, and
 * every pass after it was sign-only. The merchant sat still, turn after turn, having been
 * given a perfectly good order. Movement being restored is itself the moment to act on, and
 * the engine announces it.
 *
 * ⚠️ Safe against the cascade this file's header warns about, on two counts: the per-turn
 * attempt cap still applies, and `advance` will not issue a course to a merchant that already
 * has one - so a merchant walking normally, which fires this event on every tile it spends,
 * cannot re-order itself around in circles.
 */
const MOVE_EVENTS = ['UnitMovementPointsChanged'];

/**
 * The pass that runs whatever the store thinks it knows.
 *
 * ⚠️ THE SAFETY NET FOR THE SHORTCUT BELOW. Every other pass is skipped outright when no
 * merchant is under an order, and "no merchant is under an order" is answered from a set
 * seeded out of the `localStorage` mirror - which `knownOrderedKeys` itself documents as
 * possibly unreadable. If it ever is, that shortcut would silently strand every merchant for
 * the rest of the session. This pass ignores the shortcut, so the worst case is an order that
 * resumes at the start of the next turn instead of instantly.
 *
 * It is also the pass that may move, for the reason recorded on `MOVE_EVENTS` above.
 */
const FULL_PASS_EVENTS = ['LocalPlayerTurnBegin'];

let gameKey = null;

/** Unit ids are only unique within one game; the file is keyed by the game's seed. */
function currentGameKey() {
    if (gameKey !== null) {
        return gameKey;
    }
    try {
        const seed = Configuration.getGame()?.gameSeed;
        gameKey = seed === undefined || seed === null ? null : String(seed);
    } catch (error) {
        gameKey = null;
    }
    return gameKey;
}

function optionName(key) {
    return `${MOD_ID}.merchantOrder.${currentGameKey()}.${key}`;
}

function readFallback(key) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return all?.[currentGameKey()]?.[key];
    } catch (error) {
        return undefined;
    }
}

function writeFallback(key, code) {
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        const game = currentGameKey();
        all[game] ??= {};
        all[game][key] = code;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (error) {
        // The primary channel is UI.setOption; this one is a bonus.
    }
}

/**
 * Which merchants have an order, as a set of unit keys.
 *
 * ⚠️ Kept because `UI.getOption` cannot be enumerated: it answers about a name you already
 * know. Without a list of the names, an order belonging to a merchant that has since drowned
 * can never be found again to be cleared - and unit ids are recycled, so the next merchant
 * born with that id would inherit a dead one's errand.
 *
 * Seeded from the `localStorage` mirror, which is the only one of the two channels that can be
 * read back whole. If that mirror is unavailable the set starts empty and this session simply
 * prunes nothing; the orders themselves still work.
 */
let orderedKeys = null;

function knownOrderedKeys() {
    if (orderedKeys) {
        return orderedKeys;
    }
    orderedKeys = new Set();
    try {
        const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        for (const [key, code] of Object.entries(all?.[currentGameKey()] ?? {})) {
            if (Number(code) > 0) {
                orderedKeys.add(key);
            }
        }
    } catch (error) {
        // An unreadable mirror is not worth a warning; see the note above.
    }
    return orderedKeys;
}

function announceChange() {
    try {
        window.dispatchEvent(new CustomEvent(MerchantOrdersChangedEventName));
    } catch (error) {
        warn(`could not announce the merchant orders change: ${error}`);
    }
}

function writeOrder(key, code) {
    try {
        UI.setOption('user', 'Mod', optionName(key), code);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the merchant's order: ${error}`);
    }
    writeFallback(key, code);
    if (code > 0) {
        knownOrderedKeys().add(key);
    } else {
        knownOrderedKeys().delete(key);
    }
    announceChange();
}

/** @returns the plot index of the settlement this merchant is heading for, or -1. */
function readOrder(key) {
    if (currentGameKey() === null) {
        return -1;
    }
    let code = null;
    try {
        code = UI.getOption('user', 'Mod', optionName(key));
    } catch (error) {
        code = null;
    }
    if (code == null) {
        code = readFallback(key);
    }
    const plotIndex = Number(code) - 1;
    return Number.isInteger(plotIndex) && plotIndex >= 0 ? plotIndex : -1;
}

/**
 * The settlement an order points at.
 *
 * ⚠️ Looked up from the plot rather than stored as a ComponentID, because a settlement that
 * changes hands keeps its plot and gets a new id. The order then still means what the player
 * meant by it - "that place" - and the route command is refused on its own terms if the new
 * owner is one we cannot trade with.
 */
function cityAtPlot(plotIndex) {
    try {
        return Cities.getAtLocation(plotIndex) ?? null;
    } catch (error) {
        return null;
    }
}

const attempts = new Map();

/**
 * When this mod last told a merchant to move, per unit.
 *
 * ⚠️ THIS IS WHAT TELLS OUR OWN REFUSALS APART FROM THE PLAYER'S HAND. Both look identical from
 * the outside: `UnitOperationsCleared` fires either way, and the merchant ends up standing
 * still with an order it is not pursuing. But an engine refusal arrives in the same breath as
 * the request that caused it, while a player calling a merchant back happens whenever they
 * feel like it - so a clear that lands within a moment of our own request is ours, and
 * anything later is theirs.
 */
const commandedAt = new Map();

/**
 * Merchants seen with a journey queued on the last pass.
 *
 * ⚠️ THIS IS WHAT MAKES "THE PLAYER STOPPED IT" A FACT RATHER THAN A GUESS. A cancelled
 * journey and a turn's ordinary housekeeping both arrive as `UnitOperationsCleared` on a
 * merchant with nothing queued - identical from the outside. What tells them apart is the
 * step before: a merchant the player called back HAD a journey a moment ago, and one that was
 * standing still waiting to sign never did.
 *
 * Dropping the order without that distinction wiped it on the turn rollover, which is how a
 * cancelled-and-resent merchant came to sit doing nothing for the rest of the game.
 */
const wasTravelling = new Set();

/** Long enough for a refusal to come back, far shorter than any human decision. */
const OURS_WINDOW_MS = 1500;

function currentTurn() {
    try {
        return Number(Game.turn);
    } catch (error) {
        return 0;
    }
}

function mayAttempt(key) {
    const turn = currentTurn();
    const entry = attempts.get(key);
    if (!entry || entry.turn !== turn) {
        attempts.set(key, { turn, count: 1 });
        return true;
    }
    if (entry.count >= ATTEMPTS_PER_TURN) {
        return false;
    }
    entry.count++;
    return true;
}

/**
 * Drops the order of a merchant the player has called back or halted.
 *
 * ⚠️ Only when it can no longer do the job from where it stands. A merchant that ARRIVES has
 * its operation cleared too, and on the turn it arrives it may still have movement in hand -
 * which is indistinguishable from having been stopped, except that this one is standing
 * exactly where the route can be signed. Dropping its order there would throw the errand away
 * one step from the end, so the sign pass is left to finish it.
 */
function rememberWhetherTravelling(unit) {
    const key = unitKey(unit?.id);
    if (!key) {
        return;
    }
    let queued = false;
    try {
        queued = Boolean(Units.getQueuedOperationDestination?.(unit.id));
    } catch (error) {
        queued = false;
    }
    if (queued) {
        wasTravelling.add(key);
    } else {
        wasTravelling.delete(key);
    }
}

function forgetOrderIfAbandoned(unitID) {
    const key = unitKey(unitID);
    if (!key || readOrder(key) < 0) {
        return;
    }
    // Our own request being refused, not the player's doing; the attempt cap handles those.
    if (Date.now() - (commandedAt.get(key) ?? 0) <= OURS_WINDOW_MS) {
        return;
    }
    let unit = null;
    try {
        unit = Units.get(unitID);
    } catch (error) {
        return;
    }
    if (!unit) {
        return;
    }
    /*
     * ⚠️ Still carrying a journey: the player REDIRECTED it rather than stopping it, so there
     * is something in progress and the order is not the thing to remove.
     */
    try {
        if (Units.getQueuedOperationDestination?.(unit.id)) {
            return;
        }
    } catch (error) {
        return;
    }
    /*
     * ⚠️ And it has to have been GOING somewhere for this to be a cancellation at all. A
     * merchant standing still - waiting to sign next turn, which is every Modern-age merchant
     * between being given its order and getting its movement - has its operations cleared by
     * the turn rolling over like anything else, and reading that as "the player called it
     * back" is what silently erased the order overnight.
     */
    if (!wasTravelling.has(key)) {
        return;
    }
    wasTravelling.delete(key);
    /*
     * ⚠️ Only where arrival is the point. A merchant that has ARRIVED has its operations
     * cleared too, and in the ages where it had to travel it is now standing exactly where the
     * route can be signed - dropping its order there would throw the errand away one step from
     * the end, so the sign pass is left to finish it.
     *
     * ⚠️ In the Modern age this test must NOT be applied, and applying it was a bug: a merchant
     * there can sign from anywhere, so `canSignRoute` is true wherever it stands and the guard
     * held every single time. Cancelling a merchant's journey did nothing to its order, and the
     * card went on treating it as spoken for.
     */
    if (!routesOpenFromAnywhere()) {
        const city = cityAtPlot(readOrder(key));
        if (city?.location && canSignRoute(unit, city.location)) {
            return;
        }
    }
    log('a merchant was called back; its standing order is dropped');
    clearMerchantOrder(unitID);
}

export function clearMerchantOrder(unitID) {
    const key = unitKey(unitID);
    if (!key) {
        return;
    }
    attempts.delete(key);
    commandedAt.delete(key);
    wasTravelling.delete(key);
    writeOrder(key, 0);
}

/**
 * Works one merchant: sign if the engine will have it, walk on if the caller allows it.
 *
 * @returns true when the order is finished with, so the caller can drop it.
 */
function advance(unit, city, mayMove) {
    if (signRoute(unit, city.location)) {
        log(`trade route opened with ${Locale.compose(city.name ?? '')}`);
        return true;
    }

    /*
     * ⚠️ IN THE MODERN AGE, NO JOURNEY IS EVER THE ANSWER. A merchant there opens a route from
     * wherever it stands, so a refusal is never about distance - it is the trade limit, a war,
     * or simply this turn's movement already spent. Walking cannot fix any of those, and doing
     * it anyway is what carried freshly bought merchants off towards the other empire for
     * nothing. The order stands and is retried when the turn begins.
     */
    if (routesOpenFromAnywhere()) {
        return false;
    }

    /*
     * Antiquity and Exploration: the merchant has to get there. Out of movement it cannot set
     * off this turn - a course issued now would only sit queued - so the turn beginning is
     * left to start it, which is also the pass that is allowed to move.
     */
    if (hasSpentItsTurn(unit)) {
        return false;
    }
    if (!mayMove) {
        return false;
    }
    /*
     * ⚠️ Already walking: leave it. Re-issuing a course to a merchant that has one would
     * restart the journey it is partway through, and would do so on every movement point it
     * spends now that spending them wakes this pass.
     */
    try {
        if (Units.getQueuedOperationDestination?.(unit.id)) {
            return false;
        }
    } catch (error) {
        return false;
    }
    if (!mayAttempt(unitKey(unit.id))) {
        return false;
    }
    for (const location of approachLocations(unit, city)) {
        if (moveMerchant(unit, location)) {
            commandedAt.set(unitKey(unit.id), Date.now());
            return false;
        }
    }
    return false;
}


let processing = false;
let scheduled = false;
let scheduledMayMove = false;

/**
 * Drops the orders of merchants that no longer exist.
 *
 * A merchant lost at sea, killed by a raider or disbanded takes nothing with it: the order is a
 * number in the user options, and nothing in the engine knows it is there. Left alone it shows
 * on the card as "one is already on its way" for the rest of the game - a wrong answer to the
 * one question the button exists to answer - and, because unit ids are recycled, the next
 * merchant to be born with that id would silently inherit the errand.
 *
 * ⚠️ Skipped entirely when the merchant list could not be read. An empty list means "they are
 * all gone"; a failed call means nothing at all, and treating the two the same would throw away
 * the orders of merchants that are alive and walking. See `readMerchants`.
 */
function pruneOrders(merchants) {
    if (!merchants) {
        return;
    }
    const known = knownOrderedKeys();
    if (known.size === 0) {
        return;
    }
    const alive = new Set(merchants.map((unit) => unitKey(unit.id)));
    let dropped = 0;
    for (const key of Array.from(known)) {
        if (alive.has(key)) {
            continue;
        }
        attempts.delete(key);
        // writeOrder announces the change and takes the key out of the set.
        writeOrder(key, 0);
        dropped++;
    }
    if (dropped > 0) {
        log(`${dropped} merchant order(s) dropped: the merchant is gone`);
    }
}

/**
 * @param mayMove whether this pass may issue movement, or only try to sign the route.
 *
 * ⚠️ Most passes are sign-only, and that is the whole reason the player keeps control of
 * their own merchant. A pass that re-issued movement on every `UnitMoveComplete` would drag
 * the merchant back onto its errand the instant the player moved it anywhere else - and it is
 * also the pass that feeds the refusal cascade described at the top of this file. Movement is
 * re-issued once a turn, and on the click that gave the order.
 */
function processOrders(mayMove) {
    if (processing) {
        return;
    }
    processing = true;
    try {
        const merchants = readMerchants();
        pruneOrders(merchants);
        for (const unit of merchants ?? []) {
            rememberWhetherTravelling(unit);
            const key = unitKey(unit.id);
            const plotIndex = readOrder(key);
            if (plotIndex < 0) {
                continue;
            }
            /*
             * ⚠️ Repairs the set from the store that actually holds the orders.
             *
             * `knownOrderedKeys` is seeded from the `localStorage` mirror, which may be
             * unreadable - and since 1.9 an empty set means "skip every pass". Without this,
             * a session that started with an unreadable mirror would fall back to one pass a
             * turn for good, even though `readOrder` can plainly see the order. Now the first
             * full pass finds it and every later event acts on it at once.
             */
            knownOrderedKeys().add(key);
            const city = cityAtPlot(plotIndex);
            if (!city) {
                // The settlement is gone - razed, or never found again. The merchant is left
                // where it stands rather than walking to an empty plot.
                clearMerchantOrder(unit.id);
                continue;
            }
            try {
                if (advance(unit, city, mayMove)) {
                    clearMerchantOrder(unit.id);
                }
            } catch (error) {
                warn(`could not advance a merchant's order: ${error}`);
            }
        }
    } finally {
        processing = false;
    }
}

/**
 * ⚠️ Debounced, and it has to be. Every event this module listens for can arrive several
 * times for one move, and each pass talks to the engine about every merchant. Two passes that
 * fall in the same window merge, and the one that may move wins.
 */
function scheduleProcess(mayMove = false, { force = false } = {}) {
    /*
     * ⚠️ Nothing is under an order, so there is nothing for a pass to do - and this is the
     * single cheapest place to say so. Below this line a pass reads every unit the player
     * owns and asks the engine about each one; above it, the answer costs a set's size.
     * `FULL_PASS_EVENTS` is the safety net for the case where the set is wrong.
     */
    if (!force && knownOrderedKeys().size === 0) {
        return;
    }
    scheduledMayMove = scheduledMayMove || mayMove;
    if (scheduled) {
        return;
    }
    scheduled = true;
    setTimeout(() => {
        scheduled = false;
        const move = scheduledMayMove;
        scheduledMayMove = false;
        processOrders(move);
    }, PROCESS_DELAY_MS);
}

/**
 * Files the order and acts on it at once - a merchant bought in a settlement that is already
 * within reach opens its route on the same click rather than after a turn.
 */
/**
 * @param mayMove whether this merchant may set off NOW if the route cannot be signed yet.
 *
 * ⚠️ Pass false when something you have just requested is about to change the answer. A
 * treaty proposal is the case this exists for: `sendRequest` only QUEUES, so for a moment
 * afterwards the engine still reports the old trade capacity and refuses the route - and a
 * merchant with movement in hand reads that refusal as "too far" and walks off towards the
 * other empire for a journey the treaty was about to make unnecessary. Standing still costs
 * nothing: the order is retried at the start of every turn, by which time the treaty has
 * resolved one way or the other.
 */
export function orderMerchantTo(unit, city, { mayMove = true } = {}) {
    if (!isMerchant(unit) || !city?.location) {
        return false;
    }
    const key = unitKey(unit.id);
    if (!key || currentGameKey() === null) {
        return false;
    }

    let plotIndex = -1;
    try {
        plotIndex = GameplayMap.getIndexFromLocation(city.location);
    } catch (error) {
        warn(`could not locate ${Locale.compose(city.name ?? '')}: ${error}`);
        return false;
    }

    writeOrder(key, plotIndex + 1);
    // A deliberate order gets a fresh budget: the cap exists to stop the engine's own
    // refusals looping, not to ration what the player asked for. It is also the one pass
    // outside the turn beginning that is allowed to set the merchant walking.
    attempts.delete(key);

    /*
     * ⚠️ `advance` may quite correctly decide to do NOTHING. A merchant bought this turn has
     * no movement left, and from the Modern age it does not need any - it is already standing
     * somewhere the route can be opened from, so the right answer is to wait where it is and
     * sign when the turn begins, not to set off. See `hasSpentItsTurn` in merchant.js.
     */
    if (advance(unit, city, mayMove)) {
        clearMerchantOrder(unit.id);
    }
    return true;
}

/**
 * The merchants already walking to this settlement.
 *
 * ⚠️ Read from the LIVE merchants, not from the stored orders. A merchant that drowned on the
 * way still has its order in the options until the next pruning pass, and the card must not
 * offer to wait for - or fly the camera to - a merchant that no longer exists.
 */
/**
 * The merchants walking to any settlement of one leader.
 *
 * ⚠️ This is what stops the mod selling the same trade slot twice. Capacity is counted PER
 * LEADER, not per settlement: with one slot free and a merchant already on its way to one of
 * Amina's cities, a second merchant sent to a different city of hers arrives to a slot that is
 * spoken for. The card cannot know that from its own status - the projection was made before
 * the first merchant left.
 */
/** Whether this mod has told this merchant to go somewhere. */
function hasStandingOrder(unit) {
    return readOrder(unitKey(unit.id)) >= 0;
}

/**
 * Whether this merchant is actually going somewhere right now.
 *
 * ⚠️ THE ONE PLACE THE UNIT'S REAL STATE IS READ, and both questions this module answers are
 * built on it - "which merchants are free?" and "which are on their way to that settlement?".
 * Kept as one predicate because the two are opposites: answered separately they drifted into
 * claiming the same merchant was simultaneously idle and en route.
 *
 * ⚠️ The standing order is NOT evidence of travel. Orders live in the user options, outside the
 * save (this mod declares `AffectsSavedGames = 0` deliberately), so they outlive a reloaded
 * save - and the player can stop or turn a merchant around at any moment without the store
 * hearing about it. Both were reported: buttons that never appeared after a reload, and
 * merchants reported "on the way" long after being called back.
 *
 * Two questions, both about the unit and both about now:
 *
 *   a queued destination   it is on its way somewhere. `Units.getQueuedOperationDestination`
 *                          is what the game's own map decoration reads to draw the path a unit
 *                          still has to walk, so this is true exactly while the player would
 *                          see that path.
 *   no movement left       it may be mid-errand this turn - including this mod's own "wait
 *                          here and sign the route when the turn begins". Counted as travel,
 *                          the conservative half: it errs towards leaving a merchant alone.
 *
 * A merchant with movement in hand and nowhere queued is doing nothing, whatever the store
 * says - which is also exactly what the player sees on the map.
 */
function isTravelling(unit) {
    try {
        if (Units.getQueuedOperationDestination?.(unit.id)) {
            return true;
        }
    } catch (error) {
        // Cannot tell whether it is travelling - assume it is, and leave it be.
        return true;
    }
    /*
     * ⚠️ Nothing is queued, so out of movement only means "busy" when there is an ORDER that
     * explains it - and that pairing is the whole point.
     *
     * Under an order, no movement is this mod's own merchant partway through its errand,
     * including the one told to stand still and sign the route when the turn begins. Without
     * one, no movement means only that it was bought this turn, or has already walked: nobody
     * sent it anywhere, and it is as free to be given a job as it will be tomorrow. Treating
     * that as busy hid the plus buttons for a whole turn after buying merchants - which is
     * exactly the turn a player is looking for somewhere to send them.
     */
    return hasStandingOrder(unit) && Number(unit?.Movement?.movementMovesRemaining ?? 0) <= 0;
}

/** Merchants of ours with nothing to do; see `isTravelling` for what "nothing" means. */
export function idleMerchants() {
    return localMerchants().filter((unit) => !isTravelling(unit));
}

/**
 * The spare merchant that would reach `city` soonest, or null when there is none.
 *
 * Nearest by plot distance rather than by path length: a path is only knowable for a
 * destination the unit can currently reach, and the whole point of the button this feeds is
 * that from the Modern age the distance may not matter at all.
 */
export function nearestIdleMerchant(city) {
    const spare = idleMerchants();
    if (spare.length === 0 || !city?.location) {
        return null;
    }
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const unit of spare) {
        let distance = Number.POSITIVE_INFINITY;
        try {
            distance = GameplayMap.getPlotDistance(
                unit.location.x, unit.location.y, city.location.x, city.location.y,
            );
        } catch (error) {
            distance = Number.POSITIVE_INFINITY;
        }
        if (distance < bestDistance) {
            best = unit;
            bestDistance = distance;
        }
    }
    return best ?? spare[0];
}

export function merchantsBoundForPlayer(leaderId) {
    if (leaderId === undefined || leaderId === null) {
        return [];
    }
    return localMerchants().filter((unit) => {
        const plotIndex = readOrder(unitKey(unit.id));
        // Same rule as `merchantsBoundFor`: a halted merchant is not spoken for.
        return plotIndex >= 0 && isTravelling(unit) && cityAtPlot(plotIndex)?.owner === leaderId;
    });
}

export function merchantsBoundFor(city) {
    if (!city?.location) {
        return [];
    }
    let plotIndex = -1;
    try {
        plotIndex = GameplayMap.getIndexFromLocation(city.location);
    } catch (error) {
        return [];
    }
    /*
     * ⚠️ The order AND the unit, never the order alone. A merchant the player has called back
     * or halted still carries its order - nothing tells the store otherwise - and reporting it
     * as "one is already on its way" is what left cards refusing to offer a second merchant
     * for a delivery that had been cancelled. See `isTravelling`.
     */
    return localMerchants().filter(
        (unit) => readOrder(unitKey(unit.id)) === plotIndex && isTravelling(unit),
    );
}

let listening = false;

/**
 * ⚠️ Starts with the screen closed, from the entry point. The journey it looks after carries
 * on for turns after the Commerce screen has been shut, and an order that is only processed
 * while a screen happens to be open would strand the merchant on the road.
 */
export function startMerchantOrders() {
    if (listening) {
        return;
    }
    listening = true;
    // ⚠️ An arrow of our own, not `scheduleProcess` itself: the engine hands the listener its
    // event payload, and the first argument here decides whether the pass may move a
    // merchant. Passing the function straight in made every event a moving one, because a
    // payload object is truthy.
    SIGN_EVENTS.forEach((name) => onLocalPlayerEvent(name, () => scheduleProcess(false)));
    MOVE_EVENTS.forEach((name) => onLocalPlayerEvent(name, () => scheduleProcess(true)));
    // Carries no unit and belongs to nobody, so it is subscribed unfiltered.
    FULL_PASS_EVENTS.forEach((name) =>
        onEngineEvent(name, () => scheduleProcess(true, { force: true })),
    );

    /*
     * ⚠️ Per unit, unlike everything above. These two are the ONLY events that carry which
     * merchant they are about (`{ unit }`, the same payload the game's own unit-actions panel
     * reads), and this needs that: the question is not "has anything changed" but "has THIS
     * merchant been called back". They are already listened for above as sign-only passes;
     * this is a second listener with a different job, not a replacement.
     */
    for (const name of ['UnitOperationsCleared', 'UnitOperationDeactivated']) {
        onLocalPlayerEvent(name, (data) => {
            const unitID = data?.unit;
            if (unitID) {
                forgetOrderIfAbandoned(unitID);
            }
        });
    }
    // A game loaded mid-session brings its own seed, and with it its own orders.
    onEngineEvent('GameStarted', () => {
        gameKey = null;
        orderedKeys = null;
        attempts.clear();
    });
    // A load lands mid-journey as often as not: try to sign straight away, and let the first
    // turn beginning be the one that sets anyone still short of the target walking again.
    // Forced, because this is also where the orders of a loaded game are first read.
    scheduleProcess(false, { force: true });
}
