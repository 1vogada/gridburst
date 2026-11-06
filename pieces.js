// Gridburst piece selection. Pure logic, no DOM: the game calls GBPieces.newSet() whenever the
// tray is empty and assigns colours itself.
//   GBPieces.init()                  -> mem, a JSON-serialisable object the game saves and passes back
//   GBPieces.newSet(grid, mem, info) -> three pieces [{ s, cells, w, h }]
//     grid: 8x8 array, -1 = empty, >= 0 = filled; info: { score, best }
//
// Modelled on how Block Blast deals (minus its deliberately unplaceable "death" sets):
//  1. Base pool: every rotation is its own shape with near-even weights. As the board fills,
//     pieces of 3 cells or fewer get likelier and pieces of 6+ cells much rarer.
//  2. Clear assist: above 12% fill, about 3 in 5 deals (nearly all when crowded, more after a set
//     without a clear) look for placements that complete rows/columns, favouring multi-line
//     clears, or exactly fill an enclosed hole, and deal those pieces. Often it chains: piece 2 is
//     chosen to clear again on the board piece 1 leaves, and so on, or it deals a pair that
//     together fills the gaps of two lines. Assisted deals draw several placeable candidates
//     and usually keep the one whose best play has the most clears and combos.
//  3. Variety: shapes from the last two sets and repeats inside a set are damped; never three of
//     the same shape family in one set.
//  4. Difficulty: from 70% of your best score onward (and on its own in very long games), big
//     pieces get likelier and the assist backs off. Before that it stays generous.
//  5. Guarantee: every set is checked with an exact search (all orders, all positions, line clears
//     included). If none of the drawn sets fits, it retries with small pieces, then builds a set
//     piece by piece on a simulated board. Only a truly jammed board gets an unplaceable set.
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
  return { ...p, wt, fam, id, n: p.cells.length };
});
const NS = SHAPES.length;

// ---------- bitboards ----------
// The board is two int32 words: lo = rows 0-3, hi = rows 4-7, bit (r % 4) * 8 + c.
const ROW_LO = [], ROW_HI = [], COL = [];
for (let r = 0; r < N; r++){ ROW_LO.push(r < 4 ? (0xFF << (8 * r)) | 0 : 0); ROW_HI.push(r >= 4 ? (0xFF << (8 * (r - 4))) | 0 : 0); }
for (let c = 0; c < N; c++) COL.push((0x01010101 << c) | 0);
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

// ---------- weights ----------
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
// Per-size multiplier for this board fill f (0..1) and difficulty d (0..2; above 1 is "far past
// your best" or a very long game, where the crowded-board protection also weakens).
function sizeFactors(f, d){
  const a = clamp((f - 0.33) / 0.25, 0, 1) * (d > 1 ? 1 - 0.45 * (d - 1) : 1);   // 0 below 33% fill, 1 from 58%
  const out = [];
  for (let n = 0; n <= 9; n++){
    let x = 1;
    if (n <= 3) x *= 1 + 1.2 * a;
    else if (n === 4) x *= 1 - 0.1 * a;
    else if (n === 5) x *= 1 - 0.45 * a;
    else x *= 1 - 0.85 * a;
    if (n >= 5) x *= 1 + 1.5 * d; else if (n <= 2) x *= Math.max(0.2, 1 - 0.45 * d); else if (d > 1) x *= 1 - 0.3 * (d - 1);
    out.push(x);
  }
  return out;
}
function shapeWeight(sh, ctx, picked, rescue){
  let x = sh.wt * ctx.sizeF[sh.n];
  if (ctx.last.includes(sh.id)) x *= 0.3; else if (ctx.prev.includes(sh.id)) x *= 0.65;
  let fam = 0;
  for (const q of picked){ if (q === sh.id) x *= 0.15; if (SHAPES[q].fam === sh.fam) fam++; }
  if (fam >= 2) return 0;
  if (fam === 1) x *= 0.45;
  if (rescue) x *= sh.n >= 5 ? 0.12 : sh.n === 4 ? 0.6 : 2;
  return x;
}
function pickW(items, w, tot){
  let x = Math.random() * tot;
  for (let i = 0; i < items.length; i++){ x -= w[i]; if (x <= 0) return items[i]; }
  return items[items.length - 1];
}
function drawShape(ctx, picked, rescue){
  const w = [], ids = [];
  let tot = 0;
  for (const sh of SHAPES){ const x = shapeWeight(sh, ctx, picked, rescue); if (x > 0){ ids.push(sh.id); w.push(x); tot += x; } }
  return pickW(ids, w, tot);
}
// Pieces that complete a line (or exactly fill a pocket) on this board, each with its best position.
const LINE_V = [0, 1, 4, 8, 10, 12];
function assistCands(lo, hi, ctx, picked, rescue){
  const hs = holes(lo, hi), ids = [], pos = [], w = [];
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
        v = LINE_V[oLines];
        if (!(oLo & P[i]) && !(oHi & P[i + 1])) v *= 1.6;    // every cell of the piece went away
      }
      for (let h = 0; h < hs.length; h += 2) if (hs[h] === P[i] && hs[h + 1] === P[i + 1]){ v = Math.max(v, 1) * 2; break; }
      if (v > bv){ bv = v; bi = i; ties = 1; }
      else if (v > 0 && v === bv && Math.random() * ++ties < 1) bi = i;
    }
    if (bi >= 0){ ids.push(s); pos.push(bi); w.push(sw * bv * bv); tot += sw * bv * bv; }
  }
  return { ids, pos, w, tot };
}

