import { template, insert, className, Portal, setAttribute, spread, use } from '../../vendor/solid-js/web/dist/web.js';
import { createContext, useContext, createSignal, createMemo, onMount, onCleanup, createComponent, createRenderEffect, createEffect, on, batch, Show, mergeProps, splitProps, children } from '../../vendor/solid-js/dist/solid.js';
import { Activatable } from './activatable.js';
import { L10n } from './l10n.js';
import { KBMNavHelp, NavHelp } from './nav-help.js';
import { Slot } from './slot.js';
import { TooltipModel, HIDE_TOOLTIPS_HOLD_THRESHOLD_MS } from './tooltip-model.js';
import { TriggerActivationContext, TriggerActivationContextProvider, TriggerType } from './trigger.js';
import { ComponentRegistry } from '../services/component-registry.js';
import { FocusManager } from '../services/focus-manager.js';
import { isFocusable, useFocusContext } from '../services/focus.js';
import { HotkeyIconContext } from '../services/hotkey.js';
import { IsKeyboardActive, IsMouseActive, IsTouchActive } from '../services/input.js';
import { createArraySignal, createPropsRefSignal, createLayoutComplete } from '../utilities/solid-utilities.js';
import { NestedTooltipContext, isNestedTooltipContextDisabled } from './tooltip-nested.js';
import './tooltip-hidden-hint.js';

