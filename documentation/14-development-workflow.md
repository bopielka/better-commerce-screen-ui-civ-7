# 14 — Development workflow

## The repository is the source of truth

**The game never reads from here.** A deploy script copies a build into Civ VII's mod folder.
**Run it after every change.**

**`deploy.sh` is the script**, on both platforms. It picks the default target from `uname`:

| Platform | Default target |
|---|---|
| Windows (Git Bash) | `%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Mods\` |
| macOS | `~/Library/Application Support/Civilization VII/Mods/` |

`deploy-on-mac.sh` still exists and still works — it is a two-line shim that `exec`s
`deploy.sh`, kept because it is what gets typed.

```bash
./deploy-on-mac.sh
```

```bash
./deploy-on-mac.sh --dry
```

Override the install location:

```bash
CIV7_MODS_DIR="/path/to/Mods" ./deploy-on-mac.sh
```

⚠️ **Not `Documents\My Games\…`** — that is the Civ VI convention and Civ VII never scans it.

⚠️ **There used to be two full scripts** with a comment on each saying "keep them in sync if
the deploy or check logic changes". They were not kept in sync: the Windows copy never
received the `STEAM_CHANGELOG.bbcode` size check, so the one platform the mod is actually
published from was the one that could not warn about a change note Steam would silently
truncate. Do not reintroduce a second copy; add a `case "$(uname -s)"` branch instead.

After deploying, **return to the main menu (or restart)** to reload the mod.

### What the script does

1. Refuses to run if `<MOD_ID>.modinfo` is not in the source folder, or if the target path does not
   end in the mod id, or if the mods folder does not exist. **A bad path must never turn this into
   a destructive command.**
2. **Wipes and rebuilds** the target folder, so files deleted here also disappear from the game
   instead of lingering as stale leftovers.
3. Copies **only** the `.modinfo`, `ui/`, `text/` and `config/`. The README, the deploy scripts,
   `.git/` and notes never reach the player's mod folder — **by construction, not by an exclude
   list that can drift.**
4. Runs three checks (below).
5. Verifies that **every file referenced by the `.modinfo` exists** in the target.

## The three checks the deploy script runs

### 1. Every script must parse

⚠️ **`node --check <file>.js` DOES NOT CHECK THESE FILES.** It parses a `.js` file as CommonJS, and
every file here is an ES module; faced with `import` it gives up and exits 0. Verified against a
file with a deliberate line break inside a string literal:

```
node --check ui/screen/tab-icons.js                  → exit 0   (says nothing)
node --input-type=module --check < .../tab-icons.js  → exit 1   (points at line 23)
```

Reading from **stdin with `--input-type=module`** is what actually parses them. Every "syntax ok"
this project reported before that was worthless, which is how a broken string literal reached the
game and stopped the mod loading entirely.

It runs from the deploy script rather than by hand because by hand is the other half of that
failure: a file was checked, edited once more, and deployed unchecked.

Manually, if you need it:

```bash
for f in ui/**/*.js; do node --input-type=module --check < "$f"; done
```

If `node` is not installed the check is skipped with a note. On macOS: `brew install node`.

### 2. No backtick inside a style block

The CSS in this mod lives in template literals, and **a backtick written inside one — quoting a
property name in a comment, say — closes it.** What follows is parsed as code and the module fails
to load, taking the whole mod with it.

The parser above does catch this. The dedicated check is kept because it **names the actual
mistake** instead of pointing at whatever line the wreckage first stops parsing on, and because it
still works if `node` is missing.

> Use quotes in CSS comments, never backticks.

### 3. The Steam description has a hard 6000-character limit

Steam truncates the Workshop description field at 6000 characters **without warning** — the tail is
simply gone, and the first thing lost is whatever sits at the bottom, which is where the credits
and the source link live. `steam-description.bbcode` currently sits at 5993/6000.

## Reading the logs

```
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VII\Logs\      (Windows)
~/Library/Application Support/Civilization VII/Logs/                 (macOS)

  Modding.log    was the mod discovered and loaded?
  Database.log   did the XML pass validation?
  UI.log         JavaScript errors, missing assets, this mod's own output
