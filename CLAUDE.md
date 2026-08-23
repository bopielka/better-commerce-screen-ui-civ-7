# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A UI-only mod for Sid Meier's Civilization VII that replaces the Commerce screen
(`screen-resource-allocation`). Plain ES modules, **no build step, no bundler, no TypeScript,
no tests** — the game loads the `.js` files directly.

## Read this first

**[`documentation/README.md`](documentation/README.md) is the index, and it is written for exactly
this situation** — an agent starting with no context. It routes to fourteen documents mirroring the
folders under `ui/`. Read the one covering the area you are about to touch before you touch it;
they record traps that have already been paid for once.

This file carries only what has to be in context *before* that, plus the things a session gets
wrong when it does not know them.

## Commands

Everything goes through one script. **The game never reads this repository** — it reads a copy in
its own mod folder, so a change that has not been deployed is a change that is not running.

```bash
./deploy.sh
```

```bash
./deploy.sh --dry
```

```bash
CIV7_MODS_DIR="/path/to/Mods" ./deploy.sh
```

`deploy.sh` is the script on **both** platforms (it branches on `uname`). `deploy-on-mac.sh` is a
two-line shim kept because it is what gets typed. It wipes and rebuilds the target, copies only
`.modinfo` + `ui/` + `text/` + `config/`, parses every script, and refuses to deploy if either
BBCode file is over its character limit.

After deploying, **return to the main menu or restart** — scripts are loaded once.

### ⚠️ `node --check` is worthless on these files

It parses `.js` as CommonJS, meets `import`, gives up, and **exits 0 on a file with a syntax
error**. Every "syntax ok" reported that way means nothing. The real check reads from stdin:

```bash
for f in $(find ui -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done
```

`deploy.sh` runs this itself, which is the reason to deploy rather than hand-check.

### Logs

