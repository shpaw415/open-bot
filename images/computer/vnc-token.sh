#!/bin/sh
set -u
session=${1:-}
port=${2:-}
mkdir -p /run/open-bot
token_file=/run/open-bot/tokens
touch "$token_file"
exec 9>/run/open-bot/tokens.lock
flock 9
grep -v "^${session}: " "$token_file" >"$token_file.tmp" || true
echo "${session}: localhost:${port}" >>"$token_file.tmp"
mv "$token_file.tmp" "$token_file"
