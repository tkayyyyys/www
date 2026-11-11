import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// ---------------------------------------------------------------
// 1. Source texture — render live DOM into a 2D canvas
// ---------------------------------------------------------------
const srcCanvas = document.getElementById('source-canvas');
const srcCtx = srcCanvas.getContext('2d');
const pageEl = document.getElementById('page-content');
let hasDrawElementImage = typeof srcCtx.drawElementImage === 'function';

// The text on the cloth lives in a public Google Doc so it can be edited
// without a deploy. The plain-text export is tiny, has no images, and answers
// with `access-control-allow-origin: *`, so a plain fetch works from any origin.
// One line per doc paragraph; the body starts with a BOM and uses CRLF.
const CLOTH_DOC_URL = 'https://docs.google.com/document/d/1YLRYtxePRIJzSMIwcWiJ2h0cZQN3C1Luc4a_5otdVV8/export?format=txt';

// Font sizes the cloth steps through as the doc grows, largest first. The
// first four are h3–h6 at the 40px base the cloth was designed with
// (1.17 / 1 / 0.83 / 0.67em); the rest keep the same ~17% ratio down to the
// 12px floor. With the 1.25 line height each step fits this many paragraphs
// on the 1024px paper: 17 / 20 / 24 / 30 / 36 / 43 / 52 / 63 / 68. Past 68
// the text stays at 12px and the remainder falls off the bottom.
const CLOTH_FONT_SIZES = [46.8, 40, 33.2, 26.8, 22.4, 18.7, 15.6, 13, 12];

// Computed line height in px, falling back to 1.25em when the browser
// reports 'normal'.
function lineHeightPx(s) {
  const lh = parseFloat(s.lineHeight);
  return Number.isFinite(lh) ? lh : parseFloat(s.fontSize) * 1.25;
}

// Choose the largest step at which `lineCount` paragraphs fit the paper and
// apply it inline. The line-height ratio comes from styles.css (unitless, so
// it scales with the size); both render paths then pick the size up through
// the <p>s' computed styles. Counts paragraphs, not wrapped lines: a long
// paragraph that wraps can still run off the bottom.
function fitClothFontSize(lineCount) {
  const s = getComputedStyle(pageEl);
  const ratio = lineHeightPx(s) / parseFloat(s.fontSize);
  const size = CLOTH_FONT_SIZES.find(px => lineCount * px * ratio <= srcCanvas.height)
    ?? CLOTH_FONT_SIZES[CLOTH_FONT_SIZES.length - 1];
  pageEl.style.fontSize = `${size}px`;
}

// Replace #page-content's children with one <p> per non-blank line of `text`.
// Blank doc paragraphs are dropped: they are neither drawn nor counted toward
// the font-size step. Built with textContent, never innerHTML — the text
// comes from a third party.
function renderClothText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  fitClothFontSize(lines.length);
  pageEl.replaceChildren(...lines.map(line => {
    const p = document.createElement('p');
    p.textContent = line;
    return p;
  }));
}

// Fetch the doc and paint it. Called once `texture` exists (section 2). The
// explicit repaint matters when the cloth was torn before the text arrived,
// because tick() stops repainting after the first tear.
async function loadClothText() {
  try {
    const res = await fetch(CLOTH_DOC_URL);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    renderClothText(await res.text());
    paintSource();
    texture.needsUpdate = true;
  } catch (err) {
    // Leave the paper blank; the site works without the text.
    console.error('cloth text failed to load', err);
  }
}

