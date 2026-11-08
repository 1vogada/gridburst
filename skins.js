// Gridburst block skins. Every block on the board, in the tray and under the finger is drawn here.
// All art is drawn in code. Load after settings.js (works standalone too, with default settings).
//
//   GBSkins.list()                         [{ id, name, tags }] in a stable order
//   GBSkins.draw(ctx, x, y, size, opts)    draw one cell filling (x, y, size, size), in ctx's CSS units
//     opts: { hex, skin, pattern, t, seed, alpha = 1, scale = 1, lit = 0, rot = 0, dy = 0 }
//       hex      base colour, e.g. '#3fcf3a'          skin    skin id ('classic' when unknown)
//       pattern  '' | 'gingham' | 'dots' (stage patterns; used by the classic and pastel skins)
//       t        time in ms (default performance.now()) seed  integer, stable per block (variant + phase)
//       alpha    multiplies ctx.globalAlpha            scale   scales around the centre
//       lit      0..1 highlight glow (hover / ghost)   rot     radians, dy  fraction of size (see anim())
//   GBSkins.skinFor({ stage, pieceSeed, cellSeed, themeSkin, mode? })   skin id for one block, from
//     the 'visuals.mix' setting ('mode' overrides it, for previews)
//   GBSkins.anim(seed, t, kind)            { scale, dy, rot } for kind 'idle' (breathing, t = now) or
//     'place' (t = ms since placement). dy is a fraction of the block size. Identity when animations
//     are off or reduced motion is on. Pass the result straight to draw(): draw(..., { scale, dy, rot }).
//   GBSkins.symbolFor(hex)                 colour-blind symbol name for a colour
//   GBSkins.clearCache() / stats()         sprite cache control
(() => {
'use strict';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const GS = window.GBSettings;

// ---------- colour helpers (colours are [r, g, b] arrays) ----------
const WHITE = [255, 255, 255];
const rgbMemo = new Map();
function hexRgb(h){
  let c = rgbMemo.get(h); if (c) return c;
  let s = String(h || '#888888').trim().replace('#', '');
  if (s.length === 3) s = s.replace(/./g, '$&$&');
  const n = parseInt(s.slice(0, 6), 16);
  c = isFinite(n) ? [n >> 16 & 255, n >> 8 & 255, n & 255] : [136, 136, 136];
  if (rgbMemo.size > 500) rgbMemo.clear();
  rgbMemo.set(h, c); return c;
}
const R8 = v => Math.round(clamp(v, 0, 255));
const css = (c, a) => a == null || a >= 1 ? `rgb(${R8(c[0])},${R8(c[1])},${R8(c[2])})` : `rgba(${R8(c[0])},${R8(c[1])},${R8(c[2])},${+Math.max(0, a).toFixed(3)})`;
// same maths as the game's original shade(): p < 0 darkens toward black, p > 0 lightens toward white
function sh(c, p){
  const t = p < 0 ? 0 : 255, a = Math.min(1, Math.abs(p));
  return [Math.round((t - c[0]) * a + c[0]), Math.round((t - c[1]) * a + c[1]), Math.round((t - c[2]) * a + c[2])];
}
const S = (c, p, a) => css(sh(c, p), a);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function rgb2hsl(c){
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0; const l = (mx + mn) / 2, d = mx - mn;
  if (d > 1e-6){
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}
function hsl2rgb(h, s, l){
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
// very light colours (the mint stage) need darker accents instead of white ones
const isLight = c => rgb2hsl(c)[2] > 0.8;
const hue = (c, dh, ds = 0, dl = 0) => { const [h, s, l] = rgb2hsl(c); return hsl2rgb(h + dh, s + ds, l + dl); };

// ---------- small maths ----------
function rng(seed){
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function hstr(s){ let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hint(n){ n = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return n >>> 0; }

// ---------- path helpers ----------
function rr(c, x, y, w, h, r){
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function poly(c, pts, fill){ c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); if (fill){ c.fillStyle = fill; c.fill(); } }
function dot(c, x, y, r, f){ c.beginPath(); c.arc(x, y, Math.max(0, r), 0, TAU); c.fillStyle = f; c.fill(); }
function ell(c, x, y, rx, ry, rot){ c.beginPath(); c.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot || 0, 0, TAU); }
function heartPath(c, cx, cy, s){
  c.beginPath(); c.moveTo(cx, cy + s * 0.36);
  c.bezierCurveTo(cx - s * 0.62, cy - s * 0.04, cx - s * 0.36, cy - s * 0.56, cx, cy - s * 0.2);
  c.bezierCurveTo(cx + s * 0.36, cy - s * 0.56, cx + s * 0.62, cy - s * 0.04, cx, cy + s * 0.36);
  c.closePath();
}
function starPath(c, cx, cy, ro, ri, n, rot){
  c.beginPath();
  for (let k = 0; k < n * 2; k++){ const r = k & 1 ? ri : ro, a = rot + k * Math.PI / n; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (k) c.lineTo(x, y); else c.moveTo(x, y); }
  c.closePath();
}
function grad(g, stops){ for (const [o, col] of stops) g.addColorStop(o, col); return g; }
const lin = (c, x0, y0, x1, y1, stops) => grad(c.createLinearGradient(x0, y0, x1, y1), stops);
const rad = (c, x0, y0, r0, x1, y1, r1, stops) => grad(c.createRadialGradient(x0, y0, r0, x1, y1, r1), stops);
// smooth closed blob through jittered points around (cx, cy)
function blob(c, cx, cy, r, n, jit, R){
  const pts = [];
  for (let k = 0; k < n; k++){ const a = k / n * TAU, q = r * (1 - jit / 2 + R() * jit); pts.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); }
  c.beginPath();
  const mid = k => { const a = pts[k % n], b = pts[(k + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  let m0 = mid(n - 1); c.moveTo(m0[0], m0[1]);
  for (let k = 0; k < n; k++){ const m = mid(k); c.quadraticCurveTo(pts[k][0], pts[k][1], m[0], m[1]); }
  c.closePath();
}

// ---------- shared block parts ----------
// K: { P, m (margin), R (corner radius from settings), r (this skin's outer radius), G (gloss gain),
//      B (bevel gain), v (variant), fr (frame), pattern, rnd() (seeded per skin + variant) }
// Glossy bevelled body, the game's original block: dark rim, lit top bevel, darker bottom bevel.
function body(c, P, col, K, rimP = -0.5, sc = [0.55, 0.25, -0.14, -0.34], bvK = 1){
  const m = K.m, w = P - 2 * m, r = K.r;
  rr(c, m, m, w, w, r); c.fillStyle = S(col, rimP); c.fill();
  const a = m + P * 0.03, b = P - a, bv = P * 0.15 * bvK * Math.min(K.B, 1.6), f = Math.min(K.B, 1.5);
  c.save(); rr(c, a, a, b - a, b - a, r * 0.7); c.clip();
  if (bv >= 0.5){
    poly(c, [a, a, b, a, b - bv, a + bv, a + bv, a + bv], S(col, sc[0] * f));
    poly(c, [a, a, a + bv, a + bv, a + bv, b - bv, a, b], S(col, sc[1] * f));
    poly(c, [b, a, b, b, b - bv, b - bv, b - bv, a + bv], S(col, sc[2] * f));
    poly(c, [a, b, b, b, b - bv, b - bv, a + bv, b - bv], S(col, sc[3] * f));
  }
  c.restore();
  const f0 = a + bv;
  return { a, b, f0, fw: b - bv - f0, fr: r * (0.035 / 0.09) };
}
function gloss(c, K, f0, fw, a){
  c.globalAlpha = clamp(a * K.G, 0, 0.95); c.fillStyle = '#fff';
  rr(c, f0 + fw * 0.08, f0 + fw * 0.08, fw * 0.6, fw * 0.16, fw * 0.08); c.fill();
  c.globalAlpha = 1;
}
// stage patterns, exactly as the original sprite drew them (k fades them for soft skins)
function pattern(c, pat, f0, fw, fr, k = 1){
  if (!pat) return;
  c.save(); rr(c, f0, f0, fw, fw, fr); c.clip();
  if (pat === 'gingham'){
    c.fillStyle = `rgba(255,255,255,${0.32 * k})`;
    for (let q = 0; q < 3; q++){ c.fillRect(f0, f0 + fw * (q / 3 + 0.08), fw, fw / 6); c.fillRect(f0 + fw * (q / 3 + 0.08), f0, fw / 6, fw); }
    c.fillStyle = `rgba(200,40,120,${0.16 * k})`;
    for (let q = 0; q < 3; q++) for (let p = 0; p < 3; p++) c.fillRect(f0 + fw * (q / 3 + 0.25), f0 + fw * (p / 3 + 0.25), fw / 12, fw / 12);
  } else if (pat === 'dots'){
    const dots = [[0.22, 0.3, '#ff8fb3'], [0.7, 0.24, '#ffc94d'], [0.5, 0.62, '#7fd2ff'], [0.2, 0.78, '#9be86a'], [0.8, 0.76, '#ff8fb3']];
    c.globalAlpha = k;
    for (const [dx, dy, dc] of dots){ c.fillStyle = dc; c.beginPath(); c.arc(f0 + fw * dx, f0 + fw * dy, fw * 0.075, 0, TAU); c.fill(); }
    c.globalAlpha = 1;
  }
  c.restore();
}
// flat tile: rim at the margin, returns the inner square { i, iw, ir }
function tile(c, P, K, rimFill, inset = 0.04){
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = rimFill; c.fill();
  const i = m + P * inset; return { i, iw: P - 2 * i, ir: Math.max(0, K.r - P * inset * 0.8) };
}
function clipIn(c, g){ c.save(); rr(c, g.i, g.i, g.iw, g.iw, g.ir); c.clip(); }
function fillIn(c, g, f){ rr(c, g.i, g.i, g.iw, g.iw, g.ir); c.fillStyle = f; c.fill(); }
function cushion(c, P, k = 1){
  c.fillStyle = rad(c, P * 0.42, P * 0.36, P * 0.05, P * 0.5, P * 0.5, P * 0.72, [[0, `rgba(255,255,255,${0.26 * k})`], [0.5, 'rgba(255,255,255,0)'], [1, `rgba(0,0,0,${0.3 * k})`]]);
  c.fillRect(0, 0, P, P);
}
function stitch(c, P, g, color){
  const o = P * 0.085; c.save(); c.setLineDash([P * 0.06, P * 0.045]); c.lineWidth = Math.max(1, P * 0.022); c.lineCap = 'round';
  c.strokeStyle = color; rr(c, g.i + o, g.i + o, g.iw - 2 * o, g.iw - 2 * o, Math.max(0, g.ir - o * 0.6)); c.stroke(); c.restore();
}
// facet shading: brighter toward the top-left light
function facet(c, pts, col, cx, cy, k, jit){
  let x = 0, y = 0; for (let i = 0; i < pts.length; i += 2){ x += pts[i]; y += pts[i + 1]; }
  x = x / (pts.length / 2) - cx; y = y / (pts.length / 2) - cy;
  const d = Math.hypot(x, y) || 1, l = (-x - y) / d * 0.7071;
  poly(c, pts, S(col, l * k + jit));
}
// split convex polygons by the line through (x0, y0)-(x1, y1)
function splitPolys(polys, x0, y0, x1, y1){
  const out = [];
  for (const p of polys){
    const A = [], B = [], n = p.length / 2;
    const side = i => (x1 - x0) * (p[i * 2 + 1] - y0) - (y1 - y0) * (p[i * 2] - x0);
    for (let i = 0; i < n; i++){
      const j = (i + 1) % n, si = side(i), sj = side(j);
      (si >= 0 ? A : B).push(p[i * 2], p[i * 2 + 1]);
      if ((si >= 0) !== (sj >= 0)){
        const t = si / (si - sj), x = p[i * 2] + (p[j * 2] - p[i * 2]) * t, y = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t;
        A.push(x, y); B.push(x, y);
      }
    }
    if (A.length >= 6) out.push(A); if (B.length >= 6) out.push(B);
  }
  return out;
}
const INK = '#3b1d2e';
function eyes(c, P, open, ex, ey, er, ink = INK){
  for (const x of ex){
    if (open){
      ell(c, P * x, P * ey, er * 0.82, er); c.fillStyle = ink; c.fill();
      dot(c, P * x - er * 0.28, P * ey - er * 0.38, er * 0.36, '#fff');
      dot(c, P * x + er * 0.3, P * ey + er * 0.35, er * 0.14, 'rgba(255,255,255,.85)');
    } else {
      c.beginPath(); c.arc(P * x, P * ey - er * 0.35, er * 0.85, 0.18 * Math.PI, 0.82 * Math.PI);
      c.strokeStyle = ink; c.lineWidth = Math.max(1, P * 0.042); c.lineCap = 'round'; c.stroke();
    }
  }
}
function blush(c, P, y = 0.64, x = 0.2){
  c.fillStyle = 'rgba(255,92,140,.42)';
  ell(c, P * x, P * y, P * 0.085, P * 0.05); c.fill(); ell(c, P * (1 - x), P * y, P * 0.085, P * 0.05); c.fill();
}

// ---------- the skins ----------
// paint(c, P, col, K) draws the static sprite. fx lists the cheap animated overlays:
//   glint: shimmer sweep strength   tw: twinkle points [[u, v, size]] or (v, rnd) => points
//   blink: true | [variants]        flicker / pulse / beat / rainbow / pix: special effects
//   drift: [u, v, w, h] wobbling highlight
// rk / rmin: outer corner radius = max(corner * rk, rmin) * P. pat: honours the stage pattern.
const SKINS = [], BY = Object.create(null);
function add(id, name, tags, o){ const s = Object.assign({ id, name, tags, n: 1, rk: 1, rmin: 0, fx: null }, o); SKINS.push(s); BY[id] = s; }

add('classic', 'Classic glossy', ['shiny', 'original'], { pat: true, paint(c, P, col, K){
  const f = body(c, P, col, K);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, 0.14)], [1, S(col, -0.06)]]); c.fill();
  pattern(c, K.pattern, f.f0, f.fw, f.fr);
  gloss(c, K, f.f0, f.fw, 0.38);
} });

add('jelly', 'Jelly', ['sweet', 'shiny', 'cute'], { n: 3, rk: 1.7, rmin: 0.13, fx: { drift: [0.66, 0.34, 0.22, 0.14] }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.42), 0.035);
  fillIn(c, g, rad(c, P * 0.5, P * 0.64, P * 0.04, P * 0.5, P * 0.5, P * 0.64, [[0, S(col, 0.45)], [0.55, css(col)], [1, S(col, -0.24)]]));
  clipIn(c, g);
  c.lineWidth = P * 0.06; c.strokeStyle = S(col, 0.4, 0.4); rr(c, g.i + P * 0.05, g.i + P * 0.05, g.iw - P * 0.1, g.iw - P * 0.1, g.ir * 0.8); c.stroke();
  c.fillStyle = rad(c, P * 0.5, P * 0.88, 0, P * 0.5, P * 0.88, P * 0.4, [[0, S(col, 0.75, 0.6)], [1, S(col, 0.75, 0)]]); c.fillRect(0, 0, P, P);
  const R = K.rnd;
  for (let k = 0; k < 3; k++){
    const bx = g.i + g.iw * (0.22 + R() * 0.56), by = g.i + g.iw * (0.5 + R() * 0.32), br = P * (0.022 + R() * 0.026);
    c.beginPath(); c.arc(bx, by, br, 0, TAU); c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = Math.max(1, P * 0.012); c.stroke();
    dot(c, bx - br * 0.35, by - br * 0.35, br * 0.32, 'rgba(255,255,255,.85)');
  }
  c.restore();
  c.globalAlpha = clamp(0.6 * K.G, 0, 0.95); c.fillStyle = '#fff'; ell(c, P * 0.38, P * 0.22, P * 0.22, P * 0.07, -0.12); c.fill(); c.globalAlpha = 1;
} });

