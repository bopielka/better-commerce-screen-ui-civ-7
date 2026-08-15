# 09 — `ui/screen/` — interaction, buttons and chrome

The mouse handling, the injected controls and the layout tweaks. The tabs themselves are in
[screen: tabs](10-screen-tabs.md); the notification filter is in
[notifications](13-notifications.md).

Read [Platform notes](03-platform-notes.md) first — every file here depends on the input and
DOM facts recorded there.

| File | Lines | Purpose |
|---|---|---|
| `resources-tab.js` | 226 | the component wrapper; right-click unassign; **the hub** |
| `settlement-controls.js` | 453 | per-card priority picker, quick assign, unassign |
| `assign-all-buttons.js` | 241 | Assign All / Reassign All / Unassign All / "?" |
| `tab-icons.js` | 244 | icons instead of words on the tab strip |
| `hover-highlight.js` | 167 | Shift + hover preview |
| `bulk-assign.js` | 170 | Shift-assign, by wrapping `slotSelectedResource` |
| `layout.js` | 164 | tab strip, description line, dropdown height |
| `shift-click.js` | 120 | left-clicking at all while Shift is held |
| `factory-first.js` | 107 | the "factories first" checkbox |
| `help-mark.js` | 50 | the shared round "?" |

---

## `resources-tab.js` — the hub

Wraps `CommerceResourcesContainer` at `existing + 100`. That component is the right host: it
**is** the Resources tab, so it is mounted exactly when right-click should do something, and
being inside the screen's context provider it can reach the model.

