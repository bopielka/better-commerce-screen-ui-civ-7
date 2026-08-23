# Changelog

Notable changes to **Better Commerce Screen UI**. Newest first.

## 1.9

Nothing on screen changes in this release. Every feature behaves exactly as it did in 1.8;
what changed is what the mod costs the game while you are playing it.

### Performance

- **The mod no longer listens to other empires' turns.** This is the whole story of the
  release, and everything below is a variation on it. `UnitMoved`, `UnitMovementPointsChanged`,
  `ResourceAssigned`, `ConstructibleChanged` and a dozen more are raised by the engine for
  **every player in the game**, not for you. In a late game an AI turn raises thousands of
  them, and this mod woke up on all of them — walking your unit list, your settlements and
  your resource pool to conclude, almost every time, that somebody else's scout had moved.
  Every one of those subscriptions is now filtered by whose event it is before any work
  starts, which is the same check the game's own `panel-action` opens `onUnitMoved` with.
  - New `ui/engine/events.js` holds that check once. An event whose payload names **no**
    owner is deliberately *not* filtered: dropping a trigger because we could not name its
    owner would trade a performance problem for the kind of silent-gap bug this mod's history
    is full of.
- **Automatic assignment installs nothing while it is switched off — and off is the default.**
  It used to subscribe to twelve engine events and start a fifteen-second sweep at load,
  whatever the setting said, and answer "switched off" only *after* each of those had woken a
  debounce. A player who never turned the feature on was paying for all of it. The watcher is
  now attached and detached on the option itself.
- **A Merchant's standing order costs nothing when there are no standing orders.** Every unit
  event used to start a pass that read every unit you own and asked the engine about each one.
  The pass is now skipped outright unless something is actually under an order, with the start
  of your turn as the unfiltered safety net behind that shortcut.
- **Treasure Convoys are looked after per convoy, not per unit list.** The unit events that
  drive it now check the one unit they name — whose it is, and whether it is a loaded convoy —
  instead of scanning everything you own. With the switch off, nothing is scheduled at all.
- **Four `MutationObserver`s watching the whole HUD became one watching the Commerce screen.**
  They were attached to `document.body` with `subtree: true`, so every tooltip, unit flag,
  notification and yield banner the game repainted woke four separate callbacks that then
  searched the Commerce screen for something to fix. The new shared watcher is scoped to the
  screen's own element, so mutations elsewhere are never delivered, and it runs its
  subscribers **once per frame** rather than once per mutation.
  - It also discards the mutations its own pass produces. Each of the old observers ran twice
    for every real change and only settled because each feature was careful to write nothing
    on the second pass.
  - Every subscriber now gets the `requestAnimationFrame` guarantee that only the Trade Routes
    tab used to have — the one that keeps this mod's DOM work out of the middle of a Solid
    render. See the note on `scheduleDecorate` in `ui/screen/trade-routes.js`.
- **The HUD's Resource Allocation button no longer recomputes on other empires' assignments.**
  Working out whether anything in your pool would go anywhere is the single most expensive
  call in this mod, and an AI tidying its empire used to trigger it once per resource for the
  whole of its turn. It is now filtered by player and coalesced to one pass per frame.
- **`GameCoreEventPlaybackComplete` is only subscribed while something is waiting for it.**
  It fires constantly and about everything; it exists here to close a window of a few hundred
  milliseconds after this mod's own button raises a trade limit. It is now opened then and
  closed on the first event, instead of being left attached for the session.
- **The end-turn prompt filter does its diagnostic bookkeeping only when diagnostics are on.**
  Three engine calls were being made on every refresh of the action panel to build a log line
  that the shipped build never prints.
- **`MakeTradeRoute` is read once per unit type instead of once per unit per pass.** It is a
  column in a static table; it cannot change while the game is running.
