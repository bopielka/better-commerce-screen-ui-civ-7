import '/core/ui/options/screen-options.js'; // must load before the model is touched
import { CategoryType, Options, OptionType } from '/core/ui/options/model-options.js';
import { CategoryData } from '/core/ui/options/options-helpers.js';

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

const CommerceOptions = new (class {
    mode = null;

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
})();

Options.addInitCallback(() => {
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
});

export { CommerceOptions as default };
