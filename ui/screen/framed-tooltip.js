/**
 * The game's framed tooltip, for this mod's own buttons and controls.
 *
 * The game draws its tooltips as a bordered frame with a title over one or more inset
 * cards. Everything this mod added drew a bare box of text instead, so the screen had two
 * visual languages on it at once - the game's for its own controls, ours for the buttons
 * sitting right beside them.
 *
 * Multi-paragraph text becomes one CARD PER PARAGRAPH, which is what the frame is for: the
 * shortcut list, the switches and the settlement controls all had two or three thoughts
 * separated by a blank line, and in a bare box those ran together.
 *
 * ⚠️ Paragraphs are found by splitting the COMPOSED text on a blank line, so nothing new is
 * needed in the localisation files - `[N][N]` already resolves to one. Existing keys become
 * cards on their own.
 *
 * ⚠️ These triggers live OUTSIDE Solid's tree. `assign-all-buttons.js`, `assign-switches.js`
 * and `settlement-controls.js` inject into elements the game owns, from a MutationObserver -
 * there is no component and therefore no owner. Every tooltip is created inside its own
 * `createRoot` so the reactive scope has somewhere to live and something to dispose it, and
 * `disposeFramedTooltips()` tears them all down when the screen goes.
 *
 * See resource-tooltip.js for the same job on the Empire and Factory cards, and for the
 * traps in writing Solid without JSX - they apply here too.
 */
import { createComponent, createRoot } from '/core/vendor/solid-js/dist/solid.js';
import { insert } from '/core/vendor/solid-js/web/dist/web.js';
import { CardFrame } from '/core/ui-next/components/card-frame.js';
import { L10n } from '/core/ui-next/components/l10n.js';
import { Tooltip } from '/core/ui-next/components/tooltip.js';

import { makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/** How far the frame floats off the control it belongs to. The game's default is 0. */
const TOOLTIP_OFFSET = 12;

/** One disposer per tooltip; see disposeFramedTooltips. */
const disposers = [];

export function disposeFramedTooltips() {
    while (disposers.length) {
        try {
            disposers.pop()();
        } catch (error) {
            warn(`disposing a tooltip failed: ${error}`);
        }
    }
}

/**
 * A blank line separates thoughts; each becomes its own card.
 *
 * ⚠️ Split on the MARKER as well as on a real blank line. `Locale.compose` does not turn
 * `[N]` into a newline - `Locale.stylize` does, and that runs later, inside `L10n.Stylize`.
 * Looking only for `\n\n` therefore found nothing in a composed string and every tooltip
 * came out as a single card, which is the whole feature not working.
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
 *
 * @param title  a localisation key for the heading, or null for no heading.
 * @param text   already composed; blank lines split it into cards.
 */
export function appendWithFramedTooltip(parent, trigger, { title = null, text = '' } = {}) {
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
                    // ⚠️ The component's own `offset`, default 0 - which puts the frame
                    // flush against the control and reads as part of it. A little air
                    // makes it read as a separate thing floating over the screen.
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
                                                insert(heading, createComponent(L10n.Compose, { text: title }));
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
                disposers.push(dispose);
                insert(parent, rendered);
                return;
            }
            dispose?.();
        } catch (error) {
            warn(`the framed tooltip would not mount, using plain text: ${error}`);
        }
    }
    if (text) {
        trigger.setAttribute('data-tooltip-content', text);
    }
    parent.appendChild(trigger);
}
