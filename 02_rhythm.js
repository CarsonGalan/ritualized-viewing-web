// noprotect
// Ritualized Viewing v43.1 — 02_rhythm.js
// Timing engine (channels, Flicker / Slow, Hz clock, display rate), scroll Pulse / Free, set cycles & blends, Projection changes (cut / fade), safety limit + startup warning.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- v35.3: TIMING CHANNELS ----------------------
// Colour and Layout share ONE timing engine. Each is a "channel": a small
// adapter that reads/writes that group's own fields, so every function
// below works for both. Modes (per scene):
//   'flicker' — frame-locked rate (FLASH_HZ_VALUES) + fade share; the
//               hold/transition seconds are DERIVED from them.
//   'slow'    — hold/transition seconds are the source of truth
//               (ms-based); hz/fade just remember the last Flicker values.
// Arrow functions read the live globals at call time, so it doesn't
// matter that layoutGroup is created further down the file.
function makeTimingChannel(cfg) {
  return Object.assign({
    clock: { epochFrame: 0, lastSeenEpochMs: null }, // frame-locked epoch (see timingElapsedFrames)
    changes: { times: [], lastFrom: null },          // measured rate (see timingRecordChange)
  }, cfg);
}
const colorTimingChannel = makeTimingChannel({
  label: 'Colour', noun: 'colour',
  getMode: () => colorTimingMode, setModeRaw: (m) => { colorTimingMode = m; },
  getHz: () => colorFlashHz, setHz: (v) => { colorFlashHz = v; },          // the LISTED rate
  getNudge: () => colorNudgeHz, setNudge: (v) => { colorNudgeHz = v; },    // v35.6
  getFade: () => colorFadeShare, setFade: (v) => { colorFadeShare = v; },
  getHold: () => changeIntervalSec, setHold: (v) => { changeIntervalSec = v; },
  getTrans: () => transitionDurationSec, setTrans: (v) => { transitionDurationSec = v; },
  getSlowHold: () => colorSlowHoldSec, setSlowHold: (v) => { colorSlowHoldSec = v; },   // v35.5
  getSlowTrans: () => colorSlowTransSec, setSlowTrans: (v) => { colorSlowTransSec = v; }, // v35.5
  getSets: () => colorSets,
  getEpochMs: () => colorEpochMs, setEpochMs: (v) => { colorEpochMs = v; },
  sync: () => syncActiveSceneColorTiming(),
});
const layoutTimingChannel = makeTimingChannel({
  label: 'Layout', noun: 'layout',
  getMode: () => layoutGroup.timingMode, setModeRaw: (m) => { layoutGroup.timingMode = m; },
  getHz: () => layoutGroup.flashHz, setHz: (v) => { layoutGroup.flashHz = v; },
  getNudge: () => layoutGroup.nudgeHz || 0, setNudge: (v) => { layoutGroup.nudgeHz = v; }, // v35.6
  getFade: () => layoutGroup.fadeShare, setFade: (v) => { layoutGroup.fadeShare = v; },
  getHold: () => layoutGroup.changeIntervalSec, setHold: (v) => { layoutGroup.changeIntervalSec = v; },
  getTrans: () => layoutGroup.transitionDurationSec, setTrans: (v) => { layoutGroup.transitionDurationSec = v; },
  getSlowHold: () => layoutGroup.slowHoldSec, setSlowHold: (v) => { layoutGroup.slowHoldSec = v; },     // v35.5
  getSlowTrans: () => layoutGroup.slowTransSec, setSlowTrans: (v) => { layoutGroup.slowTransSec = v; }, // v35.5
  getSets: () => layoutGroup.sets,
  getEpochMs: () => layoutEpochMs, setEpochMs: (v) => { layoutEpochMs = v; },
  sync: () => syncActiveSceneLayoutTiming(),
});

// v36: the scroll Pulse clock is a third channel. It only uses the
// clock parts of the engine (rate, Nudge, epoch, frame-locked position):
// one STEP of its position = one pulse (tick), exactly like one colour
// change — which is why 1 Hz = 2 pulses per second.
const scrollTimingChannel = makeTimingChannel({
  label: 'Scroll', noun: 'scroll',
  getMode: () => scrollTimingMode, setModeRaw: (m) => { scrollTimingMode = m; },
  getHz: () => scrollFlashHz, setHz: (v) => { scrollFlashHz = v; },
  getNudge: () => scrollNudgeHz, setNudge: (v) => { scrollNudgeHz = v; },
  getEpochMs: () => scrollEpochMs, setEpochMs: (v) => { scrollEpochMs = v; },
  sync: () => syncActiveSceneScrollTiming(),
});

// v36: modes whose clock counts screen refreshes (Flicker, scroll Pulse).
function timingIsFrameLocked(ch) {
  let m = ch.getMode();
  return m === 'flicker' || m === 'pulse';
}

// v37.3: Nudge's reach scales with the listed rate — at most ± half of
// it (0.4×, so the slowest rate can't hit the 0.02 Hz floor), and never
// beyond ±1 Hz — so it stays a FINE adjustment at slow rates.
function timingNudgeLimit(hz) {
  return Math.min(NUDGE_MAX_HZ, hz * 0.4);
}
function timingNudgeStep(hz) {
  let L = timingNudgeLimit(hz);
  if (L >= 0.5) return 0.05;
  if (L >= 0.1) return 0.01;
  if (L >= 0.02) return 0.002;
  return 0.0005;
}
// Rounds a Nudge to the current step and trims it to the current reach.
function timingRoundNudge(ch, v) {
  let hz = ch.getHz(), L = timingNudgeLimit(hz), st = timingNudgeStep(hz);
  let n = Math.round((v || 0) / st) * st;
  return Math.round(Math.min(Math.max(n, -L), L) * 1e6) / 1e6;
}
// The Nudge actually in effect (stored value trimmed to this rate's reach).
function timingActiveNudge(ch) {
  let L = timingNudgeLimit(ch.getHz());
  return Math.min(Math.max(ch.getNudge() || 0, -L), L);
}
// Listed rate + Nudge (trimmed to its reach), never below the floor.
function nudgedHz(hz, nudge) {
  let L = timingNudgeLimit(hz);
  let n = Math.min(Math.max(nudge || 0, -L), L);
  return Math.max(hz + n, MIN_EFFECTIVE_FLICKER_HZ);
}

// v35.6: the rate Flicker actually plays = listed rate + Nudge.
function timingEffectiveHz(ch) {
  return nudgedHz(ch.getHz(), ch.getNudge());
}

// v35.6: changes the Flicker rate WITHOUT jumping: the cycle keeps its
// current position and simply continues at the new speed. (Without this,
// position = elapsed × rate, so any rate change teleported the cycle to
// an arbitrary point — awkward while watching a beat and adjusting it.)
function timingChangeRateSmoothly(ch, mutate) {
  if (!timingIsFrameLocked(ch)) { mutate(); return; } // v36: scroll Pulse too
  let now = sketchNow(); // v43.0
  let x = timingStepPosition(ch, now, 0);
  mutate();
  timingReanchor(ch, x, now);
}

// v37.1: puts a frame-locked channel back at step position `x` at the
// CURRENT played rate — the shared core of smooth rate changes and of
// the safety limit changing its slow-down factor.
function timingReanchor(ch, x, now) {
  let stepsPerFrame = (2 * timingPlayedEffHz(ch)) / displayInfo.nominalHz;
  let elapsedFrames = x / stepsPerFrame;           // may be fractional — that's fine
  ch.setEpochMs(now - elapsedFrames * nominalFramePeriodMs());
  ch.clock.epochFrame = vsyncCount - elapsedFrames;
  ch.clock.lastSeenEpochMs = ch.getEpochMs();
}

// v37.1: the rate actually PLAYED = designed rate × the safety limit's
// slow-down factor (1 when nothing is limited).
function timingPlayedEffHz(ch) {
  return timingEffectiveHz(ch) * safetyFactor;
}

// Keeps the seconds in step with the rate, so everything that still reads
// seconds (jump-to-set, scene cycle counting, scene crossfades, Save/Load)
// stays correct in Flicker mode.
function timingDeriveSeconds(ch) {
  let step = 1 / (2 * timingPlayedEffHz(ch)); // v37.1: played (safety-limited) rate
  ch.setHold(step * (1 - ch.getFade()));
  ch.setTrans(step * ch.getFade());
}

// v35.5: sets the ACTIVE hold/transition seconds from whichever mode is
// selected — the rate in Flicker, the remembered Hold/Fade in Slow change.
function timingApplyActive(ch) {
  if (ch.getMode() === 'flicker') {
    timingDeriveSeconds(ch);
  } else {
    // v37.1: the safety limit stretches Slow change's seconds when needed.
    ch.setHold(ch.getSlowHold() / safetyFactor);
    ch.setTrans(ch.getSlowTrans() / safetyFactor);
  }
}

// v37.1: the DESIGNED hold/fade seconds (what's saved), whatever the
// safety limit is currently doing to playback.
function timingDesignSeconds(ch) {
  if (ch.getMode() === 'flicker') {
    let step = 1 / (2 * timingEffectiveHz(ch));
    return { hold: step * (1 - ch.getFade()), trans: step * ch.getFade() };
  }
  return { hold: ch.getSlowHold(), trans: ch.getSlowTrans() };
}

// v35.5: restarts the cycle so the set currently on screen begins NOW
// with the current timing — no leftover hold time from before.
function timingRestartFromVisible(ch, setIndex, now) {
  let idxs = enabledIndices(ch.getSets());
  let p = Math.max(idxs.indexOf(setIndex), 0);
  let stepMs = (Math.max(ch.getHold(), 0) + Math.max(ch.getTrans(), 0)) * 1000;
  ch.setEpochMs(now - p * stepMs);
  if (ch.getMode() === 'flicker') {
    // Convert to screen updates directly (rounding UP), so the restart
    // lands inside that set's step rather than one update before it.
    let stepFrames = displayInfo.nominalHz / (2 * timingPlayedEffHz(ch)); // v37.1
    ch.clock.epochFrame = vsyncCount - Math.ceil(p * stepFrames - 1e-9);
    ch.clock.lastSeenEpochMs = ch.getEpochMs();
  }
}

