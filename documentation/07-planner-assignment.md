# 07 — `ui/planner/` — the assignment engine

Deciding what goes where, and doing it. Ten of the fourteen files in `ui/planner/`; the other
four are covered in [planner: valuation](08-planner-valuation.md).

| File | Lines | Purpose |
|---|---|---|
| `effects.js` | 259 | reading the modifier tables |
| `facts.js` | 395 | what a resource **is** and **does** |
| `scoring.js` | 964 | the tiers and `bestAssignment` |
| `place.js` | 283 | the placement loop, shared by both paths |
| `run.js` | 129 | every entry point — one guard around `place.js` |
| `auto-assign.js` | 344 | deciding **when** to run with the screen closed |
| `priorities.js` | 112 | per-settlement priority, in memory |
| `happiness-setting.js` | 89 | how far the rescue tier goes |
| `hoard-setting.js` | 84 | whether the culture and gold piles are built |
| `imports-first-setting.js` | 69 | whether trade-route resources jump the queue |

## ⚠️ Attribution

The assignment engine is a **port of Resource+** (`brads-assign-all-resources`, Steam id
3756000777) by **Br4d**, at this mod's author's request, so the buttons behave identically.
The scoring constants, the ordering rules, the conditional-bonus table and the overall shape
of `bestAssignment` are **Br4d's work, used with permission** — see the note at the top of
`ui/planner/scoring.js`. Keep that note.

Divergences from Resource+ are marked in the source and listed at the end of this document.

---

## `effects.js` — reading the modifier tables

Everything about what a modifier *is*. Three indexes, each built once and cached in a
module-level `Map`, because `GameInfo` tables are iterated rather than queried.

```js
resourceModifiers(resourceType)   // → Map<modifierId, Map<argName, value>>
modifierApplies(modifierId, settlement)   // would it actually do anything here?
modifierIsConditional(modifierId)         // is it gated on anything at all?
modifierRequirements(modifierId)          // → { all, entries: [{ type, inverse, args }] }
effectTypeOf(modifierId)                  // → EffectType string
collectionOf(modifierId)                  // → CollectionType string
forgetModifierIndex()                     // called when a tab opens
```

### Two bugs the ported code had, both found by auditing every resource in every age

⚠️ **1. Not every resource modifier is registered in `ModifierMetadatas`.** Resource+ looked
there only. Nickel (Modern) and one of Gypsum's (Antiquity) are linked *solely* by the
modifier's own `ResourceType` **argument**, so they were invisible — Nickel scored as a
resource that does nothing at all. `indexResourceModifiers` reads both links.

⚠️ **2. Modifiers carry requirements, and most of them mean "cities only".** 29 resource
modifiers are gated on `REQUIREMENT_CITY_HAS_BUILD_QUEUE`, which a town does not have. Jade's
+10 gold, Silk's +10 culture, Lapis Lazuli's +4 production — all of it was being credited to
towns, where none of it happens. Others split by settlement type outright: Tin gives +2
production in a city and +4 in a town, Wild Game +2 and +4, and taking the smaller of the two
(which is what happens when both look applicable) understated both.

### Requirement types understood

```
REQUIREMENT_CITY_IS_CITY          REQUIREMENT_CITY_IS_TOWN
REQUIREMENT_CITY_HAS_BUILD_QUEUE  ← the common "cities only"
REQUIREMENT_CITY_IS_CAPITAL       REQUIREMENT_CITY_IS_DISTANT_LANDS
REQUIREMENT_CITY_HAS_BUILDING
```

⚠️ **Anything not understood counts as satisfied.** Being too eager costs a slightly wrong
score; being too strict would silently drop a resource from consideration entirely, which is
much worse and much harder to notice. `entry.inverse` flips the answer.

The requirement *set* type matters too: `REQUIREMENTSET_TEST_ANY` means "some", anything else
means "all".

### `effectTypeOf` / `collectionOf`

⚠️ **Both come from `DynamicModifiers`, keyed by `ModifierType`.** `Modifiers` rows carry
neither. Reading `CollectionType` off a `Modifiers` row returns `undefined` every time, which
silently disabled capital-only handling: furs give +3 Happiness in the **capital**, and the
total was being multiplied by the whole empire.

Resource modifiers use four collections: `ALL_CITIES` (115), `ALL_UNITS` (10), `ALL_PLAYERS`
(10), `ALL_CAPITAL_CITIES` (6).

---

## `facts.js` — what a resource is and does

Answers questions about a resource type alone, or a type in a given settlement, with **no view
on whether placing it there would be a good idea**. That judgement lives in `scoring.js`.
Split because the two change for different reasons: these follow the game's data, the scoring
follows what the player asked for.

Everything is cached by type, and by age where the age can change the answer
(`${Game.age}:${type}` keys).

```js
resourceType(resource)                       // from the field, or Game.Resources.getResourceOnPlot
resourceYieldTypes(resource)
effectiveResourceYieldTypes(resource, settlement)
resourceYieldEffects(resource)               // [{ modifierId, yieldType, amount, percent, effectType }]
givesUnitProductionBonus(resource)
resourceClassOf(resource)
isAssignableToSettlement(resource)           // false for empire and treasure resources
isImportedResource(resource)                 // came over a trade route from another leader
forgetImportOrigins()                        // called at the start of a placement run
scalesWithWarehouses(resource)
conditionalBoostStrength(resource, settlement)
yieldTypeFromIcon(iconSource)
HAPPINESS_YIELD, PRODUCTION_YIELD            // string constants
```

### `yieldTypeFromIcon`

