# 05 — `ui/engine/` — talking to the game

No DOM, no knowledge of the screen's model. Everything that reaches the game's C++ side goes
through here — and everything the game raises comes back through here too.

| File | Purpose |
|---|---|
| `events.js` | **every** `engine.on` this mod makes, and the "is this even about me?" filter |
| `stored-setting.js` | **every** setting the player changes and the mod remembers |
| `operations.js` | **every** `ASSIGN_RESOURCE` request |
| `unassign.js` | releasing, and who has to leave with what |
| `resource-slots.js` | `BonusResourceSlots` (camels) |
| `merchant.js` | buying a merchant, walking it, signing the route |
| `merchant-orders.js` | the standing order a bought merchant carries, turn after turn |
| `resource-locks.js` | resources pinned in place; obeyed by `unassign.js`, cleared when one leaves |
| `treasure-convoys.js` | sends loaded Treasure Convoys home, unloads them, and announces it |
| `treasure-return-setting.js` | the switch that turns that off; **on** by default |
| `tooltip-setting.js` | the switch that hides every tooltip this mod draws; **off** by default |
| `diplomacy.js` | proposing "Improve Trade Relations" |
| `wait.js` | waiting for a queued operation to land |
| `age.js` | which age this is, worked out once |
| `shift.js` | is Shift held? |

---

## `events.js` — the single door to `engine.on`

⚠️ **The engine's events are not about you.** `UnitMoved`, `UnitMoveComplete`,
`UnitMovementPointsChanged`, `ResourceAssigned`, `ConstructibleChanged` and the rest are
raised for **every player in the game**. A late-game AI turn raises thousands of them, and
until 1.9 this mod woke on all of them — typically to walk the local player's whole unit list
and conclude that somebody else's scout had moved. It was the largest thing this mod ever
cost a frame.

The game's own components do not work that way. `panel-action.ts` opens `onUnitMoved` with

```js
if (data.unit.owner !== GameContext.localPlayerID) { return; }
```

and `panel-production-chooser.ts` asks the plot who owns it for `ConstructibleAddedToMap`.
This module is that check, written once.

```js
onEngineEvent(name, handler)              // → a handle, or null
onLocalPlayerEvent(name, handler)         // the same, everybody else's dropped first
onEngineEvents(names, handler, { localPlayerOnly = true })
stopEngineEvents(handles)                 // takes a whole list off again
isSomeoneElses(data)                      // for the one place that has to ask directly
logEventStats()                           // diagnostics only; see below
```

### One `engine.on` per event name, however many listeners

⚠️ **Six modules here want the same handful of names.** `LocalPlayerTurnBegin` has six
subscribers, `ResourceUnassigned` and `ResourceCapChanged` four each, `ResourceAssigned` and
`TradeRouteChanged` three, `UnitMoved` and `UnitMoveComplete` two. Every one of those used to be
its own `engine.on`: **53 subscriptions over 27 distinct names**, so one thing happening in the
game crossed into this mod's JavaScript up to six times, and the same payload was then asked "was
that mine?" up to six times over.

The subscription is now shared. The first listener for a name installs one dispatcher, the rest
join a list behind it, and the last to leave takes it off again. The owner is worked out **at most
once per event**, lazily — a name whose listeners are all unfiltered never asks, which matters
because for a payload carrying only a `location` that question is a map query.

⚠️ **The handle is the identity now, not the function.** `engine.off` never sees a listener's own
function at all, only the shared dispatcher, so a handle must be kept if the listener is ever to be
removed. A listener that throws is caught and logged; it cannot stop the ones behind it.

### Measuring it

`logEventStats()` prints, per event name, how many arrived since the last call and how many
milliseconds this mod spent hearing them — sorted by cost. It is **diagnostics only**: with
`DIAGNOSTICS` off nothing is counted and the entry point does not even install the turn-begin
listener that prints it.

⚠️ This is the **first** measurement to take when the report is "the game runs slowly with this mod
on". Everything this mod hears goes through one dispatcher, so one counter measures the whole mod,
and it answers the question reading the code cannot: which names actually arrive in their
thousands in *that* player's game.

⚠️ **An unknown owner is never filtered out.** Not every payload carries one, and dropping an
event because we could not name its owner would trade a performance problem for a correctness
one — the failure mode this mod's history is full of, where a missing trigger looks exactly
like a feature that does nothing. `CityTransfered` is the case that settles it: a settlement
changing hands is precisely when the owner on the payload is the ambiguous part.