// v35.5: switching mode just picks the other mode's REMEMBERED settings
// (nothing is converted or overwritten), and the new mode takes over
// immediately from the set currently on screen.
function timingSetMode(ch, mode) {
  if (mode === ch.getMode()) return;
  let now = sketchNow(); // v43.0
  let st = timingCycleState(ch, now, 0);
  let visible = st.blend >= 0.5 ? st.toIndex : st.fromIndex;
  ch.setModeRaw(mode);
  timingApplyActive(ch);
  timingRestartFromVisible(ch, visible, now);
}

// Equivalent flash rate, either mode (readout + safety colouring).
// v37.1: always the DESIGNED rate (Slow change reads its own memory, not
// the possibly safety-stretched active seconds). Played = × safetyFactor.
function timingRequestedHz(ch) {
  if (timingIsFrameLocked(ch)) return timingEffectiveHz(ch); // v36.2: scroll Pulse too
  if (ch === scrollTimingChannel) return NaN;                 // Free scroll: no shared rate
  let step = Math.max(ch.getSlowHold(), 0) + Math.max(ch.getSlowTrans(), 0);
  return step > 0 ? 1 / (2 * step) : Infinity;
}

// Colour wrappers kept so existing call sites read naturally.
function deriveSecondsFromHz() { timingDeriveSeconds(colorTimingChannel); }
function setColorTimingMode(mode) { timingSetMode(colorTimingChannel, mode); }
function currentRequestedFlashHz() { return timingRequestedHz(colorTimingChannel); }

// ---------------------- v35: DISPLAY MEASUREMENT ----------------------
// draw() runs once per screen refresh (see setup()'s frameRate call),
// so the time between frames reveals the screen's refresh rate. We take
// the MEDIAN of recent frame times (robust to the odd slow frame) and
// snap it to the nearest common rate, e.g. 59.94 -> 60.
const UNCAPPED_FRAME_RATE = 1000; // p5 only draws every refresh if its target is above the screen rate
const COMMON_REFRESH_RATES = [24, 25, 30, 48, 50, 60, 72, 75, 85, 90, 100, 120, 144, 165, 170, 175, 180, 200, 240, 360];
const DISPLAY_SAMPLE_COUNT = 120;
let displayInfo = {
  measuredHz: 60,   // raw median-based estimate
  nominalHz: 60,    // snapped value used for frame-locked timing
  ready: false,     // false until enough frames have been sampled
  fps: 60,          // frames actually drawn in the last second
  droppedRecent: 0, // refreshes missed in the last 10 s
};
let displaySamples = [];
let displayFrameTimes = [];  // timestamps of recent frames (fps)
let displayDropTimes = [];   // { t, n } recent missed refreshes
let displayFramesSinceEstimate = 0;

// Counts REAL screen refreshes since start, including ones we failed
// to draw (a 33 ms gap on a 60 Hz screen adds 2). Frame-locked timing
// counts in these units, so a dropped frame skips ahead instead of
// making the flicker run slow.
let vsyncCount = 0;

function nominalFramePeriodMs() {
  return 1000 / displayInfo.nominalHz;
}

// v42.4.1: 60 Hz snaps within 6 % (56.6–63.8), others within 3 % — a 60 Hz
// screen sometimes measured 63 and was shown (and timed) as 63 Hz.
function snapRefreshRate(hz) {
  let best = null;
  COMMON_REFRESH_RATES.forEach((r) => {
    let tol = r === 60 ? 0.06 : 0.03;
    if (Math.abs(r - hz) / r < tol && (best === null || Math.abs(r - hz) < Math.abs(best - hz))) best = r;
  });
  return best !== null ? best : Math.round(hz);
}

// v40.15: the screen's refresh period, judged by its FASTEST REGULAR
// frames. Before, the typical (median) frame gap was used, so when more
// than half the frames missed their slot (a heavy picture), a 60 Hz screen
// read as "30 Hz ⚠" and the dropped counter went quiet. Now: find the
// fastest group of frame gaps that is common enough (at least 5% of the
// last 120 frames) and take its typical value. A genuinely slower screen
// (e.g. a projector at 50 Hz) has no faster frames, so it still reads
// correctly.
function estimateRefreshPeriod(samples) {
  let s = samples.slice().sort((a, b) => a - b), n = s.length;
  if (!n) return 1000 / 60;
  let need = Math.max(5, Math.ceil(n * 0.05));
  for (let q of [0.05, 0.1, 0.2, 0.35]) {
    let lo = s[Math.floor(n * q)];
    if (!(lo > 4)) continue; // ignore odd near-zero gaps
    let group = s.filter((v) => v >= lo * 0.8 && v <= lo * 1.25);
    if (group.length >= need) return group[Math.floor(group.length / 2)];
  }
  return s[Math.floor(n / 2)];
}

// v40.16: do most frame gaps sit on whole multiples of `periodMs`?
let displayLowerVotes = 0;
function gapsFitPeriod(samples, periodMs) {
  if (!samples.length) return true;
  let fit = 0;
  samples.forEach((g) => { let k = g / periodMs, r = Math.round(k); if (r >= 1 && Math.abs(k - r) < 0.15) fit++; });
  return fit >= samples.length * 0.8;
}
// v40.16: changing the screen rate keeps every rhythm where it is. The
// Flicker / Pulse clocks count screen refreshes and turn them into
// positions using the screen rate; a rate change used to make positions
// jump (60 → 30 doubled them; back to 60 halved them, so Pulse went
// silent until it caught up: the "long pauses"). Now each clock's count
// is rescaled so its position stays put.
function setNominalHz(newHz) {
  let oldHz = displayInfo.nominalHz;
  if (oldHz > 0 && newHz > 0 && oldHz !== newHz) {
    [colorTimingChannel, layoutTimingChannel, scrollTimingChannel].forEach((ch) => {
      if (!ch || !ch.clock) return;
      let elapsed = vsyncCount - ch.clock.epochFrame;
      ch.clock.epochFrame = vsyncCount - Math.round(elapsed * newHz / oldHz);
    });
    if (typeof diagEvent === 'function') diagEvent('screen rate ' + oldHz + ' Hz → ' + newHz + ' Hz');
  }
  displayInfo.nominalHz = newHz;
}

function updateDisplayMeasurement(dt, now) {
  // v43.1: exporting = one frame is one refresh at the export rate (no
  // measuring); the first live frame after it steps one refresh (its gap
  // is the whole export).
  if (exportState.on) { vsyncCount++; return; }
  if (exportState.after) { exportState.after = false; if (!pauseState.paused) vsyncCount++; return; }
  if (!Number.isFinite(dt) || dt <= 0) return;

  // Ignore pauses (hidden tab, dragged window) — not refresh-rate data.
  if (dt < 100) {
    displaySamples.push(dt);
    if (displaySamples.length > DISPLAY_SAMPLE_COUNT) displaySamples.shift();
  }

  displayFramesSinceEstimate++;
  if (displaySamples.length >= 30 && displayFramesSinceEstimate >= 15) {
    displayFramesSinceEstimate = 0;
    displayInfo.measuredHz = 1000 / estimateRefreshPeriod(displaySamples); // v40.15
    let cand = snapRefreshRate(displayInfo.measuredHz), cur = displayInfo.nominalHz;
    // v40.16: the rate goes UP at once, but only goes DOWN when the frame
    // gaps stop fitting the current rate. On a busy 60 Hz screen every gap
    // is still a whole number of refreshes (33, 50, 67 ms…), so it stays
    // 60. A real change (a 50 Hz projector: 20, 40 ms) doesn't fit and is
    // accepted after 3 checks in a row (~¾ s).
    let accept = !displayInfo.ready || cand > cur;
    if (!accept && cand < cur) {
      if (!gapsFitPeriod(displaySamples, 1000 / cur)) displayLowerVotes++;
      else displayLowerVotes = 0;
      accept = displayLowerVotes >= 3;
    } else displayLowerVotes = 0;
    if (accept && cand !== cur) setNominalHz(cand);
    displayInfo.ready = true;
  }

  let refreshesElapsed = Math.max(1, Math.round(dt / nominalFramePeriodMs()));
  if (!pauseState.paused) vsyncCount += refreshesElapsed; // v43.0: paused = the frame-locked rhythms stand still (the rate is still measured)
  if (refreshesElapsed > 1 && dt < 1000) displayDropTimes.push({ t: now, n: refreshesElapsed - 1 });

  displayFrameTimes.push(now);
  while (displayFrameTimes.length && now - displayFrameTimes[0] > 1000) displayFrameTimes.shift();
  while (displayDropTimes.length && now - displayDropTimes[0].t > 10000) displayDropTimes.shift();
  displayInfo.fps = displayFrameTimes.length;
  displayInfo.droppedRecent = displayDropTimes.reduce((sum, d) => sum + d.n, 0);
}

