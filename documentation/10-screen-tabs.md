# 10 — `ui/screen/` — the tabs

The tabs this mod replaces, adds or decorates. The interaction layer is in
[screen: interaction](09-screen-interaction.md).

| File | Lines | Tab |
|---|---|---|
| `factory-tab.js` | 173 | **replaces `CommerceScreen`** — the only way to add a fifth tab |
| `factory-resources.js` | 722 | the Factory tab's body (Modern age) |
| `empire-tab.js` | 747 | the rebuilt Empire tab |
| `trade-routes.js` | 747 | the Trade Routes tab, decorated from the outside |
| `trade-summary.js` | 182 | the routes-running line above the tabs |
| `treasure-tab.js` | 156 | the Treasure tab, wrapped and its data filtered |

---

## `factory-tab.js` — replacing the screen

⚠️ **This is the one place in the mod that will break on a game patch that touches the Commerce
screen's own layout.** Everything else wraps or decorates; this replaces.

### Why the whole screen has to be replaced

Tabs are children of `CommerceScreen`, **declared inline in its JSX**. Nothing in the framework
lets a mod push another `Tab.Item` into an existing `Tab`. So the only way in is to register a
`CommerceScreen` of our own at a higher priority.

The function is therefore a **transcription of the game's own component — deliberately line for
line, so a future patch can be diffed against it** — with one `Show` added at the end and nothing
else changed.

It is written in Solid's compiled form (`createComponent`, prop getters) rather than JSX, because
a mod's scripts are plain ES modules with no build step. ⚠️ The getters are not decoration: a
plain value there would read the model once and never update.

### What it renders

```
Tab.TabList / Tab.Output
Tab.Item  Resources  → CommerceResourcesContainer   (the game's, wrapped elsewhere)
Tab.Item  Trade      → TradeRoutesContainer         (the game's)
Tab.Item  Empire     → EmpireResourcesContainer     ← ⚠️ OURS, not the game's
Show (Exploration)
  Tab.Item Treasure  → TreasureConvoysContainer     ← ⚠️ OURS, data via withoutHomelandIdlers
Show (isFactoryAge)
  Tab.Item Factory   → FactoryResourcesContainer    ← the addition
```

The model's tab-change handler switches on the tab **name** and ignores anything it does not
know, so `'Factory'` is safe to add.

Registered with `styles: [screenStyle]` — the game's own `commerce-screen.scss.js` — because
replacing the component would otherwise drop its stylesheet.

`onContextChanged` is the game's own guard, kept verbatim: unexpected popups can leave the input
context pointing elsewhere and never put it back.

---

## `empire-tab.js` — rebuilt

The game's version gives each resource a card the size of a poster: the rule in full prose, a
"SOURCE" divider and a row of leader portraits. Five resources fill the screen and none of them
answers the question actually being asked — **what is this worth to me?**

This one is a compact list. Each card is a title line and a total:

```
[icon] SALTPETER [10]
One:  +12 (gold)  +12 (happiness)
All:  +72 (gold)  +72 (happiness)
```

The prose and the origins move into the **tooltip on the icon**. The arithmetic is in
[`empire-effects.js`](08-planner-valuation.md).

⚠️ **Rendered imperatively rather than reactively, and deliberately**: nothing here changes while
the tab is open — these figures move only when settlements or resources do, and both of those
close this screen to happen. A Solid render tree would be machinery guarding a value that cannot
move. `template()` builds the host; `onMount` fills it once.

### The two-area layout

**Not one flowing list.** Everything with a combat bonus goes down the first area; the rest fill
the second, three to a row. A single wrapping list cannot do that — it places cards in the order
they come.

⚠️ The first area used to be a flat 33.3%, **wrong in both directions**: with one short combat
resource it reserved a third of the screen for a line of text a quarter that wide, and with none
at all it left a third of the screen blank. `flex: 0 1 auto` with no width makes its base size the
widest thing in it — which is the point, since what is *in* it varies by age, civilisation and
language. `min-width: 17rem` / `max-width: 45%` keep that honest.

### The figures block — columns, not rows

⚠️ **This is the whole trick, and it is not decoration.** Laid out as rows, the second figure
starts wherever the first one happened to end, so "+18" above "+144" pushed everything after it
out of line and **no two plus signs sat under each other**.

A column per figure fixes it by construction: each column is as wide as its widest cell, both
cells start at the column's left edge, and the plus signs line up whatever the numbers are — no
measuring, no guessed widths, nothing to re-tune when a bonus reaches four digits.

⚠️ **CSS grid would express this directly. Deliberately not used**: `display: grid` appears
nowhere in the entire shipped game, so nothing says this renderer implements it, and this layout
is not the place to find out.

