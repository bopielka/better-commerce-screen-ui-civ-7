# 03 — Platform notes: Civ VII `ui-next`, Solid.js, and the engine

This is the document to read before writing any new UI code for this mod. Everything here
was found the hard way; each item names the failure it prevents.

## The screen is Solid.js, not the old framework

Civ VII ships **two** UI frameworks side by side:

| | Old framework | `ui-next` |
|---|---|---|
| Defined with | `Controls.define(...)` | Solid.js components |
| Mod hook | `Controls.decorate(...)` | `ComponentRegistry.register(...)` |
| Class exported? | yes — prototype can be patched | no — only the registry |
| Used by | `panel-action`, most in-game panels | `screens/commerce/`, other newer screens |

The Commerce screen is `ui-next`. Consequences:

- **`Controls.decorate` does not work here.** It silently does nothing.
- The old `ui/resource-allocation/` files still ship and still load, but they lose on
  priority and are not what the player sees. **Editing them changes nothing.**
- `PanelAction` (`/base-standard/ui/action/panel-action.js`) *is* old-framework, which is
  precisely why `ui/screen/assign-notification.js` can patch its prototype.

Full analysis lives in the author's knowledge base, outside this repository:
`../../knowledge-base/25-ui-next-solidjs.md` and `../../knowledge-base/26-commerce-screen.md`.

## `ComponentRegistry` — the documented mod hook

```js
import { ComponentRegistry } from '/core/ui-next/services/component-registry.js';
import { CommerceResourcesContainer } from '/base-standard/ui-next/screens/commerce/commerce-screen-resources-tab.js';

// Capture whatever is registered at IMPORT time: the game's, or another mod's wrapper.
const originalFactory  = CommerceResourcesContainer.factory;
const overridePriority = (CommerceResourcesContainer.overridePriority ?? 0) + 100;

ComponentRegistry.register({
    name: 'CommerceResourcesContainer',
    overridePriority,
    createInstance: (props) => { /* ...our work... */ return originalFactory(props); },
});
```

Rules:

- **Load order does not matter** — priority decides.
- Take `existing + 100`, never a hard-coded number. That lands outside whoever is already
  there regardless of load order, and calling `originalFactory` keeps their wrapper *and* the
  game's own component alive. Resource+ sits at 1100 on this same component.
- Pass `styles: [...]` when replacing a component that carried a stylesheet — see
  `ui/screen/factory-tab.js`, which passes `screenStyle`.

## Solid, without a build step

A mod's scripts are plain ES modules. There is **no JSX and no compiler**, so components are
written in Solid's compiled form:

```js
createComponent(Tab.Item, {
    name: 'Factory',
    title: () => 'LOC_RESOURCECLASS_FACTORY_NAME',
    body:  () => createComponent(FactoryResourcesContainer, {}),
});
```

⚠️ **The getters are not decoration.** A plain value in a reactive prop position reads the
model once and never updates:

```js
get children() { return model.data.ornatePanelData; }   // reactive
children: model.data.ornatePanelData                    // read once, then stale
```

Useful imports:

```js
import { Show, createComponent, createMemo, mergeProps, onCleanup, onMount }
    from '/core/vendor/solid-js/dist/solid.js';
import { template } from '/core/vendor/solid-js/web/dist/web.js';
```

`template(...)` builds a detached host element that imperative code can then fill — the
pattern both `ui/screen/empire-tab.js` and `factory-resources.js` use, because nothing in
those tabs changes while they are open and a reactive tree would be machinery guarding a
value that cannot move.

### Reaching the model

`useCommerceScreenContext()` may **only** be called while a component is being set up. Anything
running later — a `window` input handler, a `MutationObserver` callback — cannot call it. So
the wrapper calls it once and parks the result:

```js
// ui/screen/resources-tab.js
onMount(()   => setCommerceModel(model));
onCleanup(() => clearCommerceModel(model));
```

and everything else reads `getCommerceModel()` from `ui/model/screen-model.js`.

