/**
 * Treasure Convoys that sail home and unload themselves.
 *
 * A convoy is produced in a distant-lands settlement and is worth nothing at all until it
 * reaches the homeland and unloads - the game's own wording for the command is "Scores GDP,
 * awards Gold, and removes the Unit from the game", and its refusal reason is "Must be within
 * the borders of one of your Homeland Settlements to unload cargo". So the whole errand is:
 *
 *     sail towards the nearest homeland settlement
 *     stop at the FIRST tile of our own territory it reaches
 *     unload there
 *
 * ⚠️ The stop is a step of its own because a convoy is a NAVAL unit. Unloading is legal
 * anywhere inside our borders, but the only plots of a settlement a ship can be SENT to are
 * its water and its centre - so any course this issues names the centre or something beside
 * it, and a convoy left to finish that course sails past perfectly good owned water, often
 * for several more turns, before its journey ends and the cargo comes off. See `stopJourney`.
 *
 * There is no decision in any of that. The only skill a player exercises over a loaded convoy
 * is remembering it exists, several turns after the screen that produced it was closed, which
 * is bookkeeping rather than strategy - so this does it for them. The switch that turns it off
 * is in ./treasure-return-setting.js.
 *
 * The shape is the one Holistic QoL+ arrived at for the same problem (its "treasure convoy
 * return" patch) and, for the same reasons, it is also the shape of this mod's own
 * ./merchant-orders.js:
 *
 *   1. Every pass tries to UNLOAD first and only sails when unloading is refused. No distance
 *      is computed anywhere: `canStart` is the only thing that knows what "within the borders"
 *      means, and it accounts for borders shifting between turns.
 *   2. Nothing is stored. Unlike a merchant, a convoy needs no standing order to remember -
 *      every loaded convoy has the same destination and the same errand, so the intent is
 *      re-derived from the units themselves on each pass and there is nothing to persist,
 *      prune, or key by game seed.
 *   3. The unit is left alone the moment it has no cargo.
 *
 * ⚠️ THE ATTEMPT CAP IS NOT A TIDINESS MEASURE - WITHOUT IT THE GAME FREEZES. This is the
 * same trap documented at the top of merchant-orders.js, and Holistic QoL+ documents it too:
 * the engine answers a move request it cannot honour by firing `UnitOperationsCleared` /
 * `UnitOperationDeactivated`, which is exactly what this module listens for. A convoy that
 * cannot reach the homeland therefore re-requests, is refused, is woken by its own refusal,
 * and the cascade never ends.
 */
/*
 * ⚠️ IMPORTED, not read off the global scope. Almost everything this file talks to - `Game`,
 * `Players`, `GameplayMap`, `UnitOperationTypes` - IS global in this environment, and
 * `PlotCoord` looks like it belongs to that set but does not: it is a plain ES module export
 * (`core/ui/utilities/utilities-plotcoord.js`). Taking it for a global threw
 * `ReferenceError: PlotCoord is not defined` inside `homeTargets`, where the catch turned it
 * into an empty list of destinations - so every convoy silently had nowhere to go and none of
 * them ever sailed, with one line in UI.log as the only sign of it.
 */
import { PlotCoord } from '/core/ui/utilities/utilities-plotcoord.js';

import { isTreasureAutoReturnEnabled } from './treasure-return-setting.js';
import { unitKey } from './merchant.js';
import { onEngineEvent, onLocalPlayerEvent } from './events.js';
import { log, warn } from '../support/diagnostics.js';

/** See the ⚠️ at the top of the file. This number is the difference between a working
 *  mod and a hung game. */
const ATTEMPTS_PER_TURN = 3;

/** Long enough for a queued request to have landed, short enough to feel immediate. */
const PROCESS_DELAY_MS = 160;

/** These only ever ask "can it unload now?" - see `processConvoys`. */
const UNLOAD_EVENTS = ['UnitMoved', 'UnitMoveComplete'];

/**
 * Sailing is only re-issued on these.
 *
 * ⚠️ `UnitAddedToMap` IS one of them, and it is the only event outside the turn beginning
 * that may set a convoy moving. The rule everywhere else here is "do not fight the player" -
 * a pass that re-issued movement whenever a unit stopped would drag a convoy back the instant
 * it was steered somewhere else. A convoy that has just appeared has no such intent to
 * override: it is one turn old and standing in the settlement that built it. Leaving it out
 * meant a convoy produced during your turn sat still until your NEXT turn began, which is
 * exactly "a new convoy is not sent home".
 *
 * ⚠️ `UnitOperationsCleared` and `UnitOperationDeactivated` are NOT in this list, and that is
 * the freeze guard working with the cap rather than against it: those two are exactly what a
 * refused request fires, so re-issuing movement on them is the cascade. They are still
 * listened for, because a convoy whose orders were cleared should be looked at - but only to
 * see whether it can unload where it now stands.
 */