function paintSource() {
  if (hasDrawElementImage) {
    try {
      srcCtx.reset();
      srcCtx.drawElementImage(pageEl, 0, 0, 1024, 1024);
      return;
    } catch (err) {
      // The HTML-in-canvas API is still changing: current Chrome exposes
      // drawElementImage but throws unless the canvas carries an attribute
      // newer than `layoutsubtree`. A thrown first paint used to abort this
      // whole module (no cloth at all), so drop to the manual painter for good.
      console.warn('drawElementImage unusable, painting manually', err);
      hasDrawElementImage = false;
    }
  }
  // Fallback: #page-content sits inside <canvas> fallback content, so it is
  // never laid out (every rect is 0×0 at the origin). Reproduce a minimal
  // block flow by hand from the computed styles: top-left origin, each
  // block word-wrapped to the paper width, blocks stacked with their margins.
  // Then place the whole block: centred when styles.css asks for it via
  // justify-content / align-content (desktop), else top-left. Offsets clamp
  // at 0 so a block larger than the paper is clipped bottom/right, as before.
  const pageStyle = getComputedStyle(pageEl);
  srcCtx.fillStyle = pageStyle.backgroundColor || '#fafaf7';
  srcCtx.fillRect(0, 0, 1024, 1024);
  srcCtx.textBaseline = 'top';
  const maxWidth = srcCanvas.width;
  const lines = [];
  let blockWidth = 0;
  let y = 0;
  for (const el of pageEl.querySelectorAll('h1,h2,h3,h4,h5,h6,p')) {
    if (y > srcCanvas.height) break;
    const s = getComputedStyle(el);
    const font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    srcCtx.font = font;
    const lineHeight = lineHeightPx(s);
    y += parseFloat(s.marginTop) || 0;
    const push = text => {
      lines.push({ text, y, font, color: s.color });
      blockWidth = Math.max(blockWidth, Math.min(maxWidth, srcCtx.measureText(text).width));
      y += lineHeight;
    };
    // Greedy word wrap. A single word wider than the paper overflows rather
    // than being broken mid-word.
    let line = '';
    for (const word of el.textContent.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && srcCtx.measureText(candidate).width > maxWidth) {
        push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    push(line); // flush the last line
    y += parseFloat(s.marginBottom) || 0;
  }
  const x0 = pageStyle.justifyContent === 'center' ? Math.max(0, (srcCanvas.width - blockWidth) / 2) : 0;
  const y0 = pageStyle.alignContent === 'center' ? Math.max(0, (srcCanvas.height - y) / 2) : 0;
  for (const l of lines) {
    srcCtx.font = l.font;
    srcCtx.fillStyle = l.color;
    srcCtx.fillText(l.text, x0, y0 + l.y);
  }
}
paintSource();

// ---------------------------------------------------------------
// 2. Three.js scene
// ---------------------------------------------------------------
const threeCanvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 14);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(3, 4, 6);
scene.add(key);

const texture = new THREE.CanvasTexture(srcCanvas);
texture.colorSpace = THREE.SRGBColorSpace;
texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
loadClothText();

// ---------------------------------------------------------------
// 3. Cloth — particles + verlet integration + tearable constraints
// ---------------------------------------------------------------
// Cell size in world units (matches the original 11/60 feel). The grid
// resolution is derived per-build from the viewport so cells stay ~square.
const CELL_SIZE = 11 / 60;

let COLS, ROWS;
let particles, cMap, constraints;
let geometry, posAttr, mesh;

function computeClothSize() {
  const vh = 2 * camera.position.z * Math.tan((camera.fov * Math.PI / 180) / 2);
  const vw = vh * camera.aspect;
  return { W: vw, H: vh };
}

const GRAVITY_TARGET = -0.003;
const GRAVITY_RAMP_FRAMES = 90;
const DAMPING = 0.985;
const TEAR_RATIO = 4.0;
const ITERATIONS = 18;
const SETTLE_FRAMES = 120;
let frameCount = 0;
let firstTearShown = false;
let clothRevealed = false;
const tmp = new THREE.Vector3();

function stepPhysics() {
  // Ease gravity in so vertical springs don't all get yanked at once on frame 1.
  const gy = GRAVITY_TARGET * Math.min(1, frameCount / GRAVITY_RAMP_FRAMES);
  // Verlet integration
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const p = particles[j][i];
      if (p.pinned) continue;
      const vx = (p.pos.x - p.prev.x) * DAMPING;
      const vy = (p.pos.y - p.prev.y) * DAMPING;
      const vz = (p.pos.z - p.prev.z) * DAMPING;
      p.prev.copy(p.pos);
      p.pos.x += vx;
      p.pos.y += vy + gy;
      p.pos.z += vz;
    }
  }
  // Constraint relaxation with tearing (disabled while the cloth settles)
  const tearingArmed = frameCount >= SETTLE_FRAMES;
  let torn = false;
  for (let k = 0; k < ITERATIONS; k++) {
    for (let n = 0; n < constraints.length; n++) {
      const c = constraints[n];
      if (!c.alive) continue;
      tmp.subVectors(c.b.pos, c.a.pos);
      const len = tmp.length();
      if (len === 0) continue;
      if (tearingArmed) {
        const t = (c.weakenedAt === frameCount ? TEAR_RATIO * 0.55 : TEAR_RATIO);
        if (len > c.rest * t) {
          c.alive = false;
          torn = true;
          for (const nb of c.neighbors) nb.weakenedAt = frameCount;
          continue;
        }
      }
      const diff = (len - c.rest) / len * 0.5;
      tmp.multiplyScalar(diff);
      if (!c.a.pinned) c.a.pos.add(tmp);
      if (!c.b.pinned) c.b.pos.sub(tmp);
    }
  }
  return torn;
}

