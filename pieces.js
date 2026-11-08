// Gridburst piece selection. Pure logic, no DOM: the game calls GBPieces.newSet() whenever the
// tray is empty and assigns colours itself.
//   GBPieces.init()                  -> mem, a JSON-serialisable object the game saves and passes back
//   GBPieces.newSet(grid, mem, info) -> three pieces [{ s, cells, w, h }]
//     grid: 8x8 array, -1 = empty, >= 0 = filled
//     info: { score, best, chain?, quiet?, placed? }  chain = current combo chain (0 = none), quiet =
//           non-clearing placements since the last clear (0-2), placed = placements this game.
//           Missing fields count as 0, and old saved mem objects are repaired on load.
//
// Modelled on how Block Blast deals, minus its deliberately unplaceable "death" sets. Built to be
// generous and moreish, never adversarial. Every knob is a setting under Piece algorithm (tab 'algo').
//  1. Base pool: every rotation is its own shape with near-even weights, scaled by a big/small
//     bias and by mercy, which grows as the board fills (small pieces likelier, 6+ cells rarer).
//  2. Clear assist: a share of deals look for placements that complete rows/columns (multi-line
//     clears preferred) or exactly fill an enclosed hole, often chaining: piece 2 clears again on
//     the board piece 1 leaves, and so on.
//  3. Setups: two or three pieces that exactly fill the gaps of two to four lines, so playing them
//     clears them all, often at once. On a light board late enough for the all-clear bonus it can
//     look for a set that empties the board.
//  4. Moments: rescue sets above a fill threshold (small pieces, the most cells cleared); a
//     tension/relief cycle (a few slightly leaner trays on a light board, then a big-clear set);
//     near-misses (sets whose likely play leaves a line one or two cells short, and the next tray
//     leans towards finishing it); chain keeping (when a combo is about to die, the set holds a
//     clear you can play right away).
//  5. Choosing: candidate sets are scored by a short beam search over every order (clears,
//     multi-line clears, combo chain kept or lost, how rough the board is after) and by a model of
//     a player who does not plan ahead (a few quick random-ish plays: does the whole set fit, how
//     much clears, is the combo kept, are lines left nearly done). On a crowded board mercy leans
//     hard on "fits however you play it". The best one is usually dealt; far past your best the
//     dealer judges less and less often.
//  6. Variety: shapes from the last two sets and repeats inside a set are damped, with a cap on the
//     same family per set. Families can be switched off (one always stays on).
//  7. Difficulty: from a share of your best score onward (and in very long games), big pieces get
//     likelier and the help backs off. A difficulty slider scales all of it.
//  8. Guarantee: every set is checked with an exact search (all orders, all positions, line clears
//     included). If none fits, it retries with small pieces, builds a set piece by piece on a
//     simulated board, and finally searches every combination (switched-off families included), so
//     an unplaceable set is only dealt when no placeable set exists at all.
//  Randomness comes from Math.random, or from a seeded generator when algo.seed is set (the seed,
//  the deal number and the board together decide the deal, so a replay is reproducible).
(() => {
'use strict';
const N = 8;
// [pattern, base weight, family]; rows split by '/'. Order matches the previous version, so ids stay stable.
const SHAPE_DEFS = [
  ['1',.55,'dot'],['11',.9,'i2'],['1/1',.9,'i2'],['111',1,'i3'],['1/1/1',1,'i3'],['1111',.95,'i4'],['1/1/1/1',.95,'i4'],['11111',.8,'i5'],['1/1/1/1/1',.8,'i5'],
  ['11/11',1.15,'o2'],['111/111/111',.6,'o3'],['111/111',.65,'r6'],['11/11/11',.65,'r6'],
  ['10/11',1,'v3'],['01/11',1,'v3'],['11/10',1,'v3'],['11/01',1,'v3'],
  ['10/10/11',.75,'l4'],['01/01/11',.75,'l4'],['11/10/10',.75,'l4'],['11/01/01',.75,'l4'],
  ['111/100',.75,'l4'],['111/001',.75,'l4'],['100/111',.75,'l4'],['001/111',.75,'l4'],
  ['100/100/111',.8,'l5'],['001/001/111',.8,'l5'],['111/100/100',.8,'l5'],['111/001/001',.8,'l5'],
  ['111/010',.85,'t4'],['010/111',.85,'t4'],['10/11/10',.85,'t4'],['01/11/01',.85,'t4'],
  ['011/110',.75,'s4'],['110/011',.75,'s4'],['10/11/01',.75,'s4'],['01/11/10',.75,'s4'],
];
function parse(s){
  const rows = s.split('/'), cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '1') cells.push([r, c]); }));
  return { cells, h: rows.length, w: rows[0].length };
}
const SHAPES = SHAPE_DEFS.map(([s, wt, fam], id) => {
  const p = parse(s);
  return { ...p, wt, fam, id, n: p.cells.length, fat: p.cells.length === p.w * p.h && p.w > 1 && p.h > 1 };
});
const NS = SHAPES.length;
const FAMS = ['dot', 'i2', 'i3', 'i4', 'i5', 'o2', 'o3', 'r6', 'v3', 'l4', 'l5', 't4', 's4'];
const FAM_LABEL = { dot: 'Single dot', i2: 'Bar of 2', i3: 'Bar of 3', i4: 'Bar of 4', i5: 'Bar of 5', o2: 'Square 2×2', o3: 'Square 3×3',
  r6: 'Rectangle 2×3', v3: 'Small corner (3)', l4: 'L shape (4)', l5: 'Big corner (5)', t4: 'T shape (4)', s4: 'S / Z shape (4)' };