// How well a screen refreshing `screenHz` times per second can show a
// flash rate of `f` Hz:
//   'clean'      — each colour gets the same whole number of refreshes
//   'lopsided'   — steady, but one colour lasts one refresh longer ("~")
//   'inbetween'  — (v35.6) no steady pattern, but each step lasts N or
//                  N+1 updates with N >= 2: mildly uneven
//   'stutter'    — steps of 1 and 2 updates: visibly rough
//   'impossible' — faster than the screen can alternate (above half its
//                  rate); what you actually see is a slower BEAT
// `beatHz` (impossible only) is that visible beat — the distance to the
// nearest multiple of the screen rate (48 Hz on 60 Hz -> 12 Hz).
function classifyFlashHz(f, screenHz) {
  if (!(f > 0) || !Number.isFinite(f)) return { kind: 'clean', beatHz: null };
  if (f > screenHz / 2 + 1e-6) {
    return { kind: 'impossible', beatHz: Math.abs(f - screenHz * Math.round(f / screenHz)) };
  }
  let framesPerFlash = screenHz / f;
  if (Math.abs(framesPerFlash - Math.round(framesPerFlash)) < 1e-6) {
    return { kind: Math.round(framesPerFlash) % 2 === 0 ? 'clean' : 'lopsided', beatHz: null };
  }
  // Slow rates: each colour lasts many refreshes, so a one-refresh
  // wobble now and then is invisible — treat as clean.
  let stepFrames = framesPerFlash / 2;
  if (stepFrames >= 8) return { kind: 'clean', beatHz: null };
  // v35.6: in-between rates mix two step lengths. Mixing 2s and 3s (or
  // longer) is mild — 'inbetween', a calm note. Mixing 1s and 2s is a 2×
  // difference — visibly rough — 'stutter', purple.
  let lo = Math.floor(stepFrames);
  if (lo >= 2) return { kind: 'inbetween', beatHz: null, lo, hi: lo + 1 };
  return { kind: 'stutter', beatHz: null, lo, hi: lo + 1 };
}

// Flash-safety colouring shared by the counter: red at the most
// sensitive point (15–20 Hz), orange anywhere in the risk zone (above 3
// up to 60 Hz), null = no warning.
const FLASH_ORANGE = '#ff9a2e';
const FLASH_RED = '#ff4a4a';
const FLASH_PURPLE = '#b98cff';
function flashDangerLevel(f) {
  if (!(f > 3) || !Number.isFinite(f)) return 0;
  if (f > 15 && f <= 20) return 2; // v37.1: 15 itself counts as orange, matching Avoid peak's band (15, 20]
  if (f <= 60) return 1;
  return 0;
}
function flashDangerColor(level) {
  return level === 2 ? FLASH_RED : level === 1 ? FLASH_ORANGE : null;
}

function formatHz(f) {
  if (!Number.isFinite(f)) return '—';
  if (f >= 1) return (Math.round(f * 100) / 100).toString(); // v35.6: 2 decimals so nudged rates read exactly
  return (Math.round(f * 1000) / 1000).toString();
}
function formatDurationSec(sec) {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 1) return Math.round(sec * 1000 * 10) / 10 + ' ms';
  return Math.round(sec * 100) / 100 + ' s';
}

// --- Deterministic pseudo-random helper ---
// Used ONLY to seed a module's very first swipe time/colour, so the
// initial frame doesn't look synchronized. Everything a module does
// after that first event comes from live Math.random() draws stored
// in its own state, not from this hash.
function hashFrac(n) {
  let s = Math.sin(n) * 43758.5453;
  return s - Math.floor(s);
}
function cellHash(c, r, salt) {
  return hashFrac(c * 127.1 + r * 311.7 + salt * 74.7);
}

function randomWaitTime() {
  // v36: the two waits are separate sliders, so tolerate min > max.
  let lo = Math.min(minWaitTime, maxWaitTime), hi = Math.max(minWaitTime, maxWaitTime);
  return lo + Math.random() * (hi - lo);
}

// ---------------------- v36: SCROLL PULSE ENGINE ----------------------
// Ranges for the scroll sliders (also used to clamp loaded files).
const SCROLL_WAIT_MIN_MS = 100, SCROLL_WAIT_MAX_MS = 15000;
const SCROLL_SWIPE_MIN_MS = 50, SCROLL_SWIPE_MAX_MS = 2000;
const SCROLL_PULSE_MAX_BACKLOG = 3;   // after a pause (hidden tab), don't fire a burst of missed ticks
const SCROLL_SWIPE_WARN_FRAMES = 5;   // shorter swipes than this are hard to see

let scrollPulseState = { lastTick: -1, seed: 0 };
// Keys ("c_r") of the modules actually visible on the canvas LAST frame —
// the pool a pulse picks from (refilled every frame in drawScreenModule()).
let scrollVisibleKeys = [];
let scrollVisibleKeysNext = [];

// Restarts the pulse clock: tick 0 is now. Called when Pulse is switched
// on and when a scene loads. (A rate/Nudge change does NOT call this —
// timingChangeRateSmoothly() keeps the tick count running.)
function resetScrollPulseClock(now) {
  scrollEpochMs = now;
  scrollTimingChannel.clock.lastSeenEpochMs = null; // force timingElapsedFrames() to re-read the epoch
  scrollPulseState.lastTick = -1;
  scrollPulseState.seed = Math.random() * 1000;
}

// Where tick k sits, in steps (pulses). Without Wobble, exactly k. Wobble
// moves it by up to ±half a step, from a per-tick hash — so each tick's
// offset is fixed (no drift, no accumulated error) and two ticks can
// never swap order (k + 0.5 <= (k + 1) - 0.5).
function scrollTickPosition(k) {
  if (scrollWobble <= 0) return k;
  let j = hashFrac(k * 78.233 + scrollPulseState.seed * 12.9898) * 2 - 1; // -1..1
  return k + 0.5 * scrollWobble * j;
}

// Called once per frame from draw(), before the modules are drawn. Fires
// every tick whose position has been reached since last frame.
function updateScrollPulse(now) {
  if (scrollTimingMode !== 'pulse') return;
  let ch = scrollTimingChannel;
  let x = timingStepPosition(ch, now, 0);
  let ps = scrollPulseState;
  if (x - ps.lastTick > SCROLL_PULSE_MAX_BACKLOG) ps.lastTick = Math.floor(x) - 1;
  let stepsPerMs = (2 * timingPlayedEffHz(ch)) / 1000; // v37.1: played rate
  let gapMs = 1 / stepsPerMs;
  for (let guard = 0; guard < SCROLL_PULSE_MAX_BACKLOG + 2; guard++) {
    let k = ps.lastTick + 1;
    let pos = scrollTickPosition(k);
    if (x + 1e-7 < pos) break;
    ps.lastTick = k;
    timingRecordTick(ch, now); // v36.2: measured pulse rate
    // The tick's exact moment may fall between two frames — start the
    // swipes from that moment, so the rhythm doesn't wobble by a frame.
    fireScrollPulse(now - (x - pos) / stepsPerMs, gapMs);
  }
}

// One tick: picks round(coverage × visible screens) screens at random
// from those not already mid-swipe (or waiting to start), and schedules
// each one's swipe. Spread adds a random LATE delay per screen; the
// swipe then shortens so delay + swipe still fits inside the gap.
function fireScrollPulse(tickMs, gapMs) {
  let visibleCount = scrollVisibleKeys.length;
  if (visibleCount === 0 || scrollCoverage <= 0) return;
  let pool = [];
  scrollVisibleKeys.forEach((key) => {
    let s = moduleStates.get(key);
    if (s && !s.swiping && s.pendingStartMs == null) pool.push(s);
  });
  let count = Math.min(Math.round(scrollCoverage * visibleCount), pool.length);
  let minSwipeMs = 2 * nominalFramePeriodMs();
  for (let i = 0; i < count; i++) {
    let j = i + Math.floor(Math.random() * (pool.length - i)); // partial Fisher–Yates
    let s = pool[j]; pool[j] = pool[i]; pool[i] = s;
    let delay = Math.random() * scrollSpread * gapMs;
    let dur = Math.min(scrollSwipeShare * gapMs, gapMs - delay);
    s.pendingStartMs = tickMs + delay;
    s.pendingDurMs = Math.max(dur, minSwipeMs);
  }
}

// Switching to Free: forget any scheduled pulse swipes and scatter every
// idle screen's next swipe, so they don't all fire at once from timers
// that expired while Pulse was running.
function rescatterFreeScrollTimers(now) {
  moduleStates.forEach((s) => {
    s.pendingStartMs = null;
    if (!s.swiping) s.nextSwipeTime = now + Math.random() * Math.max(minWaitTime, maxWaitTime);
  });
}

function scrollSetMode(mode) {
  if (mode === scrollTimingMode) return;
  scrollTimingMode = mode;
  let now = sketchNow(); // v43.0
  if (mode === 'pulse') resetScrollPulseClock(now);
  else rescatterFreeScrollTimers(now);
}

// Loads a scene's scroll settings (already migrated) into the live globals.
function applyScrollTimingData(st, now) {
  let prevMode = scrollTimingMode;
  scrollTimingMode = st.mode === 'pulse' ? 'pulse' : 'free';
  minWaitTime = st.minWaitMs; maxWaitTime = st.maxWaitMs; swipeDuration = st.swipeMs;
  scrollFlashHz = FLASH_HZ_VALUES.includes(st.flashHz) ? st.flashHz : DEFAULT_SCROLL_TIMING.flashHz;
  scrollNudgeHz = Number.isFinite(st.nudgeHz) ? st.nudgeHz : 0;
  scrollCoverage = st.coverage; scrollSwipeShare = st.swipeShare;
  scrollWobble = st.wobble; scrollSpread = st.spread;
  if (scrollTimingMode === 'pulse') resetScrollPulseClock(now); // scene restarts its own rhythm
  else if (prevMode !== 'free') rescatterFreeScrollTimers(now);
}

function syncActiveSceneScrollTiming() {
  let scene = sequenceScenes[sequenceState.currentSceneIndex];
  if (!scene) return;
  scene.scrollTiming = scrollTimingSnapshot();
}

// Picks a random palette index guaranteed to differ from `current`
// (falls back to 0 if the palette is currently a single colour).
function randomOtherColorIndex(current) {
  let n = palette.length;
  if (n <= 1) return 0;
  let idx = Math.floor(Math.random() * n);
  if (idx === current) idx = (idx + 1) % n;
  return idx;
}

