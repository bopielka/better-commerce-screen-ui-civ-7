# Better Commerce Screen UI by Najane

A UI-only mod for Sid Meier's Civilization VII, targeting the **Commerce screen** — the
screen where resources are assigned to settlements and trade routes are reviewed.

No game rules, values or balance are changed, and saved games are unaffected
(`AffectsSavedGames = 0`).

Status: **0.1 — first feature written, not yet confirmed in game.**

## Features

**Right-click an assigned resource** to send it back to the unassigned pool.
**Shift + right-click** sends back every resource of that same kind assigned to *that*
settlement; the rest of the empire keeps theirs.

**Assign with Shift held** — by dragging or by clicking — and the settlement keeps
taking resources of that same kind out of the unassigned pool until it runs out of room
or out of resources.

**Hold Shift and hover** any resource and every resource of that kind in the same group
enlarges, exactly the way the game already enlarges the one under the cursor. Over a
settlement that previews what Shift + right-click would release; over the unassigned
pool it previews what Shift-assigning would send in.

Right-clicking anywhere else on the screen keeps its normal meaning (closing the
screen) — only clicks that land on an assigned resource are intercepted.

A **?** beside the three buttons carries all of the above in its tooltip; none of it is
discoverable by looking.

**Assign All / Reassign All**, to the left of the tab strip, and three controls on every
settlement card: a **priority picker** (remembered across reloads), **quick assign** and
**unassign** — the last one
being the game's own return button, moved up from the far side of the card.

**Unassign All** is the third button in that row, replacing the game's own button at the
bottom of the settlement column — same action, without the scroll and without the
confirmation prompt.

**Assign All puts happiness first.** Before anything else it looks for settlements sitting
on negative happiness and feeds them happiness resources — the most unhappy one first,
only until it stops being the most unhappy, then the next. The aim is zero, not a maximum,
so three settlements at −10 / −20 / −30 are levelled rather than one of them being
rescued outright. **Cities come before towns as a class**: while any city is below zero,
no town is considered, however deep its own hole. A camel will be spent on opening slots
in a full unhappy settlement when that is what stands in the way.

Resources whose purpose is cheaper **units** — military, civilian or religious — go last,
after everything else. Recognised from their modifiers (any `ADJUST_UNIT_PRODUCTION`
effect), not from a list of names.

When nothing left in the pool serves a city's chosen priority, **production comes next** —
ahead of a resource whose situational bonus merely happens to apply there. Towns fall back
differently, since production in a town becomes gold rather than buildings.

A **city** with no priority chosen counts as wanting **production**; a **town** counts as
wanting **food**, since a town turns its production into gold rather than building with
it. Either can be overridden by picking a priority.

**Turtles and silk are gathered into one city** — whichever makes the most culture on its
own — and **jade into another**, whichever makes the most gold, never the culture one. If
the intended city fills up, the next best by that same yield takes over. This happens only
once a settlement has taken everything matching its own priority.

Resources whose bonus **scales with warehouses** (clay, crabs, turtles) are steered to the
settlement that has the most of them — recognised from the data, not from a list of names.

What a resource is worth in a settlement is read from the **modifier tables, including
each modifier's requirements** — so a bonus that only fires in a city, a capital, distant
lands or a settlement with a given building is not counted anywhere else. This matters
more than it sounds: 29 resource modifiers are gated on having a build queue, which is
the game's way of saying "cities only", and that covers Jade, Silk, Lapis Lazuli, Cloves
and Incense.

A resource that carries **production** is nudged away from towns, since a town turns
production into gold rather than building with it: cotton (+2 food, +2 production) goes to
a city rather than a town, even though a town wants the food. And how much of a priority a
resource actually serves is the dominant term in the ordering, so llamas (+1 production
beside +3 happiness) are only reached for once everything with more production is placed.

> The three assignment buttons and the settlement controls reproduce the behaviour of
> the Workshop mod **Resource+** (`brads-assign-all-resources`, id 3756000777) by
> **Brad**, whose permission the author has. The scoring and ordering in
> `ui/planner/scoring.js` are a port of Brad's work. Resource+'s per-resource locks are
> not ported, so "Reassign All" clears everything.

