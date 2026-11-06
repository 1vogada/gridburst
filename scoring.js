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
//   GBScore.comboLabel(st) -> text for the combo badge under the score while a chain of K >= 2 is alive, or ''
(() => {
'use strict';
const KEEP = 2;          // non-clearing placements a chain survives
const CLEAR_BONUS = 300; // all-clear bonus
const CLEAR_ROUND = 6;   // first tray deal at which the all-clear bonus counts
const rate = K => K <= 6 ? 34 : K <= 12 ? 50.6 : 57.75;
const linePoints = (L, K) => L <= 0 ? 0 : Math.round(rate(K) * K * L);
const text = K => K >= 3 ? 'Combo ' + (K - 1) : K === 2 ? 'Combo' : '';

function norm(st){
  // older saves held { streak, quiet }
  if (typeof st.chain !== 'number') st.chain = st.streak | 0;
  if (typeof st.quiet !== 'number') st.quiet = 0;
  if (typeof st.placed !== 'number') st.placed = 0;
  delete st.streak;
  return st;
}
function place(st, ev){
  norm(st);
  const round = ev.round > 0 ? ev.round : Math.floor(st.placed / 3) + 1;
  st.placed++;
  const lines = ev.lines | 0;
  let lineScore = 0, bonus = 0;
  if (lines){
    st.chain++; st.quiet = 0;
    lineScore = linePoints(lines, st.chain);
    if (ev.boardClear && round >= CLEAR_ROUND) bonus = CLEAR_BONUS;
  } else if (++st.quiet > KEEP){
    st.chain = 0; st.quiet = 0;
  }
  const gain = (ev.cells | 0) + lineScore + bonus;
  return {
    gain, lineScore, bonus,
    combo: lines && st.chain >= 2 ? st.chain - 1 : 0,
    comboText: lines ? text(st.chain) : '',
    chain: st.chain,
  };
}
window.GBScore = {
  init: () => ({ chain: 0, quiet: 0, placed: 0 }),
  place,
  comboLabel: st => text(norm(st).chain),
};
})();
