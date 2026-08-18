# Changelog

Notable changes to **Better Commerce Screen UI**. Newest first.

⚠️ **There was no changelog before 1.3.** Earlier releases are not recorded here, and nothing
below should be read as the mod's full history — it is the history from 1.3 onwards.

## 1.5

### Added

- **Propose "Improve Trade Relations" and buy a Merchant, both from a limit-blocked trade route
  card.** Every card in the "one trade slot away" group under **unavailable trade routes** now
  carries a button of its own, priced in **both** Influence and Gold. One click:
  - proposes the treaty with that leader — **the same action the Diplomacy screen offers**, via
    `ui/engine/diplomacy.js`;
  - buys a Merchant and sends it **regardless of whether the treaty is accepted**;
  - the Merchant opens the route itself the moment a slot exists, whether it came from this
    treaty, a later one, or nothing this mod did at all.
  - **Both costs are checked before the button lights up** — the treaty's own eligibility (once
    proposed, the next attempt costs more; a cooldown follows a refusal; the leader must be met
    and not at war) through the same `canStart` the game's own diplomacy hub calls, and enough
    Influence and Gold in the bank. Short of either, the button goes dark with both prices still
    on it, and the tooltip says which is short.
  - **The treaty can be refused** — proposing it is not the same as it taking effect, and this
    mod does not pretend otherwise. Nothing here waits to find out: the purchase goes ahead
    regardless, because the Merchant already knows how to wait on an uncertain outcome.
- **A blocked trade route's title tooltip now says why.** Out of range, at war, or your Trade
  Route capacity with that leader is full — in the game's own wording, the same explanations
  its own card overlay already carries further down, just easier to find. A route blocked for
  more than one reason at once lists all of them.
- **The capacity warning can now fix the thing it warns about.** It carries an Influence price
  next to the attention mark and proposes "Improve Trade Relations" with that leader directly
  on a click, the same treaty the limit-blocked button offers — without also buying a second
  Merchant, since this card already has its own gold button for that. When the treaty is not
  currently on offer — short of Influence, on cooldown, or the pairing does not have it at all
  — the click falls back to opening diplomacy, exactly what this button always did before.

### Fixed

- **"Factories first" ignored how many copies of each Factory Resource the pool held**, which
  showed up worst with a single factory: instead of starting it on whichever kind had the most
  copies waiting, it read as picking one at random. `factoryStockByType` was keying its stock
  count by the wrong map key (`groupByResourceType`'s compound `type|import`/`type|ours` key,
  read straight into a variable named `type`) while every lookup in `factoryFirstScore` asked
  for the bare resource type — so the lookup missed every time, stock silently read as 0 for
  every kind, and the tier fell back to plain yield value with no notion of stock at all.
- **"Already running this Diplomatic Action with this Leader" did not say for how long.** On a
  trade route card that is the whole question — the tooltip now says **this turn**, which is
  exact: `diplomacy-actions.xml` gives Improve Trade Relations `BaseDuration="0"`, so it
  resolves at the end of the turn it was proposed in and the next attempt is never further off
  than that. Swapped by localisation *key* before the text is composed, so it stays translated
  in all twelve languages, and only on this mod's own cards — the game's own key is untouched
  and still reads the general way everywhere else in diplomacy.
- **The Trade Routes tab could be dragged sideways**, so the cards drifted left and right
  under the cursor. It now scrolls up and down only. The drift had something to reach for
  because the header naming a group of unavailable routes was 0.6rem wider than its row —
  `box-sizing: border-box` covers padding and border but never margin, so its full-width rule
  plus its own side margins overhung the line. The inset is padding now, and the text sits
  exactly where it did.
- **Buying a Merchant killed the tooltips on every other card pointing at the same
  settlement** — which on screen read as "the tooltips stopped working on that one leader's
  cards", because the several cards naming one settlement are necessarily all that leader's.
  Each card's buttons file their framed tooltips under a *scope*, which is the bucket its
  rebuild disposes — and the scope was keyed by the **target settlement**.
  `projectPossibleTradeRoutes` returns one route per *pairing*, so every settlement of ours in
  reach of the same foreign settlement gets its own card naming that same target: those cards
  all shared one bucket. A redraw of any one of them disposed the lot, then remounted only its
  own, so only the last card rendered for a given settlement kept a live tooltip. The scope is
  now a serial issued per button stack, which is what the comment above it always claimed it
  was. A stack discarded without a redraw (a route that stops being actionable) now disposes
  its tooltips before it goes, too.