⚠️ Every cell has `min-height: 1.7rem` and centres its content. Without it the columns drift apart
vertically — a figure carries a 1.5rem icon, a label carries text, and the "all" row is bold:
three different heights across a block that has to read as two straight lines.

### The legend

⚠️ The words used to sit **inline beside each number, repeated in both rows.** That is where the
space went: the same words twice, on a line already holding two numbers and two icons, in a card a
ninth of the screen wide. Truncating them was worse than useless — "+6 (sword)" with no words does
not say *which* units, which is the only thing that line is for.

On its own line it has the whole card, is written once, and is allowed to **wrap** rather than
truncate.

⚠️ **The icon alone is only a key while the icons differ.** Two production percentages in one card
would both show the production icon and the reader could not tell which line belonged to which —
so in that case the figure goes into the legend line as well. Coal and Oil do not hit this, but
nothing in the data promises that.

### Both rows, always (when the bonus scales)

Including at one copy, where they read the same. They were hidden in that case at first, on the
grounds that an identical pair says nothing. Shown, they say something else: **this resource is
worth stockpiling, and here is what the next copy is worth.** The cards also stop changing shape
as the empire grows.

A bonus that does **not** grow with copies gets a single line plus a note saying so — there, two
rows would claim a distinction the game does not make.

### Fallback and summary

When `empireEffectTotals` returns nothing (an effect this mod does not know how to total), the
card shows **the game's own sentence** instead of an empty space.

The summary line above the tabs totals **yields only**. ⚠️ Combat strength is left out because it
is not income and does not add up — "+6 to siege units" and "+3 to cavalry" are not +9 of
anything. Percentages towards buildings are left out for the same reason.
⚠️ Celebration-only bonuses are excluded while no Celebration is running.

### Tooltip

⚠️ Line breaks need **both** a newline character **and** `white-space: pre-wrap` on
`#tooltip-root-content > div`. Two attempts failed for the same reason: the renderer does
`element.innerHTML = Locale.stylize(content)` into a bare div, so a newline collapses to a space
the way any whitespace does in HTML, and the game's `[N]` marker resolves to that same newline
rather than to a `<br>`. **Nothing about the text can force the break; the CSS has to allow it.**

The origins are rebuilt from `resourceOriginData` rather than taken from the model's ready-made
`tooltips`, because those were already stylised into one blob per leader — fine where the game
puts them, unusable once they have to be laid out differently.

### The class badge

Read from the **resource itself**, not from the tab's `isTreasure` flag: the same resource is an
empire resource in one age and a treasure one in the next, and the game keeps a third class for
treasure coming from distant lands. Built as `url(blp:${UI.getIconBLP(classType)})`, the way the
game builds it in `getResourcePropsFromDefinition`.

---

## `factory-resources.js` — the Factory tab body

Built on the Empire tab's shape — same cards, same tooltips, same idea — with two differences the
mechanic forces:

1. **Four equal columns.** Nothing here lists unit classes, so the cards are narrower and one more
   fits across.
2. **No "one copy / all copies" pair.** A factory resource pays nothing for being held, so one
   copy's worth is not a number the player can act on.

Hence **two sections** rather than one list:

| Section | Shows |
|---|---|
| **In factories** | every factory resource actually working, with the real total for the copies slotted |
| **Not assigned** | the ones sitting in the pool, and exactly what they would add |

The second is the whole reason the tab is worth opening: the game will happily let a Modern empire
sit on six unslotted Coffee without ever saying what that is costing.

Details:

- Each section's own totals sit **on the heading line**, not in a card of their own.
- ⚠️ **No estimates in a heading**: a worked-out number belongs beside the resource that earns it,
  where it can be checked against that resource's percentage. In a heading it is a figure with
  nothing to compare it to, and it crowds out the words that say what the percentages are for.
- The idle section is drawn at reduced opacity and its totals labelled as hypothetical.
- `applied` — the percentage per yield **already in the empire's figures** — is computed once per
  render, because it is a fact about the empire rather than about a card, and the idle estimates
  measure what would be added on top of exactly that.
- ⚠️ Almost every factory resource has exactly **one** bonus, and then its words fit inline beside
  the number — no second line, so every card in a row is the same height. The legend is only for
  the rare card with two. (This is the reverse of the Empire tab, where the legend is the rule.)
- ⚠️ Tooltip origins use `[B]…[/B]`, **not HTML**: `Locale.stylize` strips elements, so a `<div>`
  per leader vanished and took its line breaks with it, running the whole list into one paragraph.
  Separation comes from a blank line.
- The GDP line above the tabs is the one figure about the whole tab — every slotted copy pays the
  same rate, so per resource it would just be the count again.

---

## `trade-routes.js` — decorated from the outside

