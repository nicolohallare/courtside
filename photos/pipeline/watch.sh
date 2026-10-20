#!/bin/bash
# Watch a staging folder and index photos as they arrive.
# Usage: watch.sh <staging-dir> <out-dir>
# Expects day subfolders anywhere below <staging-dir> named like "Day 1 ..." / "Day 2 ...".
# index.js deletes each source jpg after it is processed, so the staging folder empties as it goes.
set -u
STAGE="${1:?staging dir}"
OUT="${2:?output dir}"
HERE="$(cd "$(dirname "$0")" && pwd)"
while true; do
  while IFS= read -r -d '' d; do
    ls "$d"/*.jpg "$d"/*.JPG >/dev/null 2>&1 || continue
    day=$(basename "$d" | grep -oE 'Day [0-9]+' || echo "Day 1")
    node "$HERE/index.js" "$d" "$OUT" "$day" >> "$OUT/log.txt" 2>&1
  done < <(find "$STAGE" -type d -iname 'Day *' -print0)
  sleep 5
done
