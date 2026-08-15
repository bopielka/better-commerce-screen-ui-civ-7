# 07 — `ui/planner/` — the assignment engine

Deciding what goes where, and doing it. Seven of the eleven files in `ui/planner/`; the other
four are covered in [planner: valuation](08-planner-valuation.md).

| File | Lines | Purpose |
|---|---|---|
| `effects.js` | 259 | reading the modifier tables |
| `facts.js` | 262 | what a resource **is** and **does** |
| `scoring.js` | 729 | the tiers and `bestAssignment` |
| `place.js` | 283 | the placement loop, shared by both paths |
| `run.js` | 119 | what the buttons do — framing around `place.js` |
| `auto-assign.js` | 326 | placing new resources with the screen closed |
| `priorities.js` | 82 | per-settlement priority, in memory |

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

### `scalesWithWarehouses`

`EFFECT_CITY_ADJUST_CONSTRUCTIBLE_YIELD_PER_RESOURCE` modifiers carrying `Tag = WAREHOUSE`.
⚠️ Resource+ named a single resource here — turtles — and so missed Clay (production) and Crabs
(food), which scale exactly the same way.

### `conditionalBoostStrength(resource, settlement)`

0 means the resource brings nothing here it would not bring anywhere; higher means this
settlement meets a condition the resource rewards, and bigger is a better fit.

- Warehouse-scaling resources return the **warehouse count**, which both measures the fit and
  steers them where the warehouses are.
- Otherwise 1 if any conditional modifier of the resource applies here.

⚠️ Resource+ answered this from a hand-written table of resource names per age, **and the table
disagreed with the data**: it returned "conditions met" for gypsum, kaolin and pearls when a
settlement was **not** the capital, while the game gates those on
`REQUIREMENT_CITY_IS_CAPITAL` — the opposite. The same inversion ran through the distant-lands
entries for spices, sugar, tea and cocoa, and **31 conditional resources were missing from the
table altogether.** So the question is put to the data instead.

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
| `SPECIALIZED_CONDITIONAL_SCORE_BASE` | 850 000 000 | serves the settlement's priority **and** a conditional bonus applies |
| `SPECIALIZED_SCORE_BASE` | 700 000 000 | serves the settlement's priority |
| `HOARD_SCORE_BASE` | 600 000 000 | gathering turtles/silk/jade — compared against, never chained |
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
| `FACTORY_STOCK_WEIGHT` | 10 000 000 | per spare copy when choosing what to start an empty factory on |
| `FACTORY_STOCK_CAP` | 40 | past this more copies stop mattering; keeps the tier under the rescue |
| `HOARD_CULTURE_FIRST` | 10 000 000 | culture pile is settled before the gold pile |

### The happiness rescue — `rescueScore`

Above everything, including camels. **No settlement should sit on negative happiness.**

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

### Gathering — `hoardScore`

Turtles and silk into whichever city makes the most **culture** on its own; jade into a
different city for **gold**, so the two piles do not compete for the same slots.

- Below the priority tier: a settlement takes what it was told to prioritise first.
- Above the conditional tier: gathering beats the generic "this bonus applies here" rule —
  including, deliberately, the warehouse rule that would otherwise scatter turtles.
- ⚠️ Compared against the ordinary score with `Math.max`, **not chained**, so it never
  overrides a settlement's own priority.
- The settlement's own yield is part of the score rather than a hard target, so if the intended
  city fills up, the next best by the same measure takes over **without any special case**.
- ⚠️ Unlike everything else in this file, `HOARD_TARGETS` is **resource names**, because that is
  what was asked for: a judgement about three specific resources, not a property of the data.

`bareYield` is the settlement's yield minus the estimated contribution of what is slotted now
— *not* the model's `baseYields`, which is a snapshot taken when the screen opened and still
includes whatever was assigned at the time.

### `scorePair` — ordering within a tier

