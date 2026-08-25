/**
 * Buying a merchant, walking it, and signing the route once it is there. No state; the standing
 * order that survives turn to turn lives in ./merchant-orders.js.
 *
 * The three calls are the game's own, taken from where the game makes them: `CityCommandTypes.
 * PURCHASE` with `{ UnitType }` (production-chooser-helpers.js), `UnitOperationTypes.MOVE_TO`,
 * and `UnitCommandTypes.MAKE_TRADE_ROUTE` with the TARGET SETTLEMENT'S OWN PLOT
 * (trade-route-chooser.js).
 *
 * ⚠️ `WorldInput.requestMoveOperation` is NOT used, although the game's own send-merchant button
 * uses it: it is the right-click handler, it probes for an attack first and can open a
 * declare-war confirmation - which must never come out of a button labelled "buy a merchant".
 *
 * ⚠️ "A merchant" is `MakeTradeRoute` on the unit definition, not the type name. Half a dozen
 * civs have their own, so matching UNIT_MERCHANT left those civs with a button that never worked.
 */
import { isFactoryAge } from './age.js';
import { waitForEngineEvent } from './wait.js';
import { log, warn } from '../support/diagnostics.js';

/** A unit is identified the way settlements are elsewhere in this mod: by the id alone. */
export function unitKey(unitID) {
    return unitID ? String(unitID.id) : '';
}

let merchantTypes = null;

/** Every unit type that can open a trade route. Built once; `GameInfo.Units` is static. */
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

/**
 * `MakeTradeRoute`, remembered per unit type.
 *
 * ⚠️ `GameInfo.Units.lookup` is a DATABASE call and this is asked once per unit every time the
 * merchant list is read. Keyed on `unit.type` as it arrives and answered THROUGH `lookup`, so a
 * patch that changes the shape breaks nothing.
 */
const makesTradeRouteByType = new Map();

function typeMakesTradeRoute(type) {
    const cached = makesTradeRouteByType.get(type);
    if (cached !== undefined) {
        return cached;
    }
    let answer = false;
    try {
        answer = GameInfo.Units.lookup(type)?.MakeTradeRoute === true;
    } catch (error) {
        answer = false;
    }
    makesTradeRouteByType.set(type, answer);
    return answer;
}

export function isMerchant(unit) {
    if (!unit || unit.owner !== GameContext.localPlayerID) {
        return false;
    }
    return typeMakesTradeRoute(unit.type);
}

/**
 * Every merchant this player owns, or **null** when the engine could not be asked.
 * ⚠️ null and [] are different answers: see `pruneOrders` in merchant-orders.js.
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

/** What a merchant would cost here, and whether it can be bought at all. */
const offerCache = new Map();

/** Throws the prices away. */
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

    // ⚠️ Cached per settlement: asking the engine what a merchant costs runs once per settlement
    // per card per observer pass otherwise.
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

/** Which settlement buys the merchant. */
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

/** Buys a merchant and hands back the unit that appeared. */
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

/** How many trade routes this empire may hold with another leader, and how many it holds. */
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

/** Puts the camera on a unit and selects it. */
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
 * How many plots this puts through the pathfinder, and how many hits are enough to stop.
 *
 * ⚠️ A PERFORMANCE FIX. `Units.getPathTo` is a full pathfinder query and this ran one for EVERY
 * plot the target owns - thirty to fifty - after which `advance` put each through `moveMerchant`,
 * which pathfinds again inside `canStart`: eighty searches per merchant per attempt, three
 * attempts a turn, synchronous at `LocalPlayerTurnBegin`. Tens of seconds on a big map.
 *
 * ⚠️ The FAILING case is the expensive one: a search that succeeds stops at the target, one that
 * fails must exhaust everything the unit can reach.
 *
 * ⚠️ Nearest-first is what makes the cap safe rather than merely cheap - sorted by distance FROM
 * THE UNIT, the plots probed first are on the unit's own side. When the cap bites the centre is
 * still handed back and the attempt is still counted.
 */
const MAX_PATH_PROBES = 10;
const ENOUGH_REACHABLE = 3;

/**
 * Where to walk to, best plot first - the plots the target owns that the unit can path to.
 * A settlement's centre is often not its reachable part. When nothing paths, the centre is handed
 * back alone so an order still has somewhere to aim; the engine then refuses and the caller
 * counts the attempt.
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

    const reachable = [];
    let probes = 0;
    for (const location of locations) {
        if (reachable.length >= ENOUGH_REACHABLE || probes >= MAX_PATH_PROBES) {
            break;
        }
        probes++;
        try {
            if ((Units.getPathTo(unit.id, location)?.plots?.length ?? 0) > 0) {
                reachable.push(location);
            }
        } catch (error) {
            // Not reachable, and not worth a warning: that is what this loop is asking.
        }
    }
    if (reachable.length > 0) {
        return reachable;
    }
    if (locations.length > probes) {
        log(
            `no reachable plot among the ${probes} nearest of ${locations.length}; ` +
                'aiming at the settlement centre',
        );
    }
    return city?.location ? [{ x: city.location.x, y: city.location.y }] : locations.slice(0, ENOUGH_REACHABLE);
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

    // ⚠️ The target settlement's OWN plot, never the plot the merchant stands on - the same
    // argument `checkAndStartTradeRoute()` passes.
function routeArgs(location) {
    return { X: location.x, Y: location.y };
}

/**
 * Whether this merchant has already spent its turn.
 * ⚠️ Movement remaining, not "has it acted": a merchant bought this turn has none, and a course
 * issued to it would only sit queued.
 */
export function hasSpentItsTurn(unit) {
    try {
        return Number(unit?.Movement?.movementMovesRemaining ?? 0) <= 0;
    } catch (error) {
        return false;
    }
}

/**
 * How many turns before this merchant can open the route, or null when it cannot be said.
 *
 * ⚠️ Read from the engine's own pathfinder: `Units.getPathTo` answers with a `turns` array, one
 * entry per plot, so the last is the arrival turn.
 *
 * ⚠️ A FULL PATHFINDER QUERY - see MAX_PATH_PROBES. Its one caller draws the "arrives in N" label
 * on a trade route card, which exists only where a merchant is ALREADY walking there, so it is
 * bounded by the merchants under an order rather than by the number of cards. It is answered from
 * a cache on that side; do not call it from anything that iterates settlements or routes.
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

/**
 * Whether a merchant can open a route from wherever it stands - the Modern age only.
 * ⚠️ Named for the factory age because that is this mod's existing name for Modern.
 */
export function routesOpenFromAnywhere() {
    return isFactoryAge();
}

/** Stops a merchant where it stands, dropping whatever journey it still had queued. */
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
