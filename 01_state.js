// noprotect
// (v39.2: the line above tells the p5.js web editor NOT to stop the sketch
// when one frame takes long — its "infinite loop" guard was killing the
// animation on heavy Room views. See v39.2 in the changelog archive.)

// v39.4: switch off p5's Friendly Error System — it checks every drawing
// call while the sketch runs, which roughly doubled the cost of a Room-view
// frame. Side effect: the editor no longer shows p5's "friendly" warnings.
if (typeof p5 !== 'undefined') p5.disableFriendlyErrors = true;
// =====================================================================
// RITUALIZED VIEWING (formerly Endless Architecture) — fixed phone-screen modules in a configurable
// colour mosaic. A scroll bar sweeps upward through each module, swapping
// it to a new colour. Each module runs its OWN independent timer.
//
// v41.6: the sketch is split into files (load order = index.html):
//   01_state · 02_rhythm · 03_draw · 04_room · 05_menus · 06_dock ·
//   07_sequence · 08_webgl · 09_export · 99_mesh. Map and conventions: 00_index.md.
//   Changelog v40.x–v41.x: changelog_v40-v41.md (was this header).
// THIS FILE: Settings, colour & layout sets, scene data model, Projection sets (mappings) data, save / load, migration, backups, session snapshots.
// =====================================================================
const SKETCH_VERSION = 'v43.1.1'; // v40.15: shown in the console and the diagnostics report

// ---------------------- CONFIGURABLE PARAMETERS ----------------------

// screenWidth, hSpacing, vSpacing and gapHeightRatio are all LIVE
// values: every frame, rebuildEffectiveLayout() recomputes them from
// the current cycle position of `layoutGroup` below. The numbers here
// are just the initial defaults before the first frame runs.
let screenWidth   = 220;      // width of one phone-screen module (px)
let aspectRatio   = 16 / 9;   // portrait ratio: height = screenWidth * aspectRatio
let screenHeight;             // computed below

let hSpacing = 14;            // horizontal gap between columns
let vSpacing = 14;            // vertical gap between screens within a column

let gapHeightRatio = 0.07;    // scroll-bar height, as fraction of screenHeight

// --- Timing of the swipe gesture (per-module scroll animation) ---
let swipeDuration  = 320;     // ms — duration of the bar's travel through the module

// Independent-random mode: after each swipe, a module waits a random
// amount of time (drawn fresh, uniformly) between minWaitTime and
// maxWaitTime before it swipes again.
let minWaitTime = 500;        // ms — shortest possible gap between a module's swipes
let maxWaitTime = 3000;       // ms — longest possible gap between a module's swipes

// How far across time (ms) each module's very first swipe is scattered,
// so the animation doesn't start all-in-sync at t = 0. Only affects the
// first event per module — every event after that is a live random draw.
let initialStaggerSpread = 2500;

// true  = every module runs its own independent random timer (desired look)
// false = every module swipes together on one shared clock, for testing
let staggeredMode = true;
let syncInterval  = 1200;     // ms — shared period used only when staggeredMode = false

// ---------------------- v36: SCROLL TIMING (Free / Pulse) ----------------------
// minWaitTime / maxWaitTime / swipeDuration above are FREE mode's
// settings (now saved per scene). PULSE mode's settings live here. Both
// modes remember their own values; switching never converts them.
const DEFAULT_SCROLL_TIMING = {
  mode: 'free',
  minWaitMs: 500, maxWaitMs: 3000, swipeMs: 320,   // Free
  flashHz: 1, nudgeHz: 0,                          // Pulse rate (1 Hz = 2 pulses per second)
  coverage: 0.3,                                   // share of visible screens per pulse
  swipeShare: 0.6,                                 // swipe length, share of the gap between ticks
  wobble: 0,                                       // 0 = metronome, 1 = ticks up to ±half a gap early/late
  spread: 0,                                       // 0 = picked screens start together, 1 = spread over the whole gap
};
let scrollTimingMode = DEFAULT_SCROLL_TIMING.mode;
let scrollFlashHz = DEFAULT_SCROLL_TIMING.flashHz;
let scrollNudgeHz = DEFAULT_SCROLL_TIMING.nudgeHz;
let scrollCoverage = DEFAULT_SCROLL_TIMING.coverage;
let scrollSwipeShare = DEFAULT_SCROLL_TIMING.swipeShare;
let scrollWobble = DEFAULT_SCROLL_TIMING.wobble;
let scrollSpread = DEFAULT_SCROLL_TIMING.spread;

// The current scroll settings as plain scene data.
function scrollTimingSnapshot() {
  return {
    mode: scrollTimingMode,
    minWaitMs: minWaitTime, maxWaitMs: maxWaitTime, swipeMs: swipeDuration,
    flashHz: scrollFlashHz, nudgeHz: scrollNudgeHz,
    coverage: scrollCoverage, swipeShare: scrollSwipeShare,
    wobble: scrollWobble, spread: scrollSpread,
  };
}

// ---------------------- N INDEPENDENT COLOUR SETS ----------------------
// Each set fully defines a look: background colour, scroll-bar colour,
// and the palette of colours modules swipe between, plus a per-swatch
// "selected" flag used by the copy/harmony/adjustment tools below.
// `colorSets` is the single ordered source of truth — set i is always
// labelled "Colors " + (i+1); there is no separate registry to keep in
// sync. Sets can be appended (the "+" control) or removed (the "×"
// control inside each set's own panel, see deleteColorSet()); either
// way, every remaining set's label is simply recomputed from its new
// position.

function makeDefaultColorSet(paletteDefs) {
  return {
    bgColorDef: [0, 0, 0],
    scrollColorDef: [0, 0, 0],
    paletteDefs: paletteDefs,
    bgSelected: true,
    scrollSelected: true,
    paletteSelected: paletteDefs.map(() => true),
    enabled: true, // unchecking a set's checkbox excludes it from the cycle — see computeCycleStateEnabled()
    baseKey: 0,    // v38.1: the ★ base colour — palette index, 'bg' or 'scroll' (see colorSetBaseKey())
  };
}

// v27: starts with just ONE colour set (was two, "Colors 1"/"Colors 2")
// — additional sets are something you now add deliberately with the
// "+" control, rather than something to delete on every fresh session.
// v31: a brand-new colour set is no longer greyscale on black. It picks
// ONE random hue and builds five colours from near-white to near-black
// in that hue, plus a complementary (+180°) mid-tone Background and
// Scroll line (both the same colour — the scroll line is drawn inside
// the modules, not against the background, so it stays visible). Used
// for the startup set and for every "+" (addColorSet()); the existing
// Copy-from and harmony tools remain the way to derive one set from
// another.
//
// v31 fix, second pass — PERCEPTUAL model. The first two passes stepped
// HSL lightness, which doesn't match how bright each hue actually looks
// (a yellow at HSL 50% reads far lighter than a purple at 50%), so even
// numeric steps still looked uneven. Now the steps are even in OKLCH
// lightness, a colour model built so equal steps LOOK equal for every
// hue. Each colour uses the most vivid chroma that still fits an
// ordinary sRGB screen at that lightness/hue (maxInGamutChroma()) — the
// perceptual equivalent of "full saturation". Consequence: very light
// and very dark steps are naturally less vivid (the screen simply can't
// show a vivid near-white), and how vivid each step can get varies by
// hue.
//
// The ends sit at OKLCH L 0.96 / 0.22 rather than 0.95 / 0.05: OKLCH's
// dark end is compressed differently from HSL's, and anything much
// below ~0.2 reads as plain black with no visible hue — 0.22 keeps the
// "clearly tinted near-black" look asked for.
// ---- OKLab / OKLCH helpers (Björn Ottosson's OKLab), plain JS ----
function srgbToLinear(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

// OKLCH (L 0..1, C >= 0, h degrees) -> LINEAR sRGB [r, g, b], possibly out of 0..1.
function oklchToLinearRgb(L, C, h) {
  let hr = h * Math.PI / 180;
  let a = C * Math.cos(hr), b = C * Math.sin(hr);
  let l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  let m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  let s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  let l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function inSrgbGamut(lin) {
  const eps = 1e-6;
  return lin.every((v) => v >= -eps && v <= 1 + eps);
}

// Largest chroma at (L, h) that still fits on an ordinary sRGB screen —
// the perceptual-model equivalent of "full saturation" at that lightness.
function maxInGamutChroma(L, h) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 24; i++) {
    let mid = (lo + hi) / 2;
    if (inSrgbGamut(oklchToLinearRgb(L, mid, h))) lo = mid; else hi = mid;
  }
  return lo;
}