const SAIL_EVENTS = ['LocalPlayerTurnBegin', 'UnitAddedToMap'];

/** The one entry above that names no unit, and is therefore subscribed unfiltered. */
const TURN_BEGIN_EVENT = 'LocalPlayerTurnBegin';

/**
 * The game's own "Unload Cargo" command - `unit-commands.xml`, icon `action_unloadcargo.png`.
 * Named DISBAND because that is mechanically what it does: the convoy is consumed.
 */
const UNLOAD_COMMAND = 'UNITCOMMAND_DISBAND';

/** The game's own "cancel the queued order"; see `stopJourney`. */
const CANCEL_COMMAND = 'UNITCOMMAND_CANCEL';

/**
 * ⚠️ A position the command ignores. Unloading happens where the unit stands; the arguments
 * exist because `canStart`/`sendRequest` take the same shape for every command. Holistic QoL+
 * passes the same out-of-range pair for the same reason.
 */
function unloadArgs() {
    return { X: -9999, Y: -9999, UnitAbilityType: -1 };
}

/**
 * What a convoy is carrying, or 0 for a unit that is not one.
 *
 * ⚠️ This is how the GAME identifies a treasure fleet - `unit-flags.js` draws the number on
 * the flag from exactly this call, gated on exactly this pair. Matching against the unit type
 * name is the other way round and worse: `UNIT_TREASURE_FLEET` is not the only unit that can
 * carry treasure across ages and civilisations, and a type that the local player cannot build
 * does not resolve through `getBuildUnit` at all.
 */
function cargoAmount(unit) {
    try {
        if (!unit?.getAssociatedDisbandCityId?.()) {
            return 0;
        }
        const amount = Number(unit.getDisbandBaseAmount?.());
        return Number.isFinite(amount) ? amount : 0;
    } catch (error) {
        return 0;
    }
}

export function isTreasureConvoy(unit) {
    return Boolean(unit) && unit.owner === GameContext.localPlayerID && cargoAmount(unit) > 0;
}

/** Every loaded convoy of ours. An empty list on failure; nothing here needs to tell the
 *  two apart, because nothing here is stored to be pruned. */
function localConvoys() {
    try {
        return (Players.get(GameContext.localPlayerID)?.Units?.getUnits?.() ?? [])
            .filter(isTreasureConvoy);
    } catch (error) {
        warn(`could not read the treasure convoys: ${error}`);
        return [];
    }
}

function canUnload(unit) {
    try {
        return Game.UnitCommands?.canStart(unit.id, UNLOAD_COMMAND, unloadArgs(), false)?.Success === true;
    } catch (error) {
        return false;
    }
}

function unload(unit) {
    if (!canUnload(unit)) {
        return false;
    }
    try {
        Game.UnitCommands.sendRequest(unit.id, UNLOAD_COMMAND, unloadArgs());
        return true;
    } catch (error) {
        warn(`unloading a treasure convoy failed: ${error}`);
        return false;
    }
}

/**
 * Whether a plot is in our own homeland rather than the distant lands.
 *
 * ⚠️ Asked of the PLAYER, not of the plot. `isDistantLands` is a per-player question - the
 * same hemisphere is home to one empire and distant to another - and it is the same call the
 * unload command itself is gated on, so this cannot disagree with the engine about where home
 * is. Defaults to true on failure: a convoy sent to a settlement that turns out not to count
 * simply fails to unload there and is looked at again, which is recoverable, whereas
 * filtering every settlement out leaves it sitting still forever.
 */
function isHomeland(player, location) {
    if (!location || !PlotCoord.isValid(location)) {
        return false;
    }
    try {
        return player?.isDistantLands?.(location) !== true;
    } catch (error) {
        return true;
    }
}

/**
 * Whether the convoy is standing somewhere unloading is legal: inside our OWN borders, in the
 * home hemisphere.
 *
 * ⚠️ Ownership AND hemisphere, because `isHomeland` alone is not enough for this question.
 * That one answers "is this plot in the home hemisphere", which is true of every stretch of
 * open sea on this side of the world; the command wants to be "within the borders of one of
 * your Homeland Settlements", which is ownership. Both, or a convoy floating in neutral water
 * off the coast reads as home and its journey gets cancelled there.
 */