⚠️ **`engine.off` needs the same function reference that was registered.** That is what the
handles carry, and it is why nothing should pass an inline arrow to `engine.on` and forget it.
Three separate leaks in 1.8 were exactly that mistake; see the changelog for 1.9.

Where the payload names an owner, by observation of the game's own sources:

| Field | Events |
|---|---|
| `unit` | every `Unit*` event |
| `constructible` | `ConstructibleBuildCompleted` |
| `cityID` / `city` | the city events |
| `player` | `ResourceAssigned`, `ResourceUnassigned` |
| `location` only | `ConstructibleAddedToMap` — the plot is asked instead |

---

## `stored-setting.js` — the single door to a remembered setting

Five modules had their own copy of "read an option, write an option, checkpoint it, raise a
change event": factories-first, imports-first, the two gathering switches, the happiness
dropdown and treasure auto-return. What each of them keeps is the part that is theirs — the
option name, the default, and what the value means. The plumbing is here.

```js
storedSwitch({ option, defaultValue, label, changedEventName })   // → { isOn(), set(value) }
storedChoice({ option, values, defaultValue, label, changedEventName, describe })  // → { get(), set(value) }
```

⚠️ **`UI.getOption` answers 0 for an option nobody has ever set**, which is indistinguishable
from an option deliberately set to 0. So nothing is stored raw: a switch stores 1 for off and
2 for on, and a choice stores its index plus one. 0 always and only means "never touched".
This has bitten the mod twice — once when factories-first changed its default from off to on,
and once for the happiness dropdown, whose first value ("Never") **is** 0.

⚠️ **`Configuration.getUser().saveCheckpoint()` is what makes it survive the game closing.**
Without it the option lasts the session, which reads to a player as a switch that does not
stick.

⚠️ **The option NAMES are the compatibility surface.** They are written out in full in each
caller, not derived, so grepping for one finds it. Changing one loses the player's setting.

---

## `operations.js` — the single door to `PlayerOperations`

Every one of these is the **same** player operation, `ASSIGN_RESOURCE`, told apart only by
its arguments:

| Intent | Arguments |
|---|---|
| assign | `{ Location, City }` |
| release one | `{ Location, City, Action: Deactivate }` |
| empty a settlement | `{ ResourceType: NO_RESOURCE, City, Action: Clear }` |

`Location` is `GameplayMap.getLocationFromIndex(resourceValue)`. This mirrors `assignResource`
and `unassignResource` in the game's `commerce-screen-model.ts`.

### Exports

```js
canAssign(cityID, resourceValue)            // → boolean
requestAssign(cityID, resourceValue)        // sends without re-checking
canUnassign(cityID, resourceValue)          // → boolean, guards null/undefined/-1
requestUnassign(cityID, resourceValue)      // sends without re-checking
unassignIfAllowed(cityID, resourceValue)    // check + send in one go
requestClearSettlement(cityID)              // one operation, not one per resource
assignRefusalReasons(cityID, resourceValue) // → localised strings; diagnostics only
```

⚠️ **Everything that talks to `PlayerOperations` belongs here.** This module already said so
and three other modules had grown their own copies anyway — the planner, the unassign sequence
and this file each had a `canAssign` differing only in argument order, which is exactly how
two of them come to disagree about what a refusal means.

`assignRefusalReasons` exists because `canStart` answers `{ Success, FailureReasons }` and the
reasons are localisation keys the game shows as tooltips elsewhere. The placement loop needs
only the yes/no; the reasons are what turns "nothing could be placed" into something a player
can act on. Used only by `explainWhyNothingFits` in `ui/planner/place.js`.

⚠️ `Game.PlayerOperations.canStart` is **the single most expensive call in this mod.** Anything
that asks it in a loop must cache (see `forgetEligibility` in `ui/planner/scoring.js`) or skip
settlements that cannot possibly accept anything (see `ui/screen/assign-notification.js`).

⚠️ `sendRequest` only **queues**. See `wait.js` below.

---

## `unassign.js` — releasing, with companions

