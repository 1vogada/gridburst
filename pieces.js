// Gridburst piece selection. Pure logic, no DOM: the game calls GBPieces.newSet() whenever the
// tray is empty and assigns colours itself.
//   GBPieces.init()                  -> mem, a JSON-serialisable object the game saves and passes back
//   GBPieces.newSet(grid, mem, info) -> three pieces [{ s, cells, w, h }]
//     grid: 8x8 array, -1 = empty, >= 0 = filled; info: { score, best }
(() => {
'use strict';
const N = 8;
// [pattern, base weight, family]; rotations of one shape share a family
const SHAPE_DEFS = [
  ['1',.8,'dot'],['11',1.1,'i2'],['1/1',1.1,'i2'],['111',1.2,'i3'],['1/1/1',1.2,'i3'],['1111',1,'i4'],['1/1/1/1',1,'i4'],['11111',.6,'i5'],['1/1/1/1/1',.6,'i5'],
  ['11/11',1.4,'o2'],['111/111/111',.45,'o3'],['111/111',.8,'r6'],['11/11/11',.8,'r6'],
  ['10/11',1,'v3'],['01/11',1,'v3'],['11/10',1,'v3'],['11/01',1,'v3'],
  ['10/10/11',.8,'l4'],['01/01/11',.8,'l4'],['11/10/10',.8,'l4'],['11/01/01',.8,'l4'],
  ['111/100',.8,'l4'],['111/001',.8,'l4'],['100/111',.8,'l4'],['001/111',.8,'l4'],
  ['100/100/111',.45,'l5'],['001/001/111',.45,'l5'],['111/100/100',.45,'l5'],['111/001/001',.45,'l5'],
  ['111/010',.8,'t4'],['010/111',.8,'t4'],['10/11/10',.8,'t4'],['01/11/01',.8,'t4'],
  ['011/110',.7,'s4'],['110/011',.7,'s4'],['10/11/01',.7,'s4'],['01/11/10',.7,'s4'],
];
function parse(s){
  const rows = s.split('/'), cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '1') cells.push([r, c]); }));
  return { cells, h: rows.length, w: rows[0].length };
}
const SHAPES = SHAPE_DEFS.map(([s, wt, fam], id) => {
  const p = parse(s);
  return { ...p, wt, fam, id, n: p.cells.length, hard: p.cells.length >= 5 || fam === 's4' };
});

