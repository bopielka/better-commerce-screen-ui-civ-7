/**
 * Buying a merchant, walking it, and signing the route once it is there.
 *
 * The three calls this needs are the game's own, taken from where the game makes them:
 *
 *   buy    `CityCommandTypes.PURCHASE` with `{ UnitType }` - production-chooser-helpers.js,
 *          `Construct()`, the branch that runs when the Purchase tab is the open one.
 *   walk   `UnitOperationTypes.MOVE_TO` - the plain operation.
 *   sign   `UnitCommandTypes.MAKE_TRADE_ROUTE` with the TARGET SETTLEMENT'S OWN PLOT -
 *          trade-route-chooser.js, `checkAndStartTradeRoute()`.
 *
 * ⚠️ `WorldInput.requestMoveOperation` is NOT used, although the game's own "send merchant"
 * button uses it. That function is the right-click handler: it probes for an attack first
 * and can open a declare-war confirmation, which must never come out of a button labelled
 * "buy a merchant". Holistic QoL+ avoids it for the same reason and says so in a comment.
 *
 * ⚠️ Which unit is "a merchant" is `MakeTradeRoute` on the unit's definition, not the type
 * name. Half a dozen civs have their own - Vaishya, Watonathi, Mandarin, Tajiro, Hangshang -
 * and matching UNIT_MERCHANT would have left those civs with a button that never worked.
 *
 * Nothing here keeps state; the standing order that survives from turn to turn lives in
 * ./merchant-orders.js.
 */
import { isFactoryAge } from './age.js';
import { waitForEngineEvent } from './wait.js';
import { warn } from '../support/diagnostics.js';

/** A unit is identified the way settlements are elsewhere in this mod: by the id alone. */
export function unitKey(unitID) {
    return unitID ? String(unitID.id) : '';
}

let merchantTypes = null;

/**
 * Every unit type that can open a trade route, as a set of type names.
 *
 * Built once. `GameInfo.Units` is a static table - it cannot change during a game - and it
 * is long enough that a per-card scan would be felt on a tab full of cards.
 */
function merchantTypeNames() {
    if (merchantTypes) {
        return merchantTypes;
    }
    merchantTypes = new Set();
    try {
        for (const definition of GameInfo.Units) {
            if (definition.MakeTradeRoute === true) {
                merchantTypes.add(definition.UnitType);
            }
        }
    } catch (error) {
        warn(`could not read the unit table: ${error}`);
    }
    return merchantTypes;
}

export function isMerchant(unit) {
    if (!unit || unit.owner !== GameContext.localPlayerID) {
        return false;
    }
    try {
        const definition = GameInfo.Units.lookup(unit.type);
        return definition?.MakeTradeRoute === true;
    } catch (error) {
        return false;
    }
}

/**
 * Every merchant this player owns, wherever it is - or **null** when the engine could not be
 * asked at all.
 *
 * ⚠️ The null matters and is not defensive noise. Anything that prunes stored state against
 * this list reads an empty array as "every merchant is gone" and throws the lot away. A
 * failed call must be told apart from an empty answer, or one bad tick wipes the orders of
 * merchants that are alive and walking.
 */
export function readMerchants() {
    try {
        const units = Players.get(GameContext.localPlayerID)?.Units?.getUnits() ?? [];
        return units.filter(isMerchant);
    } catch (error) {
        warn(`could not list the merchants: ${error}`);
        return null;
    }
}

/** The same list for callers that only iterate it. */
export function localMerchants() {
    return readMerchants() ?? [];
}

export function goldBalance() {
    try {
        return Players.get(GameContext.localPlayerID)?.Treasury?.goldBalance ?? 0;
    } catch (error) {
        return 0;
    }
}

function purchaseArgs(definition) {
    const hash = GameInfo.Types.lookup(definition.UnitType)?.Hash;
    return hash === undefined ? null : { UnitType: hash };
}