// ---------- settings ----------
// [key under 'algo.', spec]. Defaults are the recommended values ("Reset algorithm to recommended").
const SPECS = [
  ['difficulty', { type: 'slider', group: 'Difficulty', label: 'Difficulty', def: 0.5, min: 0, max: 1, step: 0.05,
    help: '0 = always relaxed, 0.5 = recommended, 1 = hard from the start.' }],
  ['followBest', { type: 'toggle', group: 'Difficulty', label: 'Difficulty follows best score', def: true,
    help: 'As your score nears and passes your best, pieces get a little bigger and the help backs off.' }],
  ['rampStart', { type: 'slider', group: 'Difficulty', label: 'Challenge starts at', def: 70, min: 30, max: 150, step: 5, unit: '%',
    help: 'Share of your best score at which the challenge starts to rise.' }],
  ['longGame', { type: 'toggle', group: 'Difficulty', label: 'Long-game ramp', def: true,
    help: 'Very long games slowly tighten on their own.' }],
  ['longGameStart', { type: 'slider', group: 'Difficulty', label: 'Long-game ramp starts after', def: 100, min: 20, max: 500, step: 10, unit: 'trays',
    help: 'Number of trays before the long-game ramp begins.' }],

  ['mercy', { type: 'slider', group: 'Mercy & rescue', label: 'Mercy strength', def: 0.6, min: 0, max: 1, step: 0.05,
    help: 'How much smaller the pieces get and how much more help you get when the board is crowded.' }],
  ['mercyGrowth', { type: 'slider', group: 'Mercy & rescue', label: 'Mercy grows with fill', def: 0.85, min: 0, max: 1, step: 0.05,
    help: '0 = the same mercy on any board, 1 = mercy only kicks in as the board fills up.' }],
  ['rescueAt', { type: 'slider', group: 'Mercy & rescue', label: 'Rescue threshold', def: 55, min: 30, max: 100, step: 1, unit: '%',
    help: 'Board fill at which a rescue set (small pieces that clear the most) is dealt. 100 = never.' }],

  ['assist', { type: 'slider', group: 'Clears & combos', label: 'Clear-assist chance', def: 0.65, min: 0, max: 1, step: 0.05,
    help: 'Share of deals built around pieces that complete a row or column.' }],
  ['multiLine', { type: 'slider', group: 'Clears & combos', label: 'Multi-line clear preference', def: 0.65, min: 0, max: 1, step: 0.05,
    help: 'How strongly the dealer prefers sets that clear two or more lines at once.' }],
  ['chainAssist', { type: 'slider', group: 'Clears & combos', label: 'Chain assist', def: 0, min: 0, max: 1, step: 0.05,
    help: 'When a combo is about to die, how often the next set holds a clear you can play right away.' }],
  ['nearMiss', { type: 'slider', group: 'Clears & combos', label: 'Near-miss rate', def: 0, min: 0, max: 1, step: 0.05,
    help: 'Share of sets that leave a line one or two cells short; the next tray leans towards finishing it.' }],
  ['allClear', { type: 'slider', group: 'Clears & combos', label: 'All-clear setups', def: 0, min: 0, max: 1, step: 0.05,
    help: 'Chance, on a light board from the 6th tray on, to deal a set that can empty the whole board.' }],
  ['gapFill', { type: 'slider', group: 'Clears & combos', label: 'Gap-fill strength', def: 0.7, min: 0, max: 1, step: 0.05,
    help: 'How strongly assisted sets favour pieces that exactly plug an enclosed hole.' }],
  ['polish', { type: 'slider', group: 'Clears & combos', label: 'Set polish', def: 0.8, min: 0, max: 1, step: 0.05,
    help: 'How often the most fun of several candidate sets is dealt instead of the first one drawn.' }],

  ['cycle', { type: 'toggle', group: 'Pacing', label: 'Tension / relief cycle', def: false,
    help: 'A few leaner trays on a light board build up lines, then a big-clear set arrives.' }],
  ['cycleLen', { type: 'slider', group: 'Pacing', label: 'Cycle length', def: 5, min: 2, max: 12, step: 1, unit: 'trays',
    help: 'Trays from one relief set to the next.' }],
  ['cycleAmp', { type: 'slider', group: 'Pacing', label: 'Cycle strength', def: 0.5, min: 0, max: 1, step: 0.05,
    help: 'How much the tension trays hold back help. The relief set comes either way.' }],

  ['sizeBias', { type: 'slider', group: 'Piece mix', label: 'Big ↔ small pieces', def: 0, min: -1, max: 1, step: 0.05,
    help: 'Negative = more small pieces, positive = more big pieces.' }],
  ['variety', { type: 'slider', group: 'Piece mix', label: 'Variety (anti-repeat)', def: 0.5, min: 0, max: 1, step: 0.05,
    help: 'How strongly shapes from the last two sets, and repeats within a set, are avoided.' }],
  ['maxFamily', { type: 'slider', group: 'Piece mix', label: 'Max same family per set', def: 2, min: 1, max: 3, step: 1,
    help: 'Most pieces of one shape family (e.g. any L) in one set.' }],
];
const SPEC_OF = new Map(SPECS);
const DEF = {};
for (const [k, s] of SPECS) DEF[k] = s.def;
for (const f of FAMS) DEF['fam.' + f] = true;
DEF.seed = '';

let registered = false;
function register(){
  const G = typeof window !== 'undefined' && window.GBSettings;
  if (registered || !G || typeof G.define !== 'function') return;
  registered = true;
  try {
    for (const [k, s] of SPECS) G.define('algo.' + k, s);
    for (const f of FAMS) G.define('algo.fam.' + f, { type: 'toggle', group: 'Shapes', label: FAM_LABEL[f], def: true,
      help: 'Include this shape in deals. At least one family always stays on.' });
    G.define('algo.seed', { type: 'text', group: 'Randomness', label: 'Seed', def: '',
      help: 'Empty = random. Any text = the same deals for the same moves (handy for replays and tests).' });
    G.define('algo.reset', { type: 'button', group: 'Randomness', label: 'Reset algorithm to recommended',
      help: 'Puts every piece-algorithm setting back to its recommended value.',
      action: () => { if (typeof G.resetTab === 'function') G.resetTab('algo'); else for (const k in DEF) G.reset && G.reset('algo.' + k); } });
    // never let the last shape family be switched off
    if (typeof G.on === 'function') G.on('algo.*', (v, key) => {
      if (typeof key === 'string' && key.startsWith('algo.fam.') && v === false && FAMS.every(f => !G.get('algo.fam.' + f))) G.set(key, true);
    });
  } catch (e) { if (typeof console !== 'undefined') console.error(e); }
}
register();
// Current settings, clamped; defaults when GBSettings is missing (Node tests).
function cfg(){
  register();
  const G = typeof window !== 'undefined' && window.GBSettings, c = {};
  for (const k in DEF){
    let v;
    if (G && typeof G.get === 'function'){ try { v = G.get('algo.' + k); } catch (e) { v = undefined; } }
    if (typeof v !== typeof DEF[k] || (typeof v === 'number' && !isFinite(v))) v = DEF[k];
    const s = SPEC_OF.get(k);
    if (s && s.type === 'slider') v = v < s.min ? s.min : v > s.max ? s.max : v;
    c[k] = v;
  }
  return c;
}