⚠️ Built by asking `UI.getIcon` for every yield and indexing the answers. Resource+
pattern-matched the string with `/YIELD_[A-Z_]+/`, and **that never matches** — the icon for
`YIELD_HAPPINESS` is `blp:Yield_Happiness`, in mixed case. Every yield total read that way came
back as 0, **which is why the happiness rescue did nothing at all.**

### `effectiveResourceYieldTypes`

Cowries pay science in a town and gold in a city. Nothing else changes by place.

### `givesUnitProductionBonus`

Read from the modifier tables, **not from a list of resource names**: any
`*_ADJUST_UNIT_PRODUCTION_*` effect attached to the resource counts, qualified or not.

```
no qualifier at all               → every unit        (Truffles, Salt)
Domain = DOMAIN_LAND / DOMAIN_SEA → combat units      (Cotton, Hardwood, Citrus)
UnitClass = UNIT_CLASS_NON_COMBAT → settlers and such (Hardwood, modern)
UnitTag  = UNIT_CLASS_RELIGIOUS   → missionaries      (Incense)
```

⚠️ The first attempt *required* a qualifier and missed Truffles and Salt entirely, which is
how a truffle kept beating jade to a slot.

### `isAssignableToSettlement`

⚠️ An **empire** resource pays its bonus for being held and a **treasure** resource turns into
treasure fleets — neither is ever assigned to a settlement, and the game's own Commerce screen
drops both before it builds the unassigned pool.

⚠️ **Which resources those are changes with the age**, which is exactly why this is a class check
and not a list of names: Gold is `EMPIRE` in Antiquity and `TREASURE` in Exploration, Ivory is
`EMPIRE` then `BONUS`, Marble becomes `EMPIRE` only in Modern. Each age's `resources.xml`
rewrites the column with `<Update>` rows, so reading `ResourceClassType` out of the loaded
database already answers for the age being played.

Written as an **exclusion** rather than an allow-list, matching the game: a class a patch or a
DLC adds is then offered for assignment rather than silently vanishing from the pool.

Used by [`buildAvailableResources`](06-model.md), by `auto-assign.js` when deciding what counts
as a new arrival, and by `assign-notification.js`.

### `scalesWithWarehouses`

`EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD_PER_RESOURCE` modifiers carrying `Tag = WAREHOUSE`.
⚠️ Resource+ named a single resource here — turtles — and so missed Clay (production) and Crabs
(food), which scale exactly the same way.

### `conditionalBoostStrength(resource, settlement)`

0 means this settlement is not a place the resource is especially rewarded in; higher means it
is, and bigger is a better fit. Scoring lifts a resource a whole tier on this, so it has to
mean "this is the good branch" and nothing weaker.

- Warehouse-scaling resources return the **warehouse count**, which both measures the fit and
  steers them where the warehouses are.
- Otherwise 1 when a gated bonus applies here **and** what this settlement gets out of it is
  the most that resource can pay for that yield anywhere.

⚠️ Resource+ answered this from a hand-written table of resource names per age, **and the table
disagreed with the data**: it returned "conditions met" for gypsum, kaolin and pearls when a
settlement was **not** the capital, while the game gates those on
`REQUIREMENT_CITY_IS_CAPITAL` — the opposite. The same inversion ran through the distant-lands
entries for spices, sugar, tea and cocoa, and **31 conditional resources were missing from the
table altogether.** So the question is put to the data instead.

⚠️ **But "a gated bonus applies here" is not enough on its own, and asking only that is what
sent Fish to portless towns.** The game writes an either/or bonus as two gated modifiers, the
second the inverse of the first:

```
MOD_FISH_PORT_FOOD      +8 Food   requires BUILDING_PORT
MOD_FISH_NON_PORT_FOOD  +4 Food   requires NOT BUILDING_PORT
```

A settlement **without** a port satisfies a gated bonus — the consolation one — so Fish was
lifted onto the conditional tier there just as it is in a port city. In a food-hungry town
that put Fish at +4 (tier 850 000 000) above Sugar at a flat +8 (tier 700 000 000): the wrong
way round by a factor of two, which is the bug that prompted the rule above.

The same shape covers **Furs, Pearls, Silk, Tobacco and Truffles** in Modern, **Tin, Wild Game,
Gypsum, Kaolin and Pearls** in Antiquity, and **nine more** in Exploration. Note that the
direction flips between ages — Antiquity pearls are better *outside* the capital, Modern pearls
*inside* it — which is exactly why this is read from the data. The full per-age list is
[`knowledge-base/27-resources.md`](../../knowledge-base/27-resources.md).

---

## `scoring.js` — the tiers

`bestAssignment(model, targetCityID = null, blockedPairs = new Set())` returns
`{ resource, settlement, score, rescue }` or `null`.

### The tiers, highest first

| Base constant | Value | What it is |
|---|---|---|
| `HAPPINESS_RESCUE_BASE` | 10 000 000 000 | **not Br4d's** — the whole reason this file diverges |
| `FACTORY_FIRST_SCORE_BASE` | 5 000 000 000 | factory resources into fillable factories, when the switch is on |
| `CAMEL_SCORE_BASE` | 1 000 000 000 | slot-carriers first: they make room for everything after |
| `IMPORT_FIRST_SCORE_BASE` | 900 000 000 | imported resources into **cities**, when the switch is on |
| `SPECIALIZED_CONDITIONAL_SCORE_BASE` | 850 000 000 | serves the settlement's priority **and** a conditional bonus applies |
| `SPECIALIZED_SCORE_BASE` | 700 000 000 | serves the settlement's priority |
| `HOARD_SCORE_BASE` | 600 000 000 | gathering culture / gold — compared against, never chained |
| `PRODUCTION_FALLBACK_SCORE_BASE` | 550 000 000 | nothing serves this city's priority, but this brings production |
| `CONDITIONAL_SCORE_BASE` | 500 000 000 | a conditional bonus applies here |
| `SINGLE_YIELD_SCORE_BASE` | 100 000 000 | one yield |
| `MULTI_YIELD_SCORE_BASE` | 50 000 000 | more than one |
| `FALLBACK_YIELD_SCORE_BASE` | 10 000 000 | no readable yields |
| `UNIT_PRODUCTION_SCORE_BASE` | 1 000 000 | ⚠️ below everything: resources whose whole point is cheaper units |

