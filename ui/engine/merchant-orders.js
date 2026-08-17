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
    isMerchant,
    localMerchants,
    moveMerchant,
    readMerchants,
    signRoute,
    unitKey,
} from './merchant.js';
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

/** These only ever ask "can the route be signed now?" - see `processOrders`. */
const SIGN_EVENTS = [
    'UnitMoved',
    'UnitMoveComplete',
    'UnitOperationsCleared',
    'UnitOperationDeactivated',
    'UnitRemovedFromMap',
];

/** Once a turn, a merchant that has stopped short is sent on its way again. */
const MOVE_EVENTS = ['LocalPlayerTurnBegin'];

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

export function clearMerchantOrder(unitID) {
    const key = unitKey(unitID);
    if (!key) {
        return;
    }
    attempts.delete(key);
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
    if (!mayMove || !mayAttempt(unitKey(unit.id))) {
        return false;
    }
    for (const location of approachLocations(unit, city)) {
        if (moveMerchant(unit, location)) {
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
            const key = unitKey(unit.id);
            const plotIndex = readOrder(key);
            if (plotIndex < 0) {
                continue;
            }
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
function scheduleProcess(mayMove = false) {
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
export function orderMerchantTo(unit, city) {
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
    if (advance(unit, city, true)) {
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
export function merchantsBoundForPlayer(leaderId) {
    if (leaderId === undefined || leaderId === null) {
        return [];
    }
    return localMerchants().filter((unit) => {
        const plotIndex = readOrder(unitKey(unit.id));
        return plotIndex >= 0 && cityAtPlot(plotIndex)?.owner === leaderId;
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
    return localMerchants().filter((unit) => readOrder(unitKey(unit.id)) === plotIndex);
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
    const listen = (name, mayMove) => {
        try {
            // ⚠️ An arrow of our own, not `scheduleProcess` itself: the engine hands the
            // listener its event payload, and the first argument here decides whether the
            // pass may move a merchant. Passing the function straight in made every event a
            // moving one, because a payload object is truthy.
            engine.on(name, () => scheduleProcess(mayMove));
        } catch (error) {
            warn(`could not listen for ${name}: ${error}`);
        }
    };
    SIGN_EVENTS.forEach((name) => listen(name, false));
    MOVE_EVENTS.forEach((name) => listen(name, true));
    // A game loaded mid-session brings its own seed, and with it its own orders.
    try {
        engine.on('GameStarted', () => {
            gameKey = null;
            orderedKeys = null;
            attempts.clear();
        });
    } catch (error) {
        warn(`could not listen for GameStarted: ${error}`);
    }
    // A load lands mid-journey as often as not: try to sign straight away, and let the first
    // turn beginning be the one that sets anyone still short of the target walking again.
    scheduleProcess(false);
}
