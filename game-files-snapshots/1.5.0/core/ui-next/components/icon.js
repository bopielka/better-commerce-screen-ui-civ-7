import { template, spread, insert } from '../../vendor/solid-js/web/dist/web.js';
import { createMemo, createEffect, mergeProps } from '../../vendor/solid-js/dist/solid.js';
import { useImageCache } from './image-cache.js';
import { ComponentRegistry } from '../services/component-registry.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`);
const IconComponent = (props) => {
  const iconComponentSymbol = Symbol();
  const imageCache = useImageCache();
  const iconUrl = createMemo(() => {
    if (!props.name) {
      return void 0;
    }
    const cssURL = (props.isUrl ? props.name : UI.getIconCSS(props.name, props.context)) || props.name;
    return cssURL;
  });
  createEffect(() => {
    const url = iconUrl();
    if (url) {
      imageCache.updateImages(iconComponentSymbol, [url]);
    }
  });
  const iconStyle = createMemo(() => {
    if (props.mask) {
      return {
        "background-image": iconUrl(),
        "mask-image": props.mask,
        "mask-size": "contain",
        "mask-position": "center"
      };
    } else {
      return {
        "background-image": iconUrl()
      };
    }
  });
  return (() => {
    var _el$ = _tmpl$();
    spread(_el$, mergeProps(props, {
      get ["class"]() {
        return `bg-center bg-contain bg-no-repeat ${props.class}`;
      },
      get classList() {
        return props.classList;
      },
      get style() {
        return iconStyle();
      },
      "data-name": "Icon"
    }), false, true);
    insert(_el$, () => props.children);
    return _el$;
  })();
};
const Icon = ComponentRegistry.register("Icon", IconComponent);

export { Icon };
//# sourceMappingURL=icon.js.map
