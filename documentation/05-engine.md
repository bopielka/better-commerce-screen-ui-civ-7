# 05 — `ui/engine/` — talking to the game

Six files. No DOM, no knowledge of the screen's model. Everything that reaches the game's
C++ side goes through here.

| File | Lines | Purpose |
|---|---|---|
| `operations.js` | 132 | **every** `ASSIGN_RESOURCE` request |
| `unassign.js` | 139 | releasing, and who has to leave with what |
| `resource-slots.js` | 80 | `BonusResourceSlots` (camels) |
| `wait.js` | 51 | waiting for a queued operation to land |
| `age.js` | 32 | which age this is, worked out once |
| `shift.js` | 52 | is Shift held? |

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
unassignOne(settlement, slottedResource)               // → Promise<number released>
unassignAllOfTypeInSettlement(settlement, resourceType) // → Promise<number released>
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
