import { DisplayQueueManager } from './display-queue-manager.js';
import { DialogBoxManager } from '../dialog-box/manager-dialog-box.js';
import { setContextManager } from '../framework.js';
import Cursor from '../input/cursor.js';
import { InputHandlerState } from '../input/input-support.js';
import ViewManager from '../views/view-manager.js';
import { FocusManager } from '../../ui-next/services/focus-manager.js';

const DEBUG_LOG_PASSED_ATTRIBUTES = false;
var ContextManagerEvents;
((ContextManagerEvents2) => {
  ContextManagerEvents2.OnChanged = "OnContextManagerChanged";
  ContextManagerEvents2.OnOpen = "OnContextManagerOpen";
  ContextManagerEvents2.OnClose = "OnContextManagerClose";
})(ContextManagerEvents || (ContextManagerEvents = {}));
class ContextManagerSingleton {
  static _instance;
  engineInputEventHandlers = [];
  //Array of component references
  screens = [];
  //Events for components to listen for any Context state changes
  receiveFocusEvent = new CustomEvent("event-mgr-receive-focus");
  loseFocusEvent = new CustomEvent("event-mgr-lose-focus");
  popFocusEvent = new CustomEvent("event-mgr-pop");
  targetSlotPrefix = "target-slot-";
  lastActivatedComponent = null;
  // True when we want to ignore cursor target input events due to dragging
  ignoreCursorTargetDueToDragging = false;
  dragStartingTarget = null;
  dragStartingTime = 0;
  // Time in milliseconds during which drag events won't count against a click on an element or world hex
  clickDuration = 400;
  // Trach if we're in the process of pushing a screen, to avoid re-entrant issues.
  pushingTarget = null;
  pushingClassName = null;
  constructor() {
    window.addEventListener("set-activated-component", this.onSetActivatedEvent.bind(this));
    window.addEventListener("view-changed", () => {
      const screen = this.screens.find((screen2) => {
        const panel = screen2.component;
        return panel.inputContext != void 0 && panel.inputContext != InputContext.INVALID;
      });
      if (!screen) {
        ViewManager.handleReceiveFocus();
      }
    });
    this.updateClickDuration();
  }
  /**
   * Singleton accessor
   */
  static getInstance() {
    if (!ContextManagerSingleton._instance) {
      ContextManagerSingleton._instance = new ContextManagerSingleton();
    }
    return ContextManagerSingleton._instance;
  }
  get isEmpty() {
    return this.screens.length == 0 && this.pushingTarget == null && this.pushingClassName == null;
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Push a reference to a component in to the front of the stack.
   * @param targetElement The element you want to register with the ContextManager, extending HTMLElement somewhere in its parentage.
   */
  pushElement(targetElement, prop) {
    if (this.pushingTarget != null && targetElement.tagName != "MOUSE-GUARD") {
      console.warn(
        `ContextManager.pushElement() is already in the process of pushing a screen: ${this.pushingTarget.tagName}, attempted to push: ${targetElement.tagName}. This likely means that there is a re-entrant issue with the screen's onAttach logic.`
      );
    }
    this.pushingTarget = targetElement;
    let deactivatedElement;
    if (this.screens.length > 0) {
      if (targetElement.tagName.toLowerCase() != "mouse-guard") {
        this.screens[0].dispatchEvent(this.loseFocusEvent);
      }
      deactivatedElement = this.screens[0];
    }
    if (prop && prop.createMouseGuard) {
      const guardProperties = {
        singleton: true,
        targetParent: targetElement
      };
      const mouseGuard = this.push("mouse-guard", guardProperties);
      if (prop.attributes) {
        if (prop.attributes.shouldDarken === false) {
          mouseGuard.classList.add("invisible");
        }
        if (prop.attributes.blackOut === true) {
          mouseGuard.classList.add("bg-black");
        }
      }
      ViewManager.isWorldInputAllowed = false;
    }
    this.screens.unshift(targetElement);
    this.screens.sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & (Node.DOCUMENT_POSITION_FOLLOWING | Node.DOCUMENT_POSITION_CONTAINED_BY)) {
        return 1;
      } else if (pos & (Node.DOCUMENT_POSITION_PRECEDING | Node.DOCUMENT_POSITION_CONTAINS)) {
        return -1;
      }
      return 0;
    });
    if (targetElement.tagName.toLowerCase() != "mouse-guard") {
      engine.trigger(ContextManagerEvents.OnChanged, {
        detail: { activatedElement: targetElement, deactivatedElement }
      });
      engine.trigger(ContextManagerEvents.OnOpen, {
        detail: { activatedElement: targetElement, deactivatedElement }
      });
      if (targetElement === this.screens[0]) {
        const panel = targetElement.component;
        if (panel.inputContext != null && panel.inputContext != InputContext.INVALID) {
          Input.setActiveContext(panel.inputContext);
        }
        targetElement.dispatchEvent(this.receiveFocusEvent);
      }
    }
    this.pushingTarget = null;
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Function will create and the Push() a new elements of specified class type.
   * @param targetClassName string of HTMLElement type to create
   */
  push(targetClassName, prop) {
    if (this.pushingClassName != null && targetClassName != "mouse-guard") {
      console.warn(
        `ContextManager.push() is already in the process of pushing a screen: ${this.pushingClassName}, attempted to push: ${targetClassName}. This likely means that there is a re-entrant issue with the screen's onAttach logic.`
      );
    }
    this.pushingClassName = targetClassName;
    if (this.screens.length == 0 && targetClassName != "mouse-guard") {
      ViewManager.handleLoseFocus();
    }
    let target;
    if (prop && !prop.singleton) {
      target = document.createElement(targetClassName);
    } else {
      let targetIndex = -1;
      if (targetClassName != "mouse-guard") {
        targetIndex = this.getTargetIndex(targetClassName);
      }
      if (targetIndex == -1) {
        target = document.createElement(targetClassName);
      } else {
        target = this.screens[targetIndex];
      }
      if (!target?.isConnected) {
        if (prop?.attributes) {
          this.passTargetAttributes(target, prop.attributes);
        }
        let possibleSpecificTarget = null;
        if (prop && prop.targetParent) {
          possibleSpecificTarget = prop.targetParent;
        } else {
          possibleSpecificTarget = document.getElementById(`${this.targetSlotPrefix}${targetClassName}`);
        }
        let targetParent = null;
        if (possibleSpecificTarget) {
          targetParent = possibleSpecificTarget;
        } else {
          targetParent = document.querySelector(".fxs-popups");
        }
        if (targetParent) {
          if (targetClassName == "mouse-guard") {
            targetParent.parentNode?.insertBefore(target, targetParent);
          } else {
            targetParent.appendChild(target);
          }
        } else {
          console.error(
            `ContextManager.push() failed to find a targetParent to load the requested screen in to: { classname: ${targetClassName} }`
          );
        }
      } else {
        const screenBeneathTarget = this.screens[targetIndex + 1];
        target = this.screens.splice(targetIndex, 1)[0];
        if (prop?.attributes) {
          this.passTargetAttributes(target, prop.attributes);
        }
        if (screenBeneathTarget?.tagName == "MOUSE-GUARD") {
          screenBeneathTarget?.parentElement?.removeChild(screenBeneathTarget);
          this.screens.splice(targetIndex, 1);
        }
      }
    }
    this.pushElement(target, prop);
    const panel = target.component;
    let viewChangeMethod = UIViewChangeMethod.Unknown;
    if (prop) {
      if (prop.viewChangeMethod) {
        viewChangeMethod = prop.viewChangeMethod;
      }
    }
    const panelContent = panel.getPanelContent ? panel.getPanelContent() : "";
    if (panelContent == "replaying") {
      UI.panelEnd(targetClassName, panelContent, viewChangeMethod, false);
    }
    UI.panelStart(targetClassName, panelContent, viewChangeMethod, true);
    if (prop) {
      if (prop.panelOptions) {
        panel.setPanelOptions(prop.panelOptions);
      }
    }
    this.pushingClassName = null;
    return target;
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Pop the first instance found of an element out of the Context.
   * Note: this does NOT pop anything else. If you want to pop all elements
   * on top of the target, too; use PopUntil().
   * @param target string class name of the screen or element you are looking for
   * @param prop.mustExist optional flag to require the target to exist. A warning in the log generated if flagged but target not found.
   */
  pop(target, prop) {
    if (target == void 0) {
      return;
    }
    let targetElement = void 0;
    if (target instanceof HTMLElement) {
      targetElement = target;
    } else {
      targetElement = this.getTarget(target);
    }
    if (targetElement) {
      let dontDetach = false;
      if (prop && prop.dontDetach) {
        dontDetach = prop.dontDetach;
      }
      if (!dontDetach) {
        targetElement.parentElement?.removeChild(targetElement);
      }
      const foundIndex = this.getTargetIndex(target);
      if (foundIndex == 0) {
        targetElement.dispatchEvent(this.loseFocusEvent);
      }
      if (foundIndex > 0 && prop && prop.mustExist) {
        console.warn(
          `ContextManager.pop() requesting to pop a screen which is not currently the top of the stack. THIS WILL CAUSE PROBLEMS! : classname: ${target}, foundIndex: ${foundIndex}`
        );
        console.log(new Error().stack);
      }
      if (foundIndex >= 0) {
        this.screens.splice(foundIndex, 1);
      }
      if (!dontDetach) {
        targetElement.dispatchEvent(this.popFocusEvent);
      }
      if (this.screens.length > 0 && foundIndex >= 0 && foundIndex <= this.screens.length - 1 && this.screens[foundIndex].tagName == "MOUSE-GUARD") {
        const mouseGuardElement = this.screens[foundIndex];
        mouseGuardElement?.parentElement?.removeChild(mouseGuardElement);
        this.screens.splice(foundIndex, 1);
        mouseGuardElement?.dispatchEvent(this.popFocusEvent);
      }
      let activatedElement;
      if (this.screens.length > 0) {
        if (foundIndex == 0) {
          const screen = this.screens.find((screen2) => {
            const panel2 = screen2.component;
            return panel2.inputContext != void 0 && panel2.inputContext != InputContext.INVALID;
          });
          if (screen) {
            const panel2 = screen.component;
            Input.setActiveContext(panel2.inputContext);
          } else {
            Input.setActiveContext(ViewManager.current.getInputContext());
          }
        }
        activatedElement = this.screens[0];
        if (!activatedElement.contains(document.activeElement)) {
          activatedElement.dispatchEvent(this.receiveFocusEvent);
        }
      } else {
        ViewManager.handleReceiveFocus();
        if (ViewManager.current.getName() == "World") {
          UI.panelDefault();
        }
      }
      engine.trigger(ContextManagerEvents.OnChanged, {
        detail: { activatedElement, deactivatedElement: targetElement }
      });
      engine.trigger(ContextManagerEvents.OnClose, {
        detail: { activatedElement, deactivatedElement: targetElement }
      });
      let viewChangeMethod = UIViewChangeMethod.Unknown;
      if (prop) {
        if (prop.viewChangeMethod) {
          viewChangeMethod = prop.viewChangeMethod;
        }
      }
      const panel = targetElement.component;
      const panelName = targetElement.tagName.toLowerCase();
      const panelContent = panel.getPanelContent ? panel.getPanelContent() : "";
      UI.panelEnd(panelName, panelContent, viewChangeMethod, false);
    }
    if (this.getTarget("mouse-guard") == void 0) {
      const worldInputRule = ViewManager.current.getRules().find((rule) => rule.name == "world-input");
      if (worldInputRule == void 0 || worldInputRule.selectable != void 0 && worldInputRule.selectable == true) {
        ViewManager.isWorldInputAllowed = true;
      }
    }
    if (prop && prop.mustExist) {
      console.warn(
        `ContextManager.pop() failed to find requested screen: { classname: ${target}, prop.mustExist: ${prop.mustExist}`
      );
      console.log(new Error().stack);
    }
    const toptag = this.getCurrentTarget();
    if (toptag != void 0 && toptag.tagName == "MAIN-MENU") {
      ViewManager.isWorldInputAllowed = false;
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Pop all elements until target is reached, NOT INCLUDING target.
   * @param targetClassName string class name of the screen or element you are looking for
   * @param prop optional flags
   */
  popUntil(targetName, prop) {
    DialogBoxManager.clear();
    const foundIndex = this.getTargetIndex(targetName);
    if (foundIndex > 0) {
      const targetTagName = targetName.toUpperCase();
      for (let iScreen = 0; iScreen < foundIndex; iScreen++) {
        if (this.screens[0].tagName == targetTagName) {
          continue;
        }
        this.pop(this.screens[0].tagName, prop);
      }
      return;
    }
    if (prop && prop.mustExist) {
      console.warn(
        `ContextManager.popUntil() failed to find requested screen: { classname: ${targetName}, prop.mustExist: ${prop.mustExist}`
      );
      console.log(new Error().stack);
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Pop all elements until the target is reached AND INCLUDING the target.
   * @param targetClassName string class name of the screen or element you are looking for
   * @param prop optional flags
   */
  popIncluding(targetClassName, prop) {
    const foundIndex = this.getTargetIndex(targetClassName);
    if (foundIndex == 0 && prop && prop.mustExist) {
      console.warn(
        `ContextManager.popIncluding() failed to find requested screen: { classname: ${targetClassName}, prop.mustExist: ${prop.mustExist}`
      );
      console.log(new Error().stack);
    } else {
      this.popUntil(targetClassName, prop);
      this.pop(targetClassName, prop);
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Clear the entire stack, generally down to the HUD.
   */
  clear() {
    let target;
    while (this.screens.length > 0) {
      target = this.getCurrentTarget();
      if (target) {
        this.pop(target);
      }
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Returns a REFERENCE to an HTMLElement, if found in the screen Context array
   * @param targetClassName string class name of the screen or element you are looking for
   */
  getTarget(target) {
    if (target instanceof HTMLElement) {
      return this.screens.find(function(item) {
        return item == target;
      });
    } else {
      const targetTagName = target.toUpperCase();
      return this.screens.find(function(item) {
        return item.tagName == targetTagName;
      });
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Private look up for INDEX of an HTMLElement in the Context array
   * @param target string class name of the screen or element you are looking for
   */
  getTargetIndex(target) {
    if (target instanceof HTMLElement) {
      return this.screens.findIndex(function(item) {
        return item == target;
      });
    } else {
      const targetTagName = target.toUpperCase();
      return this.screens.findIndex(function(item) {
        return item.tagName == targetTagName;
      });
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Returns current HTMLElement at the top of the stack
   */
  getCurrentTarget() {
    if (this.screens.length >= 1) {
      return this.screens[0];
    } else {
      return void 0;
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Returns true if there is any instance of the target class
   * @param targetClassName string class name of the screen or element you are looking for
   */
  hasInstanceOf(targetClassName, prop) {
    if (this.getTargetIndex(targetClassName) > -1) {
      return true;
    } else {
      if (prop && prop.mustExist) {
        console.warn(
          `ContextManager.doesNotHaveInstanceOf() has unexpectedly found the target type: { classname: ${targetClassName}`
        );
        console.log(new Error().stack);
      }
      return false;
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Returns true if the target screen class is atzero in the array
   * @param targetClassName string class name of the screen or element you are looking for
   */
  isCurrentClass(targetClassName) {
    return this.getTargetIndex(targetClassName) == 0;
  }
  /** ------------------------------------------------------------------------------------------------------------------
   * Indicates that the click delay setting has changed.
   */
  updateClickDuration() {
    this.clickDuration = UI.getOption("user", "Accessibility", "LongPressDelay");
    UI.setTouchscreenTapDelay(this.clickDuration);
  }
  /** ------------------------------------------------------------------------------------------------------------------ */
  /** Convert generic key:value object in to HTML attributes  */
  passTargetAttributes(target, attributes) {
    let logInfo = "";
    for (const [key, value] of Object.entries(attributes)) {
      target.setAttribute(key, value);
      logInfo += `${key}: ${value ?? "-"}, `;
    }
    if (DEBUG_LOG_PASSED_ATTRIBUTES) {
      if (logInfo.length > 3) {
        logInfo = logInfo.substring(0, logInfo.length - 2);
      }
      console.log("context-manager, attrs: " + logInfo);
    }
  }
  /** ------------------------------------------------------------------------------------------------------------------ */
  /**
   * Output formatted debugging information to the log.
   */
  log() {
    console.log(`===========================`);
    console.log(`ContextManager log information:`);
    let targetElement;
    let targetInfo = "";
    for (let index = 0; index < this.screens.length; index++) {
      targetElement = this.screens[index];
      if (targetElement == null) {
        targetInfo = `null`;
      } else {
        targetInfo = targetElement.tagName;
      }
      console.log(`${index} 	  ${targetInfo}`);
    }
    console.log(`===========================`);
  }
  //TODO: remove this when we update focus management system.
  //For now, we need to divide when this engine event is used by various parts of UI.
  canUseInput(source, action) {
    switch (source) {
      case "plot-cursor":
        if (this.getCurrentTarget()?.tagName == "TUTORIAL-DIALOG") {
          return false;
        }
        break;
      case "world-input":
      case "notification-train":
        if (action == "action-target" || action == "action-next-action") {
          if (this.hasInstanceOf("screen-tech-tree-chooser") || this.hasInstanceOf("screen-culture-tree-chooser") || this.hasInstanceOf("tutorial-dialog")) {
            return false;
          }
        }
        break;
      case "panel-radial-menu":
        if (this.isCurrentClass(source)) {
          return true;
        }
        if (!this.isEmpty) {
          return false;
        }
        break;
    }
    return true;
  }
  /// Add an input handler; input will be handled in the order provided.
  registerEngineInputHandler(engineEventHandler) {
    this.engineInputEventHandlers.push(engineEventHandler);
  }
  /// Remove an input handler.  (Only loading screen should be doing this!)
  unregisterEngineInputHandler(engineEventHandler) {
    const index = this.engineInputEventHandlers.findIndex((handler) => {
      return handler == engineEventHandler;
    });
    if (index == -1) {
      console.warn("Unable to unregister event handler, not found in list!");
      return;
    }
    this.engineInputEventHandlers.splice(index, 1);
  }
  onSetActivatedEvent(event) {
    this.setLastActivatedComponent(event.detail.component);
  }
  setLastActivatedComponent(component) {
    if (this.lastActivatedComponent != component) {
      if (this.lastActivatedComponent) {
        this.lastActivatedComponent.onDeactivated();
      }
      this.lastActivatedComponent = component;
    }
  }
  shouldSendEventToCursor(inputEvent) {
    return inputEvent.detail.isMouse;
  }
  /**
   * Run through input handlers
   * @param inputEvent An 'engine-input' event to process.
   * @returns true if still valid (may need to be handled) or false if event was cancelled.
   */
  handleInput(inputEvent) {
    if (inputEvent.detail.name == void 0 || inputEvent.type != "engine-input") {
      console.warn(
        "CM: Attempt to process a non 'engine-input' custom event in the input handler: ",
        inputEvent.type
      );
      return true;
    }
    if (inputEvent.detail.status == InputActionStatuses.START && (inputEvent.detail.isMouse || inputEvent.detail.isTouch)) {
      this.dragStartingTarget = Cursor.target;
      this.dragStartingTime = Date.now();
    }
    if (inputEvent.detail.status == InputActionStatuses.DRAG && inputEvent.detail.name != "mousebutton-right" && (inputEvent.detail.isMouse || inputEvent.detail.isTouch)) {
      this.ignoreCursorTargetDueToDragging = true;
    }
    const focusManager = FocusManager.get();
    if (focusManager.isFocusActive() && !inputEvent.detail.isTouch && !this.shouldSendEventToCursor(inputEvent)) {
      focusManager.currentFocus().dispatchEvent(inputEvent);
      if (inputEvent.defaultPrevented) {
        return false;
      }
    }
    let skipFinishOnDrag = false;
    if (inputEvent.detail.status == InputActionStatuses.FINISH && this.ignoreCursorTargetDueToDragging) {
      const dragLength = Date.now() - this.dragStartingTime;
      this.ignoreCursorTargetDueToDragging = false;
      if (Cursor.target == document.body && dragLength >= this.clickDuration) {
        return true;
      } else {
        if (Cursor.target == this.dragStartingTarget) {
          if (dragLength >= this.clickDuration) {
            skipFinishOnDrag = true;
          }
        } else {
          skipFinishOnDrag = true;
        }
      }
    }
    if (!skipFinishOnDrag) {
      if (this.shouldSendEventToCursor(inputEvent) && Cursor.target instanceof HTMLElement) {
        Cursor.target.dispatchEvent(inputEvent);
        if (inputEvent.defaultPrevented) {
          return false;
        }
      }
    }
    if (inputEvent.detail.isTouch) {
      const element = document.elementFromPoint(inputEvent.detail.x, inputEvent.detail.y);
      element?.dispatchEvent(inputEvent);
      if (inputEvent.defaultPrevented) {
        return false;
      }
    }
    const currentTarget = this.getCurrentTarget();
    if (currentTarget != void 0) {
      currentTarget.dispatchEvent(inputEvent);
      if (inputEvent.defaultPrevented) {
        return false;
      }
    }
    if (inputEvent.detail.status == InputActionStatuses.FINISH && ["mousebutton-left", "accept", "touch-tap"].includes(inputEvent.detail.name)) {
      this.setLastActivatedComponent(null);
    }
    return !this.engineInputEventHandlers.some((handler) => {
      return handler.handleInput(inputEvent) == InputHandlerState.Handled;
    });
  }
  /**
   * Handle focus navigation specific events.  These are based on input events but may bounce around the system more based on the rules slots contain.
   * @param navigationEvent Event with navigation details.
   * @returns true if even is still valid, or false if it was cancelled.
   */
  handleNavigation(navigationEvent) {
    const focusManager = FocusManager.get();
    let focus = focusManager.currentFocus();
    if (!focus.isConnected) {
      focusManager.realizeFocus(false);
      focus = focusManager.currentFocus();
    }
    focus.dispatchEvent(navigationEvent);
    if (!navigationEvent.defaultPrevented && this.getCurrentTarget() != void 0) {
      this.getCurrentTarget().dispatchEvent(navigationEvent);
    }
    let cancelled = navigationEvent.defaultPrevented;
    if (!cancelled) {
      cancelled = this.engineInputEventHandlers.some((handler) => {
        return handler.handleNavigation(navigationEvent) == InputHandlerState.Handled;
      });
    }
    return !cancelled;
  }
  /**
   * Since the context manager lives in the shell and game, it would be best
   * to move a pause menu out to a game specific area only.
   * @returns true, if the pause menu can be raised.
   */
  canOpenPauseMenu() {
    const pausingDisabled = DisplayQueueManager.activeDisplays.some((request) => request.disablesPausing);
    if (pausingDisabled) {
      return false;
    }
    if (ContextManager.getTarget("endgame-screen")) {
      return false;
    }
    const victoryProgress = ContextManager.getTarget("screen-victory-progress");
    if (victoryProgress && victoryProgress.getAttribute("endGameScreen") == "true") {
      return false;
    }
    if (ViewManager && ViewManager.current.getName() == "Diplomacy") {
      return false;
    }
    const isCinematic = DisplayQueueManager.activeDisplays.some((request) => request.category === "Cinematic") || ViewManager.current.getName() == "Cinematic";
    return !isCinematic && !GameContext.hasSentRetire();
  }
  isGameActive() {
    return (!Game.AgeProgressManager.isAgeOver || Game.AgeProgressManager.isExtendedGame) && !GameContext.hasSentRetire();
  }
  canSaveGame() {
    return this.isGameActive();
  }
  canLoadGame() {
    return this.isGameActive();
  }
  /** Should the UI show a modal popup, based on the input player
   * This helps prevent popups from being shown if automation is
   * running.
   */
  shouldShowPopup(playerId) {
    if (playerId == GameContext.localPlayerID && !Automation.isActive) {
      return Players.isParticipant(playerId) && Players.isHuman(playerId);
    }
    return false;
  }
  // Similar to a popup, but called out differently for usage context
  shouldShowModalEvent(playerId) {
    if (playerId == GameContext.localPlayerID && !Automation.isActive) {
      return Players.isParticipant(playerId) && Players.isHuman(playerId);
    }
    return false;
  }
  // Check to see if there is no user input active.
  noUserInput() {
    return Automation.isActive || Autoplay.isActive || Players.isParticipant(GameContext.localPlayerID) == false || Players.isHuman(GameContext.localPlayerID) == false;
  }
}
const ContextManager = ContextManagerSingleton.getInstance();
setContextManager(ContextManager);

export { ContextManager, ContextManagerEvents, ContextManager as default };
//# sourceMappingURL=context-manager.js.map
