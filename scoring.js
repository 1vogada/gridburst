// Gridburst scoring. Pure logic, no DOM.
// Point values read off a recorded Block Blast Classic run (score popups and counter, frame by frame):
//   placement   1 point per cell placed
//   line clear  L = rows + cols completed by the placement, K = chain count after this placement
//               points = round(rate(K) * K * L), rate 34 for K <= 6, 50.6 for K 7..12, 57.75 from K 13
//               (seen: +34 +68 +102 at K 1-3, +272 K4/2 lines, +340 K5/2, +612 K6/3, +354 K7, +405 K8,
//                +911 K9/2, +506 K10, +982 K17, +1732 K15/2, +2080 K18/2; the 7..12 / 13+ split is a guess)
//   chain       the first clearing placement sets K = 1; every later clearing placement adds 1
//               (one per placement, however many lines). Up to 2 non-clearing placements in a row
//               keep the chain; the 3rd resets it to 0.
//   on screen   no combo text at K = 1, "Combo" without a number at K = 2, "Combo N" with N = K - 1 from K = 3
//   all clear   +300 when the board ends up empty, not multiplied, and only from the 6th tray deal on
//   comeback    a clear made while the board is nearly full (>= 46 of 64 cells occupied after the piece lands,
//               before lines are removed) pays line points x 1.715 and shows "Legendary Comeback"
//               (seen: +58 at K1 = 34 x 1.715, +608 at K7, +867 at K10, all on crowded boards)
//   combo master the 16th clear of a chain (on-screen combo 15) shows "Combo Master" instead of "Combo 15";
//               points are normal (seen twice: +5544 = 924 x 6 lines, +1848 = 924 x 2 lines)
//   stages      at 28000, 31500, then every 3500 points the game plays a stage cutscene "X1", "X2", ...
//               and adds about 4.9% of the score, capped at 1750 (seen: ~1400 at 28.7k, +1560 at 31.7k)
//
//   GBScore.init()         -> st, a JSON-serialisable object the game saves and passes back
//   GBScore.place(st, ev)  -> { gain, lineScore, bonus, combo, comboText, chain } after one placement
//     ev: { cells, lines, rows, cols, boardClear, round? }  (lines = rows + cols cleared by this placement;
//         round = optional 1-based tray-deal number; when absent it is counted as 3 placements per tray)
//     gain: total points to add; lineScore: line-clear points shown at the cleared lines;
//     bonus: all-clear bonus (shown separately), 0 if none;
//     combo: the game's on-screen combo number (K - 1) when this placement cleared and K >= 2, else 0;
//            note K = 2 gives combo 1, which the game shows as a bare "Combo" (see comboText)
//     comboText: the game's combo popup for this placement: '' , 'Combo' or 'Combo N'
//     chain: the internal chain count K after this placement (0 = no chain)
//     ev.filled: occupied cells after the piece lands, before clearing; ev.score: score before this placement
//     extra returns: banner ('' | 'Legendary Comeback' | 'Combo Master'), comeback (bool),
//                    stageUp (0 or the new stage n), stageBonus (included in gain)
//   GBScore.stageOf(score) -> 0 base, 1 first stage change, 2, ...
//   GBScore.comboLabel(st) -> text for the combo badge under the score while a chain of K >= 2 is alive, or ''
(() => {
'use strict';
// Every number below can be changed in Settings > Scoring; the defaults are the values read off the video.
const S = window.GBSettings;
if (S){
  const d = (k, spec) => S.define('scoring.' + k, spec);
  d('mult', { type: 'slider', group: 'General', label: 'Score multiplier', def: 1, min: 0.25, max: 5, step: 0.05, unit: 'x', help: 'Multiplies every point you earn. 1x matches the original.' });
  d('cellPoints', { type: 'slider', group: 'General', label: 'Points per placed block', def: 1, min: 0, max: 10, step: 1, help: 'Each block of a placed piece is worth this much.' });
  d('rate1', { type: 'slider', group: 'Line clears', label: 'Line value, combo 0-5', def: 34, min: 5, max: 150, step: 0.25, help: 'Points per line x chain length while the chain is 6 or shorter.' });
  d('rate2', { type: 'slider', group: 'Line clears', label: 'Line value, combo 6-11', def: 50.6, min: 5, max: 150, step: 0.25 });
  d('rate3', { type: 'slider', group: 'Line clears', label: 'Line value, combo 12+', def: 57.75, min: 5, max: 150, step: 0.25 });
  d('keep', { type: 'slider', group: 'Combo', label: 'Moves a combo survives', def: 2, min: 0, max: 6, step: 1, help: 'Placements without a clear before the combo resets. The original allows 2.' });
  d('comeback', { type: 'toggle', group: 'Bonuses', label: 'Legendary Comeback', def: true, help: 'Clearing on a nearly full board pays extra.' });
  d('comebackFill', { type: 'slider', group: 'Bonuses', label: 'Comeback: board fullness', def: 46, min: 30, max: 60, step: 1, unit: 'cells', help: 'Occupied cells (of 64) needed for a comeback.' });
  d('comebackMult', { type: 'slider', group: 'Bonuses', label: 'Comeback: multiplier', def: 1.715, min: 1, max: 5, step: 0.005, unit: 'x' });
  d('master', { type: 'toggle', group: 'Bonuses', label: 'Combo Master banner', def: true, help: 'Shown on the 16th clear of a chain.' });
  d('allClear', { type: 'toggle', group: 'Bonuses', label: 'All-clear bonus', def: true });
  d('allClearPoints', { type: 'slider', group: 'Bonuses', label: 'All-clear points', def: 300, min: 0, max: 3000, step: 50 });
  d('allClearRound', { type: 'slider', group: 'Bonuses', label: 'All-clear counts from tray', def: 6, min: 1, max: 20, step: 1, help: 'The original only pays it from the 6th tray on.' });
  d('stages', { type: 'toggle', group: 'Stages', label: 'Stage changes and bonus', def: true, help: 'Color stage changes with the X1, X2 cutscene and a bonus.' });
  d('stageStart', { type: 'slider', group: 'Stages', label: 'First stage at', def: 28000, min: 1000, max: 100000, step: 500, unit: 'pts' });
  d('stageEvery', { type: 'slider', group: 'Stages', label: 'Next stage every', def: 3500, min: 500, max: 50000, step: 500, unit: 'pts' });
  d('stageBonus', { type: 'slider', group: 'Stages', label: 'Stage bonus', def: 4.9, min: 0, max: 30, step: 0.1, unit: '%', help: 'Bonus as a share of your score.' });
  d('stageBonusMax', { type: 'slider', group: 'Stages', label: 'Stage bonus cap', def: 1750, min: 0, max: 50000, step: 50, unit: 'pts', help: 'Largest stage bonus. Keeps scores from running away in very long games.' });
}
const get = (k, def) => { const v = S && S.get('scoring.' + k); return v === undefined ? def : v; };
const KEEP = () => get('keep', 2);   // non-clearing placements a chain survives
const rate = K => K <= 6 ? get('rate1', 34) : K <= 12 ? get('rate2', 50.6) : get('rate3', 57.75);
const linePoints = (L, K) => L <= 0 ? 0 : Math.round(rate(K) * K * L);
const MASTER_CHAIN = 16;
const stageOf = sc => { const a = get('stageStart', 28000), e = get('stageEvery', 3500); return sc < a ? 0 : 1 + Math.floor((sc - a) / e); };
const text = K => K >= 3 ? 'Combo ' + (K - 1) : K === 2 ? 'Combo' : '';

function norm(st){
  // older saves held { streak, quiet }
  if (typeof st.chain !== 'number') st.chain = st.streak | 0;
  if (typeof st.quiet !== 'number') st.quiet = 0;
  if (typeof st.placed !== 'number') st.placed = 0;
  if (typeof st.stage !== 'number') st.stage = -1;   // -1: not yet synced with the score
  delete st.streak;
  return st;
}
function place(st, ev){
  norm(st);
  const round = ev.round > 0 ? ev.round : Math.floor(st.placed / 3) + 1;
  st.placed++;
  const lines = ev.lines | 0;
  let lineScore = 0, bonus = 0, comeback = false, banner = '';
  if (lines){
    st.chain++; st.quiet = 0;
    lineScore = linePoints(lines, st.chain);
    if (get('comeback', true) && (ev.filled | 0) >= get('comebackFill', 46)){ comeback = true; lineScore = Math.round(lineScore * get('comebackMult', 1.715)); banner = 'Legendary Comeback'; }
    if (get('master', true) && st.chain === MASTER_CHAIN) banner = 'Combo Master';
    if (get('allClear', true) && ev.boardClear && round >= get('allClearRound', 6)) bonus = get('allClearPoints', 300);
  } else if (++st.quiet > KEEP()){
    st.chain = 0; st.quiet = 0;
  }
  const m = get('mult', 1);
  if (m !== 1){ lineScore = Math.round(lineScore * m); bonus = Math.round(bonus * m); }
  let gain = Math.round((ev.cells | 0) * get('cellPoints', 1) * m) + lineScore + bonus, stageUp = 0, stageBonus = 0;
  const before = ev.score | 0;
  if (st.stage < 0) st.stage = stageOf(before);
  const n = get('stages', true) ? stageOf(before + gain) : st.stage;
  if (n > st.stage){
    stageUp = n;
    stageBonus = Math.min(get('stageBonusMax', 1750), Math.round((before + gain) * get('stageBonus', 4.9) / 100));
    gain += stageBonus;
    st.stage = get('stages', true) ? stageOf(before + gain) : n;   // a bonus that crosses the next stage line never triggers another bonus
  }
  else if (n < st.stage) st.stage = n;   // stage settings were changed
  return {
    gain, lineScore, bonus, comeback, banner, stageUp, stageBonus,
    combo: lines && st.chain >= 2 ? st.chain - 1 : 0,
    comboText: lines && banner !== 'Combo Master' ? text(st.chain) : '',
    chain: st.chain,
  };
}
window.GBScore = {
  init: () => ({ chain: 0, quiet: 0, placed: 0, stage: 0 }),
  place, stageOf,
  comboLabel: st => text(norm(st).chain),
};
})();
