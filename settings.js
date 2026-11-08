// Gridburst settings core. Loaded first; every other file registers its own settings here.
//
//   GBSettings.define(key, spec)   register one setting (call at load time, before the menu opens)
//     key:  'tab.name', e.g. 'algo.mercy'. The part before the first dot must be a tab id (see TABS).
//     spec: { type, label, def, help?, group?, min?, max?, step?, unit?, options?, action?, hidden?, live? }
//       type 'toggle'  def true/false
//       type 'slider'  def number, min, max, step, unit ('%', 'ms', 'x', 'cells', ...)
//       type 'select'  def value, options [{ v, label }]
//       type 'text'    def string (e.g. a seed)
//       type 'button'  action: () => void   (no stored value; e.g. "Reset to original")
//       type 'custom'  render: (container) => void  (the menu calls it to draw a widget, e.g. a preview)
//       group: sub-heading inside the tab; settings keep the order they were defined in.
//   GBSettings.get(key)            current value (falls back to def; unknown key -> undefined)
//   GBSettings.set(key, v)         clamps/validates, saves, fires listeners
//   GBSettings.reset(key) / resetTab(tab) / resetAll()
//   GBSettings.on(key | 'tab.*' | '*', fn(value, key)) -> unsubscribe
//   GBSettings.tabs()              [{ id, label }] in menu order
//   GBSettings.specs(tab?)         [{ key, ...spec }] in definition order
//   GBSettings.exportAll() / importAll(json) / wipeAll()   every gridburst-* localStorage key
//   GBSettings.dragGeom(fx, fy, pw, ph, cell, opts?)  where a dragged piece sits for a finger at (fx, fy):
//     returns { cx, cy, size } = centre of the piece and its cell size. Shared by the game and the
//     settings preview so both behave the same. opts: { touch = true, k = 1 (pickup progress 0..1),
//     trayCell, x0, y0 (where the drag started; enables the movement gain) } .
//     Uses controls.offY/offX/scale/gainX/gainY and gameplay.leftHanded.
// Drag defaults were measured frame by frame from the recorded Block Blast run: the piece sits about
// 1.4 rows above the touch point, centred, at 1.05x board size, appears full size instantly, moves
// about 1.35x as far as the finger vertically (1.1x sideways), and snaps to a free spot within ~1 cell.
(() => {
'use strict';
const KEY = 'gridburst-settings-v1';
const TABS = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'algo', label: 'Piece algorithm' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'visuals', label: 'Visuals & blocks' },
  { id: 'effects', label: 'Effects' },
  { id: 'sound', label: 'Sound & haptics' },
  { id: 'controls', label: 'Controls' },
  { id: 'access', label: 'Accessibility' },
  { id: 'data', label: 'Data' },
];
const specs = new Map(), listeners = [];
let values = {};
try { values = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { values = {}; }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {} };
const tabOf = k => k.slice(0, k.indexOf('.'));

function clean(spec, v){
  switch (spec.type){
    case 'toggle': return !!v;
    case 'slider': {
      let n = Number(v); if (!isFinite(n)) return spec.def;
      n = Math.min(spec.max, Math.max(spec.min, n));
      if (spec.step) n = Math.round((n - spec.min) / spec.step) * spec.step + spec.min;
      return +n.toFixed(6);
    }
    case 'select': return spec.options.some(o => o.v === v) ? v : spec.def;
    case 'text': return String(v == null ? '' : v).slice(0, 200);
    default: return v;
  }
}
function fire(key, v){
  for (const l of listeners.slice()){
    if (l.k === '*' || l.k === key || (l.k.endsWith('.*') && key.startsWith(l.k.slice(0, -1)))){
      try { l.fn(v, key); } catch (e) { console.error(e); }
    }
  }
}
const api = {
  define(key, spec){
    if (!TABS.some(t => t.id === tabOf(key))) throw new Error('GBSettings: unknown tab in ' + key);
    specs.set(key, Object.assign({ group: '' }, spec));
    return api;
  },
  get(key){
    const s = specs.get(key); if (!s) return undefined;
    if (s.type === 'button' || s.type === 'custom') return undefined;
    return key in values ? clean(s, values[key]) : s.def;
  },
  set(key, v){
    const s = specs.get(key); if (!s || s.type === 'button' || s.type === 'custom') return;
    const c = clean(s, v);
    if (c === s.def) delete values[key]; else values[key] = c;
    persist(); fire(key, c);
  },
  reset(key){ const s = specs.get(key); if (s) api.set(key, s.def); },
  resetTab(tab){ for (const k of specs.keys()) if (tabOf(k) === tab) api.reset(k); },
  resetAll(){ for (const k of specs.keys()) api.reset(k); values = {}; persist(); },
  on(key, fn){ const l = { k: key, fn }; listeners.push(l); return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); }; },
  tabs: () => TABS.slice(),
  specs: tab => [...specs].filter(([k]) => !tab || tabOf(k) === tab).map(([key, s]) => Object.assign({ key }, s)),
  exportAll(){
    const out = {};
    try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.startsWith('gridburst-')) out[k] = localStorage.getItem(k); } } catch {}
    return JSON.stringify({ gridburst: 1, saved: new Date().toISOString(), data: out });
  },
  importAll(json){
    const o = JSON.parse(json);
    if (!o || o.gridburst !== 1 || typeof o.data !== 'object') throw new Error('Not a Gridburst backup');
    for (const [k, v] of Object.entries(o.data)) if (k.startsWith('gridburst-') && typeof v === 'string') localStorage.setItem(k, v);
  },
  wipeAll(){
    try { const ks = []; for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.startsWith('gridburst-')) ks.push(k); } ks.forEach(k => localStorage.removeItem(k)); } catch {}
    values = {};
  },
  dragGeom(fx, fy, pw, ph, cell, opts = {}){
    const touch = opts.touch !== false, k = opts.k == null ? 1 : opts.k;
    const scale = api.get('controls.scale') ?? 1;
    const tc = opts.trayCell || cell;
    const size = tc + (cell * scale - tc) * k;
    if (!touch) return { cx: fx, cy: fy, size };
    const mirror = api.get('gameplay.leftHanded') ? -1 : 1;
    const offX = (api.get('controls.offX') ?? 0) * cell * mirror;
    const offY = (api.get('controls.offY') ?? 1.4) * cell;
    // gain: the piece travels further than the finger, measured from where the drag started
    const gx = api.get('controls.gainX') ?? 1.1, gy = api.get('controls.gainY') ?? 1.35;
    const x = opts.x0 == null ? fx : opts.x0 + (fx - opts.x0) * gx;
    const y = opts.y0 == null ? fy : opts.y0 + (fy - opts.y0) * gy;
    // offY: gap in board cells between the finger and the piece's bottom edge
    return { cx: x + offX * k, cy: y - (offY + ph * size / 2) * k, size };
  },
};
window.GBSettings = api;