// Safe palette lookup: wraps out-of-range indices instead of throwing,
// since `palette`'s length can change live as colours are added/removed.
function paletteAt(i) {
  let n = palette.length;
  if (n === 0) return colBg;
  return palette[((i % n) + n) % n];
}

// v42.3: a screen's key is a NUMBER, not the text "c_r" (no new text per
// screen per frame). Unique while |r| < 32768 (rows are in the hundreds).
function moduleKey(c, r) {
  return c * 65536 + r;
}
// v42.3: the updates below return this ONE reused object (the caller
// copies its three values out at once), not a new object per screen.
const moduleResult = { currentColor: null, nextColor: null, progress: 0 };
function moduleResultSet(currentColor, nextColor, progress) {
  moduleResult.currentColor = currentColor;
  moduleResult.nextColor = nextColor;
  moduleResult.progress = progress;
  return moduleResult;
}

function getModuleState(c, r, now) {
  let key = moduleKey(c, r); // v42.3
  let state = moduleStates.get(key);
  if (!state) {
    // First time this module has ever been drawn: seed it deterministically
    // from its position so the very first swipe is scattered rather than
    // synchronized, without needing to store anything expensive yet.
    let n = Math.max(palette.length, 1);
    let initialColorIndex = Math.floor(cellHash(c, r, 1) * n);
    let initialDelay = cellHash(c, r, 2) * initialStaggerSpread;
    state = {
      colorIndex: initialColorIndex,
      nextColorIndex: initialColorIndex,
      swiping: false,
      swipeStartTime: 0,
      nextSwipeTime: now + initialDelay,
    };
    moduleStates.set(key, state);
  }
  state.lastSeenMs = now; // v30: see pruneModuleStates()
  return state;
}

// Advances one module's independent state machine and returns the info
// needed to draw it: { currentColor, nextColor, progress (0..1) }.
function updateModuleIndependent(c, r, now) {
  let state = getModuleState(c, r, now);

  if (!state.swiping) {
    // v36: a swipe starts either from a pulse (scheduled start + length,
    // see fireScrollPulse()) or, in Free mode, from this module's own timer.
    let startAt = null, dur = swipeDuration;
    if (state.pendingStartMs != null) {
      if (now >= state.pendingStartMs) {
        startAt = state.pendingStartMs;
        dur = state.pendingDurMs;
        state.pendingStartMs = null;
      }
    } else if (scrollTimingMode === 'free' && now >= state.nextSwipeTime) {
      startAt = now;
    }
    if (startAt !== null) {
      // Time to start a new swipe. Pick a fresh destination colour and
      // mark the start time — this is the only per-event random draw.
      state.swiping = true;
      state.swipeStartTime = startAt;
      state.swipeDurMs = dur;
      state.nextColorIndex = randomOtherColorIndex(state.colorIndex);
    } else {
      // Idle: fully showing its current colour, no bar visible.
      let cur = paletteAt(state.colorIndex);
      return moduleResultSet(cur, cur, 0); // v42.3
    }
  }

  // Mid-swipe (or just started this frame).
  // v42.3: Math.min / max, not p5's constrain() (same result; p5's full
  // build checks every call's arguments, thousands of times a frame)
  let rawProgress = Math.max(Math.min((now - state.swipeStartTime) / Math.max(state.swipeDurMs || swipeDuration, 1), 1), 0);
  let progress = easeInOutCubic(rawProgress);

  if (rawProgress >= 1) {
    // Swipe just finished: commit the new colour and draw this module's
    // next random wait — independently of every other module.
    state.colorIndex = state.nextColorIndex;
    state.swiping = false;
    state.nextSwipeTime = now + randomWaitTime();
    let cur = paletteAt(state.colorIndex);
    return moduleResultSet(cur, cur, 0); // v42.3
  }

  return moduleResultSet(paletteAt(state.colorIndex), paletteAt(state.nextColorIndex), progress); // v42.3
}

// Synchronized fallback used only when staggeredMode = false, for testing.
function updateModuleSynced(c, r, now) {
  let completedSwipes = Math.floor(now / syncInterval);
  let tMod = now - completedSwipes * syncInterval;
  let rawProgress = Math.max(Math.min(tMod / swipeDuration, 1), 0); // v42.3
  let progress = easeInOutCubic(rawProgress);

  let n = Math.max(palette.length, 1);
  let curIdx  = Math.floor(cellHash(c, r, completedSwipes * 2) * n);
  let nextIdx = Math.floor(cellHash(c, r, (completedSwipes + 1) * 2) * n);

  return moduleResultSet(paletteAt(curIdx), paletteAt(nextIdx), progress); // v42.3
}

// ---------------------- GENERIC N-SET CYCLE / BLEND ----------------------

// Generalizes the old two-set "hold@0 -> transition -> hold@1 ->
// transition -> repeat" schedule to N sets, rotated through strictly in
// order (index 0 -> 1 -> 2 -> ... -> N-1 -> 0 -> ...). Each set is held
// for `holdSec`, with a `transSec` crossfade into the NEXT set (by
// index, wrapping around) between each hold. For N = 2 this reduces to
// exactly the old two-set schedule (same total cycle length, same blend
// values at every point in time). If transSec is 0, the transition
// phases have zero width, so this naturally collapses into an instant
// sequential swap. This one function backs BOTH the colour-set cycle
// and the Layout-set cycle below — each caller supplies its own
// n/holdSec/transSec, so the two cycles run fully independently even
// though they share the same math.
//
// Returns { fromIndex, toIndex, blend }: blend is 0..1, 0 = fully the
// set at fromIndex, 1 = fully the set at toIndex (during a hold phase,
// fromIndex === toIndex and blend is 0, so "fully that set" either way).
function computeCycleStateGeneric(now, n, holdSec, transSec) {
  if (n <= 1) return { fromIndex: 0, toIndex: 0, blend: 0 };

  let holdMs  = Math.max(holdSec, 0) * 1000;
  let transMs = Math.max(transSec, 0) * 1000;
  let stepMs  = holdMs + transMs;
  let fullCycle = stepMs * n;
  if (fullCycle <= 0) return { fromIndex: 0, toIndex: 0, blend: 0 }; // stay on set 0

  let t = now % fullCycle;
  let stepIndex = Math.floor(t / stepMs);
  let tInStep = t - stepIndex * stepMs;
  let fromIndex = stepIndex % n;
  let toIndex = (stepIndex + 1) % n;

  if (tInStep < holdMs) {
    return { fromIndex, toIndex: fromIndex, blend: 0 };
  }
  let transT = tInStep - holdMs;
  let blend = easeInOutCubic(constrain(transT / Math.max(transMs, 1), 0, 1));
  return { fromIndex, toIndex, blend };
}

// Returns the indices of `sets` whose .enabled is not false, in order.
// Falls back to every index if somehow none are enabled — a safety net
// only; the UI itself (see updateColorEnabledCheckboxesState /
// updateLayoutEnabledCheckboxesState) locks a set's checkbox whenever
// it's the last enabled one in its group, so a normal user interaction
// can never actually reach zero.
function enabledIndices(sets) {
  let idxs = [];
  sets.forEach((s, i) => { if (s.enabled !== false) idxs.push(i); });
  return idxs.length > 0 ? idxs : sets.map((_, i) => i);
}

// Same contract as computeCycleStateGeneric, but rotates only through
// the ENABLED sets in `sets` — unchecking a set's checkbox (pausing it)
// removes it from rotation entirely rather than just skipping over it
// when landed on. With exactly one set enabled, this naturally holds
// static on that one set (computeCycleStateGeneric's own n<=1 case),
// which is how isolating a single set for design/debugging works.
function computeCycleStateEnabled(now, sets, holdSec, transSec) {
  let idxs = enabledIndices(sets);
  let state = computeCycleStateGeneric(now, idxs.length, holdSec, transSec);
  return { fromIndex: idxs[state.fromIndex], toIndex: idxs[state.toIndex], blend: state.blend };
}

// Thin wrapper: the colour-set cycle specifically, using its own
// dedicated timing globals (changeIntervalSec / transitionDurationSec).
// When Sequence playback is active, it — not the autonomous cycle —
// decides which two colour sets are blended right now; see
// updateSequence(), called once per frame before this is read.
// Thin wrapper: the colour-set cycle specifically, using its own
// dedicated timing globals (changeIntervalSec / transitionDurationSec).
// `now - colorEpochMs` rather than raw `now` is what makes a freshly
// loaded Scene's colour cycle visibly restart at Set 1 instead of
// picking up wherever the absolute clock happens to land — see
// finalizeLoadScene().
function computeCycleState(now) {
  return timingCycleState(colorTimingChannel, now, 0); // v35.3: shared engine (Flicker / Slow change)
}

// ---------------------- v35: FRAME-LOCKED Hz CLOCK (v35.3: per channel) ----------------------
// Flicker mode measures elapsed time in REAL SCREEN REFRESHES
// (vsyncCount), not milliseconds, so e.g. 10 Hz on a 60 Hz screen is
// exactly 3 refreshes per step, every time — no millisecond jitter.
//
// Each channel's epoch is still stored in ms (colorEpochMs /
// layoutEpochMs — jump-to-set and scene loads set them), so whenever it
// changes we convert it ONCE into a refresh count. Rounding happens only
// at that moment, never accumulates.
function timingElapsedFrames(ch, now) {
  let epochMs = ch.getEpochMs();
  if (epochMs !== ch.clock.lastSeenEpochMs) {
    ch.clock.epochFrame = vsyncCount - Math.round(Math.max(now - epochMs, 0) / nominalFramePeriodMs());
    ch.clock.lastSeenEpochMs = epochMs;
  }
  return Math.max(vsyncCount - ch.clock.epochFrame, 0);
}

