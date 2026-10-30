/**
 * ⚠️ TEMPORARY - a heartbeat for the V8 out-of-memory crashes (2026-09-23..26). Every minute
 * it writes one line to UI.log: the engine's JS heap if it exposes one, the live DOM size, and the
 * size of every collection another module has registered here. A number that only ever climbs
 * across a long session is the leak. Remove, with every `registerMemoryGauges` call, once answered.
 *
 * In support/ so any layer can register without importing upwards; the probe only reads what it is
 * handed. ⚠️ `warn`, not `log`: it has to reach UI.log with DIAGNOSTICS off.
 *
 * Cost: one `getElementsByTagName("*")` walk and a `.size` read per gauge, every minute.
 */
import { warn } from './diagnostics.js';

// ⚠️ Wall-clock, not frames: a frame-counted interval stretches exactly when the game is slow.
const INTERVAL_MS = 60 * 1000;

/** module name -> { gauge name -> collection | () => number } */
const gauges = new Map();

/**
 * @param entries a collection (read via `.size` or `.length`) or a function returning a number.
 *        ⚠️ Pass a FUNCTION for a `let` that gets reassigned - a captured array would go stale.
 */
export function registerMemoryGauges(moduleName, entries) {
    gauges.set(moduleName, entries);
}

function read(source) {
    try {
        const value = typeof source === 'function' ? source() : (source?.size ?? source?.length);
        return typeof value === 'number' ? value : '?';
    } catch (error) {
        return '!';
    }
}

function megabytes(bytes) {
    return `${Math.round(bytes / 1048576)}MB`;
}

function heap() {
    try {
        const memory = performance?.memory;
        if (!memory || typeof memory.usedJSHeapSize !== 'number') {
            return 'n/a';
        }
        return `${megabytes(memory.usedJSHeapSize)}/${megabytes(memory.totalJSHeapSize)}`
            + ` limit ${megabytes(memory.jsHeapSizeLimit)}`;
    } catch (error) {
        return 'n/a';
    }
}

function domNodes() {
    try {
        return document.getElementsByTagName('*').length;
    } catch (error) {
        return '?';
    }
}

function turn() {
    try {
        return Game.turn;
    } catch (error) {
        return '?';
    }
}

const startedAt = Date.now();

function report() {
    const parts = [];
    for (const [moduleName, entries] of gauges) {
        const values = Object.entries(entries).map(([name, source]) => `${name}=${read(source)}`);
        parts.push(`${moduleName}{${values.join(' ')}}`);
    }
    const minutes = Math.round((Date.now() - startedAt) / 60000);
    warn(`[memory-probe] up=${minutes}min turn=${turn()} heap=${heap()} dom=${domNodes()} ${parts.join(' ')}`);
}

let started = false;

export function startMemoryProbe() {
    if (started) {
        return;
    }
    started = true;
    report();
    setInterval(report, INTERVAL_MS);
}