Mirrors the game's own `unassignResource` exactly: `ASSIGN_RESOURCE` with
`Action = Deactivate`. Going through `PlayerOperations` rather than poking the model keeps the
engine the single source of truth, and the screen refreshes itself through the
`ResourceUnassigned` event it already listens for.

The model's own `unslotSelectedResource()` is deliberately **not** used: it works on whatever
is currently selected, so driving it would mean selecting each resource first — and for the
bulk case that pushes the selection signal through one change per resource.

### Why it is asynchronous

A resource that carries slots (a camel) cannot be removed in one pass: taking it out shrinks
the settlement's capacity, so its companions have to actually *land* first. The first attempt
fired everything at once and the result was exactly that — the companions went, the camel
stayed, and the next click charged two more companions for a removal that no longer needed
any.

So each step waits for the engine to confirm, and **the decision is made by asking `canStart`
rather than by arithmetic**: companions are pulled one at a time and only until the resource
the player actually clicked is accepted.

### Exports

```js
unassignOne(settlement, slottedResource)                // → Promise<number released>
unassignAllOfTypeInSettlement(settlement, resourceType) // → Promise<number released>
unassignEverySettlement()                               // → Promise<number released>
freeRoomForMove(sourceSettlement, slottedResource, targetCityID) // → Promise<boolean>
```

`freeRoomForMove` is the *drag* case: moving a camel out shrinks the old settlement's
capacity by two, so the engine refuses the move outright — which is why dragging a camel out
of a full settlement silently did nothing. Same treatment, one companion at a time, only for
as long as the engine keeps refusing. Called from `ui/screen/bulk-assign.js`.

---

## `resource-slots.js` — resources that carry their own slots

Camels grant two extra slots **in the database, not in code**:

```xml
<Row ResourceType="RESOURCE_CAMELS" ... BonusResourceSlots="2" .../>
```

`BonusResourceSlots` is a schema column defaulting to 0, so reading it covers every resource
that ever gains the property — including ones added by DLC or another mod. **Nothing here
mentions camels by name, on purpose.**

```js
bonusSlotsFor(resourceType)     // → number, 0 for most
grantsBonusSlots(resourceType)  // → boolean
companionCandidates(settlement, doomed)  // → array, best candidate first
```

`companionCandidates` is a **queue to draw from, not a list to remove**. The caller pulls one
at a time and stops the moment the engine accepts what it actually wanted to remove — that is
what keeps the settlement from losing more than the situation demands.

Order and safety:

- from the **end** of the settlement's list backwards — the most recently slotted resources
  go first, which is what the player expects to lose;
- resources that grant slots themselves are **never** candidates — removing one would shrink
  capacity again and turn this into a cascade;
- the queue is **capped at the number of slots actually going away**, so a misjudgement
  cannot strip the settlement.

---

## `merchant.js` — buying a merchant and sending it

```js
isMerchant(unit)                              // → boolean
tradeCapacityWith(leaderId)                   // → { capacity, used }
localMerchants()                              // → every merchant this player owns
merchantOffer(cityID)                         // → { definition, cost, canBuy, insufficientFunds }
purchaseSite(preferredCityID, targetCity)     // → { city, offer } — who actually buys
purchaseMerchant(cityID, definition)          // sends the purchase
purchaseAndCollectMerchant(cityID, definition)// → Promise<unit|null>
approachLocations(unit, city)                 // → plots to walk to, best first (probe-capped)
moveMerchant(unit, location)                  // MOVE_TO
canSignRoute(unit, location) / signRoute(…)   // MAKE_TRADE_ROUTE
goldBalance() / unitKey(unitID)
```

### ⚠️ `approachLocations` is probe-capped, and that cap is a turn-time fix

`Units.getPathTo` is a **full pathfinder query**. This function used to run one for *every plot
the target settlement owns* — a developed Exploration-age city owns thirty to fifty — and
`advance` then put every plot that came back through `moveMerchant`, which pathfinds again
inside `canStart`. **Eighty searches per merchant per attempt.**

⚠️ And the expensive case is the one that actually happens. A search that **succeeds** stops
when it reaches the target; a search that **fails** must exhaust everything the unit can reach
before it can say so. A merchant that cannot get there — unexplored ocean, a war in the way —
therefore paid the most expensive possible query, forty times over, three times a turn (the
attempt cap), for every merchant under an order. All synchronous, all at
`LocalPlayerTurnBegin`, where movement is handed back and the pass is woken.