/**
 * What a merchant would cost in this settlement, and whether it can be bought at all.
 *
 * ⚠️ Asked through `canStartQuery`, not by looping over the unit table and asking about
 * each type in turn. The query is the call the production chooser itself makes (`getUnits`
 * in production-chooser-helpers.js), it answers for every unit type in one go, and its
 * `result` carries the reason for a refusal - which is what the tooltip needs when the
 * button is dark.
 *
 * @returns `{ definition, cost, canBuy, insufficientFunds }`, or null when this settlement
 *          has no merchant to sell at all - a different case from "cannot afford it".
 */
const offerCache = new Map();

/**
 * Throws the prices away.
 *
 * ⚠️ Must be called whenever gold is spent or a merchant is bought: the unit's cost
 * progression counts the copies already bought, so the next merchant costs more than the last
 * one did, and a stale figure on the button is a figure the engine will not honour.
 */
export function forgetMerchantOffers() {
    offerCache.clear();
}

export function merchantOffer(cityID) {
    let city = null;
    try {
        city = Cities.get(cityID);
    } catch (error) {
        return null;
    }
    if (!city?.Gold) {
        return null;
    }

    /*
     * ⚠️ Cached per settlement, and it is not an optimisation for its own sake: when no
     * settlement can sell a merchant, `purchaseSite` walks the whole empire for every route
     * card on screen. Without this that is one `canStartQuery` per settlement per card.
     */
    const cacheKey = String(city.id.id);
    if (offerCache.has(cacheKey)) {
        return offerCache.get(cacheKey);
    }

    const names = merchantTypeNames();
    let best = null;
    try {
        const results = Game.CityCommands.canStartQuery(city.id, CityCommandTypes.PURCHASE, CityQueryType.Unit);
        for (const { index, result } of results) {
            const definition = GameInfo.Units.lookup(index);
            if (!definition || !names.has(definition.UnitType)) {
                continue;
            }
            // An obsolete merchant is still in the table and still answers the query; it is
            // simply not one this age can field.
            if (result?.Requirements?.FullFailure || result?.Requirements?.Obsolete) {
                continue;
            }
            const cost = result?.Cost
                ?? city.Gold.getUnitPurchaseCost(YieldTypes.YIELD_GOLD, definition.UnitType);
            const offer = {
                definition,
                cost: Number(cost) || 0,
                canBuy: result?.Success === true,
                insufficientFunds: result?.InsufficientFunds === true,
            };
            // The one that can be bought wins; between two that can, the cheaper one. A civ
            // with a unique merchant sees both its own and the generic one listed.
            if (!best
                || (offer.canBuy && !best.canBuy)
                || (offer.canBuy === best.canBuy && offer.cost < best.cost)) {
                best = offer;
            }
        }
    } catch (error) {
        warn(`could not ask ${Locale.compose(city.name ?? '')} about merchants: ${error}`);
        return null;
    }
    offerCache.set(cacheKey, best);
    return best;
}

/**
 * Which settlement buys the merchant.
 *
 * The route's own nearest settlement first - that is the one the route is measured from, and
 * the one the player is looking at on the card. It is not always able to sell a merchant
 * though: a settlement in unrest cannot buy, and a town's purchase list depends on what it
 * has. So the rest of the empire is tried after it, nearest to the destination first, and the
 * settlement that ends up buying is named in the tooltip rather than left to be discovered.
 *
 * @returns `{ city, offer }` where `offer.canBuy` says whether the button is live. The city
 *          is the preferred one when nothing can buy, so the tooltip can still explain.
 */
