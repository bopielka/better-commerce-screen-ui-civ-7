import { FxsCheckbox } from '../components/fxs-checkbox.js';
import { DropdownSelectionChangeEventName } from '../components/fxs-dropdown.js';
import { FxsSlider } from '../components/fxs-slider.js';
import { FxsStepper } from '../components/fxs-stepper.js';
import { FxsSwitch } from '../components/fxs-switch.js';
import { ContextManager } from '../context-manager/context-manager.js';
import { displayRequestUniqueId } from '../context-manager/display-handler.js';
import { DialogBoxManager } from '../dialog-box/manager-dialog-box.js';
import { MainMenuReturnEvent } from '../events/shell-events.js';
import { InputEngineEventName } from '../input/input-support.js';
import NavTray from '../navigation-tray/model-navigation-tray.js';
import { Options, OptionType } from './model-options.js';
import { ShowRestartGamePrompt, ShowReloadUIPrompt, CategoryData } from './options-helpers.js';
import './options.js';
import './screen-options-category.js';
import Panel from '../panel-support.js';
import { MustGetElement } from '../utilities/utilities-dom.js';
import { FocusManager } from '../../ui-next/services/focus-manager.js';
import styles from './screen-options.scss.js';
import { DialogBoxAction } from '../dialog-box/model-dialog-box.js';

