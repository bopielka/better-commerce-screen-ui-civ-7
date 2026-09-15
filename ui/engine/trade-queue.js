/**
 * "Do it when the turn turns": a standing request to raise the Trade Route limit with one leader
 * and send a merchant into the slot it opens.
 *
 * The Commerce screen offers this where the treaty cannot be proposed NOW - it has already been
 * proposed this turn, or the Influence is short. Both are answers that change when the turn does,
 * and neither is something the player should have to come back and do by hand.
 *
 * In engine/ because it runs at `LocalPlayerTurnBegin` with the screen CLOSED, and because
 * everything it needs - diplomacy, merchants, standing orders - is at this layer or below.
 *
 * The pass, in two steps that do NOT have to happen on the same turn (user's instruction,
 * 2026-09-10):
 *   1. THE MERCHANT FIRST - a spare one, or a bought one. It is sent to the target at once.
 *   2. THE TREATY WHEN THE INFLUENCE IS THERE. Until then the merchant is already walking.
 *
 * ⚠️ THIS ORDER IS THE POINT. Travel takes turns and Influence accrues over turns, so doing them
 * at once wasted whichever was ready first; sent ahead, the merchant spends the wait covering
 * ground it would have had to cover anyway.
 *
 * ⚠️ A MERCHANT THAT ARRIVES BEFORE THE INFLUENCE DOES MUST NOT GO BACK IN THE SPARE POOL. It
 * carries a standing order, and `idleMerchants` excludes anything under one - which is also what
 * stops the next pass buying a second merchant for the same errand. The order survives the
 * arrival because `forgetOrderIfAbandoned` reads arrival off the MAP, not off the trade command.
 *
 * ⚠️ IT SPENDS INFLUENCE AND GOLD WITHOUT ASKING AGAIN, which is exactly what was asked for - but
 * it means the entry has to be cancellable and has to be visible while it waits. Both prices are
 * on the button before it is pressed, and the same button cancels.
 *
 * ⚠️ STORED, like a merchant's standing order and for the same reason: the wait is measured in
 * turns and the screen will not be open when it ends. Nothing is written into the save; this mod
 * declares AffectsSavedGames = 0.
 */
import { influenceBalance, proposeTradeRelations, tradeRelationsOffer } from './diplomacy.js';
import {
    forgetMerchantOffers,
    goldBalance,
    purchaseAndCollectMerchant,
    purchaseSite,
    tradeCapacityWith,
} from './merchant.js';
import { merchantsOrderedTo, nearestIdleMerchant, orderMerchantTo } from './merchant-orders.js';
import { currentGameKey, readSection, writeSection } from './mod-storage.js';
import { onEngineEvent } from './events.js';
import { log, warn } from '../support/diagnostics.js';

const MOD_ID = 'better-commerce-screen-ui';

/** ⚠️ A section of the SHARED `modSettings` key - see ./mod-storage.js for why. */
const SECTION = 'tradeQueue';

/** Raised when an entry is added, cancelled or spent; anything drawing one redraws on it. */
export const TradeQueueChangedEventName = 'najane-trade-queue-changed';

/**
 * Raised when a queued request reaches one of its two steps. The detail carries
 * `{ kind, leaderName, cityName }`; screen/trade-queue-toast.js listens.
 *
 * ⚠️ TWO STEPS MEANS TWO PIECES OF NEWS (user's instruction, 2026-09-10). The merchant setting off
 * and the limit actually rising can be many turns apart, and one line reporting both would be
 * wrong for whichever of them had not happened yet.
 *
 * ⚠️ An event rather than a call: this module is in engine/ and may not import screen.
 */
export const TradeQueueRanEventName = 'najane-trade-queue-ran';

/** The merchant is under way; the limit is still waiting on Influence. */
export const QUEUE_STEP_MERCHANT = 'merchant';
/** The treaty has been proposed - the request is finished with. */
const QUEUE_STEP_TREATY = 'treaty';

/**
 * ⚠️ KEYED BY THE TARGET SETTLEMENT, NOT BY THE LEADER. The request is "send a merchant to THAT
 * city"; keyed by leader, queueing one route lit the button on every card of that leader, because
 * every one of them asked the same question and got the same answer.
 *
 * ⚠️ By its PLOT, like a merchant's standing order: a settlement that changes hands keeps its
 * plot and gets a new id, so the entry still means the place the player pointed at.
 *
 * ⚠️ THE VALUE IS THE STEP THE REQUEST HAS REACHED: 1 - waiting for a merchant; 2 - a merchant is
 * on its way and only the treaty is left. Without that second state the pass could not tell "no
 * merchant sent yet" from "one sent and standing at the gate", and bought a second one.
 *
 * ⚠️ Zero stays free to mean "nothing queued": `UI.getOption` answers 0 for an option that was
 * never set, and the two must not be the same answer.
 */