// Presets, defined first so they sit at the top of the Gameplay tab. Every default in every file is
// set to match the original game as closely as we know it; "Gridburst extras" turns on the parts we
// added on top (random skins, combo glow, music, a dealer that helps more).
const EXTRAS = {
  'visuals.mix': 'piece', 'visuals.breathe': 0.25, 'gameplay.boardGlow': true, 'gameplay.comboBadge': true,
  'gameplay.awayFromBest': true, 'effects.rings': true, 'sound.music': 0.35,
  'algo.chainAssist': 0.8, 'algo.nearMiss': 0.6, 'algo.allClear': 0.25, 'algo.cycle': true,
};
api.define('gameplay.presetOriginal', { type: 'button', group: 'Preset', label: 'Match the original game', help: 'Puts every setting back to the values closest to the original game. Same as Reset all.', action: () => api.resetAll() });
api.define('gameplay.presetExtras', { type: 'button', group: 'Preset', label: 'Gridburst extras', help: 'Random skin per piece, combo glow, music, and a dealer that keeps combos alive and sets up near-misses and big clears.', action: () => { for (const [k, v] of Object.entries(EXTRAS)) api.set(k, v); } });

// Drag controls live here because dragGeom reads them. Defaults are replaced by the values measured
// from the recorded Block Blast run once they are known.
api.define('controls.offY', { type: 'slider', group: 'Dragging', label: 'Lift above finger', def: 1.4, min: 0, max: 5, step: 0.05, unit: 'cells', help: 'Gap between your finger and the bottom of the dragged piece.' });
api.define('controls.offX', { type: 'slider', group: 'Dragging', label: 'Sideways offset', def: 0, min: -3, max: 3, step: 0.05, unit: 'cells', help: 'Moves the piece left or right of your finger. Mirrored in left-handed mode.' });
api.define('controls.scale', { type: 'slider', group: 'Dragging', label: 'Pickup size', def: 1.05, min: 0.6, max: 1.3, step: 0.01, unit: 'x', help: 'Size of the dragged piece compared with a board cell.' });
api.define('controls.grow', { type: 'slider', group: 'Dragging', label: 'Pickup grow time', def: 0, min: 0, max: 600, step: 10, unit: 'ms', help: 'How long the piece takes to grow from tray size to board size.' });
api.define('controls.gainY', { type: 'slider', group: 'Dragging', label: 'Vertical speed', def: 1.35, min: 0.5, max: 2.5, step: 0.05, unit: 'x', help: 'How far the piece moves up and down for each bit of finger movement. The original moves it about 1.35x.' });
api.define('controls.gainX', { type: 'slider', group: 'Dragging', label: 'Sideways speed', def: 1.1, min: 0.5, max: 2.5, step: 0.05, unit: 'x' });
api.define('controls.original', { type: 'button', group: 'Dragging', label: 'Reset to original', action: () => ['controls.offY', 'controls.offX', 'controls.scale', 'controls.grow', 'controls.snap', 'controls.gainY', 'controls.gainX'].forEach(api.reset) });
api.define('controls.snap', { type: 'slider', group: 'Dragging', label: 'Snap strength', def: 0.5, min: 0, max: 1, step: 0.05, help: 'At 0 the piece lands exactly under itself. Higher values pull it to the nearest spot where it fits.' });
})();
