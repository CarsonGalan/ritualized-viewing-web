// noprotect
// Ritualized Viewing v43.0 — 07_sequence.js
// Scene transitions (crossfade), Sequence menu, save / load / import rows, backups list.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- SCENE TRANSITION (cross-scene crossfade) ----------------------
// v22's loadScene() was an instant cut: the live colorSets/
// layoutGroup.sets pointer snapped straight to the new scene's arrays
// and the cycle epoch reset, so background/scroll/palette and spacing/
// thickness/scale all jumped in a single frame. v23 makes a scene
// switch crossfade the exact same way an ordinary within-scene set
// switch already does — same easeInOutCubic curve, same lerp-based
// blending — just one level up: FROM whatever is currently on screen
// (frozen at the instant the switch starts, exactly like a within-scene
// transition holds its `fromIndex` steady) TO the incoming scene's own
// first enabled set, timed by THAT scene's own Color/Layout transition
// durations (so once loaded, a scene's transitions are timed
// consistently whether they're the scene-switch-in or an ordinary
// in-scene set change). Color and Layout still blend fully
// independently of each other, exactly as they do everywhere else in
// this file.
//
// Only once BOTH groups finish blending does the live colorSets/
// layoutGroup.sets pointer actually swap over to the new scene's
// arrays (finalizeLoadScene()) and the normal per-scene cycle resume —
// mirroring how a within-scene transition holds on `fromIndex` until
// blend reaches 1, at which point it's effectively `toIndex`.
let sceneTransition = null;
// Shape while active:
// {
//   targetIndex,                          // index into sequenceScenes being switched to
//   startMs,                              // millis() when this transition began
//   colorDurationMs, layoutDurationMs,     // from the INCOMING scene's own timing
//   fromColor:  { bg, scroll, paletteDefs },  // raw RGB snapshot of what was on screen
//   fromLayout: { spacing, thickness, scale },
//   toColorSet, toLayoutSet,               // the incoming scene's first enabled sets
// }

// Returns the first ENABLED set in `sets` — the same set a fresh cycle
// would land on at t=0 (see computeCycleStateGeneric), so crossfading
// into it here matches exactly what the incoming scene will visibly
// settle into as soon as its own cycle epoch resets.
function firstEnabledSet(sets) {
  return sets[enabledIndices(sets)[0]];
}

// Captures the CURRENT on-screen colour/layout state (whatever
// colBg/colScroll/palette/layoutGroup.current happen to hold right now
// — which may itself be mid-crossfade between two sets of the outgoing
// scene, or even mid-way through a previous, still-running scene
// transition) as a frozen starting point, and begins blending toward
// `sequenceScenes[index]`'s first enabled sets. Safe to call again with
// a different index while a transition is already running — it simply
// re-freezes the CURRENT (already partway-blended) look as the new
// starting point and retargets, so redirecting mid-transition stays
// smooth rather than jumping.
function beginSceneTransition(index) {
  let scene = sequenceScenes[index];
  let toColorSet = firstEnabledSet(scene.colorSets);
  let toLayoutSet = firstEnabledSet(scene.layoutSets);

  // v29.1: per-scene opt-out, via the checkbox above the 🕐 slider.
  // Checked (default): Color and Layout blend TOGETHER over the
  // incoming scene's own sceneTransitionDurationSec. Unchecked: back to
  // the original behaviour — Color and Layout each blend independently
  // over their own Colors Timing / Layout Timing transition duration,
  // which can finish at different moments (the "staggered" look).
  let colorDurationMs, layoutDurationMs;
  if (scene.useSceneTransition === true) {
    let sceneTransitionMs = Math.max(scene.sceneTransitionDurationSec, 0) * 1000;
    colorDurationMs = sceneTransitionMs;
    layoutDurationMs = sceneTransitionMs;
  } else {
    colorDurationMs = Math.max(scene.colorTiming.transitionDurationSec, 0) * 1000;
    layoutDurationMs = Math.max(scene.layoutTiming.transitionDurationSec, 0) * 1000;
  }

  sceneTransition = {
    targetIndex: index,
    startMs: sketchNow(), // v43.0
    colorDurationMs,
    layoutDurationMs,
    fromColor: {
      bg: [red(colBg), green(colBg), blue(colBg)],
      scroll: [red(colScroll), green(colScroll), blue(colScroll)],
      paletteDefs: palette.map((c) => [red(c), green(c), blue(c)]),
    },
    fromLayout: { ...layoutGroup.current },
    toColorSet,
    toLayoutSet,
    // v40.1: views can't blend — the drawn view holds, then cuts halfway
    // through the (longer) fade. See mappingForFrame().
    fromMapping: { ...frameMapping },
    mappingCutMs: sketchNow() + Math.max(colorDurationMs, layoutDurationMs) / 2,
  };
}

