// noprotect
// Ritualized Viewing v43.1 — 09_export.js
// Video export (v43, design/v43_video_export.md). v43.1: the engine without an encoder — renders N frames on the virtual clock and hands each to a callback (tests / measuring). The panel and MP4 come in v43.2.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// v43.1: HOW AN EXPORT RUNS
// startExport() stops p5's own loop (noLoop) and draws one frame at a time
// with redraw(): frame k's artwork time is startNow + k × 1000 / fps
// (sketchFrameNow, 01_state), vsyncCount steps 1 per frame and the screen
// rate is the export's fps (setNominalHz, so the rhythms re-base exactly as
// on a real screen of that rate). A frame may take 4 ms or 4 s; the video
// is the same. During the export:
//  - the canvas is drawn at the export size (fitCanvasToWindow), Auto
//    sharpness off, screen limit ignored and not learning (03_draw);
//  - WebGL smoothing 4× (or Off if chosen) (glWantSamples, 08_webgl);
//  - the person redrawn every frame (04_room);
//  - Math.random is a seeded generator: same seed = same video;
//  - backups / session snapshots / the 30-min file save wait (05_menus);
//  - a frame error stops the export (no on-canvas note in the video).
// Afterwards the live clock continues from the export's last frame (no
// jump back: Free scroll waits, crossfades… are already in the future of
// that time), Math.random and the screen rate are restored.
// startNow = the frame after the one on screen, like a resume after pause.
const EXPORT_DESIGN_W = 1920; // v43.1: 16:9 / 16:10 only (other shapes: v43.3)

// mulberry32: small, fast, good enough for artwork choices.
function makeSeededRandom(seed) {
  let a = (Math.floor(Number(seed) || 0) >>> 0);
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// opts: { fps (60), frames (1 s), seed (1), width (1920; height follows the
//   design shape), smoothing ('on' | 'off'), onFrame(canvas, k) → may return
//   a promise (the next frame waits for it) }
// Returns a promise of { frames, fps, seed, width, height, ms: [per frame] }.
// cancelExport() stops it after the current frame (resolves, cancelled: true).
// It begins at the end of the next live frame (exportBegin, called by
// draw()): noLoop() inside a frame stops p5 cleanly, while from outside
// p5 still draws the animation frame it had already asked for.
function startExport(opts) {
  let E = exportState;
  if (E.on || E.pending) return Promise.reject(new Error('already exporting'));
  return new Promise((resolve, reject) => {
    E.pending = { opts: opts || {}, resolve, reject };
    if (!isLooping()) exportBegin(); // no live frame coming
  });
}

function exportBegin() {
  let E = exportState, P = pauseState;
  let { opts, resolve, reject } = E.pending;
  E.pending = null;
  let fps = Number(opts.fps) > 0 ? Number(opts.fps) : 60;
  let outW = Math.round(Number(opts.width) > 0 ? Number(opts.width) : EXPORT_DESIGN_W);
  Object.assign(E, {
    fps, frame: 0, frames: Math.max(1, Math.floor(Number(opts.frames) || fps)),
    seed: Number.isFinite(Number(opts.seed)) ? Number(opts.seed) : 1,
    density: outW / width, smoothing: opts.smoothing === 'off' ? 'off' : 'on',
    onFrame: typeof opts.onFrame === 'function' ? opts.onFrame : null,
    want: 0, error: null, cancel: false, ms: [],
    saved: { random: Math.random, hz: displayInfo.nominalHz, looping: isLooping() },
  });
  E.startNow = P.lastNow + 1000 / fps; // the frame after the one on screen
  E.on = true;
  noLoop();
  Math.random = makeSeededRandom(E.seed);
  setNominalHz(fps);
  lastDensity = null;
  fitCanvasToWindow();
  diagEvent('export start: ' + E.frames + ' frames, ' + fps + ' fps, ' + Math.round(width * E.density) + '×' + Math.round(height * E.density) + ', seed ' + E.seed);
  let ch = new MessageChannel(); // a yield without setTimeout's 4 ms clamp
  let next = () => { ch.port2.onmessage = step; ch.port1.postMessage(0); };
  let step = () => {
    if (E.cancel || E.frame >= E.frames) {
      let res = exportResult(E.cancel);
      endExport();
      resolve(res);
      return;
    }
    let t0 = performance.now();
    E.want = 1;
    Promise.resolve(redraw()).then(() => {
      if (E.error) throw E.error;
      if (E.want) throw new Error('frame ' + E.frame + ' was not drawn');
      E.ms.push(performance.now() - t0);
      return E.onFrame ? E.onFrame(drawingContext.canvas, E.frame) : null;
    }).then(() => {
      E.frame++;
      next();
    }).catch((err) => {
      diagEvent('export stopped at frame ' + E.frame + ': ' + String(err && err.message || err));
      endExport();
      reject(err);
    });
  };
  next(); // after the live frame that called this has finished
}
function cancelExport() { if (exportState.on) exportState.cancel = true; }

function exportResult(cancelled) {
  let E = exportState;
  return { frames: E.frame, fps: E.fps, seed: E.seed, cancelled: !!cancelled,
    width: drawingContext.canvas.width, height: drawingContext.canvas.height, ms: E.ms.slice() };
}

function endExport() {
  let E = exportState, P = pauseState;
  Math.random = E.saved.random;
  E.on = false;
  E.want = 0;
  E.after = true; // the first live frame steps vsyncCount by one (02_rhythm)
  P.lastReal = millis();
  P.offsetMs = P.lastReal - P.lastNow; // live continues from the last exported frame
  setNominalHz(E.saved.hz);
  lastDensity = null;
  fitCanvasToWindow();
  diagEvent('export end: ' + E.frame + ' / ' + E.frames + ' frames');
  if (E.saved.looping) loop();
}

// Speed summary for a result's ms list: median / mean / slowest, in ms.
function exportSpeedText(res) {
  let a = res.ms.slice().sort((x, y) => x - y);
  if (!a.length) return 'no frames';
  let mean = a.reduce((s, x) => s + x, 0) / a.length;
  return a.length + ' frames · median ' + a[a.length >> 1].toFixed(1) + ' ms · mean ' + mean.toFixed(1) +
    ' ms · slowest ' + a[a.length - 1].toFixed(1) + ' ms · ' + (mean * res.fps / 1000).toFixed(1) + ' min per minute of video';
}