// OKLCH -> sRGB [0..255] ints. `chromaFrac` is a fraction (0..1) of the
// maximum displayable chroma at this L/h, so 1 = as vivid as possible
// without leaving the screen's gamut.
function oklchToRgb255(L, chromaFrac, h) {
  let C = maxInGamutChroma(L, h) * chromaFrac;
  let lin = oklchToLinearRgb(L, C, h);
  return lin.map((v) => Math.round(Math.min(Math.max(linearToSrgb(Math.min(Math.max(v, 0), 1)), 0), 1) * 255));
}

// v32: the reverse direction — sRGB [0..255] -> OKLCH [L, C, h] — used by
// the "Match brightness" / "Match saturation" buttons to read each
// swatch's CURRENT perceptual brightness/vividness, whatever edits it's
// been through. h is meaningless (and returned as NaN) for a colour with
// essentially no chroma (greys, pure white/black); callers handle that.
function rgb255ToOklch(rgb) {
  let r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
  let l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  let m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  let s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  let L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  let A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  let B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let C = Math.sqrt(A * A + B * B);
  let h = C < 1e-4 ? NaN : ((Math.atan2(B, A) * 180 / Math.PI) + 360) % 360;
  return [L, C, h];
}

// v32: a swatch's vividness RELATIVE to the most vivid colour a screen
// can show at its own brightness and hue (0 = grey, 1 = as vivid as
// possible). This — not raw chroma — is what "Match saturation" copies,
// so e.g. a yellow and a blue both at "full" read as equally saturated
// even though a screen can make yellows far more chromatic than blues
// at most brightnesses. Same scale oklchToRgb255()'s chromaFrac uses.
function relativeChroma(L, C, h) {
  if (!(C > 0) || isNaN(h)) return 0;
  let maxC = maxInGamutChroma(L, h);
  return maxC > 1e-6 ? Math.min(C / maxC, 1) : 0;
}

const NEW_SET_COLOUR_COUNT = 5;
const NEW_SET_L_TOP = 0.96;        // OKLCH lightness of the near-white step
const NEW_SET_L_BOTTOM = 0.22;     // OKLCH lightness of the near-black step
const NEW_SET_CHROMA_FRAC = 1;     // fraction of max displayable chroma (1 = as vivid as possible)
const NEW_SET_BG_L = (NEW_SET_L_TOP + NEW_SET_L_BOTTOM) / 2; // "mid tone" = the middle step's lightness

function makeRandomHueColorSet() {
  let hue = Math.random() * 360; // OKLCH hue angle
  let paletteDefs = [];
  for (let i = 0; i < NEW_SET_COLOUR_COUNT; i++) {
    let L = NEW_SET_L_TOP - i * (NEW_SET_L_TOP - NEW_SET_L_BOTTOM) / (NEW_SET_COLOUR_COUNT - 1);
    paletteDefs.push(oklchToRgb255(L, NEW_SET_CHROMA_FRAC, hue));
  }
  let set = makeDefaultColorSet(paletteDefs);
  let complement = oklchToRgb255(NEW_SET_BG_L, NEW_SET_CHROMA_FRAC, hue + 180);
  set.bgColorDef = [...complement];
  set.scrollColorDef = [...complement];
  return set;
}

let colorSets = [makeRandomHueColorSet()];

// v31: "+" now appends a FRESH random-hue set (see makeRandomHueColorSet())
// instead of copying the current last set — use the set's own
// "Copy colors from" tool when a copy is what's wanted. Appends it to
// `colorSets` and returns it; the caller builds/attaches its menu and
// relays out the menu bar.
function addColorSet() {
  let newSet = makeRandomHueColorSet();
  colorSets.push(newSet);
  return newSet;
}

// ---------------------- COLOUR-SET CYCLE TIMING ----------------------
// "How often they change": how long each set is held before switching.
// v32: startup defaults kept as named constants so "+ Add Scene"
// (makeFreshScene()) can reset to exactly the same values.
const DEFAULT_COLOR_CHANGE_SEC = 3;
const DEFAULT_COLOR_TRANSITION_SEC = 2;
let changeIntervalSec = DEFAULT_COLOR_CHANGE_SEC;
// "How long the transition takes": 0 = instant swap, >0 = smooth crossfade.
// v27: default lowered from 4s to 2s, matching Layout's own default (see
// createLayoutSetGroup() below) so a fresh session's Colors and Layout
// timing agree out of the box.
let transitionDurationSec = DEFAULT_COLOR_TRANSITION_SEC;

// ---------------------- v35: FREQUENCY (Hz) MODE ----------------------
// Flash rate in Hz = FULL flashes per second; one flash = A -> B -> back
// to A = two colour changes (the convention flash-safety guidelines use).
// Only these values are offered — the screen can only show some rates
// evenly, see classifyFlashHz().
// v35.1: the slow end is defined by "each colour stays N seconds"
// (15 s down to 1 s), the fast end in plain Hz.
const SLOW_STAY_SECONDS = [15, 10, 7.5, 5, 4, 3, 2.5, 2, 1.5, 1];
const FLASH_HZ_VALUES = SLOW_STAY_SECONDS.map((sec) => 1 / (2 * sec))
  .concat([0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 10, 12, 15, 20, 24, 30, 40, 48, 60]);
const DEFAULT_FLASH_HZ = 0.1;       // = each colour stays 5 s per step...
const DEFAULT_FADE_SHARE = 0.4;     // ...of which 2 s fade: same as the old 3 s + 2 s default
// v35.2: two modes, per scene.
//   'flicker' — frame-locked rate from FLASH_HZ_VALUES + fade share;
//               changeIntervalSec / transitionDurationSec are DERIVED.
//   'slow'    — changeIntervalSec (Hold) + transitionDurationSec (Fade)
//               are the source of truth, ms-based; flashHz/fadeShare
//               just remember the last Flicker settings.
let colorTimingMode = 'slow';
// v35.6: Nudge — a fine offset added to the listed rate, for in-between
// rates (mainly to design slow beats). 0 = the clean listed rate.
const NUDGE_MIN_HZ = -1, NUDGE_MAX_HZ = 1, NUDGE_STEP_HZ = 0.05;
const MIN_EFFECTIVE_FLICKER_HZ = 0.02; // nudging a slow rate below 0 is clamped here
let colorNudgeHz = 0;
const DEFAULT_FLICKER_HZ = 1;      // v35.5: what Flicker starts at the first time it's picked
const DEFAULT_FLICKER_FADE = 0;
let colorFlashHz = DEFAULT_FLICKER_HZ;
let colorFadeShare = DEFAULT_FLICKER_FADE; // 0..1 — share of each colour's time spent fading into the next

// v35.5: each mode REMEMBERS its own settings. Slow change's Hold/Fade
// live here; Flicker's live in colorFlashHz/colorFadeShare. The active
// changeIntervalSec/transitionDurationSec are always derived from
// whichever mode is selected (timingApplyActive()), so switching modes
// never converts or overwrites the other mode's values.
let colorSlowHoldSec = DEFAULT_COLOR_CHANGE_SEC;
let colorSlowTransSec = DEFAULT_COLOR_TRANSITION_SEC;

function nearestFlashHz(f) {
  if (!Number.isFinite(f) || f <= 0) return DEFAULT_FLASH_HZ;
  let best = FLASH_HZ_VALUES[0];
  FLASH_HZ_VALUES.forEach((v) => {
    if (Math.abs(Math.log(v / f)) < Math.abs(Math.log(best / f))) best = v;
  });
  return best;
}

// Seconds (hold + transition) -> nearest listed rate + fade share. Used
// when switching Slow change -> Flicker, and to read older show files.
function flashFromSeconds(holdSec, transSec) {
  let hold = Number.isFinite(holdSec) ? Math.max(holdSec, 0) : DEFAULT_COLOR_CHANGE_SEC;
  let trans = Number.isFinite(transSec) ? Math.max(transSec, 0) : DEFAULT_COLOR_TRANSITION_SEC;
  let step = hold + trans;
  if (step <= 0) return { flashHz: FLASH_HZ_VALUES[FLASH_HZ_VALUES.length - 1], fadeShare: 0 };
  return { flashHz: nearestFlashHz(1 / (2 * step)), fadeShare: Math.min(trans / step, 1) };
}