// Called once per frame from draw(), in place of rebuildEffectivePalette()
// / rebuildEffectiveLayout() whenever a scene transition is in flight.
// Blends colBg/colScroll/palette and layoutGroup.current (plus the
// derived hSpacing/vSpacing/gapHeightRatio/screenWidth, same as
// rebuildEffectiveLayout() does) directly from the frozen `fromColor`/
// `fromLayout` snapshot toward the incoming scene's first sets, using
// each group's OWN duration/progress — Color can finish before Layout
// or vice versa, exactly like the normal per-scene Timing/Layout Timing
// split. Returns true while a transition is active (including the
// frame it finishes on, since colBg etc. have already been set for that
// frame here); the caller uses this to skip the normal rebuild for that
// frame, since colorSets/layoutGroup.sets still belong to the OUTGOING
// scene until finalizeLoadScene() runs.
function updateSceneTransitionState(now) {
  if (!sceneTransition) return false;

  let t = now - sceneTransition.startMs;
  let colorP = sceneTransition.colorDurationMs > 0 ? constrain(t / sceneTransition.colorDurationMs, 0, 1) : 1;
  let layoutP = sceneTransition.layoutDurationMs > 0 ? constrain(t / sceneTransition.layoutDurationMs, 0, 1) : 1;
  let colorBlend = easeInOutCubic(colorP);
  let layoutBlend = easeInOutCubic(layoutP);

  let fromC = sceneTransition.fromColor;
  let toC = sceneTransition.toColorSet;
  colBg = lerpColor(
    color(fromC.bg[0], fromC.bg[1], fromC.bg[2]),
    color(toC.bgColorDef[0], toC.bgColorDef[1], toC.bgColorDef[2]),
    colorBlend
  );
  colScroll = lerpColor(
    color(fromC.scroll[0], fromC.scroll[1], fromC.scroll[2]),
    color(toC.scrollColorDef[0], toC.scrollColorDef[1], toC.scrollColorDef[2]),
    colorBlend
  );

  let lenA = fromC.paletteDefs.length;
  let lenB = toC.paletteDefs.length;
  let n = Math.max(lenA, lenB, 1);
  let nextPalette = [];
  for (let i = 0; i < n; i++) {
    let rgbA = fromC.paletteDefs[i % lenA];
    let rgbB = toC.paletteDefs[i % lenB];
    nextPalette.push(
      lerpColor(color(rgbA[0], rgbA[1], rgbA[2]), color(rgbB[0], rgbB[1], rgbB[2]), colorBlend)
    );
  }
  palette = nextPalette;

  let fromL = sceneTransition.fromLayout;
  let toL = sceneTransition.toLayoutSet;
  layoutGroup.current = {
    spacing: fromL.spacing + (toL.spacing - fromL.spacing) * layoutBlend,
    thickness: fromL.thickness + (toL.thickness - fromL.thickness) * layoutBlend,
    scale: fromL.scale + (toL.scale - fromL.scale) * layoutBlend,
  };
  layoutGroup.anchorSet = toL; // v30: incoming scene's first set governs the zoom
  let spacingPx = (layoutGroup.current.spacing / 100) * layoutGroup.current.scale;
  hSpacing = spacingPx;
  vSpacing = spacingPx;
  gapHeightRatio = layoutGroup.current.thickness / 100;
  screenWidth = layoutGroup.current.scale;
  recomputeDerivedValues();

  if (colorP >= 1 && layoutP >= 1) {
    let targetIndex = sceneTransition.targetIndex;
    sceneTransition = null;
    finalizeLoadScene(targetIndex);
  }
  return true;
}

// The single public entry point for switching scenes — used identically
// by a manual click in the Sequence list, an automatic advance from
// updateSequence(), and a forced switch from deleting the active scene
// (see deleteScene()). Starts (or retargets) a smooth scene-transition
// crossfade rather than swapping instantly; the actual array swap is
// deferred to finalizeLoadScene(), called once the crossfade completes.
// Guarded against re-triggering the SAME in-flight target every frame
// (updateSequence() calls this unconditionally once its threshold is
// crossed, every frame, until sceneStartMs advances — which only
// happens once finalizeLoadScene() actually runs).
function loadScene(index) {
  if (index < 0 || index >= sequenceScenes.length) return;
  if (sceneTransition && sceneTransition.targetIndex === index) return;
  beginSceneTransition(index);
  // Give immediate visual feedback in the Sequence list — the clicked/
  // targeted scene gets its blue "loading in" highlight right away,
  // rather than waiting for the crossfade to finish and the next full
  // rebuildSequenceList() call (see refreshSequenceHighlights()).
  refreshSequenceHighlights();
}

// Swaps the live colorSets/layoutGroup.sets/timings to point at the
// target scene's own data (no copying — see the note above), resets
// the cycle epoch so playback restarts at Set 1, and rebuilds the
// left-side menus to match. Called only once a scene-transition
// crossfade has finished (see updateSceneTransitionState()) — never
// directly; loadScene() is the public entry point.
function finalizeLoadScene(index) {
  if (index < 0 || index >= sequenceScenes.length) return;
  let now = sketchNow(); // v43.0
  let scene = sequenceScenes[index];

  colorSets = scene.colorSets;
  // v35.5: each mode's remembered settings, then the active seconds
  // derived from whichever mode the scene uses.
  colorTimingMode = scene.colorTiming.mode === 'flicker' ? 'flicker' : 'slow';
  colorFlashHz = FLASH_HZ_VALUES.includes(scene.colorTiming.flashHz) ? scene.colorTiming.flashHz : DEFAULT_FLICKER_HZ;
  colorFadeShare = Number.isFinite(scene.colorTiming.fadeShare) ? scene.colorTiming.fadeShare : DEFAULT_FLICKER_FADE;
  colorNudgeHz = Number.isFinite(scene.colorTiming.nudgeHz) ? scene.colorTiming.nudgeHz : 0; // v35.6
  colorSlowHoldSec = Number.isFinite(scene.colorTiming.slowHoldSec) ? scene.colorTiming.slowHoldSec : DEFAULT_COLOR_CHANGE_SEC;
  colorSlowTransSec = Number.isFinite(scene.colorTiming.slowTransSec) ? scene.colorTiming.slowTransSec : DEFAULT_COLOR_TRANSITION_SEC;
  timingApplyActive(colorTimingChannel);

  layoutGroup.sets = scene.layoutSets;
  layoutGroup.timingMode = scene.layoutTiming.mode === 'flicker' ? 'flicker' : 'slow';
  layoutGroup.flashHz = FLASH_HZ_VALUES.includes(scene.layoutTiming.flashHz) ? scene.layoutTiming.flashHz : DEFAULT_FLICKER_HZ;
  layoutGroup.fadeShare = Number.isFinite(scene.layoutTiming.fadeShare) ? scene.layoutTiming.fadeShare : DEFAULT_FLICKER_FADE;
  layoutGroup.nudgeHz = Number.isFinite(scene.layoutTiming.nudgeHz) ? scene.layoutTiming.nudgeHz : 0; // v35.6
  layoutGroup.slowHoldSec = Number.isFinite(scene.layoutTiming.slowHoldSec) ? scene.layoutTiming.slowHoldSec : 3;
  layoutGroup.slowTransSec = Number.isFinite(scene.layoutTiming.slowTransSec) ? scene.layoutTiming.slowTransSec : 2;
  timingApplyActive(layoutTimingChannel);

  applyScrollTimingData(scene.scrollTiming || DEFAULT_SCROLL_TIMING, now); // v36

  colorEpochMs = now;  // v30: both clocks still reset together here
  layoutEpochMs = now;
  sequenceState.sceneStartMs = now;
  sequenceState.currentSceneIndex = index;

  rebuildColorAndLayoutMenus();
  rebuildSequenceList();
  mappingIndex = 0; // v40.2: a scene starts on Mapping 1
  mappingFade = null; // v40.5
  mappingCycleStart = sketchNow(); // v43.0
  if (roomMenu) roomMenu.refresh(); // v40.1: the menu shows this scene's mappings
}

