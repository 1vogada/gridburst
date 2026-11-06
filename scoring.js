// Gridburst scoring. Pure logic, no DOM.
//   GBScore.init()         -> st, a JSON-serialisable object the game saves and passes back
//   GBScore.place(st, ev)  -> { gain, lineScore, bonus, combo } after one placement
//     ev: { cells, lines, rows, cols, boardClear }  (lines = rows + cols cleared by this placement)
//     gain: total points to add; lineScore: points shown at the cleared lines;
//     bonus: extra points for a board clear (shown separately); combo: combo level for effects (0 = none)
//   GBScore.comboLabel(st) -> text for the combo badge under the score, or ''
(() => {
'use strict';
function place(st, ev){
  let gain = ev.cells, lineScore = 0, bonus = 0;
  if (ev.lines){
    st.streak++; st.quiet = 0;
    lineScore = 10 * ev.lines * ev.lines * st.streak;
    if (ev.boardClear) bonus = 300;
  } else {
    st.quiet++; if (st.quiet >= 3) st.streak = 0;
  }
  gain += lineScore + bonus;
  return { gain, lineScore, bonus, combo: ev.lines ? st.streak : 0 };
}
window.GBScore = {
  init: () => ({ streak: 0, quiet: 0 }),
  place,
  comboLabel: st => st.streak >= 2 ? 'Combo x' + st.streak : '',
};
})();
