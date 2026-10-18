/* Marriage round scoring for the live scorer.
 * Each active player settles maal with everyone else:
 *   points = n × own maal − total maal − game points paid to the winner.
 * Seen pays 3, unseen 10, dublee 0, foul 15, plus 5 each if the winner has
 * dublee. Murder: unseen maal doesn't count. Kidnap: the winner takes it.
 * Matches Marriage Point Calculator (see test/scoring.test.js).
 * Works in the browser (window.Scoring) and in Node (module.exports). */
(function (root) {
  'use strict';

  const DEFAULT_RULES = { mode: 'murder', seen: 3, unseen: 10, dublee: 0, foul: 15, dubleeWinBonus: 5 };
  const STATUSES = ['seen', 'unseen', 'dublee', 'foul', 'hold'];

  /** round: { winner, entries: [{ player, status, maal }] } → list of problems. */
  function validate(round) {
    const problems = [];
    const active = round.entries.filter(e => e.status !== 'hold');
    if (active.length < 2) problems.push('At least two people need to play the round.');
    const w = round.entries.find(e => e.player === round.winner);
    if (!w) problems.push('Tap the crown for whoever won the round.');
    else if (w.status === 'hold') problems.push('The winner can\'t be on hold.');
    else if (w.status === 'unseen') problems.push('The winner has to be seen.');
    else if (w.status === 'foul') problems.push('The winner can\'t have a foul.');
    if (round.entries.some(e => !Number.isFinite(e.maal) || e.maal < 0)) problems.push('Maal has to be 0 or more.');
    return problems;
  }

  /** Points per player for one round. Always adds up to 0; hold scores 0. */
  function scoreRound(round, rules = DEFAULT_RULES) {
    const problems = validate(round);
    if (problems.length) throw new Error(problems.join(' '));
    const active = round.entries.filter(e => e.status !== 'hold');
    const n = active.length;
    const w = active.find(e => e.player === round.winner);
    const maal = new Map();
    let kidnapped = 0;
    for (const e of active) {
      let m = e.maal;
      if (e.status === 'foul') m = 0;
      if (e.status === 'unseen' && e !== w) {
        if (rules.mode === 'murder') m = 0;
        else if (rules.mode === 'kidnap') { kidnapped += m; m = 0; }
      }
      maal.set(e.player, m);
    }
    maal.set(w.player, maal.get(w.player) + kidnapped);
    const total = [...maal.values()].reduce((a, b) => a + b, 0);
    const pts = {};
    let winnerGets = 0;
    for (const e of round.entries) {
      if (e.status === 'hold') { pts[e.player] = 0; continue; }
      if (e === w) continue;
      const pay = rules[e.status] + (w.status === 'dublee' ? rules.dubleeWinBonus : 0);
      pts[e.player] = n * maal.get(e.player) - total - pay;
      winnerGets -= pts[e.player];
    }
    pts[w.player] = winnerGets;
    return pts;
  }

  function totals(rounds, players, rules = DEFAULT_RULES) {
    const t = Object.fromEntries(players.map(p => [p, 0]));
    for (const r of rounds) for (const [p, v] of Object.entries(scoreRound(r, rules))) t[p] = (t[p] || 0) + v;
    return t;
  }

  const api = { DEFAULT_RULES, STATUSES, validate, scoreRound, totals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