// =====================================================================
// SEQUENCE MENU — top-right, opposite the left-to-right Colors/Layout
// bar. Just a flat list: each Scene's name, its cycle count, a delete
// button, and "+ Add Scene" — plus one "Auto-advance" checkbox. There
// is deliberately NO second panel here for programming a scene's
// colours/layout/timing: those are edited on the LEFT, in the normal
// Colors N / Layout N / Timing / Layout Timing menus, which is exactly
// what's currently loaded (see finalizeLoadScene() above). This menu
// only ever decides WHICH scene is loaded, in what order, and how many
// cycles each one gets before advancing — never what a scene contains.
// =====================================================================

let sequenceListContentDiv = null;
let backupsListDiv = null; // the "Recovered backups" list inside the Sequence panel — see refreshBackupList()
let backupsToggleLabelSpan = null; // the clickable header's text (gets the live count appended)
let backupsSectionExpanded = false; // v27: collapsed by default, so the panel doesn't grow with every backup

// Parallel to the rows built by the last rebuildSequenceList() call:
// [{ scene, nameBtn }]. Lets refreshSequenceHighlights() restyle just the
// name buttons in place (no DOM teardown/rebuild, no risk of interrupting
// a click or losing scroll position) whenever a scene transition starts
// or a different target is retargeted mid-transition.
let sequenceRowHandles = [];

// Shared by the initial row build (rebuildSequenceList) and the
// lightweight in-place refresh (refreshSequenceHighlights) below, so the
// two never disagree about what a given state looks like. Three states:
//   - PENDING (isPending): this scene is what an in-flight scene
//     transition is currently crossfading TOWARD — a distinct blue
//     highlight, so clicking a scene gives immediate feedback instead of
//     silently waiting for the whole crossfade to finish before anything
//     visibly changes.
//   - ACTIVE (isActive): this scene is what's actually loaded right now
//     (sequenceState.currentSceneIndex) — true even while a transition
//     TO ANOTHER scene is in flight elsewhere, since the live
//     colorSets/layoutGroup.sets still belong to this scene until that
//     transition's finalizeLoadScene() runs. The existing bright
//     highlight.
//   - neither: the existing dim/inactive style.
// A scene can be both PENDING and ACTIVE at once (e.g. re-clicking the
// currently-loaded scene while nothing else is transitioning) — pending
// wins visually in that case, which still reads correctly ("this is
// (re)loading").
function applySceneButtonStyle(nameBtn, isActive, isPending) {
  let background = isPending
    ? 'rgba(70,130,255,0.55)'
    : isActive
      ? 'rgba(255,255,255,0.28)'
      : 'rgba(255,255,255,0.08)';
  let borderColor = isPending ? '#6fa8ff' : '#555';
  Object.assign(nameBtn.style, {
    background: background,
    border: '1px solid ' + borderColor,
    fontWeight: (isActive || isPending) ? 'bold' : 'normal',
  });
  nameBtn.title = isPending ? 'Loading…' : (isActive ? 'Currently loaded' : 'Load this scene');
}

// Restyles every scene row's name button IN PLACE, without rebuilding
// the Sequence list's DOM — called right when a scene transition starts
// or retargets (see loadScene()) so the visual feedback is immediate,
// rather than waiting for the transition to finish and the next full
// rebuildSequenceList() call (which still happens at the end, via
// finalizeLoadScene() -> rebuildSequenceList(), and naturally clears
// every PENDING state since sceneTransition is null by then).
function refreshSequenceHighlights() {
  sequenceRowHandles.forEach(({ scene, nameBtn }) => {
    let idx = sequenceScenes.indexOf(scene);
    let isPending = !!sceneTransition && sceneTransition.targetIndex === idx;
    let isActive = idx === sequenceState.currentSceneIndex;
    applySceneButtonStyle(nameBtn, isActive, isPending);
  });
}

// A scene's display name is purely its position in `sequenceScenes`,
// same "recomputed fresh via indexOf()" convention as colorSetName()/
// layoutSetName() — so it's always correct after an add OR a delete
// without a separate registry.
// A scene's display name is its custom `name` if it's been renamed, or
// its position in `sequenceScenes` otherwise ("Scene " + position,
// recomputed fresh via indexOf() so it's always correct after an add OR
// a delete without a separate registry) — same fallback convention as
// colorSetName()/layoutSetName(), just with an optional override.
function sceneName(scene) {
  return scene.name || ('Scene ' + (sequenceScenes.indexOf(scene) + 1));
}

