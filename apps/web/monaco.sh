#!/usr/bin/env bash
# Copies the self-hosted Monaco AMD build next to the app bundle.
# Usage: monaco.sh <target-dir>   (apps/web/public for dev, apps/web/dist for build)
set -euo pipefail

target="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
cd "$(dirname "$0")"

src="node_modules/monaco-editor/min/vs"
dest="$target/monaco/vs"

if [ ! -d "$src" ]; then
  echo "monaco-editor is not installed" >&2
  exit 1
fi
if [ -d "$dest" ]; then
  exit 0
fi

mkdir -p "$target/monaco"
cp -r "$src" "$dest"