Modifiers within and across tiers:

| Constant | Value | Effect |
|---|---|---|
| `TOWN_PRODUCTION_PENALTY` | 500 000 | a town wanting a production-carrying resource is docked half a priority step. A nudge, not a ban |
| `PRODUCTION_FALLBACK_WEIGHT` | 1 000 | inside `scorePair`; stays under the 100 000 a priority match is worth |
| `FACTORY_CONTINUE_BONUS` | 3 000 000 000 | finishing a running factory beats opening another |
| `FACTORY_STOCK_WEIGHT` | 10 000 000 | per copy that would actually **fit**, choosing what to start an empty factory on |
| `FACTORY_STOCK_CAP` | 40 | past this more copies stop mattering; keeps the tier under the rescue |
| `FACTORY_LEFTOVER_WEIGHT` | 1 000 | best fit: settles ties towards the snugger factory |
| `HOARD_CULTURE_FIRST` | 10 000 000 | culture pile is settled before the gold pile |

### The happiness rescue — `rescueScore`

Above everything, including camels. **No settlement should sit on negative happiness.**

⚠️ **How far this goes is the player's** — see [`happiness-setting.js`](11-options-and-persistence.md#uiplannerhappiness-settingjs).
It is the single largest thing the mod does to a layout and it used to be unconditional:

| Mode | Effect |
|---|---|
| Never | the tier does not run; happiness is just another yield |
| Cities only | cities are rescued, towns are left where they fall |
| All settlements (default) | cities first as a class, then towns — the original behaviour |

⚠️ In "cities only" a town's deficit is left out of the reading altogether rather than filtered
later, so an empire with one permanently unhappy town does not walk the whole board every pass
for a rescue it is going to refuse.

- `deficit * 1000` dominates, so the most unhappy settlement is served first.
- The tie-break is `min(boost, deficit) * 10` — credit for how much of the hole a resource
  actually fills, **with no reward for overshooting**, because the goal is zero and not a
  maximum.
- ⚠️ Deficits are read **fresh on every pass**. That is what makes the rescue *level out*
  instead of dumping everything into one settlement: each assignment is chosen against the
  deficits left after the previous one landed.
- **Cities come first as a class**: while any city is unhappy, no town is considered, however
  far below zero it may be (`townsAreEligible`).
- A camel scores here too, one point lower, but **only in a settlement that is unhappy *and*
  full** — it fixes nothing itself, it opens the two slots a happiness resource then needs.
  Pointless if no happiness resource is left, hence `happinessResourceExists`.

### Factories first — `factoryFirstScore`

⚠️ **The game's rule decides the shape of this, and it is not what the first version assumed:**

> "Only one type of Factory Resource can be assigned to a Settlement at a time. You can assign
> multiple copies of the same Factory Resource to a Settlement, so it pays to be efficient!"
> — `LOC_PEDIA_CONCEPTS_FACTORY_RESOURCES_TOOLTIP`

Spreading one apiece — which is what this did at first, by analogy with the happiness rescue —
is **the worst thing to do**. It commits every factory to a different kind, and then every
spare copy has exactly one settlement it may go to. With more kinds than factories, most of
the pool becomes unplaceable.

Instead: **keep feeding a factory that is already running**, and when starting an empty one,
**start it on the kind with the most copies waiting** — the kind that can fill it.

⚠️ **How many copies would actually LAND, not how many are waiting.** Weighing the raw stock
left the choice of *settlement* to `scorePair`, which is about yields and priorities and knows
nothing about how many slots are free — so the most plentiful kind could be started in the
smallest factory. Two factories with 3 and 10 free slots, Coffee ×10 and Cocoa ×3: starting
Coffee in the 3-slot one places 3, the 10-slot one then continues on Coffee for the remaining
7, and Cocoa never goes anywhere — **10 placed where 13 would fit**. Scoring
`min(stock, free slots)` sends Coffee to the roomy factory and leaves the small one for Cocoa.
`FACTORY_LEFTOVER_WEIGHT` then settles ties towards the snugger fit.

⚠️ **`factoryStockByType` read stock off the wrong key, once — and it shipped.**
`groupByResourceType` keys its groups compound: `` `${type}|${imported ? 'import' : 'ours'}` ``,
so an imported Coffee and a home-grown one are separate entries (a settlement's own
imports-first requirement needs to tell them apart). The first version of `factoryStockByType`
destructured that key straight into a variable it called `type` and used IT to key the stock
map — so every entry was actually filed under `"RESOURCE_COFFEE|ours"`, never the bare
`"RESOURCE_COFFEE"` that `factoryFirstScore` asks `factoryStock.get(type)` for. Every lookup
missed, stock silently read as 0 for every kind, and `wouldLand` — the whole "prefer the kind
with the most copies" term — was 0 for every candidate alike. With more than one factory the
symptom was subtle (the tier still preferred *continuing* a running factory, which masked it);
with exactly one, nothing was left to decide between kinds but `scorePair` — yield value, no
notion of stock at all — which is indistinguishable from picking at random if you are watching
for "the kind with the most copies." Fixed by reading `resourceType(group[0])` off each GROUP
instead of trusting the map's own key, and summing rather than overwriting so an imported and a
home-grown copy of the same kind count as the one stock they are.