// ---------- randomness ----------
let rnd = Math.random;
function mulberry(a){
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// ---------- bitboards ----------
// The board is two int32 words: lo = rows 0-3, hi = rows 4-7, bit (r % 4) * 8 + c.
const ROW_LO = [], ROW_HI = [], COL = [];
for (let r = 0; r < N; r++){ ROW_LO.push(r < 4 ? (0xFF << (8 * r)) | 0 : 0); ROW_HI.push(r >= 4 ? (0xFF << (8 * (r - 4))) | 0 : 0); }
for (let c = 0; c < N; c++) COL.push((0x01010101 << c) | 0);
const LINES = [];
for (let r = 0; r < N; r++) LINES.push([ROW_LO[r], ROW_HI[r]]);
for (let c = 0; c < N; c++) LINES.push([COL[c], COL[c]]);
// PL[s]: every position of shape s as [lo, hi, row, col] runs.
const PL = SHAPES.map(sh => {
  const out = [];
  for (let r = 0; r <= N - sh.h; r++) for (let c = 0; c <= N - sh.w; c++){
    let lo = 0, hi = 0;
    for (const [dr, dc] of sh.cells){ const k = (r + dr) * N + c + dc; if (k < 32) lo |= 1 << k; else hi |= 1 << (k - 32); }
    out.push(lo | 0, hi | 0, r, c);
  }
  return Int32Array.from(out);
});
function pc(x){
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
}
const ctz = x => 31 - Math.clz32(x & -x);
// FIRST[k]: [lo, hi, shape, position index, ...] for every placement whose lowest cell is k.
const FIRST = (() => {
  const a = Array.from({ length: 64 }, () => []);
  PL.forEach((P, s) => { for (let i = 0; i < P.length; i += 4) a[P[i] ? ctz(P[i]) : 32 + ctz(P[i + 1])].push(P[i], P[i + 1], s, i); });
  return a.map(x => Int32Array.from(x));
})();
// put() writes its result here: board after placing and clearing, and the lines cleared.
let oLo = 0, oHi = 0, oLines = 0;
function put(lo, hi, s, i){
  const P = PL[s], sh = SHAPES[s], r = P[i + 2], c = P[i + 3];
  const nlo = lo | P[i], nhi = hi | P[i + 1];
  let clo = 0, chi = 0, lines = 0;
  for (let y = r; y < r + sh.h; y++){ const a = ROW_LO[y], b = ROW_HI[y]; if ((nlo & a) === a && (nhi & b) === b){ clo |= a; chi |= b; lines++; } }
  for (let x = c; x < c + sh.w; x++){ const m = COL[x]; if ((nlo & m) === m && (nhi & m) === m){ clo |= m; chi |= m; lines++; } }
  oLo = nlo & ~clo; oHi = nhi & ~chi; oLines = lines;
}
function anyFit(lo, hi, s){
  const P = PL[s];
  for (let i = 0; i < P.length; i += 4) if (!(lo & P[i]) && !(hi & P[i + 1])) return true;
  return false;
}
// Exact: can these pieces all be placed in some order, counting line clears between placements?
function solvable(lo, hi, ids){
  if (ids.length === 1) return anyFit(lo, hi, ids[0]);
  for (let k = 0; k < ids.length; k++){
    const s = ids[k];
    if (ids.indexOf(s) !== k) continue;                       // same shape twice: one order is enough
    const rest = ids.filter((_, j) => j !== k), P = PL[s];
    if (rest.length === 1){
      const o = rest[0], oFits = anyFit(lo, hi, o);
      for (let i = 0; i < P.length; i += 4){
        if ((lo & P[i]) || (hi & P[i + 1])) continue;
        put(lo, hi, s, i);
        if (!oFits && !oLines) continue;                      // nothing freed, still no room
        if (anyFit(oLo, oHi, o)) return true;
      }
    } else {
      for (let i = 0; i < P.length; i += 4){
        if ((lo & P[i]) || (hi & P[i + 1])) continue;
        put(lo, hi, s, i);
        if (solvable(oLo, oHi, rest)) return true;
      }
    }
  }
  return false;
}
// Enclosed empty pockets (4-connected empty regions of 1-5 cells) as [lo, hi] masks.
function holes(lo, hi){
  const out = [], seen = new Uint8Array(64), st = [];
  for (let k0 = 0; k0 < 64; k0++){
    if (seen[k0] || (k0 < 32 ? (lo >>> k0) & 1 : (hi >>> (k0 - 32)) & 1)) continue;
    let mlo = 0, mhi = 0, n = 0;
    seen[k0] = 1; st.push(k0);
    while (st.length){
      const k = st.pop(); n++;
      if (k < 32) mlo |= 1 << k; else mhi |= 1 << (k - 32);
      const r = k >> 3, c = k & 7;
      const nb = [r > 0 ? k - 8 : -1, r < 7 ? k + 8 : -1, c > 0 ? k - 1 : -1, c < 7 ? k + 1 : -1];
      for (const q of nb){
        if (q < 0 || seen[q] || (q < 32 ? (lo >>> q) & 1 : (hi >>> (q - 32)) & 1)) continue;
        seen[q] = 1; st.push(q);
      }
    }
    if (n <= 5) out.push(mlo | 0, mhi | 0);
  }
  return out;
}
// Lines (rows + columns) that are one or two cells short of complete.
function nearLines(lo, hi){
  let k = 0;
  for (let l = 0; l < 16; l++){ const e = 8 - pc(lo & LINES[l][0]) - pc(hi & LINES[l][1]); if (e === 1 || e === 2) k++; }
  return k;
}

// Exact cell mask -> shapes that cover exactly those cells (for "one piece finishes two lines").
const PMAP = new Map();
PL.forEach((P, s) => { for (let i = 0; i < P.length; i += 4){ const k = P[i] + ',' + P[i + 1]; if (!PMAP.has(k)) PMAP.set(k, []); PMAP.get(k).push(s); } });
// How many pairs of lines a single (enabled) piece could finish at once on this board.
function multiPot(lo, hi, famOn){
  const e = [];
  for (let l = 0; l < 16; l++){
    const elo = LINES[l][0] & ~lo, ehi = LINES[l][1] & ~hi, n = pc(elo) + pc(ehi);
    if (n && n <= 5) e.push(elo, ehi);
  }
  let k = 0;
  for (let a = 0; a < e.length; a += 2) for (let b = a + 2; b < e.length; b += 2){
    const ulo = e[a] | e[b], uhi = e[a + 1] | e[b + 1];
    if (pc(ulo) + pc(uhi) > 9) continue;
    const ss = PMAP.get(ulo + ',' + uhi);
    if (ss && ss.some(x => famOn[x])) k++;
  }
  return k;
}

// ---------- weights ----------
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
// Per-size multiplier for mercy m (0..2), difficulty d (0..2; above 1 is "far past your best" or a
// very long game, where the crowded-board protection also weakens) and the big/small bias.
function sizeFactors(m, d, bias){
  const a = m * (d > 1 ? 1 - 0.45 * (d - 1) : 1);
  const out = [];
  for (let n = 0; n <= 9; n++){
    let x = 1;
    if (n <= 3) x *= 1 + 1.2 * a;
    else if (n === 4) x *= Math.max(0.1, 1 - 0.1 * a);
    else if (n === 5) x *= Math.max(0.05, 1 - 0.45 * a);
    else x *= Math.max(0.03, 1 - 0.85 * a);
    if (n >= 5) x *= 1 + 1.5 * d; else if (n <= 2) x *= Math.max(0.2, 1 - 0.45 * d); else if (d > 1) x *= 1 - 0.3 * (d - 1);
    x *= Math.exp(bias * 0.35 * (n - 4));
    out.push(x);
  }
  return out;
}
function shapeWeight(sh, ctx, picked, rescue){
  if (!ctx.famOn[sh.id]) return 0;
  let x = sh.wt * ctx.sizeF[sh.n] * (sh.fat ? ctx.fatF : 1);   // squares/rectangles fill two lines at once
  if (ctx.last.includes(sh.id)) x *= ctx.vLast; else if (ctx.prev.includes(sh.id)) x *= ctx.vPrev;
  let fam = 0;
  for (const q of picked){ if (q === sh.id) x *= ctx.vDup; if (SHAPES[q].fam === sh.fam) fam++; }
  if (fam >= ctx.maxFam) return 0;
  if (fam) x *= ctx.vFam;
  if (rescue) x *= sh.n >= 5 ? 0.12 : sh.n === 4 ? 0.6 : 2;
  return x;
}
function pickW(items, w, tot){
  let x = rnd() * tot;
  for (let i = 0; i < items.length; i++){ x -= w[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}
function drawShape(ctx, picked, rescue){
  const w = [], ids = [];
  let tot = 0;
  for (const sh of SHAPES){ const x = shapeWeight(sh, ctx, picked, rescue); if (x > 0){ ids.push(sh.id); w.push(x); tot += x; } }
  if (!ids.length){         // the variety cap or the family switches left nothing: relax them
    for (const sh of SHAPES) if (ctx.famOn[sh.id]){ ids.push(sh.id); w.push(sh.wt); tot += sh.wt; }
    if (!ids.length) for (const sh of SHAPES){ ids.push(sh.id); w.push(sh.wt); tot += sh.wt; }
  }
  return pickW(ids, w, tot);
}
// Pieces that complete a line (or exactly fill a pocket) on this board, each with its best position.
function assistCands(lo, hi, ctx, picked, rescue){
  const hs = ctx.gap > 0 ? holes(lo, hi) : [], ids = [], pos = [], w = [];
  let tot = 0;
  for (let s = 0; s < NS; s++){
    const sw = shapeWeight(SHAPES[s], ctx, picked, rescue);
    if (sw <= 0) continue;
    const P = PL[s];
    let bv = 0, bi = -1, ties = 0;
    for (let i = 0; i < P.length; i += 4){
      if ((lo & P[i]) || (hi & P[i + 1])) continue;
      put(lo, hi, s, i);
      let v = 0;
      if (oLines){
        v = ctx.lineV[Math.min(oLines, 5)];
        if (!(oLo & P[i]) && !(oHi & P[i + 1])) v *= 1.6;    // every cell of the piece went away
      }
      for (let h = 0; h < hs.length; h += 2) if (hs[h] === P[i] && hs[h + 1] === P[i + 1]){ v = Math.max(v, 2 * ctx.gap) * (1 + 2 * ctx.gap); break; }
      if (v > bv){ bv = v; bi = i; ties = 1; }
      else if (v > 0 && v === bv && rnd() * ++ties < 1) bi = i;
    }
    if (bi >= 0){ ids.push(s); pos.push(bi); w.push(sw * bv * bv); tot += sw * bv * bv; }
  }
  return { ids, pos, w, tot };
}

// ---------- setups ----------
const PERM = [[[0]], [[0, 1], [1, 0]], [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]];
// Groups of two to four lines whose empty cells one to three pieces fill exactly, so playing them
// clears every line of the group (allClear: the group covers every filled cell, so the board ends
// empty). Each result: { ids, pos, ord (best order), v }. Budgeted, so it stays fast on any board.
function setups(lo, hi, ctx, allClear){
  const out = [], w = [];
  let tot = 0, budget = allClear ? 3500 : 2500;
  const cand = [];
  for (let l = 0; l < 16; l++){
    const elo = LINES[l][0] & ~lo, ehi = LINES[l][1] & ~hi, e = pc(elo) + pc(ehi);
    if (e && e <= (allClear ? 7 : 6)) cand.push(l, elo | 0, ehi | 0);
  }
  for (let j = cand.length / 3 - 1; j > 0; j--){    // random line order, so a spent budget has no bias
    const r = (rnd() * (j + 1) | 0) * 3, a = j * 3;
    for (let t = 0; t < 3; t++){ const x = cand[a + t]; cand[a + t] = cand[r + t]; cand[r + t] = x; }
  }
  const maxL = allClear ? 4 : 3, maxCells = allClear ? 15 : 13, minL = allClear ? 1 : 2;
  const sw0 = SHAPES.map(sh => shapeWeight(sh, ctx, [], false));
  const pk = [];
  function emit(){
    const m = pk.length >> 1, ids = [];
    let wt = 1;
    for (let j = 0; j < m; j++){ const x = shapeWeight(SHAPES[pk[2 * j]], ctx, ids, false); if (x <= 0) return; wt *= x; ids.push(pk[2 * j]); }
    let bv = 0, bo = null;
    for (const ord of PERM[m - 1]){
      let a = lo, b = hi, v = 0, prev = 0, cs = 0;
      for (const j of ord){
        put(a, b, pk[2 * j], pk[2 * j + 1]); a = oLo; b = oHi;
        if (oLines){ v += ctx.lineV[Math.min(oLines, 5)] + (prev ? 2 : 0); prev = 1; cs++; } else prev = 0;
      }
      if (allClear && (a || b)) continue;
      if (cs === m) v *= allClear ? 3 : 1.5;   // every piece clears as it lands: easy to see, keeps the combo
      if (v > bv){ bv = v; bo = ord; }
    }
    if (!bo || (!allClear && bv < ctx.lineV[2])) return;
    if (allClear) bv += 20;
    out.push({ ids, pos: Array.from({ length: m }, (_, j) => pk[2 * j + 1]), ord: bo, v: bv });
    w.push(wt * bv); tot += wt * bv;
  }
  function tile(elo, ehi){
    if (!elo && !ehi){ emit(); return; }
    if (pk.length === 6 || --budget <= 0 || out.length >= 80) return;
    const nelo = ~elo, nehi = ~ehi, F = FIRST[elo ? ctz(elo) : 32 + ctz(ehi)];
    for (let f = 0; f < F.length; f += 4){
      if ((F[f] & nelo) || (F[f + 1] & nehi) || sw0[F[f + 2]] <= 0) continue;
      pk.push(F[f + 2], F[f + 3]); tile(elo & ~F[f], ehi & ~F[f + 1]); pk.length -= 2;
    }
  }
  // Groups of exactly `size` lines (small groups first, so the budget never starves them).
  function rec(start, depth, size, ulo, uhi, mlo, mhi){
    if (depth === size){ if (!allClear || (!(lo & ~mlo) && !(hi & ~mhi))) tile(ulo, uhi); return; }
    for (let j = start; j < cand.length && budget > 0; j += 3){
      const nlo = ulo | cand[j + 1], nhi = uhi | cand[j + 2];
      if (pc(nlo) + pc(nhi) > maxCells) continue;
      const l = cand[j];
      rec(j + 3, depth + 1, size, nlo, nhi, mlo | LINES[l][0], mhi | LINES[l][1]);
    }
  }
  for (let size = minL; size <= maxL && budget > 0; size++) rec(0, 0, size, 0, 0, 0, 0);
  return { out, w, tot };
}

// ---------- building a set ----------
function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = rnd() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
// chain: how many pieces in a row should be picked to clear on the simulated board (0 = none).
// setup: open with a multi-line setup ('m') or an all-clear setup ('a') when one exists.
function buildSet(ctx, chain, rescue, setup){
  const set = [];
  let lo = ctx.lo, hi = ctx.hi;
  const key = rescue ? 'r' : 'n';
  if (setup){
    const ck = 's' + setup + key;
    const all = ctx[ck] || (ctx[ck] = setups(lo, hi, ctx, setup === 'a'));
    if (all.out.length){
      const t = pickW(all.out, all.w, all.tot);
      for (const j of t.ord){ set.push(t.ids[j]); put(lo, hi, t.ids[j], t.pos[j]); lo = oLo; hi = oHi; }
    }
  }
  // The first assist step only depends on the real board, so its candidates are worked out once per deal.
  for (let k = set.length; k < chain; k++){
    const c = k ? assistCands(lo, hi, ctx, set, rescue) : ctx['a' + key] || (ctx['a' + key] = assistCands(lo, hi, ctx, set, rescue));
    if (!c.ids.length) break;
    const j = c.ids.indexOf(pickW(c.ids, c.w, c.tot));
    set.push(c.ids[j]);
    put(lo, hi, c.ids[j], c.pos[j]); lo = oLo; hi = oHi;
  }
  while (set.length < 3) set.push(drawShape(ctx, set, rescue));
  return shuffle(set);
}
// Before calling the board jammed: pick small pieces one at a time, each one placed on the
// simulated board (clearing where it can) before the next is chosen.
function construct(ctx){
  for (let t = 0; t < 8; t++){
    const set = [];
    let lo = ctx.lo, hi = ctx.hi;
    while (set.length < 3){
      const ids = [], w = [];
      let tot = 0;
      for (const sh of SHAPES){
        if (sh.n > 4 || !anyFit(lo, hi, sh.id)) continue;
        // the last tries may break the variety rule or the family switches (e.g. three dots) rather than end the game
        const x = (shapeWeight(sh, ctx, set, true) || (t >= 6 ? 0.05 * sh.wt : 0)) * (t >= 4 ? 1 / sh.n : 1);
        if (x > 0){ ids.push(sh.id); w.push(x); tot += x; }
      }
      if (!ids.length) break;
      const s = pickW(ids, w, tot), P = PL[s];
      let bi = -1, bl = -1;
      for (let i = 0; i < P.length; i += 4){
        if ((lo & P[i]) || (hi & P[i + 1])) continue;
        put(lo, hi, s, i);
        if (oLines > bl || (oLines === bl && rnd() < 0.3)){ bl = oLines; bi = i; }
      }
      set.push(s); put(lo, hi, s, bi); lo = oLo; hi = oHi;
    }
    if (set.length === 3) return shuffle(set);
  }
  return null;
}
// Exhaustive last resort: every combination of shapes that fit at all, smallest first. Finds a
// placeable set whenever one exists.
function exhaustive(ctx){
  const fit = SHAPES.filter(sh => anyFit(ctx.lo, ctx.hi, sh.id)).sort((a, b) => a.n - b.n || (ctx.famOn[b.id] - ctx.famOn[a.id])).map(sh => sh.id);
  for (let a = 0; a < fit.length; a++) for (let b = a; b < fit.length; b++) for (let c = b; c < fit.length; c++){
    const set = [fit[a], fit[b], fit[c]];
    if (solvable(ctx.lo, ctx.hi, set)) return shuffle(set);
  }
  return null;
}

// ---------- judging a set ----------
// How rough a board is: edges between filled and empty cells plus isolated empty cells.
function rough(lo, hi){
  let t = pc((lo ^ (lo >>> 1)) & 0x7F7F7F7F) + pc((hi ^ (hi >>> 1)) & 0x7F7F7F7F);
  t += pc((lo ^ (lo >>> 8)) & 0x00FFFFFF) + pc((hi ^ (hi >>> 8)) & 0x00FFFFFF) + pc(((lo >>> 24) ^ hi) & 0xFF);
  const iso = pc(~lo & (((lo << 1) & 0xFEFEFEFE) | 0x01010101) & (((lo >>> 1) & 0x7F7F7F7F) | 0x80808080) & ((lo << 8) | 0xFF) & ((lo >>> 8) | (hi << 24)))
            + pc(~hi & (((hi << 1) & 0xFEFEFEFE) | 0x01010101) & (((hi >>> 1) & 0x7F7F7F7F) | 0x80808080) & ((hi << 8) | (lo >>> 24)) & ((hi >>> 8) | 0xFF000000));
  return t + iso * 5;
}
const ORDERS = PERM[2];
// Short beam search over every order (line clears included). Rewards clears, multi-line clears and
// a combo chain kept alive, penalises a chain lost, then a rough board. Returns the best line of
// play: { v, lines, maxL, clears, K, lo, hi }.
function evalSet(lo0, hi0, set, ctx){
  let best = null;
  const seen = [];
  for (const ord of ORDERS){
    const sig = set[ord[0]] * 4096 + set[ord[1]] * 64 + set[ord[2]];
    if (seen.includes(sig)) continue;
    seen.push(sig);
    // lo, hi, fun, chain K, quiet, lines, max lines in one placement, clears, rank
    let beam = [[lo0, hi0, 0, ctx.chain0, ctx.quiet0, 0, 0, 0, 0]];
    for (const j of ord){
      const s = set[j], P = PL[s], top = [];
      for (const st of beam){
        for (let i = 0; i < P.length; i += 4){
          if ((st[0] & P[i]) || (st[1] & P[i + 1])) continue;
          put(st[0], st[1], s, i);
          let fun = st[2], K = st[3], q = st[4];
          if (oLines){
            K++; q = 0;
            fun += 2 + ctx.mlW * oLines * oLines + (K >= 2 ? ctx.chW * Math.min(K, 6) / 3 : 0);
          } else if (++q > 2){
            if (K) fun -= ctx.deathW * Math.min(K, 6);
            K = 0; q = 0;
          }
          const rank = fun * 10 - rough(oLo, oHi);
          if (top.length === 3 && rank <= top[2][8]) continue;
          const e = [oLo, oHi, fun, K, q, st[5] + oLines, st[6] > oLines ? st[6] : oLines, st[7] + (oLines ? 1 : 0), rank];
          let p = top.length < 3 ? top.length : 2;
          top[p] = e;
          while (p > 0 && top[p - 1][8] < rank){ top[p] = top[p - 1]; top[p - 1] = e; p--; }
        }
      }
      if (!top.length){ beam = null; break; }
      beam = top;
    }
    if (!beam) continue;
    const b = beam[0], v = b[2] * 10 - rough(b[0], b[1]) * 0.1;
    if (!best || v > best.v) best = { v, lines: b[5], maxL: b[6], clears: b[7], K: b[3], lo: b[0], hi: b[1] };
  }
  return best;
}

// A model of a player who does not plan ahead: random order, a random spot, a clear taken when one
// is there 70% of the time, and never a spot that leaves another tray piece nowhere to go (when
// avoidable). Averages over a few such plays: ok = share that placed the whole set, lines = lines
// cleared, multi = placements clearing 2+ lines, alive = combo chain still alive at the end,
// near = lines left one or two cells short, empty = board emptied.
function casualStats(lo0, hi0, set, tries, ctx){
  const r = { ok: 0, lines: 0, multi: 0, alive: 0, near: 0, empty: 0 };
  const pos = [], clr = [];
  for (let t = 0; t < tries; t++){
    let lo = lo0, hi = hi0, fail = false, K = ctx.chain0, q = ctx.quiet0;
    const left = set.slice();
    while (left.length){
      const j = rnd() * left.length | 0, s = left[j], P = PL[s];
      left.splice(j, 1);
      pos.length = 0; clr.length = 0;
      let any = -1;
      for (let i = 0; i < P.length; i += 4){
        if ((lo & P[i]) || (hi & P[i + 1])) continue;
        any = i;
        put(lo, hi, s, i);
        const a = oLo, b = oHi, l = oLines;
        let room = true;
        for (const o of left) if (!anyFit(a, b, o)){ room = false; break; }
        if (!room) continue;
        pos.push(i); if (l) clr.push(i);
      }
      if (any < 0){ fail = true; break; }
      const i = clr.length && rnd() < 0.7 ? clr[rnd() * clr.length | 0] : pos.length ? pos[rnd() * pos.length | 0] : any;
      put(lo, hi, s, i); lo = oLo; hi = oHi;
      if (oLines){ r.lines += oLines; if (oLines >= 2) r.multi++; K++; q = 0; } else if (++q > 2){ K = 0; q = 0; }
    }
    if (fail) continue;
    r.ok++;
    if (K) r.alive++;
    if (!lo && !hi) r.empty++;
    else r.near += nearLines(lo, hi);
  }
  for (const k in r) r[k] /= tries;
  return r;
}

// 0 = generous, 1 = hard, up to 2 = far past your best or a very long game.
function difficulty(info, round, c){
  const score = +info.score || 0, best = +info.best || 0;
  let d = 0;
  if (c.followBest){
    const r0 = c.rampStart / 100;
    if (best >= 1000){
      const r = score / best;
      // nothing below the ramp start; about 0.2 at the best, 0.6 at 1.5x, 1 at 2x, 2 at 3.25x
      if (r0 < 1) d = r < r0 ? 0 : r < 1 ? 0.2 * (r - r0) / (1 - r0) : 0.2 + (r - 1) * 0.8;
      else d = r < r0 ? 0 : 0.2 + (r - r0) * 0.8;
    } else d = clamp((score - 3000) / 12000, 0, 0.5);    // first games, no real best yet
  }
  // Very long games tighten up on their own (Block Blast's round-based pool adjustment).
  if (c.longGame) d = Math.max(d, (round - c.longGameStart) / 350);
  d = d * c.difficulty * 2 + Math.max(0, c.difficulty - 0.5) * 1.2;
  return clamp(d, 0, 2);
}
function fixMem(mem){
  if (!Array.isArray(mem.recent)) mem.recent = [];
  mem.recent = mem.recent.slice(0, 2).map(a => Array.isArray(a) ? a.filter(x => Number.isInteger(x) && x >= 0 && x < NS) : []);
  if (!Number.isFinite(mem.dry)) mem.dry = 0;
  if (!Number.isFinite(mem.lastFill)) mem.lastFill = -1;
  if (!Number.isFinite(mem.lastCells)) mem.lastCells = 0;
  if (!Number.isFinite(mem.n)) mem.n = 0;
  if (!Number.isFinite(mem.tens)) mem.tens = 0;       // trays since the last relief
}

function newSet(grid, mem, info){
  if (!mem || typeof mem !== 'object') mem = {};
  fixMem(mem);
  info = info || {};
  const c = cfg();
  let lo = 0, hi = 0;
  for (let r = 0; r < N; r++) for (let x = 0; x < N; x++) if (grid[r] && grid[r][x] >= 0){ const k = r * N + x; if (k < 32) lo |= 1 << k; else hi |= 1 << (k - 32); }
  lo |= 0; hi |= 0;
  const seed = String(c.seed || '').trim();
  rnd = seed ? mulberry(hashStr(seed) ^ Math.imul(mem.n + 1, 0x9E3779B1) ^ lo ^ Math.imul(hi, 0x85EBCA6B)) : Math.random;
  const filled = pc(lo) + pc(hi), f = filled / (N * N);
  // What happened with the last set? (Fewer cells than it would leave without clears = it cleared.)
  const cleared = mem.lastFill >= 0 ? mem.lastFill + mem.lastCells - filled : 0;
  if (mem.lastFill >= 0) mem.dry = cleared > 0 ? 0 : Math.min(mem.dry + 1, 9);
  if (cleared >= 16) mem.tens = 0;                     // a big clear of the player's own is a relief too
  const d = difficulty(info, mem.n, c);
  const ease = (1 - 0.35 * Math.min(d, 1)) * (d > 1 ? Math.max(0.3, 2 - d) : 1);
  const chain0 = Math.max(0, +info.chain | 0), quiet0 = clamp(+info.quiet | 0, 0, 2);

  // Mercy (0..2): grows from a base level as the fill passes 30% and is full from about 58%.
  const ramp = clamp((f - 0.3) / 0.28, 0, 1);
  const m = 2 * c.mercy * ((1 - c.mercyGrowth) * 0.5 + c.mercyGrowth * ramp);
  // Tension: on a light board the trays since the last relief get slightly leaner.
  const cyc = c.cycle;
  const tight = cyc ? c.cycleAmp * clamp(mem.tens / c.cycleLen, 0, 1) * clamp((0.5 - f) / 0.2, 0, 1) : 0;
  const famOn = SHAPES.map(sh => !!c['fam.' + sh.fam]);
  if (!famOn.some(Boolean)) famOn.fill(true);
  const v = c.variety, ml = c.multiLine;
  const ctx = {
    lo, hi, sizeF: sizeFactors(m, d, c.sizeBias + 0.6 * tight), last: mem.recent[0] || [], prev: mem.recent[1] || [],
    famOn, maxFam: Math.round(c.maxFamily),
    vLast: Math.max(0.02, 1 - 1.4 * v), vPrev: Math.max(0.05, 1 - 0.7 * v), vDup: Math.max(0.02, 1 - 1.7 * v), vFam: Math.max(0.05, 1 - 1.1 * v),
    fatF: 1 + 0.6 * ml * (1 - ramp), gap: c.gapFill, lineV: [0, 1, 4, 8, 10, 12].map((x, l) => l ? 1 + (x - 1) * ml * 2 : 0),
    mlW: 6 * ml, chW: 4 * c.chainAssist, deathW: 2 * c.chainAssist, chain0, quiet0,
  };
  const nearNow = f >= 0.15 ? nearLines(lo, hi) : 0;

  // How hard to help this deal: none on a near-empty board, most deals mid-game, nearly always
  // when crowded, more after sets without a clear or with a line left nearly done, less in the
  // tension trays and when well past the best score.
  let pAssist = f < 0.12 ? 0 : c.assist * (1 + 0.6 * m + 0.2 * Math.min(mem.dry, 3));
  if (nearNow) pAssist += c.nearMiss * 0.6 * (1 - Math.min(pAssist, 1));
  pAssist = Math.min(0.97, pAssist) * ease * (1 - 0.6 * tight);

  // Which kind of deal this is.
  let mode = 'plain', chain = 0, setup = null, rescue = false;
  const allClearOk = c.allClear > 0 && mem.n >= 5 && filled >= 4 && filled <= 26;
  if (allClearOk && rnd() < c.allClear * ease) mode = 'allclear';
  else if (c.rescueAt < 100 && f >= c.rescueAt / 100 && rnd() < (d > 1 ? Math.max(0.3, 2 - d) : 1)) mode = 'rescue';
  else if (cyc && mem.tens >= c.cycleLen && f >= 0.2) mode = 'relief';
  else if (chain0 >= 2 && quiet0 >= 1 && rnd() < c.chainAssist) mode = 'chain';
  if (mode === 'plain' && (rnd() < pAssist || (f >= 0.2 && rnd() < ml * ease && multiPot(lo, hi, famOn)))) mode = 'assist';
  if (mode === 'assist' || mode === 'chain'){
    const x = rnd(), busy = f > 0.45 ? 0.1 : 0;
    chain = x < 0.4 - busy ? 1 : x < 0.78 - busy ? 2 : 3;
    if (d > 0.5 && chain === 3 && rnd() < d - 0.3) chain = 2;
    if (chain >= 2 && rnd() < 0.25 + 0.7 * ml) setup = 'm';
  } else if (mode === 'rescue'){ chain = 3; rescue = true; setup = 'm'; }
  else if (mode === 'relief'){ chain = 3; setup = 'm'; }
  else if (mode === 'allclear'){ chain = 0; setup = 'a'; }
  const nmOn = f >= 0.15 && rnd() < Math.min(1, c.nearMiss + 0.5 * tight);

  // Draw placeable candidates and judge them.
  let chosen = null, special = false;
  const want = mode === 'rescue' || mode === 'relief' ? 8 : chain ? 8 : mode === 'allclear' ? 4 : nmOn ? 4 : f >= 0.2 && d < 0.5 ? 2 : 1;
  const cands = [];
  for (let t = 0; t < 16 && cands.length < want; t++){
    const set = buildSet(ctx, chain, rescue, setup && t < (mode === 'allclear' ? 6 : 4) ? setup : null);
    if (solvable(lo, hi, set)) cands.push(set);
  }
  // On a crowded board mercy also looks at how forgiving each set is (see casualStats()).
  const robW = 300 * c.mercy * clamp((f - 0.25) / 0.2, 0, 1) * ease;
  for (let t = 0; robW > 0 && t < 10 && cands.length < 5; t++){ const set = buildSet(ctx, chain, rescue, null); if (solvable(lo, hi, set)) cands.push(set); }
  // Far past the best (difficulty above 1) the dealer judges less and less often, so a strong
  // player's game does end some time.
  const judged = ((mode !== 'plain' && mode !== 'assist') || robW > 0 || rnd() < c.polish * ease) && !(d > 1 && rnd() < d - 1);
  if (cands.length > 1 && judged){
    let bv = -Infinity, bE = null;
    for (const set of cands){
      const E = evalSet(lo, hi, set, ctx);
      if (!E) continue;
      const C = casualStats(lo, hi, set, mode === 'rescue' ? 10 : 8, ctx);
      let s = E.v + 25 * C.lines + robW * C.ok;
      if (ml > 0) s += ml * (120 * C.multi + (nmOn || tight > 0 ? 40 : 20) * Math.min(2, multiPot(E.lo, E.hi, famOn)));
      if (chain0 > 0) s += 70 * c.chainAssist * C.alive;
      if (nmOn) s += 90 * Math.min(2, C.near);
      if (mode === 'rescue') s += 4 * (64 - pc(E.lo) - pc(E.hi)) + 30 * C.lines;
      else if (mode === 'relief') s += 25 * E.maxL + 10 * E.lines + 40 * C.lines + 60 * C.multi;
      else if (mode === 'chain') s += (E.K ? 50 : 0) + 80 * C.alive;
      else if (mode === 'allclear') s += (!E.lo && !E.hi ? 200 : 0) + 300 * C.empty;
      if (s > bv){ bv = s; chosen = set; bE = E; }
    }
    special = !!bE && (mode === 'rescue' || mode === 'relief' || mode === 'allclear') && bE.lines >= 2;
  }
  if (!chosen && cands.length) chosen = cands[0];
  for (let t = 0; t < 16 && !chosen; t++){ const set = buildSet(ctx, Math.max(chain, 1 + (t & 1)), true, null); if (solvable(lo, hi, set)) chosen = set; }
  if (!chosen) chosen = construct(ctx);
  if (!chosen) chosen = exhaustive(ctx);
  if (!chosen) chosen = buildSet(ctx, 0, true, null);   // genuinely jammed: this is game over

  let cells = 0;
  for (const s of chosen) cells += SHAPES[s].n;
  mem.recent = [chosen.slice(), mem.recent[0] || []];
  mem.lastFill = filled; mem.lastCells = cells; mem.n++;
  mem.tens = special ? 0 : Math.min(mem.tens + 1, 99);
  return chosen.map(s => { const sh = SHAPES[s]; return { s, cells: sh.cells.map(q => q.slice()), w: sh.w, h: sh.h }; });
}

window.GBPieces = {
  SHAPES,
  init: () => ({ recent: [], dry: 0, lastFill: -1, lastCells: 0, n: 0, tens: 0 }),
  newSet,
};
})();
