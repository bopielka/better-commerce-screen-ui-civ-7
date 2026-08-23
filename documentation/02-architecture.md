# 02 — Architecture

## The five layers

```
support  ←  engine  ←  model  ←  planner  ←  screen
```

A module may import from **its own folder or from one to its left**, never to its right.

`ui/options/` sits outside the chain. It may import a **settings module** and nothing else -
the value holders under `ui/planner/` and `ui/engine/`, which reach no further than
`engine/stored-setting.js` and `support/diagnostics.js` behind them. The direction is one-way:
the options screen writes to a setting, a setting never reads the options screen. ⚠️ This file
also loads in **shell** scope, where there is no game, so nothing it pulls in may touch the
game at import time.

| Layer | Folder | Knows about | Must not know about |
|---|---|---|---|
| `support` | `ui/support/` | nothing — plain JS and the DOM | the game, this mod |
| `engine` | `ui/engine/` | the game's globals (`Game`, `GameInfo`, `Input`, `engine`) | the DOM, the screen's model |
| `model` | `ui/model/` | the Commerce screen's data shapes, and how to rebuild them | the planner's decisions |
| `planner` | `ui/planner/` | what is worth placing where | the DOM, any UI widget |
| `screen` | `ui/screen/` | the DOM this mod adds and the components it wraps | — |

### Why this is load-bearing, not tidiness

The automatic assignment path (`ui/planner/auto-assign.js`) runs **with the Commerce screen
closed**. If anything in `planner/` imports from `screen/`, loading the assignment engine
drags the entire button bar in behind it.

This has already happened once: the "factories first" checkbox and the setting it changes
started life as one module in `screen/`. The planner imported it to ask a yes/no question,
and the whole UI came with it. The split is now:

- `ui/planner/factory-first-setting.js` — the value, its persistence, its change event
- `ui/screen/assign-switches.js` — the checkbox elements only, for this and for imports-first

The same reasoning put `ui/engine/age.js` in `engine/` rather than beside the Factory tab
that first needed it.

### The one exception, and why it is tolerated

`ui/model/headless-model.js` imports `isAssignableToSettlement` from `ui/planner/facts.js`,
which is a step to the **right**. It is recorded here rather than quietly left, because the
next person to notice it should not "fix" it by writing a second copy of that function - two
definitions of "can this resource go in a settlement at all" is exactly the class of bug the
headless model exists to prevent.

It is tolerated because the harm the rule prevents is specifically **`planner` reaching into
`screen`**: that is what would drag the whole button bar into the automatic path. `facts.js`
reaches no further than `effects.js` and `support/`, so nothing comes with it. The real repair
is to move the resource-class facts down into `engine/`, beside `resource-types.js`; it has not
been done because it touches the planner's hottest code for no behavioural gain.

### Which way `options/` points

`ui/options/` is outside the chain in both directions, so neither arrow above describes it:

- it **imports** settings modules (`planner/happiness-setting.js`, `planner/hoard-setting.js`,
  `engine/resource-locks.js`) in order to write to them;
- `planner/` and `screen/` **import it back**, to read `CommerceOptions`.

That is a cycle on paper and not one in practice: what the options screen writes to is a value
holder that reaches no further than `engine/stored-setting.js`, and what reads `CommerceOptions`
only ever reads. ⚠️ The rule that actually matters here is the shell one - this file loads in the
main menu, where there is no game, so nothing it pulls in may touch the game at import time.

## The entry point and load order

The `.modinfo` lists exactly **two** scripts:

```xml
<UIScripts>
    <Item>ui/options/najane-commerce-options.js</Item>
    <Item>ui/better-commerce-screen-ui.js</Item>
</UIScripts>
```

Everything else is pulled in by `import`, which also fixes the order — a module always runs
before the module importing it.

`ui/better-commerce-screen-ui.js` in full:

