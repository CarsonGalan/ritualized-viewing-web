// noprotect
// Ritualized Viewing v43.1 — 04_room.js
// Room preview constants, room geometry & unfolding, perspective, viewpoint, grid draw range, room background, the person (mesh drawing, cache, shine, marker).
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- v39.1: ROOM PREVIEW ----------------------
// Room coordinates in metres: x right (centre line at 0), y up (floor at
// 0), z into the room (open front at 0, back wall at D). The viewer's eye
// sits ROOM_EYE_DIST_M in front of the opening; the opening is mapped to
// the window, so depth controls how big the back wall looks
// (eye / (eye + depth) of the opening: 8 / 16 = half by default).
const ROOM_FACE_NAMES = ['back', 'left', 'right', 'ceiling', 'floor'];
const ROOM_FACE_LABELS = { back: 'Back wall', left: 'Left wall', right: 'Right wall', ceiling: 'Ceiling', floor: 'Floor' };
const ROOM_EYE_DIST_M = 8;
const ROOM_SIZE_RANGE = { w: [2, 30], h: [2, 20], d: [2, 30] }; // v40.5: height up to 20 m (was 15)
const ROOM_EYE_MARGIN = 0.03; // the eye stays just inside the opening (so every wall is seen from inside)
const ROOM_REF_WIDTH_M = 8;     // v39.2: the window's width = 8 m of wall, whatever the room's size
const ROOM_SCREEN_BUDGET = 5000; // v39.2: above this, Room view shows a note instead of stalling (v40.20: was 3000; v42.6: the lowest the measured screen limit goes)
const ROOM_DEFAULTS = {
  w: 8, h: 4, d: 8,
  // v40.1 / v40.2 / v40.4: the centre surface, the viewpoint and the
  // shown surfaces moved into each scene's Mappings (below).
  // v40.3: the scale figure (showcase only). fx / fz = where it stands, as
  // a fraction of the floor's width (left -> right) and depth (front ->
  // back), so it stays in the same place when the room is resized.
  figure: { on: true, fx: 0.5, fz: 0.5, color: [225, 228, 235], solid: 0 }, // v40.9: solid 0 = chrome … 1 = solid
};
let room = deepClonePlain(ROOM_DEFAULTS); // saved with the show (buildShowData())
let roomView = false;       // Flat / Room — a preview switch, not saved
let roomMoveEye = false;    // eye marker shown and draggable
let roomGeom = null, roomGeomSig = null;
let roomMenu = null, roomEyeMarker = null;
let displayMenu = null; // v40.4


