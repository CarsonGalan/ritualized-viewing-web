// noprotect
// Ritualized Viewing v43.1 — 05_menus.js
// setupUI(), top-bar menus Colors and Layout, set group menus & chips, colour tools, sliders, UI helpers, hover auto-close, rebuildColorAndLayoutMenus. (v42.0: the Projection menu, view switch, icons and ⓘ dots moved to 05b_projection.js.)
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// =====================================================================
// COLOUR HARMONY / ADJUSTMENT ENGINE
// v38.1: everything here works in the perceptual OKLCH model (see the
// OKLab helpers near the top of the file), so "same brightness" and
// "same saturation" LOOK the same across hues. The old HSL helpers are
// gone. All operations are CUMULATIVE: they read and rewrite a swatch's
// current colour, so repeated clicks compound as expected.
// =====================================================================

// v38.1: the same colour with a new hue, keeping its own perceptual
// brightness and relative saturation. A grey has no saturation to show
// a hue with, so it comes back unchanged.
function withOklchHue(rgb, hue) {
  let [L, C, h] = rgb255ToOklch(rgb);
  if (isNaN(h)) return rgb;
  return oklchToRgb255(L, relativeChroma(L, C, h), hue);
}

// Shared list of hue-relationship angles, used both by the intra-set
// "Generate hues" buttons and by the cross-set copy-with-shift dropdown.
const HARMONY_ANGLE_OPTIONS = [
  ['Adjacent −', -30], ['Adjacent +', 30],
  ['Triadic −', -120], ['Triadic +', 120],
  ['Tetradic −', -90], ['Tetradic +', 90],
  ['Complementary', 180],
];

// Flat, ordered view over a colour set's three kinds of swatches
// (background, scroll line, palette entries), each exposing a get/set
// `rgb` and a `selected` flag, so the tools below don't need three
// separate code paths.
//
// v31: ORDER — palette colours FIRST, then Background, then Scroll line.
// v38.1: the base is no longer "the first ticked" but the ★ entry (see
// baseAndOthers()); this order is now only the order the OTHER ticked
// colours are stepped in. Each entry has a `key` (palette index, 'bg'
// or 'scroll') matching colorSet.baseKey.
function getSetEntries(colorSet) {
  let entries = [];
  colorSet.paletteDefs.forEach((rgb, i) => {
    entries.push({
      key: i, // v38.1
      get rgb() { return colorSet.paletteDefs[i]; },
      set rgb(v) { colorSet.paletteDefs[i] = v; },
      get selected() { return colorSet.paletteSelected[i]; },
    });
  });
  entries.push({
    key: 'bg', // v38.1
    get rgb() { return colorSet.bgColorDef; },
    set rgb(v) { colorSet.bgColorDef = v; },
    get selected() { return colorSet.bgSelected; },
  });
  entries.push({
    key: 'scroll', // v38.1
    get rgb() { return colorSet.scrollColorDef; },
    set rgb(v) { colorSet.scrollColorDef = v; },
    get selected() { return colorSet.scrollSelected; },
  });
  return entries;
}

// v38.1: the set's ★ base, validated (a removed colour falls back to Colour 1).
function colorSetBaseKey(colorSet) {
  let k = colorSet.baseKey;
  if (k === 'bg' || k === 'scroll') return k;
  return (Number.isInteger(k) && k >= 0 && k < colorSet.paletteDefs.length) ? k : 0;
}

// v38.1: what every base tool works from — the ★ entry, and the OTHER
// ticked entries in list order (the base is never among them).
function baseAndOthers(colorSet) {
  let key = colorSetBaseKey(colorSet);
  let entries = getSetEntries(colorSet);
  let base = entries.find((e) => e.key === key);
  let others = entries.filter((e) => e !== base && e.selected);
  return { base, others };
}

// Fully overwrites targetSet with a one-time snapshot of sourceSet
// (background, scroll line, palette — resized to match, all newly
// selected). After this call the two sets are completely decoupled;
// further edits to one never affect the other.
function copyColorSet(sourceSet, targetSet) {
  targetSet.bgColorDef = [...sourceSet.bgColorDef];
  targetSet.scrollColorDef = [...sourceSet.scrollColorDef];
  targetSet.paletteDefs = sourceSet.paletteDefs.map(rgb => [...rgb]);
  targetSet.bgSelected = true;
  targetSet.scrollSelected = true;
  targetSet.paletteSelected = targetSet.paletteDefs.map(() => true);
  targetSet.baseKey = colorSetBaseKey(sourceSet); // v38.1
  moduleStates.clear();
}

// Rotates EVERY swatch's own hue by shiftDeg, independently, preserving
// each swatch's own (v38.1: perceptual) brightness and saturation. Unlike applyHueHarmonyGenerate
// (which fixes one ticked swatch as an unmoving "base" and steps the
// others outward from it), this touches every swatch equally — so a set
// produced this way from another set never keeps a leftover-identical
// colour, which is what made a plain harmony-generate after a Copy look
// like one swatch had "frozen" between the two colour sets.
function applyHueShiftToAll(colorSet, shiftDeg) {
  if (shiftDeg === 0) return;
  getSetEntries(colorSet).forEach((entry) => {
    let h = rgb255ToOklch(entry.rgb)[2]; // v38.1: perceptual (OKLCH) hue
    if (!isNaN(h)) entry.rgb = withOklchHue(entry.rgb, h + shiftDeg);
  });
}

// One-time snapshot copy of sourceSet into targetSet (see copyColorSet),
// optionally followed by a uniform hue rotation of the freshly-copied
// colours. This is how "the complementary/triadic/etc. of the other
// list" is generated directly, in one action, rather than needing a
// separate cross-set harmony tool alongside the existing intra-set one.
function copyColorSetWithShift(sourceSet, targetSet, shiftDeg) {
  copyColorSet(sourceSet, targetSet);
  applyHueShiftToAll(targetSet, shiftDeg);
}

// v38.1: hue-harmony generation. The ★ base keeps its colour; the OTHER
// ticked colours (list order) get hue = baseHue + angleStep × 1, 2, 3 …,
// each keeping its own perceptual brightness and saturation (OKLCH —
// was HSL before v38.1). If more colours are ticked than the harmony
// defines (e.g. > 2 others for triadic), the angle sequence simply
// continues. A grey stays grey; a grey base gives hue 0.
function applyHueHarmonyGenerate(colorSet, angleStepDeg) {
  let { base, others } = baseAndOthers(colorSet);
  if (others.length === 0) return;
  let bH = rgb255ToOklch(base.rgb)[2];
  let baseH = isNaN(bH) ? 0 : bH;
  others.forEach((entry, i) => {
    entry.rgb = withOklchHue(entry.rgb, baseH + angleStepDeg * (i + 1));
  });
}

// v32: "Match brightness" / "Match saturation". Same selection rule as
// the hue buttons above: acts on the TICKED swatches, in harmony order
// (colours, then Background, then Scroll line — see getSetEntries()),
// v38.1: from the ★ base. Measured perceptually (OKLCH), so "same
// brightness" looks the same across different hues.
//   - Brightness: each takes the base's brightness, keeping its OWN hue
//     and its own relative vividness. On a fresh random-hue set (every
//     colour already one hue at full vividness) this makes them identical.
//   - Saturation: each takes the base's relative vividness (see
//     relativeChroma()), keeping its own hue and brightness.
// The base itself is left exactly as it is. A swatch with no hue of its
// own (a pure grey/white/black) borrows the base's hue, since "match
// saturation" on a grey otherwise has no direction to go in.
//   - v33 Hue: each takes the base's hue, keeping its own brightness and
//     relative vividness. A grey stays grey (no vividness to show a hue
//     with); if the BASE is grey there's no hue to give, so nothing changes.
function applyMatchToBase(colorSet, which) {
  let { base: baseEntry, others } = baseAndOthers(colorSet); // v38.1: ★ base
  if (others.length === 0) return;
  let base = rgb255ToOklch(baseEntry.rgb);
  others.forEach((entry) => {
    entry.rgb = transferPerceptualProperty(base, entry.rgb, which, 0);
  });
}

// v33: the single "take ONE property from a source colour, keep the
// other two" rule shared by the Match buttons (source = the base swatch)
// and the "Copy only" buttons (source = the same-position swatch in
// another set). `which` is 'brightness' | 'saturation' | 'hue';
// `src` is an OKLCH [L, C, h] triple; hueShiftDeg is added to the
// source hue when copying hue (the Copy row's shift dropdown).
// Saturation is always RELATIVE vividness (relativeChroma()).
// Hue-less cases: a grey TARGET borrows the source's hue when taking
// brightness/saturation (so "match saturation" can colour it in); a
// grey SOURCE has no hue to give, so "hue" leaves the target unchanged.
function transferPerceptualProperty(src, targetRgb, which, hueShiftDeg) {
  let [sL, sC, sH] = src;
  let [L, C, h] = rgb255ToOklch(targetRgb);
  let frac = relativeChroma(L, C, h);
  if (which === 'hue') {
    if (isNaN(sH)) return targetRgb;
    return oklchToRgb255(L, frac, sH + (hueShiftDeg || 0));
  }
  if (isNaN(h)) h = isNaN(sH) ? 0 : sH;
  if (which === 'brightness') return oklchToRgb255(sL, frac, h);
  return oklchToRgb255(L, relativeChroma(sL, sC, sH), h); // 'saturation'
}

// v33: "Copy only brightness / saturation / hue" from another set.
// Swatches pair up BY POSITION — Colour 1 <- Colour 1, Colour 2 <-
// Colour 2, Background <- Background, Scroll line <- Scroll line. Only
// TICKED swatches in the target change; a target colour with no
// counterpart (target has more colours than the source) is left alone.
// hueShiftDeg only matters for 'hue'.
function copyPropertyFromSet(sourceSet, targetSet, which, hueShiftDeg) {
  function apply(srcRgb, getT, setT, selected) {
    if (!selected || !srcRgb) return;
    setT(transferPerceptualProperty(rgb255ToOklch(srcRgb), getT(), which, hueShiftDeg));
  }
  targetSet.paletteDefs.forEach((rgb, i) => apply(
    sourceSet.paletteDefs[i],
    () => targetSet.paletteDefs[i],
    (v) => { targetSet.paletteDefs[i] = v; },
    targetSet.paletteSelected[i]));
  apply(sourceSet.bgColorDef, () => targetSet.bgColorDef, (v) => { targetSet.bgColorDef = v; }, targetSet.bgSelected);
  apply(sourceSet.scrollColorDef, () => targetSet.scrollColorDef, (v) => { targetSet.scrollColorDef = v; }, targetSet.scrollSelected);
}

// v34: PERCEPTUAL Saturation / Brightness / Contrast for the adjust rows
// (Increase/Decrease by the chosen %), applied to every TICKED swatch,
// cumulative like before. Each changes ONE property and keeps the other
// two — same rule as transferPerceptualProperty():
//   - 'saturation': relative vividness (relativeChroma(), 0..1) +/- pct/100.
//     A grey has no hue to saturate, so it's left alone.
//   - 'brightness': OKLCH lightness +/- pct/100 — every colour moves the
//     same amount, gaps between them unchanged.
//   - 'contrast':   lightness pushed away from (Increase) or pulled toward
//     (Decrease) the perceptual mid-tone NEW_SET_BG_L — the same "middle"
//     the fresh-set generator uses — by a factor of (1 +/- pct/100).
// Lightness clamps to 0..1, so a colour driven all the way to pure
// white/black still loses its hue there (a screen can't show a
// coloured pure white) — same caveat as before.
function applyPerceptualAdjustment(colorSet, kind, deltaPct) {
  let d = deltaPct / 100;
  getSetEntries(colorSet).forEach((entry) => {
    if (!entry.selected) return;
    let [L, C, h] = rgb255ToOklch(entry.rgb);
    let frac = relativeChroma(L, C, h);
    let hue = isNaN(h) ? 0 : h;
    if (kind === 'saturation') {
      if (isNaN(h)) return;
      entry.rgb = oklchToRgb255(L, Math.min(Math.max(frac + d, 0), 1), hue);
    } else if (kind === 'brightness') {
      entry.rgb = oklchToRgb255(Math.min(Math.max(L + d, 0), 1), frac, hue);
    } else { // 'contrast'
      let L2 = NEW_SET_BG_L + (L - NEW_SET_BG_L) * (1 + d);
      entry.rgb = oklchToRgb255(Math.min(Math.max(L2, 0), 1), frac, hue);
    }
  });
}

