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
findAvailableResourceAtPoint(x, y)
    // → { entries, resource, slotIndex, cardElement, slotElements } | null
findSettlementAtPoint(x, y)
    // → { settlement, cardElement } | null — anywhere on the card, not just a slot
settlementCards()
    // → [{ settlement, cardElement }] for every card currently on screen
```

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

## `headless-model.js` (275 lines)

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
    cityID, isDistantLands,
    settlementNameData: { settlementName, isTown, warehouseCount, hasRail },
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

The scoring handles both shapes: a `Map` here, and the screen's list of icon URLs plus numbers
there (mapped back through `yieldTypeFromIcon`). See `settlementYieldTotals` in
`ui/planner/scoring.js`.

#### `hasFactory`

⚠️ **Copied from the game's own `populateFactoryResourceDataForCity`**, *not* worked out from
"does it have `BUILDING_FACTORY`" — which is what this used to do, and which disagreed with
the screen. The two paths have to answer identically or "factories first" means one thing
with the screen open and another with it shut.

```js
cityResources.isTreasureConstructiblePrereqMet() && isFactoryAge() &&
    (cityResources.getNumFactoryResources() === 0 ||
     GameInfo.Resources.lookup(cityResources.getFactoryResource()) != null)
```

#### Building cache

`countBuildings` walks every constructible in every settlement, and a run re-reads all of them
before every single resource. Buildings do not go up while resources are being assigned, so it
is cached for the length of a run:

```js
forgetSettlementBuildings()        // all
forgetSettlementBuildings(cityID)  // just the one that changed
```

`ui/planner/place.js` calls the second form after each placement — only that settlement's
factory state can have changed.

### `buildAvailableResources(settlements)`

⚠️ Worked out **by subtraction**: the player's full list minus everything the settlements
report as assigned. **There is no "unassigned" accessor to ask.** The same subtraction appears
in `ui/screen/assign-notification.js`.

### `buildHeadlessModel(prebuiltSettlements, prebuiltAvailable)`

A stand-in carrying only what the planner reads, in the same nesting the real model uses:

```js
{
    isSlottingAvailable: true,     // the planner waits on it; nothing to wait for here
    data: { resourceTabData: { slottedResourceSectionData, availableResourceSectionData, unslottedBonuses } },
    selectedResource: () => ({ resourceValue: -1, cityID: undefined }),
    clickAvailableResource: () => {},
    slotSelectedResource: () => {},
    deselectSelectedResource: () => {},
    setLastSlottedResourceValues: () => {},
}
```

The no-op methods only need to *not throw*: `ui/planner/auto-assign.js` sends the player
operations itself. Passing prebuilt arrays lets `place.js` read the board once per pass rather
than twice.