add('gem', 'Gem', ['shiny', 'fancy'], { n: 2, rk: 0.5, fx: { glint: 0.9, tw: [[0.3, 0.3, 0.42], [0.74, 0.64, 0.3]] }, paint(c, P, col, K){
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = S(col, -0.62); c.fill();
  const a = m + P * 0.035, b = P - a, M = (a + b) / 2, w = b - a, R = K.rnd, k = 0.5 * Math.min(K.B, 1.4) + 0.05;
  const A = [a, a], B = [b, a], C = [b, b], D = [a, b], T = [M, a], Rt = [b, M], Bt = [M, b], L = [a, M];
  let tris, table;
  if (K.v === 0){
    const p = a + w * 0.27, q = b - w * 0.27, tp = [p, p], tq = [q, p], tr = [q, q], ts = [p, q];
    tris = [[A, T, tp], [T, B, tq], [T, tq, tp], [B, Rt, tq], [Rt, C, tr], [Rt, tr, tq], [C, Bt, tr], [Bt, D, ts], [Bt, ts, tr], [D, L, ts], [L, A, tp], [L, tp, ts]];
    table = [p, p, q, p, q, q, p, q];
  } else {
    const h = w * 0.17, tT = [M, a + h], tR = [b - h, M], tB = [M, b - h], tL = [a + h, M];
    tris = [[A, T, tT], [A, tT, tL], [A, tL, L], [B, Rt, tR], [B, tR, tT], [B, tT, T], [C, Bt, tB], [C, tB, tR], [C, tR, Rt], [D, L, tL], [D, tL, tB], [D, tB, Bt]];
    table = [tT[0], tT[1], tR[0], tR[1], tB[0], tB[1], tL[0], tL[1]];
  }
  c.save(); rr(c, a, a, w, w, K.r * 0.6); c.clip();
  for (const t of tris) facet(c, [t[0][0], t[0][1], t[1][0], t[1][1], t[2][0], t[2][1]], col, M, M, k, (R() - 0.5) * 0.12);
  poly(c, table, lin(c, a, a, b, b, [[0, S(col, 0.38)], [0.55, S(col, 0.05)], [1, S(col, -0.18)]]));
  c.globalAlpha = clamp(0.3 * K.G, 0, 0.9); poly(c, [M - w * 0.2, a + w * 0.3, M - w * 0.05, a + w * 0.3, M - w * 0.3, b - w * 0.3, M - w * 0.42, b - w * 0.3], '#fff'); c.globalAlpha = 1;
  c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = Math.max(1, P * 0.012);
  for (const t of tris){ poly(c, [t[0][0], t[0][1], t[1][0], t[1][1], t[2][0], t[2][1]]); c.stroke(); }
  c.restore();
} });

add('candy', 'Candy', ['sweet', 'fun'], { n: 3, rk: 1.5, rmin: 0.1, fx: { glint: 0.8 }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.45), 0.035);
  clipIn(c, g);
  c.fillStyle = css(col); c.fillRect(0, 0, P, P);
  c.fillStyle = isLight(col) ? css(hue(col, 0, 0.2, -0.32)) : 'rgba(255,255,255,.9)';
  if (K.v === 1){
    const cx = P / 2, R0 = P * 0.8, tw = 2.4;
    for (let k = 0; k < 8; k += 2){
      const a0 = k * TAU / 8, a1 = (k + 1) * TAU / 8; c.beginPath(); c.moveTo(cx, cx);
      for (let s = 0; s <= 12; s++){ const q = R0 * s / 12, an = a0 + tw * s / 12; c.lineTo(cx + Math.cos(an) * q, cx + Math.sin(an) * q); }
      for (let s = 12; s >= 0; s--){ const q = R0 * s / 12, an = a1 + tw * s / 12; c.lineTo(cx + Math.cos(an) * q, cx + Math.sin(an) * q); }
      c.closePath(); c.fill();
    }
    dot(c, cx, cx, P * 0.05, css(col));
  } else {
    const d = K.v === 0 ? 1 : -1, sw = P * 0.12, gap = P * 0.29;
    for (let k = -P; k < P * 2; k += gap){
      c.beginPath();
      if (d > 0){ c.moveTo(k, 0); c.lineTo(k + sw, 0); c.lineTo(k + sw - P, P); c.lineTo(k - P, P); }
      else { c.moveTo(k, 0); c.lineTo(k + sw, 0); c.lineTo(k + sw + P, P); c.lineTo(k + P, P); }
      c.fill();
    }
  }
  c.fillStyle = rad(c, P * 0.4, P * 0.36, P * 0.05, P * 0.5, P * 0.5, P * 0.72, [[0, 'rgba(255,255,255,.2)'], [0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.35)']]); c.fillRect(0, 0, P, P);
  c.restore();
  c.globalAlpha = clamp(0.55 * K.G, 0, 0.95); c.fillStyle = '#fff'; ell(c, P * 0.34, P * 0.24, P * 0.16, P * 0.06, -0.5); c.fill(); c.globalAlpha = 1;
} });

add('glass', 'Glass', ['shiny', 'fancy'], { fx: { glint: 1 }, paint(c, P, col, K){
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = S(col, -0.35); c.fill();
  const i = m + P * 0.04, iw = P - 2 * i, ir = Math.max(0, K.r - P * 0.03);
  c.save(); rr(c, i, i, iw, iw, ir); c.clip();
  c.clearRect(0, 0, P, P);
  c.fillStyle = css(sh(col, 0.1), 0.55); c.fillRect(0, 0, P, P);
  c.strokeStyle = S(col, 0.15, 0.38);
  for (let k = 0; k < 4; k++){ c.lineWidth = P * (0.24 - k * 0.055); rr(c, i, i, iw, iw, ir); c.stroke(); }
  c.fillStyle = lin(c, 0, 0, P, P, [[0, 'rgba(255,255,255,.4)'], [0.45, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,.06)']]); c.fillRect(0, 0, P, P);
  c.globalAlpha = clamp(0.5 * K.G, 0, 0.95);
  poly(c, [P * 0.6, 0, P * 0.78, 0, P * 0.22, P, P * 0.04, P], 'rgba(255,255,255,.45)');
  poly(c, [P * 0.86, 0, P * 0.92, 0, P * 0.36, P, P * 0.3, P], 'rgba(255,255,255,.55)');
  c.globalAlpha = 1;
  c.lineWidth = Math.max(1, P * 0.035);
  c.strokeStyle = lin(c, 0, 0, P, P, [[0, 'rgba(255,255,255,.95)'], [0.42, 'rgba(255,255,255,0)'], [0.62, S(col, 0.5, 0)], [1, S(col, 0.55, 0.9)]]);
  rr(c, i + P * 0.02, i + P * 0.02, iw - P * 0.04, iw - P * 0.04, ir * 0.8); c.stroke();
  c.restore();
} });

add('neon', 'Neon', ['glow', 'retro'], { n: 2, fx: { flicker: true }, paint(c, P, col, K){
  const m = K.m, dark = mix(sh(col, -0.84), [8, 6, 22], 0.4);
  rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = css(dark); c.fill();
  c.lineWidth = Math.max(1, P * 0.02); c.strokeStyle = css(col, 0.45); rr(c, m + P * 0.01, m + P * 0.01, P - 2 * m - P * 0.02, P - 2 * m - P * 0.02, K.r); c.stroke();
  const on = K.fr === 0, o = P * 0.19;
  if (on){ c.fillStyle = rad(c, P / 2, P / 2, 0, P / 2, P / 2, P * 0.5, [[0, css(col, 0.28)], [1, css(col, 0.04)]]); rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fill(); }
  const tube = path => {
    c.save(); c.lineCap = c.lineJoin = 'round';
    if (on){ c.shadowColor = css(col); c.shadowBlur = P * 0.16; }
    c.strokeStyle = on ? S(col, 0.12) : S(col, -0.45); c.lineWidth = P * 0.08; path(); c.stroke();
    if (on){ c.shadowBlur = P * 0.06; c.stroke(); }
    c.restore();
    if (on){ c.strokeStyle = S(col, 0.72); c.lineWidth = Math.max(1, P * 0.028); path(); c.stroke(); }
  };
  tube(() => rr(c, o, o, P - 2 * o, P - 2 * o, Math.max(P * 0.06, K.r * 0.8)));
  if (K.v === 1) tube(() => { c.beginPath(); c.moveTo(P / 2, P * 0.38); c.lineTo(P * 0.62, P / 2); c.lineTo(P / 2, P * 0.62); c.lineTo(P * 0.38, P / 2); c.closePath(); });
} });

add('pixel', 'Pixel 8-bit', ['retro', 'fun'], { n: 2, rk: 0, fx: { pix: true }, paint(c, P, col, K){
  const q = k => Math.round(k * P / 8);
  const px = (x, y, f) => { c.fillStyle = f; c.fillRect(q(x), q(y), q(x + 1) - q(x), q(y + 1) - q(y)); };
  const O = S(col, -0.6), L = S(col, 0.4), D = S(col, -0.28), B = css(col), H = S(col, 0.82), D2 = S(col, -0.13);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++){
    if ((x === 0 || x === 7) && (y === 0 || y === 7)) continue;
    let f = B;
    if (x === 0 || x === 7 || y === 0 || y === 7) f = O;
    else if (y === 1 || x === 1) f = (x === 6 || y === 6) ? B : L;
    else if (y === 6 || x === 6) f = D;
    else if (K.v === 1 && (x + y) % 2 === 0 && x + y >= 8) f = D2;
    px(x, y, f);
  }
  px(1, 1, B); px(2, 2, H);
  if (K.v === 0){ px(3, 2, H); px(2, 3, H); } else { px(3, 2, L); px(2, 3, L); }
} });

add('wood', 'Wood', ['nature', 'cozy'], { n: 3, fx: null, paint(c, P, col, K){
  const base = mix(col, [196, 142, 88], 0.4);
  const f = body(c, P, base, K, -0.6, [0.32, 0.16, -0.14, -0.32], 0.55);
  c.save(); rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.clip();
  c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(base, 0.1)], [1, S(base, -0.08)]]); c.fillRect(0, 0, P, P);
  const R = K.rnd, ctr = [[P * 0.5, P * 1.45, 1, 0.42], [P * 0.7, P * 0.38, 1, 0.55], [P * -0.5, P * 0.5, 0.45, 1]][K.v];
  for (let k = 1; k < 26; k++){
    const rx = P * 0.055 * k * ctr[2] * 2.2, ry = P * 0.055 * k * ctr[3] * 2.2, ph = R() * TAU;
    c.beginPath();
    for (let s = 0; s <= 64; s++){ const a = s / 64 * TAU, w = 1 + 0.035 * Math.sin(a * 5 + ph) + 0.02 * Math.sin(a * 11 + k); const x = ctr[0] + Math.cos(a) * rx * w, y = ctr[1] + Math.sin(a) * ry * w; if (s) c.lineTo(x, y); else c.moveTo(x, y); }
    c.strokeStyle = S(base, -0.2 - R() * 0.2, 0.5 + R() * 0.25); c.lineWidth = P * (0.008 + R() * 0.02); c.stroke();
  }
  if (K.v === 1){ ell(c, ctr[0], ctr[1], P * 0.05, P * 0.03); c.fillStyle = S(base, -0.5); c.fill(); }
  c.restore();
  gloss(c, K, f.f0, f.fw, 0.18);
} });

