#!/usr/bin/env bash
#
# Turns the dev-only "devtools" section OFF for the deployed mod - the in-game dev panel
# (ui/screen/dev-panel.js) stops being copied into the player's mod folder at all, then deploys
# immediately so the change is live right away.
#
# ⚠️ This is a file-level exclusion, separate from DIAGNOSTICS in ui/support/diagnostics.js.
# DIAGNOSTICS=false already stops the dev panel from DOING anything even when the file ships;
# this additionally keeps the file itself out of a release build. Use this before publishing, on
# top of (not instead of) setting DIAGNOSTICS to false - see CLAUDE.md.
#
# Usage:  ./disable-devtools.sh
#
set -euo pipefail

MOD_ID="better-commerce-screen-ui"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Double-clicked in Explorer, this runs in a git-bash.exe window that closes the instant the
# script ends - same trap deploy.sh uses, so deploy.sh's own output is readable first.
if [[ $- == *i* ]]; then
    trap 'printf "\nPress Enter to close... "; read -r' EXIT
fi

[[ -f "$SRC_DIR/$MOD_ID.modinfo" ]] \
    || die "$MOD_ID.modinfo not found in $SRC_DIR - run this from the mod's own folder."

touch "$SRC_DIR/.devtools-disabled"
say "devtools: disabled (./enable-devtools.sh to re-include)"
say ""

"$SRC_DIR/deploy.sh"
