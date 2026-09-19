# Snapshot: game build `25245002` (Steam `appmanifest_1295660.acf`, captured 2026-09-20)

32 original game `.js` files, copied 1:1 from
`C:\Program Files (x86)\Steam\steamapps\common\Sid Meier's Civilization VII\Base\modules\...`,
mirroring that same relative path under `core/` and `base-standard/` below. These are **every
file this mod's `ui/` code imports from the game** (`grep -rno "from ['\"]/\(core\|base-standard\)"
ui/`), including the three the mod overrides through `ComponentRegistry`.

See [`../README.md`](../README.md) for what "overwrite" means for a UI-only mod (there is no
`<ImportFiles>` — nothing on disk is replaced) and how to capture the next snapshot after a game
update. Below, **⚠️ OVERRIDDEN** marks a file whose game component this mod registers a
replacement for; everything else is a read-only dependency.

## `base-standard/ui-next/screens/commerce/` — the Commerce screen itself

This is the screen the mod exists to change (`screen-resource-allocation`, opened via
`ContextManager.push`). Check these files **first** after any game update — this directory is
where a patch is most likely to break the mod.

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `commerce-screen.js` | The screen's skeleton: `ScreenFrame` + `Tab` + the (3 or 4, age-dependent) `Tab.Item`s. Registered in `ComponentRegistry` as `CommerceScreen`. | **⚠️ OVERRIDDEN.** [`ui/screen/factory-tab.js`](../../ui/screen/factory-tab.js) registers its own `CommerceScreen` at `overridePriority: (CommerceScreen.overridePriority ?? 0) + 100` — this is the **only** way to add a 5th tab (`Tab.Item`s are inline JSX children of this component; nothing lets a mod inject one from outside). `factory-tab.js` is a **deliberate line-for-line transcription** of this file plus one added `Show` block, specifically so it can be diffed against this snapshot after a patch. |
| `commerce-screen-model.js` | ~3300 lines: all data and actions for every tab (`createCommerceScreenModel`, `useCommerceScreenContext`, `slotSelectedResource`/`unslotSelectedResource`, sorting, filtering, the `ResourceCapChanged`/`ResourceAssigned`/`ResourceUnassigned` engine listeners). | Read-only. [`empire-tab.js`](../../ui/screen/empire-tab.js), [`factory-tab.js`](../../ui/screen/factory-tab.js) and [`resources-tab.js`](../../ui/screen/resources-tab.js) call `useCommerceScreenContext()` to reach the live model from inside a wrapped/rebuilt component instead of recreating it. |
| `commerce-screen-base-tab-content.js` | `CommerceScreenBaseTabContent` — the shared frame (title, description, header bar) every tab is wrapped in. | Read-only. [`empire-tab.js`](../../ui/screen/empire-tab.js) and [`factory-resources.js`](../../ui/screen/factory-resources.js) wrap new tab bodies in it so they share the exact chrome of the game's own tabs. |
| `commerce-screen-resources-tab.js` | `CommerceResourcesContainer` — the whole "Resources" tab (drag & drop assignment, ~1600 lines in the source). | **⚠️ OVERRIDDEN.** [`resources-tab.js`](../../ui/screen/resources-tab.js) registers `CommerceResourcesContainerWithRightClickUnassign` under the same name (`overridePriority` +100), adding right-click-to-unassign, hover highlighting, bulk-assign, settlement controls and resource locks, then calls `originalFactory(props)` — a wrap, not a rewrite. |
| `commerce-screen-trade-tab.js` | `TradeRoutesContainer` — the Trade tab's body. ❗ Not registered in `ComponentRegistry` by the game itself. | Read-only, imported directly (it cannot be wrapped by name). [`factory-tab.js`](../../ui/screen/factory-tab.js) re-places it as a child when it rebuilds `CommerceScreen`. |
| `commerce-screen.scss.js` | The screen's own compiled stylesheet. | Read-only. `factory-tab.js` re-supplies it (`styles: [screenStyle]`) when registering the replacement `CommerceScreen` — a component registered without its own `styles` silently loses the game's styling. |
| `trade-route-card.js` | `TradeRouteCard` — one trade route's card (`CardFrame`, header, delivery line, incoming resources, leader portrait + relationship change). | **⚠️ OVERRIDDEN.** [`trade-routes.js`](../../ui/screen/trade-routes.js) registers `TradeRouteCardWithDestination` under the same name, adding destination info/highlighting, then returns `originalFactory(props)`. |
| `commerce-screen-treasure-tab.js` | `TreasureResourceContainer` — the Treasure tab's body (`AGE_EXPLORATION` only). ❗ Not registered in `ComponentRegistry` by the game itself. | Read-only, imported directly. [`treasure-tab.js`](../../ui/screen/treasure-tab.js) wraps/filters it and adds two controls, then re-places it, the same pattern as the Trade tab. |

## `base-standard/ui-next/components/` — shared game UI components

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `screen-frame.js` | `ScreenFrame` — the chrome (title bar, background) around every `ui-next` screen. | Read-only. `factory-tab.js` needs it because it rebuilds `CommerceScreen`, which is itself wrapped in a `ScreenFrame`. |
| `framed-resource.js` | `FramedResource` — one resource icon inside the game's own frame styling. | Read-only. [`resource-tooltip.js`](../../ui/screen/resource-tooltip.js) uses it to render the resource icon consistent with the game's own tooltip. |

## `base-standard/ui/` — old-framework game modules

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `action/panel-action.js` | `PanelAction` — old-framework base class notification panels extend; its prototype has `getNotificationInfo`. | **Runtime prototype patch, not a `ComponentRegistry` override.** [`assign-notification.js`](../../ui/screen/assign-notification.js) wraps `PanelAction.prototype.getNotificationInfo` (and related methods) to suppress the "Resource Assignments Available" notification when nothing could actually be placed. This is the one place the mod touches old-framework code directly, because that notification has no `ui-next` equivalent to override by name. |
| `diplomacy/diplomacy-events.js` | `RaiseDiplomacyEvent` — the event class the game's diplomacy UI listens for. | Read-only. [`trade-buy-merchant.js`](../../ui/screen/trade-buy-merchant.js) dispatches it (`window.dispatchEvent(new RaiseDiplomacyEvent(leaderId))`) after closing the Commerce screen, so opening a diplomacy action from a trade route card behaves exactly like the game's own flow. |
| `utilities/utilities-tags.js` | `ConstructibleHasTagType(constructibleType, tag)` — checks whether a building carries a given tag (e.g. `WAREHOUSE`). | Read-only. [`ui/model/headless-model.js`](../../ui/model/headless-model.js) and [`ui/planner/gdp.js`](../../ui/planner/gdp.js) use it to detect warehouse buildings (for warehouse-scaling resources) and gold-building tags for GDP scoring. |

## `core/ui-next/components/` — the `ui-next` (Solid) component library

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `tab.js` | `Tab` — the tab-strip component `CommerceScreen` is built from. | Read-only. `factory-tab.js` imports it because it recreates the whole `CommerceScreen` including its `Tab` strip. |
| `card-frame.js` | `CardFrame` — the game's card/tooltip frame styling. | Read-only. Used by [`framed-tooltip.js`](../../ui/screen/framed-tooltip.js) and [`resource-tooltip.js`](../../ui/screen/resource-tooltip.js) to build tooltips that match the game's own look. |
| `l10n.js` | `L10n` — the localized-text component. | Read-only. Used by `framed-tooltip.js`, `resource-tooltip.js` and [`treasure-tab.js`](../../ui/screen/treasure-tab.js). |
| `tooltip.js` | `Tooltip` — the generic tooltip primitive. | Read-only. Used by `framed-tooltip.js` and `resource-tooltip.js`. |
| `divider.js` | `Divider` — a visual separator line. | Read-only. Used by `resource-tooltip.js`. |
| `icon.js` | `Icon` — renders a game icon by id. | Read-only. Used by `resource-tooltip.js`. |
| `portrait-icon.js` | `PortraitIcon` — renders a leader/civilization portrait. | Read-only. Used by `resource-tooltip.js`. |

## `core/ui-next/services/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `component-registry.js` | `ComponentRegistry` — the override mechanism itself: `.register({ name, overridePriority, createInstance })`. | **This is the file that makes every override in this mod possible.** Imported by `factory-tab.js`, `resources-tab.js` and `trade-routes.js` to register their replacement components. |
| `audio-support.js` | `useAudio` — hover/click sound hooks. | Read-only. Used by `factory-tab.js` and `resources-tab.js` so the mod's own controls sound consistent with the rest of the screen. |
| `view-experience.js` | `isMobile` / `UIViewExperience` — device and viewport detection. | Read-only. Used by `factory-tab.js` to mirror the game's own mobile-layout handling when it recreates `CommerceScreen`. |

