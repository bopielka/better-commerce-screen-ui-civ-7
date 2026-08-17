# 08 — `ui/planner/` — valuation: what a resource is *worth*

Two modules that answer a different question from the assignment engine. They do not decide
where anything goes; they turn a rule into a number the player can act on, and they feed the
Empire and Factory tabs.

| File | Lines | Feeds |
|---|---|---|
| `empire-effects.js` | 404 | `ui/screen/empire-tab.js` |
| `factory-effects.js` | 340 | `ui/screen/factory-resources.js` |

Both read the modifier tables through [`effects.js`](07-planner-assignment.md#effectsjs--reading-the-modifier-tables).

⚠️ The cards both tabs draw use **the game's own resource tooltip**, not a plain-text one — see
`ui/screen/resource-tooltip.js`. It is a Solid **component** (`ui-next/tooltips/resource-tooltip.jsx`)
that wraps its trigger in `<Tooltip.Trigger>`, so it cannot be asked for from a `data-tooltip-*`
attribute: the trigger has to be handed to the component and the component's output put in its
place. Both tabs build their cards imperatively inside `onMount`, which is where the Solid owner it
needs comes from.

⚠️ It is a **transcription** of the game's component, not a wrapper around it. The game's has
exactly one free text slot — `resourceOrigin`, rendered after "Origin:" — which is enough for the
single city name it puts there and nowhere near enough for what these tabs know. So the shell is
rebuilt from the same parts and the breakdown goes underneath as **a card per leader**: their
portrait, their total, and their settlements. Nothing is lost and it still looks like the game's.

⚠️ Its props are transcribed from `getResourcePropsFromDefinition`, which the game does not export —
`resourceType` there is a **localisation key**, not the resource's type, and both icons are
`url(blp:…)` strings.

⚠️ It **falls back to the plain-text tooltip** if the component will not mount, and warns. This
reaches into a component the game did not write for outside use; without the fallback a game patch
that moves it would leave the cards with no tooltip at all, which is worse than the bare box this
replaced.

⚠️ **They are separate files on purpose.** An empire resource pays for being **held**, so the
interesting number is per copy multiplied by reach. A factory resource pays for being
**slotted**, so the only numbers worth showing are the total from copies actually in factories
and — separately — what the idle ones would add. Neither aggregation rule is the other's.

---

## `empire-effects.js`

```js
empireEffectTotals(resourceType, copies, settlements = null)
    // → [{ kind: 'yield'|'combat'|'percent', ... }]
forgetEmpireEffects()   // called when the tab is opened
```

Returned entries:

| `kind` | Fields | Meaning |
|---|---|---|
| `yield` | `yieldType, amount, perCopy, scales, conditional, active` | income per turn |
| `combat` | `amount, perCopy, capped, units[], conditional, active` | combat strength, capped |
| `percent` | `amount, perCopy, towards[], conditional, active` | % towards building something |

Two modifiers granting the same yield are merged into **one line, not two**.

### The four effect shapes

```
EFFECT_CITY_ADJUST_YIELD_PER_AVAILABLE_RESOURCE_TYPE     Gold, Silver, Wine, Furs…
EFFECT_CITY_ADJUST_YIELD_PER_RESOURCE                    Ivory, Horses, Pearls…
PLAYER_ADJUST_YIELD_PER_RESOURCE_TYPE
    → Amount × copies × settlements the modifier reaches

EFFECT_UNIT_ADJUST_COMBAT_STRENGTH_PER_RESOURCE          Saltpeter, Coal, Oil, Rubber
    → Amount × copies, across the army, capped

EFFECT_CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_RESOURCE Coal, Oil
    → a percentage, Amount × copies, towards one kind of building

EFFECT_PLAYER_ADJUST_UNIT_PRODUCTION_PER_RESOURCE        Hardwood (only)
    → a percentage, Percent × copies, towards a kind of UNIT rather than a building
```

⚠️ **`EFFECT_PLAYER_ADJUST_UNIT_PRODUCTION_PER_RESOURCE` names its own figure `Percent`, not
`Amount`** - the one effect here that does. Reading only `Amount` silently dropped it to the
card's fallback text (the game's own description, composed but not stylised - "missing labels
on Hardwood", since `Locale.compose` leaves `[icon:...]` and `[TIP:...]...[/tip]` as literal
text). `empireEffectTotals` now reads `Amount ?? Percent`.

