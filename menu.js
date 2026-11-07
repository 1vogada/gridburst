// Gridburst main menu, settings, stats and how-to-play screens.
// Loaded after settings.js / pieces.js / scoring.js / skins.js and before the inline game script.
//
//   GBMenu.open(page?)   page: 'main' (default) | 'settings' | 'stats' | 'help'. Pauses the game.
//   GBMenu.close()       hides the menu and unpauses the game, then calls GBMenu.onClose() if set.
//   GBMenu.isOpen()      -> bool
//   GBMenu.onClose       optional callback, set by the game.
//
// Uses (all optional, every call guarded): window.GBGame { hasSave, continueGame, newGame, pause,
// stats, resetStats, best, version }, window.GBSkins { draw, list }, window.GBSettings.
// Settings lists are built lazily each time the settings screen opens, so settings defined after
// this file loads still show up. All CSS classes are prefixed gbm-.
(() => {
'use strict';
const S = window.GBSettings;
const COLORS = ['#f23d3d', '#ff8c1a', '#ffc61a', '#3fcf3a', '#16c3ee', '#3566f2', '#9a4dff', '#ff4fa8'];
const PAGES = ['main', 'settings', 'stats', 'help'];
const STORABLE = ['toggle', 'slider', 'select', 'text'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = k => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

// ---------- safe access ----------
function sget(k){ try { return S ? S.get(k) : undefined; } catch { return undefined; } }
function game(fn, ...a){
  const g = window.GBGame;
  if (g && typeof g[fn] === 'function'){ try { return g[fn](...a); } catch (e) { console.error(e); } }
  return undefined;
}
const hasGame = fn => !!(window.GBGame && typeof window.GBGame[fn] === 'function');
function reducedMotion(){
  const v = sget('access.reducedMotion');
  if (v !== undefined) return v === true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// ---------- settings this file owns ----------
if (S){
  S.define('gameplay.menuOnStart', { type: 'toggle', group: 'Menu', label: 'Show menu when the game opens', def: true });
  S.define('gameplay.menuBg', { type: 'toggle', group: 'Menu', label: 'Animated menu background', def: true, help: 'Falling blocks behind the main menu. Off keeps them still.' });
  S.define('gameplay.confirmNew', { type: 'toggle', group: 'Menu', label: 'Ask before starting a new game', def: true, help: 'Only asks when there is a game in progress.' });
  S.define('data.export', { type: 'custom', group: 'Backup', label: 'Export save', help: 'Copy or download a backup of everything: settings, stats, best score and the game in progress.', render: renderExport });
  S.define('data.import', { type: 'custom', group: 'Backup', label: 'Import save', help: 'Paste a backup to restore it. The game reloads afterwards.', render: renderImport });
  S.define('data.resetStats', { type: 'button', group: 'Danger zone', label: 'Reset stats', help: 'Clears your game statistics.', action: onResetStats });
  S.define('data.wipe', { type: 'custom', group: 'Danger zone', label: 'Wipe everything', help: 'Deletes every bit of Gridburst data on this device and starts fresh.', render: renderWipe });
}

// ---------- tiny DOM helper ----------
function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)){
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()){ if (c == null || c === false) continue; n.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return n;
}
let uid = 0;
const btn = (cls, label, onclick, attrs) => el('button', Object.assign({ type: 'button', class: cls, onclick }, attrs || {}), label);

// ---------- colours and block sprites ----------
function shade(hex, a){
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (a >= 0){ r += (255 - r) * a; g += (255 - g) * a; b += (255 - b) * a; }
  else { r *= 1 + a; g *= 1 + a; b *= 1 + a; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function rr(c, x, y, w, h, r){ c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function poly(c, p, fill){ c.beginPath(); c.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]); c.closePath(); c.fillStyle = fill; c.fill(); }
const sprites = new Map();
// Same bevelled glossy look as the game's own blocks.
function sprite(hex, px){
  const key = hex + '@' + px;
  let s = sprites.get(key); if (s) return s;
  if (sprites.size > 160) sprites.clear();
  s = document.createElement('canvas'); s.width = s.height = px;
  const c = s.getContext('2d');
  const m = px * 0.03, w = px - 2 * m, r = px * 0.09;
  rr(c, m, m, w, w, r); c.fillStyle = shade(hex, -0.5); c.fill();
  const a = m + px * 0.03, b = px - a, bv = px * 0.15;
  c.save(); rr(c, a, a, b - a, b - a, r * 0.7); c.clip();
  poly(c, [a, a, b, a, b - bv, a + bv, a + bv, a + bv], shade(hex, 0.55));
  poly(c, [a, a, a + bv, a + bv, a + bv, b - bv, a, b], shade(hex, 0.25));
  poly(c, [b, a, b, b, b - bv, b - bv, b - bv, a + bv], shade(hex, -0.14));
  poly(c, [a, b, b, b, b - bv, b - bv, a + bv, b - bv], shade(hex, -0.34));
  c.restore();
  const f0 = a + bv, fw = b - bv - f0;
  const g = c.createLinearGradient(0, f0, 0, f0 + fw);
  g.addColorStop(0, shade(hex, 0.14)); g.addColorStop(1, shade(hex, -0.06));
  rr(c, f0, f0, fw, fw, px * 0.035); c.fillStyle = g; c.fill();
  c.globalAlpha = 0.38; c.fillStyle = '#fff';
  rr(c, f0 + fw * 0.08, f0 + fw * 0.08, fw * 0.6, fw * 0.16, fw * 0.08); c.fill();
  sprites.set(key, s); return s;
}
let skinFail = false;
function skinId(){
  let v = sget('visuals.skin');
  if (v === undefined && window.GBSkins && typeof GBSkins.list === 'function'){ try { const l = GBSkins.list(); v = l && l[0] ? l[0].id : undefined; } catch {} }
  return v;
}
function drawBlock(c, x, y, s, hex, t, seed, skin, dpr){
  const sk = window.GBSkins;
  if (sk && typeof sk.draw === 'function' && !skinFail){
    try { sk.draw(c, x, y, s, { hex, skin, t, seed }); return; }
    catch (e) { skinFail = true; console.warn('GBMenu: GBSkins.draw failed, using built-in blocks', e); }
  }
  const px = Math.max(4, Math.ceil(s * dpr / 4) * 4);
  c.drawImage(sprite(hex, px), x, y, s, s);
}

// ---------- styles ----------
const F = n => `calc(${n}px * var(--gbm-fs))`;
const INK = '#3a1f6b';
const CSS = `
.gbm-root{position:fixed;inset:0;z-index:1000;display:none;--gbm-fs:1;font-family:"Fredoka",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-weight:500;color:${INK};line-height:1.25;text-align:left;overflow:hidden;overflow:clip;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation;background:linear-gradient(165deg,#ffb3d4 0%,#d2a6ff 38%,#86c5ff 72%,#5fe0cf 100%)}
.gbm-root.gbm-open{display:block;animation:gbm-fade .25s ease-out}
.gbm-root.gbm-big{--gbm-fs:1.2}
.gbm-root *,.gbm-root *::before,.gbm-root *::after{box-sizing:border-box}
.gbm-root h1,.gbm-root h2,.gbm-root h3,.gbm-root p{margin:0}
.gbm-root [hidden]{display:none!important}
.gbm-root button{font-family:inherit;margin:0;-webkit-tap-highlight-color:transparent}
.gbm-root button:focus-visible,.gbm-root input:focus-visible,.gbm-root select:focus-visible,.gbm-root textarea:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px rgba(138,79,255,.55)}
.gbm-root input,.gbm-root textarea,.gbm-root select{font-family:inherit}
.gbm-root input[type=text],.gbm-root input[type=search],.gbm-root textarea{-webkit-user-select:text;user-select:text}
.gbm-bg{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;transition:opacity .25s}
.gbm-insub .gbm-bg{opacity:.28}
.gbm-page{position:absolute;inset:0;display:none;flex-direction:column;overflow:hidden;overflow:clip;padding:env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)}
.gbm-page.gbm-on{display:flex}
.gbm-sub.gbm-on{animation:gbm-in-r .22s ease-out}
.gbm-main{overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain}
.gbm-mainin{width:100%;max-width:380px;margin:auto;padding:28px 16px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px}
.gbm-x{position:absolute;top:calc(10px + env(safe-area-inset-top));right:calc(12px + env(safe-area-inset-right));width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.55);color:${INK};font-size:24px;line-height:1;cursor:pointer;box-shadow:0 3px 0 rgba(58,31,107,.15);z-index:2}
.gbm-x:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(58,31,107,.15)}
.gbm-title{position:relative;text-align:center;font-weight:700;font-size:clamp(38px,15vw,66px);line-height:1.15;letter-spacing:.01em;white-space:nowrap;margin:0 0 2px;padding:.12em 0}
.gbm-l{position:relative;display:inline-block;transform:rotate(var(--r));animation:gbm-bob 2.6s ease-in-out var(--d) infinite}
.gbm-lw,.gbm-lb{position:absolute;left:0;top:0}
.gbm-lw{color:#fff;-webkit-text-stroke:.3em #fff;text-shadow:0 .14em 0 rgba(58,31,107,.28)}
.gbm-lb{color:${INK};-webkit-text-stroke:.15em ${INK}}
.gbm-lf{position:relative;background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.gbm-tag{text-align:center;color:#fff;font-weight:600;font-size:${F(15)};text-shadow:0 1px 0 rgba(58,31,107,.35);margin-top:-4px}
.gbm-best{align-self:center;display:flex;align-items:center;gap:8px;padding:6px 16px 6px 12px;border-radius:999px;background:rgba(255,255,255,.75);box-shadow:0 4px 12px rgba(58,31,107,.15);font-weight:700;font-size:${F(18)};margin:4px 0 10px}
.gbm-best svg{width:30px;height:24px;flex:none;filter:drop-shadow(0 1px 0 rgba(0,0,0,.2))}
.gbm-best small{font-size:${F(13)};color:#8a6fb8;text-transform:uppercase;letter-spacing:.06em}
.gbm-btn{appearance:none;-webkit-appearance:none;border:0;cursor:pointer;color:#fff;border-radius:18px;min-height:58px;padding:8px 16px;font-weight:700;font-size:${F(22)};display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(var(--a),var(--b));box-shadow:0 5px 0 var(--s),0 10px 20px rgba(58,31,107,.22),inset 0 2px 0 rgba(255,255,255,.45);text-shadow:0 2px 0 rgba(0,0,0,.18);transition:transform .07s,box-shadow .07s}
.gbm-btn:active{transform:translateY(4px);box-shadow:0 1px 0 var(--s),0 4px 8px rgba(58,31,107,.2),inset 0 2px 0 rgba(255,255,255,.45)}
.gbm-gold{--a:#ffe766;--b:#ffb703;--s:#c77c00;color:#5a2a00;text-shadow:0 1px 0 rgba(255,255,255,.55)}
.gbm-green{--a:#86f07c;--b:#2fc35a;--s:#1d8a3c}
.gbm-blue{--a:#86ccff;--b:#3a8cff;--s:#2160c4}
.gbm-purple{--a:#c9a4ff;--b:#8a5cf6;--s:#5a34b8}
.gbm-pink{--a:#ffa6cf;--b:#ff5fa2;--s:#c43a7a}
.gbm-row3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:4px}
.gbm-tile{flex-direction:column;gap:4px;min-height:80px;font-size:${F(15)};border-radius:18px;padding:8px 4px}
.gbm-ico{font-size:${F(26)};line-height:1;text-shadow:none}
.gbm-ver{text-align:center;color:rgba(255,255,255,.85);font-size:${F(12)};margin-top:8px;text-shadow:0 1px 0 rgba(58,31,107,.3)}
.gbm-head{display:flex;align-items:center;gap:12px;padding:12px 16px 10px;flex:none}
.gbm-back{width:44px;height:44px;flex:none;border:0;border-radius:14px;background:#fff;color:${INK};font-size:26px;line-height:1;cursor:pointer;box-shadow:0 3px 0 rgba(58,31,107,.18)}
.gbm-back:active{transform:translateY(2px);box-shadow:0 1px 0 rgba(58,31,107,.18)}
.gbm-h1{flex:1;min-width:0;font-size:${F(26)};font-weight:700;color:#fff;text-shadow:0 2px 0 rgba(58,31,107,.35)}
.gbm-scroll{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;touch-action:pan-y;padding:2px 16px calc(28px + env(safe-area-inset-bottom))}
.gbm-scroll.gbm-sl{animation:gbm-in-l .2s ease-out}.gbm-scroll.gbm-sr{animation:gbm-in-r .2s ease-out}
.gbm-search{position:relative;margin:0 16px 8px;flex:none}
.gbm-search input{width:100%;min-height:46px;border:0;border-radius:23px;padding:0 46px 0 42px;font-size:16px;color:${INK};background:rgba(255,255,255,.92);box-shadow:0 4px 12px rgba(58,31,107,.14);-webkit-appearance:none;appearance:none}
.gbm-search input::placeholder{color:#9b87c2}
.gbm-search input::-webkit-search-cancel-button{display:none}
.gbm-search svg{position:absolute;left:14px;top:50%;width:18px;height:18px;margin-top:-9px;pointer-events:none}
.gbm-sclr{position:absolute;right:1px;top:1px;width:44px;height:44px;border:0;border-radius:22px;background:transparent;color:#8a6fb8;font-size:22px;cursor:pointer}
.gbm-tabs{display:flex;gap:8px;overflow-x:auto;overflow-y:hidden;padding:2px 16px 10px;flex:none;scrollbar-width:none;touch-action:pan-x;overscroll-behavior-x:contain}
.gbm-tabs::-webkit-scrollbar{display:none}
.gbm-tab{flex:none;min-height:44px;padding:0 16px;border:0;border-radius:22px;background:rgba(255,255,255,.32);color:#fff;font-weight:700;font-size:${F(15)};white-space:nowrap;cursor:pointer;text-shadow:0 1px 0 rgba(58,31,107,.3)}
.gbm-tab[aria-selected=true]{background:#fff;color:#8a4fff;text-shadow:none;box-shadow:0 3px 0 rgba(58,31,107,.15)}
.gbm-gh{font-size:${F(13)};font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#fff;text-shadow:0 1px 0 rgba(58,31,107,.4);margin:16px 6px 7px}
.gbm-gh:first-child,.gbm-count+.gbm-gh{margin-top:8px}
.gbm-card{background:#fff;border-radius:20px;padding:2px 14px;margin:0 0 12px;box-shadow:0 6px 18px rgba(58,31,107,.15),0 2px 0 rgba(58,31,107,.05)}
.gbm-rowx{padding:6px 0;border-top:1px solid #f1eafa}
.gbm-rowx:first-child{border-top:0}
.gbm-rl{display:flex;align-items:center;gap:4px;min-height:46px}
.gbm-lw2{flex:1;min-width:0;display:flex;align-items:center}
.gbm-lab{min-width:0;font-size:${F(16)};font-weight:600;overflow-wrap:anywhere;cursor:default}
.gbm-info,.gbm-rs{flex:none;width:36px;height:44px;border:0;background:transparent;cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center}
.gbm-info span{width:20px;height:20px;border-radius:50%;background:#efe6fb;color:#8a5cf6;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;font-style:normal}
.gbm-info[aria-expanded=true] span{background:#8a5cf6;color:#fff}
.gbm-rs{color:#ff5fa2;font-size:22px;font-weight:700}
.gbm-help{font-size:${F(14)};color:#7a68a0;margin:-4px 0 8px;padding:8px 10px;background:#faf6ff;border-radius:12px;display:none}
.gbm-help.gbm-on{display:block;animation:gbm-fade .2s}
.gbm-sw{position:relative;flex:none;width:56px;height:34px;border:0;padding:0;border-radius:17px;background:#e3d9f2;cursor:pointer;transition:background .2s;box-shadow:inset 0 2px 4px rgba(58,31,107,.15)}
.gbm-sw::before{content:"";position:absolute;inset:-5px -2px}
.gbm-sw::after{content:"";position:absolute;left:3px;top:3px;width:28px;height:28px;border-radius:50%;background:#fff;box-shadow:0 2px 4px rgba(58,31,107,.3);transition:transform .2s cubic-bezier(.3,1.5,.6,1)}
.gbm-sw[aria-checked=true]{background:linear-gradient(90deg,#ff7eb6,#a46bff)}
.gbm-sw[aria-checked=true]::after{transform:translateX(22px)}
.gbm-val{flex:none;font-weight:700;color:#8a4fff;font-size:${F(15)};font-variant-numeric:tabular-nums;white-space:nowrap;padding-left:4px}
.gbm-range{display:block;width:100%;height:40px;margin:0 0 4px;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer;--p:50%}
.gbm-range::-webkit-slider-runnable-track{height:10px;border-radius:5px;background:linear-gradient(90deg,#ff7eb6,#a46bff) 0/var(--p) 100% no-repeat,#ece4f7}
.gbm-range::-webkit-slider-thumb{-webkit-appearance:none;width:28px;height:28px;margin-top:-9px;border-radius:50%;background:#fff;border:3px solid #a46bff;box-shadow:0 2px 6px rgba(58,31,107,.3)}
.gbm-range::-moz-range-track{height:10px;border-radius:5px;background:#ece4f7}
.gbm-range::-moz-range-progress{height:10px;border-radius:5px;background:linear-gradient(90deg,#ff7eb6,#a46bff)}
.gbm-range::-moz-range-thumb{width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid #a46bff;box-shadow:0 2px 6px rgba(58,31,107,.3)}
.gbm-range:focus-visible{outline:none;box-shadow:none}
.gbm-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 5px rgba(164,107,255,.4)}
.gbm-seg{display:flex;gap:4px;padding:4px;margin:0 0 6px;background:#f1eafb;border-radius:14px}
.gbm-seg button{flex:1 1 0;min-width:0;min-height:40px;border:0;border-radius:11px;background:transparent;color:#6b5596;font-weight:600;font-size:${F(14)};cursor:pointer;padding:2px 4px;overflow-wrap:anywhere;line-height:1.1}
.gbm-seg button[aria-checked=true]{background:#fff;color:${INK};box-shadow:0 2px 6px rgba(58,31,107,.18)}
.gbm-sel{flex:none;max-width:52%;min-height:44px;border:2px solid #e6dcf5;border-radius:12px;padding:0 32px 0 12px;font-size:${F(15)};color:${INK};background:#faf7ff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%238a5cf6' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 11px center;-webkit-appearance:none;appearance:none;text-overflow:ellipsis}
.gbm-in{flex:none;width:42%;min-width:110px;min-height:44px;border:2px solid #e6dcf5;border-radius:12px;padding:0 12px;font-size:16px;color:${INK};background:#faf7ff}
.gbm-pill{appearance:none;-webkit-appearance:none;border:0;min-height:44px;padding:0 18px;border-radius:22px;font-weight:700;font-size:${F(15)};color:#fff;cursor:pointer;background:linear-gradient(#c9a4ff,#8a5cf6);box-shadow:0 3px 0 #5a34b8;text-shadow:0 1px 0 rgba(0,0,0,.15);transition:transform .07s,box-shadow .07s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.gbm-pill:active{transform:translateY(2px);box-shadow:0 1px 0 #5a34b8}
.gbm-pill.gbm-soft{background:#f1eafb;color:#6b3fd6;box-shadow:0 3px 0 #d6c6f2;text-shadow:none}
.gbm-pill.gbm-soft:active{box-shadow:0 1px 0 #d6c6f2}
.gbm-pill.gbm-danger{background:linear-gradient(#ff8a9e,#f23d5e);box-shadow:0 3px 0 #b5193a}
.gbm-pill.gbm-danger:active{box-shadow:0 1px 0 #b5193a}
.gbm-pill.gbm-gold{background:linear-gradient(#ffe766,#ffb703);box-shadow:0 3px 0 #c77c00;color:#5a2a00;text-shadow:none}
.gbm-pillrow{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 8px}
.gbm-custom{margin:0 0 8px;min-width:0}
.gbm-ta{display:block;width:100%;min-height:84px;resize:vertical;border:2px solid #e6dcf5;border-radius:12px;padding:8px 10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:${INK};background:#faf7ff;margin:0 0 8px}
.gbm-err{color:#e0244a;font-size:${F(14)};font-weight:600;margin:0 0 8px}
.gbm-foot{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:18px 0 6px}
.gbm-empty{text-align:center;color:#fff;font-weight:600;font-size:${F(16)};padding:30px 10px;text-shadow:0 1px 0 rgba(58,31,107,.35)}
.gbm-count{color:#fff;font-size:${F(13)};font-weight:600;margin:2px 6px 0;text-shadow:0 1px 0 rgba(58,31,107,.35)}
.gbm-prev{display:block;width:100%;height:280px;border-radius:14px;touch-action:none;cursor:grab;margin:4px 0 6px}
.gbm-prev:active{cursor:grabbing}
.gbm-ph{font-size:${F(14)};color:#7a68a0;margin:0 0 10px;text-align:center}
.gbm-pt{font-weight:700;font-size:${F(16)};margin:10px 0 2px}
.gbm-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.gbm-stat{background:#fff;border-radius:18px;padding:14px 14px 12px;box-shadow:0 6px 18px rgba(58,31,107,.15);border-top:5px solid var(--c);min-width:0}
.gbm-stat.gbm-wide{grid-column:1/-1}
.gbm-sv{font-size:${F(26)};font-weight:700;color:var(--c2);line-height:1.1;overflow-wrap:anywhere}
.gbm-sk{font-size:${F(13)};font-weight:600;color:#7a68a0;margin-top:4px}
.gbm-hcard{display:flex;gap:14px;align-items:flex-start;background:#fff;border-radius:20px;padding:14px;margin:0 0 12px;box-shadow:0 6px 18px rgba(58,31,107,.15)}
.gbm-hico{flex:none;width:48px;height:48px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:26px;background:var(--c);box-shadow:inset 0 -3px 0 rgba(0,0,0,.12)}
.gbm-hcard h3{font-size:${F(17)};font-weight:700;margin-bottom:3px}
.gbm-hcard p{font-size:${F(15)};color:#6b5a8c}
.gbm-modal{position:absolute;inset:0;z-index:5;display:none;align-items:center;justify-content:center;padding:16px;background:rgba(40,16,80,.5)}
.gbm-modal.gbm-on{display:flex;animation:gbm-fade .18s}
.gbm-dlg{width:100%;max-width:340px;background:#fff;border-radius:24px;padding:24px 18px 18px;text-align:center;box-shadow:0 18px 50px rgba(30,10,70,.45);animation:gbm-pop .28s cubic-bezier(.3,1.4,.6,1)}
.gbm-dlg h2{font-size:${F(22)};font-weight:700;margin-bottom:8px}
.gbm-dlg p{font-size:${F(15)};color:#6b5a8c;margin-bottom:18px}
.gbm-dlg .gbm-pillrow{justify-content:center;margin:0}
.gbm-dlg .gbm-pill{flex:1 1 0;min-height:48px}
.gbm-toast{position:absolute;left:50%;bottom:calc(28px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;background:${INK};color:#fff;font-weight:600;font-size:${F(15)};padding:10px 18px;border-radius:999px;box-shadow:0 8px 20px rgba(30,10,70,.35);pointer-events:none;opacity:0;transition:opacity .2s;max-width:calc(100% - 32px);text-align:center}
.gbm-toast.gbm-on{opacity:1}
@keyframes gbm-fade{from{opacity:0}to{opacity:1}}
@keyframes gbm-pop{0%{transform:scale(.7);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes gbm-bob{0%,100%{transform:translateY(0) rotate(var(--r))}50%{transform:translateY(-.07em) rotate(calc(var(--r) * -.5))}}
@keyframes gbm-in-r{from{transform:translateX(28px);opacity:0}to{transform:none;opacity:1}}
@keyframes gbm-in-l{from{transform:translateX(-28px);opacity:0}to{transform:none;opacity:1}}
.gbm-rm,.gbm-rm *,.gbm-rm *::before,.gbm-rm *::after{animation:none!important;transition:none!important}
`;

const CROWN = '<svg viewBox="0 0 30 24" aria-hidden="true"><defs><linearGradient id="gbm-cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff07a"/><stop offset=".55" stop-color="#ffc21a"/><stop offset="1" stop-color="#e88a00"/></linearGradient></defs><path d="M3 20 1.5 6.5l7 5.5L15 2l6.5 10 7-5.5L27 20z" fill="url(#gbm-cg)" stroke="#a85a00" stroke-width="1.6" stroke-linejoin="round"/><rect x="3" y="19" width="24" height="3.6" rx="1.6" fill="#ffb300" stroke="#a85a00" stroke-width="1.4"/><circle cx="15" cy="14" r="2.2" fill="#ff4d8d"/><circle cx="8.5" cy="16" r="1.5" fill="#5fd0ff"/><circle cx="21.5" cy="16" r="1.5" fill="#5fd0ff"/></svg>';
const SEARCH_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="#8a5cf6" stroke-width="2.4"/><path d="M13 13l5 5" stroke="#8a5cf6" stroke-width="2.4" stroke-linecap="round"/></svg>';

// ---------- state ----------
let root = null, bgCv = null, modalEl = null, toastEl = null;
const pages = {};
let openFlag = false, stack = [], pushed = 0, skipPop = 0;
let curTab = null, query = '';
let pageCleanups = [], bodyCleanups = [], rows = [];
let modalDone = null, toastT = 0;
let settingsBody = null, tabBar = null, searchIn = null, previewRedraw = null;
const top = () => stack[stack.length - 1];

function build(){
  if (root) return;
  document.head.append(el('style', { id: 'gbm-style' }, CSS));
  root = el('div', { class: 'gbm-root', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Gridburst menu', 'aria-hidden': 'true' });
  bgCv = el('canvas', { class: 'gbm-bg', 'aria-hidden': 'true' });
  root.append(bgCv);
  for (const p of PAGES){ pages[p] = el('div', { class: 'gbm-page ' + (p === 'main' ? 'gbm-main' : 'gbm-sub gbm-p-' + p) }); root.append(pages[p]); }
  modalEl = el('div', { class: 'gbm-modal' });
  toastEl = el('div', { class: 'gbm-toast', role: 'status', 'aria-live': 'polite' });
  root.append(modalEl, toastEl);
  // Keep scroll gestures and typing inside the menu away from game-wide listeners.
  for (const t of ['touchmove', 'pointermove', 'wheel', 'keydown', 'keyup']) root.addEventListener(t, e => e.stopPropagation());
  document.body.append(root);
  window.addEventListener('popstate', onPop);
  if (S){
    S.on('access.*', () => { if (!openFlag) return; applyPrefs(); if (top() === 'main') startBg(); });
    S.on('gameplay.menuBg', () => { if (openFlag && top() === 'main') startBg(); });
  }
}
function applyPrefs(){
  root.classList.toggle('gbm-big', sget('access.bigText') === true);
  root.classList.toggle('gbm-rm', reducedMotion());
}

// ---------- open / close / navigation ----------
function pushState(){ try { history.pushState({ gbm: true }, ''); pushed++; } catch {} }
function open(page){
  page = PAGES.includes(page) ? page : 'main';
  if (document.readyState === 'loading' && !document.body){ document.addEventListener('DOMContentLoaded', () => open(page), { once: true }); return; }
  build(); applyPrefs();
  if (!openFlag){
    openFlag = true;
    root.classList.add('gbm-open'); root.setAttribute('aria-hidden', 'false');
    game('pause', true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    stack = ['main']; pushState(); show('main');
  }
  if (page === 'main'){
    if (stack.length > 1){ const n = Math.min(stack.length - 1, pushed); stack = ['main']; if (n > 0){ skipPop++; pushed -= n; history.go(-n); } show('main'); }
  } else if (top() !== page){
    if (stack.length > 1){ stack[stack.length - 1] = page; show(page); } else go(page);
  }
}
function go(page){ stack.push(page); pushState(); show(page); }
// Reload without leaving our pushed history entries behind. The menu stays open (and the game
// paused) until the page goes, so nothing gets saved over a fresh import or wipe.
function reloadPage(){
  const n = pushed;
  if (n <= 0){ location.reload(); return; }
  let done = false;
  const go2 = () => { if (!done){ done = true; location.reload(); } };
  skipPop++; pushed = 0;
  window.addEventListener('popstate', () => setTimeout(go2, 0), { once: true });
  setTimeout(go2, 600);
  try { history.go(-n); } catch { go2(); }
}
function close(){
  if (!openFlag) return;
  const n = pushed;
  closeInternal();
  if (n > 0){ pushed = 0; skipPop++; try { history.go(-n); } catch { skipPop--; } }
}
function closeInternal(){
  if (modalDone) modalDone(false);
  openFlag = false;
  teardown();
  stopBg();
  stack = [];
  root.classList.remove('gbm-open'); root.setAttribute('aria-hidden', 'true');
  for (const p of PAGES) pages[p].classList.remove('gbm-on');
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  game('pause', false);
  if (typeof api.onClose === 'function'){ try { api.onClose(); } catch (e) { console.error(e); } }
}
function navBack(){
  if (modalDone){ modalDone(false); return; }
  if (stack.length <= 1){ close(); return; }
  if (pushed > 0) history.back();
  else { stack.pop(); show(top()); }
}
function onPop(){
  if (skipPop > 0){ skipPop--; return; }
  if (!openFlag) return;
  pushed = Math.max(0, pushed - 1);
  if (modalDone){ modalDone(false); pushState(); return; }
  if (stack.length > 1){ stack.pop(); show(top()); }
  else closeInternal();
}
function onKey(e){
  if (!openFlag || e.key !== 'Escape') return;
  e.preventDefault(); e.stopPropagation();
  if (modalDone){ modalDone(false); return; }
  if (searchIn && document.activeElement === searchIn && searchIn.value){ searchIn.value = ''; setQuery(''); return; }
  navBack();
}
function onResize(){
  if (!openFlag) return;
  sizeBg();
  if (top() === 'main' && !bg.raf) drawBg(performance.now(), 0);
  if (previewRedraw) previewRedraw(true);
}
function teardown(){
  runAll(bodyCleanups); runAll(pageCleanups);
  rows = []; settingsBody = tabBar = searchIn = previewRedraw = null;
}
function runAll(a){ while (a.length){ try { a.pop()(); } catch (e) { console.error(e); } } }

function show(page){
  teardown();
  for (const p of PAGES){ pages[p].classList.toggle('gbm-on', p === page); if (p !== page) pages[p].textContent = ''; }
  const pg = pages[page]; pg.textContent = '';
  ({ main: renderMain, settings: renderSettings, stats: renderStats, help: renderHelp })[page](pg);
  root.classList.toggle('gbm-insub', page !== 'main');
  root.scrollLeft = root.scrollTop = 0;
  if (page === 'main') startBg(); else stopBg();
  const f = pg.querySelector('.gbm-back') || pg.querySelector('.gbm-btn');
  if (f) try { f.focus({ preventScroll: true }); } catch {}
}

// ---------- modal and toast ----------
function confirmBox({ title, text, ok = 'OK', cancel = 'Cancel', danger = false }){
  return new Promise(res => {
    if (modalDone) modalDone(false);
    const prev = document.activeElement, id = 'gbm-d' + (++uid);
    const done = v => { if (modalDone !== done) return; modalDone = null; modalEl.classList.remove('gbm-on'); modalEl.textContent = ''; try { prev && prev.focus && prev.focus({ preventScroll: true }); } catch {} res(v); };
    modalDone = done;
    const noB = btn('gbm-pill gbm-soft', cancel, () => done(false));
    const okB = btn('gbm-pill ' + (danger ? 'gbm-danger' : 'gbm-gold'), ok, () => done(true));
    modalEl.textContent = '';
    modalEl.append(el('div', { class: 'gbm-dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': id + 't', 'aria-describedby': id + 'p' },
      el('h2', { id: id + 't' }, title), el('p', { id: id + 'p' }, text), el('div', { class: 'gbm-pillrow' }, noB, okB)));
    modalEl.onclick = e => { if (e.target === modalEl) done(false); };
    modalEl.classList.add('gbm-on');
    try { (danger ? noB : okB).focus({ preventScroll: true }); } catch {}
  });
}
function toast(msg){
  if (!toastEl) return;
  toastEl.textContent = msg; toastEl.classList.add('gbm-on');
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('gbm-on'), 1800);
}

// ---------- background ----------
const SHAPES = [[[0, 0]], [[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0], [1, 1]], [[0, 0], [0, 1], [0, 2]]];
const bg = { raf: 0, last: 0, w: 0, h: 0, dpr: 1, items: [] };
function sizeBg(){
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
  if (w === bg.w && h === bg.h && dpr === bg.dpr && bg.items.length) return;
  bg.w = w; bg.h = h; bg.dpr = dpr;
  bgCv.width = Math.round(w * dpr); bgCv.height = Math.round(h * dpr);
  const n = clamp(Math.round(w * h / 22000), 8, 22);
  bg.items = Array.from({ length: n }, (_, i) => {
    const cells = SHAPES[(Math.random() * SHAPES.length) | 0], s = 16 + Math.random() * 16;
    const pw = Math.max(...cells.map(c => c[1])) + 1, ph = Math.max(...cells.map(c => c[0])) + 1;
    return { x: Math.random() * w, y: (i / n) * (h + 120) - 60, s, cells, pw, ph, hex: COLORS[i % COLORS.length],
      vy: 10 + s * 0.9, r: (Math.random() - 0.5) * 0.8, ph0: Math.random() * 6.28, seed: (Math.random() * 1e6) | 0, a: 0.45 + (s - 16) / 16 * 0.5 };
  });
}
function drawBg(t, dt){
  const c = bgCv.getContext('2d'), { w, h, dpr } = bg, skin = skinId();
  c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
  for (const b of bg.items){
    b.y += b.vy * dt;
    const ext = Math.max(b.pw, b.ph) * b.s;
    if (b.y - ext > h){ b.y = -ext; b.x = Math.random() * w; }
    const x = b.x + Math.sin(t / 1400 + b.ph0) * 10, rot = b.r + Math.sin(t / 1900 + b.ph0) * 0.18;
    c.save(); c.translate(x, b.y); c.rotate(rot); c.globalAlpha = b.a;
    const ox = -b.pw * b.s / 2, oy = -b.ph * b.s / 2;
    for (const [r, k] of b.cells) drawBlock(c, ox + k * b.s, oy + r * b.s, b.s, b.hex, t, b.seed + r * 7 + k, skin, dpr);
    c.restore();
  }
}
function startBg(){
  stopBg(); sizeBg();
  const animate = sget('gameplay.menuBg') !== false && !reducedMotion();
  drawBg(performance.now(), 0);
  if (!animate) return;
  bg.last = performance.now();
  const loop = t => {
    const dt = Math.min(0.05, Math.max(0, (t - bg.last) / 1000)); bg.last = t;
    drawBg(t, dt); bg.raf = requestAnimationFrame(loop);
  };
  bg.raf = requestAnimationFrame(loop);
}
function stopBg(){ if (bg.raf) cancelAnimationFrame(bg.raf); bg.raf = 0; }

// ---------- main page ----------
function titleEl(){
  const t = el('h1', { class: 'gbm-title', 'aria-label': 'Gridburst' });
  const cols = ['#ff4fa8', '#ff8c1a', '#ffc61a', '#3fcf3a', '#16c3ee', '#3566f2', '#9a4dff', '#ff4fa8', '#ff8c1a'];
  [...'Gridburst'].forEach((ch, i) => {
    const c = cols[i % cols.length];
    const g = `linear-gradient(180deg,${shade(c, 0.65)} 0%,${shade(c, 0.2)} 42%,${c} 58%,${shade(c, -0.18)} 100%)`;
    t.append(el('span', { class: 'gbm-l', 'aria-hidden': 'true', style: `--r:${i % 2 ? 3 : -3}deg;--d:${(i * 0.13).toFixed(2)}s;--g:${g}` },
      el('span', { class: 'gbm-lw' }, ch), el('span', { class: 'gbm-lb' }, ch), el('span', { class: 'gbm-lf' }, ch)));
  });
  return t;
}
function renderMain(pg){
  const save = !!game('hasSave');
  let best = Number(game('best'));
  if (!isFinite(best)) best = 0;
  const bestEl = el('div', { class: 'gbm-best', 'aria-label': 'Best score ' + best.toLocaleString() });
  bestEl.innerHTML = CROWN;
  bestEl.append(el('small', null, 'Best'), el('span', null, best.toLocaleString()));
  const ver = window.GBGame && window.GBGame.version;
  pg.append(
    btn('gbm-x', '×', close, { 'aria-label': 'Close menu' }),
    el('div', { class: 'gbm-mainin' },
      titleEl(),
      el('p', { class: 'gbm-tag' }, 'Fill the lines, burst the blocks!'),
      bestEl,
      save && btn('gbm-btn gbm-gold', [el('span', { class: 'gbm-ico', 'aria-hidden': 'true' }, '▶'), 'Continue'], onContinue),
      btn('gbm-btn ' + (save ? 'gbm-green' : 'gbm-gold'), [el('span', { class: 'gbm-ico', 'aria-hidden': 'true' }, '✦'), 'New game'], onNew),
      el('div', { class: 'gbm-row3' },
        S && btn('gbm-btn gbm-tile gbm-blue', [el('span', { class: 'gbm-ico', 'aria-hidden': 'true' }, '⚙️'), 'Settings'], () => go('settings')),
        btn('gbm-btn gbm-tile gbm-purple', [el('span', { class: 'gbm-ico', 'aria-hidden': 'true' }, '📊'), 'Stats'], () => go('stats')),
        btn('gbm-btn gbm-tile gbm-pink', [el('span', { class: 'gbm-ico', 'aria-hidden': 'true' }, '💡'), 'How to play'], () => go('help'))),
      ver ? el('p', { class: 'gbm-ver' }, 'v' + ver) : null));
}
function onContinue(){ game('continueGame'); close(); }
async function onNew(){
  if (game('hasSave') && sget('gameplay.confirmNew') !== false){
    const ok = await confirmBox({ title: 'Start a new game?', text: 'Your current game will be lost.', ok: 'New game', cancel: 'Keep it' });
    if (!ok || !openFlag) return;
  }
  game('newGame'); close();
}

// ---------- subpage frame ----------
function frame(pg, title){
  pg.append(el('div', { class: 'gbm-head' }, btn('gbm-back', '‹', navBack, { 'aria-label': 'Back' }), el('h2', { class: 'gbm-h1' }, title)));
}

// ---------- settings page ----------
const visible = sp => { if (typeof sp.hidden === 'function'){ try { return !sp.hidden(); } catch { return true; } } return !sp.hidden; };
function visibleTabs(){ return S.tabs().filter(t => t.id === 'controls' || S.specs(t.id).some(visible)); }
function renderSettings(pg){
  frame(pg, 'Settings');
  const tabs = visibleTabs();
  if (!tabs.some(t => t.id === curTab)) curTab = tabs[0] ? tabs[0].id : null;
  const sbox = el('div', { class: 'gbm-search', role: 'search' });
  sbox.innerHTML = SEARCH_ICON;
  searchIn = el('input', { type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  searchIn.value = query;
  const clr = btn('gbm-sclr', '×', () => { searchIn.value = ''; setQuery(''); searchIn.focus(); }, { 'aria-label': 'Clear search', hidden: !query });
  searchIn.addEventListener('input', () => { clr.hidden = !searchIn.value; setQuery(searchIn.value); });
  searchIn.addEventListener('keydown', e => { if (e.key === 'Enter') searchIn.blur(); });
  sbox.append(searchIn, clr);
  tabBar = el('div', { class: 'gbm-tabs', role: 'tablist', 'aria-label': 'Settings sections', hidden: !!query.trim() });
  for (const t of tabs){
    tabBar.append(btn('gbm-tab', t.label, () => setTab(t.id, 0), { role: 'tab', id: 'gbm-tab-' + t.id, 'data-tab': t.id, 'aria-selected': t.id === curTab ? 'true' : 'false', 'aria-controls': 'gbm-panel' }));
  }
  settingsBody = el('div', { class: 'gbm-scroll', id: 'gbm-panel', role: 'tabpanel' });
  pg.append(sbox, tabBar, settingsBody);
  // swipe between tabs
  let sx = 0, sy = 0, st = 0, ok = false;
  settingsBody.addEventListener('touchstart', e => {
    const t = e.touches[0];
    ok = e.touches.length === 1 && !query.trim() && !e.target.closest('input,textarea,select,canvas,.gbm-seg,.gbm-noswipe');
    sx = t.clientX; sy = t.clientY; st = Date.now();
  }, { passive: true });
  settingsBody.addEventListener('touchend', e => {
    if (!ok) return; ok = false;
    const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy) && Date.now() - st < 700) stepTab(dx < 0 ? 1 : -1);
  }, { passive: true });
  // keep rows in sync with any change (resets, buttons, other code)
  pageCleanups.push(S.on('*', (v, key) => { for (const r of rows) if (r.key === key) r.refresh(); }));
  renderBody(0);
  requestAnimationFrame(() => scrollTabIntoView(false));
}
function setQuery(q){
  query = q;
  if (tabBar) tabBar.hidden = !!q.trim();
  renderBody(0);
}
function stepTab(dir){
  const tabs = visibleTabs(), i = tabs.findIndex(t => t.id === curTab), j = i + dir;
  if (j >= 0 && j < tabs.length) setTab(tabs[j].id, dir);
}
function setTab(id, dir){
  if (!dir){ const tabs = visibleTabs(); dir = tabs.findIndex(t => t.id === id) >= tabs.findIndex(t => t.id === curTab) ? 1 : -1; }
  if (id === curTab && !query.trim()) return;
  curTab = id;
  if (tabBar) for (const b of tabBar.children) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
  scrollTabIntoView(true);
  renderBody(dir);
}
function scrollTabIntoView(smooth){
  if (!tabBar) return;
  const b = tabBar.querySelector('[aria-selected=true]'); if (!b) return;
  const left = b.offsetLeft - (tabBar.clientWidth - b.offsetWidth) / 2;
  try { tabBar.scrollTo({ left, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' }); } catch { tabBar.scrollLeft = left; }
}
function renderBody(dir){
  if (!settingsBody) return;
  runAll(bodyCleanups); rows = []; previewRedraw = null;
  const body = settingsBody;
  body.textContent = ''; body.scrollTop = 0;
  body.classList.remove('gbm-sl', 'gbm-sr');
  if (dir){ void body.offsetWidth; body.classList.add(dir > 0 ? 'gbm-sr' : 'gbm-sl'); }
  const q = query.trim().toLowerCase();
  if (q) renderSearch(body, q);
  else if (curTab) renderTab(body, curTab);
}
function groupsOf(specs){
  const m = new Map();
  for (const sp of specs){ const g = sp.group || ''; if (!m.has(g)) m.set(g, []); m.get(g).push(sp); }
  return m;
}
function renderTab(body, tab){
  body.setAttribute('aria-labelledby', 'gbm-tab-' + tab);
  const specs = S.specs(tab).filter(visible);
  if (tab === 'controls') body.append(el('h3', { class: 'gbm-gh' }, 'Try it'), previewCard());
  for (const [g, list] of groupsOf(specs)){
    if (g) body.append(el('h3', { class: 'gbm-gh' }, g));
    const card = el('div', { class: 'gbm-card' });
    for (const sp of list) card.append(renderRow(sp));
    body.append(card);
  }
  if (!specs.length && tab !== 'controls') body.append(el('p', { class: 'gbm-empty' }, 'Nothing here yet.'));
  const tabLabel = (S.tabs().find(t => t.id === tab) || {}).label || tab;
  body.append(el('div', { class: 'gbm-foot' },
    specs.some(sp => STORABLE.includes(sp.type)) && btn('gbm-pill gbm-soft', '↺ Reset this tab', async () => {
      if (await confirmBox({ title: 'Reset ' + tabLabel + '?', text: 'Every setting in this tab goes back to its default.', ok: 'Reset' })){ S.resetTab(tab); toast(tabLabel + ' reset'); }
    }),
    btn('gbm-pill gbm-danger', 'Reset all settings', async () => {
      if (await confirmBox({ title: 'Reset all settings?', text: 'Every setting in every tab goes back to its default. Your scores and saved game are kept.', ok: 'Reset all', danger: true })){
        S.resetAll(); toast('All settings reset'); renderBody(0);
      }
    })));
}
function renderSearch(body, q){
  body.removeAttribute('aria-labelledby');
  const terms = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const t of S.tabs()) for (const sp of S.specs(t.id)){
    if (!visible(sp)) continue;
    const hay = [sp.label, sp.help, sp.group].filter(Boolean).join(' ').toLowerCase();
    if (terms.every(w => hay.includes(w))) hits.push([t, sp]);
  }
  body.append(el('p', { class: 'gbm-count', role: 'status' }, hits.length ? hits.length + (hits.length === 1 ? ' setting' : ' settings') + ' found' : ''));
  if (!hits.length){ body.append(el('p', { class: 'gbm-empty' }, 'No settings match “' + query.trim() + '”.')); return; }
  let lastHead = null, card = null;
  for (const [t, sp] of hits){
    const head = t.label + (sp.group ? ' · ' + sp.group : '');
    if (head !== lastHead){ body.append(el('h3', { class: 'gbm-gh' }, head)); card = el('div', { class: 'gbm-card' }); body.append(card); lastHead = head; }
    card.append(renderRow(sp));
  }
}
function fmtVal(sp, v){
  const st = sp.step || 1;
  const d = st >= 1 ? 0 : Math.min(4, (String(st).split('.')[1] || '').length);
  const s = Number(v).toFixed(d), u = sp.unit || '';
  if (!u) return s;
  return /^(%|x|×|°)$/.test(u) ? s + u : s + ' ' + u;
}
function renderRow(sp){
  const id = 'gbm-r' + (++uid), label = sp.label || sp.key;
  const row = el('div', { class: 'gbm-rowx', 'data-key': sp.key });
  const lab = el('span', { class: 'gbm-lab', id: id + 'l' }, label);
  const lw = el('div', { class: 'gbm-lw2' });
  const rl = el('div', { class: 'gbm-rl' }, lw);
  let help = null, infoB = null;
  if (sp.help){
    help = el('p', { class: 'gbm-help', id: id + 'h' }, sp.help);
    infoB = btn('gbm-info', el('span', null, 'i'), () => { const on = help.classList.toggle('gbm-on'); infoB.setAttribute('aria-expanded', on ? 'true' : 'false'); },
      { 'aria-label': 'About ' + label, 'aria-expanded': 'false', 'aria-controls': id + 'h' });
  }
  const storable = STORABLE.includes(sp.type);
  const rs = storable ? btn('gbm-rs', '↺', () => S.reset(sp.key), { 'aria-label': 'Reset ' + label + ' to default', title: 'Reset to default' }) : null;
  const refreshRs = () => { if (rs) rs.hidden = S.get(sp.key) === sp.def; };
  let refresh = () => {}, below = null;

  if (sp.type === 'button'){
    const b = btn('gbm-pill gbm-soft', label, () => { try { sp.action && sp.action(); } catch (e) { console.error(e); toast('Something went wrong'); } });
    lw.append(b);
    if (infoB) lw.append(infoB);
  } else {
    lw.append(lab); if (infoB) lw.append(infoB);
  }
  if (rs) rl.append(rs);

  switch (sp.type){
    case 'toggle': {
      const sw = btn('gbm-sw', null, () => S.set(sp.key, !S.get(sp.key)), { role: 'switch', 'aria-labelledby': id + 'l', 'aria-checked': 'false' });
      lab.addEventListener('click', () => sw.click()); lab.style.cursor = 'pointer';
      rl.append(sw);
      refresh = () => sw.setAttribute('aria-checked', S.get(sp.key) ? 'true' : 'false');
      break;
    }
    case 'slider': {
      const val = el('span', { class: 'gbm-val', 'aria-hidden': 'true' });
      rl.append(val);
      const inp = el('input', { type: 'range', class: 'gbm-range', min: sp.min, max: sp.max, step: sp.step || 'any', 'aria-labelledby': id + 'l' });
      if (help) inp.setAttribute('aria-describedby', id + 'h');
      const paint = v => {
        val.textContent = fmtVal(sp, v);
        inp.setAttribute('aria-valuetext', fmtVal(sp, v));
        inp.style.setProperty('--p', ((v - sp.min) / ((sp.max - sp.min) || 1) * 100) + '%');
      };
      inp.addEventListener('input', () => { const v = +inp.value; paint(v); if (sp.live !== false) S.set(sp.key, v); });
      inp.addEventListener('change', () => S.set(sp.key, +inp.value));
      below = inp;
      refresh = () => { const v = S.get(sp.key); if (+inp.value !== v) inp.value = v; paint(v); };
      break;
    }
    case 'select': {
      const opts = sp.options || [];
      if (opts.length <= 4){
        const seg = el('div', { class: 'gbm-seg', role: 'radiogroup', 'aria-labelledby': id + 'l' });
        const bs = opts.map(o => btn('', o.label, () => S.set(sp.key, o.v), { role: 'radio', 'aria-checked': 'false' }));
        seg.append(...bs); below = seg;
        refresh = () => { const v = S.get(sp.key); bs.forEach((b, i) => b.setAttribute('aria-checked', opts[i].v === v ? 'true' : 'false')); };
      } else {
        const sel = el('select', { class: 'gbm-sel', 'aria-labelledby': id + 'l' }, opts.map((o, i) => el('option', { value: String(i) }, o.label)));
        sel.addEventListener('change', () => { const o = opts[+sel.value]; if (o) S.set(sp.key, o.v); });
        rl.append(sel);
        refresh = () => { const i = opts.findIndex(o => o.v === S.get(sp.key)); sel.value = String(Math.max(0, i)); };
      }
      break;
    }
    case 'text': {
      const inp = el('input', { type: 'text', class: 'gbm-in', 'aria-labelledby': id + 'l', autocomplete: 'off', spellcheck: 'false', maxlength: '200' });
      inp.addEventListener('input', () => S.set(sp.key, inp.value));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
      rl.append(inp);
      refresh = () => { if (document.activeElement !== inp) inp.value = S.get(sp.key) ?? ''; };
      break;
    }
    case 'custom': {
      const box = el('div', { class: 'gbm-custom', role: 'group', 'aria-labelledby': id + 'l' });
      below = box;
      try { if (typeof sp.render === 'function') sp.render(box); } catch (e) { console.error(e); box.textContent = 'This widget failed to load.'; }
      break;
    }
  }
  row.append(rl);
  if (help) row.append(help);
  if (below) row.append(below);
  if (storable){
    const r = { key: sp.key, refresh: () => { refresh(); refreshRs(); } };
    rows.push(r); r.refresh();
  }
  return row;
}

// ---------- controls tab: live drag preview ----------
function previewCard(){
  const card = el('div', { class: 'gbm-card gbm-noswipe' });
  const cv = el('canvas', { class: 'gbm-prev', role: 'img', 'aria-label': 'Drag preview: drag inside this box to see how a piece follows your finger' });
  card.append(cv, el('p', { class: 'gbm-ph' }, 'Drag anywhere in the box. The dot is your finger.'));
  const N = 5, PIECE = [[0, 0], [1, 0], [2, 0], [2, 1]], PW = 2, PH = 3, HEX = '#ff4fa8';
  const FILLED = new Set(['4,0', '4,1', '4,3', '4,4', '3,0', '3,4', '0,4']);
  const FILL_COL = ['#16c3ee', '#ffc61a', '#3fcf3a', '#9a4dff'];
  let W = 0, H = 280, dpr = 1, cell = 30, bx = 0, by = 0, trayX = 0, trayY = 0, trayCell = 15;
  let drag = null, ret = null, raf = 0;
  function layout(){
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth || 300; H = cv.clientHeight || 280;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cell = Math.floor(Math.min(36, (W - 40) / N, (H - 100) / N));
    bx = Math.round((W - cell * N) / 2); by = 18;
    trayCell = Math.round(cell * 0.5);
    trayX = W / 2; trayY = by + cell * N + (H - (by + cell * N)) / 2;
  }
  function pieceAt(c, cx, cy, size, alpha){
    const x0 = cx - PW * size / 2, y0 = cy - PH * size / 2;
    c.globalAlpha = alpha;
    for (const [r, k] of PIECE) drawBlock(c, x0 + k * size, y0 + r * size, size, HEX, performance.now(), 11 + r * 3 + k, skinId(), dpr);
    c.globalAlpha = 1;
  }
  function draw(){
    raf = 0;
    if (!cv.isConnected) return;
    const c = cv.getContext('2d'), now = performance.now();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3b2380'); g.addColorStop(1, '#24135a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // board
    rr(c, bx - 6, by - 6, cell * N + 12, cell * N + 12, 12); c.fillStyle = 'rgba(0,0,0,.28)'; c.fill();
    let fi = 0;
    for (let r = 0; r < N; r++) for (let k = 0; k < N; k++){
      if (FILLED.has(r + ',' + k)) drawBlock(c, bx + k * cell, by + r * cell, cell, FILL_COL[fi++ % FILL_COL.length], now, r * 9 + k, skinId(), dpr);
      else { rr(c, bx + k * cell + 1.5, by + r * cell + 1.5, cell - 3, cell - 3, 5); c.fillStyle = 'rgba(255,255,255,.07)'; c.fill(); }
    }
    // tray
    rr(c, 14, trayY - trayCell * 2.2, W - 28, trayCell * 4.4, 12); c.fillStyle = 'rgba(255,255,255,.06)'; c.fill();
    let busy = false;
    if (drag){
      const grow = Math.max(0, Number(sget('controls.grow')) || 0);
      const k = grow > 0 ? easeOut((now - drag.t0) / grow) : 1;
      if (k < 1) busy = true;
      const geo = S.dragGeom(drag.fx, drag.fy, PW, PH, cell, { touch: true, k, trayCell });
      // landing ghost
      const col = Math.round((geo.cx - PW * cell / 2 - bx) / cell), row = Math.round((geo.cy - PH * cell / 2 - by) / cell);
      const fits = PIECE.every(([r, q]) => { const rr2 = row + r, cc = col + q; return rr2 >= 0 && cc >= 0 && rr2 < N && cc < N && !FILLED.has(rr2 + ',' + cc); });
      if (fits){
        c.globalAlpha = 0.35;
        for (const [r, q] of PIECE) drawBlock(c, bx + (col + q) * cell, by + (row + r) * cell, cell, HEX, now, 5, skinId(), dpr);
        c.globalAlpha = 1;
      }
      pieceAt(c, geo.cx, geo.cy, geo.size, 1);
      // finger
      c.beginPath(); c.arc(drag.fx, drag.fy, 22, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,.28)'; c.fill();
      c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.8)'; c.stroke();
      c.beginPath(); c.arc(drag.fx, drag.fy, 3, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
    } else if (ret){
      const k = easeOut((now - ret.t0) / 160);
      const size = ret.size + (trayCell - ret.size) * k;
      pieceAt(c, ret.cx + (trayX - ret.cx) * k, ret.cy + (trayY - ret.cy) * k, size, 1);
      if (k < 1) busy = true; else ret = null;
    } else {
      pieceAt(c, trayX, trayY, trayCell, 1);
    }
    if (busy) raf = requestAnimationFrame(draw);
  }
  const redraw = relayout => { if (relayout) layout(); if (!raf) raf = requestAnimationFrame(draw); };
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    const [fx, fy] = pos(e); drag = { fx, fy, t0: performance.now(), id: e.pointerId }; ret = null; redraw();
  });
  cv.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const [fx, fy] = pos(e); drag.fx = fx; drag.fy = fy; redraw();
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const grow = Math.max(0, Number(sget('controls.grow')) || 0);
    const k = grow > 0 ? easeOut((performance.now() - drag.t0) / grow) : 1;
    const geo = S.dragGeom(drag.fx, drag.fy, PW, PH, cell, { touch: true, k, trayCell });
    drag = null; ret = { cx: geo.cx, cy: geo.cy, size: geo.size, t0: performance.now() }; redraw();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  bodyCleanups.push(S.on('controls.*', () => redraw()), S.on('gameplay.leftHanded', () => redraw()), () => { if (raf) cancelAnimationFrame(raf); raf = 0; });
  previewRedraw = redraw;
  requestAnimationFrame(() => redraw(true));
  return card;
}

// ---------- data tab widgets ----------
function exportText(){ try { return S.exportAll(); } catch (e) { console.error(e); return ''; } }
function copyText(text, ta){
  const fallback = () => {
    try { if (ta){ ta.focus(); ta.select(); } const ok = document.execCommand('copy'); toast(ok ? 'Copied!' : 'Select the text and copy it'); }
    catch { toast('Select the text and copy it'); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast('Copied!'), fallback);
  else fallback();
}
function renderExport(box){
  const ta = el('textarea', { class: 'gbm-ta', readonly: true, rows: '4', 'aria-label': 'Backup data', spellcheck: 'false' });
  ta.value = exportText();
  box.append(ta, el('div', { class: 'gbm-pillrow' },
    btn('gbm-pill', '📋 Copy', () => { ta.value = exportText(); copyText(ta.value, ta); }),
    btn('gbm-pill gbm-soft', '⬇ Download', () => {
      ta.value = exportText();
      const url = URL.createObjectURL(new Blob([ta.value], { type: 'application/json' }));
      const a = el('a', { href: url, download: 'gridburst-backup-' + new Date().toISOString().slice(0, 10) + '.json', style: 'display:none' });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    })));
}
function renderImport(box){
  const ta = el('textarea', { class: 'gbm-ta', rows: '4', placeholder: 'Paste your backup here', 'aria-label': 'Backup to import', spellcheck: 'false' });
  const err = el('p', { class: 'gbm-err', role: 'alert', hidden: true });
  box.append(ta, err, el('div', { class: 'gbm-pillrow' }, btn('gbm-pill', '⬆ Import', async () => {
    err.hidden = true;
    const text = ta.value.trim();
    let o = null;
    try { o = JSON.parse(text); } catch {}
    if (!text){ err.textContent = 'Paste a backup first.'; err.hidden = false; return; }
    if (!o || o.gridburst !== 1 || typeof o.data !== 'object'){ err.textContent = 'That does not look like a Gridburst backup.'; err.hidden = false; return; }
    if (!await confirmBox({ title: 'Restore this backup?', text: 'It replaces your current settings, stats and saved game. The game reloads afterwards.', ok: 'Restore' })) return;
    try { S.importAll(text); } catch (e) { err.textContent = 'Import failed: ' + (e && e.message || e); err.hidden = false; return; }
    reloadPage();
  })));
}
async function onResetStats(){
  if (!hasGame('resetStats')){ toast('Stats are not available yet'); return; }
  if (!await confirmBox({ title: 'Reset stats?', text: 'Your game statistics go back to zero. This cannot be undone.', ok: 'Reset stats', danger: true })) return;
  game('resetStats'); toast('Stats reset');
}
function renderWipe(box){
  box.append(el('div', { class: 'gbm-pillrow' }, btn('gbm-pill gbm-danger', '🗑 Erase all data', async () => {
    if (!await confirmBox({ title: 'Wipe everything?', text: 'This deletes your settings, stats, best score and saved game on this device.', ok: 'Continue', danger: true })) return;
    if (!await confirmBox({ title: 'Are you really sure?', text: 'There is no undo. Export a backup first if you might want it back.', ok: 'Wipe it all', cancel: 'No, keep it', danger: true })) return;
    try { S.wipeAll(); } catch (e) { console.error(e); }
    reloadPage();
  })));
}

// ---------- stats page ----------
function renderStats(pg){
  frame(pg, 'Stats');
  const body = el('div', { class: 'gbm-scroll' });
  pg.append(body);
  const st = game('stats');
  const entries = st && typeof st === 'object' ? Object.entries(st).filter(([, v]) => v != null && typeof v !== 'object' && typeof v !== 'function') : [];
  if (!entries.length){ body.append(el('p', { class: 'gbm-empty' }, 'No stats yet. Play a game and they will show up here!')); return; }
  const cols = ['#ff4fa8', '#ff8c1a', '#3fcf3a', '#16c3ee', '#9a4dff', '#ffc61a', '#3566f2', '#f23d3d'];
  const grid = el('div', { class: 'gbm-stats' });
  entries.forEach(([k, v], i) => {
    const c = cols[i % cols.length];
    const txt = typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 })) : String(v);
    grid.append(el('div', { class: 'gbm-stat' + (txt.length > 9 ? ' gbm-wide' : ''), style: `--c:${c};--c2:${shade(c, -0.25)}` },
      el('div', { class: 'gbm-sv' }, txt), el('div', { class: 'gbm-sk' }, k)));
  });
  body.append(grid);
}

// ---------- how to play ----------
function renderHelp(pg){
  frame(pg, 'How to play');
  const body = el('div', { class: 'gbm-scroll' });
  pg.append(body);
  const items = [
    ['🧩', '#ffd6ea', 'Drag and drop', 'Drag the pieces from the tray onto the board. Fill a whole row or column and it bursts! Clearing several lines at once scores extra.'],
    ['🔥', '#ffe2c2', 'Build a combo', 'Clear lines move after move to grow your combo. You can make up to 2 moves without a clear and the combo stays alive.'],
    ['👑', '#fff1b8', 'Legendary Comeback', 'Clear lines when the board is nearly full and you pull off a Legendary Comeback, with a big bonus.'],
    ['🎨', '#d9f0ff', 'New stages', 'As your score climbs, the board changes stage and look. Every new stage gives you a bonus.'],
    ['🚫', '#e6dcff', 'Game over', 'The game ends when none of your pieces fits on the board. Keep some room for the big ones!'],
  ];
  for (const [ico, c, h, p] of items){
    body.append(el('div', { class: 'gbm-hcard' }, el('div', { class: 'gbm-hico', style: '--c:' + c, 'aria-hidden': 'true' }, ico), el('div', null, el('h3', null, h), el('p', null, p))));
  }
  body.append(el('div', { class: 'gbm-foot' }, btn('gbm-pill gbm-gold', "Let's play!", () => { if (game('hasSave')) game('continueGame'); close(); })));
}

const api = {
  open,
  close,
  isOpen: () => openFlag,
  onClose: null,
};
window.GBMenu = api;
})();