// Position in the cycle, in STEPS (one step = one set = half a flash).
// `offsetSteps` is always 0 for now; future ripple / wall-group / beat
// features ask "where is THIS screen?" by passing their own offset.
function timingStepPosition(ch, now, offsetSteps) {
  let stepsPerFrame = (2 * timingPlayedEffHz(ch)) / displayInfo.nominalHz; // v37.1: played rate
  return timingElapsedFrames(ch, now) * stepsPerFrame + (offsetSteps || 0);
}

// Same { fromIndex, toIndex, blend } contract as
// computeCycleStateGeneric(), from a position measured in steps.
// The tiny epsilon stops floating-point error (3 x 0.3333... =
// 0.99999...) from landing a step boundary one refresh late.
function cycleStateFromSteps(x, n, fadeShare) {
  if (n <= 1) return { fromIndex: 0, toIndex: 0, blend: 0, stepIndex: 0 };
  let stepIndex = Math.floor(x + 1e-7);
  let frac = Math.max(x - stepIndex, 0);
  let fromIndex = ((stepIndex % n) + n) % n;
  let toIndex = (fromIndex + 1) % n;
  let holdFrac = 1 - fadeShare;
  if (fadeShare <= 0 || frac < holdFrac) return { fromIndex, toIndex: fromIndex, blend: 0, stepIndex };
  let blend = easeInOutCubic(constrain((frac - holdFrac) / fadeShare, 0, 1));
  return { fromIndex, toIndex, blend, stepIndex };
}

// The one entry point both groups use: which two sets, and how far
// between them, right now — frame-locked in Flicker, ms-based in Slow.
function timingCycleState(ch, now, offsetSteps) {
  let sets = ch.getSets();
  if (ch.getMode() === 'flicker') {
    let idxs = enabledIndices(sets);
    let st = cycleStateFromSteps(timingStepPosition(ch, now, offsetSteps), idxs.length, ch.getFade());
    return { fromIndex: idxs[st.fromIndex], toIndex: idxs[st.toIndex], blend: st.blend };
  }
  return computeCycleStateEnabled(Math.max(now - ch.getEpochMs(), 0), sets, ch.getHold(), ch.getTrans());
}

// ---------------------- v35: MEASURED FLASH RATE (v35.3: per channel) ----------------------
// Records every moment a group's displayed set actually changes, so the
// readout can report what really happened (dropped frames, hidden tab, a
// screen that can't show the request). Two changes = one flash.
const COLOR_CHANGE_WINDOW_MS = 2000;
function timingRecordChange(ch, fromIndex, now) {
  let c = ch.changes;
  if (c.lastFrom !== null && fromIndex !== c.lastFrom) c.times.push(now);
  c.lastFrom = fromIndex;
  while (c.times.length && now - c.times[0] > COLOR_CHANGE_WINDOW_MS) c.times.shift();
}
// v36.2: the scroll clock has no sets to watch — each fired pulse is
// recorded directly (one pulse = one change, two = one Hz).
function timingRecordTick(ch, now) {
  ch.changes.times.push(now);
  timingTrimChanges(ch, now);
}
function timingTrimChanges(ch, now) {
  let c = ch.changes;
  while (c.times.length && now - c.times[0] > COLOR_CHANGE_WINDOW_MS) c.times.shift();
}
function timingMeasuredHz(ch) {
  // v36.2: measured from the span between the first and last change in
  // the window, not "changes ÷ window length" — the old way could count
  // one change too many at the window's edge (2 Hz read as 2.25).
  let t = ch.changes.times;
  if (t.length >= 3) {
    let span = (t[t.length - 1] - t[0]) / 1000;
    if (span > 0) return (t.length - 1) / span / 2;
  }
  return t.length / 2 / (COLOR_CHANGE_WINDOW_MS / 1000);
}

// Rebuilds the effective (blended) background, scroll-bar, and palette
// colours for THIS frame only. Cheap: at most a handful of lerpColor()
// calls against the two sets currently being crossfaded, done once per
// frame rather than once per module — regardless of how many colour
// sets exist in total. Skipped entirely (see draw()) while a scene
// transition is in flight — updateSceneTransitionState() sets colBg/
// colScroll/palette itself during that window.
function rebuildEffectivePalette(now) {
  let { fromIndex, toIndex, blend } = computeCycleState(now);
  timingRecordChange(colorTimingChannel, fromIndex, now); // v35
  updateColorActiveHighlight(fromIndex, toIndex, blend);
  let setA = colorSets[fromIndex];
  let setB = colorSets[toIndex];

  colBg = lerpColor(
    color(setA.bgColorDef[0], setA.bgColorDef[1], setA.bgColorDef[2]),
    color(setB.bgColorDef[0], setB.bgColorDef[1], setB.bgColorDef[2]),
    blend
  );

  colScroll = lerpColor(
    color(setA.scrollColorDef[0], setA.scrollColorDef[1], setA.scrollColorDef[2]),
    color(setB.scrollColorDef[0], setB.scrollColorDef[1], setB.scrollColorDef[2]),
    blend
  );

  let lenA = setA.paletteDefs.length;
  let lenB = setB.paletteDefs.length;
  let n = Math.max(lenA, lenB, 1);

  let next = [];
  for (let i = 0; i < n; i++) {
    let rgbA = setA.paletteDefs[i % lenA];
    let rgbB = setB.paletteDefs[i % lenB];
    next.push(
      lerpColor(
        color(rgbA[0], rgbA[1], rgbA[2]),
        color(rgbB[0], rgbB[1], rgbB[2]),
        blend
      )
    );
  }
  palette = next;
}

// ---------------------- LAYOUT-SET CYCLE / BLEND ----------------------

// Recomputes layoutGroup.current for this frame by blending all three
// fields (spacing, thickness, scale) together between whichever two
// sets computeCycleStateGeneric() says are currently "from"/"to", using
// layoutGroup's own timing — fully independent of the colour cycle.
// When Sequence playback is active, it decides the from/to/blend
// instead (see updateSequence(), called once per frame before this).
// Skipped entirely (see draw()) while a scene transition is in flight —
// updateSceneTransitionState() sets layoutGroup.current itself during
// that window.
function rebuildLayoutGroup(now) {
  // v35.3: shared timing engine — Layout can flicker too.
  let { fromIndex, toIndex, blend } = timingCycleState(layoutTimingChannel, now, 0);
  timingRecordChange(layoutTimingChannel, fromIndex, now);
  updateLayoutActiveHighlight(fromIndex, toIndex, blend);
  let a = layoutGroup.sets[fromIndex];
  let b = layoutGroup.sets[toIndex];
  layoutGroup.current = {
    spacing: a.spacing + (b.spacing - a.spacing) * blend,
    thickness: a.thickness + (b.thickness - a.thickness) * blend,
    scale: a.scale + (b.scale - a.scale) * blend,
  };
  // v30: the INCOMING set's anchor governs while crossfading toward it;
  // otherwise the held set's own.
  layoutGroup.anchorSet = blend > 0 ? b : a;
}

// A layout set's display name is purely its position within
// layoutGroup.sets (e.g. "Layout 2") — same convention as colorSetName,
// recomputed fresh each time via indexOf() so it's always correct after
// an append OR a deletion.
function layoutSetName(group, setObj) {
  return 'Layout ' + (group.sets.indexOf(setObj) + 1);
}

// Recomputes the layout cycle for this frame and applies the blended
// values to the live layout variables (including screenWidth — a live
// scale change reshapes the module grid, same as a window resize), then
// re-derives the values that depend on them. Called once per frame from
// draw(), the same way rebuildEffectivePalette() is.
//
// Spacing is stored as a PERCENTAGE of Scale, not a pixel value, so it's
// converted to pixels here, fresh every frame, from the already-blended
// spacing% and scale — this is what makes the gap between modules track
// Scale automatically (including mid-crossfade between two Layout sets
// with different Scales) instead of needing to be manually re-widened
// whenever Scale changes.
function rebuildEffectiveLayout(now) {
  rebuildLayoutGroup(now);
  let spacingPx = (layoutGroup.current.spacing / 100) * layoutGroup.current.scale;
  hSpacing = spacingPx;
  vSpacing = spacingPx;
  gapHeightRatio = layoutGroup.current.thickness / 100;
  screenWidth = layoutGroup.current.scale;
  recomputeDerivedValues();
}

let mappingFade = null;       // { from: mapping, startMs, durMs } while fading
let mappingFadeCanvas = null; // the old mapping's picture during a fade
let mappingCycleStart = 0;    // when the current mapping started (for cycling)

function switchMapping(i, now) {
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  if (i < 0 || i >= sc.mappings.length || i === mappingIndex) return;
  let mt = sceneMappingTiming();
  let from = activeMapping();
  mappingIndex = i;
  mappingFade = (mt.change === 'fade' && mt.fadeSec > 0 && !sceneTransition)
    ? { from, startMs: now, durMs: mt.fadeSec * 1000 } : null;
  mappingCycleStart = now;
}

// Called once per frame before drawing: advances the cycle, ends fades.
function updateMappingChange(now) {
  if (mappingFade && now >= mappingFade.startMs + mappingFade.durMs) mappingFade = null;
  if (sceneTransition) return; // a scene change takes over
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  let mt = sceneMappingTiming();
  if (!mt.cycle || sc.mappings.length < 2) { mappingCycleStart = now; return; } // turning Cycle on waits a full hold
  if (roomMenu && roomMenu.isOpen && roomMenu.isOpen()) { mappingCycleStart = now; return; } // v41.4: editing — wait; a full hold after closing
  if (now - mappingCycleStart >= Math.max(mt.holdSec, MAPPING_HOLD_MIN_SEC) * 1000) {
    switchMapping((mappingIndex + 1) % sc.mappings.length, now);
    if (roomMenu) roomMenu.refresh();
  }
}