var _tmpl$ = /* @__PURE__ */ template(`<div></div>`), _tmpl$2 = /* @__PURE__ */ template(`<span class="hidden"></span>`), _tmpl$3 = /* @__PURE__ */ template(`<div class="flex flex-row items-center"></div>`), _tmpl$4 = /* @__PURE__ */ template(`<span class="flex flex-row items-center">&nbsp;</span>`), _tmpl$5 = /* @__PURE__ */ template(`<div class="flex items-center justify-center"></div>`), _tmpl$6 = /* @__PURE__ */ template(`<div class="relative h-0\\.5 w-full flex-auto bg-secondary scale-0 origin-center -mb-2 rounded"></div>`), _tmpl$7 = /* @__PURE__ */ template(`<div class="tooltip-frame-focus-glow"></div>`), _tmpl$8 = /* @__PURE__ */ template(`<div class="absolute top-1 left-1 rotate-180 size-4 bg-contain opacity-30"></div>`), _tmpl$9 = /* @__PURE__ */ template(`<div class="absolute top-1 right-1 -rotate-90 size-4 bg-contain opacity-30"></div>`), _tmpl$10 = /* @__PURE__ */ template(`<div class="absolute bottom-1 left-1 rotate-90 size-4 bg-contain opacity-30"></div>`), _tmpl$11 = /* @__PURE__ */ template(`<div class="absolute bottom-1 right-1 size-4 bg-contain opacity-30"></div>`), _tmpl$12 = /* @__PURE__ */ template(`<div><div class="flex flex-col items-stretch"></div></div>`), _tmpl$13 = /* @__PURE__ */ template(`<div role="heading"></div>`);
const _PROTECTED_IMPORTS = [isFocusable];
const MAX_VISIBLE_TOOLTIPS = 20;
const TooltipNavigationRules = /* @__PURE__ */ new Map([[InputNavigationAction.UP, (context) => {
  const firstFocusable = context.children()[0];
  context.focusChild(firstFocusable);
}], [InputNavigationAction.LEFT, (context) => context.focusPrevious()], [InputNavigationAction.RIGHT, (context) => context.focusNext()], [InputNavigationAction.NONE, (context) => context.focusCurrent()]]);
var TooltipVerticalPosition = /* @__PURE__ */ ((TooltipVerticalPosition2) => {
  TooltipVerticalPosition2["AUTO"] = "auto";
  TooltipVerticalPosition2["TOP"] = "top";
  TooltipVerticalPosition2["CENTER"] = "center";
  TooltipVerticalPosition2["BOTTOM"] = "bottom";
  return TooltipVerticalPosition2;
})(TooltipVerticalPosition || {});
var TooltipHorizontalPosition = /* @__PURE__ */ ((TooltipHorizontalPosition2) => {
  TooltipHorizontalPosition2["AUTO"] = "auto";
  TooltipHorizontalPosition2["LEFT_COVER"] = "left_cover";
  TooltipHorizontalPosition2["LEFT"] = "left";
  TooltipHorizontalPosition2["CENTER"] = "center";
  TooltipHorizontalPosition2["RIGHT_COVER"] = "right_cover";
  TooltipHorizontalPosition2["RIGHT"] = "right";
  return TooltipHorizontalPosition2;
})(TooltipHorizontalPosition || {});
function inPx(value) {
  return value === void 0 ? void 0 : `${value}px`;
}
const isTargetClipped = (el) => {
  const rect = el.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
    return true;
  }
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clips = style.overflow !== "visible" || style.overflowX !== "visible" || style.overflowY !== "visible";
    if (!clips) {
      continue;
    }
    const clip = parent.getBoundingClientRect();
    if (rect.bottom <= clip.top || rect.top >= clip.bottom || rect.right <= clip.left || rect.left >= clip.right) {
      return true;
    }
  }
  return false;
};
const TooltipContext = createContext();
function flipVertical(pos) {
  switch (pos) {
    case "top" /* TOP */:
      return "bottom" /* BOTTOM */;
    case "bottom" /* BOTTOM */:
      return "top" /* TOP */;
    default:
      return pos;
  }
}
function flipHorizontal(pos) {
  switch (pos) {
    case "left" /* LEFT */:
      return "right" /* RIGHT */;
    case "right" /* RIGHT */:
      return "left" /* LEFT */;
    case "left_cover" /* LEFT_COVER */:
      return "right_cover" /* RIGHT_COVER */;
    case "right_cover" /* RIGHT_COVER */:
      return "left_cover" /* LEFT_COVER */;
    default:
      return pos;
  }
}
function getTooltipEnterClass(vPosition, hPosition) {
  const vertical = vPosition === "top" /* TOP */ ? "top" : vPosition === "bottom" /* BOTTOM */ ? "bottom" : "center";
  const horizontal = hPosition === "left" /* LEFT */ || hPosition === "left_cover" /* LEFT_COVER */ ? "left" : hPosition === "right" /* RIGHT */ || hPosition === "right_cover" /* RIGHT_COVER */ ? "right" : "center";
  return `ui-next-tooltip-enter--${vertical}-${horizontal}`;
}
function computeTooltipPosition(targetRect, tooltip, desiredV, desiredH, offset) {
  const tooltipWidth = tooltip.offsetWidth;
  const tooltipHeight = tooltip.offsetHeight;
  const screenHeight = window.innerHeight;
  const screenWidth = window.innerWidth;
  const targetCenterX = targetRect.x + targetRect.width / 2;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const tooltipLocalCenterX = tooltipWidth / 2;
  let calcVPos = desiredV;
  let calcHPos = desiredH;
  if (calcVPos === "auto" /* AUTO */) {
    calcVPos = targetCenterY <= screenHeight / 2 ? "bottom" /* BOTTOM */ : "top" /* TOP */;
  }
  if (calcHPos === "auto" /* AUTO */) {
    const thirdWidth = screenWidth / 3;
    if (targetCenterX < thirdWidth) {
      calcHPos = calcVPos === "center" /* CENTER */ ? "right" /* RIGHT */ : "right_cover" /* RIGHT_COVER */;
    } else if (targetCenterX < thirdWidth * 2) {
      if (calcVPos === "center" /* CENTER */) {
        calcHPos = targetCenterY > screenWidth / 2 ? "right" /* RIGHT */ : "left" /* LEFT */;
      } else {
        calcHPos = "center" /* CENTER */;
      }
    } else {
      calcHPos = calcVPos === "center" /* CENTER */ ? "left" /* LEFT */ : "left_cover" /* LEFT_COVER */;
    }
  }
  let top = 0;
  let left = 0;
  switch (calcVPos) {
    case "top" /* TOP */:
      top = targetRect.top - tooltipHeight - offset;
      break;
    case "bottom" /* BOTTOM */:
      top = targetRect.bottom + offset;
      break;
    case "center" /* CENTER */:
      top = targetCenterY - tooltipHeight / 2;
      break;
    default:
      calcVPos;
  }
  switch (calcHPos) {
    case "center" /* CENTER */:
      left = targetCenterX - tooltipLocalCenterX;
      break;
    case "left_cover" /* LEFT_COVER */:
      left = targetRect.right - tooltipWidth - offset;
      break;
    case "left" /* LEFT */:
      left = targetRect.left - tooltipWidth - offset;
      break;
    case "right" /* RIGHT */:
      left = targetRect.right + offset;
      break;
    case "right_cover" /* RIGHT_COVER */:
      left = targetRect.left + offset;
      break;
    default:
      calcHPos;
  }
  const safeAreaMargins = UI.getSafeAreaMargins();
  const overflow = {
    above: top < safeAreaMargins.top,
    below: top + tooltipHeight > screenHeight - safeAreaMargins.bottom,
    left: left < safeAreaMargins.left,
    right: left + tooltipWidth > screenWidth - safeAreaMargins.right
  };
  return {
    top,
    left,
    appliedVPos: calcVPos,
    appliedHPos: calcHPos,
    overflow
  };
}
let curTooltip = 0;
const TooltipRootComponent = (props) => {
  const parentCtx = useContext(TooltipContext);
  const nestedCtx = useContext(NestedTooltipContext);
  const tooltipModel = TooltipModel.get();
  const name = `tooltip-${curTooltip++}`;
  const [triggerContext, setTriggerContext] = createSignal(void 0);
  const [vPosition, setVPosition] = createSignal(props.initialVPosition);
  const [hPosition, setHPosition] = createSignal(props.initialHPosition);
  const [childTooltipList, setChildTooltipList] = createArraySignal([]);
  const offset = createMemo(() => props.offset ?? 0);
  if (!isNestedTooltipContextDisabled(nestedCtx)) {
    onMount(() => {
      parentCtx?.setChildTooltipList((tooltips) => {
        tooltips.push(name);
        return tooltips;
      });
      onCleanup(() => {
        parentCtx?.setChildTooltipList((tooltips) => {
          const index = tooltips.indexOf(name);
          if (index !== -1) {
            tooltips.splice(index, 1);
          }
          return tooltips;
        });
      });
    });
  }
  onMount(() => {
    const unregister = tooltipModel.register(name, childTooltipList);
    onCleanup(() => {
      unregister();
    });
  });
  return createComponent(TooltipContext.Provider, {
    get value() {
      return {
        name,
        initialVPosition: props.initialVPosition,
        initialHPosition: props.initialHPosition,
        offset,
        allowFlip: () => props.allowFlip ?? false,
        showFiligrees: () => props.showFiligrees ?? true,
        vPosition,
        setVPosition,
        hPosition,
        setHPosition,
        triggerContext,
        setTriggerContext,
        childTooltipList,
        setChildTooltipList
      };
    },
    get children() {
      return props.children;
    }
  });
};
const onMouseMove = (e) => {
  setMousePosition({
    x: e.clientX,
    y: e.clientY
  });
};
document.addEventListener("mousemove", onMouseMove, {
  capture: true
});
const [mousePosition, setMousePosition] = createSignal({
  x: 0,
  y: 0
});
const tooltipRoot = document.getElementById("uinext-tooltips") ?? document.body;
const TooltipContentInternal = (props) => {
  onMount(() => {
    const focusCtx = useFocusContext();
    focusCtx.register(props.root());
    props.setFocusCtx(focusCtx);
  });
  onCleanup(() => {
    props.focusCtx()?.unregister(props.root());
    props.setFocusCtx(null);
  });
  return (() => {
    var _el$ = _tmpl$();
    insert(_el$, () => props.children);
    createRenderEffect(() => className(_el$, `ui-next-tooltip-enter ${props.enterAnimationClass()}`));
    return _el$;
  })();
};
const TooltipActiveContentComponent = (props) => {
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error("TooltipActiveContentComponent must be used within a TooltipContext");
  }
  const shouldActivate = () => props.shouldActivate();
  const tooltipModel = TooltipModel.get();
  const focusManager = FocusManager.get();
  const [root, setRoot] = createPropsRefSignal(() => props.contentProps.ref);
  const parentNestedCtx = useContext(NestedTooltipContext);
  const nestedTooltipsDisabled = createMemo(() => {
    if (isNestedTooltipContextDisabled(parentNestedCtx)) {
      return true;
    }
    const active = tooltipModel.active();
    return active.length >= MAX_VISIBLE_TOOLTIPS && active[active.length - 1] === ctx.name;
  });
  const [top, setTop] = createSignal();
  const [left, setLeft] = createSignal();
  const [scale, setScale] = createSignal(1);
  const [isCalculatingPosition, setIsCalculatingPosition] = createSignal(true);
  const [didCalculatePosition, setDidCalculatePosition] = createSignal(false);
  const [isAnimating, setIsAnimating] = createSignal(false);
  const [isClipped, setIsClipped] = createSignal(false);
  const isLayoutComplete = createLayoutComplete();
  const target = createMemo(() => tooltipModel.getTarget(ctx.name));
  const [targetRect, setTargetRect] = createSignal();
  const isTop = createMemo(() => {
    const active = tooltipModel.active();
    return active.length > 0 && active[active.length - 1] === ctx.name;
  });
  createEffect(on([() => tooltipModel.isActive(ctx.name), isAnimating], () => {
    setDidCalculatePosition(false);
  }));
  const shouldShow = createMemo(() => targetRect() !== void 0 && !isClipped());
  const enterAnimationClass = createMemo(() => getTooltipEnterClass(ctx.vPosition() ?? "auto" /* AUTO */, ctx.hPosition() ?? "auto" /* AUTO */));
  const setTargetRectFromXY = (x, y) => {
    setTargetRect({
      x,
      y,
      width: 0,
      height: 0,
      top: y,
      right: x,
      bottom: y,
      left: x
    });
  };
  const onCameraChanged = (_state) => {
    const currentTarget = target();
    if (currentTarget && !(currentTarget instanceof HTMLElement) && !tooltipModel.isLocked(ctx.name)) {
      const screenUV = WorldUI.getScreenPlotPos(currentTarget);
      if (screenUV) {
        const x = screenUV.x * window.innerWidth;
        const y = screenUV.y * window.innerHeight;
        setTargetRectFromXY(x, y);
      } else {
        setTargetRect(void 0);
      }
    }
  };
  const isKBM = createMemo(() => IsKeyboardActive() || IsMouseActive());
  createEffect(() => {
    if (isTop()) {
      engine.on("CameraChanged", onCameraChanged);
      onCleanup(() => {
        engine.off("CameraChanged", onCameraChanged);
      });
    }
  });
  createEffect(on([target, () => tooltipModel.isLocked(ctx.name), mousePosition], ([currentTarget, isLocked, currentMousePosition]) => {
    if (currentTarget && !(currentTarget instanceof HTMLElement) && isTop() && !isLocked) {
      if (isKBM()) {
        const hoveredPlot = Camera.pickPlotFromPoint(currentMousePosition.x, currentMousePosition.y);
        if (hoveredPlot?.x === currentTarget.x && hoveredPlot?.y === currentTarget.y) {
          setTargetRectFromXY(currentMousePosition.x, currentMousePosition.y);
        } else {
          setTargetRect(void 0);
        }
      } else {
        const screenUV = WorldUI.getScreenPlotPos(currentTarget);
        if (screenUV) {
          const x = screenUV.x * window.innerWidth;
          const y = screenUV.y * window.innerHeight;
          setTargetRectFromXY(x, y);
        } else {
          setTargetRect(void 0);
        }
      }
    } else {
      if (currentTarget instanceof HTMLElement) {
        setTargetRect(currentTarget.getBoundingClientRect());
      }
    }
  }));
  createEffect(() => {
    const currentRoot = root();
    const currentTarget = target();
    if (!(currentTarget instanceof HTMLElement) || !currentRoot || !isTop() || tooltipModel.isLocked(ctx.name)) {
      return;
    }
    const updateTargetRect = () => {
      setTargetRect(currentTarget.getBoundingClientRect());
    };
    let animationCount = 0;
    const onAnimationStart = (e) => {
      if (e.target instanceof Element && (e.target === currentTarget || e.target.contains(currentTarget))) {
        let isAnimationInfinite = true;
        if (e instanceof AnimationEvent) {
          const anim = e.target.getAnimations().find((a) => {
            if (a instanceof CSSAnimation) {
              return a.animationName === e.animationName;
            }
            return false;
          });
          if (anim?.effect != null) {
            isAnimationInfinite = anim.effect.getTiming().iterations === Infinity;
          } else {
            const style = getComputedStyle(e.target);
            isAnimationInfinite = style.animationIterationCount === "infinite";
          }
        } else if (e instanceof TransitionEvent) {
        }
        if (!isAnimationInfinite) {
          animationCount++;
          setIsAnimating(true);
        }
      }
    };
    const onAnimationEnd = (e) => {
      if (e.target instanceof Element && (e.target === currentTarget || e.target.contains(currentTarget))) {
        animationCount--;
        if (animationCount === 0) {
          setIsAnimating(false);
        }
        updateTargetRect();
      }
    };
    let scrollRafHandle;
    const onScroll = (e) => {
      if (!(e.target instanceof Element) || !e.target.contains(currentTarget)) {
        return;
      }
      if (scrollRafHandle === void 0) {
        scrollRafHandle = requestAnimationFrame(() => {
          scrollRafHandle = void 0;
          setIsClipped(isTargetClipped(currentTarget));
        });
      }
    };
    const observer = new ResizeObserver(updateTargetRect);
    observer.observe(currentTarget);
    observer.observe(currentRoot);
    document.addEventListener("animationstart", onAnimationStart, true);
    document.addEventListener("transitionstart", onAnimationStart, true);
    document.addEventListener("animationend", onAnimationEnd, true);
    document.addEventListener("transitionend", onAnimationEnd, true);
    document.addEventListener("scroll", onScroll, true);
    onCleanup(() => {
      observer.disconnect();
      if (scrollRafHandle !== void 0) {
        cancelAnimationFrame(scrollRafHandle);
      }
      document.removeEventListener("animationstart", onAnimationStart, true);
      document.removeEventListener("transitionstart", onAnimationStart, true);
      document.removeEventListener("animationend", onAnimationEnd, true);
      document.removeEventListener("transitionend", onAnimationEnd, true);
      document.removeEventListener("scroll", onScroll, true);
    });
  });
  createEffect(() => {
    const tooltip = root();
    const currentTargetRect = targetRect();
    if (!currentTargetRect || !tooltip || !isLayoutComplete() || !shouldActivate() || // ensure tooltip positions are calculated at least once,
    // mostly to ensure tooltips on touch have their positions calculated because they can start locked
    tooltipModel.isLocked(ctx.name) && didCalculatePosition()) {
      return;
    }
    const offset = ctx.offset ?? 0;
    setIsCalculatingPosition(true);
    waitForLayout(() => {
      if (!shouldActivate()) {
        setIsCalculatingPosition(false);
        return;
      }
      if (tooltipModel.isLocked(ctx.name) && didCalculatePosition()) {
        setIsCalculatingPosition(false);
        return;
      }
      const initial = computeTooltipPosition(currentTargetRect, tooltip, ctx.initialVPosition ?? ctx.vPosition() ?? "auto" /* AUTO */, ctx.initialHPosition ?? ctx.hPosition() ?? "auto" /* AUTO */, offset());
      let final = initial;
      if (ctx.allowFlip()) {
        const needFlipVertical = initial.overflow.above || initial.overflow.below;
        const needFlipHorizontal = initial.overflow.left || initial.overflow.right;
        if (needFlipVertical || needFlipHorizontal) {
          const flippedVPos = flipVertical(initial.appliedVPos);
          const flippedHPos = flipHorizontal(initial.appliedHPos);
          ctx.setVPosition(flippedVPos);
          ctx.setHPosition(flippedHPos);
          final = computeTooltipPosition(currentTargetRect, tooltip, flippedVPos, flippedHPos, offset());
        }
      }
      const safeAreaMargins = UI.getSafeAreaMargins();
      const tooltipWidth = tooltip.offsetWidth;
      const tooltipHeight = tooltip.offsetHeight;
      const screenHeight = window.innerHeight;
      const screenWidth = window.innerWidth;
      const scaleValue = Math.min(1, screenWidth / tooltipWidth, screenHeight / tooltipHeight);
      const xOffset = (1 - scaleValue) * tooltipWidth / 2;
      const yOffset = (1 - scaleValue) * tooltipHeight / 2;
      const scaledWidth = tooltipWidth * scaleValue;
      const scaledHeight = tooltipHeight * scaleValue;
      let idealVisualLeft = final.left;
      if (final.appliedHPos === "left" /* LEFT */ || final.appliedHPos === "left_cover" /* LEFT_COVER */) {
        idealVisualLeft += 2 * xOffset;
      } else if (final.appliedHPos === "center" /* CENTER */) {
        idealVisualLeft += xOffset;
      }
      let idealVisualTop = final.top;
      if (final.appliedVPos === "top" /* TOP */) {
        idealVisualTop += 2 * yOffset;
      } else if (final.appliedVPos === "center" /* CENTER */) {
        idealVisualTop += yOffset;
      }
      const clampedVisualTop = Math.min(Math.max(safeAreaMargins.top, idealVisualTop), screenHeight - scaledHeight - safeAreaMargins.bottom);
      const clampedVisualLeft = Math.min(Math.max(safeAreaMargins.left, idealVisualLeft), screenWidth - scaledWidth - safeAreaMargins.right);
      batch(() => {
        setTop(clampedVisualTop - yOffset);
        setLeft(clampedVisualLeft - xOffset);
        setScale(scaleValue);
        setIsCalculatingPosition(false);
        setDidCalculatePosition(true);
      });
    });
  });
  createEffect(on(() => tooltipModel.isLocked(ctx.name), (locked) => {
    const currentRoot = root();
    if (locked && currentRoot) {
      FocusManager.get().setFocus(currentRoot);
      onCleanup(() => {
        if (focusManager.currentFocus() === currentRoot) {
          focusManager.setFocus(document.body);
        }
      });
    }
  }));
  let inspectStartTime = 0;
  const onEngineInput = (inputEvent) => {
    const {
      name,
      status
    } = inputEvent.detail;
    if (tooltipModel.locked()) {
      inputEvent.preventDefault();
    }
    const isInspectAction = name === "keyboard-inspect-tooltip" || name === "toggle-tooltip";
    if (isInspectAction && status === InputActionStatuses.START) {
      inspectStartTime = performance.now();
      inputEvent.preventDefault();
      return;
    }
    if (status === InputActionStatuses.FINISH) {
      let didHandleEvent = false;
      if (isInspectAction) {
        const holdDuration = performance.now() - inspectStartTime;
        if (holdDuration >= HIDE_TOOLTIPS_HOLD_THRESHOLD_MS) {
          didHandleEvent = true;
        } else {
          tooltipModel.lock();
          didHandleEvent = true;
        }
      } else if (inputEvent.isCancelInput() && tooltipModel.locked()) {
        tooltipModel.unlockAll();
        didHandleEvent = true;
      }
      if (didHandleEvent) {
        inputEvent.preventDefault();
      }
    }
  };
  createEffect(() => {
    if (isTop()) {
      window.addEventListener("engine-input", onEngineInput, true);
      onCleanup(() => {
        window.removeEventListener("engine-input", onEngineInput, true);
      });
    } else {
      window.removeEventListener("engine-input", onEngineInput, true);
    }
  });
  const [focusCtx, setFocusCtx] = createSignal(null);
  const onNavigate = (navigationEvent) => {
    if (navigationEvent.detail.status != InputActionStatuses.FINISH) {
      return;
    }
    if (focusCtx()?.navigate(navigationEvent.detail.navigation)) {
      navigationEvent.preventDefault();
      navigationEvent.stopPropagation();
    }
  };
  return createComponent(Portal, {
    mount: tooltipRoot,
    get children() {
      return [createComponent(Show, {
        get when() {
          return tooltipModel.locked() == ctx.name;
        },
        get children() {
          return createComponent(Activatable, {
            name: "TooltipBackdrop",
            onActivate: () => tooltipModel.unlockAll(),
            disableTrigger: true,
            "class": "fixed inset-0 pointer-events-auto",
            style: {
              "background-color": "rgba(0 0 0 / .5)"
            }
          });
        }
      }), createComponent(Slot, mergeProps(() => props.contentProps, {
        name: "TooltipContentSlot",
        ref: setRoot,
        get disableFocus() {
          return !tooltipModel.isLocked(ctx.name);
        },
        get ["class"]() {
          return `absolute visible tooltip-content-root ${props.contentProps.class ?? ""}`;
        },
        get classList() {
          return {
            "opacity-0": isCalculatingPosition() && !didCalculatePosition() && !isAnimating(),
            hidden: !shouldShow(),
            "pointer-events-auto": tooltipModel.isLocked(ctx.name) || IsTouchActive(),
            "pointer-events-none": !tooltipModel.isLocked(ctx.name) && !IsTouchActive()
          };
        },
        get style() {
          return {
            top: inPx(top()),
            left: inPx(left()),
            transform: `scale(${scale()})`
          };
        },
        navRules: TooltipNavigationRules,
        lockNavigation: true,
        "on:navigate-input": onNavigate,
        "on:engine-input": (e) => {
          if (e.detail.status === InputActionStatuses.FINISH && e.detail.name === "touch-tap") {
            e.stopPropagation();
            if (!isTop()) {
              tooltipModel.pop();
            }
          }
        },
        tabIndex: -1,
        get children() {
          return createComponent(TooltipContentInternal, {
            root,
            focusCtx,
            setFocusCtx,
            enterAnimationClass,
            get children() {
              return createComponent(NestedTooltipContext.Provider, {
                value: {
                  disabled: nestedTooltipsDisabled
                },
                get children() {
                  return props.contentProps.children;
                }
              });
            }
          });
        }
      }))];
    }
  });
};
const TooltipContentComponent = (props) => {
  const tooltipModel = TooltipModel.get();
  const ctx = useContext(TooltipContext);
  if (!ctx) {
    throw new Error("Tooltip.Content must be used within a <Tooltip> root component");
  }
  const shouldActivate = () => !tooltipModel.tooltipsHidden() && (tooltipModel.isLocked(ctx.name) || tooltipModel.isActive(ctx.name));
  return (
    // Hidden span prevents empty text nodes being rendered as placeholders in the DOM tree
    (() => {
      var _el$2 = _tmpl$2();
      insert(_el$2, createComponent(Show, {
        get when() {
          return shouldActivate();
        },
        get children() {
          return createComponent(TooltipActiveContentComponent, {
            contentProps: props,
            shouldActivate
          });
        }
      }));
      createRenderEffect(() => setAttribute(_el$2, "data-tooltip-id", ctx.name));
      return _el$2;
    })()
  );
};
const TooltipInspectHintComponent = (props) => {
  const tooltipModel = TooltipModel.get();
  const ctx = useContext(TooltipContext);
  const [local, other] = splitProps(props, ["class", "progressBarRef", "isLargeContent", "handlers"]);
  const hotkeyIconProvider = {
    disabled: () => false,
    actionName: () => "toggle-tooltip"
  };
  if (!ctx && local.handlers == void 0) {
    throw new Error("Tooltip.InspectHint must be used within a <Tooltip> root component or managed individually using handlers.");
  }
  const isLocked = () => {
    if (local.handlers) {
      return local.handlers.isLocked();
    }
    if (ctx) {
      return tooltipModel.isLocked(ctx.name);
    }
  };
  const tooltipCount = createMemo(() => {
    if (local.handlers) {
      return local.handlers.tooltipCount();
    }
    if (ctx) {
      return ctx.childTooltipList().length;
    } else {
      console.error("Tooltip.InspectHint The tooltip count should be handled to show the tooltip.");
      return 0;
    }
  });
  const isTopLevelActiveAndLocked = createMemo(() => {
    if (local.handlers) {
      return local.handlers.isTopLevelActiveAndLocked();
    }
    const active = tooltipModel.active();
    if (ctx && active.length > 0) {
      return active[active.length - 1] == ctx.name && isLocked();
    } else {
      return isLocked();
    }
  });
  const shouldShowHoldToHideAction = createMemo(() => {
    if (local.handlers) return false;
    const hasTooltips = tooltipCount() > 0;
    const hasLargeContent = local.isLargeContent ? local.isLargeContent() : false;
    if (!hasTooltips && !hasLargeContent) return false;
    const active = tooltipModel.active();
    return active.length > 0 && active[0] === ctx?.name && !tooltipModel.isLocked(ctx.name);
  });
  const isKBM = createMemo(() => IsKeyboardActive() || IsMouseActive());
  const strClose = Locale.toUpper("LOC_GENERIC_CLOSE");
  const inspectText = () => createComponent(L10n.Stylize, {
    get text() {
      return isTopLevelActiveAndLocked() ? strClose : "LOC_INSPECT_TOOLTIP";
    },
    "class": "text-sm font-body uppercase mr-2",
    get classList() {
      return {
        "text-accent-1": isLocked()
      };
    },
    style: {
      "letter-spacing": "-0.5px"
    },
    role: "heading"
  });
  const navHelp = (isHoldAction = false) => {
    if (isKBM()) {
      return createComponent(KBMNavHelp, {
        actionName: "keyboard-inspect-tooltip",
        isHoldAction,
        holdTimeMs: HIDE_TOOLTIPS_HOLD_THRESHOLD_MS
      });
    } else {
      return createComponent(NavHelp, {
        actionName: "toggle-tooltip",
        "class": "size-8",
        isHoldAction,
        holdTimeMs: HIDE_TOOLTIPS_HOLD_THRESHOLD_MS
      });
    }
  };
  return createComponent(Show, {
    get when() {
      return createMemo(() => !!!IsTouchActive())() && (tooltipCount() > 0 || local.isLargeContent?.());
    },
    get children() {
      var _el$3 = _tmpl$();
      spread(_el$3, mergeProps(other, {
        get ["class"]() {
          return `flex flex-col justify-center items-center px-2 gap-1 text-sm text-accent-3 font-body uppercase ${local.class ?? ""}`;
        },
        "style": {
          "letter-spacing": "-0.5px"
        }
      }), false, true);
      insert(_el$3, createComponent(HotkeyIconContext.Provider, {
        value: hotkeyIconProvider,
        get children() {
          return [(() => {
            var _el$4 = _tmpl$5();
            insert(_el$4, createComponent(Show, {
              get when() {
                return createMemo(() => tooltipCount() > 0)() && (!isLocked() || isTopLevelActiveAndLocked());
              },
              get children() {
                var _el$5 = _tmpl$3();
                insert(_el$5, inspectText, null);
                insert(_el$5, navHelp, null);
                createRenderEffect(() => _el$5.classList.toggle("mr-1", !!shouldShowHoldToHideAction()));
                return _el$5;
              }
            }), null);
            insert(_el$4, createComponent(Show, {
              get when() {
                return shouldShowHoldToHideAction();
              },
              get children() {
                var _el$6 = _tmpl$4(), _el$7 = _el$6.firstChild;
                insert(_el$6, createComponent(L10n.Compose, {
                  text: "LOC_UI_HOLD_INPUT",
                  args: ["LOC_UI_GENERIC_HIDE"]
                }), _el$7);
                insert(_el$6, () => navHelp(true), null);
                return _el$6;
              }
            }), null);
            return _el$4;
          })(), createComponent(Show, {
            get when() {
              return tooltipCount() > 0;
            },
            get children() {
              var _el$8 = _tmpl$6();
              var _ref$ = local.progressBarRef;
              typeof _ref$ === "function" ? use(_ref$, _el$8) : local.progressBarRef = _el$8;
              return _el$8;
            }
          })];
        }
      }));
      return _el$3;
    }
  });
};
const TooltipTriggerInternal = (props) => {
  const [needsWrapper, setNeedsWrapper] = createSignal(false);
  const resolved = children(() => props.children);
  createEffect(on(resolved, (resolvedChildren) => {
    let element;
    if (resolvedChildren) {
      if (!Array.isArray(resolvedChildren) && resolvedChildren instanceof HTMLElement) {
        element = resolvedChildren;
      } else if (Array.isArray(resolvedChildren) && resolvedChildren.length === 1 && resolvedChildren[0] instanceof HTMLElement) {
        element = resolvedChildren[0];
      }
    }
    if (element) {
      element.addEventListener("mouseover", props.onShowTooltip);
      element.addEventListener("mouseleave", props.onMouseLeave);
      element.addEventListener("focus", props.onShowTooltip);
      element.addEventListener("blur", props.onBlur);
      element.addEventListener("engine-input", props.onShowTooltipTouch);
      onCleanup(() => {
        props.clearTooltipDelay();
        element.removeEventListener("mouseover", props.onShowTooltip);
        element.removeEventListener("mouseleave", props.onMouseLeave);
        element.removeEventListener("focus", props.onShowTooltip);
        element.removeEventListener("blur", props.onBlur);
        element.removeEventListener("engine-input", props.onShowTooltipTouch);
      });
      props.setRoot(element);
      setNeedsWrapper(false);
    } else {
      props.clearTooltipDelay();
      setNeedsWrapper(true);
    }
  }));
  return createComponent(Show, {
    get when() {
      return !needsWrapper();
    },
    get fallback() {
      return (() => {
        var _el$9 = _tmpl$();
        use(isFocusable, _el$9, () => [true, void 0]);
        var _ref$2 = props.setRoot;
        typeof _ref$2 === "function" ? use(_ref$2, _el$9) : props.setRoot = _el$9;
        spread(_el$9, mergeProps(() => props.hostProps, {
          get ["on:mouseover"]() {
            return props.onShowTooltip;
          },
          get ["on:mouseleave"]() {
            return props.onMouseLeave;
          },
          get ["on:focus"]() {
            return props.onShowTooltip;
          },
          get ["on:blur"]() {
            return props.onBlur;
          },
          get ["on:engine-input"]() {
            return props.onShowTooltipTouch;
          },
          get ["data-tooltip-id"]() {
            return props.tooltipName;
          }
        }), false, true);
        insert(_el$9, resolved);
        return _el$9;
      })();
    },
    get children() {
      return resolved();
    }
  });
};
const TooltipTriggerComponent = (props) => {
  const tooltipCtx = useContext(TooltipContext);
  if (!tooltipCtx) {
    throw new Error("Tooltip.Trigger must be used within a <Tooltip> root component");
  }
  const parentContext = useContext(TriggerActivationContext);
  const tooltipModel = TooltipModel.get();
  const triggerContext = new TriggerActivationContextProvider(tooltipModel, parentContext, () => tooltipCtx.name);
  tooltipCtx.setTriggerContext(triggerContext);
  const [root, setRoot] = createSignal();
  let tooltipDelayHandle;
  const clearTooltipDelay = () => {
    if (tooltipDelayHandle !== void 0) {
      clearTimeout(tooltipDelayHandle);
      tooltipDelayHandle = void 0;
    }
  };
  const triggerTooltipWithDelay = () => {
    clearTooltipDelay();
    const activeTooltips = tooltipModel.active();
    const delay = activeTooltips.length === 0 ? Configuration.getUser().tooltipDelay : 0;
    const triggerRoot = root();
    if (delay <= 0) {
      tooltipModel.triggerTooltip(tooltipCtx.name, TriggerType.Focus, triggerRoot);
      return;
    }
    tooltipDelayHandle = window.setTimeout(() => {
      tooltipDelayHandle = void 0;
      tooltipModel.triggerTooltip(tooltipCtx.name, TriggerType.Focus, triggerRoot);
    }, delay);
  };
  const onShowTooltip = (event) => {
    if (event instanceof MouseEvent && event.screenX === 0 && event.screenY === 0) {
      return;
    }
    event.stopPropagation();
    triggerTooltipWithDelay();
  };
  const onShowTooltipTouch = (event) => {
    if (event.detail.status !== InputActionStatuses.FINISH) {
      return;
    }
    if (event.detail.name !== "touch-press") {
      return;
    }
    const activeTooltips = tooltipModel.active();
    const isActive = activeTooltips[activeTooltips.length - 1] === tooltipCtx.name;
    if (isActive) {
      tooltipModel.pop();
    } else {
      if (activeTooltips.length > 0 && activeTooltips[activeTooltips.length - 1] !== parentContext?.name()) {
        if (tooltipModel.locked() !== activeTooltips[activeTooltips.length - 1] && activeTooltips[activeTooltips.length - 2] === parentContext?.name()) {
          tooltipModel.pop();
        } else {
          return;
        }
      }
      triggerTooltipWithDelay();
    }
    event.stopPropagation();
    event.preventDefault();
  };
  const onMouseLeave = (_event) => {
    clearTooltipDelay();
    tooltipModel.triggerTooltip(tooltipCtx.name, TriggerType.Blur, root());
  };
  const onBlur = (event) => {
    event.stopPropagation();
    clearTooltipDelay();
    tooltipModel.triggerTooltip(tooltipCtx.name, TriggerType.Blur, root());
  };
  onCleanup(() => {
    clearTooltipDelay();
  });
  return createComponent(TriggerActivationContext.Provider, {
    value: triggerContext,
    get children() {
      return createComponent(TooltipTriggerInternal, {
        get tooltipName() {
          return tooltipCtx.name;
        },
        hostProps: props,
        setRoot,
        clearTooltipDelay,
        onShowTooltip,
        onMouseLeave,
        onBlur,
        onShowTooltipTouch,
        get children() {
          return props.children;
        }
      });
    }
  });
};
const AUTOLOCK_PROGRESS_ANIMATION_NAME = "tooltip-autolock-progress";
const AUTOLOCK_FRAME_ANIMATION_NAME = "tooltip-autolock-frame";
const AUTOLOCK_FRAME_GLOW_DURATION_MS = 300;
const AUTOLOCK_FRAME_GLOW_LEAD_MS = 5 / 9 * AUTOLOCK_FRAME_GLOW_DURATION_MS;
const TooltipFrameComponent = (props) => {
  const ctx = useContext(TooltipContext);
  const tooltipModel = TooltipModel.get();
  const [local, other] = splitProps(props, ["hideHint", "class", "children"]);
  const [frameRef, setFrameRef] = createSignal(void 0);
  const [progressBarRef, setProgressBarRef] = createSignal(void 0);
  const [contentRef, setContentRef] = createSignal(void 0);
  const [isLargeContent, setIsLargeContent] = createSignal(false);
  let frameGlowTimeout;
  const isAutoLocking = createMemo(() => ctx ? tooltipModel.isAutoLocking(ctx.name) : false);
  const startAutoLockAnimation = (element, animationClass, durationMs) => {
    element.style.animationDuration = `${durationMs}ms`;
    element.classList.remove(animationClass);
    element.classList.add(animationClass);
  };
  const stopAutoLockAnimation = (element, animationClass) => {
    if (!element) {
      return;
    }
    element.classList.remove(animationClass);
    element.style.animationDuration = "";
  };
  const stopAllAnimations = () => {
    stopAutoLockAnimation(progressBarRef(), AUTOLOCK_PROGRESS_ANIMATION_NAME);
    stopAutoLockAnimation(frameRef(), AUTOLOCK_FRAME_ANIMATION_NAME);
    if (frameGlowTimeout !== void 0) {
      clearTimeout(frameGlowTimeout);
      frameGlowTimeout = void 0;
    }
  };
  const threshholdContentHeight = 200;
  createEffect(() => {
    const contentEl = contentRef();
    if (!contentEl) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsLargeContent(entry.contentRect.height > threshholdContentHeight);
      }
    });
    observer.observe(contentEl);
    onCleanup(() => observer.disconnect());
  });
  createEffect(on([isAutoLocking, progressBarRef, frameRef], ([autoLocking, progressBarRef2, frameRef2]) => {
    const autolockMs = Configuration.getUser().tooltipAutolock;
    if (autolockMs <= 100 || !progressBarRef2 || !frameRef2) {
      stopAllAnimations();
      return;
    }
    if (autoLocking) {
      startAutoLockAnimation(progressBarRef2, AUTOLOCK_PROGRESS_ANIMATION_NAME, autolockMs);
      const glowDelayMs = Math.max(0, autolockMs - AUTOLOCK_FRAME_GLOW_LEAD_MS);
      frameGlowTimeout = window.setTimeout(() => {
        startAutoLockAnimation(frameRef2, AUTOLOCK_FRAME_ANIMATION_NAME, AUTOLOCK_FRAME_GLOW_DURATION_MS);
        frameGlowTimeout = void 0;
      }, glowDelayMs);
    } else {
      stopAllAnimations();
    }
  }));
  return (() => {
    var _el$10 = _tmpl$12(), _el$16 = _el$10.firstChild;
    use(setFrameRef, _el$10);
    spread(_el$10, mergeProps(other, {
      get ["class"]() {
        return `img-tooltip-border img-tooltip-bg p-4 ${local.class ?? ""}`;
      },
      get classList() {
        return {
          "min-w-48": !local.hideHint
        };
      }
    }), false, true);
    insert(_el$10, createComponent(Show, {
      get when() {
        return createMemo(() => !!!IsMouseActive())() && !IsKeyboardActive();
      },
      get children() {
        return _tmpl$7();
      }
    }), _el$16);
    insert(_el$10, createComponent(Show, {
      get when() {
        return ctx?.showFiligrees();
      },
      get children() {
        return [(() => {
          var _el$12 = _tmpl$8();
          _el$12.style.setProperty("background-image", "url(blp:mp_player_detail)");
          return _el$12;
        })(), (() => {
          var _el$13 = _tmpl$9();
          _el$13.style.setProperty("background-image", "url(blp:mp_player_detail)");
          return _el$13;
        })(), (() => {
          var _el$14 = _tmpl$10();
          _el$14.style.setProperty("background-image", "url(blp:mp_player_detail)");
          return _el$14;
        })(), (() => {
          var _el$15 = _tmpl$11();
          _el$15.style.setProperty("background-image", "url(blp:mp_player_detail)");
          return _el$15;
        })()];
      }
    }), _el$16);
    use(setContentRef, _el$16);
    insert(_el$16, () => local.children);
    insert(_el$10, createComponent(Show, {
      get when() {
        return !local.hideHint;
      },
      get children() {
        return createComponent(Tooltip.InspectHint, {
          "class": "relative mt-2",
          progressBarRef: setProgressBarRef,
          isLargeContent
        });
      }
    }), null);
    return _el$10;
  })();
};
const TooltipTextInnerComponent = (props) => {
  const ctx = useContext(TooltipContext);
  const hasTooltips = createMemo(() => (ctx?.childTooltipList().length ?? 0) > 0);
  const showBg = createMemo(() => !!props.header || hasTooltips());
  return createComponent(Tooltip.Frame, {
    get ["class"]() {
      return `relative flex flex-col pb-1 max-w-128 w-full ${props.class ?? ""}`;
    },
    get children() {
      return [createComponent(Show, {
        get when() {
          return props.header;
        },
        children: (header) => (() => {
          var _el$18 = _tmpl$13();
          insert(_el$18, createComponent(L10n.Compose, {
            get text() {
              return header();
            }
          }));
          createRenderEffect(() => className(_el$18, `relative text-center font-title text-sm text-secondary mb-2 uppercase tracking-100 ${props.headerClass ?? ""}}`));
          return _el$18;
        })()
      }), (() => {
        var _el$17 = _tmpl$();
        insert(_el$17, createComponent(L10n.Stylize, {
          get text() {
            return props.text;
          },
          get args() {
            return props.args;
          },
          "class": "relative"
        }));
        createRenderEffect((_p$) => {
          var _v$ = `flex-auto w-full ${showBg() ? "p-3" : "p-0"} ${props.bodyClass ?? ""}`, _v$2 = !!showBg();
          _v$ !== _p$.e && className(_el$17, _p$.e = _v$);
          _v$2 !== _p$.t && _el$17.classList.toggle("img-base-ticket-bg", _p$.t = _v$2);
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$17;
      })()];
    }
  });
};
const TooltipTextComponent = (props) => {
  const [local, other] = splitProps(props, ["text", "args", "children", "header", "class", "headerClass", "bodyClass"]);
  return createComponent(Tooltip, mergeProps(other, {
    get showFiligrees() {
      return props.showFiligrees ?? false;
    },
    get children() {
      return [createComponent(Tooltip.Trigger, {
        get children() {
          return local.children;
        }
      }), createComponent(Tooltip.Content, {
        get children() {
          return createComponent(TooltipTextInnerComponent, local);
        }
      })];
    }
  }));
};
const TooltipLegacyTextComponent = (props) => {
  const [local, other] = splitProps(props, ["text", "args", "children"]);
  return createComponent(Tooltip, mergeProps(other, {
    showFiligrees: false,
    get children() {
      return [createComponent(Tooltip.Trigger, {
        get children() {
          return local.children;
        }
      }), createComponent(Tooltip.Content, {
        get children() {
          return createComponent(Tooltip.Frame, {
            "class": "relative flex flex-col pb-1 max-w-96 p-3 pointer-events-none break-words font-body text-xs",
            hideHint: true,
            get children() {
              return createComponent(L10n.Stylize, {
                get text() {
                  return local.text;
                },
                get args() {
                  return local.args;
                },
                "class": "relative"
              });
            }
          });
        }
      })];
    }
  }));
};
const Tooltip = ComponentRegistry.register("Tooltip", TooltipRootComponent);
Tooltip.Trigger = ComponentRegistry.register("Tooltip.Trigger", TooltipTriggerComponent);
Tooltip.Content = ComponentRegistry.register("Tooltip.Content", TooltipContentComponent);
Tooltip.Frame = ComponentRegistry.register("Tooltip.Frame", TooltipFrameComponent);
Tooltip.Text = ComponentRegistry.register("Tooltip.Text", TooltipTextComponent);
Tooltip.LegacyText = ComponentRegistry.register("Tooltip.LegacyText", TooltipLegacyTextComponent);
Tooltip.InspectHint = ComponentRegistry.register("Tooltip.InspectHint", TooltipInspectHintComponent);

export { Tooltip, TooltipContext, TooltipHorizontalPosition, TooltipNavigationRules, TooltipVerticalPosition };
//# sourceMappingURL=tooltip.js.map