// v33: brightness RAMPS ("Fade to dark" / "Fade to light", v34 names).
// v38.1: the ★ base stays as it is; the other
// ticked swatches step evenly in (perceptual) brightness so the LAST
// ticked one lands exactly on the default near-black (NEW_SET_L_BOTTOM)
// or near-white (NEW_SET_L_TOP) — the same ends a fresh random-hue set
// uses. The number of steps follows the number of ticked swatches.
// v34: acts on EVERY ticked swatch in panel/harmony order (colours, then
// Background, then Scroll line — see getSetEntries()), like every other
// tool; untick Background / Scroll line to leave them out (the v33
// automatic exclusion is gone).
//   toward: 'dark' | 'light'
//   hueMode: 'shades' ("One hue")  — every step becomes a shade of the
//              BASE (base hue and base relative vividness);
//            'own'    ("Keep hues") — each swatch keeps its own hue and
//              vividness, only its brightness is stepped.
function applyBrightnessRamp(colorSet, toward, hueMode) {
  let { base, others } = baseAndOthers(colorSet); // v38.1: ★ base
  if (others.length === 0) return;
  let [bL, bC, bH] = rgb255ToOklch(base.rgb);
  let bFrac = relativeChroma(bL, bC, bH);
  let endL = toward === 'dark' ? NEW_SET_L_BOTTOM : NEW_SET_L_TOP;
  let n = others.length;
  others.forEach((entry, k) => {
    let L = bL + (endL - bL) * (k + 1) / n;
    if (hueMode === 'shades') {
      entry.rgb = oklchToRgb255(L, bFrac, isNaN(bH) ? 0 : bH);
    } else {
      let [oL, oC, oH] = rgb255ToOklch(entry.rgb);
      entry.rgb = oklchToRgb255(L, relativeChroma(oL, oC, oH), isNaN(oH) ? 0 : oH);
    }
  });
}

// v38.1: SATURATION ramp ("Fade to vivid" / "Fade to grey"). Same shape
// as the brightness ramp: the ★ base stays as it is, and the OTHER ticked
// colours step evenly in relative saturation (relativeChroma()) from the
// base's value so the LAST one lands on fully vivid (1) or fully grey
// (0). Each keeps its own hue and brightness; a grey has no hue of its
// own, so it borrows the base's (hue 0 if the base is grey too).
//   toward: 'vivid' | 'grey'
function applySaturationRamp(colorSet, toward) {
  let { base, others } = baseAndOthers(colorSet);
  if (others.length === 0) return;
  let [bL, bC, bH] = rgb255ToOklch(base.rgb);
  let bFrac = relativeChroma(bL, bC, bH);
  let endFrac = toward === 'vivid' ? 1 : 0;
  let n = others.length;
  others.forEach((entry, k) => {
    let [L, , h] = rgb255ToOklch(entry.rgb);
    let hue = !isNaN(h) ? h : (isNaN(bH) ? 0 : bH);
    entry.rgb = oklchToRgb255(L, bFrac + (endFrac - bFrac) * (k + 1) / n, hue);
  });
}

// =====================================================================
// UI — plain DOM, no external libraries.
//   - "Colors 1" / "Colors 2" / ...: identical toolboxes — selection,
//     copy, hue-harmony generation, and cumulative saturation/lightness/
//     contrast adjustment — each operating on that menu's own colours.
//     A delete ("×") button sits in the panel's own top-right corner.
//   - "Timing": how the colour sets cycle/crossfade in sequence.
//   - "Layout 1" / "Layout 2" / ...: each holds one Spacing + Thickness
//     + Scale trio; the group cycles through them together, timing
//     controlled by "Layout Timing". Same top-right delete button.
// =====================================================================

function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

// Ordered handles for everything living in the top menu bar, kept so the
// bar can be re-laid-out (and existing menus' "copy from" lists
// refreshed) whenever a set is added or removed from any group.
// `colorMenuHandles` is parallel to `colorSets`, `layoutMenuHandles` is
// parallel to `layoutGroup.sets` (same order, same length, in each case).
let colorMenuHandles = [];
let addSetHandle = null;
let timingHandle = null;

// v27: whether the whole control UI (every menu bar wrapper, plus the
// Sequence menu) is currently shown — toggled by the hamburger button
// (see createHamburgerToggle()/setMenuSystemVisible()) so the piece can
// be viewed without the controls in the way. createMenuWrapper() reads
// this at creation time so menus rebuilt later (e.g. after a Scene
// switch tears down and rebuilds Colors N/Layout N — see
// rebuildColorAndLayoutMenus()) come back in whatever state the UI was
// already in, rather than always popping back up visible.
let menuSystemVisible = true;
let sequenceMenuWrapper = null; // stored so setMenuSystemVisible() can reach it — it isn't built via createMenuWrapper()

let layoutMenuHandles = [];
let layoutAddHandle = null;
let layoutTimingHandle = null;

// v27: live "which set is actually playing right now" feedback on the
// Colors N / Layout N toggle buttons themselves — the same visual
// language as the Scene list's ACTIVE/PENDING highlight (see
// applySceneButtonStyle()), one level down: ACTIVE (bright) is whichever
// set the render is currently holding on or crossfading FROM, PENDING
// (blue) is whichever set it's crossfading INTO, when blend > 0. Called
// every frame — once per group — from rebuildEffectivePalette() /
// rebuildLayoutGroup() with that frame's already-computed fromIndex/
// toIndex/blend, so it always mirrors exactly what the cycle is doing
// on screen with no extra bookkeeping to keep in sync when sets are
// added, removed, or reordered (menus get torn down and rebuilt for
// that anyway — the very next frame just re-applies the right style to
// whatever buttons now exist).
function applySetActiveStyle(row, isActive, isPending) {
  // v28/v28.1: these buttons sit directly on top of the (busy,
  // colourful) generative piece at all times, not over an opened
  // panel's own dark backdrop like the Scene list's highlight does — a
  // low-alpha tint here just blends into whatever the art happens to be
  // doing underneath and reads as barely-there. Both states are solid,
  // high-alpha colours instead, distinct from each other and from the
  // (already fairly opaque) inactive black, so the marker stays legible
  // regardless of what's rendering behind it. ACTIVE is off-white
  // rather than green (v28's first pass tried green, felt like too much
  // — v28.1 is this off-white version) — dark text is swapped in for
  // that one case, since white-on-white would disappear; PENDING's blue
  // and the default black both stay legible with the usual white text.
  let background = isPending
    ? 'rgba(40,95,210,0.95)'    // solid blue — "crossfading in"
    : isActive
      ? 'rgba(238,236,230,0.95)' // solid off-white — "playing now"
      : 'rgba(20,20,20,0.85)';   // styleToggleButton()'s own default
  let borderColor = isPending ? '#8fc3ff' : (isActive ? '#ccc' : '#555');
  let textColor = (isActive && !isPending) ? '#1a1a1a' : '#fff';
  row.style.background = background;
  row.style.border = '1px solid ' + borderColor;
  row.style.color = textColor; // labelSpan has no colour of its own, so it inherits this
}

// v41.2: + the group's top button shows the playing set ("· 2", "· 2→3")
function setGroupStatusText(fromIndex, toIndex, blend) {
  if (!(fromIndex >= 0)) return '';
  return '· ' + (fromIndex + 1) + (blend > 0 && toIndex >= 0 && toIndex !== fromIndex ? '→' + (toIndex + 1) : '');
}
function updateColorActiveHighlight(fromIndex, toIndex, blend) {
  let pendingIndex = blend > 0 ? toIndex : -1;
  colorMenuHandles.forEach((h, i) => {
    applySetActiveStyle(h.toggleBtn, i === fromIndex, i === pendingIndex);
  });
  if (colorGroupMenu) colorGroupMenu.setStatus(setGroupStatusText(fromIndex, toIndex, blend));
}

function updateLayoutActiveHighlight(fromIndex, toIndex, blend) {
  let pendingIndex = blend > 0 ? toIndex : -1;
  layoutMenuHandles.forEach((h, i) => {
    applySetActiveStyle(h.toggleBtn, i === fromIndex, i === pendingIndex);
  });
  if (layoutGroupMenu) layoutGroupMenu.setStatus(setGroupStatusText(fromIndex, toIndex, blend));
}

// Slider ranges/units for a Layout set's Spacing/Thickness/Scale rows —
// shared between the initial build in setupUI() and
// rebuildColorAndLayoutMenus() (used when a Scene loads a different
// number of layout sets).
const LAYOUT_SET_SLIDER_OPTS = {
  spacing:   { min: 0, max: 1000, step: 1, unit: '%' }, // % of this set's own Scale (v41.5: up to 1000, sticky at 100)
  thickness: { min: 0, max: 50, step: 1, unit: '%' },
  // v28: `max` here is just a fallback used before the canvas exists —
  // updateMaxScaleForWindowSize() overwrites it with the real screen
  // width the instant setup() runs, and keeps it in sync after that.
  // See that function's own comment just below.
  scale:     { min: 20, max: 800, step: 1, unit: 'px' },
};

// v28: Scale's slider ceiling now tracks the actual window/screen the
// piece is running on, instead of a fixed 800px — so a differently
// sized window, browser tab, or computer gets a sensible max
// automatically, and resizing the window live updates it too (see
// windowResized() and setup()). MIN_MAX_SCALE_PX keeps the slider
// usable even if the window/canvas is tiny (e.g. a narrow code-editor
// pane) rather than collapsing its range to something unworkable.
const MIN_MAX_SCALE_PX = 200;

function currentMaxScalePx() {
  // `width` (p5's canvas width, not the raw browser window) is what
  // "the screen the scene is currently drawn on" actually means here —
  // this sketch always sizes the canvas to fill the window
  // (createCanvas/resizeCanvas both use windowWidth/windowHeight), so
  // in practice the two agree, but `width` is the more correct thing
  // to ask for.
  return Math.max(Math.round(width), MIN_MAX_SCALE_PX);
}

// Updates the shared slider-options ceiling (so any Layout set menu
// built AFTER this point — "+ Add Layout Set", or a Scene switch's
// rebuildColorAndLayoutMenus() — already gets the current max) and
// live-rescales every EXISTING Scale slider via the setScaleMax() each
// createLayoutSetMenu() handle exposes. That in turn clamps a set's
// stored scale value down (and fires its onChange, so the data model
// stays consistent) if the window has shrunk below it — see
// buildSliderRow()'s own setMax(), which this reuses.
function updateMaxScaleForWindowSize() {
  let newMax = currentMaxScalePx();
  LAYOUT_SET_SLIDER_OPTS.scale.max = newMax;
  layoutMenuHandles.forEach((h) => { if (h.setScaleMax) h.setScaleMax(newMax); });
}

// v27: a small, subtle circular toggle, fixed top-left, that shows/hides
// EVERY other control on screen at once (the whole Colors/Layout menu
// bar plus the Sequence menu) so the piece can be viewed without the UI
// in the way. Built independently of createMenuWrapper()/the hide-on-
// toggle system it drives — this button itself is never hidden, or
// there'd be no way to bring the rest back. Deliberately outside
// relayoutMenuBar()'s flow too (own fixed position, own small z-index
// bump so it always sits above whatever it's toggling).
// v39.3: ⛶ full screen, just under ☰. Hidden with the other controls.
// Browsers only allow it from a click; inside the editor's preview pane it
// may be blocked — use File → Share → Present there.
let fullscreenBtn = null;
function createFullscreenToggle() {
  let btn = document.createElement('button');
  btn.textContent = '⛶';
  btn.title = 'Full screen (Esc to leave)';
  Object.assign(btn.style, {
    position: 'fixed', top: '46px', left: '10px', zIndex: 1100,
    width: '30px', height: '30px', borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)',
    fontSize: '15px', lineHeight: '1', padding: '0', cursor: 'pointer',
    display: menuSystemVisible ? 'flex' : 'none', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif',
  });
  btn.onclick = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {
        window.alert('Full screen was blocked here. In the p5 editor, open File → Share → Present, then try again (or use the browser\'s own full screen: ⌃⌘F on a Mac).');
      });
    } catch (err) { /* very old browser: nothing to do */ }
  };
  document.body.appendChild(btn);
  return btn;
}

