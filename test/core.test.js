// Run with: node --test test/core.test.js
const test = require('node:test');
const assert = require('node:assert');
const Core = require('../js/core.js');

test('matchPlayer maps app abbreviations', () => {
  const cases = { 'Hars.': 'Harsh', 'Sanil': 'Sanil', 'Suyo.': 'Suyog', 'Subh.': 'Subash', 'Subas.': 'Subash',
    'Raje.': 'Rajesh', 'Rajes.': 'Rajesh', 'Sarg.': 'Sargat', 'Bhuj.': 'Abhishek', 'Bhuju': 'Abhishek', 'Bh': 'Abhishek',
    'Abhis.': 'Abhishek', 'Abhishek': 'Abhishek', 'Sajol': 'Sajol', 'Utsu': 'Utsu', 'Uttu': 'Uttu' };
  for (const [raw, want] of Object.entries(cases)) assert.strictEqual(Core.matchPlayer(raw, {}), want, raw);
});

test('every abbreviation of every player, in any case', () => {
  for (const p of Core.PLAYERS) {
    for (let n = 3; n <= p.length; n++) {
      const ab = p.slice(0, n);
      for (const v of [ab, ab + '.', ab.toUpperCase(), ab.toUpperCase() + '.', ab.toLowerCase(), ab.toLowerCase() + '.']) {
        assert.strictEqual(Core.matchPlayer(v, {}), p, `${v} -> ${p}`);
      }
    }
  }
});

test('common OCR misreads still match', () => {
  const cases = { '5arg.': 'Sargat', 'Sarq.': 'Sargat', 'SARG': 'Sargat', 'Sargt': 'Sargat', 'Sargat.': 'Sargat',
    'Rajcs.': 'Rajesh', 'Su8as': 'Subash', 'Hars,': 'Harsh', 'Sani1': 'Sanil', 'Sajo1': 'Sajol', 'Suy0': 'Suyog' };
  for (const [raw, want] of Object.entries(cases)) assert.strictEqual(Core.matchPlayer(raw, {}), want, raw);
});

test('ambiguous or junk names are left for the user', () => {
  for (const raw of ['Ut', 'Sa', 'Su', 'S', '', 'Round', 'xyz', '###']) assert.strictEqual(Core.matchPlayer(raw, {}), '', raw);
});

test('learned aliases and custom player lists', () => {
  assert.strictEqual(Core.matchPlayer('Bunty', { bunty: 'Harsh' }), 'Harsh');
  assert.strictEqual(Core.matchPlayer('Kiran', {}, [...Core.PLAYERS, 'Kiran']), 'Kiran');
  assert.strictEqual(Core.matchPlayer('Kir.', {}, [...Core.PLAYERS, 'Kiran']), 'Kiran');
  // An alias pointing at a player who isn't in the list is ignored.
  assert.strictEqual(Core.matchPlayer('Bunty', { bunty: 'Ghost' }), '');
});

test('parseStartTime', () => {
  assert.strictEqual(Core.parseStartTime('Start Time : October 1, 2026 @ 6:49 PM'), '2026-10-01 18:49');
  assert.strictEqual(Core.parseStartTime('Start Time : September 28,2026 @ 7:46 PM'), '2026-09-28 19:46');
});

test('parseScoreboard reads totals and names by column', () => {
  const W = (text, x, y) => ({ text, x0: x - 20, x1: x + 20, y0: y - 10, y1: y + 10 });
  const xs = [300, 500, 700, 900, 1100];
  const words = [
    ...['Hars.', 'Sanil', 'Suyo.', 'Subh.', 'Bhuj.'].map((t, i) => W(t, xs[i], 100)),
    W('Total', 100, 150), ...[-43, -25, 12, 2, 54].map((v, i) => W(String(v), xs[i], 170)), W('Points', 100, 190),
    W('Rs.', 80, 240), W('10/pt', 130, 240), ...[-430, -250, 120, 20, 540].map((v, i) => W(String(v), xs[i], 260)),
  ];
  const r = Core.parseScoreboard(words);
  assert.deepStrictEqual(r.columns.map(c => [c.name, c.total]),
    [['Hars', -43], ['Sanil', -25], ['Suyo', 12], ['Subh', 2], ['Bhuj', 54]]);
  assert.deepStrictEqual(r.warnings, []);
});

test('settle produces balanced transfers', () => {
  const balances = { A: 1460, B: -1880, C: 1200, D: -560, E: 10, F: -1960, G: 560, H: 1170 };
  const t = Core.settle(balances);
  const net = {};
  for (const x of t) { net[x.from] = (net[x.from] || 0) - x.amount; net[x.to] = (net[x.to] || 0) + x.amount; }
  for (const [k, v] of Object.entries(balances)) assert.strictEqual(net[k] || 0, v, k);
  assert.ok(t.length <= 7);
});

test("a player's own name beats a nickname pointing elsewhere", () => {
  const players = [...Core.PLAYERS, 'Rujan', '__new'];
  assert.strictEqual(Core.matchPlayer('Rujan', { rujan: '__new' }, players), 'Rujan');
  assert.strictEqual(Core.matchPlayer('Ruja.', {}, [...Core.PLAYERS, 'Rujan']), 'Rujan');
  assert.strictEqual(Core.matchPlayer('Anvesh', {}, [...Core.PLAYERS, 'Anvesh']), 'Anvesh');
  assert.strictEqual(Core.matchPlayer('Anve.', {}, [...Core.PLAYERS, 'Anvesh']), 'Anvesh');
});