⚠️ `clearCommerceModel` only clears **its own instance**. The screen can be re-opened before
the old one's cleanup runs, and clearing unconditionally would blank the new model.

`useAudio(...)` has the same restriction — resolve it during setup, call the result later.

The model is a `createMutable` store, which is why `ui/screen/bulk-assign.js` can simply
reassign `model.slotSelectedResource` and put it back on cleanup.

## This DOM implementation is not a browser

| Missing / different | Use instead |
|---|---|
| `element.replaceChildren()` — **throws** "is not a function" | `clearChildren()` in `ui/support/dom.js` |
| Modern append APIs | `appendChild` only — `appendAll()` in `ui/support/dom.js` |
| `display: grid` — appears nowhere in the entire shipped game | flexbox; do not find out the hard way |
| `console.log` — never reaches `Logs\UI.log` | `console.error`, via `ui/support/diagnostics.js` |
| `calc()` **mixing a percentage with a length** — the whole declaration is dropped | keep `calc()` to one unit family, or avoid it |
| `PlotCoord` — **not a global**, unlike almost every other engine name | `import { PlotCoord } from '/core/ui/utilities/utilities-plotcoord.js'` |

`document.elementsFromPoint` **does** work and is what the game's own drag-and-drop uses to
resolve dropzones. `MutationObserver`, `requestAnimationFrame`, `CustomEvent` and
`localStorage` all work.

`rem` scales with resolution in this UI, so sizing in `rem` keeps proportions across screen
sizes — `ui/screen/layout.js` relies on this when budgeting horizontal space between the
button bar and the tab strip.

⚠️ `calc()` works, but **only within one unit family.** Every `calc()` in the entire shipped
game is length-only (`calc(1rem + 0.2222rem)`, `calc(29.6em + 2.6667rem)`); not one mixes a
percentage with a length. `calc(100% - 0.6rem)` had the *whole* `width` declaration dropped, so
the element fell back to `flex-basis: auto` and sized to its own text — which reads on screen as
a full-width bar suddenly sitting in the first column with cards beside it. To inset a
full-width box without overflowing its row, use padding: `box-sizing: border-box` covers padding
and border but **never margin**, so `width: 100%` plus any side margin overhangs the line — and
one over-wide child anywhere is enough to make the whole scroll area draggable sideways.

## Input: the engine withholds mouse actions while a modifier is held

⚠️ **This is the single most expensive fact in the repository.** Traced with an input spy:

```
plain right-click:   dom mousedown button=2 shiftKey=false
                     engine-input mousebutton-right START ... FINISH
Shift + right-click: dom mousedown button=2 shiftKey=true isShiftDown=true
                     (no engine-input at all)
```

So:

- Anything listening only for `mousebutton-right` / `mousebutton-left` **can never see a
  modified click**. Two earlier attempts at reading Shift both looked broken; neither
  `event.shiftKey` nor `Input.isShiftDown()` was at fault — the event never arrived.
- The screen's `Activatable` fires `onActivate` from `mousebutton-left`, so **with Shift down
  the whole screen stops responding to clicks**. That is what `ui/screen/shift-click.js`
  exists to repair, by doing what `Activatable` would have done from the native DOM event.
- Native DOM mouse events fire for both cases and carry the modifier state. They drive every
  mouse feature in this mod.

⚠️ **`event.shiftKey` is NOT reliable, and the transcript above records ONE build rather than
a promise.** On a later build every mousedown and mouseup reported `shiftKey: false` with
Shift plainly held, while `Input.isShiftDown()` said true throughout — which broke
Shift-*clicking* while leaving the Shift *highlight* working, because the two ask different
sources. **Always test `event.shiftKey || isShiftHeld()`**, the way `resources-tab.js` and
`shift-click.js` both now do.

The engine action is still handled in one place, for one reason: a plain right-click is
`isCancelInput()` and the panel closes the screen on it. `ui/screen/resources-tab.js`
swallows it — in the **capture** phase on `window`, within a 400 ms window of the DOM
mouseup that did the work.