Its `onMount` / `onCleanup` start and stop nearly everything else in this document — see
[Architecture → Lifecycles](02-architecture.md#lifecycles--who-starts-and-stops-what).

### Right-click unassign

| Event | Phase | What it does |
|---|---|---|
| `mousedown` (button 2) | capture, `window` | if it lands on a resource, **swallow it** so the screen's own handlers cannot start selecting or dragging — that is what made Shift + right-click look like it was "selecting" the resource |
| `mouseup` (button 2) | capture, `window` | the work: `unassignOne` or `unassignAllOfTypeInSettlement` |
| `InputEngineEventName` | capture, `window` | **suppression only** — a plain right-click is `isCancelInput()` and the panel would close the whole screen |

The engine action arrives *after* the DOM mouseup that did the work, so anything within
`SAME_CLICK_WINDOW_MS = 400` belongs to the same physical click. If the click did **not** land on
a resource, nothing is suppressed and right-click keeps its normal meaning.

Bulk is `event.shiftKey || isShiftHeld()`.

Other details:

- A resource about to leave its slot must not stay selected → `model.deselectSelectedResource()`.
- Unassigning is a **sequence** of engine round-trips, not one call. The click is answered
  immediately; the work reports back, plays `dropUnassign` if anything was released, and calls
  `refreshHighlight()` because the card has been rebuilt with different slots.
- `useAudio('CommerceScreen/ResourceSlotting')` is resolved **during setup** — it reads a Solid
  context and cannot be called from an input handler running later.

---

## `bulk-assign.js` — Shift while assigning

The screen offers two ways to assign, and **both end at the same call**:

```
city Activatable onActivate → model.slotSelectedResource(cityID)
ghost slot       onActivate → model.slotSelectedResource(cityID)
DragAndDrop      onDragDrop → model.slotSelectedResource(cityID)
```

So the model's own method is wrapped **once** and both routes are covered. The model is a
`createMutable` store, so the property is simply reassigned and put back on cleanup.

A call carrying `targetResourceValue` is a **swap** between two resources, not an assignment into
a free slot, and is left alone.

### How many is "as many as possible"

**Not computed.** Free slots are not counted and capacity is not modelled: the loop keeps asking
`canAssign` and stops the first time the engine says no. That is also why it copes with camels,
which bring two extra slots with them and make room for more than were free when the player
clicked.

Each step waits for the previous one to land — `sendRequest` only queues.

⚠️ The candidate list is **snapshotted before the first wait**: the model repopulates underneath.
And the resource the player assigned themselves is still listed as unassigned (queued), so it is
excluded by value or it would be sent twice.

### The camel-move case

`needsRoomFreed` detects a *move* (not a swap, different settlement) of a slot-carrying resource,
and routes it through `freeRoomForMove` before letting the original do the move.

⚠️ The selection is **re-made rather than assumed**: freeing companions rebuilds the model, and
whatever was selected before does not survive that.

---

## `shift-click.js` — making Shift-clicks work at all

The screen's `Activatable` fires `onActivate` from the engine's `mousebutton-left` action, and
**the engine withholds mouse actions while a modifier is held**. So with Shift down the whole
screen stops responding to clicks — which is why Shift-assigning worked when dragging but not
when clicking.

This does what `Activatable` would have done, from the native DOM event, **only while Shift is
held**. Without Shift nothing here runs and the screen behaves exactly as the game wrote it.

Each branch calls the same model method the corresponding `Activatable` calls, so the result is
the game's own behaviour — including `bulk-assign.js`, which is layered on
`slotSelectedResource` and therefore applies to this route too.

- Resources are tested **first**: they sit inside the settlement card, which would otherwise
  swallow a click meant for one of them.
- `DRAG_THRESHOLD_PX = 6` between press and release — farther and it was a drag, which handles
  itself.

---

## `hover-highlight.js` — the Shift + hover preview

While Shift is held, hovering a resource marks every resource of that same kind **in the same
group**. Both sides mean something different:

- assigned to a settlement → its kin in that settlement, all of which Shift + right-click would
  release;
- in the unassigned pool → its kin in the pool, which Shift-assigning would send in together.

The marks are **not stored anywhere**: the screen rebuilds its DOM whenever the model changes, so
every recompute clears whatever carries the class and marks the current set again. That makes a
stale mark impossible, at the price of one `querySelectorAll` per recompute.

`transform: scale(1.25)` on `.framed-resource` — ⚠️ **not a taste decision**: the screen's own
markup carries `hover:scale-125` on the draggable, so matching it makes the preview read as
"these are all hovered" rather than as a new kind of decoration. `.framed-resource` is the target
because it is rendered in **both** branches of `DraggableResource`; `.draggable-resource` only
exists while the resource is interactive.

⚠️ The hovered resource itself is skipped when the game already enlarges it, or the two transforms
multiply (1.25 × 1.25) and it ends up visibly bigger than its own kind.

Cost when Shift is not held is one boolean test per `mousemove` — `scheduleRecompute` returns
immediately when nothing is marked and Shift is up. Work is coalesced into one
`requestAnimationFrame`.

`refreshHighlight()` is exported for `resources-tab.js` to call after an unassign.

---

## `settlement-controls.js` — three controls per card

A priority picker, a quick-assign button and an unassign button, level with the settlement's
name. The first two are ports of Resource+'s controls, including their look; the third is the
game's own per-settlement "return all resources", hidden where it was and reissued here so all
three actions are in one place.

The card is Solid-rendered and rebuilt whenever the model changes, so the controls are
re-injected from a `MutationObserver` rather than placed once.

### The header layout — two failed attempts worth not repeating

⚠️ Absolute placement with a hard-coded gap for the factory cog knew nothing about how wide the
pills were, so the controls either sat far from the cog or overlapped the pills.

⚠️ Placing them in the flow with `margin-left: auto` and trusting the header's own
`justify-between` to pull the cog along did not work either — the cog stayed at the far edge.

**So the adjacency is no longer left to the header**: our controls **and** the cog go into a
container of ours (`najane-card-actions`), which cannot lay them out any other way. The name
block (`najane-card-name`) gives way first, so pills wrap in the vertical instead of pushing the
controls off the right-hand edge.

⚠️ The name block is marked **from JS**, not matched with `:first-child`: the name is wrapped in
an `Activatable` while no resource is selected, so which element is first — and what classes it
carries — depends on what the player is doing.

⚠️ Moving the cog moves a node Solid rendered. That is only safe because `hasFactory` cannot
change while the screen is open, and because a rebuilt card is a fresh one that comes back
through the injector anyway.

⚠️ `hideSettlementReturnButton` is **not** simply the first `.fxs-image-button` in the card. On a
settlement with a factory the `FactoryTypeDisplay` in the header contains one too, and being in
the header it comes first — so that version hid the factory's button and left the settlement's on
screen. Anything inside the header is the factory's.

### Other details

- Re-entrancy guard `injecting` — our own `appendChild` is a `childList` mutation and would call
  the observer again.
- The observer watches `childList` **only**, so re-adding classes to our own elements cannot
  retrigger it.
- `control.addEventListener('engine-input', e => e.stopPropagation())` — the card beneath treats
  a press as "assign the selected resource here"; these controls are not that.
- **Balanced** has no single icon, so it is drawn as a cluster of all seven yield icons.
- `stopSettlementControls` **empties** the actions container into the header rather than removing
  it, because the game's cog is inside it.

---

## `assign-all-buttons.js` — the button bar

Three buttons plus the "?" and (in Modern) the factories-first checkbox, absolutely positioned at
the left of the tab row.

The behaviour is Resource+'s; **the placement is not**. That mod measures the resource column
every frame and pins its buttons over it with `position: fixed`. These sit inside the tab row,
which is a positioned element the game already maintains, so they **move with the layout instead
of chasing it**.

`tabRow()` is `document.querySelector('[data-name="TabList"]')?.parentElement` — the anchor every
summary line in this mod also uses.

⚠️ **Equal button widths (10.5rem), text on one line, allowed to shrink.** Equal so none of the
three reads as the primary action — which means the box cannot grow to fit a longer label.
"Assigning…" is longer than "Assign All", and in Polish longer still, so the label spilled past
the border and the middle button broke onto a second line. The shrinking is the game's own
`coh-font-fit-mode`, applied through the `font-fit-shrink` class.

The game's own "unassign all" is **hidden, not moved**: it is a `ConfirmationDialog` wrapping an
icon button, and relocating a Solid-managed subtree would fight whatever re-renders it. It is
matched by `.self-end` inside `[data-name="slotted-resource-container"]`.

⚠️ The confirmation prompt is lost along the way. That matches its new neighbours — "Reassign
All" already clears everything without asking.

The `MutationObserver` here **disconnects itself** once both injections succeed, and needs no
re-entrancy guard: `inject()` appends only when the bar is missing, and the observer is
disconnected in the same breath.

---

## `tab-icons.js` — icons instead of words

Tabs render in declaration order and **nothing on a tab element says which one it is**, so
position is the identity — and which tab sits in which position **depends on the age**:

```js
[RESOURCES, TRADE, EMPIRE]  + TREASURE (Exploration)  + FACTORY (Modern)
```

⚠️ A fixed array would have put a treasure chest on the factory tab.

Tooltips are **this mod's own strings**, not the tab's title, because the title is not it:
"Resources" does not say the tab holds city and bonus resources rather than all of them, and the
Empire tab holds treasure resources too once Exploration reclassifies them. `null` in the tooltip
array keeps the tab's own name — already exactly right for trade routes.

`softenCaps` lowercases a SHOUTED label for tooltip use. Two tab names are stored in capitals in
the localisation itself (the English source is literally "TRADE ROUTES"), which reads as shouting
in a tooltip. Anything already mixed-case is left alone, and so is any script without letter case
at all.

⚠️ **Collapsing labels with `font-size: 0` did nothing**: tab labels carry `font-fit-shrink`
(`coh-font-fit-mode: shrink`) and the engine sizes that text itself, ignoring the declared size.
So the **text nodes are removed** instead — only bare text nodes, so the injected icon element
survives. The rule is kept anyway, as cover for a label that reappears before the observer gets
to it.

⚠️ **There is deliberately no `stopTabIcons()`.** One existed, was never called, and would have
removed the icons from a strip that was still on screen. The strip outlives any single tab; the
observer is attached to the strip itself and simply stops receiving events when the screen closes.

More tabs than icons → that tab is left as text rather than guessed at, so a future tab is merely
unstyled and not blank.

---

## `layout.js` — screen chrome

Three changes, and **two stylesheets on purpose**:

| Sheet | Scope | Contents |
|---|---|---|
| `najane-commerce-tab-style` | the whole screen, scoped to `screen-resource-allocation` | tab strip size, the instruction line |
| `najane-commerce-screen-style` | the Resources tab, attached and removed with it | filter/sort dropdown heights |

⚠️ The instruction-line rule **must** be in the screen sheet. The tab sheet is taken down when the
Resources tab unmounts, and the line came straight back on Trade Routes. `ensureScreenLayout()` is
exported so `trade-routes.js` can call it — that tab can be the first one opened and must not
depend on the player visiting Resources first.

The tab strip: the game asks for `w-187` (41.56rem) and `min-h-16` (3.56rem); at that width a
two-word tab title wraps and the strip grows to two lines. It is set to 30rem, `min-height:
2.667rem`, `align-self: flex-end`, `margin-right: 6rem` — pushed out of `self-center` to clear
the button bar. The horizontal budget, both sides in `rem` so it scales with resolution:

```
left edge   2rem + three 10.5rem buttons + gaps  ≈ 35rem
right edge  30rem strip + 6rem margin            ≈ 36rem
```

30rem is only enough **because the tabs carry icons**. Widen it again if they ever go back to
text.

Hiding the instruction line closed the gap completely and the panel ended up touching the tabs,
so one margin's worth is given back via `DESCRIPTION_SELECTOR + div`.

Dropdown height comes from **three** places at once — the class the screen passes in
(`min-h-14`), the component's own `min-h-10` on the same element, and the open-arrow's
`min-h-12`. Overriding only the first left them nearly as tall.

`checkDescription()` warns if the description selector matches anything other than exactly one
element. Not fatal — the worst case is the line staying visible — but it means the selector needs
revisiting. It runs from an observer because `CommerceScreenBaseTabContent` renders inside a
`ThrobberSuspense`, so at mount time the content is still a placeholder.

⚠️ Removed feature, recorded so it is not re-added: the unassigned-resource yield totals used to be
restyled as badges here. The row is built from `getUnassignedResourceYieldBonus`, which is **zero
for every yield** unless something specifically pays you for leaving resources unassigned. For
almost every game the row is empty — the styling was not broken, there was simply nothing there.

---

## `factory-first.js` — the checkbox

Only the **control** is here; what it means and where it is kept are in
`ui/planner/factory-first-setting.js`. Returns `null` outside the Modern age.

Why a control on the screen rather than a mod option: it is a decision about this empire in this
age, the kind of thing you change while looking at the board.

⚠️ It began beside the filters, **in the screen's own header bar, and never appeared there.**
Injecting into it, watching it, and putting the switch back when it vanished all failed silently
— **Solid owns that bar.** It now goes into `assign-all-buttons.js`'s bar, which this mod builds
and therefore controls.

⚠️ No teardown of its own: the switch is created into that bar and goes when the bar goes. An
exported `stopFactoryFirst()` existed and was never called from anywhere — dead code in the one
place that must not have any, the cleanup path.

---

## `help-mark.js` — the shared "?"

A small round mark carrying an explanation in its tooltip. Used where the screen does something a
player cannot discover by looking: the Shift shortcuts on the Resources tab, and what a click on
a treasure card actually does.

Shared rather than copied, because a second one that looked slightly different would read as a
different kind of control. Not clickable — just a label with a tooltip.

Exports `HELP_CLASS`, `HELP_STYLE` (to be concatenated into the caller's sheet) and
`makeHelpMark(tooltipKey, labelKey)`.