// Prompts for a new name; an empty/whitespace-only answer clears the
// custom name and reverts to the auto "Scene N" label. Cancelling
// leaves the name untouched.
function renameScene(scene) {
  let answer = window.prompt('Rename this scene:', scene.name || sceneName(scene));
  if (answer === null) return;
  let trimmed = answer.trim();
  scene.name = trimmed.length > 0 ? trimmed : null;
  rebuildSequenceList();
}

// v29: a small per-scene "Scene transition" control living right after
// each scene's name in the Sequence list (before the ✏️ rename icon) —
// a 🕐 icon that pops open a checkbox + slider for this scene's own
// sceneTransitionDurationSec: how long Color and Layout take, together,
// to blend into THIS scene when a scene switch arrives here (see
// beginSceneTransition()). Colors Timing / Layout Timing still govern
// only ORDINARY within-scene set-to-set fades, unaffected either way.
// Seeded once, at scene-creation time, from that scene's own Layout
// Timing transition value (see cloneSceneFrom() and the initial
// sequenceScenes literal) — after that it's fully independent, same
// "default, then decoupled" convention Colors/Layout timing already
// follow.
//
// v29.1: the checkbox — unchecking scene.useSceneTransition falls back
// to the pre-v29 behaviour for THIS scene (Color and Layout each
// blending independently over their own Colors/Layout Timing duration,
// the "staggered" look) without discarding the slider's stored value,
// so re-checking it later picks up right where it left off.
//
// v29.1 also fixes clipping: a plain position:absolute popup nested
// inside the Sequence panel's own scrollable area got its edges cut off
// (first the right edge, then — after anchoring right:0 — the left
// edge, since the icon sits too close to the panel's right edge for a
// 200px-wide popup to fit either direction within it). Fixed properly
// this time: the popup is position:fixed and reads the icon's actual
// on-screen position (getBoundingClientRect()) right before it opens,
// which lets it escape the Sequence panel's overflow clipping entirely
// (a standard CSS escape hatch — position:fixed isn't clipped by an
// ordinary overflow:auto ancestor) and sit wherever there's room:
// opening UPWARD from the icon and extending LEFTWARD, comfortably
// clear of the panel's edges regardless of where in the (possibly
// scrolled) scene list this row currently sits.
//
// Reuses attachHoverAutoClose()'s click-to-toggle/hover-hold/auto-fade
// behaviour. Returns { wrapper, menuEntry } — the caller appends
// `wrapper` into the scene row and keeps `menuEntry` in
// sequenceRowHandles so rebuildSequenceList() can detach it before its
// next full wipe-and-rebuild, the same teardown discipline
// rebuildColorAndLayoutMenus() already uses for per-set menus (skipping
// this would leak a stale, DOM-less entry into the shared
// colour-picker-freeze bookkeeping — allMenus — every single rebuild).
function createSceneTransitionClock(scene) {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, { position: 'relative', display: 'inline-block' });

  let clockBtn = smallButton('🕐', "This scene's own transition duration \u2014 how long Color and Layout take to blend in together when a scene switch arrives here"); // 🕐
  clockBtn.style.fontSize = '11px';
  wrapper.appendChild(clockBtn);

  // v30: clock turns blue (same PENDING blue as applySetActiveStyle())
  // while "Unified transition" is checked, so it's visible from the
  // Sequence list without opening the popup. Static per-scene setting:
  // set once here, then again from the checkbox's change listener.
  function refreshClockStyle() {
    let on = scene.useSceneTransition === true;
    clockBtn.style.background = on ? 'rgba(40,95,210,0.95)' : 'rgba(255,255,255,0.1)';
    clockBtn.style.border = '1px solid ' + (on ? '#8fc3ff' : '#555');
  }
  refreshClockStyle();

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, {
    position: 'fixed', // escapes the Sequence panel's own overflow clipping — see the function comment above
    minWidth: '200px',
    zIndex: 1100,       // above the Sequence panel's own wrapper (zIndex 1000)
  });
  wrapper.appendChild(panel);

  // Recomputed every time the popup is about to open, since the row
  // (and therefore the icon) can be anywhere on screen depending on
  // scroll position. Right edge pinned near the icon's right edge,
  // bottom edge pinned just above the icon's top edge — so it opens
  // upward and grows leftward, away from the Sequence panel's edges.
  function positionPanel() {
    let r = clockBtn.getBoundingClientRect();
    panel.style.right = (window.innerWidth - r.right) + 'px';
    panel.style.left = 'auto';
    panel.style.bottom = (window.innerHeight - r.top + 6) + 'px';
    panel.style.top = 'auto';
  }
  wrapper.addEventListener('mouseenter', positionPanel);
  clockBtn.addEventListener('click', positionPanel);

  let checkboxRow = document.createElement('label');
  Object.assign(checkboxRow.style, { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  let checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = scene.useSceneTransition === true;
  checkbox.title = 'Checked: Color and Layout blend together over the slider below on a scene switch. Unchecked: they blend independently using Colors Timing / Layout Timing instead (the old, staggered behaviour).';
  checkbox.addEventListener('change', (e) => {
    scene.useSceneTransition = e.target.checked;
    sliderRow.style.opacity = e.target.checked ? '1' : '0.5';
    refreshClockStyle(); // v30
  });
  let checkboxLabel = document.createElement('span');
  checkboxLabel.textContent = 'Unified transition';
  checkboxRow.appendChild(checkbox);
  checkboxRow.appendChild(checkboxLabel);
  panel.appendChild(checkboxRow);

  let sliderRow = buildSliderRow(
    'Scene transition',
    0, 15, 0.1, scene.sceneTransitionDurationSec, 's',
    (v) => { scene.sceneTransitionDurationSec = v; }
  );
  sliderRow.style.opacity = (scene.useSceneTransition === true) ? '1' : '0.5';
  panel.appendChild(sliderRow);

  let menuEntry = attachHoverAutoClose(wrapper, panel);

  return { wrapper, menuEntry };
}

// Builds the "Save Show" / "Load Show" row that sits at the TOP of the
// Sequence panel — deliberately outside sequenceListContentDiv, since
// that div's innerHTML gets wiped and rebuilt by every rebuildSequenceList()
// call (every scene add/delete/switch); these two buttons (and the
// hidden file input behind Load) need to survive all of that untouched.
//
// Save prompts for a show name (used as both the filename and the
// `showName` stored inside the file, so a reloaded show is recognizable
// later), then downloads the WHOLE current Sequence as a .json file —
// see buildShowData()/downloadShowFile().
//
// Load opens a native file picker (a hidden <input type="file">, clicked
// programmatically), reads the chosen file, migrates it (migrateShowData()
// — tolerant of an older/incomplete file), confirms with the user since
// this REPLACES every currently loaded Scene, snapshots an auto-backup
// of whatever's about to be discarded as one last safety net, then
// applies it (applyShowData()).
function createSaveLoadRow() {
  let container = document.createElement('div');
  Object.assign(container.style, { display: 'flex', gap: '6px' });

  let saveBtn = harmonyButton('💾 Save Show'); // 💾
  Object.assign(saveBtn.style, { flex: '1', fontSize: '12px', padding: '6px 8px', fontWeight: 'bold' });
  saveBtn.title = 'Download the whole current Sequence (every Scene) as a JSON file you can open on any computer';
  saveBtn.onclick = () => {
    let name = window.prompt('Name this show:', lastShowName || 'Untitled show');
    if (name === null) return; // cancelled
    name = name.trim() || 'Untitled show';
    lastShowName = name;
    downloadShowFile(buildShowData(name));
  };

  let loadBtn = harmonyButton('📂 Load Show'); // 📂
  Object.assign(loadBtn.style, { flex: '1', fontSize: '12px', padding: '6px 8px', fontWeight: 'bold' });
  loadBtn.title = 'Replace the current Sequence with one loaded from a saved show file';

  let fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', (e) => {
    let file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so picking the SAME file again still fires 'change'
    if (!file) return;

    let reader = new FileReader();
    reader.onload = () => {
      let raw;
      try {
        raw = JSON.parse(reader.result);
      } catch (err) {
        window.alert('That file is not valid JSON.');
        return;
      }
      let migrated;
      try {
        migrated = migrateShowData(raw);
      } catch (err) {
        window.alert("That file doesn't look like a saved show:\n" + err.message);
        return;
      }
      if (!window.confirm('Load "' + (migrated.showName || 'this show') + '"? It will replace every Scene currently loaded.')) return;
      captureAutoBackup(); // preserve whatever was on screen before it's gone for good
      applyShowData(migrated);
    };
    reader.onerror = () => window.alert('Could not read that file.');
    reader.readAsText(file);
  });

  loadBtn.onclick = () => fileInput.click();

  container.appendChild(saveBtn);
  container.appendChild(loadBtn);
  container.appendChild(fileInput);
  return container;
}

