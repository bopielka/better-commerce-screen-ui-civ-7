/**
 * The game's framed tooltip - a bordered frame with a title over inset cards - for this mod's own
 * buttons and controls, which otherwise drew a bare box beside controls that drew a frame.
 *
 * Multi-paragraph text becomes one CARD PER PARAGRAPH. ⚠️ Paragraphs are found by splitting the
 * COMPOSED text on a blank line, so nothing new is needed in the localisation files.
 *
 * ⚠️ These triggers live OUTSIDE Solid's tree - injected into elements the game owns, from an
 * observer, so there is no component and no owner. Each tooltip is created in its own `createRoot`
 * so the reactive scope has somewhere to live and something to dispose it.
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
 * ⚠️ Per SCOPE, not one list: a tab tearing its own tooltips down used to dispose every tooltip on
 * the screen, so a visit to Trade Routes left the Resources tab's buttons with dead ones.
 */
const disposers = new Map();

const DEFAULT_SCOPE = 'screen';

/**
 * Disposes a scope and everything filed under it - "trade-routes" takes "trade-routes:1234" too.
 *
 * ⚠️ Disposing before discarding a trigger is NOT optional: a framed tooltip is anchored to the
 * element it was built around, and removing that element while the frame is open leaves the frame
 * on screen with nothing to measure against, drawn in the top-left corner.
 */
export function disposeFramedTooltips(scope = DEFAULT_SCOPE) {
    const prefix = `${scope}:`;
    for (const key of Array.from(disposers.keys())) {
        if (key !== scope && !key.startsWith(prefix)) {
            continue;
        }
        const list = disposers.get(key);
        while (list?.length) {
            try {
                list.pop()();
            } catch (error) {
                warn(`disposing a tooltip failed: ${error}`);
            }
        }
        disposers.delete(key);
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
     * ⚠️ The trigger still goes in - every caller is putting a BUTTON on screen and describing it
     * in the same breath, so returning early would take the button away with its explanation.
     *
     * ⚠️ Decided when the control is BUILT, which is why throwing the switch takes full effect on
     * the next visit: a framed tooltip mounts its trigger INSIDE the Solid root it creates, so
     * disposing one to undo it would remove the button too.
     */
    if (areModTooltipsHidden()) {
        parent.appendChild(trigger);
        return;
    }
    const paragraphs = paragraphsOf(text);
    if (paragraphs.length) {
        try {
            let dispose;
            const rendered = createRoot((disposeRoot) => {
                dispose = disposeRoot;
                // ⚠️ Nested components are built inside the parent's `children` getter, the
                // way JSX does it - hoisting one into a variable mounts it twice.
                return createComponent(Tooltip, {
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
            });

            if (rendered) {
                if (!disposers.has(scope)) {
                    disposers.set(scope, []);
                }
                disposers.get(scope).push(dispose);
                insert(parent, rendered);
                return;
            }
            dispose?.();
        } catch (error) {
            warn(`the framed tooltip would not mount, using plain text: ${error}`);
        }
    }
    setTooltip(trigger, text);
    parent.appendChild(trigger);
}
