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
  data/faces.bin       NOT committed (face descriptors); regenerate with the pipeline
  netlify.toml         proxies /img/* to the R2 public URL (cached at Netlify edge)
pipeline/
  index.js     resize (1600 web / 480 thumb) + face index one folder of jpgs
  daemon.sh    watches a staging folder and runs index.js as photos arrive
```

## How it works
- Photos live in Cloudflare R2 bucket `mdp-photos` under `albums/<album-id>/{web,thumb}/<sha>.jpg`.
- Faces: @vladmandic/face-api 1.7.15 (MIT), same model offline (Node + tfjs wasm) and in the browser (WebGL).
  Only faces with score >= 0.7 and width >= 40px are indexed. faces.bin = uint16 photo index per face, then int8 descriptors (scale 0.55/127).
- Search runs fully on the phone: live camera only, selfie never uploaded. Seeds < 0.40, centroid expansion < 0.42 with >= 50% seed support; "Maybe" label at >= 0.40.
- Forms (Netlify Forms): `club-interest`, `photo-removal`.

## Adding the next album
1. Stage photos into a folder, run `node pipeline/index.js <dir> <out> "Day 1"` per day folder.
2. Categorize (A = Action, P = Podium & Awards, G = Groups & Candids, V = Venue & Sponsors).
3. Upload `<out>/web` and `<out>/thumb` to R2 with `Cache-Control: public, max-age=31536000, immutable`.
4. Build album.json + faces.bin, update champions.json and the copy in index.html, deploy `site/`.

R2 and Netlify credentials are never stored in this repo.