// ---------------------------------------------------------------
// 4. Geometry — non-indexed-style triangle removal via index rebuild
// ---------------------------------------------------------------
function rebuildIndices() {
  const idx = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const tl = j * (COLS + 1) + i;
      const tr = tl + 1;
      const bl = tl + (COLS + 1);
      const br = bl + 1;
      const top  = cMap[`h_${i}_${j}`].alive;
      const bot  = cMap[`h_${i}_${j+1}`].alive;
      const left = cMap[`v_${i}_${j}`].alive;
      const right= cMap[`v_${i+1}_${j}`].alive;
      const diag = cMap[`d_${i}_${j}`].alive;
      // PlaneGeometry-style split with diagonal tr–bl
      if (top && left && diag)   idx.push(tl, bl, tr);
      if (right && bot && diag)  idx.push(tr, bl, br);
    }
  }
  geometry.setIndex(idx);
}

function writePositions() {
  const arr = posAttr.array;
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const p = particles[j][i].pos;
      const k = (j * (COLS + 1) + i) * 3;
      arr[k]   = p.x;
      arr[k+1] = p.y;
      arr[k+2] = p.z;
    }
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function buildCloth() {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  const { W, H } = computeClothSize();
  COLS = Math.max(8, Math.round(W / CELL_SIZE));
  ROWS = Math.max(8, Math.round(H / CELL_SIZE));

  particles = [];
  for (let j = 0; j <= ROWS; j++) {
    const row = [];
    for (let i = 0; i <= COLS; i++) {
      const x = (i / COLS - 0.5) * W;
      const y = (0.5 - j / ROWS) * H;
      row.push({
        pos: new THREE.Vector3(x, y, 0),
        prev: new THREE.Vector3(x, y, 0),
        pinned: j === 0,
      });
    }
    particles.push(row);
  }

  cMap = {};
  const makeC = (key, a, b) => {
    cMap[key] = { a, b, rest: a.pos.distanceTo(b.pos), alive: true };
  };
  for (let j = 0; j <= ROWS; j++)
    for (let i = 0; i < COLS; i++)
      makeC(`h_${i}_${j}`, particles[j][i], particles[j][i+1]);
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i <= COLS; i++)
      makeC(`v_${i}_${j}`, particles[j][i], particles[j+1][i]);
  for (let j = 0; j < ROWS; j++)
    for (let i = 0; i < COLS; i++)
      makeC(`d_${i}_${j}`, particles[j][i+1], particles[j+1][i]);
  constraints = Object.values(cMap);

  // Per-constraint neighbor list (any other constraint sharing an endpoint).
  // Used to cascade tears: when one snaps, its neighbors weaken for the frame.
  const byParticle = new Map();
  for (const c of constraints) {
    for (const p of [c.a, c.b]) {
      let list = byParticle.get(p);
      if (!list) { list = []; byParticle.set(p, list); }
      list.push(c);
    }
  }
  for (const c of constraints) {
    const set = new Set();
    for (const n of byParticle.get(c.a)) if (n !== c) set.add(n);
    for (const n of byParticle.get(c.b)) if (n !== c) set.add(n);
    c.neighbors = [...set];
    c.weakenedAt = -1;
  }

  const vCount = (ROWS + 1) * (COLS + 1);
  const positions = new Float32Array(vCount * 3);
  const uvs = new Float32Array(vCount * 2);
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const k = j * (COLS + 1) + i;
      uvs[k*2]   = i / COLS;
      uvs[k*2+1] = 1 - j / ROWS;
    }
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  posAttr = geometry.attributes.position;
  rebuildIndices();
  writePositions();

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
  });
  mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  frameCount = 0;
  firstTearShown = false;
}
buildCloth();