Its TARGET is also unlike the combat branch above: an **argument** on the modifier
(`Domain="DOMAIN_SEA"` in Antiquity/Exploration, `UnitClass="UNIT_CLASS_NON_COMBAT"` in
Modern), not a unit-tag `REQUIREMENT_UNIT_TAG_MATCHES` requirement - so `unitClassesOf` does
not apply, and `unitProductionTargetName` reads the argument directly. `DOMAIN_SEA` reuses this
file's own naval name (`LOC_NAJANE_COMMERCE_UNITS_NAVAL`); `UNIT_CLASS_NON_COMBAT` gets a key
of its own, `LOC_NAJANE_COMMERCE_UNITS_CIVILIAN`.

### ⚠️ All four suffixes scale with copies

```
PER_RESOURCE                  62 uses
PER_AVAILABLE_RESOURCE_TYPE   29 uses
PER_RESOURCE_TYPE              3 uses
PER_SLOTTED_RESOURCE           7 uses
```

An earlier version read those names as the *counting rule* and concluded that the two carrying
`_TYPE` pay once for the whole empire. **Play says otherwise**: improving one more copy of Gold
raised income by roughly the settlement count, which that reading predicts should not happen at
all. The same correction applies to `PER_RESOURCE_TYPE`, left flat one round longer — Wine
showed +10 Culture whether you held one bottle or six.

What actually differs is **reach**, and that comes from the **collection**: a settlement-scoped
bonus pays once per settlement it reaches, a player-scoped one pays once, full stop.

> The lesson is bigger than the number: **a name in the data is a hypothesis, and a measurement
> in the running game outranks it.**

### `settlementsReached(modifierId, settlements)`

**Both** narrowings apply:

1. the **collection** says which settlements are in scope at all — `…CAPITAL…` filters to the
   capital, `…PLAYER…` returns 1 (a player-level effect lands once, not once per settlement);
2. the **requirements** then filter those, through the same evaluator the assignment scoring
   uses.

⚠️ Reading only the requirements is not enough. Furs give +3 Happiness through
`COLLECTION_ALL_CAPITAL_CITIES` — the capital, once — and counting that in every settlement
multiplied the figure by the size of the empire.

### The combat cap

```js
const COMBAT_STRENGTH_CAP = 6;
```

⚠️ **Not in the data.** Every one of these resources says "(maximum +6)" in its own description,
but no modifier argument, global parameter or table carries the number — the engine holds it.
So it is a constant here, and **if a patch changes the cap this is the line that will be
wrong**. Everything else is read from the game.

### Which units a combat bonus reaches — `unitClassesOf`

⚠️ **Unit classes overlap.** A battleship is `SIEGE` and `NAVAL` and `HEAVY` and `RANGED` all at
once. Saltpeter, written as `RANGED + SIEGE`, reaches every heavy warship in the age — which is
why the game's own description talks about heavy naval units, and why listing only the two named
tags left a player looking at a battleship unable to tell whether it was included. It was.

So a class is listed when **every** unit in it is covered — containment, not overlap. Naval is
not added to saltpeter, because light warships are naval and are not reached.

⚠️ `LIGHT` and `HEAVY` are **naval** classes. This was wrong here at first — the tags read as
land units. Checked against `age-modern/data/units.xml`: `UNIT_CLASS_LIGHT` is the cruiser,
destroyer and ironclad; `UNIT_CLASS_HEAVY` is the battleship, dreadnought and frigate.

Once the whole of `NAVAL` is covered, the two halves are dropped as noise — but **only** the
naval halves. ⚠️ Deliberately *not* a general "drop any class contained in another": in the
Modern age every heavy warship happens to be ranged as well, so that rule would quietly delete
"heavy naval" from saltpeter — the one class a player checking their battleship is looking for.
Containment between roles is a coincidence of one age's roster; containment within naval is a
taxonomy.

⚠️ **The unit-class tags have no name anywhere in the game's data** — nothing displays them, so
nothing translates them. `UNIT_CLASS_NAMES` maps them to **this mod's own** localisation keys;
see [localisation](12-localisation.md).

### Celebration-only bonuses

`REQUIREMENT_PLAYER_IS_IN_GOLDEN_AGE` is the only condition on these resources that is about the
*player* rather than a settlement. Three modifiers carry it — furs and tea pay gold during a
Celebration and nothing outside one.

`playerCondition` returns `{ conditional, active }`. `active: false` entries are drawn faded with
an explanatory tooltip, and are **excluded from the empire income summary** — adding them at all
times would overstate actual income.

### What is left out

⚠️ **Effects this does not know how to total are left out rather than guessed at.** The card
still carries the game's own description in its tooltip, so nothing goes missing — it simply
does not get a number of its own.

