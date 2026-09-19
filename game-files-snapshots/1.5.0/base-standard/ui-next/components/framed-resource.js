import { template, insert, className, classList } from '../../../core/vendor/solid-js/web/dist/web.js';
import { createRenderEffect, mergeProps, createComponent, Show } from '../../../core/vendor/solid-js/dist/solid.js';
import { useDraggableContext } from '../../../core/ui-next/components/drag-and-drop.js';
import { Icon } from '../../../core/ui-next/components/icon.js';
import { useImageCache } from '../../../core/ui-next/components/image-cache.js';
import { L10n } from '../../../core/ui-next/components/l10n.js';

var _tmpl$ = /* @__PURE__ */ template(`<div class="size-10 bg-contain bg-no-repeat bg-center absolute flex items-center justify-center -bottom-2 translate-y-1\\/2"><div class="size-full bg-contain bg-no-repeat bg-center absolute"></div><div class="size-full bg-contain bg-no-repeat bg-center absolute"></div></div>`), _tmpl$2 = /* @__PURE__ */ template(`<div class="size-full bg-contain bg-no-repeat bg-center absolute pointer-events-none"></div>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="absolute flex flex-row items-center gap-1 px-1 py-0\\.5 rounded-lg text-2xs text-white pointer-events-none"></div>`), _tmpl$4 = /* @__PURE__ */ template(`<div><div class="relative size-full flex items-end justify-center"></div></div>`);
const ImportFlagSymbol = Symbol();
const ImportFlag = (props) => {
  const images = {
    shadowBannerCSS: "url(blp:res_banner_shadow)",
    outerBannerCSS: "url(blp:res_banner_outer)",
    innerBannerCSS: "url(blp:res_banner_inner)"
  };
  const imageCache = useImageCache();
  imageCache.registerImages(ImportFlagSymbol, Object.values(images));
  return (() => {
    var _el$ = _tmpl$(), _el$2 = _el$.firstChild, _el$3 = _el$2.nextSibling;
    createRenderEffect((_p$) => {
      var _v$ = images.shadowBannerCSS, _v$2 = images.outerBannerCSS, _v$3 = props.primaryColor, _v$4 = images.innerBannerCSS, _v$5 = props.secondaryColor;
      _v$ !== _p$.e && ((_p$.e = _v$) != null ? _el$.style.setProperty("background-image", _v$) : _el$.style.removeProperty("background-image"));
      _v$2 !== _p$.t && ((_p$.t = _v$2) != null ? _el$2.style.setProperty("background-image", _v$2) : _el$2.style.removeProperty("background-image"));
      _v$3 !== _p$.a && ((_p$.a = _v$3) != null ? _el$2.style.setProperty("fxs-background-image-tint", _v$3) : _el$2.style.removeProperty("fxs-background-image-tint"));
      _v$4 !== _p$.o && ((_p$.o = _v$4) != null ? _el$3.style.setProperty("background-image", _v$4) : _el$3.style.removeProperty("background-image"));
      _v$5 !== _p$.i && ((_p$.i = _v$5) != null ? _el$3.style.setProperty("fxs-background-image-tint", _v$5) : _el$3.style.removeProperty("fxs-background-image-tint"));
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0,
      o: void 0,
      i: void 0
    });
    return _el$;
  })();
};
const FramedResourceSymbol = Symbol();
const FramedResource = (props) => {
  const mergedProps = mergeProps({
    showTooltip: true,
    size: 18
  }, props);
  const images = {
    resourceSlotSelectCSS: "url(blp:resource_slot_select)"
  };
  const imageCache = useImageCache();
  imageCache.registerImages(FramedResourceSymbol, Object.values(images));
  const draggableContext = useDraggableContext();
  return (() => {
    var _el$4 = _tmpl$4(), _el$5 = _el$4.firstChild;
    insert(_el$5, createComponent(Show, {
      get when() {
        return props.importFlag;
      },
      children: (importFlagProps) => createComponent(ImportFlag, mergeProps(importFlagProps))
    }), null);
    insert(_el$5, createComponent(Show, {
      get when() {
        return props.showHighlight;
      },
      get children() {
        var _el$6 = _tmpl$2();
        createRenderEffect((_$p) => (_$p = images.resourceSlotSelectCSS) != null ? _el$6.style.setProperty("background-image", _$p) : _el$6.style.removeProperty("background-image"));
        return _el$6;
      }
    }), null);
    insert(_el$5, createComponent(Icon, {
      "class": "size-full pointer-events-none relative",
      isUrl: true,
      get name() {
        return props.resourceIcon;
      }
    }), null);
    insert(_el$5, () => props.children, null);
    insert(_el$5, createComponent(Icon, {
      "class": "size-1\\/2 -bottom-2 absolute pointer-events-none scale-90",
      get name() {
        return props.resourceTypeIcon;
      },
      isUrl: true,
      "data-name": "Framed-Resource"
    }), null);
    insert(_el$5, createComponent(Show, {
      get when() {
        return props.isSwapTarget;
      },
      get children() {
        var _el$7 = _tmpl$3();
        _el$7.style.setProperty("border", "solid 2px rgba(255, 226, 136, 1)");
        _el$7.style.setProperty("background", "linear-gradient(to top, rgba(21, 27, 39, 1) 0%, rgba(33, 38, 57, 1) 100%)");
        insert(_el$7, createComponent(Icon, {
          "class": "size-4",
          name: "url(blp:replace_arrows)",
          isUrl: true
        }), null);
        insert(_el$7, createComponent(L10n.Compose, {
          text: "LOC_COMMERCE_REPLACE_RESOURCE_LABEL"
        }), null);
        return _el$7;
      }
    }), null);
    insert(_el$4, createComponent(Show, {
      get when() {
        return props.isDamaged;
      },
      get children() {
        return createComponent(Icon, {
          "class": "size-10 absolute top-3",
          name: "url(blp:buildicon_warning)",
          isUrl: true
        });
      }
    }), null);
    createRenderEffect((_p$) => {
      var _v$6 = `size-${mergedProps.size} relative flex items-end justify-center ${draggableContext.isRenderingOverlay ? "pointer-events-none" : "pointer-events-auto"} ${props.class ?? ""}`, _v$7 = {
        "mb-4": props.importFlag !== void 0,
        "mb-2": props.importFlag === void 0,
        ...props.classList
      }, _v$8 = !!(props.isDamaged === true);
      _v$6 !== _p$.e && className(_el$4, _p$.e = _v$6);
      _p$.t = classList(_el$4, _v$7, _p$.t);
      _v$8 !== _p$.a && _el$5.classList.toggle("opacity-30", _p$.a = _v$8);
      return _p$;
    }, {
      e: void 0,
      t: void 0,
      a: void 0
    });
    return _el$4;
  })();
};

export { FramedResource };
//# sourceMappingURL=framed-resource.js.map