// ---------------------- LAYOUT SETS (Spacing + Thickness + Scale) ----------------------
// Same idea as colorSets, but each "set" bundles THREE numbers together
// (module spacing, scroll-bar thickness, module scale) instead of a
// palette — they always change together as one look, the same
// relationship a colour set's background/scroll-line/palette have to
// each other. `layoutGroup.current` is recomputed once per frame in
// rebuildEffectiveLayout() and is what hSpacing/vSpacing/gapHeightRatio/
// screenWidth actually take their live values from.
//
// `spacing` is a PERCENTAGE of `scale` (0-100), not a pixel value — see
// rebuildEffectiveLayout(). This is what makes the gap between modules
// track Scale automatically instead of needing manual readjustment.
function createLayoutSetGroup(defaultSpacingPct, defaultThickness, defaultScale) {
  return {
    sets: [{ spacing: defaultSpacingPct, thickness: defaultThickness, scale: defaultScale, anchor: DEFAULT_ANCHOR, enabled: true }],
    changeIntervalSec: 3,
    transitionDurationSec: 2,
    // v35.3: Flicker / Slow change, same model as colour timing.
    timingMode: 'slow',
    flashHz: DEFAULT_FLICKER_HZ,      // Flicker memory
    fadeShare: DEFAULT_FLICKER_FADE,
    nudgeHz: 0,                       // v35.6
    slowHoldSec: 3,                   // v35.5: Slow change memory
    slowTransSec: 2,
    current: { spacing: defaultSpacingPct, thickness: defaultThickness, scale: defaultScale },
    // v30: the set whose `anchor` governs zooming THIS frame — set by
    // rebuildLayoutGroup() / updateSceneTransitionState(), read by
    // updateAnchorFrac(). Not saved anywhere; purely per-frame.
    anchorSet: null,
  };
}
// ---------------------- ZOOM ANCHOR (v30) ----------------------
// Anchor choices as fractions of the canvas: [x, y], 0 = left/top edge,
// 0.5 = centre, 1 = right/bottom edge. Keys are compass directions.
const ANCHOR_POINTS = {
  NW: [0, 0],   N: [0.5, 0],   NE: [1, 0],
  W:  [0, 0.5], C: [0.5, 0.5], E:  [1, 0.5],
  SW: [0, 1],   S: [0.5, 1],   SE: [1, 1],
};
const ANCHOR_RANDOM_MODES = ['RANDOM_ANY', 'RANDOM_9'];
const DEFAULT_ANCHOR = 'C';

function isValidAnchor(a) {
  return Object.prototype.hasOwnProperty.call(ANCHOR_POINTS, a) || ANCHOR_RANDOM_MODES.includes(a);
}

// The resolved zoom point for this frame, plus what it was resolved
// from — so a Random mode only re-picks when the governing set (or its
// chosen mode) actually changes, not every frame.
let anchorState = { frac: [0.5, 0.5], govSet: null, mode: null, lastKey9: null };

// Live grid origin: screen position of column 0 / row 0's top-left
// corner. (0,0) at startup = identical to pre-v30. prevCw/prevUh are
// last frame's columnWidth/unitHeight, so updateGridOrigin() can tell
// how much the grid was just rescaled.
let gridOrigin = { x: 0, y: 0, prevCw: null, prevUh: null };

const DEFAULT_LAYOUT_SPACING_PCT = 6;   // % of Scale — 6% of 220px ≈ the old 14px default
const DEFAULT_LAYOUT_THICKNESS_PCT = 7; // %
const DEFAULT_LAYOUT_SCALE_PX = 220;    // px
let layoutGroup = createLayoutSetGroup(DEFAULT_LAYOUT_SPACING_PCT, DEFAULT_LAYOUT_THICKNESS_PCT, DEFAULT_LAYOUT_SCALE_PX);

// ---------------------- SEQUENCE (SCENES) ----------------------
// A Scene is a saved configuration of the artwork's EXISTING controls —
// not a separate thing you program elsewhere. Each scene owns its own
// colorSets array, layoutGroup.sets array, and both groups' timing
// values. Exactly one scene is "loaded" at a time: the module-level
// `colorSets` variable and `layoutGroup.sets` that the rest of the file
// already reads/writes are made to literally POINT AT that scene's own
// arrays (see finalizeLoadScene()) — not a copy. So every existing
// interaction (add/delete a set, drag a slider, pick a colour, drag
// Change-every/Transition) mutates the loaded scene's data in place,
// live, with nothing to "save" and no snapshot/copy-back step that
// could race or drop an edit. Switching scenes crossfades from whatever
// is currently on screen to the incoming scene's first set (see the
// SCENE TRANSITION section below), then swaps which arrays those
// variables point at, plus a small rebuild of the left-side menu DOM (a
// different scene can have a different NUMBER of sets) and a reset of
// the cycle "epoch" so playback visibly restarts at Set 1.
//
// `sequenceScenes` is the ordered list; a scene's display name
// ("Scene " + position) is always recomputed from indexOf(), same
// convention as colorSetName()/layoutSetName().

let sequenceState = {
  currentSceneIndex: 0,
  sceneStartMs: 0,     // millis() when the current scene finished loading — start of its cycle count
  autoAdvance: true,   // when false, Sequence stops swapping scenes on its own — lets you edit the loaded scene without it changing underneath you; manually clicking another scene still switches
};

// Reset to `now` every time a scene finishes loading (see
// finalizeLoadScene()). computeCycleState()/rebuildLayoutGroup() measure
// elapsed time as `now - colorEpochMs` / `now - layoutEpochMs` rather than raw `now`, so a
// freshly-loaded scene's colour/layout cycle always visibly starts over
// at Set 1 instead of picking up wherever the absolute clock happens to
// land.
//
// v30: split into TWO independent clocks, one for Color and one for
// Layout. Both are still reset together at scene load, but clicking a
// Colors N / Layout N button (jumpColorToSet() / jumpLayoutToSet())
// moves only its own group's clock — with a single shared epoch,
// jumping Color would also have shifted Layout's position, and vice
// versa.
let colorEpochMs = 0;
let layoutEpochMs = 0;
let scrollEpochMs = 0; // v36: scroll Pulse clock (see resetScrollPulseClock())

// v43.0: THE ARTWORK CLOCK (the pause button; video export builds on it).
// Everything the artwork times reads sketchNow(), never millis(): playing
// = millis() minus the time spent paused; paused = frozen at the last
// drawn frame. vsyncCount (02_rhythm) stands still while paused too, so
// Flicker / Pulse freeze with Slow change, Free scroll, Projection fades,
// scene crossfades and the person's shimmer. Resume continues with the
// frame after the one shown (nothing jumps, nothing catches up). Real
// time stays where it measures the COMPUTER: readout, diagnostics, Auto
// sharpness, screen limit, backups, the person layer's redraw rate.
// Never paused: offsetMs = 0, so sketchNow() = millis() exactly.
let pauseState = { paused: false, offsetMs: 0, lastNow: 0, lastReal: 0 };
// v43.1: VIDEO EXPORT (engine in 09_export). While on, the artwork clock is
// virtual: frame k = startNow + k × 1000 / fps, however long a frame takes
// to draw; vsyncCount steps exactly 1 per frame (02_rhythm). It overrides
// the pause (an export always moves).
let exportState = { on: false, pending: null, fps: 60, frame: 0, frames: 0, startNow: 0, density: 1, smoothing: 'on', want: 0, after: false };
function sketchNow() {
  let P = pauseState;
  return (P.paused || exportState.on) ? P.lastNow : millis() - P.offsetMs; // v43.1
}
// v43.1: paused for the artwork (an export moves even when paused)
function artworkPaused() { return pauseState.paused && !exportState.on; }
// drawFrame() calls this once per frame with millis(): the frame's artwork time.
function sketchFrameNow(real) {
  let P = pauseState, E = exportState;
  P.lastReal = real;
  if (E.on) P.lastNow = E.startNow + E.frame * 1000 / E.fps; // v43.1
  else if (!P.paused) P.lastNow = real - P.offsetMs;
  return P.lastNow;
}
function setPaused(on) {
  let P = pauseState;
  on = !!on;
  if (on === P.paused) return;
  if (!on) P.offsetMs = P.lastReal - P.lastNow; // next frame = last shown + one frame
  P.paused = on;
  diagEvent(on ? 'paused' : 'resumed');
  if (rhythmDock) rhythmDock.refresh();
}
function togglePause() { setPaused(!pauseState.paused); }

// Floored at 0 defensively — millis() only ever increases in real
// usage so `now` should never fall behind an epoch, but this keeps
// computeCycleStateGeneric's `now % fullCycle` from ever going negative
// (which would produce an out-of-range index) if it somehow did. A jump
// can also legitimately place an epoch slightly in the past relative to
// `now` only — never the future — see jumpGroupEpoch().
function timeSinceColorEpoch(now) {
  return Math.max(now - colorEpochMs, 0);
}
function timeSinceLayoutEpoch(now) {
  return Math.max(now - layoutEpochMs, 0);
}

// v30: click-to-jump. Returns the epoch value that puts `setIndex` at
// the very START of its hold window right now (blend = 0, fully settled
// — an instant snap, not a crossfade). Rotation continues normally from
// there. Returns null (no change) if the set isn't in the rotation
// (disabled — the UI already blocks those clicks) or if there's nothing
// to rotate (a single enabled set, or zero total cycle time).
function jumpGroupEpoch(sets, setIndex, holdSec, transSec, now) {
  let idxs = enabledIndices(sets);
  let pos = idxs.indexOf(setIndex);
  if (pos < 0 || idxs.length <= 1) return null;
  let stepMs = (Math.max(holdSec, 0) + Math.max(transSec, 0)) * 1000;
  if (stepMs <= 0) return null;
  return now - pos * stepMs;
}