// v29: "Import Scenes" — pulls every scene from a saved show file into
// the CURRENT show, ADDITIVE rather than replacing (that's still what
// Load Show does, above). Same file-picker/FileReader/migrateShowData()
// validation as Load Show, but the confirm dialog describes what's
// being added rather than what's being discarded, and nothing about the
// currently-loaded scene, autoAdvance, or playback is touched — the
// imported scenes simply land at the END of the Sequence list, dormant
// until clicked or reached by auto-advance. No per-scene picker (v29
// decision, favouring the simpler path) — it's all-or-nothing; prune
// unwanted ones afterward with each scene's own existing × delete
// button, same as any manually-added scene.
function createImportRow() {
  let container = document.createElement('div');
  Object.assign(container.style, { display: 'flex', gap: '6px' });

  let importBtn = harmonyButton('📥 Import Scenes'); // 📥
  Object.assign(importBtn.style, { flex: '1', fontSize: '12px', padding: '6px 8px', fontWeight: 'bold' });
  importBtn.title = 'Add every scene from another saved show file to the end of this Sequence, without replacing anything currently loaded';

  let fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', (e) => {
    let file = e.target.files && e.target.files[0];
    e.target.value = ''; // reset so picking the SAME file again still fires 'change'
    if (!file) return;

    let reader = new FileReader();
    reader.onload = () => {
      let raw;
      try {
        raw = JSON.parse(reader.result);
      } catch (err) {
        window.alert('That file is not valid JSON.');
        return;
      }
      let migrated;
      try {
        migrated = migrateShowData(raw);
      } catch (err) {
        window.alert("That file doesn't look like a saved show:\n" + err.message);
        return;
      }
      let n = migrated.scenes.length;
      let label = migrated.showName ? '"' + migrated.showName + '"' : 'this file';
      let plural = n === 1 ? 'scene' : 'scenes';
      if (!window.confirm(
        'Import all ' + n + ' ' + plural + ' from ' + label + '? ' +
        "They'll be added to the end of your current Sequence \u2014 nothing currently loaded is replaced."
      )) return;
      // migrateShowData()'s scenes are already fully independent,
      // plain JSON-safe objects (migrateSceneData() builds each one
      // fresh, field by field) — safe to push straight onto the live
      // array, same as "+ Add Scene" does with cloneSceneFrom()'s
      // output. currentSceneIndex/autoAdvance and any in-flight
      // transition are untouched.
      sequenceScenes.push(...migrated.scenes);
      rebuildSequenceList();
    };
    reader.onerror = () => window.alert('Could not read that file.');
    reader.readAsText(file);
  });

  importBtn.onclick = () => fileInput.click();

  container.appendChild(importBtn);
  container.appendChild(fileInput);
  return container;
}

