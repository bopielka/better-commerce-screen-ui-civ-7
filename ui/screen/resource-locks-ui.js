/**
 * The padlock in the corner of a slotted resource. The lock itself is engine/resource-locks.js.
 * ⚠️ Re-injected from the shared screen watcher rather than placed once: the tiles are Solid's.
 */
import { getCommerceModel, settlementCards } from '../model/screen-model.js';
import {
    ResourceLocksChangedEventName,
    isResourceLocked,
    isResourceLockingAllowed,
    toggleResourceLock,
} from '../engine/resource-locks.js';
import { bindActivatable, ensureStyle, makeElement, setTooltip } from '../support/dom.js';
import { watchCommerceScreen } from './screen-observer.js';
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

let unwatch = null;
let injecting = false;
let styleElement = null;

/**
 * The four strings a padlock can carry, composed once.
 *
 * ⚠️ `Locale.compose` is a call into the game, and `paint` runs for EVERY padlock on EVERY pass
 * over the screen - one per assigned resource in the empire, so a hundred and twenty of them a
 * frame, for four strings that cannot change while the game runs.
 */
const wording = new Map();

function composed(key) {
    let text = wording.get(key);
    if (text === undefined) {
        text = Locale.compose(key);
        wording.set(key, text);
    }
    return text;
}

function paint(lock, cityID, resourceValue) {
    const locked = isResourceLocked(cityID, resourceValue);
    /*
     * ⚠️ Nothing is written when nothing changed. Both attributes below are DOM mutations inside
     * the element the screen watcher is watching, so repainting a padlock that already reads
     * correctly is a write per padlock per frame for no visible difference.
     */
    if (lock.dataset.najaneLocked === String(locked)) {
        return;
    }
    lock.dataset.najaneLocked = String(locked);
    lock.classList.toggle(LOCKED_CLASS, locked);
    setTooltip(
        lock,
        composed(locked
            ? 'LOC_NAJANE_COMMERCE_RESOURCE_UNLOCK_TOOLTIP'
            : 'LOC_NAJANE_COMMERCE_RESOURCE_LOCK_TOOLTIP'),
    );
    lock.setAttribute(
        'aria-label',
        composed(locked
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
    // A tile past the end of the model's list is an EMPTY slot: nothing to lock.
                slot.querySelector(`.${LOCK_CLASS}`)?.remove();
                slot.classList.remove(SLOT_CLASS);
                return;
            }

            slot.classList.add(SLOT_CLASS);
            const key = `${settlement.cityID?.id}:${resource.resourceValue}`;
            const existing = slot.querySelector(`.${LOCK_CLASS}`);
            if (existing) {
        // ⚠️ Only reused when it still belongs to the same resource - the slots are recycled.
                if (existing.dataset.najaneLockKey === key) {
                    paint(existing, settlement.cityID, resource.resourceValue);
                    return;
                }
                existing.remove();
            }

            const lock = makeElement('div', LOCK_CLASS);
    // ⚠️ Marks this as OURS for the screen's hit-testing, and it is not optional: a hit test that
    // returned the padlock instead of the resource under it broke Shift-click on locked tiles.
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
        // ⚠️ Switched off means GONE, not inert: a padlock still drawn but doing nothing is worse
        // than either state.
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
    if (unwatch) {
        return;
    }
    styleElement = ensureStyle(STYLE_ID, STYLE);
    // ⚠️ The options menu opens OVER this screen, so turning the option off has to take the
    // padlocks away there and then - no DOM mutation of the game's own would announce it.
    window.addEventListener(ResourceLocksChangedEventName, inject);
    inject();
    // One observer for the whole screen, batched to a frame; see screen-observer.js.
    unwatch = watchCommerceScreen(inject);
}

    // ⚠️ The padlocks go, the LOCKS STAY: the player's choices belong to the session, not to the
    // screen being open.
export function stopResourceLocks() {
    unwatch?.();
    unwatch = null;
    window.removeEventListener(ResourceLocksChangedEventName, inject);
    removeAllLocks();
    styleElement?.remove();
    styleElement = null;
}