```

⚠️ **`console.log` never reaches `UI.log`.** Use `log()` / `warn()` from
`ui/support/diagnostics.js`, which go through `console.error` and prefix `[better-commerce]`.

⚠️ If the mod is discovered and shows as enabled but **never appears in `Modding.log`'s "enabled
mods" list**, check `version` on `<Mod>`: it is parsed as an int, so `version="0.1"` lands in
`Mods.sqlite` as `Version 0` and the game silently refuses to apply the mod.

## Code conventions

Follow the surrounding code. In short:

- **ES modules**, no build step, no bundler, no TypeScript. Imports of game files are absolute
  (`/core/…`, `/base-standard/…`); imports of this mod's files are relative.
- **4-space indent**, semicolons, single quotes, trailing commas in multi-line literals.
- `camelCase` for functions and variables, `SCREAMING_SNAKE` for module constants,
  `LOC_NAJANE_COMMERCE_*` for localisation keys, `najane-*` for CSS classes and style ids.
- `#region` / `#endregion` markers group related exports in the larger engine files.
- Every module opens with a **block comment saying what it is for and why it exists in that
  layer**. Match that.
- Prefer `?.` and `??`. Wrap every call into the game in `try` / `catch` and `warn` on failure —
  the engine throws where a browser would return `undefined`.

### The `⚠️` convention

⚠️ markers record a bug that shipped, a measurement, or an approach that was tried and failed.
**They are the most valuable text in the repository.** If you change the code one describes, update
the marker. Do not delete one because it "reads like a comment about nothing" — that is exactly
what a successfully prevented bug looks like.

Write a new one when you discover something the platform does that a reasonable reader would not
predict. Say what was tried, what happened, and what the evidence was.

## Before you commit

1. `./deploy.sh` — parses, checks, deploys, verifies.
2. Load the game, return to the main menu, open the Commerce screen.
3. Check `UI.log` for `[better-commerce]` warnings.
4. If you touched the planner, watch the timing lines: a pass that suddenly costs 30 s means
   something is going through the screen's model again — see
   [planner: assignment](07-planner-assignment.md).
5. If you touched localisation, confirm no raw `LOC_…` tags appear on screen.
6. Set `DIAGNOSTICS = false` in `ui/support/diagnostics.js` **before publishing** (it is currently
   `true`). The author's previous mod shipped 1.0 with logging on.

## Compatibility

⚠️ **Not compatible with Resource+.** Both mods replace the same screen — enable one or the other.
The `LoadOrder` of 1200 (above Resource+'s 1100) and the runtime `existing + 100` override
priorities are belt and braces: with both enabled this mod wins outright rather than
half-applying.

Saved games are unaffected, no rules or values are touched, and the mod is safe to add or remove
mid-game.

## Files that are not part of the build

`deploy.sh` copies only the `.modinfo`, `ui/`, `text/` and `config/`. Everything else stays here:

```
README.md                 the player- and author-facing document
CHANGELOG.md              the full history, with reasoning
STEAM_CHANGELOG.bbcode    ⚠️ the SHORT form of it; see below. 8000-character limit
TODO.md                   ⚠️ "For AI agents: Don't edit this file unless asked."
documentation/            this folder
steam-description.bbcode  the Workshop page, 6000-character limit
deploy.sh, deploy-on-mac.sh
.idea/, .git/
```

### ⚠️ The changelog is written TWICE

Every entry added to `CHANGELOG.md` is condensed into `STEAM_CHANGELOG.bbcode` **in the same
pass**. Skip it once and the two drift apart within a release or two, at which point nobody
knows which is right.

| | `CHANGELOG.md` | `STEAM_CHANGELOG.bbcode` |
|---|---|---|
| Audience | whoever maintains this next | a player on the Workshop page |
| Carries | the cause, the ⚠️ notes, the approaches that failed | what changed, one bullet each |
| Fixes | one entry per fix, explained | folded into a single "Fixed:" bullet per version |
| Format | Markdown, newest first | BBCode, `[h2]` per version, house style from `steam-description.bbcode` |

`deploy.sh` prints both character counts and refuses to deploy over either limit. When
the Steam file approaches 8000, **drop the oldest version section** rather than trimming the
recent ones — old releases are what nobody reads, and the full history is in the Markdown file
either way.

There is currently no `config/` directory; the deploy script tolerates a content directory that
does not exist.

## Licence and origin

The automatic assignment logic is a port of **Resource+** (`brads-assign-all-resources`) by
**Br4d**, used with permission. See the attribution note at the top of `ui/planner/scoring.js` for
what is theirs and what is not — **keep that note.**

The code was generated by **Opus 5**, a model by **Anthropic**. Anyone may reuse it freely as a
basis for their own mods.
