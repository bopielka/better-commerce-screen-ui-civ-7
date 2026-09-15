/**
 * The game's framed tooltip for this mod's own buttons, which otherwise drew a bare box beside
 * controls that drew a frame. Multi-paragraph text becomes one CARD PER PARAGRAPH.
 *
 * ⚠️ These triggers live OUTSIDE Solid's tree - injected from an observer into elements the game
 * owns - so there is no component and no owner. Each gets its own `createRoot` to give the
 * reactive scope somewhere to live and something to dispose it.
 */
import { createComponent, createRoot } from '/core/vendor/solid-js/dist/solid.js';
import { insert } from '/core/vendor/solid-js/web/dist/web.js';
import { CardFrame } from '/core/ui-next/components/card-frame.js';
import { L10n } from '/core/ui-next/components/l10n.js';
import { Tooltip } from '/core/ui-next/components/tooltip.js';

import { areModTooltipsHidden } from '../engine/tooltip-setting.js';
import { makeElement, setTooltip } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/** How far the frame floats off the control it belongs to. The game's default is 0. */
const TOOLTIP_OFFSET = 12;

/**
 * Every live root's dispose function, in a Set per scope.
 * ⚠️ Per SCOPE, not one list: a tab tearing its own tooltips down used to dispose every tooltip on
 * the screen, so a visit to Trade Routes left the Resources tab's buttons with dead ones.
 */
const disposersByScope = new Map();

/**
 * Every scope another has been filed under ("trade-routes" for "trade-routes:12"). Only these need
 * the prefix scan; disposing a leaf - one buy stack's serial scope - is a single Map lookup.
 * ⚠️ Never pruned: a scope nested UNDER a serial one ("x:12:y") would grow it without bound.
 */
const parentScopes = new Set();

const DEFAULT_SCOPE = 'screen';

function fileDisposer(scope, dispose) {
    let disposers = disposersByScope.get(scope);
    if (!disposers) {
        disposers = new Set();
        disposersByScope.set(scope, disposers);
        for (let at = scope.indexOf(':'); at !== -1; at = scope.indexOf(':', at + 1)) {
            parentScopes.add(scope.slice(0, at));
        }
    }
    disposers.add(dispose);
}

function disposeScope(scope) {
    const disposers = disposersByScope.get(scope);
    if (!disposers) {
        return;
    }
    disposersByScope.delete(scope);
    for (const dispose of disposers) {
        try {
            dispose();
        } catch (error) {
            warn(`disposing a tooltip failed: ${error}`);
        }
    }
}

/**
 * Disposes a scope and everything filed under it - "trade-routes" takes "trade-routes:1234" too.
 * ⚠️ NOT optional before discarding a trigger: the frame is anchored to that element, and losing
 * it leaves the frame on screen with nothing to measure against, in the top-left corner.
 *
 * ⚠️ Nothing here disposes a root whose trigger merely LEFT THE DOCUMENT. The tabs' content sits in
 * a `ThrobberSuspense` (commerce-screen-base-tab-content.js) that detaches the same nodes while
 * images load and puts them back after, so a detached trigger is not proof of a dead one. A caller
 * may release its own detached roots only at a moment it has just found its container IN the
 * document - see `releaseDiscardedStrips` in trade-sort-tabs.js.
 */
export function disposeFramedTooltips(scope = DEFAULT_SCOPE) {
    disposeScope(scope);
    if (!parentScopes.has(scope)) {
        return;
    }
    const prefix = `${scope}:`;
    for (const key of Array.from(disposersByScope.keys())) {
        if (key.startsWith(prefix)) {
            disposeScope(key);
        }
    }
}

/**
 * A blank line separates thoughts; each becomes its own card.
 * ⚠️ Split on the MARKER as well as on a real blank line: `Locale.compose` does not turn `[N]` into
 * a newline - `Locale.stylize` does, later - so looking only for a real blank line found nothing.
 */
function paragraphsOf(text) {
    return String(text ?? '')
        .split(/\[N\]\s*\[N\]|\n\s*\n/)
        .map((part) => part.trim())
        .filter(Boolean);
}

function textCard(paragraph, isFirst) {
    return createComponent(CardFrame, {
        class: `${isFirst ? '' : 'mt-2 '}w-full flex flex-col p-3`,
        get children() {
            // ⚠️ Stylize, not Compose: these strings are already composed, and they carry
            // the game's own markup - [B] in the shortcut list, [N] inside a paragraph.
            return createComponent(L10n.Stylize, { text: paragraph });
        },
    });
}

/**
 * Puts `trigger` inside a framed tooltip and appends the result to `parent`.
 * @param title a localisation key for the heading, or null. @param text already composed.
 */
export function appendWithFramedTooltip(
    parent,
    trigger,
    { title = null, text = '', scope = DEFAULT_SCOPE } = {},
) {
    /*
     * ⚠️ The trigger still goes in: every caller is putting a BUTTON on screen, so returning early
     * would take the button away with its explanation.
     *
     * ⚠️ Decided when the control is BUILT, which is why the switch takes full effect on the next
     * visit - the trigger mounts INSIDE the Solid root, so disposing it removes the button too.
     */
    if (areModTooltipsHidden()) {
        parent.appendChild(trigger);
        return;
    }
    const paragraphs = paragraphsOf(text);
    if (paragraphs.length) {
        let dispose;
        try {
            const rendered = createRoot((disposeRoot) => {
                dispose = disposeRoot;
                // ⚠️ Nested components are built inside the parent's `children` getter, the
                // way JSX does it - hoisting one into a variable mounts it twice.
                const tooltip = createComponent(Tooltip, {
                    showFiligrees: false,
                    // The component default is 0, which puts the frame flush against the control.
                    offset: TOOLTIP_OFFSET,
                    get children() {
                        return [
                            createComponent(Tooltip.Trigger, {
                                get children() {
                                    return trigger;
                                },
                            }),
                            createComponent(Tooltip.Content, {
                                get children() {
                                    return createComponent(Tooltip.Frame, {
                                        class: 'relative flex flex-col items-center bp-1 min-w-64 max-w-96',
                                        get children() {
                                            const parts = [];
                                            if (title) {
                                                const heading = makeElement(
                                                    'div',
                                                    'font-title text-secondary uppercase mb-2',
                                                );
                                /*
                                 * ⚠️ Stylize, not Compose. Compose resolves the key and stops, so a
                                 * name carrying the game's own markup - every yield name is
                                 * "[icon:YIELD_FOOD] Food" in several languages - printed the tag
                                 * as literal text.
                                 */
                                                insert(heading, createComponent(L10n.Stylize, { text: title }));
                                                parts.push(heading);
                                            }
                                            parts.push(
                                                ...paragraphs.map((paragraph, index) =>
                                                    textCard(paragraph, index === 0),
                                                ),
                                            );
                                            return parts;
                                        },
                                    });
                                },
                            }),
                        ];
                    },
                });
                // ⚠️ Inside the root, as Solid's own `render` does: `tooltip` is a memo accessor, so
                // `insert` makes a render effect, and only one made here is released by `dispose`.
                if (tooltip) {
                    insert(parent, tooltip);
                }
                return tooltip;
            });

            if (rendered) {
                fileDisposer(scope, dispose);
                return;
            }
            dispose?.();
        } catch (error) {
            warn(`the framed tooltip would not mount, using plain text: ${error}`);
            try {
                dispose?.();
            } catch (disposeError) {
                warn(`disposing a tooltip that would not mount failed: ${disposeError}`);
            }
        }
    }
    setTooltip(trigger, text);
    parent.appendChild(trigger);
}
