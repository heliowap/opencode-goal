#!/bin/sh
set -eu

repo=$(cd "$(dirname "$0")" && pwd)
config=${XDG_CONFIG_HOME:-$HOME/.config}/opencode

mkdir -p "$config/plugins" "$config/skills"
ln -sfn "$repo/src/index.ts" "$config/plugins/goal.ts"
ln -sfn "$repo/skill" "$config/skills/goal"

echo "plugin: $config/plugins/goal.ts -> $repo/src/index.ts"
echo "skill:  $config/skills/goal -> $repo/skill"
