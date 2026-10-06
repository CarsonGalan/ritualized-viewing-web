// noprotect
// Ritualized Viewing v43.1 — 08_webgl.js
// v42 WebGL renderer: the screen pieces from THE DOORWAY (batchFlush) drawn by the graphics card, then pasted once onto the picture; ✕ / ✚ regions cut with a stencil (v42.1). Renderer switch, automatic smoothing (v42.2), automatic fallback to Canvas. Room: the chip puts the pieces in perspective (v42.4); ✕ / ✚ screens sent uncut, cut by a mask per region piece (v42.5).
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- v42.0: WEBGL RENDERER ----------------------
// How a frame is drawn with WebGL on:
//   p5 canvas: background / room  →  [WebGL: every screen piece in ONE draw
//   call on its own hidden canvas, smoothed with 4× multisampling]  →  one
//   paste of that canvas onto the picture  →  person, notes (p5 again).
// The pieces are exactly the ones Canvas would fill (same corners, same
// colours, same order); only who fills them changes. Our own WebGL2
// context, not p5's WEBGL mode, so p5 1.x and 2.x behave the same.
// v42.1: ✕ / ✚ too: each region's cut outline is drawn into a STENCIL (a
// per-sample mask), then the region's background and screens are drawn
// only inside it — clean cuts with no hidden layers. Still one paste.
// Fallback: if WebGL can't start, a draw fails, or the graphics chip drops
// the context ("context lost"), the sketch switches to Canvas by itself
// (logged in diagnostics, shown in the readout). Never saved in show files.
// v42.4: ROOM ON THE CHIP (Radiate off). The pieces arrive flat — a sheet
// rectangle cut to one wall, plus the wall's number — and a second shader
// ("room") puts each one in perspective with that wall's formula (the
// same 11 numbers as f.proj in roomBuildGeometry, `f.pk`) and the room's
// camera. Each piece = its 4 flat corners (16 bytes each), joined into 2
// triangles by a fixed index list (0 1 2, 0 2 3), so 4 corners instead of
// 6; still one draw call, same order. (Tried first: one 24-byte record per
// piece drawn as instances — 4× slower in the test browser, and tiny
// instances are slow on many real chips too.)
// The chip calculates in 32-bit numbers, so corners move by far less than
// a pixel: only edge pixels can differ from v42.3.
const GL_SAMPLES_WANTED = 4; // smoothing samples per pixel (8 would need ~340 MB at 3072×1728)
let rendererChoice = 'webgl'; // 'webgl' | 'canvas' — what the person picked (🖥 Display)
let glSmoothing = 'auto';     // v42.2: 'auto' | 'on' (4×) | 'off' — 🖥 Display → Smoothing; not saved
// v42.2 AUTO SMOOTHING. The Intel test (v42.1) showed smoothing was the
// whole full-size cost (heavy Room at 3072×1728: 34–37 fps on, 60 off).
// Auto turns it OFF where it can't be seen:
//  - Flat without ✕ / ✚: every screen edge sits on a whole pixel, so the
//    picture is identical either way;
//  - a very sharp canvas: GL_SMOOTH_OFF_RATIO or more canvas pixels per
//    screen point (full sharpness on a retina screen), where the steps are
//    too small to see.
// It stays ON where pixels are big: ordinary screens and projectors at
// 1 pixel per point, reduced sharpness. For a big wall driven at a high
// pixel ratio, choose On.
const GL_SMOOTH_OFF_RATIO = 1.75;
let glr = {
  canvas: null, gl: null, prog: null, vbo: null,
  fbo: null, colorRb: null, samples: 0,
  dsRb: null,          // v42.1: depth-stencil buffer (made on the first ✕ / ✚ frame)
  wantStencil: false,
  w: 0, h: 0,
  nv: 0,               // vertices recorded this pass
  segs: [],            // v42.1: runs of vertices with one stencil mode
  mode: 0, ref: 0,     // 0 = plain, 1 = write the stencil, 2 = draw inside it
  recording: false,    // a ✕ / ✚ pass is being collected
  frameRadiate: false, // v42.2: this frame draws ✕ / ✚ (see glPlanFrame)
  smoothWhy: '',       // v42.2: why smoothing is on / off right now
  useStencil: false,
  uM: null, uSize: null,
  failed: null,        // reason text once WebGL has failed (→ Canvas)
  started: false,
  buf: new ArrayBuffer(12 * 6 * 4096), // 12 bytes per vertex: x, y (float), colour (4 bytes)
  f32: null, u32: null,
  vaoPlain: null,      // v42.4: the plain shader's vertex layout
  progRoom: null, vaoRoom: null, rvbo: null, rebo: null, // v42.4: the room shader, its layout, corners and index list
  rbuf: new ArrayBuffer(16 * 4 * 8192), // v42.4: 16 bytes per corner: x, y on the sheet, wall (float), colour (4 bytes)
  rf32: null, ru32: null,
  reboQuads: 0,        // v42.4: pieces the index list covers
  ni: 0,               // v42.4: room pieces recorded this pass
  walls: [],           // v42.4: the formulas (f.pk) for the room shader's slots (v42.5: GL_WALLS)
  cam: null,           // v42.4: the room's camera (roomGeom.cam), or GL_FLAT_CAM
  uA: new Float32Array(24 * 4), uB: new Float32Array(24 * 4), uC: new Float32Array(24 * 4), // v42.5: uniform staging (GL_WALLS × vec4)
  regionK: 0,          // v42.5: the ✕ / ✚ region being recorded
  endMs: 0,            // v42.6: time spent in glEnd (drawing + paste), summed; the screen limit leaves it out
  clipCount: new Int32Array(6), clipAt: new Int32Array(6), // v42.5: its pieces' screen counts (GL_REGION_SLOTS)
  clipRef: (k, j) => k * 8 + j + 1, // v42.5: mask value of region k's piece j (1 … 30)
  uRoom: null,         // v42.4: the room shader's uniform locations
  colours: new Map(),  // css → packed RGBA (little-endian bytes r, g, b, a)
  probe: null,         // a tiny 2D context to read any css colour
};