function jumpColorToSet(setIndex) {
  let e = jumpGroupEpoch(colorSets, setIndex, changeIntervalSec, transitionDurationSec, sketchNow()); // v43.0
  if (e !== null) colorEpochMs = e;
}
function jumpLayoutToSet(setIndex) {
  let e = jumpGroupEpoch(layoutGroup.sets, setIndex, layoutGroup.changeIntervalSec, layoutGroup.transitionDurationSec, sketchNow()); // v43.0
  if (e !== null) layoutEpochMs = e;
}

// v30: wires a Colors N / Layout N toggle row for click-to-jump. MUST be
// called BEFORE attachHoverAutoClose() on the same wrapper, so this
// listener runs first:
//   - set disabled (unchecked): swallow the click entirely
//     (stopImmediatePropagation also blocks attachHoverAutoClose's own
//     toggle listener) — only the checkbox stays interactive;
//   - set enabled and the panel is about to OPEN: jump the live display
//     to this set, then let the normal toggle open the panel. Closing
//     an already-open panel does NOT jump, so tidying up a menu never
//     yanks the display around.
// "About to open" = panel not currently shown: attachHoverAutoClose
// keeps display:'flex' exactly while its own isOpen is true.
function attachJumpOnClick(toggleBtn, panel, isEnabled, doJump) {
  toggleBtn.addEventListener('click', (e) => {
    if (!isEnabled()) {
      e.stopImmediatePropagation();
      return;
    }
    if (panel.style.display !== 'flex') doJump();
  });
}

// Greys the pointer on a disabled set's row so it reads as not clickable.
function refreshToggleRowCursor(toggleBtn, enabled) {
  toggleBtn.style.cursor = enabled ? 'pointer' : 'default';
}

// Cycle count given to a brand-new scene from "+ Add Scene".
let sequenceDefaultCycles = 1;

// Deep-clones a plain JSON-safe value (colorSets/layoutGroup.sets are
// plain numbers/arrays/booleans throughout, so JSON round-tripping is a
// reliable, low-code way to get a fully independent copy — used only
// when a NEW scene needs its own separate arrays, e.g. the two extra
// example scenes below and "+ Add Scene").
function deepClonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloneSceneFrom(scene, cycles) {
  return {
    // v32: a copy of a custom-named scene is labelled "<name> (copy)";
    // a copy of an unnamed one stays unnamed (auto "Scene N").
    name: scene.name ? scene.name + ' (copy)' : null,
    cycles,
    colorSets: deepClonePlain(scene.colorSets),
    colorTiming: { ...scene.colorTiming },
    layoutSets: deepClonePlain(scene.layoutSets),
    layoutTiming: { ...scene.layoutTiming },
    scrollTiming: { ...DEFAULT_SCROLL_TIMING, ...(scene.scrollTiming || {}) }, // v36
    // v29: seeded from the source's Layout Timing transition value at
    // the moment of duplication — a ONE-TIME copy, same "default, then
    // independent" convention as everything else here. Dragging Layout
    // Timing's own slider afterward (on this scene or the source) never
    // retroactively moves this.
    sceneTransitionDurationSec: scene.layoutTiming.transitionDurationSec,
    useSceneTransition: scene.useSceneTransition === true, // v29.1 — carries the source's on/off state forward
    mappings: deepClonePlain(scene.mappings || [makeDefaultMapping()]), // v40.1
    mappingTiming: deepClonePlain(scene.mappingTiming || makeDefaultMappingTiming()), // v40.5
  };
}

// v32: "+ Add Scene" no longer copies the loaded scene — it starts from
// the same defaults a fresh session does: ONE new random-hue Colors set
// (makeRandomHueColorSet()), ONE default Layout set, default timings,
// default cycle count, unified transition off. Copying an existing
// scene is now its own per-row ⧉ button (copySceneAfter()), which still
// uses cloneSceneFrom() above.
function makeFreshScene() {
  let g = createLayoutSetGroup(DEFAULT_LAYOUT_SPACING_PCT, DEFAULT_LAYOUT_THICKNESS_PCT, DEFAULT_LAYOUT_SCALE_PX);
  // v28 safety: keep a default Scale within the current window's ceiling.
  if (typeof currentMaxScalePx === 'function') {
    g.sets.forEach((set) => { set.scale = Math.min(set.scale, currentMaxScalePx()); });
  }
  return {
    name: null,
    cycles: sequenceDefaultCycles,
    colorSets: [makeRandomHueColorSet()],
    colorTiming: {
      changeIntervalSec: DEFAULT_COLOR_CHANGE_SEC, transitionDurationSec: DEFAULT_COLOR_TRANSITION_SEC,
      mode: 'slow', flashHz: DEFAULT_FLICKER_HZ, fadeShare: DEFAULT_FLICKER_FADE, nudgeHz: 0, // v35.2 / v35.6
      slowHoldSec: DEFAULT_COLOR_CHANGE_SEC, slowTransSec: DEFAULT_COLOR_TRANSITION_SEC, // v35.5
    },
    layoutSets: g.sets,
    layoutTiming: { changeIntervalSec: g.changeIntervalSec, transitionDurationSec: g.transitionDurationSec, mode: g.timingMode, flashHz: g.flashHz, fadeShare: g.fadeShare, nudgeHz: g.nudgeHz || 0, slowHoldSec: g.slowHoldSec, slowTransSec: g.slowTransSec }, // v35.3 / v35.5
    sceneTransitionDurationSec: g.transitionDurationSec, // same seed-from-Layout-Timing convention as everywhere else
    useSceneTransition: false,
    scrollTiming: { ...DEFAULT_SCROLL_TIMING }, // v36
    mappings: [makeDefaultMapping()], // v40.1
    mappingTiming: makeDefaultMappingTiming(), // v40.5
  };
}

// Scene 1 IS the default state already built above (same array objects
// by reference, not a copy) — so at startup, nothing needs loading;
// the artwork already shows exactly what Scene 1 will show.
//
// v27: starts with just this ONE scene (was three, seeded as examples)
// — additional scenes are something you now add deliberately with
// "+ Add Scene", rather than something to delete on every fresh
// session. cloneSceneFrom() (used by "+ Add Scene" itself, and still
// useful if you want to script more starter scenes back in) is
// otherwise unchanged.
let sequenceScenes = [
  {
    name: null,
    cycles: sequenceDefaultCycles,
    colorSets: colorSets,
    colorTiming: { changeIntervalSec, transitionDurationSec, mode: colorTimingMode, flashHz: colorFlashHz, fadeShare: colorFadeShare, nudgeHz: colorNudgeHz, slowHoldSec: colorSlowHoldSec, slowTransSec: colorSlowTransSec }, // v35.2 / v35.5
    layoutSets: layoutGroup.sets,
    layoutTiming: { changeIntervalSec: layoutGroup.changeIntervalSec, transitionDurationSec: layoutGroup.transitionDurationSec, mode: layoutGroup.timingMode, flashHz: layoutGroup.flashHz, fadeShare: layoutGroup.fadeShare, nudgeHz: layoutGroup.nudgeHz || 0, slowHoldSec: layoutGroup.slowHoldSec, slowTransSec: layoutGroup.slowTransSec }, // v35.3 / v35.5
    sceneTransitionDurationSec: layoutGroup.transitionDurationSec, // v29 — same seed-from-Layout-Timing convention as cloneSceneFrom()
    useSceneTransition: false, // v29.1 — off by default; check per-scene to use the new unified blend
    scrollTiming: scrollTimingSnapshot(), // v36
    mappings: [makeDefaultMapping()], // v40.1
    mappingTiming: makeDefaultMappingTiming(), // v40.5
  },
];

// "One cycle" of a scene = one full pass through its own colour
// pattern (e.g. Colors 1 -> 2 -> 3 = one cycle), matching the handoff's
// own example. Falls back to the layout pattern's length when colours
// aren't actually varying (e.g. a single enabled colour set), so a
// colour-static scene can still be timed instead of never completing
// a "cycle". Always reads from the currently LIVE colorSets/layoutGroup,
// since that IS this scene's data while it's the one loaded.
function groupFullCycleMs(sets, changeIntervalSecVal, transitionDurationSecVal) {
  let n = Math.max(enabledIndices(sets).length, 1);
  let holdMs = Math.max(changeIntervalSecVal, 0) * 1000;
  let transMs = Math.max(transitionDurationSecVal, 0) * 1000;
  return (holdMs + transMs) * n;
}
function currentSceneCycleDurationMs() {
  if (enabledIndices(colorSets).length > 1) {
    return groupFullCycleMs(colorSets, changeIntervalSec, transitionDurationSec);
  }
  if (enabledIndices(layoutGroup.sets).length > 1) {
    return groupFullCycleMs(layoutGroup.sets, layoutGroup.changeIntervalSec, layoutGroup.transitionDurationSec);
  }
  return groupFullCycleMs(colorSets, changeIntervalSec, transitionDurationSec);
}

