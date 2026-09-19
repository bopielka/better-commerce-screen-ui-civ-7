import { template } from '../../../core/vendor/solid-js/web/dist/web.js';
import { createSignal, mergeProps, createMemo, createComponent, Show } from '../../../core/vendor/solid-js/dist/solid.js';
import { ContextManager } from '../../../core/ui/context-manager/context-manager.js';
import { AudioContextProvider } from '../../../core/ui-next/components/audio-context-provider.js';
import { CloseButton } from '../../../core/ui-next/components/close-button.js';
import { Filigree } from '../../../core/ui-next/components/filigree.js';
import { Header } from '../../../core/ui-next/components/header.js';
import { ImageCacheProvider } from '../../../core/ui-next/components/image-cache.js';
import { L10n } from '../../../core/ui-next/components/l10n.js';
import { OrnateFrame } from '../../../core/ui-next/components/ornate-panel.js';
import { Panel } from '../../../core/ui-next/components/panel.js';
import { Popup } from '../../../core/ui-next/components/popup.js';
import { ComponentRegistry } from '../../../core/ui-next/services/component-registry.js';
import { useIsSmallScreen } from '../../../core/ui-next/utilities/layout-utilities.js';
import PopupSequencer from '../../ui/popup-sequencer/popup-sequencer.js';
import { YieldStatusBar } from './yield-status-bar.js';

var _tmpl$ = /* @__PURE__ */ template(`<div class="absolute top-12 left-3 bottom-0 wip-banner"></div>`);
var ScreenFrameCloseHandler = /* @__PURE__ */ ((ScreenFrameCloseHandler2) => {
  ScreenFrameCloseHandler2[ScreenFrameCloseHandler2["ContextManager"] = 0] = "ContextManager";
  ScreenFrameCloseHandler2[ScreenFrameCloseHandler2["PopupSequencer"] = 1] = "PopupSequencer";
  return ScreenFrameCloseHandler2;
})(ScreenFrameCloseHandler || {});
const ScreenFrameComponent = (props) => {
  const [popupContext, setPopupContext] = createSignal();
  const isSmallScreen = useIsSmallScreen();
  const mergedProps = mergeProps({
    addYieldBar: true
  }, props);
  function close() {
    if (props.onClosing) {
      props.onClosing();
    }
    switch (props.closeHandler ?? 0 /* ContextManager */) {
      case 0 /* ContextManager */:
        ContextManager.pop(props.panelContext);
        break;
      case 1 /* PopupSequencer */:
        PopupSequencer.closePopup(props.panelContext);
        break;
    }
  }
  function handleCancelInput() {
    if (props.hideClose) {
      return;
    } else if (popupContext()?.active()) {
      popupContext()?.close();
    } else {
      close();
    }
  }
  const showTitle = createMemo(() => {
    return props.title != null;
  });
  const ornateFrameClass = createMemo(() => {
    const aspectRatio = props.doNotStretch ? "menu-aspect-ratio-fixed" : "menu-aspect-ratio";
    return `${aspectRatio} flex flex-col items-center ${props.isFullscreen ? "size-full" : "max-w-screen max-h-screen"}`;
  });
  return createComponent(Panel, {
    get name() {
      return props.name;
    },
    get id() {
      return props.panelContext;
    },
    "class": "flex justify-center",
    onCancelInput: handleCancelInput,
    ref(r$) {
      var _ref$ = props.ref;
      typeof _ref$ === "function" ? _ref$(r$) : props.ref = r$;
    },
    get onContextChanged() {
      return props.onContextChanged;
    },
    get children() {
      return createComponent(AudioContextProvider, {
        get segment() {
          return props.audioContext;
        },
        get children() {
          return createComponent(ImageCacheProvider, {
            get children() {
              return [createComponent(Show, {
                get when() {
                  return !isSmallScreen() && mergedProps.addYieldBar && !props.isFullscreen;
                },
                get children() {
                  return createComponent(YieldStatusBar, {});
                }
              }), createComponent(Popup, {
                setPopupContext,
                get children() {
                  return [createComponent(OrnateFrame, mergeProps(() => props.ornatePanelData, {
                    get hideTopIcon() {
                      return isSmallScreen() || props.isFullscreen;
                    },
                    get useNoMarginFrame() {
                      return isSmallScreen() || props.isFullscreen;
                    },
                    get ["class"]() {
                      return ornateFrameClass();
                    },
                    get isFullscreen() {
                      return props.isFullscreen;
                    },
                    get children() {
                      return [createComponent(Show, {
                        get when() {
                          return props.wip;
                        },
                        get children() {
                          return _tmpl$();
                        }
                      }), createComponent(Show, {
                        get when() {
                          return showTitle();
                        },
                        get children() {
                          return createComponent(Filigree.TitleAccent, {
                            get ["class"]() {
                              return `mb-2 mx-24 ${isSmallScreen() || props.isFullscreen ? "mt-2" : "-mt-2"}`;
                            },
                            get children() {
                              return createComponent(Header, {
                                "class": `max-w-full text-center justify-center`,
                                get children() {
                                  return createComponent(L10n.Compose, {
                                    get text() {
                                      return props.title;
                                    }
                                  });
                                }
                              });
                            }
                          });
                        }
                      }), createMemo(() => props.children), createComponent(Show, {
                        get when() {
                          return !props.hideClose;
                        },
                        get children() {
                          return createComponent(CloseButton, {
                            get ["class"]() {
                              return `${isSmallScreen() ? "right-1 top-1" : "right-4 top-5"} absolute`;
                            },
                            onActivate: () => close(),
                            hotkeyAction: "cancel",
                            navTrayText: "LOC_GENERIC_CLOSE"
                          });
                        }
                      })];
                    }
                  })), createComponent(Popup.Output, {
                    "class": "fullscreen child-fullscreen"
                  })];
                }
              })];
            }
          });
        }
      });
    }
  });
};
const ScreenFrame = ComponentRegistry.register({
  name: "ScreenFrame",
  //styles: [style],
  images: ["blp:wip_label"],
  createInstance: ScreenFrameComponent
});

export { ScreenFrame, ScreenFrameCloseHandler };
//# sourceMappingURL=screen-frame.js.map