function standsWhereItCanUnload(player, unit) {
    const at = unit?.location;
    if (!at || !PlotCoord.isValid(at) || !isHomeland(player, at)) {
        return false;
    }
    try {
        return GameplayMap.getOwner(at.x, at.y) === GameContext.localPlayerID;
    } catch (error) {
        return false;
    }
}

/**
 * Drops a queued journey, so the convoy stops where it is instead of carrying on.
 *
 * ⚠️ `UNITCOMMAND_CANCEL` is the game's OWN cancel - `unit-commands.xml`, icon
 * `Action_Cancel.png`, the same command its unit action panel offers. Not a zero-distance
 * `MOVE_TO` to fake standing still, which is the obvious trick and is refused.
 */
function stopJourney(unit) {
    try {
        if (!Units.getQueuedOperationDestination?.(unit.id)) {
            return false;
        }
        const args = { X: -9999, Y: -9999 };
        if (Game.UnitCommands.canStart(unit.id, CANCEL_COMMAND, args, false)?.Success !== true) {
            return false;
        }
        Game.UnitCommands.sendRequest(unit.id, CANCEL_COMMAND, args);
        return true;
    } catch (error) {
        warn(`could not stop a treasure convoy that had reached the homeland: ${error}`);
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
 * Everywhere a convoy could unload, nearest first.
 *
 * ⚠️ Every purchased plot, not just the city centre. The command asks to be "within the
 * borders" of a homeland settlement, so the edge of the territory is as good as the middle
 * and is often many turns closer - and a city centre can be occupied by another unit while
 * its borders are wide open.
 */
function homeTargets(unit) {
    const player = Players.get(GameContext.localPlayerID);
    const locations = new Map();

    try {
        for (const city of player?.Cities?.getCities?.() ?? []) {
            if (city.owner !== GameContext.localPlayerID || city.isDistantLands === true) {
                continue;
            }
            if (!isHomeland(player, city.location)) {
                continue;
            }
            const add = (location) => {
                if (location && PlotCoord.isValid(location) && isHomeland(player, location)) {
                    locations.set(`${location.x},${location.y}`, { x: location.x, y: location.y });
                }
            };
            add(city.location);
            for (const plotIndex of city.getPurchasedPlots?.() ?? []) {
                add(GameplayMap.getLocationFromIndex(plotIndex));
            }
        }
    } catch (error) {
        warn(`could not find a homeland settlement for a treasure convoy: ${error}`);
    }

    return Array.from(locations.values())
        .sort((first, second) => plotDistance(unit.location, first) - plotDistance(unit.location, second));
}

function moveArgs(location) {
    return {
        X: location.x,
        Y: location.y,
        // Home is ours and its surroundings need not all be explored; without this the
        // order is refused when they are not. Same reasoning as moveMerchant in merchant.js.
        Modifiers: UnitOperationMoveModifiers.MOVE_IGNORE_UNEXPLORED_DESTINATION,
    };
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

function sailHome(unit) {
    if (!mayAttempt(unitKey(unit.id))) {
        return false;
    }
    for (const location of homeTargets(unit)) {
        try {
            if (!Game.UnitOperations.canStart(unit.id, UnitOperationTypes.MOVE_TO, moveArgs(location), false).Success) {
                continue;
            }
            Game.UnitOperations.sendRequest(unit.id, UnitOperationTypes.MOVE_TO, moveArgs(location));
            return true;
        } catch (error) {
            warn(`sending a treasure convoy home failed: ${error}`);
            return false;
        }
    }
    return false;
}

let processing = false;
let scheduled = false;
let scheduledMaySail = false;

/**
 * @param maySail whether this pass may issue movement, or only try to unload.
 *
 * ⚠️ Most passes are unload-only, and that is what keeps the player in control of their own
 * convoy. A pass that re-issued movement on every `UnitMoveComplete` would drag the convoy
 * back onto its course the instant the player steered it anywhere else - to scout, to run
 * from a raider, to pick a different landing - and it is also the pass that feeds the refusal
 * cascade described at the top of this file. Movement is re-issued once a turn.
 */
function processConvoys(maySail) {
    if (processing || !isTreasureAutoReturnEnabled()) {
        return;
    }
    processing = true;
    try {
        const player = Players.get(GameContext.localPlayerID);
        for (const unit of localConvoys()) {
            try {
                if (unload(unit)) {
                    log('a treasure convoy unloaded in the homeland');
                    attempts.delete(unitKey(unit.id));
                    continue;
                }
                /*
                 * ⚠️ THE FIRST OWNED TILE IS THE DESTINATION, not the settlement it was aimed
                 * at. Unloading is legal anywhere inside our borders, but a convoy is a NAVAL
                 * unit and the only plots of a settlement it can actually be sent to are its
                 * water and its centre - so the course this issues necessarily names the
                 * centre or a tile near it, and left alone the convoy sails the whole way
                 * there before its journey ends and the cargo comes off.
                 *
                 * Standing inside our own borders with the engine still refusing is that and
                 * nothing else: the queued journey still owns the unit. Dropping it lets the
                 * next pass unload where the convoy already is, several tiles and often
                 * several turns earlier.
                 */
                if (standsWhereItCanUnload(player, unit)) {
                    if (stopJourney(unit)) {
                        log('a treasure convoy stopped at the first homeland tile it reached');
                    }
                    // Home is home: never sail on from here, whatever `maySail` says.
                    continue;
                }
                if (maySail) {
                    sailHome(unit);
                }
            } catch (error) {
                warn(`could not advance a treasure convoy: ${error}`);
            }
        }
    } finally {
        processing = false;
    }
}

/**
 * ⚠️ Debounced, and it has to be. Every event this module listens for can arrive several
 * times for one move, and each pass talks to the engine about every convoy. Two passes that
 * fall in the same window merge, and the one that may sail wins. Holistic QoL+ records the
 * same fix: one raw timer per engine event was itself enough to grow into a freeze.
 */
function scheduleProcess(maySail = false) {
    /*
     * ⚠️ Asked here as well as in `processConvoys`, and it is not a duplicate. Switched off,
     * the pass does nothing - but the timer is still armed and the merged flags still
     * bookkept, on every movement of every convoy, all game. This is the version of the
     * question that costs nothing.
     */
    if (!isTreasureAutoReturnEnabled()) {
        return;
    }
    scheduledMaySail = scheduledMaySail || maySail;
    if (scheduled) {
        return;
    }
    scheduled = true;
    setTimeout(() => {
        scheduled = false;
        const sail = scheduledMaySail;
        scheduledMaySail = false;
        processConvoys(sail);
    }, PROCESS_DELAY_MS);
}

let started = false;

/**
 * Installs the listeners. Called from the entry point, not from a component: a convoy sails
 * for many turns after the Commerce screen that produced it has been closed.
 *
 * ⚠️ The switch is read per pass, not here. Turning it on mid-game has to start looking after
 * the convoys already at sea, and turning it off has to stop at once - see `processConvoys`.
 */
export function startTreasureConvoys() {
    if (started) {
        return;
    }
    started = true;

    /*
     * ⚠️ THESE EVENTS ARE NOT ABOUT YOUR CONVOYS, AND MOSTLY NOT ABOUT YOU. `UnitMoved` is
     * raised once per tile per unit for every player in the game; a late-game AI turn raises
     * thousands, and each one used to wake a pass that walked the player's whole unit list
     * asking the engine twice about every unit in it - to conclude, almost always, that
     * nothing had moved except somebody else's scout.
     *
     * Two filters, both before any of that: whose unit it is, and whether it is a convoy at
     * all. The second costs one `Units.get` and the two calls `cargoAmount` makes about that
     * ONE unit, against the whole list. `LocalPlayerTurnBegin` keeps the unfiltered pass, so
     * a convoy nothing has been raised about is still looked after once a turn.
     */
    const listenPerUnit = (name, maySail) =>
        onLocalPlayerEvent(name, (data) => {
            if (!isTreasureAutoReturnEnabled() || !data?.unit) {
                return;
            }
            let unit = null;
            try {
                unit = Units.get(data.unit);
            } catch (error) {
                return;
            }
            if (!isTreasureConvoy(unit)) {
                return;
            }
            scheduleProcess(maySail);
        });

    for (const name of UNLOAD_EVENTS) {
        listenPerUnit(name, false);
    }
    for (const name of SAIL_EVENTS) {
        if (name === TURN_BEGIN_EVENT) {
            // Belongs to nobody and names no unit; it is the safety net behind the filters.
            onEngineEvent(name, () => scheduleProcess(true));
            continue;
        }
        listenPerUnit(name, true);
    }
    // Refused or cleared orders: worth a look, never worth re-issuing movement for. See the
    // note on SAIL_EVENTS.
    listenPerUnit('UnitOperationsCleared', false);
    listenPerUnit('UnitOperationDeactivated', false);

    // A convoy already at sea when the game is loaded gets its first pass now.
    scheduleProcess(true);
    log('treasure convoy auto-return installed');
}