// Called once per frame from draw(), BEFORE updateSceneTransitionState()
// / rebuildEffectivePalette() / rebuildEffectiveLayout(). Advances to
// the next scene once the current one has run its configured number of
// cycles — a no-op whenever autoAdvance is off, when there's only one
// scene (it just runs indefinitely, exactly like the artwork's
// behaviour before Sequence existed), or while a scene transition is
// already in flight (loadScene() below is itself guarded against
// re-triggering the same target, so calling it again here every frame
// during a transition is harmless).
function updateSequence(now) {
  if (!sequenceState.autoAdvance || sequenceScenes.length <= 1) return;
  let scene = sequenceScenes[sequenceState.currentSceneIndex];
  if (!scene) return;

  let totalMs = currentSceneCycleDurationMs() * Math.max(scene.cycles, 1);
  if (totalMs > 0 && now - sequenceState.sceneStartMs >= totalMs) {
    loadScene((sequenceState.currentSceneIndex + 1) % sequenceScenes.length);
  }
}

// ---------------------- SAVE / LOAD (SHOW PERSISTENCE) ----------------------
// v26 adds full show persistence: the ENTIRE Sequence (every Scene, its
// Colors/Layout sets and timings, autoAdvance, and which Scene is
// currently loaded) can be downloaded as a JSON file and loaded back in
// — on this computer or any other, since it's a plain file rather than
// anything tied to one browser's storage. This is the primary, portable
// save mechanism. A separate, lower-stakes mechanism (further below,
// "AUTO-BACKUP") keeps a rolling local history purely as a crash-
// recovery safety net on THIS browser — it is never how a show should
// travel between computers.
//
// File format:
// {
//   formatVersion: 1,
//   showName: string | null,
//   savedAt: ISO timestamp string,
//   sequenceState: { autoAdvance: boolean, currentSceneIndex: number },
//   scenes: [ { name, cycles, colorSets, colorTiming, layoutSets,
//               layoutTiming, sceneTransitionDurationSec }, ... ]  // last field added v29
// }
// — i.e. exactly sequenceScenes' own shape (see the SEQUENCE (SCENES)
// section above), which is already plain JSON-safe data throughout (see
// deepClonePlain()'s own note on this), so no conversion is needed going
// either direction.

const SHOW_FORMAT_VERSION = 1;
let lastShowName = null; // remembered only to prefill the next Save prompt

// Builds a fully independent, JSON-safe snapshot of the CURRENT show —
// used both by "Save Show" (JSON.stringify'd straight to a download) and
// by the auto-backup log (kept as a plain object in localStorage).
// Always deep-clones (deepClonePlain()) so a saved/backed-up snapshot is
// frozen at the moment this is called, never retroactively altered by
// further live edits to the sets it copied from.
function buildShowData(showName) {
  return {
    formatVersion: SHOW_FORMAT_VERSION,
    showName: showName || null,
    designAspect, // v39.3
    savedAt: new Date().toISOString(),
    sequenceState: {
      autoAdvance: sequenceState.autoAdvance,
      currentSceneIndex: sequenceState.currentSceneIndex,
    },
    scenes: deepClonePlain(sequenceScenes.map((s) => ({
      name: s.name,
      cycles: s.cycles,
      colorSets: s.colorSets,
      colorTiming: s.colorTiming,
      layoutSets: s.layoutSets,
      layoutTiming: s.layoutTiming,
      sceneTransitionDurationSec: s.sceneTransitionDurationSec, // v29
      useSceneTransition: s.useSceneTransition === true, // v29.1
      scrollTiming: s.scrollTiming, // v36
      mappings: s.mappings, // v40.1
      mappingTiming: s.mappingTiming, // v40.5
    }))),
    room: deepClonePlain(room), // v39.1: once per show, not per scene
  };
}

// Triggers a browser download of `data` as a named .json file — a plain
// Blob + object URL + a synthetic <a download>, no library needed.
// `filenameOverride` lets a caller (see triggerScheduledFileSave()) use
// a different filename than the usual slugified-show-name one, e.g. to
// keep automatic saves visually distinct from deliberate ones in your
// Downloads folder.
function downloadShowFile(data, filenameOverride) {
  let json = JSON.stringify(data, null, 2);
  let blob = new Blob([json], { type: 'application/json' });
  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = filenameOverride || (slugifyShowFilename(data.showName) + '.json');
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to actually start the download before the
  // object URL is revoked out from under it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// v27: a periodic "just in case" full Save Show, unconditional (no
// dedup against unchanged state — unlike the local auto-backup below,
// this is a deliberate download the user asked for on a fixed clock).
// Filenames get "-autosave-<timestamp>" so they're never confused with
// a Save Show you triggered yourself. NOTE: browsers can restrict
// downloads that don't originate from a direct user click/tap — this
// hasn't been exercised in a real browser session yet (see the sketch's
// own testing caveats), so if 30 minutes go by with no download, that's
// the first thing to check.
const AUTO_FILE_SAVE_INTERVAL_MS = 30 * 60 * 1000;

function triggerScheduledFileSave() {
  let data = buildShowData(lastShowName || 'Untitled show');
  let filename = slugifyShowFilename(data.showName) + '-autosave-' + Date.now() + '.json';
  downloadShowFile(data, filename);
}

function slugifyShowFilename(name) {
  let base = (name || 'endless-architecture-show')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'endless-architecture-show';
}

// Validates and fills in defaults for a JSON blob that CLAIMS to be a
// saved show — used for BOTH a loaded file and a stored auto-backup, so
// a file/backup missing a field a later sketch version added doesn't
// crash on load; it just falls back to a sensible default for that
// field, in the same spirit as this file's other defensive lookups
// (e.g. paletteAt()'s wrap-around, enabledIndices()'s fallback-to-all).
// Throws a plain Error with a human-readable message for input that
// isn't salvageable at all (not an object, or no usable scenes) — every
// caller is expected to catch this and show it to the user rather than
// let it propagate further.
function migrateShowData(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('not a show file (expected a JSON object)');
  }
  let rawScenes = Array.isArray(raw.scenes) ? raw.scenes : null;
  if (!rawScenes || rawScenes.length === 0) {
    throw new Error('missing or empty "scenes" list');
  }

  // v40.1: before v40 the centre surface was one per show (room.hub);
  // it now lives in each scene's View 1. Old files: every scene gets it.
  // v40.2: the same for the viewpoint (room.eye).
  let legacy = (raw.room && typeof raw.room === 'object') ? raw.room : {};
  let scenes = rawScenes.map((rawScene) => migrateSceneData(rawScene, legacy));

  let rawSeqState = (raw.sequenceState && typeof raw.sequenceState === 'object') ? raw.sequenceState : {};
  let currentSceneIndex = Number.isInteger(rawSeqState.currentSceneIndex) ? rawSeqState.currentSceneIndex : 0;
  currentSceneIndex = Math.min(Math.max(currentSceneIndex, 0), scenes.length - 1);

  return {
    formatVersion: Number.isFinite(raw.formatVersion) ? raw.formatVersion : 1,
    showName: typeof raw.showName === 'string' ? raw.showName : null,
    designAspect: DESIGN_FORMATS[raw.designAspect] ? raw.designAspect : '16:9', // v39.3
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : new Date().toISOString(),
    sequenceState: {
      autoAdvance: rawSeqState.autoAdvance !== false, // default true, same as the sketch's own initial state
      currentSceneIndex,
    },
    scenes,
    room: migrateRoomData(raw.room), // v39.1 (missing in older files -> defaults)
  };
}