## `core/ui-next/utilities/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `game-core-utilities.js` | `useLocalPlayerId` — a Solid hook returning the local player's id. | Read-only. Used by `factory-tab.js`. |

## `core/ui/context-manager/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `context-manager.js` | `ContextManager` — the game's screen/panel stack (`push`/`pop`). | Read-only. [`dock-trade-button.js`](../../ui/screen/dock-trade-button.js) pushes the Commerce panel (`ContextManager.push(COMMERCE_PANEL_CONTEXT, { singleton: true, createMouseGuard: true })`); [`close-screen.js`](../../ui/screen/close-screen.js) pops it — the exact same call the screen's own close button makes. ⚠️ Both files note this import is easy to mistake for a global (like `PlotCoord` below) and forget entirely, which throws `ReferenceError: ContextManager is not defined` inside a click handler. |

## `core/ui/options/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `model-options.js` | `Options`, `CategoryType`, `OptionType` — the options screen's data model. | Read-only. [`najane-commerce-options.js`](../../ui/options/najane-commerce-options.js) and [`najane-mod-options-registry.js`](../../ui/options/najane-mod-options-registry.js) use it to register this mod's settings under a shared "Mods" tab. This module also loads in **SHELL scope** (main menu, no game) — see the ⚠️ in `CLAUDE.md` about `ui/options/`. |
| `options-helpers.js` | `CategoryData` — per-category metadata (title/description) for the options screen. | Read-only. Used to create the shared "Mods" category the first time any of the three "Najane" mods runs. |
| `screen-options.js` | Side-effect module that initializes the options screen's registry. | Imported for its side effect only (`import '/core/ui/options/screen-options.js';`), and **must load before `model-options.js` is touched** — see the comment at the top of `najane-commerce-options.js`. |

