// noprotect
// Ritualized Viewing v43.1 — 03_draw.js
// Design grid, setup(), draw(), drawFrame(), screens, THE DOORWAY (screenFill → sheetRect → batchPath → batchFlush), Radiate ✕ / ✚ cutting.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- v39.3: FIXED DESIGN GRID ----------------------
// The sketch always draws on DESIGN_W × designHeight() — the same numbers
// on every computer — and the canvas element is merely DISPLAYED scaled to
// fit the window. Its backing pixel density follows the displayed size
// (× the screen's own devicePixelRatio), so it's as sharp as the screen
// allows without drawing more pixels than are actually shown.
const DESIGN_W = 1920;
const DESIGN_FORMATS = { '16:9': 1080, '16:10': 1200 }; // height for each frame shape
const DESIGN_MAX_DENSITY = 3;
let designAspect = '16:9'; // saved with the show
let previewSharpness = 'auto'; // v39.4: 'full' | 'half' — preview only, never saved; v41.7: + 'auto' (default)
let lastDensity = null;

function designHeight() {
  return DESIGN_FORMATS[designAspect] || DESIGN_FORMATS['16:9'];
}

function fitCanvasToWindow() {
  let cnv = drawingContext.canvas;
  let ww = window.innerWidth, wh = window.innerHeight;
  let s = Math.min(ww / width, wh / height);
  let density = s * (window.devicePixelRatio || 1) * sharpnessFactor(); // v39.4; v41.7: Auto steps 1 / ¾ / ½
  density = Math.min(Math.max(density, 0.25), DESIGN_MAX_DENSITY);
  density = Math.round(density * 100) / 100;
  if (exportState.on) density = exportState.density; // v43.1: the export's size, whatever the window
  if (lastDensity === null || Math.abs(density - lastDensity) / lastDensity > 0.04) {
    lastDensity = density;
    pixelDensity(density); // re-creates the backing store; p5 resets the element's CSS size
  }
  document.body.style.background = '#000';
  Object.assign(cnv.style, {
    position: 'fixed',
    width: (width * s) + 'px', height: (height * s) + 'px',
    left: ((ww - width * s) / 2) + 'px', top: ((wh - height * s) / 2) + 'px',
  });
}

// v39.4: preview sharpness (see the v39.4 notes).
// v41.7: + Auto (the default): AUTO_SHARP_LEVELS of full, see updateAutoSharpness().
function setPreviewSharpness(v) {
  previewSharpness = (v === 'half' || v === 'full') ? v : 'auto';
  autoSharp.level = 0; // v41.7: Auto always starts again from full
  autoSharpReset(performance.now());
  autoSharp.blockMs = 0; autoSharp.backoffMs = AUTO_SHARP_BACKOFF_MIN_MS; autoSharp.lastUpMs = -1e9;
  lastDensity = null;
  fitCanvasToWindow();
  if (displayMenu) displayMenu.refresh(); // v40.4
  if (typeof markTimingChanged === 'function') markTimingChanged(); // refresh the readout now
}

// ---------------------- v41.7: AUTO SHARPNESS ----------------------
// Auto lowers the canvas density when frames are being dropped and raises
// it again when there's room, in steps of full → ¾ → ½ (never below ½).
// Judged over seconds, not single frames:
//  - DOWN after ~2 s in which ≥ 10% of the expected frames were missed;
//  - UP after ~10 s with ≤ 1% missed;
//  - after each change it waits ~1.5 s (the resize itself costs a frame);
//  - if a step UP runs into trouble again within ~15 s, that level is
//    blocked for 1 min, then 2, 4… (max 10) — so it never flips back and
//    forth on a computer that sits right at the edge.
// Frames are counted against the screen rate, capped at 60 fps, so a
// 120 Hz screen drawing a steady 60 isn't mistaken for trouble (and a
// reading under 48 Hz is treated as 60: see below). A frame
// counts at most 2 missed (one long hitch is not "trouble"); gaps over
// 250 ms (hidden tab, a menu rebuild, the resize) are skipped.
const AUTO_SHARP_LEVELS = [1, 0.75, 0.5];
const AUTO_SHARP_LABELS = ['1', '¾', '½'];
const AUTO_SHARP_DOWN_MS = 2000, AUTO_SHARP_DOWN_SHARE = 0.10;
const AUTO_SHARP_UP_MS = 10000, AUTO_SHARP_UP_SHARE = 0.01;
const AUTO_SHARP_SETTLE_MS = 1500, AUTO_SHARP_FAIL_WINDOW_MS = 15000;
const AUTO_SHARP_BACKOFF_MIN_MS = 60000, AUTO_SHARP_BACKOFF_MAX_MS = 600000;
let autoSharp = {
  level: 0,           // index into AUTO_SHARP_LEVELS
  gaps: [],           // { t, expect, missed } for the last AUTO_SHARP_UP_MS
  sinceMs: 0,         // judge only frames after this (start / last change)
  lastUpMs: -1e9,     // when it last stepped up
  blockMs: 0,         // no step up before this time
  backoffMs: AUTO_SHARP_BACKOFF_MIN_MS,
  pending: false,     // a change waiting to be applied between frames
};

function sharpnessFactor() {
  if (previewSharpness === 'half') return 0.5;
  if (previewSharpness === 'auto') return AUTO_SHARP_LEVELS[autoSharp.level];
  return 1;
}
// The short text for the readout / diagnostics: 'full', 'half', 'auto 1', 'auto ¾'…
function sharpnessText() {
  return previewSharpness === 'auto' ? 'auto ' + AUTO_SHARP_LABELS[autoSharp.level] : previewSharpness;
}
function autoSharpReset(now) {
  autoSharp.gaps = [];
  autoSharp.sinceMs = now;
}
// Share of expected frames missed in the last `spanMs`; null if fewer
// than `spanMs` of judged frames exist yet.
function autoSharpMissedShare(now, spanMs) {
  if (now - autoSharp.sinceMs < spanMs) return null;
  let expect = 0, missed = 0;
  for (const g of autoSharp.gaps) {
    if (now - g.t <= spanMs) { expect += g.expect; missed += g.missed; }
  }
  return expect > 0 ? missed / expect : null;
}
function updateAutoSharpness(dt, now) {
  if (exportState.on) return; // v43.1: an export draws at its own fixed size
  if (previewSharpness !== 'auto' || autoSharp.pending || !displayInfo.ready) return;
  if (!Number.isFinite(dt) || dt <= 0) return;
  if (dt > 250 || (typeof document !== 'undefined' && document.hidden)) { autoSharpReset(now); return; }
  if (now - autoSharp.sinceMs < AUTO_SHARP_SETTLE_MS) return; // let a change settle first
  // A screen reading below 48 Hz is most likely a struggling 60 Hz one
  // (all frames late look like a slow screen), so judge against 60 then.
  let hz = displayInfo.nominalHz >= 48 ? Math.min(displayInfo.nominalHz, 60) : 60;
  let period = 1000 / hz;
  let steps = Math.max(1, Math.round(dt / period));
  autoSharp.gaps.push({ t: now, expect: steps, missed: Math.min(steps - 1, 2) });
  while (autoSharp.gaps.length && now - autoSharp.gaps[0].t > AUTO_SHARP_UP_MS) autoSharp.gaps.shift();

  let judgedFrom = autoSharp.sinceMs + AUTO_SHARP_SETTLE_MS;
  let lvl = autoSharp.level;
  if (lvl < AUTO_SHARP_LEVELS.length - 1 && now - judgedFrom >= AUTO_SHARP_DOWN_MS) {
    let share = autoSharpMissedShare(now, AUTO_SHARP_DOWN_MS);
    if (share !== null && share >= AUTO_SHARP_DOWN_SHARE) {
      // A step up that didn't hold: block it for a while, longer each time.
      if (now - autoSharp.lastUpMs < AUTO_SHARP_FAIL_WINDOW_MS) {
        autoSharp.blockMs = now + autoSharp.backoffMs;
        autoSharp.backoffMs = Math.min(autoSharp.backoffMs * 2, AUTO_SHARP_BACKOFF_MAX_MS);
        autoSharp.lastUpMs = -1e9;
      }
      autoSharpChange(lvl + 1, now, Math.round(share * 100) + '% of frames missed');
      return;
    }
  }
  if (lvl > 0 && now >= autoSharp.blockMs && now - judgedFrom >= AUTO_SHARP_UP_MS) {
    let share = autoSharpMissedShare(now, AUTO_SHARP_UP_MS);
    if (share !== null && share <= AUTO_SHARP_UP_SHARE) {
      autoSharp.lastUpMs = now;
      autoSharpChange(lvl - 1, now, 'room to spare');
    }
  }
}
// The density change re-creates the canvas, so it's done between frames
// (like a window resize), never in the middle of drawing one.
function autoSharpChange(newLevel, now, why) {
  let from = AUTO_SHARP_LABELS[autoSharp.level], to = AUTO_SHARP_LABELS[newLevel];
  autoSharp.level = newLevel;
  autoSharp.pending = true;
  autoSharpReset(now);
  if (typeof diagEvent === 'function') diagEvent('sharpness auto ' + from + ' → ' + to + ' (' + why + ')');
  setTimeout(() => {
    autoSharp.pending = false;
    autoSharpReset(performance.now());
    if (previewSharpness !== 'auto') return;
    fitCanvasToWindow();
    if (displayMenu) displayMenu.refresh();
    if (typeof markTimingChanged === 'function') markTimingChanged();
  }, 0);
}

