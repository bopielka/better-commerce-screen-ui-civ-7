# 08 — `ui/planner/` — valuation: what a resource is *worth*

Two modules that answer a different question from the assignment engine. They do not decide
where anything goes; they turn a rule into a number the player can act on, and they feed the
Empire and Factory tabs.

| File | Feeds |
|---|---|
| `empire-effects.js` | `ui/screen/empire-tab.js` |
| `factory-effects.js` | `ui/screen/factory-resources.js` |
| `gdp.js` | the GDP readout in `ui/screen/assign-all-buttons.js` |

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

⚠️ **Nothing a tooltip shows is worked out up front.** `appendWithResourceTooltip(parent,
trigger, props, fallbackText, groups)` takes the fallback text and the leader cards either as
values or as functions: the cards are resolved once, untracked, on the first hover, and the
fallback text only if the component fails to mount. Composing both for every card on every visit
was most of what opening the Empire and Factory tabs cost.

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
empireEffectTotals(resourceType, copies, settlements)
    // → [{ kind: 'yield'|'combat'|'percent', ... }]
```

`settlements` is required, and only `cityID` and `settlementNameData.isTown` are read from it —
the Empire tab passes `buildSettlementRefs()` from `headless-model.js`, not the whole planner
board. ⚠️ The unit-class index behind the combat lines is static data for the age and is reset
**only** through `support/game-data.js`; dropping it every time the tab opened re-scanned
`GameInfo.Units` and `GameInfo.TypeTags` on every visit.

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
sumFactoryTotals(perResource)              // adds across resources, keeping incompatibles apart
absoluteWorth(yieldType, percent)          // → { worth, net }
forgetYieldPools()                         // drop the cached pools before a render
factoryGdpRequirement()                    // what the factory tracker still waits for, or null
gdpPerSlottedResource()                    // from VictoryScorings, through gdp.js
factoryHoldings()                          // → { working[], idle[] }  ← what the tab renders
```

The per-resource totals and the slotted/held readers behind `factoryHoldings` are module-private.

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

### ⚠️ The game ADDS its percentages; it does not compound them

**Reported from a live game, 2026-09-05.** Base 1000 Science, +25% from a diplomacy project, +15%
from five slotted Tea, and the game pays **1000 + 250 + 150 = 1400**. The Tea is worth 150 — 15%
of the *base*, not 15% of the 1250 that was on the panel before it.

So **the top-panel figure cannot be the base for any of this**, and no amount of dividing the
factory percentage back out of it helps: the other percentages are in there too, and they are not
knowable from the panel.

```
pool  = Σ settlements' net yield        ← the "before"; the top panel is the "after"
worth = pool × percent/100
```

⚠️ **The pool is the sum of the SETTLEMENTS' net yields**, read with `city.Yields.getNetYield`.
These effects are `COLLECTION_ALL_PLAYERS`, so they land after the settlements have been added up
— which is exactly why the settlement figures are the base and the player figure is not.

The same formula answers both questions, with no denominator to get wrong: "how much of my Science
comes from Tea" and "how much would slotting these add" are both `pool × percent/100`.

Still labelled "≈": a few yields reach the empire without passing through a settlement, and the
pool does not see those. `forgetYieldPools()` clears the per-yield cache once per render in
`ui/screen/factory-resources.js` — one pass over the settlements per yield, not one per card.

Only the three that multiply a yield readable off the top panel get an estimate (Tea, Kaolin,
Cocoa). The rest multiply production towards one particular thing, or a growth rate, and there is
no single figure to take a percentage of.

### ⚠️ A tracker pays NOTHING until a tech or a civic switches it on

Every row this mod reads out of `victories.xml` carries `RequiresActivation="true"`:

| Scoring id | Unlocked by |
|---|---|
| `VICTORY_TRACKER_SLOTTED_BONUS` / `..._SLOTTED_CITY` | `NODE_TECH_AQ_WHEEL` — the Wheel |
| `VICTORY_TRACKER_GOLD_BUILDINGS_ANTIQUITY` | `NODE_TECH_AQ_CURRENCY` — Currency |
| `VICTORY_TRACKER_IMPORTED_RESOURCES` | `NODE_CIVIC_AQ_MAIN_SKILLED_TRADES` — a **civic**, not a tech |
| `VICTORY_TRACKER_SLOTTED_FACTORY` | `NODE_TECH_MO_MASS_PRODUCTION` — Mass Production |

The mod handed out the table's rate whatever the player had researched, so a turn-one empire was
promised GDP it could not earn. `trackerRequirement(scoringId)` in `ui/planner/gdp.js` answers
what a tracker is still waiting for; a locked one contributes **zero**, and the tooltip line says
why in red rather than leaving a bare `+0` to be read as "you have assigned nothing".

⚠️ **The table above is derived at runtime, not written down.** `indexTrackerNodes()` walks
`ProgressionTreeNodeUnlocks` for `KIND_MODIFIER` rows and resolves each to the tracker it
activates. Hardcoding the four node names would break on the next balance patch and on any mod
that moves them.

⚠️ **`TrackerName` is the marker, and one argument name is enough.** Across Base and every DLC it
appears on `EFFECT_PLAYER_ACTIVATE_VICTORY_POINT_TRACKER` and on nothing else, so resolving each
candidate's effect properly would be a scan of the 12k-row `Modifiers` table to learn what the
argument name already says.

⚠️ **One level of attachment has to be followed.** The Wheel's node names
`MOD_AQ_CITY_RESOURCE_GDP`, which does not activate anything itself — it is an
`EFFECT_ATTACH_MODIFIERS` naming the two that do. Reading the node's own modifier alone finds
neither. Nothing in the data nests deeper.

⚠️ **NO node in this age means UNLOCKED, not locked.** `GameInfo` holds only the age being played,
and from Exploration onwards every civilization's trait (`TRAIT_EXPLORATION_CIV`,
`TRAIT_MODERN_CIV`) activates the four antiquity trackers outright. There is no node to find, so
"not found" must mean "already on" — the opposite default would black out the whole readout for
every player past Antiquity.

⚠️ **Unknown counts as unlocked** in `nodeUnlocked` too. Claiming a tracker is locked hides points
the player may well be earning, which is the worse of the two errors.

### Reading the GDP total — `gdpPerTurn()`

⚠️ **Read off the engine, not through `buildSettlements()`.** Only the town flag and the slotted
types count, and the planner's board also reads capacities, yields and a building walk per
settlement; the settlements are the same ones it would build (those with a `Resources`
component). The gold-building walk is skipped while that tracker pays 0, and the memoised age
type is cleared through `support/game-data.js`.

⚠️ `scoringRate(scoringId)` is **the only reader of `GameInfo.VictoryScorings`**: `ScoringId` is
its primary key, so one memoised map answers every tracker, the factory rate included.

### GDP per slotted resource

⚠️ **Read from `GameInfo.VictoryScorings`** (`VICTORY_TRACKER_SLOTTED_FACTORY`, through
`scoringRate`), not written as a
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
