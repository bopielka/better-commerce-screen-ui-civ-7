#!/usr/bin/env bash
#
# Turns the dev-only "devtools" section (the in-game dev panel, ui/screen/dev-panel.js) back ON
# in the deployed mod, then deploys immediately so the change is live right away.
#
# See disable-devtools.sh for what "on"/"off" actually does - this just removes the marker file
# deploy.sh checks for and re-runs it.
#
# Usage:  ./enable-devtools.sh
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

rm -f "$SRC_DIR/.devtools-disabled"
say "devtools: enabled (./disable-devtools.sh to exclude again)"
say ""

"$SRC_DIR/deploy.sh"