function setDesignAspect(aspect) {
  if (!DESIGN_FORMATS[aspect]) aspect = '16:9';
  if (aspect === designAspect && height === designHeight()) return;
  designAspect = aspect;
  resizeCanvas(DESIGN_W, designHeight());
  lastDensity = null;
  fitCanvasToWindow();
  roomGeomSig = null;
  if (roomMenu) roomMenu.refresh();
  if (displayMenu) displayMenu.refresh(); // v40.4
}

function setup() {
  console.log('Endless Architecture ' + SKETCH_VERSION + ' on p5.js ' + (typeof p5 !== 'undefined' && p5.VERSION ? p5.VERSION : '?')); // v40.13
  createCanvas(DESIGN_W, designHeight()); // v39.3: fixed design grid (was the window size)
  fitCanvasToWindow();
  rectMode(CORNER);
  noStroke();
  noSmooth(); // hard pixel edges, no anti-aliasing seams between rects

  // v28: after createCanvas() (so `width` is real), before setupUI()
  // (so the very first Layout menu is built with the right ceiling
  // already, not the 800px fallback).
  updateMaxScaleForWindowSize();

  recomputeDerivedValues();
  setupUI();

  // v35: p5 normally caps drawing at 60 fps, which would halve the
  // frames on a 120 Hz screen. A target far above any real screen means
  // draw() runs on every refresh, whatever the screen's rate.
  frameRate(UNCAPPED_FRAME_RATE);
  rhythmDock = createRhythmDock(); // v35.1
  safetyControl = createSafetyControl(); // v37.1
  displayMenu = createDisplayMenu(); // v40.4: bottom-left, next to Safety (needs it first)
  showStartupWarning(); // v37.1
}

function windowResized() {
  fitCanvasToWindow(); // v39.3: only the DISPLAYED size changes; the design grid stays fixed
  // v28: keep Scale's ceiling in sync with the window/screen's actual
  // current size — see updateMaxScaleForWindowSize()'s own comment.
  updateMaxScaleForWindowSize();
}

function recomputeDerivedValues() {
  screenHeight = screenWidth * aspectRatio;
  unitHeight   = screenHeight + vSpacing;
  columnWidth  = screenWidth + hSpacing;
  gapHeight    = screenHeight * gapHeightRatio;
}

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// ---------------------- v40.7: RADIATE ----------------------
// The picture flows OUT from the middle of the centre surface. The centre
// is split into 4 regions — ✕: by its diagonals, each triangle flowing to
// its own edge; ✚: into quarters, each flowing diagonally to its corner.
// Each region draws the whole design grid ROTATED to point its way
// (about the centre's middle), cut to that region. The region continues
// across the edges onto the next surfaces (they're cut along the same
// lines in 3D), so each flow carries straight on. In Flat the window is
// split the same way.
// A region is a pair of half-planes in the centre's own coordinates:
// a = across (−1 left edge … +1 right edge), b = down (−1 top … +1 bottom);
// inside when ca·a + cb·b ≥ 0 for both. rot = clockwise degrees that turn
// the grid's "up" into the region's direction; [da, db] = that direction.
const RADIATE_REGIONS = {
  x: [
    { rot: 0,   da: 0,  db: -1, hp: [[-1, -1], [1, -1]] }, // top: up
    { rot: 90,  da: 1,  db: 0,  hp: [[1, -1], [1, 1]] },   // right
    { rot: 180, da: 0,  db: 1,  hp: [[-1, 1], [1, 1]] },   // bottom: down
    { rot: 270, da: -1, db: 0,  hp: [[-1, -1], [-1, 1]] }, // left
  ],
  plus: [ // the far surface continues from the top/bottom neighbour (db)
    { rot: 45,  da: 0, db: -1, hp: [[1, 0], [0, -1]] },  // top right
    { rot: 135, da: 0, db: 1,  hp: [[1, 0], [0, 1]] },   // bottom right
    { rot: 225, da: 0, db: 1,  hp: [[-1, 0], [0, 1]] },  // bottom left
    { rot: 315, da: 0, db: -1, hp: [[-1, 0], [0, -1]] }, // top left
  ],
};
let radiatePass = null;           // the region being drawn (null = normal)
let radiateCache = new Map();

// Cuts a polygon to the half-plane α + βx + γy ≥ 0.
// v40.22: for…of (with its own counter) instead of for (let i…): the p5
// editor's loop guard adds a clock check to every pass of a for / while
// loop, and per-screen code paid for it thousands of times a frame. See
// LOOP GUARD COST in the v40.22 notes.
function clipHalfPlane(poly, h) {
  let out = [], n = poly.length, i = 0;
  for (const P of poly) {
    let Q = poly[i + 1 < n ? i + 1 : 0];
    i++;
    let dp = h[0] + h[1] * P[0] + h[2] * P[1], dq = h[0] + h[1] * Q[0] + h[2] * Q[1];
    if (dp >= 0) out.push(P);
    if ((dp >= 0) !== (dq >= 0)) {
      let t = dp / (dp - dq);
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
    }
  }
  return out;
}
function polyBBox(poly) {
  let b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  poly.forEach(([x, y]) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); });
  return b;
}
// One piece of a region: where to cut (half-planes, in sheet coords) and
// how to draw (proj: sheet -> canvas).
// v40.11: each region is DRAWN reaching RADIATE_OVERLAP sheet-pixels past
// its ✕ / ✚ lines, so neighbouring regions overlap a hair instead of
// meeting edge to edge (where the smoothed edges let a thin line of the
// background show through).
// v40.12: each region is first drawn COMPLETE (background + screens) on a
// hidden layer, reaching RADIATE_DRAW_REACH past its cut lines, then laid
// onto the picture through ONE smoothed edge RADIATE_OVERLAP past the cut.
// One edge = nothing can leak through (v40.10: a thin background line)
// and nothing sticks out over a neighbour's gaps (v40.11 overlapped only
// the screens, which poked over the gap lines). See drawRadiateRegion().
const RADIATE_OVERLAP = 1;
const RADIATE_DRAW_REACH = 3;
function makeRadiateClip(x0, y0, x1, y1, regionHp, proj) {
  let exact = [[-x0, 1, 0], [x1, -1, 0], [-y0, 0, 1], [y1, 0, -1]].concat(regionHp);
  let rect4 = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  let cut = (hps) => { let q = rect4; hps.forEach((h) => { if (q.length) q = clipHalfPlane(q, h); }); return q; };
  let grow = (d) => exact.slice(0, 4).concat(regionHp.map(([a, b, c]) => [a + d * Math.hypot(b, c), b, c]));
  let poly = cut(exact);
  let hp = grow(RADIATE_DRAW_REACH);       // screens are cut to this (on the hidden layer)
  let drawPoly = cut(hp);                  // background of the hidden layer
  let pastePoly = cut(grow(RADIATE_OVERLAP)); // what's laid onto the picture
  if (poly.length < 3) return null;
  let area = 0;
  for (let i = 0; i < poly.length; i++) { let P = poly[i], Q = poly[(i + 1) % poly.length]; area += P[0] * Q[1] - Q[0] * P[1]; }
  if (Math.abs(area) < 2) return null;
  return { hp, proj, poly, drawPoly, pastePoly, bbox: polyBBox(poly) };
}

