// noprotect
// Ritualized Viewing v43.0 — 06_dock.js
// Bottom dock: rhythm dock & timing panels, readout, perf timing, diagnostics + report, 🖥 Display menu.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

const PERF_WINDOW_MS = 2000;
// v40.22: + flush (ms in batchFlush = the hand-over), pieces handed over,
// cut (pieces cut along a ✕ / ✚ line), corners (all pieces' corners).
// Geometry = screens − flush − paste.
let perfFrame = { screens: 0, paste: 0, person: 0, n: 0, flush: 0, pieces: 0, cut: 0, corners: 0 };
function perfAccNew(t0) { return { frames: 0, total: 0, screens: 0, paste: 0, person: 0, n: 0, flush: 0, pieces: 0, cut: 0, corners: 0, t0: t0 }; }
let perfAcc = perfAccNew(0);
let perfStats = null; // { total, screens, paste, person, n, flush, pieces, cut, corners } — per frame
function perfFrameStart() {
  perfFrame.screens = perfFrame.paste = perfFrame.person = perfFrame.flush = 0;
  perfFrame.n = perfFrame.pieces = perfFrame.cut = perfFrame.corners = 0;
}
const PERF_KEYS = ['screens', 'paste', 'person', 'n', 'flush', 'pieces', 'cut', 'corners'];
function perfFrameEnd(totalMs, now) {
  let A = perfAcc;
  if (!A.t0) A.t0 = now;
  A.frames++; A.total += totalMs;
  for (let i = 0; i < PERF_KEYS.length; i++) { A[PERF_KEYS[i]] += perfFrame[PERF_KEYS[i]]; }
  if (now - A.t0 >= PERF_WINDOW_MS) {
    let f = A.frames || 1;
    perfStats = { total: A.total / f };
    for (let i = 0; i < PERF_KEYS.length; i++) { perfStats[PERF_KEYS[i]] = A[PERF_KEYS[i]] / f; }
    perfStats.n = Math.round(perfStats.n);
    perfAcc = perfAccNew(now);
  }
}
// v40.22: the "screens" split as text, shared by the readout and the report
// (values are per-frame averages; n = screens per frame).
function perfSplitText(screens, flush, paste, n, pieces, cut, corners) {
  let geo = Math.max(screens - flush - paste, 0);
  let us = (ms) => n > 0 ? Math.round(ms * 1000 / n) : 0;
  return 'geometry ' + geo.toFixed(1) + ' (' + us(geo) + 'µs/screen) · hand-over ' + flush.toFixed(1) + ' (' + us(flush) + 'µs/screen)'
    + (paste > 0.005 ? ' · layers ' + paste.toFixed(1) : '')
    + ' · pieces ' + Math.round(pieces) + (cut >= 0.5 ? ' (cut ' + Math.round(cut) + ')' : '') + ' corners ' + Math.round(corners);
}

