/**
 * A DEVELOPER-ONLY panel, opened by Numpad 9 or a dock icon, for buttons with no place in a
 * release.
 *
 * ⚠️ NEVER SHIPS: gated on `DIAGNOSTICS`, which is `false` in every published build - the same
 * switch `documentation/14-development-workflow.md` already requires flipping off before
 * publishing, so there is no second flag to remember. With it off, `startDevPanel()` installs
 * nothing at all - no listener, no dock icon.
 *
 * ⚠️ Plain DOM on `document.body`, same shape as `screen/treasure-toast.js` - works with any
 * screen open, or none, and needs no game state to exist. Content is paged through `SECTIONS`
 * (a nav bar plus one content area, both rebuilt from that one list) - add a new page there, not
 * by hand at each of the two render sites. The only page today, "Resource management", is one
 * button per `scoring.js` job (`JOB_LIST`), each running that job ALONE until it has nothing left
 * to place - see `runOnlyJob` in `planner/run.js`. A real placement run, through the same guard
 * and the same placement loop Assign All uses - not a preview.
 *
 * ⚠️ No engine action exists for a raw physical key like Numpad9 - the base game's own hotkeys
 * run through `engine-input` / `hotkey-next-action` CustomEvents tied to pre-bound actions this
 * mod cannot register. A plain capture-phase `keydown` on `window` is the only way in, the same
 * mechanism `screen/shift-click.js` and `screen/hover-highlight.js` already rely on.
 *
 * ⚠️ The dock icon decorates `panel-sub-system-dock`, exactly as `dock-resource-button.js` does -
 * `Controls.decorate` keeps a LIST, so both run and neither replaces the other. It is inserted as
 * a DOM sibling of the real `.resources` button so it sits in the same flex row, rather than a
 * separately positioned floating element that would need its own coordinates kept in sync.
 */
import { DIAGNOSTICS, log, warn } from '../support/diagnostics.js';
import { appendAll, bindActivatable, clearChildren, ensureStyle, makeElement } from '../support/dom.js';
import { JOB_LIST } from '../planner/scoring.js';
import { runOnlyJob } from '../planner/run.js';

const PANEL_TITLE_TEXT = 'Better Commerce Screen devtools';

const PANEL_ID = 'najane-commerce-dev-panel';
const STYLE_ID = 'najane-commerce-dev-panel-style';
const TITLE_CLASS = 'najane-dev-panel-title';
const NAV_CLASS = 'najane-dev-panel-nav';
const NAV_BUTTON_CLASS = 'najane-dev-panel-nav-button';
const NAV_BUTTON_ACTIVE_CLASS = 'najane-dev-panel-nav-button-active';
const CONTENT_CLASS = 'najane-dev-panel-content';
const BUTTON_CLASS = 'najane-dev-panel-button';
/**
 * ⚠️ `event.code`, not `event.key` - the physical key stays fixed regardless of Num Lock.
 * ⚠️ **"NumPad9", capital P - NOT THE W3C SPELLING** ("Numpad9"). Confirmed in `UI.log` after the
 * toggle was reported not to work at all: this engine's `KeyboardEvent.code` deviates from the
 * standard spelling for the numpad row (`.key` was unusable too, reporting "i"; `.location` read
 * 0, not the standard 3 for a numpad key). Read the log rather than guess again if this ever
 * needs revisiting - see the standing rule in CLAUDE.md.
 */
const TOGGLE_KEY_CODE = 'NumPad9';

const DOCK_BUTTON_ID = 'najane-commerce-dev-panel-dock-button';
const DOCK_BUTTON_CLASS = 'najane-dev-panel-dock-button';
const DOCK_BUTTON_TOOLTIP = 'Better Commerce Screen devtools';
/** Where the resources button lives, for the pass that inserts a sibling beside it. */
const RESOURCES_BUTTON_SELECTOR = '.resources';