function migrateSceneData(rawScene, legacy) {
  rawScene = (rawScene && typeof rawScene === 'object') ? rawScene : {};

  let colorSets = Array.isArray(rawScene.colorSets) && rawScene.colorSets.length > 0
    ? rawScene.colorSets.map((s) => migrateColorSetData(s))
    : [migrateColorSetData(null)];

  let layoutSets = Array.isArray(rawScene.layoutSets) && rawScene.layoutSets.length > 0
    ? rawScene.layoutSets.map((s) => migrateLayoutSetData(s))
    : [migrateLayoutSetData(null)];

  let colorTiming = (rawScene.colorTiming && typeof rawScene.colorTiming === 'object') ? rawScene.colorTiming : {};
  let layoutTiming = (rawScene.layoutTiming && typeof rawScene.layoutTiming === 'object') ? rawScene.layoutTiming : {};
  let resolvedLayoutTransitionSec = Number.isFinite(layoutTiming.transitionDurationSec) ? layoutTiming.transitionDurationSec : 2;

  // v29: a file saved before this field existed has no
  // sceneTransitionDurationSec at all — falls back to this scene's own
  // (already-resolved) Layout Timing transition value, the same number
  // v29's UI seeds a brand-new scene from, and close to what an old
  // file's scene switches already looked like (layoutTiming's own
  // transition duration was one of the two this used to borrow — see
  // beginSceneTransition()'s v29 comment further down).
  let sceneTransitionDurationSec = Number.isFinite(rawScene.sceneTransitionDurationSec)
    ? rawScene.sceneTransitionDurationSec
    : resolvedLayoutTransitionSec;

  return {
    name: typeof rawScene.name === 'string' ? rawScene.name : null,
    cycles: Number.isFinite(rawScene.cycles) && rawScene.cycles >= 1 ? rawScene.cycles : sequenceDefaultCycles,
    colorSets,
    colorTiming: migrateColorTiming(colorTiming), // v35.1
    layoutSets,
    layoutTiming: migrateColorTiming(layoutTiming), // v35.3: same model as colour timing
    sceneTransitionDurationSec,
    useSceneTransition: rawScene.useSceneTransition === true, // v29.1 — defaults off for files that predate it
    scrollTiming: migrateScrollTiming(rawScene.scrollTiming), // v36
    mappings: applySavedSharedEye(migrateMappings(rawScene.mappings || rawScene.viewSets, legacy), rawScene.sharedEye), // v40.1 (v40.1 files said viewSets; v40.19: + v40.17–18 shared viewpoint)
    mappingTiming: migrateMappingTiming(rawScene.mappingTiming), // v40.5
  };
}

// v35.2: picks the mode for a saved scene's colour timing.
//   - has a valid `mode`                  -> that mode
//   - v35 "Hz" save or v35.1 save         -> Flicker (they carry flashHz)
//   - anything else (pre-v35, v35 Seconds) -> Slow change, exactly as saved
function migrateColorTiming(ct) {
  let hold = Number.isFinite(ct.changeIntervalSec) ? Math.max(ct.changeIntervalSec, 0) : DEFAULT_COLOR_CHANGE_SEC;
  let fade = Number.isFinite(ct.transitionDurationSec) ? Math.max(ct.transitionDurationSec, 0) : DEFAULT_COLOR_TRANSITION_SEC;
  let hasRate = Number.isFinite(ct.flashHz);
  let mode = (ct.mode === 'flicker' || ct.mode === 'slow') ? ct.mode
    : (hasRate && ct.unit !== 's') ? 'flicker' : 'slow';
  let rate = hasRate
    ? { flashHz: nearestFlashHz(ct.flashHz), fadeShare: Number.isFinite(ct.fadeShare) ? Math.min(Math.max(ct.fadeShare, 0), 1) : 0 }
    : flashFromSeconds(hold, fade);
  if (mode === 'flicker') {
    let nudge = Number.isFinite(ct.nudgeHz) ? ct.nudgeHz : 0;
    let step = 1 / (2 * nudgedHz(rate.flashHz, nudge)); // v35.6: includes Nudge (v37.3: trimmed)
    hold = step * (1 - rate.fadeShare);
    fade = step * rate.fadeShare;
  } else if (hold + fade <= 0) {
    hold = DEFAULT_COLOR_CHANGE_SEC; // a zero-length cycle never changes; fall back to the default
  }
  // v35.5: Slow change memory. Saved since v35.5; before that a Slow
  // scene's own seconds ARE its memory, and a Flicker scene had none.
  let slowHold = Number.isFinite(ct.slowHoldSec) ? Math.max(ct.slowHoldSec, 0.05)
    : mode === 'slow' ? hold : DEFAULT_COLOR_CHANGE_SEC;
  let slowTrans = Number.isFinite(ct.slowTransSec) ? Math.max(ct.slowTransSec, 0)
    : mode === 'slow' ? fade : DEFAULT_COLOR_TRANSITION_SEC;
  return { mode, changeIntervalSec: hold, transitionDurationSec: fade, flashHz: rate.flashHz, fadeShare: rate.fadeShare,
           slowHoldSec: slowHold, slowTransSec: slowTrans,
           // v35.6: Nudge (absent before v35.6 -> 0, the clean listed rate)
           nudgeHz: Number.isFinite(ct.nudgeHz) ? Math.min(Math.max(ct.nudgeHz, NUDGE_MIN_HZ), NUDGE_MAX_HZ) : 0 };
}

// v36: scroll timing. Files from before v36 have none -> Free mode with
// the old built-in defaults (exactly what those shows looked like).
function migrateScrollTiming(st) {
  st = (st && typeof st === 'object') ? st : {};
  let d = DEFAULT_SCROLL_TIMING;
  let num = (v, lo, hi, def) => Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : def;
  return {
    mode: st.mode === 'pulse' ? 'pulse' : 'free',
    minWaitMs: num(st.minWaitMs, SCROLL_WAIT_MIN_MS, SCROLL_WAIT_MAX_MS, d.minWaitMs),
    maxWaitMs: num(st.maxWaitMs, SCROLL_WAIT_MIN_MS, SCROLL_WAIT_MAX_MS, d.maxWaitMs),
    swipeMs: num(st.swipeMs, SCROLL_SWIPE_MIN_MS, SCROLL_SWIPE_MAX_MS, d.swipeMs),
    flashHz: Number.isFinite(st.flashHz) ? nearestFlashHz(st.flashHz) : d.flashHz,
    nudgeHz: num(st.nudgeHz, NUDGE_MIN_HZ, NUDGE_MAX_HZ, d.nudgeHz),
    coverage: num(st.coverage, 0, 1, d.coverage),
    swipeShare: num(st.swipeShare, 0.05, 1, d.swipeShare),
    wobble: num(st.wobble, 0, 1, d.wobble),
    spread: num(st.spread, 0, 1, d.spread),
  };
}

function migrateColorSetData(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  let paletteDefs = Array.isArray(raw.paletteDefs) && raw.paletteDefs.length > 0
    ? raw.paletteDefs.map((rgb) => migrateRgb(rgb, [255, 255, 255]))
    : [[255, 255, 255], [0, 0, 0]];
  let paletteSelected = Array.isArray(raw.paletteSelected) && raw.paletteSelected.length === paletteDefs.length
    ? raw.paletteSelected.map((v) => v !== false)
    : paletteDefs.map(() => true);
  return {
    bgColorDef: migrateRgb(raw.bgColorDef, [0, 0, 0]),
    scrollColorDef: migrateRgb(raw.scrollColorDef, [0, 0, 0]),
    paletteDefs,
    bgSelected: raw.bgSelected !== false,
    scrollSelected: raw.scrollSelected !== false,
    paletteSelected,
    enabled: raw.enabled !== false,
    baseKey: (raw.baseKey === 'bg' || raw.baseKey === 'scroll'
      || (Number.isInteger(raw.baseKey) && raw.baseKey >= 0 && raw.baseKey < paletteDefs.length)) ? raw.baseKey : 0, // v38.1
  };
}

function migrateRgb(rgb, fallback) {
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => Number.isFinite(v))) {
    return [constrain(rgb[0], 0, 255), constrain(rgb[1], 0, 255), constrain(rgb[2], 0, 255)];
  }
  return [...fallback];
}

function migrateLayoutSetData(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  return {
    spacing: Number.isFinite(raw.spacing) ? constrain(raw.spacing, 0, 1000) : 6, // v41.5: up to 1000 %
    thickness: Number.isFinite(raw.thickness) ? constrain(raw.thickness, 0, 50) : 7,
    scale: Number.isFinite(raw.scale) ? constrain(raw.scale, 20, 800) : 220,
    anchor: isValidAnchor(raw.anchor) ? raw.anchor : DEFAULT_ANCHOR, // v30
    enabled: raw.enabled !== false,
  };
}

// Replaces the ENTIRE current show with `data` (already migrated — see
// migrateShowData()) and loads whichever Scene it says was active.
// Cancels any in-flight scene-transition crossfade first, since it would
// otherwise keep blending toward sets that no longer exist once the swap
// happens, and clears moduleStates — same as any other whole-palette-
// source change elsewhere in this file (e.g. copyColorSet()) — since the
// new show's palettes have no relation to whatever indices were in play
// a moment ago.
function applyShowData(data) {
  sceneTransition = null;
  sequenceScenes = data.scenes;
  sequenceState.autoAdvance = data.sequenceState.autoAdvance;
  moduleStates.clear();
  finalizeLoadScene(data.sequenceState.currentSceneIndex);
  safetyAfterShowLoad(); // v37.1: badge back on; note if scenes are over the limit
  room = deepClonePlain(data.room || ROOM_DEFAULTS); // v39.1
  setDesignAspect(data.designAspect || '16:9'); // v39.3
  if (roomMenu) roomMenu.refresh();
}

