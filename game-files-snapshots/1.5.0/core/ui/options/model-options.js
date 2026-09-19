import { ContextManager } from '../context-manager/context-manager.js';

var OptionType = /* @__PURE__ */ ((OptionType2) => {
  OptionType2[OptionType2["Editor"] = 0] = "Editor";
  OptionType2[OptionType2["Checkbox"] = 1] = "Checkbox";
  OptionType2[OptionType2["Dropdown"] = 2] = "Dropdown";
  OptionType2[OptionType2["Slider"] = 3] = "Slider";
  OptionType2[OptionType2["Stepper"] = 4] = "Stepper";
  OptionType2[OptionType2["Switch"] = 5] = "Switch";
  return OptionType2;
})(OptionType || {});
var CategoryType = /* @__PURE__ */ ((CategoryType2) => {
  CategoryType2["Accessibility"] = "accessibility";
  CategoryType2["Audio"] = "audio";
  CategoryType2["Game"] = "game";
  CategoryType2["Graphics"] = "graphics";
  CategoryType2["Input"] = "input";
  CategoryType2["System"] = "system";
  CategoryType2["Interface"] = "interface";
  return CategoryType2;
})(CategoryType || {});
class OptionsModel {
  /** Backing data and callback for all the options across all the sections.  */
  Options = /* @__PURE__ */ new Map();
  /** Pending options, can be modified and applied externally */
  graphicsOptions = GraphicsOptions.getCurrentOptions();
  supportedOptions = GraphicsOptions.getSupportedOptions();
  // Consider removing these counts and tracking separately in each Option instance
  /** Reference count of options that have changed and aren't back to their original value */
  changeRefCount = 0;
  /** Reference count of options that need a reload and aren't back to their original value */
  needReloadRefCount = 0;
  /** Reference count of options that need a reload and aren't back to their original value */
  needRestartRefCount = 0;
  /** Track if changing options means explicit input refresh needs to occur.  (Different meanings on the C++ side based on platform.) */
  inputRefreshRequired = false;
  optionsInitCallbacks = [];
  optionsReInitCallbacks = [];
  optionsChangedCallbacks = [];
  constructor() {
    engine.whenReady.then(() => {
      const playerProfileChangedListener = () => {
      };
      engine.on("PlayerProfileChanged", playerProfileChangedListener);
      engine.on("GraphicsOptionsChanged", () => {
        this.graphicsOptions = GraphicsOptions.getCurrentOptions();
        this.supportedOptions = GraphicsOptions.getSupportedOptions();
        this.reInitOptions();
      });
    });
  }
  get data() {
    return this.Options;
  }
  get supportsGraphicOptions() {
    return this.supportedOptions.profiles.length != 0;
  }
  get showAdvancedGraphicsOptions() {
    return this.supportedOptions.canShowAdvancedGraphicsOptions;
  }
  get canUseMetalFx() {
    return this.supportedOptions.canUseMetalFx;
  }
  get showCustomGraphicsProfile() {
    return this.supportedOptions.canShowCustomGraphicsProfile;
  }
  incRefCount() {
    return this.changeRefCount++;
  }
  init() {
    this.optionsInitCallbacks.forEach((callback) => callback());
    this.optionsInitCallbacks = [];
    this.updateHiddenOptions();
  }
  /**
   * Adds a callback to be executed when the options are initialized.
   *
   * an init callback is a function that adds options to the model (i.e., calls addOption)
   */
  addInitCallback(callback) {
    if (this.optionsReInitCallbacks.length && !this.optionsInitCallbacks.length) {
      throw new Error("Options already initialized, cannot add init callback");
    }
    this.optionsInitCallbacks.push(callback);
    this.optionsReInitCallbacks.push(callback);
  }
  /**
   * Adds a callback to be executed when the options are changed by the engine.
   */
  addChangedCallback(callback) {
    this.optionsChangedCallbacks.push(callback);
  }
  /**
   * Removes all options changed callbacks.
   */
  clearChangedCallbacks() {
    this.optionsChangedCallbacks = [];
  }
  /**
   * Set up to make the options screen rebuild from the engine data next time it opens.
   */
  reInitOptions() {
    this.Options.clear();
    this.optionsInitCallbacks = this.optionsReInitCallbacks;
    this.optionsChangedCallbacks.forEach((callback) => callback());
    this.optionsChangedCallbacks = [];
  }
  /**
   * Add a new option to the options screen.
   */
  addOption(info) {
    switch (info.type) {
      case 4 /* Stepper */:
        info.currentValue ??= 0;
        info.min ??= 0;
        info.max ??= 100;
        break;
      case 2 /* Dropdown */:
        break;
      case 1 /* Checkbox */:
        info.currentValue ??= false;
        break;
      case 3 /* Slider */:
        info.min ??= 0;
        info.max ??= 1;
        info.steps ??= 0;
        break;
      case 0 /* Editor */:
        break;
    }
    this.Options.set(info.id, info);
    info.initListener?.(info);
  }
  /**
   * Create a checkpoint for sound and configuration options
   */
  saveCheckpoints() {
    Configuration.getUser().saveCheckpoint();
    Sound.volumeSetCheckpoint();
  }
  /**
   * Save all categories to disk
   */
  commitOptions(category) {
    switch (category) {
      case "sound":
        Sound.volumeWriteSettings();
        break;
      case "graphics":
        GraphicsOptions.applyOptions(this.graphicsOptions);
        break;
      case "application":
        UI.commitApplicationOptions();
        break;
      case "network":
        UI.commitNetworkOptions();
        break;
      case "configuration":
        Configuration.getUser().saveCheckpoint();
        break;
      default:
        Sound.volumeWriteSettings();
        GraphicsOptions.applyOptions(this.graphicsOptions);
        UI.commitApplicationOptions();
        UI.commitNetworkOptions();
        Configuration.getUser().saveCheckpoint();
    }
    if (this.isUIReloadRequired()) {
      if (!UI.isInGame() || !UI.isMultiplayer()) {
        UI.refreshPlayerColors();
        UI.reloadUI();
      }
    }
    this.changeRefCount = 0;
    this.needReloadRefCount = 0;
    this.needRestartRefCount = 0;
  }
  /**
   * default restores most settings to their engine-defined default values.
   */
  resetOptionsToDefault() {
    const previousAudioIdx = Locale.getCurrentAudioLanguageOption();
    const previousDisplayIdx = Locale.getCurrentDisplayLanguageOption();
    UI.defaultApplicationOptions();
    UI.defaultAudioOptions();
    UI.defaultUserOptions();
    UI.defaultTutorialOptions();
    if (!UI.isInGame()) {
      this.graphicsOptions = GraphicsOptions.getDefaultOptions();
      GraphicsOptions.applyOptions(this.graphicsOptions);
    }
    Sound.volumeSetMaster(Sound.volumeGetMaster());
    Sound.volumeSetMusic(Sound.volumeGetMusic());
    Sound.volumeSetSFX(Sound.volumeGetSFX());
    Sound.volumeSetUI(Sound.volumeGetUI());
    Sound.volumeSetCinematics(Sound.volumeGetCinematics());
    Sound.volumeSetVoice(Sound.volumeGetVoice());
    Sound.volumeWriteSettings();
    UI.commitApplicationOptions();
    UI.commitNetworkOptions();
    if (UI.isInGame()) {
      if (this.isUIReloadRequired() && !UI.isMultiplayer()) {
        UI.refreshPlayerColors();
        UI.reloadUI();
      }
    }
    this.changeRefCount = 0;
    this.needReloadRefCount = 0;
    this.needRestartRefCount = 0;
    const currentAudioIdx = Locale.getCurrentAudioLanguageOption();
    const currentDisplayIdx = Locale.getCurrentDisplayLanguageOption();
    const didChangeLanguage = currentAudioIdx !== previousAudioIdx || currentDisplayIdx !== previousDisplayIdx;
    if (didChangeLanguage) {
      this.needRestartRefCount++;
    }
  }
  /**
   * restore resets all categories to their on disk values
   */
  restore(category) {
    switch (category) {
      case "sound":
        Sound.volumeRestoreCheckpoint();
        break;
      case "graphics":
        this.graphicsOptions = GraphicsOptions.getCurrentOptions();
        break;
      case "application":
        UI.revertApplicationOptions();
        break;
      case "network":
        UI.revertNetworkOptions();
        break;
      case "configuration":
        Configuration.getUser().restoreCheckpoint();
        break;
      default:
        Sound.volumeRestoreCheckpoint();
        UI.revertApplicationOptions();
        UI.revertNetworkOptions();
        Configuration.getUser().restoreCheckpoint();
        this.graphicsOptions = GraphicsOptions.getCurrentOptions();
        ContextManager.updateClickDuration();
    }
    this.changeRefCount = 0;
    this.needReloadRefCount = 0;
    this.needRestartRefCount = 0;
    for (const option of this.Options.values()) {
      option.restoreListener?.(option);
      option.initListener?.(option);
    }
  }
  hasChanges() {
    return this.changeRefCount > 0;
  }
  /**
   * Check if the changed options will cause the UI to reload.
   * @returns true if applying the options changes will reload the UI, false otherwise
   */
  isUIReloadRequired() {
    return this.needReloadRefCount > 0;
  }
  /**
   * Check if the pending options require a restart.
   * @returns true if applying the pending options will require a restart, false otherwise
   */
  isRestartRequired() {
    if (this.needRestartRefCount > 0) return true;
    const currentOptions = GraphicsOptions.getCurrentOptions();
    return this.graphicsOptions.deviceID != currentOptions.deviceID || this.graphicsOptions.hdr != currentOptions.hdr;
  }
  /**
   * Does some explicit refresh of the UI input system need to occur?
   */
  isInputRefreshRequired() {
    return this.inputRefreshRequired;
  }
  updateHiddenOptions() {
    const crossplayOption = this.Options.get("option-crossplay");
    if (crossplayOption != void 0) {
      crossplayOption.isHidden = !Network.hasCrossPlayPrivilege();
    }
  }
}
const Options = new OptionsModel();

export { CategoryType, OptionType, Options };
//# sourceMappingURL=model-options.js.map
