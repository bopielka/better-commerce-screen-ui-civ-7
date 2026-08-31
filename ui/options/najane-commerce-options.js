import '/core/ui/options/screen-options.js'; // must load before the model is touched
import { CategoryType, Options, OptionType } from '/core/ui/options/model-options.js';
import { CategoryData } from '/core/ui/options/options-helpers.js';

/*
 * ⚠️ The only imports of this mod's own code here, and they are all near-leaves. This file also
 * loads in SHELL scope, before any game exists, so nothing it pulls in may touch the game at
 * import time: `storedSwitch`/`storedChoice` build a closure and stop, and the option behind them
 * is read lazily on the first question asked.
 */
import {
    happinessPriorityMode,
    setHappinessPriorityMode,
} from '../planner/happiness-setting.js';
import {
    isCultureGatheringEnabled,
    isGoldGatheringEnabled,
    setCultureGatheringEnabled,
    setGoldGatheringEnabled,
} from '../planner/hoard-setting.js';
import { isResourceLockingAllowed, setResourceLockingAllowed } from '../engine/resource-locks.js';
import { areModTooltipsHidden, setModTooltipsHidden } from '../engine/tooltip-setting.js';
import { flushNajaneOptions, registerNajaneOptions } from './najane-mod-options-registry.js';

/**
 * Mod options, under a "Mods" tab in the options screen.
 * ⚠️ The "Mods" category is not part of the base game, so it is created with `??=` under the shared
 * id "mods" - several community mods then share one tab instead of each spawning its own.
 */
CategoryType['Mods'] = 'mods';
CategoryData[CategoryType.Mods] ??= {
    title: 'LOC_UI_CONTENT_MGR_SUBTITLE',
    description: 'LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION',
};

const MOD_ID = 'better-commerce-screen-ui';

/** This mod's own heading inside the shared "Mods" tab. */
/**
 * The two headings this mod owns in the shared "Mods" tab.
 *
 * ⚠️ `najane_mods_*` IS A CONVENTION ACROSS THREE MODS (user's instruction, 2026-08-30). Better
 * City UI and Better Specialists UI use the same prefix and the same "Najane Mods: x" heading
 * pattern, so all of them read as one family rather than as three unrelated blocks.
 *
 * ⚠️ THE HEADING TEXT IS DERIVED, NOT PASSED. `GetGroupLocKey` uppercases the group name into
 * `LOC_OPTIONS_GROUP_<NAME>`, so these strings and the localisation tags have to be kept in step
 * by hand - nothing errors when they drift, the player just sees a raw tag.
 *
 * ⚠️ Split along the line that already ran through this list: what gets ASSIGNED WHERE, and how
 * the screen READS. The old single heading held both and the file already carried a comment
 * apologising for it.
 */
const GROUP_ASSIGN = 'najane_mods_commerce';
const GROUP_VIEW = 'najane_mods_commerce_view';

export const CommerceOptionsChangedEventName = 'najane-commerce-options-changed';

function persist(optionID, value) {
    UI.setOption('user', 'Mod', `${MOD_ID}.${optionID}`, value);
    Configuration.getUser().saveCheckpoint();
    try {
        const options = JSON.parse(localStorage.getItem('modSettings') || '{}');
        options[MOD_ID] ??= {};
        options[MOD_ID][optionID] = value;
        localStorage.setItem('modSettings', JSON.stringify(options));
    } catch (error) {
        console.error(`[better-commerce] could not write option ${optionID}: ${error}`);
    }
}

function restore(optionID) {
    const stored = UI.getOption('user', 'Mod', `${MOD_ID}.${optionID}`);
    if (stored != null) {
        return stored;
    }
    try {
        const options = JSON.parse(localStorage.getItem('modSettings') || '{}');
        return options?.[MOD_ID]?.[optionID] ?? null;
    } catch (error) {
        console.error(`[better-commerce] could not read option ${optionID}: ${error}`);
        return null;
    }
}

/**
 * How far automatic assignment goes. One dropdown rather than three checkboxes: these are four
 * points on a scale and only one can hold at a time. ⚠️ Append only - the index is what is stored.
 */
export const AutoAssignMode = {
    Off: 0,
    NewOnly: 1,
    EverythingUnassigned: 2,
    RebuildEverything: 3,
};

const MODE_ITEMS = [
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_MODE_OFF' },
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_MODE_NEW' },
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_MODE_ALL' },
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_MODE_REBUILD' },
];

/** Carries over the three checkboxes this dropdown replaced. Safe to delete after a release. */
function migrateFromCheckboxes() {
    if (!Number(restore('autoAssignNewResources'))) {
        return AutoAssignMode.Off;
    }
    if (Number(restore('autoReassignEverything'))) {
        return AutoAssignMode.RebuildEverything;
    }
    if (Number(restore('autoAssignEverything'))) {
        return AutoAssignMode.EverythingUnassigned;
    }
    return AutoAssignMode.NewOnly;
}

// ⚠️ Offset by one: this defaults to ON and an option never set reads back as 0.
const SKIP_PROMPT_OFF = 1;
const SKIP_PROMPT_ON = 2;