const STYLE = `
#${PANEL_ID} {
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 9999;
    min-width: 12rem;
    padding: 0.6rem;
    background: rgba(10, 10, 14, 0.92);
    border: 1px solid rgba(255, 140, 60, 0.85);
    box-shadow: 0 0 1rem rgba(0, 0, 0, 0.7);
    font-family: monospace;
    font-size: 0.8rem;
    color: #ffd8a8;
    pointer-events: auto;
}
.${TITLE_CLASS} {
    margin: -0.6rem -0.6rem 0 -0.6rem;
    padding: 0.4rem 0.6rem 0.3rem 0.6rem;
    border-bottom: 1px solid rgba(255, 140, 60, 0.5);
    font-weight: bold;
    letter-spacing: 0.05rem;
    text-align: center;
    cursor: move;
    user-select: none;
}
.${NAV_CLASS} {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin: 0.4rem 0;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid rgba(255, 140, 60, 0.5);
}
.${NAV_BUTTON_CLASS} {
    padding: 0.2rem 0.5rem;
    background: transparent;
    border: 1px solid rgba(255, 140, 60, 0.4);
    color: #ffd8a8;
    cursor: pointer;
}
.${NAV_BUTTON_CLASS}:hover {
    background: rgba(255, 140, 60, 0.18);
}
.${NAV_BUTTON_ACTIVE_CLASS} {
    background: rgba(255, 140, 60, 0.4);
    border-color: rgba(255, 140, 60, 0.9);
    font-weight: bold;
}
.${BUTTON_CLASS} {
    display: block;
    width: 100%;
    margin: 0.25rem 0 0 0;
    padding: 0.3rem 0.4rem;
    background: rgba(255, 140, 60, 0.12);
    border: 1px solid rgba(255, 140, 60, 0.5);
    color: #ffd8a8;
    text-align: left;
    cursor: pointer;
}
.${BUTTON_CLASS}:hover {
    background: rgba(255, 140, 60, 0.28);
}
/*
 * ⚠️ Position/size copied from dock-resource-button.js's own READY_CLASS rule, deliberately -
 * same background image ("blp:ntf_discover_resource_blk"), so it needs the same offset fix.
 * The colour filter is approximate (generated for #ffa500); nudge hue-rotate if it reads wrong
 * in game.
 */
.${DOCK_BUTTON_CLASS} .ssb__button-icon {
    top: -0.1111111111rem;
    left: 0;
    width: 3rem;
    height: 3rem;
    background-image: url("blp:ntf_discover_resource_blk");
    filter: brightness(0) saturate(100%) invert(67%) sepia(54%) saturate(2476%) hue-rotate(1deg) brightness(103%) contrast(104%);
}
`;

function closePanel() {
    document.getElementById(PANEL_ID)?.remove();
}

/**
 * Drags `panel` by `handle`. Plain `mousedown`/`mousemove`/`mouseup` on `window`, the same
 * event family `screen/shift-click.js` already relies on for this DOM.
 *
 * ⚠️ Switches the panel from its stylesheet `top`/`right` to explicit inline `left`/`top` on the
 * FIRST drag, read from `getBoundingClientRect()` - `right` and an inline `left` fighting over the
 * same element would stretch its width instead of moving it.
 */
function makeDraggable(panel, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    const onMouseMove = (event) => {
        if (!dragging) {
            return;
        }
        panel.style.left = `${event.clientX - offsetX}px`;
        panel.style.top = `${event.clientY - offsetY}px`;
    };
    const onMouseUp = () => {
        dragging = false;
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', (event) => {
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        dragging = true;
        event.preventDefault();
        event.stopPropagation();
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });
}

/** One `scoring.js` job button per entry, run ALONE through `runOnlyJob` - see its own note. */
function renderResourceManagementSection(container) {
    for (const job of JOB_LIST) {
        const button = makeElement('div', BUTTON_CLASS);
        button.textContent = job.label;
        // ⚠️ Runs the job for REAL, through the same guard and placement loop Assign All uses -
        // "until it has nothing left to place", not a single pick. See `runOnlyJob`.
        bindActivatable(button, () => {
            log(`dev panel: running job "${job.key}" alone`);
            runOnlyJob(job.key, { label: `dev panel: ${job.label}` });
        });
        appendAll(container, button);
    }
}

/**
 * The panel's pages. ⚠️ ADD NEW SECTIONS HERE ONLY - the nav bar and the content area both read
 * this one list, so a new entry needs nothing else to appear and be switchable.
 */
const SECTIONS = [{ key: 'resourceManagement', label: 'Resource management', render: renderResourceManagementSection }];

/** Which section is showing - kept across a close/reopen, reset only when the build reloads. */
let activeSectionKey = SECTIONS[0].key;

function renderContent(content) {
    clearChildren(content);
    const section = SECTIONS.find((entry) => entry.key === activeSectionKey) ?? SECTIONS[0];
    section.render(content);
}