// Is WebGL drawing the screens right now (for the readout / diagnostics)?
function rendererText() {
  if (rendererChoice === 'canvas') return 'canvas';
  if (glr.failed) return 'canvas (webgl failed)';
  return 'webgl';
}

function setRendererChoice(v) {
  rendererChoice = v === 'canvas' ? 'canvas' : 'webgl';
  if (rendererChoice === 'webgl' && glr.failed) glReset(); // picking WebGL again tries again
  if (typeof diagEvent === 'function') diagEvent('renderer → ' + rendererChoice);
  if (displayMenu) displayMenu.refresh();
  if (typeof markTimingChanged === 'function') markTimingChanged();
}

// v42.2: the smoothing choice (Auto / On / Off)
function setGlSmoothing(v) {
  glSmoothing = (v === 'on' || v === 'off') ? v : 'auto';
  if (typeof diagEvent === 'function') diagEvent('smoothing → ' + glSmoothing);
  if (displayMenu) displayMenu.refresh();
}
// What the frame being drawn needs: set by drawFrame() before drawing.
function glPlanFrame(mappings) {
  glr.frameRadiate = mappings.some((mp) => mp && mp.radiate && mp.radiate !== 'off');
}
// Canvas pixels per screen point (2 at full sharpness on a retina screen).
function glPixelRatio(cv) {
  let cssW = parseFloat(cv.style.width) || cv.width;
  return cv.width / cssW;
}
// Samples per pixel for this frame, and why (for the report).
function glWantSamples(cv) {
  let full = Math.max(0, Math.min(GL_SAMPLES_WANTED, glr.maxSamples || 0));
  if (exportState.on) return [exportState.smoothing === 'off' ? 0 : full, 'export']; // v43.1: always 4× unless chosen Off
  if (glSmoothing === 'on') return [full, 'on'];
  if (glSmoothing === 'off') return [0, 'off'];
  if (!roomView && !glr.frameRadiate) return [0, 'Flat'];
  if (glPixelRatio(cv) >= GL_SMOOTH_OFF_RATIO) return [0, 'sharp'];
  return [full, 'needed'];
}
function glSmoothingText() {
  let n = glr.gl ? glr.samples : GL_SAMPLES_WANTED;
  let now = n > 0 ? n + '×' : 'off';
  if (glSmoothing !== 'auto') return glSmoothing === 'on' ? now : 'off';
  return 'auto ' + now + (glr.smoothWhy && glr.smoothWhy !== 'needed' ? ' (' + glr.smoothWhy + ')' : '');
}

function glReset() {
  glr.canvas = glr.gl = glr.prog = glr.vbo = glr.fbo = glr.colorRb = glr.dsRb = null;
  glr.vaoPlain = glr.progRoom = glr.vaoRoom = glr.rvbo = glr.rebo = glr.cam = glr.uRoom = null; glr.ni = glr.reboQuads = 0; glr.walls.length = 0; // v42.4
  glr.w = glr.h = 0; glr.samples = 0; glr.recording = false;
  glr.failed = null; glr.started = false;
}

