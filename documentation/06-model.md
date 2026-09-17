# 06 — `ui/model/` — reading the screen's data

Two files. `screen-model.js` reads the live Solid model and maps screen points back to
resources; `headless-model.js` rebuilds the same shapes from the game with the screen closed.

The point of the pair: **`ui/planner/scoring.js` cannot tell them apart and needs no branch
for it.**

---

## `screen-model.js` (311 lines)

### Parking the model

`useCommerceScreenContext()` can only be called during component setup, so
`ui/screen/resources-tab.js` calls it once and parks the result here:

```js
setCommerceModel(model)     // from onMount
clearCommerceModel(model)   // from onCleanup — clears ONLY this instance
getCommerceModel()          // everything that runs later
```

⚠️ `clearCommerceModel` compares identity before clearing. The screen can be re-opened before
the old instance's cleanup runs, and clearing unconditionally would blank the new model.

### Reading settlements and the pool

```js
allSettlements(model)                  // flattened across sections
findSlottedResource(model, resourceValue)  // → { settlement, resource } | null
pooledResources(model)                 // every unassigned resource the MODEL holds
```

Shape of the data, for reference:

```
model.data.resourceTabData
    .slottedResourceSectionData[].cityResources[]   ← settlements
    .availableResourceSectionData[].subSections[].resourceSlotData[]   ← the pool
```

⚠️ `findSlottedResource` reads **fresh from the model** rather than remembering: the model is
rebuilt every time the engine confirms anything, so a reference held across a wait is stale
by definition.

⚠️ `pooledResources` is **not** the same list the DOM renders, and the difference used to be
hidden behind one name exported from two modules. `pooledResources` is what the model says;
`renderedPoolSections` (private) is what the DOM renders, in DOM order, with empty sections
dropped so the Nth container lines up with the Nth section. Only hit-testing wants the
second; everything else wants the first.

### Hit-testing — screen point to resource

The screen exposes **no id on its DOM nodes**, so the mapping goes:

```
point → settlement card → index of the slot within that card → same index in slottedResources
```

```js
findSlottedResourceAtPoint(x, y)
    // → { entries, resource, settlement, slotIndex, cardElement, slotElements } | null
findResourceAtPoint(x, y)
    // → the slotted hit, else the unassigned-pool hit — from ONE elementsFromPoint
findSettlementAtPoint(x, y)
    // → { settlement, cardElement } | null — anywhere on the card, not just a slot
settlementCards(root = document)
    // → [{ settlement, cardElement }] for every card under root
```

⚠️ `settlementCards` runs on every pass over the DOM, so the screen layer hands in the screen's
own element (`settlementCardsOnScreen()` in `ui/screen/screen-observer.js`, one list per pass);
the default searches the whole document, HUD included. `findResourceAtPoint` answers Shift-hover
and Shift-click with one hit test where asking the two halves separately made two per frame. A
card's name is matched against `settlementNameData.settlementName` through a per-visit memo of
composed names, cleared with the model.

Facts these depend on:

| | |
|---|---|
| `document.elementsFromPoint`, **not** `elementFromPoint` | the slot is covered by the resource icon, its tooltip wrapper and the drag-and-drop overlay; the game's own drag-and-drop resolves dropzones the same way |
| `.size-19` | one slotted resource — the game gives them an explicit size to work around a layout bug |
| `[data-name^="city-resource-container-"]` | the settlement card, named by settlement |
| `[data-name$="-city-resource-activatable"]` | the whole clickable card |
| `[data-name="commerce-unassigned-resources"]` | one per **rendered** pool section |

⚠️ **Cards are matched by name, never by position**, so sorting and filtering the settlement
list cannot desynchronise the mapping.

⚠️ The two name lookups deliberately use **different** sources:

- `findSlottedResourceAtPoint` matches `settlementNameData.settlementName`, which is what the
  `city-resource-container-` name carries;
- `findSettlementAtPoint` and `settlementCards` recompute
  `Locale.compose(Cities.get(cityID).name)`, because that is exactly how the
  `-city-resource-activatable` name is built. The model's `settlementNameData` is not used
  there, because nothing promises it is the same string.

`slotElements` is handed back so callers can address the hovered resource's siblings by index
without querying the card a second time — `ui/screen/hover-highlight.js` relies on this.

Empty slots are rendered separately and are **not** `.size-19`, so a hit that finds no model
resource at that index means the DOM and the model disagree; it is logged.

---

## `headless-model.js`

Everything the scoring reads normally comes from `CommerceScreenModel`, which only exists
while that screen is open. Auto-assignment has to work with the screen closed, so the same
shapes are rebuilt straight from the game.

⚠️ **Every field the planner reads must be built the way the model builds it, not merely
present.** `yieldTypes` was an empty array for a while, and it silently *changed the outcome*
rather than breaking anything.

Only the fields the planner actually reads are filled in. Anything to do with drag and drop,
focus or display is left out — if the planner ever starts reading one of those, it will come
back `undefined` rather than wrong, which is the failure mode to want.

### `buildSettlements()`

```js
{
    cityID,
    settlementNameData: { settlementName, isTown, warehouseCount },  // settlementName: diagnostics only
    factoryResourceData: { hasFactory },
    yieldTotals: Map<yieldType, number>,          // NOT in the screen's shape — see below
    slottedResources: [{ resourceValue, resourceType, cityID, yieldTypes }],
    availableSlots: Array(capacity - assigned)     // the planner only reads its length
}
```

