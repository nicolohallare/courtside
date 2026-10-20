"""Build the site data for an album: album.json and faces.bin.

Usage:
  python3 build_album.py <out-dir> <site-data-dir> --id mdp-s3-invitational \
      --title "Season 3: Spin Off Edition" --venue "The Zone" --month "Oct 10-11, 2026" --credit "Ricky Tiu"

Needs from <out-dir>: index.jsonl (from index.js), order.json (from contact_sheets.py),
categories.json (optional; photo number -> P/G/V, anything missing is A).

faces.bin layout (what app.js reads):
  uint16[faceCount]        photo index of each face (position in album.photos)
  int8[faceCount * 128]    face descriptors, value = q * faceScale
Only faces with detection score >= 0.7 and box width >= 40px are kept (weaker ones are mostly noise).
"""
import argparse
import json
import os

import numpy as np

MIN_SCORE = 0.7
MIN_WIDTH = 40
SCALE = 0.55  # descriptor values stay within about +-0.53


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("site_data")
    ap.add_argument("--id", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="")
    ap.add_argument("--venue", default="")
    ap.add_argument("--month", default="")
    ap.add_argument("--credit", default="")
    a = ap.parse_args()

    recs = {}
    for line in open(os.path.join(a.out, "index.jsonl")):
        if line.strip():
            r = json.loads(line)
            recs[r["sha"]] = r
    order = json.load(open(os.path.join(a.out, "order.json")))
    cat_path = os.path.join(a.out, "categories.json")
    cats = json.load(open(cat_path)) if os.path.exists(cat_path) else {}

    photos, desc, pidx = [], [], []
    for n, sha in enumerate(order):
        r = recs[sha]
        day = int("".join(ch for ch in r["day"] if ch.isdigit()) or 1)
        photos.append([sha, day, cats.get(str(n), "A"), r["w"], r["h"]])
        for f in r["faces"]:
            if f["score"] >= MIN_SCORE and f["box"][2] >= MIN_WIDTH:
                desc.append(f["d"])
                pidx.append(n)

    F = np.array(desc, dtype=np.float32).reshape(-1, 128)
    q = np.clip(np.round(F / SCALE * 127), -127, 127).astype(np.int8)
    album = {
        "id": a.id, "title": a.title, "subtitle": a.subtitle, "venue": a.venue,
        "month": a.month, "credit": a.credit, "photos": photos,
        "faceScale": SCALE / 127, "faceCount": len(pidx),
    }
    os.makedirs(a.site_data, exist_ok=True)
    json.dump(album, open(os.path.join(a.site_data, "album.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    with open(os.path.join(a.site_data, "faces.bin"), "wb") as fh:
        fh.write(np.array(pidx, dtype=np.uint16).tobytes())
        fh.write(q.tobytes())
    counts = {k: sum(1 for p in photos if p[2] == k) for k in "APGV"}
    print(f"{len(photos)} photos {counts}, {len(pidx)} faces indexed")


if __name__ == "__main__":
    main()