function renderNav(nav, content) {
    clearChildren(nav);
    for (const section of SECTIONS) {
        const navButton = makeElement(
            'div',
            section.key === activeSectionKey ? `${NAV_BUTTON_CLASS} ${NAV_BUTTON_ACTIVE_CLASS}` : NAV_BUTTON_CLASS,
        );
        navButton.textContent = section.label;
        bindActivatable(navButton, () => {
            if (activeSectionKey === section.key) {
                return;
            }
            activeSectionKey = section.key;
            renderNav(nav, content);
            renderContent(content);
        });
        appendAll(nav, navButton);
    }
}

function openPanel() {
    if (!document.body) {
        return;
    }
    ensureStyle(STYLE_ID, STYLE);
    document.getElementById(PANEL_ID)?.remove();

    const panel = makeElement('div', '', { id: PANEL_ID });
    const title = makeElement('div', TITLE_CLASS);
    title.textContent = PANEL_TITLE_TEXT;
    const nav = makeElement('div', NAV_CLASS);
    const content = makeElement('div', CONTENT_CLASS);
    appendAll(panel, title, nav, content);
    makeDraggable(panel, title);

    renderNav(nav, content);
    renderContent(content);

    document.body.appendChild(panel);
}

function togglePanel() {
    if (document.getElementById(PANEL_ID)) {
        closePanel();
    } else {
        openPanel();
    }
}

function onKeyDown(event) {
    if (event.code !== TOGGLE_KEY_CODE) {
        return;
    }
    // Numpad9 doubles as Page Up without Num Lock; this key is claimed for the panel instead.
    event.preventDefault();
    togglePanel();
}

/**
 * The orange dock icon that opens the panel - a second, more reliable way in: added once the
 * keyboard toggle was reported not to work at all, which turned out to be this engine spelling
 * `KeyboardEvent.code` as "NumPad9" rather than the W3C "Numpad9" (see `TOGGLE_KEY_CODE`).
 *
 * ⚠️ THE DOCK IS OLD-FRAMEWORK, the same fact that lets `dock-resource-button.js` decorate it -
 * `Controls.decorate` does nothing to a `ui-next` component.
 */
class DevPanelDockButton {
    constructor(component) {
        this.component = component;
        this.Root = component.Root;
    }

    resourcesButton() {
        return this.component.resourcesButton
            ?? this.Root?.querySelector(RESOURCES_BUTTON_SELECTOR)
            ?? null;
    }

    afterAttach() {
        ensureStyle(STYLE_ID, STYLE);
        if (document.getElementById(DOCK_BUTTON_ID)) {
            return;
        }
        const anchor = this.resourcesButton();
        if (!anchor?.parentElement) {
            warn('dev panel dock button: could not find the resources button to sit beside');
            return;
        }
        // ⚠️ Built fresh rather than cloning the real button: cloning would also copy whatever
        // state (colour/pulse classes, tooltip data) it happened to carry at this exact moment.
        // ⚠️ `data-tooltip-content` goes through `makeElement`, not a direct `setAttribute` - see
        // `support/dom.js`'s own note: it is the one door, so the "hide tooltips" option still
        // applies to this even though the option itself is player-facing and this panel is not.
        const button = makeElement(
            'div',
            `ssb__button ${DOCK_BUTTON_CLASS} ssb__element pointer-events-auto cursor-pointer`,
            { id: DOCK_BUTTON_ID, 'data-tooltip-content': DOCK_BUTTON_TOOLTIP },
        );
        appendAll(button, makeElement('div', 'ssb__button-iconbg'), makeElement('div', 'ssb__button-icon'));
        bindActivatable(button, () => togglePanel());
        anchor.parentElement.insertBefore(button, anchor.nextSibling);
    }

    beforeAttach() { }
    beforeDetach() { }

    afterDetach() {
        document.getElementById(DOCK_BUTTON_ID)?.remove();
    }
}

let started = false;

/** Installs both ways in, from the entry point - the panel must work with any screen, or none. */
export function startDevPanel() {
    if (started || !DIAGNOSTICS) {
        return;
    }
    started = true;
    window.addEventListener('keydown', onKeyDown, true);
    try {
        Controls.decorate('panel-sub-system-dock', (component) => new DevPanelDockButton(component));
    } catch (error) {
        warn(`could not add the dev panel's dock icon: ${error}`);
    }
    log('dev panel installed - Numpad 9 or the orange dock icon toggles it');
    warn('DEV PANEL IS ACTIVE (DIAGNOSTICS on) - turn diagnostics off before publishing');
}
