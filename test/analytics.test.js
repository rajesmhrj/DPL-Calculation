// Run with: node --test test/analytics.test.js
const test = require('node:test');
const assert = require('node:assert');
const A = require('../js/analytics.js');

const games = [
  { id: '1', date: '2026-10-01 18:00', scores: { A: 50, B: -20, C: -30 } },
  { id: '2', date: '2026-10-02 18:00', scores: { A: 10, B: -10 } },
  { id: '3', date: '2026-10-03 18:00', scores: { A: -40, B: 25, C: 15 } },
  { id: '0', date: '2026-09-30 18:00', scores: { B: 5, C: -5 } },
];

test('player stats', () => {
  const a = A.player(games, 'A', 10);
  assert.strictEqual(a.games, 3);
  assert.deepStrictEqual([a.wins, a.losses, a.evens], [2, 1, 0]);
  assert.strictEqual(a.net, 200);
  assert.strictEqual(a.best.value, 500);
  assert.strictEqual(a.worst.value, -400);
  assert.deepStrictEqual(a.series.map(s => s.cum), [500, 600, 200]);
  assert.deepStrictEqual(a.streak.current, { type: 'loss', length: 1 });
  assert.strictEqual(a.streak.longestWin, 2);
  assert.strictEqual(a.topFinishes, 2);
  assert.strictEqual(a.series[2].place, 3);
});

test('streaks', () => {
  assert.deepStrictEqual(A.streaks([1, 2, -1, -1, -1, 3]), { current: { type: 'win', length: 1 }, longestWin: 2, longestLoss: 3 });
  assert.deepStrictEqual(A.streaks([1, 0, 1]).longestWin, 1);
  assert.strictEqual(A.streaks([]).current, null);
});

test('group stats', () => {
  const g = A.group(games, ['A', 'B', 'C', 'D'], 10);
  assert.strictEqual(g.games, 4);
  assert.deepStrictEqual(g.players.map(p => p.name), ['A', 'B', 'C']); // D never played
  assert.strictEqual(g.moneyMoved, 50 + 500 + 100 + 400);
  assert.deepStrictEqual(g.biggestWin, { name: 'A', value: 500, date: '2026-10-01 18:00' });
  assert.deepStrictEqual(g.biggestLoss, { name: 'A', value: -400, date: '2026-10-03 18:00' });
  assert.deepStrictEqual(g.cumulative.A, [0, 500, 600, 200]);
  for (let i = 0; i < g.games; i++) assert.strictEqual(Object.values(g.cumulative).reduce((s, c) => s + c[i], 0), 0);
});

test('head to head', () => {
  const h = A.headToHead(games, 'A', 'B', 10);
  assert.strictEqual(h.games, 3);
  assert.deepStrictEqual([h.aAhead, h.bAhead, h.ties], [2, 1, 0]);
  assert.deepStrictEqual([h.aNet, h.bNet], [200, -50]);
  assert.strictEqual(h.biggestGap.id, '1'); // 500 vs -200: a 700 gap
  const r = A.rivals(games, 'C', ['A', 'B', 'C', 'D'], 10);
  assert.deepStrictEqual(r.map(x => [x.b, x.games]), [['B', 3], ['A', 2]]);
});

test('days of the week', () => {
  assert.strictEqual(A.weekday('2026-10-17 12:45'), 6); // Saturday
  assert.strictEqual(A.weekday('2026-10-11 20:00'), 0); // Sunday
  assert.strictEqual(A.weekday('nonsense'), -1);
  const g = [
    { date: '2026-10-10 19:00', scores: { A: 10, B: -10 } },  // Sat
    { date: '2026-10-17 19:00', scores: { A: 30, B: -30 } },  // Sat
    { date: '2026-10-12 19:00', scores: { A: -5, B: 5 } },    // Mon
    { date: '2026-10-19 19:00', scores: { A: -15, B: 15 } },  // Mon
    { date: '2026-10-13 19:00', scores: { A: 100, B: -100 } }, // Tue, only once
  ];
  const rows = A.playerWeekdays(g, 'A', 10);
  assert.strictEqual(rows.length, 7);
  assert.deepStrictEqual([rows[6].games, rows[6].wins, rows[6].net, rows[6].avg], [2, 2, 400, 200]);
  assert.deepStrictEqual([rows[1].games, rows[1].losses, rows[1].avg], [2, 2, -100]);
  // Tuesday has the best average but only one game, so it doesn't count.
  assert.strictEqual(A.bestDay(rows).day, 'Saturday');
  assert.strictEqual(A.bestDay(rows, 1).day, 'Tuesday');
  assert.strictEqual(A.luckiestDay(rows).day, 'Saturday');
  assert.strictEqual(A.worstDay(rows).day, 'Monday');
  assert.strictEqual(A.bestDay(A.playerWeekdays([], 'A', 10)), null);
  const grp = A.groupWeekdays(g, 10);
  assert.deepStrictEqual([grp[6].games, grp[6].moneyMoved, grp[6].avgPlayers], [2, 400, 2]);
});

test('each game can have its own rupees per point', () => {
  const g = [
    { id: '1', date: '2026-10-01 18:00', scores: { A: 10, B: -10 } },           // usual rate (10)
    { id: '2', date: '2026-10-02 18:00', scores: { A: -5, B: 5 }, rate: 50 },   // high stakes night
  ];
  assert.strictEqual(A.player(g, 'A', 10).net, 100 - 250);
  const grp = A.group(g, ['A', 'B'], 10);
  assert.deepStrictEqual(grp.cumulative.A, [100, -150]);
  assert.strictEqual(grp.moneyMoved, 100 + 250);
  assert.deepStrictEqual([A.headToHead(g, 'A', 'B', 10).aNet, A.headToHead(g, 'A', 'B', 10).bNet], [-150, 150]);
  assert.strictEqual(A.groupWeekdays(g, 10).reduce((s, d) => s + d.moneyMoved, 0), 350);
});
