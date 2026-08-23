# 11 — Options and persistence

Eight separate things are remembered between sessions, all through the same channel, none of
them in the save file.

| What | Module | Key |
|---|---|---|
| Automatic assignment mode | `ui/options/najane-commerce-options.js` | `better-commerce-screen-ui.autoAssignMode` |
| Skip the assignment prompt | `ui/options/najane-commerce-options.js` | `better-commerce-screen-ui.skipAssignPrompt` |
| Happiness priority | `ui/planner/happiness-setting.js` | `better-commerce-screen-ui.happinessPriorityMode` |
| Build a culture settlement | `ui/planner/hoard-setting.js` | `better-commerce-screen-ui.gatherCulture` |
| Build a gold settlement | `ui/planner/hoard-setting.js` | `better-commerce-screen-ui.gatherGold` |
| "Imports first" | `ui/planner/imports-first-setting.js` | `better-commerce-screen-ui.importsFirstChoice` |
| "Factories first" | `ui/planner/factory-first-setting.js` | `better-commerce-screen-ui.factoryFirstChoice` |
| Per-settlement priority | `ui/planner/priority-store.js` | `better-commerce-screen-ui.priority.<gameSeed>.<cityKey>` |
| Resource locks allowed | `ui/engine/resource-locks.js` | `better-commerce-screen-ui.allowResourceLocks` |
| Hide this mod's tooltips | `ui/engine/tooltip-setting.js` | `better-commerce-screen-ui.hideTooltips` |

### ⚠️ "Don't show tooltips on the Commerce screen"

Off by default, and it covers **only what this mod draws** — the game's own tooltips are not
this mod's to take away. Three mechanisms, one switch, three choke points:

| What | Where it is declined |
|---|---|
| Framed tooltips on the mod's buttons, switches, settlement controls | `appendWithFramedTooltip` returns after appending the trigger alone |
| Plain `data-tooltip-content` on bars, totals, padlocks, trade-route titles | `setTooltip` in `support/dom.js` — the one door for that attribute |
| The extended resource tooltip on Empire / Factory / Treasure cards | `appendWithResourceTooltip` returns after appending the tile alone |

The round "?" marks go with them: `makeHelpMark` answers **null**, and every caller appends
through `appendAll`, which skips what is not there. A mark exists only to carry a tooltip, so
one drawn with the explanations off would be a button that does nothing.

⚠️ **`setTooltip` also marks what it sets** (`data-najane-tooltip`). That mark is what makes
`removeModTooltips` safe: some of these hang on the GAME's own elements — the trade-route card
title is the clear case — so "strip every `data-tooltip-content` on this screen" would take the
game's own with them.

⚠️ **Throwing the switch is not fully retroactive, and cannot be.** The plain tooltips are an
attribute and are stripped where they stand, from the entry point's listener on
`TooltipSettingChangedEventName`. A framed tooltip mounts its trigger *inside* the Solid root
it creates, so disposing one to undo it would remove the button with it — those wait for the
screen to be reopened. The option's description says so.

## The storage channel

```js
UI.setOption('user', 'Mod', name, value);
Configuration.getUser().saveCheckpoint();     // ⚠️ required, or it does not survive
```

⚠️ **Every use of `UI.setOption` in the game itself passes a NUMBER.** Priorities are therefore
stored as a small integer rather than as JSON.

⚠️ **`localStorage` alone does not come back after a reload.** It is kept everywhere as a *second*
write — harmless if it works, ignored if it does not.

⚠️ **Not the save file.** This mod declares `AffectsSavedGames = 0`; writing into a save would make
that a lie and tie the save to having the mod installed.

### ⚠️ The zero trap

An option that was **never set** reads back as `0`, exactly like an option deliberately set to
zero. Two modules work around this in the same way — by **offsetting the stored value by one**, so
that `0`, `null` and `undefined` all mean "never chosen":

- `priority-store.js`: stores `index + 1` into `CODES`, so index 0 (Balanced) is stored as 1;
- `factory-first-setting.js`: `STORED_OFF = 1`, `STORED_ON = 2`, and 0 means untouched;
- `happiness-setting.js`: `STORED_OFFSET = 1`, so `Never` (0) stores as 1 and 0 means untouched;
- `hoard-setting.js`: `STORED_OFF = 1`, `STORED_ON = 2`, both defaulting to on;
- `najane-commerce-options.js`: `SKIP_PROMPT_OFF = 1`, `SKIP_PROMPT_ON = 2`, defaulting to on —
  ⚠️ `autoAssignMode` in the same file gets away with a **raw** value only because its default
  happens to be `0` as well;
