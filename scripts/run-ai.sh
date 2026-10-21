#!/usr/bin/env bash
# Runs the AI on one or more CT folders, on this computer (scans never leave it).
#
#   scripts/run-ai.sh <CT series folder> [<more folders> ...]
#
# For each folder <scan>, writes next to it a folder <scan>_ai/ with:
#   ai-lung-nodules.dcm  nodule candidates   (TotalSegmentator task lung_nodules)
#   ai-lung-lobes.dcm    the five lung lobes  (TotalSegmentator task total, lobe classes)
# Then open the PARENT folder in Nodule Research Copilot: the AI results are picked up automatically.
#
# Needs TotalSegmentator (pip install TotalSegmentator highdicom). Set TOTALSEG=/path/to/TotalSegmentator
# if it is not on PATH, and DEVICE=cpu on machines without Apple Silicon / CUDA (DEVICE=gpu for NVIDIA).
# TotalSegmentator sends anonymous usage statistics by default. This script switches that off before every run
# (send_usage_stats = false in ~/.totalsegmentator/config.json), so nothing about the run leaves the computer.
set -euo pipefail
TS="${TOTALSEG:-TotalSegmentator}"
DEVICE="${DEVICE:-mps}"
if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/run-ai.sh <CT series folder> [...]" >&2
  exit 1
fi
# Opt out of TotalSegmentator's anonymous usage statistics (keeps any other settings in the config file).
python3 - <<'PY'
import json, os, secrets
p = os.path.expanduser("~/.totalsegmentator/config.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
cfg = {}
if os.path.exists(p):
    try:
        cfg = json.load(open(p))
    except Exception:
        cfg = {}
cfg.setdefault("totalseg_id", "totalseg_" + secrets.token_hex(5))
cfg.setdefault("prediction_counter", 0)
cfg["send_usage_stats"] = False
json.dump(cfg, open(p, "w"), indent=4)
print("TotalSegmentator usage statistics: off (" + p + ")")
PY
for scan in "$@"; do
  scan="${scan%/}"
  out="${scan}_ai"
  mkdir -p "$out"
  echo "== $scan"
  if [ ! -f "$out/ai-lung-nodules.dcm" ]; then
    "$TS" -i "$scan" -o "$out/ai-lung-nodules.dcm" -ta lung_nodules --output_type dicom_seg --device "$DEVICE"
  fi
  if [ ! -f "$out/ai-lung-lobes.dcm" ]; then
    "$TS" -i "$scan" -o "$out/ai-lung-lobes.dcm" -ta total --output_type dicom_seg --device "$DEVICE" \
      --roi_subset lung_upper_lobe_left lung_lower_lobe_left lung_upper_lobe_right lung_middle_lobe_right lung_lower_lobe_right
  fi
  echo "   → $out"
done
echo "Done. Open the parent folder in the app."