// v40.1: the surface that doesn't touch the centre hangs off this one.
// With Left or Right as centre, the far wall hangs off the CEILING, so
// the walls and ceiling/floor form one continuous loop: up the left
// wall, across the ceiling, DOWN the right wall (and across the floor
// back to the left wall, through a seam). Before v40 it hung off the
// back wall, which made the right wall flow against the others.
// Floor / Ceiling centres keep the back wall (floor -> back -> ceiling).
const ROOM_FAR_PARENT = { left: 'ceiling', right: 'ceiling' };
// v40.5: centres whose whole unfolding is spelled out, in order
// [surface, the surface it hangs off]. Ceiling as centre: the side walls
// hang off the FLOOR, so they flow toward you (continuing the floor,
// seamless there; their corners with the ceiling are seams). Before, they
// hung off the ceiling and flowed away.
const ROOM_UNFOLD_PLANS = {
  ceiling: [['back', 'ceiling'], ['floor', 'back'], ['left', 'floor'], ['right', 'floor']],
};

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function v3mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3norm(a) { let l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

function roomFaceCorners(name, W, H, D) {
  let x0 = -W / 2, x1 = W / 2;
  switch (name) {
    case 'back':    return [[x0, 0, D], [x1, 0, D], [x1, H, D], [x0, H, D]];
    case 'left':    return [[x0, 0, 0], [x0, 0, D], [x0, H, D], [x0, H, 0]];
    case 'right':   return [[x1, 0, D], [x1, 0, 0], [x1, H, 0], [x1, H, D]];
    case 'floor':   return [[x0, 0, 0], [x1, 0, 0], [x1, 0, D], [x0, 0, D]];
    case 'ceiling': return [[x0, H, D], [x1, H, D], [x1, H, 0], [x0, H, 0]];
  }
}

// How the CENTRE surface is laid on the sheet, seen from inside the room:
// [sheet-right, sheet-down] as room directions. Walls stand upright; floor
// and ceiling have the back wall at the top of the sheet.
const ROOM_HUB_FRAMES = {
  back:    [[1, 0, 0],  [0, -1, 0]],
  left:    [[0, 0, 1],  [0, -1, 0]],
  right:   [[0, 0, -1], [0, -1, 0]],
  floor:   [[1, 0, 0],  [0, 0, -1]],
  ceiling: [[-1, 0, 0], [0, 0, -1]],
};

// Builds the unfolded sheet and the perspective view from `room` and the
// window size. Each face gets its sheet rectangle (x0..x1, y0..y1 in sheet
// px), a sheet -> 3D map, and a sheet -> screen map. Cached (see
// roomUpdateGeometry()); rebuilt only when something changes.
// v40.4: takes the mapping to build (default: the one drawn this frame);
// the menu also builds one for the mapping being edited, to describe it.
function roomBuildGeometry(mp, opts) {
  mp = mp || frameMapping;
  let radiateDir = opts && opts.radiateDir; // v40.7: a radiate region's outward direction (3D)
  let W = room.w, H = room.h, D = room.d, hub = mp.hub; // v40.1: from the mapping
  let corners = {};
  ROOM_FACE_NAMES.forEach((n) => { corners[n] = roomFaceCorners(n, W, H, D); });
  // v39.2: FIXED sheet px per metre, so screens keep their physical size
  // (Scale = size on an 8 m wall). Was width / centre-wall width in v39.1.
  let k = width / ROOM_REF_WIDTH_M;
  let [right, down] = ROOM_HUB_FRAMES[hub];
  let minR = Math.min(...corners[hub].map((p) => v3dot(p, right)));
  let minD = Math.min(...corners[hub].map((p) => v3dot(p, down)));
  let flat = {};
  flat[hub] = (p) => [(v3dot(p, right) - minR) * k, (v3dot(p, down) - minD) * k];

  let key = (p) => p.map((v) => v.toFixed(5)).join(',');
  function sharedEdge(a, b) {
    let kb = new Set(corners[b].map(key));
    let s = corners[a].filter((p) => kb.has(key(p)));
    return s.length === 2 ? s : null;
  }
  // Unfold `child` about its shared edge with `parent` into the parent's
  // plane, then use the parent's own sheet mapping.
  function attach(child, parent) {
    let [A, B] = sharedEdge(child, parent);
    let e = v3norm(v3sub(B, A));
    let inward = (face) => {
      let q = corners[face].find((p) => key(p) !== key(A) && key(p) !== key(B));
      let r = v3sub(q, A);
      return v3norm(v3sub(r, v3mul(e, v3dot(r, e))));
    };
    let nC = inward(child), m = v3mul(inward(parent), -1);
    let pf = flat[parent];
    flat[child] = (p) => {
      let r = v3sub(p, A);
      return pf(v3add(v3add(A, v3mul(e, v3dot(r, e))), v3mul(m, v3dot(r, nC))));
    };
  }
  if (ROOM_UNFOLD_PLANS[hub] && !radiateDir) {
    ROOM_UNFOLD_PLANS[hub].forEach(([child, parent]) => attach(child, parent)); // v40.5
  } else {
    ROOM_FACE_NAMES.forEach((n) => { if (n !== hub && sharedEdge(n, hub)) attach(n, hub); });
    // the one surface not touching the centre (v40.1). v40.7 Radiate: it
    // continues from the neighbour lying in the region's direction, when
    // they share an edge.
    let centreOf = (n) => v3mul(corners[n].reduce((a, p) => v3add(a, p), [0, 0, 0]), 1 / corners[n].length);
    let hubC = centreOf(hub);
    ROOM_FACE_NAMES.forEach((n) => {
      if (flat[n]) return;
      let parent = ROOM_FAR_PARENT[hub] || 'back';
      if (radiateDir) {
        let best = null, bestDot = 0.001;
        ROOM_FACE_NAMES.forEach((m) => {
          if (m === hub || m === n || !sharedEdge(m, hub)) return;
          let d = v3dot(v3sub(centreOf(m), hubC), radiateDir);
          if (d > bestDot) { bestDot = d; best = m; }
        });
        if (best && sharedEdge(n, best)) parent = best;
      }
      attach(n, parent);
    });
  }

  // Perspective: eye in front of the opening; opening fitted to the window.
  let s = Math.min(width / W, height / H);
  let ox = (width - W * s) / 2, oy = (height - H * s) / 2;
  let eye = eyeFor(mp); // v40.2: from the mapping (v40.17: or the scene's shared one)
  let ex = -W / 2 + eye[0] * W, ey = H * (1 - eye[1]);
  let project = (p) => {
    let t = ROOM_EYE_DIST_M / (p[2] + ROOM_EYE_DIST_M);
    return [ox + (ex + (p[0] - ex) * t + W / 2) * s, oy + (H - (ey + (p[1] - ey) * t)) * s];
  };

  let faces = ROOM_FACE_NAMES.map((n) => {
    let fc = corners[n].map((p) => ({ p, s: flat[n](p) }));
    let xs = fc.map((c) => c.s[0]), ys = fc.map((c) => c.s[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let at = (x, y) => fc.reduce((best, c) => {
      let d = Math.hypot(c.s[0] - x, c.s[1] - y);
      return d < best.d ? { d, p: c.p } : best;
    }, { d: Infinity }).p;
    let c00 = at(x0, y0), ux = v3sub(at(x1, y0), c00), uy = v3sub(at(x0, y1), c00);
    let walls = mp.walls || {}, rev = mp.reversed || {};
    let f = { name: n, on: walls[n] !== false, reversed: rev[n] === true, x0, x1, y0, y1 };
    // v40.4: a REVERSED surface is mirrored along the flow (top <-> bottom
    // of its sheet rectangle): its columns still meet the neighbours'
    // columns, but it flows the other way, so its joins become seams.
    f.to3d = f.reversed
      ? (sx, sy) => v3add(v3add(c00, v3mul(ux, (sx - x0) / (x1 - x0))), v3mul(uy, (y1 - sy) / (y1 - y0)))
      : (sx, sy) => v3add(v3add(c00, v3mul(ux, (sx - x0) / (x1 - x0))), v3mul(uy, (sy - y0) / (y1 - y0)));
    // v40.20: the same as project(f.to3d(sx, sy)), worked out with plain
    // numbers (no in-between lists), as it runs for every screen corner.
    {
      let kx = 1 / (x1 - x0), ky = (f.reversed ? -1 : 1) / (y1 - y0), yRef = f.reversed ? y1 : y0;
      let ax = ux[0] * kx, ay = ux[1] * kx, az = ux[2] * kx;
      let bx = uy[0] * ky, by = uy[1] * ky, bz = uy[2] * ky;
      let cx = c00[0], cy = c00[1], cz = c00[2], D = ROOM_EYE_DIST_M;
      f.proj = (sx, sy) => {
        let dx = sx - x0, dy = sy - yRef;
        let X = cx + ax * dx + bx * dy, Y = cy + ay * dx + by * dy, Z = cz + az * dx + bz * dy;
        let t = D / (Z + D);
        return [ox + (ex + (X - ex) * t + W / 2) * s, oy + (H - (ey + (Y - ey) * t)) * s];
      };
      f.pk = [x0, yRef, cx, cy, cz, ax, ay, az, bx, by, bz]; // v42.4: the same formula's numbers, for the graphics chip (08_webgl)
    }
    f.screen = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => f.proj(x, y));
    // v40.4: which way the screens on this surface really move (room
    // directions), with the mapping's Direction and this surface's Reverse.
    let mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    f.flowDir = v3mul(v3norm(v3sub(f.to3d(mx, my - 1), f.to3d(mx, my))), mp.flow === 'down' ? -1 : 1);
    return f;
  });
  let hubFace = faces.find((f) => f.name === hub);
  let on = faces.filter((f) => f.on);
  let span = on.length ? on : faces;
  return {
    faces, on, k,
    hubRect: { x: hubFace.x0, y: hubFace.y0, w: hubFace.x1 - hubFace.x0, h: hubFace.y1 - hubFace.y0 },
    range: {
      x0: Math.min(...span.map((f) => f.x0)), x1: Math.max(...span.map((f) => f.x1)),
      y0: Math.min(...span.map((f) => f.y0)), y1: Math.max(...span.map((f) => f.y1)),
    },
    opening: { ox, oy, w: W * s, h: H * s },
    project, cam: { ox, oy, s, ex, ey, W, H, D }, // v40.3: for the scale figure
    eyeScreen: [ox + (ex + W / 2) * s, oy + (H - ey) * s],
  };
}

// v40.5: keeps the last few built rooms, so a fade between two mappings
// (both drawn every frame) doesn't rebuild them each time.
let roomGeomCache = new Map();
function roomUpdateGeometry() {
  let sig = JSON.stringify({ ...room, figure: 0 }) + '|' + JSON.stringify(frameMapping) + '|' + JSON.stringify(eyeFor(frameMapping)) + '|' + width + 'x' + height; // v40.17: + the viewpoint actually used (may be the scene's shared one); v40.1/2: + the mapping (v40.3: the figure doesn't change the room)
  if (sig === roomGeomSig) return;
  roomGeomSig = sig;
  let g = roomGeomCache.get(sig);
  if (!g) {
    g = roomBuildGeometry();
    if (roomGeomCache.size >= 4) roomGeomCache.delete(roomGeomCache.keys().next().value);
    roomGeomCache.set(sig, g);
  }
  roomGeom = g;
}

// v39.2: roughly how many screens the shown surfaces need right now.
function roomScreenEstimate() {
  let n = 0;
  for (let f of roomGeom.on) {
    n += (Math.ceil((f.x1 - f.x0) / columnWidth) + 1) * (Math.ceil((f.y1 - f.y0) / unitHeight) + 1);
  }
  return n;
}

// ---------------------- v42.6: SCREEN LIMIT ----------------------
// How many screens may be drawn is MEASURED on this computer instead of a
// fixed 5,000: the screens' own drawing time per screen (µs; with WebGL
// without glEnd — the chip's drawing and the paste depend on pixels, which
// Auto sharpness / smoothing look after — from frames
// with at least SCREEN_LIMIT_LEARN_N screens), and the limit = what fits
// in SCREEN_LIMIT_MS per frame. Measured separately per renderer and view
// (WebGL / Canvas × Flat / Room × Radiate off / ✕ ✚): e.g. 'webgl room ✕'.
// Never below ROOM_SCREEN_BUDGET (5,000, proven), never above
// SCREEN_LIMIT_MAX. Rises as soon as a 2 s window measures faster; falls
// only after SCREEN_LIMIT_DOWN_WINDOWS windows in a row (~30 s) that are
// clearly slower AND missed frames (SCREEN_LIMIT_MISSED_SHARE), with the
// canvas sharpness unchanged, so a hiccup never blanks the room.
// v43.0.1: the Intel report showed the ✕ limit dropping for 2 s twice
// (9,500 → 6,600, 10,600 → 7,000) while Auto sharpness had gone up to
// full: the chip and the processor share power there, so heavy pixels
// make the screens' work slower too — but Auto sharpness fixes that within
// seconds. Now a window at a steady frame rate breaks the row, and any
// sharpness change starts it again. Remembered in this browser
// (SCREEN_LIMIT_KEY), never in show files. 🖥 Display → Screen limit Off
// draws everything however slowly (not saved); video export ignores it.
const SCREEN_LIMIT_MS = 10;              // screens' share of a 60 Hz frame (16.7 ms)
const SCREEN_LIMIT_MAX = 60000;
const SCREEN_LIMIT_LEARN_N = 1000;       // fewer screens: fixed costs would distort the figure
const SCREEN_LIMIT_WINDOW_MS = 2000;
const SCREEN_LIMIT_DOWN_WINDOWS = 15;    // v43.0.1: was 5 (~10 s)
const SCREEN_LIMIT_MISSED_SHARE = 0.05;  // v43.0.1: a slow window counts only if ≥ 5 % of refreshes were missed
const SCREEN_LIMIT_SLOWER = 1.15;        // "clearly slower": 15 % more per screen
const SCREEN_LIMIT_KEY = 'endlessArchitecture.screenLimit.v1';
let screenLimitOn = true;                // 🖥 Display → Screen limit [Auto] [Off]
let screenLimitState = { us: null, acc: {}, t0: 0, slow: {}, frame: -1, frames: 0, missed: 0, canvasW: 0 }; // us: mode → µs per screen (v43.0.1: + this window's frames / missed refreshes, the canvas width)
let screenLimitHints = [];               // Layout menus' "smallest Scale" lines
function screenLimitMode(mp) {
  let r = mp && mp.radiate && mp.radiate !== 'off' ? ' ' + (mp.radiate === 'x' ? '✕' : '✚') : '';
  return rendererText() + ' ' + (roomView ? 'room' : 'flat') + r;
}
function screenLimitUs() {
  let S = screenLimitState;
  if (!S.us) {
    S.us = {};
    try { let v = JSON.parse(localStorage.getItem(SCREEN_LIMIT_KEY) || '{}'); if (v && typeof v === 'object') S.us = v; } catch (e) {}
  }
  return S.us;
}
function screenLimitFor(mode) {
  let us = screenLimitUs()[mode];
  if (!(us > 0)) return ROOM_SCREEN_BUDGET;
  return Math.max(ROOM_SCREEN_BUDGET, Math.min(SCREEN_LIMIT_MAX, Math.floor(SCREEN_LIMIT_MS * 1000 / us / 100) * 100));
}
// One pass's screens: how many, how long. Judged per 2 s window.
function screenLimitRecord(mode, n, ms, now) {
  let S = screenLimitState;
  if (S.frame !== frameCount) { // v43.0.1: once per frame (a mapping fade has two passes)
    S.frame = frameCount; S.frames++;
    let period = 1000 / Math.max(displayInfo.nominalHz || 60, 1);
    if (deltaTime > 0 && deltaTime < 1000) S.missed += Math.max(0, Math.round(deltaTime / period) - 1);
  }
  if (n >= SCREEN_LIMIT_LEARN_N) {
    let a = S.acc[mode] || (S.acc[mode] = { n: 0, ms: 0 });
    a.n += n; a.ms += ms;
  }
  if (!S.t0) S.t0 = now;
  if (now - S.t0 < SCREEN_LIMIT_WINDOW_MS) return;
  S.t0 = now;
  let us = screenLimitUs(), changed = false;
  let struggling = S.frames > 0 && S.missed / (S.frames + S.missed) >= SCREEN_LIMIT_MISSED_SHARE; // v43.0.1
  let cw = drawingContext.canvas.width;
  if (cw !== S.canvasW) { S.canvasW = cw; S.slow = {}; } // v43.0.1: sharpness changed: Auto sharpness goes first
  S.frames = S.missed = 0;
  Object.keys(S.acc).forEach((m) => {
    let a = S.acc[m], est = a.ms * 1000 / a.n, cur = us[m], before = screenLimitFor(m);
    if (!(cur > 0) || est < cur) { us[m] = est; S.slow[m] = null; }           // faster: the limit rises now
    else if (est > cur * SCREEN_LIMIT_SLOWER && struggling) {                  // slower and missing frames: only after ~30 s of it
      let sl = S.slow[m] || (S.slow[m] = []);
      sl.push(est);
      if (sl.length >= SCREEN_LIMIT_DOWN_WINDOWS) { us[m] = sl.slice().sort((x, y) => x - y)[sl.length >> 1]; S.slow[m] = null; } // the middle one: a window from before the slow-down doesn't count
    } else S.slow[m] = null;
    let after = screenLimitFor(m);
    if (after !== before) {
      changed = true;
      if (typeof diagEvent === 'function' && (after > before * 1.1 || after < before)) diagEvent('screen limit ' + m + ': ' + before.toLocaleString() + ' → ' + after.toLocaleString() + ' (' + us[m].toFixed(2) + ' µs/screen)');
    }
  });
  S.acc = {};
  if (changed) {
    try { localStorage.setItem(SCREEN_LIMIT_KEY, JSON.stringify(us)); } catch (e) {}
    setTimeout(() => { if (displayMenu) displayMenu.refresh(); }, 0); // the Auto button shows the limit
  }
}
function setScreenLimitOn(on) {
  screenLimitOn = !!on;
  if (typeof diagEvent === 'function') diagEvent('screen limit → ' + (screenLimitOn ? 'auto' : 'off'));
  if (displayMenu) displayMenu.refresh();
}
function screenLimitText() {
  let m = screenLimitMode(frameMapping), us = screenLimitUs()[m];
  if (!screenLimitOn) return 'off';
  return 'auto ' + screenLimitFor(m).toLocaleString() + ' (' + (us > 0 ? us.toFixed(2) + ' µs/screen' : 'not measured yet') + ', ' + m + ')';
}
// Roughly how many screens this view needs (Room: the shown surfaces;
// Flat: the window, ✕ / ✚ about the same).
function screenEstimate() {
  if (roomView) return roomScreenEstimate();
  return (Math.ceil(width / columnWidth) + 3) * (Math.ceil(height / unitHeight) + 3);
}
// The smallest Scale a Layout set can have here (screens ≈ area / one
// screen's cell, and a cell grows with Scale²). 0 = no limit.
function smallestScaleFor(setObj) {
  if (!screenLimitOn || typeof width === 'undefined') return 0;
  let area = 0;
  if (roomView && roomGeom) { for (const f of roomGeom.on) { area += (f.x1 - f.x0) * (f.y1 - f.y0); } }
  else area = width * height;
  let sp = (setObj.spacing || 0) / 100;
  let cell = (1 + sp) * (aspectRatio + sp); // × Scale²
  return Math.sqrt(area / (screenLimitFor(screenLimitMode(frameMapping)) * cell));
}
// v42.6: the line under a Layout set's Scale slider, kept up to date.
function addScreenLimitHint(el, setObj) {
  screenLimitHints.push({ el, setObj });
  if (screenLimitHints.length === 1) setInterval(refreshScreenLimitHints, 1000);
  refreshScreenLimitHints();
}
function refreshScreenLimitHints() {
  let m = screenLimitMode(frameMapping) + screenLimitFor(screenLimitMode(frameMapping));
  if (m !== screenLimitState.shown) { screenLimitState.shown = m; if (displayMenu) displayMenu.refresh(); } // the Auto button follows the view
  screenLimitHints = screenLimitHints.filter((h) => h.el.isConnected || !h.el.dataset.placed);
  for (const h of screenLimitHints) {
    h.el.dataset.placed = h.el.isConnected ? '1' : '';
    if (!screenLimitOn) { h.el.textContent = 'Screen limit off (🖥 Display)'; h.el.style.color = '#888'; continue; }
    let s = smallestScaleFor(h.setObj);
    if (!(s > 0)) { h.el.textContent = ''; continue; }
    let lim = screenLimitFor(screenLimitMode(frameMapping));
    h.el.textContent = 'Smallest Scale here: about ' + Math.ceil(s) + ' (limit ' + lim.toLocaleString() + ' screens)';
    h.el.style.color = h.setObj.scale < s ? FLASH_ORANGE : '#888';
  }
}

// v39.2: shown instead of the screens when the budget is exceeded.
function drawCanvasNote(msg, y) {
  textFont('sans-serif');
  textSize(15);
  textAlign(CENTER, CENTER);
  let w = textWidth(msg) + 32;
  fill(0, 200);
  rect(width / 2 - w / 2, y - 20, w, 40, 6);
  fill(255);
  text(msg, width / 2, y);
}

// Where the grid is anchored / zoomed (the centre surface in Room view)…
function gridViewRect() {
  return roomView ? roomGeom.hubRect : { x: 0, y: 0, w: width, h: height };
}
// …and the sheet area that needs drawing (every shown surface).
function gridDrawRange() {
  if (radiatePass) return radiatePass.gridRange; // v40.7
  return roomView ? roomGeom.range : { x0: 0, x1: width, y0: 0, y1: height };
}

function drawRoomBackground() {
  background(0);
  roomGeom.faces.forEach((f) => {
    let q = f.screen;
    if (f.on) { fill(colBg); stroke(colBg); } else { fill(0); stroke(255, 45); }
    strokeWeight(1);
    quad(q[0][0], q[0][1], q[1][0], q[1][1], q[2][0], q[2][1], q[3][0], q[3][1]);
  });
  noStroke();
}

function migrateRoomData(r) {
  r = (r && typeof r === 'object') ? r : {};
  let d = ROOM_DEFAULTS;
  let num = (v, [lo, hi], def) => Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : def;
  return {
    w: num(r.w, ROOM_SIZE_RANGE.w, d.w), h: num(r.h, ROOM_SIZE_RANGE.h, d.h), d: num(r.d, ROOM_SIZE_RANGE.d, d.d),
    // v40.1/2/4: `hub`, `eye` and `walls` moved to the scenes' Mappings (see migrateShowData())
    figure: migrateFigureData(r.figure), // v40.3
  };
}

// ---------------------- v40.3: SCALE FIGURE ----------------------
// A simple 3D person, FIGURE_HEIGHT_M tall (average height in Spain),
// standing on the floor to show the size of the room. Room view only,
// showcase only (never part of the artwork). Built from "bones" in metres
// (x right, y up, z toward the back wall), drawn with the room's own
// perspective as round tubes with a chrome look: each tube has a sideways
// gradient (highlight on the left, dark core, and a right-hand rim in the
// screens' current colours — a cheap "reflection" of the walls).
const FIGURE_HEIGHT_M = 1.76;
const FIGURE_MARGIN_M = 0.25; // keeps the person off the walls
let figureMoving = false;     // drag handle shown
let figureMarker = null;

function migrateFigureData(f) {
  f = (f && typeof f === 'object') ? f : {};
  let frac = (v) => Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0.5;
  return {
    on: f.on !== false,
    fx: frac(f.fx), fz: frac(f.fz),
    color: migrateRgb(f.color, [225, 228, 235]),
    // v40.9: 0 = chrome … 1 = solid (v40.6 saved true / false)
    solid: f.solid === true ? 1 : Number.isFinite(f.solid) ? Math.min(Math.max(f.solid, 0), 1) : 0,
  };
}

// Where the feet stand, in room metres (kept inside the floor).
function figureFeet() {
  let g = roomGeom.cam, m = FIGURE_MARGIN_M;
  let x = -g.W / 2 + Math.min(Math.max(room.figure.fx * g.W, m), Math.max(g.W - m, m));
  let z = Math.min(Math.max(room.figure.fz * g.D, m), Math.max(g.D - m, m));
  return [x, 0, z];
}

// v40.4: the person is a real 3D model — \"Free Pack - Stick Man
// (Rigged)\" by PolyOne Studio (https://sketchfab.com/polyone), licensed
// CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Changes: arms
// posed down (7° out from the body, from its T-pose, using its own
// skeleton), scaled to FIGURE_HEIGHT_M, simplified from 1,984 to 792
// triangles (looks the same at this size), and stored as plain triangles in
// FIGURE_MESH_B64 at the very end of this file (no 3D engine needed).
// Layout of the data: FIGURE_MESH_COUNTS[0] points as 3 × int16 (mm),
// the same points' normals as 3 × int8, then FIGURE_MESH_COUNTS[1]
// triangles as 3 × uint16. x right, y up (feet at 0), z into the room.
const FIGURE_MESH_COUNTS = [398, 792];
let figureMesh = null;
function figureMeshData() {
  if (figureMesh) return figureMesh;
  let bin = atob(FIGURE_MESH_B64);
  let bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let [nV, nT] = FIGURE_MESH_COUNTS;
  let dv = new DataView(bytes.buffer);
  let pos = new Float32Array(nV * 3), nrm = new Float32Array(nV * 3), idx = new Uint16Array(nT * 3);
  for (let i = 0; i < nV * 3; i++) pos[i] = dv.getInt16(i * 2, true) / 1000;
  for (let i = 0; i < nV * 3; i++) nrm[i] = dv.getInt8(nV * 6 + i) / 127;
  for (let i = 0; i < nT * 3; i++) idx[i] = dv.getUint16(nV * 9 + i * 2, true);
  // The mesh never changes shape, so each triangle's centre and (smooth)
  // normal are worked out once here.
  let cen = new Float32Array(nT * 3), tn = new Float32Array(nT * 3);
  for (let k = 0; k < nT; k++) {
    for (let j = 0; j < 3; j++) {
      let a = idx[k * 3], b = idx[k * 3 + 1], d = idx[k * 3 + 2];
      cen[k * 3 + j] = (pos[a * 3 + j] + pos[b * 3 + j] + pos[d * 3 + j]) / 3;
      tn[k * 3 + j] = nrm[a * 3 + j] + nrm[b * 3 + j] + nrm[d * 3 + j];
    }
    let l = Math.hypot(tn[k * 3], tn[k * 3 + 1], tn[k * 3 + 2]) || 1;
    tn[k * 3] /= l; tn[k * 3 + 1] /= l; tn[k * 3 + 2] /= l;
  }
  figureMesh = {
    nV, nT, pos, idx, cen, tn,
    sx: new Float32Array(nV), sy: new Float32Array(nV),
    depth: new Float32Array(nT), color: new Array(nT), order: [], colorText: new Map(),
  };
  return figureMesh;
}

// v40.14: draws the person onto `ctx` (the person's own cached layer —
// see drawScaleFigureCached()) and records the area it covers in
// figureDrawnBox (canvas units), so only that rectangle is pasted.
let figureDrawnBox = null;
// v41.3: FLAT VIEW — the person is seen straight from the front (no
// perspective) at true scale (the picture's width = ROOM_REF_WIDTH_M,
// the same metres as Room view), standing on the bottom edge, placed
// across by its floor position (fx). No floor shadow (seen edge-on).
function figureFlatPlacement() {
  let k = width / ROOM_REF_WIDTH_M; // px per metre
  let m = FIGURE_MARGIN_M * k;
  let fx = Math.min(Math.max(room.figure.fx * width, m), Math.max(width - m, m));
  return { k, fx, gy: height };
}
function drawScaleFigure(ctx) {
  if (!room.figure.on) return;
  let flatView = !roomView; // v41.3
  if (!flatView && !roomGeom) return;
  let g = roomGeom, c = flatView ? null : g.cam, feet = flatView ? [0, 0, 0] : figureFeet();
  let fp = flatView ? figureFlatPlacement() : null;
  let m = figureMeshData();
  ctx = ctx || drawingContext;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  let grow = (x, y) => { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; };
  let eX = flatView ? 0 : c.ex, eY = flatView ? 0 : c.ey, eZ = -ROOM_EYE_DIST_M;

  // Soft contact shadow on the floor (light from the front left).
  let shadow = (rx, rz, dx, dz, alpha) => { // v40.14: straight onto ctx
    ctx.fillStyle = 'rgba(0,0,0,' + (alpha / 255) + ')';
    ctx.beginPath();
    for (let i = 0; i < 28; i++) {
      let a = i / 28 * Math.PI * 2;
      let q = g.project([feet[0] + dx + Math.cos(a) * rx, 0, feet[2] + dz + Math.sin(a) * rz]);
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      grow(q[0], q[1]);
    }
    ctx.closePath();
    ctx.fill();
  };
  if (!flatView) { // v41.3: no floor shadow in the flat front view
    shadow(0.42, 0.3, 0.08, 0.12, 35);
    shadow(0.28, 0.18, 0.04, 0.06, 60);
  }

  // What each direction of the room \"shows\" for the chrome to reflect:
  // walls get the screens' colours (softened by the background), hidden
  // surfaces are dark, and behind the viewer is a soft mix of the room.
  // A vibe, not real reflections.
  let pal = palette.map((p) => [red(p), green(p), blue(p)]);
  let pc = (i) => pal.length ? pal[i % pal.length] : [128, 128, 128];
  let bg = [red(colBg), green(colBg), blue(colBg)];
  let walls = frameMapping.walls || {};
  let shown = (f, col) => walls[f] === false ? [8, 8, 8] : [0, 1, 2].map((i) => col[i] * 0.7 + bg[i] * 0.3);
  let R = shown('right', pc(2)), Lw = shown('left', pc(1)), U = shown('ceiling', pc(0));
  let D = shown('floor', pc(3)), B = shown('back', pc(4));
  let Fr = [0, 1, 2].map((i) => (R[i] + Lw[i] + U[i] + D[i] + B[i]) / 5 * 0.6 + 25); // behind the viewer: a soft mix of the room
  let base = room.figure.color;
  let b0 = Math.min(base[0] * 0.96, 255), b1 = Math.min(base[1] * 0.96, 255), b2 = Math.min(base[2] * 0.96, 255); // the metal's own tint (v40.5: 20% lighter)
  // v40.8: the highlight SHIMMERS — see updateFigureShine().
  let shine = updateFigureShine(sketchNow(), pal); // v43.0: the artwork clock (was the real one)
  let h0 = shine.col[0], h1 = shine.col[1], h2 = shine.col[2]; // the highlight blends TOWARD this, so it never burns out to white
  let fl = shine.flash, fx = shine.dir[0], fy = shine.dir[1], fz = shine.dir[2];
  let sc0 = red(colScroll), sc1 = green(colScroll), sc2 = blue(colScroll);
  let lx = -0.45, ly = 0.75, lz = -0.48, ll = Math.hypot(lx, ly, lz); // towards the light
  lx /= ll; ly /= ll; lz /= ll;

  // Project every point once.
  let { pos, idx, cen, tn, sx, sy, depth, color, order, colorText } = m;
  if (flatView) { // v41.3: straight front view
    for (let i = 0; i < m.nV; i++) {
      sx[i] = fp.fx + pos[i * 3] * fp.k;
      sy[i] = fp.gy - pos[i * 3 + 1] * fp.k;
      grow(sx[i], sy[i]);
    }
  } else {
    let px = c.s;
    for (let i = 0; i < m.nV; i++) {
      let x = feet[0] + pos[i * 3], y = pos[i * 3 + 1], z = feet[2] + pos[i * 3 + 2];
      let t = ROOM_EYE_DIST_M / (z + ROOM_EYE_DIST_M);
      sx[i] = c.ox + (c.ex + (x - c.ex) * t + c.W / 2) * px;
      sy[i] = c.oy + (c.H - (c.ey + (y - c.ey) * t)) * px;
      grow(sx[i], sy[i]);
    }
  }
  figureDrawnBox = { x0: bx0, y0: by0, x1: bx1, y1: by1 };

  // Shade the triangles that face us.
  order.length = 0;
  let sumR = 0, sumG = 0, sumB = 0;
  let solidAmt = room.figure.solid || 0; // v40.9
  for (let k = 0; k < m.nT; k++) {
    let vx, vy, vz, vl;
    if (flatView) { vx = 0; vy = 0; vz = 1; vl = 100 - cen[k * 3 + 2]; } // v41.3: looking straight in; nearer = smaller z
    else {
      vx = feet[0] + cen[k * 3] - eX; vy = cen[k * 3 + 1] - eY; vz = feet[2] + cen[k * 3 + 2] - eZ;
      vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
      vx /= vl; vy /= vl; vz /= vl;
    }
    let nx = tn[k * 3], ny = tn[k * 3 + 1], nz = tn[k * 3 + 2];
    let nv = nx * vx + ny * vy + nz * vz;
    if (nv > 0.2) continue; // turned away: hidden behind the front
    if (nv > 0) { nx = -nx; ny = -ny; nz = -nz; nv = -nv; }
    // the view direction bounced off the surface -> which part of the room it \"sees\"
    let rx = vx - 2 * nv * nx, ry = vy - 2 * nv * ny, rz = vz - 2 * nv * nz;
    let wR = rx > 0 ? rx : 0, wL = rx < 0 ? -rx : 0, wU = ry > 0 ? ry : 0, wD = ry < 0 ? -ry : 0, wB = rz > 0 ? rz : 0, wF = rz < 0 ? -rz : 0;
    let ws = (wR + wL + wU + wD + wB + wF) || 1;
    let edge = 1 + nv;               // 0 facing us, 1 at the outline: edges reflect more
    let rw = Math.min(0.54 + 0.48 * edge, 0.95); // v40.5: 20% more reflective
    let refl = rw / ws;
    let keep = 1 - rw;
    let sp = rx * lx + ry * ly + rz * lz;
    sp = sp > 0 ? Math.min(Math.pow(sp, 12) + 0.35 * Math.pow(sp, 4), 0.9) : 0; // the highlight + a soft glow around it (v40.6: blended in, max 90%)
    let lit = 0.8 + 0.3 * Math.max(nx * lx + ny * ly + nz * lz, 0);
    let r = Math.min((b0 * keep + (R[0] * wR + Lw[0] * wL + U[0] * wU + D[0] * wD + B[0] * wB + Fr[0] * wF) * refl) * lit, 255) * (1 - sp) + h0 * sp;
    let gg = Math.min((b1 * keep + (R[1] * wR + Lw[1] * wL + U[1] * wU + D[1] * wD + B[1] * wB + Fr[1] * wF) * refl) * lit, 255) * (1 - sp) + h1 * sp;
    let bb = Math.min((b2 * keep + (R[2] * wR + Lw[2] * wL + U[2] * wU + D[2] * wD + B[2] * wB + Fr[2] * wF) * refl) * lit, 255) * (1 - sp) + h2 * sp;
    if (fl > 0) { // v40.8: a flash in the scroll bar's colour, lit from the left wall or the ceiling
      let f = rx * fx + ry * fy + rz * fz;
      f = f > 0 ? Math.min(Math.pow(f, 6) * fl, 0.9) : 0;
      r = r * (1 - f) + sc0 * f; gg = gg * (1 - f) + sc1 * f; bb = bb * (1 - f) + sc2 * f;
    }
    if (solidAmt > 0) { // v40.9: part-way to one flat colour
      r += (base[0] - r) * solidAmt; gg += (base[1] - gg) * solidAmt; bb += (base[2] - bb) * solidAmt;
    }
    // colours rounded to steps of 4, and their text cached (setting a canvas
    // colour from text is the slow part)
    let key = ((Math.min(r, 255) >> 2) << 12) | ((Math.min(gg, 255) >> 2) << 6) | (Math.min(bb, 255) >> 2);
    let txt = colorText.get(key);
    if (!txt) {
      txt = 'rgb(' + ((key >> 12) << 2) + ',' + (((key >> 6) & 63) << 2) + ',' + ((key & 63) << 2) + ')';
      if (colorText.size > 4000) colorText.clear();
      colorText.set(key, txt);
    }
    depth[k] = vl;
    color[k] = txt;
    order.push(k);
    sumR += Math.min(r, 255); sumG += Math.min(gg, 255); sumB += Math.min(bb, 255); // v40.6: for the underlay
  }
  order.sort((p, q) => depth[q] - depth[p]); // far first

  ctx.save();
  if (room.figure.solid >= 1) {
    // v40.6: SOLID — one flat colour, the whole visible body in one go
    // (no shading, no reflections; the floor shadow stays).
    ctx.fillStyle = 'rgb(' + base.map(Math.round).join(',') + ')';
    ctx.beginPath();
    for (let k of order) {
      let a = idx[k * 3], b = idx[k * 3 + 1], d = idx[k * 3 + 2];
      ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[d], sy[d]); ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
    return;
  }
  // v40.6: an underlay of the whole body in its own AVERAGE colour, drawn
  // in one go: where neighbouring triangles leave a hairline gap, the
  // gap shows nearly the same colour (v40.4 used a dark underlay, which
  // showed as thin lines; v40.5 grew each triangle, which made the
  // outline spiky).
  ctx.fillStyle = 'rgb(' + Math.round(sumR / Math.max(order.length, 1)) + ',' + Math.round(sumG / Math.max(order.length, 1)) + ',' + Math.round(sumB / Math.max(order.length, 1)) + ')';
  ctx.beginPath();
  for (let k of order) {
    let a = idx[k * 3], b = idx[k * 3 + 1], d = idx[k * 3 + 2];
    ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[d], sy[d]); ctx.closePath();
  }
  ctx.fill();
  for (let k of order) {
    let a = idx[k * 3], b = idx[k * 3 + 1], d = idx[k * 3 + 2];
    ctx.fillStyle = color[k];
    ctx.beginPath();
    ctx.moveTo(sx[a], sy[a]); ctx.lineTo(sx[b], sy[b]); ctx.lineTo(sx[d], sy[d]); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// v40.14: the person is drawn onto its own hidden layer and only pasted
// onto the picture each frame (just the rectangle around it). It's
// redrawn right away when anything that MOVES it changes (viewpoint, room,
// position, size of the picture, shown surfaces, its settings), and
// otherwise at most FIGURE_REDRAW_HZ times a second for the shimmer and
// the room colours it reflects. Before, all ~800 triangles were shaded and
// drawn every frame (about a quarter of the dropped frames at small
// Scale). Up to 2 layers are kept, so a mapping fade (two mappings drawn
// per frame) doesn't force a redraw every frame.
const FIGURE_REDRAW_HZ = 20;
let figureLayers = []; // { key, canvas, lastMs, box (device px) }
function drawScaleFigureCached() {
  if (!room.figure.on || (roomView && !roomGeom)) return; // v41.3: Flat too
  let R = p5Renderer();
  let main = R ? R.drawingContext : drawingContext;
  let cv = main.canvas, tf = main.getTransform();
  let c = roomView ? roomGeom.cam : { ox: 'flat', oy: width, s: height, ex: 0, ey: 0, W: 0, H: 0, D: 0 };
  let key = [c.ox, c.oy, c.s, c.ex, c.ey, c.W, c.H, c.D, cv.width, cv.height, tf.a, tf.d, tf.e, tf.f,
    JSON.stringify(room.figure), JSON.stringify((frameMapping && frameMapping.walls) || {})].join('|');
  let L = figureLayers.find((e) => e.key === key);
  // v43.0: the redraw rhythm runs on ARTWORK time, so after a pause the
  // shimmer's random picks land on the same frames as without one. While
  // paused it redraws on real time (colour edits show on the person) with
  // the shimmer held (updateFigureShine).
  let now = sketchNow(), real = millis(), paused = artworkPaused(); // v43.1: an export moves even when paused
  if (!L) {
    L = figureLayers.length >= 2 ? figureLayers.shift() : { canvas: document.createElement('canvas') };
    L.key = key; L.lastMs = -1e9; L.lastReal = -1e9; L.box = null;
    figureLayers.push(L);
  }
  let due = exportState.on || (paused ? real - L.lastReal >= 1000 / FIGURE_REDRAW_HZ || real < L.lastReal
    : now - L.lastMs >= 1000 / FIGURE_REDRAW_HZ || now < L.lastMs); // v43.1: export redraws every frame
  if (due) {
    let lc = L.canvas;
    if (lc.width !== cv.width || lc.height !== cv.height) { lc.width = cv.width; lc.height = cv.height; }
    let ctx = lc.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, lc.width, lc.height);
    ctx.setTransform(tf);
    figureDrawnBox = null;
    drawScaleFigure(ctx);
    if (!paused) L.lastMs = now; // v43.0
    L.lastReal = real;
    let b = figureDrawnBox;
    if (b && isFinite(b.x0) && isFinite(b.y0) && isFinite(b.x1) && isFinite(b.y1)) {
      let xs = [b.x0, b.x1], ys = [b.y0, b.y1], x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      xs.forEach((x) => ys.forEach((y) => {
        let dx = tf.a * x + tf.c * y + tf.e, dy = tf.b * x + tf.d * y + tf.f;
        x0 = Math.min(x0, dx); x1 = Math.max(x1, dx); y0 = Math.min(y0, dy); y1 = Math.max(y1, dy);
      }));
      x0 = Math.max(0, Math.floor(x0) - 3); y0 = Math.max(0, Math.floor(y0) - 3);
      x1 = Math.min(cv.width, Math.ceil(x1) + 3); y1 = Math.min(cv.height, Math.ceil(y1) + 3);
      L.box = (x1 > x0 && y1 > y0) ? { x0, y0, w: x1 - x0, h: y1 - y0 } : null;
    } else L.box = null;
  }
  if (!L.box) return;
  let B = L.box;
  main.save();
  main.setTransform(1, 0, 0, 1, 0, 0);
  main.drawImage(L.canvas, B.x0, B.y0, B.w, B.h, B.x0, B.y0, B.w, B.h);
  main.restore();
}

// v40.8: the highlight's SHIMMER. It drifts between the palette's colours
// (each shown at full brightness, like a light), changing at random moments
// between the screens' shortest and longest wait (Scroll timing). Each
// change eases over FIGURE_SHINE_EASE_MS. Now and then (FIGURE_FLASH_CHANCE
// per change) it also flashes the scroll bar's colour, lit from the left
// wall or the ceiling, rising and falling over FIGURE_FLASH_MS.
const FIGURE_SHINE_EASE_MS = 350;
const FIGURE_FLASH_MS = 420;
const FIGURE_FLASH_CHANCE = 0.3;
// v40.9: remembers WHICH palette colour it picked (an index), read live
// every frame, so it follows the room when the colours change.
let figureShine = { fromIdx: 0, toIdx: 0, startMs: 0, nextMs: 0, flashStart: -1e9, flashDir: [-1, 0, 0], k: 0, ft: -1 }; // v43.0: k, ft = last blend / flash phase (held while paused)
function updateFigureShine(now, pal) {
  let st = figureShine;
  if (!pal.length) return { col: [255, 255, 255], flash: 0, dir: st.flashDir };
  let ease = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
  let bright = (i) => { let q = pal[i % pal.length], m = Math.max(q[0], q[1], q[2], 1); return q.map((v) => v * 255 / m); }; // full brightness: reads as light
  let paused = artworkPaused(); // v43.0 (v43.1: not while exporting): paused = the last shimmer, held; no new random picks
  let k = paused ? st.k : ease((now - st.startMs) / FIGURE_SHINE_EASE_MS);
  if (!paused && now >= st.nextMs) {
    st.fromIdx = k >= 0.5 ? st.toIdx : st.fromIdx; // whichever it mostly showed
    st.toIdx = Math.floor(Math.random() * pal.length);
    st.startMs = now;
    k = 0;
    let lo = Math.min(minWaitTime, maxWaitTime), hi = Math.max(minWaitTime, maxWaitTime);
    st.nextMs = now + lo + Math.random() * (hi - lo);
    if (Math.random() < FIGURE_FLASH_CHANCE) {
      st.flashStart = now;
      // light from the left wall or the ceiling (towards the light, room directions)
      let d = Math.random() < 0.5 ? [-1, 0.25, -0.35] : [-0.15, 1, -0.35];
      let l = Math.hypot(d[0], d[1], d[2]);
      st.flashDir = d.map((v) => v / l);
    }
  }
  let a = bright(st.fromIdx), b = bright(st.toIdx);
  let col = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  let ft = paused ? st.ft : (now - st.flashStart) / FIGURE_FLASH_MS;
  st.k = k; st.ft = ft;
  return { col, flash: ft >= 0 && ft <= 1 ? Math.sin(Math.PI * ft) : 0, dir: st.flashDir };
}

// v40.3: the drag handle at the person's feet ("🧍 Move person"). Maps
// the pointer back onto the floor (y = 0) through the room's perspective.
function createFigureMarker() {
  let m = document.createElement('div');
  m.textContent = '✥';
  m.title = 'Drag to move the person around the floor';
  Object.assign(m.style, {
    position: 'fixed', zIndex: 1060, width: '30px', height: '30px', borderRadius: '50%',
    display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#fff',
    background: 'rgba(0,0,0,0.6)', border: '2px solid #8fc3ff', cursor: 'grab',
    touchAction: 'none', userSelect: 'none',
  });
  let dragging = false;
  m.addEventListener('pointerdown', (e) => {
    dragging = true;
    m.setPointerCapture(e.pointerId);
    m.style.cursor = 'grabbing';
    e.preventDefault();
  });
  m.addEventListener('pointermove', (e) => {
    if (!dragging || !roomGeom) return;
    let r = drawingContext.canvas.getBoundingClientRect();
    let cx = (e.clientX - r.left) * (width / r.width), cy = (e.clientY - r.top) * (height / r.height);
    let c = roomGeom.cam;
    // screen y on the floor -> how far in (t = eye / (z + eye)) -> x
    let t = ((cy - c.oy) / c.s - c.H + c.ey) / c.ey;
    let z = t > 0.0001 ? ROOM_EYE_DIST_M / t - ROOM_EYE_DIST_M : c.D;
    z = Math.min(Math.max(z, 0), c.D);
    t = ROOM_EYE_DIST_M / (z + ROOM_EYE_DIST_M);
    let x = c.ex + ((cx - c.ox) / c.s - c.W / 2 - c.ex) / t;
    room.figure.fx = Math.min(Math.max((x + c.W / 2) / c.W, 0), 1);
    room.figure.fz = z / c.D;
  });
  let end = () => { dragging = false; m.style.cursor = 'grab'; };
  m.addEventListener('pointerup', end);
  m.addEventListener('pointercancel', end);
  document.body.appendChild(m);
  return m;
}

function updateFigureMarker() {
  if (!figureMarker) return;
  let show = roomView && figureMoving && room.figure.on && menuSystemVisible && !!roomGeom;
  figureMarker.style.display = show ? 'flex' : 'none';
  if (!show) return;
  let r = drawingContext.canvas.getBoundingClientRect();
  let [x, y] = roomGeom.project(figureFeet());
  figureMarker.style.left = (r.left + x * (r.width / width) - 15) + 'px';
  figureMarker.style.top = (r.top + y * (r.height / height) - 15) + 'px';
}

// v39.2: safety net — an error inside one frame is caught and shown on
// the canvas instead of stopping the animation for good.