// v40.15: DIAGNOSTICS. A light recorder: every frame adds a few numbers
// to running totals; every DIAG_SAMPLE_MS they become one line, kept for
// DIAG_KEEP_SAMPLES lines (5 minutes). Settings are compared at each line
// and only CHANGES are logged, plus tab hidden/shown, window resizes and
// frame errors. "📋 Copy diagnostics" (🖥 Display menu) copies it all as
// text to paste into the chat. Costs a few additions per frame.
const DIAG_SAMPLE_MS = 2000;
const DIAG_KEEP_SAMPLES = 150;
let diag = {
  startMs: null, frames: 0, errors: 0,
  win: null,            // running totals for the current line
  samples: [],          // { t, text, settings (as at the start of the line) }
  lastCheckMs: 0,
  events: [],           // { t, text }
  lastSettings: null, firstSettings: null,
};
function diagNewWindow(t) {
  return { t0: t, settings: diag.lastSettings, frames: 0, missed: 0, dts: [], total: 0, totalMax: 0, screens: 0, paste: 0, person: 0, n: 0, flush: 0, pieces: 0, cut: 0, corners: 0, late: 0 }; // v40.22: + flush, pieces, cut, corners
}
function diagT(t) { return ((t - (diag.startMs || 0)) / 1000).toFixed(0).padStart(4) + 's'; }
function diagEvent(text) {
  let t = performance.now();
  diag.events.push({ t, text });
  if (diag.events.length > 400) diag.events.shift();
}
function diagSettings() {
  let S = {};
  let put = (k, f) => { try { let v = f(); S[k] = (v === undefined || v === null || v === '') ? '-' : String(v); } catch (e) { S[k] = '?'; } };
  let r1 = (v) => Math.round(v * 10) / 10;
  let mp = () => frameMapping || activeMapping();
  put('view', () => roomView ? 'Room' : 'Flat');
  put('room', () => roomView ? room.w + 'x' + room.h + 'x' + room.d + 'm' : '-');
  put('centre', () => roomView ? mp().hub : '-');
  put('flow', () => mp().flow);
  put('radiate', () => mp().radiate || 'off');
  put('hidden', () => { let w = mp().walls || {}; return roomView ? (Object.keys(w).filter((k) => w[k] === false).join('+') || 'none') : '-'; });
  put('reversed', () => { let r = mp().reversed || {}; return roomView ? (Object.keys(r).filter((k) => r[k]).join('+') || 'none') : '-'; });
  // v42.4.1: the enabled Layout sets' own values ("39/1920"), not the live
  // flicker value — that changed several times a second and spammed the log.
  let ls = (k, f) => enabledIndices(layoutGroup.sets).map((i) => f(layoutGroup.sets[i][k])).join('/');
  put('scale', () => ls('scale', Math.round));
  put('spacing', () => ls('spacing', r1));
  put('thickness', () => ls('thickness', r1));
  put('colour', () => colorTimingMode + ' ' + colorFlashHz + 'Hz');
  put('layout', () => layoutGroup.timingMode + ' ' + layoutGroup.flashHz + 'Hz');
  put('scroll', () => scrollTimingMode + ' ' + scrollFlashHz + 'Hz');
  put('colourSets', () => enabledIndices(colorSets).length + '/' + colorSets.length);
  put('layoutSets', () => enabledIndices(layoutGroup.sets).length + '/' + layoutGroup.sets.length);
  put('palette', () => palette.length);
  put('safety', () => safetyLevel + (safetyFactor < 1 ? ' (slowed to ' + Math.round(safetyFactor * 100) + '%)' : ''));
  put('person', () => roomView ? (room.figure.on ? 'on, solid ' + r1(room.figure.solid || 0) : 'off') : '-');
  put('sharpness', () => sharpnessText()); // v41.7: 'auto ¾' etc.
  put('renderer', () => rendererText()); // v42.0
  put('radiateCuts', () => rendererText() === 'webgl' ? 'stencil (webgl)' : (radiateDirect ? 'direct (test)' : 'clean (layers)')); // v40.21 (v42.1: stencil)
  put('glSmoothing', () => glSmoothingText()); // v42.1
  put('screenLimit', () => screenLimitText()); // v42.6
  put('shape', () => designAspect);
  put('canvas', () => width + 'x' + height + ' x' + r1(pixelDensity()) + ' = ' + Math.round(width * pixelDensity()) + 'x' + Math.round(height * pixelDensity()) + 'px');
  put('window', () => innerWidth + 'x' + innerHeight + ' dpr ' + (window.devicePixelRatio || 1));
  put('fullscreen', () => document.fullscreenElement ? 'yes' : 'no');
  put('menus', () => menuSystemVisible ? 'shown' : 'hidden');
  put('scene', () => (sequenceState.currentSceneIndex + 1) + '/' + sequenceScenes.length + (sequenceState.autoAdvance ? '' : ' (auto off)'));
  put('mappings', () => { let sc = sequenceScenes[sequenceState.currentSceneIndex]; return sc && sc.mappings ? (mappingIndex + 1) + '/' + sc.mappings.length : '-'; });
  return S;
}
let diagListenersOn = false;
let diagLastVisibilityMs = -1e9;
// v40.17: the graphics chip's name, as the browser reports it (asked once)
let diagGpu = null;
function diagGpuName() {
  if (diagGpu) return diagGpu;
  try {
    let c = document.createElement('canvas');
    let gl = c.getContext('webgl', { powerPreference: 'low-power' }) || c.getContext('experimental-webgl');
    if (!gl) return (diagGpu = 'unknown (no WebGL)');
    let ext = gl.getExtension('WEBGL_debug_renderer_info');
    diagGpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    let lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { diagGpu = 'unknown'; }
  return diagGpu;
}
function diagFrame(tStart, totalMs) {
  if (diag.startMs === null) {
    diag.startMs = tStart;
    diag.win = diagNewWindow(tStart);
    diag.firstSettings = diag.lastSettings = diagSettings();
    diag.win.settings = diag.lastSettings;
  }
  if (!diagListenersOn && typeof document !== 'undefined') {
    diagListenersOn = true;
    document.addEventListener('visibilitychange', () => { diagLastVisibilityMs = performance.now(); diagEvent(document.hidden ? 'tab hidden (drawing pauses)' : 'tab shown again'); });
    window.addEventListener('resize', () => diagEvent('window resized to ' + innerWidth + 'x' + innerHeight));
    window.addEventListener('blur', () => diagEvent('browser window lost focus'));
    window.addEventListener('focus', () => diagEvent('browser window focused'));
  }
  diag.frames++;
  let W = diag.win;
  let dt = deltaTime;
  let period = 1000 / Math.max(displayInfo.nominalHz || 60, 1);
  W.frames++;
  if (Number.isFinite(dt) && dt > 0 && dt < 1000) {
    W.dts.push(dt);
    W.missed += Math.max(0, Math.round(dt / period) - 1);
    if (dt > 50) W.late++;
  } else if (Number.isFinite(dt) && dt >= 1000 && !document.hidden && tStart - diagLastVisibilityMs > dt + 500) { // v40.17: not right after a tab switch
    diagEvent('a frame took ' + (dt / 1000).toFixed(1) + ' s (picture froze)'); // v40.16
  }
  W.total += totalMs; if (totalMs > W.totalMax) W.totalMax = totalMs;
  for (let i = 0; i < PERF_KEYS.length; i++) { W[PERF_KEYS[i]] += perfFrame[PERF_KEYS[i]]; } // v40.22
  if (tStart - diag.lastCheckMs >= 250) { // settings compared 4× a second, so changes get the right time
    diag.lastCheckMs = tStart;
    let S = diagSettings(), P = diag.lastSettings, ch = [];
    Object.keys(S).forEach((k) => { if (P && P[k] !== S[k]) ch.push(k + ' ' + P[k] + ' → ' + S[k]); });
    if (ch.length) { diag.events.push({ t: tStart, text: 'changed: ' + ch.join(' · ') }); diag.lastSettings = S; }
  }
  if (tStart - W.t0 >= DIAG_SAMPLE_MS) {
    diagCloseWindow(tStart);
    diag.win = diagNewWindow(tStart);
  }
}
function diagCloseWindow(t) {
  let W = diag.win, f = Math.max(W.frames, 1), secs = Math.max((t - W.t0) / 1000, 0.001);
  let d = W.dts.slice().sort((a, b) => a - b);
  let q = (p) => d.length ? d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(1) : '-';
  let mem = (performance && performance.memory) ? ' heap ' + Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : '';
  let ms = (v) => (v / f).toFixed(1);
  let text = diagT(W.t0) + '  fps ' + Math.round(W.frames / secs).toString().padStart(3)
    + '  missed ' + String(W.missed).padStart(3)
    + '  screen ' + (displayInfo.nominalHz || '?') + 'Hz'
    + '  gaps ' + q(0.5) + ' (fast ' + q(0) + ', slow ' + q(1) + ')'
    + (W.late ? '  >50ms ' + W.late : '')
    + '  sketch ' + ms(W.total) + 'ms max ' + W.totalMax.toFixed(1)
    + ' [screens ' + ms(W.screens) + ' = ' + perfSplitText(W.screens / f, W.flush / f, W.paste / f, W.n / f, W.pieces / f, W.cut / f, W.corners / f) // v40.22
    + (W.person > 0 ? ' | person ' + ms(W.person) : '')
    + ' | other ' + ms(Math.max(W.total - W.screens - W.person, 0)) + ']'
    + '  n ' + Math.round(W.n / f)
    + (mappingFade ? '  mapping-fade' : '') + (sceneTransition ? '  scene-fade' : '')
    + mem;
  diag.samples.push({ t: W.t0, text, settings: W.settings });
  if (diag.samples.length > DIAG_KEEP_SAMPLES) diag.samples.shift();
  if (diag.events.length > 400) diag.events.splice(0, diag.events.length - 400);
}
function diagReport() {
  let now = performance.now();
  let lines = [];
  let ver = (typeof p5 !== 'undefined' && p5.VERSION) ? p5.VERSION : '?';
  lines.push('ENDLESS ARCHITECTURE DIAGNOSTICS — ' + SKETCH_VERSION + ' on p5.js ' + ver);
  lines.push('Copied ' + new Date().toLocaleString() + ' · running ' + Math.round((now - (diag.startMs || now)) / 1000) + ' s · ' + diag.frames + ' frames · frame errors ' + frameErrorCount);
  lines.push('Browser: ' + navigator.userAgent);
  lines.push('Cores: ' + (navigator.hardwareConcurrency || '?') + (navigator.deviceMemory ? ' · memory ~' + navigator.deviceMemory + 'GB' : '') + ' · graphics: ' + diagGpuName());
  lines.push('Screen now: ' + (displayInfo.nominalHz || '?') + ' Hz (measured ' + (displayInfo.measuredHz ? displayInfo.measuredHz.toFixed(2) : '?') + ')');
  let S = diagSettings();
  lines.push('Settings now: ' + Object.keys(S).map((k) => k + '=' + S[k]).join(' · '));
  let first = diag.samples.length ? diag.samples[0].t : now;
  let S0 = diag.samples.length ? diag.samples[0].settings : null;
  if (S0) lines.push('Settings at the first line: ' + Object.keys(S0).map((k) => k + '=' + S0[k]).join(' · '));
  lines.push('');
  lines.push('Each line = ' + (DIAG_SAMPLE_MS / 1000) + ' s. fps · missed refreshes · gaps between frames in ms (typical, fastest, slowest) · frames over 50 ms · sketch drawing ms per frame (average, max) [split: screens = geometry (working out the screens) + hand-over (giving the shapes to the browser) + layers (✕ / ✚ only: clearing, clipping and pasting the hidden layers), with µs per screen and the pieces handed over | person | other] · screens drawn · heap. ▸ lines = what happened, at that moment (inside the line above).');
  let items = diag.samples.map((x) => ({ t: x.t, text: x.text, k: 0 }))
    .concat(diag.events.filter((e) => e.t >= first - DIAG_SAMPLE_MS).map((e) => ({ t: e.t, text: diagT(e.t) + '  ▸ ' + e.text, k: 1 })));
  items.sort((a, b) => a.t - b.t || a.k - b.k);
  items.forEach((x) => lines.push(x.text));
  // the line still being collected
  if (diag.win && diag.win.frames) lines.push(diagT(diag.win.t0) + '  (current, ' + diag.win.frames + ' frames so far)');
  return lines.join('\n');
}
function copyDiagnostics(btn) {
  let text = diagReport();
  let done = (ok) => {
    if (!btn) return;
    let old = '📋 Copy diagnostics';
    btn.textContent = ok ? '✓ Copied — paste it in the chat' : old;
    setTimeout(() => { btn.textContent = old; }, 2500);
  };
  let fallback = () => { showDiagnosticsBox(text); done(false); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true), fallback);
    } else fallback();
  } catch (e) { fallback(); }
}
// When the clipboard isn't allowed (the editor's preview frame can block
// it): the report in a box, already selected — press Cmd+C.
function showDiagnosticsBox(text) {
  let box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', zIndex: 3000,
    width: 'min(760px, 92vw)', background: '#1b1b1b', border: '1px solid #666', borderRadius: '8px',
    padding: '12px', fontFamily: 'sans-serif', fontSize: '12px', color: '#eee', boxShadow: '0 8px 30px rgba(0,0,0,0.6)',
  });
  let msg = document.createElement('div');
  msg.textContent = 'Copying wasn\'t allowed here. The report is selected below: press Cmd+C (Ctrl+C), then paste it in the chat.';
  msg.style.marginBottom = '8px';
  let ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  Object.assign(ta.style, { width: '100%', height: '50vh', boxSizing: 'border-box', background: '#000', color: '#ddd', fontFamily: 'monospace', fontSize: '11px', border: '1px solid #444' });
  let close = document.createElement('button');
  close.textContent = 'Close';
  Object.assign(close.style, { marginTop: '8px', padding: '5px 14px', cursor: 'pointer', borderRadius: '4px', border: '1px solid #555', background: '#333', color: '#fff' });
  close.addEventListener('click', () => box.remove());
  box.appendChild(msg); box.appendChild(ta); box.appendChild(close);
  document.body.appendChild(box);
  ta.focus(); ta.select();
}

// v40.20: FAST RADIATE CUTTING. A screen's 4 corners are turned into the
// region with plain numbers, then checked against each piece's cut lines:
// all outside one line → the piece is skipped; all inside every line →
// drawn as it is (most screens); only screens crossing a line are cut.
// Before, every screen was cut, building new lists at every step.
// ---------------------- v35.1: RHYTHM DOCK (bottom-right) ----------------------
// Everything about how fast the piece FLASHES lives here, next to the
// readout of what is actually happening:
//   - "Colour timing ▴" button (v35.2) opens the panel upward (same
//     open/auto-close behaviour as the top menus); hidden by ☰;
//   - one-line readout: "Colour 10 Hz · Screen 60 Hz · 60 fps", plus
//     inline extras only when they matter (⚠ beat / stutter, a measured
//     rate that differs from the request, dropped frames);
//   - its own "Hz" button hides/shows the readout, independent of ☰.
// Colours: orange above 3 Hz, red 15–20 Hz, purple = the screen can't
// show the requested rate. Built so V36 (scroll pulse) and V37 (safety
// limit) can add their own sections and readout pieces.
let rhythmDock = null;
let rhythmDockVisible = true;
let lastRhythmDockUpdateMs = -Infinity;
let lastTimingChangeMs = -Infinity; // measured rate needs ~2 s to settle after a change
const RHYTHM_DOCK_UPDATE_MS = 250;

function markTimingChanged() {
  lastTimingChangeMs = millis();
  lastRhythmDockUpdateMs = -Infinity; // refresh the readout right away
}

// Flash-rate text in the most readable form: slow rates as "each colour
// stays …", fast ones in Hz. Returns { primary, secondary }.
function describeFlashRate(f, noun) {
  let stay = formatDurationSec(1 / (2 * f));
  let each = 'each ' + (noun || 'colour') + ' stays ';
  if (f < 1) return { primary: each + stay, secondary: formatHz(f) + ' Hz' };
  return { primary: formatHz(f) + ' Hz', secondary: each + stay };
}

