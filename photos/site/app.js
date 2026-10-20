const CFG = window.MDP_CONFIG;
const ALBUM_ID = 'mdp-s3-invitational';
const IMG = (kind, sha) => `${CFG.imageBase}/albums/${ALBUM_ID}/${kind}/${sha}.jpg`;
const CAT_NAMES = { A: 'Action', P: 'Podium & Awards', G: 'Groups & Candids', V: 'Venue & Sponsors' };
const $ = (s) => document.querySelector(s);

let album = null, faces = null;
const state = { day: 0, cat: 'all', list: [], shown: 0, results: [], lbList: [], lbPos: 0 };

/* ---------- data ---------- */
async function loadAlbum() {
  album = await fetch('/data/album.json').then((r) => r.json());
  album.photos = album.photos.map(([sha, day, cat, w, h], i) => ({ i, sha, day, cat, w, h }));
  $('#albumCount').textContent = `${album.photos.length.toLocaleString()} photos · by ${album.credit}`;
  $('#albumSub').textContent = `${album.month} · ${album.photos.length.toLocaleString()} photos · by ${album.credit} · ${album.venue}`;
  const picks = [album.photos.find((p) => p.cat === 'P'), album.photos.find((p) => p.cat === 'A' && p.w > p.h), album.photos.find((p) => p.cat === 'G')].filter(Boolean);
  $('#mosaic').innerHTML = picks.map((p) => `<img src="${IMG('thumb', p.sha)}" alt="" loading="lazy">`).join('');
  buildFilters();
  loadExtras();
}
async function loadFaces() {
  if (faces) return faces;
  const buf = await fetch('/data/faces.bin').then((r) => r.arrayBuffer());
  const n = album.faceCount;
  const idx = new Uint16Array(buf, 0, n);
  const q = new Int8Array(buf, n * 2, n * 128);
  const d = new Float32Array(n * 128);
  for (let k = 0; k < d.length; k++) d[k] = q[k] * album.faceScale;
  faces = { n, idx, d };
  return faces;
}

/* ---------- season extras ---------- */
const LEAD = [['Wilson', '/logo-wilson.png'], ['DITO Telecommunity', '/logo-dito.png']];
const PARTNERS = ['Lambretta','Vita Coco','Evian',"Nature's Spring","Welch's",'Minute Maid','Pocari','Angkan','Culture Blends','Primebeef','Gyukatsu','Bistro by Le Blanc','Barilla','Act II Popcorn','Daily Fix Granola','Oh So Healthy','Halls','Tulip','Fly Ace',"Dad's",'Locally','Nutribullet','Aveeno Baby',"Johnson's Baby",'White Cloud','Listerine','Bactidol','Kotex','Modess','Rexona'];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let champs = [];
async function loadExtras() {
  $('#sponsors').innerHTML = `<div class="sp-lead">${LEAD.map(([n, src]) => `<span><img src="${src}" alt="${n}"></span>`).join('')}</div><div class="sp-rest">${PARTNERS.map((n) => `<span>${esc(n)}</span>`).join('')}</div>`;
  const pick = album.photos.filter((p) => p.cat === 'P' && p.w > p.h)[5] || album.photos[0];
  document.querySelectorAll('.vthumb, [data-vthumb]').forEach((el) => { el.style.backgroundImage = `url(${IMG('thumb', pick.sha)})`; });
  champs = await fetch('/data/champions.json').then((r) => r.json()).catch(() => []);
  renderChamps(1);
}
function renderChamps(d) {
  document.querySelectorAll('#champTabs button').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.d === d));
  $('#champList').innerHTML = champs.filter((c) => c.day === d).map((c) => `<details class="champ"><summary><span class="cat">${esc(c.cat)}</span><span class="gold-team">${esc(c.g)}</span><span class="hint">See podium</span></summary><div class="more-teams"><span>🥈 ${esc(c.s)}</span><span>🥉 ${esc(c.b)}</span></div></details>`).join('');
}
$('#champTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) renderChamps(+b.dataset.d); });

/* ---------- album grid ---------- */
function buildFilters() {
  const days = [[0, 'All days'], [1, 'Day 1'], [2, 'Day 2']];
  $('#dayTabs').innerHTML = days.map(([v, l]) => `<button type="button" data-day="${v}" aria-pressed="${state.day === v}">${l}</button>`).join('');
  const inDay = album.photos.filter((p) => !state.day || p.day === state.day);
  const cats = [['all', 'All', inDay.length], ...Object.entries(CAT_NAMES).map(([k, l]) => [k, l, inDay.filter((p) => p.cat === k).length])];
  $('#catChips').innerHTML = cats.map(([v, l, c]) => `<button type="button" data-cat="${v}" aria-pressed="${state.cat === v}">${l}<small>${c}</small></button>`).join('');
}
function renderGrid() {
  state.list = album.photos.filter((p) => (!state.day || p.day === state.day) && (state.cat === 'all' || p.cat === state.cat));
  state.shown = 0;
  $('#grid').innerHTML = '';
  moreGrid();
}
function tile(p, list, pos, extra = '') {
  return `<button type="button" class="tile" data-pos="${pos}" data-list="${list}" aria-label="Open photo ${p.i + 1}"><img src="${IMG('thumb', p.sha)}" alt="" loading="lazy" decoding="async" onerror="retryImg(this)">${extra}</button>`;
}
function moreGrid() {
  const next = state.list.slice(state.shown, state.shown + 90);
  $('#grid').insertAdjacentHTML('beforeend', next.map((p, k) => tile(p, 'album', state.shown + k)).join(''));
  state.shown += next.length;
}
new IntersectionObserver((e) => { if (e[0].isIntersecting && album && state.shown < state.list.length) moreGrid(); }, { rootMargin: '800px' }).observe($('#gridMore'));
$('#dayTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.day = +b.dataset.day; buildFilters(); renderGrid(); });
$('#catChips').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.cat = b.dataset.cat; buildFilters(); renderGrid(); });