add('stone', 'Cobblestone', ['nature', 'cozy'], { n: 3, paint(c, P, col, K){
  const base = mix(col, [134, 130, 126], 0.42);
  const g = tile(c, P, K, S(base, -0.62), 0.035);
  fillIn(c, g, S(base, -0.45));
  clipIn(c, g);
  const R = K.rnd, gp = P * 0.03;
  const lay = [[[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
               [[0, 0, 1, 0.46], [0, 0.46, 0.56, 0.54], [0.56, 0.46, 0.44, 0.54]],
               [[0, 0, 0.6, 0.55], [0.6, 0, 0.4, 0.55], [0, 0.55, 0.4, 0.45], [0.4, 0.55, 0.6, 0.45]]][K.v];
  for (const [rx, ry, rw, rh] of lay){
    const x = g.i + g.iw * rx + gp + (R() - 0.5) * gp, y = g.i + g.iw * ry + gp + (R() - 0.5) * gp;
    const w = g.iw * rw - gp * 2, h = g.iw * rh - gp * 2, rad_ = Math.min(w, h) * (0.32 + R() * 0.12);
    rr(c, x + P * 0.015, y + P * 0.022, w, h, rad_); c.fillStyle = 'rgba(0,0,0,.35)'; c.fill();
    const st = sh(base, (R() - 0.5) * 0.24);
    rr(c, x, y, w, h, rad_); c.fillStyle = lin(c, x, y, x + w, y + h, [[0, S(st, 0.32)], [0.5, css(st)], [1, S(st, -0.22)]]); c.fill();
    c.save(); rr(c, x, y, w, h, rad_); c.clip();
    for (let k = 0; k < 6; k++) dot(c, x + R() * w, y + R() * h, P * (0.006 + R() * 0.01), R() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.22)');
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = Math.max(1, P * 0.015); rr(c, x + P * 0.01, y + P * 0.01, w, h, rad_); c.stroke();
    c.restore();
  }
  c.restore();
} });

add('metal', 'Brushed metal', ['shiny', 'cool'], { fx: { glint: 0.55 }, paint(c, P, col, K){
  const base = sh(mix(col, [176, 180, 188], 0.32), -0.06);
  const f = body(c, P, base, K, -0.6, [0.5, 0.25, -0.15, -0.35], 0.5);
  c.save(); rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.clip();
  c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(base, 0.32)], [0.5, css(base)], [1, S(base, -0.2)]]); c.fillRect(0, 0, P, P);
  const R = K.rnd, step = Math.max(1, P / 50);
  for (let y = f.f0; y < f.f0 + f.fw; y += step){ c.fillStyle = R() < 0.5 ? `rgba(255,255,255,${(0.08 + R() * 0.16).toFixed(3)})` : `rgba(0,0,0,${(0.06 + R() * 0.1).toFixed(3)})`; c.fillRect(f.f0, y, f.fw, Math.max(0.6, step * 0.5)); }
  c.restore();
  const o = f.fw * 0.15, rv = Math.max(1, P * 0.034);
  for (const [x, y] of [[f.f0 + o, f.f0 + o], [f.f0 + f.fw - o, f.f0 + o], [f.f0 + o, f.f0 + f.fw - o], [f.f0 + f.fw - o, f.f0 + f.fw - o]]){
    dot(c, x + rv * 0.3, y + rv * 0.4, rv, 'rgba(0,0,0,.35)');
    dot(c, x, y, rv, rad(c, x - rv * 0.4, y - rv * 0.4, 0, x, y, rv, [[0, S(base, 0.7)], [1, S(base, -0.3)]]));
  }
} });

add('chrome', 'Chrome', ['shiny', 'cool'], { fx: { glint: 1.2 }, paint(c, P, col, K){
  const f = body(c, P, col, K, -0.62, [0.85, 0.45, -0.3, -0.62], 0.75);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr);
  c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, 0.85)], [0.34, S(col, 0.22)], [0.49, S(col, -0.55)], [0.53, S(col, -0.2)], [0.8, S(col, 0.38)], [1, S(col, 0.08)]]);
  c.fill();
  c.globalAlpha = clamp(0.75 * K.G, 0, 1); c.fillStyle = '#fff';
  rr(c, f.f0 + f.fw * 0.1, f.f0 + f.fw * 0.1, f.fw * 0.8, Math.max(1, f.fw * 0.06), f.fw * 0.03); c.fill(); c.globalAlpha = 1;
} });

add('gold', 'Gold & enamel', ['fancy', 'shiny'], { fx: { glint: 1, tw: [[0.16, 0.16, 0.36], [0.84, 0.84, 0.28]] }, paint(c, P, col, K){
  const G1 = [255, 240, 160], G2 = [242, 194, 62], G3 = [176, 116, 22], G4 = [92, 58, 10];
  const m = K.m, r = K.r; rr(c, m, m, P - 2 * m, P - 2 * m, r); c.fillStyle = css(G4); c.fill();
  const a = m + P * 0.03, b = P - a, bv = P * 0.16;
  c.save(); rr(c, a, a, b - a, b - a, r * 0.7); c.clip();
  poly(c, [a, a, b, a, b - bv, a + bv, a + bv, a + bv], lin(c, a, a, b, a, [[0, css(G1)], [0.5, css(G2)], [1, css(G1)]]));
  poly(c, [a, a, a + bv, a + bv, a + bv, b - bv, a, b], css(mix(G1, G2, 0.55)));
  poly(c, [b, a, b, b, b - bv, b - bv, b - bv, a + bv], css(G3));
  poly(c, [a, b, b, b, b - bv, b - bv, a + bv, b - bv], css(mix(G3, G4, 0.35)));
  c.restore();
  const f0 = a + bv, fw = b - bv - f0;
  rr(c, f0 - P * 0.012, f0 - P * 0.012, fw + P * 0.024, fw + P * 0.024, r * 0.45); c.fillStyle = css(G4); c.fill();
  rr(c, f0, f0, fw, fw, r * 0.4);
  c.fillStyle = rad(c, f0 + fw * 0.35, f0 + fw * 0.3, fw * 0.04, f0 + fw * 0.5, f0 + fw * 0.5, fw * 0.78, [[0, S(col, 0.5)], [0.5, css(col)], [1, S(col, -0.38)]]); c.fill();
  gloss(c, K, f0, fw, 0.45);
} });

add('marble', 'Marble', ['fancy', 'nature'], { n: 3, fx: { glint: 0.45 }, paint(c, P, col, K){
  const base = mix(col, WHITE, 0.4);
  const g = tile(c, P, K, S(col, -0.4), 0.035);
  fillIn(c, g, lin(c, 0, 0, P, P, [[0, S(base, 0.3)], [1, S(base, -0.06)]]));
  clipIn(c, g);
  const R = K.rnd;
  for (let k = 0; k < 3; k++){ const x = P * R(), y = P * R(), q = P * (0.25 + R() * 0.25); c.fillStyle = rad(c, x, y, 0, x, y, q, [[0, css(col, 0.35)], [1, css(col, 0)]]); c.fillRect(0, 0, P, P); }
  const vein = (w, a) => {
    let x = R() < 0.5 ? -P * 0.1 : P * R(), y = x < 0 ? P * R() : -P * 0.1, ang = Math.atan2(P * 0.5 - y, P * 0.5 - x) + (R() - 0.5) * 1.2;
    c.beginPath(); c.moveTo(x, y);
    for (let s = 0; s < 14; s++){ ang += (R() - 0.5) * 0.9; x += Math.cos(ang) * P * 0.1; y += Math.sin(ang) * P * 0.1; c.lineTo(x, y); }
    c.strokeStyle = S(col, -0.32, a); c.lineWidth = w; c.lineJoin = 'round'; c.stroke();
  };
  vein(Math.max(1, P * 0.03), 0.75); vein(Math.max(1, P * 0.016), 0.6); vein(Math.max(0.7, P * 0.009), 0.5); c.strokeStyle = 'rgba(255,255,255,.5)'; vein(Math.max(0.7, P * 0.012), 0.5);
  c.fillStyle = lin(c, 0, 0, P, P, [[0.15, 'rgba(255,255,255,0)'], [0.28, 'rgba(255,255,255,.35)'], [0.4, 'rgba(255,255,255,0)']]); c.globalAlpha = clamp(K.G, 0, 1.5) / 1.5; c.fillRect(0, 0, P, P); c.globalAlpha = 1;
  c.restore();
} });

add('gingham', 'Gingham', ['fabric', 'cozy', 'cute'], { rk: 1.2, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.45), 0.035);
  clipIn(c, g);
  c.fillStyle = css(mix(col, WHITE, 0.84)); c.fillRect(0, 0, P, P);
  const n = 3, bw = g.iw / (n * 2); c.fillStyle = isLight(col) ? css(hue(col, 0, 0.2, -0.3), 0.55) : css(col, 0.55);
  for (let k = 0; k < n; k++){ c.fillRect(g.i, g.i + bw * (2 * k + 0.5), g.iw, bw); c.fillRect(g.i + bw * (2 * k + 0.5), g.i, bw, g.iw); }
  c.fillStyle = 'rgba(255,255,255,.12)'; for (let y = g.i; y < g.i + g.iw; y += Math.max(1.5, P / 30)) c.fillRect(g.i, y, g.iw, Math.max(0.5, P / 90));
  cushion(c, P, 0.9);
  c.restore();
  stitch(c, P, g, S(col, -0.4, 0.85));
} });

add('polka', 'Polka dots', ['fabric', 'cute'], { n: 2, rk: 1.2, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.45), 0.035);
  clipIn(c, g);
  c.fillStyle = css(col); c.fillRect(0, 0, P, P);
  const dc = isLight(col) ? css(hue(col, 0, 0.2, -0.3)) : K.v === 0 ? 'rgba(255,255,255,.92)' : S(col, 0.45), r = g.iw * (K.v === 0 ? 0.1 : 0.13);
  for (let row = 0; row < 3; row++) for (let k = -1; k < 3; k++) dot(c, g.i + g.iw * (k * 0.5 + (row % 2) * 0.25 + 0.25), g.i + g.iw * (row * 0.5), r, dc);
  cushion(c, P, 1);
  c.restore();
  stitch(c, P, g, S(col, -0.38, 0.8));
} });

add('knit', 'Knitted', ['fabric', 'cozy'], { rk: 1.2, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.48), 0.035);
  clipIn(c, g);
  c.fillStyle = S(col, -0.25); c.fillRect(0, 0, P, P);
  const cols = 3, rows = 4, sw = g.iw / cols, sv = g.iw / rows;
  for (let r = -1; r <= rows; r++) for (let k = 0; k < cols; k++){
    const cx = g.i + sw * (k + 0.5), cy = g.i + sv * (r + 0.5);
    for (const s of [-1, 1]){
      ell(c, cx + s * sw * 0.21, cy, sw * 0.2, sv * 0.62, s * 0.55);
      c.fillStyle = lin(c, cx, cy - sv * 0.6, cx, cy + sv * 0.6, [[0, S(col, 0.22)], [1, S(col, -0.06)]]); c.fill();
      c.strokeStyle = S(col, -0.4, 0.7); c.lineWidth = Math.max(0.7, P * 0.012); c.stroke();
    }
  }
  cushion(c, P, 0.8);
  c.restore();
} });

add('face', 'Cute faces', ['cute', 'fun'], { n: 4, rk: 1.9, rmin: 0.15, fx: { blink: true }, paint(c, P, col, K){
  const f = body(c, P, col, K, -0.48, [0.42, 0.2, -0.1, -0.26], 0.6);
  rr(c, f.f0, f.f0, f.fw, f.fw, K.r * 0.6); c.fillStyle = rad(c, P * 0.45, P * 0.38, P * 0.05, P * 0.5, P * 0.5, P * 0.6, [[0, S(col, 0.2)], [1, S(col, -0.04)]]); c.fill();
  gloss(c, K, f.f0, f.fw, 0.3);
  blush(c, P, 0.65, 0.21);
  eyes(c, P, K.fr === 0, [0.33, 0.67], 0.47, P * 0.095);
  c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = Math.max(1.2, P * 0.045); c.lineCap = 'round'; c.lineJoin = 'round';
  if (K.v === 0){ c.beginPath(); c.arc(P / 2, P * 0.6, P * 0.09, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); }
  else if (K.v === 1){ ell(c, P / 2, P * 0.68, P * 0.05, P * 0.06); c.fill(); }
  else if (K.v === 2){ c.beginPath(); c.arc(P * 0.445, P * 0.62, P * 0.055, 0.1 * Math.PI, 0.95 * Math.PI); c.moveTo(P * 0.61, P * 0.64); c.arc(P * 0.555, P * 0.62, P * 0.055, 0.05 * Math.PI, 0.9 * Math.PI); c.stroke(); }
  else { c.beginPath(); c.moveTo(P * 0.39, P * 0.59); c.lineTo(P * 0.61, P * 0.59); c.arc(P / 2, P * 0.59, P * 0.11, 0, Math.PI); c.closePath(); c.fill(); ell(c, P / 2, P * 0.665, P * 0.055, P * 0.027); c.fillStyle = '#ff7a9c'; c.fill(); }
} });

