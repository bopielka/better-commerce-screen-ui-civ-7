/**
 * Waiting for a queued player operation to actually land.
 *
 * `sendRequest` only QUEUES; the state - and the answer `canStart` gives about the next
 * operation - does not change until the engine has processed it.
 *
 * ⚠️ The timeout is WALL-CLOCK and used to be counted in frames. Thirty frames is half a second
 * at sixty, three at ten, and never if the frame loop is not running - which is where these are
 * chained: one per settlement from the automatic pass at LocalPlayerTurnBegin, between turns.
 */
import { onLocalPlayerEvent, stopEngineEvents } from './events.js';

/** Half a second: what 30 frames was meant to be before the framerate got a say. */
const DEFAULT_TIMEOUT_MS = 500;

export function waitForEngineEvent(eventName, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let settled = false;
        let timer = null;
        const handles = [];

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            stopEngineEvents(handles);
            resolve();
        };

        /*
         * Shared dispatcher, so a chain of these does not churn a subscription on a name four
         * other modules already listen for.
         *
         * ⚠️ AND FILTERED BY WHOSE EVENT IT IS. Unfiltered, an AI unassigning something on the far
         * side of the map released the wait early - the same trap `awaitAssignment` in place.js
         * avoids by asking the settlement instead. An UNKNOWN owner still counts as ours, so the
         * worst this can do is behave as it did before.
         */
        const handle = onLocalPlayerEvent(eventName, finish);
        if (handle) {
            handles.push(handle);
        }

        timer = setTimeout(finish, timeoutMs);
    });
}