const STEP_NEEDS_MERCHANT = 1;
const STEP_NEEDS_TREATY = 2;

function optionName(plotIndex) {
    return `${MOD_ID}.tradeQueue.${currentGameKey()}.${plotIndex}`;
}

function plotOf(city) {
    if (!city?.location) {
        return -1;
    }
    try {
        return GameplayMap.getIndexFromLocation(city.location);
    } catch (error) {
        return -1;
    }
}

function announce() {
    try {
        window.dispatchEvent(new CustomEvent(TradeQueueChangedEventName));
    } catch (error) {
        warn(`could not announce the trade queue change: ${error}`);
    }
}

/**
 * What every entry says, read through to storage ONCE per leader.
 *
 * ⚠️ `UI.getOption` is a lookup, and a card asks this on every redraw of the tab. Negative answers
 * are cached too - "nothing queued with this leader" is the common case and is the one that was
 * paying for a lookup every time. Same rule, and the same reason, as `orderByKey` in
 * ./merchant-orders.js.
 *
 * ⚠️ Written only by `write`, which repairs the entry rather than dropping the cache.
 */
const queuedByPlot = new Map();

// Plots are stable, but the seed is not; nothing here may survive into the next game.
onEngineEvent('GameStarted', () => queuedByPlot.clear());

function write(plotIndex, code) {
    queuedByPlot.set(plotIndex, code);
    try {
        UI.setOption('user', 'Mod', optionName(plotIndex), code);
        Configuration.getUser().saveCheckpoint();
    } catch (error) {
        warn(`could not save the queued trade action: ${error}`);
    }
    // ⚠️ A finished entry is DELETED from the mirror, not written as 0 - same rule and reason as
    // `writeFallback` in ./merchant-orders.js: every reader treats the two alike.
    writeSection(SECTION, (all) => {
        const game = currentGameKey();
        if (code > 0) {
            all[game] ??= {};
            all[game][String(plotIndex)] = code;
            return;
        }
        if (all[game]) {
            delete all[game][String(plotIndex)];
            if (Object.keys(all[game]).length === 0) {
                delete all[game];
            }
        }
    });
    announce();
}

/** @returns the step this settlement's request has reached, or 0 for none. */
function stepAtPlot(plotIndex) {
    if (plotIndex < 0 || currentGameKey() === null) {
        return 0;
    }
    const cached = queuedByPlot.get(plotIndex);
    if (cached !== undefined) {
        return cached;
    }
    let code = null;
    try {
        code = UI.getOption('user', 'Mod', optionName(plotIndex));
    } catch (error) {
        code = null;
    }
    if (code == null) {
        code = readSection(SECTION)?.[currentGameKey()]?.[String(plotIndex)];
    }
    const answer = Number(code) > 0 ? Number(code) : 0;
    queuedByPlot.set(plotIndex, answer);
    return answer;
}

/** Whether a request is waiting for THIS settlement, at whatever step. */
export function isTradeActionQueued(city) {
    return stepAtPlot(plotOf(city)) > 0;
}

export function queueTradeAction(city) {
    const plotIndex = plotOf(city);
    if (plotIndex < 0 || currentGameKey() === null) {
        return false;
    }
    write(plotIndex, STEP_NEEDS_MERCHANT);
    log(() => `queued: raise the trade limit and send a merchant to `
        + `${Locale.compose(city.name ?? '')}`);
    // ⚠️ At once, not at the turn: a merchant standing idle while a route is planned for it is
    // simply a wasted turn of travel. Only spare ones; see `dispatchSpareMerchantsToQueue`.
    dispatchSpareMerchantsToQueue();
    return true;
}

/**
 * Sends a merchant to every queued request that has one to spare, NOW.
 *
 * ⚠️ SPARE MERCHANTS ONLY - it never buys. Buying is the turn pass's job, because that is what the
 * button's own tooltip promises and gold should not leave the treasury on a click. A merchant
 * standing idle costs nothing to send and there is no reason at all to make it wait for the turn:
 * six routes were planned while four merchants stood about doing nothing.
 *
 * ⚠️ Synchronous, and that is what makes it safe to call from a click: nothing here awaits the
 * engine, so it cannot interleave with the turn pass.
 */
