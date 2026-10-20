"""Turn an MDP official results PDF into the site's champions.json.

Usage: python3 parse_results.py <results.pdf> <site-data-dir>/champions.json
Needs `pdftotext` (poppler-utils). Reads each category header ("19+ MIXED DOUBLES — NOVICE")
and the Gold / Silver / Bronze rows of its "Final standings" table.
Check the printed list against the PDF before deploying.
"""
import json
import re
import subprocess
import sys


def nice(cat):
    a, b = cat.split(" — ")
    a = a.replace("MEN'S", "Men's").replace("WOMEN'S", "Women's").replace("MIXED", "Mixed").replace("DOUBLES", "Doubles")
    b = " ".join(w if w in ("A", "B") else w.capitalize() for w in b.split())
    return f"{a} · {b}"


def main(pdf, out):
    text = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    rows, cur, day = [], None, 1
    for line in text.split("\n"):
        s = line.strip()
        m = re.match(r"^DAY (\d)\s", s)
        if m:
            day = int(m.group(1))
        m = re.match(r"^(\d\d\+ [A-Z' ]+DOUBLES — [A-Z ]+?)(\s{2,}.*)?$", s)
        if m:
            cur = {"day": day, "cat": nice(m.group(1).strip())}
            rows.append(cur)
            continue
        m = re.match(r"^(Gold|Silver|Bronze)\s+\d+\s+(.+?)\s{2,}\d+[–-]\d+", s)
        if m and cur is not None:
            k = {"Gold": "g", "Silver": "s", "Bronze": "b"}[m.group(1)]
            cur.setdefault(k, m.group(2).strip())
    for r in rows:
        missing = [k for k in "gsb" if k not in r]
        print(r["day"], r["cat"], "|", r.get("g"), "|", r.get("s"), "|", r.get("b"), "MISSING " + ",".join(missing) if missing else "")
    json.dump(rows, open(out, "w"), ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