const DEFAULT_PUSH_PROPERTIES = {
  singleton: true,
  createMouseGuard: true
};
class ScreenOptions extends Panel {
  panels = [];
  tabData = [];
  tabControl;
  slotGroup = document.createElement("fxs-slot-group");
  scrollable;
  cancelButton;
  defaultsButton;
  confirmButton;
  dialogId = displayRequestUniqueId();
  minWidthByFontScale = {
    [FontScale.XSmall]: "w-11",
    [FontScale.Small]: "w-12",
    [FontScale.Medium]: "w-13",
    [FontScale.Large]: "w-14",
    [FontScale.XLarge]: "w-16"
  };
  onInitialize() {
    super.onInitialize();
    Options.init();
    for (const option of Options.data.values()) {
      option.initListener?.(option);
    }
    Options.saveCheckpoints();
    this.render();
  }
  onAttach() {
    this.enableOpenSound = true;
    this.enableCloseSound = true;
    this.Root.setAttribute("data-audio-group-ref", "options");
    super.onAttach();
    this.cancelButton?.addEventListener("action-activate", this.onCancelOptions);
    this.cancelButton?.setAttribute("data-audio-focus-ref", "data-audio-hero-focus");
    this.defaultsButton?.addEventListener("action-activate", this.onDefaultOptions);
    this.defaultsButton?.setAttribute("data-audio-focus-ref", "data-audio-hero-focus");
    this.confirmButton?.addEventListener("action-activate", this.onConfirmOptions);
    this.Root.addEventListener(InputEngineEventName, this.onEngineInput);
    const uiViewExperienceIsMobile = UI.getViewExperience() == UIViewExperience.Mobile;
    const optionFrame = MustGetElement(".option-frame", this.Root);
    optionFrame.classList.toggle("size-full", uiViewExperienceIsMobile);
    optionFrame.setAttribute("outside-safezone-mode", uiViewExperienceIsMobile ? "full" : "vertical");
    this.Root.listenForEngineEvent("UIFontScaleChanged", this.onFontScaleChanged.bind(this));
    this.adjustSliderTextsSize();
    Options.addChangedCallback(this.onOptionsChanged);
  }
  onDetach() {
    NavTray.clear();
    Options.clearChangedCallbacks();
    this.Root.removeEventListener(InputEngineEventName, this.onEngineInput);
    this.cancelButton?.removeEventListener("action-activate", this.onCancelOptions);
    this.defaultsButton?.removeEventListener("action-activate", this.onDefaultOptions);
    this.confirmButton?.removeEventListener("action-activate", this.onConfirmOptions);
    super.onDetach();
  }
  onReceiveFocus() {
    super.onReceiveFocus();
    NavTray.clear();
    NavTray.addOrUpdateGenericCancel();
    NavTray.addOrUpdateShellAction1("LOC_OPTIONS_CONFIRM_CHANGES");
    NavTray.addOrUpdateShellAction2("LOC_OPTIONS_RESET_TO_DEFAULTS");
    Sound.volumeSetCheckpoint();
    waitForLayout(() => {
      FocusManager.get().setFocus(this.slotGroup);
    });
  }
  onLoseFocus() {
    NavTray.clear();
    super.onLoseFocus();
  }
  onOptionsChanged = () => {
    const defaultCallback = (_eAction) => {
      Options.restore();
      VisualRemaps.revertUnsavedChanges();
      window.dispatchEvent(new MainMenuReturnEvent());
      this.close();
      delayByFrame(() => {
        ContextManager.push("screen-options", { singleton: true, createMouseGuard: true });
      }, 8);
    };
    DialogBoxManager.createDialog_Confirm({
      body: "LOC_OPTIONS_CONFIG_CHANGE_BODY",
      title: "LOC_OPTIONS_CONFIG_CHANGE",
      canClose: false,
      displayQueue: "SystemMessage",
      addToFront: true,
      callback: defaultCallback
    });
  };
  onDefaultOptions = () => {
    const defaultCallback = (eAction) => {
      if (eAction == DialogBoxAction.Confirm) {
        Options.resetOptionsToDefault();
        if (Options.isRestartRequired()) {
          ShowRestartGamePrompt();
        }
        engine.trigger("UIFontScaleChanged");
        engine.trigger("UIGlobalScaleChanged");
        VisualRemaps.resetToDefaults();
        window.dispatchEvent(new MainMenuReturnEvent());
        this.close();
      }
    };
    DialogBoxManager.createDialog_ConfirmCancel({
      body: "LOC_OPTIONS_ARE_YOU_SURE_DEFAULT",
      title: "LOC_OPTIONS_DEFAULT",
      canClose: false,
      displayQueue: "SystemMessage",
      addToFront: true,
      callback: defaultCallback
    });
  };
  onCancelOptions = () => {
    const cancelCallback = (eAction) => {
      if (eAction == DialogBoxAction.Confirm) {
        Options.restore();
        VisualRemaps.revertUnsavedChanges();
        window.dispatchEvent(new MainMenuReturnEvent());
        this.close();
      }
    };
    if (Options.hasChanges() || VisualRemaps.hasUnsavedChanges()) {
      DialogBoxManager.createDialog_ConfirmCancel({
        dialogId: this.dialogId,
        body: "LOC_OPTIONS_REVERT_DESCRIPTION",
        title: "LOC_OPTIONS_CANCEL_CHANGES",
        canClose: false,
        displayQueue: "SystemMessage",
        addToFront: true,
        callback: cancelCallback
      });
    } else {
      window.dispatchEvent(new MainMenuReturnEvent());
      this.close();
    }
  };
  onConfirmOptions = () => {
    const closeFn = this.close.bind(this);
    if (Options.isUIReloadRequired() && UI.isInGame() && UI.isMultiplayer()) {
      ShowRestartGamePrompt(closeFn);
    } else if (Options.isUIReloadRequired() && UI.isInGame()) {
      ShowReloadUIPrompt(closeFn);
    } else if (Options.isRestartRequired()) {
      ShowRestartGamePrompt(closeFn);
    } else {
      Options.commitOptions();
      VisualRemaps.saveConfiguration();
      engine.trigger("update-tutorial-level");
      engine.trigger("UIFontScaleChanged");
      engine.trigger("UIGlobalScaleChanged");
      engine.trigger("UI_OptionsChanged");
      window.dispatchEvent(new MainMenuReturnEvent());
      this.close();
    }
    if (Options.isInputRefreshRequired()) {
      Options.inputRefreshRequired = false;
      UI.refreshInput();
    }
  };
  onFontScaleChanged() {
    this.adjustSliderTextsSize();
  }
  adjustSliderTextsSize() {
    const newScale = Configuration.getUser().uiFontScale;
    const minWidthTag = this.minWidthByFontScale[newScale];
    const sliderTexts = this.Root.querySelectorAll(".screen-options-category_slider-text");
    sliderTexts.forEach((element) => {
      element.classList.remove(...Object.values(this.minWidthByFontScale));
      element.classList.add(minWidthTag ?? "");
    });
  }
  onEngineInput = (inputEvent) => {
    if (inputEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (inputEvent.isCancelInput()) {
      this.onCancelOptions();
      inputEvent.preventDefault();
      inputEvent.stopPropagation();
    }
    switch (inputEvent.detail.name) {
      case "shell-action-1":
        this.onConfirmOptions();
        inputEvent.preventDefault();
        inputEvent.stopPropagation();
        break;
      case "shell-action-2":
        this.onDefaultOptions();
        inputEvent.preventDefault();
        inputEvent.stopPropagation();
        break;
    }
  };
  onOptionsTabSelected = (e) => {
    e.stopPropagation();
    const { index } = e.detail;
    const slotId = this.panels[index].id;
    this.slotGroup.setAttribute("selected-slot", slotId);
  };
  handleForceRenderOptions(optionElement, _component, option) {
    optionElement.classList.toggle("hidden", option.isHidden ?? false);
  }
  onUpdateOptionValue(optionElement, component, option) {
    switch (option.type) {
      // TODO: Add cases for other component types used
      case OptionType.Editor:
        component.Root.addEventListener("action-activate", (_event) => {
          const pushProperties = option.pushProperties ?? DEFAULT_PUSH_PROPERTIES;
          const activateResult = option.activateListener?.();
          if (option.editorTagName && (activateResult === void 0 || activateResult === false)) {
            ContextManager.push(option.editorTagName, pushProperties);
          }
          Options.incRefCount();
        });
        break;
      case OptionType.Dropdown:
        component.Root.addEventListener(
          DropdownSelectionChangeEventName,
          (event) => {
            Options.incRefCount();
            option.updateListener?.(option, event.detail.selectedIndex);
          }
        );
        option.forceRender = () => {
          component.Root.setAttribute("selected-item-index", `${option.selectedItemIndex ?? 0}`);
          component.Root.setAttribute("dropdown-items", JSON.stringify(option.dropdownItems));
          component.Root.setAttribute("disabled", `${option.isDisabled}`);
          this.handleForceRenderOptions(optionElement, component, option);
        };
        break;
      case OptionType.Stepper:
        if (component instanceof FxsStepper) {
          component.Root.addEventListener("component-value-changed", () => {
            Options.incRefCount();
            option.updateListener?.(option, component.value);
          });
        }
        option.forceRender = () => {
          component.Root.setAttribute("value", `${option.currentValue ?? 0}`);
          this.handleForceRenderOptions(optionElement, component, option);
        };
        break;
      case OptionType.Checkbox:
        if (component instanceof FxsCheckbox) {
          component.Root.addEventListener(
            ComponentValueChangeEventName,
            (event) => {
              Options.incRefCount();
              option.updateListener?.(option, event.detail.value);
            }
          );
          option.forceRender = () => {
            component.Root.setAttribute("selected", `${option.currentValue}`);
            component.Root.setAttribute("disabled", `${option.isDisabled}`);
            this.handleForceRenderOptions(optionElement, component, option);
          };
        }
        break;
      case OptionType.Switch:
        if (component instanceof FxsSwitch) {
          component.Root.addEventListener(ComponentValueChangeEventName, (event) => {
            Options.incRefCount();
            option.updateListener?.(option, event.detail.value);
          });
          option.forceRender = () => {
            component.Root.setAttribute("selected", option.currentValue ? "true" : "false");
            this.handleForceRenderOptions(optionElement, component, option);
          };
        }
        break;
      case OptionType.Slider:
        if (component instanceof FxsSlider) {
          component.Root.addEventListener(ComponentValueChangeEventName, (event) => {
            if (option.currentValue && Math.abs(option.currentValue - event.detail.value) > 1e-6) {
              Options.incRefCount();
            }
            option.updateListener?.(option, event.detail.value);
            if (option.sliderValue) {
              const output = option.formattedValue ?? `${option.currentValue ?? 0}%`;
              option.sliderValue.textContent = output;
            }
          });
          if (option.sliderValue) {
            const output = option.formattedValue ?? `${option.currentValue ?? 0}%`;
            option.sliderValue.textContent = output;
          }
          option.forceRender = () => {
            component.Root.setAttribute("value", `${option.currentValue ?? 0}`);
            component.Root.setAttribute("disabled", `${option.isDisabled}`);
            this.handleForceRenderOptions(optionElement, component, option);
          };
        }
        break;
      default:
        throw new Error(`Unhandled option type: ${option}`);
    }
  }
  /**
   * getOrCreateCategoryTab Finds or creates the panel associated with a given option category.
   *
   * @param catID A category to associate with a tab.
   * @returns The display panel associated with the tab.
   */
  getOrCreateCategoryTab(catID) {
    const elementID = `category-table-${catID}`;
    let categoryPanel = this.panels.find((panel) => panel.id === elementID);
    if (!categoryPanel) {
      categoryPanel = document.createElement("screen-options-category");
      categoryPanel.classList.add(elementID, "flex", "flex-col");
      categoryPanel.id = elementID;
      this.panels.push(categoryPanel);
      const { title, description } = CategoryData[catID];
      categoryPanel.setAttribute("description", description);
      this.tabData.push({
        id: elementID,
        category: catID,
        label: title
      });
    }
    return categoryPanel;
  }
  render() {
    const supportedOptions = Options.supportedOptions;
    let resetTooltip = Locale.compose("LOC_OPTIONS_RESET_TO_DEFAULTS_TOOLTIP");
    if (supportedOptions.canChangeScreenMode || supportedOptions.hdr && supportedOptions.canDisableHDR || supportedOptions.resolutions.length > 0) {
      resetTooltip += "[N] [N]";
      resetTooltip += Locale.compose("LOC_OPTIONS_RESET_EXCLUDES");
      resetTooltip += "[N][LIST]";
      if (supportedOptions.canChangeScreenMode) {
        resetTooltip += "[LI]";
        resetTooltip += Locale.compose("LOC_OPTIONS_GFX_SCREEN_MODE");
      }
      if (supportedOptions.hdr && supportedOptions.canDisableHDR) {
        resetTooltip += "[LI]";
        resetTooltip += Locale.compose("LOC_OPTIONS_GFX_ENABLE_HDR");
      }
      if (supportedOptions.resolutions.length > 0) {
        resetTooltip += "[LI]";
        resetTooltip += Locale.compose("LOC_OPTIONS_GFX_RESOLUTION");
      }
      resetTooltip += "[/LIST]";
    }
    this.Root.classList.add(
      "absolute",
      "flex",
      "justify-center",
      "fullscreen",
      "max-w-screen",
      "max-h-screen",
      "pointer-events-auto"
    );
    this.Root.innerHTML = `
			<div class="absolute img-lsgb-egypt-720 fullscreen"></div>
			<fxs-frame class="option-frame min-w-256 flex-initial" content-as="fxs-vslot" content-class="flex-auto">
				<fxs-vslot class="flex-auto" focus-rule="last">
					<fxs-header class="self-center mb-6 font-title text-xl text-secondary" title="LOC_UI_OPTIONS_TITLE" filigree-style="none"></fxs-header>
					<fxs-tab-bar class="mb-6"></fxs-tab-bar>
					<fxs-scrollable class="flex-auto" attached-scrollbar="true" allow-mouse-panning="true"></fxs-scrollable>
				</fxs-vslot>
				<div class="flex flex-row justify-between items-end mt-6" data-bind-class-toggle="hidden:{{g_NavTray.isTrayRequired}}">
					<fxs-button id="options-cancel"
								data-audio-group-ref="options" data-audio-activate="options-cancel-selected"
								caption="LOC_OPTIONS_CANCEL_CHANGES"></fxs-button>
					<fxs-button id="options-defaults" class="ml-2"
								data-audio-group-ref="options" data-audio-activate="options-default-selected"
								caption="LOC_OPTIONS_RESET_TO_DEFAULTS" data-tooltip-content="${resetTooltip}"></fxs-button>
					<fxs-hero-button id="options-confirm" class="ml-2"
								caption="LOC_OPTIONS_CONFIRM_CHANGES" data-audio-group-ref="options"
								data-audio-activate-ref="data-audio-options-confirm"></fxs-button>
				</div>
			</fxs-frame>
		`;
    this.scrollable = MustGetElement("fxs-scrollable", this.Root);
    this.cancelButton = MustGetElement("#options-cancel", this.Root);
    this.defaultsButton = MustGetElement("#options-defaults", this.Root);
    this.confirmButton = MustGetElement("#options-confirm", this.Root);
    this.tabControl = MustGetElement("fxs-tab-bar", this.Root);
    for (const [, option] of Options.data) {
      const category = this.getOrCreateCategoryTab(option.category);
      if (!category.maybeComponent) {
        category.initialize();
      }
      const { optionRow, optionElement } = category.component.appendOption(option);
      optionElement.initialize();
      this.onUpdateOptionValue(optionRow, optionElement.component, option);
      optionRow.classList.toggle("hidden", option.isHidden ?? false);
    }
    this.tabControl.setAttribute("tab-items", JSON.stringify(this.tabData));
    const selectedTab = this.Root.getAttribute("selected-tab");
    this.tabControl.setAttribute("selected-tab-index", selectedTab ?? "0");
    for (let i = 0; i < this.panels.length; i++) {
      this.slotGroup.appendChild(this.panels[i]);
    }
    this.slotGroup.classList.add("px-6");
    this.scrollable.appendChild(this.slotGroup);
    this.tabControl.addEventListener("tab-selected", this.onOptionsTabSelected);
    const isMobile = UI.getViewExperience() == UIViewExperience.Mobile;
    if (isMobile) {
      this.tabControl.classList.add("mx-7");
    }
  }
}
Controls.define("screen-options", {
  createInstance: ScreenOptions,
  description: "Screen for adjusting game options.",
  styles: [styles]
});

export { ScreenOptions };
//# sourceMappingURL=screen-options.js.map