export function purchaseSite(preferredCityID, targetCity) {
    let preferred = null;
    try {
        preferred = preferredCityID ? Cities.get(preferredCityID) : null;
    } catch (error) {
        preferred = null;
    }
    const preferredOffer = preferred ? merchantOffer(preferred.id) : null;
    if (preferredOffer?.canBuy) {
        return { city: preferred, offer: preferredOffer };
    }

    const preferredKey = preferred ? String(preferred.id.id) : '';
    let others = [];
    try {
        others = (Players.get(GameContext.localPlayerID)?.Cities?.getCities() ?? [])
            .filter((city) => String(city.id.id) !== preferredKey && city.location)
            .sort((first, second) => plotDistance(first.location, targetCity.location)
                - plotDistance(second.location, targetCity.location));
    } catch (error) {
        warn(`could not list your settlements: ${error}`);
    }

    for (const city of others) {
        const offer = merchantOffer(city.id);
        if (offer?.canBuy) {
            return { city, offer };
        }
    }
    return { city: preferred, offer: preferredOffer };
}

/** Sends the purchase. The unit appears in the settlement a moment later, not at once. */
export function purchaseMerchant(cityID, definition) {
    const args = purchaseArgs(definition);
    if (!args) {
        return false;
    }
    try {
        if (!Game.CityCommands.canStart(cityID, CityCommandTypes.PURCHASE, args, false).Success) {
            return false;
        }
        Game.CityCommands.sendRequest(cityID, CityCommandTypes.PURCHASE, args);
        return true;
    } catch (error) {
        warn(`buying a merchant failed: ${error}`);
        return false;
    }
}

/** How long the new merchant is waited for, in frames. Half a second at 60fps. */
const NEW_MERCHANT_FRAMES = 30;

function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * Buys a merchant and hands back the unit that appeared.
 *
 * ⚠️ The new unit is found by comparing the merchant list before and after, NOT by listening
 * for `UnitAddedToMap`. The game's own unit-flag manager says why it avoids that event: "event
 * race condition in looking up a valid Unit" - it can arrive before the unit can be read back.
 * Polling asks the question the caller actually has, which is whether the unit is there yet.
 *
 * @returns the new merchant, or null if the purchase was refused or nothing turned up.
 */
export async function purchaseAndCollectMerchant(cityID, definition) {
    const before = new Set(localMerchants().map((unit) => unitKey(unit.id)));
    if (!purchaseMerchant(cityID, definition)) {
        return null;
    }
    // `sendRequest` only queues; nothing exists until the engine has processed it.
    await waitForEngineEvent('CityMadePurchase');
    for (let frame = 0; frame < NEW_MERCHANT_FRAMES; frame++) {
        const fresh = localMerchants().find((unit) => !before.has(unitKey(unit.id)));
        if (fresh) {
            return fresh;
        }
        await nextFrame();
    }
    return null;
}

/**
 * How many trade routes this empire may hold with another leader, and how many it holds.
 *
 * The two calls the game's own trade lens makes for the same sentence - see
 * `getTradeActionText` in trade-routes-model.js, which writes "2 of 3 with Amina" from
 * exactly these. A merchant is only worth buying while the second number is below the first.
 */
export function tradeCapacityWith(leaderId) {
    try {
        const trade = Players.get(GameContext.localPlayerID)?.Trade;
        return {
            capacity: trade?.getTradeCapacityFromPlayer(leaderId) ?? 0,
            used: trade?.countPlayerTradeRoutesTo(leaderId) ?? 0,
        };
    } catch (error) {
        warn(`could not read the trade capacity with player ${leaderId}: ${error}`);
        return { capacity: 0, used: 0 };
    }
}

/**
 * Puts the camera on a unit and selects it.
 *
 * The two together, because either alone is half an answer: the camera without the selection
 * leaves the player looking at a tile and hunting for which figure on it was meant, and the
 * selection without the camera happens somewhere off screen.
 *
 * ⚠️ Selecting FIRST. `UI.Player.selectUnit` moves the camera itself in some situations, and
 * doing it in the other order meant the framing this asks for was immediately overruled.
 */
export function focusUnitOnMap(unit) {
    if (!unit?.location) {
        return false;
    }
    try {
        UI.Player.selectUnit(unit.id);
    } catch (error) {
        warn(`could not select the merchant: ${error}`);
    }
    try {
        Camera.lookAtPlot(unit.location);
        return true;
    } catch (error) {
        warn(`could not look at the merchant: ${error}`);
        return false;
    }
}

