# Better Commerce Screen UI by Najane

A UI-only mod for Sid Meier's Civilization VII, targeting the **Commerce screen** — the
screen where resources are assigned to settlements and trade routes are reviewed.

No game rules, values or balance are changed, and saved games are unaffected
(`AffectsSavedGames = 0`).

Status: **0.1 — feature-complete, in testing.**

The Steam Workshop page carries a short overview; the full description lives here, under
[What the mod does](#what-the-mod-does). The two are kept apart on purpose: a store page
is read in ten seconds, and everything that does not survive that cut belongs somewhere a
reader can choose to go.

## What the mod does

This is the long version. The Steam page carries a short one; everything below is the
same content written out in full, so a reader who wants to know exactly what changes has
somewhere to find it.

### The mouse does more

- **Right-click** an assigned resource to send it straight back to the unassigned pool.
  No selecting, no dragging it back.
- **Shift + right-click** returns every resource of that same kind in that settlement at
  once. The rest of the empire keeps theirs.
- Hold **Shift** and hover anything, and every resource of that kind lights up the same
  way the game already highlights whatever is under your cursor. You see what you are
  about to affect before you commit to it.
- Hold **Shift while assigning** — dragging or clicking, either works — and the settlement
  keeps taking resources of that kind out of the pool until it runs out of room or you run
  out of resources.

Right-clicking anywhere else still closes the screen, exactly as before.

None of that is discoverable by looking, so there is a **?** beside the buttons at the top
that spells it out.

### Camels stop being a puzzle

Camels carry two extra resource slots with them, so pulling one out of a full settlement
means something else has to leave first. The mod works out how much room is actually
needed and frees exactly that much — taken from the end of the settlement's list, and not
one resource more than the situation demands.

That applies to dragging one out by hand as well. Normally the game simply refuses the
move and nothing happens; here the room is made and the camel goes where you dropped it.

### Assign your whole empire

Three buttons sit above the tabs:

| Button | What it does |
|---|---|
| **Assign All** | Places every unassigned resource, keeping what is already assigned. |
| **Reassign All** | Clears everything and lays it out again from scratch. |
| **Unassign All** | Empties every settlement. The game's own version of this button is buried at the very bottom of the settlement list; this one is where you can reach it. |

Every settlement card also gets three controls of its own, next to its name:

- **A priority picker** — tell this settlement which yield it should be fed first. What
  you pick is remembered, so it is still there after you reload.
- **Quick assign** — fill this one settlement from the pool, leaving the rest alone.
- **Unassign** — empty it again.

### How Assign All thinks

**Unhappiness comes first**, ahead of everything else — unless you say otherwise. It is the
single largest thing the mod does to a layout, so **Options → Mods** decides how far it goes:
never, cities only, or all settlements. Any settlement sitting below zero
Happiness is fed happiness resources until it is back at zero — not maximised, just out of
trouble. Cities are rescued before towns, as a class: while any city is unhappy, no town
is considered. And the help is spread rather than dumped, so three settlements at -10, -20
and -30 are levelled out instead of one of them being rescued while the others stay in the
red. If a full settlement is the problem, a camel will be spent on opening the slots.

After that it works down in order: camels first, since they make room for everything else;
then resources whose stronger situational bonus actually applies in that settlement; then
single-yield resources; then multi-yield ones. Resources that do nothing but make units
cheaper to build are placed last of all.

When nothing left can serve a city's chosen priority, production is what it takes next —
ahead of a resource whose situational bonus merely happens to apply there.

**Balanced** — which every settlement is until you say otherwise — means production in a
city and food in a town: a town turns its production into gold rather than building with
it, so growth is what it can actually use. It does *not* mean "whatever it has least of",
which is what it meant in Resource+.

What a resource is actually worth somewhere is read from the game's own data,
**conditions included** — a bonus that only applies in a city, in your capital, in distant
lands or in a settlement with the right building is not counted anywhere it would not
happen. Jade's gold, Silk's culture and Lapis Lazuli's production all need a city; they
will not be dropped into a town where they do nothing.

Nor is the **weaker half of an either/or bonus** mistaken for a good fit. The game writes
those as two conditions — Fish pays 8 Food with a Port and 4 without — and both read as
"a condition is met", which had Fish at +4 outranking Sugar at a flat +8 and going to
portless towns. See [`knowledge-base/27-resources.md`](../knowledge-base/27-resources.md)
for every resource this shape applies to, per age.

**Everything paying culture** is gathered into whichever city makes the most culture by
itself, and **everything paying gold** into a different one, so those bonuses stack
somewhere instead of being sprinkled about. When the city holding a role fills up, the
next best takes it over. Both piles are switchable in **Options → Mods**, on by default.

Resources whose bonus grows with the number of warehouses in a settlement are steered to
wherever those warehouses actually are. Resources that carry production lean towards
cities rather than towns, and a resource that barely helps with a settlement's priority
waits until everything that helps more has been placed.

### Hands off, if you want it

One setting under **Options → Mods**, set to **Never** until you change it, deciding what
happens when a resource arrives — by improving a tile, or over a trade route. Whatever you
pick happens with the screen closed and without interrupting you, in the same order Assign
All uses.

| Setting | What happens on arrival |
|---|---|
| Never | the mod does nothing on its own |
| Place the new resource | just the one that arrived, nothing else touched |
| Place everything unassigned | the arrival is a cue to tidy up the whole pool |
| Rebuild every assignment | clears every settlement and starts again |

Anything short of the last never moves a resource you have already placed, and never
touches one you deliberately left out. Nothing happens unless something actually happens
in your game — loading a save assigns nothing.

Resources arrive in more ways than improving a tile, so the watcher listens for a spread
of events — trade routes, captured settlements, wonders and buildings that carry slots —
and, behind all of them, **looks again every fifteen seconds**. The engine's event surface
is not documented and the list turned out to be incomplete three times; the events make it
feel instant, the sweep makes it correct.

### Factories first

In the Modern age a checkbox appears after the **?** in the button row, on unless you
clear it. With it on, factory resources are placed before anything else, and placed the
way the game rewards: a settlement may only run one kind of factory resource at a time,
but it may hold any number of copies of that kind. So each factory is started on the kind
there are most of, and then filled with it, rather than every factory being committed to a
different kind and most of your stock left with nowhere legal to go.

Settlements below zero Happiness are still dealt with before anything.

### Imports first

A second switch, in **every** age and **off** by default, for one victory condition only.
Towards the Economic Victory a resource in a city is worth +1 GDP a turn and an imported
one — reached you over a trade route from another leader — is worth +1 more on top, twice
as much as your own. Neither pays anything in a town, so imports are never sent to one.

It outranks every settlement's own priority, which is the point and also the cost: until
the last import is placed, your cities take whatever the trade network supplies. Chasing
culture, science or a military win, leave it off.

### What it is all earning

Beside the switches, a figure with the economic victory-point icon: roughly what your
assigned resources pay per turn. Its tooltip breaks that into resources in cities, the
extra from imported ones, factory resources, and gold buildings — the last counted only
for the **current age**, since a Market stops paying once Exploration begins, except the
ageless ones which always count. It updates as you assign.

### Trade routes, at a glance

A route card used to say where its goods were going in a sentence underneath the name, and
how much gold the other leader made at the bottom. Now the title line says all of it:

```
(city) (sea)  MEKKA -> BOGDAN
```

Three cards to a row instead of one and a half, so a screen holds three times the routes.
Both lines of prose are gone, and so is the standing instruction paragraph that opened
every tab.

Above the tabs, one line says how many routes you are running and how many you could — and
its tooltip names every leader you still have room for, split into the ones you could sign
with right now and the ones where the room is there but nothing of theirs is in range.
That distinction is the whole question the tab used to make you answer card by card.

That section also opens by default now — the game draws it closed, which hid everything below.

The routes you cannot start yet are split into two collapsible groups, because they are
different news: the ones where **nothing is wrong except your trade limit**, and the ones
that are simply **out of range**. The first group is your shopping list for the next trade
capacity you earn.

#### Which route is worth the capacity

Above the cards in each section — available and unavailable alike — sits the screen's own
tab strip in miniature, one tab per yield:

```
  (balanced) (food) (production) (gold) (science) (culture) (influence) (camels) (empire)
```

Balanced is what you get without touching anything: nothing is hidden, and the routes carrying
the most resources come first. Pick a yield and the section shows **only** the routes carrying
at least one resource that pays it, the ones carrying the most of it first — which is the question you actually have
when a trade slot opens up and three empires want to use it. The camel tab counts the
resources that bring extra settlement slots with them, and the last one counts empire and
treasure resources together; in the Modern age the camels go (there are none) and a factory
tab arrives. One
section keeps its own choice, so sorting the available routes by gold says nothing about how
the ones you cannot reach yet are ordered.

Only the tabs worth offering are drawn: the strip is built from what is actually in reach this
turn, so you will never be given a filter that hides every card.

#### Buy the merchant from the card

Every route you could actually open now carries a gold button next to the leader's
portrait, showing what a merchant costs:

```
(city) (sea)  MEKKA -> BOGDAN            [ 325 ]  (leader)
```

One click buys a merchant in the settlement the route is measured from and sends it to the
other empire's settlement. It walks there on its own and **opens the trade route itself**
as soon as it is close enough — including on the turns after you have closed this screen.
You are not asked to confirm: the price is on the button before you press it, exactly as
the game's own production list buys with one click.

If that settlement cannot sell a merchant, the nearest one that can does instead, and the
tooltip names it. If you cannot afford one, the button goes dark and says so rather than
disappearing.

Clicking a leader's portrait on any card opens diplomacy with them.

Trade capacity is counted per leader, not per settlement — so if one slot is free and a
merchant of yours is already walking to one of that leader's cities, every other card of theirs
gets an **attention mark** under the price, priced in Influence, saying the slot is spoken for.
It does not stop you: relations can change while a merchant walks. Click it and it proposes
"Improve Trade Relations" with that leader on the spot — the same treaty the button below
offers — or, if that is not on offer right now, opens diplomacy with them instead, same as it
always did.

One errand per settlement at a time: while a merchant of yours is walking there the button is
disabled and a **map pin** appears under it. Click the pin and the screen closes and takes you
to that merchant. If it is lost at sea or killed on the road, the mod notices, drops the errand
and gives you the gold button back — the card never claims that help is on the way when it is
not.

#### Or fix the limit and buy the merchant anyway

The "one trade slot away" group under **unavailable trade routes** carries a button too — the
same idea, priced in Influence as well as Gold:

```
(city) (sea)  MEKKA -> BOGDAN      [ 12 ]  [ 325 ]  (leader)
```

One click **proposes "Improve Trade Relations"** with that leader — the same treaty the
Diplomacy screen offers — and buys and sends a merchant regardless of whether it is accepted.
The treaty can be refused; this mod does not pretend otherwise. Nothing waits to find out: the
merchant is sent anyway, because it already knows how to wait for a slot that might come from
this treaty, a later one, or nowhere this mod had a hand in. The button only lights up once
both prices are affordable and the treaty is actually on offer right now — once proposed, the
next attempt costs more, and a refusal is followed by a cooldown, both checked the same way the
Diplomacy screen itself checks them.

### Treasure convoys, without the noise

The "not generating" list used to hold every settlement in your empire that was not
sending treasure — including all your homeland ones, which never could. They are gone from
it now, so what is left is the handful you can actually do something about.

Three cards to a row here as well. Each card drops the heading that repeated the name of
the screen, and the sentence about what a convoy pays out becomes the two numbers it was
hiding:

```
+300 (gold)   +60 (gdp)
```

The condition — paid on unloading at home — moves into the tooltip, where it does not need
re-reading on every card.

Clicking a card here moves the map to that settlement without closing the screen, which is
easy to mistake for nothing happening. A **?** beside the tabs says so.

### Empire resources, worth in numbers

The Empire tab told you what each resource does — "+1 Gold and Happiness in all
settlements" — which reads the same whether you hold one settlement or twenty. It now
tells you what that is worth to you:

```
(icon) GOLD [6]
One:  +12 (gold)  +12 (happiness)
All:  +72 (gold)  +72 (happiness)
```

One line for a single copy, one for everything you hold, and above the tabs a single total
for the whole empire. Combat bonuses say which units they reach — and they say it in full,
including the classes the game's own description leaves out. Resources whose bonus is
capped, or that only pay during a Celebration, say so instead of quietly inflating the
total.

Four columns, with the combat resources gathered in the first one where the longer lines
have room. The rule in the game's own words, and where every copy came from, move into the
tooltip on the resource icon.

### Factory resources, and what they are worth

The Modern age adds a class of resource that pays nothing at all for being owned — it only
does anything once it sits in a settlement with a Factory. The game has no screen for
them: they appear as a subsection of the unassigned pool and as a dropdown on individual
settlements, and nowhere can you see the lot together.

This mod adds a fifth tab that does, in two halves:

- **In factories** — every factory resource that is actually working, with the total it is
  producing for your empire. Not "+5% per copy": the real figure for the copies you have
  slotted, added up per section.
- **Not assigned** — the ones sitting in the pool doing nothing, and exactly what they
  would add the moment you place them.

```
In factories    +20% (prod) Buildings, Wonders    +9% (sci)
Not assigned    +15% (prod) Land Units
```

Where a percentage multiplies a yield you can read off the top panel — Tea's Science,
Kaolin's Culture, Cocoa's Happiness — the card also shows roughly what that is in whole
numbers. Above the tabs, one line totals the GDP your slotted resources earn towards the
Modern economic legacy path.

The tooltip on each resource is the game's own framed one — the class header, the resource
in its frame, its name and description — with **a card per leader** underneath: their
portrait, how many copies came from them, and which of their settlements. The Empire tab's
cards do the same.

### A screen with room to breathe

- The tabs carry icons instead of words, with the full name in the tooltip.
- The standing line of instructions above the panel is gone. It said the same thing every
  turn.
- The filter and sort boxes are a third shorter.
- The "Resource Assignments Available" prompt no longer takes over the turn button when
  every settlement is full and nothing new can go anywhere. It is a HIGH severity
  notification that does not expire at end of turn, so it stood between you and ending
  the turn, every turn, for a situation that rarely has anything worth doing about it.

  Not that nothing *can* be done: you can always open the screen and rearrange what is
  already assigned, swapping one resource for another. That is why the prompt is only
  held back when no unassigned resource can be placed anywhere — the case where the
  rearranging would be for its own sake.

  Nothing is dismissed and no game state is touched: the notification still exists as far
  as the game is concerned, and the hold on the turn was the panel's own — `canEndTurn` is
  a UI method reading a UI-facing query — so declining to present it lets the turn end
  normally. It returns the moment something becomes placeable.

### Languages

Every language the game ships in: English, German, Spanish, French, Italian, Japanese,
Korean, Polish, Portuguese, Simplified and Traditional Chinese — and Ukrainian.

The game has no Ukrainian locale, so those strings sit in the Russian one. That is a
deliberate choice, noted in `text/ru_RU/InGameText.xml` and in the `.modinfo`, not a
mislabelled file.

The wording for things like empire, treasure and factory resources is taken from the
game's own translation files, so it matches the rest of the interface rather than reading
like a separate mod — including which terms take a capital, which differs by language.

### Compatibility

Saved games are unaffected and no game rules, values or balance are touched. Safe to add
or remove mid-game.

⚠️ **Not compatible with Resource+.** Both mods replace the same screen, so they cannot
run together — enable one or the other.

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
    merchant.js                       buying a merchant, walking it, signing the route
    merchant-orders.js                the standing order a bought merchant carries
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
    imports-first-setting.js          whether trade-route resources jump the queue
    happiness-setting.js              how far the happiness rescue goes
    hoard-setting.js                  whether the culture and gold settlements are built
    gdp.js                            what the assigned resources earn per turn
    factory-effects.js                what a factory resource is worth where it sits
    auto-assign.js                    decides WHEN to run with the screen closed
  screen/                           the DOM this mod puts on the Commerce screen
    resources-tab.js                  the component wrapper; right-click unassign
    factory-tab.js                    the screen itself, plus the Modern-age Factory tab
    empire-tab.js                     the rebuilt Empire Resources tab
    trade-routes.js                   the Trade Routes tab: titles, columns, grouping
    trade-buy-merchant.js             the gold button on a route card: buy and send
    trade-sort-tabs.js                the per-yield sort tabs above each route section
    assign-all-buttons.js             Assign All / Reassign All / Unassign All / "?"
    settlement-controls.js            per-settlement priority picker + quick assign
    assign-switches.js                the "imports first" / "factories first" checkboxes
    resource-tooltip.js               the game's framed resource tooltip, plus leader cards
    framed-tooltip.js                 the same framed style for this mod's own controls
    factory-resources.js              the Factory Resources tab body
    treasure-tab.js                   the tidied treasure convoys
    trade-summary.js                  routes running / possible, above the tabs
    assign-notification.js            hides the end-turn nag when nothing can be placed
    help-mark.js                      the shared round "?"
    layout.js                         tab strip, description line, dropdown height
    tab-icons.js                      icons instead of words on the tab strip
    hover-highlight.js                Shift + hover preview
    bulk-assign.js                    Shift-assign, by wrapping slotSelectedResource
    shift-click.js                    left-clicking at all while Shift is held
  options/najane-commerce-options.js  mod options (Options -> Mods)
    support/                          dom helpers and diagnostics
text/<locale>/                      every on-screen string (12 languages)
deploy.sh / deploy-on-mac.sh        copies a build into the game's mod folder
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

The automatic assignment logic is a port of **Resource+** (`brads-assign-all-resources`)
by **Br4d**, used with permission. See the attribution note at the top of
`ui/planner/scoring.js` for what is theirs and what is not.

Generated by **Opus 5**, a model by **Anthropic**. Anyone may reuse it freely as a basis
for their own mods.