add('emoji', 'Emoji moods', ['cute', 'fun'], { n: 4, fx: { blink: [2] }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.5));
  fillIn(c, g, lin(c, 0, g.i, 0, g.i + g.iw, [[0, S(col, -0.02)], [1, S(col, -0.22)]]));
  const cx = P / 2, cy = P / 2, R0 = P * 0.37;
  dot(c, cx + P * 0.015, cy + P * 0.025, R0, 'rgba(0,0,0,.25)');
  dot(c, cx, cy, R0, rad(c, cx - R0 * 0.35, cy - R0 * 0.4, R0 * 0.1, cx, cy, R0, [[0, S(col, 0.62)], [0.6, S(col, 0.3)], [1, S(col, 0.05)]]));
  c.lineWidth = Math.max(1, P * 0.022); c.strokeStyle = S(col, -0.45); c.beginPath(); c.arc(cx, cy, R0, 0, TAU); c.stroke();
  c.strokeStyle = INK; c.fillStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = Math.max(1, P * 0.034);
  const ey = P * 0.45, ex = [0.38, 0.62];
  if (K.v === 0){
    for (const x of ex){ heartPath(c, P * x, ey, P * 0.17); c.fillStyle = '#ff3b6b'; c.fill(); c.strokeStyle = '#b3123c'; c.lineWidth = Math.max(0.8, P * 0.012); c.stroke(); }
    c.strokeStyle = INK; c.lineWidth = Math.max(1, P * 0.034); c.beginPath(); c.arc(cx, P * 0.56, P * 0.11, 0.18 * Math.PI, 0.82 * Math.PI); c.stroke();
  } else if (K.v === 1){
    c.fillStyle = '#1a1420'; rr(c, P * 0.26, P * 0.38, P * 0.21, P * 0.13, P * 0.05); c.fill(); rr(c, P * 0.53, P * 0.38, P * 0.21, P * 0.13, P * 0.05); c.fill();
    c.fillRect(P * 0.45, P * 0.4, P * 0.1, P * 0.03);
    c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = Math.max(0.8, P * 0.014); c.beginPath(); c.moveTo(P * 0.3, P * 0.41); c.lineTo(P * 0.36, P * 0.41); c.moveTo(P * 0.57, P * 0.41); c.lineTo(P * 0.63, P * 0.41); c.stroke();
    c.strokeStyle = INK; c.lineWidth = Math.max(1, P * 0.034); c.beginPath(); c.moveTo(P * 0.42, P * 0.64); c.quadraticCurveTo(P * 0.54, P * 0.69, P * 0.62, P * 0.6); c.stroke();
  } else if (K.v === 2){
    eyes(c, P, K.fr === 0, [0.38], 0.45, P * 0.06);
    c.strokeStyle = INK; c.lineWidth = Math.max(1, P * 0.034); c.beginPath(); c.moveTo(P * 0.55, P * 0.45); c.lineTo(P * 0.66, P * 0.43); c.stroke();
    c.beginPath(); c.arc(cx, P * 0.56, P * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    ell(c, P * 0.535, P * 0.66, P * 0.04, P * 0.05); c.fillStyle = '#ff6f91'; c.fill();
  } else {
    for (const x of ex){ c.beginPath(); c.arc(P * x, ey + P * 0.03, P * 0.05, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); }
    c.beginPath(); c.moveTo(P * 0.36, P * 0.56); c.lineTo(P * 0.64, P * 0.56); c.arc(cx, P * 0.56, P * 0.14, 0, Math.PI); c.closePath(); c.fill();
    ell(c, cx, P * 0.65, P * 0.07, P * 0.035); c.fillStyle = '#ff6f91'; c.fill();
    c.fillStyle = '#7fd6ff'; for (const s of [-1, 1]){ c.beginPath(); c.ellipse(cx + s * P * 0.25, P * 0.53, P * 0.035, P * 0.05, 0, 0, TAU); c.fill(); }
  }
} });

add('cupcake', 'Cupcake', ['sweet', 'food', 'cute'], { n: 3, rk: 1.3, fx: { tw: [[0.3, 0.2, 0.3]] }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.52), 0.035);
  clipIn(c, g);
  const y0 = g.i + g.iw * 0.56, wrap = sh(col, -0.25), n = 7, sw = g.iw / n;
  for (let k = 0; k < n; k++){ c.fillStyle = k % 2 ? S(wrap, 0.12) : S(wrap, -0.1); c.fillRect(g.i + k * sw, y0, sw + 0.5, g.iw); }
  c.fillStyle = lin(c, 0, y0, 0, g.i + g.iw, [[0, 'rgba(0,0,0,.25)'], [0.3, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.2)']]); c.fillRect(0, y0, P, P);
  const F = mix(col, WHITE, 0.3), R = K.rnd;
  c.beginPath(); c.moveTo(g.i - 1, g.i - 1); c.lineTo(g.i + g.iw + 1, g.i - 1); c.lineTo(g.i + g.iw + 1, y0);
  const drips = 4, dw = (g.iw + 2) / drips;
  for (let k = 0; k < drips; k++){ const xr = g.i + g.iw + 1 - k * dw, d = P * (0.04 + R() * 0.16); c.bezierCurveTo(xr, y0 + d * 1.3, xr - dw, y0 + d * 1.3, xr - dw, y0); }
  c.closePath();
  c.fillStyle = lin(c, 0, g.i, 0, y0 + P * 0.15, [[0, S(F, 0.4)], [1, css(F)]]); c.fill();
  c.strokeStyle = S(F, -0.22, 0.7); c.lineWidth = Math.max(1, P * 0.015); c.stroke();
  const SP = ['#ff5d8f', '#ffd93b', '#4fc8ff', '#74df5f', '#ffffff', '#b07cff'];
  c.lineCap = 'round'; c.lineWidth = Math.max(1.2, P * 0.034);
  for (let k = 0; k < 7; k++){
    const x = g.i + g.iw * (0.14 + R() * 0.72), y = g.i + g.iw * (0.12 + R() * 0.36), a = R() * Math.PI, l = P * 0.035;
    c.strokeStyle = SP[(k + K.v) % SP.length]; c.beginPath(); c.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  c.globalAlpha = clamp(0.45 * K.G, 0, 0.9); ell(c, g.i + g.iw * 0.28, g.i + g.iw * 0.16, g.iw * 0.14, g.iw * 0.05, -0.2); c.fillStyle = '#fff'; c.fill(); c.globalAlpha = 1;
  c.restore();
} });

add('ice', 'Ice', ['cool', 'shiny'], { n: 3, fx: { glint: 1, tw: [[0.72, 0.28, 0.36], [0.28, 0.76, 0.26]] }, paint(c, P, col, K){
  const base = mix(col, [226, 243, 255], 0.36);
  const g = tile(c, P, K, S(col, -0.42), 0.035);
  fillIn(c, g, lin(c, 0, 0, P, P, [[0, S(base, 0.5)], [0.5, css(base)], [1, css(mix(col, base, 0.35))]]));
  clipIn(c, g);
  c.fillStyle = rad(c, P * 0.56, P * 0.62, 0, P * 0.56, P * 0.62, P * 0.4, [[0, css(col, 0.4)], [1, css(col, 0)]]); c.fillRect(0, 0, P, P);
  const R = K.rnd;
  c.strokeStyle = 'rgba(255,255,255,.8)'; c.lineWidth = Math.max(0.8, P * 0.013); c.lineJoin = 'round';
  for (let k = 0; k < 2; k++){
    let x = g.i + g.iw * (k ? 1 : R()), y = g.i + g.iw * (k ? R() : 0); const ang0 = k ? Math.PI * (0.8 + R() * 0.4) : Math.PI * (0.3 + R() * 0.4);
    c.beginPath(); c.moveTo(x, y);
    for (let s = 0; s < 4; s++){ const a = ang0 + (R() - 0.5) * 1.2; x += Math.cos(a) * P * 0.12; y += Math.sin(a) * P * 0.12; c.lineTo(x, y); }
    c.stroke();
  }
  for (let k = 0; k < 16; k++){ const e = R() < 0.5, u = R(), d = 0.04 + R() * 0.1; const x = e ? g.i + g.iw * u : g.i + g.iw * (R() < 0.5 ? d : 1 - d), y = e ? g.i + g.iw * (R() < 0.5 ? d : 1 - d) : g.i + g.iw * u; dot(c, x, y, P * (0.006 + R() * 0.012), `rgba(255,255,255,${(0.5 + R() * 0.4).toFixed(2)})`); }
  c.globalAlpha = clamp(0.4 * K.G, 0, 0.9); poly(c, [g.i, g.i, g.i + g.iw * 0.5, g.i, g.i, g.i + g.iw * 0.5], '#fff'); c.globalAlpha = 1;
  c.strokeStyle = 'rgba(255,255,255,.75)'; c.lineWidth = Math.max(1, P * 0.022); rr(c, g.i + P * 0.012, g.i + P * 0.012, g.iw - P * 0.024, g.iw - P * 0.024, g.ir); c.stroke();
  c.restore();
} });

add('lava', 'Lava', ['glow', 'nature'], { n: 3, fx: { pulse: true }, paint(c, P, col, K){
  const crust = mix(sh(col, -0.52), [44, 26, 22], 0.22);
  const hot = K.fr ? mix(sh(col, 0.55), [255, 240, 170], 0.25) : mix(sh(col, 0.18), [255, 200, 110], 0.14);
  const g = tile(c, P, K, css(sh(crust, -0.55)), 0.03);
  clipIn(c, g);
  c.fillStyle = rad(c, P / 2, P / 2, 0, P / 2, P / 2, P * 0.7, [[0, css(sh(hot, 0.35))], [1, css(hot)]]); c.fillRect(0, 0, P, P);
  const R = K.rnd, N = 3, lo = -P * 0.25, span = P * 1.5, cell = span / N, cw = P * 0.024;
  c.translate(P / 2, P / 2); c.rotate(0.35 + K.v * 0.7); c.translate(-P / 2, -P / 2);
  const V = [];
  for (let r = 0; r <= N; r++){ V.push([]); for (let k = 0; k <= N; k++) V[r].push([lo + cell * k + (R() - 0.5) * cell * 0.7, lo + cell * r + (R() - 0.5) * cell * 0.7]); }
  c.lineJoin = 'round';
  for (let r = 0; r < N; r++) for (let k = 0; k < N; k++){
    const q = [V[r][k], V[r][k + 1], V[r + 1][k + 1], V[r + 1][k]], cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const pts = []; for (const [x, y] of q){ const d = Math.hypot(x - cx, y - cy) || 1, s = Math.max(0, 1 - cw * (1 + R()) / d); pts.push(cx + (x - cx) * s, cy + (y - cy) * s); }
    const tone = sh(crust, (R() - 0.5) * 0.18);
    c.save(); c.shadowColor = css(hot); c.shadowBlur = P * (K.fr ? 0.12 : 0.07);
    poly(c, pts, lin(c, cx - cell / 2, cy - cell / 2, cx + cell / 2, cy + cell / 2, [[0, S(tone, 0.25)], [1, S(tone, -0.1)]]));
    c.restore();
    c.strokeStyle = css(hot, K.fr ? 0.55 : 0.28); c.lineWidth = Math.max(0.8, P * 0.014); c.stroke();
    if (R() < 0.6){ dot(c, cx + (R() - 0.5) * cell * 0.4, cy + (R() - 0.5) * cell * 0.4, Math.max(0.6, P * 0.012), css(hot, 0.7)); }
  }
  c.restore();
} });

add('galaxy', 'Galaxy', ['space', 'glow', 'fancy'], { n: 3, fx: { tw: (v, R) => [0, 1, 2].map(() => [0.18 + R() * 0.64, 0.18 + R() * 0.64, 0.3 + R() * 0.15]) }, paint(c, P, col, K){
  const g = tile(c, P, K, css(mix(sh(col, -0.85), [6, 4, 20], 0.4)), 0.03);
  fillIn(c, g, rad(c, P * 0.4, P * 0.4, 0, P / 2, P / 2, P * 0.7, [[0, S(col, -0.3 - 0.25 * rgb2hsl(col)[2])], [1, css(mix(sh(col, -0.78), [8, 6, 24], 0.3))]]));
  clipIn(c, g);
  const R = K.rnd;
  c.globalCompositeOperation = 'lighter';
  const neb = [col, hue(col, 45, 0, 0.05), hue(col, -40, 0, 0)];
  const na = clamp(0.62 - 0.45 * rgb2hsl(col)[2], 0.2, 0.5);
  for (let k = 0; k < 3; k++){ const x = P * (0.2 + R() * 0.6), y = P * (0.2 + R() * 0.6), q = P * (0.22 + R() * 0.22); c.fillStyle = rad(c, x, y, 0, x, y, q, [[0, css(neb[k], na)], [1, css(neb[k], 0)]]); c.fillRect(0, 0, P, P); }
  c.fillStyle = lin(c, 0, P, P, 0, [[0.35, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,.12)'], [0.65, 'rgba(255,255,255,0)']]); c.fillRect(0, 0, P, P);
  c.globalCompositeOperation = 'source-over';
  for (let k = 0; k < 16; k++) dot(c, g.i + R() * g.iw, g.i + R() * g.iw, Math.max(0.5, P * (0.005 + R() * 0.012)), `rgba(255,255,255,${(0.45 + R() * 0.55).toFixed(2)})`);
  c.restore();
  c.strokeStyle = S(col, 0.2, 0.8); c.lineWidth = Math.max(1, P * 0.028); rr(c, g.i, g.i, g.iw, g.iw, g.ir); c.stroke();
} });

add('bubble', 'Bubble wrap', ['fun', 'shiny'], { fx: { drift: [0.42, 0.37, 0.24, 0.13] }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.5));
  fillIn(c, g, lin(c, 0, g.i, 0, g.i + g.iw, [[0, S(col, -0.08)], [1, S(col, -0.26)]]));
  const cx = P / 2, cy = P / 2, R0 = P * 0.33;
  dot(c, cx + P * 0.03, cy + P * 0.045, R0, 'rgba(0,0,0,.28)');
  dot(c, cx, cy, R0, rad(c, cx - R0 * 0.3, cy - R0 * 0.35, R0 * 0.05, cx, cy, R0, [[0, S(col, 0.62)], [0.6, S(col, 0.18)], [1, S(col, -0.1)]]));
  c.lineWidth = Math.max(1, P * 0.03);
  if (c.createConicGradient){ const cg = c.createConicGradient(0, cx, cy); for (let k = 0; k <= 6; k++) cg.addColorStop(k / 6, `hsla(${k * 60},100%,75%,.65)`); c.strokeStyle = cg; }
  else c.strokeStyle = S(col, 0.5, 0.6);
  c.beginPath(); c.arc(cx, cy, R0 - c.lineWidth / 2, 0, TAU); c.stroke();
  ell(c, cx - R0 * 0.38, cy - R0 * 0.42, R0 * 0.2, R0 * 0.12, -0.6); c.fillStyle = 'rgba(255,255,255,.85)'; c.fill();
} });