function dispatchSpareMerchantsToQueue() {
    for (const plotIndex of queuedPlots()) {
        if (stepAtPlot(plotIndex) !== STEP_NEEDS_MERCHANT) {
            continue;
        }
        let city = null;
        try {
            city = Cities.getAtLocation(plotIndex) ?? null;
        } catch (error) {
            city = null;
        }
        if (!city) {
            continue;
        }
        const spare = nearestIdleMerchant(city);
        if (!spare || !orderMerchantTo(spare, city)) {
            continue;
        }
        write(plotIndex, STEP_NEEDS_TREATY);
        announceRan(QUEUE_STEP_MERCHANT, city.owner, city);
        log(() => `queued action: a spare merchant is on its way to ${Locale.compose(city.name ?? '')}`);
    }
}

export function cancelTradeAction(city) {
    const plotIndex = plotOf(city);
    if (plotIndex < 0) {
        return;
    }
    write(plotIndex, 0);
}

/**
 * Every leader with something queued.
 *
 * ⚠️ Read from the localStorage MIRROR, because `UI.getOption` cannot be enumerated - it answers
 * about a name you already know. Same limitation, and the same answer, as the merchant orders.
 * A mirror that cannot be read costs a turn's pass, never correctness: the entry is still in the
 * durable store and `isTradeActionQueued` still finds it once a card asks.
 */
function queuedPlots() {
    const found = [];
    try {
        for (const [key, code] of Object.entries(readSection(SECTION)?.[currentGameKey()] ?? {})) {
            if (Number(code) > 0) {
                found.push(Number(key));
            }
        }
    } catch (error) {
        // An unreadable mirror is not worth a warning; see above.
    }
    return found;
}

function leaderName(leaderId) {
    try {
        return Locale.compose(Players.get(leaderId)?.leaderName ?? '');
    } catch (error) {
        return '';
    }
}

function announceRan(kind, leaderId, city) {
    try {
        window.dispatchEvent(new CustomEvent(TradeQueueRanEventName, {
            detail: {
                kind,
                leaderName: leaderName(leaderId),
                cityName: Locale.compose(city?.name ?? ''),
            },
        }));
    } catch (error) {
        warn(`could not announce the queued trade action: ${error}`);
    }
}

/**
 * Where a merchant would come from, WITHOUT taking it yet: one standing idle, or one that could be
 * bought here for this much.
 *
 * ⚠️ Buying is the SECOND choice, always. A spare merchant costs nothing, and a queued request is
 * not a licence to spend gold while a free merchant is standing about.
 *
 * ⚠️ ASKED BEFORE THE TREATY IS PROPOSED, and that is the whole reason it is separated from the
 * taking. Proposing spends Influence whatever happens next, so a pass that proposed first and only
 * then discovered it had no merchant and could not afford one had spent it for nothing.
 */
function merchantSource(city) {
    const spare = nearestIdleMerchant(city);
    if (spare) {
        return { spare };
    }
    const site = purchaseSite(null, city);
    if (!site?.offer?.canBuy || site.offer.cost > goldBalance()) {
        return null;
    }
    return { site };
}

/** Takes what `merchantSource` found - the only step here that spends gold. */
async function takeMerchant(source) {
    if (source.spare) {
        return source.spare;
    }
    return purchaseAndCollectMerchant(source.site.city.id, source.site.offer.definition);
}

/**
 * One queued request. @returns true when it is finished with and may be dropped.
 *
 * ⚠️ WAITING IS NOT FAILING. Short Influence, short gold or a treaty that cannot be proposed yet
 * all leave the entry standing for the next turn - that is the whole point of queueing it. Only
 * a target that no longer exists, or a request actually carried out, takes it out.
 */