const CommerceOptions = new (class {
    mode = null;
    skipPrompt = null;

/** Off by default: it acts on the player's behalf without being asked and shows nothing. */
    get autoAssignMode() {
        if (this.mode === null) {
            const stored = restore('autoAssignMode');
            this.mode = stored != null ? Number(stored) : migrateFromCheckboxes();
        }
        return this.mode;
    }

    set autoAssignMode(value) {
        this.mode = Number(value);
        persist('autoAssignMode', this.mode);
        window.dispatchEvent(new CustomEvent(CommerceOptionsChangedEventName));
    }

/**
 * Whether the end-turn prompt may be hidden while nothing you hold can be placed. On by default:
 * the notification is HIGH severity and does not expire, so once the empire is full it takes over
 * the turn button every turn for a situation with nothing to do about it.
 */
    get skipAssignPrompt() {
        if (this.skipPrompt === null) {
            const stored = Number(restore('skipAssignPrompt'));
            this.skipPrompt = stored === SKIP_PROMPT_OFF ? false : true;
        }
        return this.skipPrompt;
    }

    set skipAssignPrompt(value) {
        this.skipPrompt = !!value;
        persist('skipAssignPrompt', this.skipPrompt ? SKIP_PROMPT_ON : SKIP_PROMPT_OFF);
        window.dispatchEvent(new CustomEvent(CommerceOptionsChangedEventName));
    }
})();

const HAPPINESS_ITEMS = [
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_HAPPINESS_NEVER' },
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_HAPPINESS_CITIES' },
    { label: 'LOC_OPTIONS_NAJANE_COMMERCE_HAPPINESS_ALL' },
];

// ⚠️ Order matters: a group is laid out in the order its options are added.
/**
 * ⚠️ REGISTERED, NOT ADDED. Going straight to `Options.addInitCallback` puts this mod's headings
 * wherever its callback happens to fall among every other mod's, which scattered the Najane
 * sections down the tab. The registry collects all three mods and adds them in one burst, so the
 * headings come out adjacent. See ui/options/najane-mod-options-registry.js.
 *
 * ⚠️ `sort` and `probeId` are part of that contract: `sort` is this mod's fixed place in the
 * running order, `probeId` is the first option below and is how the registry recognises an init
 * cycle it has already handled.
 */
registerNajaneOptions({
    sort: 30,
    probeId: 'najane-commerce-happiness-priority',
    add: () => {
        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_ASSIGN,
            type: OptionType.Dropdown,
            id: 'najane-commerce-happiness-priority',
            initListener: (info) => (info.selectedItemIndex = happinessPriorityMode()),
            updateListener: (_info, value) => setHappinessPriorityMode(value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_HAPPINESS',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_HAPPINESS_DESCRIPTION',
            dropdownItems: HAPPINESS_ITEMS,
        });

        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_ASSIGN,
            type: OptionType.Dropdown,
            id: 'najane-commerce-auto-assign-mode',
            initListener: (info) => (info.selectedItemIndex = CommerceOptions.autoAssignMode),
            updateListener: (_info, value) => (CommerceOptions.autoAssignMode = value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_AUTO_MODE',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_AUTO_MODE_DESCRIPTION',
            dropdownItems: MODE_ITEMS,
        });

        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_ASSIGN,
            type: OptionType.Checkbox,
            id: 'najane-commerce-skip-assign-prompt',
            initListener: (info) => (info.currentValue = CommerceOptions.skipAssignPrompt),
            updateListener: (_info, value) => (CommerceOptions.skipAssignPrompt = value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_SKIP_PROMPT',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_SKIP_PROMPT_DESCRIPTION',
        });

        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_ASSIGN,
            type: OptionType.Checkbox,
            id: 'najane-commerce-allow-resource-locks',
            initListener: (info) => (info.currentValue = isResourceLockingAllowed()),
            updateListener: (_info, value) => setResourceLockingAllowed(value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_ALLOW_LOCKS',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_ALLOW_LOCKS_DESCRIPTION',
        });

        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_VIEW,
            type: OptionType.Checkbox,
            id: 'najane-commerce-gather-culture',
            initListener: (info) => (info.currentValue = isCultureGatheringEnabled()),
            updateListener: (_info, value) => setCultureGatheringEnabled(value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_CULTURE',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_CULTURE_DESCRIPTION',
        });

        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_VIEW,
            type: OptionType.Checkbox,
            id: 'najane-commerce-gather-gold',
            initListener: (info) => (info.currentValue = isGoldGatheringEnabled()),
            updateListener: (_info, value) => setGoldGatheringEnabled(value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_GOLD',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_GOLD_DESCRIPTION',
        });

        // ⚠️ Last within its own heading, which is now what "about how the screen READS" means here.
        Options.addOption({
            category: CategoryType.Mods,
            group: GROUP_VIEW,
            type: OptionType.Checkbox,
            id: 'najane-commerce-hide-tooltips',
            initListener: (info) => (info.currentValue = areModTooltipsHidden()),
            updateListener: (_info, value) => setModTooltipsHidden(value),
            label: 'LOC_OPTIONS_NAJANE_COMMERCE_HIDE_TOOLTIPS',
            description: 'LOC_OPTIONS_NAJANE_COMMERCE_HIDE_TOOLTIPS_DESCRIPTION',
        });
    },
});

// ⚠️ Every Najane mod registers this same flush; the first one to fire adds all of them.
Options.addInitCallback(flushNajaneOptions);
export { CommerceOptions as default };