add('brick', 'Toy brick', ['fun', 'retro'], { paint(c, P, col, K){
  const f = body(c, P, col, K, -0.5, [0.35, 0.18, -0.12, -0.3], 0.45);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, 0.1)], [1, S(col, -0.08)]]); c.fill();
  const cx = P / 2, cy = P * 0.48, r = P * 0.24;
  ell(c, cx + P * 0.03, cy + P * 0.06, r, r * 0.96); c.fillStyle = 'rgba(0,0,0,.3)'; c.fill();
  dot(c, cx, cy + P * 0.04, r, S(col, -0.22));
  dot(c, cx, cy, r, lin(c, cx - r, cy - r, cx + r, cy + r, [[0, S(col, 0.32)], [1, S(col, -0.04)]]));
  c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, P * 0.022); c.lineCap = 'round'; c.beginPath(); c.arc(cx, cy, r * 0.82, 1.05 * Math.PI, 1.55 * Math.PI); c.stroke();
} });

add('cookie', 'Cookie', ['food', 'sweet', 'cozy'], { n: 4, rk: 1.4, rmin: 0.1, paint(c, P, col, K){
  const dough = mix(col, [222, 168, 104], 0.4);
  const g = tile(c, P, K, S(dough, -0.55), 0.035);
  fillIn(c, g, rad(c, P * 0.45, P * 0.42, P * 0.05, P / 2, P / 2, P * 0.68, [[0, S(dough, 0.22)], [0.55, css(dough)], [1, S(dough, -0.35)]]));
  clipIn(c, g);
  const R = K.rnd;
  for (let k = 0; k < 18; k++) dot(c, g.i + R() * g.iw, g.i + R() * g.iw, P * (0.005 + R() * 0.009), S(dough, -0.22, 0.45));
  c.strokeStyle = S(dough, -0.28, 0.5); c.lineWidth = Math.max(0.7, P * 0.011); c.lineCap = 'round';
  for (let k = 0; k < 2; k++){ const x = g.i + g.iw * (0.25 + R() * 0.5), y = g.i + g.iw * (0.25 + R() * 0.5); c.beginPath(); c.arc(x, y, P * (0.08 + R() * 0.06), R() * TAU, 0); c.stroke(); }
  const chip = mix(sh(col, -0.62), [70, 36, 20], 0.5);
  const chips = n => {
    for (let k = 0; k < n; k++){
      const a = k * 2.4 + K.v, d = 0.12 + 0.26 * Math.sqrt((k + 0.5) / n), x = P / 2 + Math.cos(a) * g.iw * d, y = P / 2 + Math.sin(a) * g.iw * d, q = P * (0.035 + R() * 0.03);
      blob(c, x + q * 0.15, y + q * 0.2, q, 7, 0.45, R); c.fillStyle = 'rgba(0,0,0,.2)'; c.fill();
      blob(c, x, y, q, 7, 0.45, R); c.fillStyle = lin(c, x - q, y - q, x + q, y + q, [[0, S(chip, 0.3)], [1, css(chip)]]); c.fill();
      ell(c, x - q * 0.3, y - q * 0.35, q * 0.3, q * 0.16, -0.5); c.fillStyle = 'rgba(255,255,255,.3)'; c.fill();
    } };
  if (K.v === 2){
    const jr = P * 0.17;
    dot(c, P / 2, P / 2 + P * 0.02, jr * 1.18, S(dough, -0.3, 0.6));
    dot(c, P / 2, P / 2, jr, rad(c, P / 2 - jr * 0.3, P / 2 - jr * 0.3, 0, P / 2, P / 2, jr, [[0, S(col, 0.35)], [0.7, css(sh(col, -0.05))], [1, S(col, -0.3)]]));
    ell(c, P / 2 - jr * 0.35, P / 2 - jr * 0.38, jr * 0.32, jr * 0.18, -0.6); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
  } else if (K.v === 3){
    chips(2);
    for (let k = 0; k < 16; k++){ const x = g.i + R() * g.iw, y = g.i + R() * g.iw, q = P * (0.012 + R() * 0.01); poly(c, [x, y - q, x + q, y, x, y + q, x - q, y], 'rgba(255,255,255,.9)'); }
  } else chips(K.v ? 8 : 7);
  c.restore();
} });

add('leaf', 'Leaf', ['nature'], { n: 4, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.58));
  fillIn(c, g, lin(c, 0, g.i, 0, g.i + g.iw, [[0, S(col, -0.22)], [1, S(col, -0.4)]]));
  c.save(); c.translate(P / 2, P / 2); c.rotate(K.v * Math.PI / 2); c.translate(-P / 2, -P / 2);
  const A = [P * 0.22, P * 0.78], B = [P * 0.8, P * 0.2];
  c.strokeStyle = S(col, -0.15); c.lineWidth = Math.max(1, P * 0.035); c.lineCap = 'round'; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(A[0] - P * 0.08, A[1] + P * 0.08); c.stroke();
  c.beginPath(); c.moveTo(A[0], A[1]); c.quadraticCurveTo(P * 0.2, P * 0.2, B[0], B[1]); c.quadraticCurveTo(P * 0.8, P * 0.8, A[0], A[1]); c.closePath();
  c.fillStyle = lin(c, P * 0.3, P * 0.3, P * 0.7, P * 0.7, [[0, S(col, 0.32)], [1, S(col, -0.06)]]); c.fill();
  c.strokeStyle = S(col, -0.42); c.lineWidth = Math.max(1, P * 0.02); c.stroke();
  c.strokeStyle = S(col, 0.55); c.lineWidth = Math.max(1, P * 0.022); c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke();
  c.lineWidth = Math.max(0.7, P * 0.012); c.strokeStyle = S(col, 0.45, 0.8);
  for (const t of [0.28, 0.48, 0.68]){ const x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, l = P * 0.13 * (1 - Math.abs(t - 0.48)); c.beginPath(); c.moveTo(x, y); c.lineTo(x - l * 0.1, y - l); c.moveTo(x, y); c.lineTo(x + l, y + l * 0.1); c.stroke(); }
  c.globalAlpha = clamp(0.35 * K.G, 0, 0.8); ell(c, P * 0.42, P * 0.4, P * 0.1, P * 0.035, -Math.PI / 4); c.fillStyle = '#fff'; c.fill(); c.globalAlpha = 1;
  c.restore();
} });

add('flower', 'Flower', ['nature', 'cute'], { n: 4, paint(c, P, col, K){
  const f = body(c, P, col, K, -0.5, [0.4, 0.2, -0.12, -0.3], 0.45);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, 0.08)], [1, S(col, -0.1)]]); c.fill();
  const N = [5, 6, 5, 8][K.v], rot = [0, 0.26, 0.63, 0.2][K.v], cx = P / 2, cy = P / 2;
  const pl = N === 8 ? 0.13 : 0.15, pw = N === 8 ? 0.06 : N === 6 ? 0.085 : 0.1, pc = mix(col, WHITE, 0.74);
  for (let k = 0; k < N; k++){
    const a = rot + k * TAU / N;
    ell(c, cx + Math.cos(a) * P * pl, cy + Math.sin(a) * P * pl, P * 0.14, P * pw, a);
    c.fillStyle = rad(c, cx, cy, P * 0.05, cx, cy, P * 0.3, [[0, css(mix(col, WHITE, 0.45))], [1, css(pc)]]); c.fill();
    c.strokeStyle = S(col, -0.2, 0.55); c.lineWidth = Math.max(0.7, P * 0.012); c.stroke();
  }
  const Y = [255, 212, 80];
  dot(c, cx, cy, P * 0.095, rad(c, cx - P * 0.03, cy - P * 0.03, 0, cx, cy, P * 0.1, [[0, css(sh(Y, 0.4))], [1, css(mix(Y, [232, 140, 30], 0.6))]]));
  for (let k = 0; k < 5; k++){ const a = k * TAU / 5 + 0.3; dot(c, cx + Math.cos(a) * P * 0.045, cy + Math.sin(a) * P * 0.045, Math.max(0.5, P * 0.011), 'rgba(140,70,10,.6)'); }
} });

add('heart', 'Hearts', ['cute', 'love'], { fx: { beat: true }, paint(c, P, col, K){
  const f = body(c, P, col, K, -0.5, [0.45, 0.22, -0.12, -0.3], 0.5);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, 0.06)], [1, S(col, -0.12)]]); c.fill();
  const cx = P / 2, cy = P * 0.53, s = P * 0.64;
  heartPath(c, cx + P * 0.02, cy + P * 0.03, s); c.fillStyle = 'rgba(0,0,0,.22)'; c.fill();
  heartPath(c, cx, cy, s); c.fillStyle = lin(c, 0, cy - s * 0.5, 0, cy + s * 0.4, [[0, S(col, 0.62)], [1, S(col, 0.22)]]); c.fill();
  c.strokeStyle = S(col, -0.3); c.lineWidth = Math.max(1, P * 0.02); c.stroke();
  c.globalAlpha = clamp(0.75 * K.G, 0, 1); ell(c, cx - s * 0.2, cy - s * 0.2, s * 0.09, s * 0.055, -0.6); c.fillStyle = '#fff'; c.fill(); c.globalAlpha = 1;
} });

add('star', 'Stars', ['cute', 'shiny', 'space'], { n: 2, fx: { glint: 0.7, tw: [[0.5, 0.16, 0.36]] }, paint(c, P, col, K){
  const f = body(c, P, col, K, -0.5, [0.4, 0.2, -0.12, -0.3], 0.45);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(col, -0.02)], [1, S(col, -0.18)]]); c.fill();
  const cx = P / 2, cy = P * 0.52, ro = P * 0.34, ri = ro * 0.46, rot = -Math.PI / 2 + (K.v ? 0.2 : 0), sc = mix(col, [255, 236, 140], 0.3);
  starPath(c, cx + P * 0.02, cy + P * 0.03, ro, ri, 5, rot); c.fillStyle = 'rgba(0,0,0,.22)'; c.fill();
  for (let k = 0; k < 10; k++){
    const a0 = rot + Math.floor(k / 2) * TAU / 5, tip = [cx + Math.cos(a0) * ro, cy + Math.sin(a0) * ro], a1 = a0 + (k & 1 ? 1 : -1) * Math.PI / 5;
    const inn = [cx + Math.cos(a1) * ri, cy + Math.sin(a1) * ri];
    const mx = (cx + tip[0] + inn[0]) / 3 - cx, my = (cy + tip[1] + inn[1]) / 3 - cy, l = (-mx - my) / (Math.hypot(mx, my) || 1);
    poly(c, [cx, cy, tip[0], tip[1], inn[0], inn[1]], S(sc, 0.15 + l * 0.32 + (k & 1 ? -0.08 : 0.06)));
  }
  starPath(c, cx, cy, ro, ri, 5, rot); c.strokeStyle = S(col, -0.4); c.lineWidth = Math.max(1, P * 0.02); c.lineJoin = 'round'; c.stroke();
} });