// ---------------------- AUTO-BACKUP (local crash-recovery safety net) ----------------------
// Independent of Save/Load above: periodically snapshots the current
// show into the BROWSER's own localStorage, keeping only the most
// recent AUTO_BACKUP_MAX. Purely a "the tab crashed / I forgot to save"
// recovery net for THIS computer — never a substitute for Save Show,
// since localStorage never leaves this one browser. Uses the exact same
// { formatVersion, showName, savedAt, sequenceState, scenes } shape as a
// saved file (buildShowData()), and a restored backup goes through the
// same migrateShowData() validation a loaded file does, so the two
// mechanisms share one code path for everything except where the bytes
// live.
const AUTO_BACKUP_STORAGE_KEY = 'endlessArchitecture.autoBackups.v1';
const AUTO_BACKUP_MAX = 10;
const AUTO_BACKUP_INTERVAL_MS = 2 * 60 * 1000; // v27: widened from 15s to 2min
let lastAutoBackupSignature = null; // dedup guard — skip writing an identical snapshot while idle

// Both wrapped in try/catch: localStorage can throw (private browsing,
// quota exceeded, disabled entirely) in perfectly normal use. Since this
// is a convenience net and never the primary save path, failing silently
// here is the right behaviour — nothing the user does depends on it
// succeeding, and Save Show remains completely unaffected either way.
function loadAutoBackups() {
  try {
    let raw = window.localStorage.getItem(AUTO_BACKUP_STORAGE_KEY);
    if (!raw) return [];
    let parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function saveAutoBackups(list) {
  try {
    window.localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // Storage full/unavailable — see note above; nothing else to do.
  }
}

// Called periodically (see the setInterval in setupUI()) and once right
// before a Load Show replaces everything, so the show you're about to
// leave isn't lost without at least one recovery point. Skips writing
// when nothing has actually changed since the last snapshot (compares a
// cheap JSON signature of just the parts that matter), so sitting idle
// doesn't burn through the 10-slot history with duplicate states.
function captureAutoBackup() {
  let data = buildShowData(null); // unnamed — these are timestamp-identified, not user-named
  let signature = JSON.stringify(data.scenes) + '|' + JSON.stringify(data.sequenceState) + '|' + JSON.stringify(data.room) + '|' + data.designAspect; // v39.1 / v39.3
  if (signature === lastAutoBackupSignature) return;
  lastAutoBackupSignature = signature;

  let backups = loadAutoBackups();
  backups.unshift(data);
  if (backups.length > AUTO_BACKUP_MAX) backups.length = AUTO_BACKUP_MAX;
  saveAutoBackups(backups);
  refreshBackupList();
}

// ---------------------- v39.2: SESSION SNAPSHOTS ----------------------
// Fine-grained "where was I" history, separate from the 2-minute backups:
// checked every second, written only when something changed, one slot per
// SESSION_SNAPSHOT_EVERY_MS (the newest slot keeps updating until it's that
// old), the last SESSION_SNAPSHOT_MAX kept. Each holds the whole show (as
// buildShowData(), so it includes the room) plus the Flat/Room view. Only
// starts once the startup box is closed, so a fresh page never pushes the
// previous session's states out before you can pick one.
const SESSION_STORAGE_KEY = 'endlessArchitecture.sessionSnapshots.v1';
const SESSION_SNAPSHOT_EVERY_MS = 5000;
const SESSION_SNAPSHOT_MAX = 36;
const SESSION_ID = Date.now() + '-' + Math.floor(Math.random() * 1e6);
let sessionSnapshotsActive = false;
let lastSessionSig = null;

function loadSessionSnapshots() {
  try {
    let raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    let list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

// Storage can be full: keep halving the list until it fits.
function saveSessionSnapshots(list) {
  for (let tries = 0; tries < 6 && list.length; tries++) {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(list));
      return;
    } catch (err) {
      list = list.slice(0, Math.ceil(list.length / 2));
    }
  }
}

function captureSessionSnapshot() {
  if (!sessionSnapshotsActive) return;
  let data = buildShowData(lastShowName);
  let view = { roomView };
  let sig = JSON.stringify(data.scenes) + '|' + JSON.stringify(data.sequenceState) + '|'
    + JSON.stringify(data.room) + '|' + data.designAspect + '|' + JSON.stringify(view);
  if (sig === lastSessionSig) return;
  lastSessionSig = sig;
  let now = Date.now();
  let list = loadSessionSnapshots();
  let top = list[0];
  let entry = { t: now, t0: now, session: SESSION_ID, data, view };
  if (top && top.session === SESSION_ID && now - (top.t0 || top.t) < SESSION_SNAPSHOT_EVERY_MS) {
    entry.t0 = top.t0 || top.t; // still inside the newest slot: update it
    list[0] = entry;
  } else {
    list.unshift(entry);
  }
  if (list.length > SESSION_SNAPSHOT_MAX) list.length = SESSION_SNAPSHOT_MAX;
  saveSessionSnapshots(list);
}

function startSessionSnapshots() {
  sessionSnapshotsActive = true;
  lastSessionSig = null;
}

function snapshotTimeAgo(t) {
  let s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + ' s ago';
  let m = Math.round(s / 60);
  if (m < 60) return m + ' min ago';
  return new Date(t).toLocaleString();
}

function describeSnapshot(snap) {
  let d = snap.data || {};
  let scenes = Array.isArray(d.scenes) ? d.scenes : [];
  let i = (d.sequenceState && Number.isInteger(d.sequenceState.currentSceneIndex)) ? d.sequenceState.currentSceneIndex : 0;
  let sc = scenes[i];
  let name = (sc && sc.name) ? sc.name : 'Scene ' + (i + 1);
  if (scenes.length > 1) name += ' of ' + scenes.length;
  let r = d.room;
  let where = (snap.view && snap.view.roomView)
    ? 'Room' + (r ? ' ' + r.w + '×' + r.h + '×' + r.d + ' m' : '')
    : 'Flat view';
  return name + ' · ' + where;
}

// Loads a snapshot. `flat` = same state, but start in Flat view.
function resumeSessionSnapshot(snap, flat) {
  let migrated;
  try {
    migrated = migrateShowData(snap.data);
  } catch (err) {
    window.alert('This saved state is damaged and can\'t be opened: ' + err.message);
    return false;
  }
  applyShowData(migrated);
  if (migrated.showName) lastShowName = migrated.showName;
  roomView = !flat && !!(snap.view && snap.view.roomView);
  roomMoveEye = false;
  if (roomMenu) roomMenu.refresh();
  return true;
}

function formatBackupTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch (err) {
    return iso;
  }
}

// ---------------------- EFFECTIVE (BLENDED) RENDER STATE ----------------------
// Rebuilt once per frame — NOT per module.
let palette = [];   // array of p5.Color, the blended palette in use right now
let colBg;           // blended background colour
let colScroll;        // blended scroll-bar colour

// ---------------------- INTERNAL (derived) VALUES ----------------------
let unitHeight;
let columnWidth;
let gapHeight;

// Per-module state, keyed by "c_r". Each entry:
// {
//   colorIndex,        current (static) colour index into `palette`
//   nextColorIndex,     colour index being swiped in
//   swiping,            bool — mid-swipe right now?
//   swipeStartTime,      ms timestamp the current swipe began
//   nextSwipeTime         ms timestamp this module is next allowed to swipe
// }
let moduleStates = new Map();

// ---------------------- v40.1 / v40.2: MAPPINGS ----------------------
// A Mapping holds how the artwork sits on the room. Saved PER SCENE as
// `mappings` (a list: Mapping 1, 2…; called "View sets" in v40.1).
// ARTWORK settings — part of the piece, exported:
//   hub  — the centre surface of the unfolded sheet
//   flow — 'up' or 'down': which way every swipe travels on the sheet.
// One rule explains the flow: screens flow UP the unfolded sheet (or all
// DOWN it), and where two surfaces join on the sheet, the flow carries
// straight across.
// SHOWCASE settings — only for demo videos, never the real walls:
//   eye  — the viewpoint (v40.2: moved here from the show-level room).
// The room itself (size, shown surfaces) stays once per show, like the
// venue. Changes between mappings can't blend, so they CUT (see
// frameMapping below).
const VIEW_FLOWS = ['up', 'down'];
const RADIATE_MODES = ['off', 'x', 'plus']; // v40.7
// (Literals only: scene 1 is built near the top of the file, before the
// room constants exist.)
function makeDefaultMapping() {
  return {
    hub: 'back', flow: 'up', eye: [0.5, 0.5],
    // v40.4: per mapping — which surfaces are projected on, and which are
    // reversed (mirrored along the flow, so they flow the other way).
    walls: { back: true, left: true, right: true, ceiling: true, floor: true },
    reversed: { back: false, left: false, right: false, ceiling: false, floor: false },
    radiate: 'off', // v40.7: 'off' | 'x' | 'plus' — flow out from the middle of the centre
    // v40.9 / v40.10: which point of the middle screen sits on the
    // midpoint, in the screen's own directions — across −1 left edge … 0
    // centre … +1 right edge; along −1 top edge … +1 bottom edge — PER
    // SECTION (in RADIATE_REGIONS order). `link` = how the sliders move
    // them: 'all' four together, 'pairs' (opposite sections together),
    // or 'each' on its own.
    radiateAlign: makeDefaultRadiateAlign(),
  };
}

function migrateMappings(raw, legacy) {
  legacy = legacy || {};
  let fallbackHub = ROOM_FACE_NAMES.includes(legacy.hub) ? legacy.hub : 'back';
  let list = Array.isArray(raw) && raw.length > 0 ? raw : [{}];
  return list.map((m) => {
    m = (m && typeof m === 'object') ? m : {};
    return {
      hub: ROOM_FACE_NAMES.includes(m.hub) ? m.hub : fallbackHub,
      flow: VIEW_FLOWS.includes(m.flow) ? m.flow : 'up',
      eye: migrateEye(m.eye !== undefined ? m.eye : legacy.eye),
      walls: migrateFaceFlags(m.walls || legacy.walls, true),   // v40.4 (was once per show)
      reversed: migrateFaceFlags(m.reversed, false),            // v40.4
      radiate: RADIATE_MODES.includes(m.radiate) ? m.radiate : 'off', // v40.7
      radiateAlign: migrateRadiateAlign(m.radiateAlign), // v40.9
    };
  });
}

const RADIATE_LINKS = ['all', 'pairs', 'each'];
// v40.10: which sections each slider pair moves, and its heading. Sections
// are in RADIATE_REGIONS order — ✕: top, right, bottom, left; ✚: top
// right, bottom right, bottom left, top left — so opposite ones are
// always 0 & 2 and 1 & 3.
function radiateAlignGroups(mode, link) {
  if (link === 'all') return [{ idx: [0, 1, 2, 3], label: '' }];
  if (link === 'pairs') return mode === 'plus'
    ? [{ idx: [0, 2], label: '↗ Top right & ↙ bottom left' }, { idx: [1, 3], label: '↘ Bottom right & ↖ top left' }]
    : [{ idx: [0, 2], label: '↕ Top & bottom' }, { idx: [1, 3], label: '↔ Left & right' }];
  let names = mode === 'plus' ? ['↗ Top right', '↘ Bottom right', '↙ Bottom left', '↖ Top left'] : ['↑ Top', '→ Right', '↓ Bottom', '← Left'];
  return [0, 1, 2, 3].map((i) => ({ idx: [i], label: names[i] }));
}
function makeDefaultRadiateAlign() {
  return { link: 'all', sections: [0, 1, 2, 3].map(() => ({ across: 0, along: 0 })) };
}
function migrateRadiateAlign(a) {
  let c = (v) => Number.isFinite(v) ? Math.min(Math.max(v, -2), 2) : 0; // v40.19: ±2 (one gap past the edge)
  a = (a && typeof a === 'object') ? a : {};
  if (!Array.isArray(a.sections)) { // v40.9 files: one shared alignment
    let one = { across: c(a.across), along: c(a.along) };
    return { link: 'all', sections: [0, 1, 2, 3].map(() => ({ ...one })) };
  }
  return {
    link: RADIATE_LINKS.includes(a.link) ? a.link : 'all',
    sections: [0, 1, 2, 3].map((i) => ({ across: c(a.sections[i] && a.sections[i].across), along: c(a.sections[i] && a.sections[i].along) })),
  };
}

// v40.4: { back: bool, left: … } with a default for anything missing.
function migrateFaceFlags(raw, def) {
  let out = {};
  ROOM_FACE_NAMES.forEach((n) => {
    out[n] = (raw && typeof raw[n] === 'boolean') ? raw[n] : def;
  });
  return out;
}

// v40.17: viewpoint helpers (v40.19: per mapping only; copying between
// mappings is the 👁📋 menu in 👁 Room → Showcase).
function currentScene() { return sequenceScenes[sequenceState.currentSceneIndex]; }
// v40.19: the shared viewpoint was removed (the 👁📋 menu's "All mappings"
// does the job); a file saved with one gives it to every mapping on load.
function eyeFor(mp) { return (mp && mp.eye) || [0.5, 0.5]; }
function setViewEye(e) { activeMapping().eye = e; }
function copyViewpointToAllMappings() {
  let sc = currentScene();
  if (!sc || !sc.mappings) return;
  let e = eyeFor(activeMapping());
  sc.mappings.forEach((m) => { m.eye = e.slice(); });
}

function applySavedSharedEye(mappings, shared) {
  if (Array.isArray(shared)) { let e = migrateEye(shared); mappings.forEach((m) => { m.eye = e.slice(); }); }
  return mappings;
}

function migrateEye(e) {
  return Array.isArray(e) && e.length === 2 && e.every((v) => Number.isFinite(v))
    ? e.map((v) => Math.min(Math.max(v, ROOM_EYE_MARGIN), 1 - ROOM_EYE_MARGIN)) : [0.5, 0.5];
}

// v40.2: which mapping of the loaded scene is playing / being edited.
// No cycling yet: you pick one with its button. A scene always starts on
// Mapping 1 (like Colour and Layout sets); not saved.
let mappingIndex = 0;
function activeMapping() {
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  if (!sc.mappings || !sc.mappings.length) sc.mappings = [makeDefaultMapping()];
  if (mappingIndex >= sc.mappings.length) mappingIndex = sc.mappings.length - 1;
  if (mappingIndex < 0) mappingIndex = 0;
  let m = sc.mappings[mappingIndex];
  // v40.4: never trip over a mapping that lacks the newer fields
  if (!m.walls) m.walls = migrateFaceFlags(null, true);
  if (!m.reversed) m.reversed = migrateFaceFlags(null, false);
  if (!m.eye) m.eye = [0.5, 0.5];
  if (!RADIATE_MODES.includes(m.radiate)) m.radiate = 'off';
  if (!m.radiateAlign || !Array.isArray(m.radiateAlign.sections)) m.radiateAlign = migrateRadiateAlign(m.radiateAlign);
  return m;
}

// v40.2: + copies the mapping you're on, × deletes it (never the last).
function addMapping() {
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  let copy = deepClonePlain(activeMapping());
  sc.mappings.splice(mappingIndex + 1, 0, copy);
  mappingIndex++;
}
function requestDeleteMapping() {
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  if (sc.mappings.length <= 1) return;
  if (!window.confirm('Delete Projection ' + (mappingIndex + 1) + '? This cannot be undone.')) return;
  sc.mappings.splice(mappingIndex, 1);
  mappingIndex = Math.min(mappingIndex, sc.mappings.length - 1);
}

// ---------------------- v40.5: CHANGING MAPPINGS ----------------------
// Per scene: how one mapping changes to the next — a CUT or a FADE
// (crossfade: both mappings drawn, the new one on top growing from
// transparent) — and whether the scene CYCLES through its mappings by
// itself, holding each for `holdSec`. Clicking a mapping button uses the
// same change. A scene starts on Mapping 1 and its cycle clock restarts.
const MAPPING_HOLD_MIN_SEC = 2;   // safety: never cut faster than this
const MAPPING_HOLD_RANGE = [MAPPING_HOLD_MIN_SEC, 600];
const MAPPING_FADE_RANGE = [0.1, 20];
function makeDefaultMappingTiming() {
  return { change: 'cut', fadeSec: 1, cycle: true, holdSec: 4 }; // v40.6: Cut + cycle every 4 s by default
}
function migrateMappingTiming(raw) {
  raw = (raw && typeof raw === 'object') ? raw : {};
  let d = makeDefaultMappingTiming();
  let num = (v, [lo, hi], def) => Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : def;
  return {
    change: raw.change === 'fade' ? 'fade' : 'cut',
    fadeSec: num(raw.fadeSec, MAPPING_FADE_RANGE, d.fadeSec),
    cycle: raw.cycle !== false,
    holdSec: num(raw.holdSec, MAPPING_HOLD_RANGE, d.holdSec),
  };
}
function sceneMappingTiming() {
  let sc = sequenceScenes[sequenceState.currentSceneIndex];
  if (!sc.mappingTiming) sc.mappingTiming = makeDefaultMappingTiming();
  return sc.mappingTiming;
}
