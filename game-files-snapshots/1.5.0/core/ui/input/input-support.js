const InputEngineEventName = "engine-input";
class InputEngineEvent extends CustomEvent {
  constructor(name, status, x, y, isTouch, isMouse, bubbles = true) {
    super(InputEngineEventName, {
      bubbles,
      cancelable: true,
      detail: {
        name,
        status,
        x,
        y,
        isTouch,
        isMouse
      }
    });
  }
  static CreateNewEvent(oldEvent, bubbles) {
    return new InputEngineEvent(
      oldEvent.detail.name,
      oldEvent.detail.status,
      oldEvent.detail.x,
      oldEvent.detail.y,
      oldEvent.detail.isTouch,
      oldEvent.detail.isMouse,
      bubbles ?? oldEvent.bubbles
    );
  }
  isCancelInput() {
    return this.detail.name == "cancel" || this.detail.name == "keyboard-escape" || this.detail.name == "mousebutton-right";
  }
}
const NavigateInputEventName = "navigate-input";
class NavigateInputEvent extends CustomEvent {
  getDirection() {
    return this.detail.navigation;
  }
  static CreateNewEvent(oldEvent, bubbles) {
    return new NavigateInputEvent(NavigateInputEventName, {
      bubbles: bubbles ?? oldEvent.bubbles,
      cancelable: true,
      detail: {
        name: oldEvent.detail.name,
        status: oldEvent.detail.status,
        x: oldEvent.detail.x,
        y: oldEvent.detail.y,
        navigation: oldEvent.detail.navigation
      }
    });
  }
}
var AnalogInput;
((AnalogInput2) => {
  AnalogInput2.deadzoneThreshold = 0.2;
})(AnalogInput || (AnalogInput = {}));
var InputHandlerState = /* @__PURE__ */ ((InputHandlerState2) => {
  InputHandlerState2[InputHandlerState2["Active"] = 0] = "Active";
  InputHandlerState2[InputHandlerState2["Handled"] = 1] = "Handled";
  return InputHandlerState2;
})(InputHandlerState || {});

export { AnalogInput, InputEngineEvent, InputEngineEventName, InputHandlerState, NavigateInputEvent, NavigateInputEventName };
//# sourceMappingURL=input-support.js.map
