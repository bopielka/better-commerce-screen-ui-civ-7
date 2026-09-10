/**
 * A brief line at the top of the screen when a queued trade action has been carried out by
 * itself: the limit raised and a merchant sent.
 *
 * ⚠️ Driven by a window event, not by an import. `engine/trade-queue.js` is what knows it
 * happened, and engine may not import screen - the same one-way direction as
 * ./treasure-toast.js, which this is modelled on.
 *
 * ⚠️ Plain DOM on `document.body`, not a game notification. The engine's notification train is
 * for things the player must ACT on; this reports something already done, and putting it there
 * would make it another item to dismiss every turn.
 *
 * ⚠️ Coalesced into ONE PASS but not into one message: several leaders can come due on the same
 * turn, and a separate toast per leader would replace each other faster than any could be read.
 * They are gathered and then drawn as a stack of separate boxes - see `render`.
 */
import { QUEUE_STEP_MERCHANT, TradeQueueRanEventName } from '../engine/trade-queue.js';
import { log, warn } from '../support/diagnostics.js';

const TOAST_ID = 'najane-commerce-trade-queue-toast';
const VISIBLE_MS = 6000;
const FADE_MS = 400;
/** Long enough to gather one turn's worth, short enough to feel immediate. */
const GATHER_MS = 700;

const pending = [];
/**
 * ⚠️ `undefined`, NOT `null` - these are compared with `!== undefined` to mean "a timer is already
 * running". Initialised to null that test is true before the first timer has ever been set, and
 * the gather timer never starts. The same trap already paid for in ./treasure-toast.js.
 */
let gatherTimer;
let hideTimer;

/**
 * One sentence per thing that happened.
 *
 * ⚠️ NEVER A COUNT. The two steps are different news - "a merchant has set off" and "the limit has
 * risen" - so a line saying "3 things happened" would leave the player unable to tell which. Rare
 * enough that spelling each one out costs nothing.
 */
function lineFor(entry) {
    const key = entry.kind === QUEUE_STEP_MERCHANT
        ? 'LOC_NAJANE_COMMERCE_QUEUE_TOAST_SENT'
        : 'LOC_NAJANE_COMMERCE_QUEUE_TOAST_ONE';
    return Locale.compose(key, entry.leaderName, entry.cityName);
}

function compose() {
    try {
        return pending.map(lineFor);
    } catch (error) {
        warn(`could not compose the trade queue toast: ${error}`);
        return [];
    }
}

/**
 * ⚠️ ONE BOX PER PIECE OF NEWS (user's instruction, 2026-09-10), not one box with several
 * sentences in it. Two things that happened to two settlements read as one run-on paragraph when
 * they share a frame - and the line break meant to separate them does not survive: this renderer
 * does not honour `white-space: pre-line`, so the sentences simply ran together.
 *
 * The positioning stays on ONE container, so the stack is centred and torn down as a unit.
 */
const STACK_STYLE = [
    'position: absolute',
    'top: 12rem',
    'left: 50%',
    'transform: translateX(-50%)',
    'z-index: 200',
    'display: flex',
    'flex-direction: column',
    'align-items: center',
    'pointer-events: none',
].join('; ');

const BOX_STYLE = [
    'max-width: 60rem',
    'margin-bottom: 0.4rem',
    'padding: 0.7rem 1.6rem',
    'border: 0.08rem solid #b39e80',
    'border-radius: 0.2rem',
    'background: rgba(18, 22, 30, 0.94)',
    'color: #ffffff',
    'font-size: 1.05rem',
    'text-align: center',
].join('; ');

function render(lines) {
    if (!document.body || lines.length === 0) {
        return;
    }
    document.getElementById(TOAST_ID)?.remove();
    if (hideTimer !== undefined) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
    }

    const stack = document.createElement('div');
    stack.id = TOAST_ID;
    stack.setAttribute('style', `${STACK_STYLE}; transition: opacity ${FADE_MS}ms linear`);
    for (const line of lines) {
        const box = document.createElement('div');
        box.textContent = line;
        box.setAttribute('style', BOX_STYLE);
        stack.appendChild(box);
    }
    document.body.appendChild(stack);

    hideTimer = setTimeout(() => {
        hideTimer = undefined;
        stack.style.opacity = '0';
        setTimeout(() => stack.remove(), FADE_MS);
    }, VISIBLE_MS);
}

function onRan(event) {
    const detail = event?.detail;
    if (!detail) {
        return;
    }
    pending.push({
        kind: detail.kind,
        leaderName: detail.leaderName ?? '',
        cityName: detail.cityName ?? '',
    });
    if (gatherTimer !== undefined) {
        return;
    }
    gatherTimer = setTimeout(() => {
        gatherTimer = undefined;
        const lines = compose();
        pending.length = 0;
        render(lines);
        log(() => `trade queue toast: ${lines.length} line(s)`);
    }, GATHER_MS);
}

let listening = false;

export function startTradeQueueToast() {
    if (listening) {
        return;
    }
    listening = true;
    window.addEventListener(TradeQueueRanEventName, onRan);
}
