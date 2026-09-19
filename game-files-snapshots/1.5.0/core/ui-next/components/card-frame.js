import { template, spread, insert } from '../../vendor/solid-js/web/dist/web.js';
import { mergeProps } from '../../vendor/solid-js/dist/solid.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`);
const CardFrame = (props) => {
  return (() => {
    var _el$ = _tmpl$();
    spread(_el$, mergeProps(props, {
      get ["class"]() {
        return `card-frame-bg ${props.class}`;
      },
      "data-name": "Card-Frame"
    }), false, true);
    insert(_el$, () => props.children);
    return _el$;
  })();
};
const MetalCardFrame = (props) => {
  return (() => {
    var _el$2 = _tmpl$();
    spread(_el$2, mergeProps(props, {
      get ["class"]() {
        return `metal-card-frame-bg ${props.class}`;
      },
      "data-name": "Metal-Card-Frame"
    }), false, true);
    insert(_el$2, () => props.children);
    return _el$2;
  })();
};

export { CardFrame, MetalCardFrame };
//# sourceMappingURL=card-frame.js.map