function glFail(why) {
  if (glr.failed) return;
  glr.failed = why;
  if (typeof diagEvent === 'function') diagEvent('webgl failed: ' + why + ' → drawing with Canvas');
  console.warn('WebGL renderer off (' + why + '); drawing with Canvas.');
  // the menus are refreshed between frames, never in the middle of one
  setTimeout(() => {
    if (displayMenu) displayMenu.refresh();
    if (typeof markTimingChanged === 'function') markTimingChanged();
  }, 0);
}

function glCompile(gl, type, src) {
  let s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
  return s;
}

// Starts WebGL once (lazily, on the first frame that needs it).
function glInit() {
  if (glr.started) return !!glr.gl;
  glr.started = true;
  try {
    let cv = document.createElement('canvas');
    let gl = cv.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false,
      stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance',
    });
    if (!gl) { glFail('WebGL2 not available'); return false; }
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glr.gl = null; glFail('context lost'); });
    let vs = glCompile(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 aPos;
in vec4 aCol;
uniform mat3 uM;     // sketch units -> canvas pixels (the 2D context's transform)
uniform vec2 uSize;  // canvas size in pixels
out vec4 vCol;
void main() {
  vec3 d = uM * vec3(aPos, 1.0);
  vec2 c = d.xy / uSize * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vCol = aCol;
}`);
    let fs = glCompile(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 outCol;
void main() { outCol = vec4(vCol.rgb * vCol.a, vCol.a); }`);
    let prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aCol');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(prog));
    glr.uM = gl.getUniformLocation(prog, 'uM');
    glr.uSize = gl.getUniformLocation(prog, 'uSize');
    let vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    let vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 12, 8);
    // v42.4: the room shader — a flat corner on wall `aWall`, put in perspective here
    let vsRoom = glCompile(gl, gl.VERTEX_SHADER, `#version 300 es
in vec2 aSheet;     // the corner on the sheet
in float aWall;     // which formula slot (v42.4: shown wall; v42.5: or ✕ / ✚ region piece)
in vec4 aCol;
uniform vec4 uWa[24]; // per slot (GL_WALLS): x0, yRef, cx, cy   (f.pk)
uniform vec4 uWb[24]; //           cz, ax, ay, az
uniform vec4 uWc[24]; //           bx, by, bz, -
uniform vec4 uCamA;  // ox, oy, ex, ey               (roomGeom.cam)
uniform vec4 uCamB;  // W, H, s, D
uniform mat3 uM;
uniform vec2 uSize;
out vec4 vCol;
void main() {
  int w = int(aWall + 0.5);
  vec4 A = uWa[w], B = uWb[w], C = uWc[w];
  float dx = aSheet.x - A.x, dy = aSheet.y - A.y;
  vec3 P = vec3(A.z, A.w, B.x) + B.yzw * dx + C.xyz * dy;
  float t = uCamB.w / (P.z + uCamB.w);
  vec2 q = vec2(uCamA.x + (uCamA.z + (P.x - uCamA.z) * t + uCamB.x * 0.5) * uCamB.z,
                uCamA.y + (uCamB.y - (uCamA.w + (P.y - uCamA.w) * t)) * uCamB.z);
  vec3 d = uM * vec3(q, 1.0);
  vec2 c = d.xy / uSize * 2.0 - 1.0;
  gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
  vCol = aCol;
}`);
    let progRoom = gl.createProgram();
    gl.attachShader(progRoom, vsRoom); gl.attachShader(progRoom, fs);
    gl.bindAttribLocation(progRoom, 0, 'aSheet');
    gl.bindAttribLocation(progRoom, 1, 'aWall');
    gl.bindAttribLocation(progRoom, 2, 'aCol');
    gl.linkProgram(progRoom);
    if (!gl.getProgramParameter(progRoom, gl.LINK_STATUS)) throw new Error('link (room): ' + gl.getProgramInfoLog(progRoom));
    let uRoom = {};
    ['uWa', 'uWb', 'uWc', 'uCamA', 'uCamB', 'uM', 'uSize'].forEach((n) => { uRoom[n] = gl.getUniformLocation(progRoom, n); });
    let vaoRoom = gl.createVertexArray();
    gl.bindVertexArray(vaoRoom);
    let rvbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rvbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    let rebo = gl.createBuffer(); // the index list belongs to this layout
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rebo);
    gl.bindVertexArray(null);
    glr.vaoPlain = vao; glr.progRoom = progRoom; glr.vaoRoom = vaoRoom; glr.rvbo = rvbo; glr.rebo = rebo; glr.uRoom = uRoom;
    glr.reboQuads = 0;
    glr.rf32 = new Float32Array(glr.rbuf); glr.ru32 = new Uint32Array(glr.rbuf);
    glr.maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
    glr.samples = Math.max(0, Math.min(GL_SAMPLES_WANTED, glr.maxSamples));
    glr.canvas = cv; glr.gl = gl; glr.prog = prog; glr.vbo = vbo;
    glr.fbo = gl.createFramebuffer();
    glr.f32 = new Float32Array(glr.buf); glr.u32 = new Uint32Array(glr.buf);
    let chip = typeof diagGpuName === 'function' ? diagGpuName() : '';
    if (typeof diagEvent === 'function') diagEvent('webgl started (smoothing up to ' + glr.samples + '×' + (chip ? ', ' + chip : '') + ')');
    return true;
  } catch (err) {
    glFail(String(err && err.message || err));
    return false;
  }
}