window.retryImg = (img) => {
  const n = +(img.dataset.retry || 0);
  if (n >= 4) return;
  img.dataset.retry = n + 1;
  setTimeout(() => { img.src = img.src.split('?')[0] + '?r=' + (n + 1); }, 800 * 2 ** n);
};

/* ---------- lightbox ---------- */
function openLb(list, pos) {
  state.lbList = list; state.lbPos = pos; $('#lb').hidden = false; showLb();
}
function showLb() {
  const p = state.lbList[state.lbPos];
  $('#lbImg').src = IMG('web', p.sha);
  $('#lbNum').textContent = `Photo #${p.i + 1} · ${CAT_NAMES[p.cat]}`;
}
function stepLb(d) { state.lbPos = (state.lbPos + d + state.lbList.length) % state.lbList.length; showLb(); }
document.addEventListener('click', (e) => {
  const x = e.target.closest('.x');
  if (x) { e.stopPropagation(); hideResult(+x.dataset.i); return; }
  const t = e.target.closest('.tile');
  if (t) openLb(t.dataset.list === 'album' ? state.list : state.results, +t.dataset.pos);
});
$('#lbClose').onclick = () => { $('#lb').hidden = true; $('#lbImg').src = ''; };
$('#lbImg').onerror = () => retryImg($('#lbImg'));
$('#lbPrev').onclick = () => stepLb(-1);
$('#lbNext').onclick = () => stepLb(1);
document.addEventListener('keydown', (e) => {
  if ($('#lb').hidden) return;
  if (e.key === 'Escape') $('#lbClose').click(); else if (e.key === 'ArrowLeft') stepLb(-1); else if (e.key === 'ArrowRight') stepLb(1);
});
let touchX = null;
$('#lb').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#lb').addEventListener('touchend', (e) => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) stepLb(dx < 0 ? 1 : -1); touchX = null; });

