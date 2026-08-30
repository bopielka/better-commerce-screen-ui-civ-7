/**
 * A brief line at the top of the screen when a Treasure Convoy unloads itself.
 *
 * ⚠️ Driven by a window event, not by an import. `engine/treasure-convoys.js` is what knows a
 * convoy unloaded, and engine may not import screen - so it announces and this listens. Same
 * one-way direction as a setting and the checkbox that draws it.
 *
 * ⚠️ COALESCED, and that is the point rather than a nicety: every convoy already standing in the
 * homeland unloads in the same instant at the start of a turn, so one toast per convoy would be a
 * stack of them replacing each other faster than any of them could be read.
 *
 * ⚠️ Plain DOM on `document.body`, not a game notification. The engine's notification train is for
 * things the player must act on; this reports something that already happened, and putting it
 * there would make it another item to dismiss every turn.
 */
import { TreasureConvoyUnloadedEventName } from '../engine/treasure-convoys.js';
import { log, warn } from '../support/diagnostics.js';

const TOAST_ID = 'najane-commerce-treasure-toast';
const VISIBLE_MS = 5000;
const FADE_MS = 400;
/** ⚠️ Long enough to gather one turn's worth of unloads, short enough to feel immediate. */
const GATHER_MS = 700;

const pending = [];
/**
 * ⚠️ `undefined`, NOT `null`. These are compared with `!== undefined` to mean "a timer is already
 * running"; initialised to `null` that test is true before the first timer has ever been set, so
 * the gather timer never starts and the toast cannot appear once.
 */
let gatherTimer;
let hideTimer;

function total(field) {
    return pending.reduce((sum, entry) => sum + entry[field], 0);
}

function compose() {
    try {
        return pending.length === 1
            ? Locale.compose('LOC_NAJANE_COMMERCE_TREASURE_TOAST_ONE', total('gdp'), total('gold'))
            : Locale.compose(
                'LOC_NAJANE_COMMERCE_TREASURE_TOAST_MANY',
                pending.length,
                total('gdp'),
                total('gold'),
            );
    } catch (error) {
        warn(`could not compose the treasure convoy toast: ${error}`);
        return '';
    }
}

function render(text) {
    if (!document.body || !text) {
        return;
    }
    document.getElementById(TOAST_ID)?.remove();
    if (hideTimer !== undefined) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
    }

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.classList.add('font-body', 'text-sm', 'text-accent-1');
    // ⚠️ Inline, not a stylesheet rule: one element that exists for five seconds is not worth a
    // class in a sheet every card on the Commerce screen also has to be matched against.
    toast.style.cssText = [
        'position:fixed',
        /*
         * ⚠️ BELOW the two other fixed strips this player may have: Repair Shop+'s repair summary
         * sits at 5.5rem and Better City UI's citizen toast at 9rem. All three are centred at the
         * top with the same z-index and all three fire at the start of a turn, so at a shared
         * offset the later one simply covers the earlier.
         */
        'top:12.5rem',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:9999',
        'pointer-events:none',
        'padding:0.4rem 0.9rem',
        'background:rgba(5, 8, 18, 0.82)',
        'border:1px solid rgba(225, 197, 125, 0.75)',
        'box-shadow:0 0 1rem rgba(0, 0, 0, 0.65)',
        `transition:opacity ${FADE_MS}ms ease`,
        'opacity:0',
    ].join(';');
    /*
     * ⚠️ `Locale.stylize` into innerHTML, not textContent: the message carries [icon:ECONOMIC_VP]
     * and [icon:YIELD_GOLD], which are markup rather than characters and reach the screen as
     * literal square brackets without it.
     */
    try {
        toast.innerHTML = Locale.stylize(text);
    } catch (error) {
        toast.textContent = text;
    }
    document.body.appendChild(toast);

    // ⚠️ Two frames before the fade in. Setting opacity in the same frame the element is added
    // skips the transition entirely - the browser has nothing to animate from.
    requestAnimationFrame(() => requestAnimationFrame(() => {
        toast.style.opacity = '1';
    }));

    hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), FADE_MS);
    }, VISIBLE_MS);
}

function announce(detail) {
    try {
        pending.push({
            gdp: Number(detail?.gdp) || 0,
            gold: Number(detail?.gold) || 0,
        });
        if (gatherTimer !== undefined) {
            return;
        }
        gatherTimer = setTimeout(() => {
            gatherTimer = undefined;
            const text = compose();
            log(`treasure unload announced: ${pending.length} convoy(s) - "${text}"`);
            pending.length = 0;
            render(text);
        }, GATHER_MS);
    } catch (error) {
        warn(`could not announce a treasure convoy unloading: ${error}`);
    }
}

let started = false;

/** Installs the listener, from the entry point: a convoy unloads with the screen closed. */
export function startTreasureToast() {
    if (started) {
        return;
    }
    started = true;
    window.addEventListener(TreasureConvoyUnloadedEventName, (event) => announce(event?.detail));
    log('treasure convoy unload toast installed');
}