### Imports first — `importFirstScore`

Off by default, offered in **every** age, and a bet on one victory condition. Towards the Economic
Victory a resource slotted in a city is worth **+1 GDP a turn**, and an imported one is worth
**+1 more on top** — double — while neither pays anything in a town:

```
VICTORY_TRACKER_SLOTTED_BONUS / _SLOTTED_CITY   Points=1   (city, not town)
VICTORY_TRACKER_IMPORTED_RESOURCES              Points=1   additive
```

⚠️ **"Imported" is the game's own test**, copied from `getResourcePropsFromDefinition` in
`commerce-screen-model.ts` — it is what draws the foreign leader's flag on the resource icon:

```js
originCity.owner !== GameContext.localPlayerID
```

The **current** owner, not `originalOwner`; the model reads that too, but only to pick the flag's
colours. A city you have since captured stops being an import.

The four ranks, best first. They decide the **order** imports are placed in, not whether they are
placed, because every one of them outranks everything that is not an import:

| Rank | Meaning |
|---|---|
| 3 | serves what the player told this city to make |
| 2 | brings production — the second choice everywhere else in this file too |
| 1 | the city has no specialisation of its own, so nothing is being displaced |
| 0 | a specialised city, and this helps neither its priority nor its production |

⚠️ Rank 3 is measured against the player's **explicit** choice, not `effectivePriority`. A
settlement left on Balanced has not asked for anything, so an import landing there displaces no
plan and belongs at rank 1 — that is what "fill the unspecialised cities next" means. Resolving
Balanced to production here would collapse ranks 3, 2 and 1 into one for every city the player
never touched.

⚠️ **Above the priority tiers on purpose**, which is the point and also the cost. A culture city
that has run out of imported culture must not start on *our* culture while an imported resource is
still homeless elsewhere: the import is worth double wherever it lands and ours is worth the same
wherever it lands, so ours can wait.

⚠️ **Below camels.** A camel is not a priority and does not compete with this — it brings two slots
with it, so placing one first can only mean *more* imports fit. That is also why the three are
compared with `Math.max` rather than chained with `??`: `importFirst ?? ordinary` would have pushed
an **imported camel** down off its own tier and cost the two slots it carries.

⚠️ **Cities only.** An import in a town earns nothing towards the tracker, so there is nothing to
promote and it falls back to the ordinary rules.

#### ⚠️ It broke an invariant in `groupByResourceType`

"Every copy of a resource scores identically" stopped being true of the **type** alone: your own
Silk and a Silk bought from a neighbour are the same type and worth different amounts of GDP.
Grouped on type alone, one representative would answer for both and every copy in the group would
be scored as whatever the first one happened to be. The group key now carries the import flag, and
the invariant holds again.

`isImportedResource` is cached by resource **value** for the length of a run and dropped by
`startPlacementRun()` — a city changing hands changes the answer, and that cannot happen while
resources are being assigned.

### Gathering — `hoardScore`

Everything paying **culture** into whichever city makes the most culture on its own; everything
paying **gold** into a different city, so the two piles do not compete for the same slots.

- Below the priority tier: a settlement takes what it was told to prioritise first.
- Above the conditional tier: gathering beats the generic "this bonus applies here" rule —
  including, deliberately, the warehouse rule that would otherwise scatter turtles.
- ⚠️ Compared against the ordinary score with `Math.max`, **not chained**, so it never
  overrides a settlement's own priority.
- ⚠️ "Pays the yield" is asked of **this settlement**, not of the resource in the abstract: silk
  pays culture in a city and nothing in a town, and a resource contributing nothing here has no
  business being gathered here.
- Cities only.

#### ⚠️ Exactly one settlement holds each role — and the role can move on

The gold pile used to have no target at all: it scored **every** city that was not the culture
city, weighted by that city's own gold. That is "spread gold around, richest first", not "build a
gold settlement", and it cost a slot in play — Jade reached the gathering tier (600 000 000) in
the **capital** while Silk, which was not the capital's pile, could only reach the conditional
tier (500 000 000) there and stayed in the pool.

⚠️ **When the settlement holding a role fills up, the next-best city takes it over.** A culture
city with two free slots would otherwise take two culture resources and let the remaining twelve
scatter under the ordinary rules — the very thing the option exists to prevent, merely delayed by
two slots.

⚠️ The gold role skips whichever settlement **currently** holds the culture role, not the one
picked at the start — so handing the culture role on also frees the city it left.

#### ⚠️ The ranking is settled once per run; only "who has room" moves

`hoardRanking` orders the cities by `bareYield` on the first pass of a run and holds that order.
`startPlacementRun()` — called by `place.js` next to `forgetEligibility()` — clears it.

`bareYield` subtracts the estimated contribution of what is slotted, so the culture city's own
bare culture **falls as its pile grows**, and with percentage resources the estimate is taken off
a total those same resources inflated. Re-ranked every pass, the leader could hand the role to a
rival partway through and leave the pile split between two settlements — the one outcome this
tier exists to prevent. Fixing the order means the role only ever walks **down** a settled list.

⚠️ **Only `cityKey`s are cached.** Settlement objects are rebuilt from the board before every
pass, so anything held across passes must be a key and not an object.

The log prints one line whenever the pair changes, so a handover is visible:

```
gathering: culture -> Yetakapewaki, gold -> Cilakofa
gathering: culture -> Berlin, gold -> Cilakofa        ← Yetakapewaki filled up
```

