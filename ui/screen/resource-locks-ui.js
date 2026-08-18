/**
 * The padlock in the corner of a slotted resource.
 *
 * Click it and that resource stays where it is through "Unassign all" and "Reassign all".
 * What the lock means and where it is kept are in engine/resource-locks.js; this module is
 * only the control.
 *
 * ⚠️ The look and the placement are **Resource+**'s (`br4d-resource-lock`), on purpose - the
 * game's own `blp:icon_lock`, small, top-right of the tile, dim until locked. A player who
 * has used that mod should recognise this one without being told, and two mods drawing the
 * same idea two different ways is worse than either.
 *
 * ⚠️ Re-injected from a `MutationObserver` rather than placed once, the same as
 * settlement-controls.js: the cards are Solid's and a redraw takes anything of ours with it.
 */
import { getCommerceModel, settlementCards } from '../model/screen-model.js';
import {
    ResourceLocksChangedEventName,
    isResourceLocked,
    isResourceLockingAllowed,
    toggleResourceLock,
} from '../engine/resource-locks.js';
import { bindActivatable, ensureStyle, makeElement } from '../support/dom.js';
import { warn } from '../support/diagnostics.js';

const LOCK_CLASS = 'najane-resource-lock';
const LOCKED_CLASS = `${LOCK_CLASS}--on`;
/** On the tile itself, so the padlock has something to be positioned against. */
const SLOT_CLASS = 'najane-lock-slot';
const STYLE_ID = 'najane-resource-locks-style';

/** One `.size-19` per resource, in model order - the same assumption hover-highlight makes. */
const SLOT_SELECTOR = '.size-19';

const STYLE = `
.${SLOT_CLASS} { position: relative; }
.${LOCK_CLASS} {
    position: absolute;
    top: -0.3rem;
    right: -0.3rem;
    /*
     * Above the tile and its hover enlargement. The game scales a hovered resource to 1.25
     * (see hover-highlight.js), which would otherwise ride over the padlock.
     */
    z-index: 60;
    box-sizing: border-box;
    width: 1.35rem;
    height: 1.35rem;
    border: 0.08rem solid #746a58;
    border-radius: 50%;
    background-color: rgba(18, 23, 33, 0.94);
    background-image: url("blp:icon_lock");
    background-position: center;
    background-repeat: no-repeat;
    background-size: 0.82rem 0.82rem;
    /*
     * Faint until it means something. One of these sits on every assigned resource in the
     * empire, so at full strength they would read as a row of buttons rather than as a mark
     * on the handful the player has actually pinned.
     */
    opacity: 0.45;
    /* The tile underneath is draggable; without this the click never reaches us. */
    pointer-events: auto;
}
.${LOCK_CLASS}:hover { opacity: 0.85; }
.${LOCK_CLASS}.${LOCKED_CLASS} {
    border-color: #e5d2ac;
    background-color: rgba(92, 75, 44, 0.98);
    opacity: 1;
}
.${LOCK_CLASS}:focus {
    outline: 0.12rem solid #e5d2ac;
    outline-offset: 0.08rem;
}
`;

let observer = null;
let injecting = false;
let styleElement = null;

function paint(lock, cityID, resourceValue) {
    const locked = isResourceLocked(cityID, resourceValue);
    lock.classList.toggle(LOCKED_CLASS, locked);
    lock.setAttribute(
        'data-tooltip-content',
        Locale.compose(locked
            ? 'LOC_NAJANE_COMMERCE_RESOURCE_UNLOCK_TOOLTIP'
            : 'LOC_NAJANE_COMMERCE_RESOURCE_LOCK_TOOLTIP'),
    );
    lock.setAttribute(
        'aria-label',
        Locale.compose(locked
            ? 'LOC_NAJANE_COMMERCE_RESOURCE_UNLOCK'
            : 'LOC_NAJANE_COMMERCE_RESOURCE_LOCK'),
    );
}