function createHamburgerToggle() {
  let btn = document.createElement('button');
  btn.textContent = '☰'; // ☰
  btn.title = 'Show/hide all controls';
  Object.assign(btn.style, {
    position: 'fixed',
    top: '10px',
    left: '10px',
    zIndex: 1100,
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.55)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.35)',
    fontSize: '14px',
    lineHeight: '1',
    padding: '0',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
  });
  btn.onclick = () => setMenuSystemVisible(!menuSystemVisible);
  document.body.appendChild(btn);
  return btn;
}

function setupUI() {
  createHamburgerToggle();
  fullscreenBtn = createFullscreenToggle(); // v39.3

  // v41.2: one menu per group, the sets as chips inside
  colorGroupMenu = createSetGroupMenu('Colors', 'Colour sets: pick one to edit · tick = in the cycle · + adds one', 320);
  layoutGroupMenu = createSetGroupMenu('Layout', 'Layout sets: pick one to edit · tick = in the cycle · + adds one', 280);
  addSetHandle = createAddSetControl(); // the + chip first, so sets land before it
  colorSets.forEach((set) => {
    colorMenuHandles.push(createColorSetMenu(colorSetName(set), set));
  });
  // v35.1: colour timing moved to the rhythm dock (createRhythmDock(),
  // built in setup()); timingHandle stays null so the top bar skips it.

  layoutAddHandle = createAddLayoutSetControl(layoutGroup, layoutMenuHandles, LAYOUT_SET_SLIDER_OPTS); // v41.2: + chip first
  layoutGroup.sets.forEach((setObj) => {
    layoutMenuHandles.push(createLayoutSetMenu(layoutGroup, setObj, layoutMenuHandles, LAYOUT_SET_SLIDER_OPTS));
  });
  // v41.5: Select all ↔ Deselect all for the sets' ticks
  colorGroupMenu.setAllToggle(() => colorSets.map((st) => st.enabled !== false), (on, keep) => {
    colorSets.forEach((st, i) => {
      st.enabled = on || i === keep;
      if (colorMenuHandles[i]) colorMenuHandles[i].toggleBtn.checkbox.checked = st.enabled;
    });
    updateColorEnabledCheckboxesState();
  });
  layoutGroupMenu.setAllToggle(() => layoutGroup.sets.map((st) => st.enabled !== false), (on, keep) => {
    layoutGroup.sets.forEach((st, i) => {
      st.enabled = on || i === keep;
      if (layoutMenuHandles[i]) layoutMenuHandles[i].toggleBtn.checkbox.checked = st.enabled;
    });
    updateLayoutEnabledCheckboxesState(layoutGroup, layoutMenuHandles);
  });

  // v35.3: Layout timing moved to the rhythm dock; layoutTimingHandle
  // stays null so the top bar skips it.

  updateColorDeleteButtonsState();
  updateLayoutDeleteButtonsState(layoutGroup, layoutMenuHandles);
  updateColorEnabledCheckboxesState();
  updateLayoutEnabledCheckboxesState(layoutGroup, layoutMenuHandles);

  relayoutMenuBar();

  // Sequence lives in the top-right corner, opposite the left-to-right
  // bar above — it never participates in relayoutMenuBar()'s left-to-
  // right flow, so it's set up independently, last.
  createSequenceMenu();
  roomMenu = createRoomMenu(); // v41.4: in the left bar, after Layout
  relayoutMenuBar();
  viewSwitch = createViewSwitch(); // v41.1: [Flat | Room ⚙] (v41.4: just left of Sequence)
  viewSwitch.place();
  roomEyeMarker = createRoomEyeMarker();
  figureMarker = createFigureMarker(); // v40.3

  // Auto-backup: a periodic, best-effort browser-storage snapshot (last
  // AUTO_BACKUP_MAX, deduped when nothing's changed) — pure crash-
  // recovery convenience for THIS browser/computer, never how a show
  // should travel between computers (that's Save Show, a downloadable
  // file — see the SAVE / LOAD and AUTO-BACKUP sections above). Captures
  // once immediately so there's at least one recovery point from the
  // moment the piece starts running, then on a fixed interval after that.
  captureAutoBackup();
  // v43.1: none of these run during a video export (they'd cause hitches)
  setInterval(() => { if (!exportState.on) captureAutoBackup(); }, AUTO_BACKUP_INTERVAL_MS);
  setInterval(() => { if (!exportState.on) captureSessionSnapshot(); }, 1000); // v39.2 (inactive until the startup box closes)

  // v27: a full Save Show every 30 minutes, unconditionally — a second,
  // heavier safety net on top of the local auto-backup above (a real
  // downloaded file survives even a wiped browser profile, not just a
  // crashed tab). See triggerScheduledFileSave()'s own comment for the
  // real-browser-testing caveat.
  setInterval(() => { if (!exportState.on) triggerScheduledFileSave(); }, AUTO_FILE_SAVE_INTERVAL_MS);
}

// A colour set's display name is purely its position in `colorSets`
// ("Colors " + (index + 1)) — recomputed fresh every time from
// indexOf(), so it's always correct after an append OR a deletion,
// without needing a separately-maintained registry.
function colorSetName(set) {
  return 'Colors ' + (colorSets.indexOf(set) + 1);
}

// Small "+" button that appends a new colour set (seeded as a copy of
// the current last set, per addColorSet()), builds its menu, and
// refreshes every existing menu's "copy from" dropdown to include it.
function createAddSetControl() {
  let btn = document.createElement('button');
  btn.textContent = '+';
  btn.title = 'Add a new colour set (starts as a copy of the last one)';
  styleToggleButton(btn);
  colorGroupMenu.setPlus(btn); // v41.2: a chip inside the Colors menu

  btn.onclick = () => {
    let newSet = addColorSet();
    colorMenuHandles.push(createColorSetMenu(colorSetName(newSet), newSet));
    colorMenuHandles.forEach((h) => h.rebuild());
    updateColorDeleteButtonsState();
    updateColorEnabledCheckboxesState();
    colorGroupMenu.select(colorMenuHandles.length - 1); // v41.2: edit the new one
  };

  return { wrapper: null };
}

// Deletes a colour set after confirmation, refuses if it's the only one
// left. Since a set's label is purely its index, every remaining set's
// button label and "copy from" list is refreshed afterward.
function requestDeleteColorSet(colorSet) {
  if (colorSets.length <= 1) return;
  let name = colorSetName(colorSet);
  if (!window.confirm('Delete ' + name + '? This cannot be undone.')) return;
  deleteColorSet(colorSet);
}

function deleteColorSet(colorSet) {
  let idx = colorSets.indexOf(colorSet);
  if (idx === -1) return;

  colorSets.splice(idx, 1);
  let handle = colorMenuHandles[idx];
  colorMenuHandles.splice(idx, 1);
  if (handle) handle.remove(); // v41.2

  // Every remaining set's label (and "copy from" list) is index-based,
  // so it needs refreshing now that positions have shifted.
  colorMenuHandles.forEach((h) => {
    h.toggleBtn.setLabel(colorSetName(h.colorSet));
    h.rebuild();
  });

  updateColorDeleteButtonsState();
  updateColorEnabledCheckboxesState();
  relayoutMenuBar();
}

// Disables every colour set's delete button once only one set remains
// (there must always be at least one colour set to render with).
function updateColorDeleteButtonsState() {
  let canDelete = colorSets.length > 1;
  colorMenuHandles.forEach((h) => {
    h.deleteBtn.disabled = !canDelete;
    h.deleteBtn.style.cursor = canDelete ? 'pointer' : 'not-allowed';
    h.deleteBtn.style.opacity = canDelete ? '1' : '0.4';
  });
}

// Locks (greys out, unclickable) a colour set's own enabled-checkbox
// whenever it's the SOLE enabled set — there must always be at least
// one colour set participating in the cycle. Any other checkbox (on a
// currently-disabled set) stays clickable, since checking it would
// raise the enabled count back above one and unlock everything else.
function updateColorEnabledCheckboxesState() {
  if (colorGroupMenu) colorGroupMenu.refreshAll(); // v41.5: Select all ↔ Deselect all label
  let enabledCount = colorSets.filter((s) => s.enabled !== false).length;
  colorMenuHandles.forEach((h) => {
    let isSoleEnabled = enabledCount <= 1 && h.colorSet.enabled !== false;
    h.toggleBtn.checkbox.disabled = isSoleEnabled;
    h.toggleBtn.checkbox.style.cursor = isSoleEnabled ? 'not-allowed' : 'pointer';
    h.toggleBtn.checkbox.title = isSoleEnabled
      ? 'At least one colour set must stay active'
      : 'Include this set in the cycle (uncheck to pause/isolate it)';
  });
}

// Same pattern as requestDeleteColorSet/deleteColorSet, generalized for
// the Layout-set group and its handles array.
function requestDeleteLayoutSet(group, handlesArray, setObj) {
  if (group.sets.length <= 1) return;
  let name = layoutSetName(group, setObj);
  if (!window.confirm('Delete ' + name + '? This cannot be undone.')) return;
  deleteLayoutSet(group, handlesArray, setObj);
}

function deleteLayoutSet(group, handlesArray, setObj) {
  let idx = group.sets.indexOf(setObj);
  if (idx === -1) return;

  group.sets.splice(idx, 1);
  let handle = handlesArray[idx];
  handlesArray.splice(idx, 1);
  if (handle) handle.remove(); // v41.2

  // Every remaining set's button label AND its three slider labels
  // ("Spacing N" / "Thickness N" / "Scale N") are index-based, so all
  // need refreshing now that positions have shifted.
  handlesArray.forEach((h) => h.refreshLabels());

  updateLayoutDeleteButtonsState(group, handlesArray);
  updateLayoutEnabledCheckboxesState(group, handlesArray);
  relayoutMenuBar();
}

function updateLayoutDeleteButtonsState(group, handlesArray) {
  let canDelete = group.sets.length > 1;
  handlesArray.forEach((h) => {
    h.deleteBtn.disabled = !canDelete;
    h.deleteBtn.style.cursor = canDelete ? 'pointer' : 'not-allowed';
    h.deleteBtn.style.opacity = canDelete ? '1' : '0.4';
  });
}

// Locks (greys out, unclickable) a layout set's own enabled-checkbox
// whenever it's the SOLE enabled set — same rule as
// updateColorEnabledCheckboxesState, applied to layoutGroup instead.
function updateLayoutEnabledCheckboxesState(group, handlesArray) {
  if (layoutGroupMenu) layoutGroupMenu.refreshAll(); // v41.5
  let enabledCount = group.sets.filter((s) => s.enabled !== false).length;
  handlesArray.forEach((h) => {
    let isSoleEnabled = enabledCount <= 1 && h.setObj.enabled !== false;
    h.toggleBtn.checkbox.disabled = isSoleEnabled;
    h.toggleBtn.checkbox.style.cursor = isSoleEnabled ? 'not-allowed' : 'pointer';
    h.toggleBtn.checkbox.title = isSoleEnabled
      ? 'At least one layout set must stay active'
      : 'Include this set in the cycle (uncheck to pause/isolate it)';
  });
}

// Small "+" button that appends a new Layout set (seeded as a copy of
// the group's current last set: same spacing, thickness, scale and —
// v30 — anchor).
function createAddLayoutSetControl(group, handlesArray, opts) {
  let btn = document.createElement('button');
  btn.textContent = '+';
  btn.title = 'Add a new layout set (starts as a copy of the last one)';
  styleToggleButton(btn);
  layoutGroupMenu.setPlus(btn); // v41.2: a chip inside the Layout menu

  btn.onclick = () => {
    let last = group.sets[group.sets.length - 1];
    let newSet = { spacing: last.spacing, thickness: last.thickness, scale: last.scale, anchor: last.anchor || DEFAULT_ANCHOR, enabled: true };
    group.sets.push(newSet);
    let handle = createLayoutSetMenu(group, newSet, handlesArray, opts);
    handlesArray.push(handle);
    updateLayoutDeleteButtonsState(group, handlesArray);
    updateLayoutEnabledCheckboxesState(group, handlesArray);
    layoutGroupMenu.select(handlesArray.length - 1); // v41.2: edit the new one
  };

  return { wrapper: null };
}

