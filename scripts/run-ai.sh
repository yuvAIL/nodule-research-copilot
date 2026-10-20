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
# TotalSegmentator sends anonymous usage statistics by default — switch that off before using non-public scans.
set -euo pipefail
TS="${TOTALSEG:-TotalSegmentator}"
DEVICE="${DEVICE:-mps}"
if [ "$#" -eq 0 ]; then
  echo "Usage: scripts/run-ai.sh <CT series folder> [...]" >&2
  exit 1
fi
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