- **A route's own card never noticed its Trade Route capacity had changed** — proposing and
  winning "Improve Trade Relations" left the card offering to propose it again until the whole
  Commerce screen was closed and reopened. This mod's own cache now clears on `DiplomacyEventEnded`
  and `DiplomacyQueueChanged` as well, so a button on that card switches to the right flow on
  the next redraw. ⚠️ The card's own SECTION still cannot move without reopening the screen —
  `commerce-screen-model.js` builds the trade route list exactly once, when the screen's model
  is created, and nothing in the base game ever rebuilds it again while that screen stays open;
  see the note on `ROUTE_EVENTS` in `trade-routes.js`.

## 1.4

### Added

- **The "unavailable trade routes" section now opens by default.** The game draws it closed,
  which hid both the two groups this mod splits it into and the new sort tabs.
- **Filter tabs above each trade route section.** The screen's own tab strip, in miniature, at
  the top of "available" and "unavailable" alike — one tab per yield. Picking one shows **only**
  the routes carrying at least one resource of that kind, the richest first.
  - **Balanced** is the default, hides nothing, and puts the routes carrying the **most
    resources** at the front.
  - **Only the tabs worth offering are drawn** — the strip is built from the resources actually
    in reach this turn, so there is no tab that would hide every card.
  - **Food**, **Production**, **Gold**, **Science**, **Culture** and **Influence** reorder the
    cards by how many of the route's resources pay that yield. A **camel** tab counts the
    resources that carry their own settlement slots (hidden in the Modern age, which has
    none), a tab counts **Empire resources**, and in the Modern age one more counts **Factory
    resources**.
  - Within a tab, more of what it counts wins; between equals, the route carrying more in
    total.
  - Each section keeps its own choice — sorting the available routes by gold says nothing
    about how the unreachable ones should be ordered.
  - Routes that are **already running** get no strip — the capacity is already spent, and the
    tabs are a question about what to spend it on next.

- **Buy a merchant straight from a trade route card.** Every route in "Available trade routes"
  now carries a gold button beside the leader's portrait with the merchant's price on it. One
  click buys a merchant in the settlement the route is measured from and sends it to the other
  empire's settlement; it walks there on its own and **opens the trade route itself** as soon
  as the game allows it, including on the turns after the Commerce screen has been closed.
  - If that settlement cannot sell a merchant, the nearest one that can does instead, and the
    tooltip names it.
  - Not enough gold, or a settlement that cannot buy: the button goes **dark with the price
    still on it** rather than disappearing, and the tooltip says which it is.
  - **One errand per settlement at a time.** While a merchant of yours is walking to that
    settlement the button is disabled and the tooltip says so — and only that; the sentence
    about the purchase it would otherwise make is about an action that is not on offer.
  - **A warning under the price when the slot is already spoken for.** Trade capacity is
    counted per leader, so with one slot free and a merchant already walking to one of that
    leader's settlements, every other card of theirs still reads as available — and would sell
    you a second merchant into a slot that is taken. Those cards now carry an attention mark
    that says so, in the tooltip as well, and clicking it opens **diplomacy with that leader**
    where the capacity can be raised. It never blocks the purchase: relations change while a
    merchant walks, and that gamble is the player's to take.
  - **A map pin under the gold button** while a merchant is on its way: it closes the Commerce
    screen and takes you straight to that merchant on the map. It shares the slot with the
    warning above — the two can never apply at once.
  - **Clicking a leader's portrait opens diplomacy with them**, on every card in the tab.
  - Tooltips throughout are the game's framed ones, the same as the buttons on the Resources
    tab, and every one that sits on a button now says plainly that it can be clicked.
  - **Merchants that never arrive are tracked.** One lost at sea, killed or disbanded has its
    order dropped, so the card stops claiming that help is on the way and the button comes back
    by itself. Cards refresh on that the moment it happens, not on the next time something on
    screen moves.
  - No confirmation dialog, deliberately: the game's own production list buys with one click
    too, and the price is on the button before it is pressed.
  - The continuation logic — try to sign the route first, walk on only when the engine refuses,
    three attempts per merchant per turn — follows **Holistic QoL+**, whose merchant-route patch
    solves the same problem and documents the freeze that the attempt cap prevents.
- The **Empire** filter tab now counts **Treasure Resources alongside Empire ones** — the same
  pairing `ui/planner/facts.js` already treats as one kind of thing, since a resource is
  TREASURE instead of EMPIRE in some ages purely because a patch rewrote its class (Gold is
  EMPIRE in Antiquity, TREASURE in Exploration).

### Fixed

- **Hardwood's card showed raw, unrendered markup** — `[icon:YIELD_PRODUCTION]`,
  `[TIP:...]...[/tip]` — instead of an icon and a tooltip, reported as "missing labels on
  Hardwood". Its production bonus uses an effect (`EFFECT_PLAYER_ADJUST_UNIT_PRODUCTION_PER_RESOURCE`,
  a percentage towards naval or civilian units rather than a building) that
  `ui/planner/empire-effects.js` had no branch for, so the card fell all the way through to
  the game's own description — composed but never stylised. It now has a proper branch and
  shows a normal "+X% towards Naval/Civilian Units" total like every other resource.
  - The fallback path itself is fixed too, for any future effect this mod does not yet total:
    it renders with `Locale.stylize`, the same call the game's own tooltip renderer makes for
    this exact kind of text, instead of composing into plain `textContent`.
