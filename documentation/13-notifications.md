# 13 — `ui/screen/assign-notification.js` — the end-turn nag

411 lines for one behaviour, and the file is dense with dead ends. Read this before touching it.

## What it does

The game raises `NOTIFICATION_ASSIGN_NEW_RESOURCES` when a resource **reaches the player's pool**,
or when a **settlement gains a slot**. Its row in `notification.xml`:

```xml
SeverityType="HIGH"  ExpiresEndOfTurn="False"  AutoNotify="True"  Priority="1"
```

So once raised it **holds the turn button until it is acted on** — including when there is
nothing that could be done about it.

⚠️ **The two triggers are observed in play, not read from the data.** The row carries the
severity and the expiry; what *raises* it is engine-side and appears nowhere in
`notification.xml`. An earlier version of this page asserted the condition was simply "you have
unassigned resources" — an inference, and wrong. It had already been copied into a player-facing
tooltip before anyone checked it, which is the reason this warning is here.

Measured in game: **140 resources in the pool, 0 of 18 settlements with a free slot.** The
notification is factually right and completely useless, and the game still promotes it to the main
button once every other action is done.

With this module, the icon is not drawn while **nothing you hold could legally be placed
anywhere**. It comes back the moment that changes.

## ⚠️ Two conditions, either of which turns the whole thing off

`suppressionEnabled()` is checked by both wrapped methods and by the filter:

1. **The player's own switch** — *Skip the assignment prompt when nothing fits*, on by default.
   Hiding a prompt the game raised is the most intrusive thing in this file, so it is worth being
   able to say no to outright.
2. **Automatic assignment must be on.** The justification for hiding this notification is that
   **the mod has already assigned the resources** — sending the player to a screen where the work
   is done is the nag, not the notification itself. With automatic assignment Off the mod assigns
   nothing on its own, so the notification is telling the player something true and actionable and
   taking it away removes a prompt they still need.

With either one off the game behaves exactly as it does without this mod — nothing is wrapped
away, the icon is drawn, and the turn button blocks as the engine intends.

⚠️ An options change raises **no engine event**, so `CommerceOptionsChangedEventName` is listened
for alongside the board events. Without it, switching the setting would not visibly change
anything until something else happened to refresh the panel.

⚠️ **Nothing is dismissed, cancelled or acknowledged, and turn blocking is untouched.** That is
decided by the engine, not by whether an icon is drawn. This only declines to draw it, which keeps
the mod's promise that no game state is changed.

⚠️ The turn genuinely ends: `canEndTurn` is a **UI method reading a UI-facing query**, and ending
the turn is `GameContext.sendTurnComplete()`. The hold was the panel's, not the engine's.

## ⚠️ Two places draw it, and they do not share a source

**This is the whole reason the first attempt did nothing visible.**

| | Reads | Takes |
|---|---|---|
| the notification **train** (`panel-notification-train`) | `NotificationModel` | only notifications that do **not** block turn advancement (`isSoftNotification`) |
| the **icon** in the ring around the end-turn button (`panel-action`) | `Game.Notifications.getIdsForPlayer` **directly** | only the ones that **do** block |

This notification blocks, so it is drawn by the second and ignored by the first. Suppressing it in
the model — which is what a notification handler can do — therefore removed it from a list it was
never in.

The way to the icon the player actually sees is `panel-action`'s own `getNotificationInfo`: the
list is built by mapping every id through it and dropping the nulls, so **returning null hides its
icon** and costs nothing else — slot logic, animations and turn-blocking machinery all carry on.

⚠️ `panel-action` is an **old-framework** component (`Controls.define`), so unlike the `ui-next`
screens its class *is* exported and its prototype can be wrapped. See
[Platform notes](03-platform-notes.md).

## ⚠️ The test is not "are there free slots"

That was the first version and it almost never fired: **one spare slot in one town anywhere in the
empire was enough to bring the nag back, and there usually is one.**

What matters is whether any `(resource, settlement)` pair would actually be **accepted** — a
settlement can have room and still refuse everything you are holding, which is exactly when the
notification is at its most useless.

