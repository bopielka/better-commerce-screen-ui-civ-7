/**
 * The game's own framed resource tooltip, extended with a card per leader.
 *
 * The unassigned pool draws a proper tooltip for every resource; these tabs used to draw a bare
 * box of text, so the same resource looked like two different objects depending on the tab.
 *
 * ⚠️ It cannot be asked for from a `data-tooltip-*` attribute: `ui-next/tooltips/
 * resource-tooltip.jsx` is a Solid COMPONENT that wraps its trigger in `<Tooltip.Trigger>`, so the
 * trigger has to be handed to it and its output put in the trigger's place.
 *
 * ⚠️ And it has exactly ONE free text slot, `resourceOrigin`, rendered after "Origin:" - enough
 * for the single city name the game puts there, not for what these tabs know. Hence the extra
 * cards below it.
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

import { areModTooltipsHidden } from '../engine/tooltip-setting.js';
import { makeElement, setTooltip } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

/**
 * ⚠️ Three lookups per resource card - the resource table and the atlas twice - and every one of
 * them describes the resource TYPE, which cannot change while the game runs. Only the description
 * varies by caller, so it is layered on top rather than cached with the rest.
 */
const propsByType = new Map();

function baseProps(resourceType) {
    let props = propsByType.get(resourceType);
    if (props === undefined) {
        const definition = GameInfo.Resources.lookup(resourceType);
        if (!definition) {
            props = null;
        } else {
            const classType = definition.ResourceClassType;
            props = {
                resourceName: definition.Name,
                resourceIcon: `url(blp:${UI.getIconBLP(definition.ResourceType)})`,
                resourceType: `LOC_${classType}_NAME`,
                resourceTypeIcon: `url(blp:${UI.getIconBLP(classType)})`,
                tooltipText: definition.Tooltip,
            };
        }
        propsByType.set(resourceType, props);
    }
    return props;
}

/** The props the game's tooltip reads, built the way the game builds them. */
export function resourceTooltipProps(resourceType, { description = null } = {}) {
    const props = baseProps(resourceType);
    if (!props) {
        return null;
    }
    return description === null ? props : { ...props, tooltipText: description };
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

/** The fixed-width column every card puts its icon in, so the text lines up down the stack. */
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

/** One card per leader: their face, their name and total, and their settlements beneath. */
function leaderCard(group) {
    const words = makeElement('div', 'flex flex-col shrink');
    const title = makeElement('div', 'font-title text-secondary uppercase');
    title.textContent = group.title;
    words.appendChild(title);
    for (const line of group.lines ?? []) {
        insert(words, createComponent(L10n.Stylize, { text: line }));
    }

    // ⚠️ Laid out exactly like the resource card above it - portrait, vertical rule, text - so the
    // stack reads as one object rather than as a tooltip with something bolted under it.
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

/** Puts `trigger` inside the tooltip and appends the result to `parent`. */
export function appendWithResourceTooltip(parent, trigger, props, fallbackText, groups = []) {
    // ⚠️ The tile still goes in; only the tooltip is declined - and the plain fallback below is
    // declined with it, so this means "no tooltip", not "the worse of the two".
    if (areModTooltipsHidden()) {
        parent.appendChild(trigger);
        return;
    }
    if (props) {
        try {
            /*
             * ⚠️ Every nested component is created INSIDE its parent's `children` getter, never
             * hoisted into a variable. That is what JSX nesting compiles to, and the difference is
             * not cosmetic: built beforehand, the Frame is created OUTSIDE the Tooltip's context
             * and mounts twice, so two tooltips follow the cursor.
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
    setTooltip(trigger, fallbackText);
    parent.appendChild(trigger);
}