- `imports-first-setting.js`: the same 1/2, even though its default is **off** and it would
  therefore survive a plain 0/1 — storing 0 for "off" is exactly the shape that broke when
  factories-first later changed its default, and the cost of writing it safely now is one
  constant.

This only started to matter for factories-first when its default became **on** — with a default of
"off", "never touched" and "switched off" were the same thing. ⚠️ It also uses a **different option
name** from the old 0/1 one, so an old value cannot be read as a new one.

⚠️ The happiness dropdown is the sharpest case of the trap: its "never touched" default is
`AllSettlements` and its **first** item is `Never`, so without the offset every player who had
not opened the options screen would have had the rescue tier switched off.

---

## `ui/options/najane-commerce-options.js`

The only module in `ui/options/`. It imports **nothing of this mod's except leaf settings modules**
under `ui/planner/`, each of which imports nothing but diagnostics. The dependency runs one way —
options write to the planner, the planner never reads the options screen — which is what lets the
assignment engine answer these questions with the Commerce screen closed. It is listed in **both**
action groups (`game` and `shell`) because the options screen exists in the main menu as well as in
game — registered in only one scope, the dropdown disappears from the other.

```js
import '/core/ui/options/screen-options.js';   // ⚠️ must load before the model is touched
import { CategoryType, Options, OptionType } from '/core/ui/options/model-options.js';
import { CategoryData } from '/core/ui/options/options-helpers.js';
```

### The shared "Mods" tab

```js
CategoryType['Mods'] = 'mods';
CategoryData[CategoryType.Mods] ??= { title: ..., description: ... };
```

The "Mods" category is **not part of the base game**. It is created with `??=` and the shared id
`'mods'` — deliberately the same shape as the specialists mod's options — so several community mods
end up in **one tab** instead of each spawning its own.

### The group id

```js
const OPTION_GROUP = 'najane_commerce';
```

The options screen derives the heading from the group id as `LOC_OPTIONS_GROUP_<ID IN CAPITALS>`,
so this needs `LOC_OPTIONS_GROUP_NAJANE_COMMERCE` in the text files. The heading text is **not** set
in code.

⚠️ **Do not reuse another mod's group id.** The specialists mod owns `najane_mods` and titles it
with its own name, so anything filed there appears to belong to it.

### `AutoAssignMode`

```js
export const AutoAssignMode = { Off: 0, NewOnly: 1, EverythingUnassigned: 2, RebuildEverything: 3 };
```

⚠️ **Append only** — the index is what gets stored.

One dropdown rather than three checkboxes: these are four points on a scale and only one can hold at
a time. As separate boxes they invited combinations that had to be explained away in their own
descriptions.

`Off` is the default, deliberately: automatic assignment **acts on the player's behalf without being
asked and shows nothing while doing it.**

`migrateFromCheckboxes()` carries over the three checkboxes the dropdown replaced, so an existing
setting is not silently switched off. It is marked safe to delete once the mod has shipped with the
dropdown.

### The change event

```js
export const CommerceOptionsChangedEventName = 'najane-commerce-options-changed';
window.dispatchEvent(new CustomEvent(CommerceOptionsChangedEventName));
```

Dispatched on every write. (`factory-first-setting.js` mirrors the pattern with
`FactoryFirstChangedEventName`.)

### ⚠️ Order in the group is registration order

The options screen lays a group out in the order `Options.addOption` is called, so the happiness
dropdown is registered **before** automatic assignment to sit above it. There is no sort key.

---

## `ui/planner/happiness-setting.js`

```js
HappinessPriorityMode          // { Never: 0, CitiesOnly: 1, AllSettlements: 2 }
happinessPriorityMode()
isHappinessRescueEnabled()     // → mode !== Never
townsMayBeRescued()            // → mode === AllSettlements
setHappinessPriorityMode(value)
HappinessPriorityChangedEventName
```

The rescue tier sits above every other consideration in `scoring.js` — above factories, above
camels, above a settlement's own priority — so it is the single largest thing this mod does to a
layout, and it used to be unconditional. Default **all settlements**: an empire in revolt is the
one situation where overriding what the player asked each settlement for is worth it, so the
setting is there to opt out, not to opt in.

Two convenience predicates rather than one enum getter, so `scoring.js` never has to know the
mode's shape — see how `isFactoryFirstEnabled()` folds the age check in for the same reason.

---

## `ui/planner/hoard-setting.js`

```js
isCultureGatheringEnabled()   /  setCultureGatheringEnabled(value)
isGoldGatheringEnabled()      /  setGoldGatheringEnabled(value)
HoardSettingChangedEventName
```