The trade tab's **container is not registered**, so the only mount signal available is the
**card**. `TradeRouteCard` is wrapped purely to count live mounts:

```js
onMount:   liveCards++; listenForRouteChanges(); startTradeRoutes();
onCleanup: liveCards--; requestAnimationFrame(() => { if (liveCards <= 0) stopTradeRoutes(); });
```

⚠️ The count is checked **a frame later** because a rebuild unmounts the old cards around the same
time it mounts the new ones, and the order between the two is not ours to rely on — deciding at
the moment the count hits zero would tear the decoration down mid-redraw.

### The title line

```
[hex] [sea]  MEKKA → BOGDAN                      [leader]
```

⚠️ The destination does **not** come from parsing the card's sentence. The model hands the card
`domainString`, already composed and translated, and taking it apart again would break in every
language that words it differently. The route is looked up instead through
`Trade.projectPossibleTradeRoutes` — the same call the model itself uses — which carries `domain`
and `nearestCityId` as **data**.

That projection is real work (it is what builds the whole tab), so it is cached in
`routesByCityName` and invalidated on `TradeRouteAddedToMap`, `TradeRouteChanged` and
`LocalPlayerTurnBegin`.

⚠️ The tooltip goes on the **text**, not the row. On the row it also answered for the icons, so
hovering the domain icon showed the route name instead of what that icon means.

The class and the tooltip are re-applied **every pass**: they are ours, but the row is Solid's and
a redraw takes both with it.

### Three cards to a row

⚠️ **The panel is the child, not the card.** `trade-route-card.js` splits off only `tradeRoute`,
`autoFocus`, `class` and `onFocus`, and spreads the **rest** onto the `CardFrame`. `style` is not
in that list, so the width and margin the tab computes land on the frame — the bordered box the
player sees — while `.trade-route-card` is only the `Activatable` around it and is **never sized by
the game at all.** This is why every attempt to even the columns up by sizing
`.trade-route-card` did nothing visible.

⚠️ A **percentage** width (33.3333%), not a measured pixel width. The measured version was correct
but arrived late — written when the decorator runs, so cards drew at the game's own width first and
only snapped into three columns once something disturbed the DOM. Hovering a card was enough,
which is exactly what it looked like.

⚠️ `flex-grow: 0` as well. A width alone did not hold: as a flex item the card could still be
stretched by leftover space in its line, which is why the last column came out wider however
carefully the width was computed.

⚠️ `!important` is not decoration here — the tab measures the container and writes width and
`margin-right` straight onto each card as **inline** styles (`checkForWrap` in
`commerce-screen-trade-tab.js`), and an inline style beats a class rule. The measuring keeps
running and keeps being overruled, which is harmless: it settles because the widths it measures no
longer change.

### The empty band under a section

⚠️ It belongs to the element the **sections** wrap inside, which is `flex flex-row flex-wrap
flex-auto`: `flex-auto` makes it fill the scroll area, and the default `align-content: stretch`
then shares its spare height out among the lines — one line per section. It is also why a fresh
screen shows two rows and then settles to one while keeping the height.

Fixed with `align-content: flex-start` **and** `flex: 0 0 auto` — `align-content` alone only
decided where in that band the cards sat.

⚠️ That element is found by **walking up until an ancestor carries both `flex-wrap` and
`flex-auto`**, not by counting levels. Two earlier attempts marked a parent one or two steps
short: a `.trade-route-cards-row` is the body of *one* section, and between it and the container
sit the `CollapsibleContainer`'s own wrappers, which are not the same depth for every section.

### Grouping the unstartable routes

Two collapsible groups, in a fixed order:

| Group | Meaning |
|---|---|
| `limit` | nothing is wrong except your trade limit — your shopping list for the next capacity |
| `range` | simply out of range |

Both containers are created the first time **either** is needed, so the order on screen is this
one rather than whichever kind of card happened to come first.

⚠️ **The status names do not read the way they mean.** The model treats
`TradeRouteStatus.NEED_MORE_FRIENDSHIP` as *"trade capacity with this player is used up"* (see the
`LOC_COMMERCE_TRADE_STATUS_CAPACITY` block in `commerce-screen-model.js`) and `DISTANCE` as out of
range. Taken at face value the first would have been sorted as a diplomacy problem.

A route both over the limit and at war is **not** "just one more slot away", which is the whole
point of the `limit` group, so `AT_WAR` disqualifies it.

⚠️ Which cards are unavailable is decided **from the route status, not from the "disabled" class**
on the card. That class is set on the `CardFrame` through Solid's `classList` prop, and looking for
it on the card's first child found nothing — which is why no groups appeared at all.