// v35.3: one timing menu (button + panel), built once per channel.
// `extraStatus(ch)` lets a channel add its own heads-up (Layout's
// zoom-anchor note). Returns { wrapper, refresh(), setButtonVisible() }.
function buildTimingDockMenu(ch, buttonText, extraStatus) {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', display: menuSystemVisible ? '' : 'none' });

  // First child = the toggle attachHoverAutoClose() listens to.
  let btn = document.createElement('button');
  btn.textContent = buttonText;
  btn.title = 'Open ' + ch.noun + ' timing (flicker rate / slow change)';
  styleToggleButton(btn);
  wrapper.appendChild(btn);

  // v35.4: the panel is pinned to the screen's bottom-right corner, NOT
  // to its button, and has a fixed width — so a changing readout or a
  // wrapping line can never slide it around while you drag a slider.
  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, {
    position: 'fixed', top: 'auto', left: 'auto', right: '10px', bottom: '52px',
    width: '320px', minWidth: '0', boxSizing: 'border-box',
  });
  wrapper.appendChild(panel);

  let menu = attachHoverAutoClose(wrapper, panel);

  function note(text, extra) {
    let d = document.createElement('div');
    d.textContent = text || '';
    Object.assign(d.style, { fontSize: '11px', color: '#aaa', lineHeight: '1.4' }, extra || {});
    return d;
  }
  function section() {
    let d = document.createElement('div');
    Object.assign(d.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
    return d;
  }
  function changed() {
    ch.sync();
    markTimingChanged();
    refresh();
  }

  let title = document.createElement('div');
  title.textContent = ch.label + ' timing';
  Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px' });
  panel.appendChild(title);

  // ---- mode switch ----
  let modeRow = document.createElement('div');
  Object.assign(modeRow.style, { display: 'flex', gap: '4px' });
  function modeButton(text, mode, tip) {
    let b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    Object.assign(b.style, {
      flex: '1', padding: '5px 6px', borderRadius: '4px', cursor: 'pointer',
      border: '1px solid #555', fontFamily: 'sans-serif', fontSize: '12px',
    });
    b.addEventListener('click', () => { timingSetMode(ch, mode); changed(); });
    modeRow.appendChild(b);
    return b;
  }
  let flickerBtn = modeButton('Flicker (Hz)', 'flicker', 'Precise, frame-locked flash rates');
  let slowBtn = modeButton('Slow change (seconds)', 'slow', 'Free hold and fade times');
  panel.appendChild(modeRow);

  // ---- status lines (safety/screen first, then the channel's own) ----
  // v35.4: placed ABOVE the sliders. The panel grows upward from its
  // bottom edge, so lines appearing/disappearing up here never move the
  // sliders below while you drag them.
  let statusLine = note('', { display: 'none' });
  panel.appendChild(statusLine);
  let extraLine = note('', { display: 'none', color: TIMING_HEADSUP_COLOR });
  panel.appendChild(extraLine);
  let limitLine = note('', { display: 'none', color: SAFETY_LIMITED_COLOR }); // v37.1
  panel.appendChild(limitLine);
  let noRoomLine = note('', { display: 'none', color: SAFETY_LIMITED_COLOR }); // v37.3
  panel.appendChild(noRoomLine);

  // ---- Flicker section ----
  let flickerSection = section();
  let rateLine = document.createElement('div');
  Object.assign(rateLine.style, { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' });
  let ratePrimary = document.createElement('span');
  Object.assign(ratePrimary.style, { fontSize: '15px', fontWeight: 'bold' });
  let rateSecondary = document.createElement('span');
  Object.assign(rateSecondary.style, { fontSize: '11px', color: '#aaa' });
  rateLine.appendChild(ratePrimary);
  rateLine.appendChild(rateSecondary);
  flickerSection.appendChild(rateLine);

  let rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.min = 0;
  rateSlider.max = FLASH_HZ_VALUES.length - 1;
  rateSlider.step = 1;
  rateSlider.title = 'Slow ← → fast';
  rateSlider.addEventListener('input', () => {
    // v37.2: a blocked rate snaps to the nearest allowed one.
    let v = rateGuard.snap(FLASH_HZ_VALUES[parseInt(rateSlider.value, 10)]);
    rateSlider.value = FLASH_HZ_VALUES.indexOf(v);
    timingChangeRateSmoothly(ch, () => ch.setHz(v)); // v37.3: Nudge is kept as set, and trimmed to the new rate's reach when played
    timingDeriveSeconds(ch);
    changed();
  });
  let rateStrip = makeSafetyStrip(); // v37.2
  let rateCol = document.createElement('div');
  Object.assign(rateCol.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
  rateCol.appendChild(rateSlider);
  rateCol.appendChild(rateStrip);
  flickerSection.appendChild(rateCol);

  // v35.6: Nudge — fine offset for in-between rates (e.g. 10 + 0.5).
  let nudgeLine = document.createElement('div');
  Object.assign(nudgeLine.style, { display: 'flex', alignItems: 'flex-end', gap: '6px' });
  let nudgeRow = buildSliderRow('Nudge (fine-tune, for beats)', NUDGE_MIN_HZ, NUDGE_MAX_HZ, NUDGE_STEP_HZ, ch.getNudge(), 'Hz', (v) => {
    timingChangeRateSmoothly(ch, () => ch.setNudge(timingRoundNudge(ch, v))); // v37.3: step/reach follow the rate
    timingDeriveSeconds(ch);
    changed();
  });
  nudgeRow.style.flex = '1';
  nudgeLine.appendChild(nudgeRow);
  let nudgeReset = document.createElement('button');
  nudgeReset.textContent = '0';
  nudgeReset.title = 'Reset Nudge to 0 (clean listed rate)';
  Object.assign(nudgeReset.style, {
    padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #555',
    background: '#222', color: '#fff', fontSize: '11px', marginBottom: '2px',
  });
  nudgeReset.addEventListener('click', () => {
    timingChangeRateSmoothly(ch, () => ch.setNudge(0));
    timingDeriveSeconds(ch);
    changed();
  });
  nudgeLine.appendChild(nudgeReset);
  flickerSection.appendChild(nudgeLine);

  let fadeShareRow = buildSliderRow('Fade', 0, 100, 5, Math.round(ch.getFade() * 100), '%', (v) => {
    ch.setFade(v / 100);
    timingDeriveSeconds(ch);
    changed();
  });
  flickerSection.appendChild(fadeShareRow);
  flickerSection.appendChild(note(ch === layoutTimingChannel
    ? '0% = instant jump · 100% = continuous breathing zoom'
    : '0% = hard flash · 100% = smooth pulse'));
  panel.appendChild(flickerSection);

  // ---- Slow change section ----
  let slowSection = section();
  let slowSummary = note(); // v35.4: above the sliders, same reason as the status lines
  slowSection.appendChild(slowSummary);
  let holdRow = buildSliderRow('Hold (' + ch.noun + ' stays)', 0.05, 15, 0.05, ch.getSlowHold(), 's',
    (v) => { ch.setSlowHold(v); timingApplyActive(ch); changed(); }); // v35.5: Slow change's own memory
  slowSection.appendChild(holdRow);
  let fadeSecRow = buildSliderRow('Fade (blend into the next)', 0, 15, 0.1, ch.getSlowTrans(), 's',
    (v) => { ch.setSlowTrans(v); timingApplyActive(ch); changed(); });
  slowSection.appendChild(fadeSecRow);
  panel.appendChild(slowSection);

  // ---- v37.2: safety guards (blue strips + snapping) ----
  let rateGuard = makeSafetyGuard(FLASH_HZ_VALUES, FLASH_HZ_VALUES.map((_, i) => i / (FLASH_HZ_VALUES.length - 1)),
    () => ch.getHz(), (v) => ch.setHz(v), rateStrip);
  // v37.3: Nudge's values follow the rate (see timingNudgeLimit()).
  let nudgeVals = () => { let L = timingNudgeLimit(ch.getHz()); return safetyRange(-L, L, timingNudgeStep(ch.getHz())); };
  let nudgeGuard = makeSafetyGuard(nudgeVals, () => { let L = timingNudgeLimit(ch.getHz()); return linearPositions(nudgeVals(), -L, L); },
    () => ch.getNudge() || 0, (v) => ch.setNudge(v), nudgeRow.safetyStrip);
  nudgeRow.filterValue = (v) => nudgeGuard.snap(v);
  let holdVals = safetyRange(0.05, 15, 0.05);
  let holdGuard = makeSafetyGuard(holdVals, linearPositions(holdVals, 0.05, 15),
    () => ch.getSlowHold(), (v) => ch.setSlowHold(v), holdRow.safetyStrip);
  holdRow.filterValue = (v) => holdGuard.snap(v);
  let fadeVals = safetyRange(0, 15, 0.1);
  let fadeGuard = makeSafetyGuard(fadeVals, linearPositions(fadeVals, 0, 15),
    () => ch.getSlowTrans(), (v) => ch.setSlowTrans(v), fadeSecRow.safetyStrip);
  fadeSecRow.filterValue = (v) => fadeGuard.snap(v);
  // Only worth computing while the panel is open (and right when it opens).
  function updateGuards() {
    if (panel.style.display !== 'flex') return;
    let gs = ch.getMode() === 'flicker' ? [rateGuard, nudgeGuard] : [holdGuard, fadeGuard];
    gs.forEach((g) => g.update());
    let noRoom = gs.some((g) => g.noRoom); // v37.3
    noRoomLine.textContent = noRoom ? safetyNoRoomNote(ch.label) : '';
    noRoomLine.style.display = noRoom ? '' : 'none';
  }
  btn.addEventListener('click', () => setTimeout(refresh, 0));

  function round3(v) { return Math.round(v * 1000) / 1000; }

  function refresh() {
    let screenHz = displayInfo.nominalHz;
    let nSets = enabledIndices(ch.getSets()).length;
    let isFlicker = ch.getMode() === 'flicker';
    let f = timingRequestedHz(ch);
    let info = timingScreenInfo(ch);
    let unshowable = info.kind === 'impossible' || info.kind === 'stutter';
    let dangerColor = flashDangerColor(timingDangerLevel(ch));

    flickerSection.style.display = isFlicker ? 'flex' : 'none';
    slowSection.style.display = isFlicker ? 'none' : 'flex';
    [[flickerBtn, isFlicker], [slowBtn, !isFlicker]].forEach(([b, active]) => {
      b.style.background = active ? '#e8e8e8' : '#222';
      b.style.color = active ? '#111' : '#fff';
    });

    let effHz = timingEffectiveHz(ch);
    let nudge = timingActiveNudge(ch); // v37.3: as played (trimmed to this rate's reach)
    let d = describeFlashRate(effHz, ch.noun);
    ratePrimary.textContent = d.primary;
    let nudgeText = Math.abs(nudge) > 1e-9
      ? formatHz(ch.getHz()) + (nudge > 0 ? ' + ' : ' − ') + formatHz(Math.abs(nudge)) + ' · '
      : '';
    rateSecondary.textContent = nudgeText + d.secondary
      + ((info.kind === 'lopsided' || info.kind === 'inbetween') ? ' (uneven)' : '');
    ratePrimary.style.color = unshowable ? FLASH_PURPLE : (dangerColor || '');
    rateSlider.value = Math.max(FLASH_HZ_VALUES.indexOf(ch.getHz()), 0);
    { let L = timingNudgeLimit(ch.getHz()); nudgeRow.setRange(-L, L, timingNudgeStep(ch.getHz())); } // v37.3
    nudgeRow.setValue(Math.round(nudge * 10000) / 10000);
    fadeShareRow.setValue(Math.round(ch.getFade() * 100));

    holdRow.setValue(round3(ch.getSlowHold()));
    fadeSecRow.setValue(round3(ch.getSlowTrans()));
    slowSummary.textContent = Number.isFinite(f)
      ? 'One ' + ch.noun + ' every ' + formatDurationSec(ch.getSlowHold() + ch.getSlowTrans()) + ' · equals ' + formatHz(f) + ' Hz'
      : '';
    slowSummary.style.color = dangerColor || '#aaa';

    let status = '', statusColor = '#aaa';
    if (nSets < 2) {
      status = 'Only one ' + ch.noun + ' set is ticked — nothing changes.';
    } else if (info.kind === 'impossible') {
      status = 'Too fast for this ' + screenHz + ' Hz screen — you\'ll see a beat of about ' + formatHz(info.beatHz) + ' Hz instead.';
      statusColor = FLASH_PURPLE;
    } else if (info.kind === 'stutter') {
      status = 'This ' + screenHz + ' Hz screen can\'t show this evenly — it will stutter.';
      statusColor = FLASH_PURPLE;
    } else if (info.kind === 'lopsided') {
      status = 'Uneven: one ' + ch.noun + ' lasts one screen update longer. Steady, rarely noticeable.';
    } else if (info.kind === 'inbetween') {
      status = 'In-between rate: each ' + ch.noun + ' lasts ' + info.lo + ' or ' + info.hi + ' screen updates — slightly uneven, usually hard to notice.';
    } else if (!isFlicker && f > 3) {
      status = 'This is flicker territory. Slow change isn\'t frame-locked and may judder — switch to Flicker for exact rates.';
      statusColor = FLASH_ORANGE;
    }
    statusLine.textContent = status;
    statusLine.style.color = statusColor;
    statusLine.style.display = status ? '' : 'none';

    let extra = (nSets >= 2 && extraStatus) ? extraStatus(ch) : '';
    extraLine.textContent = extra;
    extraLine.style.display = extra ? '' : 'none';

    let lim = (nSets >= 2 && safetyFactor < 1 && Number.isFinite(f)) ? safetyLimitedNote(f) : '';
    limitLine.textContent = lim;
    limitLine.style.display = lim ? '' : 'none';
    updateGuards(); // v37.2
  }

  function setButtonVisible(visible) {
    wrapper.style.display = visible ? '' : 'none';
    if (!visible) menu.closeNow();
  }

  refresh();
  return { wrapper, button: btn, refresh, setButtonVisible, closeNow: menu.closeNow };
}

// v36: the Scroll timing menu (button + panel), same look and pinned
// spot as buildTimingDockMenu(), with its own two modes:
//   Pulse — rate + Nudge, Screens per pulse, Swipe length, Wobble, Spread
//   Free  — shortest / longest wait and swipe length (the old behaviour)
function buildScrollDockMenu() {
  let ch = scrollTimingChannel;
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', display: menuSystemVisible ? '' : 'none' });

  let btn = document.createElement('button');
  btn.textContent = 'Scroll timing ▴';
  btn.title = 'Open scroll timing (pulse / free)';
  styleToggleButton(btn);
  wrapper.appendChild(btn);

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, {
    position: 'fixed', top: 'auto', left: 'auto', right: '10px', bottom: '52px',
    width: '320px', minWidth: '0', boxSizing: 'border-box',
  });
  wrapper.appendChild(panel);
  let menu = attachHoverAutoClose(wrapper, panel);

  function note(text, extra) {
    let d = document.createElement('div');
    d.textContent = text || '';
    Object.assign(d.style, { fontSize: '11px', color: '#aaa', lineHeight: '1.4' }, extra || {});
    return d;
  }
  function section() {
    let d = document.createElement('div');
    Object.assign(d.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
    return d;
  }
  function changed() {
    syncActiveSceneScrollTiming();
    markTimingChanged();
    refresh();
  }

  let title = document.createElement('div');
  title.textContent = 'Scroll timing';
  Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px' });
  panel.appendChild(title);

  let modeRow = document.createElement('div');
  Object.assign(modeRow.style, { display: 'flex', gap: '4px' });
  function modeButton(text, mode, tip) {
    let b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    Object.assign(b.style, {
      flex: '1', padding: '5px 6px', borderRadius: '4px', cursor: 'pointer',
      border: '1px solid #555', fontFamily: 'sans-serif', fontSize: '12px',
    });
    b.addEventListener('click', () => { scrollSetMode(mode); changed(); });
    modeRow.appendChild(b);
    return b;
  }
  let pulseBtn = modeButton('Pulse (Hz)', 'pulse', 'One shared clock: on every tick a share of the screens swipes');
  let freeBtn = modeButton('Free (random)', 'free', 'Every screen swipes on its own random timer');
  panel.appendChild(modeRow);

  // Status lines ABOVE the sliders (same reason as the other timing panels).
  let statusLine = note('', { display: 'none' });
  panel.appendChild(statusLine);
  let swipeWarnLine = note('', { display: 'none', color: TIMING_HEADSUP_COLOR });
  panel.appendChild(swipeWarnLine);
  let limitLine = note('', { display: 'none', color: SAFETY_LIMITED_COLOR }); // v37.1
  panel.appendChild(limitLine);
  let noRoomLine = note('', { display: 'none', color: SAFETY_LIMITED_COLOR }); // v37.3
  panel.appendChild(noRoomLine);

  // ---- Pulse ----
  let pulseSection = section();
  let rateLine = document.createElement('div');
  Object.assign(rateLine.style, { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' });
  let ratePrimary = document.createElement('span');
  Object.assign(ratePrimary.style, { fontSize: '15px', fontWeight: 'bold' });
  let rateSecondary = document.createElement('span');
  Object.assign(rateSecondary.style, { fontSize: '11px', color: '#aaa' });
  rateLine.appendChild(ratePrimary);
  rateLine.appendChild(rateSecondary);
  pulseSection.appendChild(rateLine);

  let rateSlider = document.createElement('input');
  rateSlider.type = 'range';
  rateSlider.min = 0;
  rateSlider.max = FLASH_HZ_VALUES.length - 1;
  rateSlider.step = 1;
  rateSlider.title = 'Slow ← → fast';
  rateSlider.addEventListener('input', () => {
    let v = rateGuard.snap(FLASH_HZ_VALUES[parseInt(rateSlider.value, 10)]); // v37.2
    rateSlider.value = FLASH_HZ_VALUES.indexOf(v);
    timingChangeRateSmoothly(ch, () => ch.setHz(v)); // v37.3: Nudge is kept as set, and trimmed to the new rate's reach when played
    changed();
  });
  let rateStrip = makeSafetyStrip(); // v37.2
  let rateCol = document.createElement('div');
  Object.assign(rateCol.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
  rateCol.appendChild(rateSlider);
  rateCol.appendChild(rateStrip);
  pulseSection.appendChild(rateCol);

  let nudgeLine = document.createElement('div');
  Object.assign(nudgeLine.style, { display: 'flex', alignItems: 'flex-end', gap: '6px' });
  let nudgeRow = buildSliderRow('Nudge (fine-tune, for beats)', NUDGE_MIN_HZ, NUDGE_MAX_HZ, NUDGE_STEP_HZ, ch.getNudge(), 'Hz', (v) => {
    timingChangeRateSmoothly(ch, () => ch.setNudge(timingRoundNudge(ch, v))); // v37.3: step/reach follow the rate
    changed();
  });
  nudgeRow.style.flex = '1';
  nudgeLine.appendChild(nudgeRow);
  let nudgeReset = document.createElement('button');
  nudgeReset.textContent = '0';
  nudgeReset.title = 'Reset Nudge to 0 (clean listed rate)';
  Object.assign(nudgeReset.style, {
    padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #555',
    background: '#222', color: '#fff', fontSize: '11px', marginBottom: '2px',
  });
  nudgeReset.addEventListener('click', () => {
    timingChangeRateSmoothly(ch, () => ch.setNudge(0));
    changed();
  });
  nudgeLine.appendChild(nudgeReset);
  pulseSection.appendChild(nudgeLine);

  let coverageRow = buildSliderRow('Screens per pulse', 0, 100, 5, Math.round(scrollCoverage * 100), '%',
    (v) => { scrollCoverage = v / 100; changed(); });
  pulseSection.appendChild(coverageRow);
  let coverageNote = note();
  pulseSection.appendChild(coverageNote);

  let swipeShareRow = buildSliderRow('Swipe length (of the gap)', 5, 100, 5, Math.round(scrollSwipeShare * 100), '%',
    (v) => { scrollSwipeShare = v / 100; changed(); });
  pulseSection.appendChild(swipeShareRow);
  let swipeShareNote = note();
  pulseSection.appendChild(swipeShareNote);

  let wobbleRow = buildSliderRow('Wobble (when each pulse lands)', 0, 100, 5, Math.round(scrollWobble * 100), '%',
    (v) => { scrollWobble = v / 100; changed(); });
  pulseSection.appendChild(wobbleRow);
  pulseSection.appendChild(note('0% = metronome · 100% = irregular, like a loose drummer. The average rate stays the same.'));

  let spreadRow = buildSliderRow('Spread (screens within a pulse)', 0, 100, 5, Math.round(scrollSpread * 100), '%',
    (v) => { scrollSpread = v / 100; changed(); });
  pulseSection.appendChild(spreadRow);
  pulseSection.appendChild(note('0% = all start together (a clap) · 100% = scattered over the whole gap (rain).'));
  panel.appendChild(pulseSection);

  // ---- Free ----
  let freeSection = section();
  let freeSummary = note();
  freeSection.appendChild(freeSummary);
  let minWaitRow = buildSliderRow('Shortest wait between swipes', SCROLL_WAIT_MIN_MS / 1000, SCROLL_WAIT_MAX_MS / 1000, 0.1,
    minWaitTime / 1000, 's', (v) => { minWaitTime = v * 1000; changed(); });
  freeSection.appendChild(minWaitRow);
  let maxWaitRow = buildSliderRow('Longest wait between swipes', SCROLL_WAIT_MIN_MS / 1000, SCROLL_WAIT_MAX_MS / 1000, 0.1,
    maxWaitTime / 1000, 's', (v) => { maxWaitTime = v * 1000; changed(); });
  freeSection.appendChild(maxWaitRow);
  let swipeMsRow = buildSliderRow('Swipe length', SCROLL_SWIPE_MIN_MS, SCROLL_SWIPE_MAX_MS, 10,
    swipeDuration, 'ms', (v) => { swipeDuration = v; changed(); });
  freeSection.appendChild(swipeMsRow);
  freeSection.appendChild(note('Each screen keeps its own random timer — no shared rhythm.'));
  panel.appendChild(freeSection);

  // ---- v37.2: safety guards ----
  let rateGuard = makeSafetyGuard(FLASH_HZ_VALUES, FLASH_HZ_VALUES.map((_, i) => i / (FLASH_HZ_VALUES.length - 1)),
    () => ch.getHz(), (v) => ch.setHz(v), rateStrip);
  // v37.3: Nudge's values follow the rate (see timingNudgeLimit()).
  let nudgeVals = () => { let L = timingNudgeLimit(ch.getHz()); return safetyRange(-L, L, timingNudgeStep(ch.getHz())); };
  let nudgeGuard = makeSafetyGuard(nudgeVals, () => { let L = timingNudgeLimit(ch.getHz()); return linearPositions(nudgeVals(), -L, L); },
    () => ch.getNudge() || 0, (v) => ch.setNudge(v), nudgeRow.safetyStrip);
  nudgeRow.filterValue = (v) => nudgeGuard.snap(v);
  let covVals = safetyRange(0, 100, 5);
  let covGuard = makeSafetyGuard(covVals, linearPositions(covVals, 0, 100),
    () => Math.round(scrollCoverage * 100), (v) => { scrollCoverage = v / 100; }, coverageRow.safetyStrip);
  coverageRow.filterValue = (v) => covGuard.snap(v);
  function updateGuards() {
    if (scrollTimingMode !== 'pulse') { noRoomLine.style.display = 'none'; return; }
    if (panel.style.display !== 'flex') return;
    rateGuard.update(); nudgeGuard.update(); covGuard.update();
    let noRoom = rateGuard.noRoom || nudgeGuard.noRoom; // v37.3 (coverage 0 is always allowed)
    noRoomLine.textContent = noRoom ? safetyNoRoomNote('Scroll') : '';
    noRoomLine.style.display = noRoom ? '' : 'none';
  }
  btn.addEventListener('click', () => setTimeout(refresh, 0));

  function round2(v) { return Math.round(v * 100) / 100; }

  function refresh() {
    let isPulse = scrollTimingMode === 'pulse';
    pulseSection.style.display = isPulse ? 'flex' : 'none';
    freeSection.style.display = isPulse ? 'none' : 'flex';
    [[pulseBtn, isPulse], [freeBtn, !isPulse]].forEach(([b, active]) => {
      b.style.background = active ? '#e8e8e8' : '#222';
      b.style.color = active ? '#111' : '#fff';
    });

    let screenHz = displayInfo.nominalHz;
    let effHz = timingEffectiveHz(ch);
    let pulsesPerSec = 2 * effHz;
    let gapSec = 1 / pulsesPerSec;
    let info = classifyFlashHz(effHz, screenHz);
    let unshowable = info.kind === 'impossible' || info.kind === 'stutter';

    // Rate text: fast rates lead with Hz, slow ones with "a pulse every …".
    let pps = 'pulses per second';
    let every = 'a pulse every ' + formatDurationSec(gapSec);
    let nudge = timingActiveNudge(ch); // v37.3: as played
    let nudgeText = Math.abs(nudge) > 1e-9
      ? formatHz(ch.getHz()) + (nudge > 0 ? ' + ' : ' − ') + formatHz(Math.abs(nudge)) + ' · '
      : '';
    if (effHz < 1) {
      ratePrimary.textContent = every;
      rateSecondary.textContent = nudgeText + formatHz(effHz) + ' Hz';
    } else {
      ratePrimary.textContent = formatHz(effHz) + ' Hz';
      rateSecondary.textContent = nudgeText + formatHz(pulsesPerSec) + ' ' + pps + ' · ' + every;
    }
    if (info.kind === 'lopsided' || info.kind === 'inbetween') rateSecondary.textContent += ' (uneven)';
    let danger = flashDangerColor(Math.max(flashDangerLevel(effHz), info.beatHz !== null ? flashDangerLevel(info.beatHz) : 0));
    ratePrimary.style.color = unshowable ? FLASH_PURPLE : (danger || '');
    rateSlider.value = Math.max(FLASH_HZ_VALUES.indexOf(ch.getHz()), 0);
    { let L = timingNudgeLimit(ch.getHz()); nudgeRow.setRange(-L, L, timingNudgeStep(ch.getHz())); } // v37.3
    nudgeRow.setValue(Math.round(nudge * 10000) / 10000);
    coverageRow.setValue(Math.round(scrollCoverage * 100));
    swipeShareRow.setValue(Math.round(scrollSwipeShare * 100));
    wobbleRow.setValue(Math.round(scrollWobble * 100));
    spreadRow.setValue(Math.round(scrollSpread * 100));

    let visible = scrollVisibleKeys.length;
    let perPulse = Math.round(scrollCoverage * visible);
    coverageNote.textContent = visible > 0
      ? 'About ' + perPulse + ' of the ' + visible + ' screens on view swipe on each pulse.'
      : '';
    let swipeSec = scrollSwipeShare * gapSec;
    let swipeFrames = swipeSec * screenHz;
    swipeShareNote.textContent = 'Each swipe takes ' + formatDurationSec(swipeSec)
      + (scrollSpread > 0 ? ' (shorter for late starters, with Spread)' : '') + '.';

    minWaitRow.setValue(round2(minWaitTime / 1000));
    maxWaitRow.setValue(round2(maxWaitTime / 1000));
    swipeMsRow.setValue(Math.round(swipeDuration));
    let lo = Math.min(minWaitTime, maxWaitTime) / 1000, hi = Math.max(minWaitTime, maxWaitTime) / 1000;
    freeSummary.textContent = 'Each screen waits a random ' + round2(lo) + '–' + round2(hi) + ' s between swipes.';

    let status = '', statusColor = '#aaa';
    if (isPulse) {
      if (scrollCoverage <= 0) {
        status = 'Screens per pulse is 0% — nothing swipes.';
      } else if (info.kind === 'impossible') {
        status = 'Too fast for this ' + screenHz + ' Hz screen — pulses will merge and misfire.';
        statusColor = FLASH_PURPLE;
      } else if (info.kind === 'stutter') {
        status = 'This ' + screenHz + ' Hz screen can\'t space these pulses evenly — they will stutter.';
        statusColor = FLASH_PURPLE;
      } else if (danger && scrollCoverage >= 0.5) {
        // v36.2: many screens moving together, fast, is a large-area flash.
        status = '⚠ Safety: ' + formatHz(pulsesPerSec) + ' pulses per second moving ' + Math.round(scrollCoverage * 100)
          + '% of the screens is a large-area flash. Fewer screens per pulse (or more Spread) softens it.';
        statusColor = danger;
      } else if ((info.kind === 'lopsided' || info.kind === 'inbetween') && scrollWobble <= 0) {
        status = 'In-between rate: the gaps between pulses differ by one screen update — usually hard to notice.';
      }
    }
    statusLine.textContent = status;
    statusLine.style.color = statusColor;
    statusLine.style.display = status ? '' : 'none';

    let warn = (isPulse && scrollCoverage > 0 && !unshowable && swipeFrames < SCROLL_SWIPE_WARN_FRAMES)
      ? '⚠ Swipes last only about ' + Math.max(Math.round(swipeFrames), 1) + ' screen update' + (Math.round(swipeFrames) === 1 ? '' : 's') + ' — too quick to see as a scroll. Slow the rate or lengthen the swipe.'
      : '';
    swipeWarnLine.textContent = warn;
    swipeWarnLine.style.display = warn ? '' : 'none';

    let lim = (isPulse && scrollCoverage > 0 && safetyFactor < 1) ? safetyLimitedNote(effHz) : '';
    limitLine.textContent = lim;
    limitLine.style.display = lim ? '' : 'none';
    updateGuards(); // v37.2
  }

  function setButtonVisible(visible) {
    wrapper.style.display = visible ? '' : 'none';
    if (!visible) menu.closeNow();
  }

  refresh();
  return { wrapper, button: btn, refresh, setButtonVisible, closeNow: menu.closeNow };
}

// Calm "heads-up" colour for notes that aren't about safety or the
// screen (e.g. zoom-anchor behaviour) — distinct from orange/red/purple.
const TIMING_HEADSUP_COLOR = '#e6d38a';

// What the screen does with this channel's rate. Slow change isn't
// frame-locked, so screen-fit only describes Flicker mode.
// v37.1: `played` = judge the safety-limited rate (readout) instead of
// the designed one (panels).
function timingScreenInfo(ch, played) {
  if (!timingIsFrameLocked(ch)) return { kind: 'clean', beatHz: null }; // v36.2: scroll Pulse too
  return classifyFlashHz(played ? timingPlayedEffHz(ch) : timingEffectiveHz(ch), displayInfo.nominalHz);
}
function timingDangerLevel(ch, played) {
  let info = timingScreenInfo(ch, played);
  let f = timingRequestedHz(ch) * (played ? safetyFactor : 1);
  return Math.max(flashDangerLevel(f), info.beatHz !== null ? flashDangerLevel(info.beatHz) : 0);
}

// v35.3: Layout flicker heads-up. Every layout change zooms around the
// INCOMING set's anchor. If the sets use different anchors, each flip
// zooms around a different point, so the grid slides a little further
// every time; a random anchor re-picks on every flip. Shown in Flicker
// mode only (at slow speeds the slide is the familiar camera move).
function layoutAnchorHeadsUp(ch) {
  if (ch.getMode() !== 'flicker') return '';
  let anchors = enabledIndices(layoutGroup.sets).map((i) => layoutGroup.sets[i].anchor || DEFAULT_ANCHOR);
  if (anchors.some((a) => a === 'RANDOM_ANY' || a === 'RANDOM_9')) {
    return '⚠ A random zoom anchor is on: the grid jumps to a new point on every flip.';
  }
  if (new Set(anchors).size > 1) {
    return '⚠ These layout sets use different zoom anchors: the grid slides a little on every flip and wanders over time. Use the same anchor for a steady flicker.';
  }
  return '';
}

// v35.3: beat between two rhythms that are close, or close to a simple
// multiple (1×–4×) of each other. Returns null when there's no
// meaningful beat (far apart, or exactly in step).
function beatBetween(f1, f2) {
  if (!(f1 > 0 && f2 > 0) || !Number.isFinite(f1) || !Number.isFinite(f2)) return null;
  let hi = Math.max(f1, f2), lo = Math.min(f1, f2);
  let k = Math.round(hi / lo);
  if (k < 1 || k > 4) return null;
  let d = Math.abs(hi - k * lo);
  if (d < 1e-6 || d / (k * lo) > 0.25) return null; // v35.6: was 0.15 — 10 vs 12 Hz is a real 2 Hz beat
  return d;
}

function createRhythmDock() {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed', right: '10px', bottom: '10px', zIndex: 1000,
    display: 'flex', alignItems: 'center', gap: '6px',
    fontFamily: 'sans-serif', fontSize: '12px',
  });

  let colorMenu = buildTimingDockMenu(colorTimingChannel, 'Colour timing ▴', null);
  // (v37.3: dock buttons never wrap onto two lines — see the nowrap below.)
  let layoutMenu = buildTimingDockMenu(layoutTimingChannel, 'Layout timing ▴', layoutAnchorHeadsUp);
  let scrollMenu = buildScrollDockMenu(); // v36
  // Both panels open in the same pinned spot, so opening one closes the
  // other. (attachHoverAutoClose's own click listener on the same button
  // still runs — stopPropagation doesn't block same-element listeners.)
  // v36: three panels share the spot — opening any one closes the others.
  let dockMenus = [colorMenu, layoutMenu, scrollMenu];
  dockMenus.forEach((m) => m.button.addEventListener('click', () => {
    dockMenus.forEach((o) => { if (o !== m) o.closeNow(); });
  }));

  // Plain information, not clickable.
  // v35.4: placed LEFT of the buttons — its width changes constantly,
  // and only things to its left would be pushed around by that.
  let readout = document.createElement('div');
  Object.assign(readout.style, {
    padding: '6px 10px', background: 'rgba(0,0,0,0.55)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.25)', borderRadius: '6px',
    whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', cursor: 'default',
    // v37.3: never run into the Safety button on the left; cut off with … instead.
    maxWidth: 'calc(100vw - 596px)', overflow: 'hidden', textOverflow: 'ellipsis',
  });
  // v43.0: ⏸ / ▶ — pause freezes every artwork clock (sketchNow(), 01_state).
  let pauseBtn = document.createElement('button');
  Object.assign(pauseBtn.style, {
    width: '30px', height: '30px', borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)', fontSize: '12px',
    padding: '0', cursor: 'pointer', fontFamily: 'sans-serif', flex: 'none',
  });
  pauseBtn.addEventListener('click', () => togglePause());
  function refreshPauseBtn() {
    let p = pauseState.paused;
    pauseBtn.textContent = p ? '▶' : '⏸';
    pauseBtn.title = p ? 'Play — continues exactly where it stopped (Space)' : 'Pause — every rhythm, fade and scene stands still; edits still show (Space)';
  }
  refreshPauseBtn();
  // Space = the same button, except while typing in a field.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    let t = e.target;
    if (t && (isTypingControl(t) || t.isContentEditable
      || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color'].includes(t.type)))) return;
    e.preventDefault();
    if (t && t !== document.body && typeof t.blur === 'function') t.blur(); // a focused button would also "click" on Space
    togglePause();
  });
  wrapper.appendChild(pauseBtn);
  wrapper.appendChild(readout);
  wrapper.appendChild(colorMenu.wrapper);
  wrapper.appendChild(layoutMenu.wrapper);
  wrapper.appendChild(scrollMenu.wrapper);
  [colorMenu, layoutMenu, scrollMenu].forEach((m) => { m.button.style.whiteSpace = 'nowrap'; m.wrapper.style.flex = 'none'; }); // v37.3

  let hideBtn = document.createElement('button');
  hideBtn.textContent = 'Hz';
  hideBtn.title = 'Show/hide the frequency readout';
  Object.assign(hideBtn.style, {
    width: '30px', height: '30px', borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)', fontSize: '11px',
    padding: '0', cursor: 'pointer', fontFamily: 'sans-serif', flex: 'none',
  });
  hideBtn.addEventListener('click', () => {
    rhythmDockVisible = !rhythmDockVisible;
    readout.style.display = rhythmDockVisible ? '' : 'none';
    lastRhythmDockUpdateMs = -Infinity;
  });
  wrapper.appendChild(hideBtn);
  document.body.appendChild(wrapper);

  function piece(text, color) {
    let sp = document.createElement('span');
    sp.textContent = text;
    if (color) sp.style.color = color;
    return sp;
  }
  function dot() { return piece(' · ', '#777'); }

  // Adds one channel's part of the readout ("Colour 10 Hz", maybe a
  // ⚠ beat / stutter, maybe a differing measured rate). Returns the
  // channel's rate if it is changing, else null.
  function addChannel(ch, tip, settled, first) {
    let fDesign = timingRequestedHz(ch);
    let f = fDesign * safetyFactor; // v37.1: the readout shows what actually PLAYS
    let changing;
    if (ch === scrollTimingChannel) {
      // v36.2: scroll shows only while Pulse is actually moving screens.
      changing = scrollTimingMode === 'pulse' && scrollCoverage > 0;
      if (!changing) {
        tip.push(scrollTimingMode === 'pulse'
          ? 'Scroll: Pulse, but 0% of screens per pulse'
          : 'Scroll: Free (each screen on its own random timer, no shared rhythm)');
        return null;
      }
      timingTrimChanges(ch, sketchNow()); // v43.0: change times are artwork time
    } else {
      changing = enabledIndices(ch.getSets()).length >= 2 && Number.isFinite(f);
    }
    // Colour always shows (it's the main rhythm); Layout/Scroll only when they move.
    if (!changing && ch !== colorTimingChannel) return null;
    if (!first) readout.appendChild(dot());
    if (!changing) {
      readout.appendChild(piece(ch.label + ' —'));
      tip.push(ch.label + ': not changing (only one set ticked)');
      return null;
    }
    let info = timingScreenInfo(ch, true);
    let unshowable = info.kind === 'impossible' || info.kind === 'stutter';
    // v37.2: when the safety limit slows it, show "designed→played".
    let rateText = safetyFactor < 1 ? formatHz(fDesign) + '→' + formatHz(f) : formatHz(f);
    readout.appendChild(piece(ch.label + ' ' + rateText + ' Hz' + ((info.kind === 'lopsided' || info.kind === 'inbetween') ? ' (uneven)' : ''),
      flashDangerColor(timingDangerLevel(ch, true))));
    let modeName = { flicker: 'Flicker', slow: 'Slow change', pulse: 'Pulse' }[ch.getMode()] || '';
    if (safetyFactor < 1) tip.push(ch.label + ': designed ' + formatHz(fDesign) + ' Hz, limited to ' + formatHz(f) + ' Hz');
    tip.push(ch.label + ': ' + formatHz(f) + ' Hz (' + modeName
      + (ch === scrollTimingChannel ? ' · ' + formatHz(2 * f) + ' pulses/s · ' + Math.round(scrollCoverage * 100) + '% of screens' : '') + ')');
    if (info.kind === 'impossible') {
      readout.appendChild(dot());
      readout.appendChild(piece('⚠ beat ' + formatHz(info.beatHz) + ' Hz', FLASH_PURPLE));
      tip.push('  screen can\'t show it: visible beat ≈ ' + formatHz(info.beatHz) + ' Hz');
    } else if (info.kind === 'stutter') {
      readout.appendChild(dot());
      readout.appendChild(piece('⚠ stutters', FLASH_PURPLE));
      tip.push('  screen can\'t show it evenly');
    }
    let wobbly = ch === scrollTimingChannel && scrollWobble > 0; // v36.2: a wobbly rate never measures exactly
    if (f >= 0.5 && settled && !unshowable && !wobbly) {
      let m = timingMeasuredHz(ch);
      tip.push('  measured ' + formatHz(m) + ' Hz');
      if (Math.abs(m - f) / f > 0.1) {
        readout.appendChild(dot());
        readout.appendChild(piece('measured ' + formatHz(m), flashDangerColor(flashDangerLevel(m)) || '#ccc'));
      }
    }
    return f;
  }

  // Ticking/unticking sets changes what moves: give the measured rates
  // time to settle instead of briefly showing "0".
  let lastSetCounts = null;
  function refresh() {
    let counts = enabledIndices(colorSets).length + '/' + enabledIndices(layoutGroup.sets).length + '/' + scrollTimingMode;
    if (lastSetCounts !== null && counts !== lastSetCounts) lastTimingChangeMs = millis();
    lastSetCounts = counts;

    colorMenu.refresh();
    layoutMenu.refresh();
    scrollMenu.refresh();
    refreshPauseBtn(); // v43.0
    if (!rhythmDockVisible) return;

    let settled = millis() - lastTimingChangeMs > COLOR_CHANGE_WINDOW_MS + 200;
    readout.replaceChildren();
    let tip = [];
    let fc = null, fl = null, fs = null;
    if (pauseState.paused) { // v43.0: "Paused" in place of the rates
      readout.appendChild(piece('⏸ Paused'));
      tip.push('Paused: every rhythm, fade and scene stands still. Space or ▶ plays on from exactly here; edits show at once.');
    } else {
      fc = addChannel(colorTimingChannel, tip, settled, true);
      fl = addChannel(layoutTimingChannel, tip, settled, false);
      fs = addChannel(scrollTimingChannel, tip, settled, false); // v36.2
    }

    // Beats between every pair of moving rhythms at close rates (v36.2:
    // was colour–layout only; now each beat is labelled with its pair).
    [[fc, fl, 'Colour', 'Layout'], [fc, fs, 'Colour', 'Scroll'], [fl, fs, 'Layout', 'Scroll']].forEach(([a, b, na, nb]) => {
      let beat = (a !== null && b !== null) ? beatBetween(a, b) : null;
      if (beat === null) return;
      readout.appendChild(dot());
      readout.appendChild(piece('Beat ' + na.toLowerCase() + '–' + nb.toLowerCase() + ' ' + formatHz(beat) + ' Hz',
        flashDangerColor(flashDangerLevel(beat)) || '#ddd'));
      tip.push(na + ' and ' + nb + ' drift in and out of step ' + formatHz(beat) + ' times per second');
    });

    // v37.1: safety limit is slowing playback down
    if (safetyFactor < 1) {
      readout.appendChild(dot());
      // v37.2: a plain sentence instead of a bare "Limited".
      // v37.3: kept short so the bar doesn't overflow; the reason is in the hover tip and the panels.
      readout.appendChild(piece('Slowed to ' + Math.round(safetyFactor * 100) + '% by safety limit', SAFETY_LIMITED_COLOR));
      tip.push('Why: ' + safetyReasonText() + '.');
      tip.push('Safety limit (' + SAFETY_LEVELS[safetyLevel].label + '): combined ' + formatHz(safetyInfo.combined)
        + ' Hz plays at ' + formatHz(safetyInfo.combined * safetyFactor) + ' Hz — every rhythm × ' + (Math.round(safetyFactor * 100) / 100));
    }

    readout.appendChild(dot());
    // v37.1: an unusual refresh rate (e.g. a projector output set to 50 Hz) gets a warning colour.
    let oddScreen = displayInfo.ready && displayInfo.nominalHz < 59;
    if (previewSharpness === 'half') { // v39.4: never forget it's on
      readout.appendChild(piece('½ sharpness', TIMING_HEADSUP_COLOR));
      readout.appendChild(dot());
      tip.push('Preview sharpness: Half (🖥 Display menu). Preview only — exports render at full sharpness.');
    } else if (previewSharpness === 'auto' && autoSharp.level > 0) { // v41.7: only shown when Auto has stepped down
      readout.appendChild(piece('Auto · ' + AUTO_SHARP_LABELS[autoSharp.level] + ' sharpness', TIMING_HEADSUP_COLOR));
      readout.appendChild(dot());
      tip.push('Preview sharpness: Auto, now at ' + AUTO_SHARP_LABELS[autoSharp.level] + ' — lowered because frames were being dropped; it goes back up when there is room (🖥 Display menu). Preview only — exports render at full sharpness.');
    }
    if (rendererChoice === 'webgl' && glr.failed) { // v42.0: WebGL fell back to Canvas
      readout.appendChild(piece('Canvas', TIMING_HEADSUP_COLOR));
      readout.appendChild(dot());
      tip.push('Drawing with Canvas: WebGL stopped (' + glr.failed + '). 🖥 Display → Renderer → WebGL tries again.');
    }
    readout.appendChild(piece('Screen ' + (displayInfo.ready ? displayInfo.nominalHz + ' Hz' : '…') + (oddScreen ? ' ⚠' : ''), oddScreen ? FLASH_ORANGE : '#aaa'));
    if (oddScreen) tip.push('⚠ Unusual screen refresh rate — check the display settings (60 Hz is the usual). The sketch only sees what the computer sends, not what a projector does inside.');
    readout.appendChild(dot());
    readout.appendChild(piece(displayInfo.fps + ' fps', '#aaa'));
    if (displayInfo.droppedRecent > 0) {
      readout.appendChild(dot());
      readout.appendChild(piece(displayInfo.droppedRecent + ' dropped', '#ccc'));
    }
    // v40.14: how long the sketch's own drawing takes per frame
    if (perfStats) {
      let budget = 1000 / Math.max(displayInfo.nominalHz || 60, 1);
      let heavy = perfStats.total > budget * 0.75;
      readout.appendChild(dot());
      readout.appendChild(piece(perfStats.total.toFixed(1) + ' ms', heavy ? FLASH_ORANGE : '#aaa'));
      let ms = (v) => v.toFixed(1) + ' ms';
      tip.push('Drawing per frame (average of the last 2 s): ' + ms(perfStats.total) + ' of ' + ms(budget) + ' available');
      tip.push('  screens ' + ms(perfStats.screens) + ' (' + perfStats.n.toLocaleString() + ' screens)'
        + ': ' + perfSplitText(perfStats.screens, perfStats.flush, perfStats.paste, perfStats.n, perfStats.pieces, perfStats.cut, perfStats.corners) // v40.22
        + (roomView && room.figure.on ? ' | person ' + ms(perfStats.person) : '')
        + ' | everything else ' + ms(Math.max(perfStats.total - perfStats.screens - perfStats.person, 0)));
      tip.push('  (the browser then paints the pixels — not counted here, so drops can happen below the limit)');
    }
    tip.push('Screen ' + displayInfo.nominalHz + ' Hz (measured ' + formatHz(displayInfo.measuredHz) + ')');
    tip.push(displayInfo.fps + ' fps · ' + displayInfo.droppedRecent + ' frames dropped in the last 10 s');
    readout.title = tip.join('\n');
  }

  // ☰ hides both Timing buttons like every other menu; the readout
  // follows only its own "Hz" button.
  function setMenuButtonVisible(visible) {
    colorMenu.setButtonVisible(visible);
    layoutMenu.setButtonVisible(visible);
    scrollMenu.setButtonVisible(visible);
  }

  lastTimingChangeMs = millis(); // nothing measured yet at startup
  refresh();

  return { wrapper, refresh, setMenuButtonVisible, pauseBtn }; // v43.0: pauseBtn (tests)
}

function updateRhythmDock(now) {
  if (!rhythmDock) return;
  if (now - lastRhythmDockUpdateMs < RHYTHM_DOCK_UPDATE_MS) return;
  lastRhythmDockUpdateMs = now;
  rhythmDock.refresh();
}

// Shows/hides every existing menu wrapper (every Colors N/Layout N
// menu, both "+" controls, both Timing menus, and the Sequence menu)
// and updates `menuSystemVisible` so any wrapper built LATER (e.g. a
// fresh Colors N menu after a Scene switch) is created already matching
// the current state — see createMenuWrapper()'s own read of this flag.
function setMenuSystemVisible(visible) {
  menuSystemVisible = visible;
  let displayValue = visible ? '' : 'none';
  if (colorGroupMenu) colorGroupMenu.wrapper.style.display = displayValue; // v41.2: one menu per group
  if (layoutGroupMenu) layoutGroupMenu.wrapper.style.display = displayValue;
  if (timingHandle) timingHandle.wrapper.style.display = displayValue;
  if (layoutTimingHandle) layoutTimingHandle.wrapper.style.display = displayValue;
  if (sequenceMenuWrapper) sequenceMenuWrapper.style.display = displayValue;
  if (fullscreenBtn) fullscreenBtn.style.display = visible ? 'flex' : 'none'; // v39.3
  if (rhythmDock) rhythmDock.setMenuButtonVisible(visible); // v35.2: the dock's Timing button is a menu too
  if (safetyControl) safetyControl.setButtonVisible(visible); // v37.1 (the "!" badge stays)
  if (roomMenu) roomMenu.setVisible(visible); // v39.1 (the eye marker follows, see updateRoomEyeMarker())
  if (viewSwitch) viewSwitch.setVisible(visible); // v41.1
  if (displayMenu) displayMenu.setVisible(visible); // v40.4
}

function createDisplayMenu() {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed', left: '200px', bottom: '10px', zIndex: 1000,
    fontFamily: 'sans-serif', fontSize: '12px', display: menuSystemVisible ? '' : 'none',
  });
  document.body.appendChild(wrapper);

  let btn = document.createElement('button');
  btn.textContent = '🖥 Display ▴';
  btn.title = 'Renderer, frame shape, preview sharpness and diagnostics';
  styleToggleButton(btn);
  wrapper.appendChild(btn);

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, { position: 'fixed', top: 'auto', right: 'auto', bottom: '52px', width: '280px', minWidth: '0', boxSizing: 'border-box' });
  wrapper.appendChild(panel);
  attachHoverAutoClose(wrapper, panel);

  function pill(text, tip, onClick) {
    let b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    Object.assign(b.style, {
      flex: '1', padding: '5px 6px', borderRadius: '4px', cursor: 'pointer',
      border: '1px solid #555', fontFamily: 'sans-serif', fontSize: '12px',
    });
    b.addEventListener('click', onClick);
    return b;
  }
  function setActive(b, on) {
    b.style.background = on ? '#e8e8e8' : '#222';
    b.style.color = on ? '#111' : '#fff';
  }
  function row() {
    let r = document.createElement('div');
    Object.assign(r.style, { display: 'flex', gap: '4px' });
    return r;
  }

  let shapeTip = 'Same width, so nothing moves: 16:10 just shows a strip more at the bottom. Switching back restores the exact look. Saved with the show. Sharpness follows the screen it plays on.';
  let shapeHead = harmonySubsectionLabel('Frame shape');
  shapeHead.title = shapeTip;
  panel.appendChild(shapeHead);
  let aspectRow = row();
  let aspectBtns = {};
  Object.keys(DESIGN_FORMATS).forEach((a) => {
    aspectBtns[a] = pill(a + '  (' + DESIGN_W + ' × ' + DESIGN_FORMATS[a] + ')', 'Design grid ' + DESIGN_W + ' × ' + DESIGN_FORMATS[a] + '. ' + shapeTip, () => setDesignAspect(a));
    aspectRow.appendChild(aspectBtns[a]);
  });
  panel.appendChild(aspectRow);

  // v42.0: who fills the screens — the graphics card (WebGL) or Canvas
  let rendHead = harmonySubsectionLabel('Renderer');
  rendHead.title = 'WebGL: the graphics card draws all screens in one go, ✕ / ✚ included (much faster on weaker computers). Canvas: the browser draws them one by one (as before v42). Falls back to Canvas by itself if WebGL stops. Not saved.';
  panel.appendChild(rendHead);
  let rendRow = row();
  let rendBtns = {
    webgl: pill('WebGL', 'The graphics card draws the screens (default). Click again to retry after a fallback.', () => setRendererChoice('webgl')),
    canvas: pill('Canvas', 'The browser draws the screens one by one, as before v42', () => setRendererChoice('canvas')),
  };
  rendRow.appendChild(rendBtns.webgl);
  rendRow.appendChild(rendBtns.canvas);
  panel.appendChild(rendRow);
  // v42.2: smoothing of edges (WebGL), Auto by default
  let smHead = harmonySubsectionLabel('Smoothing (WebGL)');
  smHead.title = 'Smooths the edges of the screens. Auto: off where it makes no visible difference (Flat without ✕ / ✚, and full sharpness on a sharp screen such as a retina Mac, where steps are too small to see); on otherwise (ordinary screens, projectors, reduced sharpness). Choose On for a big projected wall. Not saved.';
  panel.appendChild(smHead);
  let smRow = row();
  let smBtns = {
    auto: pill('Auto', 'Off where it makes no visible difference, on where edges would show steps (default)', () => setGlSmoothing('auto')),
    on: pill('On', 'Always smooth edges (4×). Costs speed at full sharpness on weaker graphics chips.', () => setGlSmoothing('on')),
    off: pill('Off', 'Never smooth: edges step by whole pixels', () => setGlSmoothing('off')),
  };
  smRow.appendChild(smBtns.auto);
  smRow.appendChild(smBtns.on);
  smRow.appendChild(smBtns.off);
  panel.appendChild(smRow);
  // v42.6: the screen limit, measured on this computer (04_room)
  let limHead = harmonySubsectionLabel('Screen limit');
  limHead.title = 'How many screens may be drawn, measured on this computer: as many as fit in ' + SCREEN_LIMIT_MS + ' ms per frame (never fewer than ' + ROOM_SCREEN_BUDGET.toLocaleString() + '). Above it, a note is shown instead of the screens. Learned while it runs and remembered in this browser. Off: draw everything, however slowly (e.g. to check a very fine Scale before exporting). Not saved; video export ignores the limit.';
  panel.appendChild(limHead);
  let limRow = row();
  let limBtns = {
    auto: pill('Auto', 'As many screens as this computer draws in ' + SCREEN_LIMIT_MS + ' ms per frame (default)', () => setScreenLimitOn(true)),
    off: pill('Off', 'Draw every screen, however slowly. Not saved: starts on Auto every time.', () => setScreenLimitOn(false)),
  };
  limRow.appendChild(limBtns.auto);
  limRow.appendChild(limBtns.off);
  panel.appendChild(limRow);

  panel.appendChild(harmonySubsectionLabel('Preview sharpness'));
  let sharpRow = row();
  let sharpBtns = {
    auto: pill('Auto', 'Full sharpness, stepping down to ¾ and then ½ only while frames are being dropped, and back up when there is room. Changes are judged over seconds, never on a single slow frame.', () => setPreviewSharpness('auto')), // v41.7
    full: pill('Full', 'Always as sharp as this screen allows', () => setPreviewSharpness('full')),
    half: pill('Half', 'Always a quarter of the pixels: smoother on slow computers, slightly soft. Preview only — video exports always render at full sharpness.', () => setPreviewSharpness('half')),
  };
  sharpRow.appendChild(sharpBtns.auto);
  sharpRow.appendChild(sharpBtns.full);
  sharpRow.appendChild(sharpBtns.half);
  panel.appendChild(sharpRow);
  let sharpNote = document.createElement('div');
  sharpNote.textContent = 'Preview only. Video exports always render at full sharpness.';
  Object.assign(sharpNote.style, { fontSize: '11px', color: '#aaa', lineHeight: '1.4' });
  panel.appendChild(sharpNote);

  // v40.15: the diagnostics report (see DIAGNOSTICS)
  panel.appendChild(harmonySubsectionLabel('Diagnostics'));
  let diagRow = row();
  let diagBtn = pill('📋 Copy diagnostics', 'Copies a text report of the last ' + Math.round(DIAG_KEEP_SAMPLES * DIAG_SAMPLE_MS / 60000) + ' minutes: performance every ' + (DIAG_SAMPLE_MS / 1000) + ' s, settings and what changed. Paste it into the chat.', () => copyDiagnostics(diagBtn));
  setActive(diagBtn, false);
  diagRow.appendChild(diagBtn);
  panel.appendChild(diagRow);
  // v40.21: ✕ / ✚ cut-line test
  let cutsHead = harmonySubsectionLabel('✕ / ✚ cut lines (test)');
  cutsHead.title = 'Clean: each region drawn on a hidden layer and pasted (no lines). Direct: drawn straight onto the picture (a faint line can show along the cuts). Only to measure what the layers cost; Canvas renderer only; not saved.';
  panel.appendChild(cutsHead);
  let cutsRow = row();
  let cutsBtns = {
    clean: pill('Clean (layers)', 'Normal: no line along the cuts', () => { radiateDirect = false; refresh(); }),
    direct: pill('Direct (test)', 'No hidden layers or pastes; a faint line may show along the cuts', () => { radiateDirect = true; refresh(); }),
  };
  cutsRow.appendChild(cutsBtns.clean);
  cutsRow.appendChild(cutsBtns.direct);
  panel.appendChild(cutsRow);

  // Sits just right of the Safety button, whose width changes with its text.
  function place() {
    let sw = safetyControl && safetyControl.wrapper;
    let left = sw ? sw.getBoundingClientRect().right + 6 : 200;
    if (sw && sw.style.display === 'none') left = 46;
    wrapper.style.left = left + 'px';
    panel.style.left = left + 'px';
  }
  if (safetyControl && safetyControl.wrapper && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(place).observe(safetyControl.wrapper);
  }

  function refresh() {
    Object.keys(aspectBtns).forEach((a) => setActive(aspectBtns[a], a === designAspect));
    setActive(rendBtns.webgl, rendererChoice === 'webgl'); setActive(rendBtns.canvas, rendererChoice === 'canvas'); // v42.0
    rendBtns.webgl.textContent = rendererChoice === 'webgl' && glr.failed ? 'WebGL (off — retry)' : 'WebGL';
    setActive(sharpBtns.auto, previewSharpness === 'auto'); // v41.7: shows the level it is at
    sharpBtns.auto.textContent = previewSharpness === 'auto' && autoSharp.level > 0 ? 'Auto · ' + AUTO_SHARP_LABELS[autoSharp.level] : 'Auto';
    setActive(sharpBtns.full, previewSharpness === 'full');
    setActive(sharpBtns.half, previewSharpness === 'half');
    setActive(cutsBtns.clean, !radiateDirect); setActive(cutsBtns.direct, radiateDirect); // v40.21
    setActive(smBtns.auto, glSmoothing === 'auto'); setActive(smBtns.on, glSmoothing === 'on'); setActive(smBtns.off, glSmoothing === 'off'); // v42.2
    smBtns.auto.textContent = glSmoothing === 'auto' && glr.gl ? 'Auto · ' + (glr.samples ? glr.samples + '×' : 'off') : 'Auto';
    setActive(limBtns.auto, screenLimitOn); setActive(limBtns.off, !screenLimitOn); // v42.6
    limBtns.auto.textContent = screenLimitOn && typeof frameMapping !== 'undefined' && frameMapping ? 'Auto · ' + screenLimitFor(screenLimitMode(frameMapping)).toLocaleString() : 'Auto';
    place();
  }
  function setVisible(visible) { wrapper.style.display = visible ? '' : 'none'; place(); }

  refresh();
  return { refresh, setVisible };
}

// v40.7: with Radiate, what each surface does, for the surface table:
// the centre radiates (out, or in with Direction Down); others list the
// directions of the regions that reach them.
