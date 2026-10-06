// noprotect
// Ritualized Viewing v43.0 — 05b_projection.js
// Split out of 05_menus in v42.0 (code unchanged, same order): the view switch [Flat | Room | ⚙] (Room + Person tabs), the Projection menu (createRoomMenu), the eye marker, icons (ICON_SVG, iconEl) and ⓘ dots (infoDot), surface-table flow words.
// Part of a multi-file sketch: all files share one global scope; load order
// is set in index.html. Map and conventions: 00_index.md.

// ---------------------- v39.1: ROOM MENU (👁, top-right) ----------------------
// Everything about the room: Flat / Room, centre surface, size, which
// surfaces are shown, and the viewpoint. Sits just left of Sequence.
// v40.4: the 🖥 Display menu, bottom-left next to Safety — how the
// picture is shown on this screen: frame shape (saved with the show) and
// preview sharpness (preview only). Moved out of the Projection menu.
function radiateFlowWords(mp) {
  if (!mp || !mp.radiate || mp.radiate === 'off') return null;
  let wasRoom = roomView;
  roomView = true; // the table describes the room, even when previewing Flat
  let regs = radiateRegionsFor(mp);
  roomView = wasRoom;
  let words = {};
  ROOM_FACE_NAMES.forEach((n) => { words[n] = []; });
  let sign = mp.flow === 'down' ? -1 : 1;
  regs.forEach((reg) => reg.clips.forEach((c) => {
    let f = c.face, n = f.name;
    if (n === mp.hub) return;
    let cx = c.poly.reduce((a, p) => a + p[0], 0) / c.poly.length, cy = c.poly.reduce((a, p) => a + p[1], 0) / c.poly.length;
    let d = v3norm(v3sub(f.to3d(cx + reg.sin * sign, cy - reg.cos * sign), f.to3d(cx, cy))); // the grid's "up", turned
    let comp = d.map(Math.abs).sort((a, b) => b - a);
    let w = comp[1] > 0.35 ? '⤢ diagonal' : flowWords(d); // ✚ flows run at an angle
    if (!words[n].includes(w)) words[n].push(w);
  }));
  ROOM_FACE_NAMES.forEach((n) => { words[n] = words[n].join(' / ') || '—'; });
  words[mp.hub] = mp.flow === 'down' ? '✳ inward' : '✳ outward';
  return words;
}

// v40.4: a room direction (unit vector) in words, as seen by the viewer
// standing at the open front looking at the back wall.
function flowWords(d) {
  let ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  if (ay >= ax && ay >= az) return d[1] > 0 ? '↑ up' : '↓ down';
  if (ax >= az) return d[0] > 0 ? '→ right' : '← left';
  return d[2] > 0 ? 'away' : 'toward you';
}