- **Settlement names are composed once per assignment run instead of once per placement.**
  They are read for diagnostics only, and a full empire rebuild was composing several hundred
  localised strings for a log that ships switched off.

### Internal — sharing what had been copied

Nothing here changes behaviour. Each item replaced between three and six near-identical
private copies, and in every case the copies had **already drifted** — which is the argument,
not the tidiness.

- **`ui/engine/stored-setting.js`** — one implementation of "read an option, write it,
  checkpoint it, announce the change". Five modules had their own: factories-first,
  imports-first, the two gathering switches, the happiness dropdown and treasure auto-return.
  Every option key and every stored encoding is unchanged, so no setting is lost.
- **`ui/engine/resource-types.js`** — `GameInfo.Resources.lookup(…)?.ResourceType` was written
  out in six places, three of them walking the same list one after another. It is a database
  call for a column in a static table, and the placement loop makes it thousands of times per
  run. Now asked once per resource, and the end-turn prompt's placeability test resolves each
  type once instead of three times.
- **`ui/screen/screen-parts.js`** — the selectors more than one module needs.
  `[data-name="TabList"]` had five copies and `screen-resource-allocation` had five; they are
  the game's DOM, not ours, so "check whether this still matches after a patch" used to mean
  finding all of them first. Also holds the tab-row summary the three rebuilt tabs share.
- **`ui/screen/icons.js`** — `UI.getIcon` and `UI.getIconBLP` throw on a name the atlas does
  not carry, so every caller had grown the same `try`/`catch`; two of them were byte-identical.
- **One deploy script.** There were two, differing only in the default install path, each
  carrying a comment telling the reader to keep them in sync. They were not in sync: the
  Windows copy never received the `STEAM_CHANGELOG.bbcode` size check, so the one platform the
  mod is published from was the one that could not warn about a change note Steam would
  silently truncate. `deploy.sh` now picks the path from `uname`; `deploy-on-mac.sh` is a
  two-line shim, so either command still works.
- **The modifier index is used everywhere it should have been.** `facts.js` was still joining
  `GameInfo.Modifiers` to `GameInfo.DynamicModifiers` by scanning both tables, once per
  modifier, while `effects.js` next door had built that join once for everybody.
- **Documentation caught up with the code**: the support layer's "`DIAGNOSTICS = true` —
  currently ON" (it ships off), a reference to a `screen/factory-first.js` that no longer
  exists, "Resource+'s per-resource locks are not ported" (they are — the padlocks), two
  missing options, per-file line counts that were wrong in every table, and a dependency rule
  that the code has one documented exception to.

### Fixed

- **Leaks that grew for as long as the session did.** Each one was invisible in a short test
  and compounded with every visit to the Commerce screen:
  - The GDP readout subscribed to four engine events every time the Resources tab opened and
    unsubscribed from none, so the pile kept firing long after the screen was closed.
  - The settlement cards added a `click` listener to the whole document on every visit and
    removed none.
  - Closing the Commerce screen before its content had finished rendering left a
    whole-document observer behind permanently, because the only way out of it was finding the
    tab strip.
- **Automatic assignment could not resume after being blocked.** A trigger that arrived while
  the Commerce screen was open, or while another pass was running, was meant to be held and
  retried a moment later — the mechanism the module documents at length. It threw a
  `ReferenceError` instead, from inside a timer, so the trigger was simply lost. This is the
  exact failure the retry was written to prevent: the ordinary workflow, where the resource
  lands while you are still looking at the screen.
- **The fifteen-second sweep no longer arms three follow-up checks every time it finds
  nothing.** Those exist to cover the gap between an improvement finishing and the resource
  reaching your hands. A clock ticking is not an arrival.

## 1.8

### Added