// How far the fade is (0..1, eased), or -1 when not fading.
function mappingFadeAmount(now) {
  if (!mappingFade || sceneTransition) return -1;
  let t = Math.min(Math.max((now - mappingFade.startMs) / mappingFade.durMs, 0), 1);
  return t * t * (3 - 2 * t);
}

// The mapping being DRAWN this frame: normally the one picked. During a
// scene crossfade the old one holds until halfway through, then cuts to
// the incoming scene's Mapping 1 (a centre or flow change can't blend,
// so the cut is hidden in the middle of the fade).
let frameMapping = makeDefaultMapping();
function mappingForFrame(now) {
  let st = sceneTransition;
  if (st && st.fromMapping) {
    if (now < st.mappingCutMs) return st.fromMapping;
    let target = sequenceScenes[st.targetIndex];
    if (target && target.mappings && target.mappings[0]) return target.mappings[0];
  }
  return activeMapping();
}
// ---------------------- v37.1: SAFETY LIMIT ----------------------
// See the v37.1 header note. The limit never edits designed values; it
// computes ONE slow-down factor (safetyFactor, 0..1] that every rhythm's
// playback is multiplied by, recomputed whenever anything relevant changes.
const SAFETY_LEVELS = {
  safe: {
    label: 'Safe', color: '#7fd18b',
    desc: 'All rhythms combined stay at or under 3 flashes per second (the WCAG guideline).',
  },
  peak: {
    label: 'Avoid peak', color: FLASH_ORANGE,
    desc: 'Skips the most sensitive band (above 15 up to 20 Hz) and rates this screen can\'t show. Reduces risk — NOT safe for photosensitive viewers.',
  },
  off: {
    label: 'Off', color: FLASH_RED,
    desc: 'No limit. For designing in a controlled setting only.',
  },
};
const SAFE_MAX_HZ = 3;
const PEAK_LO_HZ = 15, PEAK_HI_HZ = 20;
const SAFETY_LIMITED_COLOR = '#8fc3ff';

let safetyLevel = 'safe';   // never saved in show files; a fresh page always starts Safe
let safetyFactor = 1;       // shared playback slow-down, 1 = playing as designed
let safetySignature = null; // inputs the current factor was computed from
let safetyInfo = { combined: 0, parts: [] };
let safetyBadgeDismissed = false;
let safetyControl = null;

// The rhythms that count, from LIVE settings. Each part: label, designed
// Hz, frame-locked or not, weight (Scroll Pulse = its share of screens).
function safetyPartsLive() {
  let parts = [];
  [colorTimingChannel, layoutTimingChannel].forEach((ch) => {
    let hz = timingRequestedHz(ch);
    if (enabledIndices(ch.getSets()).length >= 2 && Number.isFinite(hz) && hz > 0) {
      parts.push({ label: ch.label, hz, frameLocked: timingIsFrameLocked(ch), weight: 1 });
    }
  });
  if (scrollTimingMode === 'pulse' && scrollCoverage > 0) {
    parts.push({ label: 'Scroll', hz: timingEffectiveHz(scrollTimingChannel), frameLocked: true, weight: scrollCoverage });
  }
  return parts;
}

// Same, from a STORED scene (used to check a loaded show).
function safetyPartsFromScene(scene) {
  let parts = [];
  function timingHz(t) {
    if (t.mode === 'flicker') return nudgedHz(t.flashHz || 0, t.nudgeHz || 0);
    let step = Math.max(t.slowHoldSec || 0, 0) + Math.max(t.slowTransSec || 0, 0);
    return step > 0 ? 1 / (2 * step) : NaN;
  }
  [['Colour', scene.colorSets, scene.colorTiming], ['Layout', scene.layoutSets, scene.layoutTiming]].forEach(([label, sets, t]) => {
    if (!t || !sets || enabledIndices(sets).length < 2) return;
    let hz = timingHz(t);
    if (Number.isFinite(hz) && hz > 0) parts.push({ label, hz, frameLocked: t.mode === 'flicker', weight: 1 });
  });
  let st = scene.scrollTiming;
  if (st && st.mode === 'pulse' && st.coverage > 0) {
    parts.push({ label: 'Scroll', hz: nudgedHz(st.flashHz, st.nudgeHz), frameLocked: true, weight: st.coverage });
  }
  return parts;
}

function safetyCombinedHz(parts) {
  return parts.reduce((sum, p) => sum + p.hz * p.weight, 0);
}

// Is slow-down factor f acceptable at this level?
function safetyFactorOk(parts, level, f, screenHz) {
  let inPeak = (r) => r > PEAK_LO_HZ + 1e-9 && r <= PEAK_HI_HZ + 1e-9; // band (15, 20]: exactly 15 is allowed (and clean on 60 Hz)
  for (let p of parts) {
    let r = p.hz * f;
    if (p.frameLocked) {
      let kind = classifyFlashHz(r, screenHz).kind;
      if (kind === 'impossible' || kind === 'stutter') return false; // any limit blocks purple
    }
    if (level === 'peak' && inPeak(r)) return false;
  }
  let combined = safetyCombinedHz(parts) * f;
  if (level === 'safe') return combined <= SAFE_MAX_HZ + 1e-9;
  if (level === 'peak') return !inPeak(combined);
  return true;
}

// The LARGEST factor (<= 1) that satisfies the level — i.e. the least
// slow-down needed. Tries exact "land right on a boundary" values first,
// then a fine 1%-step search downward.
function safetyComputeFactor(parts, level, screenHz) {
  if (level === 'off' || parts.length === 0) return 1;
  let C = safetyCombinedHz(parts);
  let candidates = [1];
  let bounds = [SAFE_MAX_HZ, PEAK_LO_HZ, screenHz / 2];
  bounds.forEach((b) => {
    if (C > 0) candidates.push(b / C);
    parts.forEach((p) => candidates.push(b / p.hz));
  });
  for (let f = 1, i = 0; i < 700; i++) { f *= 0.99; candidates.push(f); }
  candidates = candidates.filter((f) => f > 0 && f <= 1).sort((a, b) => b - a);
  for (let f of candidates) if (safetyFactorOk(parts, level, f, screenHz)) return f;
  return candidates[candidates.length - 1];
}

// Called once per frame from draw(). Cheap: only recomputes when the
// inputs change, and only touches the clocks when the factor changes.
function updateSafetyLimit(now) {
  let parts = safetyPartsLive();
  let screenHz = displayInfo.nominalHz;
  let sig = safetyLevel + '|' + screenHz + '|' + parts.map((p) => p.label + p.hz + ':' + p.weight + (p.frameLocked ? 'f' : 's')).join(',');
  if (sig === safetySignature) return;
  safetySignature = sig;
  safetyInfo = { combined: safetyCombinedHz(parts), parts };
  let f = safetyComputeFactor(parts, safetyLevel, screenHz);
  if (Math.abs(f - safetyFactor) > 1e-9) applySafetyFactor(f, now);
  else if (safetyControl) safetyControl.refresh(); // combined rate changed even if the factor didn't
}

// Changes the shared slow-down WITHOUT jumps: every rhythm keeps its
// current position and continues at its new played speed.
function applySafetyFactor(newF, now) {
  let chans = [colorTimingChannel, layoutTimingChannel, scrollTimingChannel];
  let snaps = chans.map((ch) => {
    if (timingIsFrameLocked(ch)) return { ch, x: timingStepPosition(ch, now, 0) };
    if (ch === scrollTimingChannel) return null; // Free scroll isn't scaled
    return { ch, slow: true, elapsed: Math.max(now - ch.getEpochMs(), 0), step: ch.getHold() + ch.getTrans() };
  });
  safetyFactor = newF;
  timingApplyActive(colorTimingChannel);
  timingApplyActive(layoutTimingChannel);
  snaps.forEach((s) => {
    if (!s) return;
    if (s.slow) {
      let ns = s.ch.getHold() + s.ch.getTrans();
      if (s.step > 0 && ns > 0) s.ch.setEpochMs(now - s.elapsed * ns / s.step);
    } else {
      timingReanchor(s.ch, s.x, now);
    }
  });
  markTimingChanged();
  if (safetyControl) safetyControl.refresh();
}

// v37.2: WHY the limit is slowing things down, in plain words.
function safetyReasonText() {
  let parts = safetyInfo.parts, C = safetyInfo.combined, screenHz = displayInfo.nominalHz;
  let inPeak = (r) => r > PEAK_LO_HZ + 1e-9 && r <= PEAK_HI_HZ + 1e-9;
  if (safetyLevel === 'safe') {
    return parts.length > 1
      ? 'all rhythms together add up to ' + formatHz(C) + ' Hz, over the 3 Hz limit'
      : (parts[0] ? parts[0].label + ' ' + formatHz(parts[0].hz) + ' Hz is over the 3 Hz limit' : 'over the 3 Hz limit');
  }
  for (let p of parts) {
    if (!p.frameLocked) continue;
    let k = classifyFlashHz(p.hz, screenHz).kind;
    if (k === 'impossible') return p.label + ' ' + formatHz(p.hz) + ' Hz is too fast for this ' + screenHz + ' Hz screen';
    if (k === 'stutter') return p.label + ' ' + formatHz(p.hz) + ' Hz can\'t be shown evenly on this ' + screenHz + ' Hz screen';
  }
  for (let p of parts) if (inPeak(p.hz)) return p.label + ' ' + formatHz(p.hz) + ' Hz is in the peak band (15–20 Hz)';
  if (inPeak(C)) return 'all rhythms together add up to ' + formatHz(C) + ' Hz, in the peak band (15–20 Hz)';
  return 'over the limit';
}

// Panel line: "designed X, playing at Y" for one rhythm, with the reason.
function safetyLimitedNote(designHz) {
  return 'Safety limit (' + SAFETY_LEVELS[safetyLevel].label + '): playing at ' + formatHz(designHz * safetyFactor)
    + ' Hz instead of ' + formatHz(designHz) + ' Hz, because ' + safetyReasonText()
    + '. Everything is slowed together; your settings are kept.';
}

