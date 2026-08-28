/**
 * ⚠️ `console.log` never reaches Logs\UI.log in this engine; everything goes through
 * `console.error`. DIAGNOSTICS ships false - `warn` still writes, `log` does not.
 */
export const DIAGNOSTICS = false;

/**
 * ⚠️ A FUNCTION ARGUMENT IS CALLED HERE, and that is what makes it free with diagnostics off.
 * `log(`... ${Locale.compose(x)}`)` composes the message whatever DIAGNOSTICS says - the
 * argument is evaluated before the call. Pass `() => `...`` wherever the message costs a call
 * into the game, and the game is never asked.
 */
export function log(...args) {
    if (!DIAGNOSTICS) {
        return;
    }
    console.error('[better-commerce]', ...args.map((arg) => (typeof arg === 'function' ? arg() : arg)));
}

export function warn(...args) {
    console.error('[better-commerce]', ...args);
}