- **"Send a spare Merchant" — a plus beside the price**, on both the Gold button of an
  available route and the Influence-and-Gold button of a limit-blocked one. It appears **only
  while you actually have a Merchant with nothing to do** — one left over from an earlier Age,
  say — and sends that one instead of buying another.
  - A Merchant counts as spare when it carries no standing order of this mod's *and* has no
    journey of its own queued. `Units.getQueuedOperationDestination` is the same call the
    game's own map decoration uses to draw a unit's remaining path, so a Merchant the player
    is steering by hand is left alone.
  - Sending it makes every plus on the tab disappear at once, which is the only correct answer
    when the single spare Merchant has just been spoken for. Nothing refreshes by hand:
    `orderMerchantTo` announces the new order and the tab redraws itself, the path that was
    already there.
  - The card that is already waiting on a Merchant does not offer it — one errand per
    settlement, the same rule the Gold button follows.

### Changed

- **The tooltips on this mod's own controls are the game's framed ones**, everywhere — the
  settlement card's priority, quick-assign and return buttons, the factory button, and the tab
  icons. They were drawing the bare box a plain `data-tooltip-content` produces, while the
  button bar at the top of the screen already used the framed style, so the same actions looked
  like two different kinds of control depending on where you met them.
- **A tab icon's tooltip now says what is on that screen** instead of repeating the tab's name
  in both the heading and the body. The heading answers "which tab is this"; the body answers
  "what will I find there".
- **The settlement card's return button says what it does in this mod's words.** It carried
  the game's `LOC_COMMERCE_UNASSIGN_RESOURCES` — "Return all assignments from the city of
  Berlin", a sentence about *assignments* rather than resources and phrased unlike anything
  else on the screen. It now reads **"Unassign all in Berlin"** with a tooltip underneath, the
  same shape as the "Assign all" / "Unassign all" pair at the top of the screen, because it is
  the same action for one settlement. Reusing the game's own strings is the rule here; this is
  the case where the game's own string is the odd one out.

### Fixed

- **That button ignored resource locks.** It called the model's `clearAllResources`, which has
  no idea locks exist — so a padlocked Resource, safe from the **Unassign all** that locks were
  built for, was swept away by the smaller button one row above it. Two buttons that both say
  "return everything here" now mean the same thing by "everything", and the tooltip says so.
- **A card with a Merchant already on the way drops the price and says when it arrives.** The
  gold button is not merely dimmed there, it is gone: a second Merchant sent to a settlement
  that is already spoken for is not something to offer, and a dark button that can only be
  pressed by mistake is no improvement on no button. The locate button carries the figure on its
  face and the sentence in its tooltip — *"This Merchant reaches its destination in about N
  turns"* — which is where the player is already looking when they wonder about the Merchant.
  - The bare number is on the button and the sentence is in the tooltip: Polish alone needs
    three forms of "turn" depending on the digit, and the button is a few characters wide.
  - ⚠️ A label widens `icon-button.js`, never heightens it. Its fixed height is the one thing
    that module exists to guarantee, and a button that grew to fit a number would un-level the
    row it shares — which is the very fault the component was extracted to end.
  - The figure is the engine's own: `Units.getPathTo` returns a turn per plot, the same numbers
    the game paints along a unit's route, so the last of them is the arrival.
  - In the Modern age there is no journey to measure — the Merchant opens the route from where
    it stands as soon as it has movement, so that is what is counted rather than a walk that is
    never going to happen.