### Reading Shift

`Input.isShiftDown()` asks the engine and works in every input context. The game's own
tooltip manager uses it the same way. DOM `keydown`/`keyup` listeners are kept in
`ui/engine/shift.js` **only** as a fallback for a hypothetical build without it — tracking
Shift that way never once reported it as held.

### Injected elements are not `Activatable`

An injected `div` never receives `mousebutton-left`, so this mod's buttons are wired to
native DOM events by `bindActivatable()` in `ui/support/dom.js`, which also:

- **stops propagation** — otherwise the settlement card underneath treats the click as
  "assign the selected resource here";
- **`preventDefault()`s `mousedown`** so the press never moves DOM focus. The screen's focus
  system lights up the surroundings of whatever holds focus, which is why clicking the
  priority picker used to wash the filters, the card and the picker itself in yellow;
- guards against a 150 ms double activation (a click can arrive twice, mouse and touch).

## Player operations only *queue*

```js
Game.PlayerOperations.sendRequest(playerID, PlayerOperationTypes.ASSIGN_RESOURCE, args);
```

⚠️ The game state — and therefore the answer `canStart` gives about the *next* operation —
does not change until the engine has processed it. **Anything chaining operations must wait
in between.**

Two waiting strategies, and they are not interchangeable:

| | `ui/engine/wait.js` `waitForEngineEvent` | `ui/planner/place.js` `awaitAssignment` |
|---|---|---|
| Waits for | a named engine event, or 30 frames | this settlement actually holding the resource |
| Used by | unassign sequences, bulk assign | the placement loop |
| Why | releases are confirmed by `ResourceUnassigned` | ⚠️ `ResourceAssigned` fires **for every player**, so an AI assigning something across the map would release the loop early |

`awaitAssignment` polls every 4 ms rather than once a frame: the operation is processed on
the engine's own tick and a frame-aligned check can miss it by most of a frame — 16 ms wasted
per resource.

## Reading the game's data

`GameInfo` tables are **iterated, not queried**. `GameInfo.Resources.forEach(...)`,
`GameInfo.Resources.lookup(type)`. An uncached read is a full scan, which is why almost
everything in `ui/planner/facts.js` and `ui/planner/effects.js` is indexed once into a `Map`.

`Database.makeHash('AGE_MODERN')` is a **lookup, not a constant** — `ui/engine/age.js` works
the answer out once, because the planner would otherwise hash hundreds of thousands of times
during one "Assign All".

Traps found in the modifier tables (all in `ui/planner/effects.js`):

- ⚠️ **Not every resource modifier is in `ModifierMetadatas`.** Some are linked only by the
  modifier's own `ResourceType` *argument*. Reading metadata alone made Nickel score as a
  resource that does nothing at all.
- ⚠️ **Both `EffectType` and `CollectionType` come from `DynamicModifiers`**, keyed by
  `ModifierType`. `Modifiers` rows carry neither; reading `CollectionType` off a `Modifiers`
  row returns `undefined` every time.
- ⚠️ **Modifiers carry requirements, and most mean "cities only"** —
  `REQUIREMENT_CITY_HAS_BUILD_QUEUE` is the game's most common way of writing it, and a town
  does not have one.
- ⚠️ **A name in the data is a hypothesis.** `PER_RESOURCE`, `PER_AVAILABLE_RESOURCE_TYPE`,
  `PER_RESOURCE_TYPE` and `PER_SLOTTED_RESOURCE` do *not* differ in whether they scale with
  copies — all four do. Measured in a running game, against a reading of the names that
  predicted otherwise.

## Localisation and tooltips

- `Locale.compose(key, ...args)` for every user-visible string.
- `Locale.toLower`, `Locale.stylize` exist. ⚠️ **`Locale.stylize` strips elements** — it is a
  markup translator, not a pass-through, so a `<div>` per line vanishes and takes its line
  breaks with it. Use the game's own markup (`[B]`, `[icon:...]`) and plain newlines.