```js
priorityBonus            // 100000 serving the priority, 0 not, 10000 if no priority set
+ distributionScore      // -specializedLoad*100 if serving, else -weakestAffectedYield
+ productionFallback     // positive production boost * 1000, when the priority cannot be served
+ actualBoost * 10
+ (isTown ? 0.25 : 0)
+ openSlots * 0.001
```

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

## `run.js` — what the buttons do

```js
assignAll(model)                     // → Promise<boolean> (false if already running)
reassignAll(model)                   // clear everything, then place
quickAssignSettlement(model, cityID) // one settlement only
isAssignmentInProgress()             // read by the buttons and by assign-notification.js
```

`runExclusively` guards every entry point: **only one of these loops may run at a time**, and
none may start while `model.isSlottingAvailable` is false. It deselects first and always clears
the flag in `finally`.

`unassignEverything` prefers **one `Clear` per settlement** over one `Deactivate` per resource;
the per-resource path is the fallback for when the engine refuses the bulk form. It reads the
board from `buildSettlements()`, not from the screen, for the same reason as `place.js`.

`logHappinessState` prints the deficits the rescue tier is looking at, before and after, so a
wrong reading shows up in the log rather than as a mysterious layout.

---

## `auto-assign.js` — with the screen closed

```js
startAutoAssign()        // called once from the entry point
isAutoAssignRunning()    // a pass is in flight
isAutoAssignPending()    // in flight, scheduled, or a trigger arrived < 1.5 s ago
```

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
hands) and `ResourceAssigned`. So several cheap events are watched and the question — has the
set grown? — is asked on each:

```
ConstructibleBuildCompleted   a tile improved onto a resource
TradeRouteAddedToMap          a new route brings its payload
TradeRouteChanged
ResourceCapChanged
LocalPlayerTurnBegin          catch-all / safety net
```

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
PRIORITY_OPTIONS       // [{ type: null }, FOOD, PRODUCTION, HAPPINESS, CULTURE, SCIENCE, GOLD, DIPLOMACY]
priorityLabel(type)    // 'Balanced' for null, else the yield's own translated name
getPriority(cityID)
setPriority(cityID, yieldType)
cityKey(cityID)        // String(cityID.id) — used as a map key everywhere
forgetPriorityMemory()
DEFAULT_CITY_PRIORITY = 'YIELD_PRODUCTION'
DEFAULT_TOWN_PRIORITY = 'YIELD_FOOD'
```

Every yield already has a translated name in the game's data, so **only "Balanced" needs a
string of ours** — one line of translation per language instead of eight.

A **town defaults to food**, not production: it turns its production into gold rather than
building with it, so production would be steering it nowhere while food is what a town grows
on.

The in-memory map is the hot path; the persistent half is
[`priority-store.js`](11-options-and-persistence.md).

⚠️ `forgetPriorityMemory()` must be called when a game is loaded. Settlements are identified by
the numeric part of their `ComponentID`, so **the same key is a different city in a different
campaign** — carrying the map across a load would apply one game's choices to another's cities.

---

## Divergences from Resource+, in one list

1. **The happiness rescue tier** — entirely new, and the reason the file diverges at all.
2. **Factories first** — a Modern-age tier Resource+ has no equivalent of.
3. **Conditional bonuses read from the data** instead of a hand-written per-age table that was
   inverted for six resources and missing 31.
4. **Modifier requirements honoured** — the "cities only" gate Resource+ ignored.
5. **Modifiers found by `ResourceType` argument**, not only by `ModifierMetadatas`.
6. **`givesUnitProductionBonus`** covers unqualified modifiers (Truffles, Salt).
7. **`scalesWithWarehouses`** read from the data, so Clay and Crabs are included.
8. **`yieldTypeFromIcon`** actually works, so yield totals are not all zero.
9. **The gathering tier** (turtles/silk/jade) — requested for this mod.
10. **`TOWN_PRODUCTION_PENALTY`** and the **production fallback tier**.
11. **Per-resource locks are NOT ported** — no lock UI here, so the lock set is always empty and
    "reassign" clears everything.
12. **The loop talks to the engine, not the model** — 30.7 s → a fraction of it.