**A fifth tab, Factory Resources**, in the Modern age only — the game has none, and
factory resources are otherwise scattered between a pool subsection and a per-settlement
dropdown. The body is a placeholder for now; the tab is the part that is in.

> This is the one feature that **replaces** `CommerceScreen` rather than wrapping it —
> tabs are its children and nothing lets a mod add one from outside. `ui/screen/factory-tab.js`
> is a line-for-line transcription of the game's component with one `Show` appended, so
> it can be diffed against the original after a patch. It is also the first thing to
> check if the screen ever breaks.

**Factories first** — a checkbox after the "?" in the button bar, **Modern age only**, on
by default.
With it on, factory resources are placed before anything else: each factory is started on
the kind with the most copies waiting and then filled with it, because the game allows only
one kind of factory resource per settlement but any number of copies of that kind. Unhappy settlements
are still dealt with first.

**Layout**: the tabs carry icons instead of words, with the label moved to the tooltip —
a resource leaf, the trade arrows, the empire hexagon and the treasure chest, all the
game's own art. On the Resources tab the standing instruction line above the panel is
dropped, the unassigned-yield totals are drawn as badges matching the ones Drongo's Top
Panel puts in the top-left corner, and the filter and sort dropdowns lose a third of
their height.

**Moving** a slot-carrying resource out of a settlement works the same way. The game
refuses that move outright unless the old settlement already has room to lose the two
slots, which is why dragging a camel out of a full settlement did nothing at all; now the
companions are released first and the move goes through.

**Resources that carry slots** (camels grant a settlement two) may take companions with
them: removing one shrinks the settlement's capacity, so other resources have to be
released first — taken from the end of the settlement's list. How many is not computed
in advance: companions are released one at a time and only for as long as the engine
keeps refusing the resource that was actually clicked, so a settlement with room to
spare loses nothing extra. Which resources carry slots comes from the
`BonusResourceSlots` column, not from a hard-coded rule, so anything a DLC or another
mod gives the property is handled too.

**Automatic assignment** — one setting under Options → Mods, four steps, **Never** by
default:

| | |
|---|---|
| Never | the mod does nothing on its own |
| Place the new resource | the resource just acquired is placed, nothing else is touched |
| Place everything unassigned | the arrival is a cue to tidy up the whole pool |
| Rebuild every assignment | clears every settlement and lays the empire out again |

Anything short of the last never moves a resource that is already assigned, and never
touches one you deliberately left unassigned. All of it happens with the screen closed,
using the same order as Assign All.

## What this screen actually is

The element is called `screen-resource-allocation`, but the live implementation lives in
`base-standard/ui-next/screens/commerce/` and is written in **Solid.js**, not the game's
older `Controls.define` / `data-bind-*` framework. The old `ui/resource-allocation/`
files still ship and still load, but they lose on priority and are not what the player
sees — editing them changes nothing.

Consequences for this mod:

- `Controls.decorate` does not work here.
- The way in is `ComponentRegistry.register({ name, createInstance, overridePriority: 1 })`,
  which the framework documents as the mod hook. Load order does not matter.
- Overridable names on this screen: `CommerceScreen`, `CommerceScreenBaseTabContent`,
  `CommerceResourcesContainer`, `TradeRouteCard`, `TreasureConvoyCard`,
  `TreasureConvoyProgressBar`, `FactoryTypeDisplay`, `CommerceCriteriaDisplay`.
  The tab containers for Trade / Empire / Treasure are **not** registered.

Full analysis lives in the knowledge base:
`../../knowledge-base/25-ui-next-solidjs.md` and
`../../knowledge-base/26-commerce-screen.md`.

## Repository layout

