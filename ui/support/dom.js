/**
 * Making an injected element clickable.
 *
 * The screen's own `Activatable` reacts to the engine's `mousebutton-left` action, which
 * a plain injected div never receives. Native DOM events do arrive, so buttons this mod
 * adds are wired to those instead - and their events are stopped, or the settlement card
 * underneath would treat the click as "assign the selected resource here".
 *
 * Same approach as Resource+, which is how its buttons work.
 */
const REPEAT_GUARD_MS = 150;

export function bindActivatable(element, activate) {
    if (!element.getAttribute('role')) {
        element.setAttribute('role', 'button');
    }
    if (!element.hasAttribute('tabindex')) {
        element.setAttribute('tabindex', '0');
    }
    element.setAttribute('data-activatable', 'true');

    let lastActivation = 0;
    const run = (event) => {
        event.stopPropagation();
        const now = Date.now();
        // A click can arrive twice (mouse and touch); the second one is not a second press.
        if (now - lastActivation < REPEAT_GUARD_MS) {
            event.preventDefault?.();
            return;
        }
        lastActivation = now;
        activate(event);
        // Belt and braces for the focus highlight: if anything did put focus here
        // (keyboard activation, or a build where preventDefault is ignored), let it go
        // again once the work is done.
        element.blur?.();
    };

    element.addEventListener('click', run);
    element.addEventListener('mousedown', (event) => {
        event.stopPropagation();
        // Keep the press from moving DOM focus onto this element. The screen's focus
        // system reacts to whatever holds focus by lighting up its surroundings - which
        // is why clicking the priority picker used to wash the filters, the settlement
        // card and the picker itself in yellow. A button that never takes focus never
        // triggers any of it.
        event.preventDefault();
    });
    element.addEventListener('mouseup', (event) => event.stopPropagation());
    element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            run(event);
        }
    });
}

/**
 * This DOM implementation has no `replaceChildren` - calling it throws
 * "replaceChildren is not a function". Resource+ empties containers by hand for the
 * same reason.
 */
export function clearChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

/** Same reason as clearChildren: only the older `appendChild` can be relied on here. */
export function appendAll(parent, ...children) {
    for (const child of children) {
        parent.appendChild(child);
    }
    return parent;
}

/**
 * Puts a stylesheet in the document once, under an id, and hands it back.
 *
 * Six modules had grown their own four-line version of this, three of which differed in
 * whether they remembered the element they created - which is the half that matters, as
 * it is what a teardown needs to remove.
 */
export function ensureStyle(id, css) {
    const existing = document.getElementById(id);
    if (existing) {
        return existing;
    }
    const style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
    return style;
}

export function makeElement(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    element.className = className;
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    return element;
}
