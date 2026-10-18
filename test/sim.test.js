// Run with: node --test test/sim.test.js
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/sim.js');

test('sets, pairs and maal', () => {
  assert.ok(S.isSequence(['4♥', '5♥', '6♥']));
  assert.ok(S.isSequence(['Q♠', 'K♠', 'A♠']));
  assert.ok(!S.isSequence(['K♠', 'A♠', '2♠']));
  assert.ok(S.isTunnela(['K♦', 'K♦', 'K♦']));
  assert.ok(!S.isSet(['4♥', '5♦', '6♥']));
  assert.deepStrictEqual(S.findSets(['4♥', '5♥', '6♥', 'K♦', 'K♦', 'K♦', '9♣', '10♣', 'J♣', '2♠'], 3).length, 3);
  assert.strictEqual(S.findSets(['4♥', '5♥', '6♥', 'K♦', 'K♦'], 2), null);
  assert.strictEqual(S.pairs(['Q♥', 'Q♥', 'Q♥', '3♣', '3♣', 'PUT', 'PUT']).length, 2);
  // Tiplu 7♠: 6♠ jhiplu 2, 8♠ poplu 2, 7♣ alter 5, 7♠ tiplu 3; A♠/K♠ wrap.
  assert.strictEqual(S.maal(['7♠', '6♠', '8♠', '7♣', '2♥'], '7♠').total, 12);
  // ...but 6♠ 7♠ 8♠ shown as one sequence is a marriage: 10, plus the alter 5.
  assert.strictEqual(S.maal(['7♠', '6♠', '8♠', '7♣'], '7♠', [['6♠', '7♠', '8♠']]).total, 15);
  assert.strictEqual(S.maalRole('K♥', 'A♥'), 'jhiplu');
  assert.strictEqual(S.maalRole('2♥', 'A♥'), 'poplu');
  assert.strictEqual(S.maalRole('A♦', 'A♥'), 'alter');
  assert.strictEqual(S.maalRole('A♣', 'A♥'), null); // other colour
  assert.strictEqual(S.maal(['SUP'], '7♠').total, 10);
  assert.strictEqual(S.maal(['PUT'], '7♠').total, 5);
  assert.strictEqual(S.maal(['PUT', 'PUT'], '7♠').total, 15);
});

test('scoring matches the ledger formula', () => {
  const pts = S.score([
    { status: 'seen', maal: 3 }, { status: 'seen', maal: 0 }, { status: 'dublee', maal: 7 }, { status: 'seen', maal: 2 }, { status: 'won', maal: 5 },
  ]);
  assert.deepStrictEqual(pts, [-5, -20, 18, -10, 17]);
});

test('hero hands are real and ready to show', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const h = S.heroHand(seed);
    assert.strictEqual(h.hand.length, 21);
    if (h.mode === 'sets') { assert.strictEqual(h.groups.length, 3); h.groups.forEach(g => assert.ok(S.isSet(g))); }
    else { assert.strictEqual(h.groups.length, 7); assert.strictEqual(S.pairs(h.hand).length, 7); }
    assert.ok(h.hand.filter(c => c === 'PUT').length <= 2);
    const counts = S.shoe();
    for (const c of [...h.hand, h.tiplu]) { counts.set(c, counts.get(c) - 1); assert.ok(counts.get(c) >= 0, `too many ${c}`); }
  }
});

test('simulated games are legal from deal to declaration', () => {
  const names = ['Sargat', 'Sanil', 'Rajesh', 'Abhishek'];
  let pickups = 0, power = 0;
  for (let seed = 1; seed <= 150; seed++) {
    const g = S.game(names, seed);
    // Every card used fits in the shoe (3 decks, 1 Superman, 3 Putalis).
    const counts = S.shoe();
    const use = c => { counts.set(c, counts.get(c) - 1); assert.ok(counts.get(c) >= 0, `seed ${seed}: too many ${c}`); };
    g.players.forEach(p => p.start.forEach(use));
    use(g.tiplu); use(g.firstDiscard);
    g.events.forEach(e => { if (e.from === 'pile') use(e.draw); });

    // Replay the turns.
    const hands = g.players.map(p => [...p.start]);
    let top = g.firstDiscard;
    const seen = [false, false, false, false];
    for (const e of g.events) {
      const h = hands[e.seat];
      if (e.from === 'discard') assert.strictEqual(e.draw, top, `seed ${seed}: picked up a card that wasn't on the discard pile`);
      h.push(e.draw);
      const i = h.lastIndexOf(e.discard);
      assert.ok(i >= 0, `seed ${seed}: threw a card not in hand`);
      h.splice(i, 1);
      top = e.discard;
      assert.strictEqual(h.length, 21);
      if (e.show) {
        seen[e.seat] = true;
        const flat = e.show.groups.flat();
        const rest = [...h];
        for (const c of flat) { const k = rest.indexOf(c); assert.ok(k >= 0); rest.splice(k, 1); }
        if (e.show.kind === 'sets') { assert.strictEqual(e.show.groups.length, 3); e.show.groups.forEach(s => assert.ok(S.isSet(s))); }
        else { assert.strictEqual(e.show.groups.length, 7); e.show.groups.forEach(([a, b]) => assert.strictEqual(a, b)); }
      }
      if (e.win) {
        assert.strictEqual(e.win.groups.length, 7);
        e.win.groups.forEach(s => assert.ok(S.isSet(s)));
        assert.deepStrictEqual([...e.win.groups.flat()].sort(), [...h].sort());
      }
    }
    assert.ok(g.events[g.events.length - 1].win, 'game ends with a declaration');
    g.players.forEach((p, i) => assert.deepStrictEqual([...p.end].sort(), [...hands[i]].sort()));
    assert.deepStrictEqual(g.players.map(p => p.role).sort(), ['dublee', 'seen', 'unseen', 'winner']);
    assert.ok(g.players.find(p => p.role === 'dublee').shown.kind === 'pairs');
    assert.strictEqual(g.players.find(p => p.role === 'unseen').shown, null);
    assert.strictEqual(g.players.reduce((s, p) => s + p.points, 0), 0);
    g.players.forEach(p => assert.ok(p.end.filter(c => c === 'PUT').length <= 2));
    if (g.pickup) pickups++;
    if (g.players.some(p => p.end.some(S.isPower))) power++;
  }
  console.log(`  ${pickups}/150 games had a discard pickup, ${power}/150 had a power card in play`);
});
