#!/bin/sh
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
config=${XDG_CONFIG_HOME:-$HOME/.config}/opencode

mkdir -p "$config/plugins"
ln -sfn "$repo/src/index.ts" "$config/plugins/goal.ts"

echo "plugin: $config/plugins/goal.ts -> $repo/src/index.ts"