// The 4 regions of a mapping (or null when it doesn't radiate), cached.
function radiateRegionsFor(mp) {
  if (!mp || !mp.radiate || mp.radiate === 'off') return null;
  let key = (roomView ? 'R' : 'F') + JSON.stringify({ ...room, figure: 0 }) + JSON.stringify(mp) + width + 'x' + height;
  if (radiateCache.has(key)) return radiateCache.get(key);
  let out = RADIATE_REGIONS[mp.radiate].map((def) => {
    let th = def.rot * Math.PI / 180;
    let reg = { cos: Math.cos(th), sin: Math.sin(th), clips: [], def };
    // turns the region's (a, b) half-planes into sheet half-planes for an
    // affine a(x, y) = aa + ab·x + ac·y and b(x, y) likewise
    let toSheet = (A, B) => def.hp.map(([ca, cb]) => [ca * A[0] + cb * B[0], ca * A[1] + cb * B[1], ca * A[2] + cb * B[2]]);
    if (!roomView) {
      let hw = width / 2, hh = height / 2;
      reg.px = hw; reg.py = hh;
      let c = makeRadiateClip(0, 0, width, height, toSheet([-1, 1 / hw, 0], [-1, 0, 1 / hh]), (x, y) => [x, y]);
      if (c) reg.clips.push(c);
    } else {
      let [right, down] = ROOM_HUB_FRAMES[mp.hub];
      let g = roomBuildGeometry(mp, { radiateDir: v3add(v3mul(right, def.da), v3mul(down, def.db)) });
      let hc = roomFaceCorners(mp.hub, room.w, room.h, room.d);
      let C = v3mul(hc.reduce((a, p) => v3add(a, p), [0, 0, 0]), 1 / hc.length);
      let ext = (ax) => { let v = hc.map((p) => v3dot(v3sub(p, C), ax)); return (Math.max(...v) - Math.min(...v)) / 2; };
      let hw = ext(right), hh = ext(down);
      reg.px = g.hubRect.x + g.hubRect.w / 2;
      reg.py = g.hubRect.y + g.hubRect.h / 2;
      g.on.forEach((f) => {
        let aff = (ax, half) => {
          let v = (x, y) => v3dot(v3sub(f.to3d(x, y), C), ax) / half;
          let v00 = v(f.x0, f.y0), bx = (v(f.x1, f.y0) - v00) / (f.x1 - f.x0), by = (v(f.x0, f.y1) - v00) / (f.y1 - f.y0);
          return [v00 - bx * f.x0 - by * f.y0, bx, by];
        };
        let c = makeRadiateClip(f.x0, f.y0, f.x1, f.y1, toSheet(aff(right, hw), aff(down, hh)), f.proj);
        if (c) { c.face = f; reg.clips.push(c); }
      });
    }
    // the grid area this region needs: its pieces, turned back into grid space
    let bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    reg.clips.forEach((c) => c.poly.forEach(([x, y]) => {
      let dx = x - reg.px, dy = y - reg.py;
      let gx = reg.px + dx * reg.cos + dy * reg.sin, gy = reg.py - dx * reg.sin + dy * reg.cos;
      bb.x0 = Math.min(bb.x0, gx); bb.x1 = Math.max(bb.x1, gx); bb.y0 = Math.min(bb.y0, gy); bb.y1 = Math.max(bb.y1, gy);
    }));
    reg.gridRange = bb;
    // v40.21: each piece as a polygon in grid space (before the centring
    // shift), so a column can ask which rows can land on it
    reg.clips.forEach((c) => {
      c.gridPoly = (c.drawPoly && c.drawPoly.length >= 3 ? c.drawPoly : c.poly).map(([x, y]) => {
        let dx = x - reg.px, dy = y - reg.py;
        return [reg.px + dx * reg.cos + dy * reg.sin, reg.py - dx * reg.sin + dy * reg.cos];
      });
    });
    return reg;
  });
  if (radiateCache.size >= 8) radiateCache.delete(radiateCache.keys().next().value);
  radiateCache.set(key, out);
  return out;
}

// v40.8: Radiate is built around the MIDDLE: the grid is shifted so one
// screen's centre sits exactly on the midpoint of the ✕ / ✚ — the same in
// every region — and all other screens follow from it (for ✚ that
// screen's column runs along the diagonal through the midpoint).
// Worked out every frame, since Scale and spacing can change.
// v40.9: `align` picks WHICH point of that screen sits on the midpoint
// (see radiateAlign) — e.g. across −1 puts its left edge there.
function radiateCentreShift(px, py, align) {
  // v40.19: past ±1 the point moves into the gap beyond the edge (±2 = one whole gap)
  let off = (a, size, gap) => {
    a = Math.min(Math.max(a || 0, -2), 2);
    if (a > 1) return size + (a - 1) * gap;
    if (a < -1) return (a + 1) * gap;
    return size * (1 + a) / 2;
  };
  let ax = off(align && align.across, screenWidth, columnWidth - screenWidth);  // 0 … screenWidth (± a gap)
  let ay = off(align && align.along, screenHeight, unitHeight - screenHeight);  // 0 … screenHeight (± a gap)
  let c0 = Math.round((px - gridOrigin.x - ax) / columnWidth);
  let x = gridOrigin.x + c0 * columnWidth;
  let brick = (c0 % 2 !== 0) ? unitHeight / 2 : 0;
  let r0 = Math.round((py - gridOrigin.y - brick - ay) / unitHeight);
  let y = gridOrigin.y + r0 * unitHeight + brick;
  return [px - (x + ax), py - (y + ay)];
}