// Clears and rebuilds the "Recovered backups" list inside the Sequence
// panel from whatever's currently in localStorage (loadAutoBackups()) —
// called after every captureAutoBackup() and whenever the panel is first
// built, so it never shows stale entries. A no-op if the panel hasn't
// been built yet (backupsListDiv still null) — captureAutoBackup() can
// fire from setupUI() before createSequenceMenu() has run.
function refreshBackupList() {
  if (!backupsListDiv) return;
  backupsListDiv.innerHTML = '';

  let backups = loadAutoBackups();
  if (backupsToggleLabelSpan) {
    backupsToggleLabelSpan.textContent = 'Recovered backups (' + backups.length + ')';
  }
  if (backups.length === 0) {
    let empty = document.createElement('div');
    empty.textContent = 'No backups yet — this fills in automatically as you work.';
    Object.assign(empty.style, { fontSize: '11px', opacity: '0.6' });
    backupsListDiv.appendChild(empty);
    return;
  }

  backups.forEach((backup) => {
    let row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '6px' });

    let label = document.createElement('span');
    label.textContent = formatBackupTimestamp(backup.savedAt);
    Object.assign(label.style, { flex: '1', fontSize: '11px' });

    let restoreBtn = harmonyButton('Restore');
    restoreBtn.onclick = () => {
      let when = formatBackupTimestamp(backup.savedAt);
      if (!window.confirm('Restore the auto-backup from ' + when + '? Your current unsaved changes will be lost (save them first if you want to keep them).')) return;
      let migrated;
      try {
        migrated = migrateShowData(backup);
      } catch (err) {
        window.alert('This backup is damaged and can\'t be restored: ' + err.message);
        return;
      }
      applyShowData(migrated);
    };

    row.appendChild(label);
    row.appendChild(restoreBtn);
    backupsListDiv.appendChild(row);
  });
}

function createSequenceMenu() {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    zIndex: 1000,
    fontFamily: 'sans-serif',
    fontSize: '12px',
    display: menuSystemVisible ? '' : 'none', // v27: respect the hamburger's current state
  });
  document.body.appendChild(wrapper);
  sequenceMenuWrapper = wrapper; // so setMenuSystemVisible() can reach it — built here, not via createMenuWrapper()

  let toggleBtn = document.createElement('button');
  toggleBtn.textContent = 'Sequence';
  styleToggleButton(toggleBtn);
  wrapper.appendChild(toggleBtn);

  let panel = document.createElement('div');
  stylePanel(panel);
  // stylePanel() defaults to left:0 (panel grows rightward from the
  // wrapper), which would push a panel wider than the button off the
  // right edge of the screen here, since the wrapper itself is pinned
  // via right:10px. Anchoring the panel's own RIGHT edge to the
  // wrapper's right edge instead makes it grow leftward, staying
  // on-screen. Widened slightly from v22's 230px to fit the Save/Load
  // buttons and backup rows comfortably.
  Object.assign(panel.style, { left: 'auto', right: '0', minWidth: '280px' });
  wrapper.appendChild(panel);

  attachHoverAutoClose(wrapper, panel);

  // Save/Load sit OUTSIDE sequenceListContentDiv (see createSaveLoadRow's
  // own comment) so they survive every rebuildSequenceList() untouched.
  panel.appendChild(createSaveLoadRow());
  panel.appendChild(createImportRow()); // v29

  let topDivider = document.createElement('div');
  Object.assign(topDivider.style, { borderTop: '1px solid #555', margin: '4px 0' });
  panel.appendChild(topDivider);

  let contentDiv = document.createElement('div');
  Object.assign(contentDiv.style, { display: 'flex', flexDirection: 'column', gap: '6px' });
  panel.appendChild(contentDiv);
  sequenceListContentDiv = contentDiv;

  let bottomDivider = document.createElement('div');
  Object.assign(bottomDivider.style, { borderTop: '1px solid #555', margin: '4px 0' });
  panel.appendChild(bottomDivider);

  // v27: collapsed behind a small clickable header by default — a
  // dropdown rather than an always-open list — so it doesn't take up
  // panel space until you actually want to look at it. Its arrow/count
  // and the list itself (backupsListDiv) are kept as separate elements
  // so refreshBackupList() can update the count/rows without touching
  // whether the section is currently expanded.
  let backupsToggle = document.createElement('button');
  Object.assign(backupsToggle.style, {
    display: 'flex', alignItems: 'center', gap: '4px', width: '100%',
    background: 'transparent', color: '#fff', border: 'none',
    padding: '2px 0', cursor: 'pointer', fontSize: '11px', opacity: '0.85', textAlign: 'left',
  });
  let backupsToggleArrow = document.createElement('span');
  backupsToggleArrow.textContent = backupsSectionExpanded ? '▾' : '▸'; // ▾ / ▸
  let backupsToggleLabel = document.createElement('span');
  backupsToggleLabel.textContent = 'Recovered backups'; // refreshBackupList() appends the live count
  backupsToggle.appendChild(backupsToggleArrow);
  backupsToggle.appendChild(backupsToggleLabel);
  backupsToggle.title = 'Local auto-backups on this browser only — not how a show travels between computers (use Save/Load Show above for that)';
  backupsToggle.onclick = () => {
    backupsSectionExpanded = !backupsSectionExpanded;
    backupsToggleArrow.textContent = backupsSectionExpanded ? '▾' : '▸';
    backupsListDiv.style.display = backupsSectionExpanded ? 'flex' : 'none';
  };
  panel.appendChild(backupsToggle);
  backupsToggleLabelSpan = backupsToggleLabel;

  let backupsDiv = document.createElement('div');
  Object.assign(backupsDiv.style, {
    display: backupsSectionExpanded ? 'flex' : 'none',
    flexDirection: 'column', gap: '4px', marginTop: '2px',
  });
  panel.appendChild(backupsDiv);
  backupsListDiv = backupsDiv;

  rebuildSequenceList();
  refreshBackupList();

  return { wrapper, panel, toggleBtn };
}