---

## `factory-effects.js`

```js
factoryEffectTotals(resourceType, count)   // → [{ kind, amount, perCopy, yieldType?, towards? }]
sumFactoryTotals(perResource)              // adds across resources, keeping incompatibles apart
absoluteWorth(yieldType, percent, applied) // → { worth, net }
gdpPerSlottedResource()                    // from VictoryScorings
slottedFactoryResources()                  // → Map<type, { count, cities[] }>
heldFactoryResources()                     // → Map<type, { total, definition, origins }>
factoryHoldings()                          // → { working[], idle[] }  ← what the tab renders
FACTORY_CLASS = 'RESOURCECLASS_FACTORY'
```

### The five effect shapes

⚠️ **None of them is one `empire-effects.js` already handles**, which is why the placeholder tab
could not simply reuse it:

```
ADJUST_PLAYER_YIELD_PER_SLOTTED_RESOURCE          Cocoa, Tea, Kaolin  — % of a yield
CITY_ADJUST_UNIT_PRODUCTION_PER_SLOTTED_RESOURCE  Citrus, Cotton      — % towards units
CITY_ADJUST_CONSTRUCTIBLE_PRODUCTION_PER_SLOTTED  Coffee              — % towards builds
CITY_ADJUST_GROWTH_PER_RESOURCE                   Tin                 — % growth rate
UNIT_ADJUST_HEAL_PER_RESOURCE                     Quinine             — flat HP
```

⚠️ **Two of them carry the number in a `Percent` argument rather than `Amount`**, and the
constructible one names a `ConstructibleClass` rather than a `ConstructibleType`. Code written
against the empire-resource shapes reads every one of these as **zero**. `numberOf()` tries both.

### ⚠️ These do NOT multiply by the number of settlements

`PER_SLOTTED_RESOURCE` and `GlobalSlots` both mean the empire's slotted copies are counted once
and the percentage then applies wherever the collection says — so four Coffee is **+20% in every
settlement, not +20% per settlement**. This is the opposite of how the empire resources
aggregate, and getting it backwards would inflate the figures by the size of the empire.

### `sumFactoryTotals`

"+9% Science" and "+20% towards Buildings" are **not +29% of anything**, so the key is the kind
*and* what it is aimed at. Two resources that both raise Science do combine.

### `absoluteWorth` — the ≈ figure

"+30% Science" is meaningless without knowing your Science. This turns it into the number the
player would have worked out by hand.

⚠️ It is an **estimate** and is labelled as one. The catch: the net yield **already includes**
whatever factory resources are slotted, so a naive `net × percent` overstates it — a 30% bonus is
30% of the yield *before* itself, not after.

```
before = net / (1 + applied/100)
worth  = before × percent/100  =  net × percent / (100 + applied)
```

Exact if the game multiplies its percentages, close if it adds them together with percentages
from other sources — which is not knowable from here, hence "about". `applied` is the factory
percentage for that yield already in the net figure, computed once per render in
`ui/screen/factory-resources.js`.

Only the three that multiply a yield readable off the top panel get an estimate (Tea, Kaolin,
Cocoa). The rest multiply production towards one particular thing, or a growth rate, and there is
no single figure to take a percentage of.

### GDP per slotted resource

⚠️ **Read from `GameInfo.VictoryScorings`** (`VICTORY_TRACKER_SLOTTED_FACTORY`), not written as a
3. It is exactly the kind of number a balance patch moves, and a hardcoded one would go on
looking right while being wrong.

⚠️ **Not the whole story for every civ**: America's Industrial Park quarter carries a second row
worth +1 more per resource in the settlement holding it. Detecting that needs a walk over each
settlement's plots for a civ-specific case, so **the tooltip says so** instead of the number
quietly being low.

### Reading the holdings

⚠️ A settlement may run only **one kind** of factory resource at a time, but **any number of
copies** of that kind — which is why one `getFactoryResource()` plus one `getNumFactoryResources()`
per settlement is the whole picture, and why the counts must be summed across settlements rather
than read from any single one.

⚠️ One entry from `getResources()` is **one copy, not one kind** — the game's own empire-tab
builder counts them the same way. The origin (`Game.Resources.getOriginCity`) is looked up per
copy, which is the only reason the tooltip's counts can be per settlement.

`factoryHoldings()` computes **idle = held − slotted** rather than taking a separate reading, so
the two sections always account for exactly the copies you own — a resource cannot appear in both
with counts that do not add up. Both lists are sorted by count, descending.
