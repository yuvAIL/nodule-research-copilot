#!/usr/bin/env bash
# One command for the LIDC-IDRI challenging-nodule test (public data, runs on this computer):
#   scripts/lidc/run-lidc.sh
# Uses the same Python as TotalSegmentator. Output in data/lidc/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/../.."
TS="${TOTALSEG:-}"
for c in "$(command -v TotalSegmentator || true)" "$HOME/idc-venv/bin/TotalSegmentator" "$HOME/.venv/bin/TotalSegmentator"; do
  if [ -z "$TS" ] && [ -n "$c" ] && [ -x "$c" ]; then TS="$c"; fi
done
if [ -z "$TS" ]; then echo "TotalSegmentator not found (set TOTALSEG=/path/to/TotalSegmentator)" >&2; exit 1; fi
case "$TS" in */.pyenv/shims/*) TS="$(pyenv which TotalSegmentator)" ;; esac
PY="$(head -1 "$TS" | sed 's/^#!//')"
case "$PY" in */env*|*bash*|*sh) PY="$(dirname "$TS")/python3"; [ -x "$PY" ] || PY="python3" ;; esac
echo "TotalSegmentator: $TS"
echo "Python:           $PY"
mkdir -p data
"$PY" -m pip install -q --no-deps pylidc
"$PY" -m pip install -q idc-index
TOTALSEG="$TS" "$PY" scripts/lidc/prepare_lidc.py --out data/lidc "$@" 2>&1 | tee data/lidc-run.log
