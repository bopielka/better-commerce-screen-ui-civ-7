/**
 * Treasure Convoys that sail home and unload themselves.
 *
 * A loaded convoy is worth nothing until it reaches the homeland and unloads, and the only skill
 * a player exercises over one is remembering it exists several turns after the screen that
 * produced it closed. The errand: sail towards the nearest homeland settlement, stop at the FIRST
 * tile of our own territory, unload there. Switch in ./treasure-return-setting.js.
 *
 * ⚠️ The stop is a step of its own because a convoy is a NAVAL unit. Unloading is legal anywhere
 * inside our borders, but the only plots of a settlement a ship can be SENT to are its water and
 * its centre - so a convoy left to finish its course sails past perfectly good owned water for
 * several more turns. See `stopJourney`.
 *
 * Same shape as ./merchant-orders.js: try to UNLOAD first and only sail when refused (no distance
 * is computed - `canStart` is the only thing that knows what "within the borders" means), store
 * nothing (every loaded convoy has the same errand, so intent is re-derived each pass), and leave
 * the unit alone the moment it has no cargo.
 *
 * ⚠️ THE ATTEMPT CAP IS NOT TIDINESS - WITHOUT IT THE GAME FREEZES. Same trap as merchant-orders:
 * the engine answers a move it cannot honour with `UnitOperationsCleared`, which is what this
 * module listens for, so the convoy is woken by its own refusal and the cascade never ends.
 */
/*
 * ⚠️ IMPORTED, not global. `Game`, `Players`, `GameplayMap` and friends ARE global here and
 * `PlotCoord` looks like it belongs to that set - it does not, it is a plain ES module export.
 * Taking it for a global threw `ReferenceError` inside `homeTargets`, where the catch turned it
 * into an empty destination list: every convoy silently had nowhere to go.
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
 * ⚠️ `UnitAddedToMap` IS one of them, and it is the only event outside the turn beginning that
 * may set a convoy moving. The rule everywhere else is "do not fight the player" - a pass that
 * re-issued movement whenever a unit stopped would drag a convoy back the instant it was steered
 * elsewhere. A convoy that has just appeared has no such intent to override.
 */
const SAIL_EVENTS = ['LocalPlayerTurnBegin', 'UnitAddedToMap'];

/** The one entry above that names no unit, and is therefore subscribed unfiltered. */
const TURN_BEGIN_EVENT = 'LocalPlayerTurnBegin';

/** The game's own "Unload Cargo" command. Named DISBAND because that is what it does. */
const UNLOAD_COMMAND = 'UNITCOMMAND_DISBAND';

/** The game's own "cancel the queued order"; see `stopJourney`. */
const CANCEL_COMMAND = 'UNITCOMMAND_CANCEL';

// ⚠️ A position the command ignores: unloading happens where the unit stands.
function unloadArgs() {
    return { X: -9999, Y: -9999, UnitAbilityType: -1 };
}

/**
 * What a convoy is carrying, or 0 for a unit that is not one.
 * ⚠️ This is how the GAME identifies a treasure fleet - `unit-flags.js` draws the number from
 * exactly this call. Matching the type name is worse: UNIT_TREASURE_FLEET is not the only one.
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

/** Whether a plot is in our own homeland rather than the distant lands. */
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

/** Whether the convoy is standing somewhere unloading is legal. */
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

/** Drops a queued journey, so the convoy stops instead of sailing past owned water. */
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

/** Everywhere a convoy could unload, nearest first. */
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

/** @param maySail whether this pass may issue movement, or only try to unload. */
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
         * ⚠️ THE FIRST OWNED TILE IS THE DESTINATION, not the settlement it was aimed at. A course
         * can only name water or the centre, so the convoy is stopped the moment it stands
         * somewhere unloading is legal.
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

// ⚠️ Debounced: every event here can arrive several times for one move.
function scheduleProcess(maySail = false) {
    // ⚠️ Asked here as well as in `processConvoys`, and not a duplicate: switched off, nothing is
    // even scheduled.
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
 * Installs the listeners, from the entry point rather than a component - a convoy sails for many
 * turns after the screen that produced it is gone.
 * ⚠️ The switch is read per pass, not here: turning it on mid-game has to pick up the convoys
 * already at sea.
 */
export function startTreasureConvoys() {
    if (started) {
        return;
    }
    started = true;

    /*
     * ⚠️ THESE EVENTS ARE NOT ABOUT YOUR CONVOYS, AND MOSTLY NOT ABOUT YOU. `UnitMoved` is raised
     * once per tile per unit for every player. Two filters before any work: whose unit it is, and
     * whether it is a convoy at all - one `Units.get` and two calls about that ONE unit, against
     * the whole list. `LocalPlayerTurnBegin` keeps the unfiltered pass as the safety net.
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