⚠️ It is also **not** "nothing can be done". The player can always open the screen and rearrange
what is already assigned, swapping one resource for another. The test is therefore whether any
**unassigned** resource can go anywhere — the case where rearranging would be for its own sake.
Saying "you cannot act on this" would be untrue.

### ⚠️ `canAssign` is not the whole rule: factory resources

**A factory resource needs a settlement with a factory, and the engine does not say so.**
`canAssign` accepts the pair; the resource then sits in a settlement that cannot run it. So the
icon kept being offered for a haul of factory resources while every settlement with a free slot
lacked a factory — "you can act on this", for an action worth nothing.

The check therefore skips those pairs before asking. It uses `settlementHasFactory` from
[`headless-model.js`](06-model.md) — **the planner's own function**, deliberately: two definitions
of "has a factory" is how the screen and the engine come to disagree, and that file exists to stop
exactly that.

⚠️ The neighbouring rule needs no such help: a **City** resource cannot go into a Town, and
`canAssign` **does** refuse that one. Only the factory rule leaks.

### `computeAnythingCanBePlaced()`

```
1. walk the settlements: collect assigned values, and those with a free slot
2. unassigned = the player's resources minus assigned    ← no accessor exists
3. ⚠️ if any unassigned resource grants bonus slots → true, regardless of free slots
4. if no settlement has room → false
5. otherwise ask canAssign for pairs until one is accepted
```

⚠️ **A camel is always placeable, full empire or not.** It carries two slots of its own, so it can
be put into a settlement that has no room by *making* room — which is what this mod's camel
handling does. Counting free slots alone would hide the icon while the one resource that could fix
the shortage sat in the pool. Asked of the data (`BonusResourceSlots`), not of a resource name.

⚠️ **Settlements with no free slot are skipped entirely rather than asked.** `canAssign` goes
through `Game.PlayerOperations.canStart`, the single most expensive call in this mod, and a full
settlement cannot take anything. Settlements with room are tried first and the search stops at the
first acceptance, so the normal case costs one call. The expensive case is the one where the answer
is "no" — which is also the case where the notification is about to be hidden for the rest of the
turn.

⚠️ It is a **pure question about the board, with no view on timing.** It used to answer "yes" while
a pass was pending, which is a display *policy* rather than a fact — and that leaked: the dismissal
path asks the same question and was told "yes, something can be placed" during the grace window, so
it never dismissed anything. The timing policy now lives only in the icon filter.

On any error it returns `true`. **Hiding a notification the player should have seen is the worse of
the two failures.**

Answers are cached for `ANSWER_CACHE_MS = 3000`, and **what actually invalidates them is
`forgetPlaceability()`**, wired to every event that can change the answer (`BOARD_EVENTS` below).

⚠️ The timer is the **backstop, not the invalidation**. At 250 ms it was doing the invalidating
instead: the most expensive call in this mod ran four times a second for the whole game while the
board sat still, because the action panel refreshes far more often than that.

Two cheap refusals come before the engine is asked at all, and both are answers the *data* already
carries:

- a **factory** resource cannot work in a settlement without a factory;
- a **City** resource cannot go into a Town at all
  (`LOC_PEDIA_CONCEPTS_CITY_RESOURCES_TOOLTIP`), which is also why `place.js` explains that case
  by hand — the engine's refusal for it carries no reason.

Both skips remove whole rows of `canStart` calls from the expensive "no" case.

## The two wrapped methods

⚠️ **Two, because the panel asks the same question twice for two different purposes.** Wrapping only
the first produced a button reading **"End Turn" that opened the Commerce screen when clicked**:

| Method | Decides |
|---|---|
| `refreshActionButton` | what the button **looks like** |
| `tryEndTurn` | what pressing it **does** — `canEndTurn` re-reads the blocker and, on finding one, calls `activateBlockingNotification` instead of ending the turn |

Both go through `blockingPointlessly(playerID)`: is this notification the thing blocking the end of
the turn, **and** is there nothing to be done?

### `withoutOurBlocker(body)`

Rather than reproduce what the panel does when nothing blocks, **the game is asked the question
differently**: `Game.Notifications.getEndTurnBlockingType` is substituted for the duration of one
call, so the untouched original takes its own no-blocker path.