// ---------- building a set ----------
function shuffle(a){ for (let i = a.length - 1; i > 0; i--){ const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Combo setup: two pieces that together fill exactly the empty cells of two lines (two rows, two
// columns, or a row and a column), so playing both clears both lines, often at once.
const LINES = [];
for (let r = 0; r < N; r++) LINES.push([ROW_LO[r], ROW_HI[r]]);
for (let c = 0; c < N; c++) LINES.push([COL[c], COL[c]]);
const PMAP = new Map();           // exact cell mask -> [shape, position index, ...]
PL.forEach((P, s) => { for (let i = 0; i < P.length; i += 4){ const k = P[i] + ',' + P[i + 1]; if (!PMAP.has(k)) PMAP.set(k, []); PMAP.get(k).push(s, i); } });
// FIRST[k]: [shape, position index, ...] for every placement whose lowest cell is k.
const ctz = x => 31 - Math.clz32(x & -x);
const FIRST = Array.from({ length: 64 }, () => []);
PL.forEach((P, s) => { for (let i = 0; i < P.length; i += 4) FIRST[P[i] ? ctz(P[i]) : 32 + ctz(P[i + 1])].push(s, i); });
// Returns every candidate as { out: [[s, pos, t, pos], ...], w, tot }; only called on the real board.
function comboPairs(lo, hi, ctx, picked, rescue){
  const out = [], w = [];
  let tot = 0;
  const sw = SHAPES.map(sh => shapeWeight(sh, ctx, picked, rescue)), sw2 = new Map();
  const weight2 = (s, t) => { const k = s * NS + t; let v = sw2.get(k); if (v === undefined){ v = shapeWeight(SHAPES[t], ctx, picked.concat(s), rescue); sw2.set(k, v); } return v; };
  for (let a = 0; a < LINES.length; a++) for (let b = a + 1; b < LINES.length; b++){
    if (!((LINES[a][0] & ~lo) | (LINES[a][1] & ~hi)) || !((LINES[b][0] & ~lo) | (LINES[b][1] & ~hi))) continue;
    const elo = (LINES[a][0] | LINES[b][0]) & ~lo, ehi = (LINES[a][1] | LINES[b][1]) & ~hi;
    const n = pc(elo) + pc(ehi);
    if (n < 3 || n > 10) continue;
    for (let k = 0; k < 64; k++){
      if (!(k < 32 ? (elo >>> k) & 1 : (ehi >>> (k - 32)) & 1)) continue;
      const F = FIRST[k];
      for (let f = 0; f < F.length; f += 2){
        const s = F[f], i = F[f + 1], P = PL[s];
        if (sw[s] <= 0 || (P[i] & ~elo) || (P[i + 1] & ~ehi)) continue;   // must sit inside the gap
        const rest = PMAP.get(((elo & ~P[i]) | 0) + ',' + ((ehi & ~P[i + 1]) | 0));
        if (!rest) continue;
        for (let r = 0; r < rest.length; r += 2){
          const t = rest[r], wt = weight2(s, t);
          if (wt <= 0) continue;
          put(lo, hi, s, i); const l1 = oLines;
          put(oLo, oHi, t, rest[r + 1]);
          if (!oLines) continue;                                     // first piece's clear broke the second line
          const v = sw[s] * wt * (l1 ? 1 : oLines >= 2 ? 2 : 0.6) * LINE_V[Math.min(5, l1 + oLines)];
          out.push([s, i, t, rest[r + 1]]); w.push(v); tot += v;
        }
      }
    }
  }
  return { out, w, tot };
}
// chain: how many pieces in a row should be picked to clear on the simulated board (0 = none).
// pair: try to open with a two-piece combo setup.
function buildSet(ctx, chain, rescue, pair){
  const set = [];
  let lo = ctx.lo, hi = ctx.hi;
  // The first step only depends on the real board, so its candidates are worked out once per deal.
  const key = rescue ? 'r' : 'n';
  if (pair && chain >= 2){
    const all = ctx['p' + key] || (ctx['p' + key] = comboPairs(lo, hi, ctx, set, rescue));
    const p = all.out.length ? pickW(all.out, all.w, all.tot) : null;
    if (p){ set.push(p[0], p[2]); put(lo, hi, p[0], p[1]); put(oLo, oHi, p[2], p[3]); lo = oLo; hi = oHi; }
  }
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
// Last resort before calling the board jammed: pick small pieces one at a time, each one placed
// on the simulated board (clearing where it can) before the next is chosen.
function construct(ctx){
  for (let t = 0; t < 8; t++){
    const set = [];
    let lo = ctx.lo, hi = ctx.hi;
    while (set.length < 3){
      const ids = [], w = [];
      let tot = 0;
      for (const sh of SHAPES){
        if (sh.n > 4 || !anyFit(lo, hi, sh.id)) continue;
        // the last tries may break the variety rule (e.g. three dots) rather than end the game
        const x = (shapeWeight(sh, ctx, set, true) || (t >= 6 ? 0.05 * sh.wt : 0)) * (t >= 4 ? 1 / sh.n : 1);
        if (x > 0){ ids.push(sh.id); w.push(x); tot += x; }
      }
      if (!ids.length) break;
      const s = pickW(ids, w, tot), P = PL[s];
      let bi = -1, bl = -1;
      for (let i = 0; i < P.length; i += 4){
        if ((lo & P[i]) || (hi & P[i + 1])) continue;
        put(lo, hi, s, i);
        if (oLines > bl || (oLines === bl && Math.random() < 0.3)){ bl = oLines; bi = i; }
      }
      set.push(s); put(lo, hi, s, bi); lo = oLo; hi = oHi;
    }
    if (set.length === 3) return shuffle(set);
  }
  return null;
}

// How much fun a set is: a short beam search over every order (line clears included) that looks
// for clears, multi-line clears and clears on consecutive placements, minus a rough board after.
function rough(lo, hi){
  let t = pc((lo ^ (lo >>> 1)) & 0x7F7F7F7F) + pc((hi ^ (hi >>> 1)) & 0x7F7F7F7F);
  t += pc((lo ^ (lo >>> 8)) & 0x00FFFFFF) + pc((hi ^ (hi >>> 8)) & 0x00FFFFFF) + pc(((lo >>> 24) ^ hi) & 0xFF);
  const iso = pc(~lo & (((lo << 1) & 0xFEFEFEFE) | 0x01010101) & (((lo >>> 1) & 0x7F7F7F7F) | 0x80808080) & ((lo << 8) | 0xFF) & ((lo >>> 8) | (hi << 24)))
            + pc(~hi & (((hi << 1) & 0xFEFEFEFE) | 0x01010101) & (((hi >>> 1) & 0x7F7F7F7F) | 0x80808080) & ((hi << 8) | (lo >>> 24)) & ((hi >>> 8) | 0xFF000000));
  return t + iso * 5;
}
const ORDERS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function setFun(lo0, hi0, set){
  let best = -1e9;
  for (const ord of ORDERS){
    let beam = [[lo0, hi0, 0, 0]];                  // lo, hi, fun, cleared on the previous placement
    for (const j of ord){
      const s = set[j], P = PL[s], next = [];
      for (const [lo, hi, fun, prevC] of beam){
        for (let i = 0; i < P.length; i += 4){
          if ((lo & P[i]) || (hi & P[i + 1])) continue;
          put(lo, hi, s, i);
          const f2 = fun + (oLines ? 2 + 3 * oLines * oLines + (prevC ? 2 : 0) : 0);
          next.push([oLo, oHi, f2, oLines ? 1 : 0, f2 * 10 - rough(oLo, oHi)]);
        }
      }
      if (!next.length){ beam = null; break; }
      next.sort((a, b) => b[4] - a[4]);
      beam = next.slice(0, 3);
    }
    if (beam) best = Math.max(best, beam[0][2] * 10 - rough(beam[0][0], beam[0][1]) * 0.1);
  }
  return best;
}
// 0 = generous, 1 = hard, up to 2 = far past your best or a very long game.
function difficulty(info, round){
  const score = +info.score || 0, best = +info.best || 0;
  let d;
  // Nothing below 70% of the best; about 0.2 at the best, 0.6 at 1.5x, 1 at 2x, 2 at 3.25x.
  if (best >= 1000){ const r = score / best; d = r < 0.7 ? 0 : r < 1 ? (r - 0.7) / 1.5 : 0.2 + (r - 1) * 0.8; }
  else d = clamp((score - 3000) / 12000, 0, 0.5);    // first games, no real best yet
  // Very long games tighten up on their own (Block Blast's round-based pool adjustment).
  return clamp(Math.max(d, (round - 100) / 350), 0, 2);
}
function fixMem(mem){
  if (!Array.isArray(mem.recent)) mem.recent = [];
  mem.recent = mem.recent.slice(0, 2).map(a => Array.isArray(a) ? a.filter(x => Number.isInteger(x)) : []);
  if (!Number.isFinite(mem.dry)) mem.dry = 0;
  if (!Number.isFinite(mem.lastFill)) mem.lastFill = -1;
  if (!Number.isFinite(mem.lastCells)) mem.lastCells = 0;
  if (!Number.isFinite(mem.n)) mem.n = 0;
}

function newSet(grid, mem, info){
  fixMem(mem);
  info = info || {};
  let lo = 0, hi = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c] >= 0){ const k = r * N + c; if (k < 32) lo |= 1 << k; else hi |= 1 << (k - 32); }
  const filled = pc(lo) + pc(hi), f = filled / (N * N);
  // Did the player clear anything with the last set? (Fewer cells than it would leave without clears.)
  if (mem.lastFill >= 0) mem.dry = filled < mem.lastFill + mem.lastCells ? 0 : Math.min(mem.dry + 1, 9);
  const d = difficulty(info, mem.n);
  const ctx = { lo, hi, sizeF: sizeFactors(f, d), last: mem.recent[0] || [], prev: mem.recent[1] || [] };

  // How hard to help this deal: none on a near-empty board, about 3 in 5 mid-game, nearly always
  // when crowded, more after sets without a clear, less when well past the best score.
  const ease = (1 - 0.35 * Math.min(d, 1)) * (d > 1 ? Math.max(0.3, 2 - d) : 1);
  let pAssist = f < 0.12 ? 0 : 0.6 + 0.35 * clamp((f - 0.3) / 0.25, 0, 1);
  pAssist = Math.min(0.97, (pAssist + (f >= 0.12 ? 0.12 * Math.min(mem.dry, 3) : 0)) * ease);
  let chain = 0;
  if (Math.random() < pAssist){
    const x = Math.random(), busy = f > 0.45 ? 0.1 : 0;
    chain = x < 0.4 - busy ? 1 : x < 0.78 - busy ? 2 : 3;
    if (d > 0.5 && chain === 3 && Math.random() < d - 0.3) chain = 2;
  }
  const pair = chain >= 2 && Math.random() < 0.6;

  // Assisted deals draw up to 8 placeable candidates and usually keep the most fun one. Plain deals
  // are the real game's random sets: the first placeable draw (best of two on a board that is
  // filling up, before the difficulty ramp).
  let chosen = null;
  const want = chain ? 8 : f >= 0.2 && d < 0.5 ? 2 : 1, cands = [];
  for (let t = 0; t < 14 && cands.length < want; t++){ const set = buildSet(ctx, chain, false, pair && t < 3); if (solvable(lo, hi, set)) cands.push(set); }
  if (cands.length > 1 && Math.random() < 0.8 * ease){
    let bv = -Infinity;
    for (const set of cands){ const v = setFun(lo, hi, set); if (v > bv){ bv = v; chosen = set; } }
  } else if (cands.length) chosen = cands[0];
  for (let t = 0; t < 16 && !chosen; t++){ const set = buildSet(ctx, Math.max(chain, 1 + (t & 1)), true); if (solvable(lo, hi, set)) chosen = set; }
  if (!chosen) chosen = construct(ctx);
  if (!chosen) chosen = buildSet(ctx, 0, true);   // genuinely jammed: this is game over

  let cells = 0;
  for (const s of chosen) cells += SHAPES[s].n;
  mem.recent = [chosen.slice(), mem.recent[0] || []];
  mem.lastFill = filled; mem.lastCells = cells; mem.n++;
  return chosen.map(s => { const sh = SHAPES[s]; return { s, cells: sh.cells.map(c => c.slice()), w: sh.w, h: sh.h }; });
}

window.GBPieces = {
  SHAPES,
  init: () => ({ recent: [], dry: 0, lastFill: -1, lastCells: 0, n: 0 }),
  newSet,
};
})();
