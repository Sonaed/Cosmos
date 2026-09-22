#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ ! -x "$root/build/cosmos-desktop" ]; then
  "$root/build-desktop.sh"
fi
exec "$root/build/cosmos-desktop" "$@"
