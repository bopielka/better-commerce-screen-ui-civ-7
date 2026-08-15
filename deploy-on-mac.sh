#!/usr/bin/env bash
#
# Deploys "Better Commerce Screen UI by Najane" into Civilization VII's mod folder.
#
# This is the macOS counterpart to deploy.sh, which was written for Windows
# (Git Bash) and defaults to %LOCALAPPDATA%. The two scripts are otherwise
# identical - keep them in sync if the deploy/check logic changes.
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
# Usage:  ./deploy-on-mac.sh          deploy
#         ./deploy-on-mac.sh --dry    show what would happen, change nothing
#
# Override the install location if needed:
#         CIV7_MODS_DIR="/path/to/Mods" ./deploy-on-mac.sh
#
set -euo pipefail

# --- configure ---------------------------------------------------------------
MOD_ID="better-commerce-screen-ui"

# Directories copied into the game, relative to this script.
CONTENT_DIRS=(ui text config)

# Default install path on macOS.
DEFAULT_MODS_DIR="$HOME/Library/Application Support/Civilization VII/Mods"
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

# --- check: every script must parse -------------------------------------------
#
# ⚠️ `node --check <file>.js` DOES NOT CHECK THESE FILES. It parses a .js file as
# CommonJS, and every file here is an ES module; faced with `import` it gives up and
# exits 0. Verified against a file with a deliberate line break inside a string literal:
#
#     node --check ui/screen/tab-icons.js                  -> exit 0   (says nothing)
#     node --input-type=module --check < .../tab-icons.js  -> exit 1   (points at line 23)
#
# Reading from stdin with --input-type=module is what actually parses them. Every
# "syntax ok" this project reported before that was worthless, which is how a broken
# string literal reached the game and stopped the mod loading entirely.
#
# It runs here rather than by hand because by hand is the other half of that failure: a
# file was checked, edited once more, and deployed unchecked.
if command -v node >/dev/null 2>&1; then
    broken=0
    while IFS= read -r file; do
        node --input-type=module --check < "$SRC_DIR/$file" >/dev/null 2>&1 || {
            printf 'SYNTAX ERROR: %s\n' "$file" >&2
            node --input-type=module --check < "$SRC_DIR/$file" 2>&1 | sed -n '1,4p' >&2
            broken=$((broken + 1))
        }
    done < <(cd "$SRC_DIR" && find ui -name '*.js' -type f | sort)
    [[ $broken -eq 0 ]] || die "$broken file(s) do not parse - the mod would not load."
else
    say "note: node not found, skipping the syntax check"
fi

# --- check: a backtick inside a style block ends the string early -------------
#
# The CSS in this mod lives in template literals, and a backtick written inside one -
# quoting a property name in a comment, say - closes it. What follows is then parsed as
# code and the module fails to load, taking the whole mod with it.
#
# The parser above does catch this - it reports the same "SyntaxError: Unexpected
# identifier" the game does. This check is kept because it names the actual mistake
# instead of pointing at whatever line the wreckage first stops parsing on, and because
# it still works if node is missing. (An earlier note here claimed Node could not catch
# it at all; that was wrong - the check simply was not parsing these files.)
stray=0
while IFS= read -r hit; do
    printf 'BACKTICK INSIDE A STYLE BLOCK: %s\n' "$hit" >&2
    stray=$((stray + 1))
done < <(
    cd "$SRC_DIR" && find ui -name '*.js' -type f 2>/dev/null | sort | while IFS= read -r file; do
        awk -v f="$file" '
            /^const [A-Za-z_]+ = `$/ { inside = 1; next }
            inside && /^`;$/         { inside = 0; next }
            inside && /`/            { printf "%s:%d  %s\n", f, NR, $0 }
        ' "$file"
    done
)
[[ $stray -eq 0 ]] || die "$stray stray backtick(s) - the mod would fail to load. Use quotes in CSS comments."

# --- check: the Steam description has a hard 6000-character limit -------------
#
# Steam truncates the Workshop description field at 6000 characters. It does not warn -
# the tail is simply gone, and the first thing lost is whatever sits at the bottom, which
# is where the credits and the source link live.
#
# Checked here rather than trusted to memory: the description grows a line at a time as
# features land, and nobody counts characters while writing one.
DESCRIPTION="$SRC_DIR/steam-description.bbcode"
DESCRIPTION_LIMIT=6000
if [[ -f "$DESCRIPTION" ]]; then
    size=$(wc -c < "$DESCRIPTION" | tr -d '[:space:]')
    if [[ "$size" -gt "$DESCRIPTION_LIMIT" ]]; then
        die "steam-description.bbcode is $size characters; Steam allows $DESCRIPTION_LIMIT. Trim it."
    fi
    say "steam description: $size/$DESCRIPTION_LIMIT characters"
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
