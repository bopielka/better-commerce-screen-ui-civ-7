import { createSignal, createContext, useContext } from '../../vendor/solid-js/dist/solid.js';
import { asyncLoad } from '../utilities/async-load.js';

function _validateAudioRulePath(_path) {
  return true;
}
function compileAudioRules(rules) {
  const tree = {
    rules: [],
    children: {}
  };
  const reverse = rules.reverse();
  for (const rule of reverse) {
    const segments = rule.path.split("/");
    let current = tree;
    for (const s of segments) {
      let child = current.children[s];
      if (child == null) {
        child = { rules: [], children: {} };
        current.children[s] = child;
      }
      current = child;
    }
    current.rules.push(rule);
  }
  return tree;
}
const [globalRules, setGlobalRules] = createSignal({ rules: [], children: {} });
const AudioContext = createContext({
  path: () => "",
  vars: () => ({}),
  tree: globalRules
});
function meetsConstraint(key, constraint, vars) {
  if (typeof constraint == "string") {
    return vars[key] == constraint;
  } else {
    if (constraint.op == null) {
      return vars[key] == constraint.value;
    } else {
      switch (constraint.op) {
        case "eq":
          return vars[key] == constraint.value;
        case "neq":
          return vars[key] != constraint.value;
        case "lt":
          return constraint.value != null ? vars[key] < constraint.value : false;
        case "lte":
          return constraint.value != null ? vars[key] <= constraint.value : false;
        case "gt":
          return constraint.value != null ? vars[key] > constraint.value : false;
        case "gte":
          return constraint.value != null ? vars[key] >= constraint.value : false;
        case "exists":
          return vars[key] != null;
        case "in":
          return constraint.value.includes(vars[key]);
        default:
          return false;
      }
    }
  }
}
function meetsConstraints(rule, vars, shouldLogVerbose) {
  const constraints = rule.constraints;
  if (constraints == null) {
    return true;
  } else {
    return Object.entries(constraints).every(([key, value]) => {
      const result = meetsConstraint(key, value, vars);
      if (shouldLogVerbose != null && shouldLogVerbose) {
        console.log(
          `-- Constraint ${key} ${typeof value === "string" ? "eq" : value.op} ${typeof value === "string" ? value : value.value} -> ${result}`
        );
      }
      return result;
    });
  }
}
const audioVariableRegex = /{(\w+)}/g;
const useAudio = (localSegment) => {
  const ctx = useContext(AudioContext);
  const trigger = (segmentOrEventName, eventNameOrVars, optionalVars) => {
    const segment = typeof eventNameOrVars === "string" ? segmentOrEventName : null;
    const eventName = typeof eventNameOrVars === "string" ? eventNameOrVars : segmentOrEventName;
    const localVars = typeof eventNameOrVars === "object" ? eventNameOrVars : optionalVars;
    const path = ctx.path();
    const vars = localVars != null ? { ...ctx.vars(), ...localVars } : ctx.vars();
    const targetPath = [path, localSegment, segment].filter((p) => p).join("/");
    const segments = targetPath.split("/");
    let current = ctx.tree();
    for (const seg of segments) {
      if (current.children[seg]) {
        current = current.children[seg];
      } else {
      }
    }
    const shouldLogVerbose = UI.Debug.getWidgetValue("logAudioRuleConstraintMatching");
    const match = current.rules.find((r) => meetsConstraints(r, vars, shouldLogVerbose));
    if (match?.events[eventName]) {
      const sound = match.events[eventName];
      const tag = sound.replace(audioVariableRegex, (_, k) => vars[k] || k);
      const shouldLog = UI.Debug.getWidgetValue("logMatchedAudioTriggers");
      if (shouldLog != null && shouldLog) {
        const strVars = Object.entries(vars).map((entry) => `${entry[0]}=${entry[1]}`).join("&");
        console.log(`${targetPath}[${strVars}]:${eventName} -> ${tag} (${match.path})`);
      }
      if (tag != null && tag != "") {
        UI.sendAudioEvent(tag);
      }
    } else {
      const shouldLog = UI.Debug.getWidgetValue("logUnmatchedAudioTriggers");
      if (shouldLog != null && shouldLog) {
        const strVars = Object.entries(vars).map((entry) => `${entry[0]}=${entry[1]}`).join("&");
        console.log(`${targetPath}[${strVars}]:${eventName} -> No Match`);
      }
    }
  };
  return trigger;
};
engine.whenReady.then(async () => {
  const audioRules = Modding.getAudioRulesUrls();
  const rules = (await Promise.all(audioRules.map(asyncLoad))).flatMap((result) => JSON.parse(result));
  setGlobalRules(compileAudioRules(rules));
});
const LogAudioMatchedTriggersWidget = {
  id: "logMatchedAudioTriggers",
  category: "Audio",
  caption: "Log Matched Triggers",
  domainType: "bool",
  value: false
};
const LogAudioNotMatchedTriggersWidget = {
  id: "logUnmatchedAudioTriggers",
  category: "Audio",
  caption: "Log Unmatched Triggers",
  domainType: "bool",
  value: false
};
const LogAudioRuleConstraintMatchingWidget = {
  id: "logAudioRuleConstraintMatching",
  category: "Audio",
  caption: "Log Constraint Matching (Verbose)",
  domainType: "bool",
  value: false
};
UI.Debug.registerWidget(LogAudioMatchedTriggersWidget);
UI.Debug.registerWidget(LogAudioNotMatchedTriggersWidget);
UI.Debug.registerWidget(LogAudioRuleConstraintMatchingWidget);

export { AudioContext, compileAudioRules, useAudio };
//# sourceMappingURL=audio-support.js.map
