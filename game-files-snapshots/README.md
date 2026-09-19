# Game file snapshots

This mod does not overwrite any file on disk — it is UI-only, `ComponentRegistry`-based (see
[`documentation/02-architecture.md`](../documentation/02-architecture.md) and
[`documentation/03-platform-notes.md`](../documentation/03-platform-notes.md)). "Overwrite" here
means: the mod registers its own component under the **same name** as a game component, at a
higher `overridePriority`, so the game's `ComponentRegistry` hands out the mod's version instead.
Some of those wrappers still call back into the original (`originalFactory(props)`); one
(`CommerceScreen`) is a full line-for-line transcription that does not.

Each sub-folder here is a **1:1 copy of every original game `.js` file this mod imports from or
overrides**, captured at a specific game version, mirroring the real path under the game's
`Base/modules/` folder (e.g. `1.5.0/base-standard/ui-next/screens/commerce/commerce-screen.js`
came from
`.../Sid Meier's Civilization VII/Base/modules/base-standard/ui-next/screens/commerce/commerce-screen.js`).

This folder is **tracked in git**, unlike most local/generated content in this repo. It exists so
that after a game update, an agent (or a person) can `diff` the new game files against the last
captured snapshot and see immediately what changed upstream, instead of having to guess why
something in the mod broke.

## ⚠️ Retention: keep AT MOST two versions — newest, and ONE version back

**The user's instruction, 2026-09-20.** Unlike `STEAM_CHANGELOG.bbcode`, this is not an archive —
it exists only so the *current* game update can be diffed against the *previous* one. Once a
third snapshot would exist, delete the oldest folder in the same change that adds the new one.
Right now there is only `1.5.0/` because this is the first game update this process covers; the
next snapshot (e.g. `1.6.0/`) is added alongside it, and only starting with the *one after that*
(e.g. `1.7.0/`) does an old folder actually get deleted.

## Versions captured

| Folder | Game build | Captured | Notes |
|---|---|---|---|
| [`1.5.0/`](1.5.0/README.md) | Steam `buildid 25245002` | 2026-09-20 | First snapshot; see its own `README.md` for a file-by-file description. |

## ⚠️ A new import or override → add that file to the CURRENT snapshot right away

**The user's instruction, 2026-09-20.** This folder is meant to hold **every** original game file
the mod currently imports from or overrides — not just whatever was true on the day a version was
captured. Whenever a change under `ui/` adds:

- a new `from '/core/...'` or `from '/base-standard/...'` import, **or**
- a new `ComponentRegistry.register({ name: '...' })` target (the mod starts overriding a
  component it did not override before),

copy that one file into the **newest** version folder (currently `1.5.0/`) in the same change that
adds the import — do **not** create a new version folder for this, only a game update does that.
Mirror its `core/...` / `base-standard/...` path exactly the way the existing files do, then add a
row for it to that folder's own `README.md` (what it is in the game, how the mod uses it — copy
the format of the existing rows), marked **⚠️ OVERRIDDEN** if it is a `ComponentRegistry` target.

Skipping this is how the snapshot goes stale: the next game-update diff (see below) would silently
miss a file the mod actually depends on, because it was never captured to begin with.

## How to capture the next snapshot (e.g. after the 1.6.0 game update)

1. Find every original-game import the mod currently has:
   ```bash
   grep -rno "from ['\"]/\(core\|base-standard\)[^'\"]*" ui/ | sort -u
   ```
   Also re-check `ComponentRegistry.register({ name: '...' })` calls in `ui/screen/*.js` — the set
   of overridden component names is the most important thing to keep in sync with this list.
2. Copy each of those files from the game install (`Base/modules/...`) into a new
   `game-files-snapshots/<new-version>/` folder, preserving the `core/...` / `base-standard/...`
   relative path — see the file list this command produces for the exact paths.
3. `diff -ru game-files-snapshots/1.5.0 game-files-snapshots/<new-version>` (or point a normal
   diff tool at the two folders) to see exactly what the update changed.
4. Copy `1.5.0/README.md` to `<new-version>/README.md` and update it: file-by-file descriptions
   rarely change, but add a note for anything the diff in step 3 actually touched, and update the
   "Game build" / "Captured" values.
5. Add a row for the new folder to the table above.
6. **If this brings the count above two, delete the oldest folder now** (see the retention rule
   above) and remove its row from the table.