add('pastel', 'Pastel matte', ['soft', 'cute'], { pat: true, rk: 2, rmin: 0.14, paint(c, P, col, K){
  const pc = mix(col, WHITE, 0.42);
  const g = tile(c, P, K, S(pc, -0.24), 0.035);
  fillIn(c, g, lin(c, 0, g.i, 0, g.i + g.iw, [[0, S(pc, 0.16)], [1, css(pc)]]));
  pattern(c, K.pattern, g.i, g.iw, g.ir, 0.8);
  clipIn(c, g);
  c.fillStyle = lin(c, 0, g.i, 0, g.i + g.iw, [[0.6, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.1)']]); c.fillRect(0, 0, P, P);
  c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = Math.max(1, P * 0.03); rr(c, g.i + P * 0.015, g.i + P * 0.015, g.iw - P * 0.03, g.iw, g.ir); c.stroke();
  c.restore();
} });

add('holo', 'Holographic', ['shiny', 'fancy', 'glow'], { fx: { rainbow: true }, paint(c, P, col, K){
  const base = mix(col, WHITE, 0.15);
  const g = tile(c, P, K, S(col, -0.42), 0.035);
  fillIn(c, g, css(base));
  clipIn(c, g);
  const rb = c.createLinearGradient(0, P, P, 0); for (let k = 0; k <= 6; k++) rb.addColorStop(k / 6, `hsla(${k * 60 + 300},100%,70%,.3)`);
  c.fillStyle = rb; c.fillRect(0, 0, P, P);
  c.fillStyle = css(col, 0.42); c.fillRect(0, 0, P, P);
  c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = Math.max(0.6, P * 0.01);
  for (let k = -P; k < P * 2; k += Math.max(2, P * 0.06)){ c.beginPath(); c.moveTo(k, 0); c.lineTo(k - P, P); c.stroke(); }
  c.fillStyle = rad(c, P * 0.35, P * 0.3, 0, P * 0.35, P * 0.3, P * 0.5, [[0, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]); c.fillRect(0, 0, P, P);
  c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = Math.max(1, P * 0.022); rr(c, g.i + P * 0.012, g.i + P * 0.012, g.iw - P * 0.024, g.iw - P * 0.024, g.ir); c.stroke();
  c.restore();
} });

add('watercolor', 'Watercolor', ['soft', 'art'], { n: 3, paint(c, P, col, K){
  const paper = mix([252, 248, 240], col, 0.07);
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = css(paper); c.fill();
  c.save(); rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.clip();
  const R = K.rnd;
  blob(c, P * 0.5, P * 0.5, P * 0.5, 18, 0.3, R); c.fillStyle = css(col, 0.62); c.fill(); c.strokeStyle = S(col, -0.2, 0.55); c.lineWidth = Math.max(1, P * 0.02); c.stroke();
  blob(c, P * (0.38 + R() * 0.24), P * (0.36 + R() * 0.24), P * 0.27, 12, 0.3, R); c.fillStyle = S(col, -0.08, 0.38); c.fill(); c.strokeStyle = S(col, -0.25, 0.4); c.lineWidth = Math.max(0.8, P * 0.014); c.stroke();
  blob(c, P * (0.55 + R() * 0.2), P * (0.55 + R() * 0.2), P * 0.16, 10, 0.5, R); c.fillStyle = S(col, -0.2, 0.3); c.fill();
  for (let k = 0; k < 26; k++) dot(c, P * R(), P * R(), Math.max(0.4, P * (0.004 + R() * 0.008)), S(col, -0.35, 0.22));
  c.restore();
  c.strokeStyle = S(col, -0.5, 0.75); c.lineWidth = Math.max(1, P * 0.025); rr(c, m + P * 0.012, m + P * 0.012, P - 2 * m - P * 0.024, P - 2 * m - P * 0.024, K.r); c.stroke();
} });

add('comic', 'Comic halftone', ['art', 'fun', 'retro'], { n: 2, paint(c, P, col, K){
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = '#141018'; c.fill();
  const g = { i: m + P * 0.055, iw: P - 2 * (m + P * 0.055), ir: Math.max(0, K.r - P * 0.045) };
  fillIn(c, g, css(col));
  clipIn(c, g);
  const sp = P * 0.11, dc = S(col, -0.38);
  for (let y = g.i, row = 0; y < g.i + g.iw + sp; y += sp, row++) for (let x = g.i + (row % 2) * sp / 2; x < g.i + g.iw + sp; x += sp){
    const k = clamp(((x - g.i) + (y - g.i)) / (2 * g.iw), 0, 1), r = sp * 0.55 * Math.pow(clamp((k - 0.3) / 0.7, 0, 1), 0.85);
    if (r > 0.3) dot(c, x, y, r, dc);
  }
  c.restore();
  c.fillStyle = '#fff'; c.strokeStyle = '#141018'; c.lineWidth = Math.max(1, P * 0.02); c.lineJoin = 'round';
  if (K.v === 0){ poly(c, [g.i + P * 0.08, g.i + P * 0.08, g.i + P * 0.36, g.i + P * 0.07, g.i + P * 0.32, g.i + P * 0.16, g.i + P * 0.14, g.i + P * 0.2], '#fff'); c.stroke(); }
  else { ell(c, g.i + P * 0.16, g.i + P * 0.14, P * 0.08, P * 0.05, -0.4); c.fill(); c.stroke(); dot(c, g.i + P * 0.3, g.i + P * 0.1, P * 0.025, '#fff'); c.stroke(); }
} });

add('melon', 'Watermelon', ['food', 'fun', 'summer'], { n: 3, paint(c, P, col, K){
  const g = tile(c, P, K, '#1d3a1f', 0.03);
  clipIn(c, g);
  c.fillStyle = rad(c, P / 2, P * 0.3, 0, P / 2, P * 0.3, P * 0.7, [[0, S(col, 0.22)], [1, S(col, -0.05)]]); c.fillRect(0, 0, P, P);
  const cy = P * 1.62, rind = mix([64, 158, 72], col, 0.12);
  dot(c, P / 2, cy, P * 0.9, css(mix(WHITE, col, 0.18)));
  dot(c, P / 2, cy, P * 0.82, lin(c, 0, P * 0.8, 0, P, [[0, css(rind)], [1, S(rind, -0.35)]]));
  c.strokeStyle = S(rind, -0.4, 0.8); c.lineWidth = Math.max(1, P * 0.025);
  for (let k = -3; k <= 3; k++){ c.beginPath(); c.moveTo(P / 2 + k * P * 0.16, P * 0.83); c.lineTo(P / 2 + k * P * 0.19, P); c.stroke(); }
  const R = K.rnd, ns = 4 + K.v;
  for (let k = 0; k < ns; k++){
    const x = g.i + g.iw * (0.14 + ((k + R() * 0.6) / ns) * 0.72), y = g.i + g.iw * (0.18 + R() * 0.42), a = (x - P / 2) / P * 1.2;
    c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(0, -P * 0.05); c.quadraticCurveTo(P * 0.035, P * 0.01, 0, P * 0.035); c.quadraticCurveTo(-P * 0.035, P * 0.01, 0, -P * 0.05); c.fillStyle = '#2a1414'; c.fill();
    dot(c, -P * 0.008, -P * 0.01, Math.max(0.5, P * 0.009), 'rgba(255,255,255,.7)'); c.restore();
  }
  c.restore();
} });

add('citrus', 'Citrus slice', ['food', 'summer'], { n: 2, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.58));
  fillIn(c, g, S(col, -0.32));
  const cx = P / 2, cy = P / 2;
  dot(c, cx + P * 0.015, cy + P * 0.025, P * 0.43, 'rgba(0,0,0,.25)');
  dot(c, cx, cy, P * 0.43, lin(c, 0, 0, P, P, [[0, S(col, 0.1)], [1, S(col, -0.15)]]));
  dot(c, cx, cy, P * 0.375, css(mix(col, WHITE, 0.8)));
  const N = 8, rot = K.v * Math.PI / 8, gap = 0.07;
  for (let k = 0; k < N; k++){
    const a0 = rot + k * TAU / N + gap, a1 = rot + (k + 1) * TAU / N - gap, am = (a0 + a1) / 2, o = P * 0.03;
    c.beginPath(); c.moveTo(cx + Math.cos(am) * o, cy + Math.sin(am) * o); c.arc(cx, cy, P * 0.335, a0, a1); c.closePath();
    c.fillStyle = rad(c, cx, cy, P * 0.03, cx, cy, P * 0.34, [[0, css(mix(col, WHITE, 0.45))], [1, css(col)]]); c.fill();
  }
  const R = K.rnd;
  for (let k = 0; k < 16; k++){ const a = R() * TAU, d = P * (0.1 + R() * 0.2); ell(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, P * 0.02, P * 0.008, a); c.fillStyle = 'rgba(255,255,255,.4)'; c.fill(); }
  dot(c, cx, cy, P * 0.035, css(mix(col, WHITE, 0.85)));
} });

add('sushi', 'Sushi roll', ['food', 'cute'], { n: 2, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.62));
  fillIn(c, g, lin(c, 0, g.i, 0, g.i + g.iw, [[0, S(col, -0.25)], [1, S(col, -0.42)]]));
  const cx = P / 2, cy = P / 2;
  dot(c, cx + P * 0.015, cy + P * 0.025, P * 0.43, 'rgba(0,0,0,.3)');
  dot(c, cx, cy, P * 0.43, '#1d2a22');
  c.strokeStyle = 'rgba(160,220,180,.18)'; c.lineWidth = Math.max(0.8, P * 0.014); c.beginPath(); c.arc(cx, cy, P * 0.4, 0, TAU); c.stroke();
  dot(c, cx, cy, P * 0.36, '#f7f5ee');
  const R = K.rnd;
  for (let k = 0; k < 24; k++){ const a = R() * TAU, d = P * (0.21 + R() * 0.13); ell(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, P * 0.03, P * 0.014, R() * Math.PI); c.fillStyle = R() < 0.5 ? '#e2ddcf' : '#ffffff'; c.fill(); }
  if (K.v === 0){
    dot(c, cx, cy, P * 0.19, rad(c, cx - P * 0.05, cy - P * 0.05, 0, cx, cy, P * 0.19, [[0, S(col, 0.38)], [0.7, css(col)], [1, S(col, -0.2)]]));
    c.strokeStyle = S(col, 0.6, 0.55); c.lineWidth = Math.max(0.8, P * 0.014);
    for (let k = -1; k <= 1; k++){ c.beginPath(); c.arc(cx - P * 0.25, cy + k * P * 0.06, P * 0.3, -0.35, 0.35); c.stroke(); }
  } else {
    c.beginPath(); c.arc(cx, cy, P * 0.19, Math.PI * 0.75, Math.PI * 1.75); c.closePath(); c.fillStyle = css(col); c.fill();
    c.beginPath(); c.arc(cx, cy, P * 0.19, Math.PI * 1.75, Math.PI * 2.75); c.closePath(); c.fillStyle = S(col, 0.5); c.fill();
    dot(c, cx + P * 0.05, cy + P * 0.05, P * 0.05, '#7ccf5a');
  }
} });

add('stained', 'Stained glass', ['art', 'fancy', 'glow'], { n: 3, fx: { glint: 0.6 }, paint(c, P, col, K){
  const lead = '#1b1418';
  const m = K.m; rr(c, m, m, P - 2 * m, P - 2 * m, K.r); c.fillStyle = lead; c.fill();
  const i = m + P * 0.04, iw = P - 2 * i, R = K.rnd;
  let polys = [[i, i, i + iw, i, i + iw, i + iw, i, i + iw]];
    const a0 = R() * Math.PI; for (let k = 0; k < 3; k++){ const x = i + iw * (0.3 + R() * 0.4), y = i + iw * (0.3 + R() * 0.4), a = a0 + k * Math.PI / 3 + (R() - 0.5) * 0.5; polys = splitPolys(polys, x, y, x + Math.cos(a), y + Math.sin(a)); }
  c.save(); rr(c, i, i, iw, iw, Math.max(0, K.r - P * 0.03)); c.clip();
  for (const p of polys){ const tone = hue(col, (R() - 0.5) * 60, 0, (R() - 0.35) * 0.3); poly(c, p, css(tone)); }
  c.fillStyle = rad(c, P * 0.35, P * 0.3, 0, P * 0.4, P * 0.4, P * 0.75, [[0, 'rgba(255,255,255,.4)'], [0.5, 'rgba(255,255,255,.05)'], [1, 'rgba(0,0,0,.25)']]); c.fillRect(0, 0, P, P);
  c.strokeStyle = lead; c.lineWidth = Math.max(1.2, P * 0.045); c.lineJoin = 'round';
  for (const p of polys){ poly(c, p); c.stroke(); }
  c.restore();
} });

add('origami', 'Paper fold', ['art', 'soft'], { n: 4, rk: 0.6, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.5), 0.035);
  clipIn(c, g);
  const a = g.i, b = g.i + g.iw, d = K.v & 1;
  if (!d){ poly(c, [a, a, b, a, b, b], S(col, 0.2)); poly(c, [a, a, b, b, a, b], S(col, -0.1)); }
  else { poly(c, [a, a, b, a, a, b], S(col, 0.2)); poly(c, [b, a, b, b, a, b], S(col, -0.1)); }
  c.strokeStyle = S(col, 0.45, 0.7); c.lineWidth = Math.max(0.8, P * 0.012); c.beginPath(); if (!d){ c.moveTo(a, a); c.lineTo(b, b); } else { c.moveTo(b, a); c.lineTo(a, b); } c.stroke();
  if (K.v >= 2){
    const f = g.iw * 0.3;
    poly(c, [b - f, a, b, a, b, a + f], S(col, -0.5));
    poly(c, [b - f + P * 0.01, a + P * 0.02, b - f + P * 0.01, a + f + P * 0.02, b, a + f + P * 0.02], 'rgba(0,0,0,.22)');
    poly(c, [b - f, a, b - f, a + f, b, a + f], lin(c, b - f, a, b, a + f, [[0, S(col, 0.5)], [1, S(col, 0.25)]]));
  }
  c.restore();
} });