// Lays out the whole top menu bar left-to-right: colour sets, "+",
// Timing, Layout sets, "+", Layout Timing — measuring each wrapper's
// own rendered width (position:fixed elements shrink-to-fit their
// content) rather than assuming fixed spacing, so the bar adapts
// cleanly as sets are added or removed from either group.
function relayoutMenuBar() {
  // v27: starts to the right of the hamburger toggle (fixed at
  // left:10px, ~30px wide — see createHamburgerToggle()), so the two
  // never overlap.
  const MARGIN = 46;
  const GAP = 10;
  let x = MARGIN;

  let orderedWrappers = [] // v41.2: one menu per group
    .concat(colorGroupMenu ? [colorGroupMenu.wrapper] : [])
    .concat(timingHandle ? [timingHandle.wrapper] : [])
    .concat(layoutGroupMenu ? [layoutGroupMenu.wrapper] : [])
    .concat(layoutTimingHandle ? [layoutTimingHandle.wrapper] : [])
    .concat(roomMenu ? [roomMenu.wrapper] : []); // v41.4: Projection right after Layout

  orderedWrappers.forEach((w) => {
    w.style.left = x + 'px';
    x += w.offsetWidth + GAP;
  });
}

// v41.2: ONE MENU PER GROUP. "Colors" and "Layout" are each a single
// top-bar menu; inside, a row of chips picks the set to edit:
//   [☑ 1] [☑ 2] [☐ 3] [+]
//   Colors 2                                   🗑️
//   …that set's editor (exactly as before)…
// A chip's tick = in the cycle (as before). Clicking a chip shows that
// set's editor and, if it's ticked, jumps the picture to it (as opening
// its menu did before). A paused (unticked) set can now be edited too.
// The chips keep the live colours: off-white = playing, blue = fading in.
// The top button shows which set plays ("Colors · 2", "· 2→3").
// Replaces one top-bar menu per set, whose panels overlapped.
let colorGroupMenu = null, layoutGroupMenu = null;
function createSetGroupMenu(title, tip, minWidth) {
  let wrapper = createMenuWrapper();
  let btn = document.createElement('button');
  styleToggleButton(btn);
  btn.title = tip;
  let btnLabel = document.createElement('span');
  btnLabel.textContent = title;
  let btnState = document.createElement('span');
  Object.assign(btnState.style, { display: 'inline-block', minWidth: '36px', marginLeft: '5px', opacity: '0.75', textAlign: 'left' });
  btn.appendChild(btnLabel);
  btn.appendChild(btnState);
  wrapper.appendChild(btn);

  let panel = document.createElement('div');
  stylePanel(panel);
  panel.style.minWidth = minWidth + 'px';
  wrapper.appendChild(panel);
  let menuEntry = attachHoverAutoClose(wrapper, panel);

  let chipRow = document.createElement('div');
  Object.assign(chipRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', paddingBottom: '6px', borderBottom: '1px solid #444' });
  let body = document.createElement('div');
  panel.appendChild(chipRow);
  panel.appendChild(body);

  let entries = []; // { chip, setPanel }, in set order
  let plusEl = null;
  let selected = 0;

  function select(i) {
    if (!entries.length) return;
    selected = Math.min(Math.max(i, 0), entries.length - 1);
    entries.forEach((en, k) => {
      let on = k === selected;
      en.setPanel.style.display = on ? 'flex' : 'none';
      en.chip.style.outline = on ? '2px solid #fff' : 'none';
      en.chip.style.outlineOffset = '2px';
    });
  }
  // A set's chip (its toggle row) and editor panel, moved in here.
  function adopt(chip, setPanel, fullName, isEnabled, doJump) {
    Object.assign(chip.style, { padding: '4px 9px', fontSize: '13px', gap: '5px' });
    Object.assign(setPanel.style, {
      position: 'relative', top: 'auto', left: 'auto', display: 'none', opacity: '1', pointerEvents: 'auto',
      background: 'transparent', border: 'none', borderRadius: '0', padding: '30px 0 0 0',
      maxHeight: 'none', overflowY: 'visible', minWidth: '0', transition: 'none',
    });
    let heading = document.createElement('div');
    Object.assign(heading.style, { position: 'absolute', top: '8px', left: '0', fontWeight: 'bold', fontSize: '13px' });
    setPanel.insertBefore(heading, setPanel.firstChild);
    let origSetLabel = chip.setLabel;
    chip.setLabel = (text) => { // chips show just the number; the editor shows the full name
      let m = String(text).match(/(\d+)\s*$/);
      origSetLabel(m ? m[1] : text);
      heading.textContent = text;
    };
    chip.setLabel(fullName);
    chip.title = 'Edit ' + fullName + ' (and jump the picture to it, if it is ticked)';
    let entry = { chip, setPanel };
    chip.addEventListener('click', () => {
      if (isEnabled()) doJump();
      select(entries.indexOf(entry));
    });
    entries.push(entry);
    if (plusEl) chipRow.insertBefore(chip, plusEl); else chipRow.appendChild(chip);
    body.appendChild(setPanel);
    select(selected);
    return () => { // removes this set's chip and editor
      let k = entries.indexOf(entry);
      if (k >= 0) entries.splice(k, 1);
      chip.remove(); setPanel.remove();
      if (k >= 0 && k < selected) selected--;
      select(selected);
    };
  }
  function setPlus(el) {
    plusEl = el;
    Object.assign(el.style, { padding: '4px 10px', fontSize: '13px', fontWeight: 'bold' });
    chipRow.appendChild(el);
  }
  // v41.5: [Select all] ↔ [Deselect all] after the +, for the sets' ticks.
  // Deselect all keeps the set being edited ticked (one must stay on).
  let allChip = document.createElement('button');
  styleToggleButton(allChip);
  Object.assign(allChip.style, { padding: '4px 9px', fontSize: '12px' });
  let allCfg = null;
  allChip.addEventListener('click', () => {
    if (!allCfg) return;
    let flags = allCfg.flags();
    allCfg.apply(!flags.every(Boolean), selected);
    refreshAll();
  });
  function setAllToggle(flags, apply) { allCfg = { flags, apply }; chipRow.appendChild(allChip); refreshAll(); }
  function refreshAll() {
    if (!allCfg) return;
    if (chipRow.lastChild !== allChip) chipRow.appendChild(allChip); // always last
    let flags = allCfg.flags();
    allChip.style.display = flags.length > 1 ? '' : 'none';
    let all = flags.every(Boolean);
    allChip.textContent = all ? 'Deselect all' : 'Select all';
    allChip.title = all ? 'Untick all sets except the one you are editing (it plays alone)' : 'Tick all sets (all take part in the cycle)';
  }
  let lastStatus = null;
  function setStatus(text) { // called every frame — only touches the page when it changes
    if (text === lastStatus) return;
    lastStatus = text;
    btnState.textContent = text;
  }
  return { wrapper, panel, adopt, setPlus, select, setStatus, setAllToggle, refreshAll, count: () => entries.length, menuEntry };
}

// A self-contained wrapper: a toggle button plus a panel that appears
// directly beneath it. Left offset is set later by relayoutMenuBar()
// (position:fixed elements shrink-to-fit, so 0px here is harmless — it
// never paints before the initial relayout runs).
function createMenuWrapper(leftPx) {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '10px',
    left: (leftPx || 0) + 'px',
    zIndex: 1000,
    fontFamily: 'sans-serif',
    fontSize: '12px',
    display: menuSystemVisible ? '' : 'none', // v27: respect the hamburger's current state, even for a wrapper built later (e.g. on a Scene switch)
  });
  document.body.appendChild(wrapper);
  return wrapper;
}

function styleToggleButton(btn) {
  Object.assign(btn.style, {
    padding: '8px 12px',
    background: 'rgba(20,20,20,0.85)',
    color: '#fff',
    border: '1px solid #555',
    borderRadius: '6px',
    fontFamily: 'sans-serif',
    fontSize: '13px',
    cursor: 'pointer',
  });
}

function stylePanel(panel) {
  Object.assign(panel.style, {
    position: 'absolute',
    top: '40px',
    left: '0',
    display: 'none',
    flexDirection: 'column',
    gap: '6px',
    padding: '10px',
    background: 'rgba(20,20,20,0.85)',
    border: '1px solid #555',
    borderRadius: '6px',
    color: '#fff',
    minWidth: '220px',
    maxHeight: '80vh',
    overflowY: 'auto',
    opacity: '0',
    pointerEvents: 'none',
    transition: 'opacity 0.25s ease',
  });
}

function smallButton(text, title) {
  let btn = document.createElement('button');
  btn.textContent = text;
  if (title) btn.title = title;
  Object.assign(btn.style, {
    width: '22px', height: '22px', lineHeight: '22px',
    textAlign: 'center', padding: '0',
    background: 'rgba(255,255,255,0.1)', color: '#fff',
    border: '1px solid #555', borderRadius: '4px', cursor: 'pointer',
  });
  return btn;
}

// A small "×" fixed to a panel's own top-right corner, used for both
// "delete this colour set" and "delete this layout set". It lives
// INSIDE the panel — open the menu, then delete it from within — rather
// than sitting next to the toggle button in the bar (which used to read
// as if it were its own separate menu item).
function createDeleteButton(title) {
  let btn = smallButton('', title); // 🗑️ trash bin — distinguishes "delete this set" from the plain × used to just close/cancel elsewhere
  let binIcon = document.createElement('span'); // v41.3: the bin ~18% brighter
  binIcon.textContent = '🗑️';
  binIcon.style.filter = 'brightness(1.18)';
  btn.appendChild(binIcon);
  Object.assign(btn.style, {
    position: 'absolute',
    top: '6px',
    right: '6px',
    fontSize: '12px',
  });
  return btn;
}

// Builds the top-bar element for one cyclable set (a "Colors N" or
// "Layout N" menu): a checkbox — participates in this group's cycle
// when checked, paused/excluded from it when unchecked — plus a label
// showing the set's name, laid out together as this menu's toggle
// button. This is what `wrapper.children[0]` is for every set menu, so
// attachHoverAutoClose's own "click toggles just this menu" listener
// keeps working unchanged; the checkbox stops its own click/change
// events from bubbling up to that listener, so ticking it only ever
// changes the enabled state, never opens/closes the panel.
//
// Returns the row element itself, with two extra properties attached
// (the same pattern buildSliderRow uses for setMax/setValue) so callers
// don't need to know its internal structure:
//   - `.checkbox`  the underlying <input type="checkbox">, so delete/
//                  add flows can grey it out via
//                  update{Color,Layout}EnabledCheckboxesState()
//   - `.setLabel(text)`  updates the name text without touching the
//                  checkbox (a plain `.textContent =` would wipe it)
function createToggleButtonRow(initialLabel, isEnabled, onToggle) {
  let row = document.createElement('div');
  styleToggleButton(row);
  Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px' });

  let checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = isEnabled;
  Object.assign(checkbox.style, { margin: '0', cursor: 'pointer' });
  checkbox.title = 'Include this set in the cycle (uncheck to pause/isolate it)';
  checkbox.addEventListener('click', (e) => { e.stopPropagation(); });
  checkbox.addEventListener('change', (e) => {
    labelSpan.style.opacity = e.target.checked ? '1' : '0.5';
    onToggle(e.target.checked);
  });

  let labelSpan = document.createElement('span');
  labelSpan.textContent = initialLabel;
  labelSpan.style.opacity = isEnabled ? '1' : '0.5';

  row.appendChild(checkbox);
  row.appendChild(labelSpan);

  row.checkbox = checkbox;
  row.setLabel = (text) => { labelSpan.textContent = text; };

  return row;
}

// Shared setup for any panel that needs a top-right delete button: adds
// extra top padding so the button doesn't overlap the first row, then
// returns { deleteBtn, contentDiv } — `contentDiv` is a plain child the
// caller's rebuild()/initial-build logic can freely clear and refill
// (panel.innerHTML = '' would also wipe the delete button itself, which
// is why the two are kept separate).
function preparePanelWithDelete(panel, deleteTitle, onDelete) {
  panel.style.paddingTop = '34px';

  let deleteBtn = createDeleteButton(deleteTitle);
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    onDelete();
  };
  panel.appendChild(deleteBtn);

  let contentDiv = document.createElement('div');
  Object.assign(contentDiv.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
  panel.appendChild(contentDiv);

  return { deleteBtn, contentDiv };
}

