"""Make numbered contact sheets for categorizing an album.

Usage: python3 contact_sheets.py <out-dir>

Reads <out-dir>/index.jsonl and <out-dir>/thumb/, writes <out-dir>/order.json (the album order)
and <out-dir>/sheets/sNN.jpg (48 thumbnails each, numbered by position in order.json).

Review the sheets and write <out-dir>/categories.json mapping photo number (string) to a letter,
listing only photos that are NOT Action:
  P = Podium & Awards, G = Groups & Candids, V = Venue & Sponsors   (missing = A, Action)
"""
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont


def sort_key(r):
    nums = [int(x) for x in re.findall(r"\d+", r["file"])]
    # edited exports ("Matchday ... -12.jpg") first, then camera originals by prefix, numerically
    return (r["day"], 0 if r["file"].startswith("Matchday") else 1, r["file"][:3], nums)


def main(out):
    recs = [json.loads(l) for l in open(os.path.join(out, "index.jsonl")) if l.strip()]
    recs.sort(key=sort_key)
    json.dump([r["sha"] for r in recs], open(os.path.join(out, "order.json"), "w"))
    os.makedirs(os.path.join(out, "sheets"), exist_ok=True)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
    per, cols, t = 48, 8, 200
    for s in range(0, len(recs), per):
        sheet = Image.new("RGB", (cols * t, (per // cols) * t), "black")
        d = ImageDraw.Draw(sheet)
        for i, r in enumerate(recs[s:s + per]):
            im = Image.open(os.path.join(out, "thumb", r["sha"] + ".jpg"))
            im.thumbnail((t - 4, t - 4))
            x, y = (i % cols) * t, (i // cols) * t
            sheet.paste(im, (x + 2, y + 2))
            d.rectangle([x + 2, y + 2, x + 62, y + 28], fill="yellow")
            d.text((x + 5, y + 3), str(s + i), fill="black", font=font)
        sheet.save(os.path.join(out, "sheets", f"s{s // per:02d}.jpg"), quality=70)
    print(f"{len(recs)} photos, {(len(recs) + per - 1) // per} sheets")


if __name__ == "__main__":
    main(sys.argv[1])
