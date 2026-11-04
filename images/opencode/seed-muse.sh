#!/bin/sh
# Seed Muse into the agent's home.
#
# The muse launcher keeps its downloaded binary and state (.muse-version,
# muse-bin-<ver>, update lock/work dirs) in the directory the launcher
# script itself lives in. Installed under /usr/local/bin that directory
# is root-owned (and restored from the image snapshot on every boot), so
# the agent's first download silently no-ops and every run dies with
# "installed binary is missing; rerun the installer". The launcher must
# live agent-writable and persistent: ~/.local/bin, with /usr/local/bin
# reduced to a symlink into it (the launcher resolves its own path
# through the link, so the home dir stays the install dir).
#
# Usage: seed-muse.sh [BIN_LINK_DIR]   (default /usr/local/bin)
# Env: HOME (agent home), MUSE_SEED_DIR (default /opt/muse-seed)
set -eu
home="${HOME:-/home/agent}"
seed_dir="${MUSE_SEED_DIR:-/opt/muse-seed}"
link_dir="${1:-/usr/local/bin}"
target_dir="$home/.local/bin"
target="$target_dir/muse"

mkdir -p "$target_dir"

# Launcher script: seed copy wins; an already-downloaded home launcher
# (self-updated) is never clobbered. Existing broken desktops carry the
# launcher as a regular file in the link dir — adopt it as the source.
if [ ! -f "$target" ]; then
  if [ -f "$seed_dir/muse" ]; then
    cp "$seed_dir/muse" "$target"
  elif [ -f "$link_dir/muse" ] && [ ! -L "$link_dir/muse" ]; then
    cp "$link_dir/muse" "$target"
  else
    echo "seed-muse: no launcher source found" >&2
    exit 1
  fi
  chmod 755 "$target"
fi

# Pre-downloaded binary from the image build, only while the home has
# none: first boot then works before any network download, and later
# boots keep whatever version the launcher updated itself to.
if [ ! -f "$target_dir/.muse-version" ] && [ -f "$seed_dir/.muse-version" ]; then
  version=$(cat "$seed_dir/.muse-version")
  if [ -f "$seed_dir/muse-bin-$version" ]; then
    cp "$seed_dir/muse-bin-$version" "$target_dir/muse-bin-$version"
    chmod 755 "$target_dir/muse-bin-$version"
    cp "$seed_dir/.muse-version" "$target_dir/.muse-version"
    [ -f "$seed_dir/.muse-release-info.json" ] && \
      cp "$seed_dir/.muse-release-info.json" "$target_dir/.muse-release-info.json" || true
  fi
fi

mkdir -p "$link_dir"
ln -sf "$target" "$link_dir/muse"
