import { Audio } from '../../../core/ui/audio-base/audio-support.js';
import { ActiveDeviceTypeChangedEventName } from '../../../core/ui/input/input-events.js';
import { PlotCursor } from '../../../core/ui/input/plot-cursor.js';
import { InterfaceMode } from '../../../core/ui/interface-modes/interface-modes.js';
import Panel, { AnchorType } from '../../../core/ui/panel-support.js';
import { SpriteSheetAnimation } from '../../../core/ui/utilities/animations.js';
import { ComponentID } from '../../../core/ui/utilities/utilities-component-id.js';
import { MustGetElement } from '../../../core/ui/utilities/utilities-dom.js';
import { Icon } from '../../../core/ui/utilities/utilities-image.js';
import UpdateGate from '../../../core/ui/utilities/utilities-update-gate.js';
import { IsControllerActive } from '../../../core/ui-next/services/input.js';
import getAdviceManager from '../advice/advice-manager.js';
import { NotificationModel } from '../notification-train/model-notification-train.js';
import WatchOutManager from '../watch-out/watch-out-manager.js';
import styles from './panel-action.scss.js';

const TURN_BLOCKING_NOTIFICATION_ICON_COUNT = 8;
const TIMER_FLASH_START = 20;
class PanelAction extends Panel {
  actionButton = document.createElement("fxs-activatable");
  mpTurnTimerContainer = document.createElement("div");
  mpTimerMaxTime = 0;
  turnTimerElement;
  timerAnimationElements = [];
  notificationIcon = document.createElement("div");
  actionText = document.createElement("p");
  lastPlayerMessageContainer = null;
  navHelpContainer = null;
  lastPlayerMessageVisibility = false;
  pleaseWaitAnimation = new SpriteSheetAnimation(
    this.notificationIcon,
    { imageName: "blp:ntf_pleasewait_anim", rows: 4, cols: 4, frames: 10 },
    1e3
  );
  static actionIconCache = new ImageCache();
  updateGate = new UpdateGate(this.onUpdate.bind(this));
  engineInputListener = this.onEngineInput.bind(this);
  activeDeviceChangedEventListener = this.onActiveDeviceChanged.bind(this);
  nextActionHotKeyListener = this.onNextActionHotkey.bind(this);
  centerButtonAnimListener = this.centerButtonAnimEnd.bind(this);
  inputContextChangedListener = this.inputContextChanged.bind(this);
  notificationSlots = new Array(
    TURN_BLOCKING_NOTIFICATION_ICON_COUNT
  );
  currentTurnTimerDisplay = 0;
  onInitialize() {
    this.animateInType = this.animateOutType = AnchorType.RelativeToBottom;
    const frag = document.createDocumentFragment();
    const actionPanelContainer = document.createElement("div");
    actionPanelContainer.classList.add("action-panel__button", "primary-action-button", "tut-action-button");
    const actionButtonBk = document.createElement("div");
    actionButtonBk.classList.add("action-panel__button-bk");
    actionPanelContainer.appendChild(actionButtonBk);
    const actionButtonGear = document.createElement("div");
    actionButtonGear.classList.add("action-panel__button-gear", "absolute", "pointer-events-none");
    actionPanelContainer.appendChild(actionButtonGear);
    const actionButtonMain = document.createElement("div");
    actionButtonMain.classList.add("action-panel__button-main");
    actionPanelContainer.appendChild(actionButtonMain);
    const actionButtonDecor = document.createElement("div");
    actionButtonDecor.classList.add("action-panel__button-decor");
    actionPanelContainer.appendChild(actionButtonDecor);
    const actionButtonUnitBracket = document.createElement("div");
    actionButtonUnitBracket.classList.add("action-panel__unit-bracket");
    actionPanelContainer.appendChild(actionButtonUnitBracket);
    const actionButtonTextPlateContainer = document.createElement("div");
    actionButtonTextPlateContainer.classList.add(
      "action-panel__button-txt-plate-container",
      "flex",
      "flex-col",
      "absolute",
      "items-end"
    );
    actionPanelContainer.appendChild(actionButtonTextPlateContainer);
    if (Configuration.getGame().isAnyMultiplayer) {
      this.lastPlayerMessageContainer = document.createElement("div");
      this.lastPlayerMessageContainer.classList.add(
        "action-panel__last-player-message",
        "mb-4",
        "-mr-4",
        "px-2",
        "text-shadow",
        "hidden"
      );
      actionButtonTextPlateContainer.appendChild(this.lastPlayerMessageContainer);
      const lastPlayerMessageBackground = document.createElement("div");
      lastPlayerMessageBackground.classList.add("action-panel__last-player-message-background");
      this.lastPlayerMessageContainer.appendChild(lastPlayerMessageBackground);
      const lastPlayerMessageText = document.createElement("div");
      lastPlayerMessageText.classList.add("action-panel__last-player-message-text");
      lastPlayerMessageText.setAttribute("data-l10n-id", "LOC_ACTION_PANEL_LAST_PLAYER_MESSAGE");
      lastPlayerMessageBackground.appendChild(lastPlayerMessageText);
      if (this.isLastPlayerInMPTurn()) {
        this.lastPlayerMessageShow();
      }
    }
    const actionButtonTextPlate = document.createElement("div");
    actionButtonTextPlate.classList.add("action-panel__button-txt-plate", "relative");
    actionButtonTextPlateContainer.appendChild(actionButtonTextPlate);
    const actionButtonTxtPlateBk = document.createElement("div");
    actionButtonTxtPlateBk.classList.add("action-panel__button-txt-plate__bk");
    actionButtonTextPlate.appendChild(actionButtonTxtPlateBk);
    this.navHelpContainer = document.createElement("div");
    this.navHelpContainer.classList.add("action-panel__nav-help-container");
    this.navHelpContainer.classList.toggle("gamepad-active", IsControllerActive());
    actionButtonTextPlate.appendChild(this.navHelpContainer);
    const navHelp = document.createElement("fxs-nav-help");
    navHelp.setAttribute("action-key", "inline-next-action");
    navHelp.setAttribute("decoration-mode", "border");
    this.navHelpContainer.appendChild(navHelp);
    const navHelpExt = document.createElement("div");
    navHelpExt.classList.add("action-panel__nav-help-ext");
    this.navHelpContainer.appendChild(navHelpExt);
    this.actionText.classList.add(
      "action-panel__button-txt-plate__text",
      "text-right",
      "relative",
      "font-title",
      "text-secondary",
      "font-bold",
      "text-xs",
      "tut-action-panel",
      "tut-action-text",
      "uppercase",
      "font-fit-shrink"
    );
    this.actionText.setAttribute("data-tooltip-content", "LOC_ACTION_PANEL_TAKE_THE_NEXT_ACTION");
    actionButtonTextPlate.appendChild(this.actionText);
    this.actionButton.classList.add("action-panel__button-next-action");
    this.actionButton.setAttribute("data-tooltip-content", Locale.compose("LOC_ACTION_PANEL_TAKE_THE_NEXT_ACTION"));
    this.actionButton.setAttribute("data-audio-group-ref", "turn-action");
    this.actionButton.setAttribute("data-audio-activate-ref", "data-audio-activate");
    this.actionButton.setAttribute("data-vfx-path", "turn-action-button");
    actionPanelContainer.appendChild(this.actionButton);
    const actionButtonNotificationContainer = document.createElement("div");
    actionButtonNotificationContainer.classList.add("absolute", "inset-0", "pointer-events-none");
    for (let i = 1; i <= TURN_BLOCKING_NOTIFICATION_ICON_COUNT; i++) {
      const actionButtonNotification = document.createElement("fxs-activatable");
      actionButtonNotification.classList.add("action-panel__button-notification");
      actionButtonNotification.setAttribute("data-audio-group-ref", "turn-action");
      actionButtonNotification.setAttribute("data-audio-press-ref", "none");
      actionButtonNotification.setAttribute("data-audio-activate-ref", "none");
      actionButtonNotification.setAttribute("data-audio-focus-ref", "none");
      actionButtonNotificationContainer.appendChild(actionButtonNotification);
      const actionButtonNotificationContent = document.createElement("div");
      actionButtonNotificationContent.classList.add("action-panel__button-notification__content");
      actionButtonNotification.appendChild(actionButtonNotificationContent);
      const actionButtonBk2 = document.createElement("div");
      actionButtonBk2.classList.add("action-panel__button-notification__bk");
      actionButtonNotificationContent.appendChild(actionButtonBk2);
      const actionButtonNotificationIcon = document.createElement("div");
      actionButtonNotificationIcon.classList.add("action-panel__button-notification__icon");
      actionButtonBk2.appendChild(actionButtonNotificationIcon);
      actionButtonNotification.addEventListener("action-activate", this.onActionPanelBlockerActivated);
      this.notificationSlots[i - 1] = {
        notificationId: null,
        notificationType: null,
        parentEle: actionButtonNotification,
        bgEle: actionButtonBk2,
        iconEle: actionButtonNotificationIcon
      };
    }
    actionPanelContainer.appendChild(actionButtonNotificationContainer);
    this.actionButton.setAttribute("data-tut-highlight", "founderHighlight");
    this.notificationIcon.classList.add("action-panel__button-next-action__icon");
    this.actionButton.appendChild(this.notificationIcon);
    const notificationIconHover = this.notificationIcon.cloneNode();
    notificationIconHover.classList.add("action-panel__button-next-action__icon--hover");
    this.actionButton.appendChild(notificationIconHover);
    const notificationIconActive = this.notificationIcon.cloneNode();
    notificationIconActive.classList.add("action-panel__button-next-action__icon--active");
    this.actionButton.appendChild(notificationIconActive);
    this.actionButton.addEventListener("action-activate", this.onActionButton.bind(this));
    this.mpTurnTimerContainer.classList.add(
      "action_panel_mp-timer-container",
      "size-32",
      "flex",
      "justify-center",
      "items-center",
      "hidden"
    );
    this.mpTurnTimerContainer.innerHTML = `
			<div class="action_panel__mp-timer-bk size-32 absolute bg-contain pointer-events-none overflow-hidden -left-2\\.5 -top-2\\.5"></div>
			<div class="action_panel__mp-timer-front action_panel__mp-timer-left-circle size-32 absolute bg-contain pointer-events-none overflow-hidden -left-2\\.5 -top-2\\.5 animated"></div>
			<div class="action_panel__mp-timer-bk action_panel__mp-timer-right-bk-circle size-32 absolute bg-contain pointer-events-none overflow-hidden -left-2\\.5 -top-2\\.5"></div>
			<div class="action_panel__mp-timer-front action_panel__mp-timer-right-circle size-32 absolute bg-contain pointer-events-none overflow-hidden -left-2\\.5 -top-2\\.5 animated"></div>
			<div class="action_panel__mp-timer-bk action_panel__mp-timer-left-bk-circle size-32 absolute bg-contain pointer-events-none overflow-hidden -left-2\\.5 -top-2\\.5 animated"></div>
			<div class="action_panel__mp-timer-countdown size-18 absolute bg-no-repeat bg-cover -bottom-2\\.5 flex justify-center items-center left-6 pointer-events-none overflow-hidden">
				<div id="action_panel__mp-turntimer"></div>
			</div>
		`;
    this.actionButton.appendChild(this.mpTurnTimerContainer);
    this.timerAnimationElements = Array.from(this.mpTurnTimerContainer.querySelectorAll("div.animated"));
    frag.appendChild(actionPanelContainer);
    this.Root.appendChild(frag);
    this.updateGate.call("onInitialize");
  }
  onAttach() {
    super.onAttach();
    engine.on("AutoplayEnded", this.onAutoplayEnd, this);
    engine.on("AutoplayStarted", this.onAutoplayStarted, this);
    engine.on("GameStarted", this.onGameStarted, this);
    engine.on("LocalPlayerChanged", this.onLocalPlayerChanged, this);
    engine.on("LocalPlayerTurnBegin", this.onLocalPlayerTurnBegin, this);
    engine.on("LocalPlayerTurnEnd", this.onLocalPlayerTurnEnd, this);
    engine.on("NotificationAdded", this.onNotificationAdded, this);
    engine.on("NotificationDismissed", this.onNotificationDismissed, this);
    engine.on("NotificationUpdated", this.onNotificationUpdated, this);
    engine.on("PlayerTurnActivated", this.onPlayerTurnActivated, this);
    engine.on("PlayerTurnDeactivated", this.onPlayerTurnDeactivated, this);
    engine.on("RemotePlayerTurnBegin", this.remotePlayerTurnChanged, this);
    engine.on("RemotePlayerTurnEnd", this.remotePlayerTurnChanged, this);
    engine.on("UnitMoved", this.onUnitMoved, this);
    engine.on("UnitActivityChanged", this.onUnitActivityChanged, this);
    engine.on("UnitBermudaTeleported", this.onUnitBermudaTeleported, this);
    engine.on("UnitOperationStarted", this.onUnitOperationStart, this);
    engine.on("UnitAddedToMap", this.onUnitNumModified, this);
    engine.on("UnitRemovedFromMap", this.onUnitNumModified, this);
    engine.on("TurnTimerUpdated", this.onTurnTimerUpdated, this);
    engine.on("GamePauseStateChanged", this.onGamePauseStateChanged, this);
    engine.on("InputContextChanged", this.inputContextChangedListener);
    window.addEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceChangedEventListener);
    window.addEventListener("engine-input", this.engineInputListener);
    window.addEventListener("hotkey-next-action", this.nextActionHotKeyListener);
  }
  onActiveDeviceChanged() {
    this.navHelpContainer?.classList.toggle("gamepad-active", IsControllerActive());
  }
  onDetach() {
    engine.off("AutoplayEnded", this.onAutoplayEnd, this);
    engine.off("AutoplayStarted", this.onAutoplayStarted, this);
    engine.off("GameStarted", this.onGameStarted, this);
    engine.off("LocalPlayerChanged", this.onLocalPlayerChanged, this);
    engine.off("LocalPlayerTurnBegin", this.onLocalPlayerTurnBegin, this);
    engine.off("LocalPlayerTurnEnd", this.onLocalPlayerTurnEnd, this);
    engine.off("NotificationAdded", this.onNotificationAdded, this);
    engine.off("NotificationDismissed", this.onNotificationDismissed, this);
    engine.off("NotificationUpdated", this.onNotificationUpdated, this);
    engine.off("PlayerTurnActivated", this.onPlayerTurnActivated, this);
    engine.off("PlayerTurnDeactivated", this.onPlayerTurnDeactivated, this);
    engine.off("RemotePlayerTurnBegin", this.remotePlayerTurnChanged, this);
    engine.off("RemotePlayerTurnEnd", this.remotePlayerTurnChanged, this);
    engine.off("UnitMoved", this.onUnitMoved, this);
    engine.off("UnitActivityChanged", this.onUnitActivityChanged, this);
    engine.off("UnitBermudaTeleported", this.onUnitBermudaTeleported, this);
    engine.off("UnitOperationStarted", this.onUnitOperationStart, this);
    engine.off("UnitAddedToMap", this.onUnitNumModified, this);
    engine.off("UnitRemovedFromMap", this.onUnitNumModified, this);
    engine.off("TurnTimerUpdated", this.onTurnTimerUpdated, this);
    engine.off("InputContextChanged", this.inputContextChangedListener);
    window.removeEventListener(ActiveDeviceTypeChangedEventName, this.activeDeviceChangedEventListener);
    window.removeEventListener("engine-input", this.engineInputListener);
    window.removeEventListener("hotkey-next-action", this.nextActionHotKeyListener);
    super.onDetach();
  }
  inputContextChanged(contextData) {
    switch (contextData.newContext) {
      case InputContext.Shell:
        this.navHelpContainer?.classList.remove("action-available");
        this.navHelpContainer?.classList.add("hidden");
        break;
      case InputContext.Dual:
        this.navHelpContainer?.classList.remove("action-available");
        this.navHelpContainer?.classList.add("hidden");
        break;
      default:
        this.navHelpContainer?.classList.add("action-available");
        this.navHelpContainer?.classList.remove("hidden");
    }
  }
  onGameStarted() {
    this.updatePlayerFocus(GameContext.localPlayerID);
  }
  onActionPanelBlockerActivated = (event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const notificationId = this.notificationSlots.find((slot) => slot.parentEle === event.target)?.notificationId;
    if (notificationId) {
      Game.Notifications.activate(notificationId);
    }
  };
  disableButton() {
    this.Root.classList.add("disabled", "action-panel--disabled");
    this.actionButton?.classList.add("disabled");
  }
  enableButton() {
    this.Root.classList.remove("disabled", "action-panel--disabled");
    this.actionButton?.classList.remove("disabled");
  }
  disableActionButton() {
    this.disableButton();
  }
  enableActionButton() {
    if (!Autoplay.isActive) {
      this.enableButton();
    }
  }
  /**
   * Engine callback - autoplay ended
   */
  onAutoplayEnd() {
    this.enableButton();
    this.notificationIcon?.classList.remove("hidden");
  }
  /**
   * Engine callback - autoplay started
   */
  onAutoplayStarted() {
    this.disableButton();
  }
  onLocalPlayerTurnBegin() {
    this.enableButton();
  }
  onLocalPlayerTurnEnd() {
    PanelAction.actionIconCache.unloadAllImages();
    if (!Configuration.getGame().isAnyMultiplayer) {
      this.disableButton();
    }
    this.timerAnimationElements.forEach((element) => {
      element.style.animationDelay = "0s";
    });
    this.updateGate.call("onLocalPlayerTurnEnd");
  }
  remotePlayerTurnChanged(data) {
    if (Configuration.getGame().isAnyMultiplayer) {
      const playerConfig = Configuration.getPlayer(data.turnPlayer);
      if (playerConfig.isHuman) {
        this.updateGate.call("remotePlayerTurnChanged");
      }
    }
  }
  updatePlayerFocus(playerId) {
    if (UI.getOption("user", "Interface", "NotificationCameraPan") == 0) {
      return;
    }
    const endTurnBlockingType = Game.Notifications.getEndTurnBlockingType(playerId);
    if (endTurnBlockingType != EndTurnBlockingTypes.NONE) {
      if (InterfaceMode.isInInterfaceMode("INTERFACEMODE_DEFAULT") && endTurnBlockingType == EndTurnBlockingTypes.UNITS) {
        const selectedUnitID = UI.Player.getHeadSelectedUnit();
        if (!selectedUnitID) {
          const nextReadyUnitID = UI.Player.getFirstReadyUnit();
          if (nextReadyUnitID) {
            UI.Player.lookAtID(nextReadyUnitID, 0);
            UI.Player.selectUnit(nextReadyUnitID);
            return;
          }
        }
      } else {
        if (!ComponentID.isValid(UI.Player.getHeadSelectedUnit())) {
          const endTurnBlockingNotificationId = Game.Notifications.findEndTurnBlocking(
            playerId,
            endTurnBlockingType
          );
          if (endTurnBlockingNotificationId) {
            NotificationModel.manager.lookAt(endTurnBlockingNotificationId);
            return;
          }
        }
      }
    }
  }
  onUpdate() {
    const localPlayerID = GameContext.localPlayerID;
    this.refreshActionButton(localPlayerID);
    this.updatePlayerFocus(localPlayerID);
  }
  playNextActionAnimation(iconElement, animation, iconURL) {
    iconElement.style.backgroundImage = "none";
    iconElement.classList.remove("animate-in", "animate-out", "animate-swap");
    requestAnimationFrame(() => {
      iconElement.style.backgroundImage = `url(${iconURL})`;
      iconElement.classList.add(animation);
    });
    const endTurnBlockingType = Game.Notifications.getEndTurnBlockingType(
      GameContext.localPlayerID
    );
    const endTurnBlockingNotificationId = Game.Notifications.findEndTurnBlocking(
      GameContext.localPlayerID,
      endTurnBlockingType
    );
    if (endTurnBlockingNotificationId) {
      NotificationModel.manager.playAudio(endTurnBlockingNotificationId, "Add");
    }
  }
  playBlockerAnimation(slot, animation) {
    slot.bgEle.classList.remove("animate-in", "animate-out", "animate-swap");
    if (animation == "animate-out") {
      Audio.playSound("data-audio-turn-button-next-action");
    }
    requestAnimationFrame(() => {
      slot.bgEle.classList.add(animation);
    });
  }
  showBlockerIcon(slot, notification) {
    const notificationId = notification.id;
    if (!notificationId) {
      console.error("showBlockerIcon called without notificationId set");
      return;
    }
    slot.parentEle.classList.remove("pointer-events-none", "opacity-0");
    const iconName = Icon.getNotificationIconFromID(notificationId);
    const iconUrl = notificationId ? `url(${iconName})` : "";
    slot.iconEle.style.backgroundImage = iconUrl;
    const message = Game.Notifications.getMessage(notificationId);
    if (message) {
      slot.parentEle.setAttribute("data-tooltip-content", Locale.compose(message));
    } else {
      slot.parentEle.removeAttribute("data-tooltip-content");
    }
    if (slot.notificationType === null) {
      UI.sendAudioEvent(Audio.getSoundTag("data-audio-turn-action-appear", "turn-action"));
      this.playBlockerAnimation(slot, "animate-in");
    } else {
      this.playBlockerAnimation(slot, "animate-in");
    }
    slot.notificationType = notification.type;
    slot.notificationId = notification.id;
  }
  hideBlockerIcon(slot) {
    slot.parentEle.classList.add("pointer-events-none");
    slot.parentEle.removeAttribute("data-tooltip-content");
    if (slot.notificationType !== null) {
      this.playBlockerAnimation(slot, "animate-out");
    } else {
      slot.parentEle.classList.add("opacity-0");
    }
    slot.notificationType = null;
    slot.notificationId = null;
  }
  getNotificationInfo(notificationId) {
    const type = Game.Notifications.getType(notificationId);
    if (type) {
      return {
        id: notificationId,
        type,
        severity: Game.Notifications.getSeverity(notificationId) ?? 0
      };
    }
    return null;
  }
  refreshActionButton(playerID) {
    this.navHelpContainer?.classList.remove("action-available");
    if (Players.isValid(playerID)) {
      const player = Players.get(playerID);
      if (!player) {
        console.error(
          "panel-action: local player has valid id #" + playerID + ", but could not obtain a valid player object."
        );
        return;
      }
      if (Configuration.getGame().isPaused) {
        this.setMultiplayerPaused();
        return;
      }
      const endTurnBlockingType = Game.Notifications.getEndTurnBlockingType(playerID);
      const endTurnBlockingNotificationId = Game.Notifications.findEndTurnBlocking(playerID, endTurnBlockingType);
      const notificationIds = Game.Notifications.getIdsForPlayer(playerID) ?? [];
      if (endTurnBlockingType == EndTurnBlockingTypes.VIEW_ADVISOR_WARNING && !WatchOutManager.isManagerActive && !getAdviceManager().isAnyFollowed()) {
        this.setEndTurnWaiting();
        return;
      }
      const notificationInfos = notificationIds.map((id) => this.getNotificationInfo(id)).filter(
        (n) => n != null && Game.Notifications.getBlocksTurnAdvancement(n.id) && !ComponentID.isMatch(n.id, endTurnBlockingNotificationId)
      ).sort((a, b) => b.severity - a.severity);
      let requiresRearrange = false;
      if (notificationIds) {
        const validNotifications = [];
        for (const notificationInfo of notificationInfos) {
          const iconSrc = Icon.getNotificationIconFromID(notificationInfo.id);
          PanelAction.actionIconCache.loadImage(iconSrc);
        }
        for (let i = 0; i < notificationInfos.length && validNotifications.length < TURN_BLOCKING_NOTIFICATION_ICON_COUNT; ++i) {
          const info = notificationInfos[i];
          if (!validNotifications.some((n) => n.type == info.type)) {
            validNotifications.push(info);
            if (!this.notificationSlots.some((s) => s.notificationType === info.type)) {
              requiresRearrange = true;
            }
          }
        }
        let radialNotifCount = 0;
        for (let i = 0; i < TURN_BLOCKING_NOTIFICATION_ICON_COUNT; ++i) {
          const slot = this.notificationSlots[i];
          const notification = requiresRearrange ? validNotifications[i] : validNotifications.find((n) => n.type === slot.notificationType);
          if (!notification) {
            slot.parentEle.setAttribute("data-audio-press-ref", "none");
            slot.parentEle.setAttribute("data-audio-activate-ref", "none");
            this.hideBlockerIcon(slot);
          } else if (slot.notificationType != notification.type) {
            radialNotifCount++;
            slot.parentEle.setAttribute("data-audio-press-ref", "data-audio-notif-press");
            slot.parentEle.setAttribute("data-audio-activate-ref", "data-audio-notif-release");
            slot.parentEle.setAttribute("data-audio-focus-ref", "data-audio-notif-focus");
            Audio.playSound("data-audio-notif-" + radialNotifCount, "turn-action");
            this.showBlockerIcon(slot, notification);
          } else {
            slot.notificationId = notification.id;
            const message = Game.Notifications.getMessage(notification.id);
            if (message) {
              slot.parentEle.setAttribute("data-tooltip-content", Locale.compose(message));
            } else {
              slot.parentEle.removeAttribute("data-tooltip-content");
            }
          }
        }
      }
      if (player.isTurnActive == false || GameContext.hasSentTurnComplete()) {
        this.setEndTurnWaiting();
        return;
      }
      this.navHelpContainer?.classList.add("action-available");
      let foundNotification = false;
      if (endTurnBlockingType != EndTurnBlockingTypes.NONE) {
        if (endTurnBlockingNotificationId) {
          const endTurnBlockingNotification = Game.Notifications.find(endTurnBlockingNotificationId);
          if (endTurnBlockingNotification) {
            const message = Game.Notifications.getMessage(endTurnBlockingNotificationId);
            if (message) {
              this.pleaseWaitAnimation.stop();
              const iconSrc = Icon.getNotificationIconFromID(endTurnBlockingNotificationId, "BUBBLE");
              this.playNextActionAnimation(this.notificationIcon, "animate-in", iconSrc);
              this.notificationIcon.addEventListener("animationend", this.centerButtonAnimListener);
              const notificationTypeName = Game.Notifications.getTypeName(
                endTurnBlockingNotification.Type
              );
              if (requiresRearrange) {
                switch (notificationTypeName) {
                  case "NOTIFICATION_CHOOSE_CITY_PRODUCTION":
                    UI.sendAudioEvent(
                      Audio.getSoundTag("data-audio-city-production-ready", "city-actions")
                    );
                    break;
                  case "NOTIFICATION_NEW_POPULATION":
                    UI.sendAudioEvent(
                      Audio.getSoundTag("data-audio-city-growth-ready", "city-growth")
                    );
                    break;
                  case "NOTIFICATION_CHOOSE_TECH":
                    UI.sendAudioEvent(
                      Audio.getSoundTag(
                        "data-audio-tech-tree-ready",
                        "audio-screen-tech-tree-chooser"
                      )
                    );
                    break;
                  case "NOTIFICATION_CHOOSE_CULTURE_NODE":
                    UI.sendAudioEvent(
                      Audio.getSoundTag(
                        "data-audio-culture-tree-chooser-ready",
                        "audio-screen-culture-tree-chooser"
                      )
                    );
                    break;
                  case "NOTIFICATION_CHOOSE_GOVERNMENT":
                    UI.sendAudioEvent(
                      Audio.getSoundTag(
                        "data-audio-policy-chooser-ready",
                        "audio-policy-chooser"
                      )
                    );
                    break;
                  case "NOTIFICATION_CHOOSE_GOLDEN_AGE":
                    UI.sendAudioEvent(
                      Audio.getSoundTag(
                        "data-audio-golden-age-chooser-ready",
                        "golden-age-chooser"
                      )
                    );
                    break;
                }
              }
              this.actionButton.setAttribute("data-tooltip-content", Locale.compose(message));
              this.actionText.textContent = Locale.compose(message);
              this.Root.classList.add("new-notification");
              foundNotification = true;
            }
          }
        }
      } else if (this.showRemainingMovesState()) {
        const message = "LOC_ACTION_PANEL_UNIT_MOVES_REMAINING";
        const tooltip = "LOC_ACTION_PANEL_UNIT_MOVES_REMAINING_TT";
        const iconSrc = UI.getIconURL("NOTIFICATION_COMMAND_UNITS", "BUBBLE");
        this.pleaseWaitAnimation.stop();
        this.notificationIcon.style.backgroundImage = `url(${iconSrc})`;
        this.actionButton.setAttribute("data-tooltip-content", Locale.compose(tooltip));
        this.actionText.textContent = Locale.compose(message);
        this.Root.classList.add("new-notification");
        foundNotification = true;
      } else if (Configuration.getUser().isAutoEndTurn == true && !GameContext.hasSentTurnUnreadyThisTurn()) {
        this.sendEndTurn();
      }
      if (!foundNotification) {
        const isFinalAge = Game.AgeProgressManager.isFinalAge;
        const ageProgress = Game.AgeProgressManager.getCurrentAgeProgressionPoints();
        const maxAgeProgress = Game.AgeProgressManager.getMaxAgeProgressionPoints();
        const showAgeTransition = !isFinalAge && maxAgeProgress - ageProgress <= 0;
        const iconSrc = showAgeTransition ? UI.getIconURL("NOTIFICATION_CHOOSE_CIVILIZATION", "BUBBLE") : UI.getIconURL("NEXT_TURN", "NOTIFICATION");
        const displayText = showAgeTransition ? "LOC_END_GAME_TRANSITION" : "LOC_ACTION_PANEL_NEXT_TURN";
        this.actionText.textContent = Locale.compose(displayText);
        this.actionButton.setAttribute("data-tooltip-content", Locale.compose(displayText));
        this.pleaseWaitAnimation.stop();
        this.notificationIcon.style.backgroundImage = `url(${iconSrc})`;
        this.Root.classList.remove("new-notification");
      }
    } else {
      this.notificationIcon?.classList.add("hidden");
      if (Autoplay.isActive) {
        this.actionButton.setAttribute("data-tooltip-content", Locale.compose("LOC_ACTION_PANEL_AUTO_PLAYING"));
        this.actionText.textContent = Locale.compose("LOC_ACTION_PANEL_AUTO_PLAYING");
      } else {
        this.actionButton.setAttribute("data-tooltip-content", Locale.compose("LOC_ACTION_PANEL_PLEASE_WAIT"));
        this.actionText.textContent = Locale.compose("LOC_ACTION_PANEL_PLEASE_WAIT");
        this.pleaseWaitAnimation.start();
      }
    }
  }
  centerButtonAnimEnd(event) {
    if (event.animationName == "turnActionScale") {
      event.target?.removeEventListener("animationend", this.centerButtonAnimListener);
    }
  }
  // Set the end turn button to the approprate "Please Wait" state.
  setEndTurnWaiting() {
    if (!this.actionButton) {
      console.error("panel-action: unable to find the action button element during setEndTurnWaiting!");
      return;
    }
    if (!this.actionText) {
      console.error("panel-action: unable to find the action text element during setEndTurnWaiting!");
      return;
    }
    if (!this.notificationIcon) {
      console.error("panel-action: unable to find the notification icon element during setEndTurnWaiting!");
      return;
    }
    let activePlayersList = "";
    let buttonText = "";
    let tooltip = "";
    if (Configuration.getGame().isAnyMultiplayer) {
      const playerList = Players.getAlive();
      for (const player of playerList) {
        if (player.isHuman && player.isTurnActive) {
          const playerName = player.name.replace(new RegExp(" ", "g"), "&nbsp;");
          activePlayersList += `[N]${playerName}`;
        }
      }
    }
    if (activePlayersList == "") {
      buttonText = Locale.compose("LOC_ACTION_PANEL_PLEASE_WAIT");
      tooltip = Locale.compose("LOC_ACTION_PANEL_PLEASE_WAIT");
      this.navHelpContainer?.classList.remove("action-available");
    } else {
      buttonText = Locale.compose("LOC_ACTION_PANEL_WAITING_FOR_PLAYERS");
      tooltip = Locale.compose("LOC_ACTION_PANEL_WAITING_FOR_PLAYERS_TT");
      tooltip += activePlayersList;
      this.navHelpContainer?.classList.add("action-available");
    }
    this.actionButton.setAttribute("data-tooltip-content", tooltip);
    this.actionText.textContent = buttonText;
    this.pleaseWaitAnimation.start();
  }
  // Set the End Turn button to the Multiplayer Pausedd state.
  setMultiplayerPaused() {
    if (!this.actionButton) {
      console.error("panel-action: unable to find the action button element during setMultiplayerPaused!");
      return;
    }
    if (!this.actionText) {
      console.error("panel-action: unable to find the action text element during setMultiplayerPaused!");
      return;
    }
    if (!this.notificationIcon) {
      console.error("panel-action: unable to find the notification icon element during setMultiplayerPaused!");
      return;
    }
    let activePlayersList = "";
    const buttonText = Locale.compose("LOC_ACTION_PANEL_MULTIPLAYER_PAUSE");
    let tooltip = Locale.compose("LOC_ACTION_PANEL_MULTIPLAYER_PAUSE_TT");
    const playerList = Players.getAlive();
    for (const player of playerList) {
      const playerConfig = Configuration.getPlayer(player.id);
      if (playerConfig.isHuman && playerConfig.wantsPause) {
        const playerName = player.name.replace(new RegExp(" ", "g"), "&nbsp;");
        activePlayersList += `[N]${playerName}`;
      }
    }
    tooltip += activePlayersList;
    this.actionButton.setAttribute("data-tooltip-content", tooltip);
    this.actionText.textContent = buttonText;
    this.pleaseWaitAnimation.start();
  }
  canEndTurn() {
    const endTurnBlockingType = Game.Notifications.getEndTurnBlockingType(
      GameContext.localPlayerID
    );
    if (endTurnBlockingType != EndTurnBlockingTypes.NONE) {
      return false;
    }
    if (this.showRemainingMovesState()) {
      return false;
    }
    return true;
  }
  canUnreadyTurn() {
    if (!Players.isValid(GameContext.localPlayerID)) {
      return false;
    }
    const localPlayer = Players.get(GameContext.localPlayerID);
    if (localPlayer) {
      return localPlayer.canUnreadyTurn;
    }
    return false;
  }
  showRemainingMovesState() {
    if (Game.UnitOperations.canStartAny(GameContext.localPlayerID) == false) {
      return false;
    }
    const firstReadyID = UI.Player.getFirstReadyUnit();
    if (firstReadyID && !Configuration.getUser().isUnitCycle_RemainingMoves) {
      const unit = Units.get(firstReadyID);
      return unit != null && unit.canMove && !unit.hasMoved;
    }
    if (!Configuration.getUser().isUnitCycle_RemainingMoves) {
      return false;
    }
    if (!firstReadyID) {
      return false;
    }
    return true;
  }
  queueUpdateIfLocalPlayer(player) {
    if (player != null) {
      const localPlayerID = GameContext.localPlayerID;
      if (player == localPlayerID) {
        this.updateGate.call("queueUpdateIfLocalPlayer");
      }
      if (Configuration.getGame().isAnyMultiplayer) {
        const playerList = Players.getAlive();
        for (const player2 of playerList) {
          if (player2.isHuman && player2.isTurnActive) {
          }
        }
      }
    }
  }
  onNextActionHotkey(_event) {
    Audio.playSound("data-audio-activate", "turn-action");
    Audio.playSound("data-audio-press", "turn-action");
    this.tryEndTurn();
  }
  tryEndTurn() {
    if (this.canUnreadyTurn()) {
      this.sendUnreadyTurn();
    } else if (!GameContext.hasSentTurnComplete()) {
      if (this.canEndTurn()) {
        this.sendEndTurn();
      } else {
        this.activateBlockingNotification();
      }
    }
  }
  // Sends turn complete if we haven't already and sets the end turn button to Please Wait.
  sendEndTurn() {
    if (!GameContext.hasSentTurnComplete()) {
      if (Game.AgeProgressManager.isAgeOver && !Game.AgeProgressManager.isExtendedGame && !Game.AgeProgressManager.isFinalAge) {
        WorldUI.pushGaussianBlurFilter(5);
        engine.call("setSnapshotEnabled", true);
      }
      this.setEndTurnWaiting();
      UI.Player.deselectAllUnits();
      GameContext.sendTurnComplete();
      UI.sendAudioEvent(Audio.getSoundTag("data-audio-turn-action-complete", "turn-action"));
    }
  }
  sendUnreadyTurn() {
    GameContext.sendUnreadyTurn();
  }
  activateBlockingNotification() {
    const endTurnBlockingType = Game.Notifications.getEndTurnBlockingType(GameContext.localPlayerID);
    if (endTurnBlockingType != EndTurnBlockingTypes.NONE) {
      const endTurnBlockingNotificationId = Game.Notifications.findEndTurnBlocking(
        GameContext.localPlayerID,
        endTurnBlockingType
      );
      if (endTurnBlockingNotificationId) {
        Game.Notifications.activate(endTurnBlockingNotificationId);
        return;
      }
    }
    if (this.showRemainingMovesState()) {
      const commandUnitType = Game.getHash("NOTIFICATION_COMMAND_UNITS");
      const commandUnitHandler = NotificationModel.manager.findHandler(commandUnitType);
      if (commandUnitHandler) {
        const dummyCompID = ComponentID.make(-1, -1, -1);
        commandUnitHandler.activate(dummyCompID);
        return;
      }
    }
  }
  onPlayerTurnActivated(data) {
    this.queueUpdateIfLocalPlayer(data.player);
    const localPlayerID = GameContext.localPlayerID;
    if (data.player == localPlayerID) {
      this.updatePlayerFocus(data.player);
    }
  }
  onLocalPlayerChanged() {
    this.updateGate.call("onLocalPlayerChanged");
  }
  onNotificationAdded(data) {
    this.queueUpdateIfLocalPlayer(data.id?.owner);
  }
  onNotificationDismissed(data) {
    this.queueUpdateIfLocalPlayer(data.id?.owner);
  }
  onNotificationUpdated(data) {
    this.queueUpdateIfLocalPlayer(data.id?.owner);
  }
  onActionButton(_event) {
    if (Autoplay.isActive || this.actionButton?.classList.contains("disabled")) {
      return;
    }
    if (!GameContext.hasSentTurnComplete() || this.canUnreadyTurn()) {
      this.actionButton?.classList.add("action-panel__button--activate");
      setTimeout(() => {
        this.actionButton?.classList.remove("action-panel__button--activate");
      }, 125);
    }
    this.tryEndTurn();
  }
  onEngineInput(inputEvent) {
    if (inputEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (inputEvent.detail.name == "force-end-turn" && !InterfaceMode.isInInterfaceMode("INTERFACEMODE_HOTSEAT")) {
      this.sendEndTurn();
    }
    if (inputEvent.detail.name == "multiplayer-pause" && Configuration.getGame().isAnyMultiplayer) {
      if (Configuration.getGame().isPaused) {
        Audio.playSound("data-audio-resume", "multiplayer-pause");
      } else {
        Audio.playSound("data-audio-pause", "multiplayer-pause");
      }
      Network.toggleMultiplayerPause();
      inputEvent.stopPropagation();
    }
  }
  onActionNextAction(event) {
    this.tryEndTurn();
    event.preventDefault();
    event.stopPropagation();
  }
  onPlayerTurnDeactivated(_data) {
    if (this.isLastPlayerInMPTurn()) {
      this.lastPlayerMessageShow();
    } else {
      this.lastPlayerMessageHide();
    }
  }
  isLastPlayerInMPTurn() {
    const localPlayer = Players.get(GameContext.localPlayerID);
    if (!localPlayer) {
      if (!Autoplay.isActive)
        console.error(
          `panel-action: isLastPlayerInMPTurn - no local player found with id ${GameContext.localPlayerID}`
        );
      return false;
    }
    if (!Players.isValid(localPlayer.id)) {
      console.error(`panel-action: isLastPlayerInMPTurn - local player somehow isn't valid?!`);
      return false;
    }
    if (!localPlayer.isTurnActive) {
      return false;
    }
    if (Configuration.getGame().isNetworkMultiplayer) {
      const playerList = Players.getAlive();
      for (const player of playerList) {
        if (player.isHuman && player.isTurnActive && player.id != localPlayer.id) {
          return false;
        }
      }
      return true;
    }
    return false;
  }
  lastPlayerMessageShow() {
    if (this.lastPlayerMessageContainer && !this.lastPlayerMessageVisibility) {
      this.lastPlayerMessageContainer.classList.remove("hidden");
      this.lastPlayerMessageContainer.classList.add("show");
      this.lastPlayerMessageVisibility = true;
    }
    Audio.playSound("data-audio-mp-waiting-on-you", "turn-action");
  }
  lastPlayerMessageHide() {
    if (this.lastPlayerMessageContainer && this.lastPlayerMessageVisibility) {
      this.lastPlayerMessageContainer.classList.remove("show");
      this.lastPlayerMessageContainer.classList.add("hidden");
      this.lastPlayerMessageVisibility = false;
    }
  }
  onUnitOperationStart(data) {
    if (data.unit.owner == GameContext.localPlayerID) {
      this.updateGate.call("onUnitOperationStart");
    }
  }
  onUnitNumModified(data) {
    if (data.unit.owner !== GameContext.localPlayerID) {
      return;
    }
    this.refreshActionButton(GameContext.localPlayerID);
  }
  onUnitMoved(data) {
    const selectedUnitID = UI.Player.getHeadSelectedUnit();
    if (!ComponentID.isMatch(data.unit, selectedUnitID)) {
      return;
    }
    if (ComponentID.isValid(selectedUnitID)) {
      const selectedUnit = Units.get(selectedUnitID);
      if (selectedUnit) {
        const currentUnitMovesRemaining = selectedUnit.Movement?.movementMovesRemaining ?? 0;
        if (currentUnitMovesRemaining > 0) {
          return;
        }
      }
    }
    this.tryAutoUnitCycle(Configuration.getUser().autoUnitCycleDelay);
    this.updateGate.call("onUnitMoved");
  }
  onUnitActivityChanged(data) {
    const selectedUnitID = UI.Player.getHeadSelectedUnit();
    if (!ComponentID.isMatch(data.unit, selectedUnitID)) {
      return;
    }
    let delayMS = Configuration.getUser().autoUnitCycleDelay;
    const isMove = data.activity == UnitActivityTypes.OPERATION && data.operationType == UnitOperationTypes.MOVE_TO;
    const skipTurn = data.activity == UnitActivityTypes.OPERATION && data.operationType == UnitOperationTypes.SKIP_TURN;
    let hasMoves = false;
    if (data.activity == UnitActivityTypes.AWAKE || data.activity == UnitActivityTypes.NONE) {
      if (!skipTurn && ComponentID.isValid(selectedUnitID)) {
        const selectedUnit = Units.get(selectedUnitID);
        if (selectedUnit) {
          const currentUnitMovesRemaining = selectedUnit.Movement?.movementMovesRemaining ?? 0;
          if (currentUnitMovesRemaining > 0) {
            hasMoves = true;
          }
        }
      }
    }
    if (skipTurn) {
      delayMS = 0;
    }
    if (!isMove && (skipTurn || !hasMoves)) {
      this.tryAutoUnitCycle(delayMS);
    }
    this.updateGate.call("onUnitActivityChanged");
  }
  onUnitBermudaTeleported(data) {
    if (data.unit.owner == GameContext.localPlayerID) {
      delayByFrame(() => {
        UI.Player.lookAtID(data.unit, 0);
        Audio.playSound("data-audio-unit-bermuda-teleported-reappear", "audio-unit");
      }, 200);
    }
  }
  tryAutoUnitCycle(delayMS) {
    if (!Configuration.getUser().isAutoUnitCycle) {
      return;
    }
    const nextReadyUnitID = UI.Player.selectNextReadyUnit();
    if (ComponentID.isValid(nextReadyUnitID)) {
      UI.Player.lookAtID(nextReadyUnitID, delayMS / 1e3);
      const unitLocation = Units.get(nextReadyUnitID)?.location;
      if (unitLocation) {
        PlotCursor.plotCursorCoords = unitLocation;
      }
    }
  }
  onTurnTimerUpdated(data) {
    if (!this.turnTimerElement) {
      this.turnTimerElement = MustGetElement("#action_panel__mp-turntimer", this.mpTurnTimerContainer);
      if (!this.turnTimerElement) {
        return;
      }
    }
    if (data.phaseTimeLimit <= 0) {
      if (!this.mpTurnTimerContainer.classList.contains("hidden")) {
        this.mpTurnTimerContainer.classList.add("hidden");
      }
    } else {
      let timeRemaining = data.phaseTimeLimit - data.elapsedTime;
      timeRemaining = Math.round(timeRemaining);
      timeRemaining = Math.max(timeRemaining, 0);
      this.startMPTimerAnimation(data.phaseTimeLimit, this.mpTimerMaxTime - timeRemaining);
      this.mpTurnTimerContainer.classList.remove("hidden");
      let timeDisplayStr = `${timeRemaining}`;
      const localPlayerID = GameContext.localPlayerID;
      if (Players.isValid(localPlayerID)) {
        const player = Players.get(localPlayerID);
        if (!player) {
          console.error(
            "panel-system-bar: local player has valid id #" + localPlayerID + ", but could not obtain a valid player object."
          );
          return;
        }
        if (player.isTurnActive == true) {
          if (timeRemaining == 60 && timeRemaining != this.currentTurnTimerDisplay) {
            Audio.playSound("data-audio-turn-timer-warning", "multiplayer-timer");
          }
          if (timeRemaining < TIMER_FLASH_START) {
            if (this.currentTurnTimerDisplay != timeRemaining) {
              Audio.playSound("data-audio-turn-timer-countdown", "multiplayer-timer");
            }
            if (timeRemaining % 2 == 0) {
              timeDisplayStr = "[STYLE:screen-turntimer_text_turn_active_flash]" + timeDisplayStr + "[/STYLE]";
            }
          } else {
            timeDisplayStr = "[STYLE:screen-turntimer_text_turn_active]" + timeDisplayStr + "[/STYLE]";
          }
          this.currentTurnTimerDisplay = timeRemaining;
        } else {
          timeDisplayStr = "[STYLE:screen-turntimer_text_turn_inactive]" + timeDisplayStr + "[/STYLE]";
        }
      } else {
        console.error("panel-system-bar: local player does not have a valid id #" + localPlayerID);
        return;
      }
      timeDisplayStr = Locale.stylize(timeDisplayStr);
      this.turnTimerElement.innerHTML = timeDisplayStr;
    }
  }
  startMPTimerAnimation(timeInSeconds, currentTime) {
    if (this.mpTimerMaxTime < timeInSeconds) {
      this.mpTimerMaxTime = timeInSeconds;
      const jumpStart = -(this.mpTimerMaxTime - Math.abs(currentTime));
      this.timerAnimationElements.forEach((element) => {
        element.style.animationDuration = `${this.mpTimerMaxTime}s`;
        element.style.animationDelay = `${jumpStart}s`;
      });
    }
  }
  onGamePauseStateChanged() {
    this.refreshActionButton(GameContext.localPlayerID);
  }
}
Controls.define("panel-action", {
  createInstance: PanelAction,
  description: "Area for sub system button icons.",
  classNames: ["action-panel", "allowCameraMovement"],
  styles: [styles],
  images: [
    "fs://game/hud_notif_bk.png",
    "fs://game/hud_turn_txt_plate.png",
    "fs://game/hud_turn_decor.png",
    "fs://game/hud_turn_bk.png",
    "fs://game/hud_turn_gear.png",
    "fs://game/hud_turn_main.png",
    "blp:ntf_next_turn"
  ]
});

export { PanelAction };
//# sourceMappingURL=panel-action.js.map