// v41.3: SMALL LINE ICONS (inline SVG, drawn in the text colour, so
// they dim and brighten with their button). Gear: Feather icons (MIT).
const ICON_SVG = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  room: '<rect x="2.5" y="3.5" width="19" height="17"/><rect x="8" y="8.5" width="8" height="7"/><path d="M2.5 3.5 8 8.5M21.5 3.5 16 8.5M2.5 20.5 8 15.5M21.5 20.5 16 15.5"/>',
  // v41.5: person = "Person Standing Icon" by nhpvect 02, Vecteezy Free
  // License (attribution: Vecteezy.com — credited in the Person tab and
  // to go in the video credits / TFG). Redrawn as a clean filled shape
  // from the supplied file.
  // https://www.vecteezy.com/free-vector/person-standing-icon
  person: '<g fill="currentColor" stroke="none"><circle cx="745" cy="166" r="49"/><path d="M648 278 A50 50 0 0 1 698 228 H790 A50 50 0 0 1 840 278 V437 A18 18 0 0 1 804 437 V300 H799 V675 A24 24 0 0 1 751 675 V455 H737 V675 A24 24 0 0 1 689 675 V300 H684 V437 A18 18 0 0 1 648 437 Z"/></g>',
};
const ICON_VIEWBOX = { person: '594 108 300 594' }; // v41.5: icons not drawn on the 24 × 24 grid
function iconEl(name, size) {
  let span = document.createElement('span');
  span.innerHTML = '<svg viewBox="' + (ICON_VIEWBOX[name] || '0 0 24 24') + '" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:block">' + ICON_SVG[name] + '</svg>';
  Object.assign(span.style, { display: 'inline-flex', alignItems: 'center', justifyContent: 'center' });
  return span;
}
// v41.3: a tiny ⓘ — hover (or click) shows `text` in a small box.
// The box lives on the page itself, so a scrolling menu panel can't cut
// it off.
function infoDot(text) {
  let dot = document.createElement('span');
  dot.textContent = 'i';
  Object.assign(dot.style, {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '13px', height: '13px', borderRadius: '50%', border: '1px solid #888', color: '#bbb',
    fontSize: '9.5px', fontWeight: 'bold', fontStyle: 'italic', fontFamily: 'Georgia, serif',
    cursor: 'help', marginLeft: '4px', verticalAlign: 'middle', flex: '0 0 auto', userSelect: 'none',
  });
  let tip = null;
  let show = () => {
    if (tip) return;
    tip = document.createElement('div');
    tip.textContent = text;
    Object.assign(tip.style, {
      position: 'fixed', zIndex: 3000, maxWidth: '260px', padding: '7px 9px',
      background: 'rgba(12,12,12,0.96)', border: '1px solid #666', borderRadius: '5px',
      color: '#ddd', fontFamily: 'sans-serif', fontSize: '11px', lineHeight: '1.4', fontWeight: 'normal', fontStyle: 'normal',
      pointerEvents: 'none', textAlign: 'left',
    });
    document.body.appendChild(tip);
    let r = dot.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = Math.min(Math.max(r.left + r.width / 2 - tw / 2, 6), innerWidth - tw - 6);
    let y = r.bottom + 6 + th > innerHeight ? r.top - th - 6 : r.bottom + 6;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  let hide = () => { if (tip) { tip.remove(); tip = null; } };
  dot.addEventListener('mouseenter', show);
  dot.addEventListener('mouseleave', hide);
  dot.addEventListener('click', (e) => { e.stopPropagation(); if (tip) hide(); else show(); });
  return dot;
}

// v41.1: THE VIEW SWITCH, top bar, just left of 📽️ Projection:
//   [ Flat | Room ▾ ]
// Flat / Room switch the preview (not saved). ▾ opens a small panel with
// the ROOM (size, one for all scenes) and the PERSON (on/off, colour,
// Chrome → Solid, move). Both are saved with the show, as before. The
// viewpoint stays in Projection (it belongs to each mapping).
// The ▾ button is the wrapper's FIRST child (attachHoverAutoClose() makes
// the first child the panel's toggle); CSS order puts it last on screen.
let viewSwitch = null;
function createViewSwitch() {
  let wrapper = document.createElement('div');
  Object.assign(wrapper.style, {
    position: 'fixed', top: '10px', right: '200px', zIndex: 1000,
    display: menuSystemVisible ? 'flex' : 'none', alignItems: 'stretch',
    fontFamily: 'sans-serif', fontSize: '12px',
  });
  document.body.appendChild(wrapper);

  function seg(text, tip, order) {
    let b = document.createElement('button');
    b.textContent = text;
    b.title = tip;
    styleToggleButton(b);
    b.style.order = String(order);
    b.style.borderRadius = '0';
    return b;
  }
  let moreBtn = seg('', 'Room size and the person', 3);
  moreBtn.appendChild(iconEl('gear', 15)); // v41.3: a quiet gear (was ▾)
  let flatBtn = seg('Flat', 'The usual flat picture (the centre surface)', 1);
  let roomBtn = seg('Room', 'See the piece inside the room, in perspective', 2);
  flatBtn.style.borderRadius = '6px 0 0 6px';
  moreBtn.style.borderRadius = '0 6px 6px 0';
  roomBtn.style.borderLeft = 'none';
  moreBtn.style.borderLeft = 'none';
  Object.assign(moreBtn.style, { padding: '0 9px', display: 'flex', alignItems: 'center', color: '#8a8a8a' });
  moreBtn.addEventListener('mouseenter', () => { moreBtn.style.color = '#e8e8e8'; });
  moreBtn.addEventListener('mouseleave', () => { moreBtn.style.color = '#8a8a8a'; });
  wrapper.appendChild(moreBtn); // first child = the panel's toggle
  wrapper.appendChild(flatBtn);
  wrapper.appendChild(roomBtn);

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, { left: 'auto', right: '0', width: '260px', minWidth: '0', boxSizing: 'border-box' });
  wrapper.appendChild(panel);
  attachHoverAutoClose(wrapper, panel);

  let refreshAll = () => { if (roomMenu) roomMenu.refresh(); else refresh(); };
  flatBtn.addEventListener('click', () => { roomView = false; roomMoveEye = false; figureMoving = false; refreshAll(); });
  roomBtn.addEventListener('click', () => { roomView = true; refreshAll(); });

  function note(text) {
    let d = document.createElement('div');
    d.textContent = text;
    Object.assign(d.style, { fontSize: '11px', color: '#aaa', lineHeight: '1.4' });
    return d;
  }
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
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    return r;
  }
  function sectionHead(text, first) {
    let d = document.createElement('div');
    d.textContent = text;
    Object.assign(d.style, { fontWeight: 'bold', fontSize: '12px' });
    if (!first) Object.assign(d.style, { marginTop: '6px', borderTop: '1px solid #444', paddingTop: '6px' });
    return d;
  }
  let add = (el) => { panel.appendChild(el); return el; };

  // v41.3: two icon tabs, Room | Person — one section shown at a time
  let tabRow = row();
  Object.assign(tabRow.style, { gap: '4px', paddingBottom: '6px', borderBottom: '1px solid #444' });
  add(tabRow);
  let tabs = {};
  let tab = 'room';
  [['room', 'Room', 'Room size (one for all scenes)'], ['person', 'Person', 'The person, for scale']].forEach(([k, label, tip]) => {
    let b = pill('', tip, () => { tab = k; refresh(); });
    Object.assign(b.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' });
    b.appendChild(iconEl(k, 15));
    let t = document.createElement('span'); t.textContent = label;
    b.appendChild(t);
    tabs[k] = b;
    tabRow.appendChild(b);
  });
  let roomSec = add(document.createElement('div'));
  let personSec = add(document.createElement('div'));
  [roomSec, personSec].forEach((d) => Object.assign(d.style, { display: 'flex', flexDirection: 'column', gap: '6px' }));

  // Room — once per show (moved from Projection)
  add = (el) => { roomSec.appendChild(el); return el; };
  let flatNote = add(note('Seen in Room view.'));
  let roomTip = 'Deeper room = smaller back wall on screen. Like the real venue, the room is the same for every scene and projection set.';
  let roomHead = add(sectionHead('Room (one for all scenes)', true));
  roomHead.title = roomTip;
  let sizeRows = {};
  [['w', 'Width'], ['h', 'Height'], ['d', 'Depth']].forEach(([key, name]) => {
    let [lo, hi] = ROOM_SIZE_RANGE[key];
    sizeRows[key] = add(buildSliderRow(name, lo, hi, 0.5, room[key], 'm', (v) => { room[key] = v; }));
    sizeRows[key].title = roomTip;
  });

  // Person (moved from Projection)
  add = (el) => { personSec.appendChild(el); return el; };
  add(sectionHead('Person (one for all scenes)', true));
  // v40.3: scale figure
  let figRow = row();
  let figLab = document.createElement('label');
  Object.assign(figLab.style, { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: '1' });
  let figBox = document.createElement('input');
  figBox.type = 'checkbox';
  figBox.addEventListener('change', () => { room.figure.on = figBox.checked; if (!figBox.checked) figureMoving = false; refreshAll(); });
  let figSpan = document.createElement('span');
  figSpan.textContent = 'Person (' + FIGURE_HEIGHT_M.toFixed(2) + ' m)';
  figSpan.title = 'A ' + Math.round(FIGURE_HEIGHT_M * 100) + ' cm figure (average height in Spain) standing on the floor, to show the size of the room';
  figLab.appendChild(figBox);
  figLab.appendChild(figSpan);
  figRow.appendChild(figLab);
  let figColor = document.createElement('input');
  figColor.type = 'color';
  figColor.title = 'Figure colour';
  Object.assign(figColor.style, { width: '28px', height: '22px', padding: '0', border: '1px solid #555', background: 'none', cursor: 'pointer' });
  figColor.addEventListener('input', () => { room.figure.color = hexToRgb(figColor.value); });
  figRow.appendChild(figColor);
  add(figRow);
  // v40.9: Chrome (0%, reflects the room) … Solid (100%, one flat colour;
  // the floor shadow stays) — anything in between.
  let figLook = add(buildSliderRow('Chrome → Solid', 0, 100, 1, room.figure.solid * 100, '%', (v) => { room.figure.solid = v / 100; }));
  figLook.title = '0% = chrome, reflecting the room · 100% = one flat colour from the picker (the floor shadow stays)';
  let figMoveRow = row();
  let figMoveBtn = pill('Move person', 'Show a handle at the feet and drag it around the floor', () => {
    figureMoving = !figureMoving;
    if (figureMoving) room.figure.on = true;
    refreshAll();
  });
  Object.assign(figMoveBtn.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }); // v41.5
  figMoveBtn.insertBefore(iconEl('person', 14), figMoveBtn.firstChild);
  let figCentreBtn = pill('Centre', 'Back to the middle of the floor', () => { room.figure.fx = 0.5; room.figure.fz = 0.5; });
  setActive(figCentreBtn, false);
  figMoveRow.appendChild(figMoveBtn);
  figMoveRow.appendChild(figCentreBtn);
  add(figMoveRow);
  let personNote = add(note(''));
  let credit = add(note('')); // v41.5: Vecteezy Free License attribution
  credit.innerHTML = 'Person icon: <a href="https://www.vecteezy.com/free-vector/person-standing-icon" target="_blank" rel="noopener" style="color:#9cc4ff">Vecteezy.com</a>';
  credit.style.fontSize = '10px';
  function refresh() {
    setActive(flatBtn, !roomView);
    setActive(roomBtn, roomView);
    flatBtn.style.background = !roomView ? '#e8e8e8' : 'rgba(20,20,20,0.85)';
    roomBtn.style.background = roomView ? '#e8e8e8' : 'rgba(20,20,20,0.85)';
    flatNote.style.display = roomView ? 'none' : '';
    Object.keys(tabs).forEach((k) => setActive(tabs[k], tab === k)); // v41.3
    roomSec.style.display = tab === 'room' ? 'flex' : 'none';
    personSec.style.display = tab === 'person' ? 'flex' : 'none';
    personNote.textContent = roomView
      ? 'Saved with the show. In Flat view it stands at the bottom edge, seen from the front, for scale.'
      : 'Flat view: seen from the front at the bottom edge, at true scale (Move person works in Room view).';
    ['w', 'h', 'd'].forEach((k) => sizeRows[k].setValue(room[k]));
    figBox.checked = room.figure.on; // v40.3
    figColor.value = rgbToHex(room.figure.color);
    setActive(figMoveBtn, figureMoving);
    figLook.setValue(room.figure.solid * 100); // v40.9
  }
  function setVisible(visible) { wrapper.style.display = visible ? 'flex' : 'none'; }
  // Sits just left of Sequence (both measured from the right). v41.4: was left of Projection.
  function place() {
    let pw = sequenceMenuWrapper;
    if (!pw) return;
    wrapper.style.right = ((parseFloat(pw.style.right) || 0) + pw.offsetWidth + 10) + 'px';
  }

  refresh();
  return { refresh, setVisible, place, wrapper };
}

