# 01 — What the mod does, and where each behaviour lives

A behaviour-by-behaviour map from what the player sees to the module that implements it.
Use this to find the code for a bug report or a feature request without reading the whole
tree.

## The screen being modified

The Commerce screen. Its DOM element is `screen-resource-allocation`, but the live
implementation is **not** the old `ui/resource-allocation/` files — those still ship, still
load, and lose on priority. The real one lives in
`base-standard/ui-next/screens/commerce/` and is written in **Solid.js**.

Tabs, by age:

| Tab | Antiquity | Exploration | Modern | Owner |
|---|---|---|---|---|
| Resources | ✔ | ✔ | ✔ | the game's, wrapped |
| Trade Routes | ✔ | ✔ | ✔ | the game's, decorated from the outside |
| Empire | ✔ | ✔ | ✔ | **rebuilt by this mod** |
| Treasure | — | ✔ | — | the game's, wrapped + data filtered |
| Factory | — | — | **✔ added by this mod** | this mod's |

## Mouse and keyboard

| Behaviour | Module |
|---|---|
| Right-click an assigned resource → back to the pool | `ui/screen/resources-tab.js` |
| Shift + right-click → every resource of that kind in that settlement | `ui/screen/resources-tab.js` → `ui/engine/unassign.js` |
| Shift + hover → every resource of that kind lights up | `ui/screen/hover-highlight.js` |
| Shift + assign (drag *or* click) → keep filling with that kind | `ui/screen/bulk-assign.js` |
| Left-click working at all while Shift is held | `ui/screen/shift-click.js` |
| Right-click elsewhere still closes the screen | `ui/screen/resources-tab.js` (`onEngineInput`) |
| The **?** explaining all of the above | `ui/screen/help-mark.js`, mounted by `ui/screen/assign-all-buttons.js` |

⚠️ The engine does **not** emit `mousebutton-right` (or `mousebutton-left`) while a modifier
key is held. Everything above therefore rides on native DOM mouse events, not on engine
input actions. See [Platform notes](03-platform-notes.md).

## Camels (resources that carry their own slots)

A camel grants its settlement two extra resource slots (`BonusResourceSlots` in
`GameInfo.Resources`), so removing or moving one shrinks capacity and the engine refuses the
operation outright.

| Behaviour | Module |
|---|---|
| Freeing exactly enough room to unassign one | `ui/engine/unassign.js`, `ui/engine/resource-slots.js` |
| Freeing room so a *drag* out of a full settlement succeeds | `ui/engine/unassign.js` (`freeRoomForMove`), called from `ui/screen/bulk-assign.js` |
| A camel counting as always placeable in the notification test | `ui/screen/assign-notification.js` |

Nothing names camels; the property is read from the schema column, so DLC or another mod's
slot-granting resource is covered automatically.

## Empire-wide assignment

Three buttons above the tabs, plus three controls on every settlement card.

| Control | Module |
|---|---|
| **Assign All** | `ui/screen/assign-all-buttons.js` → `ui/planner/run.js` `assignAll` |
| **Reassign All** | same → `reassignAll` |
| **Unassign All** | same → `unassignAll` → `ui/engine/unassign.js` |
| Per-settlement priority picker | `ui/screen/settlement-controls.js` → `ui/planner/priorities.js` |
| Per-settlement quick assign | same → `ui/planner/run.js` `quickAssignSettlement` |
| Per-settlement unassign | same → `model.clearAllResources(cityID)` |
| The game's own buried "unassign all" being hidden | `ui/screen/assign-all-buttons.js` |
| The "factories first" checkbox (Modern only) | `ui/screen/assign-switches.js` + `ui/planner/factory-first-setting.js` |

Every one of these — and the automatic path below — goes through `ui/planner/run.js`, which holds
the single "only one at a time" guard. The ordering they obey is in `ui/planner/scoring.js`; the
loop that executes it is `ui/planner/place.js`; emptying a settlement is `ui/engine/unassign.js`.
See [planner: assignment](07-planner-assignment.md).

The priority picker's default is **Balanced**, and Balanced means production in a city and food in
a town — not "whatever the settlement has least of".

