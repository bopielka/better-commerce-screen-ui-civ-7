import '/core/ui/options/screen-options.js'; // must load before the model is touched
import { CategoryType, Options, OptionType } from '/core/ui/options/model-options.js';
import { CategoryData } from '/core/ui/options/options-helpers.js';

/*
 * ⚠️ The only imports of this mod's own code here, and they are all leaves: a settings
 * module under ui/planner/ holds each value and imports nothing but diagnostics. The
 * dependency runs one way - options write to the planner, the planner never reads the
 * options screen - which is what lets the assignment engine answer these questions with
 * the Commerce screen closed. See the note at the top of factory-first-setting.js.
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

/**
 * Mod options for "Better Commerce Screen UI", shown under a "Mods" tab in the options
 * screen. Same shape as the specialists mod's options, deliberately: the "Mods" category
 * is not part of the base game, so it is created with ??= and the shared id "mods" and
 * several community mods end up in one tab instead of each spawning its own.
 *
 * Values persist through UI.setOption("user", "Mod", ...), with localStorage as a
 * fallback - the approach other Civ VII mods settled on.
 */
CategoryType['Mods'] = 'mods';
CategoryData[CategoryType.Mods] ??= {
    title: 'LOC_UI_CONTENT_MGR_SUBTITLE',
    description: 'LOC_UI_CONTENT_MGR_SUBTITLE_DESCRIPTION',
};

const MOD_ID = 'better-commerce-screen-ui';

/**
 * This mod's own heading inside the shared "Mods" tab.
 *
 * The heading text is not set here: the options screen derives it from the group id as
 * `LOC_OPTIONS_GROUP_<ID IN CAPITALS>`, so this one needs
 * LOC_OPTIONS_GROUP_NAJANE_COMMERCE in the text files.
 *
 * ⚠️ Do not reuse another mod's group id. The specialists mod owns `najane_mods` and
 * titles it with its own name, so anything filed there appears to belong to it.
 */
const OPTION_GROUP = 'najane_commerce';

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
 * How far automatic assignment goes when a resource is acquired.
 *
 * One dropdown rather than three checkboxes: these are four points on a scale and only
 * one can hold at a time. As separate boxes they invited combinations that had to be
 * explained away in their own descriptions.
 *
 * ⚠️ Append only - the index is what gets stored.
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

/**
 * Carries over the three checkboxes this dropdown replaced, so an existing setting is not
 * silently switched off. Safe to delete once the mod has shipped with the dropdown.
 */
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

/**
 * ⚠️ Offset by one, because this one defaults to ON and an option that was never set reads
 * back as 0 - see "the zero trap" in documentation/11. `autoAssignMode` gets away with a raw
 * value only because its default happens to be 0 as well.
 */
const SKIP_PROMPT_OFF = 1;
const SKIP_PROMPT_ON = 2;

const CommerceOptions = new (class {
    mode = null;
    skipPrompt = null;

    /**
     * How far automatic assignment goes. Off by default: it acts on the player's behalf
     * without being asked and shows nothing while doing it.
     */
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
     * Whether the end-turn prompt may be hidden while nothing you hold can be placed.
     *
     * On by default: the game raises that notification whenever a resource is unassigned,
     * it is HIGH severity and does not expire, so once the empire is full it takes over the
     * turn button every turn for a situation with nothing to do about it. Off restores the
     * game's own behaviour exactly.
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

/*
 * ⚠️ Order matters: the options screen lays a group out in the order the options are
 * added, so the happiness dropdown is registered first to sit above automatic assignment.
 */
Options.addInitCallback(() => {
    Options.addOption({
        category: CategoryType.Mods,
        group: OPTION_GROUP,
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
        group: OPTION_GROUP,
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
        group: OPTION_GROUP,
        type: OptionType.Checkbox,
        id: 'najane-commerce-skip-assign-prompt',
        initListener: (info) => (info.currentValue = CommerceOptions.skipAssignPrompt),
        updateListener: (_info, value) => (CommerceOptions.skipAssignPrompt = value),
        label: 'LOC_OPTIONS_NAJANE_COMMERCE_SKIP_PROMPT',
        description: 'LOC_OPTIONS_NAJANE_COMMERCE_SKIP_PROMPT_DESCRIPTION',
    });

    Options.addOption({
        category: CategoryType.Mods,
        group: OPTION_GROUP,
        type: OptionType.Checkbox,
        id: 'najane-commerce-gather-culture',
        initListener: (info) => (info.currentValue = isCultureGatheringEnabled()),
        updateListener: (_info, value) => setCultureGatheringEnabled(value),
        label: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_CULTURE',
        description: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_CULTURE_DESCRIPTION',
    });

    Options.addOption({
        category: CategoryType.Mods,
        group: OPTION_GROUP,
        type: OptionType.Checkbox,
        id: 'najane-commerce-gather-gold',
        initListener: (info) => (info.currentValue = isGoldGatheringEnabled()),
        updateListener: (_info, value) => setGoldGatheringEnabled(value),
        label: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_GOLD',
        description: 'LOC_OPTIONS_NAJANE_COMMERCE_GATHER_GOLD_DESCRIPTION',
    });
});

export { CommerceOptions as default };
