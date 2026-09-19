import { template, spread } from '../../vendor/solid-js/web/dist/web.js';
import { createContext, useContext, mergeProps, createSignal, createEffect, createComponent } from '../../vendor/solid-js/dist/solid.js';
import { ComponentRegistry } from '../services/component-registry.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`);
function getDefaultColor(opacity) {
  return `rgba(77, 83, 102, ${opacity})`;
}
function getDefaultGradient(angle) {
  return `linear-gradient(${angle}deg, ${getDefaultColor(0.7)} 0%, ${getDefaultColor(0)} 100%)`;
}
const DividerContext = createContext();
const DividerComponent = (props) => {
  const ctx = useContext(DividerContext);
  const defaults = {
    crossWidth: "0\\.5",
    length: "full",
    margin: 0,
    useGradient: false
  };
  const mergedProps = mergeProps(defaults, props);
  const [margin, setMargin] = createSignal("");
  const [height, setHeight] = createSignal("");
  const [width, setWidth] = createSignal("");
  if (!ctx) {
    throw new Error("Divider must be used within a <DividerContext.Provider>");
  }
  createEffect(() => {
    setMargin(ctx.isHorizontal ? `my-${mergedProps.margin}` : `mx-${mergedProps.margin}`);
    setHeight(`h-${ctx.isHorizontal ? mergedProps.crossWidth : mergedProps.length}`);
    setWidth(`w-${ctx.isHorizontal ? mergedProps.length : mergedProps.crossWidth}`);
  });
  return (() => {
    var _el$ = _tmpl$();
    spread(_el$, mergeProps(props, {
      get ["class"]() {
        return `${height()} ${width()} ${margin()} ${props.class ?? ""}`;
      },
      get style() {
        return {
          background: mergedProps.useGradient ? props.gradientOverride ?? getDefaultGradient(ctx.isHorizontal ? 90 : 0) : props.color ?? getDefaultColor(0.7)
        };
      }
    }), false, false);
    return _el$;
  })();
};
const HorizontalDividerComponent = (props) => {
  return createComponent(DividerContext.Provider, {
    value: {
      isHorizontal: true
    },
    get children() {
      return createComponent(DividerComponent, props);
    }
  });
};
const VerticalDividerComponent = (props) => {
  return createComponent(DividerContext.Provider, {
    value: {
      isHorizontal: false
    },
    get children() {
      return createComponent(DividerComponent, props);
    }
  });
};
const Divider = {
  Horizontal: ComponentRegistry.register({
    name: "Divider.Horizontal",
    createInstance: HorizontalDividerComponent
  }),
  Vertical: ComponentRegistry.register({
    name: "Divider.Vertical",
    createInstance: VerticalDividerComponent
  })
};

export { Divider };
//# sourceMappingURL=divider.js.map
