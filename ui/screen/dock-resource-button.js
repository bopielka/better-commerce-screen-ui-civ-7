/**
 * The Resource Allocation button in the HUD dock: coloured when the screen is worth opening,
 * pulsing when there is actually something to place.
 *
 * The dock draws that button in the same grey as every other one whether or not anything is
 * waiting behind it, so the one screen this whole mod is about is the one thing on the HUD
 * that never asks to be looked at. Two signals, and they are deliberately different questions:
 *
 *   coloured   assignment is unlocked at all — the screen will let you do something
 *   pulsing    an unassigned resource of yours would actually be accepted somewhere
 *
 * The second is the useful one and is the reason this is worth doing here rather than
 * elsewhere: the count the game already prints on the button is how many resources are in the
 * pool, which is not the same as whether any of them can go anywhere. A pool full of resources
 * that every settlement would refuse still prints a number. `anythingCanBePlaced` is the test
 * `assign-notification.js` already had to build for exactly this distinction.
 *
 * ⚠️ Written to sit alongside beezany's **Ready or Not**, which colours the same button.
 * Nothing here assumes it is absent, and nothing fights it if it is present:
 *
 *   - `Controls.decorate` keeps a LIST of decorators (`addDecorator` in
 *     core/ui/component-support.js), so both mods decorate the dock and both run. Neither
 *     replaces the other.
 *   - The colouring rule below is Ready or Not's rule, to the same image at the same size,
 *     under a class of our own. With both mods on, both classes land on the button and set
 *     the same picture, so whichever wins the cascade the result is identical. With only this
 *     mod on, the button still colours.
 *   - The pulse is ours alone and touches nothing Ready or Not sets.
 *
 * ⚠️ THE DOCK IS OLD-FRAMEWORK, which is the only reason any of this is possible -
 * `Controls.decorate` does nothing to a `ui-next` component. See 03-platform-notes.md; the
 * same fact is what lets `assign-notification.js` patch `PanelAction`.
 */
import { anythingCanBePlaced } from './assign-notification.js';
import { isSomeoneElses } from '../engine/events.js';
import { ensureStyle } from '../support/dom.js';
import { log, warn } from '../support/diagnostics.js';

const STYLE_ID = 'najane-dock-resource-style';

/** On the button while the Resource Allocation screen is unlocked. */
const READY_CLASS = 'najane-dock-ready';
/** On the button while something in the pool would actually be accepted somewhere. */
const ASSIGNABLE_CLASS = 'najane-dock-assignable';

