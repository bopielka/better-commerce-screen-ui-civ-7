# Developer documentation — Better Commerce Screen UI by Najane

Written for an AI agent (or a human) starting a **new session** on this mod with no prior
context. Read this file, then read the documents it points at for the area you are about to
touch. Between them they describe what the mod does in game, how its code is organised, and
which of the platform's many traps have already been paid for once.

The repository's own `README.md` is the *player- and author-facing* document: what the mod
does and why, plus licence and origin. This folder is the *implementer-facing* one: how it
is built, and what will break if you build it differently.

## Read this first, in this order

| # | Document | What it answers |
|---|---|---|
| 01 | [What the mod does](01-what-the-mod-does.md) | Every in-game behaviour, and which module implements it |
| 02 | [Architecture](02-architecture.md) | The five layers, the dependency rule, load order, lifecycles |
| 03 | [Platform notes](03-platform-notes.md) | Civ VII `ui-next` / Solid.js, `ComponentRegistry`, DOM and engine quirks |

Then the module documents, which mirror the folders under `ui/`:

| # | Document | Folder |
|---|---|---|
| 04 | [support](04-support.md) | `ui/support/` — logging, DOM helpers |
| 05 | [engine](05-engine.md) | `ui/engine/` — talking to the game |
| 06 | [model](06-model.md) | `ui/model/` — reading the screen's data, and rebuilding it headless |
| 07 | [planner: assignment](07-planner-assignment.md) | `ui/planner/` — deciding what goes where |
| 08 | [planner: valuation](08-planner-valuation.md) | `ui/planner/` — what a resource is *worth* |
| 09 | [screen: interaction](09-screen-interaction.md) | `ui/screen/` — mouse, buttons, layout |
| 10 | [screen: tabs](10-screen-tabs.md) | `ui/screen/` — the rebuilt and added tabs |
| 11 | [options and persistence](11-options-and-persistence.md) | `ui/options/`, priority store, factory-first switch |
| 12 | [localisation](12-localisation.md) | `text/<locale>/` |
| 13 | [notifications](13-notifications.md) | `ui/screen/` — the end-turn nag, and the convoy toast |
| 14 | [development workflow](14-development-workflow.md) | Deploying, checking, reading logs, conventions |

## The one-paragraph summary

A **UI-only** mod for Sid Meier's Civilization VII targeting the **Commerce screen**
(`screen-resource-allocation`). It changes no rules, values or balance, and declares
`AffectsSavedGames = 0`. It adds right-click/Shift resource handling, empire-wide automatic
assignment ported from **Resource+** by **Br4d**, per-settlement priorities, a rebuilt
Empire tab, a new Factory tab for the Modern age, a tidied Trade Routes and Treasure tab,
and an optional automatic assignment that runs with the screen closed.

## Rules an agent working here must not break

1. **The dependency direction.** `support` ← `engine` ← `model` ← `planner` ← `screen`.
   Never import upwards. See [Architecture](02-architecture.md) for why this is load-bearing
   and not merely tidy.
2. **`deploy.sh` after every change** (`deploy-on-mac.sh` is a shim for it). The game never reads
   this repository. See [workflow](14-development-workflow.md).
3. **`console.log` never reaches the game's log.** Use the helpers in
   `ui/support/diagnostics.js`, which go through `console.error`.
4. **Do not batch the placement loop.** Each choice is made against the board the previous
   one left behind. See [planner: assignment](07-planner-assignment.md).
5. **Keep the FACT in a `⚠️` comment, not the story around it.** Almost every one records a bug
   that shipped or an approach that failed — keep that, drop the narrative. If you change the code
   they describe, update them. See the comment budget in
   [workflow](14-development-workflow.md).

6. **This mod is not compatible with Resource+** — both replace the same screen. The
   override priorities are still computed as `existing + 100` so that co-installation
   degrades rather than breaks.

## Conventions in this documentation

- Paths are relative to the repository root: `ui/planner/scoring.js`.
- "The model" without qualification means the Commerce screen's Solid model,
  `CommerceScreenModel`, reached through `useCommerceScreenContext()`.
- "The engine" means the game's C++ side, reached through globals like `Game`, `Players`,
  `Cities`, `GameInfo`, `engine.on(...)`.
- Where a document says **⚠️**, it is repeating a hard-won fact from a source comment.
