/**
 * Waiting for a queued player operation to actually land.
 *
 * `Game.PlayerOperations.sendRequest` only queues; the game state - and therefore the
 * answer `canStart` gives about the next operation - does not change until the engine
 * has processed it. Anything that chains operations has to wait in between.
 *
 * The timeout matters as much as the event: an operation the engine drops would
 * otherwise leave the sequence hanging forever.
 */
import { warn } from '../support/diagnostics.js';

const DEFAULT_TIMEOUT_FRAMES = 30;

export function waitForEngineEvent(eventName, timeoutFrames = DEFAULT_TIMEOUT_FRAMES) {
    return new Promise((resolve) => {
        let settled = false;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            try {
                engine.off(eventName, finish);
            } catch (error) {
                warn(`could not detach the ${eventName} listener: ${error}`);
            }
            resolve();
        };

        try {
            engine.on(eventName, finish);
        } catch (error) {
            warn(`could not listen for ${eventName}: ${error}`);
        }

        let frames = 0;
        const tick = () => {
            if (settled) {
                return;
            }
            if (++frames >= timeoutFrames) {
                finish();
                return;
            }
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
}