// Shared across every menu: while ANY colour picker opened from ANY
// menu is open, ALL menus should stay frozen (not just the one the
// picker lives in) — e.g. picking a colour in Colors 1 while comparing
// it against a swatch you're still hovering/reading in Colors 2 must
// not let Colors 2 fade out from under you. `allMenus` holds every
// menu's own cancel/re-check functions so a picker opening/closing in
// one of them can freeze or re-evaluate all of them at once.
let globalColorPickerOpen = false;
let allMenus = [];

// v31 fix — menus had stopped auto-closing. attachHoverAutoClose() itself
// was unchanged since v23; the problem was that several of its "still in
// use" states could get STUCK on, which holds a menu (or, for the colour
// picker, EVERY menu) open forever:
//   1. The colour-picker freeze was only ever cleared by the input's
//      `change` event — which the browser skips entirely if the picker
//      is closed without changing the colour. One cancelled picker froze
//      every menu for the rest of the session.
//   2. ANY focused control (a clicked button, slider, checkbox) counted
//      as "interacting" until focus left the panel — and a clicked
//      control keeps focus after the click; one removed by a panel
//      rebuild() may never fire focusout at all.
//   3. Pressing a slider and releasing outside the panel never cleared
//      the "mid-click" state (the mouseup landed elsewhere).
// Fixes: (1) the freeze now ALSO clears on a click anywhere that isn't a
// colour swatch, on the window regaining focus (some pickers are a
// separate OS window), and after a 60s safety timeout; (2) focus only
// holds a menu open for TYPING controls (number/text fields, dropdowns),
// checked live against document.activeElement rather than a flag, so a
// removed element can't leave it stuck; (3) a window-level mouseup
// releases every menu's "mid-click" state wherever the button comes up.
const COLOR_PICKER_FREEZE_MAX_MS = 60000;
let colorPickerFreezeTimer = null;

function setColorPickerFreeze(on) {
  if (colorPickerFreezeTimer) { clearTimeout(colorPickerFreezeTimer); colorPickerFreezeTimer = null; }
  globalColorPickerOpen = on;
  if (on) {
    allMenus.forEach((m) => m.cancelPending());
    colorPickerFreezeTimer = setTimeout(() => setColorPickerFreeze(false), COLOR_PICKER_FREEZE_MAX_MS);
  } else {
    allMenus.forEach((m) => m.scheduleHideIfIdle());
  }
}

function isColorInput(el) {
  return !!el && el.tagName === 'INPUT' && el.type === 'color';
}

// Controls where keyboard entry matters — only these hold a menu open
// by being focused (see fix 2 above).
function isTypingControl(el) {
  if (!el) return false;
  if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && ['number', 'text', 'search'].includes(el.type);
}

// Global listeners, installed once (capture phase, so they run before
// any panel's own handlers):
window.addEventListener('mouseup', () => {
  allMenus.forEach((m) => m.releasePointer());
}, true);
document.addEventListener('mousedown', (e) => {
  if (globalColorPickerOpen && !isColorInput(e.target)) setColorPickerFreeze(false);
}, true);
window.addEventListener('focus', () => {
  if (globalColorPickerOpen) setColorPickerFreeze(false);
});

// Hover-to-open, auto-fade-out menu behaviour. A menu opens the instant
// the pointer enters its button OR its (already-open) panel. It only
// starts closing once NONE of the following are true: the pointer is
// over the menu, a control inside it is mid-click, a control inside it
// is focused, or a native <input type="color"> picker is open anywhere
// (see `globalColorPickerOpen` above — this applies even if the picker
// was opened from a *different* menu). Only once all of those are false
// does a ~5s grace timer start; any of them becoming true again cancels
// it.
//
// The colour picker needs its own explicit tracking rather than relying
// on hover/focus: in most browsers it's an in-page popup, not a real OS
// window, so opening it does NOT blur the window or move DOM focus away
// from the <input> — but it DOES make the pointer appear (to the page)
// to have left the panel as soon as you move into the popup to pick a
// colour, which would otherwise start the countdown while you're still
// choosing. So the picker's own lifecycle is tracked directly: a
// mousedown on a color swatch marks it "open" (and freezes every menu),
// and the browser's own `change` event on that input — which only ever
// fires once the picker has actually closed — marks it "closed" again
// (letting every menu re-check whether it's still actually in use).
//
// Returns a small handle — `detach()` — that a caller which might later
// remove this menu entirely (colour-set/layout-set deletion) uses to
// unregister it from `allMenus`, so a removed menu's stale cancel/
// re-check functions don't linger.
function attachHoverAutoClose(wrapper, panel, options) {
  let hideGraceMs = (options && options.hideGraceMs) || 4000;
  let fadeMs = (options && options.fadeMs) || 250;
  let hideTimer = null;
  let fadeTimer = null;
  let pointerOver = false;    // mouse is over the button or the panel
  let interacting = false;    // mid-click (pointer pressed inside the panel) — v31: focus is checked live instead, see typingInside()
  let isOpen = false;         // tracked purely for this menu's own toggle-button click

  function cancelPending() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
  }

  function show() {
    cancelPending();
    panel.style.display = 'flex';
    panel.style.pointerEvents = 'auto';
    // Force a reflow so the opacity transition plays even though
    // display just changed from none to flex on this same tick.
    void panel.offsetHeight;
    panel.style.opacity = '1';
    isOpen = true;
  }

  // Only actually starts the countdown if the menu is genuinely idle
  // right now. Called from every "something ended" event; harmless (and
  // immediately cancelled) if called while still in use.
  function scheduleHideIfIdle() {
    cancelPending();
    if (pointerOver || interacting || typingInside() || globalColorPickerOpen) return;
    hideTimer = setTimeout(() => {
      panel.style.opacity = '0';
      panel.style.pointerEvents = 'none';
      fadeTimer = setTimeout(() => {
        panel.style.display = 'none';
        isOpen = false;
      }, fadeMs);
    }, hideGraceMs);
  }

  // Closes this menu right away, skipping the grace period/fade entirely
  // — used by this menu's OWN toggle-button click (see below) to close
  // itself when already open. Also resets pointerOver/interacting so a
  // later hover reopens cleanly.
  function closeNow() {
    cancelPending();
    panel.style.opacity = '0';
    panel.style.pointerEvents = 'none';
    panel.style.display = 'none';
    pointerOver = false;
    interacting = false;
    isOpen = false;
  }

  // v31: a typing control inside this panel currently has focus.
  // Checked live, so an element removed by a rebuild() can't leave it
  // stuck the way a flag could.
  function typingInside() {
    let a = document.activeElement;
    return !!a && panel.contains(a) && isTypingControl(a);
  }

  // v31: called by the global window mouseup (capture) — clears the
  // mid-click state even when the button came up outside this panel.
  function releasePointer() {
    if (!interacting) return;
    interacting = false;
    scheduleHideIfIdle();
  }

  let menuEntry = { cancelPending, scheduleHideIfIdle, closeNow, releasePointer };
  allMenus.push(menuEntry);

  // v20: menus no longer open on hover. Hovering the wrapper (toggle
  // button) only matters once the menu is already open — it then keeps
  // it open, same as before. While closed, hover does nothing; opening
  // only happens via the explicit toggle-button click handler below.
  wrapper.addEventListener('mouseenter', () => {
    pointerOver = true;
    if (isOpen) cancelPending();
  });
  wrapper.addEventListener('mouseleave', () => {
    pointerOver = false;
    if (isOpen) scheduleHideIfIdle();
  });
  panel.addEventListener('mouseenter', () => { pointerOver = true; cancelPending(); });
  panel.addEventListener('mouseleave', () => { pointerOver = false; scheduleHideIfIdle(); });

  // Keyboard/focus-based interaction (tabbing into a control, or a
  // <select>/<input> that's focused) counts the same as hovering.
  // v31: only TYPING controls count (see isTypingControl()) — a clicked
  // button/slider/checkbox keeps focus after the click and used to hold
  // the menu open indefinitely.
  panel.addEventListener('focusin', (e) => {
    if (!isTypingControl(e.target)) return;
    cancelPending();
    show();
  });
  panel.addEventListener('focusout', (e) => {
    // focusout also fires when focus moves between two controls inside
    // the same panel — only treat it as "left" once focus has actually
    // landed outside the panel. Deferred one tick so document.activeElement
    // has updated by the time typingInside() reads it.
    if (e.relatedTarget && panel.contains(e.relatedTarget)) return;
    setTimeout(scheduleHideIfIdle, 0);
  });

  // A plain mousedown/mouseup on a control (clicking a swatch, a
  // button, ticking a checkbox) — covers browsers where such controls
  // don't reliably receive DOM focus on click. Also this is where a
  // colour picker's "open" state starts, which freezes every menu, not
  // just this one.
  panel.addEventListener('mousedown', (e) => {
    interacting = true;
    cancelPending();
    if (isColorInput(e.target)) setColorPickerFreeze(true);
  });
  panel.addEventListener('mouseup', () => { interacting = false; scheduleHideIfIdle(); });

  // The browser fires `change` on a color input only once its picker
  // has actually closed (value committed) — this is the one signal
  // that's reliable across browsers regardless of how the picker is
  // implemented, so it's what actually clears the freeze on every menu.
  // Each menu then re-checks its OWN hover/interaction state — the
  // freeze lifts everywhere, but menus the pointer has genuinely left
  // still start their normal countdown from here.
  panel.addEventListener('change', (e) => {
    if (isColorInput(e.target)) setColorPickerFreeze(false);
  });

  // Click on THIS menu's own toggle button (the wrapper's first child,
  // always the button — see createMenuWrapper's callers) toggles just
  // this one menu: closed -> open, open -> closed (immediately, no fade
  // wait). Deliberately scoped to the button only, not the whole
  // wrapper, so clicking a control inside an already-open panel (a
  // slider, a swatch, ...) never triggers this. No other menu is
  // touched by this click — every other menu keeps behaving exactly as
  // before (stays open on hover, closes on its own idle timer, or is
  // held open by the colour-picker freeze).
  wrapper.children[0].addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen) {
      closeNow();
    } else {
      show();
    }
  });

  return {
    closeNow,
    detach() {
      let idx = allMenus.indexOf(menuEntry);
      if (idx !== -1) allMenus.splice(idx, 1);
    },
  };
}

function harmonyButton(text) {
  let btn = document.createElement('button');
  btn.textContent = text;
  Object.assign(btn.style, {
    padding: '4px 8px',
    background: 'rgba(255,255,255,0.1)', color: '#fff',
    border: '1px solid #555', borderRadius: '4px',
    cursor: 'pointer', fontSize: '11px',
  });
  return btn;
}

function buildIncrementSelect(defaultValue) {
  let select = document.createElement('select');
  [10, 20, 30, 40, 50].forEach((v) => {
    let opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v + '%';
    if (v === defaultValue) opt.selected = true;
    select.appendChild(opt);
  });
  Object.assign(select.style, {
    background: '#222', color: '#fff',
    border: '1px solid #555', borderRadius: '4px', padding: '2px 4px',
  });
  return select;
}

function harmonySubsectionLabel(text) {
  let label = document.createElement('div');
  label.textContent = text;
  Object.assign(label.style, { fontSize: '11px', opacity: '0.75', marginTop: '2px' });
  return label;
}

function miniLabel(text) {
  let span = document.createElement('span');
  span.textContent = text;
  span.style.flex = '1';
  return span;
}

