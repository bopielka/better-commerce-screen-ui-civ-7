/**
 * Diagnostic logging.
 *
 * `console.log` never reaches Logs\UI.log in this engine, so everything goes through
 * `console.error`.
 *
 * ⚠️ OFF for release. `warn` still writes, so a genuine failure is still recorded; what is
 * switched off is the running commentary - assignment timings, how the trade routes were
 * grouped, how many cards a tab built. Turn it back on while working on the mod and off
 * again before publishing: the previous mod shipped 1.0 with its logging still on.
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