// v40.12: draws the Radiate regions so their cut lines are clean.
// Region 0 goes straight onto the picture, complete (background +
// screens) and reaching RADIATE_DRAW_REACH past its cuts. Regions 1–3 are
// each drawn complete on a hidden layer, then laid on top through ONE
// smoothed edge RADIATE_OVERLAP past their cuts. With one edge per region
// nothing leaks through (v40.10's thin background line) and nothing sticks
// out over a neighbour's gaps (v40.11). Each region gets its OWN paste —
// sharing a layer or drawing two regions directly leaves a few-pixel
// smudge where their enlarged edges cross at the midpoint. Only the
// rectangle around each region is cleared and pasted. Drawing is pointed
// at the hidden layer by swapping p5's drawing context for the moment.
// `drawRegion(reg)` draws one region's screens (radiatePass set).
let radiateLayer = null;
function radiateFillBackground(reg) {
  noStroke();
  fill(colBg);
  for (let c of reg.clips) {
    if (!c.drawPoly || c.drawPoly.length < 3) continue;
    beginShape();
    for (let P of c.drawPoly) { let q = c.proj(P[0], P[1]); vertex(q[0], q[1]); }
    endShape(CLOSE);
  }
}
// v40.13: p5's renderer, found the same way in p5 1.x and 2.x. (p5 2.x has
// no global `_renderer`, so v40.12 crashed after region 0 there and only
// one quarter of the radiate picture appeared.)
function p5Renderer() {
  if (typeof window !== 'undefined' && window._renderer) return window._renderer;
  return (typeof p5 !== 'undefined' && p5.instance) ? p5.instance._renderer : null;
}
// p5 remembers the last fill/stroke colour and skips setting it again —
// but that memory belongs to the context it was set on. After swapping
// contexts, forget it so the next fill() really reaches the new one.
function forgetP5StyleCache(R) {
  R._cachedFillStyle = R._cachedStrokeStyle = undefined; // p5 1.x
  if (R.states) { // p5 2.x
    if (typeof R.states.setValue === 'function') { R.states.setValue('_cachedFillStyle', undefined); R.states.setValue('_cachedStrokeStyle', undefined); }
    else { R.states._cachedFillStyle = R.states._cachedStrokeStyle = undefined; }
  }
}
// v40.21: TEST SWITCH (🖥 Display → Diagnostics; not saved): 'direct'
// draws regions 1–3 straight onto the picture, each clipped to its cut
// lines, with no hidden layer and no pastes. A faint line can show along
// the cuts; this exists only to measure what the layers cost.
let radiateDirect = false;
function drawRadiateRegions(regions, drawRegion) {
  // v42.1: with WebGL, all regions in one pass cut by a stencil (08_webgl);
  // the Canvas layers below only if WebGL can't (it then draws nothing).
  if (rendererChoice === 'webgl' && !glr.failed) {
    let R0 = p5Renderer();
    if (glDrawRadiate(regions, drawRegion, R0 ? R0.drawingContext : drawingContext)) return;
  }
  radiateFillBackground(regions[0]);
  drawRegion(regions[0]);
  let R = p5Renderer();
  if (!R) { for (let k = 1; k < regions.length; k++) { radiateFillBackground(regions[k]); drawRegion(regions[k]); } return; } // fallback: never blank
  let main = R.drawingContext;
  if (radiateDirect) {
    for (let k = 1; k < regions.length; k++) {
      let reg = regions[k];
      let tClip = performance.now(); // v40.22: the clip counts as layer work
      main.save();
      main.beginPath();
      for (let c of reg.clips) {
        if (!c.pastePoly || c.pastePoly.length < 3) continue;
        c.pastePoly.forEach((P, i) => { let q = c.proj(P[0], P[1]); if (i === 0) main.moveTo(q[0], q[1]); else main.lineTo(q[0], q[1]); });
        main.closePath();
      }
      main.clip();
      perfFrame.paste += performance.now() - tClip;
      forgetP5StyleCache(R);
      radiateFillBackground(reg);
      drawRegion(reg);
      main.restore();
      forgetP5StyleCache(R);
    }
    return;
  }
  let cv = main.canvas;
  if (!radiateLayer) radiateLayer = document.createElement('canvas');
  if (radiateLayer.width !== cv.width || radiateLayer.height !== cv.height) { radiateLayer.width = cv.width; radiateLayer.height = cv.height; }
  let lc = radiateLayer.getContext('2d');
  let tf = main.getTransform();
  for (let k = 1; k < regions.length; k++) {
    let reg = regions[k];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let c of reg.clips) for (let P of (c.drawPoly || [])) {
      let q = c.proj(P[0], P[1]);
      let dx = tf.a * q[0] + tf.c * q[1] + tf.e, dy = tf.b * q[0] + tf.d * q[1] + tf.f;
      x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
    }
    x0 = Math.max(0, Math.floor(x0) - 2); y0 = Math.max(0, Math.floor(y0) - 2);
    x1 = Math.min(cv.width, Math.ceil(x1) + 2); y1 = Math.min(cv.height, Math.ceil(y1) + 2);
    if (!(x1 > x0 && y1 > y0)) continue;
    let tClear = performance.now(); // v40.22: clearing the layer counts as layer work
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(x0, y0, x1 - x0, y1 - y0);
    lc.setTransform(tf);
    perfFrame.paste += performance.now() - tClear;
    R.drawingContext = lc;
    forgetP5StyleCache(R);
    try {
      radiateFillBackground(reg);
      drawRegion(reg);
    } finally {
      R.drawingContext = main;
      forgetP5StyleCache(R);
    }
    let tPaste = performance.now(); // v40.14 (v40.22: from the clip on)
    main.save();
    main.beginPath();
    for (let c of reg.clips) {
      if (!c.pastePoly || c.pastePoly.length < 3) continue;
      c.pastePoly.forEach((P, i) => { let q = c.proj(P[0], P[1]); if (i === 0) main.moveTo(q[0], q[1]); else main.lineTo(q[0], q[1]); });
      main.closePath();
    }
    main.clip();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.drawImage(radiateLayer, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    main.restore();
    perfFrame.paste += performance.now() - tPaste;
  }
}

// A grid rectangle turned into the region's sheet position (4 corners).
function radiateCorners(x, y, w, h) {
  let R = radiatePass;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([gx, gy]) => {
    let dx = gx + R.sx - R.px, dy = gy + R.sy - R.py; // v40.8: + the centring shift
    return [R.px + dx * R.cos - dy * R.sin, R.py + dx * R.sin + dy * R.cos];
  });
}