// ---------------------------------------------------------------
// 5. Pointer — raycast, then claw nearby particles to stretch & tear
// ---------------------------------------------------------------
// #three-canvas is pointer-events:none; the transparent #cloth-hit layer on
// top of it owns all input (see the porthole below for why).
const hitEl = document.getElementById('cloth-hit');
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(-10, -10);
let mouseActive = false;
let isTouch = false;
let prevHit = null;

function trackPointer(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseActive = true;
  isTouch = e.pointerType === 'touch';
  updatePorthole(e);
}
hitEl.addEventListener('pointermove', trackPointer);
// A tap has no hover before it: test on pointerdown too, so a tap on a hole
// opens the porthole and the next tap there reaches what is behind.
hitEl.addEventListener('pointerdown', trackPointer);
hitEl.addEventListener('pointerleave', () => {
  mouseActive = false;
  prevHit = null;
});

// Porthole — how input reaches a cross-origin <iframe> (the message doc)
// behind the cloth. Events can't be forwarded into one, so when the pointer
// is over a hole in the cloth, clip a disc around it out of the hit layer:
// inside the disc the browser hit-tests straight through to #background, so
// clicks, wheel and keyboard focus land on the real element. Leaving the disc
// lands back on this layer, whose pointermove moves or closes it.
// Never close it from pointerleave: entering the disc fires pointerleave, and
// closing there would put the layer back under the pointer (flicker loop).
const PORTHOLE_PX = 40;
let portholeOpen = false;
function updatePorthole(e) {
  if (!mesh) return;
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(mesh, false).length) { closePorthole(); return; }
  const w = window.innerWidth, h = window.innerHeight, r = PORTHOLE_PX;
  const x = e.clientX, y = e.clientY;
  // Outer rect clockwise, disc anticlockwise: a hole under the default
  // nonzero rule, without relying on path(evenodd, …) support.
  hitEl.style.clipPath =
    `path("M0 0H${w}V${h}H0Z M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z")`;
  portholeOpen = true;
  // The pointer is through the cloth: nothing to claw, next event goes behind.
  mouseActive = false;
  prevHit = null;
}
function closePorthole() {
  if (!portholeOpen) return;
  hitEl.style.clipPath = '';
  portholeOpen = false;
}

// Background pages — fetch any data-page link, swap #background contents,
// and reflect the page in the URL hash so browser back/forward work.
const backgroundEl = document.getElementById('background');
const homeMarkup = backgroundEl.innerHTML;

// Pages whose content lives off-site. The key is what appears in the URL hash
// (e.g. #work); the value is a CORS-fetchable URL. Google Docs' HTML export
// endpoint reflects the request origin, so we can fetch it client-side and
// inject the document just like a local page — no iframe required.
// Use the doc's "mobilebasic" view rather than export?format=html: the export
// inlines every image as base64 (~43 MB here, ~25 s to parse), whereas
// mobilebasic is ~200 KB and references images as external URLs the browser
// streams in afterward.
const EXTERNAL_PAGES = {
  work: 'https://docs.google.com/document/d/1wu9j_QpDToOM9GHXm3jwnNJwHPP1zcZkWPFXclOUn4Q/mobilebasic',
  cv: 'https://docs.google.com/document/d/1vCS0z7NnixBY60FmcRMhGYpvost8DRUgQquHwmfzPR8/mobilebasic',
};

// Pages shown live in an <iframe> rather than fetched and injected. #message
// is the Google Docs *editor* for the doc the cloth's text comes from, so a
// visitor's message becomes the cloth on the next load. The editor only runs
// as a frame; docs.google.com sends no X-Frame-Options / frame-ancestors, so
// a cross-origin frame is allowed. Reached through the porthole (section 5).
const FRAME_PAGES = {
  message: 'https://docs.google.com/document/d/1YLRYtxePRIJzSMIwcWiJ2h0cZQN3C1Luc4a_5otdVV8/edit?tab=t.0',
};

// Bumped on every loadPage call. A fetch that resolves after a newer
// navigation has started carries a stale token, so it bails instead of
// clobbering the current page or firing a mismatched 'page loaded'.
let loadToken = 0;