/** Takes every padlock off the screen without touching what is locked. */
function removeAllLocks() {
    document.querySelectorAll(`.${LOCK_CLASS}`).forEach((lock) => lock.remove());
    document.querySelectorAll(`.${SLOT_CLASS}`).forEach((slot) => slot.classList.remove(SLOT_CLASS));
}

function injectOnce() {
    for (const { settlement, cardElement } of settlementCards()) {
        const slots = cardElement.querySelectorAll(SLOT_SELECTOR);
        const resources = settlement.slottedResources ?? [];

        slots.forEach((slot, index) => {
            const resource = resources[index];
            if (!resource) {
                /*
                 * A tile past the end of the model's list is an EMPTY slot. It carries no
                 * resource to lock, and one left over from a resource that has just been
                 * removed would otherwise keep a padlock pointing at nothing.
                 */
                slot.querySelector(`.${LOCK_CLASS}`)?.remove();
                slot.classList.remove(SLOT_CLASS);
                return;
            }

            slot.classList.add(SLOT_CLASS);
            const key = `${settlement.cityID?.id}:${resource.resourceValue}`;
            const existing = slot.querySelector(`.${LOCK_CLASS}`);
            if (existing) {
                // ⚠️ Only reused when it still belongs to the same resource. The slots are
                // positional, so a removal shuffles every resource after it up by one and a
                // padlock left in place would then be wired to its neighbour's lock.
                if (existing.dataset.najaneLockKey === key) {
                    paint(existing, settlement.cityID, resource.resourceValue);
                    return;
                }
                existing.remove();
            }

            const lock = makeElement('div', LOCK_CLASS);
            /*
             * ⚠️ Marks this as OURS for the screen's own hit-testing, and it is not optional.
             * The padlock overhangs its tile, and the hit-test climbs the DOM - so without
             * this, a click in the gap beside a resource answered as a click ON that resource
             * and shift-clicking a card to fill it selected instead of assigning. See
             * `hitTestElements` in model/screen-model.js.
             */
            lock.setAttribute('data-najane-overlay', 'true');
            lock.dataset.najaneLockKey = key;
            paint(lock, settlement.cityID, resource.resourceValue);
            bindActivatable(lock, () => {
                toggleResourceLock(settlement.cityID, resource.resourceValue);
                paint(lock, settlement.cityID, resource.resourceValue);
            });
            slot.appendChild(lock);
        });
    }
}

function inject() {
    // Our own appendChild is a childList mutation and would call this again.
    if (injecting || !getCommerceModel()) {
        return;
    }
    injecting = true;
    try {
        /*
         * ⚠️ Switched off means GONE, not merely inert. The option is offered so a player who
         * does not want this can have the screen they had before, and a padlock that is still
         * drawn but does nothing is worse than either state.
         */
        if (!isResourceLockingAllowed()) {
            removeAllLocks();
            return;
        }
        injectOnce();
    } catch (error) {
        warn(`injecting resource locks failed: ${error}`);
    } finally {
        injecting = false;
    }
}

export function startResourceLocks() {
    if (observer) {
        return;
    }
    styleElement = ensureStyle(STYLE_ID, STYLE);
    /*
     * ⚠️ The option can be changed with this screen open - the options menu opens over it -
     * and turning it off has to take the padlocks away there and then, which no DOM mutation
     * of the game's own would otherwise announce.
     */
    window.addEventListener(ResourceLocksChangedEventName, inject);
    inject();
    // childList only, so re-adding our own elements' classes cannot retrigger this.
    observer = new MutationObserver(inject);
    observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * ⚠️ The padlocks go, the LOCKS STAY. The player's choices belong to the session, not to the
 * screen being open - leaving the tab and coming back must not quietly unpin everything.
 */
export function stopResourceLocks() {
    observer?.disconnect();
    observer = null;
    window.removeEventListener(ResourceLocksChangedEventName, inject);
    removeAllLocks();
    styleElement?.remove();
    styleElement = null;
}