- **The "no Trade Route slot" tooltip named the wrong fix.** It said "better relations earn
  another slot", which is not how trade capacity actually rises — a specific diplomatic
  action, **Improve Trade Relations**, does. The tooltip now names it.

## 1.3

### Added

- **"Imports first" switch**, in the button bar above "Factories first" — offered in **every** age,
  off by default. With it on, Resources that reached you over a Trade Route from another leader are
  assigned before any of your own, and only into **Cities**.
  Why it can pay: towards an **Economic Victory** a Resource slotted in a City is worth +1 GDP per
  turn and an imported one is worth +1 more on top — twice as much as your own — while neither pays
  anything in a Town. The tooltip says as much, and says plainly that it is **not** worth it for
  any other victory type: it outranks every Settlement's own priority, so until the last import is
  placed your Cities take whatever the trade network supplies rather than what you specialised them
  for. Order within the imports: what the City was told to make, then production, then Cities with
  no specialisation of their own, then anywhere else.
- **"Prioritise Happiness" setting** (Options → Mods, above automatic assignment). The rescue
  tier — which lifts settlements out of negative Happiness before doing anything else — can now
  be set to **Never**, **Cities only**, or **All settlements** (the default, and the previous
  behaviour). It outranks factories, camels and each settlement's own priority, so it is the
  largest single thing the mod does to a layout and it should not have been unconditional.
- **"Build a Culture Settlement automatically"** and **"Build a Gold Settlement automatically"**
  (Options → Mods, both on by default). Turning either off skips that pile entirely.
- **"Skip the assignment prompt when nothing fits"** (Options → Mods, on by default). Turning it
  off leaves the game's end-turn prompt exactly as the game raises it.
- Automatic assignment now also triggers on **taking an enemy settlement**
  (`CityTransfered`, `ConqueredSettlementIntegrated`), on **wonders being completed**, on new
  settlements, and on the empire's **resource capacity changing** — so finishing a Marketplace or
  a Colossus is a cue, not just acquiring a resource.
- **A running GDP total** beside the switches, with the economic victory-point icon: roughly how
  much your assigned Resources earn per turn, broken down in its tooltip into what comes from
  Resources in Cities, the extra from imported ones, Factory Resources, and Gold buildings. It
  updates as you assign. Gold buildings are counted only for the **current age** — a Market stops
  paying in Exploration — except the ageless ones, which always count.
- `knowledge-base/27-resources.md`: what every resource pays and under what condition, per age,
  generated from the game's own data.

### Changed

- **Every tooltip this mod adds is now drawn in the game's framed style**, with sections split
  into separate cards instead of one block of text: the three buttons, the "?" shortcut list (one
  shortcut per card), both switches and the GDP total. They also float a little clear of the
  control instead of sitting flush against it.
- **The Empire and Factory tabs now draw the game's framed resource tooltip** — the class header,
  the resource in its frame, its name and description, exactly as the unassigned pool draws it.
  They used to show the same words in a plain box, so one resource looked like two different
  objects depending on which tab you hovered it on. Underneath it, **a card per leader**: their
  portrait, how many copies came from them, and which of their settlements — so nothing is lost and
  the origins are easier to read than the indented text list they replace.

- **Resources are no longer judged "specially suited" to a settlement that gets their weaker
  variant.** The game writes an either/or bonus as two gated modifiers, the second the inverse of
  the first — Fish is +8 Food *with* a Port and +4 *without* one — and both branches read as "a
  condition is met". Fish at +4 was therefore being ranked above Sugar at a flat +8 and sent to
  portless towns. A bonus now only counts as conditional when the settlement gets the **best**
  amount that resource can pay for that yield. Also affects Furs, Pearls, Silk, Tobacco and
  Truffles in Modern, and Tin, Wild Game, Gypsum, Kaolin and Pearls in the earlier ages.
- **"Balanced" now means Production in a City and Food in a Town**, instead of "whichever yield
  the settlement has least of". A settlement you have never touched also **shows** Balanced in the
  priority picker now, rather than showing Production as though you had chosen it. Both of the
  picker's tooltips — the one on the button and the one on the Balanced option — were rewritten to
  say so, in all twelve languages.
- **The culture and gold piles gather every resource that pays those yields**, not just Turtles,
  Silk and Jade. Mangos, Flax, Wine, Incense, Cowrie, Rubies, Silver, Cloves and anything else the
  age offers now go where they compound. Settlements with a priority of their own are still served
  first.
