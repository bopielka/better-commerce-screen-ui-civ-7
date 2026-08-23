/**
 * Asking the game for an icon, without every caller writing the same try/catch.
 *
 * `UI.getIcon` and `UI.getIconBLP` throw on a name the atlas does not carry, and a throw here
 * is never worth taking a tab down for - an icon that will not load is a gap on a card, not a
 * failure. Every caller had therefore grown the same wrapper, and `yieldIcon` in particular
 * was byte-for-byte identical in two of them.
 *
 * ⚠️ The two calls are NOT interchangeable, which is the part worth writing down.
 * `getIcon` hands back a URL ready for `url(...)`; `getIconBLP` hands back a bare BLP name
 * that has to be wrapped as `url(blp:...)`. Mixing them up produces no error, just a blank
 * square, and it has been done at least once here.
 */
import { warn } from '../support/diagnostics.js';

/** @returns a URL ready to go inside `url(...)`, or null. */
export function gameIcon(name, context = null) {
    if (!name) {
        return null;
    }
    try {
        return (context ? UI.getIcon(name, context) : UI.getIcon(name)) ?? null;
    } catch (error) {
        return null;
    }
}

/** The icon for a yield - Food, Production, Gold and friends. */
export function yieldIcon(yieldType) {
    return gameIcon(yieldType, 'YIELD');
}

/** The icon for a resource. */
export function resourceIcon(resourceType) {
    return gameIcon(resourceType, 'RESOURCE');
}

/** `background-image` for an icon, or an empty string so a stylesheet's own value stands. */
export function iconBackground(name, context = null) {
    const icon = gameIcon(name, context);
    return icon ? `url(${icon})` : '';
}

/**
 * `background-image` for the little class mark the game puts on a resource tile - the one
 * that says "empire", "treasure" or "factory".
 *
 * ⚠️ Read from the RESOURCE's own class, never from the tab it is being drawn on: the same
 * resource is an empire resource in one age and a treasure one in the next, and there is a
 * third class for treasure coming from distant lands.
 *
 * @returns a `url(blp:...)` string, or null when the resource has no class icon.
 */
export function resourceClassBackground(resourceType) {
    try {
        const classType = GameInfo.Resources.lookup(resourceType)?.ResourceClassType;
        const blp = classType && UI.getIconBLP(classType);
        return blp ? `url(blp:${blp})` : null;
    } catch (error) {
        warn(`could not read the class of ${resourceType}: ${error}`);
        return null;
    }
}