⚠️ `stopTradeRoutes` removes **only the elements this mod created.** The group containers are
deliberately left alone: they hold the **game's** cards, and removing a container would take those
with it. Solid rebuilds that section on the next visit.

### One measured number

Only one thing here cannot be a stylesheet constant: how much room the title row has before it
reaches the leader's portrait.

⚠️ Both elements are looked up **from the card**, not from the row's parent. The title row is
wrapped in an `Activatable`, so its parent holds nothing but the row itself — searching there
found nothing and **no width was ever written.**

⚠️ It writes to a stylesheet in `<head>`, **never to the cards**, so it cannot feed the
`MutationObserver` watching them — and only when a figure actually changes, so a resize settles
instead of oscillating. Capped at `MAX_REMEASURE_ATTEMPTS = 40`.

### Other bits

- The relationship badge under the portrait is hidden — the number is already in the tooltip
  behind the portrait, in words, with every term that adds up to it.
- ⚠️ The relationship tooltip opened barely wider than one word per line. Nothing caps it: every
  row inside is `w-full`, and **a child sized in percent contributes nothing to its parent's
  natural width** — so the frame fell back to the `min-w-72` on its content. Raising the floor to
  30rem is enough; the rows then fill whatever they are given.
- `decorateAll` carries a re-entrancy guard. Everything in it can touch the DOM, and the observer
  that calls it watches the DOM — without the guard, one careless mutation is an infinite loop
  rather than a wasted pass.
- `refreshSummary` is **idempotent on purpose**: it runs from the observer callback, and an append
  that happens every pass is itself a mutation — the shape that froze the game once already.

---

## `trade-summary.js` — how many routes, and how many you could

The tab lists routes but never totals them: the one number that decides whether the "unavailable"
section is worth reading — **have I any room left?** — is spread across every card as "2 of 3 with
this leader" and nowhere else.

⚠️ Capacity is **per leader, not per empire**. `getTradeCapacityFromPlayer` is asked once per
player we have met, and the totals are the sums. Deliberately **not** `countPlayerTradeRoutes()`,
which counts every route including ones to players outside this sum — the headline and the tooltip
breakdown would then disagree, and the breakdown is the part that can be checked by eye.

Majors only, and only players we have met: capacity towards someone never seen is not room we can
use.

⚠️ **Spare capacity is not the same as a route you can start.** Range and war block routes the
limit would allow, so the tooltip splits leaders in two — "you could open one now" vs "room, but
nothing of theirs in reach" — rather than implying every free slot is usable, which is exactly the
mistake the headline number invites.

The `startable` set is passed in from `trade-routes.js`, worked out from the projection that tab
already runs, so this module never runs it a second time.

---

## `treasure-tab.js` — filtered and widened

Wraps `TreasureResourceContainer`. The game's own component does the drawing; this wrapper does two
things it cannot.

### `withoutHomelandIdlers(treasureTabData)`

Treasure only ever comes from distant lands, so a homeland settlement in the "not generating" list
is **not a convoy that has stalled** — it is a settlement that was never going to produce one.
Listing every one of them buries the handful that can be fixed.

⚠️ **Only the section flagged `generatingConvoys: false` is touched.** A distant-lands settlement
that has stalled still belongs there, and the generating section is left exactly as the model built
it.

### The convoy figures

The game writes "+300 Gold and 60 GDP per convoy once unloaded in your homeland" on every card. The
condition is the same for all of them and never changes, so it is a sentence the eye has to read
past to reach the two numbers it came for. Those move into the tooltip; the numbers stay:

```
+300 (gold)   +60 (gdp)
```

⚠️ Built as **`L10n.Stylize`**, the same component the model uses for this field, because the card
renders whatever it is handed — and `Stylize` spreads any extra props onto its own element, which
is how the tooltip gets attached **without touching the DOM.**

The figures are read back off the settlement (`getProducedTreasureFleetGold` /
`…GDP`): the model composes them into the sentence and does not keep them anywhere else.

### Three to a row, and the "?"

⚠️ Same trap as the trade cards: the visible panel is the `CardFrame` **inside** the card
(`.w-128.min-h-64`), not `.focusable-card-activatable`. The gap lives **inside** the card as
padding on a border-box, so the three still add up to the full width — as a margin it would push
the third card onto the next row.

Clicking a card runs `Camera.lookAtPlot` and nothing else, so **the map moves behind a screen that
stays open**. Nothing on screen says so, and the natural reading of a card that visibly responds to
a click is that it took you somewhere — hence the "?" beside the tabs. It is idempotent, because
the tab row belongs to the screen and survives a tab being left and re-entered.

The stylesheet is scoped **by lifetime rather than by selector**: its rules are written for these
cards and would reach others, so they exist only while this tab does.