- **Factories first packs by capacity.** When starting an empty factory it now weighs how many
  copies would actually *fit*, not how many are waiting — so the most plentiful resource goes to
  the roomiest factory instead of being started in the smallest one and stranding the rest.
- **Automatic assignment runs the same code the buttons run.** It used to have its own copy of
  the placement call, its own "is a pass running" flag and its own "empty every settlement", any
  of which could collide with a button press mid-run.
- **One implementation of "empty every settlement"**, shared by Reassign All, Unassign All and the
  automatic rebuild. It sends the game's own bulk `Clear` operation, waits for the engine between
  settlements, and falls back to releasing one resource at a time if the bulk form is refused.
- Every placement now writes one diagnostic line naming the **tier** it won on and whether the
  resource was imported, instead of only the happiness rescue doing so. The same board can be
  produced by four different rules, and it was not possible to tell them apart from outside.

### Fixed

- **The end-turn prompt is now also hidden when the only thing left is a Factory Resource and no
  Settlement with a free slot has a Factory.** The engine accepts that pair — it just does
  nothing useful — so the prompt kept insisting there was something to do.
- **The Commerce screen no longer shows a stale layout after a run.** Assignments were being made
  faster than the screen could take them in: it updates one resource at a time from an event that
  only ever holds the most recent one, so events arriving in the same tick overwrote each other
  and those resources were never drawn. The assignment itself was always correct — closing and
  reopening the screen showed the real layout — which made it look like a placement bug. The loop
  now leaves one frame between placements while the screen is open (and still runs at full speed
  when it is closed), and reconciles the two afterwards.
  The **unassigned list on the left** needed more than pacing: unlike the settlement cards, which
  re-read live state on every event and heal themselves, a row there is removed only by the event
  naming that exact resource — so a single missed event left a resource shown as unassigned after
  it had been placed, for as long as the screen stayed open. Those stale rows are now removed
  outright.
- **Automatic assignment now checks periodically, so a missing engine event can no longer disable
  it.** Improving a tile by letting a city expand onto it raises no "build completed" event — that
  one is for the production queue — so that case produced no trigger at all. Rather than keep
  guessing at event names (this was the third such gap), the watcher now also looks every 15
  seconds. The events keep it feeling instant; the sweep makes it reliable. `ConstructibleAddedToMap`
  and `ConstructibleChanged` were added too, so the common case stays immediate.
- **Automatic assignment no longer loses a trigger that arrives at a bad moment.** If the Commerce
  screen was open, or a button was mid-run, the arrival was dropped and nothing rescheduled it —
  and closing the screen raises no event, so the pass waited for the next turn or the next
  acquisition. Since the ordinary workflow is to be *in* the Commerce screen when a resource
  lands, this was the likeliest reason for the feature appearing to do nothing at all. Triggers
  are now held and retried until the way is clear.
- **Every automatic mode still waits for something to actually happen.** The modes differ in how
  much of the pool an arrival is a cue to tidy — not in when they run. Loading a save assigns
  nothing: nothing happened, and a pool you left full is a pool you left full.
- **Empire and treasure resources are no longer treated as things to assign.** They are never
  placed in a settlement — they pay for being held, or turn into treasure fleets — and the game's
  own screen leaves them out of the unassigned pool. With the Commerce screen open the mod read
  the game's list and behaved correctly; with the screen closed it built its own and did not.
  Nothing was ever assigned wrongly, but acquiring one (Gold in Antiquity, say) handed automatic
  assignment a "new resource" it could never place, and it then retried that arrival on every
  trigger for the rest of the game. Which resources these are **depends on the age** — Gold is an
  empire resource in Antiquity and a treasure resource in Exploration — so it is read from the
  resource's class in the loaded age, not from a list.
- **One settlement holds the Culture role and one holds the Gold role, and the role moves on when
  that settlement fills up.** The Gold pile used to have no target at all: it scored every city
  that was not the Culture city, weighted by that city's own Gold — which spread Gold resources
  around instead of building a Gold settlement, and cost slots elsewhere: Jade reached the
  gathering tier in the capital while Silk, not being the capital's pile, could not, and stayed
  in the pool. Cities are now ranked **once per run** rather than re-picked before every single
  placement (which let a pile hand itself to a rival city halfway through and end up split
  between two settlements), and the role passes down that ranking as each settlement runs out of
  room, so a Culture city with two free slots no longer lets the other twelve Culture resources
  scatter.
- **The end-turn "Resource Assignments Available" prompt is no longer suppressed when automatic
  assignment is switched off.** Hiding it only makes sense when the mod has already placed the
  resources for you; with the setting off, the prompt is telling you something you still need to
  act on.
- Unassign All is now covered by the same "one run at a time" guard as the other two buttons.