const STYLE = `
/*
 * ⚠️ The image, the offset and the size are Ready or Not's, copied deliberately rather than
 * chosen. Both mods may be installed and both may put their class on this button; matching
 * the values exactly is what makes "whichever rule wins" a question with one answer.
 */
.${READY_CLASS} .ssb__button-icon {
    top: -0.1111111111rem;
    left: 0;
    width: 3rem;
    height: 3rem;
    background-image: url("blp:ntf_discover_resource_blk");
}
/*
 * The pulse. Gentle on purpose: this sits in the corner of the eye for the whole game, and
 * the tutorial's own highlight - which scales to 1.6 and drops to 0.2 opacity - is built to
 * be impossible to ignore for the few seconds it is up. This has to be noticeable without
 * ever becoming something to tune out, so it breathes by a tenth of its size.
 *
 * ⚠️ BRIGHTNESS CARRIES IT; the scale is garnish. The shipped game animates transform and
 * opacity freely (tutorial-styles.css), but every one of those keyframes lives in a .css file
 * the engine loads - and this stylesheet is injected from JS at runtime, which is not the
 * same thing in this renderer. The only animated property PROVEN to work that way is
 * "filter: brightness", which Holistic QoL+ ships in a JS-injected keyframe of its own. That
 * is why the pulse was first written to move three properties at once: so it would still read
 * as a pulse if transform and opacity turned out to be inert here.
 *
 * ⚠️ AND THAT IS WHY THERE IS NO LONGER AN OPACITY STEP. Once brightness was confirmed
 * working the third property stopped being insurance and became an artefact: fading the icon
 * to 82% makes it translucent, and what shows through is the dark "hud_sub_circle_bk" disc
 * sitting behind it - so the icon's soft outer edge washes out first and reads as the frame
 * pulling away from the icon, a gap opening between the two. The scale cannot cause that: the
 * icon is 3rem inside a 3.5556rem ring, so growing it CLOSES the gap on every side (bottom
 * 0.333rem to 0.183rem, top 0.222rem to 0.072rem). Brightness and scale alone, both of which
 * only ever push the icon towards the ring.
 */
/*
 * ⚠️ THE RING SCALES TOO, and that is the whole point of this pair of rules.
 *
 * The button draws the badge in two layers, as SIBLINGS: "ssb__button-iconbg" is the circular
 * frame ("hud_sub_circle_bk") and "ssb__button-icon" is the artwork on top of it. The artwork
 * this mod swaps in - "ntf_discover_resource_blk" - carries a circle of its own, so scaling
 * only the top layer grows one circle inside a second one that stands still, and the two
 * visibly come apart at the peak. That is the "delamination" seen on a zoomed screenshot; it
 * is not blur or rounding, it is two rings at two sizes.
 *
 * Everything that makes up the badge therefore moves by the same factor, on the same clock,
 * so nothing can separate from anything else. Brightness stays on the artwork alone: the
 * frame flashing as well would read as the button lighting up rather than the icon breathing.
 *
 * ⚠️ "transform-origin" is spelled out rather than left to the default. The shipped UI writes
 * it out by hand in six places (tutorial-dialog, root-loading, notification-train); nobody
 * does that if the default can be relied on, and a scale taken about a corner walks the layer
 * sideways as it grows.
 */
.${ASSIGNABLE_CLASS} .ssb__button-icon,
.${ASSIGNABLE_CLASS} .ssb__button-iconbg {
    transform-origin: 50% 50%;
    animation-duration: 2.2s;
    animation-iteration-count: infinite;
    animation-fill-mode: forwards;
}
.${ASSIGNABLE_CLASS} .ssb__button-icon {
    animation-name: najaneDockAssignableIcon;
}
.${ASSIGNABLE_CLASS} .ssb__button-iconbg {
    animation-name: najaneDockAssignableRing;
}
@keyframes najaneDockAssignableIcon {
    0% {
        filter: brightness(1);
        transform: scale(1);
    }
    50% {
        filter: brightness(1.45);
        transform: scale(1.1);
    }
    100% {
        filter: brightness(1);
        transform: scale(1);
    }
}
/* ⚠️ Same numbers, same duration, started by the same class - so the two never drift apart. */
@keyframes najaneDockAssignableRing {
    0% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.1);
    }
    100% {
        transform: scale(1);
    }
}
`;

/** Where the resources button lives, for the pass that runs before the component hands it over. */
const RESOURCES_BUTTON_SELECTOR = '.resources';

/**
 * Events after which the answer can differ.
 *
 * The unlock state moves on settlements and trade routes (Ready or Not watches the same three
 * for the same reason); what can be PLACED moves on top of that whenever the pool or a
 * settlement's slots change.
 *
 * ⚠️ Every name here is one the shipped UI actually subscribes to - checked, because an
 * invented name does not fail, it simply never fires and leaves a stale button that looks
 * like a logic bug. `ResourceCapChanged` is the engine's spelling; there is no
 * "ResourceCapacityChanged" and no "ResourceAddedToPlayer".
 */
const REFRESH_EVENTS = [
    'CityInitialized',
    'TradeRouteAddedToMap',
    'TradeRouteRemovedFromMap',
    'TradeRouteChanged',
    'ResourceAssigned',
    'ResourceUnassigned',
    'ResourceCapChanged',
    'LocalPlayerTurnBegin',
];

function isUnlocked(player) {
    try {
        // ⚠️ The engine's spelling, not a typo of ours: `isRessourceAssignmentLocked`.
        return !(player?.Resources?.isRessourceAssignmentLocked?.() ?? true);
    } catch (error) {
        return false;
    }
}