That is tens of seconds on a big Exploration map, and CPU does not fix it: it is one thread
asking the engine for hundreds of failed A* searches.

`MAX_PATH_PROBES = 10` and `ENOUGH_REACHABLE = 3` bound it. Nearest-first is what makes the cap
safe rather than merely cheap — the plots are sorted by distance **from the unit**, so the ones
probed first are on the unit's own side of the settlement, which for the case this list exists
for (a ship approaching an inland capital) are exactly the coastal ones. When the cap bites,
the settlement centre is still handed back, the engine still refuses, and the attempt is still
counted — the behaviour is unchanged, only the bill is.

⚠️ Note that **`turnsUntilRouteOpens` is currently unused** and pathfinds too; if anything ever
calls it again, it needs the same treatment (or a per-card cache) before it goes on a tab that
draws twenty of them.

The three engine calls are the game's own, taken from where the game makes them:

| Step | Call | Taken from |
|---|---|---|
| buy | `CityCommandTypes.PURCHASE`, `{ UnitType: hash }` | `Construct()` in `production-chooser-helpers.js` |
| walk | `UnitOperationTypes.MOVE_TO` | the plain operation |
| sign | `UnitCommandTypes.MAKE_TRADE_ROUTE`, `{ X, Y }` | `checkAndStartTradeRoute()` in `trade-route-chooser.js` |

⚠️ **`WorldInput.requestMoveOperation` is deliberately not used**, although the game's own
"send merchant" button uses it. It is the right-click handler: it probes for an attack first
and can open a **declare-war confirmation**, which must never come out of a button labelled
"buy a merchant". Holistic QoL+ avoids it for the same reason and says so in a comment.

⚠️ **A merchant is `MakeTradeRoute` on the unit definition, never the type name.** Six civs
field their own — Vaishya, Watonathi, Mandarin, Tajiro, Hangshang — and matching
`UNIT_MERCHANT` would leave those civs with a button that never worked.

⚠️ **The argument to `MAKE_TRADE_ROUTE` is the target settlement's own plot**, never the plot
the merchant stands on. The command asks "open a route with the settlement at X,Y".

⚠️ **The new unit is found by diffing the merchant list, not by listening for
`UnitAddedToMap`.** The game's own unit-flag manager documents why it avoids that event:
"event race condition in looking up a valid Unit" — it can arrive before the unit can be read
back. `purchaseAndCollectMerchant` waits for `CityMadePurchase` and then polls for up to 30
frames.

What a merchant costs is asked through `canStartQuery` — the same call the production chooser
makes — because it answers for every unit type at once and its `result` carries the reason for
a refusal, which is what the tooltip needs when the button is dark.

---

## `merchant-orders.js` — "go there and open the route"

```js
orderMerchantTo(unit, city)      // file the order and act on it now
clearMerchantOrder(unitID)
merchantsBoundFor(city)          // the live merchants walking there
merchantsBoundForPlayer(leader)  // …and to any settlement of one leader
startMerchantOrders()            // installs the listeners; called from the entry point
MerchantOrdersChangedEventName   // window event: an order was given, finished or dropped
```

A purchase is one click, the journey is several turns, and the route can only be signed once
the merchant is close enough. The shape is the one **Holistic QoL+** arrived at for the same
problem (its "merchant route continuation" patch):

1. An order is `(merchant, target settlement)` and is **stored**, so it outlives the Commerce
   screen being closed.
2. Every pass **tries to sign first** and only walks when signing is refused. No distance is
   computed anywhere — `canStart` is the only thing that knows how far is close enough, and
   the rules differ between ages and between land and sea.
3. The order is dropped the moment the route is signed or the settlement is gone.

⚠️ **THE ATTEMPT CAP IS NOT TIDINESS — WITHOUT IT THE GAME FREEZES.** The engine answers a
move request it cannot honour by firing `UnitOperationsCleared` / `UnitOperationDeactivated`,
which is exactly what this module listens for. A merchant that cannot reach its target
re-requests, is refused, is woken by its own refusal, and the cascade never ends. Three tries
per unit per turn; a deliberate click resets the budget. Holistic QoL+ documents the same
freeze.

