/**
 * The standing order a bought merchant carries: "go to that settlement and open the route".
 *
 * An order is (merchant, target settlement), STORED rather than held in a closure, so it outlives
 * the screen. Every pass tries to SIGN first and only walks when signing is refused - distance is
 * computed nowhere, because `canStart` is the only thing that knows how far is close enough.
 *
 * ⚠️ THE ATTEMPT CAP IS NOT TIDINESS - WITHOUT IT THE GAME FREEZES. The engine answers a move it
 * cannot honour with `UnitOperationsCleared`/`UnitOperationDeactivated`, which is exactly what
 * this module listens for: the merchant re-requests, is refused, is woken by its own refusal.
 * Three tries per unit per turn; a deliberate click resets it.
 *
 * ⚠️ Stored as a NUMBER through `UI.setOption` - the target plot index plus one, so zero can mean
 * "no order". Nothing is written into the save; this mod declares AffectsSavedGames = 0.
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
import { readSection, writeSection } from './mod-storage.js';
import { onEngineEvent, onLocalPlayerEvent } from './events.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';
/** ⚠️ A section of the SHARED `modSettings` key - see engine/mod-storage.js for why. */
const SECTION = 'merchantOrders';

/** Raised when the set of standing orders changes; anything drawing one redraws on it. */
export const MerchantOrdersChangedEventName = 'najane-merchant-orders-changed';

/** See the ⚠️ at the top of the file. This number is the difference between a working
 *  mod and a hung game. */
const ATTEMPTS_PER_TURN = 3;

/** Long enough for a queued request to have landed, short enough to feel immediate. */
const PROCESS_DELAY_MS = 160;

/**
 * These only ever ask "can the route be signed now?".
 *
 * ⚠️ Every one is raised for EVERY player - `UnitMoved` fires once per tile per unit, so a late-
 * game AI turn raises thousands. Subscribed through `onLocalPlayerEvent`.
 */
const SIGN_EVENTS = [
    'UnitMoved',
    'UnitMoveComplete',
    'UnitOperationsCleared',
    'UnitOperationDeactivated',
    'UnitRemovedFromMap',
];

/**
 * The passes allowed to set a merchant walking.
 *
 * ⚠️ `UnitMovementPointsChanged` IS one of them, and without it the whole thing deadlocks in the
 * ages where merchants must travel: `LocalPlayerTurnBegin` fires BEFORE the engine hands movement
 * back, so the one pass permitted to travel always saw a merchant with nothing to travel on.
 * Traced in UI.log as `turn begins ... moves=0 mayMove=true` then `moves=5 mayMove=false`.
 *
 * ⚠️ Safe against the cascade above on two counts: the per-turn cap still applies, and `advance`
 * will not issue a course to a merchant that already has one.
 */
const MOVE_EVENTS = ['UnitMovementPointsChanged'];

/**
 * The pass that runs whatever the store thinks it knows - the safety net for the shortcut in
 * `scheduleProcess`, which skips every pass when the (possibly unreadable) key set is empty.
 * It is also the pass that may move; see MOVE_EVENTS.
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
    return readSection(SECTION)?.[currentGameKey()]?.[key];
}

function writeFallback(key, code) {
    writeSection(SECTION, (all) => {
        const game = currentGameKey();
        all[game] ??= {};
        all[game][key] = code;
    });
}

/**
 * Which merchants have an order, as a set of unit keys.
 * ⚠️ Kept because `UI.getOption` cannot be ENUMERATED: without a list of names, the order of a
 * merchant that has since drowned can never be found again - and ids are recycled, so the next
 * merchant born with that id inherits it. Seeded from the localStorage mirror.
 */
let orderedKeys = null;

