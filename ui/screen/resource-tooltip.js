/**
 * The game's own framed resource tooltip, extended with a card per leader.
 *
 * The unassigned pool draws a proper tooltip for every resource: a class header with its
 * icon ("CITY RESOURCE"), the resource in its frame, its name, and the game's description.
 * These tabs used to draw a plain text one - the same words in a bare box - so the same
 * resource looked like two different objects depending on which tab you hovered it on.
 *
 * ⚠️ It cannot be asked for from a `data-tooltip-*` attribute. `ui-next/tooltips/
 * resource-tooltip.jsx` is a Solid COMPONENT that wraps its trigger in `<Tooltip.Trigger>`,
 * so the trigger has to be handed to it and its output put in the trigger's place.
 *
 * ⚠️ And it has exactly ONE free text slot, `resourceOrigin`, rendered after "Origin:" -
 * enough for the single city name the game puts there, not for what these tabs know. So
 * this is not a wrapper around the game's component but a transcription of it, with the
 * leader breakdown added underneath as its own cards. Nothing is lost and it still looks
 * like the game's.
 *
 * ═══ Building tooltips like the game's ═══
 *
 * Every piece here is the game's own, taken from what its Empire tab already does with the
 * same data (`commerce-screen-empire-tab.jsx`) - which is the shortcut worth remembering:
 * find a screen that renders the thing you want and read which components it reaches for.
 *
 *   Tooltip / .Trigger / .Content / .Frame   the shell; `showFiligrees: false` for the plain
 *                                            corner style this one uses
 *   CardFrame                                `card-frame-bg`, the inset card
 *   PortraitIcon    { playerId, size }       a leader's face, framed in their colours
 *   FramedResource  { size, ...resProps }    the resource in its class frame
 *   Icon            { name, isUrl }          `name` is a `url(blp:…)` string when isUrl
 *   Divider.Vertical / .Horizontal           `{ margin }`, `{ useGradient }`
 *   L10n.Compose    { text, args }           localise a key
 *   L10n.Stylize    { text }                 localise AND honour the game's `[B]`, `[N]`…
 *
 * ⚠️ Written in Solid's compiled form (`createComponent`, `get children()`), because a
 * mod's scripts are plain ES modules with no JSX step - the same reason factory-tab.js is.
 * The getters are not decoration: a plain value is read once and never updates.
 *
 * ⚠️ It must be created under a Solid owner. Both tabs build their cards inside `onMount`,
 * inside their container component, so there is one. Called from anywhere else it would
 * leak its reactive scope.
 */
import { createComponent } from '/core/vendor/solid-js/dist/solid.js';
import { insert } from '/core/vendor/solid-js/web/dist/web.js';
import { CardFrame } from '/core/ui-next/components/card-frame.js';
import { Divider } from '/core/ui-next/components/divider.js';
import { Icon } from '/core/ui-next/components/icon.js';
import { L10n } from '/core/ui-next/components/l10n.js';
import { PortraitIcon } from '/core/ui-next/components/portrait-icon.js';
import { Tooltip } from '/core/ui-next/components/tooltip.js';
import { FramedResource } from '/base-standard/ui-next/components/framed-resource.js';

import { makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/**
 * The props the game's tooltip reads, built the way the game builds them.
 *
 * ⚠️ Transcribed from `getResourcePropsFromDefinition` in commerce-screen-model.ts, which is
 * not exported. Two traps: `resourceType` is a LOCALISATION KEY and not the resource's type
 * - the tooltip composes it into `LOC_RESOURCECLASS_TOOLTIP_NAME` - and both icons are
 * `url(blp:…)` strings rather than paths.
 *
 * @param description overrides the resource's own `Tooltip`, for a card that says more.
 */
export function resourceTooltipProps(resourceType, { description = null } = {}) {
    const definition = GameInfo.Resources.lookup(resourceType);
    if (!definition) {
        return null;
    }
    const classType = definition.ResourceClassType;
    return {
        resourceName: definition.Name,
        resourceIcon: `url(blp:${UI.getIconBLP(definition.ResourceType)})`,
        resourceType: `LOC_${classType}_NAME`,
        resourceTypeIcon: `url(blp:${UI.getIconBLP(classType)})`,
        tooltipText: description ?? definition.Tooltip,
    };
}

/** The class header: "CITY RESOURCE", with the little class icon before it. */
function classHeader(props) {
    const header = makeElement('div', 'font-title text-secondary uppercase mb-2 flex flex-row items-center');
    insert(header, createComponent(Icon, { class: 'size-7 mr-2', name: props.resourceTypeIcon, isUrl: true }));
    insert(
        header,
        createComponent(L10n.Compose, {
            text: 'LOC_RESOURCECLASS_TOOLTIP_NAME',
            args: [Locale.compose(props.resourceType)],
        }),
    );
    return header;
}

/**
 * The fixed-width column every card puts its icon in.
 *
 * ⚠️ This is what makes the vertical rules line up. A resource in its frame and a leader's
 * portrait are both asked for at `size: 14`, but they are different components and do not
 * measure the same - the portrait carries its own hex frame and a `-mt-1` of its own - so
 * laid out directly the rule after each one landed at a different x and the cards read as
 * two unrelated boxes. Given a slot of a fixed size, whatever sits in it starts and ends in
 * the same place.
 */
function iconSlot(component) {
    const slot = makeElement('div', 'size-14 shrink-0 flex flex-row items-center justify-center');
    insert(slot, component);
    return slot;
}

/** The resource itself: framed icon, a rule, then the name over the description. */
function resourceCard(props) {
    const name = makeElement('div', 'font-title text-secondary uppercase');
    insert(name, createComponent(L10n.Compose, { text: props.resourceName }));

    const words = makeElement('div', 'flex flex-col shrink');
    words.appendChild(name);
    insert(words, createComponent(Divider.Horizontal, { margin: 1, useGradient: true }));
    insert(words, createComponent(L10n.Stylize, { text: props.tooltipText }));

    // ⚠️ `w-full`, or the frame's `items-center` sizes each card to its own contents and
    // the two end up different widths.
    const card = makeElement('div', 'w-full flex flex-row items-center img-base-ticket-bg p-3');
    card.appendChild(iconSlot(createComponent(FramedResource, { size: 14, ...props })));
    insert(card, createComponent(Divider.Vertical, { margin: 3 }));
    card.appendChild(words);
    return card;
}

/**
 * One card per leader: their face, their name and total, and their settlements beneath.
 *
 * ⚠️ `PortraitIcon` takes a `playerId`, and the leader id in `resourceOriginData` is one -
 * the game's own Empire tab passes it straight through the same way.
 *
 * @param group { leaderId, title, lines[] }
 */
function leaderCard(group) {
    const words = makeElement('div', 'flex flex-col shrink');
    const title = makeElement('div', 'font-title text-secondary uppercase');
    title.textContent = group.title;
    words.appendChild(title);
    for (const line of group.lines ?? []) {
        insert(words, createComponent(L10n.Stylize, { text: line }));
    }

    /*
     * ⚠️ Laid out exactly like the resource card above it: portrait, a vertical rule, then
     * the words - same `size: 14`, same `margin: 3` on the divider, same `p-3`. Without the
     * rule the face sits straight against its text and the two cards read as different
     * kinds of thing stacked together, which is the opposite of the point.
     */
    return createComponent(CardFrame, {
        class: 'mt-2 w-full flex flex-row items-center p-3',
        get children() {
            const row = [];
            if (group.leaderId !== undefined && group.leaderId !== null) {
                row.push(iconSlot(createComponent(PortraitIcon, { playerId: group.leaderId, size: 14 })));
                row.push(createComponent(Divider.Vertical, { margin: 3 }));
            }
            row.push(words);
            return row;
        },
    });
}

/**
 * Puts `trigger` inside the tooltip and appends the result to `parent`.
 *
 * ⚠️ Falls back to the plain text tooltip if anything here refuses to mount, and says so.
 * This reaches into components the game did not write for outside use; without the fallback
 * a patch that moves one of them would leave the card with **no tooltip at all**, which is
 * strictly worse than the bare box this replaced. The warning names it, so that shows up in
 * the log rather than as silently missing text.
 *
 * @param groups [{ leaderId?, title, lines[] }] - cards below the resource, in order.
 */
export function appendWithResourceTooltip(parent, trigger, props, fallbackText, groups = []) {
    if (props) {
        try {
            /*
             * ⚠️ Every nested component is created INSIDE its parent's `children` getter,
             * never hoisted into a variable first.
             *
             * This is what JSX nesting compiles to, and the difference is not cosmetic:
             * `<Tooltip.Content><Tooltip.Frame/></Tooltip.Content>` builds the Frame while
             * the Content is being evaluated, so the Frame is created under the Tooltip's
             * context. Building it beforehand and passing the node in creates it OUTSIDE
             * that context - and the frame then mounts on its own as well as through the
             * Content, so the card is drawn TWICE and two tooltips follow the cursor.
             */
            const rendered = createComponent(Tooltip, {
                showFiligrees: false,
                // A little air off the card, matching framed-tooltip.js.
                offset: 12,
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
                                        return [
                                            classHeader(props),
                                            resourceCard(props),
                                            // A group with no leaderId is one about us -
                                            // "in these settlements" - so it gets no
                                            // portrait.
                                            ...groups.map(leaderCard),
                                        ];
                                    },
                                });
                            },
                        }),
                    ];
                },
            });

            if (rendered) {
                insert(parent, rendered);
                return;
            }
        } catch (error) {
            warn(`the game's resource tooltip would not mount, using plain text: ${error}`);
        }
    }
    if (fallbackText) {
        trigger.setAttribute('data-tooltip-content', fallbackText);
    }
    parent.appendChild(trigger);
}
