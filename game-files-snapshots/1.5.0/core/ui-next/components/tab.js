import { template, use, spread, insert, Dynamic } from '../../vendor/solid-js/web/dist/web.js';
import { createSignal, createSelector, createContext, useContext, createEffect, mergeProps, createComponent, onMount, onCleanup, createMemo, Show, For } from '../../vendor/solid-js/dist/solid.js';
import { Activatable } from './activatable.js';
import { ArrowButton } from './arrow-button.js';
import { L10n } from './l10n.js';
import { NavHelp } from './nav-help.js';
import { RadioButton } from './radio-button.js';
import { TriggerType, createTrigger } from './trigger.js';
import { useAudio } from '../services/audio-support.js';
import { ComponentRegistry } from '../services/component-registry.js';
import { FocusContext } from '../services/focus.js';
import { createArraySignal, createPropsRefSignal, createLayoutComplete } from '../utilities/solid-utilities.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`), _tmpl$2 = /* @__PURE__ */ template(`<div><div class="absolute inset-0 img-tab-bar"></div><div class="absolute -left-1 img-tab-end-cap pointer-events-none left-border"></div><div class="absolute -right-1 rotate-y-180 img-tab-end-cap pointer-events-none right-border"></div><div class="absolute bottom-0 left-0 img-tab-selection-indicator bg-no-repeat bg-center min-h-6 bg-contain transition-left duration-150"></div></div>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="text-secondary-1"role="menuitem"></div>`);
class TabContextProvider {
  _active;
  _setActive;
  _tabs;
  _mutateTabs;
  _isActive;
  defaultTab;
  get active() {
    return this._active;
  }
  get tabs() {
    return this._tabs;
  }
  get isActive() {
    return this._isActive;
  }
  constructor() {
    const [active, setActive] = createSignal();
    this._active = active;
    this._setActive = setActive;
    const [tabs, mutateTabs] = createArraySignal();
    this._tabs = tabs;
    this._mutateTabs = mutateTabs;
    this._isActive = createSelector(() => this._active()?.name);
  }
  onTrigger(name, type, _source) {
    if (type == TriggerType.Activate) {
      this.activate(name);
    }
  }
  register(tab) {
    const foundTabIndex = this._tabs().findIndex((t) => t.name == tab.name);
    if (foundTabIndex >= 0) {
      this._mutateTabs((tabs) => tabs[foundTabIndex] = tab);
    } else {
      this._mutateTabs((tabs) => tabs.push(tab));
    }
    if (!this._active() && (!this.defaultTab || tab.name == this.defaultTab)) {
      this._setActive(tab);
    }
  }
  unregister(tabName) {
    const foundTabIndex = this._tabs().findIndex((t) => t.name == tabName);
    if (foundTabIndex >= 0) {
      this._mutateTabs((tabs) => tabs.splice(foundTabIndex, 1));
    }
  }
  activate(tabName) {
    const tab = this._tabs().find((t) => t.name == tabName);
    if (tab && !tab.disabled) {
      this._setActive(tab);
      return this._tabs().length > 1;
    }
    return false;
  }
  activateNext() {
    const active = this._active();
    const tabs = this._tabs();
    if (active) {
      const activeIndex = tabs.indexOf(active) + 1;
      for (let i = 0; i < tabs.length; i++) {
        const nextTab = tabs[(activeIndex + i) % tabs.length];
        if (!nextTab.disabled) {
          this._setActive(nextTab);
          return tabs.length > 1;
        }
      }
    }
    return false;
  }
  activatePrevious() {
    const active = this._active();
    const tabs = this._tabs();
    if (active) {
      const activeIndex = tabs.indexOf(active) - 1;
      for (let i = 0; i < tabs.length; i++) {
        const prevTab = tabs[(activeIndex - i + tabs.length) % tabs.length];
        if (!prevTab.disabled) {
          this._setActive(prevTab);
          return tabs.length > 1;
        }
      }
    }
    return false;
  }
  setDefaultTab(tabName) {
    this.activate(tabName);
    this.defaultTab = tabName;
  }
  getActiveTabIndex() {
    return this._tabs().findIndex((tab) => this._isActive(tab.name)) + 1;
  }
}
const TabContext = createContext();
function useTabContext() {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error("useTabContext - Unable to get tab context");
  }
  return context;
}
const TabComponent = (props) => {
  const contextProvider = new TabContextProvider();
  createEffect(() => {
    props.onTabChanged?.(contextProvider.active());
  });
  createEffect(() => {
    if (props.defaultTab) {
      contextProvider.setDefaultTab(props.defaultTab);
    }
  });
  createEffect(() => {
    const activeTab = props.activeTab?.();
    if (activeTab) {
      contextProvider.activate(activeTab);
    }
  });
  return (() => {
    var _el$ = _tmpl$();
    var _ref$ = props.ref;
    typeof _ref$ === "function" ? use(_ref$, _el$) : props.ref = _el$;
    spread(_el$, mergeProps(props, {
      get ["class"]() {
        return props.class ?? "flex flex-row";
      },
      "data-name": "Tab"
    }), false, true);
    insert(_el$, createComponent(TabContext.Provider, {
      value: contextProvider,
      get children() {
        return props.children;
      }
    }));
    return _el$;
  })();
};
const TabOutputComponent = (props) => {
  const tabContext = useContext(TabContext);
  return createComponent(Dynamic, {
    ref(r$) {
      var _ref$2 = props.ref;
      typeof _ref$2 === "function" ? _ref$2(r$) : props.ref = r$;
    },
    get component() {
      return tabContext?.active()?.body;
    }
  });
};
const TabTitleComponent = () => {
  const tabContext = useContext(TabContext);
  return createComponent(Dynamic, {
    get component() {
      return tabContext?.active()?.title;
    }
  });
};
const TabItemComponent = (props) => {
  const tabContext = useContext(TabContext);
  onMount(() => tabContext?.register(props));
  onCleanup(() => tabContext?.unregister(props.name));
  return null;
};
const TabListItem = (props) => {
  return createComponent(Activatable, {
    ref(r$) {
      var _ref$3 = props.ref;
      typeof _ref$3 === "function" ? _ref$3(r$) : props.ref = r$;
    },
    get ["class"]() {
      return `relative flex items-center justify-center font-fit-shrink text-center flex-1 ${props.titleClass ?? ""}`;
    },
    get classList() {
      return {
        "text-secondary": props.selected && !props.disabled,
        "text-accent-1": !props.selected && !props.disabled,
        "text-accent-5": props.disabled,
        "cursor-pointer": !props.disabled
      };
    },
    get disabled() {
      return props.disabled;
    },
    disableFocus: true,
    name: "TabListItem",
    get children() {
      return props.children;
    }
  });
};
const TabListComponent = (props) => {
  const tabContext = useContext(TabContext);
  const focusContext = useContext(FocusContext);
  const [root, setRoot] = createPropsRefSignal(() => props.ref);
  const layoutComplete = createLayoutComplete();
  let selectionIndicator;
  const showNavHelp = createMemo(() => props.showNavHelp ?? true);
  const nextHotkey = createMemo(() => props.nextHotkey ?? "nav-next");
  const prevHotkey = createMemo(() => props.previousHotkey ?? "nav-previous");
  createEffect(() => {
    const resolvedRoot = root();
    if (!resolvedRoot || !selectionIndicator || !layoutComplete()) {
      return;
    }
    const selectedTab = tabContext?.active()?.ref;
    if (!selectedTab) {
      return;
    }
    const rootRect = resolvedRoot.getBoundingClientRect();
    const tabRect = selectedTab.getBoundingClientRect();
    selectionIndicator.style.left = `${tabRect.left - rootRect.left}px`;
    selectionIndicator.style.width = `${tabRect.width}px`;
  });
  const audioTrigger = useAudio("TabListItem");
  const navigateNextTab = () => {
    if (tabContext?.activateNext()) {
      focusContext.focusCurrent();
      audioTrigger("tab-nav-next");
    }
  };
  const navigatePreviousTab = () => {
    if (tabContext?.activatePrevious()) {
      focusContext.focusCurrent();
      audioTrigger("tab-nav-previous");
    }
  };
  return (() => {
    var _el$2 = _tmpl$2(), _el$3 = _el$2.firstChild, _el$4 = _el$3.nextSibling, _el$5 = _el$4.nextSibling, _el$6 = _el$5.nextSibling;
    use(setRoot, _el$2);
    spread(_el$2, mergeProps(props, {
      get ["class"]() {
        return `flex flex-row items-stretch justify-stretch relative uppercase font-title text-base text-accent-2 tracking-150 min-h-16 px-4 ${props.class ?? ""}`;
      },
      "data-name": "TabList"
    }), false, true);
    insert(_el$2, createComponent(Show, {
      get when() {
        return showNavHelp();
      },
      get children() {
        return createComponent(Activatable, {
          "class": "absolute top-4 -left-10",
          disableFocus: true,
          get disabled() {
            return props.disabled;
          },
          get hotkeyAction() {
            return prevHotkey();
          },
          onActivate: navigatePreviousTab,
          get children() {
            return createComponent(NavHelp, {});
          }
        });
      }
    }), _el$6);
    insert(_el$2, createComponent(For, {
      get each() {
        return tabContext?.tabs();
      },
      children: (tab) => createComponent(Tab.Trigger, {
        get name() {
          return tab.name;
        },
        get children() {
          return createComponent(TabListItem, {
            ref(r$) {
              var _ref$5 = tab.ref;
              typeof _ref$5 === "function" ? _ref$5(r$) : tab.ref = r$;
            },
            get disabled() {
              return (props.disabled || tab.disabled) ?? false;
            },
            get selected() {
              return tabContext?.isActive(tab.name) || false;
            },
            get titleClass() {
              return props.titleClass;
            },
            get children() {
              return tab.title();
            }
          });
        }
      })
    }), _el$6);
    insert(_el$2, createComponent(Show, {
      get when() {
        return showNavHelp();
      },
      get children() {
        return createComponent(Activatable, {
          "class": "absolute top-4 -right-10",
          disableFocus: true,
          get disabled() {
            return props.disabled;
          },
          get hotkeyAction() {
            return nextHotkey();
          },
          onActivate: navigateNextTab,
          get children() {
            return createComponent(NavHelp, {});
          }
        });
      }
    }), _el$6);
    var _ref$4 = selectionIndicator;
    typeof _ref$4 === "function" ? use(_ref$4, _el$6) : selectionIndicator = _el$6;
    return _el$2;
  })();
};
const TabListPipsComponent = (props) => {
  const tabContext = useContext(TabContext);
  const focusContext = useContext(FocusContext);
  const showNavHelp = createMemo(() => props.showNavHelp ?? true);
  const nextHotkey = createMemo(() => props.nextHotkey ?? "nav-next");
  const prevHotkey = createMemo(() => props.previousHotkey ?? "nav-previous");
  const audioTrigger = useAudio("RadioItem");
  const navigateNextTab = () => {
    if (tabContext?.activateNext()) {
      focusContext.focusCurrent();
      audioTrigger("tab-nav-next");
    }
  };
  const navigatePreviousTab = () => {
    if (tabContext?.activatePrevious()) {
      focusContext.focusCurrent();
      audioTrigger("tab-nav-previous");
    }
  };
  return (() => {
    var _el$7 = _tmpl$();
    spread(_el$7, mergeProps(props, {
      get ["class"]() {
        return `flex flex-row items-center justify-center ${props.class ?? ""}`;
      },
      "data-name": "TabListPips"
    }), false, true);
    insert(_el$7, createComponent(Show, {
      get when() {
        return tabContext && tabContext?.tabs().length > 1;
      },
      get children() {
        return [createComponent(ArrowButton, {
          "class": `mr-1 -my-1`,
          hideForController: true,
          disableFocus: true,
          get disabled() {
            return props.disabled;
          },
          onActivate: navigatePreviousTab
        }), createComponent(Show, {
          get when() {
            return showNavHelp();
          },
          get children() {
            return createComponent(Activatable, {
              "class": "mr-1",
              disableFocus: true,
              get disabled() {
                return props.disabled;
              },
              get hotkeyAction() {
                return prevHotkey();
              },
              onActivate: navigatePreviousTab,
              get children() {
                return createComponent(NavHelp, {
                  "class": "size-10"
                });
              }
            });
          }
        })];
      }
    }), null);
    insert(_el$7, createComponent(Show, {
      get when() {
        return !props.showPages;
      },
      get fallback() {
        return (() => {
          var _el$8 = _tmpl$3();
          insert(_el$8, tabContext && createComponent(L10n.Compose, {
            text: "LOC_ADVISOR_COUNCIL_PAGE",
            get args() {
              return [tabContext?.getActiveTabIndex(), tabContext?.tabs().length];
            }
          }));
          return _el$8;
        })();
      },
      get children() {
        return createComponent(For, {
          get each() {
            return tabContext?.tabs();
          },
          children: (tab) => createComponent(Tab.Trigger, {
            get name() {
              return tab.name;
            },
            get children() {
              return createComponent(RadioButton, {
                disableFocus: true,
                get size() {
                  return props.size;
                },
                get isChecked() {
                  return tabContext?.isActive(tab.name) || false;
                },
                "class": "m-0\\.5"
              });
            }
          })
        });
      }
    }), null);
    insert(_el$7, createComponent(Show, {
      get when() {
        return tabContext && tabContext?.tabs().length > 1;
      },
      get children() {
        return [createComponent(Show, {
          get when() {
            return showNavHelp();
          },
          get children() {
            return createComponent(Activatable, {
              "class": "ml-1",
              disableFocus: true,
              get disabled() {
                return props.disabled;
              },
              get hotkeyAction() {
                return nextHotkey();
              },
              onActivate: navigateNextTab,
              get children() {
                return createComponent(NavHelp, {
                  "class": "size-10"
                });
              }
            });
          }
        }), createComponent(ArrowButton, {
          "class": `ml-1 -my-1`,
          hideForController: true,
          right: true,
          disableFocus: true,
          get disabled() {
            return props.disabled;
          },
          onActivate: navigateNextTab
        })];
      }
    }), null);
    return _el$7;
  })();
};
const Tab = ComponentRegistry.register("Tab", TabComponent);
Tab.Item = ComponentRegistry.register("Tab.Item", TabItemComponent);
Tab.Output = ComponentRegistry.register("Tab.Output", TabOutputComponent);
Tab.Title = ComponentRegistry.register("Tab.Title", TabTitleComponent);
Tab.Trigger = ComponentRegistry.register("Tab.Trigger", createTrigger(TabContext));
Tab.TabList = ComponentRegistry.register({
  name: "Tab.TabList",
  createInstance: TabListComponent,
  images: ["blp:base_tabbar-selector", "blp:base_tabbar-bg", "blp:base_tabbar-endcap"]
});
Tab.TabListPips = ComponentRegistry.register("Tab.TabListPips", TabListPipsComponent);

export { Tab, TabContext, TabContextProvider, useTabContext };
//# sourceMappingURL=tab.js.map
