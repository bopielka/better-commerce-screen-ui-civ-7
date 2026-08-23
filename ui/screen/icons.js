/**
 * Asking the game for an icon, without every caller writing the same try/catch. `UI.getIcon`
 * and `UI.getIconBLP` throw on a name the atlas does not carry, and a missing icon is a gap on
 * a card, not a reason to take a tab down.
 *
 * ⚠️ The two are NOT interchangeable: `getIcon` returns a URL for `url(...)`, `getIconBLP` a
 * bare BLP name needing `url(blp:...)`. Mixing them gives no error, just a blank square.
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

/** The icon for a yield. */
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
 * `background-image` for the class mark on a resource tile ("empire", "treasure", "factory").
 *
 * ⚠️ Read from the RESOURCE's own class, never from the tab it is drawn on: the same resource
 * is an empire resource in one age and a treasure one in the next.
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
