// Usage: node index.js <inputDir> <outDir> <dayLabel>
// For each jpg: writes web (1600px) + thumb (480px) jpgs to outDir, and appends a JSON line to outDir/index.jsonl
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-backend-wasm');
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');

const MODEL = path.join(__dirname, 'node_modules/@vladmandic/face-api/model');

async function init() {
  await tf.setBackend('wasm');
  await tf.ready();
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL);
}

async function facesIn(buf, w, h, offX, offY, scale) {
  const t = tf.tensor3d(buf, [h, w, 3], 'int32');
  const dets = await faceapi
    .detectAllFaces(t, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5, maxResults: 40 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  t.dispose();
  return dets
    .filter((d) => d.detection.box.width >= 28)
    .map((d) => ({
      box: [d.detection.box.x / scale + offX, d.detection.box.y / scale + offY, d.detection.box.width / scale, d.detection.box.height / scale].map((v) => Math.round(v)),
      score: +d.detection.score.toFixed(3),
      d: Array.from(d.descriptor).map((v) => +v.toFixed(4)),
    }));
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
}

async function main() {
  const [inDir, outDir, day] = process.argv.slice(2);
  fs.mkdirSync(path.join(outDir, 'web'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'thumb'), { recursive: true });
  const done = new Set();
  const idxPath = path.join(outDir, 'index.jsonl');
  if (fs.existsSync(idxPath)) for (const l of fs.readFileSync(idxPath, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).sha);
  await init();
  const files = fs.readdirSync(inDir).filter((f) => /\.jpe?g$/i.test(f));
  for (const f of files) {
    const src = path.join(inDir, f);
    const raw = fs.readFileSync(src);
    const sha = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 16);
    if (done.has(sha)) { console.log('dup', f); fs.unlinkSync(src); continue; }
    const base = sharp(raw).rotate();
    const web = await base.clone().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    await base.clone().resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 72, mozjpeg: true }).toFile(path.join(outDir, 'thumb', sha + '.jpg'));
    fs.writeFileSync(path.join(outDir, 'web', sha + '.jpg'), web.data);
    const W = web.info.width, H = web.info.height;
    // detect on the full 1600px image, plus two overlapping halves upscaled so small faces in action shots are caught
    const full = await sharp(web.data).removeAlpha().raw().toBuffer();
    let faces = await facesIn(full, W, H, 0, 0, 1);
    const landscape = W >= H;
    const halfW = landscape ? Math.round(W * 0.6) : W, halfH = landscape ? H : Math.round(H * 0.6);
    for (const off of [0, 1]) {
      const left = landscape ? off * (W - halfW) : 0, top = landscape ? 0 : off * (H - halfH);
      const crop = await sharp(web.data).extract({ left, top, width: halfW, height: halfH })
        .resize({ width: Math.round(halfW * 1.6) }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const more = await facesIn(crop.data, crop.info.width, crop.info.height, left, top, 1.6);
      for (const m of more) if (!faces.some((x) => iou(x.box, m.box) > 0.3)) faces.push(m);
    }
    const rec = { sha, file: f, day, w: W, h: H, faces };
    fs.appendFileSync(idxPath, JSON.stringify(rec) + '\n');
    done.add(sha);
    fs.unlinkSync(src);
    console.log(f, faces.length);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
