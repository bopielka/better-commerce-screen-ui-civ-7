/**
 * "Open the Commerce screen on THIS tab" - a one-shot request handed from whatever opens the
 * screen to the screen itself.
 *
 * ⚠️ ONE SHOT, AND THAT IS THE WHOLE DESIGN. `Tab`'s `defaultTab` is read from an effect, so a
 * value left standing would make every later opening of the screen land on the same tab - the
 * dock's own Resource Allocation button included. `takeRequestedTab` therefore CLEARS as it
 * reads, and the screen asks exactly once, when it is created.
 *
 * In screen/ because both ends are: the dock button that sets it and the CommerceScreen
 * replacement that reads it.
 */

/** A `Tab.Item` name in screen/factory-tab.js; the request has to spell one of them. */
export const TAB_TRADE = 'Trade';

let requested = null;

export function requestTabOnOpen(name) {
    requested = name ?? null;
}

/** @returns the tab asked for, or undefined for "whatever the screen opens on normally". */
export function takeRequestedTab() {
    const name = requested;
    requested = null;
    return name ?? undefined;
}
