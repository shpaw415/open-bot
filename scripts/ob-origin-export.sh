#!/bin/sh
# ob-origin-export — READ-ONLY export of ONE persisted Chromium origin
# (IndexedDB leveldb + blob dirs) from a desktop profile, without opening
# the browser, navigating, or touching any other origin (#109).
#
# Owner/operator tool: run it where docker is available. The source profile
# is never modified (docker cp out only). Stability is PROVEN, not assumed:
# the origin is copied twice and the two recursive SHA-256 manifests must
# match; if the DB is live (a tab writing to it) the export refuses and
# keeps nothing. The output is provenance + hashes + raw files — decoding
# (LevelDB/IDB parsing) is deliberately out of scope.
#
# Usage:
#   ob-origin-export.sh list [substring]
#   ob-origin-export.sh export <origin-substring> [outdir]
# Env: OB_CONTAINER (default: first running ob-oc-*), OB_ORIGIN_MAX_MB (512)
set -eu

PROFILE=/home/agent/.config/chromium/Default/IndexedDB
MAX_MB=${OB_ORIGIN_MAX_MB:-512}

container() {
  if [ -n "${OB_CONTAINER:-}" ]; then echo "$OB_CONTAINER"; return; fi
  docker ps --format '{{.Names}}' | grep '^ob-oc-' | head -n 1
}

list_origins() {
  C=$(container); [ -n "$C" ] || { echo "no running desktop container (ob-oc-*)" >&2; exit 1; }
  docker exec "$C" sh -lc '
    for d in '"$PROFILE"'/*.leveldb; do
      [ -d "$d" ] || continue
      sz=$(du -sm "$d" | cut -f1)
      mt=$(stat -c %y "$d" | cut -d. -f1)
      printf "%s\t%sMB\t%s\n" "$(basename "$d")" "$sz" "$mt"
    done' | grep -i "${1:-.}" || true
}

export_origin() {
  NEEDLE=$1
  OUT=${2:-"origin-export-$(echo "$NEEDLE" | tr -cd 'A-Za-z0-9._-')"}
  C=$(container); [ -n "$C" ] || { echo "no running desktop container (ob-oc-*)" >&2; exit 1; }
  ORIGIN=$(docker exec "$C" sh -lc 'ls -d '"$PROFILE"'/*.leveldb 2>/dev/null' | grep -i "$NEEDLE" | head -n 1 || true)
  [ -n "$ORIGIN" ] || { echo "no persisted origin matching '$NEEDLE' (try: list)" >&2; exit 1; }
  NAME=$(basename "$ORIGIN" .leveldb)
  SIZE_MB=$(docker exec "$C" sh -lc 'du -sm "$1" | cut -f1' _ "$ORIGIN")
  [ "$SIZE_MB" -le "$MAX_MB" ] || { echo "origin is ${SIZE_MB}MB > OB_ORIGIN_MAX_MB=${MAX_MB}; refusing (raise the bound explicitly if intended)" >&2; exit 1; }

  T=$(mktemp -d)
  trap 'rm -rf "$T"' EXIT INT TERM
  manifest() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs -r sha256sum); }
  docker cp "$C:$ORIGIN" "$T/a" >/dev/null
  manifest "$T/a" > "$T/a.sha"
  docker cp "$C:$ORIGIN" "$T/b" >/dev/null
  manifest "$T/b" > "$T/b.sha"
  if ! cmp -s "$T/a.sha" "$T/b.sha"; then
    echo "origin changed during copy — its database is LIVE (a tab is writing)." >&2
    echo "Close that tab (or stop the desktop) and retry. Nothing was exported." >&2
    exit 2
  fi
  COMBINED=$(sha256sum "$T/a.sha" | cut -d' ' -f1)
  FILES=$(wc -l < "$T/a.sha" | tr -d ' ')
  mkdir -p "$OUT"
  cp -a "$T/a" "$OUT/$NAME.leveldb"
  if docker exec "$C" test -d "$PROFILE/$NAME.blob"; then
    docker cp "$C:$PROFILE/$NAME.blob" "$OUT/$NAME.blob" >/dev/null
  fi
  cp "$T/a.sha" "$OUT/MANIFEST.sha256"
  cat > "$OUT/provenance.json" <<JSON
{"tool":"ob-origin-export","container":"$C","origin":"$NAME","source":"$ORIGIN","exportedAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","leveldbFiles":$FILES,"leveldbMB":$SIZE_MB,"manifestSha256":"$COMBINED","stability":"two consecutive copies byte-identical"}
JSON
  echo "exported $NAME → $OUT"
  echo "leveldb: $FILES files, ${SIZE_MB}MB, manifest sha256 $COMBINED"
  echo "read-only: the profile was not modified; no browser was opened."
}

case "${1:-}" in
  list) list_origins "${2:-}" ;;
  export) [ -n "${2:-}" ] || { echo "usage: ob-origin-export.sh export <origin-substring> [outdir]" >&2; exit 64; }; export_origin "$2" "${3:-}" ;;
  *) echo "usage: ob-origin-export.sh list [substring] | export <origin-substring> [outdir]" >&2; exit 64 ;;
esac