function plotDistance(from, to) {
    try {
        return GameplayMap.getPlotDistance(from.x, from.y, to.x, to.y);
    } catch (error) {
        return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    }
}

/**
 * Where to walk to, best plot first.
 *
 * The same shape as the game's own `tryIssueMoveCommand`: every plot the target settlement
 * owns, nearest first, keeping only the ones the unit can actually path to. A settlement's
 * centre is often not the reachable part of it - an inland capital reached by sea is the
 * obvious case - and a move order to an unreachable plot is simply refused.
 *
 * When nothing paths - a merchant that has not left the harbour yet, an unexplored gap in
 * between - the settlement's centre is handed back on its own, so an order still has
 * somewhere to aim. The engine then refuses the move, and the caller counts the attempt.
 */
export function approachLocations(unit, city) {
    const locations = [];
    const seen = new Set();

    try {
        for (const plotIndex of city?.getPurchasedPlots?.() ?? []) {
            const location = GameplayMap.getLocationFromIndex(plotIndex);
            const key = `${location.x},${location.y}`;
            if (location && !seen.has(key)) {
                seen.add(key);
                locations.push({ x: location.x, y: location.y });
            }
        }
    } catch (error) {
        warn(`could not read the plots of the target settlement: ${error}`);
    }

    locations.sort((first, second) => plotDistance(unit.location, first) - plotDistance(unit.location, second));

    const reachable = locations.filter((location) => {
        try {
            return (Units.getPathTo(unit.id, location)?.plots?.length ?? 0) > 0;
        } catch (error) {
            return false;
        }
    });
    if (reachable.length > 0) {
        return reachable;
    }
    return city?.location ? [{ x: city.location.x, y: city.location.y }] : locations;
}

function moveArgs(location) {
    return {
        X: location.x,
        Y: location.y,
        // The destination is a settlement of someone we have met; the plots on the way there
        // need not all be explored, and without this the order is refused when they are not.
        Modifiers: UnitOperationMoveModifiers.MOVE_IGNORE_UNEXPLORED_DESTINATION,
    };
}

export function moveMerchant(unit, location) {
    try {
        if (!Game.UnitOperations.canStart(unit.id, UnitOperationTypes.MOVE_TO, moveArgs(location), false).Success) {
            return false;
        }
        Game.UnitOperations.sendRequest(unit.id, UnitOperationTypes.MOVE_TO, moveArgs(location));
        return true;
    } catch (error) {
        warn(`sending a merchant on its way failed: ${error}`);
        return false;
    }
}

/**
 * ⚠️ The argument is the target settlement's OWN plot, never the plot the merchant stands
 * on. The command asks "open a route with the settlement at X,Y"; handing it the merchant's
 * position makes it refuse for as long as the merchant is anywhere but on the city centre.
 */
function routeArgs(location) {
    return { X: location.x, Y: location.y };
}


/**
 * Whether this merchant has already spent its turn.
 *
 * ⚠️ ASKED OF THE UNIT, NOT OF THE REFUSAL - and that is the second attempt at this test. The
 * first asked `canStart` why it had refused, on the reasonable assumption that
 * "LOC_UNITCOMMAND_NO_MOVES_REMAINING" would come back and could be told apart from
 * "...NO_NEARBY_CITIES". It does not: for MAKE_TRADE_ROUTE the engine answers Success=false
 * with `FailureReasons` EMPTY, every time (traced in UI.log). The reasons exist for other
 * commands - the game's own unit-actions panel reads them - but not for this one, so nothing
 * can be concluded from them here.
 *
 * `Movement.movementMovesRemaining` is the same field the unit flags and the end-turn panel
 * read, and it answers a question that needs no interpretation.
 */
export function hasSpentItsTurn(unit) {
    try {
        return Number(unit?.Movement?.movementMovesRemaining ?? 0) <= 0;
    } catch (error) {
        return false;
    }
}