async function loadPage(page) {
  const token = ++loadToken;
  // External docs render as black text on a white paper surface, so flip the
  // whole #background to white to match the Google Doc instead of letting the
  // dark theme show through the doc's margins.
  backgroundEl.classList.toggle('doc-mode', !!(EXTERNAL_PAGES[page] || FRAME_PAGES[page]));
  if (!page) { backgroundEl.innerHTML = homeMarkup; return; }
  if (FRAME_PAGES[page]) {
    const frame = document.createElement('iframe');
    frame.className = 'frame-page';
    frame.src = FRAME_PAGES[page];
    frame.title = page;
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    backgroundEl.replaceChildren(frame);
    window.posthog?.capture?.('page loaded', { page });
    return;
  }
  try {
    const url = EXTERNAL_PAGES[page] || page;
    if (EXTERNAL_PAGES[page]) {
      backgroundEl.innerHTML = '<article class="doc-page"><p>Loading…</p></article>';
    }
    const res = await fetch(url);
    if (token !== loadToken) return; // a newer navigation superseded this one
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const html = await res.text();
    if (token !== loadToken) return;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc.body) throw new Error('parsed document has no <body>');
    if (EXTERNAL_PAGES[page]) {
      // The doc's images are served with `cross-origin-resource-policy:
      // same-site`, which blocks a plain cross-origin <img>. They also send
      // `access-control-allow-origin: *`, so requesting them in CORS mode
      // (crossorigin="anonymous") satisfies CORP. The endpoint additionally
      // rejects the load unless the referrer is suppressed, so set both.
      for (const img of doc.querySelectorAll('img')) {
        img.setAttribute('crossorigin', 'anonymous');
        img.setAttribute('referrerpolicy', 'no-referrer');
      }
      // Preserve the doc's own inline <style> and wrap its body in a light
      // "paper" surface so black-on-transparent text stays readable over the
      // dark background. Scrolling comes free from #background's overflow-y.
      const styles = [...doc.querySelectorAll('style')].map(s => s.outerHTML).join('');
      backgroundEl.innerHTML = `${styles}<article class="doc-page">${doc.body.innerHTML}</article>`;
    } else {
      backgroundEl.innerHTML = doc.body.innerHTML;
    }
    window.posthog?.capture?.('page loaded', { page });
  } catch (err) {
    if (token !== loadToken) return; // superseded — leave the current page alone
    console.error('loadPage failed for', page, err);
    backgroundEl.innerHTML = `<div class="page"><p>Could not load ${page}: ${err.message || err}</p></div>`;
  }
}

const pageFromHash = () => location.hash.slice(1);

// popstate fires for both the back and forward buttons without saying which.
// Stamp each history entry with a monotonic index so a popstate can compare the
// entry it lands on against where we were and report the direction to PostHog.
let historyIndex = 0;
history.replaceState({ page: pageFromHash(), index: historyIndex }, '');

backgroundEl.addEventListener('click', (e) => {
  const link = e.target.closest && e.target.closest('a[data-page]');
  if (!link || !backgroundEl.contains(link)) return;
  e.preventDefault();
  const page = link.dataset.page;
  historyIndex++;
  history.pushState({ page, index: historyIndex }, '', page ? '#' + page : '#');
  window.posthog?.capture?.('page navigated', { page: page || 'home' });
  loadPage(page);
});

window.addEventListener('popstate', (e) => {
  const page = pageFromHash();
  const toIndex = e.state?.index ?? 0;
  const direction = toIndex < historyIndex ? 'back' : 'forward';
  historyIndex = toIndex;
  window.posthog?.capture?.('history navigated', { page: page || 'home', direction });
  loadPage(page);
});

if (pageFromHash()) loadPage(pageFromHash());

// Forward clicks through torn regions to whatever's behind. Still needed for
// touch and for a click with no preceding move; with the porthole open the
// click never reaches this layer. (A synthetic click can't drive a
// cross-origin iframe — that is what the porthole is for.)
hitEl.addEventListener('click', (e) => {
  const cx = (e.clientX / window.innerWidth) * 2 - 1;
  const cy = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera({ x: cx, y: cy }, camera);
  if (raycaster.intersectObject(mesh, false).length) return; // cloth blocks it
  hitEl.style.pointerEvents = 'none';
  const below = document.elementFromPoint(e.clientX, e.clientY);
  hitEl.style.pointerEvents = '';
  if (below && below !== hitEl) below.click();
});

// Scroll forwarding — the hit layer sits on top of #background (z-index 1) and
// captures wheel/touch input, so the scrollable page behind it never receives
// it; forward that delta to #background directly. Through an open porthole the
// event targets the real element instead and scrolls natively, so only events
// that hit the layer are forwarded. Listening on window catches both cases,
// which the home-view flip below needs (on desktop the pointer is usually over
// a hole). Touch drags still tear the cloth (the layers are independent); they
// now also scroll the document revealed behind it.
const HOME_FLIP_THRESHOLD = 40;
const HOME_FLIP_COOLDOWN  = 700;
let homeFlipAccum = 0;
let homeFlipUntil = 0;

