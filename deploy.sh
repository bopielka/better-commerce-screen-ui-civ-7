#!/usr/bin/env bash
#
# Deploys "Better Commerce Screen UI by Najane" into Civilization VII's mod folder.
#
# This repository is the source of truth; the game folder is treated as build
# output and rebuilt from scratch on every run, so files deleted here also
# disappear there instead of lingering as stale leftovers.
#
# Only what the game actually loads is copied - the .modinfo and the content
# directories listed below. Everything else (this script, README, .git, notes)
# stays out of the player's mod folder by construction, not by an exclude list
# that can drift.
#
# Usage:  ./deploy.sh          deploy
#         ./deploy.sh --dry    show what would happen, change nothing
#
# Override the install location if needed:
#         CIV7_MODS_DIR="/path/to/Mods" ./deploy.sh
#
set -euo pipefail

# --- configure ---------------------------------------------------------------
MOD_ID="better-commerce-screen-ui"

# Directories copied into the game, relative to this script.
CONTENT_DIRS=(ui text config)

# Default install path. Windows (Git Bash) uses %LOCALAPPDATA%.
DEFAULT_MODS_DIR="${LOCALAPPDATA:-$HOME/AppData/Local}/Firaxis Games/Sid Meier's Civilization VII/Mods"
# -----------------------------------------------------------------------------

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_ROOT="${CIV7_MODS_DIR:-$DEFAULT_MODS_DIR}"
DEST_DIR="$DEST_ROOT/$MOD_ID"

DRY_RUN=0
[[ "${1:-}" == "--dry" ]] && DRY_RUN=1

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- safety: never let a bad path turn this into a destructive command --------
[[ -f "$SRC_DIR/$MOD_ID.modinfo" ]] \
    || die "$MOD_ID.modinfo not found in $SRC_DIR - run this from the mod's own folder."
[[ "$(basename "$DEST_DIR")" == "$MOD_ID" ]] \
    || die "refusing to touch '$DEST_DIR' - it does not end in $MOD_ID."
[[ -d "$DEST_ROOT" ]] \
    || die "Civ VII mods folder not found: $DEST_ROOT (set CIV7_MODS_DIR to override)"

say "source: $SRC_DIR"
say "target: $DEST_DIR"
say ""

if [[ $DRY_RUN -eq 1 ]]; then
    say "[dry run] would remove the target folder and copy:"
    # `find` fails on content dirs this mod does not ship yet - not an error here.
    ( cd "$SRC_DIR" && find "$MOD_ID.modinfo" "${CONTENT_DIRS[@]}" -type f 2>/dev/null | sort | sed 's/^/  /' ) || true
    say ""
    say "[dry run] nothing was changed."
    exit 0
fi

# --- deploy ------------------------------------------------------------------
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

cp "$SRC_DIR/$MOD_ID.modinfo" "$DEST_DIR/"
for dir in "${CONTENT_DIRS[@]}"; do
    [[ -d "$SRC_DIR/$dir" ]] && cp -r "$SRC_DIR/$dir" "$DEST_DIR/"
done

# --- verify: every file the .modinfo references must exist in the target ------
missing=0
while IFS= read -r item; do
    [[ -z "$item" ]] && continue
    if [[ ! -f "$DEST_DIR/$item" ]]; then
        printf 'MISSING: %s (referenced by .modinfo)\n' "$item" >&2
        missing=$((missing + 1))
    fi
done < <(grep -o '<\(Item\|File\)[^>]*>[^<]*</\(Item\|File\)>' "$DEST_DIR/$MOD_ID.modinfo" \
         | sed 's/<[^>]*>//g')

count=$(find "$DEST_DIR" -type f | wc -l)
say "deployed $count files"
if [[ $missing -gt 0 ]]; then
    die "$missing file(s) referenced by the .modinfo are missing - the mod will not load correctly."
fi
say "all .modinfo references resolved"
say ""
say "Restart the game, or return to the main menu, to reload the mod."
