/**
 * One `MutationObserver` for the whole Commerce screen, instead of one per feature.
 *
 * ⚠️ It replaces four observers on `document.body` with `subtree: true`. The cost was not the
 * observers but what they watched: every unit flag, notification and yield banner in the HUD
 * woke four callbacks that then searched the Commerce screen for nothing. This is scoped to the
 * `screen-resource-allocation` element - `document.body` only until that exists, because the
 * content renders behind a ThrobberSuspense.
 *
 * ⚠️ One pass per FRAME, and the frame is a crash fix, not a nicety. A MutationObserver callback
 * is a microtask, and so is Solid's effect queue; writing to the DOM from inside one lands mid-
 * render and the next `reconcileArrays` throws `NotFoundError: insertBefore`. rAF runs after the
 * microtask queue has drained.
 *
 * ⚠️ `takeRecords()` after the pass is what stops the loop: every subscriber writes to the DOM
 * being watched, so each pass would queue the next. Safe because nothing can run between the
 * last subscriber returning and that call.
 */
import { isAssignmentInProgress } from '../planner/run.js';
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
        /*
         * ⚠️ NOT WHILE A BULK ASSIGNMENT IS RUNNING. `place.js` waits one frame per resource, so
         * a full empire is a hundred-odd frames and a full re-decoration of every settlement card
         * was landing in each of them, in front of the frame the loop was waiting on.
         *
         * Re-armed rather than dropped: `takeRecords` only runs from a pass, so the whole run's
         * mutations are still queued for the pass that follows it.
         */
        if (isAssignmentInProgress()) {
            schedulePass();
            return;
        }
        // The screen may have appeared since the last pass, in which case this stops
        // watching the whole HUD and narrows to it.
        retarget();
        runPass();
    });
}

/**
 * Points the observer at the screen once it exists. Called from every pass rather than once,
 * because `startX()` runs from a component's `onMount`, when the content is still a Suspense
 * placeholder.
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
 * Runs `callback` once per frame in which the screen's DOM changed.
 *
 * @returns a function that stops it. The observer is torn down when the last subscriber leaves,
 *          so a closed screen costs nothing.
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