⚠️ `bestAssignment` builds `scoreContext` and picks the targets from **every** settlement, and
applies `targetCityID` only to the loop. Quick-assigning one settlement must not make that
settlement the culture city by default, and a `scoreContext` missing a city reads as "contributes
nothing", which would hand the pile to whichever city happened to be outside the filter.

⚠️ This started as **three resource names** — turtles, silk, jade — because that is how it was
first asked for. That left every other culture resource in the age out of the pile it obviously
belonged in: mangos, flax, wine and incense all pay culture and were being scattered. It is now
read from the data, so a patch or a DLC adding another one needs no maintenance here.

Both piles are switchable; see [`hoard-setting.js`](11-options-and-persistence.md#uiplannerhoard-settingjs).

`bareYield` is the settlement's yield minus the estimated contribution of what is slotted now
— *not* the model's `baseYields`, which is a snapshot taken when the screen opened and still
includes whatever was assigned at the time.

### `scorePair` — ordering within a tier

```js
priorityBonus            // 100000 serving the priority, 0 not
+ distributionScore      // -specializedLoad*100 if serving, else -weakestAffectedYield
+ productionFallback     // positive production boost * 1000, when the priority cannot be served
+ actualBoost * 10
+ (isTown ? 0.25 : 0)
+ openSlots * 0.001
```

⚠️ **There is no "no priority" case.** `effectivePriority` resolves Balanced to production in a
city and food in a town, so every settlement is always asking for something. The branch that
used to sit here gave an unprioritised settlement a flat 10 000 and ordered its candidates by
the settlement's **weakest** affected yield — the Resource+ reading of "balanced", which
quietly pulled every such settlement towards whatever it happened to be worst at.

Settlements matching their priority **share the actual yield gain as evenly as they can**, and
how well a resource serves that priority is the dominant term — so a resource giving +1
production is only reached for once every resource giving more of it has been placed. Llamas
(+1 production alongside +3 happiness) are the case that makes this visible.

⚠️ `PRODUCTION_FALLBACK_SCORE_BASE` had to become a **tier of its own, not a tiebreak**. As a
term inside `scorePair` it only ordered resources already on the same tier — so a
culture-focused city with no culture resources left still took pearls, because a conditional
bonus outranks a plain one, and the production sitting in the pool never got a look in. Cities
only: production in a town turns into gold rather than buildings.

### Caches, and when they are cleared

| Cache | Scope | Cleared by |
|---|---|---|
| `eligibilityCache` (`canAssign` answers) | across passes | `forgetEligibility()` / `forgetEligibility(cityID)` |
| `boostsThisPass` | **one planning pass** | `startPlanningPass()`, first line of `bestAssignment` |
| `scoresThisPass` | **one planning pass** | same |

⚠️ `startPlanningPass()` **must come first** in `bestAssignment`: what those hold describes the
board as it was *before* the last assignment landed.

Within a pass the same figures are asked for again and again — `estimatedYieldBoosts` for the
priority yield, then production, then happiness; `scorePair` from as many as four branches of
the same decision. Keyed by resource **type**, since two copies score identically.

### `groupByResourceType`

Every copy of a resource scores identically — nothing in the scoring reads anything but the
type — so only one representative per kind is scored. The others come along as **substitutes
for when the engine refuses that particular one** (`assignableCopy`). With a large pool most
of the pool is copies.

A resource whose type cannot be read becomes its own group rather than being lumped in with
every other unreadable one.

---

## `place.js` — the placement loop

```js
placeResources({ scope = null, targetCityID = null, label = 'assign' })  // → Promise<number>
```

**One loop for both paths** — the buttons on screen and the automatic placement with the screen
shut. They used to be two.

### ⚠️ Why it does not go through the screen's model

The first version drove the screen: `clickAvailableResource`, `slotSelectedResource`,
`deselectSelectedResource`, then poll the model until the resource showed up. Measured over
111 resources:

```
assigned 111 resource(s) in 30663ms (1610ms planning, 16346ms waiting, 276ms each)
```

Only 1.6 s of 30.7 s was deciding anything. The 12.7 s unaccounted for were the three model
calls: each mutates a Solid store and re-renders the screen, so every resource paid for three
full redraws it had no use for. The 16.3 s of waiting was the fourth redraw — the loop was
waiting for the **screen** to catch up before it could plan again.

So this talks to the engine and reads the engine back. The screen still redraws — it listens
for the engine's events — but nothing here waits for it.

### ⚠️ …but it must not outrun the screen either

`letTheScreenCatchUp()` waits **one frame between placements, and only while the Commerce screen
is open**.

The screen updates **incrementally, and it can miss events.** `commerce-screen-model.ts` turns
`ResourceAssigned` into a Solid signal with `createEngineEvent`, which is a plain
`createSignal()` — it holds the **latest payload and nothing else** — and the effect reading it
splices that one resource into its store. Two events delivered in the same tick therefore produce
one splice, and the resource from the overwritten payload never appears on screen.

This loop provokes exactly that: it confirms an assignment by **polling** the settlement every
4 ms, so it moves on as soon as the game state changes, which is earlier than the event is
delivered. At roughly fifteen placements a second the events arrive in clumps.

⚠️ **The board is correct; the drawing is not.** Leaving the screen and coming back rebuilds it
from scratch and shows the real layout — which is what makes this look like an assignment bug. It
cost a round of investigating the scoring for a fault that was never there, which is why
`verifyScreenMatchesEngine()` now reconciles the two afterwards.

#### ⚠️ The two halves of the screen fail differently

| | Repaired by | A missed event leaves |
|---|---|---|
| Settlement cards (right) | the handler re-reads `getAssignedResources()` and rewrites `availableSlots` and `yieldDeltas` from live state on **every** event | nothing — the next event heals it |
| Unassigned pool (left) | nothing; a row is removed **only** by the event naming that exact resource | a **ghost row for as long as the screen stays open** |

Checking only the assigned count therefore reported "all good" while the pool still showed a
resource that had been placed — which is how the second round of this went. So
`pruneAssignedFromPool` in [`screen-model.js`](06-model.md) **repairs** the pool by deleting rows
for resources the game has slotted, and the cards are only *reported* on, since rebuilding those
is the game's job and reopening the screen does it.

⚠️ **Removal only, deliberately.** Deleting a row needs nothing but the resource value. Putting
one *back* would mean building a `ResourceSlotData` complete with `resourceProps` and its
`canSwapWithSelectedResource` memo — reimplementing the model's own builder, which would rot the
first time it changes. That direction is not needed anyway: unassigning goes through the model's
**update gate**, which accumulates its events in an array rather than a signal, so it does not
drop them.

⚠️ **There is no way to ask the screen to rebuild.** `updateSlottedResources()` does exactly that
and is private; the model's only public reset, `resetResourceTab()`, merely clears the selection.
So the answer is not to refresh afterwards but to not outrun it — hence the frame.

With the screen shut there is no model to keep in step and the automatic path runs at full speed.

### ⚠️ Do not "optimise" this into a batch

Each choice is made against the board the previous one left behind. That is what makes the
happiness rescue level out and the factories fill one kind at a time.

### The loop

```
forgetEligibility(); forgetSettlementBuildings();      once, at the start
while (placed < MAX_PLACEMENTS = 300):
    settlements = buildSettlements()                    ← read the board
    available   = buildAvailableResources(...) filtered by scope and `refused`
    plan        = bestAssignment(buildHeadlessModel(settlements, available), targetCityID)
    if !plan: break
    if !canAssign(...): refused.add(value); continue
    if !requestAssign(...): break
    forgetEligibility(plan.settlement.cityID)            ← only this settlement changed
    forgetSettlementBuildings(plan.settlement.cityID)
    await awaitAssignment(...)  — if it never arrives, refuse it and stop asking
```

`refused` exists because a pair the engine rejects would otherwise be chosen again every pass
and the loop would never finish.

`awaitAssignment` asks **the settlement itself** whether the resource has arrived, polling every
4 ms up to 2 s. ⚠️ **Not the `ResourceAssigned` event**: that fires for every player, so an AI
assigning something across the map would release the loop early and the next plan would be made
against a board that had not changed.

Timing is logged in four parts — reading the board, choosing, waiting, per-resource — which is
how the model-driven version's cost was found in the first place.

### ⚠️ One log line per placement, naming the tier

`bestAssignment` returns a `tier` string alongside the plan, and `place.js` prints it:

```
  RESOURCE_SILK [import] -> Yetakapewaki (imports first)
  RESOURCE_TIN -> Yetakapewaki (production fallback (wanted YIELD_CULTURE))
```

Only the happiness rescue used to say anything, and that left every other outcome
unexplainable from outside. "Why did Tin end up in my culture capital instead of Silk" has at
least four possible answers — the import tier, the production fallback, a rescue, or the
resource already sitting there before the run — and **the board looks identical in all of
them**. Three rounds of reasoning from screenshots settled none of them; one line each does.

### Diagnostics

- `explainWhyNothingFits(scope, refused)` — runs **only when a pass placed nothing**, which is
  the case worth explaining. Prints the pool size, how many settlements have room, and up to 8
  per-resource refusal reasons from the engine's own words. ⚠️ One settlement per resource is
  enough: the common reasons repeat, and asking every settlement would multiply the most
  expensive call in this mod by the size of the empire for a log line.
- `logFactoryState()` — one line at the start of a run when factories-first is on.
  ⚠️ "Factories first placed nothing" has three quite different causes — no factory resources in
  the pool, no settlement with a factory, every such settlement full — and from the outside they
  look identical. Three counts tell them apart at a glance.

---

## `run.js` — every entry point

```js
assignAll(model?, { scope?, label? })   // → Promise<number placed | false>
reassignAll(model?, { label? })         // clear everything, then place
unassignAll(model?)                     // clear everything and stop there
quickAssignSettlement(model, cityID)    // one settlement only
isAssignmentInProgress()                // read by the buttons and by assign-notification.js
```

⚠️ They answer **how many resources landed**, and `false` only when the run refused to start.
"Did it start" is not enough: `auto-assign.js` forgets a newly acquired resource only once
something has actually been placed, so a run that started and placed nothing would otherwise look
like success and swallow the arrival.

`runExclusively` guards every entry point: **only one of these may run at a time**, and none may
start while `model.isSlottingAvailable` is false. It deselects first and always clears the flag
in `finally`.

⚠️ **`model` is optional.** The automatic path has no Commerce screen and therefore no model, and
it used to keep **its own copy of this guard** — which meant an automatic pass could start while
Reassign All was halfway through emptying the empire, and the two then planned against each
other's half-finished board. There is nothing to deselect and nothing to wait for with the
screen shut, so those two conditions are simply skipped.

⚠️ **Emptying lives in [`engine/unassign.js`](05-engine.md), not here.** There were three
implementations of "empty every settlement" — the Reassign All button, the automatic rebuild and
the Unassign All button — and they had already drifted: one counted resources and one counted
settlements, one had a per-resource fallback and one did not, and only two of them waited for the
engine. Three answers to "did that work?" for one action.

`logHappinessState` prints the deficits the rescue tier is looking at, before and after.
⚠️ **Diagnostics only** — it is guarded by `DIAGNOSTICS` at the call site rather than inside
`log`, because the walk over every settlement is the expensive part, not the printing.

---

## `auto-assign.js` — with the screen closed

```js
startAutoAssign()        // called once from the entry point
isAutoAssignRunning()    // a pass is in flight
isAutoAssignPending()    // in flight, scheduled, or a trigger arrived < 1.5 s ago
```

⚠️ **This module decides WHEN, and nothing else.** The work goes through `run.js` — the same
entry points the buttons use. It used to call `placeResources` directly, keep its own
"is a pass running" flag beside `run.js`'s, and carry its own copy of "empty every settlement";
see the note in `run.js` above for what that cost.

### Only NEW resources are touched

Not everything that happens to be unassigned — **a player who left something out did that on
purpose**. Every resource the player owns is remembered in `known`; only values that were not
there last time are candidates.

⚠️ The seeding happens **as soon as the game is far enough along to ask** (`seedWithRetries`,
30 attempts a second apart), *not* on the first event. Seeding on the first event meant the
first thing that ever happened was swallowed to build the list — and since a player usually
turns the option on and then goes and does something, the first thing that happened was exactly
the thing they were waiting to see work.

### When it runs

⚠️ **There is no "resource acquired" engine event.** Checked against the engine's own event
names: the closest are `ResourceAddedToMap` (a resource appearing on the **map**, not in your
hands) and `ResourceAssigned`. So a spread of cheap events is watched and **two** questions are
asked on each: has the set of resources grown, and has the empire's **room** for them?

```
ConstructibleBuildCompleted    something the production queue finished
ConstructibleAddedToMap        an improvement that appeared without being built
ConstructibleChanged
TradeRouteAddedToMap           a new route brings its payload
TradeRouteChanged
ResourceCapChanged
WonderCompleted                the Colossus and friends carry resource slots
CityTransfered                 a settlement changing hands brings its resources with it
ConqueredSettlementIntegrated
CityAddedToMap
PlayerSettlementCapChanged
LocalPlayerTurnBegin           catch-all / safety net
```

…plus a **periodic sweep every 15 seconds** (`SWEEP_MS`), and one quiet look once the game is
readable — which finds nothing, because seeding has just recorded everything the player owns.
⚠️ **Loading a save is not an event**: nothing happened in the game, and a pool the player left
full is a pool they left full.

### ⚠️ Why there is a sweep at all

The event list above was **wrong three times running**, and each time it presented identically:
the feature simply did nothing.

| Missing | Why it was missed |
|---|---|
| trigger while the Commerce screen was open | dropped, never rescheduled |
| `ResourceUnassigned`, loading a save | not events anyone thinks to listen for |
| `ConstructibleAddedToMap` | `ConstructibleBuildCompleted` is the **production queue** finishing something; an improvement that appears because the city expanded onto the tile is never "built" |

The engine's event surface is not documented and the names that exist are not the names one
would guess. Chasing gaps one at a time is a losing game — each fix is right and the next gap is
still out there. **The events make it feel instant; the sweep makes it correct.**

It is cheap enough to justify: one walk over the player's resources and one over the cities, no
`canStart` calls. Sweeps are **silent when they find nothing** (`quiet`), or the log would fill
with them — and a sweep landing on top of a real event does not silence that event's report.

### ⚠️ None of this needs the Commerce screen, and it never opens it

The watcher attaches at load, before the screen has ever been mounted, and the whole path —
`buildSettlements`, the scoring, the player operations — reads and writes the **game**, not the
screen. The `the Commerce screen is open, waiting` lines mean the *player* had it open and the
pass deferred to them; they are not the mod opening anything.

⚠️ **The second half of that list was missing, and so was the capacity question.** A resource can
arrive by taking an enemy settlement, and somewhere to put one can arrive by finishing a
Marketplace or a wonder. Neither produced a trigger: a Colossus finished while the pool was full
changed nothing until the next turn began, and a resource that had failed to place sat there
with room now waiting for it.

⚠️ **New room is a reason to run, but NOT in "the new resource only".** A Marketplace does not
hand the player a resource, so in that mode there is genuinely nothing new and what sits in the
pool is what the player left there. The other two modes are explicitly about the pool, so more
room is exactly their cue. A resource that arrived and could not be placed is covered either
way, because `known` is only advanced after a pass that placed something.

⚠️ **Every mode still waits for something to actually happen.** What the modes differ in is
**scope** — how much of the pool an arrival is a cue to tidy — not in *when* they run.

"Place everything unassigned" briefly meant "any time anything is in the pool", added while
chasing arrivals that were being missed. It was the wrong fix for the right complaint: those
arrivals were being lost to gaps in the event list, and those gaps are fixed. What the change
left behind was a mode that emptied the pool **on load and again every fifteen seconds** —
neither of which is a cue, because nothing happened — and which quietly overrode *"a player who
left something out did that on purpose"*, the one principle this module is built on.

### ⚠️ A trigger that cannot be acted on yet is HELD, not dropped

The Commerce screen being open, a button mid-run, or a pass already in flight all mean "not now".
All three used to `return` — and the trigger was gone for good, because **closing the screen
raises no engine event**. The next chance was the next acquisition or the next turn.

That is the likeliest single reason for "automatic assignment does nothing at all", and the
workflow that produces it is the ordinary one: the player is *in* the Commerce screen, empties the
empire, improves a tile, and the arrival lands while the screen is still up.

`retryWhenUnblocked` asks again every `BLOCKED_RETRY_MS` (1.5 s) until the way is clear. A real
trigger supersedes a pending retry, and **only the first wait is logged** — a player can sit in
the Commerce screen for a long time, and a line every second and a half would bury the log.

⚠️ `isAutoAssignPending()` counts a held retry too: a pass waiting for the screen to close is
still a pass that is coming, and the icon filter must not claim otherwise in the meantime.

Debounced at 400 ms — events arrive in bursts and one pass per burst is enough.

⚠️ **The trigger fires BEFORE the resource is in your hands.** `ConstructibleBuildCompleted`
announces that the improvement finished; the resource shows up in
`player.Resources.getResources()` a moment later. A single debounced look therefore finds
nothing new and, without retries, the pass would sit out until next turn — and a player who
improves a tile, sees nothing happen and reasonably concludes the option is broken.

Hence `LATE_ARRIVAL_DELAYS_MS = [600, 1500, 3000]`: a fixed handful of follow-ups, cancelled the
moment anything is found and cancelled again by the next real trigger.

⚠️ **Only a real trigger arms these.** A retry that armed more retries would never stop — three
become nine become twenty-seven, all turn long (`isRetry`).

### Other invariants

- Skipped entirely while `getCommerceModel()` is non-null — the player is looking at the screen
  and may be mid-drag.
- ⚠️ `known` is **not** updated when nothing new was found; it already equals `current`, and
  leaving it alone keeps the retries comparing against the same baseline.
- ⚠️ `known` is updated **only after a pass that actually placed something.** Updating it before
  the work meant a pass that placed nothing still *swallowed the arrival*: the next trigger saw
  no new resources and did nothing, so one badly timed event could cost the player the whole
  feature until their next acquisition.
- `startAutoAssign` calls `forgetPriorityMemory()` — a different game may have been loaded, and
  settlement keys are only unique within one game.
- `TRIGGER_GRACE_MS = 1500` exists for **event order**: the engine raises the notification and
  these events in the same burst and nothing promises which lands first, so "is a pass
  scheduled" can still be false at the moment the notification is offered. See
  [notifications](13-notifications.md).

---

## `priorities.js` — what each settlement should be fed first

```js
PRIORITY_OPTIONS                     // [{ type: null }, FOOD, PRODUCTION, HAPPINESS, CULTURE, SCIENCE, GOLD, DIPLOMACY]
priorityLabel(type)                  // 'Balanced' for null, else the yield's own translated name
getPriority(cityID)                  // what the PLAYER chose — null for Balanced
effectivePriority(cityID, isTown?)   // what the SCORING feeds first — never null
setPriority(cityID, yieldType)
cityKey(cityID)                      // String(cityID.id) — used as a map key everywhere
forgetPriorityMemory()
DEFAULT_CITY_PRIORITY = 'YIELD_PRODUCTION'
DEFAULT_TOWN_PRIORITY = 'YIELD_FOOD'
```

Every yield already has a translated name in the game's data, so **only "Balanced" needs a
string of ours** — one line of translation per language instead of eight.

### ⚠️ Two functions, because the picker and the scoring want different answers

`getPriority` returns **the player's own answer**, and `null` when they have not given one. The
picker needs that: it used to call one function that returned `YIELD_PRODUCTION` for a
settlement nobody had ever touched, so a fresh city showed "Production" — a choice the player
had not made, presented as one they had. It now shows Balanced, which is the truth.

`effectivePriority` is what the scoring asks, and it resolves Balanced to **production in a city
and food in a town**.

⚠️ **Balanced no longer means what Resource+ made it mean.** There, a settlement with no priority
took whichever yield it had **least** of, which pulled every such settlement towards the same
shapeless middle. City-production / town-food is a stance instead of an average, and it is the
one the rest of the scoring is built around. A **town takes food**, not production: it turns its
production into gold rather than building with it, so production would be steering it nowhere
while food is what a town grows on.

The in-memory map is the hot path; the persistent half is
[`priority-store.js`](11-options-and-persistence.md).

⚠️ `forgetPriorityMemory()` must be called when a game is loaded. Settlements are identified by
the numeric part of their `ComponentID`, so **the same key is a different city in a different
campaign** — carrying the map across a load would apply one game's choices to another's cities.

---

## Divergences from Resource+, in one list

1. **The happiness rescue tier** — entirely new, and the reason the file diverges at all.
   Switchable: never / cities only / all settlements.
2. **Factories first** — a Modern-age tier Resource+ has no equivalent of, and it packs by
   capacity rather than by stock alone.
3. **Conditional bonuses read from the data** instead of a hand-written per-age table that was
   inverted for six resources and missing 31 — and a conditional bonus has to be the resource's
   **best** branch, not merely a satisfied one.
4. **Modifier requirements honoured** — the "cities only" gate Resource+ ignored.
5. **Modifiers found by `ResourceType` argument**, not only by `ModifierMetadatas`.
6. **`givesUnitProductionBonus`** covers unqualified modifiers (Truffles, Salt).
7. **`scalesWithWarehouses`** read from the data, so Clay and Crabs are included.
8. **`yieldTypeFromIcon`** actually works, so yield totals are not all zero.
9. **The gathering tier** — a culture settlement and a gold settlement, built from whatever pays
   those yields. Requested for this mod; both piles switchable.
10. **`TOWN_PRODUCTION_PENALTY`** and the **production fallback tier**.
11. **"Balanced" means city-production / town-food**, not "whichever yield it has least of".
12. **Per-resource locks are NOT ported** — no lock UI here, so the lock set is always empty and
    "reassign" clears everything.
13. **The loop talks to the engine, not the model** — 30.7 s → a fraction of it.
14. **One implementation of "empty every settlement"**, shared by all three buttons and the
    automatic rebuild; it sends the game's own bulk `Clear` operation.