- **An X beside the locate pin calls a Merchant off.** Wherever a card shows the pin — meaning
  a Merchant really is on its way there — it now sits beside a button that stops the journey
  and cancels the errand, without leaving the Commerce screen to find the unit on the map.
  - Both halves are needed: the journey is cancelled (`UNITCOMMAND_CANCEL`, the game's own) so
    it stops walking, **and** the standing order is dropped so nothing sends it out again at
    the start of the next turn. Cancelling alone would be undone a turn later; forgetting the
    order alone would leave it walking somewhere nobody expects it.
  - The Merchant keeps whatever movement it had left and is free to be sent elsewhere — the
    plus button picks it up on the next redraw, which the cancel triggers.
  - ⚠️ **The card beneath no longer sees these presses.** The title row the buttons hang in is
    the card's own `Activatable`, which fires from `engine-input` rather than from a DOM click
    — and `bindActivatable` stops click, mousedown and mouseup, none of which is the one that
    matters. Every press here also ran the card's handler, flying the camera to the settlement
    the route points at; on the cancel button that was unmistakable. One listener on the button
    stack covers all of them.
  - ⚠️ Both icon-only buttons are built by a shared `icon-button.js` with a **fixed** height and
    a fixed icon box. They were previously assembled from the rules meant for the button that
    carries a *price* — which holds an icon and a number, so its padding is deliberately
    lopsided and its height falls out of whatever its contents measure. Borrowed by a button
    holding one icon, that is an off-centre icon and a pair that never quite lines up. It was
    patched three times (symmetric padding, matching icon sizes, the missing mount rules) and
    each fix removed one way for them to differ without removing the possibility; one component
    with one set of numbers removes it.
- **Cancelling a Merchant's journey did nothing to its order in the Modern age.** Two guards in
  the same function blocked each other there: one bailed out for a Merchant with an order and no
  movement, the other kept the order whenever the route could still be signed from where the
  Merchant stood — which in the Modern age is *everywhere*, so it held every single time. The
  card went on treating the Merchant as spoken for, and the plus button only appeared once its
  movement came back. The arrival guard now applies only in the ages where arrival is the point.
  - ⚠️ A cancelled journey and a turn's ordinary housekeeping arrive as the **same** event on a
    Merchant with nothing queued. Told apart by the step before: a Merchant the player called
    back *had* a journey a moment ago, and one standing still waiting to sign never did. Without
    that distinction the order was wiped on the turn rollover, and a cancelled-and-resent
    Merchant sat doing nothing for the rest of the game.
- **Merchants in Antiquity and Exploration never set off at all.** `LocalPlayerTurnBegin` fires
  **before** the engine hands units their movement back, so the one pass allowed to start a
  journey always saw a Merchant with nothing to travel on, and every pass after it was
  sign-only. `UnitMovementPointsChanged` is now also a moving pass — movement being restored is
  itself the moment to act on, and the engine announces it.
  - ⚠️ Safe against the refusal cascade this file guards against on two counts: the per-turn
    attempt cap still applies, and a Merchant that already has a course is never given another —
    without which a Merchant walking normally would re-order itself on every tile it spent.
- **The age rule is now written down instead of inferred.** Antiquity and Exploration: the
  Merchant must reach the settlement. Modern: it opens the route from anywhere, once it has
  movement. Two attempts at deriving this from `canStart` failed — it refuses
  `MAKE_TRADE_ROUTE` with an **empty** `FailureReasons`, so nothing in the refusal separates
  "too far" from "no capacity" from "no movement". In the Modern age no journey is ever the
  answer, so none is issued.
- **A Merchant bought this turn can be given a job the same turn.** The plus buttons treated
  "no movement left" as busy, which hid them for a whole turn after buying Merchants — exactly
  the turn a player is looking for somewhere to send them. No movement only means busy when
  there is an **order** that explains it: under one it is this mod's own Merchant partway
  through its errand, including the one told to stand still and sign the route when the turn
  begins. Without one it means only that the Merchant was bought this turn, and it is as free
  to be given a job as it will be tomorrow.
  - Clicking the plus on such a Merchant records the order and leaves it where it is; the route
    opens when the turn begins.
- **The "raise the limit and send" button no longer walks the Merchant across the map.** The
  treaty it proposes is *queued*, not done — `sendRequest` returns before the engine has acted
  — so for a moment afterwards the old trade capacity is still what gets reported, the route is
  refused, and a spare Merchant with movement in hand reads that refusal as distance and sets
  off for a journey the treaty was about to make unnecessary. That button now orders the
  Merchant to stay put; the order is retried when the turn begins, by which time the treaty has
  resolved either way. Every other caller still sets off as before.
  - ⚠️ It cannot be inferred from the refusal itself: `canStart` answers `MAKE_TRADE_ROUTE` with
    `Success: false` and an **empty** `FailureReasons`, so nothing distinguishes "no capacity"
    from "too far". The caller knows what it just requested; the engine does not say.
- **A Merchant is judged by what it is doing, not by what this mod wrote down.** Two symptoms,
  one cause: the plus button never appeared after reloading a save, and a Merchant the player
  called back was still reported as "one is already on its way". Standing orders live in the
  user options, **outside the save** — this mod declares `AffectsSavedGames = 0` deliberately —
  so they outlive a reload, and nothing tells them when the player halts or turns a Merchant
  around. Both answers now come from the unit: a queued destination (what the game's own map
  decoration reads to draw the remaining path) or no movement left counts as travelling;
  anything else is free.
  - **Calling a Merchant back now drops its standing order**, so it stops being re-sent at the
    start of the next turn. ⚠️ The hard part is that the player halting a Merchant and the
    engine refusing one of this mod's own move requests look identical — both clear the unit's
    operations and leave it standing. They are told apart by timing: a refusal arrives in the
    same breath as the request that caused it, so a clear within a moment of our own request is
    ours and anything later is the player's.
  - ⚠️ A Merchant that has just **arrived** also has its operations cleared, and may still have
    movement in hand — indistinguishable from being stopped, except that it is standing exactly
    where the route can be signed. Its order is therefore kept when it can still sign, so the
    errand is not thrown away one step from the end.
  - ⚠️ A turn stamp was tried first and does not work. The player had done and undone all of it
    inside a single turn, so the turn never went backwards and there was nothing to detect.
- **A Merchant bought for a route it could open on the spot walked off anyway.** From the
  Modern Age a Merchant can open a route from wherever it stands, so buying one is the whole
  errand — it only has to wait for next turn, because a unit bought this turn has no movement
  left. That last part was the trap: the engine refused the signature, and the refusal was read
  as a plain "no", so the fallback walked the Merchant towards the other empire. It left a
  position that already worked, and the route it could have opened at home arrived several
  turns late.
  - The engine says **which** refusal it is — `LOC_UNITCOMMAND_NO_MOVES_REMAINING` is a
    different reason from `LOC_UNITCOMMAND_TRADE_ROUTE_FAILURE_NO_NEARBY_CITIES` — so it is now
    asked instead of guessed. Refused only for movement, the Merchant stays where it is and
    signs when the turn begins; refused for distance, it sets off exactly as before.
  - ⚠️ No age check anywhere, and none is needed. In an earlier Age a Merchant standing at home
    is refused for **both** reasons at once, distance among them, so the same test correctly
    sends it walking. `canStart` is also the only thing that knows about the civs and effects
    that bend the rule; a hard-coded "Age 3" would be a second, worse copy of it.
  - ⚠️ The refusal is matched on the **LOC key**, never on the composed sentence — a decision
    taken by reading translated text breaks in every other language.

## 1.7

### Changed

- **Proposing "Improve Trade Relations" from a trade route card now redraws the whole tab**,
  not just the button that was clicked. A trade limit is per **leader**, so it was never one
  card's business: every other card of that leader carried the same "no trade route slot left"
  warning, the "one trade slot away" group under the unavailable routes is drawn from the same
  numbers, and so is the total above the tabs. Redrawing only the clicked stack left all three
  saying the old thing until something else happened to disturb the screen.
  - The same redraw now also runs when a proposed treaty **actually resolves** while the
    screen is open. Those diplomacy events already cleared this mod's caches; what was missing
    was anything to redraw afterwards, and on a tab whose cards all belong to the game there
    may not be a next pass for a long time.
- **The propose button now goes dark the moment it is pressed**, instead of staying bright and
  priced on an action that could no longer be taken. "Improve Trade Relations" can be proposed
  once per turn per leader, and pressing it again did nothing — which, on a button that still
  looked ready, read as the whole feature being broken.
  - The cause was one step behind everything else: `sendRequest` **queues** the request rather
    than performing it, so for a frame or two afterwards the engine still answers "yes, you may
    propose" — it is describing the state from before the click. Every redraw in that window
    faithfully restored the old numbers. The proposal is now remembered on this mod's own side
    for exactly that window, and the tooltip says the game's own reason for it.
  - The engine's real answers — the new capacity, the next proposal's price — arrive on
    `GameCoreEventPlaybackComplete`, which is what the game's own diplomacy panel waits for
    too, so a second redraw runs then.

⚠️ **None of this reopens the screen**, and deliberately so — an earlier attempt did exactly
that and blacked the whole screen out on every click. What a reopen would additionally fix is
the card physically moving between the "available" and "unavailable" lists, which the game
builds once per screen-open and never rebuilds. That stays the player's own close-and-reopen;
a button on one card is not a reason to take the screen away.

## 1.6

### Added

- **Per-resource locks.** A small padlock in the corner of every assigned Resource; click it
  and that Resource stays where it is through **Unassign all** and **Reassign all**. For the
  handful of placements that were not the planner's idea and are not up for debate — the
  Camels holding a settlement's slots open, the Resource put somewhere for an adjacency the
  planner cannot see — the choice used to be rebuilding them by hand every time or never
  using the buttons at all.
  - The mechanism, the unit of locking and the padlock itself are **Resource+**'s, on purpose:
    a player who has used that mod should recognise this without being told.
  - **Locks survive a reload** — this is where it parts company with Resource+, whose locks
    last the session. A lock that quietly evaporated when the save was loaded again would be
    worse than no lock, because the button it guards against is the one you press without
    looking. Stored per game seed through `UI.setOption`, like everything else this mod keeps;
    both halves of the key survive a save (`resourceValue` is the resource's plot index, and a
    settlement's component id is part of the game state).
  - No key list is needed to do that, which is why it stays short: nothing ever asks "which
    pairs are locked", only ever about a pair already in hand, so each is a direct lookup by
    name. `merchant-orders.js` carries a `localStorage` mirror only because it must find
    orders belonging to units that no longer exist. Storage is read at most once per pair per
    session; every later question is answered from memory.
  - **Taking a Resource out of a Settlement drops its lock.** A lock protects a Resource *in
    a Settlement*, so once the Resource leaves there is nothing left for it to protect. Kept,
    it would lie in wait: putting the Resource back into that Settlement later would arrive
    already pinned without the padlock ever being clicked, and **Unassign all** would start
    skipping something nobody asked it to skip. Watched at the engine, so it holds however the
    Resource was moved — including by this mod's own bulk operations.
  - **Options → Mods carries "Allow resource locking"**, on by default. Switched off the
    padlocks are gone entirely, not merely inert — and a lock set earlier stops having any
    effect on a bulk clear, because the option is enforced inside `isResourceLocked` itself
    rather than at each call site. What was pinned is remembered, so switching it back on
    during the same session restores it instead of silently losing it.
  - ⚠️ The padlock is marked as this mod's own for the screen's hit-testing. It overhangs its
    tile, and the hit-test climbs the DOM — so without that mark a click in the gap *beside* a
    Resource answered as a click *on* it, and shift-clicking a card to fill it selected a
    Resource instead of assigning. Drag and drop never showed it, because that goes through
    the game's own DragAndDrop and never reaches this code.
  - ⚠️ A settlement holding a lock is emptied **one Resource at a time**. The engine's bulk
    clear takes a settlement and no list, so it cannot spare anything; settlements with
    nothing locked still take the fast path.
- **Shift now moves a whole kind of Resource in every direction**, not only out of the pool.
  Settlement → settlement and settlement → pool moved exactly one however many of that kind
  sat beside it, because both the type lookup and the candidate list were read from the
  unassigned pool: a Resource picked up from a settlement was not found there, so the bulk
  step bailed out immediately. Candidates now come from wherever the Resource actually is.
  - Returning to the pool needed a **second method wrapped**. `slotSelectedResource` is where
    a Resource lands somewhere, which covers both directions that end in a settlement — taking
    one out to the pool never goes through it. That is `unslotSelectedResource`.
  - After either bulk step the screen is put back in step with the engine, the same check
    Assign All and Reassign All already run. These loops drive the engine directly rather than
    through the model's own handlers, so its differential bookkeeping never runs for them: the
    settlement cards heal themselves from live state, but the unassigned pool is maintained
    purely by addition and removal and cannot, and was left drawing Resources where they no
    longer were.
- **"Return the factory resources" is one button now.** In the Modern age a settlement with a
  factory carried a factory icon, a black pill holding the current factory Resource's icon,
  and a return button — three things wide, in a header that is already the first thing to wrap
  onto a second line, all saying what the header's own return button says in one. It is the
  game's own return-button artwork, with the factory mark riding in the top-right corner the
  way the padlock does on an assigned Resource. ⚠️ The game's display is **hidden, not
  removed** — it is Solid's and comes back with every redraw of the card.
- **The settlement header's other three controls lost their frames** to match it. A border and
  a filled panel each was fine while they were the only things this mod put up there; beside a
  button that is the game's own artwork and nothing else, they read as a different family of
  control. They highlight on hover the way it does, too: the factory button swaps to a
  brighter copy of its own artwork, and these — having no second image to swap to — brighten
  the icon itself, rather than lighting an olive panel behind it.
- **A trade route card is laid out in three plain pieces** instead of two that overlapped:

  ```
  [ domain icon   route -> destination        prices ]   the title row
  [ resources                                        ]   its own row below
                                       [ portrait ]      the corner, on the right
  ```

  The buy buttons moved out of the leader's corner and onto the end of the title row, so the
  corner holds nothing but the portrait and reads as a right-hand column. The route name takes
  the slack and truncates with an ellipsis, so a price is never the thing that gets cut.
  ⚠️ Nothing of the game's own is moved to achieve it — the corner, the title row and the
  resources row stay exactly where Solid rendered them, and only this mod's own button stack
  changes parent.
- **The HUD's Resource Allocation button now says when it is worth opening.** It goes to the
  full-colour icon once resource assignment is unlocked, and **pulses gently** while an
  unassigned resource of yours would actually be accepted somewhere.
  - The two are different questions on purpose. The count the game already prints on that
    button is how many resources are in the pool, which is not the same as whether any of them
    can go anywhere — a pool of resources every settlement would refuse still prints a number.
    The pulse uses the placeability test this mod already had to build for the
    "Resource Assignments Available" notification.
  - ⚠️ **Made to sit alongside beezany's Ready or Not**, which colours the same button.
    `Controls.decorate` keeps a list of decorators, so both mods run and neither replaces the
    other; the colouring rule here is Ready or Not's rule, to the same image at the same size,
    under a class of this mod's own — so with both installed the two agree whichever wins the
    cascade, and with only this one installed the button still colours. The pulse is separate
    and touches nothing Ready or Not sets.
- **Treasure Convoys can send themselves home.** A checkbox beside the "?" on the Treasure
  Convoys tab, **on by default**: a loaded convoy sails to your nearest Homeland Settlement
  on its own and unloads the moment the engine allows it. A convoy is worth nothing until it
  unloads — the game's own command is "Scores GDP, awards Gold, and removes the Unit from the
  game", refused with "Must be within the borders of one of your Homeland Settlements" — so
  the only skill the player was exercising over one was remembering it existed, several turns
  after the screen that produced it was closed.
  - It stays **your** convoy: movement is only ever re-issued at the start of your turn, so
    one you steer yourself is left where you put it rather than dragged back onto course.
  - Every pass tries to **unload first** and only sails when unloading is refused; no
    distance is computed anywhere, because `canStart` is the only thing that knows what
    "within the borders" means as the borders move.
  - The convoy is recognised the way the game's own unit flags recognise it —
    `getAssociatedDisbandCityId()` with `getDisbandBaseAmount()` — rather than by matching a
    unit type name, which would miss any carrier the local player cannot build.
  - ⚠️ Carries the same per-turn attempt cap as the merchant orders, and for the same reason:
    the engine answers a move it cannot honour by firing the very events this listens for, so
    without the cap a convoy that cannot reach home wakes itself forever and the game hangs.
  - It unloads on the **first tile of your own territory it reaches**, not at the settlement
    it was aimed at. Unloading is legal anywhere inside your borders, but a convoy is a naval
    unit and the only plots of a settlement a ship can be *sent* to are its water and its
    centre — so the course necessarily names the centre, and a convoy left to finish it sails
    past perfectly good owned water for several more turns. Reaching our own borders now
    cancels the rest of the journey (`UNITCOMMAND_CANCEL`, the game's own cancel) and the
    cargo comes off there.
  - A convoy is set sailing the turn it appears, not the turn after. `UnitAddedToMap` is the
    one event outside the turn beginning allowed to start it moving: the "do not fight the
    player" rule that keeps every other event unload-only exists to avoid overriding a convoy
    the player steered somewhere, and a convoy one turn old standing in the settlement that
    built it has no such intent to override.

### Fixed

- **Shift-clicking stopped doing anything at all** — no selection, no bulk assign — while
  Shift-*hover* kept highlighting normally. In this build the native mouse events report
  `shiftKey: false` even with Shift plainly held (traced in `UI.log`: every mousedown and
  mouseup, while `Input.isShiftDown()` said true throughout). `shift-click.js` was the one
  place that trusted the event's own flag alone; the highlight asks `isShiftHeld()`, which is
  why only one of the two was being told. ⚠️ This contradicts the input-spy transcript in the
  platform notes, which recorded `shiftKey=true` on an earlier build — the flag is not
  something to rely on here.
- **The resource padlock made clicks beside a Resource behave as clicks on it**, so
  shift-clicking a settlement card to fill it selected a Resource instead of assigning. The
  padlock overhangs its tile and the hit-test climbs the DOM, so `closest()` reached the tile
  from a point that was card, not resource. Controls this mod overlays are now marked and
  skipped by the hit-test. Drag and drop never showed it, because that goes through the game's
  own DragAndDrop.

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

## 1.2

### Added

- **The "Resource Assignments Available" prompt no longer takes over the turn button when every
  settlement is full and nothing new can go anywhere.** You can still open the screen and
  rearrange what is already assigned — it just rarely gains you anything, and the prompt was
  standing between you and the next turn every turn regardless. It returns as soon as something
  can actually be placed.

### Changed

- **Empire resources:** the combat column sizes itself to its widest card instead of always
  taking a third of the screen, every card is centred, and the figures are laid out in columns
  so every "+" sits under the one above it.
- **Factory resources:** cards centred to match, four to a row instead of three, and the origin
  tooltip totals each leader's copies beside their name.

### Fixed

- **Automatic assignment could miss a resource and then wait until the next turn.** The event
  announcing a finished improvement fires *before* the resource is in your hands, so a single
  look found nothing. It now looks again over the next few seconds.
- **A pass that placed nothing no longer counts the arrival as handled**, so one badly timed
  event cannot cost you the feature until your next acquisition.

## 1.1

### Added

- **The remaining languages** (machine-translated).

### Fixed

- Minor bugs.