// v37.2: for one slider, which of its values keep the design within the
// limit (everything else as it is now)? `apply(v)` sets the live value
// with no side effects; the original is put back afterwards. Returns an
// array of booleans parallel to `values`, or null when the limit is Off.
function safetyEvaluate(values, getCurrent, apply) {
  if (safetyLevel === 'off') return null;
  let screenHz = displayInfo.nominalHz;
  let orig = getCurrent();
  let ok = values.map((v) => {
    apply(v);
    return safetyFactorOk(safetyPartsLive(), safetyLevel, 1, screenHz);
  });
  apply(orig);
  return ok;
}

// v37.3: combined rate the design would have with this slider at v.
function safetyCombinedWith(getCurrent, apply, v) {
  let orig = getCurrent();
  apply(v);
  let c = safetyCombinedHz(safetyPartsLive());
  apply(orig);
  return c;
}

// Nearest allowed value to v (v itself if allowed). If NOTHING is allowed
// (no room left), v is accepted only if it doesn't raise the combined
// rate — the slider can still move toward safer settings.
function safetySnap(values, ok, v, getCurrent, apply) {
  if (!ok) return v;
  if (!ok.some((x) => x)) {
    if (!getCurrent) return v;
    let cur = getCurrent();
    return safetyCombinedWith(getCurrent, apply, v) <= safetyCombinedWith(getCurrent, apply, cur) + 1e-9 ? v : cur;
  }
  let best = -1, bestD = Infinity, own = -1, ownD = Infinity;
  values.forEach((val, i) => {
    let d = Math.abs(val - v);
    if (d < ownD) { ownD = d; own = i; }
    if (ok[i] && d < bestD) { bestD = d; best = i; }
  });
  return ok[own] ? v : values[best];
}

function safetyRange(min, max, step) {
  let out = [];
  let n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) out.push(Math.round((min + i * step) * 1e6) / 1e6);
  return out;
}

// Thin strip under a slider; blue where values are blocked.
function makeSafetyStrip() {
  let s = document.createElement('div');
  Object.assign(s.style, { height: '4px', margin: '0 7px', borderRadius: '2px', display: 'none' });
  s.title = 'Blue = would go over the safety limit (with everything else as it is now)';
  return s;
}
function paintSafetyStrip(strip, ok, positions) {
  if (!ok || ok.every((x) => x)) { strip.style.display = 'none'; return; }
  let stops = [];
  for (let i = 0; i < ok.length; i++) {
    let a = i === 0 ? 0 : (positions[i - 1] + positions[i]) / 2;
    let b = i === ok.length - 1 ? 1 : (positions[i] + positions[i + 1]) / 2;
    let c = ok[i] ? 'rgba(255,255,255,0.08)' : SAFETY_LIMITED_COLOR;
    stops.push(c + ' ' + (a * 100).toFixed(2) + '%', c + ' ' + (b * 100).toFixed(2) + '%');
  }
  strip.style.background = 'linear-gradient(to right, ' + stops.join(', ') + ')';
  strip.style.display = '';
}

// A slider + its safety guard. `values` are the slider's possible values,
// `positions` (0..1) where each sits along the track.
// v37.3: `values` / `positions` may be functions (Nudge's range follows
// the rate). g.noRoom = every value is blocked.
function makeSafetyGuard(values, positions, getCurrent, apply, strip) {
  let g = { ok: null, noRoom: false, vals: [] };
  let get = (x) => (typeof x === 'function' ? x() : x);
  g.update = () => {
    g.vals = get(values);
    g.ok = safetyEvaluate(g.vals, getCurrent, apply);
    g.noRoom = !!g.ok && !g.ok.some((x) => x);
    paintSafetyStrip(strip, g.ok, get(positions));
  };
  g.snap = (v) => safetySnap(g.vals, g.ok, v, getCurrent, apply);
  return g;
}

// v37.3: blue panel note shown when a visible slider has no room at all.
function safetyNoRoomNote(label) {
  let others = safetyInfo.parts.filter((p) => p.label !== label);
  let C = safetyCombinedHz(others);
  return 'No room left under the limit for ' + label + ': '
    + (others.length ? 'the other rhythms already add up to ' + formatHz(C) + ' Hz' : 'even its slowest setting is over')
    + '. Its sliders can only move to safer (slower) settings. Slow another rhythm down to make room.';
}
function linearPositions(values, min, max) {
  return values.map((v) => (v - min) / (max - min));
}

// Changing level. Leaving Safe always asks first.
function setSafetyLevel(level) {
  if (level === safetyLevel || !SAFETY_LEVELS[level]) return;
  if (level !== 'safe') {
    let msg = level === 'off'
      ? 'Turn the safety limit OFF?\n\nAll flash rates become possible, including 15–20 Hz, the band most likely to trigger seizures in photosensitive people. Use only while designing, in a controlled setting.'
      : 'Switch to Avoid peak?\n\nRates up to 15 Hz and 20–30 Hz become possible. This reduces risk but is NOT safe for photosensitive viewers.';
    if (!window.confirm(msg)) return;
  }
  safetyLevel = level;
  safetyBadgeDismissed = false;
  safetySignature = null; // recompute next frame
  updateSafetyLimit(sketchNow()); // v43.0
  markTimingChanged();
  if (safetyControl) safetyControl.refresh();
}

// After Load Show / Restore: the badge comes back, and if any scene would
// be slowed by the current limit, a note says so (with a one-click unlock).
function safetyAfterShowLoad() {
  safetyBadgeDismissed = false;
  if (!safetyControl) return;
  safetyControl.refresh();
  if (safetyLevel === 'off') return;
  let screenHz = displayInfo.nominalHz;
  let limited = sequenceScenes.filter((s) => safetyComputeFactor(safetyPartsFromScene(s), safetyLevel, screenHz) < 1 - 1e-9);
  if (limited.length > 0) safetyControl.showLoadNote(limited.map((s) => sceneName(s)));
}

// Bottom-left: [!] [Safety: Safe ▴] with an upward panel, plus the load note.
function createSafetyControl() {
  let badge = document.createElement('button');
  badge.textContent = '!';
  badge.title = 'The safety limit is not on Safe — click to see';
  Object.assign(badge.style, {
    position: 'fixed', left: '10px', bottom: '10px', zIndex: 1100,
    width: '30px', height: '30px', borderRadius: '50%', padding: '0',
    color: '#fff', border: '1px solid rgba(255,255,255,0.6)', fontWeight: 'bold',
    fontSize: '16px', fontFamily: 'sans-serif', cursor: 'pointer', display: 'none',
  });
  document.body.appendChild(badge);

  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed', left: '46px', bottom: '10px', zIndex: 1000,
    fontFamily: 'sans-serif', fontSize: '12px', display: menuSystemVisible ? '' : 'none',
  });
  document.body.appendChild(wrapper);

  let btn = document.createElement('button');
  btn.title = 'Safety limit (flash limit)';
  styleToggleButton(btn);
  wrapper.appendChild(btn);

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, {
    position: 'fixed', top: 'auto', right: 'auto', left: '10px', bottom: '52px',
    width: '320px', minWidth: '0', boxSizing: 'border-box',
  });
  wrapper.appendChild(panel);
  let menu = attachHoverAutoClose(wrapper, panel);

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    safetyBadgeDismissed = true;
    refresh();
    if (panel.style.display !== 'flex') btn.click();
  });

  let title = document.createElement('div');
  title.textContent = 'Safety limit';
  Object.assign(title.style, { fontWeight: 'bold', fontSize: '13px' });
  title.appendChild(infoDot('Counts Colour + Layout + Scroll pulse (by its share of screens) together; fades count the same as flashes. Free scroll isn\'t counted. The limit only changes playback — your settings and saved shows stay as designed. It can\'t see what a projector does: test the projected image (film it, or check a recording with PEAT).')); // v41.3
  panel.appendChild(title);

  let statusLine = document.createElement('div');
  Object.assign(statusLine.style, { fontSize: '11px', lineHeight: '1.4' });
  panel.appendChild(statusLine);

  let optionButtons = {};
  Object.keys(SAFETY_LEVELS).forEach((key) => {
    let lv = SAFETY_LEVELS[key];
    let b = document.createElement('button');
    Object.assign(b.style, {
      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
      textAlign: 'left', padding: '6px 8px', borderRadius: '4px', cursor: 'pointer',
      fontFamily: 'sans-serif', color: '#fff',
    });
    let name = document.createElement('span');
    name.textContent = lv.label;
    Object.assign(name.style, { fontWeight: 'bold', fontSize: '12px', color: lv.color });
    let desc = document.createElement('span');
    desc.textContent = lv.desc;
    Object.assign(desc.style, { fontSize: '11px', color: '#bbb', lineHeight: '1.35' });
    b.appendChild(name);
    b.appendChild(desc);
    b.addEventListener('click', () => setSafetyLevel(key));
    optionButtons[key] = b;
    panel.appendChild(b);
  });

  // v41.3: the footnote moved into the ⓘ next to the title

  // Load note (shown by safetyAfterShowLoad()).
  let loadNote = document.createElement('div');
  Object.assign(loadNote.style, {
    position: 'fixed', left: '10px', bottom: '52px', zIndex: 1050, width: '320px', boxSizing: 'border-box',
    display: 'none', flexDirection: 'column', gap: '8px', padding: '10px',
    background: 'rgba(20,20,20,0.92)', border: '1px solid ' + SAFETY_LIMITED_COLOR, borderRadius: '6px',
    color: '#fff', fontFamily: 'sans-serif', fontSize: '12px', lineHeight: '1.4',
  });
  let loadNoteText = document.createElement('div');
  loadNote.appendChild(loadNoteText);
  let loadNoteRow = document.createElement('div');
  Object.assign(loadNoteRow.style, { display: 'flex', gap: '6px', justifyContent: 'flex-end' });
  let unlockBtn = harmonyButton('Unlock (Off)…');
  unlockBtn.addEventListener('click', () => { loadNote.style.display = 'none'; setSafetyLevel('off'); });
  let okBtn = harmonyButton('OK, keep the limit');
  okBtn.addEventListener('click', () => { loadNote.style.display = 'none'; });
  loadNoteRow.appendChild(unlockBtn);
  loadNoteRow.appendChild(okBtn);
  loadNote.appendChild(loadNoteRow);
  document.body.appendChild(loadNote);

  function showLoadNote(names) {
    let list = names.length <= 4 ? names.join(', ') : names.slice(0, 4).join(', ') + ' and ' + (names.length - 4) + ' more';
    loadNoteText.textContent = 'This show has ' + (names.length === 1 ? 'a scene' : names.length + ' scenes')
      + ' above the safety limit (' + SAFETY_LEVELS[safetyLevel].label + '): ' + list
      + '. ' + (names.length === 1 ? 'It' : 'They') + ' will play slowed down. The saved settings are untouched.';
    menu.closeNow(); // the note uses the panel's spot
    loadNote.style.display = 'flex';
  }

  function refresh() {
    let lv = SAFETY_LEVELS[safetyLevel];
    btn.textContent = 'Safety: ' + lv.label + ' ▴';
    btn.style.color = safetyLevel === 'safe' ? '#fff' : lv.color;
    btn.style.borderColor = safetyLevel === 'safe' ? '#555' : lv.color;
    Object.keys(optionButtons).forEach((key) => {
      let on = key === safetyLevel;
      optionButtons[key].style.background = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.04)';
      optionButtons[key].style.border = '1px solid ' + (on ? SAFETY_LEVELS[key].color : '#444');
    });
    let showBadge = safetyLevel !== 'safe' && !safetyBadgeDismissed;
    badge.style.display = showBadge ? '' : 'none';
    badge.style.background = safetyLevel === 'off' ? FLASH_RED : FLASH_ORANGE;

    let C = safetyInfo.combined;
    let s;
    if (safetyInfo.parts.length === 0) {
      s = 'Nothing is flashing right now (combined 0 Hz).';
    } else {
      s = 'Combined now: ' + formatHz(C) + ' Hz (' + safetyInfo.parts.map((p) =>
        p.label + ' ' + formatHz(p.hz) + (p.weight < 1 ? ' × ' + Math.round(p.weight * 100) + '%' : '')).join(' + ') + ').';
      if (safetyFactor < 1) s += ' Playing everything at ' + Math.round(safetyFactor * 100) + '% speed, because ' + safetyReasonText() + '.';
    }
    statusLine.textContent = s;
    statusLine.style.color = safetyFactor < 1 ? SAFETY_LIMITED_COLOR : '#aaa';
  }

  function setButtonVisible(visible) {
    wrapper.style.display = visible ? '' : 'none';
    if (!visible) menu.closeNow();
  }

  refresh();
  return { refresh, setButtonVisible, showLoadNote, wrapper }; // v40.4: wrapper, so Display can sit next to it
}

