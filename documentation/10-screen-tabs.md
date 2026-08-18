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
| `dock-resource-button.js` | 212 | the HUD dock's Resource Allocation button: colour and pulse |
| `treasure-tab.js` | 212 | the Treasure tab, wrapped, filtered, and its two controls |

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
`routesByCityName` and invalidated on `TradeRouteAddedToMap`, `TradeRouteChanged`,
`LocalPlayerTurnBegin`, `DiplomacyEventEnded` and `DiplomacyQueueChanged` — the last two solely
for a proposed "Improve Trade Relations" treaty resolving, listened for the same way
`panel-diplomacy-actions.js` itself does.

⚠️ **This cache clearing does not move a card between sections.** It only makes THIS MOD's own
`route.status` — read live from the engine on the next rebuild — correct again, so a button
this mod draws on that card switches to the right flow straight away. The card's own SECTION
stays wherever the game drew it: `commerce-screen-model.js` builds `tradeRouteTabData` exactly
**once**, when the screen's model is created, and nothing in the base game ever rebuilds it
again for the life of that one screen-open — not on any event, not on a timer. Moving the card
to reflect new capacity would mean moving it between two different `<For>`s over two different
arrays, which `reconcileArrays` cannot survive being done to from outside Solid; see the ⚠️ on
`reorderCards`. The only way the card's own section updates is closing the screen and opening
it again — true in vanilla play as well, with or without this mod.

⚠️ The tooltip goes on the **text**, not the row. On the row it also answered for the icons, so
hovering the domain icon showed the route name instead of what that icon means.

The class and the tooltip are re-applied **every pass**: they are ours, but the row is Solid's and
a redraw takes both with it.

#### Why a blocked route is blocked

On a card that is neither startable nor already running, the title tooltip gets a second
paragraph: the reason, **in the game's own words**.

⚠️ **Not written here.** `blockedReasons` reads three keys straight out of
`CommerceScreenText.xml` — `LOC_COMMERCE_TRADE_STATUS_CAPACITY_TOOLTIP`,
`_IN_RANGE_TOOLTIP`, `_AT_PEACE_TOOLTIP` — the exact explanations the game's own card overlay
(`CommerceCriteriaDisplay`, fed by `getTradeRouteDataFromTradeRoute` in
`commerce-screen-model.js`) already shows on hover, further down the same card. This mod does
not invent a second wording for something the game already explains; it puts the explanation
somewhere a player is more likely to see it — the title, not three small lines at the card's
foot.

⚠️ **No "inapplicable" branch needed.** The game's own model marks a criterion inapplicable
when a civ trait waives it, but that case never reaches `route.status` at all — the engine
simply leaves the flag out of the array once a trait bypasses it. A flag present in
`route.status` is always a real block, so `blockedReasons` only ever needs the plain
explanation, never the "although you would not ordinarily…" variant.

⚠️ **Composed, never stylized**, and set on the plain `data-tooltip-content` attribute rather
than a framed tooltip. That attribute's own renderer stylizes whatever is in it — see the note
on `TOOLTIP_TEXT_SELECTOR` in `trade-summary.js`, which also supplies the `white-space:
pre-wrap` these line breaks need to actually break. Stylizing the text here as well would
double-process the `[STYLE:...]` markup the "at war" reason carries.

A route can fail more than one criterion at once — blocked by both range and a war, say — and
every applicable one is listed, in the order the game's own overlay uses: capacity, range,
war.

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

### ⚠️ Decorate on a FRAME, never straight from the observer

A `MutationObserver` callback runs as a **microtask**, and so does Solid's effect queue — the
two interleave. Decorating straight from the observer therefore inserted and moved nodes **in
the middle of a render Solid had begun and not finished**, and its next `reconcileArrays` found
a DOM its own bookkeeping did not describe:

```
Error: NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

On screen that read as **a first visit to the tab with no leader portraits and none of this
mod's buttons**, both back on the second visit — the render had died halfway, and the next one
started from a clean DOM. Nothing in the symptom pointed at timing.

`scheduleDecorate()` coalesces every trigger — the observer, the orders-changed event, the
component's own `onMount`, a click on a group header — into one `requestAnimationFrame`, which
runs after the microtask queue has drained. The screen is not reactive to this mod's work
either way, so the frame costs nothing.

> The other observer-driven modules on this screen (`settlement-controls.js`,
> `assign-all-buttons.js`) still decorate synchronously. They have shipped that way since 1.3
> without this failure, but they are the same shape and the same trap is open to them.

### ⚠️ NEVER MOVE A CARD

The cards are rendered by Solid's `For` over `section.tradeRoutes`, and **Solid keeps its own
record of which node sits where**. Move one — into a container of this mod's own, or just past
its neighbour — and that record becomes a lie. The next reconcile throws, and it takes the rest
of the screen's rendering with it:

```
Error: NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
    at reconcileArrays (core/vendor/solid-js/web/dist/web.js:489)
```

That is from `UI.log`, and the symptom on screen was **every tooltip dead and none of this
mod's card buttons drawn** — nothing pointed at the sort or the grouping at all. A sibling
error, `replaceChild ... is not a child of this node`, arrived on closing the screen.

Reading `reconcileArrays` explains exactly what is and is not allowed:

| Action | Safe? | Why |
|---|---|---|
| Inserting an element of ours between the cards | **yes** | the algorithm only ever references its own nodes, and ours stays a child of the same parent |
| Reordering the cards in the DOM | no | Solid's `a[]` no longer matches the DOM, so its `nextSibling` references point at the wrong places |
| Moving a card into a container of ours | **never** | `a[x]` is no longer a child of the row at all, and both `insertBefore` and `replaceChild` throw |

Sorting the model's array instead is the **second** trap, and it hangs the game outright. The
tab keeps an effect of its own:

```js
createEffect(() => {
  props.tradeRouteSections.forEach((s) => s.tradeRoutes.sort(sortFunction()));
});
```

It **reads** those arrays, so writing to one wakes it; it sorts them back; that is a DOM change;
the observer calls this mod again; which writes again. Opening the Trade Routes tab froze the
game on the spot.

So ordering is done **inside the row**: the cards are re-inserted in the wanted order, before
whatever followed the last of them, and every one of them stays a child of the same row.
Filtering is a class that hides the card. Neither writes to the model, so the tab's effect has
nothing to react to.

⚠️ `order`, the flex property, is written as well — and it was tried **first**, as the mechanism
that touches nothing at all. It appears nowhere in the shipped game, and the routes did not
visibly reorder while it was the only mechanism, so this renderer very likely ignores it. The
style stays because it costs nothing and is the right answer if it is ever honoured.

⚠️ Reordering **within the row** is not the thing that crashed. Read `reconcileArrays`: every
reference it takes is one of its own nodes or that node's `nextSibling`, so while each card is
still a child of the same parent, `insertBefore` and `replaceChild` both find their targets.
What broke it was a card moved into a container of this mod's own — a different parent.

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

⚠️ The card measured is one that **carries the buy buttons**, when there is one. The width is a
single rule for every card, and the corner it is measured against is not the same width on all
of them: the first card in the document is often in the "already running" section, which has no
buttons, and the title line was then given room that ran straight underneath the gold button on
the cards that do have it. Found with a loop, not `:has()` — this renderer is not a browser, and
a selector it does not implement matches nothing silently.

⚠️ It writes to a stylesheet in `<head>`, **never to the cards**, so it cannot feed the
`MutationObserver` watching them — and only when a figure actually changes, so a resize settles
instead of oscillating. Capped at `MAX_REMEASURE_ATTEMPTS = 40`.

### The gold button — `trade-buy-merchant.js`

```
[hex] [sea]  MEKKA → BOGDAN            [325 gold] [leader]
```

One click for the whole sequence the card otherwise only hints at: buy a merchant in the
settlement the route is measured from, walk it to the other empire's settlement, and open the
route the moment the engine allows it. The journey is looked after by
[`ui/engine/merchant-orders.js`](05-engine.md); the tab only draws the button.

- **On startable cards, and on cards blocked by nothing but the trade limit** — the latter get
  the propose-and-buy variant below. On a card blocked by distance, or already running, the
  merchant would arrive to nothing this mod can promise, so those keep no button at all — the
  reason is already written across them.
- **Dark, not hidden, when the settlement cannot sell.** A price that cannot be paid is still
  the answer to "what would this cost", and the tooltip says which of the two reasons it is.
- **No confirmation dialog**, deliberately: the game's own production list buys with one click
  too, and the price is on the button before it is pressed.
- Where the merchant is bought is the route's own `nearestCityId` first, and the nearest
  settlement that *can* sell one after that. The settlement that ends up buying is **named in
  the tooltip** rather than left to be discovered.
- **A merchant already walking there disables the button**, and a second button appears under
  it: a map pin that **closes the screen and takes the player to that merchant**. One errand
  per settlement at a time. If the merchant is lost on the way, the order is dropped and the
  button comes back on its own — see the pruning pass in [`merchant-orders.js`](05-engine.md).

- **A warning under the price** when that leader's trade capacity is already spoken for —
  every route running plus every merchant on its way to *any* of that leader's settlements. It
  does not disable anything: relations change while a merchant walks, and a player is entitled
  to gamble on that. The same sentence is added to the price tooltip as its own card.
  - **It carries the fix, not just a link.** Priced in Influence next to the attention mark,
    it proposes "Improve Trade Relations" with that leader directly — the same treaty the
    limit-blocked button offers, minus the merchant purchase, since this card already has its
    own gold button for that. `warnActionText` cascades the same way `improveTooltip` does:
    ready shows the one-click fix; anything else falls back to what this button always did —
    open diplomacy with that leader — and says so.
  - ⚠️ Redraws its own stack **synchronously** right after proposing, not on the next decorate
    pass: `proposeTradeRelations` is not async like a purchase, so there is nothing to wait
    for — the new price and readiness are already known the instant it returns.

⚠️ The warning and the map pin share one slot under the price and are never both there: a
warning is only raised when no merchant of ours is walking to that settlement, which is exactly
when there is nothing to fly the camera to.

Tooltips are the game's framed ones, the same as the buttons on the Resources tab; see
`framed-tooltip.js`.

⚠️ Diplomacy is opened by dispatching the game's own `RaiseDiplomacyEvent` on `window` — the
diplomacy manager listens for it — rather than by importing the manager. The screen is popped
first: the hub is an interface mode over the map, not a panel that opens behind a screen.

**The leader's portrait opens the same thing**, on every card including the ones nothing can be
bought on — "who is this and can I fix it" is the question a blocked card raises hardest. The
relationship tooltip behind the portrait is untouched; only the click is added.

The buttons are centred on the portrait's middle and on each other: the price is wider than the
pin, and a ragged left edge showed it.

⚠️ **One state, one tooltip.** While a merchant is on its way the button does nothing, so the
tooltip says only that — printing the sentence describing the purchase underneath it describes
an action that is not on offer.

⚠️ The stack is **rebuilt, not patched**, whenever the generation changes. A framed tooltip is
a Solid component built around its trigger; there is no "set the text" on one.

⚠️ Which means each card's tooltips get **their own scope**, disposed before the elements they
are anchored to are thrown away. A frame left mounted around a discarded trigger has nothing to
measure against and the game draws it in the **top-left corner of the screen** — which is what
a click on the buy button did before the render functions (`renderAvailableStack`,
`renderImproveStack`) started disposing first. The tab's teardown passes the bare scope and
takes every card's with it; `disposeFramedTooltips` matches by prefix. The sort strip does the
same, one scope per section.

⚠️ **That covers this mod discarding a tooltip on purpose. It does not cover Solid discarding
one without asking** — which happens whenever the game's own trade route list rebuilds a card,
and left unhandled once stopped every tooltip on the whole tab, not only the one on the card
that vanished. A framed tooltip's `createRoot` lives outside Solid's own tree by design (see
the file note in `framed-tooltip.js`), so Solid removing an ancestor never calls its
`onCleanup` — the tooltip stays registered in the game's own tooltip stack
(`TooltipModel` in `core/ui-next/components/tooltip.js`, which tracks *active* tooltips by
name) with no trigger left to hover away from, and a name that can never come off that stack
blocks whatever was meant to follow it. `appendWithFramedTooltip` now marks every mount it
builds with the scope it belongs to; the tab's own `MutationObserver` calls
`disposeOrphanedTooltips` on every node in `removedNodes` **before** scheduling anything
else, so a card Solid tears down takes its tooltip's registration with it the same turn.

⚠️ The in-flight flag lives in a module-level set keyed by TARGET SETTLEMENT, not on the
button — the stack is rebuilt from scratch on every change, and a flag on the element would be
thrown away mid-purchase and let a second click through. The click also redraws its own stack,
because a click is not a DOM mutation and nothing else would wake the observer up.

⚠️ **That redraw is deferred one frame (`deferRedraw`), never done inside the click handler
itself.** A redraw disposes the framed tooltip mounted on the very element the click came
from, and disposing it BEFORE `bindActivatable`'s own handling of that click has finished —
it calls `element.blur()` right after the callback returns — tore the trigger out of the
document mid-handling. Nothing here threw; `UI.log` stayed clean, because the breakage was in
the game's own tooltip stack (`TooltipModel`), not this mod's code: a registration left with
no live trigger to answer for it blocked every tooltip queued up behind it on the whole tab,
not only the one on the button that was clicked. `requestAnimationFrame` runs once the current
script has fully yielded, giving the click's own handling an uninterrupted turn first.

⚠️ The map pin uses `ContextManager.pop("screen-resource-allocation")` — the same call the
screen's own close button makes (`ScreenFrame`, the ContextManager close handler). Moving the
camera behind an open screen is what the treasure cards do, and the "?" on that tab exists
because players could not tell it had happened.

⚠️ The tab also listens for `MerchantOrdersChangedEventName` on `window`. A merchant lost at
sea changes what a card should say and **disturbs nothing on screen**, so the MutationObserver
never fires — without that listener the card would go on offering to wait for a merchant that
has drowned.

#### The propose-and-buy button, on limit-blocked cards

```
[hex] [sea]  MEKKA → BOGDAN      [🏛 12] [💰 325] [leader]
```

The "one trade slot away" group under **unavailable trade routes** — every card blocked by
nothing but the trade limit — carries a wider variant of the same button: two prices, Influence
first. One click:

1. proposes **"Improve Trade Relations"** with that leader — [`ui/engine/diplomacy.js`](05-engine.md);
2. buys a merchant and sends it, **regardless of whether the proposal is accepted**;
3. the merchant opens the route itself once a slot exists, from this treaty or anywhere else.

⚠️ **Step 2 does not wait on step 1.** They are independent engine operations — a treaty
proposal and a city purchase — and neither depends on the other having resolved. Waiting would
only delay the one part of this that is not in question; see the file note in `diplomacy.js`
for why the treaty's outcome is never chased.

⚠️ **No warning variant here**, unlike the available flow above. The warning exists to catch a
*second* purchase on a card that still reads as open; a limit-blocked card never reads that way
to begin with — there is nothing here to warn about that the card is not already saying.

⚠️ **Ready requires both prices**, and re-checks the treaty fresh at the moment of the click
(`proposeTradeRelations` calls `canStart` again itself) rather than trusting the cached offer a
render pass ago priced it with — Influence spent on something else since would make that stale.
Buying still goes ahead even if the proposal is refused at that final check: the merchant does
not need it to have succeeded, only to eventually be accepted by *someone*.

⚠️ Measuring the corner's width (`widestCornerCard` above) prefers a card carrying **this**
button over one carrying the plain gold button, because it is wider — two prices, not one.
Picking whichever stack came first in the DOM would under-measure a row holding both kinds and
put the title back under the wider button on the limit-blocked cards, the exact overlap that
measurement exists to prevent.

⚠️ The button lives **inside the leader's corner**, which this mod flips to `row-reverse` so
that an appended child lands to the *left* of the portrait. That is why it is appended rather
than inserted first.

⚠️ It is decorated **before** the "already decorated" check on the title row. The corner and
the row are rebuilt independently by Solid, and a card whose row survived a redraw would
otherwise never get its button back.

⚠️ The price is re-read rather than closed over: the unit's cost progression counts the copies
already bought, so the price of the *next* merchant is not the price of the last one. A
generation counter, bumped by `forgetMerchantOffers()`, keeps that re-read to once per change
instead of once per DOM mutation — asking `canStartQuery` per card per mutation is the shape
of pass this mod has been slow for once already.

### The sort tabs — `trade-sort-tabs.js`

Each section that is still a decision — "available" and "unavailable" — carries a small tab
strip above its cards, one tab per yield:

```
[balanced] [food] [production] [gold] [science] [culture] [influence] [camels] [empire]
```

A tab **filters and then orders**: pick Production and the section shows only the routes
carrying at least one Resource that pays Production, the one carrying the most at the front.
Balanced filters nothing and orders by total. The camel tab counts resources that carry their
own slots; the empire tab counts resources of the `RESOURCECLASS_EMPIRE` **or**
`RESOURCECLASS_TREASURE` class, and the factory tab (Modern only) counts `RESOURCECLASS_FACTORY`.

⚠️ **Empire and Treasure are one tab, not two.** `ui/planner/facts.js`'s
`UNASSIGNABLE_CLASSES` already treats them as the same kind of thing — both are held rather
than slotted — and a resource is TREASURE instead of EMPIRE in some ages purely because a
patch rewrote its `ResourceClassType` (Gold is EMPIRE in Antiquity, TREASURE in Exploration).
A filter keyed to only one class would quietly stop finding the same resource across an age
transition.

⚠️ **Only the tabs there is something to filter by are drawn, and per section.** Counted over
every route at once, the available section offered a Science tab because some unreachable
settlement three continents away had a Science resource — and pressing it emptied the section.
A filter belongs to the list it filters. The chosen tab falls
back to Balanced if it stops being offered, or the section would empty itself with nothing on
screen to explain why.

⚠️ **Each section keeps its own choice**, keyed by what the section holds (`available` /
`unavailable`) and **not** by the element it is drawn in — the rows are Solid's and are thrown
away on every redraw, so a choice remembered against one would not survive the next.

⚠️ The camel tab is found by the **`BonusResourceSlots` column**, never by resource name — the
same rule as `ui/engine/resource-slots.js`, so anything a patch gives the property is counted.
It is hidden in the Modern age, which has no such resource: a tab that scores every route zero
falls back to the default order, which reads as the tab being broken.

⚠️ Every score is a **pair**: what the tab counts, then the total number of resources. The
second is not tidiness — a tab nobody's routes can satisfy would otherwise leave the cards in
whatever order they were in. Falling through to "most resources first" means the worst a tab
can do is the default order.

⚠️ **The strip is a copy of the game's tab bar, not an instance of it.** The classes are the
game's own — `img-tab-bar`, `img-tab-end-cap`, `img-tab-selection-indicator` and the
`text-secondary` / `text-accent-1` pair — lifted from `core/ui-next/components/tab.js`.

⚠️ It deliberately does **not** carry `data-name="TabList"` or `data-name="TabListItem"`.
Three modules find the screen's real strip by exactly those attributes (`tab-icons.js`,
`treasure-tab.js`, `trade-summary.js`) and `document.querySelector` takes the **first** match
in the document — a faithful copy would quietly become "the tab strip" for all three.

⚠️ The selection indicator is **measured**, because that is how the game does it:
`TabListComponent` writes `left` and `width` onto it from two bounding rectangles. It is
retried on the next frame while the strip has no width — it is built inside a section that may
still be collapsed, and a measurement taken then pins the marker to the left edge forever.

⚠️ The sort writes the cards back **from the end, before the node that followed the last
card** — not with `appendChild`. The cards are not the only children of a row: the strip is
one, and in the unavailable section so are the two group containers. Appending would move
every card past them, which reads as the cards having jumped into another group.

⚠️ A section of routes that are **already running** gets neither strip nor sort. The capacity
is already spent; the tabs are a question about what to spend it on next.

⚠️ The scores come from `route.resources` — the resource type names read out of
`importPayloads` when the projection is cached — and the yield/class of each type is cached
again in this module. `resourceYieldTypes` scans `GameInfo.Resource_YieldChanges` on every
call: it is written for the assignment pass, which asks about a handful of resources, while
this asks about every resource on every card on every pass.

Sorting runs **after** the grouping, so a card that has just been moved into a group is sorted
inside that group rather than in the row it came from.

### The unavailable section opens by default

`commerce-screen-model.js` gives that section `initiallyCollapsed: true`. That made sense for a
list nobody could act on; this mod splits it into "one trade slot away" and "out of range" and
puts a sort strip on it, none of which is visible behind a closed ribbon.

⚠️ The **data** is changed, not the DOM — `expandTradeSections()` in `trade-routes.js`, called
from the screen's own transcription in `factory-tab.js`, which is where the tab's data passes
through this mod. `CollapsibleContainer` reads the flag once into a signal when it is created;
by the time there is an element to click, the flag has been read, and clicking it from script
would mean forging the engine's input event — `Activatable` ignores DOM clicks.

⚠️ Written **in place**, and only when it differs: the sections are entries in the model's
store, and replacing them with copies would hand Solid a new identity on every read and rebuild
every card in the tab.

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

### Three to a row, and the two controls

⚠️ Same trap as the trade cards: the visible panel is the `CardFrame` **inside** the card
(`.w-128.min-h-64`), not `.focusable-card-activatable`. The gap lives **inside** the card as
padding on a border-box, so the three still add up to the full width — as a margin it would push
the third card onto the next row.

Clicking a card runs `Camera.lookAtPlot` and nothing else, so **the map moves behind a screen that
stays open**. Nothing on screen says so, and the natural reading of a card that visibly responds to
a click is that it took you somewhere — hence the "?" beside the tabs. It is idempotent, because
the tab row belongs to the screen and survives a tab being left and re-entered.

Beside the "?" sits the **send-convoys-home** checkbox (`makeSwitch`, shared with the Resources
button bar via `switch-control.js`). The mechanism it turns off is `engine/treasure-convoys.js`
and the setting is `engine/treasure-return-setting.js`; it is **on** by default.

⚠️ **Both sit in one positioned flex row, not at two hand-picked `left` offsets.** The "?" is a
fixed 2.4rem but the caption beside it is translated, and it is half again as long in German as
in English — an offset computed for one language would overlap the mark or leave a gap in the
others.

⚠️ **They carry their own tooltip scope (`treasure-tab`).** They are torn down whenever the tab is
left, which is sooner than the screen's own teardown, so their frames must be disposed here — and
disposing the *default* scope to do it would take the Resources and Trade Routes tabs' tooltips
with it. That is the exact bug the per-scope split exists for; see
[framed tooltips](11-screen-support.md).

The stylesheet is scoped **by lifetime rather than by selector**: its rules are written for these
cards and would reach others, so they exist only while this tab does.