// Is this sheet rectangle on screen (Flat) / on a shown surface (Room)?
// v40.14: COLOUR BATCHING. While the screens are drawn, each piece is
// added to one shape per colour instead of being filled on its own; at
// the end every colour is filled in one go (a palette has a handful of
// colours, so thousands of fills become a few). Every screen still works
// out its own colours, bar position and timing exactly as before — only
// the hand-over to the browser changes. Screens never overlap, so the
// order they're filled in doesn't change the picture.
let screenBatch = null;      // Map: css colour -> piece list (null = draw directly through p5)
let screenBatchCss = null;   // the colour the next piece belongs to
let colorCssCache = new WeakMap();
function colorCss(c) {
  if (typeof c === 'string') return c;
  let s = colorCssCache.get(c);
  if (s) return s;
  let r, g, b, a;
  if (c && Array.isArray(c.levels)) [r, g, b, a] = c.levels;              // p5 1.x
  else { r = red(c); g = green(c); b = blue(c); a = alpha(c); }            // p5 2.x
  s = 'rgba(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ',' + (Math.round(a) / 255) + ')';
  colorCssCache.set(c, s);
  return s;
}
let screenBatchTf = null;    // Flat: canvas transform, to snap edges to whole pixels
let screenBatchRoom = null;  // v42.4: Room + WebGL: the room whose walls the chip projects onto (else null)
let screenBatchRadiate = false; // v42.5: ✕ / ✚ + WebGL: screens go to the chip uncut (it cuts with masks)
// v42.0: batchFlush() hands the batch to WebGL when it's on (08_webgl.js).
// v40.21: THE DOORWAY. Every screen piece goes through screenFill() +
// sheetRect() → batchPath(), collected per colour, and batchFlush() draws
// them, each piece its own small shape ("One by one", the winner of the
// v40.17 test; Batched and Classic were removed in v40.21). A future
// WebGL renderer would plug in here — new features that draw screens
// must go through this doorway, never around it.
// v40.18: the lists are REUSED frame after frame (one flat number array
// per colour, no new objects per piece), so drawing thousands of screens
// no longer leaves heaps of garbage for the browser to clean up.
let pieceListPool = new Map(); // css colour -> list
let pieceFrameId = 0;
function makePieceList() {
  let L = { xy: new Float64Array(1024), n: 0, starts: [], kinds: [], frame: -1 };
  let grow = (need) => {
    if (L.n + need <= L.xy.length) return;
    let a = new Float64Array(Math.max(L.xy.length * 2, L.n + need));
    a.set(L.xy.subarray(0, L.n)); L.xy = a;
  };
  L.moveTo = (x, y) => { grow(2); L.starts.push(L.n); L.kinds.push(0); L.xy[L.n++] = x; L.xy[L.n++] = y; };
  L.lineTo = (x, y) => { grow(2); L.xy[L.n++] = x; L.xy[L.n++] = y; };
  L.closePath = () => {};
  L.rect = (x, y, w, h) => { grow(4); L.starts.push(L.n); L.kinds.push(1); L.xy[L.n++] = x; L.xy[L.n++] = y; L.xy[L.n++] = w; L.xy[L.n++] = h; };
  // v42.4: a flat sheet rectangle on shown wall k (roomGeom.on[k]), not yet in perspective: the graphics chip projects it
  L.sheet = (k, x0, y0, x1, y1) => { grow(5); L.starts.push(L.n); L.kinds.push(2); L.xy[L.n++] = k; L.xy[L.n++] = x0; L.xy[L.n++] = y0; L.xy[L.n++] = x1; L.xy[L.n++] = y1; };
  // v42.5: an uncut ✕ / ✚ screen piece for region piece j: its 4 turned corners (rqx / rqy), still flat
  L.quad4 = (j) => {
    grow(9); L.starts.push(L.n); L.kinds.push(3); L.xy[L.n++] = j;
    L.xy[L.n++] = rqx[0]; L.xy[L.n++] = rqy[0]; L.xy[L.n++] = rqx[1]; L.xy[L.n++] = rqy[1];
    L.xy[L.n++] = rqx[2]; L.xy[L.n++] = rqy[2]; L.xy[L.n++] = rqx[3]; L.xy[L.n++] = rqy[3];
  };
  return L;
}
function pieceListFor(css) {
  let L = pieceListPool.get(css);
  if (!L) {
    if (pieceListPool.size > 64) pieceListPool.clear(); // colours that fade change every frame
    L = makePieceList();
    pieceListPool.set(css, L);
  }
  if (L.frame !== pieceFrameId) { L.frame = pieceFrameId; L.n = 0; L.starts.length = 0; L.kinds.length = 0; }
  return L;
}
function batchBegin() {
  screenBatch = new Map(); screenBatchCss = null;
  pieceFrameId++; // v40.18: each batch starts its reused lists afresh
  let R = p5Renderer();
  let t = (R ? R.drawingContext : drawingContext).getTransform();
  screenBatchTf = (t.b === 0 && t.c === 0 && t.a > 0 && t.d > 0) ? t : null;
  // v42.4: Room with WebGL (Radiate off): pieces stay flat, the chip does the perspective
  screenBatchRoom = (roomView && !radiatePass && !glr.recording && rendererChoice === 'webgl' && !glr.failed) ? roomGeom : null;
  screenBatchRadiate = !!radiatePass && glr.recording && radiatePass.clips.length <= GL_REGION_SLOTS; // v42.5 (only while glDrawRadiate records)
}
// Flat: a screen piece with its edges on whole device pixels. The picture
// is scaled to fit the window (often by an odd factor like 1.73), so edges
// used to fall mid-pixel and blend; neighbouring pieces now meet crisply,
// whatever order the colours are filled in.
function batchRectSnapped(bp, x, y, w, h) {
  let t = screenBatchTf;
  if (!t) { bp.rect(x, y, w, h); return; }
  let x0 = Math.round(t.a * x + t.e), x1 = Math.round(t.a * (x + w) + t.e);
  let y0 = Math.round(t.d * y + t.f), y1 = Math.round(t.d * (y + h) + t.f);
  if (x1 <= x0 || y1 <= y0) return;
  bp.rect((x0 - t.e) / t.a, (y0 - t.f) / t.d, (x1 - x0) / t.a, (y1 - y0) / t.d);
}
function screenFill(col) {
  if (screenBatch) screenBatchCss = colorCss(col); else fill(col);
}
function batchPath() {
  if (!screenBatch || screenBatchCss === null) return null;
  let p = screenBatch.get(screenBatchCss);
  if (!p) { p = pieceListFor(screenBatchCss); screenBatch.set(screenBatchCss, p); }
  return p;
}
function batchFlush() {
  let batch = screenBatch, geom = screenBatchRoom;
  screenBatch = null; screenBatchCss = null; screenBatchRoom = null; screenBatchRadiate = false;
  if (!batch) return;
  let tFl = performance.now(); // v40.22: the hand-over, timed
  let R = p5Renderer();
  let ctx = R ? R.drawingContext : drawingContext; // the hidden layer while a Radiate region is drawn
  // v42.0: WebGL draws the whole batch in one call and pastes it once
  // (08_webgl). (v42.1: ✕ / ✚ regions are recorded instead, see above.) If WebGL can't,
  // the batch is filled below as before, so nothing is ever left blank.
  if (glr.recording) { // v42.1: a ✕ / ✚ region — collected, drawn at the end (glDrawRadiate)
    let res = glAddBatch(batch);
    perfFrame.flush += performance.now() - tFl;
    perfFrame.pieces += res.pieces; perfFrame.corners += res.corners;
    return;
  }
  if (rendererChoice === 'webgl' && !radiatePass) {
    let res = glDrawBatch(batch, ctx, geom); // v42.4: + the room, for its walls' formulas
    if (res) {
      perfFrame.flush += performance.now() - tFl;
      perfFrame.pieces += res.pieces; perfFrame.corners += res.corners;
      return;
    }
  }
  let pieces = 0, corners = 0;
  for (let [css, path] of batch) {
    ctx.fillStyle = css;
    let xy = path.xy, st = path.starts, kd = path.kinds, cnt = st.length;
    pieces += cnt; // v40.22
    let k = -1;
    for (const a of st) { // v40.22: for…of, and 4-corner pieces written out (see clipHalfPlane)
      k++;
      let b = k + 1 < cnt ? st[k + 1] : path.n;
      if (kd[k] === 1) { corners += 4; ctx.fillRect(xy[a], xy[a + 1], xy[a + 2], xy[a + 3]); continue; }
      if (kd[k] === 2) { // v42.4: WebGL failed this frame — project here, exactly as sheetRect does for Canvas
        corners += 4;
        let f = geom.on[xy[a]], x0 = xy[a + 1], y0 = xy[a + 2], x1 = xy[a + 3], y1 = xy[a + 4];
        let p = f.proj(x0, y0), q = f.proj(x1, y0), r = f.proj(x1, y1), s = f.proj(x0, y1);
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(r[0], r[1]); ctx.lineTo(s[0], s[1]);
        ctx.closePath();
        ctx.fill();
        continue;
      }
      corners += (b - a) / 2;
      ctx.beginPath();
      ctx.moveTo(xy[a], xy[a + 1]);
      if (b - a === 8) {
        ctx.lineTo(xy[a + 2], xy[a + 3]); ctx.lineTo(xy[a + 4], xy[a + 5]); ctx.lineTo(xy[a + 6], xy[a + 7]);
      } else {
        for (let i = a + 2; i < b; i += 2) { ctx.lineTo(xy[i], xy[i + 1]); }
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  if (R) forgetP5StyleCache(R); // p5 didn't see these fill colours
  perfFrame.flush += performance.now() - tFl; // v40.22
  perfFrame.pieces += pieces; perfFrame.corners += corners;
}

// v40.14: PERFORMANCE READOUT. Time spent per frame in each part,
// averaged over PERF_WINDOW_MS, shown in the rhythm-dock readout.
// These are the sketch's own milliseconds: the browser's painting of
// the pixels happens afterwards and isn't included.
let rqx = new Float64Array(4), rqy = new Float64Array(4);
function radiateCornersFast(x, y, w, h) {
  let R = radiatePass, cs = R.cos, sn = R.sin;
  let dx0 = x + R.sx - R.px, dy0 = y + R.sy - R.py, dx1 = dx0 + w, dy1 = dy0 + h;
  rqx[0] = R.px + dx0 * cs - dy0 * sn; rqy[0] = R.py + dx0 * sn + dy0 * cs;
  rqx[1] = R.px + dx1 * cs - dy0 * sn; rqy[1] = R.py + dx1 * sn + dy0 * cs;
  rqx[2] = R.px + dx1 * cs - dy1 * sn; rqy[2] = R.py + dx1 * sn + dy1 * cs;
  rqx[3] = R.px + dx0 * cs - dy1 * sn; rqy[3] = R.py + dx0 * sn + dy1 * cs;
}
// 0 = outside the piece, 1 = fully inside, 2 = crosses a cut line
// v40.22: the 4 corners written out (no inner for-loop: see clipHalfPlane)
function radiateClassify(c) {
  let allIn = true;
  for (const h of c.hp) {
    let a = h[0], b = h[1], g = h[2];
    let out = (a + b * rqx[0] + g * rqy[0] < 0 ? 1 : 0) + (a + b * rqx[1] + g * rqy[1] < 0 ? 1 : 0)
      + (a + b * rqx[2] + g * rqy[2] < 0 ? 1 : 0) + (a + b * rqx[3] + g * rqy[3] < 0 ? 1 : 0);
    if (out === 4) { return 0; }
    if (out) { allIn = false; }
  }
  return allIn ? 1 : 2;
}
// The last whole screen checked, and how it sits in each piece: its parts
// (current colour, bar, next colour) lie inside it, so a piece it misses
// or fully covers needs no further checks for them.
let rScreen = { pass: null, x: 0, y: 0, w: 0, h: 0, cls: new Int8Array(16) };
function sheetRectVisible(x, y, w, h) {
  if (radiatePass) { // v40.7 (v40.20: corner test instead of bounding boxes)
    radiateCornersFast(x, y, w, h);
    let clips = radiatePass.clips, any = false, i = 0;
    for (const c of clips) { let k = radiateClassify(c); if (i < 16) { rScreen.cls[i] = k; } if (k) { any = true; } i++; } // v40.22: for…of
    rScreen.pass = radiatePass; rScreen.x = x; rScreen.y = y; rScreen.w = w; rScreen.h = h;
    return any;
  }
  if (!roomView) return x + w > 0 && x < width && y + h > 0 && y < height;
  for (let f of roomGeom.on) if (x + w > f.x0 && x < f.x1 && y + h > f.y0 && y < f.y1) return true;
  return false;
}

// Draws a sheet rectangle: a plain rect in Flat view; in Room view, cut
// into one piece per surface it touches (so a screen folds across a
// corner), each piece drawn in perspective. v42.4: with WebGL the pieces
// are handed over flat (wall + rectangle) and the chip does the perspective.
// v42.5: ✕ / ✚ with WebGL: each screen goes over whole and flat (its turned
// corners) to every region piece it touches; no cutting or projecting here.
function sheetRect(x, y, w, h) {
  if (radiatePass) { // v40.7: turned into the region, cut to its pieces
    radiateCornersFast(x, y, w, h); // v40.20
    let q = null, clips = radiatePass.clips;
    let inScreen = rScreen.pass === radiatePass && x >= rScreen.x - 1e-6 && y >= rScreen.y - 1e-6
      && x + w <= rScreen.x + rScreen.w + 1e-6 && y + h <= rScreen.y + rScreen.h + 1e-6;
    let ci = -1, gpu = screenBatchRadiate ? batchPath() : null; // v42.5
    for (const c of clips) { // v40.22: for…of (see clipHalfPlane)
      ci++;
      let k = (inScreen && ci < 16 && rScreen.cls[ci] !== 2) ? rScreen.cls[ci] : radiateClassify(c);
      if (k === 0) continue;
      if (gpu) { gpu.quad4(ci); continue; } // v42.5: whole, flat — the chip cuts it (mask) and projects it
      if (k === 1) { // v40.20: fully inside — no cutting
        let bp = batchPath();
        let s0 = c.proj(rqx[0], rqy[0]), s1 = c.proj(rqx[1], rqy[1]), s2 = c.proj(rqx[2], rqy[2]), s3 = c.proj(rqx[3], rqy[3]);
        if (bp) { bp.moveTo(s0[0], s0[1]); bp.lineTo(s1[0], s1[1]); bp.lineTo(s2[0], s2[1]); bp.lineTo(s3[0], s3[1]); bp.closePath(); }
        else quad(s0[0], s0[1], s1[0], s1[1], s2[0], s2[1], s3[0], s3[1]);
        continue;
      }
      if (!q) q = [[rqx[0], rqy[0]], [rqx[1], rqy[1]], [rqx[2], rqy[2]], [rqx[3], rqy[3]]];
      let poly = q;
      for (let h of c.hp) { poly = clipHalfPlane(poly, h); if (poly.length < 3) break; }
      if (poly.length < 3) continue;
      perfFrame.cut++; // v40.22
      let bp = batchPath(); // v40.14
      if (bp) {
        poly.forEach((P, i) => { let s = c.proj(P[0], P[1]); if (i === 0) bp.moveTo(s[0], s[1]); else bp.lineTo(s[0], s[1]); });
        bp.closePath();
        continue;
      }
      beginShape();
      for (let P of poly) { let s = c.proj(P[0], P[1]); vertex(s[0], s[1]); }
      endShape(CLOSE);
    }
    return;
  }
  let bp = batchPath(); // v40.14
  if (!roomView) { if (bp) batchRectSnapped(bp, x, y, w, h); else rect(x, y, w, h); return; }
  let gpu = bp && screenBatchRoom, k = -1; // v42.4
  for (let f of roomGeom.on) {
    k++;
    let ax = Math.max(x, f.x0), bx = Math.min(x + w, f.x1);
    if (ax >= bx) continue;
    let ay = Math.max(y, f.y0), by = Math.min(y + h, f.y1);
    if (ay >= by) continue;
    if (gpu) { bp.sheet(k, ax, ay, bx, by); continue; } // v42.4: cut here, put in perspective by the chip
    let a = f.proj(ax, ay), b = f.proj(bx, ay), c = f.proj(bx, by), d = f.proj(ax, by);
    if (bp) { bp.moveTo(a[0], a[1]); bp.lineTo(b[0], b[1]); bp.lineTo(c[0], c[1]); bp.lineTo(d[0], d[1]); bp.closePath(); continue; }
    quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
  }
}

// Room view's backdrop: black outside the room, each shown surface in the
// background colour, hidden surfaces black with a faint outline.
let frameErrorInfo = null; // { msg, untilMs }
let frameErrorCount = 0;
function draw() {
  // v43.1: while exporting only the export's own redraw() draws (a stray
  // animation frame from before noLoop() would draw an extra frame)
  if (exportState.on) { if (!exportState.want) return; exportState.want = 0; }
  let tF = performance.now(); // v40.14
  perfFrameStart();
  screenBatch = null; // v40.14: never carry a half-built batch over from a failed frame
  try {
    drawFrame();
    perfFrameEnd(performance.now() - tF, tF);
    diagFrame(tF, performance.now() - tF); // v40.15
  } catch (err) {
    frameErrorCount++;
    diagEvent('frame error: ' + String(err && err.message || err)); // v40.15
    if (frameErrorCount === 1 || frameErrorCount % 300 === 0) console.error('Frame error (#' + frameErrorCount + '):', err);
    frameErrorInfo = { msg: String(err && err.message || err), untilMs: millis() + 4000 };
    if (exportState.on) exportState.error = err; // v43.1: an export stops (09_export) instead of carrying the note
    noStroke();
  }
  if (frameErrorInfo && millis() < frameErrorInfo.untilMs && !exportState.on) {
    drawCanvasNote('Something went wrong in a frame (' + frameErrorInfo.msg.slice(0, 80) + ') — still running', height - 80);
  }
  if (exportState.pending) exportBegin(); // v43.1: a video export starts after this frame (09_export)
}

function drawFrame() {
  let real = millis();
  let now = sketchFrameNow(real); // v43.0: the artwork clock (stands still while paused)
  updateDisplayMeasurement(deltaTime, real); // v35: before anything reads the frame clock
  updateAutoSharpness(deltaTime, performance.now()); // v41.7
  updateSafetyLimit(now); // v37.1: before any timing is read this frame
  updateSequence(now);

  // While a scene transition is crossfading, updateSceneTransitionState()
  // sets colBg/colScroll/palette/layoutGroup.current (and the values
  // derived from it) directly and returns true — the normal per-frame
  // rebuild is skipped for that frame, since colorSets/layoutGroup.sets
  // still belong to the OUTGOING scene until the transition finishes.
  let transitioning = updateSceneTransitionState(now);
  if (!transitioning) {
    rebuildEffectivePalette(now);
    rebuildEffectiveLayout(now);
  }

  updateMappingChange(now); // v40.5: cycling + fade bookkeeping
  let target = mappingForFrame(now);
  frameMapping = target; // v40.1: centre surface + flow drawn this frame
  if (roomView) roomUpdateGeometry(); // v39.1: before anything reads the sheet

  // v30: resolve this frame's zoom point, then shift the grid origin so
  // any Scale/spacing change since last frame radiates out from it.
  updateAnchorFrac();
  updateGridOrigin();

  // v40.5: a mapping FADE is a true crossfade: the old mapping is drawn
  // and copied aside, the new one is drawn normally, then the copy is laid
  // back on top, fading out. (Drawing the new one semi-transparent layer
  // by layer would darken and muddy the middle of the fade.)
  scrollVisibleKeysNext = [];
  let fade = mappingFadeAmount(now);
  glPlanFrame([target, fade >= 0 && mappingFade ? mappingFade.from : null]); // v42.2: does this frame draw ✕ / ✚?
  if (fade >= 0) {
    let main = drawingContext.canvas;
    if (!mappingFadeCanvas) mappingFadeCanvas = document.createElement('canvas');
    let fc = mappingFadeCanvas;
    if (fc.width !== main.width || fc.height !== main.height) { fc.width = main.width; fc.height = main.height; }
    drawMappingPass(now, mappingFade.from);
    let fctx = fc.getContext('2d');
    fctx.clearRect(0, 0, fc.width, fc.height);
    fctx.drawImage(main, 0, 0);
    drawMappingPass(now, target);
    let ctx = drawingContext;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1 - fade;
    ctx.drawImage(fc, 0, 0);
    ctx.restore();
  } else {
    drawMappingPass(now, target);
  }
  scrollVisibleKeys = scrollVisibleKeysNext;

  pruneModuleStates(now);
  updateRoomEyeMarker(); // v39.1
  updateFigureMarker(); // v40.3
  updateRhythmDock(real); // v35.1 (throttled internally; v43.0: real time, so it still updates while paused)
}

// v40.5: draws the whole picture for one mapping (the room, its screens
// and the person). Normally once per frame; twice during a mapping fade.
function drawMappingPass(now, mapping) {
  frameMapping = mapping;
  if (roomView) roomUpdateGeometry();

  if (roomView) drawRoomBackground(); // v39.1
  else background(colBg);

  // v30: visible column range derived from the live origin rather than
  // assuming column 0 sits at x = 0. With gridOrigin.x = 0 this reduces
  // exactly to the old -1 .. ceil(width / columnWidth) + 1.
  // v39.1: over the sheet area in view — the window (Flat) or every
  // shown surface (Room). Flat reduces exactly to the old range.
  let range = gridDrawRange();
  let colStart = Math.floor((range.x0 - gridOrigin.x) / columnWidth) - 1;
  let colEnd   = Math.ceil((range.x1 - gridOrigin.x) / columnWidth) + 1;

  // v39.2: screen budget — never try to draw an impossible number of screens.
  // v42.6: the limit is measured on this computer (screenLimitFor, 04_room),
  // Flat included; 🖥 Display → Screen limit Off draws everything.
  let limitMode = screenLimitMode(mapping);
  let estimate = screenEstimate(), limit = screenLimitFor(limitMode), notes = null;
  if (screenLimitOn && !exportState.on && estimate > limit) { // v43.1: an export draws everything
    scrollVisibleKeys = [];
    if (roomView) {
      noFill(); stroke(255, 70); strokeWeight(1); // the room's edges, so its shape stays readable
      roomGeom.faces.forEach((f) => { let q = f.screen; quad(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]); });
      noStroke();
    }
    let sMin = Math.ceil(layoutGroup.current.scale * Math.sqrt(estimate / limit)); // screens ≈ 1 / Scale²
    notes = ['Too many screens for this computer (about ' + estimate.toLocaleString() + '; the limit here is ' + limit.toLocaleString() + ')',
      'Raise Scale to about ' + sMin + (roomView ? ', make the room smaller,' : '') + ' or turn the limit off (🖥 Display → Screen limit)']; // drawn after the person, on top
  } else {
    updateScrollPulse(now); // v36: picks from LAST frame's visible screens
    let tS = performance.now(); // v40.14
    let n0 = perfFrame.n, g0 = glr.endMs; // v42.6: this pass's screens, for the screen limit
    let regions = radiateRegionsFor(mapping); // v40.7
    if (!regions) {
      batchBegin(); // v40.14: screens collected by colour, filled in one go
      for (let c = colStart; c <= colEnd; c++) {
        drawColumn(c, now, range);
      }
      batchFlush();
    } else {
      // v40.7 Radiate: the grid once per region, turned to point its way
      // (v40.12: drawn so the cut lines are clean — drawRadiateRegions())
      drawRadiateRegions(regions, (reg) => {
        radiatePass = reg;
        let ra = mapping.radiateAlign;
        let secAlign = ra && Array.isArray(ra.sections) ? ra.sections[regions.indexOf(reg)] : ra; // v40.10: per section
        [reg.sx, reg.sy] = radiateCentreShift(reg.px, reg.py, secAlign); // v40.8 (v40.9: + alignment)
        let g0 = gridDrawRange();
        let rr = { x0: g0.x0 - reg.sx, x1: g0.x1 - reg.sx, y0: g0.y0 - reg.sy, y1: g0.y1 - reg.sy };
        let c0 = Math.floor((rr.x0 - gridOrigin.x) / columnWidth) - 1;
        let c1 = Math.ceil((rr.x1 - gridOrigin.x) / columnWidth) + 1;
        batchBegin(); // v40.14: per region, flushed onto that region's layer
        for (let c = c0; c <= c1; c++) drawColumn(c, now, rr);
        batchFlush();
      });
      radiatePass = null;
    }
    let tE = performance.now();
    perfFrame.screens += tE - tS;
    // v42.6: learn this computer's speed from the work that grows with the
    // screens — WebGL's draw + paste (glEnd) depends on pixels, not screens
    if (!exportState.on) screenLimitRecord(limitMode, perfFrame.n - n0, tE - tS - (glr.endMs - g0), tE); // v43.1: not from export frames (other size, 4×)
  }

  let tP = performance.now(); // v40.14
  drawScaleFigureCached(); // v40.3: in front of the walls (v40.14: cached; v41.3: Flat too, front view)
  perfFrame.person += performance.now() - tP;
  if (notes) { drawCanvasNote(notes[0], height / 2 - 24); drawCanvasNote(notes[1], height / 2 + 24); } // v42.6
}

// v40.21: WHICH ROWS CAN LAND ON SOMETHING. In Room (and ✕ / ✚) the
// sheet's bounding box is mostly empty — the unfolded surfaces form a
// cross, and a region is a wedge — so walking every row of every column
// checked ~3× more screens than were drawn. Now each column asks for the
// stretches of sheet (y0…y1) it actually crosses: the shown surfaces it
// overlaps (Room), or the region's pieces cut to the column (Radiate).
// Returns null = the whole range (Flat).
function columnSpans(xL, xR) {
  let spans = [];
  if (radiatePass) {
    let R = radiatePass, clips = R.clips;
    for (const clip of clips) { // v40.22: for…of (see clipHalfPlane)
      let gp = clip.gridPoly;
      if (!gp) { return null; }
      let q = [];
      for (const G of gp) { q.push([G[0] - R.sx, G[1] - R.sy]); }
      q = clipHalfPlane(q, [-xL, 1, 0]);
      if (q.length >= 3) { q = clipHalfPlane(q, [xR, -1, 0]); }
      if (q.length < 3) { continue; }
      let y0 = Infinity, y1 = -Infinity;
      for (const Q of q) { if (Q[1] < y0) { y0 = Q[1]; } if (Q[1] > y1) { y1 = Q[1]; } }
      spans.push([y0, y1]);
    }
  } else if (roomView) {
    let on = roomGeom.on;
    for (const f of on) { if (f.x1 > xL && f.x0 < xR) { spans.push([f.y0, f.y1]); } }
  } else {
    return null;
  }
  return spans;
}
function drawColumn(c, now, range) {
  let x = gridOrigin.x + c * columnWidth;
  let brickOffset = (c % 2 !== 0) ? unitHeight / 2 : 0; // JS: -1 % 2 === -1, so negative odd columns offset too
  let rowOf = (yy) => Math.floor((yy - gridOrigin.y - brickOffset) / unitHeight);

  // v30: same as before but relative to the live origin (gridOrigin.y).
  let fullStart = rowOf(range.y0) - 1; // v39.1: sheet range
  let fullEnd   = rowOf(range.y1) + 1;
  // v40.21: only the rows that can land on a surface / region piece
  let spans = columnSpans(x - 1, x + screenWidth + 1);
  let rowSpans;
  if (!spans) rowSpans = [[fullStart, fullEnd]];
  else {
    rowSpans = [];
    for (let i = 0; i < spans.length; i++) {
      let a = Math.max(fullStart, rowOf(spans[i][0] - screenHeight) - 1), b = Math.min(fullEnd, rowOf(spans[i][1]) + 1);
      if (b >= a) rowSpans.push([a, b]);
    }
    rowSpans.sort((p, q) => p[0] - q[0]);
    let merged = [];
    for (let i = 0; i < rowSpans.length; i++) {
      let sp = rowSpans[i], last = merged[merged.length - 1];
      if (last && sp[0] <= last[1] + 1) { last[1] = Math.max(last[1], sp[1]); } else { merged.push(sp.slice()); }
    }
    rowSpans = merged;
  }
  // v40.21: plain indexed loops with braces — the p5 editor rewrites loops
  // (its infinite-loop guard), and a braceless loop inside a destructuring
  // for…of made it lose a variable (_LPxx is not defined).
  for (let si = 0; si < rowSpans.length; si++) {
  let rowStart = rowSpans[si][0], rowEnd = rowSpans[si][1];
  for (let r = rowStart; r <= rowEnd; r++) {
    let y = gridOrigin.y + r * unitHeight + brickOffset;
    // v39.2: in Room view, screens on no shown surface are skipped entirely
    // (not drawn, not stored) — the room's bounding box is mostly empty.
    if ((roomView || radiatePass) && !sheetRectVisible(Math.round(x), Math.round(y), Math.round(screenWidth), Math.round(screenHeight))) continue;
    drawScreenModule(c, r, x, y, now, roomView || !!radiatePass); // v40.21: visibility already known
  }
  }
}

// v30: resolves anchorState.frac from the governing Layout set's
// `anchor`. Fixed anchors resolve directly every frame. Random modes
// pick a new point only when the governing set object or its mode has
// changed since last frame — i.e. once per Layout transition (or when
// the user switches a set to Random) — and hold it steady otherwise, so
// a single zoom never wanders mid-transition.
function updateAnchorFrac() {
  let set = layoutGroup.anchorSet;
  if (!set) return;
  let mode = isValidAnchor(set.anchor) ? set.anchor : DEFAULT_ANCHOR;
  let changed = set !== anchorState.govSet || mode !== anchorState.mode;
  anchorState.govSet = set;
  anchorState.mode = mode;

  if (ANCHOR_POINTS[mode]) {
    anchorState.frac = ANCHOR_POINTS[mode];
    return;
  }
  if (!changed) return;

  if (mode === 'RANDOM_ANY') {
    anchorState.frac = [Math.random(), Math.random()];
  } else { // RANDOM_9 — avoid repeating the previous pick, for visible variety
    let keys = Object.keys(ANCHOR_POINTS).filter((k) => k !== anchorState.lastKey9);
    let key = keys[Math.floor(Math.random() * keys.length)];
    anchorState.lastKey9 = key;
    anchorState.frac = ANCHOR_POINTS[key];
  }
}

// v30: zoom-about-a-point. If columnWidth/unitHeight changed since last
// frame, move the origin so the screen point P under the anchor stays
// put: a grid point at distance (P - origin) from P ends up at distance
// (P - origin) * newSize / oldSize. Each axis uses its own unit
// (columnWidth for x, unitHeight for y), and the brick offset — itself
// proportional to unitHeight — scales along with everything else.
// Anchor NW (P = 0,0) with origin (0,0) keeps the origin at (0,0)
// forever: exactly the pre-v30 behaviour.
function updateGridOrigin() {
  if (gridOrigin.prevCw !== null && gridOrigin.prevCw > 0 && columnWidth !== gridOrigin.prevCw) {
    let vr = gridViewRect(); // v39.1: the centre surface in Room view
    let px = vr.x + anchorState.frac[0] * vr.w;
    gridOrigin.x = px - (px - gridOrigin.x) * (columnWidth / gridOrigin.prevCw);
  }
  if (gridOrigin.prevUh !== null && gridOrigin.prevUh > 0 && unitHeight !== gridOrigin.prevUh) {
    let vr = gridViewRect();
    let py = vr.y + anchorState.frac[1] * vr.h;
    gridOrigin.y = py - (py - gridOrigin.y) * (unitHeight / gridOrigin.prevUh);
  }
  gridOrigin.prevCw = columnWidth;
  gridOrigin.prevUh = unitHeight;
}

// v30: memory safeguard — see the v30 header note. Runs at most every
// MODULE_STATE_PRUNE_EVERY_MS; drops states not drawn for
// MODULE_STATE_TTL_MS. Only independent (staggered) mode stores states.
const MODULE_STATE_TTL_MS = 10000;
const MODULE_STATE_PRUNE_EVERY_MS = 5000;
let lastModuleStatePruneMs = 0;
function pruneModuleStates(now) {
  if (now - lastModuleStatePruneMs < MODULE_STATE_PRUNE_EVERY_MS) return;
  lastModuleStatePruneMs = now;
  for (let [key, state] of moduleStates) {
    if (now - (state.lastSeenMs || 0) > MODULE_STATE_TTL_MS) moduleStates.delete(key);
  }
}

// Draws ONE fixed screen module at (x, y). Geometry stays clamped
// (no clip() needed) — manual region math as established in v6.
function drawScreenModule(c, r, x, y, now, knownVisible) {
  let result = staggeredMode
    ? updateModuleIndependent(c, r, now)
    : updateModuleSynced(c, r, now);

  let currentColor = result.currentColor;
  let nextColor     = result.nextColor;
  let progress      = result.progress;

  let xi = Math.round(x);
  let yi = Math.round(y);
  let wI = Math.round(screenWidth);
  let hI = Math.round(screenHeight);
  // v36: remember which screens are actually on the canvas (the pulse pool).
  // v39.1: in Room view, "visible" = on any shown surface.
  if (knownVisible || sheetRectVisible(xi, yi, wI, hI)) scrollVisibleKeysNext.push(moduleKey(c, r)); // v40.21: no second check when drawColumn just did it (v42.3: number key)
  let gI = Math.round(gapHeight);
  let moduleTop    = yi;
  let moduleBottom = yi + hI;

  let travel = hI + gI;
  let barTop = Math.round(moduleBottom - travel * progress);
  let barBottom = barTop + gI;

  // v40.1: flow Down = the same swipe mirrored top-to-bottom inside the
  // screen (the bar enters at the top and travels down). Every screen
  // flips the same way, so seamless joins on the sheet stay seamless.
  let down = frameMapping.flow === 'down';

  // --- Current colour: top of module down to barTop, clamped ---
  let currentBottom = Math.max(moduleTop, Math.min(moduleBottom, barTop));
  let currentHeight = currentBottom - moduleTop;
  perfFrame.n++; // v40.14
  if (currentHeight > 0) {
    screenFill(currentColor); // v40.14 (was fill)
    drawModulePiece(xi, wI, moduleTop, moduleBottom, down, moduleTop, currentHeight); // v42.3
  }

  // --- Scroll bar: only the portion actually inside the module ---
  let barVisibleTop    = Math.max(moduleTop, barTop);
  let barVisibleBottom = Math.min(moduleBottom, barBottom);
  let barVisibleHeight = barVisibleBottom - barVisibleTop;
  if (barVisibleHeight > 0) {
    screenFill(colScroll);
    drawModulePiece(xi, wI, moduleTop, moduleBottom, down, barVisibleTop, barVisibleHeight); // v42.3
  }

  // --- Next colour: from end of bar down to bottom of module, clamped ---
  let nextTop = Math.max(moduleTop, Math.min(moduleBottom, barBottom));
  let nextHeight = moduleBottom - nextTop;
  if (nextHeight > 0) {
    screenFill(nextColor);
    drawModulePiece(xi, wI, moduleTop, moduleBottom, down, nextTop, nextHeight); // v42.3
  }
}
// One horizontal band of a screen (its colour, the bar, the next colour).
// v40.1: flow Down = mirrored top-to-bottom inside the screen.
// v42.3: a plain function (was a small function made anew for every screen).
function drawModulePiece(xi, wI, moduleTop, moduleBottom, down, top, h) {
  if (h <= 0) return;
  sheetRect(xi, down ? moduleTop + moduleBottom - top - h : top, wI, h); // v39.1
}