⚠️ **Most passes are sign-only.** `UnitMoved`, `UnitMoveComplete`, `UnitOperationsCleared`,
`UnitOperationDeactivated` and `UnitRemovedFromMap` may only *try to sign the route*. Movement
is re-issued from `LocalPlayerTurnBegin` and from the click that gave the order, and nowhere
else. A pass that re-issued movement on every `UnitMoveComplete` would drag the merchant back
onto its errand the instant the player moved it anywhere else — and it is also the pass that
feeds the refusal cascade above.

⚠️ The processing pass is **debounced** (160 ms) and carries a re-entrancy guard: every event
it listens for can arrive several times for one move, and each pass talks to the engine about
every merchant. Two passes that fall in the same window merge, and the one that may move wins.

⚠️ The listeners are wrapped in an arrow rather than handed `scheduleProcess` directly: the
engine passes the event payload to the listener, and a payload object is truthy — passing the
function straight in made **every** event a moving one.

Storage is `UI.setOption("user", "Mod", …)` with a **number** — the target's plot index plus
one, so that zero can mean "no order" — keyed per game seed, exactly as
[`ui/planner/priority-store.js`](07-planner-assignment.md) does it. Nothing is written into
the save; the mod still declares `AffectsSavedGames = 0`.

### Merchants that never arrive

A merchant lost at sea, killed by a raider or disbanded takes **nothing** with it: the order is
a number in the user options and the engine does not know it is there. Every processing pass
therefore prunes the stored orders against the live merchant list, and announces the change.

⚠️ `UI.getOption` **cannot be enumerated** — it answers about a name you already know. So the
module keeps a set of the unit keys that have an order, seeded from the `localStorage` mirror
(the only channel that can be read back whole). Without that set, a drowned merchant's order
can never be found again to be cleared, and **unit ids are recycled**: the next merchant born
with that id would silently inherit a dead one's errand.

⚠️ Pruning is **skipped entirely** when the merchant list could not be read. An empty list
means "they are all gone"; a failed call means nothing at all. `readMerchants()` returns
`null` for the second case precisely so the two cannot be confused — treating them the same
wipes the orders of merchants that are alive and walking.

⚠️ `merchantsBoundFor` counts **live merchants**, not stored orders, so a card is right about
who is on the road even in the window before the next pruning pass.

⚠️ `merchantsBoundForPlayer` is what stops the mod selling the same trade slot twice. Capacity
is counted **per leader**, not per settlement: with one slot free and a merchant already on its
way to one of Amina's cities, a second merchant sent to a different city of hers arrives to a
slot that is spoken for. No card can know that from its own status — the projection behind it
was made before the first merchant left.

⚠️ The target is stored as a **plot**, not as a `ComponentID`. A settlement that changes hands
keeps its plot and gets a new id, so the order still means what the player meant by it — "that
place" — and the route command is refused on its own terms if the new owner cannot be traded
with.

---

## `diplomacy.js` — proposing "Improve Trade Relations"

```js
tradeRelationsOffer(leaderId)   // → { project, args, cost, canStart, reasons } | null
influenceBalance()              // → number
proposeTradeRelations(leaderId, offer)   // → boolean, sent or not — not accepted or not
```

The treaty that, if the other leader accepts, raises the Trade Route limit with them by one —
what the gold-plus-Influence button on a limit-blocked trade route card proposes before buying
a Merchant regardless. See [screen: tabs](10-screen-tabs.md) for the button itself.

⚠️ **Proposing it is not the same as it taking effect.** `DIPLOMACY_ACTION_IMPROVE_TRADE_RELATIONS`
is `Opposed="true"` in the game's own data (`base-standard/data/diplomacy-actions.xml`) — the
other leader can refuse it, same as any treaty. `canStart` only answers "may I ask", never
"will they say yes", and a request that goes through spends the Influence regardless of the
answer (`RejectionRefundsInfluence="true"` gives it back on a refusal, but only once the
refusal actually happens).

⚠️ **`BaseDuration="0"` in the data, and it is not read from anywhere here on purpose.** This
mod does not know how many turns a reply takes and does not claim to. What it sends
afterwards — a merchant, via `merchant-orders.js` — already retries opening the route every
turn on its own, which is the right way to wait on an uncertain outcome: do the one thing that
is certain (send the merchant), and let the part that depends on someone else's answer resolve
in its own time. `trade-buy-merchant.js`'s `improveAndSend` therefore never waits on the
proposal before buying — the two are independent operations and neither needs the other to
have resolved.