/**
 * Stops a merchant where it stands, dropping whatever journey it still had queued.
 *
 * ⚠️ `UNITCOMMAND_CANCEL` is the game's OWN cancel - `unit-commands.xml`, icon
 * `Action_Cancel.png`, the same command its unit action panel offers. Not a zero-distance
 * `MOVE_TO` standing in for one, which is the obvious trick and is refused.
 *
 * ⚠️ Returns true when there was nothing to cancel, too. A merchant can be under a standing
 * order with no journey queued - ours waits exactly like that when it has spent its turn and
 * will sign the route next turn - and for the caller the outcome is the same either way: it is
 * not going anywhere now.
 */
/**
 * Whether a merchant can open a route from wherever it happens to be standing.
 *
 * ⚠️ AN AGE CHECK, deliberately, after two attempts at deriving this from the engine failed.
 * `canStart` refuses `MAKE_TRADE_ROUTE` with `Success: false` and an EMPTY `FailureReasons`
 * (traced in UI.log), so nothing in the refusal distinguishes "too far" from "no capacity"
 * from "no movement" - and without that distinction a refusal cannot be read as an
 * instruction to travel.
 *
 * The rule itself is plain and does not need deriving:
 *
 *   Antiquity, Exploration   the merchant must REACH the settlement to open the route
 *   Modern                   it may open one from anywhere, once it has movement to spend
 *
 * ⚠️ `isFactoryAge` is this mod's existing name for the Modern age - it was named for the
 * Factory tab that first needed it. Reused rather than duplicated; a second age test would be
 * a second thing to keep in step with the game's own age hashes.
 */
/**
 * How many turns before this merchant can open the route, or null when it cannot be said.
 *
 * ⚠️ Read from the engine's own pathfinder rather than estimated. `Units.getPathTo` answers
 * with a `turns` array carrying one entry per plot - the same numbers the game paints on the
 * map as it draws a unit's route - so the last of them is the turn it arrives on.
 *
 * ⚠️ In the Modern age there is no journey to measure: the merchant opens the route from where
 * it stands as soon as it has movement, which is the start of next turn. Answering with a path
 * length there would be describing a walk that is never going to happen.
 */
export function turnsUntilRouteOpens(unit, location) {
    if (routesOpenFromAnywhere()) {
        return canSignRoute(unit, location) ? 0 : 1;
    }
    try {
        const path = Units.getPathTo(unit.id, location);
        const turns = path?.turns;
        if (!turns?.length) {
            return null;
        }
        const arrival = Number(turns[turns.length - 1]);
        return Number.isFinite(arrival) ? Math.max(arrival, 0) : null;
    } catch (error) {
        return null;
    }
}

export function routesOpenFromAnywhere() {
    return isFactoryAge();
}

export function stopMerchant(unit) {
    try {
        if (!Units.getQueuedOperationDestination?.(unit.id)) {
            return true;
        }
        const args = { X: -9999, Y: -9999 };
        if (Game.UnitCommands.canStart(unit.id, 'UNITCOMMAND_CANCEL', args, false)?.Success !== true) {
            return false;
        }
        Game.UnitCommands.sendRequest(unit.id, 'UNITCOMMAND_CANCEL', args);
        return true;
    } catch (error) {
        warn(`could not stop a merchant: ${error}`);
        return false;
    }
}

export function canSignRoute(unit, location) {
    try {
        return Game.UnitCommands.canStart(unit.id, UnitCommandTypes.MAKE_TRADE_ROUTE, routeArgs(location), false)
            .Success === true;
    } catch (error) {
        return false;
    }
}

export function signRoute(unit, location) {
    if (!canSignRoute(unit, location)) {
        return false;
    }
    try {
        Game.UnitCommands.sendRequest(unit.id, UnitCommandTypes.MAKE_TRADE_ROUTE, routeArgs(location));
        return true;
    } catch (error) {
        warn(`opening the trade route failed: ${error}`);
        return false;
    }
}