function homeScroll(delta) {
  if (!backgroundEl.querySelector('#home')) return false;
  const now = performance.now();
  if (now < homeFlipUntil || !delta) return true;
  if (Math.sign(delta) !== Math.sign(homeFlipAccum)) homeFlipAccum = 0;
  homeFlipAccum += delta;
  if (Math.abs(homeFlipAccum) < HOME_FLIP_THRESHOLD) return true;
  const toNav = homeFlipAccum > 0;
  homeFlipAccum = 0;
  if (toNav !== backgroundEl.classList.contains('nav-view')) {
    backgroundEl.classList.toggle('nav-view', toNav);
    homeFlipUntil = now + HOME_FLIP_COOLDOWN;
  }
  return true;
}

window.addEventListener('wheel', (e) => {
  const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  if (homeScroll(dy)) return;
  if (e.target === hitEl) backgroundEl.scrollTop += dy;
}, { passive: true });

let lastTouchY = null;
window.addEventListener('touchstart', (e) => {
  lastTouchY = e.touches[0] ? e.touches[0].clientY : null;
  homeFlipAccum = 0;
}, { passive: true });
window.addEventListener('touchmove', (e) => {
  if (lastTouchY === null || !e.touches[0]) return;
  const y = e.touches[0].clientY;
  const dy = lastTouchY - y;
  lastTouchY = y;
  if (homeScroll(dy)) return;
  if (e.target === hitEl) backgroundEl.scrollTop += dy;
}, { passive: true });
window.addEventListener('touchend', () => { lastTouchY = null; }, { passive: true });

const CLAW_RADIUS = 0.7;
const CLAW_STRENGTH = 0.55;

function applyMouse() {
  if (!mouseActive) return;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(mesh, false);
  if (!hits.length) { prevHit = null; return; }
  const hit = hits[0].point;
  // Touch contact moves slowly; mouse moves fast. Tune so a stationary
  // finger still tears the cloth via the baseline forward push.
  const baseZ = isTouch ? -1.2 : -0.7;
  const motionGain = isTouch ? 5.0 : 4.0;
  const radius = isTouch ? CLAW_RADIUS * 1.6 : CLAW_RADIUS;
  const drag = tmp.set(0, 0, baseZ);
  if (prevHit) drag.add(hit.clone().sub(prevHit).multiplyScalar(motionGain));
  const r2 = radius * radius;
  for (let j = 0; j <= ROWS; j++) {
    for (let i = 0; i <= COLS; i++) {
      const p = particles[j][i];
      if (p.pinned) continue;
      const dx = p.pos.x - hit.x;
      const dy = p.pos.y - hit.y;
      const dz = p.pos.z - hit.z;
      const d2 = dx*dx + dy*dy + dz*dz;
      if (d2 > r2) continue;
      const falloff = 1 - Math.sqrt(d2) / radius;
      p.pos.x += drag.x * CLAW_STRENGTH * falloff;
      p.pos.y += drag.y * CLAW_STRENGTH * falloff;
      p.pos.z += drag.z * CLAW_STRENGTH * falloff;
    }
  }
  prevHit = hit.clone();
}

// ---------------------------------------------------------------
// 6. Loop
// ---------------------------------------------------------------
function tick() {
  frameCount++;
  applyMouse();
  const torn = stepPhysics();
  if (torn) rebuildIndices();
  writePositions();
  // Keep the DOM->texture loop live until the page starts tearing — then freeze it.
  if (!firstTearShown) {
    paintSource();
    texture.needsUpdate = true;
    if (torn) {
      firstTearShown = true;
      window.posthog?.capture?.('cloth torn', { input_type: isTouch ? 'touch' : 'mouse' });
    }
  }
  renderer.render(scene, camera);
  // First frame is on screen — bring in the deferred background photo behind the
  // cloth and fade out the loading placeholder. The canvas now has paper drawn
  // on it, so the swap from placeholder to live cloth is seamless.
  if (!clothRevealed) {
    clothRevealed = true;
    window.__clothReady?.();
  }
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  closePorthole();
  buildCloth();
});