#### `yieldTypes` — from `TypeTags`, not from yield changes

⚠️ This is **not** the same as the resource's yield changes. The model reads it from
`GameInfo.TypeTags`, so a resource tagged `PRODUCTION` affects production whether or not it
has a flat production yield. Leaving it empty made the planner fall back to
`Resource_YieldChanges` and judge every resource on its base yields alone — producing a
*different layout* here than the same algorithm produced with the screen open.

Six tags, no influence, matching the model: `FOOD`, `PRODUCTION`, `GOLD`, `SCIENCE`,
`CULTURE`, `HAPPINESS`.

#### `yieldTotals` — a `Map`, deliberately unlike the screen

⚠️ **Not** `CityYields.getCityYieldDetails`, which is what this used to call. That builds the
breakdown the yield tooltip shows — a nested tree of base values, modifier steps and localised
labels — and every one of those was thrown away here to keep one number per yield. Rebuilt for
all settlements before every single resource, it was **most of the planning time: 4.7 seconds
of a 13 second run.**

`city.Yields.getYields()` is the array that utility reads before it decorates it, indexed to
match `GameInfo.Yields`.

⚠️ **The planner reads yields from this `Map` only**, through `settlement.yieldTotals`. A
settlement from the screen's Solid model does not carry it and is not supported by the scoring;
the planner always plans on the headless board.

`settlementName` is composed only with `DIAGNOSTICS` on, and is otherwise `undefined`: every
reader is a log line, and composing it cost a `Locale.compose` per settlement per placement.

#### `hasFactory`

⚠️ **Copied from the game's own `populateFactoryResourceDataForCity`**, *not* worked out from
"does it have `BUILDING_FACTORY`" — which is what this used to do, and which disagreed with
the screen. The two paths have to answer identically or "factories first" means one thing
with the screen open and another with it shut.

```js
isFactoryAge() && cityResources.isTreasureConstructiblePrereqMet() &&
    (cityResources.getNumFactoryResources() === 0 ||
     GameInfo.Resources.lookup(cityResources.getFactoryResource()) != null)
```

The same definition, with the cached age asked first: outside the Modern Age it is the whole
answer.

#### Settlement fact cache

A run re-reads the board before every single resource, so what a placement cannot change is
cached for the length of the run:

```js
forgetSettlementFacts()        // all — at the start of a run
forgetSettlementFacts(cityID)  // what a placement there can change: its yields and factory state
```

| Cache | Lifetime |
|---|---|
| warehouse count, settlement name | the run — assigning a resource cannot build a warehouse |
| yields, factory state | the run, dropped for the settlement a placement lands in |
| "is this constructible type a warehouse" | the age — reset through `support/game-data.js` |

⚠️ `rebuildSettlement` drops that settlement's facts **itself, immediately before reading**. The
caller's wait yields to timers, and a `buildSettlements()` from outside the run in that window
would otherwise cache the yields from before the assignment landed.

### `buildSettlementRefs()`

The same settlements as `buildSettlements()`, carrying only `cityID` and
`settlementNameData.isTown` — what `planner/effects.js` `modifierApplies` and the Empire tab's
totals read. ⚠️ **Any other field is `undefined`**: a reader of one needs the full board. It
exists because the Empire tab used to read the whole board (assigned resources, capacity, yields,
a building walk) for two fields.

### `buildAvailableResources(settlements)`

⚠️ Worked out **by subtraction**: the player's full list minus everything the settlements
report as assigned. **There is no "unassigned" accessor to ask.** The same subtraction appears
in `ui/screen/assign-notification.js`.

⚠️ **Empire and treasure resources are then dropped** (`isAssignableResourceType` in
`engine/resource-types.js`, the same rule `planner/facts.js` uses), because the game's own pool
drops them —
`commerce-screen-model.ts` returns early on `RESOURCECLASS_EMPIRE` and `RESOURCECLASS_TREASURE`
before building a slot for them. An empire resource pays for being **held** and a treasure
resource turns into treasure fleets; neither is ever assigned anywhere.

Which resources those are **changes with the age** — Gold is `EMPIRE` in Antiquity and
`TREASURE` in Exploration, Ivory is `EMPIRE` then `BONUS`, Marble becomes `EMPIRE` only in
Modern — so it is a class check, not a list, and no age logic is needed: each age's
`resources.xml` rewrites the column with `<Update>` rows. See
[`knowledge-base/27-resources.md`](../../knowledge-base/27-resources.md).

⚠️ **This was the one real difference between the two paths, and it is the sort this file
exists to prevent.** With the screen OPEN the planner reads the game's model, which had already
filtered them; with the screen SHUT it read this list, which had not. Nothing was ever assigned
wrongly — the engine refuses each one and the loop sets it aside — but acquiring, say, Gold in
Antiquity handed auto-assign a "newly acquired resource" it could never place, and since an
arrival is only forgotten after a pass that placed something, that arrival was retried on every
trigger for the rest of the game.

### `buildHeadlessModel(prebuiltSettlements, prebuiltAvailable)`

A stand-in carrying only what the planner reads, in the same nesting the real model uses:

```js
{
    data: { resourceTabData: { slottedResourceSectionData, availableResourceSectionData } },
}
```

Nothing calls a method on a headless model — the planner sends the player operations itself —
so it carries none. Passing prebuilt arrays lets `place.js` read the board once per pass rather
than twice.
