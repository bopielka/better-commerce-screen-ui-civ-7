/**
 * One `MutationObserver` for the whole Commerce screen, instead of one per feature.
 *
 * ⚠️ FOUR OBSERVERS ON `document.body` WITH `subtree: true` IS WHAT THIS REPLACES, and the
 * cost was not the observers - it was what they were watching. `document.body` is the whole
 * HUD: unit flags, the notification train, the turn timer, every tooltip that opens and
 * closes, every yield banner the engine repaints. None of that is on the Commerce screen,
 * and all of it woke four separate callbacks that then ran `querySelectorAll` over the
 * screen to conclude nothing had changed.
 *
 * Two things fix that, and they are both here rather than in each feature:
 *
 *   1. **Scope.** The target is the `screen-resource-allocation` element, which is where
 *      every one of this mod's injections lives. Mutations elsewhere in the HUD are not
 *      delivered at all - the observer never sees them. `document.body` is used only until
 *      that element exists, because the screen's content renders behind a `ThrobberSuspense`
 *      and the first pass can arrive before there is anything to attach to.
 *
 *   2. **One pass per frame.** Solid rebuilds a card as a burst of mutations; every
 *      subscriber used to run once per mutation. They now run once per FRAME, together.
 *
 * ⚠️ The frame is not a nicety, it is the fix for a crash - see the note on `scheduleDecorate`
 * in trade-routes.js. A `MutationObserver` callback is a microtask and so is Solid's effect
 * queue; touching the DOM from inside the callback lands in the middle of a render Solid has
 * begun and not finished, and its next `reconcileArrays` throws `NotFoundError: Failed to
 * execute 'insertBefore'`. `requestAnimationFrame` runs after the microtask queue has
 * drained. Every subscriber gets that guarantee now, not only the one that paid for it.
 *
 * ⚠️ `takeRecords()` after the pass is what stops the loop. Every subscriber writes to the
 * DOM the observer is watching, so each pass queues the records for the next one - the
 * observers this replaces all ran twice for every real change, and only settled because each
 * feature was careful to write nothing on the second pass. Discarding the records the pass
 * itself produced is safe and not a race: nothing else can run between the last subscriber
 * returning and the call below, so any DOM state those records describe is state the pass has
 * already seen.
 */
import { warn } from '../support/diagnostics.js';
import { COMMERCE_SCREEN_SELECTOR } from './screen-parts.js';


const subscribers = new Set();

let observer = null;
let observedTarget = null;
let frame = null;

function screenRoot() {
    return document.querySelector(COMMERCE_SCREEN_SELECTOR);
}

function runPass() {
    for (const subscriber of Array.from(subscribers)) {
        try {
            subscriber();
        } catch (error) {
            warn(`a Commerce screen pass failed: ${error}`);
        }
    }
    // Whatever the pass itself disturbed is state the pass has already read; see the header.
    observer?.takeRecords();
}

function schedulePass() {
    if (frame !== null) {
        return;
    }
    frame = requestAnimationFrame(() => {
        frame = null;
        // The screen may have appeared since the last pass, in which case this stops
        // watching the whole HUD and narrows to it.
        retarget();
        runPass();
    });
}

/**
 * Points the observer at the screen once it exists.
 *
 * Called from every pass rather than once, because `startX()` runs from a component's
 * `onMount` and the screen's content is still a Suspense placeholder at that moment.
 */
function retarget() {
    if (!observer) {
        return;
    }
    const target = screenRoot() ?? document.body;
    if (target === observedTarget) {
        return;
    }
    observer.disconnect();
    observedTarget = target;
    observer.observe(target, { childList: true, subtree: true });
}

/**
 * Runs `callback` once per frame in which the Commerce screen's DOM changed, and once now.
 *
 * @returns a function that stops it. The observer itself is torn down when the last
 *          subscriber leaves, so a closed screen costs nothing at all.
 */
export function watchCommerceScreen(callback) {
    subscribers.add(callback);
    if (!observer) {
        observer = new MutationObserver(schedulePass);
        observedTarget = screenRoot() ?? document.body;
        observer.observe(observedTarget, { childList: true, subtree: true });
    }
    return () => unwatchCommerceScreen(callback);
}

function unwatchCommerceScreen(callback) {
    subscribers.delete(callback);
    if (subscribers.size > 0) {
        return;
    }
    observer?.disconnect();
    observer = null;
    observedTarget = null;
    if (frame !== null) {
        cancelAnimationFrame(frame);
        frame = null;
    }
}