- The substitution is **verified** — if the engine object refuses it, the original runs normally
  rather than half-changing something.
- Restored in `finally`, so nothing outside that one call ever sees the substitute.

## The re-check loop, and the flicker

⚠️ `panel-action` does **not** listen for resource events — its own refresh is driven by
notification and unit events. Without a nudge the icon would keep whatever it decided last, which
after an automatic pass is always "show", since that is what the filter answers mid-pass.

The events are split in two, and the split is a performance fix as much as a tidy-up:

- **`BOARD_EVENTS`** — `ResourceAssigned`, `ResourceUnassigned`, `ResourceCapChanged`,
  `CityTransfered`, `CityAddedToMap`. These can change the *answer*, so they throw the cached one
  away (`forgetPlaceability`) **and** ask for a re-check. The two city events are there because
  taking or losing a settlement changes which settlements have room, and raises none of the
  resource events.
- **`RECHECK_ONLY_EVENTS`** — `NotificationAdded` (the notification is raised *after* the resource
  lands, so without it the first chance to hide would be whatever happened next). It changes only
  *whether to ask*, never the answer, so it must **not** forget it.

⚠️ `NotificationAdded` used to sit in the first list, and that is what made the answer cache almost
worthless. It fires constantly, and every one of them threw away an answer that
`anythingCanBePlaced` — the most expensive call in this mod — then had to work out again from
scratch: in the worst case one `canStart` per unassigned resource per settlement with room, several
times a second, for the whole game.

Both debounced at 400 ms.

Two guards, both against loops:

⚠️ **`refreshing`** — the refresh calls the filter, and anything the filter asks for here would
schedule the next refresh: `refresh → filter → re-check → refresh`, every few hundred ms,
re-running the panel's slot animations each time. **That was the flicker.** The resource events
drive it instead, and the filter deliberately does **not** request a re-check.

⚠️ **`isAutoAssignRunning()`, not `isAutoAssignPending()`** in `scheduleRecheck`. The grace window
that makes the filter hide *early* would make this wait for it to expire every time, adding a
second of delay to an icon that should already be back.

## The filter itself

```js
PanelAction.prototype.getNotificationInfo = function (id) {
    const info = original.call(this, id);
    if (info?.type !== hiddenType) return info;
    if (isAutoAssignPending() || isAssignmentInProgress()) return null;   // hide, provisionally
    return anythingCanBePlaced() ? info : null;
};
```

A pass running or on its way → **hide**, rather than draw something that is wrong a second later.
Never the last word: the re-check asks again once nothing is being placed.

⚠️ The `blocking` probe logged alongside is a **probe, not logic**. `panel-action` draws this
notification twice over: as a slot icon (which this filter controls) and, when it is what blocks
the end of the turn, on the main action button — and *that* one is fetched straight from
`findEndTurnBlocking`, **never through here.** Knowing which of the two you are looking at is the
difference between hiding a nag and hiding the reason the turn will not end.

⚠️ If `getNotificationInfo` is missing, the module warns **loudly** rather than failing quietly: a
feature that silently does nothing is the hardest failure to notice.

## ⚠️ Recorded dead end — do not try dismissing it

`Game.Notifications.dismiss(id)` runs and is accepted — the log showed "dismissed 1" — **but the
notification is back within the second.** Its row in `notification.xml` carries `AutoNotify="True"`,
so the engine re-raises it for as long as the condition holds, and the condition is "you have
unassigned resources". **It cannot be cleared from the UI while those resources exist.**

## Interaction with auto-assign

`ui/planner/auto-assign.js` exports `isAutoAssignPending()` specifically for this filter. Its 1.5 s
grace window (`TRIGGER_GRACE_MS`) exists because of **event order**: the engine raises the
notification and the events the watcher listens for in the same burst, and nothing promises which
lands first — so "is a pass scheduled" can still be false at the moment the notification is
offered. Treating a trigger from the last moment as pending closes that window; the penalty for
being wrong is one late re-check, which happens anyway.

That is why this module can hide the icon **before** it is ever drawn rather than a second
afterwards: if a pass is coming, whatever is unassigned right now says nothing about what will be
unassigned when it finishes.