// Builds a full "Colors N" menu (toggle button + panel) bound to a given
// colour-set object. All tools inside operate on that colour set's own
// current values — nothing here is regenerated from another set except
// via the explicit one-time "Copy colors from" action. The delete
// button lives in the panel's own top-right corner (preparePanelWithDelete)
// and is disabled whenever this is the only remaining colour set (see
// updateColorDeleteButtonsState()).
function createColorSetMenu(title, colorSet) {
  // v41.2: no top-bar menu of its own — its chip and editor live in the
  // single Colors menu (createSetGroupMenu()).
  let toggleBtn = createToggleButtonRow(title, colorSet.enabled !== false, (checked) => {
    colorSet.enabled = checked;
    updateColorEnabledCheckboxesState();
  });

  let panel = document.createElement('div');
  stylePanel(panel);

  let { deleteBtn, contentDiv } = preparePanelWithDelete(panel, 'Delete this colour set', () => {
    requestDeleteColorSet(colorSet);
  });
  let removeFromGroup = colorGroupMenu.adopt(toggleBtn, panel, title,
    () => colorSet.enabled !== false,
    () => jumpColorToSet(colorSets.indexOf(colorSet)));

  function allSelected() {
    return colorSet.bgSelected && colorSet.scrollSelected &&
      colorSet.paletteSelected.every((v) => v);
  }

  function rebuild() {
    contentDiv.innerHTML = '';

    // --- Selection controls ---
    let selectRow = document.createElement('div');
    Object.assign(selectRow.style, { display: 'flex', gap: '6px' });
    let selectAllBtn = harmonyButton(allSelected() ? 'Deselect all' : 'Select all');
    selectAllBtn.onclick = () => {
      let target = !allSelected();
      colorSet.bgSelected = target;
      colorSet.scrollSelected = target;
      colorSet.paletteSelected = colorSet.paletteSelected.map(() => target);
      rebuild();
    };
    selectRow.appendChild(selectAllBtn);
    contentDiv.appendChild(selectRow);

    // --- Copy colors from another set, optionally with a hue shift ---
    // applied uniformly to every copied swatch. Shift = None reproduces
    // the old plain "Copy" behaviour; any other shift derives this set's
    // whole palette as e.g. "the triadic of Colors 1", swatch-for-swatch,
    // with no leftover swatch left identical between the two sets.
    let others = colorSets
      .map((s) => ({ name: colorSetName(s), set: s }))
      .filter((entry) => entry.set !== colorSet);
    if (others.length > 0) {
      let copySourceRow = document.createElement('div');
      Object.assign(copySourceRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
      let copySelect = document.createElement('select');
      others.forEach((entry) => {
        let opt = document.createElement('option');
        opt.value = entry.name;
        opt.textContent = entry.name;
        copySelect.appendChild(opt);
      });
      Object.assign(copySelect.style, {
        background: '#222', color: '#fff',
        border: '1px solid #555', borderRadius: '4px', padding: '2px 4px',
        flex: '1',
      });
      copySourceRow.appendChild(miniLabel('Copy colors from'));
      copySourceRow.appendChild(copySelect);
      contentDiv.appendChild(copySourceRow);

      let copyShiftRow = document.createElement('div');
      Object.assign(copyShiftRow.style, { display: 'flex', alignItems: 'center', gap: '6px' });
      let shiftSelect = document.createElement('select');
      let noneOpt = document.createElement('option');
      noneOpt.value = '0';
      noneOpt.textContent = 'Identical (no shift)';
      shiftSelect.appendChild(noneOpt);
      HARMONY_ANGLE_OPTIONS.forEach(([name, deg]) => {
        let opt = document.createElement('option');
        opt.value = deg;
        opt.textContent = name + ' hue shift';
        shiftSelect.appendChild(opt);
      });
      Object.assign(shiftSelect.style, {
        background: '#222', color: '#fff',
        border: '1px solid #555', borderRadius: '4px', padding: '2px 4px',
        flex: '1',
      });
      let copyBtn = harmonyButton('Copy →');
      copyBtn.onclick = () => {
        let source = others.find((entry) => entry.name === copySelect.value);
        if (source) {
          copyColorSetWithShift(source.set, colorSet, parseFloat(shiftSelect.value));
          rebuild();
        }
      };
      copyShiftRow.appendChild(shiftSelect);
      copyShiftRow.appendChild(copyBtn);
      contentDiv.appendChild(copyShiftRow);

      // v33: copy just ONE property from the chosen set, swatch-for-swatch
      // by position, onto this set's TICKED swatches (see
      // copyPropertyFromSet()). "Hue" honours the shift dropdown above.
      let copyOnlyRow = document.createElement('div');
      Object.assign(copyOnlyRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' });
      copyOnlyRow.appendChild(miniLabel('Copy only'));
      [
        ['Brightness', 'brightness', 'Ticked colours take the brightness of the same-position colour in the chosen set'],
        ['Saturation', 'saturation', 'Ticked colours take the saturation of the same-position colour in the chosen set'],
        ['Hue',        'hue',        'Ticked colours take the hue of the same-position colour in the chosen set (plus the hue shift above)'],
      ].forEach(([name, which, title]) => {
        let btn = harmonyButton(name);
        btn.title = title;
        btn.onclick = () => {
          let source = others.find((entry) => entry.name === copySelect.value);
          if (source) {
            copyPropertyFromSet(source.set, colorSet, which, parseFloat(shiftSelect.value));
            rebuild();
          }
        };
        copyOnlyRow.appendChild(btn);
      });
      contentDiv.appendChild(copyOnlyRow);
    }

    let topDivider = document.createElement('div');
    Object.assign(topDivider.style, { borderTop: '1px solid #555', margin: '4px 0' });
    contentDiv.appendChild(topDivider);

    // --- Hue-harmony generate (acts on ticked swatches) ---
    contentDiv.appendChild(harmonySubsectionLabel('Generate hues from the ★ base (changes the other ticked colours)')); // v38.1
    let hueRow = document.createElement('div');
    Object.assign(hueRow.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    HARMONY_ANGLE_OPTIONS.forEach(([name, deg]) => {
      let btn = harmonyButton(name);
      btn.onclick = () => {
        applyHueHarmonyGenerate(colorSet, deg);
        rebuild();
      };
      hueRow.appendChild(btn);
    });
    contentDiv.appendChild(hueRow);

    // v32: match the ticked swatches to the base's brightness/saturation.
    let matchRow = document.createElement('div');
    Object.assign(matchRow.style, { display: 'flex', flexWrap: 'wrap', gap: '4px' });
    [
      ['Match brightness', 'brightness', 'Give every ticked colour the base\'s brightness (keeps each one\'s own hue and saturation)'],
      ['Match saturation', 'saturation', 'Give every ticked colour the base\'s saturation (keeps each one\'s own hue and brightness)'],
      ['Match hue', 'hue', 'Give every ticked colour the base\'s hue (keeps each one\'s own brightness and saturation; greys stay grey)'], // v33
    ].forEach(([name, which, title]) => {
      let btn = harmonyButton(name);
      btn.title = title;
      btn.onclick = () => {
        applyMatchToBase(colorSet, which);
        rebuild();
      };
      matchRow.appendChild(btn);
    });
    contentDiv.appendChild(matchRow);

    // v33: brightness ramps from the first ticked colour (see applyBrightnessRamp()).
    // v34: renamed and regrouped into two rows ("Fade to dark" / "Fade
    // to light", each with "One hue" / "Keep hues").
    contentDiv.appendChild(harmonySubsectionLabel('Brightness ramp from the ★ base')); // v38.1
    [
      ['Fade to dark',  'dark',  'near-black'],
      ['Fade to light', 'light', 'near-white'],
    ].forEach(([rowName, toward, endName]) => {
      let rampRow = document.createElement('div');
      Object.assign(rampRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' });
      let lbl = miniLabel(rowName);
      lbl.style.minWidth = '84px';
      rampRow.appendChild(lbl);
      [
        ['One hue',   'shades', 'Step the ticked colours to ' + endName + ', all as shades of the ★ base'],
        ['Keep hues', 'own',    'Step the ticked colours to ' + endName + ', each keeping its own hue'],
      ].forEach(([name, hueMode, title]) => {
        let btn = harmonyButton(name);
        btn.title = title;
        btn.onclick = () => {
          applyBrightnessRamp(colorSet, toward, hueMode);
          rebuild();
        };
        rampRow.appendChild(btn);
      });
      contentDiv.appendChild(rampRow);
    });

    // v38.1: saturation ramp from the ★ base (see applySaturationRamp()).
    contentDiv.appendChild(harmonySubsectionLabel('Saturation ramp from the ★ base'));
    let satRampRow = document.createElement('div');
    // v38.2: right-aligned, like the brightness ramp buttons above it.
    Object.assign(satRampRow.style, { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' });
    [
      ['Fade to vivid', 'vivid', 'Step the ticked colours from the base\'s saturation to fully vivid (each keeps its own hue and brightness)'],
      ['Fade to grey',  'grey',  'Step the ticked colours from the base\'s saturation to fully grey (each keeps its own hue and brightness)'],
    ].forEach(([name, toward, title]) => {
      let btn = harmonyButton(name);
      btn.title = title;
      btn.onclick = () => {
        applySaturationRamp(colorSet, toward);
        rebuild();
      };
      satRampRow.appendChild(btn);
    });
    contentDiv.appendChild(satRampRow);

    // --- Saturation / Brightness (was "Lightness") / Contrast (cumulative, ticked swatches) ---
    function buildAdjustRow(name, transformFactory) {
      contentDiv.appendChild(harmonySubsectionLabel(name));
      let row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px' });
      let select = buildIncrementSelect(10);
      // v34: transformFactory is now the perceptual kind name
      // ('saturation' | 'brightness' | 'contrast') — see applyPerceptualAdjustment().
      let incBtn = harmonyButton('+ Increase');
      incBtn.onclick = () => {
        applyPerceptualAdjustment(colorSet, transformFactory, parseFloat(select.value));
        rebuild();
      };
      let decBtn = harmonyButton('− Decrease');
      decBtn.onclick = () => {
        applyPerceptualAdjustment(colorSet, transformFactory, -parseFloat(select.value));
        rebuild();
      };
      row.appendChild(select);
      row.appendChild(incBtn);
      row.appendChild(decBtn);
      contentDiv.appendChild(row);
    }
    // v34: all three now perceptual (OKLCH), matching the Match / Copy-only
    // / Fade buttons — see applyPerceptualAdjustment().
    buildAdjustRow('Saturation', 'saturation');
    buildAdjustRow('Brightness', 'brightness');
    buildAdjustRow('Contrast', 'contrast');

    let midDivider = document.createElement('div');
    Object.assign(midDivider.style, { borderTop: '1px solid #555', margin: '4px 0' });
    contentDiv.appendChild(midDivider);

    // v34: tick / untick every swatch at once — colours AND Background /
    // Scroll line — e.g. "Uncheck all" then tick just the ones a tool
    // should act on.
    let checkAllRow = document.createElement('div');
    Object.assign(checkAllRow.style, { display: 'flex', gap: '4px' });
    [['Check all', true], ['Uncheck all', false]].forEach(([name, value]) => {
      let btn = harmonyButton(name);
      btn.title = (value ? 'Tick' : 'Untick') + ' every colour, Background and Scroll line';
      btn.onclick = () => {
        colorSet.paletteSelected = colorSet.paletteDefs.map(() => value);
        colorSet.bgSelected = value;
        colorSet.scrollSelected = value;
        rebuild();
      };
      checkAllRow.appendChild(btn);
    });
    contentDiv.appendChild(checkAllRow);

    // --- Background / Scroll line row builder (checkbox + swatch) ---
    // (v31: the rows themselves are appended after the palette, below.)
    // v38.1: the ★ base marker. Filled gold = this set's base.
    function baseStarButton(key) {
      let isBase = colorSetBaseKey(colorSet) === key;
      let b = smallButton(isBase ? '★' : '☆', isBase
        ? 'Base colour: hue harmony, Match and the ramps start from here'
        : 'Make this the base colour');
      Object.assign(b.style, { color: isBase ? '#ffd166' : '#888', fontSize: '13px', flex: 'none' });
      b.onclick = (e) => {
        e.stopPropagation();
        colorSet.baseKey = key;
        rebuild();
      };
      return b;
    }

    function buildFixedColorRow(labelText, rgb, getSelected, setSelected, onChange, key) {
      let row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

      let checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = getSelected();
      checkbox.addEventListener('change', (e) => setSelected(e.target.checked));

      let input = document.createElement('input');
      input.type = 'color';
      input.value = rgbToHex(rgb);
      Object.assign(input.style, {
        width: '32px', height: '24px', padding: '0',
        border: 'none', background: 'none', cursor: 'pointer',
      });
      input.addEventListener('input', (e) => onChange(hexToRgb(e.target.value)));

      let label = document.createElement('span');
      label.textContent = labelText;
      label.style.flex = '1';
      label.style.fontWeight = 'bold';

      row.appendChild(checkbox);
      row.appendChild(input);
      row.appendChild(baseStarButton(key)); // v38.1
      row.appendChild(label);
      return row;
    }


    // --- Palette colours (checkbox + swatch + copy + remove) ---
    colorSet.paletteDefs.forEach((rgb, i) => {
      let row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px' });

      let checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = colorSet.paletteSelected[i];
      checkbox.addEventListener('change', (e) => {
        colorSet.paletteSelected[i] = e.target.checked;
      });

      let input = document.createElement('input');
      input.type = 'color';
      input.value = rgbToHex(rgb);
      Object.assign(input.style, {
        width: '32px', height: '24px', padding: '0',
        border: 'none', background: 'none', cursor: 'pointer',
      });
      input.addEventListener('input', (e) => {
        colorSet.paletteDefs[i] = hexToRgb(e.target.value);
      });

      let label = document.createElement('span');
      label.textContent = 'Colour ' + (i + 1);
      label.style.flex = '1';

      let copyBtn = smallButton('⧉', 'Duplicate this colour');
      copyBtn.onclick = () => {
        colorSet.paletteDefs.splice(i + 1, 0, [...colorSet.paletteDefs[i]]);
        colorSet.paletteSelected.splice(i + 1, 0, colorSet.paletteSelected[i]);
        if (Number.isInteger(colorSet.baseKey) && colorSet.baseKey > i) colorSet.baseKey += 1; // v38.1
        moduleStates.clear();
        rebuild();
      };

      let removeBtn = smallButton('×', 'Remove this colour');
      let canRemove = colorSet.paletteDefs.length > 2;
      removeBtn.disabled = !canRemove;
      removeBtn.style.cursor = canRemove ? 'pointer' : 'not-allowed';
      removeBtn.style.opacity = canRemove ? '1' : '0.4';
      removeBtn.onclick = () => {
        if (colorSet.paletteDefs.length <= 2) return;
        colorSet.paletteDefs.splice(i, 1);
        colorSet.paletteSelected.splice(i, 1);
        // v38.1: base follows its colour; removing the base itself falls back to Colour 1
        if (colorSet.baseKey === i) colorSet.baseKey = 0;
        else if (Number.isInteger(colorSet.baseKey) && colorSet.baseKey > i) colorSet.baseKey -= 1;
        moduleStates.clear();
        rebuild();
      };

      row.appendChild(checkbox);
      row.appendChild(input);
      row.appendChild(baseStarButton(i)); // v38.1
      row.appendChild(label);
      row.appendChild(copyBtn);
      row.appendChild(removeBtn);
      contentDiv.appendChild(row);
    });

    let addBtn = document.createElement('button');
    addBtn.textContent = '+ Add colour';
    Object.assign(addBtn.style, {
      marginTop: '4px', padding: '6px 10px',
      background: 'rgba(255,255,255,0.1)', color: '#fff',
      border: '1px solid #555', borderRadius: '4px', cursor: 'pointer',
    });
    addBtn.onclick = () => {
      colorSet.paletteDefs.push([255, 255, 255]);
      colorSet.paletteSelected.push(true);
      rebuild();
    };
    contentDiv.appendChild(addBtn);

    // v31: Background / Scroll line now sit AFTER the colours, matching
    // their new position in the harmony order (see getSetEntries()).
    let bottomDivider = document.createElement('div');
    Object.assign(bottomDivider.style, { borderTop: '1px solid #555', margin: '4px 0' });
    contentDiv.appendChild(bottomDivider);
    contentDiv.appendChild(buildFixedColorRow(
      'Background', colorSet.bgColorDef,
      () => colorSet.bgSelected, (v) => { colorSet.bgSelected = v; },
      (rgb) => { colorSet.bgColorDef = rgb; }, 'bg'
    ));
    contentDiv.appendChild(buildFixedColorRow(
      'Scroll line', colorSet.scrollColorDef,
      () => colorSet.scrollSelected, (v) => { colorSet.scrollSelected = v; },
      (rgb) => { colorSet.scrollColorDef = rgb; }, 'scroll'
    ));
  }

  rebuild();
  return {
    toggleBtn, panel, rebuild, colorSet, deleteBtn,
    remove: removeFromGroup, // v41.2 (was wrapper + detach)
  };
}

// A labelled slider + synced numeric field, e.g. "Change every: [====] 3.0 s"
// v40.10: a compact one-line slider for −100…+100 % values centred on 0,
// with a WIDE ZERO: the middle ~9% of the track all reads 0, and just
// past it the value starts at ±1 (nothing is rounded away — 1% is still
// reachable). The number box takes exact values; double-click the
// slider to reset to 0. Returns the row, with row.setValue(v).
const CENTRED_SLIDER_DEAD = 9; // track steps either side of the middle that read 0
// v40.19: the range goes to ±200 with a second STICKY STOP at ±100 (as
// wide as the one at 0). ±100 = the screen's edge on the midpoint (the
// old end); beyond it the screen moves on by up to one gap (±200), so
// opposite screens can meet in the middle.
const CENTRED_SLIDER_EDGE_DEAD = 9;
function buildCentredSlider(labelText, tip, initialValue, onChange) {
  let rowEl = document.createElement('div');
  Object.assign(rowEl.style, { display: 'flex', alignItems: 'center', gap: '6px' });
  rowEl.title = tip;
  let lab = document.createElement('span');
  lab.textContent = labelText;
  Object.assign(lab.style, { flex: '0 0 auto', minWidth: '58px' });
  let slider = document.createElement('input');
  slider.type = 'range';
  const D = CENTRED_SLIDER_DEAD, E = CENTRED_SLIDER_EDGE_DEAD, MAXV = 200;
  let span = MAXV + D + E;
  slider.min = -span; slider.max = span; slider.step = 1;
  Object.assign(slider.style, { flex: '1', minWidth: '0', margin: '0' });
  let num = document.createElement('input');
  num.type = 'number';
  num.min = -MAXV; num.max = MAXV; num.step = 1;
  Object.assign(num.style, { width: '48px', background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '4px', padding: '2px 4px' });
  let unit = document.createElement('span');
  unit.textContent = '%';
  let toValue = (pos) => {
    let a = Math.abs(pos), v;
    if (a <= D) v = 0;
    else if (a <= D + 100) v = a - D;
    else if (a <= D + 100 + E) v = 100;   // sticky at the edge
    else v = a - D - E;
    return Math.sign(pos) * Math.min(v, MAXV);
  };
  let toPos = (v) => {
    let a = Math.abs(v);
    if (a === 0) return 0;
    let p = a < 100 ? a + D : a === 100 ? 100 + D + E / 2 /* middle of the sticky stop */ : a + D + E;
    return Math.sign(v) * p;
  };
  function setValue(v) {
    v = Math.round(Math.min(Math.max(v, -MAXV), MAXV));
    slider.value = toPos(v);
    num.value = v;
  }
  slider.addEventListener('input', () => {
    let v = toValue(parseFloat(slider.value));
    num.value = v;
    onChange(v);
  });
  slider.addEventListener('dblclick', () => { setValue(0); onChange(0); });
  num.addEventListener('change', () => {
    let v = parseFloat(num.value);
    if (!Number.isFinite(v)) v = 0;
    setValue(v);
    onChange(Math.round(Math.min(Math.max(v, -MAXV), MAXV)));
  });
  [lab, slider, num, unit].forEach((el) => rowEl.appendChild(el));
  setValue(initialValue);
  rowEl.setValue = setValue;
  return rowEl;
}

function buildSliderRow(labelText, min, max, step, initialValue, unit, onChange) {
  let container = document.createElement('div');
  Object.assign(container.style, { display: 'flex', flexDirection: 'column', gap: '4px' });

  let label = document.createElement('div');
  label.textContent = labelText;
  label.style.fontWeight = 'bold';

  let controlRow = document.createElement('div');
  Object.assign(controlRow.style, { display: 'flex', alignItems: 'center', gap: '8px' });

  let slider = document.createElement('input');
  slider.type = 'range';
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = initialValue;
  // v37.2: slider + (hidden) safety strip stacked in one flexible column.
  slider.style.width = '100%';
  slider.style.margin = '0';
  let sliderCol = document.createElement('div');
  Object.assign(sliderCol.style, { flex: '1', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' });
  let safetyStrip = makeSafetyStrip();
  sliderCol.appendChild(slider);
  sliderCol.appendChild(safetyStrip);

  let numberInput = document.createElement('input');
  numberInput.type = 'number';
  numberInput.min = min;
  numberInput.max = max;
  numberInput.step = step;
  numberInput.value = initialValue;
  Object.assign(numberInput.style, {
    width: '55px', background: '#222', color: '#fff',
    border: '1px solid #555', borderRadius: '4px', padding: '2px 4px',
  });

  let unitSpan = document.createElement('span');
  unitSpan.textContent = unit;

  // v37.2: optional hook (container.filterValue) — the safety guard
  // snaps a blocked value to the nearest allowed one.
  // v41.5: optional non-linear slider (container.setCurve): the slider
  // moves in "positions", the value is curve.toValue(position).
  let curve = null;
  let posOf = (v) => curve ? curve.toPos(v) : v;
  function filtered(v) {
    if (!container.filterValue) return v;
    let v2 = container.filterValue(v);
    if (v2 !== v) slider.value = posOf(v2);
    return v2;
  }
  slider.addEventListener('input', (e) => {
    let raw = parseFloat(e.target.value);
    let v = filtered(curve ? curve.toValue(raw) : raw);
    numberInput.value = v;
    onChange(v);
  });
  numberInput.addEventListener('input', (e) => {
    let v = parseFloat(e.target.value);
    if (isNaN(v)) return;
    v = Math.min(max, Math.max(min, v));
    let v2 = filtered(v);
    slider.value = posOf(v2);
    if (v2 !== v) numberInput.value = v2;
    onChange(v2);
  });

  controlRow.appendChild(sliderCol);
  controlRow.appendChild(numberInput);
  controlRow.appendChild(unitSpan);
  container.appendChild(label);
  container.appendChild(controlRow);

  // Exposed so a sibling control can rescale this slider's range live
  // (used by Scale to keep Spacing's max at 1x the module width — see
  // createLayoutSetMenu). Plain properties on the returned element, so
  // every existing call site that just does panel.appendChild(...) is
  // unaffected.
  container.setMax = function (newMax) {
    max = newMax;
    slider.max = newMax;
    numberInput.max = newMax;
    if (parseFloat(slider.value) > newMax) {
      slider.value = newMax;
      numberInput.value = newMax;
      onChange(newMax);
    }
  };
  container.safetyStrip = safetyStrip; // v37.2
  // v37.3: change range + step live (Nudge follows the rate).
  container.setRange = function (newMin, newMax, newStep) {
    min = newMin; max = newMax;
    slider.min = newMin; slider.max = newMax; slider.step = newStep;
    numberInput.min = newMin; numberInput.max = newMax; numberInput.step = newStep;
  };
  container.setValue = function (newValue) {
    slider.value = posOf(newValue);
    numberInput.value = newValue;
  };
  container.setCurve = function (c) { // v41.5
    curve = c;
    slider.min = 0; slider.max = c.posMax; slider.step = 1;
    slider.value = posOf(parseFloat(numberInput.value) || 0);
  };
  // v41.5: a small ▾ list of handy values next to the number
  container.addPresets = function (values) {
    let sel = document.createElement('select');
    Object.assign(sel.style, { width: '22px', background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '4px', padding: '0', cursor: 'pointer' });
    sel.title = 'Jump to a value';
    let head = document.createElement('option');
    head.textContent = '▾'; head.value = ''; head.disabled = true; head.selected = true;
    sel.appendChild(head);
    values.forEach((v) => { let o = document.createElement('option'); o.value = v; o.textContent = v + unit; sel.appendChild(o); });
    sel.addEventListener('change', () => {
      let v = parseFloat(sel.value);
      sel.value = '';
      if (!Number.isFinite(v)) return;
      v = filtered(Math.min(max, Math.max(min, v)));
      container.setValue(v);
      onChange(v);
    });
    controlRow.insertBefore(sel, unitSpan);
  };

  return container;
}

// Wraps buildSliderRow for a slider whose LABEL includes a set's own
// index within a group (e.g. "Spacing 2"), so it can be kept in sync
// after a sibling set elsewhere in the same group is deleted and every
// index after it shifts down by one. Returns the built row plus a
// refreshLabel() that recomputes the label text from the set's current
// position, without touching the slider/value itself.
function buildNumberedSliderRow(prefix, group, setObj, min, max, step, initialValue, unit, onChange) {
  let row = buildSliderRow(prefix + ' ' + (group.sets.indexOf(setObj) + 1), min, max, step, initialValue, unit, onChange);
  let labelEl = row.children[0];
  return {
    row,
    refreshLabel() {
      labelEl.textContent = prefix + ' ' + (group.sets.indexOf(setObj) + 1);
    },
  };
}

// The "Timing" menu: controls how ALL colour sets cycle/crossfade in
// sequence (Colors 1 -> Colors 2 -> ... -> Colors N -> Colors 1), not
// just two — see computeCycleState().
// v29 fix: dragging Timing/Layout Timing only ever updated the LIVE
// changeIntervalSec/transitionDurationSec/layoutGroup globals — never
// the active scene's OWN stored colorTiming/layoutTiming objects (those
// are separate objects, only copied FROM at scene-load time, in
// finalizeLoadScene()). So a live tweak looked right on screen but
// wasn't actually saved into the scene: Save Show, "+ Add Scene"
// (cloneSceneFrom() reads the scene's stored value, not the live
// globals), or just switching away and back would silently revert it.
// These two helpers close that gap — called from every Timing/Layout
// Timing slider's onChange below, right after it updates the live
// global, so the active scene's stored copy never falls out of sync.
function syncActiveSceneColorTiming() {
  let scene = sequenceScenes[sequenceState.currentSceneIndex];
  if (!scene) return;
  let ds = timingDesignSeconds(colorTimingChannel); // v37.1: designed, not safety-limited
  scene.colorTiming.changeIntervalSec = ds.hold;
  scene.colorTiming.transitionDurationSec = ds.trans;
  scene.colorTiming.mode = colorTimingMode;        // v35.2
  scene.colorTiming.slowHoldSec = colorSlowHoldSec;   // v35.5
  scene.colorTiming.slowTransSec = colorSlowTransSec; // v35.5
  scene.colorTiming.flashHz = colorFlashHz;        // v35
  scene.colorTiming.nudgeHz = colorNudgeHz;        // v35.6
  scene.colorTiming.fadeShare = colorFadeShare;    // v35
}
function syncActiveSceneLayoutTiming() {
  let scene = sequenceScenes[sequenceState.currentSceneIndex];
  if (!scene) return;
  let ds = timingDesignSeconds(layoutTimingChannel); // v37.1: designed, not safety-limited
  scene.layoutTiming.changeIntervalSec = ds.hold;
  scene.layoutTiming.transitionDurationSec = ds.trans;
  scene.layoutTiming.mode = layoutGroup.timingMode;    // v35.3
  scene.layoutTiming.slowHoldSec = layoutGroup.slowHoldSec;   // v35.5
  scene.layoutTiming.slowTransSec = layoutGroup.slowTransSec; // v35.5
  scene.layoutTiming.flashHz = layoutGroup.flashHz;    // v35.3
  scene.layoutTiming.nudgeHz = layoutGroup.nudgeHz || 0; // v35.6
  scene.layoutTiming.fadeShare = layoutGroup.fadeShare; // v35.3
}

// v35.1: the colour "Timing" menu now lives in the bottom-right rhythm
// dock — see createRhythmDock().

// Builds a single "Layout N" menu: a toggle button + panel with THREE
// value sliders (Spacing N, Thickness N, Scale N) all bound to the same
// underlying set object { spacing, thickness, scale }, plus the shared
// top-right delete button (preparePanelWithDelete) which removes the
// whole trio together. Deliberately simpler than createColorSetMenu —
// no copy/harmony tools, just three numbers (plus, v30, the zoom anchor
// picker below them — see buildAnchorPicker()).
function createLayoutSetMenu(group, setObj, handlesArray, opts) {
  // v41.2: no top-bar menu of its own — its chip and editor live in the
  // single Layout menu (createSetGroupMenu()).
  let toggleBtn = createToggleButtonRow(layoutSetName(group, setObj), setObj.enabled !== false, (checked) => {
    setObj.enabled = checked;
    updateLayoutEnabledCheckboxesState(group, handlesArray);
  });

  let panel = document.createElement('div');
  stylePanel(panel);

  let { deleteBtn, contentDiv } = preparePanelWithDelete(panel, 'Delete this layout set', () => {
    requestDeleteLayoutSet(group, handlesArray, setObj);
  });
  let removeFromGroup = layoutGroupMenu.adopt(toggleBtn, panel, layoutSetName(group, setObj),
    () => setObj.enabled !== false,
    () => jumpLayoutToSet(group.sets.indexOf(setObj)));

  // Spacing is a percentage of THIS set's own Scale (module width), so
  // its slider range is just a fixed 0-100% — the actual pixel gap is
  // derived fresh every frame in rebuildEffectiveLayout(), which is what
  // makes it track Scale automatically instead of needing to be kept in
  // sync here.
  let spacingRow = buildNumberedSliderRow(
    'Spacing', group, setObj,
    opts.spacing.min, opts.spacing.max, opts.spacing.step, setObj.spacing, opts.spacing.unit,
    (v) => { setObj.spacing = v; }
  );
  // v41.5: Spacing goes to 1000 %. The slider's first half is 0–100 %
  // (1 % steps), with a sticky stop at 100 % (like 0 elsewhere); the
  // second half runs 100–1000 % (9 % steps; type any value in the box).
  spacingRow.row.setCurve({
    posMax: 210,
    toValue: (p) => p <= 100 ? p : p <= 110 ? 100 : Math.min(100 + (p - 110) * 9, 1000),
    toPos: (v) => v < 100 ? v : v === 100 ? 105 : Math.min(110 + (v - 100) / 9, 210),
  });
  spacingRow.row.addPresets([0, 50, 100, 150, 200, 250, 300, 500, 750, 1000]);
  let thicknessRow = buildNumberedSliderRow(
    'Thickness', group, setObj,
    opts.thickness.min, opts.thickness.max, opts.thickness.step, setObj.thickness, opts.thickness.unit,
    (v) => { setObj.thickness = v; }
  );
  let scaleRow = buildNumberedSliderRow(
    'Scale', group, setObj,
    opts.scale.min, opts.scale.max, opts.scale.step, setObj.scale, opts.scale.unit,
    (v) => { setObj.scale = v; }
  );

  contentDiv.appendChild(spacingRow.row);
  contentDiv.appendChild(thicknessRow.row);
  contentDiv.appendChild(scaleRow.row);
  // v42.6: the smallest Scale this computer can show here (screen limit, 04_room)
  let scaleHint = document.createElement('div');
  scaleHint.style.cssText = 'font-size:11px;color:#888;margin:-2px 0 6px 0;';
  contentDiv.appendChild(scaleHint);
  addScreenLimitHint(scaleHint, setObj);

  // v30: zoom anchor picker, below Scale.
  let anchorPicker = buildAnchorPicker(group, setObj);
  contentDiv.appendChild(anchorPicker.row);

  function refreshLabels() {
    toggleBtn.setLabel(layoutSetName(group, setObj));
    spacingRow.refreshLabel();
    thicknessRow.refreshLabel();
    scaleRow.refreshLabel();
    anchorPicker.refreshLabel();
  }

  return {
    toggleBtn, panel, setObj, deleteBtn, refreshLabels,
    remove: removeFromGroup, // v41.2 (was wrapper + menuEntry)
    // v28: lets updateMaxScaleForWindowSize() live-rescale this menu's
    // own Scale slider without needing to know anything about its
    // internal DOM structure — reuses buildSliderRow()'s own setMax().
    setScaleMax: (newMax) => scaleRow.row.setMax(newMax),
  };
}

// v30: the "Anchor N" control inside a Layout N panel — a 3x3 grid of
// arrow buttons (the 9 fixed zoom points) plus two Random buttons
// (🎲 Any point / 🎲 9-way). Exactly one is selected at a time,
// highlighted in the same PENDING blue applySetActiveStyle() uses.
// Writes straight into setObj.anchor, same live-edit convention as the
// sliders above it — no separate save step.
function buildAnchorPicker(group, setObj) {
  if (!isValidAnchor(setObj.anchor)) setObj.anchor = DEFAULT_ANCHOR;

  let row = document.createElement('div');
  Object.assign(row.style, { marginTop: '10px' });

  let label = document.createElement('div');
  Object.assign(label.style, { fontWeight: 'bold', marginBottom: '4px' }); // matches buildSliderRow()'s labels
  row.appendChild(label);

  let body = document.createElement('div');
  Object.assign(body.style, { display: 'flex', alignItems: 'flex-start', gap: '12px' });
  row.appendChild(body);

  let grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(3, 26px)', gap: '3px',
  });
  body.appendChild(grid);

  let randomCol = document.createElement('div');
  Object.assign(randomCol.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
  body.appendChild(randomCol);

  const ANCHOR_BUTTONS = [ // v39.3: was `GRID` (clashed with a p5 constant)
    ['NW', '\u2196', 'Top-left'],    ['N', '\u2191', 'Top'],       ['NE', '\u2197', 'Top-right'],
    ['W',  '\u2190', 'Left'],        ['C', '\u25CF', 'Centre'],    ['E',  '\u2192', 'Right'],
    ['SW', '\u2199', 'Bottom-left'], ['S', '\u2193', 'Bottom'],    ['SE', '\u2198', 'Bottom-right'],
  ];
  let buttons = {};

  function select(key) {
    setObj.anchor = key;
    refreshSelection();
  }
  function styleSelected(btn, on) {
    btn.style.background = on ? 'rgba(40,95,210,0.95)' : 'rgba(255,255,255,0.1)';
    btn.style.border = '1px solid ' + (on ? '#8fc3ff' : '#555');
  }
  function refreshSelection() {
    for (let k in buttons) styleSelected(buttons[k], k === setObj.anchor);
  }

  ANCHOR_BUTTONS.forEach(([key, glyph, name]) => {
    let btn = smallButton(glyph, 'Zoom from: ' + name);
    Object.assign(btn.style, { width: '26px', height: '26px', lineHeight: '26px', fontSize: key === 'C' ? '10px' : '14px' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); select(key); });
    buttons[key] = btn;
    grid.appendChild(btn);
  });

  [
    ['RANDOM_ANY', '\uD83C\uDFB2 Any point', 'Random: a new zoom point anywhere on screen, each time this layout arrives'],
    ['RANDOM_9',   '\uD83C\uDFB2 9-way',     'Random: one of the 9 fixed points (never the same twice in a row), each time this layout arrives'],
  ].forEach(([key, text, title]) => {
    let btn = smallButton(text, title);
    Object.assign(btn.style, { width: 'auto', padding: '0 8px', height: '26px', lineHeight: '26px', fontSize: '12px', whiteSpace: 'nowrap', textAlign: 'left' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); select(key); });
    buttons[key] = btn;
    randomCol.appendChild(btn);
  });

  function refreshLabel() {
    label.textContent = 'Zoom anchor ' + (group.sets.indexOf(setObj) + 1);
  }
  refreshLabel();
  refreshSelection();

  return { row, refreshLabel };
}

// The "Layout Timing" menu: controls how the Layout sets (Spacing +
// Thickness + Scale, all three together) cycle/crossfade in sequence —
// exactly the colour Timing menu's role, but for layoutGroup instead of
// colorSets.
// v35.3: the Layout Timing menu now lives in the bottom-right rhythm
// dock — see createRhythmDock() / buildTimingDockMenu().

function rebuildColorAndLayoutMenus() {
  colorMenuHandles.forEach((h) => h.remove()); // v41.2
  colorMenuHandles.length = 0;
  colorSets.forEach((set) => {
    colorMenuHandles.push(createColorSetMenu(colorSetName(set), set));
  });
  updateColorDeleteButtonsState();
  updateColorEnabledCheckboxesState();

  layoutMenuHandles.forEach((h) => h.remove()); // v41.2
  layoutMenuHandles.length = 0;
  layoutGroup.sets.forEach((setObj) => {
    layoutMenuHandles.push(createLayoutSetMenu(layoutGroup, setObj, layoutMenuHandles, LAYOUT_SET_SLIDER_OPTS));
  });
  updateLayoutDeleteButtonsState(layoutGroup, layoutMenuHandles);
  updateLayoutEnabledCheckboxesState(layoutGroup, layoutMenuHandles);

  if (rhythmDock) {
    markTimingChanged();  // v35.1: new scene's rate — let the measured value settle
    rhythmDock.refresh();
  }


  relayoutMenuBar();
}