## `core/ui/input/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `input-support.js` | `InputEngineEventName` — input event name constants. | Read-only. Used by [`resources-tab.js`](../../ui/screen/resources-tab.js). |

## `core/ui/utilities/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `utilities-plotcoord.js` | `PlotCoord` — validates a plot coordinate (`PlotCoord.isValid(location)`). | Read-only. Used by [`ui/engine/treasure-convoys.js`](../../ui/engine/treasure-convoys.js) to validate treasure fleet map locations. ⚠️ Noted in that file as a trap: it *looks* like it belongs to the game's global namespace (like most engine names) but is a plain ES module export and must be imported. |

## `core/vendor/solid-js/`

| File | What it is in the game | How this mod uses it |
|---|---|---|
| `dist/solid.js` | Solid.js's reactivity core, bundled by the game (`createComponent`, `createMemo`, `createRoot`, `onMount`, `onCleanup`, `untrack`, `mergeProps`, `Show`, etc.). | Read-only. The foundation nearly every `ui/screen/*.js` file is built on — this mod has no build step, so it imports the game's own bundled copy rather than shipping one. |
| `web/dist/web.js` | Solid's DOM renderer runtime (`template`, `insert`). | Read-only. Used by [`empire-tab.js`](../../ui/screen/empire-tab.js), [`factory-resources.js`](../../ui/screen/factory-resources.js), `framed-tooltip.js` and `resource-tooltip.js` to build DOM nodes the same way the game's own compiled Solid components do. |

## Further reading

- [`documentation/03-platform-notes.md`](../../documentation/03-platform-notes.md) — the general
  `ComponentRegistry.register` recipe used across this mod.
- [`documentation/10-screen-tabs.md`](../../documentation/10-screen-tabs.md) — per-tab detail on
  `ui/screen/*.js`, including the explicit instruction to diff `factory-tab.js` against
  `commerce-screen.js` after a patch.
- `Documents\Civ7Modding\knowledge-base\26-commerce-screen.md` — the original reconnaissance of
  the whole Commerce screen (structure, override points, DOM hooks, data model) this mod and this
  snapshot's descriptions are based on.
