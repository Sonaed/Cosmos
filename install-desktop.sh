#!/usr/bin/env sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix=${COSMOS_INSTALL_PREFIX:-"$HOME/.local"}
if [ ! -x "$root/build/cosmos-desktop" ]; then
  "$root/build-desktop.sh"
fi
cmake --install "$root/build" --prefix "$prefix"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$prefix/share/applications"
fi
echo "Cosmos installé dans $prefix/bin et ajouté au menu des applications."