// Clears and rebuilds the Sequence dropdown's contents from scratch —
// called after any add/delete/switch so the active-scene highlight and
// scene numbering (renumbered naturally via sceneName()'s indexOf())
// always match current state.
function rebuildSequenceList() {
  // v29: detach each row's 🕐 clock-popup handle from allMenus before
  // the DOM underneath it gets wiped out — same teardown discipline
  // rebuildColorAndLayoutMenus() already uses for per-set menus, so a
  // scene add/delete/switch doesn't leak a stale, DOM-less entry into
  // the shared colour-picker-freeze bookkeeping every time this runs.
  sequenceRowHandles.forEach((h) => {
    if (h.menuEntry && h.menuEntry.detach) h.menuEntry.detach();
  });
  sequenceListContentDiv.innerHTML = '';
  sequenceRowHandles = [];

  // Stops Sequence from swapping scenes on its own — lets you sit on
  // one scene and edit it via the normal Colors/Layout controls without
  // an automatic advance changing it underneath you. Manually clicking
  // a scene below still switches either way.
  let autoRow = document.createElement('label');
  Object.assign(autoRow.style, { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' });
  let autoCheckbox = document.createElement('input');
  autoCheckbox.type = 'checkbox';
  autoCheckbox.checked = sequenceState.autoAdvance;
  autoCheckbox.title = 'Automatically advance to the next scene once the current one finishes its cycle count';
  autoCheckbox.addEventListener('change', (e) => {
    sequenceState.autoAdvance = e.target.checked;
    if (sequenceState.autoAdvance) {
      // Resume counting fresh from now, rather than immediately
      // advancing because of elapsed time that built up while paused.
      sequenceState.sceneStartMs = sketchNow(); // v43.0
    }
  });
  let autoLabel = document.createElement('span');
  autoLabel.textContent = 'Auto-advance';
  autoRow.appendChild(autoCheckbox);
  autoRow.appendChild(autoLabel);
  sequenceListContentDiv.appendChild(autoRow);

  let divider = document.createElement('div');
  Object.assign(divider.style, { borderTop: '1px solid #555', margin: '2px 0' });
  sequenceListContentDiv.appendChild(divider);

  sequenceScenes.forEach((scene) => {
    let idx = sequenceScenes.indexOf(scene);
    let isActive = idx === sequenceState.currentSceneIndex;
    let isPending = !!sceneTransition && sceneTransition.targetIndex === idx;

    let row = document.createElement('div');
    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '4px' });

    let nameBtn = document.createElement('button');
    nameBtn.textContent = sceneName(scene);
    Object.assign(nameBtn.style, {
      flex: '1', textAlign: 'left', padding: '6px 8px',
      color: '#fff', borderRadius: '4px', cursor: 'pointer',
    });
    applySceneButtonStyle(nameBtn, isActive, isPending);
    nameBtn.onclick = () => loadScene(sequenceScenes.indexOf(scene));
    row.appendChild(nameBtn);

    let clockHandle = createSceneTransitionClock(scene); // v29
    row.appendChild(clockHandle.wrapper);

    sequenceRowHandles.push({ scene, nameBtn, menuEntry: clockHandle.menuEntry });

    let renameBtn = smallButton('✏️', 'Rename this scene'); // ✏️
    renameBtn.style.fontSize = '11px';
    renameBtn.onclick = (e) => { e.stopPropagation(); renameScene(scene); };
    row.appendChild(renameBtn);

    // v32: duplicate THIS scene, inserted directly after it.
    let copyBtn = smallButton('⧉', 'Copy this scene (inserted right after it)');
    copyBtn.onclick = (e) => { e.stopPropagation(); copySceneAfter(scene); };
    row.appendChild(copyBtn);

    let timesSpan = document.createElement('span');
    timesSpan.textContent = '×';
    row.appendChild(timesSpan);

    let cyclesInput = document.createElement('input');
    cyclesInput.type = 'number';
    cyclesInput.min = '1';
    cyclesInput.step = '1';
    cyclesInput.value = scene.cycles;
    cyclesInput.title = "How many times this scene's own pattern repeats before Sequence moves on";
    Object.assign(cyclesInput.style, {
      width: '38px', background: '#222', color: '#fff',
      border: '1px solid #555', borderRadius: '4px', padding: '2px 4px',
    });
    // Editing the number shouldn't also trigger the row's own "load
    // this scene" click — the click handler lives on nameBtn only, but
    // clicks here can still bubble into the wrapper's own hover/close
    // handling, so stop them at the source.
    cyclesInput.addEventListener('click', (e) => e.stopPropagation());
    cyclesInput.addEventListener('change', (e) => {
      let v = parseInt(e.target.value, 10);
      scene.cycles = isNaN(v) || v < 1 ? 1 : v;
      e.target.value = scene.cycles;
    });
    row.appendChild(cyclesInput);

    let canDelete = sequenceScenes.length > 1;
    let deleteBtn = document.createElement('button');
    deleteBtn.textContent = '×';
    deleteBtn.title = canDelete ? 'Delete this scene' : 'At least one scene must remain';
    deleteBtn.disabled = !canDelete;
    Object.assign(deleteBtn.style, {
      width: '22px', height: '22px', lineHeight: '1',
      background: 'rgba(200,60,60,0.25)', color: '#fff',
      border: '1px solid #a55', borderRadius: '4px',
      cursor: canDelete ? 'pointer' : 'not-allowed',
      opacity: canDelete ? '1' : '0.4',
    });
    deleteBtn.onclick = (e) => { e.stopPropagation(); deleteScene(scene); };
    row.appendChild(deleteBtn);

    sequenceListContentDiv.appendChild(row);
  });

  let addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Scene';
  Object.assign(addBtn.style, {
    marginTop: '4px', padding: '6px 8px',
    background: 'rgba(255,255,255,0.1)', color: '#fff',
    border: '1px solid #555', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold',
  });
  addBtn.title = 'Add a fresh scene (new random colours, default layout) — use a row\'s ⧉ to copy an existing scene instead';
  addBtn.onclick = () => {
    // v32: a fresh default scene (see makeFreshScene()), appended at the
    // end — not auto-switched to, so you can keep working on the scene
    // you're on and visit the new one later.
    sequenceScenes.push(makeFreshScene());
    rebuildSequenceList();
  };
  sequenceListContentDiv.appendChild(addBtn);
}