function knownOrderedKeys() {
    if (orderedKeys) {
        return orderedKeys;
    }
    orderedKeys = new Set();
    try {
        const all = readSection(SECTION);
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
    // This module is the only writer, so the cache is repaired rather than thrown away.
    orderByKey.set(key, Number(code) > 0 ? Number(code) - 1 : -1);
    forgetMerchantState();
    announceChange();
}

/**
 * What every order says, read through to storage ONCE per merchant.
 *
 * ⚠️ `UI.getOption` is a lookup, and this is asked per merchant per pass AND per merchant per
 * trade-route card - a card asks three questions that each walked the whole list. Written only
 * by `writeOrder`, which repairs the entry rather than dropping it.
 *
 * ⚠️ Negative answers are cached too: "this merchant has no errand" is the common case and was
 * the one paying for a lookup every time. Same rule as `readLock` in resource-locks.js.
 */
const orderByKey = new Map();

/** @returns the plot index of the settlement this merchant is heading for, or -1. */
function readOrder(key) {
    // ⚠️ NOT cached: before the seed is readable every answer is "no order", and remembering
    // that would strand every merchant in a game loaded mid-session.
    if (currentGameKey() === null) {
        return -1;
    }
    const cached = orderByKey.get(key);
    if (cached !== undefined) {
        return cached;
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
    const order = Number.isInteger(plotIndex) && plotIndex >= 0 ? plotIndex : -1;
    orderByKey.set(key, order);
    return order;
}

/** The settlement an order points at, or -1. */
function cityAtPlot(plotIndex) {
    try {
        return Cities.getAtLocation(plotIndex) ?? null;
    } catch (error) {
        return null;
    }
}

const attempts = new Map();

/** When this mod last told a merchant to move, per unit. */
const commandedAt = new Map();

/**
 * Merchants seen with a journey queued on the last pass.
 * ⚠️ THIS IS WHAT MAKES "THE PLAYER STOPPED IT" A FACT RATHER THAN A GUESS. A cancellation and a
 * turn's housekeeping both arrive as `UnitOperationsCleared` on a merchant with nothing queued;
 * only the step before tells them apart. Without it the order was wiped on turn rollover.
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

/** Drops the order of a merchant the player has called back or halted. */
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
    // ⚠️ Still carrying a journey: the player REDIRECTED it rather than stopping it, so the order
    // stands.
    try {
        if (Units.getQueuedOperationDestination?.(unit.id)) {
            return;
        }
    } catch (error) {
        return;
    }
    // ⚠️ It has to have BEEN going somewhere for this to be a cancellation at all; see
    // `wasTravelling`.
    if (!wasTravelling.has(key)) {
        return;
    }
    wasTravelling.delete(key);
    // ⚠️ Only where arrival is the point: a merchant that has ARRIVED has its operations cleared
    // too, and that is success, not cancellation.
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

/** One merchant: sign if the engine will have it, walk on if the caller allows it. */
function advance(unit, city, mayMove) {
    if (signRoute(unit, city.location)) {
        log(() => `trade route opened with ${Locale.compose(city.name ?? '')}`);
        return true;
    }

    /*
     * ⚠️ IN THE MODERN AGE NO JOURNEY IS EVER THE ANSWER: a merchant opens a route from where it
     * stands, so a refusal is the trade limit, a war or spent movement - none of which walking
     * fixes. Doing it anyway carried freshly bought merchants off across the map for nothing.
     */
    if (routesOpenFromAnywhere()) {
        return false;
    }

    // Antiquity and Exploration: it has to get there. Out of movement it cannot set off this
    // turn, so the turn beginning is left to start it.
    if (hasSpentItsTurn(unit)) {
        return false;
    }
    if (!mayMove) {
        return false;
    }
    // ⚠️ Already walking: leave it. Re-issuing a course would restart the journey it is partway
    // through, on every movement point it spends.
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
 * Drops the orders of merchants that no longer exist - otherwise a card says "one is already on
 * its way" for the rest of the game, and a recycled unit id inherits the errand.
 *
 * ⚠️ Skipped entirely when the merchant list could not be READ. An empty list means "they are all
 * gone"; a failed call means nothing at all.
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

/** @param mayMove whether this pass may issue movement, or only try to sign the route. */
function processOrders(mayMove) {
    if (processing) {
        return;
    }
    processing = true;
    // A pass is exactly when a merchant has moved, arrived or been lost.
    forgetMerchantState();
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
             * ⚠️ Repairs the set from the store that actually holds the orders. `knownOrderedKeys`
             * is seeded from the localStorage mirror, which may be unreadable - and an empty set
             * means "skip every pass", so without this a session that started with an unreadable
             * mirror would fall back to one pass a turn for good.
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

/** ⚠️ Debounced: every event here can arrive several times for one move, and each pass talks to
 *  the engine about every merchant. Two in the same window merge, and the mover wins. */
function scheduleProcess(mayMove = false, { force = false } = {}) {
    /*
     * ⚠️ Nothing is under an order, so there is nothing to do - and this is the cheapest place to
     * say so. Below this line a pass reads every unit the player owns and asks the engine about
     * each. FULL_PASS_EVENTS is the safety net for a wrong set.
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

/** Files the order and acts on it at once, so a merchant already in reach opens on the click. */
/**
 * @param mayMove whether this merchant may set off NOW if the route cannot be signed yet.
 *
 * ⚠️ Pass false when something just requested is about to change the answer. `sendRequest` only
 * QUEUES, so for a moment the engine still reports the old trade capacity and refuses the route -
 * and a merchant with movement reads that as "too far" and walks off for nothing.
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
    // A deliberate order gets a fresh budget: the cap exists to stop the engine's own refusals
    // looping, not to ration what the player asked for.
    attempts.delete(key);

    // ⚠️ `advance` may correctly do NOTHING - a merchant bought this turn has no movement. The
    // order is still filed, and the turn beginning picks it up.
    if (advance(unit, city, mayMove)) {
        clearMerchantOrder(unit.id);
    }
    return true;
}

/** Whether this mod has told this merchant to go somewhere. */
function hasStandingOrder(unit) {
    return readOrder(unitKey(unit.id)) >= 0;
}

/**
 * Whether this merchant is actually going somewhere right now.
 *
 * ⚠️ THE ONE PLACE THE UNIT'S REAL STATE IS READ. "Free" and "on its way" are opposites; answered
 * separately they drifted into claiming the same merchant was both.
 *
 * ⚠️ The standing order is NOT evidence of travel. Orders live outside the save and outlive a
 * reload, and the player can stop a merchant without the store hearing - which was reported as
 * missing buttons after a reload and merchants "on the way" long after being called back.
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
     * ⚠️ Out of movement only means "busy" when there is an ORDER that explains it. Without one it
     * means only that the merchant was bought this turn or has already walked - and treating that
     * as busy hid the plus buttons for the whole turn after buying merchants, which is exactly the
     * turn a player is looking for somewhere to send them.
     */
    return hasStandingOrder(unit) && Number(unit?.Movement?.movementMovesRemaining ?? 0) <= 0;
}

/**
 * What every merchant of ours is doing, in ONE walk.
 *
 * ⚠️ THIS EXISTS BECAUSE OF THE TRADE ROUTE CARDS. `idleMerchants`, `merchantsBoundFor` and
 * `merchantsBoundForPlayer` each read the player's whole unit list and asked the engine about
 * every merchant in it - and one card calls all three, so a tab of forty cards walked the unit
 * list a hundred and twenty times over per redraw.
 *
 * ⚠️ Two ways out, and both are needed: `forgetMerchantState` for anything this mod does (an
 * order written, a merchant sent), and the wall-clock backstop for everything it is not told
 * about - a merchant the player moved. Short enough that nothing on screen can look stale,
 * long enough that one pass over the cards is one reading.
 */
const STATE_CACHE_MS = 250;

let merchantState = null;
let merchantStateAt = 0;

export function forgetMerchantState() {
    merchantState = null;
}

function merchantStates() {
    if (merchantState && Date.now() - merchantStateAt < STATE_CACHE_MS) {
        return merchantState;
    }
    merchantState = localMerchants().map((unit) => ({
        unit,
        plotIndex: readOrder(unitKey(unit.id)),
        travelling: isTravelling(unit),
    }));
    merchantStateAt = Date.now();
    return merchantState;
}

/** Merchants of ours with nothing to do; see `isTravelling` for what "nothing" means. */
export function idleMerchants() {
    return merchantStates().filter((state) => !state.travelling).map((state) => state.unit);
}

/** The spare merchant that would reach `city` soonest, or null when there is none. */
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
    return merchantStates()
        // Same rule as `merchantsBoundFor`: a halted merchant is not spoken for.
        .filter((state) => state.plotIndex >= 0 && state.travelling
            && cityAtPlot(state.plotIndex)?.owner === leaderId)
        .map((state) => state.unit);
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
    // ⚠️ The order AND the unit, never the order alone: a merchant the player called back keeps
    // neither.
    return merchantStates()
        .filter((state) => state.plotIndex === plotIndex && state.travelling)
        .map((state) => state.unit);
}

let listening = false;

/**
 * ⚠️ Starts with the screen closed, from the entry point: the journey carries on for turns after
 * the Commerce screen is shut, and an order only processed while a screen happened to be open
 * would strand the merchant on the road.
 */
export function startMerchantOrders() {
    if (listening) {
        return;
    }
    listening = true;
    // ⚠️ An arrow of our own, not `scheduleProcess` itself: the engine hands the listener its
    // payload, and a payload object is truthy - which made every event a moving one.
    SIGN_EVENTS.forEach((name) => onLocalPlayerEvent(name, () => scheduleProcess(false)));
    MOVE_EVENTS.forEach((name) => onLocalPlayerEvent(name, () => scheduleProcess(true)));
    // Carries no unit and belongs to nobody, so it is subscribed unfiltered.
    FULL_PASS_EVENTS.forEach((name) =>
        onEngineEvent(name, () => scheduleProcess(true, { force: true })),
    );

    /*
     * ⚠️ Per unit, unlike everything above: these two are the ONLY events carrying WHICH merchant
     * they are about, and the question here is "has THIS merchant been called back". A second
     * listener with a different job, not a replacement for the sign-only pass above.
     */
    for (const name of ['UnitOperationsCleared', 'UnitOperationDeactivated']) {
        onLocalPlayerEvent(name, (data) => {
            const unitID = data?.unit;
            if (unitID) {
                forgetOrderIfAbandoned(unitID);
            }
        });
    }
    /*
     * A game loaded mid-session brings its own seed, and with it its own orders.
     * ⚠️ ALL FIVE, not just the attempts. Unit ids are recycled between games, so anything keyed
     * by one describes a unit that no longer exists - and these grew for the whole session.
     */
    onEngineEvent('GameStarted', () => {
        gameKey = null;
        orderedKeys = null;
        attempts.clear();
        commandedAt.clear();
        wasTravelling.clear();
        orderByKey.clear();
        forgetMerchantState();
    });
    // A load lands mid-journey as often as not: sign straight away, and let the turn beginning
    // restart anyone still short of the target. Forced, because this is where a loaded game first
    // reads its orders.
    scheduleProcess(false, { force: true });
}
