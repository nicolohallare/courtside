# MDP Photos

Face-search photo gallery for Match Day Pickle tournaments. Live at https://mdp-photos.netlify.app (Netlify project `mdp-photos`).
First album: Season 3 Spin Off Edition (Oct 10–11, 2026): 2,282 photos.

Separate from the Courtside app for now; the plan is to bring it in as a Photos tab.

## Layout
```
site/       static site deployed to Netlify (no build step)
  index.html, app.js, style.css, config.js
  data/album.json      photos: [sha, day, category, w, h]
  data/champions.json  podium per division
  data/faces.bin       NOT committed (face descriptors); rebuilt by build_album.py
  netlify.toml         proxies /img/* to the R2 public URL (cached at Netlify edge)
pipeline/
  index.js           resize (1600 web / 480 thumb) + face index one folder of jpgs
  watch.sh           runs index.js on photos as they land in a staging folder
  contact_sheets.py  album order + numbered sheets for categorizing
  build_album.py     album.json + faces.bin for the site
  upload_r2.py       web + thumb photos to R2 (skips files already there)
  parse_results.py   results PDF -> champions.json
```

## How it works
- Photos live in Cloudflare R2 bucket `mdp-photos` under `albums/<album-id>/{web,thumb}/<sha>.jpg`.
- Faces: @vladmandic/face-api 1.7.15 (MIT), same model offline (Node + tfjs wasm) and in the browser (WebGL).
  Only faces with score >= 0.7 and width >= 40px are indexed. faces.bin = uint16 photo index per face, then int8 descriptors (scale 0.55/127).
- Search runs fully on the phone: live camera only, selfie never uploaded. Seeds < 0.40, centroid expansion < 0.42 with >= 50% seed support; "Maybe" label at >= 0.40.
- Forms (Netlify Forms): `club-interest`, `photo-removal`.

## Adding the next album
Setup once: `cd pipeline && npm install && pip install -r requirements.txt` (and `pdftotext` for results).

1. **Index.** For each day folder: `node pipeline/index.js "<photos>/Day 1" <out> "Day 1"`.
   Or start `pipeline/watch.sh <staging> <out>` and drop day folders into `<staging>` as they arrive.
   Writes `<out>/web`, `<out>/thumb`, `<out>/index.jsonl`. Duplicate files are skipped. Source jpgs are deleted after processing, so work on a copy.
2. **Categorize.** `python3 pipeline/contact_sheets.py <out>`, review `<out>/sheets/*.jpg`, write `<out>/categories.json`
   with only the non-Action photos: `{"12": "P", "40": "G", "41": "V"}` (P = Podium & Awards, G = Groups & Candids, V = Venue & Sponsors).
3. **Upload.** Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, then `python3 pipeline/upload_r2.py <out> <album-id>`.
4. **Build.** `python3 pipeline/build_album.py <out> site/data --id <album-id> --title "..." --venue "..." --month "..." --credit "..."`.
   Champions: `python3 pipeline/parse_results.py results.pdf site/data/champions.json`, then check its output against the PDF.
5. **Update the page.** In `app.js` set `ALBUM_ID`, sponsors (`LEAD`, `PARTNERS`); in `index.html` the season text, video link and og tags.
6. **Deploy** `site/` to the Netlify project `mdp-photos`.

Checked: steps 2, 4 and the results parser reproduce the live Season 3 data byte for byte, and the upload script runs against the live bucket (0 new files).

R2 and Netlify credentials are never stored in this repo.