// Matches the hidden canvas (and its drawing buffers) to the picture.
// Drawing always goes into our own buffers (smoothed: several samples per
// pixel), which are then copied onto the hidden canvas (blitFramebuffer).
function glResize(w, h, cv) {
  let [samples, why] = glWantSamples(cv); // v42.2
  if (why !== glr.smoothWhy && glr.smoothWhy && typeof diagEvent === 'function') {
    diagEvent('smoothing ' + (samples ? samples + '×' : 'off') + ' (' + ({ on: 'chosen', off: 'chosen', Flat: 'Flat: no visible difference', sharp: 'sharp canvas: steps too small to see', needed: 'visible edges', export: 'video export' })[why] + ')');
  }
  if (why !== glr.smoothWhy) setTimeout(() => { if (displayMenu) displayMenu.refresh(); }, 0); // the Auto button shows the result
  glr.smoothWhy = why;
  let stencil = glr.wantStencil;
  if (glr.w === w && glr.h === h && glr.samples === samples && !!glr.dsRb === stencil) return;
  let gl = glr.gl;
  glr.canvas.width = w; glr.canvas.height = h;
  if (glr.colorRb) gl.deleteRenderbuffer(glr.colorRb);
  if (glr.dsRb) gl.deleteRenderbuffer(glr.dsRb);
  glr.colorRb = glr.dsRb = null;
  let store = (rb, fmt) => {
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h);
    else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h);
  };
  glr.colorRb = gl.createRenderbuffer();
  store(glr.colorRb, gl.RGBA8);
  gl.bindFramebuffer(gl.FRAMEBUFFER, glr.fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, glr.colorRb);
  if (stencil) {
    glr.dsRb = gl.createRenderbuffer();
    store(glr.dsRb, gl.DEPTH24_STENCIL8);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, glr.dsRb);
  } else {
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, null);
  }
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('drawing buffer incomplete');
  glr.samples = samples;
  glr.w = w; glr.h = h;
}