async function runOne(plotIndex) {
    let city = null;
    try {
        city = Cities.getAtLocation(plotIndex) ?? null;
    } catch (error) {
        city = null;
    }
    if (!city) {
        log('a queued trade action points at a settlement that is gone; dropped');
        return true;
    }
    // ⚠️ Read from the settlement, not stored beside the entry: the limit belongs to whoever owns
    // the place NOW, and a settlement can change hands while the request waits.
    const leaderId = city.owner;
    const step = stepAtPlot(plotIndex);

    /*
     * STEP ONE: get a merchant moving. Nothing about the treaty is asked here - the Influence may
     * be turns away, and every one of those turns is a turn the merchant could have been walking.
     *
     * ⚠️ The ORDER, not whether it is travelling: a merchant that has ARRIVED and is waiting
     * for a trade slot is not on the road any more but is very much already sent, and the
     * difference is a second merchant bought for the same errand.
     */
    if (step === STEP_NEEDS_MERCHANT) {
        const source = merchantSource(city);
        if (!source) {
            // Nothing spare and nothing affordable. Waiting costs nothing; try again next turn.
            return false;
        }
        const merchant = await takeMerchant(source);
        if (!merchant) {
            warn('a queued trade action could not obtain a merchant');
            return false;
        }
        // ⚠️ `mayMove` is left ALONE here, unlike the screen's own version of this button: nothing
        // has just been queued at the engine, so there is no stale limit for the merchant to read
        // as distance. It should set off exactly as any other ordered merchant does.
        /*
         * ⚠️ THE ANSWER IS CHECKED. `orderMerchantTo` refuses a unit it cannot file an order for,
         * and announcing regardless meant the player was told "a merchant is on its way" while
         * nothing had been ordered and nothing moved.
         */
        if (!orderMerchantTo(merchant, city)) {
            warn('a queued trade action could not give the merchant its order');
            return false;
        }
        write(plotIndex, STEP_NEEDS_TREATY);
        announceRan(QUEUE_STEP_MERCHANT, leaderId, city);
        log(() => `queued action: a merchant is on its way to ${Locale.compose(city.name ?? '')}`);
        return false;
    }

    /*
     * STEP TWO: the treaty.
     *
     * ⚠️ NO MERCHANT UNDER ORDER ANY MORE means the errand resolved itself - the route was signed
     * because a slot came free on its own, or the merchant was lost. Either way the treaty is no
     * longer what this request was for, and proposing it would spend Influence on nothing.
     */
    if (merchantsOrderedTo(city).length === 0) {
        log('a queued trade action no longer has a merchant; dropped');
        return true;
    }

    /*
     * ⚠️ THE TREATY IS ONLY EVER THE SECOND HALF, and only where the LIMIT is what is in the way.
     * A request can be queued because there was no merchant and no gold for one, with a trade slot
     * standing free the whole time - and proposing a treaty then would spend Influence to raise a
     * limit that was never reached. `used`, not `used + pending`: our own merchant is the one about
     * to fill the slot we are asking about.
     */
    const { capacity, used } = tradeCapacityWith(leaderId);
    if (used < capacity) {
        log(() => `queued action: a slot with ${leaderName(leaderId)} is already free; no treaty needed`);
        return true;
    }

    const offer = tradeRelationsOffer(leaderId);
    if (!offer) {
        // The action does not exist for this pairing at all - at war, or never met again.
        return false;
    }
    if (!offer.canStart || offer.cost > influenceBalance()) {
        // The merchant keeps walking; this is exactly the wait the two steps exist to overlap.
        return false;
    }
    if (!proposeTradeRelations(leaderId, offer)) {
        return false;
    }
    log(() => `queued action: proposed Improve Trade Relations with ${leaderName(leaderId)}`);
    announceRan(QUEUE_STEP_TREATY, leaderId, city);
    return true;
}

let running = false;

async function runQueue() {
    // ⚠️ One pass at a time: `findOrBuyMerchant` awaits the engine, so a second pass could start
    // inside the first and buy a second merchant for the same entry.
    if (running) {
        return;
    }
    running = true;
    /*
     * ⚠️ The merchant prices are cached for the Commerce screen, and only the screen clears them.
     * With it closed, the previous pass's answer would stand: one `canBuy: false` (gold short that
     * turn) kept the entry waiting every turn after, whatever the treasury held.
     */
    forgetMerchantOffers();
    try {
        for (const plotIndex of queuedPlots()) {
            try {
                if (await runOne(plotIndex)) {
                    write(plotIndex, 0);
                }
            } catch (error) {
                warn(`a queued trade action failed: ${error}`);
            }
        }
    } finally {
        running = false;
    }
}

let listening = false;

/**
 * ⚠️ Started from the entry point, with the screen closed: the wait is measured in turns and the
 * Commerce screen will not be open when it ends.
 */
export function startTradeQueue() {
    if (listening) {
        return;
    }
    listening = true;
    // Carries no player and belongs to nobody, so it is subscribed unfiltered.
    onEngineEvent('LocalPlayerTurnBegin', runQueue);
}
