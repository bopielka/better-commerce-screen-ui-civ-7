/**
 * Asking the game for an icon, without every caller writing the same try/catch. `UI.getIcon`
 * and `UI.getIconBLP` throw on a name the atlas does not carry, and a missing icon is a gap on
 * a card, not a reason to take a tab down.
 *
 * ⚠️ The two are NOT interchangeable: `getIcon` returns a URL for `url(...)`, `getIconBLP` a
 * bare BLP name needing `url(blp:...)`. Mixing them gives no error, just a blank square.
 */
import { warn } from '../support/diagnostics.js';
import { onGameDataStale } from '../support/game-data.js';

/**
 * ⚠️ `UI.getIcon` IS A LOOKUP, not a constant, and its answer cannot change while the game runs -
 * so it is asked once per name. Nothing here was memoised, and the callers are the hot ones: the
 * priority picker draws seven yield icons for its "Balanced" cluster and another fifteen for its
 * menu, per settlement card, every time Solid rebuilds the cards.
 *
 * ⚠️ A FAILED lookup is remembered as null too, or the names the atlas does not carry are the
 * ones asked about forever.
 */
const iconByName = new Map();

/** @returns a URL ready to go inside `url(...)`, or null. */
export function gameIcon(name, context = null) {
    if (!name) {
        return null;
    }
    const key = context ? `${name}|${context}` : name;
    const cached = iconByName.get(key);
    if (cached !== undefined) {
        return cached;
    }
    let icon = null;
    try {
        icon = (context ? UI.getIcon(name, context) : UI.getIcon(name)) ?? null;
    } catch (error) {
        icon = null;
    }
    iconByName.set(key, icon);
    return icon;
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
const classBackgroundByType = new Map();

// Both maps describe the age's own resources and its atlas; see support/game-data.js.
onGameDataStale(() => {
    iconByName.clear();
    classBackgroundByType.clear();
});

export function resourceClassBackground(resourceType) {
    // ⚠️ Two lookups deep - the resource table and then the atlas - and it is asked once per
    // resource tile drawn on the Empire, Factory and Treasure tabs. Neither answer can change.
    const cached = classBackgroundByType.get(resourceType);
    if (cached !== undefined) {
        return cached;
    }
    let background = null;
    try {
        const classType = GameInfo.Resources.lookup(resourceType)?.ResourceClassType;
        const blp = classType && UI.getIconBLP(classType);
        background = blp ? `url(blp:${blp})` : null;
    } catch (error) {
        warn(`could not read the class of ${resourceType}: ${error}`);
    }
    classBackgroundByType.set(resourceType, background);
    return background;
}