- Plain-text tooltips render into a bare div at **`#tooltip-root-content > div`** — by id,
  *not* `.tooltip__content`, which matches nothing.
- ⚠️ Multi-line tooltips need **both** `\n` in the text **and** `white-space: pre-wrap` on that
  selector. The renderer assigns into `innerHTML`, so a newline collapses like any HTML
  whitespace and the game's `[N]` marker resolves to that same newline rather than to `<br>`.
- Attach a tooltip with `data-tooltip-content` on the element; `data-tooltip-anchor="left"`
  positions it.

## Icons

```js
UI.getIcon('YIELD_GOLD', 'YIELD')     // → "blp:Yield_Gold" (mixed case!)
UI.getIcon('RESOURCE_COFFEE', 'RESOURCE')
UI.getIconBLP(resourceClassType)      // → a bare blp name, prefix it yourself
UI.getIcon('TRADE_ROUTE_LAND')        // no category
```

⚠️ Resource+ pattern-matched icon strings with `/YIELD_[A-Z_]+/`, which **never matches** —
`YIELD_HAPPINESS`'s icon is `blp:Yield_Happiness`, in mixed case. Every yield total read that
way came back as 0, which is why its happiness rescue did nothing at all. Build the map by
asking `UI.getIcon` for every yield and indexing the answers — `yieldTypeFromIcon` in
`ui/planner/facts.js`.

Font icons used by name in this mod: `blp:fi_nar_rew_combat_64`,
`blp:fi_victorypoint_economic_64`, `blp:fi_growth_rate_64`, `blp:fi_action_heal_64`.

## Working with Solid-rendered DOM from the outside

The screen rebuilds its DOM whenever the model changes, so anything injected must be
re-injected. The pattern used throughout `ui/screen/`:

```js
const run = () => { try { inject(); } catch (e) { warn(...); } };
run();
observer = new MutationObserver(run);
observer.observe(document.body, { childList: true, subtree: true });
```

⚠️ **Re-entrancy is the hazard.** Appending an element is itself a `childList` mutation, so an
injector that mutates on every pass is an infinite loop, not a wasted pass — this froze the
game once. Two defences, both used:

1. Write injectors that **do not mutate when there is nothing to do** (`if (row.querySelector(...)) return;`).
2. A boolean guard around the whole pass — `injecting`, `decorating`, `applying`.

Observers that only need to catch an element *appearing* should disconnect themselves
(`ui/screen/assign-all-buttons.js`); observers that must keep re-injecting stay attached
(`ui/screen/settlement-controls.js`, `trade-routes.js`).

Other DOM facts relied on by this mod:

| Selector | Is |
|---|---|
| `[data-name="TabList"]` | the tab strip; **its parent** is the positioned row every summary and the button bar hang in |
| `[data-name^="city-resource-container-"]` | a settlement card, named by settlement |
| `[data-name$="-city-resource-activatable"]` | the whole clickable settlement card |
| `[data-name="commerce-unassigned-resources"]` | one per rendered pool section |
| `.size-19` | one slotted resource (the game gives them an explicit size to work around a layout bug) |
| `[data-name="filter-and-sort"]` | the filter/sort slot |
| `.trade-route-card` / `.trade-route-cards-row` | a route card / the row it wraps in |
| `.focusable-card-activatable` + `.w-128.min-h-64` | a treasure card / the panel inside it |

⚠️ **The visible panel is the child, not the card.** Both `TradeRouteCard` and the treasure
card spread their remaining props onto an inner `CardFrame`, so the width and margin the tab
computes land on the *frame* — and sizing the outer element alone changes nothing on screen.
This wasted two rounds of work on each tab.

⚠️ Cards may be matched to model entries **by name, never by position** — sorting and
filtering the settlement list would otherwise pair a card with the wrong settlement. See
`ui/model/screen-model.js`.

⚠️ Content renders behind a **`ThrobberSuspense`** boundary, so at `onMount` time the tab body
is still a placeholder. Anything that must find a real element has to watch for it rather
than look once.
