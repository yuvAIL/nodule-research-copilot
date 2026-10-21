#!/usr/bin/env python3
"""
LIDC-IDRI challenging-nodule test set: select -> export expert outlines -> download CT -> run the AI (timed).

    python3 scripts/lidc/prepare_lidc.py [--out data/lidc] [--device mps] [--skip-ai]

Run from the repository root, with the Python that has TotalSegmentator. Everything is public, de-identified data.

1. SELECT (rules fixed before any AI result exists; nothing is picked by looking at images or AI output)
   Annotations come from the LIDC-IDRI radiologist XML, as packaged in pylidc's bundled SQLite database
   (pip install --no-deps pylidc; the Python package itself is not imported, only its database is read).
   - Scans: slice thickness <= 2.5 mm, one scan per patient, ordered by patient ID.
   - Annotations of the same nodule are grouped when their 3-D bounding boxes overlap (single linkage).
   - A nodule is a "reference nodule" when >= 3 of the 4 radiologists outlined it (LUNA16 convention).
   - Type = median of the readers' LIDC "texture" rating (1 = non-solid/ground-glass ... 5 = solid):
       <= 2.5 non-solid (ground-glass) | < 4 part-solid | >= 4 solid.
   - Size = median over readers of the largest in-plane contour extent (mm).
   - Categories, first scans in patient-ID order that contain a reference nodule of that kind:
       4 x non-solid, 3 x part-solid, 5 x small solid (4-10 mm), 3 x large solid (>= 20 mm).
   EVERY annotation on a selected scan is exported, so all nodules on those scans are evaluated, not only the
   one that caused the selection.
2. EXPORT  data/lidc/ground-truth.json (contours in pixel coordinates + z), data/lidc/selection.json (rules, counts).
3. DOWNLOAD the selected CT series from the NCI Imaging Data Commons (idc-index) into data/lidc/ct/.
4. AI      TotalSegmentator lung_nodules on each CT, wall-clock timed -> data/lidc/ai/<SeriesInstanceUID>.dcm,
           timings in data/lidc/inference-times.json. The AI only ever receives the CT folder.
"""
import argparse
import importlib.metadata
import importlib.util
import json
import math
import os
import platform
import shutil
import sqlite3
import statistics
import subprocess
import sys
import time

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="data/lidc")
ap.add_argument("--device", default=os.environ.get("DEVICE", "mps"))
ap.add_argument("--skip-ai", action="store_true")
ap.add_argument("--max-thickness", type=float, default=2.5)
args = ap.parse_args()
OUT = os.path.abspath(args.out)
os.makedirs(OUT, exist_ok=True)


def version(pkg):
    try:
        return importlib.metadata.version(pkg)
    except Exception:
        return "unknown"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 1. annotation database
spec = importlib.util.find_spec("pylidc")
if spec is None or not spec.submodule_search_locations:
    sys.exit("pylidc is not installed: python3 -m pip install --no-deps pylidc")
db_path = os.path.join(list(spec.submodule_search_locations)[0], "pylidc.sqlite")
if not os.path.exists(db_path):
    sys.exit(f"pylidc database not found at {db_path}")
con = sqlite3.connect(db_path)
con.row_factory = sqlite3.Row

schema = {}
for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    schema[t] = [r[1] for r in con.execute(f"PRAGMA table_info({t})")]
with open(os.path.join(OUT, "schema.json"), "w") as f:
    json.dump(schema, f, indent=1)


def pick(cols, *names):
    for n in names:
        if n in cols:
            return n
    sys.exit(f"Unexpected pylidc schema: none of {names} in {cols} (see {OUT}/schema.json)")


S, A, C = schema.get("scans", []), schema.get("annotations", []), schema.get("contours", [])
s_pid, s_uid = pick(S, "patient_id"), pick(S, "series_instance_uid")
s_thk, s_ps = pick(S, "slice_thickness"), pick(S, "pixel_spacing")
a_scan, a_tex = pick(A, "scan_id"), pick(A, "texture")
c_ann, c_z = pick(C, "annotation_id"), pick(C, "image_z_position")
c_coords, c_incl = pick(C, "coords"), pick(C, "inclusion")

scans = {r["id"]: dict(r) for r in con.execute("SELECT * FROM scans")}
anns = {r["id"]: dict(r) for r in con.execute("SELECT * FROM annotations")}
contours = {}
for r in con.execute("SELECT * FROM contours"):
    contours.setdefault(r[c_ann], []).append(dict(r))
log(f"pylidc database: {len(scans)} scans, {len(anns)} annotations, {sum(map(len, contours.values()))} contours")


