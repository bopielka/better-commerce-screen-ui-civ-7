import { template, className, style, insert } from '../../vendor/solid-js/web/dist/web.js';
import { createMemo, createRenderEffect, createSignal, createEffect, createComponent, mergeProps } from '../../vendor/solid-js/dist/solid.js';
import { getMajorLeader, getPlayerDiplomacy } from '../../ui/utilities/diplomacy-utilities.js';
import { getPlayerColorVariants } from '../../ui/utilities/utilities-color.js';
import { ComponentRegistry } from '../services/component-registry.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`), _tmpl$2 = /* @__PURE__ */ template(`<div data-name="Portrait-Icon"><div></div></div>`);
function desaturateOnCondition(condition, existingProps) {
  if (condition) {
    existingProps.filter = "saturate(0)";
  }
  return existingProps;
}
const LeaderIconComponent = (props) => {
  const style$1 = createMemo(() => desaturateOnCondition(props.desaturate ?? false, {
    "background-image": props.icon
  }));
  return (() => {
    var _el$ = _tmpl$();
    createRenderEffect((_p$) => {
      var _v$ = `bg-center bg-no-repeat bg-contain size-${props.size} -mt-1 pointer-events-auto`, _v$2 = style$1();
      _v$ !== _p$.e && className(_el$, _p$.e = _v$);
      _p$.t = style(_el$, _v$2, _p$.t);
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
};
const PortraitIconComponent = (props) => {
  const [iconProps, setIconProps] = createSignal();
  const [backgroundColor, setBackgroundColor] = createSignal("");
  createEffect(() => {
    if (props.playerId === PlayerIds.NO_PLAYER) {
      return;
    }
    const majorLeader = getMajorLeader(props.playerId);
    if (!majorLeader) {
      return;
    }
    const leaderType = GameInfo.Leaders.lookup(majorLeader.leaderType)?.LeaderType;
    const playerDiplomacy = getPlayerDiplomacy(majorLeader);
    if (!playerDiplomacy) {
      return;
    }
    let portraitContext = "";
    switch (playerDiplomacy.getRelationshipEnum(GameContext.localObserverID)) {
      case DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_HOSTILE:
      case DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_UNFRIENDLY:
        portraitContext = "LEADER_ANGRY";
        break;
      case DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_FRIENDLY:
      case DiplomacyPlayerRelationships.PLAYER_RELATIONSHIP_HELPFUL:
        portraitContext = "LEADER_HAPPY";
        break;
      default:
        break;
    }
    setIconProps({
      icon: UI.getIconCSS(leaderType ?? "UNKNOWN_LEADER", portraitContext),
      size: props.size,
      desaturate: props.desaturate
    });
    const variants = getPlayerColorVariants(props.playerId);
    if (variants) {
      setBackgroundColor(variants.secondaryColor.mainColor);
    }
  });
  return (() => {
    var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild;
    _el$3.style.setProperty("background-image", "url(blp:hud_diplo_hex-frame)");
    insert(_el$3, (() => {
      var _c$ = createMemo(() => iconProps() !== void 0);
      return () => _c$() && createComponent(LeaderIconComponent, mergeProps(() => iconProps()));
    })());
    createRenderEffect((_p$) => {
      var _v$3 = `portrait-icon-container relative bg-center bg-no-repeat bg-contain size-${props.size} ${props.class ?? ""}`, _v$4 = desaturateOnCondition(props.desaturate ?? false, {
        "background-image": "url(blp:final_leader-hex)",
        "fxs-background-image-tint": backgroundColor()
      }), _v$5 = `portrait-icon__background bg-center bg-no-repeat bg-contain size-${props.size}`;
      _v$3 !== _p$.e && className(_el$2, _p$.e = _v$3);
      _p$.t = style(_el$2, _v$4, _p$.t);
      _v$5 !== _p$.a && className(_el$3, _p$.a = _v$5);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$2;
  })();
};
const PortraitIcon = ComponentRegistry.register({
  name: "PortraitIcon",
  createInstance: PortraitIconComponent
});

export { LeaderIconComponent, PortraitIcon };
//# sourceMappingURL=portrait-icon.js.map