```js
import './screen/resources-tab.js';   // registers CommerceResourcesContainer
import './screen/factory-tab.js';     // replaces CommerceScreen outright
import './screen/trade-routes.js';    // wraps TradeRouteCard

import { startMerchantOrders } from './engine/merchant-orders.js';
import { startAutoAssign } from './planner/auto-assign.js';
import { startAssignNotification } from './screen/assign-notification.js';

startAutoAssign();
startAssignNotification();
startMerchantOrders();
startTreasureConvoys();
```

The last four run with the screen closed, so they are started here rather than from a
component's `onMount`. `startMerchantOrders` in particular looks after a merchant that is
still walking several turns after the Commerce screen was shut, and `startTreasureConvoys`
does the same for a Treasure Convoy still sailing home.

### Action groups and scopes

| Group | Scope | Contents |
|---|---|---|
| `najane-commerce-ui` | `game` | text + both scripts |
| `najane-commerce-shell` | `shell` | text + **the options script only** |

The options screen exists in the main menu as well as in game, so the options module has to
be registered in both scopes or the dropdown disappears from one of them. Nothing else
belongs in the shell.

`LoadOrder` is **1200**, above Resource+ (1100). The two are not compatible, but loading last
means this mod wins outright rather than half-applying if a player enables both.

⚠️ `version` on `<Mod>` must be an integer ≥ 1. It is parsed as an int, so `version="0.1"`
lands in `Mods.sqlite` as `Version 0` and the game then silently refuses to apply the mod:
discovered, shown as enabled, and never in `Modding.log`'s "enabled mods" list. The
human-readable version is the free-form string in `<Properties><Version>`.

## How the mod attaches itself

Three distinct mechanisms, chosen per target. See [Platform notes](03-platform-notes.md) for
the framework details.

| Target | Mechanism | Module |
|---|---|---|
| `CommerceResourcesContainer` | `ComponentRegistry.register`, wraps and calls the original | `ui/screen/resources-tab.js` |
| `CommerceScreen` | `ComponentRegistry.register`, **replaces** — a line-for-line transcription plus one `Show` | `ui/screen/factory-tab.js` |
| `TradeRouteCard` | `ComponentRegistry.register`, wraps for its mount/unmount signal only | `ui/screen/trade-routes.js` |
| `PanelAction` (old framework) | prototype patching — `Controls.define` classes *are* exported | `ui/screen/assign-notification.js` |
| `model.slotSelectedResource` | property reassignment on a `createMutable` store | `ui/screen/bulk-assign.js` |
| Everything else on screen | injected DOM + the shared observer | `ui/screen/*.js` |

### The shared doors

These modules exist so that a pattern is written once rather than per feature. Every one of
them replaced between three and six near-identical private copies, and in each case the copies
had **already drifted** — which is the argument for them, not the tidiness.

| Door | Module | Rule |
|---|---|---|
| every `engine.on` | `ui/engine/events.js` | filter by whose event it is; keep the handle so it can come off again |
| every remembered setting | `ui/engine/stored-setting.js` | never store a raw value — 0 means "never touched" |
| every DOM watch on this screen | `ui/screen/screen-observer.js` | one observer, scoped to `screen-resource-allocation`, one pass per frame |
| every selector more than one module needs | `ui/screen/screen-parts.js` | plus the tab-row summary the three rebuilt tabs share |
| every `UI.getIcon` / `UI.getIconBLP` | `ui/screen/icons.js` | a missing icon is a gap on a card, never a thrown tab |

A selector or a constant used by **one** module stays in that module. These are the ones more
than one needs.

⚠️ **Nothing in `ui/screen/` should construct its own `MutationObserver` on `document.body`.**
Four of them did. `document.body` with `subtree: true` is the whole HUD — unit flags, the
notification train, every tooltip that opens — so each callback woke on changes that had
nothing to do with the Commerce screen, and then searched the screen for something to fix.
`watchCommerceScreen(callback)` is the replacement; it hands back an unsubscribe, tears the
observer down when the last subscriber leaves, and discards the mutations a pass produces
itself so a pass cannot retrigger itself.