def parse_coords(text):
    pts = []
    for line in str(text).strip().splitlines():
        line = line.strip()
        if not line:
            continue
        x, y = line.split(",")[:2]
        pts.append((float(x), float(y)))
    return pts


def ann_geometry(aid, ps):
    cs = contours.get(aid, [])
    xs, ys, zs, diam = [], [], [], 0.0
    for c in cs:
        pts = parse_coords(c[c_coords])
        if not pts:
            continue
        z = float(c[c_z])
        for x, y in pts:
            xs.append(x * ps)
            ys.append(y * ps)
            zs.append(z)
        if c[c_incl] in (1, True, "1", "True", "true"):
            sub = pts[:: max(1, len(pts) // 48)]  # selection only; exact sizes are measured later from the masks
            for i in range(len(sub)):
                for j in range(i + 1, len(sub)):
                    d = math.hypot(sub[i][0] - sub[j][0], sub[i][1] - sub[j][1]) * ps
                    diam = max(diam, d)
    if not xs:
        return None
    return {"bbox": (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)), "diam": diam}


def overlap(b1, b2, m_xy, m_z):
    return (b1[0] - m_xy <= b2[1] and b2[0] - m_xy <= b1[1] and b1[2] - m_xy <= b2[3] and b2[2] - m_xy <= b1[3]
            and b1[4] - m_z <= b2[5] and b2[4] - m_z <= b1[5])


def nodule_type(med):
    return "non-solid" if med <= 2.5 else ("part-solid" if med < 4 else "solid")


by_scan = {}
for aid, a in anns.items():
    by_scan.setdefault(a[a_scan], []).append(aid)

eligible = []
for sid, s in scans.items():
    thk = s[s_thk]
    if thk is None or float(thk) > args.max_thickness or sid not in by_scan:
        continue
    ps = float(s[s_ps])
    geo = {aid: ann_geometry(aid, ps) for aid in by_scan[sid]}
    geo = {k: v for k, v in geo.items() if v}
    ids = sorted(geo)
    parent = {i: i for i in ids}

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if overlap(geo[ids[i]]["bbox"], geo[ids[j]]["bbox"], ps, float(thk) / 2):
                parent[find(ids[i])] = find(ids[j])
    clusters = {}
    for i in ids:
        clusters.setdefault(find(i), []).append(i)
    nods = []
    for members in clusters.values():
        tex = [int(anns[m][a_tex]) for m in members if anns[m][a_tex] is not None]
        med = statistics.median(tex) if tex else None
        diam = statistics.median([geo[m]["diam"] for m in members])
        nods.append({"annotations": sorted(members), "readers": len(members), "textures": tex,
                     "textureMedian": med, "type": nodule_type(med) if med is not None else "unknown",
                     "diameterMm": round(diam, 1), "reference": len(members) >= 3})
    eligible.append({"scanId": sid, "patient": s[s_pid], "series": s[s_uid], "thickness": float(thk),
                     "pixelSpacing": ps, "nodules": nods})

eligible.sort(key=lambda e: (e["patient"], e["scanId"]))
CATS = [
    ("non-solid", 4, lambda n: n["reference"] and n["type"] == "non-solid"),
    ("part-solid", 3, lambda n: n["reference"] and n["type"] == "part-solid"),
    ("small solid 4-10 mm", 5, lambda n: n["reference"] and n["type"] == "solid" and 4 <= n["diameterMm"] <= 10),
    ("large solid >= 20 mm", 3, lambda n: n["reference"] and n["type"] == "solid" and n["diameterMm"] >= 20),
]
counts = {name: sum(1 for e in eligible if any(rule(n) for n in e["nodules"])) for name, _, rule in CATS}
chosen, used_patients = [], set()
for name, k, rule in CATS:
    got = 0
    for e in eligible:
        if got == k:
            break
        if e["patient"] in used_patients or not any(rule(n) for n in e["nodules"]):
            continue
        chosen.append({**e, "selectedFor": name})
        used_patients.add(e["patient"])
        got += 1
log("Eligible scans per category:", counts)
for e in chosen:
    log(f"  {e['patient']}  {e['selectedFor']:<22} reference nodules {sum(n['reference'] for n in e['nodules'])}")

gt = []
for e in chosen:
    nods = []
    for i, n in enumerate(e["nodules"]):
        nods.append({**n, "id": i + 1, "annotations": [
            {"annotationId": aid, "texture": anns[aid][a_tex],
             "characteristics": {k: anns[aid][k] for k in A if k not in ("id", a_scan, "_nodule_id")},
             "contours": [{"z": float(c[c_z]), "inclusion": c[c_incl] in (1, True, "1", "True", "true"),
                           "coords": parse_coords(c[c_coords])} for c in contours.get(aid, [])]}
            for aid in n["annotations"]]})
    gt.append({k: e[k] for k in ("patient", "series", "thickness", "pixelSpacing", "selectedFor")} | {"nodules": nods})
with open(os.path.join(OUT, "ground-truth.json"), "w") as f:
    json.dump({"source": "LIDC-IDRI radiologist annotations via pylidc " + version("pylidc"),
               "coords": "contour points in pixel units as stored by pylidc (x = column, y = row); z = ImagePositionPatient z, mm",
               "scans": gt}, f)
with open(os.path.join(OUT, "selection.json"), "w") as f:
    json.dump({"rules": __doc__, "maxThicknessMm": args.max_thickness, "eligibleScansPerCategory": counts,
               "eligibleScans": len(eligible),
               "chosen": [{k: e[k] for k in ("patient", "series", "thickness", "selectedFor")} for e in chosen]}, f, indent=1)
log(f"Wrote {OUT}/ground-truth.json and selection.json ({len(chosen)} scans)")

# ---------------------------------------------------------------- 2. download CT (IDC)
from idc_index import IDCClient  # noqa: E402

client = IDCClient()
uids = [e["series"] for e in chosen]
try:
    idx = client.index
    mb = idx[idx["SeriesInstanceUID"].isin(uids)]["series_size_MB"].sum()
    log(f"Downloading {len(uids)} CT series, about {mb:.0f} MB, from the NCI Imaging Data Commons ...")
except Exception:
    pass
CT = os.path.join(OUT, "ct")
os.makedirs(CT, exist_ok=True)
t0 = time.time()
try:
    client.download_from_selection(downloadDir=CT, seriesInstanceUID=uids, dirTemplate="%SeriesInstanceUID")
except TypeError:
    client.download_from_selection(downloadDir=CT, seriesInstanceUID=uids)
log(f"Download finished in {time.time() - t0:.0f} s")

import pydicom  # noqa: E402  (installed with TotalSegmentator/highdicom)

series_dir = {}
for root, _dirs, files in os.walk(CT):
    for fn in files:
        try:
            ds = pydicom.dcmread(os.path.join(root, fn), stop_before_pixels=True)
        except Exception:
            continue
        series_dir.setdefault(str(ds.SeriesInstanceUID), root)
        break
missing = [u for u in uids if u not in series_dir]
if missing:
    log("WARNING: not downloaded:", missing)
with open(os.path.join(OUT, "ct-folders.json"), "w") as f:
    json.dump(series_dir, f, indent=1)

# ---------------------------------------------------------------- 3. AI, timed
if args.skip_ai:
    sys.exit(0)
ts_bin = os.environ.get("TOTALSEG") or shutil.which("TotalSegmentator") or os.path.join(os.path.dirname(sys.executable), "TotalSegmentator")
AI = os.path.join(OUT, "ai")
os.makedirs(AI, exist_ok=True)
times_path = os.path.join(OUT, "inference-times.json")
times = json.load(open(times_path)) if os.path.exists(times_path) else {}
try:
    chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
except Exception:
    chip = ""
machine = {"platform": platform.platform(), "chip": chip or platform.processor(), "device": args.device,
           "totalsegmentator": version("TotalSegmentator")}
for n, uid in enumerate(uids, 1):
    out = os.path.join(AI, f"{uid}.dcm")
    if uid not in series_dir or os.path.exists(out):
        continue
    log(f"[{n}/{len(uids)}] AI on {uid[-12:]} ...")
    t0 = time.time()
    r = subprocess.run([ts_bin, "-i", series_dir[uid], "-o", out, "-ta", "lung_nodules", "--output_type", "dicom_seg",
                        "--device", args.device], capture_output=True, text=True)
    secs = time.time() - t0
    times[uid] = {"seconds": round(secs, 1), "ok": r.returncode == 0 and os.path.exists(out),
                  "slices": len(os.listdir(series_dir[uid])), "error": r.stderr[-800:] if r.returncode else "", **machine}
    json.dump(times, open(times_path, "w"), indent=1)
    log(f"      {secs:.0f} s  {'ok' if times[uid]['ok'] else 'FAILED'}")
ok = sum(1 for u in uids if times.get(u, {}).get("ok"))
log(f"DONE: {ok}/{len(uids)} scans have an AI result in {AI}")