## Options under **Options → Mods**

| Setting | Default | What it does |
|---|---|---|
| Prioritise Happiness | All settlements | how far the rescue tier goes: never / cities only / all |
| Assign Resources automatically | Never | see the table below |
| Skip the assignment prompt | on | hides the end-turn nag while nothing you hold can be placed — and only while automatic assignment is doing something. See [notifications](13-notifications.md) |
| Allow Resource locks | on | the padlock on a slotted resource. Off removes the padlocks rather than leaving them inert |
| Build a Culture Settlement automatically | on | gathers everything paying culture into one city |
| Build a Gold Settlement automatically | on | the same for gold, deliberately in a different city |

Plus the **factories first** checkbox, which lives on the screen rather than in the options
because it is Modern-age only.

### Automatic assignment with the screen closed

| Setting | `AutoAssignMode` | Behaviour |
|---|---|---|
| Never | `Off` | nothing — **and the end-turn nag is left alone too**, see [notifications](13-notifications.md) |
| Place the new resource | `NewOnly` | only values that were not owned last pass |
| Place everything unassigned | `EverythingUnassigned` | the arrival is a cue to tidy the pool |
| Rebuild every assignment | `RebuildEverything` | clears every settlement and starts again |

A resource can arrive by improving a tile, by trade route or by **taking an enemy settlement**;
room for one can arrive by finishing a building or a **wonder** that carries slots. All of those
are triggers.

`ui/planner/auto-assign.js` decides *when*; the work goes through `run.js` like everything else.
The options are `ui/options/najane-commerce-options.js`, `ui/planner/happiness-setting.js` and
`ui/planner/hoard-setting.js`. See [options](11-options-and-persistence.md).

## The tabs

| What changed | Module |
|---|---|
| Trade route title line `(city) (sea) MEKKA → BOGDAN`, three cards to a row | `ui/screen/trade-routes.js` |
| Trade routes running / possible, with a leader breakdown tooltip | `ui/screen/trade-summary.js` |
| Unstartable routes split into "only the limit" vs "out of range" | `ui/screen/trade-routes.js` |
| Treasure: homeland settlements dropped from "not generating" | `ui/screen/treasure-tab.js` (`withoutHomelandIdlers`) |
| Treasure: `+300 (gold) +60 (gdp)` instead of a sentence; three to a row | `ui/screen/treasure-tab.js` |
| Empire tab rebuilt with per-copy and empire totals | `ui/screen/empire-tab.js` + `ui/planner/empire-effects.js` |
| Factory tab (Modern age), "in factories" and "not assigned" | `ui/screen/factory-resources.js` + `ui/planner/factory-effects.js` |
| The fifth `Tab.Item` existing at all | `ui/screen/factory-tab.js` (replaces `CommerceScreen`) |

## Screen chrome

| What changed | Module |
|---|---|
| Icons instead of words on the tab strip | `ui/screen/tab-icons.js` |
| The standing instruction line above the panel removed | `ui/screen/layout.js` |
| Tab strip widened and shortened; filter/sort boxes a third shorter | `ui/screen/layout.js` |
| "Resource Assignments Available" no longer takes over the turn button | `ui/screen/assign-notification.js` |

## Localisation

Every language the game ships in, plus Ukrainian carried in the `ru_RU` locale (the game has
no Ukrainian locale). See [localisation](12-localisation.md).

## What the mod deliberately does *not* do

- No game rules, values or balance are changed; `AffectsSavedGames = 0`.
- Nothing is written into the save file. Priorities go through `UI.setOption`, keyed by
  `gameSeed`. See [options](11-options-and-persistence.md).
- **Nothing is locked by default.** Resource+'s per-resource locks *are* here — the padlock on
  a slotted resource, `ui/screen/resource-locks-ui.js` over `ui/engine/resource-locks.js` — but
  the lock set starts empty and the feature can be switched off entirely under
  **Options → Mods**, in which case the padlocks are removed rather than left inert.
- No notification is dismissed, cancelled or acknowledged. `ui/screen/assign-notification.js`
  only declines to *draw* one. See [notifications](13-notifications.md).
