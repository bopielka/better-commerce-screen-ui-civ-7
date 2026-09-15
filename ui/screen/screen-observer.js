/**
 * One `MutationObserver` for the whole Commerce screen, instead of one per feature.
 *
 * ⚠️ Scoped to `screen-resource-allocation`, falling back to `document.body` only until that
 * exists (the content renders behind a ThrobberSuspense). The cost of the four body-wide
 * observers this replaced was not the observers but what they watched: every unit flag,
 * notification and yield banner in the HUD woke all four.
 *
 * ⚠️ One pass per FRAME, and the frame is a CRASH FIX. A MutationObserver callback is a microtask
 * and so is Solid's effect queue, so writing to the DOM from inside one lands mid-render and the
 * next `reconcileArrays` throws `NotFoundError: insertBefore`. rAF runs after the queue drains.
 *
 * ⚠️ `takeRecords()` after the pass is what stops the loop: every subscriber writes to the DOM
 * being watched, so each pass would queue the next.
 *
 * Also hands the pass's subscribers ONE settlement card list; see `settlementCardsOnScreen`.
 */
import { settlementCards } from '../model/screen-model.js';
import { isAssignmentInProgress } from '../planner/run.js';
import { warn } from '../support/diagnostics.js';
import { COMMERCE_SCREEN_SELECTOR } from './screen-parts.js';

const subscribers = new Set();

let observer = null;
let observedTarget = null;
let frame = null;

/**
 * The card list of the pass in progress, or null outside one.
 * ⚠️ Lives only while `runPass` runs, and is safe only because no subscriber adds or removes a
 * card or writes to the model. One that does must not use it.
 */
let passCards = null;
let inPass = false;

function screenRoot() {
    return document.querySelector(COMMERCE_SCREEN_SELECTOR);
}

/**
 * `settlementCards()`, looked for inside the screen, and taken once per pass.
 * ⚠️ Two subscribers (settlement controls, padlocks) each ran a document-wide attribute-suffix
 * query for the same list on every pass.
 */
export function settlementCardsOnScreen() {
    if (!inPass) {
        return settlementCards(screenRoot() ?? document);
    }
    // `retarget` has just resolved the screen for this pass.
    passCards ??= settlementCards(observedTarget ?? document);
    return passCards;
}

function runPass() {
    inPass = true;
    try {
        for (const subscriber of Array.from(subscribers)) {
            try {
                subscriber();
            } catch (error) {
                warn(`a Commerce screen pass failed: ${error}`);
            }
        }
    } finally {
        inPass = false;
        passCards = null;
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
    } else if ((screenRoot() ?? document.body) !== observedTarget) {
        /*
         * ⚠️ Joining an observer still pointed at an OLD screen: a detached tree never mutates, so
         * no pass would ever retarget it and every feature on the new screen went quiet. Records
         * the move would drop become a pass instead.
         */
        const pending = observer.takeRecords();
        retarget();
        if (pending.length > 0) {
            schedulePass();
        }
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