`%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\` — `UI.log` (this mod's output and
JS errors), `Modding.log` (was it loaded), `Database.log` (did the XML validate).

⚠️ **`console.log` never reaches `UI.log`.** Use `log()` / `warn()` from `ui/support/diagnostics.js`,
which go through `console.error`. `log()` is gated on `DIAGNOSTICS`, which ships `false`; `warn()`
always writes. Anything a player might need to report has to be a `warn`.

## Architecture

Five layers, and **the dependency direction is load-bearing, not tidiness**:

```
support  ←  engine  ←  model  ←  planner  ←  screen
```

Never import upwards. The reason is concrete: the assignment engine runs **with the Commerce
screen closed** (automatic assignment, merchant orders, treasure convoys), so a planner module
importing a screen module would drag Solid and the game's `ui-next` components into a path that
has no screen. [`documentation/02-architecture.md`](documentation/02-architecture.md) has the rest.

⚠️ **`ui/options/` loads in SHELL scope too** — the options screen exists in the main menu, where
there is no game, no DOM and no engine events. A settings module it imports may reach no further
than `ui/engine/stored-setting.js`, and must do nothing at import time beyond declaring itself.
That is why screen-facing switches still live under `ui/engine/`.

Two entry points, both listed in the `.modinfo`; everything else arrives by `import`, which is also
what fixes load order:

| File | Scope |
|---|---|
| `ui/better-commerce-screen-ui.js` | game — starts everything that runs with the screen closed |
| `ui/options/najane-commerce-options.js` | game **and** shell |

Two shared choke points worth knowing before writing anything new:

- **`ui/engine/events.js`** — every `engine.on` in the mod. One engine subscription per event name
  however many listeners want it, and the "is this event even mine?" filter. Engine events are
  raised for **every player in the game**; a handler that does not filter runs thousands of times
  per AI turn.
- **`ui/support/dom.js`** — `setTooltip` is the one door for `data-tooltip-content`, so the "hide
  tooltips" option cannot be forgotten at a call site.

## Rules that are easy to break

1. **Do not batch the placement loop** in `ui/planner/place.js`. Each choice is made against the
   board the previous one left behind; that is what makes the happiness rescue level out. The
   header there records what the batched version cost.
2. **Do not route placement through the screen's model.** Measured at 30.7 s for 111 resources
   versus 1.6 s of actual decisions — three Solid re-renders per resource. Talk to the engine and
   read the engine back.
3. **Keep the FACT in a `⚠️` comment, not the story.** Each one records a bug that shipped, a
   measurement, or an approach that failed — keep that, drop the narrative around it. If you
   change the code one describes, update it; do not delete the constraint because it "reads like a
   comment about nothing". See **Comments** below for the budget.
4. **No backtick inside a CSS template literal**, including in comments — it closes the string and
   the module fails to load, taking the whole mod with it. Use quotes in CSS comments.
5. **The changelog is written twice, in the same pass.** `CHANGELOG.md` carries the cause and the
   reasoning; `STEAM_CHANGELOG.bbcode` carries one bullet per change and has a hard 8000-character
   limit that `deploy.sh` enforces. When it is close, **drop the oldest version section** rather
   than trimming recent ones.
6. **`TODO.md` says: "For AI agents: Don't edit this file unless asked. Don't implement TODOs from
   here unless asked."** Honour it.
7. **Set `DIAGNOSTICS = false` before publishing.**

## Performance is a correctness requirement here

This is UI code inside the game's own single JavaScript thread. Work done badly here does not
show up as a slow function — it shows up as the whole game stuttering, and players report it as
"the game runs slowly with this mod on". **Every change gets a cost check before it is finished**,
and the answer goes in the `⚠️` comment beside it.

What to check, in the order these have actually bitten:

- **Is it on an engine event?** Events are raised for **every player**; `UnitMoved` and friends
  arrive in their thousands per AI turn. Subscribe through `ui/engine/events.js` and filter.
- **Does it run per frame, per DOM mutation, or per placement?** The placement loop rebuilds the
  board before every resource, so anything it calls is multiplied by the size of the empire.
- **Is it a call into the game?** `GameInfo.*.lookup`, `Database.makeHash`, `Game.getHash`,
  `Locale.compose` and `UI.getOption` are lookups, not constants — memoise anything whose answer
  cannot change while the game runs. `Game.PlayerOperations.canStart` and `Units.getPathTo` are
  the two most expensive calls in the mod: never loop either one over a list without a bound, and
  never ask the engine a question the data already answers.
- **Is a timeout counted in frames?** Make it wall-clock. A frame-based ceiling stretches exactly
  when the game is already slow, and does not fire at all when the frame loop is not running.

⚠️ **Measure rather than assume, and say what you measured.** `logEventStats()` (diagnostics on)
prints per-event counts and cost; `ui/planner/place.js` prints the breakdown of an assignment run;
a run over five seconds warns even with diagnostics off. A `⚠️` note carrying a real number is
worth more than one carrying an opinion.

## Comments

The comments here are for an agent opening this repository cold, with no memory of the session
that wrote them — **that is the whole budget**. A comment earns its place by carrying something
the code cannot say: a constraint, a measurement, a platform trap, or the reason a layer boundary
sits where it does.

- **Say the fact, not the history.** "⚠️ `canStart` is the most expensive call in this mod; do not
  ask it about pairs the data already rules out" — not three paragraphs on how that was
  discovered.
- **Never restate the code.** If the line says what it does, the comment above it is noise.
- A module header is **three to eight lines** for an ordinary module: what this is for, why it
  lives in this layer, and the one or two traps in it. A genuinely complex one (`scoring.js`'s tier
  order, `auto-assign.js`'s trigger rules) may need twenty - but then every line carries a distinct
  fact, and none of them is narrative.
- Prefer one `⚠️` line over a `⚠️` paragraph. If it genuinely needs a paragraph, it probably
  belongs in `documentation/`, with the comment pointing at it.

⚠️ This is a rule about **density, not about deleting knowledge**. Compress a long note down to
the constraint it protects; do not throw the constraint away with the prose.

⚠️ **A comment inside a template literal is not a comment - it is DATA.** The CSS in this mod lives
in template literals, so a `/* ... */` in a style constant is part of a string. Leave those alone.

## Conventions

Follow the surrounding code; it is consistent. 4-space indent, semicolons, single quotes, trailing
commas. `camelCase` functions, `SCREAMING_SNAKE` module constants, `LOC_NAJANE_COMMERCE_*`
localisation keys, `najane-*` CSS classes and style ids. Imports of game files are absolute
(`/core/…`, `/base-standard/…`), of this mod's files relative.

Every module opens with a block comment saying what it is for **and why it lives in that layer**.
Match that — it is how the layer rule stays enforceable by reading.

⚠️ Wrap every call into the game in `try`/`catch` and `warn` on failure. The engine throws where a
browser would return `undefined`.

New localisation keys go into **all twelve** `text/<locale>/InGameText.xml` files.
⚠️ `text/ru_RU/` holds **Ukrainian**; see the note in the file.