async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (_) { /* fall through */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('#lbDl').onclick = async () => {
  const p = state.lbList[state.lbPos];
  try { const b = await fetch(IMG('web', p.sha)).then((r) => { if (!r.ok) throw 0; return r.blob(); }); await saveBlob(b, `MDP-photo-${p.i + 1}.jpg`); }
  catch (_) { window.open(IMG('web', p.sha), '_blank'); }
};

/* ---------- face search ---------- */
let faceapi = null, stream = null;
const status = (t, err) => { const s = $('#findStatus'); s.textContent = t; s.classList.toggle('err', !!err); };
async function loadModels() {
  if (faceapi) return;
  status('Loading face matcher…');
  faceapi = await import('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js');
  const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/';
  await faceapi.tf.setBackend('webgl').catch(() => {});
  await faceapi.tf.ready();
  await Promise.all([faceapi.nets.ssdMobilenetv1.loadFromUri(M), faceapi.nets.faceLandmark68Net.loadFromUri(M), faceapi.nets.faceRecognitionNet.loadFromUri(M)]);
}
async function startCam() {
  const btn = $('#camBtn');
  btn.disabled = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
    const v = $('#cam'); v.srcObject = stream; await v.play(); $('#ovalPh').hidden = true;
    await Promise.all([loadModels(), loadFaces()]);
    status('Ready. Look straight at the camera.');
    btn.textContent = 'Take selfie'; btn.disabled = false; btn.onclick = snap;
  } catch (e) {
    console.error(e);
    status(e && e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in your browser settings and try again.'
      : (stream ? 'Could not load the face matcher. Check your connection and try again.' : 'Could not start the camera on this device.'), true);
    btn.disabled = false;
  }
}
function stopCam() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }
async function snap() {
  const btn = $('#camBtn'); btn.disabled = true; status('Matching…');
  try {
    const v = $('#cam');
    const det = await faceapi.detectSingleFace(v, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 })).withFaceLandmarks().withFaceDescriptor();
    if (!det) { status("Couldn't see your face clearly. Move closer, face the light, and try again.", true); btn.disabled = false; return; }
    const hits = match(det.descriptor);
    state.results = hits;
    stopCam();
    location.hash = '#/results';
  } catch (e) { status('Something went wrong. Please try again.', true); btn.disabled = false; }
}
function dist(D, a, q) { let s = 0; const o = a * 128; for (let k = 0; k < 128; k++) { const t = D[o + k] - q[k]; s += t * t; } return Math.sqrt(s); }
function match(q) {
  const { n, idx, d: D } = faces;
  const dq = new Float32Array(n);
  for (let a = 0; a < n; a++) dq[a] = dist(D, a, q);
  // seeds: faces clearly the same person as the selfie
  let seeds = [];
  for (let a = 0; a < n; a++) if (dq[a] < 0.4) seeds.push(a);
  if (!seeds.length) { const best = [...dq.keys()].sort((x, y) => dq[x] - dq[y])[0]; if (dq[best] < 0.46) seeds = [best]; }
  if (!seeds.length) return [];
  // centroid of selfie + seeds, then expand to faces close to it and to most seeds
  const c = new Float32Array(128);
  for (let k = 0; k < 128; k++) { let s = q[k]; for (const a of seeds) s += D[a * 128 + k]; c[k] = s / (seeds.length + 1); }
  const strong = new Set(seeds), out = new Map();
  for (const a of seeds) out.set(idx[a], Math.min(out.get(idx[a]) ?? 9, dq[a]));
  for (let a = 0; a < n; a++) {
    if (strong.has(a)) continue;
    const dc = dist(D, a, c);
    if (dc >= 0.42) continue;
    let sup = 0; for (const s of seeds) { if (dist(D, a, D.subarray(s * 128, s * 128 + 128)) < 0.45) sup++; }
    if (sup / seeds.length >= 0.5) { const p = idx[a]; if (!out.has(p) || out.get(p) > dc + 0.1) out.set(p, dc + 0.1); }
  }
  return [...out.entries()].sort((x, y) => x[1] - y[1]).map(([p, s]) => ({ ...album.photos[p], maybe: s >= 0.4 }));
}
function renderResults() {
  const r = state.results;
  $('#resTitle').innerHTML = r.length ? `You're in<br><em>${r.length} photo${r.length === 1 ? '' : 's'}.</em>` : `No matches<br><em>yet.</em>`;
  $('#resGrid').innerHTML = r.length
    ? r.map((p, k) => tile(p, 'results', k, `<span class="x" role="button" tabindex="0" data-i="${p.i}" aria-label="Not me">✕</span>${p.maybe ? '<span class="maybe">Maybe</span>' : ''}`)).join('')
    : '<p class="muted" style="padding:0 16px">Try again facing the light without a cap or sunglasses, or browse the album.</p>';
  $('#dlAll').hidden = !r.length;
}
function hideResult(i) { state.results = state.results.filter((p) => p.i !== i); renderResults(); }
$('#dlAll').onclick = async () => {
  const btn = $('#dlAll'); btn.disabled = true;
  try {
    const { zipSync } = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    const files = {}; let k = 0;
    for (const p of state.results) {
      btn.textContent = `Preparing ${++k}/${state.results.length}`;
      const b = await fetch(IMG('web', p.sha)).then((r) => { if (!r.ok) throw 0; return r.arrayBuffer(); });
      files[`MDP-photo-${p.i + 1}.jpg`] = [new Uint8Array(b), { level: 0 }];
    }
    await saveBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'MDP-my-photos.zip');
  } catch (_) { alert('Download all is not available right now. Open a photo and use Download instead.'); }
  btn.textContent = 'Download all'; btn.disabled = false;
};

/* ---------- forms ---------- */
function ajaxForm(form, thanks) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try {
      const r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(new FormData(form)).toString() });
      if (!r.ok) throw 0;
      form.hidden = true; thanks.hidden = false;
    } catch (_) { alert('Could not send. Please try again.'); b.disabled = false; }
  });
}
ajaxForm($('#clubForm'), $('#clubThanks'));
ajaxForm($('#removeForm'), $('#removeThanks'));
if (CFG.viberUrl) { const v = $('#viberLink'); v.href = CFG.viberUrl; v.textContent = 'Join on Viber'; document.querySelectorAll('[data-viber]').forEach((a) => { a.href = CFG.viberUrl; a.target = '_blank'; a.rel = 'noopener'; }); }

/* ---------- routing ---------- */
async function route() {
  const v = (location.hash.replace(/^#\/?/, '') || 'home').split('?')[0];
  document.querySelectorAll('.view').forEach((s) => { s.hidden = s.dataset.view !== v; });
  if (v !== 'find') stopCam();
  window.scrollTo(0, 0);
  if (!album) await loadAlbum();
  if (v === 'album' && !$('#grid').children.length) renderGrid();
  if (v === 'find') { const b = $('#camBtn'); b.textContent = 'Turn on camera'; b.disabled = false; b.onclick = startCam; status(''); $('#ovalPh').hidden = false; }
  if (v === 'results') { if (!faces) { location.hash = '#/find'; return; } renderResults(); }
  if (v === 'remove' && state.results.length) $('#removePhotos').value = state.results.map((p) => `#${p.i + 1}`).join(', ');
}
window.addEventListener('hashchange', route);
route();
