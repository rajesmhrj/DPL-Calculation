// Run with: node --test test/scoring.test.js
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/scoring.js');
const round = (winner, rows) => ({ winner, entries: rows.map(([player, status, maal]) => ({ player, status, maal })) });

test('matches Marriage Point Calculator rounds from our screenshots', () => {
  assert.deepStrictEqual(S.scoreRound(round('Rajesh', [['Sanil', 'unseen', 0], ['Subash', 'seen', 5], ['Rajesh', 'seen', 13], ['Abhishek', 'seen', 7], ['Suyog', 'seen', 3]])),
    { Sanil: -38, Subash: -6, Rajesh: 56, Abhishek: 4, Suyog: -16 });
  assert.deepStrictEqual(S.scoreRound(round('Suyog', [['A', 'unseen', 0], ['B', 'unseen', 0], ['C', 'unseen', 0], ['D', 'unseen', 0], ['Suyog', 'seen', 30]])),
    { A: -40, B: -40, C: -40, D: -40, Suyog: 160 });
  assert.deepStrictEqual(S.scoreRound(round('Suyog', [['Harsh', 'seen', 5], ['Sanil', 'seen', 5], ['Suyog', 'seen', 7], ['Subh', 'unseen', 0], ['Bhuj', 'hold', 0]])),
    { Harsh: 0, Sanil: 0, Suyog: 27, Subh: -27, Bhuj: 0 });
  assert.deepStrictEqual(S.scoreRound(round('Bhuj', [['Harsh', 'seen', 3], ['Sanil', 'seen', 0], ['Suyog', 'dublee', 7], ['Subh', 'seen', 2], ['Bhuj', 'seen', 5]])),
    { Harsh: -5, Sanil: -20, Suyog: 18, Subh: -10, Bhuj: 17 });
});

test('kidnap, foul, dublee winner', () => {
  const r = round('A', [['A', 'seen', 10], ['B', 'seen', 4], ['C', 'unseen', 6]]);
  assert.deepStrictEqual(S.scoreRound(r, { ...S.DEFAULT_RULES, mode: 'kidnap' }), { A: 41, B: -11, C: -30 });
  assert.deepStrictEqual(S.scoreRound(round('A', [['A', 'dublee', 6], ['B', 'seen', 3], ['C', 'foul', 9]])), { A: 37, B: -8, C: -29 });
});

test('validation and totals', () => {
  assert.ok(S.validate(round('A', [['A', 'unseen', 0], ['B', 'seen', 0]])).some(p => /seen/.test(p)));
  assert.ok(S.validate(round('', [['A', 'seen', 0], ['B', 'seen', 0]])).some(p => /crown/.test(p)));
  const t = S.totals([round('A', [['A', 'seen', 4], ['B', 'seen', 2]]), round('B', [['A', 'seen', 0], ['B', 'seen', 3]])], ['A', 'B']);
  assert.deepStrictEqual(t, { A: -1, B: 1 });
});