Two switches, not one, because the two piles are independent: gathering culture is worth doing
whether or not gold is being gathered, and the gold pile deliberately avoids the culture pile's
settlement, which only matters when both are on. Both default **on**.

---

## `ui/planner/imports-first-setting.js`

```js
isImportsFirstEnabled()  /  setImportsFirstEnabled(value)
ImportsFirstChangedEventName
```

⚠️ **Not age-gated**, unlike factories-first: imported resources exist in every age, and so does
the tracker that pays for them.

Default **off**, which is the opposite of factories-first and deliberate. This is a bet on one
victory condition — towards the Economic Victory a resource slotted in a city is worth +1 GDP a
turn (`VICTORY_TRACKER_SLOTTED_BONUS` / `VICTORY_TRACKER_SLOTTED_CITY`) and an imported one is
worth +1 more on top (`VICTORY_TRACKER_IMPORTED_RESOURCES`), so double. Chasing any other victory,
the same rule just hands your cities whatever the trade network happens to supply. The tooltip
says so, in as many words.

---

## Adding another option

```js
Options.addInitCallback(() => {
    Options.addOption({
        category: CategoryType.Mods,
        group: OPTION_GROUP,
        type: OptionType.Dropdown,          // or Checkbox, Slider…
        id: 'najane-commerce-<something>',
        initListener:   (info) => (info.selectedItemIndex = CommerceOptions.<prop>),
        updateListener: (_info, value) => (CommerceOptions.<prop> = value),
        label: 'LOC_OPTIONS_NAJANE_COMMERCE_<SOMETHING>',
        description: 'LOC_OPTIONS_NAJANE_COMMERCE_<SOMETHING>_DESCRIPTION',
        dropdownItems: [...],
    });
});
```

Then add the localisation keys to **every** `text/<locale>/InGameText.xml` — see
[localisation](12-localisation.md). If the planner needs to read the value, keep the *value* in a
module under `ui/planner/` and let the option write to it, so nothing in `planner/` imports UI.

---

## `ui/planner/factory-first-setting.js`

```js
isFactoryFirstEnabled()       // → boolean AND isFactoryAge()
setFactoryFirstEnabled(value)
FactoryFirstChangedEventName
```

⚠️ The setting lives here and the checkbox lives in `ui/screen/assign-switches.js`. They started as
one module, which meant the **planner imported a UI widget to ask a yes/no question** — so nothing
in the assignment engine could be reasoned about without the screen, and the automatic path (which
runs with the screen closed) pulled in the whole button bar behind it.

It persists rather than living in memory because a switch on the screen that forgot itself every
time the screen closed would be worse than no switch.

Default **on**: factory resources are the most valuable thing in the age and they can only go where
a factory is, so placing them first is what a player wants by default — the switch is there to turn
that off, not to opt into it.

`isFactoryFirstEnabled()` returns `false` outside the Modern age regardless of the stored value, so
callers never need to check the age themselves.

---

## `ui/planner/priority-store.js`

The persistent half of [`priorities.js`](07-planner-assignment.md#prioritiesjs--what-each-settlement-should-be-fed-first).

```js
storedPriority(cityKey)   // → yieldType | null (explicit Balanced) | undefined (never set)
storePriority(cityKey, yieldType)
forgetLoadedGame()        // called from forgetPriorityMemory()
```

### `CODES` is append-only

```js
const CODES = [null, 'YIELD_FOOD', 'YIELD_PRODUCTION', 'YIELD_HAPPINESS',
               'YIELD_CULTURE', 'YIELD_SCIENCE', 'YIELD_GOLD', 'YIELD_DIPLOMACY'];
```

⚠️ **Reordering would silently reinterpret everything already stored.** The stored value is
`index + 1` — see the zero trap above.

An unknown `yieldType` is refused with a warning rather than stored.

### ⚠️ Keyed per game

A settlement is identified by the numeric part of its `ComponentID`, which is **only unique within
one game** — the same number is a different city in the next campaign. Every entry is therefore
filed under `Configuration.getGame().gameSeed`, fixed for the life of a game and different between
games.

If the seed cannot be read, reads return `undefined` and writes are skipped — better to forget than
to apply one game's choices to another's cities.

`forgetLoadedGame()` clears the cached seed so the next read uses the new game's key. It is called
from `forgetPriorityMemory()`, which `startAutoAssign()` calls at load.

### ⚠️ Why not `localStorage` alone

That was the first attempt and **it did not come back after a reload.** It survives here only as a
mirror write.
