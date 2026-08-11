/**
 * Diagnostic logging.
 *
 * `console.log` never reaches Logs\UI.log in this engine, so everything goes through
 * `console.error`. Flip DIAGNOSTICS to false before releasing - the previous mod
 * shipped 1.0 with its logging still switched on.
 */
export const DIAGNOSTICS = true;

export function log(...args) {
    if (DIAGNOSTICS) {
        console.error('[better-commerce]', ...args);
    }
}

export function warn(...args) {
    console.error('[better-commerce]', ...args);
}
