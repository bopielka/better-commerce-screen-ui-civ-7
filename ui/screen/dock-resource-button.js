/**
 * The Resource Allocation button in the HUD dock: coloured when the screen is worth opening,
 * pulsing when there is actually something to place.
 *
 * Two deliberately different questions - coloured means assignment is unlocked at all, pulsing
 * means an unassigned resource would actually be ACCEPTED somewhere. The second is the useful
 * one: the count the game prints is how many are in the pool, which is not the same thing.
 *
 * ⚠️ Written to sit alongside beezany's **Ready or Not**, which colours the same button.
 * `Controls.decorate` keeps a LIST of decorators, so both run and neither replaces the other; the
 * colouring rule here is Ready or Not's rule under a class of our own, so whichever wins the
 * cascade the result is identical. The pulse is ours alone.
 *
 * ⚠️ THE DOCK IS OLD-FRAMEWORK, which is the only reason any of this is possible -
 * `Controls.decorate` does nothing to a `ui-next` component.
 */
import { anythingCanBePlaced } from './assign-notification.js';
import { onEngineEvents, stopEngineEvents } from '../engine/events.js';
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

/** Events after which the answer can differ. */
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
        /** The shared-dispatcher handles, kept so `afterDetach` can hand them back. */
        this.subscriptions = [];
    }

    /** The dock's own button, or whatever is on screen if it has not published it yet. */
    button() {
        return this.component.resourcesButton
            ?? this.Root?.querySelector(RESOURCES_BUTTON_SELECTOR)
            ?? null;
    }

/**
 * Coalesces a burst into one refresh, on the next frame. ⚠️ `anythingCanBePlaced` is the most
 * expensive call in this mod and these events arrive in clumps - a turn boundary raises several
 * at once, an assignment pass one per resource.
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
        // ⚠️ Only while unlocked: a pulsing grey button would invite the player to open a screen
        // that will not let them do anything.
            button.classList.toggle(ASSIGNABLE_CLASS, placeable);
        } catch (error) {
            warn(`could not update the resources button on the dock: ${error}`);
        }
    }

    beforeAttach() { }

    afterAttach() {
        ensureStyle(STYLE_ID, STYLE);
        /*
         * ⚠️ Filtered by whose event it is - `ResourceAssigned` is raised for EVERY player, so an
         * AI rearranging its empire used to run this mod's most expensive call once per resource.
         * ⚠️ Through this mod's own dispatcher rather than `Root.listenForEngineEvent`, which would
         * be a SECOND `engine.on` for names three other modules already listen for; `afterDetach`
         * does the cleanup the component's version would have done.
         */
        // Attach without a matching detach is not something to rely on being impossible; the
        // leak it would otherwise leave is the one fixed in assign-all-buttons.js.
        stopEngineEvents(this.subscriptions);
        this.subscriptions = onEngineEvents(REFRESH_EVENTS, this.refreshSoon);
        // ⚠️ Also straight after a click: assigning is the one change that happens behind the
        // Commerce screen while the dock is told nothing.
        this.button()?.addEventListener('action-activate', this.refresh);
        this.refresh();
    }

    beforeDetach() { }

    afterDetach() {
        this.button()?.removeEventListener('action-activate', this.refresh);
        stopEngineEvents(this.subscriptions);
        if (this.refreshFrame !== null) {
            cancelAnimationFrame(this.refreshFrame);
            this.refreshFrame = null;
        }
    }

    onAttributeChanged(_name, _prev, _next) { }
}

let started = false;

// ⚠️ Registered once: `Controls.decorate` appends to a list and never de-duplicates.
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