```
better-commerce-screen-ui.modinfo   mod manifest - actions, scopes, file list
ui/                                 JavaScript loaded by the game's UI
  better-commerce-screen-ui.js        entry point - the only file the .modinfo lists
  support/                          no knowledge of the game or of this mod
    diagnostics.js                    logging switch (ON right now)
    dom.js                            injected elements: make, click, style
  engine/                           talking to the game; no DOM, no model
    operations.js                     EVERY ASSIGN_RESOURCE request lives here
    unassign.js                       releasing, and who has to leave with what
    resource-slots.js                 BonusResourceSlots (camels)
    wait.js                           waiting for a queued operation to land
    age.js                            which age this is, worked out once
    shift.js                          is Shift held?
  model/                            reading the screen's data
    screen-model.js                   model handle, lookups, screen point -> resource
    headless-model.js                 the same shapes rebuilt without the screen
  planner/                          deciding what goes where
    facts.js                          what a resource IS and DOES, from the data
    effects.js                        resource modifiers and their requirements
    scoring.js                        the tiers and bestAssignment - see the note above
    place.js                          the placement loop, shared by buttons and automation
    run.js                            what the buttons do; the framing around place.js
    empire-effects.js                 what an empire resource is worth to this empire
    priorities.js                     per-settlement priority, in memory
    priority-store.js                 the same, kept between sessions
    factory-first-setting.js          whether factory resources go first
    auto-assign.js                    places new resources with the screen closed
  screen/                           the DOM this mod puts on the Commerce screen
    resources-tab.js                  the component wrapper; right-click unassign
    factory-tab.js                    the screen itself, plus the Modern-age Factory tab
    empire-tab.js                     the rebuilt Empire Resources tab
    trade-routes.js                   the Trade Routes tab: titles, columns, grouping
    assign-all-buttons.js             Assign All / Reassign All / Unassign All / "?"
    settlement-controls.js            per-settlement priority picker + quick assign
    factory-first.js                  the "factories first" checkbox
    layout.js                         description, yield badges, dropdown height
    tab-icons.js                      icons instead of words on the tab strip
    hover-highlight.js                Shift + hover preview
    bulk-assign.js                    Shift-assign, by wrapping slotSelectedResource
    shift-click.js                    left-clicking at all while Shift is held
  options/najane-commerce-options.js  mod options (Options -> Mods)
text/<locale>/                      every on-screen string (en_us, pl_PL for now)
deploy.sh                           copies a build into the game's mod folder
```

### Which way dependencies point

`support` <- `engine` <- `model` <- `planner` <- `screen`, and never back up. A module
may import from its own folder or from one to its left. `options/` imports nothing of
ours at all.

This is worth keeping: it is what lets the automatic path run with the screen shut. When
the planner imported the "factories first" checkbox to ask whether the setting was on,
loading the assignment engine dragged the whole button bar in behind it.

## Working on the mod

This repository is the source of truth. The game never reads from here directly —
`deploy.sh` copies a build into Civ VII's mod folder. **Run it after every change.**

```bash
./deploy.sh
```

```bash
./deploy.sh --dry
```

The script wipes and rebuilds the target folder, so files deleted here also disappear
from the game instead of lingering. It copies only the `.modinfo`, `ui/`, `text/` and
`config/` — this README, the deploy script and `.git/` never reach the player's mod
folder. It then verifies that every file referenced by the `.modinfo` exists in the
target. After deploying, return to the main menu (or restart) to reload the mod.

Override the install location if needed:

```bash
CIV7_MODS_DIR="/path/to/Mods" ./deploy.sh
```

The mod is installed to:

```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\
```

Not `Documents\My Games\...` — that is the Civ VI convention and Civ VII never scans it.

## Checking your work

```bash
for f in ui/**/*.js; do node --input-type=module --check < "$f"; done
```

Game logs are the first place to look when something does not appear:

```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\
  Modding.log    was the mod discovered and loaded?
  Database.log   did the XML pass validation?
  UI.log         JavaScript errors, missing assets
```

`console.log` never reaches `UI.log` — use `console.error` for diagnostics.

## Licence and origin

Generated by **Opus 5**, a model by **Anthropic**. Anyone may reuse it freely as a basis
for their own mods.