// ---------- piece selection ----------
// Candidate sets are drawn with weights that ramp toward big shapes as the score grows and
// that avoid shapes from the last two sets. Each candidate is then played out (every order,
// beam search over placements) and scored by the lines it can clear and the board it leaves.
// Crowded boards get the best-fitting set; open boards pick among the top half for variety.
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const CANDS = 28, BEAM = 3;
function drawShape(d, picked, calm, recent){
  const last = recent[0] || [], prev = recent[1] || [];
  let tot = 0;
  const w = SHAPES.map(s => {
    let x = s.wt;
    if (!calm){ if (s.hard) x *= 1 + 1.3 * d; else if (s.n <= 2) x *= 1 - 0.5 * d; }
    if (last.includes(s.id)) x *= 0.2; else if (prev.includes(s.id)) x *= 0.55;
    for (const q of picked){ if (q.id === s.id) x *= 0.15; else if (q.fam === s.fam) x *= 0.5; }
    tot += x; return x;
  });
  let x = Math.random() * tot;
  for (let i = 0; i < SHAPES.length; i++){ x -= w[i]; if (x <= 0) return SHAPES[i]; }
  return SHAPES[SHAPES.length - 1];
}
function occOf(g){ const o = new Uint8Array(N * N); for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) o[r * N + c] = g[r][c] >= 0 ? 1 : 0; return o; }
function fitsO(o, s, r, c){ for (const [dr, dc] of s.cells) if (o[(r + dr) * N + c + dc]) return false; return true; }
function putO(o, s, r, c){
  const n = o.slice();
  for (const [dr, dc] of s.cells) n[(r + dr) * N + c + dc] = 1;
  let fr = 0, fc = 0, lines = 0;
  for (let i = r; i < r + s.h; i++){ let f = 1; for (let j = 0; j < N; j++) if (!n[i * N + j]){ f = 0; break; } if (f){ fr |= 1 << i; lines++; } }
  for (let j = c; j < c + s.w; j++){ let f = 1; for (let i = 0; i < N; i++) if (!n[i * N + j]){ f = 0; break; } if (f){ fc |= 1 << j; lines++; } }
  if (lines) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if ((fr >> i & 1) || (fc >> j & 1)) n[i * N + j] = 0;
  return { o: n, lines };
}
// Board roughness, lower is better: filled/empty edges, sealed single holes, and fill.
function rough(o){
  let t = 0, iso = 0, fill = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++){
    const k = i * N + j, v = o[k]; fill += v;
    if (j < N - 1 && v !== o[k + 1]) t++;
    if (i < N - 1 && v !== o[k + N]) t++;
    if (!v && (j === 0 || o[k - 1]) && (j === N - 1 || o[k + 1]) && (i === 0 || o[k - N]) && (i === N - 1 || o[k + N])) iso++;
  }
  return t + iso * 6 + fill * 0.5;
}
// Best outcome for playing this set on board o, or -Infinity if the search found no order that fits all three.
function planSet(o0, set){
  let best = -Infinity;
  const seen = new Set();
  for (const pm of PERMS){
    const key = pm.map(i => set[i].id).join();
    if (seen.has(key)) continue; seen.add(key);
    let beam = [{ o: o0, lines: 0, hits: 0, multi: 0 }];
    for (const i of pm){
      const s = set[i], next = [];
      for (const st of beam){
        for (let r = 0; r <= N - s.h; r++) for (let c = 0; c <= N - s.w; c++){
          if (!fitsO(st.o, s, r, c)) continue;
          const { o, lines } = putO(st.o, s, r, c);
          const ns = { o, lines: st.lines + lines, hits: st.hits + (lines ? 1 : 0), multi: st.multi + (lines > 1 ? lines * lines : 0) };
          ns.v = ns.lines * 12 + ns.multi * 4 + ns.hits * 6 - rough(o);
          next.push(ns);
        }
      }
      if (!next.length){ beam = null; break; }
      next.sort((a, b) => b.v - a.v); beam = next.slice(0, BEAM);
    }
    if (beam && beam[0].v > best) best = beam[0].v;
  }
  return best;
}
function newSet(grid, mem, info){
  const o = occOf(grid), d = Math.min(1, info.score / 6000);
  let fill = 0; for (const v of o) fill += v;
  const crowd = fill / (N * N);
  const cands = [];
  const tryDraws = (count, calm) => {
    for (let t = 0; t < count; t++){
      const set = []; for (let k = 0; k < 3; k++) set.push(drawShape(d, set, calm, mem.recent));
      const v = planSet(o, set);
      if (v > -Infinity) cands.push({ set, v });
    }
  };
  tryDraws(CANDS, false);
  if (!cands.length) tryDraws(80, true);
  let chosen;
  if (cands.length){
    cands.sort((a, b) => b.v - a.v);
    const help = Math.min(1, crowd * 1.6) * (1 - 0.35 * d) + 0.15;
    const pool = Math.max(1, Math.round(cands.length * (1 - Math.min(1, help)) * 0.6));
    chosen = cands[Math.random() * pool | 0].set;
  } else {
    const set = []; for (let k = 0; k < 3; k++) set.push(drawShape(d, set, true, mem.recent));
    chosen = set;
  }
  mem.recent = [chosen.map(s => s.id), mem.recent[0] || []];
  return chosen.map(s => ({ s: s.id, cells: s.cells, w: s.w, h: s.h }));
}


window.GBPieces = { SHAPES, init: () => ({ recent: [] }), newSet };
})();