add('honey', 'Honeycomb', ['nature', 'sweet'], { n: 2, fx: { glint: 0.5 }, paint(c, P, col, K){
  const g = tile(c, P, K, S(col, -0.6), 0.035);
  fillIn(c, g, S(col, -0.45));
  clipIn(c, g);
  const hr = P * 0.17, dx = hr * 1.5, dy = hr * Math.sqrt(3), ox = K.v ? hr * 0.75 : 0;
  for (let k = -1; k < 6; k++) for (let r = -1; r < 5; r++){
    const x = g.i + ox + k * dx, y = g.i + r * dy + (k & 1 ? dy / 2 : 0), q = hr * 0.84;
    c.beginPath(); for (let s = 0; s < 6; s++){ const a = s * Math.PI / 3; const px = x + Math.cos(a) * q, py = y + Math.sin(a) * q; if (s) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath();
    c.fillStyle = rad(c, x - q * 0.25, y - q * 0.3, 0, x, y, q, [[0, S(col, 0.5)], [0.6, css(col)], [1, S(col, -0.18)]]); c.fill();
    dot(c, x - q * 0.35, y - q * 0.35, q * 0.14, 'rgba(255,255,255,.55)');
  }
  c.restore();
} });

add('choco', 'Chocolate', ['food', 'sweet'], { n: 2, paint(c, P, col, K){
  const base = mix(col, [108, 60, 34], 0.5);
  const f = body(c, P, base, K, -0.6, [0.3, 0.14, -0.2, -0.4], 1.25);
  rr(c, f.f0, f.f0, f.fw, f.fw, f.fr); c.fillStyle = lin(c, 0, f.f0, 0, f.f0 + f.fw, [[0, S(base, 0.1)], [1, S(base, -0.06)]]); c.fill();
  const cx = P / 2, cy = P / 2;
  if (K.v === 1){ heartPath(c, cx + P * 0.012, cy + P * 0.015, f.fw * 0.62); c.fillStyle = S(base, 0.22, 0.7); c.fill(); heartPath(c, cx, cy, f.fw * 0.62); c.fillStyle = S(base, -0.14); c.fill(); }
  else { c.lineWidth = Math.max(1, P * 0.028); c.beginPath(); c.arc(cx + P * 0.01, cy + P * 0.012, f.fw * 0.24, 0, TAU); c.strokeStyle = S(base, 0.22, 0.7); c.stroke(); c.beginPath(); c.arc(cx, cy, f.fw * 0.24, 0, TAU); c.strokeStyle = S(base, -0.2); c.stroke(); }
  gloss(c, K, f.f0, f.fw, 0.16);
} });

// ---------- settings ----------
const ORDER = SKINS.map(s => s.id);
const STAGE_DEF = ['jelly', 'ice', 'gingham', 'cupcake', 'galaxy', 'citrus'];
const STAGE_NAMES = ['Stage 1 (teal)', 'Stage 2 (blue)', 'Stage 3 (pink)', 'Stage 4 (green)', 'Stage 5 (violet)', 'Stage 6 (sunset)'];
const DEF = {};
function def(key, spec){
  DEF[key] = spec.def;
  if (GS) try { GS.define(key, spec); } catch (e) { console.warn(e); }
}
const skinOpts = SKINS.map(s => ({ v: s.id, label: s.name }));
def('visuals.preview', { type: 'custom', group: 'Block skins', label: 'Preview', render: renderPreview });
def('visuals.mix', { type: 'select', group: 'Block skins', label: 'Block skins', def: 'classic', help: 'Which skin each block wears. Random per piece gives every new piece its own look; Classic keeps the original glossy look.', options: [
  { v: 'classic', label: 'Classic (original look)' }, { v: 'stage', label: 'One skin per stage' }, { v: 'piece', label: 'Random per piece' },
  { v: 'block', label: 'Random per block' }, { v: 'favorite', label: 'Always my favourite' }] });
def('visuals.favorite', { type: 'select', group: 'Block skins', label: 'Favourite skin', def: 'jelly', options: skinOpts, help: 'Used when Block skins is set to "Always my favourite".' });
for (let n = 0; n < 6; n++) def('visuals.stageSkin.' + n, { type: 'select', group: 'Stage skins', label: STAGE_NAMES[n], def: STAGE_DEF[n], options: skinOpts, help: n === 0 ? 'Used when Block skins is set to "One skin per stage". Later stages repeat from stage 3.' : undefined });
def('visuals.gloss', { type: 'slider', group: 'Block look', label: 'Shine', def: 0.5, min: 0, max: 1, step: 0.05, help: 'Strength of the highlights. 0.5 is the original.' });
def('visuals.bevel', { type: 'slider', group: 'Block look', label: 'Bevel depth', def: 0.5, min: 0, max: 1, step: 0.05, help: '0 is flat, 0.5 is the original.' });
def('visuals.corner', { type: 'slider', group: 'Block look', label: 'Corner roundness', def: 0.09, min: 0, max: 0.5, step: 0.01, help: '0.09 is the original; 0.5 makes round blocks.' });
def('visuals.saturation', { type: 'slider', group: 'Block look', label: 'Colour saturation', def: 1, min: 0.5, max: 1.5, step: 0.05, unit: 'x' });
def('visuals.brightness', { type: 'slider', group: 'Block look', label: 'Brightness', def: 1, min: 0.7, max: 1.3, step: 0.05, unit: 'x' });
def('visuals.anim', { type: 'toggle', group: 'Block animation', label: 'Animated blocks', def: true, help: 'Shimmer, twinkles, blinking faces, breathing and wobble.' });
def('visuals.shimmer', { type: 'slider', group: 'Block animation', label: 'Shimmer', def: 0.6, min: 0, max: 1, step: 0.05, help: 'Light sweeping over shiny skins.' });
def('visuals.breathe', { type: 'slider', group: 'Block animation', label: 'Breathing', def: 0, min: 0, max: 1, step: 0.05, help: 'Blocks on the board gently pulse.' });
def('visuals.wobble', { type: 'slider', group: 'Block animation', label: 'Placement wobble', def: 0.6, min: 0, max: 1, step: 0.05 });
def('visuals.sparkle', { type: 'slider', group: 'Block animation', label: 'Sparkles', def: 0.7, min: 0, max: 1, step: 0.05, help: 'Twinkling stars on gems, ice, gold and galaxy.' });
def('visuals.faceBlink', { type: 'toggle', group: 'Block animation', label: 'Faces blink', def: true });
for (const s of SKINS) def('visuals.skin.' + s.id, { type: 'toggle', group: 'Skin pool', label: 'Use ' + s.name + ' in random mixes', def: true });
def('access.cbPatterns', { type: 'toggle', group: 'Colour blindness', label: 'Colour symbols on blocks', def: false, help: 'Draws a small symbol per colour (circle, triangle, square, star...) on every block.' });
def('access.highContrast', { type: 'toggle', group: 'Colour blindness', label: 'High-contrast block outlines', def: false });
def('access.reducedMotion', { type: 'toggle', group: 'Motion', label: 'Reduce motion', def: false, help: 'Turns off idle block animation (breathing, shimmer, twinkles, wobble).' });

const cfg = {};
const val = k => { if (GS){ const v = GS.get(k); if (v !== undefined) return v; } return DEF[k]; };
function readCfg(){
  cfg.mix = val('visuals.mix'); cfg.favorite = BY[val('visuals.favorite')] ? val('visuals.favorite') : 'jelly';
  cfg.anim = !!val('visuals.anim'); cfg.reducedMotion = !!val('access.reducedMotion');
  cfg.motion = cfg.anim && !cfg.reducedMotion;
  for (const k of ['shimmer', 'breathe', 'wobble', 'sparkle', 'gloss', 'bevel', 'corner', 'saturation', 'brightness']){ const v = Number(val('visuals.' + k)); cfg[k] = isFinite(v) ? v : DEF['visuals.' + k]; }
  cfg.faceBlink = !!val('visuals.faceBlink');
  cfg.cb = !!val('access.cbPatterns'); cfg.hc = !!val('access.highContrast');
  cfg.stage = STAGE_DEF.map((d, n) => { const v = val('visuals.stageSkin.' + n); return BY[v] ? v : d; });
  cfg.pool = ORDER.filter(id => val('visuals.skin.' + id) !== false);
  if (!cfg.pool.length) cfg.pool = ORDER.slice();
}
readCfg();
const LOOK = /^(visuals\.(gloss|bevel|corner|saturation|brightness|anim|shimmer|breathe|wobble|sparkle|faceBlink)|access\.)/;
if (GS){
  const onChange = (v, k) => { readCfg(); if (!k || LOOK.test(k)) clearCache(); };
  GS.on('visuals.*', onChange); GS.on('access.*', onChange);
}

// ---------- sprite cache (LRU by bytes) ----------
const cache = new Map(); let bytes = 0;
const MAX_BYTES = 40e6;
let dpr = Math.min(window.devicePixelRatio || 1, 3);
function clearCache(){ cache.clear(); bytes = 0; }
function cget(key, make){
  let s = cache.get(key);
  if (s){ cache.delete(key); cache.set(key, s); return s; }
  s = make(); cache.set(key, s); bytes += s.width * s.height * 4;
  while (bytes > MAX_BYTES && cache.size > 1){ const k = cache.keys().next().value, o = cache.get(k); bytes -= o.width * o.height * 4; cache.delete(k); }
  return s;
}
function mk(P){ const c = document.createElement('canvas'); c.width = c.height = P; return c; }
// quantise sprite pixel sizes so a growing (picked-up) piece reuses sprites
const qpx = p => { p = Math.max(4, Math.round(p)); return p < 48 ? p : p < 120 ? (p + 1) & ~1 : (p + 2) & ~3; };
const outerR = (P, sk) => clamp(Math.max(cfg.corner * sk.rk, sk.rmin) * P, 0, P / 2);
function adjust(c){
  if (cfg.saturation === 1 && cfg.brightness === 1) return c;
  const [h, s, l] = rgb2hsl(c), o = hsl2rgb(h, s * cfg.saturation, l);
  return [R8(o[0] * cfg.brightness), R8(o[1] * cfg.brightness), R8(o[2] * cfg.brightness)];
}

// colour-blind symbols, picked by hue so they also work for stage colours
const SYMBOLS = ['circle', 'triangle', 'square', 'star', 'diamond', 'plus', 'heart', 'ring'];
function symIndex(hex){
  const [h, s, l] = rgb2hsl(hexRgb(hex));
  if (s < 0.12) return l > 0.5 ? 7 : 2;
  return h < 15 || h >= 345 ? 0 : h < 38 ? 1 : h < 75 ? 2 : h < 160 ? 3 : h < 205 ? 4 : h < 245 ? 5 : h < 300 ? 6 : 7;
}
function drawSymbol(c, P, hex){
  const k = symIndex(hex), cx = P / 2, cy = P / 2, s = P * 0.19;
  c.save(); c.lineJoin = 'round'; c.lineWidth = Math.max(1.5, P * 0.055); c.strokeStyle = 'rgba(20,10,30,.9)'; c.fillStyle = '#fff';
  c.beginPath();
  switch (k){
    case 0: c.arc(cx, cy, s * 0.9, 0, TAU); break;
    case 1: c.moveTo(cx, cy - s); c.lineTo(cx + s * 1.05, cy + s * 0.8); c.lineTo(cx - s * 1.05, cy + s * 0.8); c.closePath(); break;
    case 2: c.rect(cx - s * 0.8, cy - s * 0.8, s * 1.6, s * 1.6); break;
    case 3: starPath(c, cx, cy + s * 0.08, s * 1.1, s * 0.48, 5, -Math.PI / 2); break;
    case 4: c.moveTo(cx, cy - s * 1.1); c.lineTo(cx + s * 0.85, cy); c.lineTo(cx, cy + s * 1.1); c.lineTo(cx - s * 0.85, cy); c.closePath(); break;
    case 5: { const a = s * 0.36, b = s; c.moveTo(cx - a, cy - b); c.lineTo(cx + a, cy - b); c.lineTo(cx + a, cy - a); c.lineTo(cx + b, cy - a); c.lineTo(cx + b, cy + a); c.lineTo(cx + a, cy + a); c.lineTo(cx + a, cy + b); c.lineTo(cx - a, cy + b); c.lineTo(cx - a, cy + a); c.lineTo(cx - b, cy + a); c.lineTo(cx - b, cy - a); c.lineTo(cx - a, cy - a); c.closePath(); break; }
    case 6: heartPath(c, cx, cy + s * 0.05, s * 2.1); break;
    default: c.arc(cx, cy, s, 0, TAU); c.moveTo(cx + s * 0.45, cy); c.arc(cx, cy, s * 0.45, 0, TAU, true);
  }
  c.stroke(); c.fill(k === 7 ? 'evenodd' : 'nonzero');
  c.restore();
}
function build(sk, hex, pat, P, v, fr){
  const cv = mk(P), c = cv.getContext('2d');
  const col = adjust(hexRgb(hex));
  const K = { P, m: P * 0.03, R: cfg.corner * P, r: outerR(P, sk), G: cfg.gloss / 0.5, B: cfg.bevel / 0.5, v, fr, pattern: pat, rnd: rng(hstr(sk.id) + v * 7919) };
  c.save();
  try { sk.paint(c, P, col, K); } catch (e) { console.error('GBSkins: ' + sk.id, e); }
  c.restore();
  if (cfg.hc){
    const w1 = Math.max(1.5, P * 0.07), h1 = w1 / 2;
    c.lineWidth = w1; c.strokeStyle = 'rgba(0,0,0,.92)'; rr(c, h1, h1, P - w1, P - w1, Math.max(0, K.r - h1 * 0.5)); c.stroke();
    const w2 = Math.max(1, P * 0.025), h2 = w1 + w2 / 2;
    c.lineWidth = w2; c.strokeStyle = 'rgba(255,255,255,.8)'; rr(c, h2, h2, P - 2 * h2, P - 2 * h2, Math.max(0, K.r - h2)); c.stroke();
  }
  if (cfg.cb) drawSymbol(c, P, hex);
  return cv;
}
function sprite(sk, hex, pat, P, v, fr){
  return cget(sk.id + '|' + hex + '|' + pat + '|' + P + '|' + v + '|' + fr, () => build(sk, hex, pat, P, v, fr));
}

// ---------- animated overlay sprites ----------
function bandFill(g, P, u, w, a){
  const f = p => a * Math.max(0, 1 - Math.abs(p - u) / w);
  const pts = [0, 1]; for (const p of [u - w, u, u + w]) if (p > 0 && p < 1) pts.push(p);
  pts.sort((x, y) => x - y);
  const gr = g.createLinearGradient(0, 0, P, P); for (const p of pts) gr.addColorStop(p, `rgba(255,255,255,${f(p).toFixed(3)})`);
  g.fillStyle = gr; g.fillRect(0, 0, P, P);
}
const GLINT_FRAMES = 14;
function glFrame(P, sk, k){
  const R = Math.round(outerR(P, sk));
  return cget(`gl|${P}|${R}|${k}`, () => {
    const c = mk(P), g = c.getContext('2d'), m = P * 0.03;
    rr(g, m, m, P - 2 * m, P - 2 * m, R); g.clip();
    const u = -0.3 + k / (GLINT_FRAMES - 1) * 1.6;
    bandFill(g, P, u, 0.12, 0.7); bandFill(g, P, u + 0.19, 0.035, 0.5);
    return c;
  });
}
function rbFrame(P, sk, k){
  const R = Math.round(outerR(P, sk));
  return cget(`rb|${P}|${R}|${k}`, () => {
    const c = mk(P), g = c.getContext('2d'), m = P * 0.03;
    rr(g, m, m, P - 2 * m, P - 2 * m, R); g.clip();
    const gr = g.createLinearGradient(0, P, P, 0);
    for (let s = 0; s <= 12; s++){ const p = s / 12, h = ((p * 1.5 - k / 8) * 360 % 360 + 360) % 360; gr.addColorStop(p, `hsla(${h.toFixed(0)},100%,68%,.6)`); }
    g.fillStyle = gr; g.fillRect(0, 0, P, P);
    return c;
  });
}
function sparkSprite(){
  return cget('spark', () => {
    const Q = 48, c = mk(Q), g = c.getContext('2d'), h = Q / 2;
    g.fillStyle = rad(g, h, h, 0, h, h, h, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]);
    g.beginPath(); g.moveTo(h, 0); g.quadraticCurveTo(h, h, Q, h); g.quadraticCurveTo(h, h, h, Q); g.quadraticCurveTo(h, h, 0, h); g.quadraticCurveTo(h, h, h, 0); g.fill();
    dot(g, h, h, Q * 0.1, '#fff');
    return c;
  });
}
function hlSprite(){
  return cget('hl', () => {
    const Q = 64, c = mk(Q), g = c.getContext('2d');
    g.fillStyle = rad(g, Q / 2, Q / 2, 0, Q / 2, Q / 2, Q / 2, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, Q, Q); return c;
  });
}
function heartSprite(P){
  return cget(`ht|${P}`, () => { const c = mk(P), g = c.getContext('2d'); heartPath(g, P / 2, P * 0.53, P * 0.64); g.fillStyle = '#fff'; g.fill(); return c; });
}
function litSprite(P, sk){
  const R = Math.round(outerR(P, sk));
  return cget(`lit|${P}|${R}`, () => {
    const c = mk(P), g = c.getContext('2d'), m = P * 0.03;
    rr(g, m, m, P - 2 * m, P - 2 * m, R);
    g.fillStyle = rad(g, P / 2, P / 2, P * 0.1, P / 2, P / 2, P * 0.72, [[0, 'rgba(255,255,255,.22)'], [1, 'rgba(255,255,255,.6)']]); g.fill();
    const w = Math.max(1.5, P * 0.06); g.lineWidth = w; g.strokeStyle = 'rgba(255,255,255,.95)';
    rr(g, m + w / 2, m + w / 2, P - 2 * m - w, P - 2 * m - w, Math.max(0, R - w / 2)); g.stroke();
    return c;
  });
}
const twMemo = new Map();
function twPts(sk, v){
  const tw = sk.fx.tw; if (Array.isArray(tw)) return tw;
  const k = sk.id + v; let p = twMemo.get(k); if (!p){ p = tw(v, rng(hstr(sk.id) + v * 31 + 7)); twMemo.set(k, p); } return p;
}

