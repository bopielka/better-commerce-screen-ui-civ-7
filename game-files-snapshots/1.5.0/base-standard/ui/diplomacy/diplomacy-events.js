const RaiseDiplomacyEventName = "raise-diplomacy";
class RaiseDiplomacyEvent extends CustomEvent {
  constructor(playerID) {
    super(RaiseDiplomacyEventName, { bubbles: true, cancelable: true, detail: { playerID } });
  }
}

export { RaiseDiplomacyEvent, RaiseDiplomacyEventName };
//# sourceMappingURL=diplomacy-events.js.map