// v32: inserts an independent copy of `scene` (every Colors/Layout set,
// timings, cycles, scene-transition settings — see cloneSceneFrom())
// directly after it. Anything after the insertion point shifts down by
// one, so the loaded scene's index (and an in-flight scene transition's
// target) are bumped to keep pointing at the same scenes.
function copySceneAfter(scene) {
  let idx = sequenceScenes.indexOf(scene);
  if (idx === -1) return;
  sequenceScenes.splice(idx + 1, 0, cloneSceneFrom(scene, scene.cycles));
  if (sequenceState.currentSceneIndex > idx) sequenceState.currentSceneIndex += 1;
  if (sceneTransition && sceneTransition.targetIndex > idx) sceneTransition.targetIndex += 1;
  rebuildSequenceList();
}

// Deletes a scene after confirmation, refuses if it's the only one
// left. If the deleted scene was the one currently loaded, loads
// whichever scene now sits in its place (or wraps to the last one) —
// via loadScene(), so this also crossfades rather than cutting;
// otherwise just fixes up the stored index if scenes after it shifted.
function deleteScene(scene) {
  if (sequenceScenes.length <= 1) return;
  let name = sceneName(scene);
  if (!window.confirm('Delete ' + name + '? This cannot be undone.')) return;

  let idx = sequenceScenes.indexOf(scene);
  if (idx === -1) return;
  let wasActive = idx === sequenceState.currentSceneIndex;
  sequenceScenes.splice(idx, 1);
  let neighbour = Math.min(idx, sequenceScenes.length - 1);

  // v38.1: keep an in-flight scene crossfade pointing at the right scene.
  // Before, its target number didn't follow the list shift, so the fade
  // could finish on the wrong scene.
  let fadeStillValid = false;
  if (sceneTransition) {
    if (sceneTransition.targetIndex === idx) {
      sceneTransition.targetIndex = -1; // its target is gone — retargeted below
    } else {
      if (sceneTransition.targetIndex > idx) sceneTransition.targetIndex -= 1;
      fadeStillValid = true;
    }
  }

  if (wasActive) {
    // The scene that was on screen just disappeared — nothing to save
    // it back into. currentSceneIndex stays invalid until the next scene
    // finishes loading (finalizeLoadScene() sets it).
    sequenceState.currentSceneIndex = -1;
  } else if (idx < sequenceState.currentSceneIndex) {
    sequenceState.currentSceneIndex -= 1;
  }

  // Head to the neighbour if the deleted scene was on screen or was being
  // faded TO — unless a still-valid crossfade is already going somewhere.
  // loadScene() freezes whatever is on screen now and fades from there.
  if ((wasActive || sceneTransition) && !fadeStillValid) loadScene(neighbour);
  rebuildSequenceList(); // v38.1: list updates straight away
}

// Tears down and rebuilds every "Colors N" / "Layout N" menu from the
// (just-swapped-in) live colorSets/layoutGroup.sets arrays. Needed
// because a Scene can carry a different NUMBER of sets than whatever
// was on screen a moment ago — the same per-set teardown addColorSet()/
// deleteColorSet() already do, just applied to the whole array at once.
// The Timing/Layout Timing menus stay in the DOM as-is (their sliders'
// onChange callbacks already close over the shared changeIntervalSec/
// layoutGroup fields correctly); only their displayed slider position
// needs to visually catch up to the loaded scene's stored values.
//
// IMPORTANT: clear each handles array IN PLACE (.length = 0) rather
// than reassigning it (colorMenuHandles = []) — createAddLayoutSetControl()
// captured `layoutMenuHandles` as a plain function PARAMETER back in
// setupUI(), a snapshot of that one array object, not a live reference
// to the `layoutMenuHandles` variable itself. Reassigning the variable
// here would leave that "+" button's closure pointing at the old,
// abandoned array forever after — it would keep pushing new layout
// menus into an array relayoutMenuBar() never looks at again, so the
// new menu's wrapper would never get positioned and would sit at its
// CSS default (the far-left edge of the screen) instead of the end of
// the layout bar. Clearing in place keeps every closure — however it
// captured the array — pointed at the same object for good.
