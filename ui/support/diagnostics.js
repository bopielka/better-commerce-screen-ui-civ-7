/**
 * ⚠️ `console.log` never reaches Logs\UI.log in this engine; everything goes through
 * `console.error`. DIAGNOSTICS ships false - `warn` still writes, `log` does not.
 */
export const DIAGNOSTICS = false;

export function log(...args) {
    if (DIAGNOSTICS) {
        console.error('[better-commerce]', ...args);
    }
}

export function warn(...args) {
    console.error('[better-commerce]', ...args);
}