// Shown on every page load. Good practice even for private use; the
// same text can open the installation (see the handoff's safety notes).
// v43.0b: restyled like the export cards (design/v43_video_export.md):
// solid black (nothing of the artwork shows before "I understand"), the
// "Ritualized Scrolling" title card first (0.2 s, faded out by 1 s), then the
// warning: red Space Grotesk title, white Archivo text, all centred. Fonts
// and button styles: style.css + fonts/. Wording and buttons unchanged.
const STARTUP_RED = '#BC002D'; // v43.0b: Hinomaru red
const STARTUP_TITLE_HOLD_MS = 200; // v43.0b: title fully shown
const STARTUP_TITLE_FADE_MS = 800; // v43.0b: then fades to black (ends at 1 s)
function showStartupWarning() {
  let overlay = document.createElement('div');
  overlay.className = 'rv-start';
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: 3000, background: '#000',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Archivo', sans-serif", color: '#fff', textAlign: 'center',
  });
  document.body.appendChild(overlay);

  // v43.0b: title card. Waits (max 1.5 s) for the fonts so it never shows in the fallback font.
  let title = document.createElement('div');
  title.textContent = 'Ritualized Scrolling';
  Object.assign(title.style, {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: '500', fontSize: 'clamp(28px, 5vw, 64px)',
    opacity: '0', transition: 'opacity ' + STARTUP_TITLE_FADE_MS + 'ms linear',
  });
  overlay.appendChild(title);
  let fontsReady = (document.fonts && document.fonts.load) ? Promise.all([
    document.fonts.load("500 20px 'Space Grotesk'"),
    document.fonts.load("400 20px 'Archivo'"),
    document.fonts.load("600 20px 'Archivo'"),
  ]) : Promise.resolve();
  let started = false;
  let startTitle = () => {
    if (started) return;
    started = true;
    title.style.transition = 'none';
    title.style.opacity = '1';
    void title.offsetWidth; // apply opacity 1 before the fade transition starts
    title.style.transition = 'opacity ' + STARTUP_TITLE_FADE_MS + 'ms linear';
    setTimeout(() => { title.style.opacity = '0'; }, STARTUP_TITLE_HOLD_MS);
    setTimeout(() => { title.remove(); overlay.appendChild(buildStartupBox(overlay)); },
      STARTUP_TITLE_HOLD_MS + STARTUP_TITLE_FADE_MS);
  };
  fontsReady.then(startTitle, startTitle);
  setTimeout(startTitle, 1500);
}

// v43.0b: the warning + resume window (content from v37.1 / v39.2), card style.
function buildStartupBox(overlay) {
  let box = document.createElement('div');
  Object.assign(box.style, {
    maxWidth: '560px', margin: '16px', padding: '8px 24px', fontSize: '15px', lineHeight: '1.6',
    maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
    opacity: '0', transition: 'opacity 400ms linear',
  });
  let h = document.createElement('div');
  h.textContent = 'Photosensitivity warning';
  Object.assign(h.style, {
    fontFamily: "'Space Grotesk', sans-serif", fontWeight: '500', fontSize: '30px',
    lineHeight: '1.2', marginBottom: '20px', color: STARTUP_RED,
  });
  box.appendChild(h);
  [
    'This work can produce flashing lights and fast-changing, high-contrast patterns. These may trigger seizures in people with photosensitive epilepsy, and cause headaches, dizziness, nausea or eye strain in others.',
    'If you feel unwell, look away and stop immediately.',
    'The safety limit is ON (Safe: at most 3 flashes per second, all rhythms combined). Unlocking it allows faster, riskier rates.',
  ].forEach((t, i) => {
    let p = document.createElement('p');
    p.textContent = t;
    Object.assign(p.style, { margin: '0 0 12px 0' });
    if (i === 2) Object.assign(p.style, { fontSize: '13px', color: '#bbb' }); // the safety-status line
    box.appendChild(p);
  });
  let snaps = loadSessionSnapshots(); // v39.2
  let ok = document.createElement('button');
  ok.textContent = snaps.length ? 'I understand, start fresh' : 'I understand, continue'; // v43.0b: commas, not dashes
  let bigBtnStyle = { display: 'block', width: '420px', maxWidth: '100%', margin: '10px auto 0 auto', boxSizing: 'border-box', padding: '9px 18px', fontSize: '14px', fontWeight: '600' };
  Object.assign(ok.style, bigBtnStyle);
  ok.addEventListener('click', () => { overlay.remove(); startSessionSnapshots(); });
  box.appendChild(ok);

  // v39.2: or pick up an earlier state (newest first).
  if (snaps.length) {
    // v43.0b: a dropdown button styled like the one above; the list opens under it.
    let head = document.createElement('button');
    let headLabel = (open) => 'I understand, resume an earlier state ' + (open ? '▴' : '▾');
    head.textContent = headLabel(false);
    Object.assign(head.style, bigBtnStyle);
    box.appendChild(head);
    let list = document.createElement('div');
    Object.assign(list.style, {
      display: 'none', flexDirection: 'column', gap: '4px', maxHeight: '240px', overflowY: 'auto',
      width: '420px', maxWidth: '100%', boxSizing: 'border-box', margin: '8px auto 0 auto',
      border: '1px solid #444', padding: '6px 8px', textAlign: 'left',
    });
    head.addEventListener('click', () => {
      let open = list.style.display === 'none';
      list.style.display = open ? 'flex' : 'none';
      head.textContent = headLabel(open);
    });
    let smallBtn = (label, tip, onClick) => {
      let b = document.createElement('button');
      b.textContent = label;
      b.title = tip;
      Object.assign(b.style, { padding: '2px 9px', fontSize: '12px', whiteSpace: 'nowrap' });
      b.addEventListener('click', onClick);
      return b;
    };
    snaps.forEach((snap) => {
      let row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' });
      let when = document.createElement('span');
      when.textContent = snapshotTimeAgo(snap.t);
      Object.assign(when.style, { minWidth: '76px', color: '#999' });
      let what = document.createElement('span');
      what.textContent = describeSnapshot(snap);
      Object.assign(what.style, { flex: '1' });
      row.appendChild(when);
      row.appendChild(what);
      let go = (flat) => { if (resumeSessionSnapshot(snap, flat)) { overlay.remove(); startSessionSnapshots(); } };
      row.appendChild(smallBtn('Resume', 'Open this state exactly as it was', () => go(false)));
      if (snap.view && snap.view.roomView) {
        row.appendChild(smallBtn('Flat', 'Same state (room unchanged), but start in Flat view — use this if it was too heavy', () => go(true)));
      }
      list.appendChild(row);
    });
    box.appendChild(list);
  }
  requestAnimationFrame(() => { box.style.opacity = '1'; });
  return box;
}