// ---------- animation timing ----------
function blinkFrame(t, seed){
  if (!cfg.faceBlink) return 0;
  const per = 2600 + hint(seed) % 1800, tt = t + hint(seed ^ 0x2f2f) % per, n = Math.floor(tt / per), k = tt - n * per;
  const h = hint(seed * 31 + n);
  if (h % 5 === 0) return 0;
  const s0 = (h >>> 4) % (per - 500);
  if (k >= s0 && k < s0 + 120) return 1;
  if ((h & 6) === 0 && k >= s0 + 230 && k < s0 + 340) return 1;
  return 0;
}
function flickerFrame(t, seed){
  const b = Math.floor(t / 60);
  if (hint(Math.imul(seed, 977) ^ (b >> 2)) % 70 !== 0) return 0;
  return hint(seed + b) & 1;
}
function fxDraw(ctx, sk, X, Y, D, P, t, seed, v, hex, pat, al){
  const fx = sk.fx;
  if (fx.pulse){
    const k = 0.5 + 0.5 * Math.sin(t / 850 + (hint(seed) % 628) / 100);
    ctx.globalAlpha = al * k * 0.9; ctx.drawImage(sprite(sk, hex, pat, P, v, 1), X, Y, D, D);
  }
  if (fx.rainbow && cfg.shimmer > 0){
    const f = (((t + hint(seed) % 4000) / 3600) % 1) * 8, k0 = f | 0, w = f - k0, A = al * cfg.shimmer * 0.75;
    ctx.globalAlpha = A * (1 - w); ctx.drawImage(rbFrame(P, sk, k0), X, Y, D, D);
    ctx.globalAlpha = A * w; ctx.drawImage(rbFrame(P, sk, (k0 + 1) & 7), X, Y, D, D);
  }
  if (fx.drift){
    const d = fx.drift, ph = (hint(seed) % 6283) / 1000, sx = 1 + 0.18 * Math.sin(t / 380 + ph);
    const w = D * d[2] * sx, h = D * d[3] / sx;
    const x = X + D * d[0] + Math.sin(t / 1100 + ph) * 0.03 * D, y = Y + D * d[1] + Math.cos(t / 1500 + ph * 1.3) * 0.025 * D;
    ctx.globalAlpha = al * clamp(0.7 * cfg.gloss / 0.5, 0, 1); ctx.drawImage(hlSprite(), x - w / 2, y - h / 2, w, h);
  }
  if (fx.beat){
    const k = ((t + hint(seed) % 1300) % 1300) / 1300, a = Math.exp(-Math.pow((k - 0.1) / 0.05, 2)) + 0.65 * Math.exp(-Math.pow((k - 0.28) / 0.05, 2));
    if (a > 0.01){ ctx.globalAlpha = al * a * 0.38; ctx.drawImage(heartSprite(P), X, Y, D, D); }
  }
  if (fx.glint && cfg.shimmer > 0){
    const h = hint(seed * 3 + 1), per = 2800 + h % 3400, k = ((t + (h >>> 8) % per) % per) / 750;
    if (k < 1){ ctx.globalAlpha = al * Math.min(1, cfg.shimmer * fx.glint); ctx.drawImage(glFrame(P, sk, Math.min(GLINT_FRAMES - 1, (k * GLINT_FRAMES) | 0)), X, Y, D, D); }
  }
  if (fx.tw && cfg.sparkle > 0){
    const pts = twPts(sk, v), spr = sparkSprite();
    for (let i = 0; i < pts.length; i++){
      const p = pts[i], w = Math.sin(t / (480 + i * 140) + (hint(seed * 7 + i) % 6283) / 1000);
      if (w > 0.25){ const a = Math.pow((w - 0.25) / 0.75, 2), d = D * p[2] * (0.55 + 0.45 * a); ctx.globalAlpha = al * a * cfg.sparkle; ctx.drawImage(spr, X + D * p[0] - d / 2, Y + D * p[1] - d / 2, d, d); }
    }
  }
  if (fx.pix && cfg.sparkle > 0){
    const per = 2400 + hint(seed) % 1600, k = (t + hint(seed * 5) % per) % per;
    if (k < 420){
      const q = D / 8, x = X + q * 5, y = Y + q * 2; ctx.globalAlpha = al * cfg.sparkle; ctx.fillStyle = '#fff';
      ctx.fillRect(x, y, q, q);
      if (k >= 140 && k < 280){ ctx.fillRect(x - q, y, q, q); ctx.fillRect(x + q, y, q, q); ctx.fillRect(x, y - q, q, q); ctx.fillRect(x, y + q, q, q); }
    }
  }
}

// ---------- public API ----------
const NO = {};
function draw(ctx, x, y, size, o){
  o = o || NO;
  if (!(size > 0)) return;
  const d = Math.min(window.devicePixelRatio || 1, 3); if (d !== dpr){ dpr = d; clearCache(); }
  const sk = BY[o.skin] || BY.classic;
  const hex = o.hex || '#888888', pat = sk.pat ? (o.pattern || '') : '';
  const seed = (o.seed | 0) >>> 0, v = sk.n > 1 ? seed % sk.n : 0;
  const a0 = ctx.globalAlpha, al = (o.alpha == null ? 1 : o.alpha) * a0;
  if (!(al > 0)) return;
  const t = o.t == null ? performance.now() : o.t, motion = cfg.motion && sk.fx;
  let fr = 0;
  if (motion){
    const b = sk.fx.blink;
    if (b && (b === true || b.indexOf(v) >= 0)) fr = blinkFrame(t, seed);
    else if (sk.fx.flicker) fr = flickerFrame(t, seed);
  }
  // classic keeps exact pixel sizes (identical to the original sprites); others snap to save cache
  const P = sk.id === 'classic' ? Math.max(4, Math.round(size * dpr)) : qpx(size * dpr), spr = sprite(sk, hex, pat, P, v, fr);
  const sc = o.scale == null ? 1 : o.scale, rot = o.rot > 0.003 || o.rot < -0.003 ? o.rot : 0, dy = (o.dy || 0) * size;
  let X = x, Y = y, D = size;
  if (rot){ ctx.save(); ctx.translate(x + size / 2, y + size / 2 + dy); ctx.rotate(rot); D = size * sc; X = Y = -D / 2; }
  else if (sc !== 1 || dy){ D = size * sc; X = x + (size - D) / 2; Y = y + (size - D) / 2 + dy; }
  ctx.globalAlpha = al;
  ctx.drawImage(spr, X, Y, D, D);
  if (motion) fxDraw(ctx, sk, X, Y, D, P, t, seed, v, hex, pat, al);
  if (o.lit > 0){ ctx.globalAlpha = al * Math.min(1, o.lit) * 0.8; ctx.drawImage(litSprite(P, sk), X, Y, D, D); }
  if (rot) ctx.restore();
  ctx.globalAlpha = a0;
}
function skinFor(q){
  q = q || NO;
  const mode = q.mode || cfg.mix;
  if (mode === 'stage'){ let s = q.stage | 0; if (s < 0) s = 0; if (s > 5) s = 2 + (s - 2) % 4; return cfg.stage[s]; }
  if (mode === 'piece') return cfg.pool[hint((q.pieceSeed | 0) ^ 0x51ed27) % cfg.pool.length];
  if (mode === 'block') return cfg.pool[hint((q.cellSeed | 0) ^ 0x1b873593) % cfg.pool.length];
  if (mode === 'favorite') return cfg.favorite;
  return 'classic';
}
function anim(seed, t, kind){
  const id = { scale: 1, dy: 0, rot: 0 };
  if (!cfg.motion) return id;
  const h = hint(seed | 0);
  if (kind === 'place'){
    const w = cfg.wobble; if (!(w > 0) || !(t >= 0) || t >= 650) return id;
    const k = t / 650, e = Math.exp(-5 * k), sg = h & 1 ? 1 : -1;
    return { scale: 1 + w * 0.2 * e * Math.cos(k * TAU * 1.6), dy: -w * 0.08 * e * Math.abs(Math.sin(k * TAU * 1.1)), rot: sg * w * 0.14 * e * Math.sin(k * TAU * 2) };
  }
  const b = cfg.breathe; if (!(b > 0) || !isFinite(t)) return id;
  const ph = (h % 10000) / 10000 * TAU, w = t / 2600 * TAU + ph;
  // no rotation while idle: rotated drawImage is far slower than a scaled one on many phones
  return { scale: 1 + b * 0.045 * Math.sin(w), dy: -b * 0.03 * (0.5 + 0.5 * Math.sin(w + 0.9)), rot: 0 };
}

// live preview for the settings menu: a strip of animated blocks in the current mix
function renderPreview(el){
  const cv = document.createElement('canvas'), H = 2, W = 8;
  cv.style.cssText = 'display:block;width:100%;max-width:360px;aspect-ratio:4/1;margin:4px 0;border-radius:10px;background:rgba(0,0,0,.28)';
  el.appendChild(cv);
  const COLS = ['#f23d3d', '#ff8c1a', '#ffc61a', '#3fcf3a', '#16c3ee', '#3566f2', '#9a4dff', '#ff4fa8'];
  let seen = false; const born = performance.now();
  const frame = now => {
    if (cv.isConnected) seen = true; else if (seen || now - born > 3000) return;
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 3);
    if (r.width > 0){
      const w = Math.round(r.width * d), h = Math.round(r.height * d);
      if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
      const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const s = Math.min(r.width / W, r.height / H) * 0.92, ox = (r.width - s * W) / 2, oy = (r.height - s * H) / 2;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
        const seed = y * W + x + 1, pc = (x >> 1) + y * 4;
        const skin = skinFor({ stage: (x >> 1) + 2 * y, pieceSeed: pc, cellSeed: seed * 7, themeSkin: -1 });
        const a = anim(seed, now, 'idle');
        draw(g, ox + x * s, oy + y * s, s, { hex: COLS[pc % 8], skin, seed, t: now, scale: a.scale, dy: a.dy, rot: a.rot });
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

window.GBSkins = {
  list: () => SKINS.map(s => ({ id: s.id, name: s.name, tags: s.tags.slice() })),
  draw, skinFor, anim,
  symbolFor: hex => SYMBOLS[symIndex(hex)],
  clearCache,
  stats: () => ({ sprites: cache.size, bytes }),
  stageDefaults: STAGE_DEF.slice(),
};
})();