class DockResourceButton {
    constructor(component) {
        this.component = component;
        this.Root = component.Root;
        this.refresh = this.refresh.bind(this);
        this.refreshSoon = this.refreshSoon.bind(this);
        this.refreshFrame = null;
        /*
         * ⚠️ Kept, because `listenForEngineEvent` remembers the function it was given and the
         * filter has to be that function - see `afterAttach`.
         */
        this.onLocalPlayerEvent = (data) => {
            if (isSomeoneElses(data)) {
                return;
            }
            this.refreshSoon();
        };
    }

    /** The dock's own button, or whatever is on screen if it has not published it yet. */
    button() {
        return this.component.resourcesButton
            ?? this.Root?.querySelector(RESOURCES_BUTTON_SELECTOR)
            ?? null;
    }

    /**
     * Coalesces a burst into one refresh, on the next frame.
     *
     * ⚠️ `anythingCanBePlaced` is the most expensive call in this mod, and the events below
     * arrive in clumps - a turn boundary raises several at once, and an assignment pass raises
     * one per resource. The 250ms answer cache covers a clump that lands together; this covers
     * the rest, and costs one frame on a button nothing is waiting for.
     */
    refreshSoon() {
        if (this.refreshFrame !== null) {
            return;
        }
        this.refreshFrame = requestAnimationFrame(() => {
            this.refreshFrame = null;
            this.refresh();
        });
    }

    refresh() {
        const button = this.button();
        if (!button) {
            return;
        }
        try {
            const player = Players.get(GameContext.localPlayerID);
            // No local player: autoplay, or between games. Leave the button alone rather
            // than deciding it is not ready - the same guard Ready or Not uses.
            if (!player) {
                return;
            }
            const unlocked = isUnlocked(player);
            button.classList.toggle(READY_CLASS, unlocked);
            const placeable = unlocked && anythingCanBePlaced();
            /*
             * ⚠️ Only while unlocked. A pulsing grey button would be inviting the player to
             * open a screen that cannot do anything for them yet, and `anythingCanBePlaced`
             * is the expensive call in this mod - not worth making for an answer that cannot
             * be acted on. It caches for 250ms, so the several events that arrive together
             * on a turn boundary still cost one pass.
             */
            button.classList.toggle(ASSIGNABLE_CLASS, placeable);
        } catch (error) {
            warn(`could not update the resources button on the dock: ${error}`);
        }
    }

    beforeAttach() { }

    afterAttach() {
        ensureStyle(STYLE_ID, STYLE);
        /*
         * ⚠️ Filtered by whose event it is. `ResourceAssigned` and friends are raised for EVERY
         * player - place.js says so where it refuses to wait on one - so an AI rearranging its
         * empire used to run this mod's single most expensive call, once per resource, all the
         * way through everybody else's turn, to decide whether YOUR button should pulse.
         * Payloads that name nobody are let through; see engine/events.js.
         */
        for (const name of REFRESH_EVENTS) {
            try {
                this.Root.listenForEngineEvent(name, this.onLocalPlayerEvent);
            } catch (error) {
                // An event this build does not raise is not worth a warning; the rest still
                // fire, and the button is refreshed on activation and turn begin regardless.
            }
        }
        /*
         * ⚠️ Also straight after a click. Assigning something is the one change that happens
         * behind the Commerce screen while the dock is not being told anything, so without
         * this the pulse can outlive the work it was asking for until the next event.
         */
        this.button()?.addEventListener('action-activate', this.refresh);
        this.refresh();
    }

    beforeDetach() { }

    afterDetach() {
        this.button()?.removeEventListener('action-activate', this.refresh);
        if (this.refreshFrame !== null) {
            cancelAnimationFrame(this.refreshFrame);
            this.refreshFrame = null;
        }
    }

    onAttributeChanged(_name, _prev, _next) { }
}

let started = false;

/**
 * ⚠️ Registered once, from the entry point. `Controls.decorate` appends to a list and never
 * de-duplicates, so calling this twice would build two decorators onto every dock.
 */
export function startDockResourceButton() {
    if (started) {
        return;
    }
    started = true;
    try {
        Controls.decorate('panel-sub-system-dock', (component) => new DockResourceButton(component));
        log('resource dock button decorated');
    } catch (error) {
        warn(`could not decorate the sub-system dock: ${error}`);
    }
}