// Any css colour → 4 bytes (r, g, b, a), remembered.
function glColour(css) {
  let v = glr.colours.get(css);
  if (v !== undefined) return v;
  let r = 0, g = 0, b = 0, a = 255;
  let m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(css);
  if (!m) { // anything else (#hex, names): let a 2D context read it
    if (!glr.probe) glr.probe = document.createElement('canvas').getContext('2d');
    glr.probe.fillStyle = '#000'; glr.probe.fillStyle = css;
    let s = glr.probe.fillStyle;
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
    if (!m && /^#[0-9a-f]{6}$/i.test(s)) m = [s, parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  }
  if (m) {
    r = Math.round(+m[1]); g = Math.round(+m[2]); b = Math.round(+m[3]);
    a = m[4] !== undefined ? Math.round(+m[4] * 255) : 255;
  }
  v = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  if (glr.colours.size > 256) glr.colours.clear(); // fading colours change every frame
  glr.colours.set(css, v);
  return v;
}

// Makes room for `n` more vertices after `used`.
function glEnsure(used, n) {
  if ((used + n) * 12 <= glr.buf.byteLength) return;
  let nb = new ArrayBuffer(Math.max(glr.buf.byteLength * 2, (used + n) * 12));
  new Uint8Array(nb).set(new Uint8Array(glr.buf, 0, used * 12));
  glr.buf = nb; glr.f32 = new Float32Array(nb); glr.u32 = new Uint32Array(nb);
}

// v42.4: makes room for `n` more room pieces (4 corners each) after `used`.
function glEnsureRoom(used, n) {
  if ((used + n) * 64 <= glr.rbuf.byteLength) return;
  let nb = new ArrayBuffer(Math.max(glr.rbuf.byteLength * 2, (used + n) * 64));
  new Uint8Array(nb).set(new Uint8Array(glr.rbuf, 0, used * 64));
  glr.rbuf = nb; glr.rf32 = new Float32Array(nb); glr.ru32 = new Uint32Array(nb);
}
// v42.4: the fixed index list (0 1 2, 0 2 3 per piece), made longer when needed;
// called with the room layout (vaoRoom) bound.
function glRoomIndices(gl, quads) {
  if (quads <= glr.reboQuads) return;
  let n = Math.max(quads, glr.reboQuads * 2, 8192), ix = new Uint32Array(n * 6);
  for (let q = 0; q < n; q++) {
    let o = q * 6, v = q * 4;
    ix[o] = v; ix[o + 1] = v + 1; ix[o + 2] = v + 2; ix[o + 3] = v; ix[o + 4] = v + 2; ix[o + 5] = v + 3;
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, glr.rebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.STATIC_DRAW);
  glr.reboQuads = n;
}

// ---- recording a pass: vertices + runs (segments) with a stencil mode ----
// v42.5: a run is plain vertices (prog 0: corners already on the canvas) or
// room pieces (prog 1: flat corners the room shader puts in perspective);
// runs are drawn in the order they were recorded, each with its own mask.
// The room shader's formulas: GL_WALLS slots. Room: slot = index in
// roomGeom.on. ✕ / ✚: slot = region × GL_REGION_SLOTS + piece (one per wall
// the region reaches; Flat: one, with the 1:1 formula GL_FLAT_PK).
const GL_WALLS = 24, GL_REGION_SLOTS = 6;
const GL_FLAT_PK = [0, 0, 0, 0, 0, 1, 0, 0, 0, -1, 0]; // v42.5: X = x, Y = −y, Z = 0 …
const GL_FLAT_CAM = { ox: 0, oy: 0, ex: 0, ey: 0, W: 0, H: 0, s: 1, D: 1 }; // … and no perspective: exactly x, y
function glBegin() {
  if (glr.failed) return false;
  if (!glInit()) return false;
  if (!glr.gl || glr.gl.isContextLost()) { glFail('context lost'); return false; }
  glr.nv = 0; glr.segs.length = 0; glr.mode = 0; glr.ref = 0; glr.useStencil = false;
  glr.ni = 0; glr.walls.length = 0; glr.cam = null; // v42.4 (v42.5: slots)
  return true;
}
// Closes the vertices (prog 0) or room pieces (prog 1) added since `start` into the current run.
function glSeg(start, prog) {
  prog = prog || 0;
  let n = (prog ? glr.ni : glr.nv) - start;
  if (n <= 0) return;
  let last = glr.segs.length ? glr.segs[glr.segs.length - 1] : null;
  if (last && last.prog === prog && last.mode === glr.mode && last.ref === glr.ref && last.first + last.count === start) last.count += n;
  else glr.segs.push({ first: start, count: n, mode: glr.mode, ref: glr.ref, prog });
}
// v42.1: 0 = draw everywhere; 1 = write `ref` into the stencil (no colour);
// 2 = draw only where the stencil holds `ref`.
function glSetMode(mode, ref) {
  glr.mode = mode; glr.ref = ref || 0;
  if (mode) glr.useStencil = true;
}
// v42.4: one flat piece (4 corners on the sheet) for formula slot `wl`, at room piece `q`.
function glPutRoomQuad(F, U, q, wl, col, ax, ay, bx, by, cx, cy, dx, dy) {
  let p = q * 16;
  F[p] = ax; F[p + 1] = ay; F[p + 2] = wl; U[p + 3] = col;
  F[p + 4] = bx; F[p + 5] = by; F[p + 6] = wl; U[p + 7] = col;
  F[p + 8] = cx; F[p + 9] = cy; F[p + 10] = wl; U[p + 11] = col;
  F[p + 12] = dx; F[p + 13] = dy; F[p + 14] = wl; U[p + 15] = col;
}

// Adds one batch (css colour → piece list, see THE DOORWAY in 03_draw).
// v42.4: `geom` = the room of Room pieces (kind 2: wall + flat rectangle).
// v42.5: ✕ / ✚ pieces (kind 3: region piece + 4 flat corners, uncut) are
// sorted by region piece, each run drawn only inside that piece's mask
// (glDrawRadiate). Pieces never overlap, so the order between region
// pieces doesn't change the picture; within one it stays as recorded.
function glAddBatch(batch, geom) {
  let start = glr.nv, startQ = glr.ni;
  let pieces = 0, corners = 0, nv = glr.nv, ni = glr.ni;
  if (geom) { geom.on.forEach((f, i) => { if (i < GL_WALLS) glr.walls[i] = f.pk; }); glr.cam = geom.cam; }
  let rk = glr.regionK, cnt3 = glr.clipCount; // v42.5: ✕ / ✚ pieces per region piece
  cnt3.fill(0);
  let any3 = false;
  for (let [css, path] of batch) {
    let col = glColour(css);
    let xy = path.xy, st = path.starts, kd = path.kinds, cnt = st.length;
    pieces += cnt;
    glEnsure(nv, cnt * 6 + (path.n >> 1) * 3); // enough for every piece as a fan
    glEnsureRoom(ni, cnt); // v42.4
    let f = glr.f32, u = glr.u32, F = glr.rf32, U = glr.ru32;
    let k = -1;
    for (const a of st) {
      k++;
      let b = k + 1 < cnt ? st[k + 1] : path.n;
      let o = nv * 3;
      if (kd[k] === 3) { cnt3[xy[a]]++; any3 = true; continue; } // v42.5: placed below, sorted by region piece
      if (kd[k] === 2) { // v42.4: a flat piece on a wall — 4 flat corners, the chip puts them in perspective
        corners += 4;
        let x0 = xy[a + 1], y0 = xy[a + 2], x1 = xy[a + 3], y1 = xy[a + 4];
        glPutRoomQuad(F, U, ni, xy[a], col, x0, y0, x1, y0, x1, y1, x0, y1);
        ni++;
        continue;
      }
      if (kd[k] === 1) { // a rectangle x, y, w, h → 2 triangles
        corners += 4;
        let x0 = xy[a], y0 = xy[a + 1], x1 = x0 + xy[a + 2], y1 = y0 + xy[a + 3];
        f[o] = x0; f[o + 1] = y0; u[o + 2] = col;
        f[o + 3] = x1; f[o + 4] = y0; u[o + 5] = col;
        f[o + 6] = x1; f[o + 7] = y1; u[o + 8] = col;
        f[o + 9] = x0; f[o + 10] = y0; u[o + 11] = col;
        f[o + 12] = x1; f[o + 13] = y1; u[o + 14] = col;
        f[o + 15] = x0; f[o + 16] = y1; u[o + 17] = col;
        nv += 6;
        continue;
      }
      let nc = (b - a) / 2;
      corners += nc;
      if (nc === 4) { // the usual piece: 4 corners → 2 triangles
        f[o] = xy[a]; f[o + 1] = xy[a + 1]; u[o + 2] = col;
        f[o + 3] = xy[a + 2]; f[o + 4] = xy[a + 3]; u[o + 5] = col;
        f[o + 6] = xy[a + 4]; f[o + 7] = xy[a + 5]; u[o + 8] = col;
        f[o + 9] = xy[a]; f[o + 10] = xy[a + 1]; u[o + 11] = col;
        f[o + 12] = xy[a + 4]; f[o + 13] = xy[a + 5]; u[o + 14] = col;
        f[o + 15] = xy[a + 6]; f[o + 16] = xy[a + 7]; u[o + 17] = col;
        nv += 6;
        continue;
      }
      // a cut piece (always convex): a fan from its first corner
      for (let i = a + 2; i + 2 < b; i += 2) {
        f[o] = xy[a]; f[o + 1] = xy[a + 1]; u[o + 2] = col;
        f[o + 3] = xy[i]; f[o + 4] = xy[i + 1]; u[o + 5] = col;
        f[o + 6] = xy[i + 2]; f[o + 7] = xy[i + 3]; u[o + 8] = col;
        o += 9; nv += 3;
      }
    }
  }
  glr.nv = nv; glr.ni = ni;
  glSeg(start, 0);
  glSeg(startQ, 1);
  if (any3) { // v42.5: second look at the batch — each region piece's pieces in one run
    let at = glr.clipAt, total = 0, j = 0;
    for (const n of cnt3) { at[j] = ni + total; total += n; j++; }
    glEnsureRoom(ni, total);
    let F = glr.rf32, U = glr.ru32, base = rk * GL_REGION_SLOTS;
    for (let [css, path] of batch) {
      let col = glColour(css);
      let xy = path.xy, kd = path.kinds, k = -1;
      for (const a of path.starts) {
        k++;
        if (kd[k] !== 3) continue;
        let c = xy[a];
        corners += 4;
        glPutRoomQuad(F, U, at[c]++, base + c, col, xy[a + 1], xy[a + 2], xy[a + 3], xy[a + 4], xy[a + 5], xy[a + 6], xy[a + 7], xy[a + 8]);
      }
    }
    j = 0;
    for (const n of cnt3) {
      if (n > 0) { glSetMode(2, glr.clipRef(rk, j)); glr.segs.push({ first: at[j] - n, count: n, mode: 2, ref: glr.ref, prog: 1 }); }
      j++;
    }
    glr.ni = ni + total;
  }
  return { pieces, corners };
}

// v42.1: a polygon of one region piece (`which` = 'drawPoly' for its
// background, 'pastePoly' / 'drawPoly' for its mask), projected and added as a fan.
// v42.5: one piece at a time (each has its own mask now).
function glAddClipPoly(c, which, css) {
  let start = glr.nv, col = glColour(css);
  let P = c[which];
  if (!P || P.length < 3) return;
  glEnsure(glr.nv, (P.length - 2) * 3);
  let f = glr.f32, u = glr.u32;
  let q0 = c.proj(P[0][0], P[0][1]);
  let prev = c.proj(P[1][0], P[1][1]);
  for (const Q of P.slice(2)) {
    let q = c.proj(Q[0], Q[1]), o = glr.nv * 3;
    f[o] = q0[0]; f[o + 1] = q0[1]; u[o + 2] = col;
    f[o + 3] = prev[0]; f[o + 4] = prev[1]; u[o + 5] = col;
    f[o + 6] = q[0]; f[o + 7] = q[1]; u[o + 8] = col;
    glr.nv += 3;
    prev = q;
  }
  glSeg(start, 0);
}

// Draws everything recorded and pastes it once onto `ctx`. False = failed
// (nothing was pasted; the caller then draws the pass with Canvas).
function glEnd(ctx) {
  let tEnd = performance.now();
  try { return glEndDraw(ctx); } finally { glr.endMs += performance.now() - tEnd; } // v42.6
}
function glEndDraw(ctx) {
  let gl = glr.gl;
  try {
    if (!gl || gl.isContextLost()) { glFail('context lost'); return false; }
    let cv = ctx.canvas;
    if (glr.useStencil) glr.wantStencil = true;
    glResize(cv.width, cv.height, cv);
    let w = glr.w, h = glr.h;
    gl.bindFramebuffer(gl.FRAMEBUFFER, glr.fbo);
    gl.viewport(0, 0, w, h);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    let bits = gl.COLOR_BUFFER_BIT;
    if (glr.useStencil) { gl.stencilMask(0xff); gl.clearStencil(0); bits |= gl.STENCIL_BUFFER_BIT; }
    gl.clear(bits);
    if (glr.segs.length) {
      let t = ctx.getTransform(), M = [t.a, t.b, 0, t.c, t.d, 0, t.e, t.f, 1];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (glr.nv > 0) { // the plain shader's vertices
        gl.useProgram(glr.prog);
        gl.uniformMatrix3fv(glr.uM, false, M);
        gl.uniform2f(glr.uSize, w, h);
        gl.bindBuffer(gl.ARRAY_BUFFER, glr.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(glr.buf, 0, glr.nv * 12), gl.STREAM_DRAW);
      }
      if (glr.ni > 0) { // v42.4: the room shader's pieces and its formulas
        let cam = glr.cam || GL_FLAT_CAM, U = glr.uRoom;
        let wa = glr.uA, wb = glr.uB, wc = glr.uC, j = 0;
        wa.fill(0); wb.fill(0); wc.fill(0);
        for (const q of glr.walls) {
          if (q) {
            let o = j * 4;
            wa[o] = q[0]; wa[o + 1] = q[1]; wa[o + 2] = q[2]; wa[o + 3] = q[3];
            wb[o] = q[4]; wb[o + 1] = q[5]; wb[o + 2] = q[6]; wb[o + 3] = q[7];
            wc[o] = q[8]; wc[o + 1] = q[9]; wc[o + 2] = q[10];
          }
          j++;
        }
        gl.useProgram(glr.progRoom);
        gl.uniformMatrix3fv(U.uM, false, M);
        gl.uniform2f(U.uSize, w, h);
        gl.uniform4fv(U.uWa, wa); gl.uniform4fv(U.uWb, wb); gl.uniform4fv(U.uWc, wc);
        gl.uniform4f(U.uCamA, cam.ox, cam.oy, cam.ex, cam.ey);
        gl.uniform4f(U.uCamB, cam.W, cam.H, cam.s, cam.D);
        gl.bindVertexArray(glr.vaoRoom);
        glRoomIndices(gl, glr.ni);
        gl.bindBuffer(gl.ARRAY_BUFFER, glr.rvbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(glr.rbuf, 0, glr.ni * 64), gl.STREAM_DRAW);
      }
      let prog = -1;
      for (const sg of glr.segs) {
        if (sg.prog !== prog) { // v42.5: plain ↔ room
          prog = sg.prog;
          gl.useProgram(prog ? glr.progRoom : glr.prog);
          gl.bindVertexArray(prog ? glr.vaoRoom : glr.vaoPlain);
        }
        if (sg.mode === 0) {
          gl.disable(gl.STENCIL_TEST);
          gl.colorMask(true, true, true, true);
        } else if (sg.mode === 1) {
          gl.enable(gl.STENCIL_TEST);
          gl.colorMask(false, false, false, false);
          gl.stencilFunc(gl.ALWAYS, sg.ref, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        } else {
          gl.enable(gl.STENCIL_TEST);
          gl.colorMask(true, true, true, true);
          gl.stencilFunc(gl.EQUAL, sg.ref, 0xff);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        }
        if (prog) gl.drawElements(gl.TRIANGLES, sg.count * 6, gl.UNSIGNED_INT, sg.first * 24);
        else gl.drawArrays(gl.TRIANGLES, sg.first, sg.count);
      }
      gl.bindVertexArray(null);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
    }
    // resolve the samples onto the hidden canvas
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, glr.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (glr.nv > 0 || glr.ni > 0) { // the one paste
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(glr.canvas, 0, 0);
      ctx.restore();
    }
    return true;
  } catch (err) {
    glFail(String(err && err.message || err));
    return false;
  }
}

// One batch drawn on its own (Flat, Room): record, draw, paste. Returns
// { pieces, corners }, or null if WebGL can't (the caller then fills the
// batch with Canvas, so a frame is never left blank). v42.4: `geom` = the
// room (Room view), whose walls the chip projects the pieces onto.
function glDrawBatch(batch, ctx, geom) {
  if (!glBegin()) return null;
  let res;
  try { res = glAddBatch(batch, geom || null); } catch (err) { glFail(String(err && err.message || err)); return null; }
  return glEnd(ctx) ? res : null;
}

// v42.1: ✕ / ✚ in WebGL, all regions in one pass, cut by the stencil.
// v42.5: every region PIECE (the part of a region on one wall; Flat: the
// whole region) gets its own mask value (glr.clipRef): region 0 writes its
// pieces' drawPoly, later regions their pastePoly (covering what earlier
// regions drew there — the same result as Canvas pasting its hidden
// layers). Each piece's background and screens are drawn only inside its
// mask. The screens arrive UNCUT (kind 3, from sheetRect): the mask does
// the cutting at the ✕ / ✚ lines and the wall edges, and the room shader
// the perspective with that piece's wall formula. Returns false if WebGL
// can't (nothing drawn; the caller draws the regions with Canvas).
function glDrawRadiate(regions, drawRegion, ctx) {
  if (!glBegin()) return false;
  glr.recording = true;
  try {
    let bg = colorCss(colBg);
    glr.cam = roomView ? roomGeom.cam : GL_FLAT_CAM;
    regions.forEach((reg, k) => {
      glr.regionK = k;
      let j = 0;
      for (const c of reg.clips) {
        if (j < GL_REGION_SLOTS) glr.walls[k * GL_REGION_SLOTS + j] = c.face ? c.face.pk : GL_FLAT_PK;
        let ref = glr.clipRef(k, j);
        glSetMode(1, ref);
        glAddClipPoly(c, k === 0 ? 'drawPoly' : 'pastePoly', bg);
        glSetMode(2, ref);
        glAddClipPoly(c, 'drawPoly', bg);
        j++;
      }
      drawRegion(reg); // its batches come back through batchFlush → glAddBatch
    });
  } catch (err) {
    glr.recording = false;
    glFail(String(err && err.message || err));
    return false;
  }
  glr.recording = false;
  let tE = performance.now();
  let ok = glEnd(ctx);
  if (typeof perfFrame !== 'undefined') perfFrame.paste += performance.now() - tE; // shown as "layers"
  return ok;
}