⚠️ **Its subscribers run from `requestAnimationFrame`, and that is load-bearing.** A
`MutationObserver` callback is a microtask and so is Solid's effect queue; touching the DOM
from inside the callback lands in the middle of a render Solid has begun and not finished. See
the note on `scheduleDecorate` in `ui/screen/trade-routes.js` for the crash that produced.

⚠️ **`ui/planner/auto-assign.js` attaches nothing while the setting is Off**, and Off is the
default. A feature that is switched off must cost nothing at all — answering "switched off"
inside the handler is not the same thing, because the handler has already been reached.

⚠️ `ui/screen/factory-tab.js` is **the one place that will break on a game patch touching the
Commerce screen's layout.** Everything else wraps or decorates; that one replaces. It is
written deliberately line-for-line against the game's own component so a future patch can be
diffed against it.

## Lifecycles — who starts and stops what

`ui/screen/resources-tab.js` is the hub. Its wrapper component's `onMount` starts, and its
`onCleanup` stops, everything that belongs to the **Resources tab**:

```
onMount:  setCommerceModel(model)
          window mousedown / mouseup / InputEngineEventName listeners
          startHoverHighlight, startBulkAssign, startShiftClick,
          startLayout, startAssignAllButtons, startSettlementControls,
          startTabIcons                              ← no stop counterpart, see below

onCleanup: the mirror image, plus clearCommerceModel(model)
```

Exceptions worth knowing:

- **`startTabIcons()` has no `stopTabIcons()` on purpose.** The tab strip belongs to the
  whole screen, not to the Resources tab; tearing icons down when that tab unmounts would
  put the words back the moment the player switched to Trade Routes. Its observer is attached
  to the strip itself, so it stops receiving events when the screen closes.
- **`ui/screen/trade-routes.js` has its own lifecycle**, driven by counting live
  `TradeRouteCard` mounts, because the trade tab's *container* is not registered and the card
  is the only mount signal available.
- **`ui/screen/empire-tab.js`, `factory-resources.js` and `treasure-tab.js`** manage their own
  styles and their own summary line in the tab row, via Solid's `onMount` / `onCleanup`.
- **`ui/screen/assign-notification.js` never stops.** It patches `PanelAction.prototype` once
  at load and stays.

## What is *not* registered

Overridable component names on this screen:

```
CommerceScreen            CommerceScreenBaseTabContent   CommerceResourcesContainer
TradeRouteCard            TreasureConvoyCard             TreasureConvoyProgressBar
FactoryTypeDisplay        CommerceCriteriaDisplay
```

The tab **containers** for Trade / Empire / Treasure are **not** registered. This is why:

- the Empire tab is reached by replacing `CommerceScreen` and passing our own container;
- the Trade tab is decorated from the outside via `MutationObserver`;
- the Treasure tab is reached the same way as Empire — our own wrapper component, handed
  data filtered by `withoutHomelandIdlers`.

## Two model shapes, one planner

The planner reads `CommerceCityResourceData` / `ResourceSlotData` shapes. With the screen
open they come from the Solid model; with it closed, `ui/model/headless-model.js` rebuilds
**the same field names** straight from the game.

⚠️ Every field the planner reads must be built *the way the model builds it*, not merely
present. `yieldTypes` was an empty array for a while and silently changed the outcome rather
than breaking anything. See [model](06-model.md).

## Adding a new feature — where does it go?

| The feature… | goes in |
|---|---|
| asks the game a question and caches the answer | `ui/engine/` |
| sends a player operation | `ui/engine/operations.js` — **and nowhere else** |
| reads settlement or resource data | `ui/model/` |
| decides what is worth placing where | `ui/planner/` |
| computes what something is worth to the player | `ui/planner/` (`*-effects.js`) |
| draws anything, or listens to the mouse | `ui/screen/` |
| is a setting the player changes in a menu | `ui/options/` + a value module in `ui/planner/` |