⚠️ **Asked through `Game.Diplomacy.getProjectDataForUI`**, the exact call the diplomacy hub's
own `DiplomacyManager.queryAvailableProjectData` makes to build its list — not reconstructed
from `GameInfo.DiplomacyActions`. Every rule the game enforces (cost rising after each
successful use, a cooldown after a refusal, needing to have met them, not at war) already
comes back through `canStart`'s `Success` / `FailureReasons`; none of it is re-derived here,
matching `assignRefusalReasons` in `operations.js`.

⚠️ **`sendRequest` QUEUES the request; it does not perform it.** For the frame or two before
the game core plays the operation back, `canStart` still answers "yes, you may propose" — it
is describing a game state the request has not reached yet. So `proposeTradeRelations` records
the leader in `proposedThisTurn`, and `tradeRelationsOffer` forces `canStart: false` for
anyone in that set, with the engine's own `LOC_DIPLOMACY_ACTION_FAILURE_DUPLICATE_PROJECT` as
the reason (through the same `REASON_OVERRIDES` table, so the player never sees two different
sentences for one situation). This is **not** second-guessing the rules — `BaseDuration="0"`
means the action resolves at the end of the turn it was proposed in, so "proposed this turn"
*is* the engine's own answer, said a few frames earlier. Without it, the redraw a click
triggers faithfully restored the button bright and priced on an action that could no longer be
taken. Cleared on `LocalPlayerTurnBegin`: a refusal frees the action again, and the turn
boundary is where that happens whichever way it went. The engine's real answers arrive with
`GameCoreEventPlaybackComplete`; see [screen: tabs](10-screen-tabs.md).

⚠️ Influence cost is read from `project.targetList1.find(entry => entry.targetID === leaderId)`
— matched against the `leaderId` THIS call asked about, not against `DiplomacyManager
.selectedPlayerID` the way the diplomacy hub's own `getCostFromTargetList` does. That helper's
match only holds while the hub is open with that leader selected, a precondition this mod does
not have — it is never called from the hub.

---

## `wait.js` — waiting for a queued operation

```js
waitForEngineEvent(eventName, timeoutFrames = 30)   // → Promise<void>
```

Listens with `engine.on`, and races it against a `requestAnimationFrame` counter.

⚠️ **The timeout matters as much as the event.** An operation the engine drops would otherwise
leave the sequence hanging forever.

Used for `ResourceUnassigned` and `ResourceAssigned`. ⚠️ Note that `ResourceAssigned` fires
for *every* player — see [Platform notes](03-platform-notes.md) and `ui/planner/place.js`,
which for that reason polls the settlement directly instead.

---

## `age.js` — which age this is

```js
isFactoryAge()       // AGE_MODERN — cached
isExplorationAge()   // AGE_EXPLORATION — not cached, called rarely
```

⚠️ `Database.makeHash` is a **lookup, not a constant**, so `isFactoryAge` works the answer out
once and keeps it: the planner asks this for every resource–settlement pair it scores, which
is hundreds of thousands of hashes over one "Assign All". The age cannot change while the
game is running, so caching is safe by construction.

It lives in `engine/` rather than beside the Factory tab that first needed it because three
modules across two layers ask the question, and the planner asking a *screen* module meant the
assignment engine could not be loaded without the UI behind it.

---

## `shift.js` — is Shift held?

```js
isShiftHeld()   // → boolean
```

`Input.isShiftDown()` asks the engine directly and works in every input context — the game's
own tooltip manager uses it the same way to shorten the tooltip delay.

⚠️ The first attempt tracked DOM `keydown`/`keyup` instead and **never once reported Shift as
held**: this UI does not deliver the engine's modifier state through DOM keyboard events. The
DOM listeners survive only as a fallback in case `Input.isShiftDown` is missing from some
build; they cost nothing when unused. A `blur` listener clears the fallback state, because a
key released while the window is unfocused never delivers its `keyup`.

The source actually in use is logged once, the first time it is asked.

Note that `event.shiftKey` on a **native DOM mouse event** is reliable and is used directly in
`ui/screen/shift-click.js` and `ui/screen/resources-tab.js` (`event.shiftKey || isShiftHeld()`).
It is only *keyboard* events that carry nothing.