// v40.2: the 📽 Projection menu (was \"👁 Room\"). Top to bottom:
//   Mapping 1, 2… [+] [×]  — this scene's mappings; click one to play and edit it
//   Artwork   — Direction (Flat too), Radiate, surface table (Room only)
//   Showcase  — Viewpoint + 👁📋 copy (Room only)
// v41.1: Flat / Room, room size and the person moved to the top bar's
// [Flat | Room ▾] control (createViewSwitch()).
// Everything that only means something in Room view is hidden in Flat.
function createRoomMenu() {
  // v41.4: in the left menu bar, right after Layout (relayoutMenuBar()),
  // built like Colors / Layout: numbered chips for this scene's
  // projection sets (the old "mappings"), the playing one on the button.
  let wrapper = createMenuWrapper();

  let btn = document.createElement('button');
  btn.title = 'How the piece sits on the room: projection sets, direction, Radiate, surfaces, viewpoint';
  styleToggleButton(btn);
  let btnLabel = document.createElement('span');
  btnLabel.textContent = 'Projection';
  let btnState = document.createElement('span');
  Object.assign(btnState.style, { display: 'inline-block', minWidth: '36px', marginLeft: '5px', opacity: '0.75', textAlign: 'left' });
  btn.appendChild(btnLabel);
  btn.appendChild(btnState);
  wrapper.appendChild(btn);

  let panel = document.createElement('div');
  stylePanel(panel);
  Object.assign(panel.style, { width: '300px', minWidth: '0', boxSizing: 'border-box' });
  wrapper.appendChild(panel);
  attachHoverAutoClose(wrapper, panel);
  // v41.4: open = being edited — the projection cycle waits (agreed v41
  // point 5, done here first: a set switching mid-edit made the sliders
  // jump to the next set's values). See updateMappingChange().
  let isOpen = () => panel.style.display === 'flex';

  let roomOnly = []; // elements hidden in Flat view
  function add(el, onlyInRoom) {
    panel.appendChild(el);
    if (onlyInRoom) { el.dataset.disp = el.style.display || ''; roomOnly.push(el); }
    return el;
  }
  function note(text) {
    let d = document.createElement('div');
    d.textContent = text;
    Object.assign(d.style, { fontSize: '11px', color: '#aaa', lineHeight: '1.4' });
    return d;
  }
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
    Object.assign(r.style, { display: 'flex', alignItems: 'center', gap: '4px' });
    return r;
  }
  function sectionHead(text) {
    let d = document.createElement('div');
    d.textContent = text;
    Object.assign(d.style, { fontWeight: 'bold', fontSize: '12px', marginTop: '6px', borderTop: '1px solid #444', paddingTop: '6px' });
    return d;
  }

  // v41.1: the Flat / Room switch, the room's size and the person moved to
  // the top bar's [Flat | Room ▾] control (createViewSwitch()).

  // v41.4: this scene's projection sets as chips [1] [2] [+], then the
  // chosen set's name and 🗑️ — the same layout as Colors / Layout.
  let mapRow = row();
  Object.assign(mapRow.style, { flexWrap: 'wrap', gap: '6px', paddingBottom: '6px', borderBottom: '1px solid #444' });
  add(mapRow);
  let setHeadRow = row();
  setHeadRow.style.justifyContent = 'space-between';
  let setHead = document.createElement('div');
  Object.assign(setHead.style, { fontWeight: 'bold', fontSize: '13px' });
  let setDel = createDeleteButton('Delete this projection set');
  Object.assign(setDel.style, { position: 'static' });
  setDel.addEventListener('click', (e) => { e.stopPropagation(); requestDeleteMapping(); refresh(); });
  setHeadRow.appendChild(setHead);
  setHeadRow.appendChild(setDel);
  add(setHeadRow);
  let mapNote = add(note(''));

  // v40.5: how mappings change (only shown with 2+ mappings)
  function numBox(range, step, onChange) {
    let inp = document.createElement('input');
    inp.type = 'number';
    inp.min = range[0]; inp.max = range[1]; inp.step = step;
    Object.assign(inp.style, { width: '52px', background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '4px', padding: '2px 4px' });
    inp.addEventListener('change', () => {
      let v = parseFloat(inp.value);
      if (!Number.isFinite(v)) { refresh(); return; }
      onChange(Math.min(Math.max(v, range[0]), range[1]));
      refresh();
    });
    return inp;
  }
  let changeRow = row();
  let changeLab = miniLabel('Change');
  Object.assign(changeLab.style, { flex: '0 0 auto', marginRight: '4px' });
  changeRow.appendChild(changeLab);
  let changeBtns = {
    cut: pill('Cut', 'Switch to the next projection set at once', () => { sceneMappingTiming().change = 'cut'; refresh(); }),
    fade: pill('Fade', 'Crossfade into the next projection set', () => { sceneMappingTiming().change = 'fade'; refresh(); }),
  };
  changeRow.appendChild(changeBtns.cut);
  changeRow.appendChild(changeBtns.fade);
  let fadeBox = numBox(MAPPING_FADE_RANGE, 0.1, (v) => { sceneMappingTiming().fadeSec = v; });
  fadeBox.title = 'Fade length in seconds';
  let fadeUnit = document.createElement('span');
  fadeUnit.textContent = 's';
  changeRow.appendChild(fadeBox);
  changeRow.appendChild(fadeUnit);
  add(changeRow);

  let cycleRow = row();
  let cycleLab = document.createElement('label');
  Object.assign(cycleLab.style, { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', flex: '1' });
  let cycleBox = document.createElement('input');
  cycleBox.type = 'checkbox';
  cycleBox.addEventListener('change', () => { sceneMappingTiming().cycle = cycleBox.checked; mappingCycleStart = sketchNow(); /* v43.0 */ refresh(); });
  let cycleSpan = document.createElement('span');
  cycleSpan.textContent = 'Cycle through them, each for';
  cycleLab.appendChild(cycleBox);
  cycleLab.appendChild(cycleSpan);
  cycleRow.appendChild(cycleLab);
  let holdBox = numBox(MAPPING_HOLD_RANGE, 0.5, (v) => { sceneMappingTiming().holdSec = v; });
  holdBox.title = 'Seconds on each projection set (at least ' + MAPPING_HOLD_MIN_SEC + ' s, for safety)';
  let holdUnit = document.createElement('span');
  holdUnit.textContent = 's';
  cycleRow.appendChild(holdBox);
  cycleRow.appendChild(holdUnit);
  add(cycleRow);

  let flowRow = row();
  let flowLab = miniLabel('Direction');
  Object.assign(flowLab.style, { flex: '0 0 auto', marginRight: '4px' });
  flowRow.appendChild(flowLab);
  let flowBtns = {
    up: pill('↑ Up', 'Every swipe travels up the unfolded sheet', () => { activeMapping().flow = 'up'; refresh(); }),
    down: pill('↓ Down', 'Every swipe travels down the unfolded sheet (all reversed at once, so joins stay seamless)', () => { activeMapping().flow = 'down'; refresh(); }),
  };
  flowRow.appendChild(flowBtns.up);
  flowRow.appendChild(flowBtns.down);
  add(flowRow);

  // v40.7: Radiate — flow out from the middle of the centre
  let radRow = row();
  let radLab = miniLabel('Radiate');
  Object.assign(radLab.style, { flex: '0 0 auto', marginRight: '4px' });
  radRow.appendChild(radLab);
  let radBtns = {
    off: pill('Off', 'The whole picture flows one way', () => { activeMapping().radiate = 'off'; refresh(); }),
    x: pill('✕', 'From the middle of the centre, split by its diagonals: each part flows to its own edge and on to the next surface', () => { activeMapping().radiate = 'x'; refresh(); }),
    plus: pill('✚', 'From the middle of the centre, split into quarters: each flows diagonally to its corner and on to the next surfaces', () => { activeMapping().radiate = 'plus'; refresh(); }),
  };
  Object.values(radBtns).forEach((b) => radRow.appendChild(b));
  add(radRow);
  // v40.10: which point of the middle screen sits on the midpoint — per
  // section, linked: all 4 together, opposite pairs, or each on its own.
  let alignBox = document.createElement('div');
  Object.assign(alignBox.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
  add(alignBox);
  // v40.11: tucked into an "Edit alignment" dropdown, closed by default;
  // opening it widens the whole panel so the sliders are longer.
  let alignOpen = false;
  let alignToggle = pill('Edit alignment ▸', 'Which point of the middle screen sits on the midpoint, measured on the screen itself. ↔ Across: −100% left edge … 0 centred … +100% right edge. ↕ Along: −100% top edge … +100% bottom edge. Double-click a slider for 0.', () => {
    alignOpen = !alignOpen;
    refresh();
  });
  Object.assign(alignToggle.style, { flex: '0 0 auto', textAlign: 'left' });
  alignBox.appendChild(alignToggle);
  let alignBody = document.createElement('div');
  Object.assign(alignBody.style, { display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '8px', borderLeft: '2px solid #444' });
  alignBox.appendChild(alignBody);
  let linkRow = row();
  let linkLab = miniLabel('Link');
  Object.assign(linkLab.style, { flex: '0 0 auto', marginRight: '4px' });
  linkRow.appendChild(linkLab);
  let linkBtns = {};
  [['all', 'All 4', 'One pair of sliders moves all four sections'],
   ['pairs', 'Pairs', 'Opposite sections move together'],
   ['each', 'Each', 'Every section on its own']].forEach(([k, t, tip]) => {
    linkBtns[k] = pill(t, tip, () => {
      let ra = activeMapping().radiateAlign;
      // the shown sliders' values carry over to every section they now move
      radiateAlignGroups(activeMapping().radiate, k).forEach((g) => g.idx.forEach((i) => { ra.sections[i] = { ...ra.sections[g.idx[0]] }; }));
      ra.link = k;
      refresh();
    });
    linkRow.appendChild(linkBtns[k]);
  });
  alignBody.appendChild(linkRow);
  let alignSliders = document.createElement('div');
  Object.assign(alignSliders.style, { display: 'flex', flexDirection: 'column', gap: '4px' });
  alignBody.appendChild(alignSliders);
  let alignSig = '', alignRows = [], alignFor = null;
  function rebuildAlignSliders(m) {
    let ra = m.radiateAlign;
    let groups = radiateAlignGroups(m.radiate, ra.link);
    let sig = m.radiate + '|' + ra.link + '|' + sequenceState.currentSceneIndex + '|' + mappingIndex;
    if (sig !== alignSig || alignFor !== m) { // rebuilt only when the layout of sliders (or the set) changes
      alignSig = sig;
      alignFor = m; // v41.4: the set these sliders write into
      alignSliders.innerHTML = '';
      alignRows = [];
      groups.forEach((g) => {
        if (g.label) {
          let h = document.createElement('div');
          h.textContent = g.label;
          Object.assign(h.style, { fontSize: '11px', color: '#aaa', marginTop: '2px' });
          alignSliders.appendChild(h);
        }
        ['across', 'along'].forEach((axis) => {
          let r = buildCentredSlider(axis === 'across' ? '↔ Across' : '↕ Along',
            axis === 'across' ? 'Left edge (−100%) … centred (0) … right edge (+100%) of the middle screen on the midpoint. Past ±100% (it sticks there first) the screen moves on by up to one gap (±200%), so screens can meet in the middle. Double-click for 0.'
                              : 'Top edge (−100%) … centred (0) … bottom edge (+100%) of the middle screen on the midpoint. Past ±100% (it sticks there first) the screen moves on by up to one gap (±200%), so screens can meet in the middle. Double-click for 0.',
            0, (v) => { g.idx.forEach((i) => { m.radiateAlign.sections[i][axis] = v / 100; }); }); // v41.4: bound to ITS set (was activeMapping(): a drag could write into the next set)
          r.group = g; r.axis = axis;
          alignSliders.appendChild(r);
          alignRows.push(r);
        });
      });
    }
    alignRows.forEach((r) => r.setValue(ra.sections[r.group.idx[0]][r.axis] * 100));
    Object.keys(linkBtns).forEach((k) => setActive(linkBtns[k], ra.link === k));
  }

  // v40.4: one table for the surfaces of this mapping — which one is the
  // centre, which are shown, and where each one's screens flow (click to
  // reverse that surface).
  let surfGrid = document.createElement('div');
  Object.assign(surfGrid.style, { display: 'grid', gridTemplateColumns: '1fr auto auto 104px', gap: '3px 8px', alignItems: 'center' });
  ['Surface', 'Centre', 'Shown', 'Flow'].forEach((h, i) => {
    let d = document.createElement('div');
    d.textContent = h;
    Object.assign(d.style, { fontSize: '11px', color: '#aaa', textAlign: i === 0 ? 'left' : 'center' });
    if (h === 'Flow') d.appendChild(infoDot('Flow = where the screens move. Click it to reverse a surface; a reversed surface meets its neighbours at seams.')); // v41.3
    surfGrid.appendChild(d);
  });
  let surfRows = {};
  let radioName = 'centre-surface-' + Math.floor(Math.random() * 1e9);
  ROOM_FACE_NAMES.forEach((n) => {
    let lab = document.createElement('div');
    lab.textContent = ROOM_FACE_LABELS[n];
    let centre = document.createElement('input');
    centre.type = 'radio';
    centre.name = radioName;
    centre.title = 'Make ' + ROOM_FACE_LABELS[n].toLowerCase() + ' the centre of the unfolded sheet';
    centre.style.justifySelf = 'center';
    centre.addEventListener('change', () => { if (centre.checked) { activeMapping().hub = n; refresh(); } });
    let shownBox = document.createElement('input');
    shownBox.type = 'checkbox';
    shownBox.title = 'Untick = not projected (drawn black)';
    shownBox.style.justifySelf = 'center';
    shownBox.addEventListener('change', () => { activeMapping().walls[n] = shownBox.checked; refresh(); });
    let flowBtn = document.createElement('button');
    flowBtn.title = 'Where this surface\'s screens move. Click to reverse this surface (its joins with the neighbours become seams).';
    Object.assign(flowBtn.style, {
      padding: '3px 6px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #555',
      fontFamily: 'sans-serif', fontSize: '12px', textAlign: 'left', whiteSpace: 'nowrap',
    });
    flowBtn.addEventListener('click', () => {
      let r = activeMapping().reversed;
      r[n] = !r[n];
      refresh();
    });
    [lab, centre, shownBox, flowBtn].forEach((el) => surfGrid.appendChild(el));
    surfRows[n] = { lab, centre, shownBox, flowBtn };
  });
  add(surfGrid, true);

  // Showcase — demo videos only
  add(sectionHead('Showcase (demo videos only, not the real walls)'), true);
  let eyeRow = row();
  let moveBtn = pill('👁 Move viewpoint', 'Show the eye on screen and drag it to look from somewhere else (saved per projection set; 👁📋 below copies it to the others)', () => {
    roomMoveEye = !roomMoveEye;
    refresh();
  });
  let centreBtn = pill('Centre', 'Look from the middle again', () => { setViewEye([0.5, 0.5]); });
  setActive(centreBtn, false); // a one-off action, never "on"
  eyeRow.appendChild(moveBtn);
  eyeRow.appendChild(centreBtn);
  add(eyeRow, true);
  // v40.18: 👁📋 copy this mapping's viewpoint to another mapping, or all
  let eyeCopyRow = row();
  eyeCopyRow.style.alignItems = 'center';
  let eyeCopyIcon = document.createElement('span');
  eyeCopyIcon.textContent = '👁📋';
  eyeCopyIcon.title = 'Copy viewpoint';
  eyeCopyIcon.style.fontSize = '14px';
  let eyeCopySelect = document.createElement('select');
  Object.assign(eyeCopySelect.style, { background: '#222', color: '#fff', border: '1px solid #555', borderRadius: '4px', padding: '3px 4px', flex: '1', fontSize: '12px' });
  eyeCopySelect.addEventListener('change', () => {
    let v = eyeCopySelect.value, sc = currentScene();
    if (!v || !sc || !sc.mappings) return;
    let e = eyeFor(activeMapping());
    let label;
    if (v === 'all') { copyViewpointToAllMappings(); label = 'all sets'; }
    else { let i = +v; if (sc.mappings[i]) sc.mappings[i].eye = e.slice(); label = 'Projection ' + (i + 1); }
    refreshEyeCopy('✓ Copied to ' + label);
    setTimeout(() => refreshEyeCopy(), 1500);
  });
  function refreshEyeCopy(doneText) {
    let sc = currentScene(), n = sc && sc.mappings ? sc.mappings.length : 1;
    let shared = false; // v40.19: "Same in all mappings" removed
    eyeCopySelect.innerHTML = '';
    let head = document.createElement('option');
    head.value = '';
    head.textContent = doneText || (shared ? 'Copy viewpoint to… (not needed: 🔗 is on)' : n < 2 ? 'Copy viewpoint to… (only one set)' : 'Copy viewpoint to…');
    eyeCopySelect.appendChild(head);
    if (!shared && n >= 2) {
      for (let i = 0; i < n; i++) {
        if (i === mappingIndex) continue;
        let o = document.createElement('option');
        o.value = String(i);
        o.textContent = 'Projection ' + (i + 1);
        eyeCopySelect.appendChild(o);
      }
      let all = document.createElement('option');
      all.value = 'all';
      all.textContent = 'All projection sets';
      eyeCopySelect.appendChild(all);
    }
    eyeCopySelect.value = '';
    eyeCopySelect.disabled = shared || n < 2;
    eyeCopySelect.title = shared ? 'With 🔗 Same in all mappings on, every mapping already uses one viewpoint.'
      : 'Copies Projection ' + (mappingIndex + 1) + '\'s viewpoint to another projection set of this scene, or to all of them. Each can still be moved on its own afterwards.';
  }
  eyeCopyRow.appendChild(eyeCopyIcon);
  eyeCopyRow.appendChild(eyeCopySelect);
  add(eyeCopyRow, true);

  // v41.1: the person moved to the top bar's Room ▾ panel (createViewSwitch()).

  function rebuildMappingButtons() {
    let sc = sequenceScenes[sequenceState.currentSceneIndex];
    activeMapping(); // makes sure the list and the index are valid
    mapRow.innerHTML = '';
    let chip = (text, tip, onClick) => { // v41.4: like the Colors / Layout chips
      let b = document.createElement('button');
      b.textContent = text;
      b.title = tip;
      styleToggleButton(b);
      Object.assign(b.style, { padding: '4px 10px', fontSize: '13px' });
      b.addEventListener('click', onClick);
      return b;
    };
    sc.mappings.forEach((m, i) => {
      let b = chip(String(i + 1), 'Play and edit Projection ' + (i + 1), () => { switchMapping(i, sketchNow() /* v43.0 */); refresh(); }); // v40.5: with the scene's Cut / Fade
      applySetActiveStyle(b, i === mappingIndex, false);
      b.style.outline = i === mappingIndex ? '2px solid #fff' : 'none';
      b.style.outlineOffset = '2px';
      mapRow.appendChild(b);
    });
    let plus = chip('+', 'Add a projection set (a copy of the one you are on)', () => { addMapping(); refresh(); });
    plus.style.fontWeight = 'bold';
    mapRow.appendChild(plus);
    setHead.textContent = 'Projection ' + (mappingIndex + 1);
    let canDel = sc.mappings.length > 1;
    setDel.disabled = !canDel;
    setDel.style.opacity = canDel ? '1' : '0.4';
    setDel.style.cursor = canDel ? 'pointer' : 'not-allowed';
    btnState.textContent = '· ' + (mappingIndex + 1);
    let paused = sc.mappings.length > 1 && sceneMappingTiming().cycle;
    mapNote.textContent = sc.mappings.length > 1
      ? 'The one you pick plays and is the one you edit. A scene starts on 1.' + (paused ? ' Cycling waits while this menu is open.' : '')
      : 'How the piece sits on the room. + adds a copy to change.';
    // v40.5: change + cycle controls
    let many = sc.mappings.length > 1;
    let mt = sceneMappingTiming();
    changeRow.style.display = many ? 'flex' : 'none';
    cycleRow.style.display = many ? 'flex' : 'none';
    setActive(changeBtns.cut, mt.change === 'cut');
    setActive(changeBtns.fade, mt.change === 'fade');
    fadeBox.value = mt.fadeSec;
    fadeBox.style.visibility = fadeUnit.style.visibility = mt.change === 'fade' ? 'visible' : 'hidden';
    cycleBox.checked = mt.cycle;
    holdBox.value = mt.holdSec;
  }

  function refresh() {
    setActive(moveBtn, roomMoveEye);
    if (document.activeElement !== eyeCopySelect) refreshEyeCopy(); // v40.18
    rebuildMappingButtons(); // v40.2
    let m = activeMapping();
    setActive(flowBtns.up, m.flow !== 'down');
    setActive(flowBtns.down, m.flow === 'down');
    Object.keys(radBtns).forEach((k) => setActive(radBtns[k], m.radiate === k)); // v40.7
    let rad = m.radiate !== 'off'; // v40.9: alignment only while radiating
    alignBox.style.display = rad ? 'flex' : 'none';
    if (rad) rebuildAlignSliders(m); // v40.10
    // v40.11: the dropdown, and a wider panel while it's open
    let showAlign = rad && alignOpen;
    alignBody.style.display = showAlign ? 'flex' : 'none';
    alignToggle.textContent = (showAlign ? 'Edit alignment ▾' : 'Edit alignment ▸');
    setActive(alignToggle, false);
    panel.style.width = showAlign ? '440px' : '300px';
    refreshSurfaceTable(m); // v40.4
    roomOnly.forEach((el) => { el.style.display = roomView ? el.dataset.disp : 'none'; }); // v40.2
    if (viewSwitch) viewSwitch.refresh(); // v41.1: keep the top-bar switch in step
  }

  // v40.4: fill the surface table from the mapping (its geometry tells
  // each surface's real flow direction).
  function refreshSurfaceTable(m) {
    let geo = roomBuildGeometry(m);
    let radWords = radiateFlowWords(m); // v40.7 (null when not radiating)
    ROOM_FACE_NAMES.forEach((n) => {
      let row = surfRows[n], f = geo.faces.find((x) => x.name === n);
      row.centre.checked = m.hub === n;
      row.shownBox.checked = m.walls[n] !== false;
      let rev = m.reversed[n] === true;
      row.flowBtn.textContent = (rev ? '⇅ ' : '') + (radWords ? radWords[n] : flowWords(f.flowDir));
      row.flowBtn.style.overflow = 'hidden';
      row.flowBtn.style.textOverflow = 'ellipsis';
      Object.assign(row.flowBtn.style, {
        background: rev ? '#24425e' : '#222', color: '#fff',
        borderColor: rev ? '#8fc3ff' : '#555', opacity: m.walls[n] === false ? '0.45' : '1',
      });
      row.lab.style.fontWeight = m.hub === n ? 'bold' : 'normal';
      row.lab.style.opacity = m.walls[n] === false ? '0.5' : '1';
    });
  }
  function setVisible(visible) { wrapper.style.display = visible ? '' : 'none'; }

  refresh();
  return { refresh, setVisible, wrapper, isOpen }; // v41.4: + isOpen (the cycle waits while editing)
}

// The draggable eye: shown in Room view while "Move viewpoint" is on.
// Dragging moves the viewpoint within the room's open front.
function createRoomEyeMarker() {
  let m = document.createElement('div');
  m.textContent = '👁';
  m.title = 'Drag to move the viewpoint';
  Object.assign(m.style, {
    position: 'fixed', zIndex: 1060, width: '34px', height: '34px', borderRadius: '50%',
    display: 'none', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
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
    let o = roomGeom.opening;
    let clamp = (v) => Math.min(Math.max(v, ROOM_EYE_MARGIN), 1 - ROOM_EYE_MARGIN);
    setViewEye([clamp((cx - o.ox) / o.w), clamp((cy - o.oy) / o.h)]); // v40.2 (v40.17: shared or per mapping)
  });
  let end = () => { dragging = false; m.style.cursor = 'grab'; };
  m.addEventListener('pointerup', end);
  m.addEventListener('pointercancel', end);
  document.body.appendChild(m);
  return m;
}

function updateRoomEyeMarker() {
  if (!roomEyeMarker) return;
  let show = roomView && roomMoveEye && menuSystemVisible && !!roomGeom;
  roomEyeMarker.style.display = show ? 'flex' : 'none';
  if (!show) return;
  let r = drawingContext.canvas.getBoundingClientRect();
  let [x, y] = roomGeom.eyeScreen;
  roomEyeMarker.style.left = (r.left + x * (r.width / width) - 17) + 'px';
  roomEyeMarker.style.top = (r.top + y * (r.height / height) - 17) + 'px';
}

// v40.4: the person's 3D model (see figureMeshData() for the layout and the CC BY 4.0 credit).
