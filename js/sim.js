/* A Marriage game simulator for the animations: real 3-deck shoe plus the
 * power cards, legal hands, real sets, maal and scoring.
 *
 * Games are random every time but steered so a 4-player game always has a
 * winner, a dublee player and someone who's seen: we pick each player's
 * finishing hand first, deal them a starting hand that's missing some of it,
 * and stack the draw pile so the missing cards arrive over the turns. The
 * starting hands, draws, discards, shows and the final declaration are then
 * replayed and checked turn by turn with the same rules a player would use.
 *
 * Works in the browser (window.Sim) and Node (module.exports) for tests. */
(function (root) {
  'use strict';

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const COLOR = { '♠': 'black', '♣': 'black', '♥': 'red', '♦': 'red' };
  const SUPERMAN = 'SUP', PUTALI = 'PUT';

  // Maal values. Superman counts when it wasn't used to show a sequence
  // (the simulator never uses it that way). Putalis: one 5, two together 15;
  // three is a house rule we don't know, so no simulated hand ever holds three.
  const MAAL = { tiplu: 3, jhiplu: 2, poplu: 2, alter: 5, marriage: 10, superman: 10, putali1: 5, putali2: 15 };
  const GAME_POINTS = { seen: 3, unseen: 10, dublee: 0 };

  /* ---------- Random ---------- */
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  function shuffle(r, arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  /* ---------- Cards ---------- */
  // A card is a string key: "7♠", "10♥", "SUP" or "PUT".
  const key = (rank, suit) => rank + suit;
  const rankOf = c => (c === SUPERMAN || c === PUTALI ? c : c.slice(0, -1));
  const suitOf = c => (c === SUPERMAN || c === PUTALI ? '' : c.slice(-1));
  const isPower = c => c === SUPERMAN || c === PUTALI;
  const ri = c => RANKS.indexOf(rankOf(c));

  /** The shoe: 3 decks (each card three times), 1 Superman, 3 Putalis. */
  function shoe() {
    const counts = new Map();
    for (const s of SUITS) for (const r of RANKS) counts.set(key(r, s), 3);
    counts.set(SUPERMAN, 1);
    counts.set(PUTALI, 3);
    return counts;
  }
  function take(counts, c) {
    const n = counts.get(c) || 0;
    if (n <= 0) return false;
    counts.set(c, n - 1);
    return true;
  }
  function randomFrom(r, counts, ok = () => true) {
    const pool = [];
    for (const [c, n] of counts) if (n > 0 && ok(c)) for (let i = 0; i < n; i++) pool.push(c);
    if (!pool.length) return null;
    const c = pick(r, pool);
    take(counts, c);
    return c;
  }

  /* ---------- Sets ---------- */
  // Pure sequences of three (A low, and Q-K-A) and tunnelas (three identical cards).
  function isSequence(cards) {
    if (cards.length !== 3 || cards.some(isPower)) return false;
    const s = suitOf(cards[0]);
    if (cards.some(c => suitOf(c) !== s)) return false;
    const idx = cards.map(ri).sort((a, b) => a - b);
    if (idx[0] + 1 === idx[1] && idx[1] + 1 === idx[2]) return true;
    return idx[0] === 0 && idx[1] === 11 && idx[2] === 12; // Q K A
  }
  const isTunnela = cards => cards.length === 3 && !isPower(cards[0]) && cards.every(c => c === cards[0]);
  const isSet = cards => isSequence(cards) || isTunnela(cards);

  function multiset(cards) { const m = new Map(); for (const c of cards) m.set(c, (m.get(c) || 0) + 1); return m; }
  function remove(cards, sub) {
    const rest = [...cards];
    for (const c of sub) { const i = rest.indexOf(c); if (i < 0) return null; rest.splice(i, 1); }
    return rest;
  }

  /** All three-card sets that can be made from these cards (no duplicates). */
  function candidateSets(cards) {
    const m = multiset(cards);
    const out = [];
    for (const [c, n] of m) if (!isPower(c) && n >= 3) out.push([c, c, c]);
    for (const s of SUITS) {
      for (let i = 0; i < 13; i++) {
        const trio = [i, i + 1, i + 2].map(k => key(RANKS[k % 13], s));
        if (i === 11) trio.splice(0, 3, key('Q', s), key('K', s), key('A', s));
        if (i > 11) continue;
        if (trio.every(c => (m.get(c) || 0) >= 1)) out.push(trio);
      }
    }
    return out;
  }

  /** `n` disjoint pure sets from the hand, or null. */
  function findSets(cards, n) {
    if (n === 0) return [];
    for (const set of candidateSets(cards)) {
      const rest = remove(cards, set);
      const more = rest && findSets(rest, n - 1);
      if (more) return [set, ...more];
    }
    return null;
  }

  /** Identical pairs in the hand (power cards don't pair). */
  function pairs(cards) {
    const out = [];
    for (const [c, n] of multiset(cards)) if (!isPower(c)) for (let i = 0; i < Math.floor(n / 2); i++) out.push([c, c]);
    return out;
  }

  /* ---------- Maal ---------- */
  function maalRole(c, tiplu) {
    if (isPower(c)) return c === SUPERMAN ? 'superman' : 'putali';
    if (c === tiplu) return 'tiplu';
    if (suitOf(c) === suitOf(tiplu)) {
      const d = (ri(c) - ri(tiplu) + 13) % 13;
      if (d === 1) return 'poplu';
      if (d === 12) return 'jhiplu';
    }
    if (rankOf(c) === rankOf(tiplu) && suitOf(c) !== suitOf(tiplu) && COLOR[suitOf(c)] === COLOR[suitOf(tiplu)]) return 'alter';
    return null;
  }

  /**
   * Maal in a hand. `sets` are the hand's sets (shown or final): a sequence of
   * jhiplu + tiplu + poplu is a marriage and counts 10 instead of 2 + 3 + 2.
   */
  function maal(cards, tiplu, sets = []) {
    const items = [];
    let rest = [...cards];
    for (const set of sets) {
      const roles = set.map(c => maalRole(c, tiplu));
      if (isSequence(set) && ['jhiplu', 'tiplu', 'poplu'].every(r => roles.includes(r))) {
        items.push({ cards: set, what: 'Marriage', value: MAAL.marriage });
        rest = remove(rest, set) || rest;
      }
    }
    let putalis = 0;
    for (const c of rest) {
      const role = maalRole(c, tiplu);
      if (role === 'putali') { putalis++; continue; }
      if (role) items.push({ cards: [c], what: role[0].toUpperCase() + role.slice(1), value: MAAL[role] });
    }
    if (putalis === 1) items.push({ cards: [PUTALI], what: 'Putali', value: MAAL.putali1 });
    if (putalis >= 2) items.push({ cards: Array(putalis).fill(PUTALI), what: `${putalis} Putalis`, value: MAAL.putali2 });
    return { items, total: items.reduce((s, x) => s + x.value, 0) };
  }

  /** Points for a hand: n × own maal − total maal − game points (murder rule). */
  function score(players) {
    const n = players.length;
    const counted = players.map(p => (p.status === 'unseen' ? 0 : p.maal));
    const total = counted.reduce((a, b) => a + b, 0);
    const pts = players.map((p, i) => (p.status === 'won' ? 0 : n * counted[i] - total - GAME_POINTS[p.status]));
    const w = players.findIndex(p => p.status === 'won');
    pts[w] = -pts.reduce((a, b) => a + b, 0);
    return pts;
  }

  /* ---------- Hand building ---------- */
  function randomSet(r, counts) {
    for (let tries = 0; tries < 60; tries++) {
      let set;
      if (r() < 0.3) { const c = key(pick(r, RANKS), pick(r, SUITS)); set = [c, c, c]; }
      else {
        const s = pick(r, SUITS), i = Math.floor(r() * 12);
        set = i === 11 ? [key('Q', s), key('K', s), key('A', s)] : [i, i + 1, i + 2].map(k => key(RANKS[k], s));
      }
      const need = multiset(set);
      if ([...need].every(([c, n]) => (counts.get(c) || 0) >= n)) { set.forEach(c => take(counts, c)); return set; }
    }
    return null;
  }

  function randomPair(r, counts) {
    for (let tries = 0; tries < 60; tries++) {
      const c = key(pick(r, RANKS), pick(r, SUITS));
      if ((counts.get(c) || 0) >= 2) { take(counts, c); take(counts, c); return [c, c]; }
    }
    return null;
  }

  /** Cards in hand order: sets/pairs first, then the rest sorted by suit and rank. */
  function sortCards(cards) {
    const order = c => (isPower(c) ? 100 + (c === SUPERMAN ? 0 : 1) : SUITS.indexOf(suitOf(c)) * 13 + ri(c));
    return [...cards].sort((a, b) => order(a) - order(b));
  }

  /* ---------- One random hand (home page) ---------- */
  /**
   * A random hand that's ready to show: three pure sets (or, about one time in
   * four, seven dublees), plus a random tiplu from the rest of the shoe.
   */
  function heroHand(seed = Date.now()) {
    const r = rng(seed);
    for (let attempt = 0; attempt < 200; attempt++) {
      const counts = shoe();
      const dublee = r() < 0.25;
      const groups = [];
      for (let i = 0; i < (dublee ? 7 : 3); i++) {
        const g = dublee ? randomPair(r, counts) : randomSet(r, counts);
        if (!g) break;
        groups.push(g);
      }
      if (groups.length !== (dublee ? 7 : 3)) continue;
      const rest = [];
      let putalis = 0;
      while (rest.length < 21 - groups.flat().length) {
        const c = randomFrom(r, counts, c => c !== PUTALI || putalis < 2);
        if (c === PUTALI) putalis++;
        rest.push(c);
      }
      const tiplu = randomFrom(r, counts, c => !isPower(c));
      const hand = [...groups.flat(), ...rest];
      // A dublee hand shouldn't accidentally have more pairs than it shows.
      if (dublee && pairs(hand).length !== 7) continue;
      const m = maal(hand, tiplu, dublee ? [] : groups);
      return { mode: dublee ? 'dublee' : 'sets', groups, rest: sortCards(rest), hand, tiplu, maal: m };
    }
    throw new Error('Could not build a hand');
  }

  /* ---------- A whole 4-player game ---------- */
  const ROLES = ['winner', 'dublee', 'seen', 'unseen'];

  function buildGame(r, names) {
    const counts = shoe();
    const tiplu = randomFrom(r, counts, c => !isPower(c));
    const family = [];
    for (const [c] of counts) if (maalRole(c, tiplu) && !isPower(c)) family.push(c);
    const roles = shuffle(r, ROLES);
    let putalisDealt = 0;

    // 1. Each player's finishing hand.
    const finals = roles.map(role => {
      let groups = [];
      if (role === 'winner') { for (let i = 0; i < 7; i++) groups.push(randomSet(r, counts)); }
      else if (role === 'seen') { for (let i = 0; i < 3; i++) groups.push(randomSet(r, counts)); }
      else if (role === 'dublee') { for (let i = 0; i < 7; i++) groups.push(randomPair(r, counts)); }
      else { for (let i = 0; i < 2; i++) groups.push(randomSet(r, counts)); }
      if (groups.some(g => !g)) return null;
      const cards = groups.flat();
      const extras = [];
      // Sprinkle maal and power cards so there's something to count.
      if (role !== 'winner') {
        if (r() < 0.7) { const c = pick(r, family); if (take(counts, c)) extras.push(c); }
        if (r() < 0.35 && take(counts, SUPERMAN)) extras.push(SUPERMAN);
        const p = r() < 0.4 ? (r() < 0.4 ? 2 : 1) : 0;
        for (let i = 0; i < p && putalisDealt < 3; i++) if (take(counts, PUTALI)) { extras.push(PUTALI); putalisDealt++; }
      }
      while (cards.length + extras.length < 21) {
        const c = randomFrom(r, counts, c => c !== PUTALI);
        if (!c) return null;
        extras.push(c);
      }
      return { role, groups, cards: [...cards, ...extras] };
    });
    if (finals.some(f => !f)) return null;

    // 2. What each player still needs: cards pulled out of their sets.
    const needs = finals.map(f => {
      const groupIdx = shuffle(r, f.groups.map((_, i) => i));
      const k = f.role === 'winner' ? 5 + Math.floor(r() * 2) : f.role === 'dublee' ? 2 + Math.floor(r() * 2) : f.role === 'seen' ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2);
      return groupIdx.slice(0, Math.min(k, f.groups.length)).map(i => pick(r, f.groups[i]));
    });

    // 3. Starting hands: the finishing hand minus its needs, plus junk.
    const starts = finals.map((f, i) => {
      let hand = remove(f.cards, needs[i]);
      const junk = [];
      for (let k = 0; k < needs[i].length; k++) {
        const c = randomFrom(r, counts, c => c !== PUTALI && c !== SUPERMAN);
        if (!c) return null;
        junk.push(c);
      }
      return { hand: [...hand, ...junk], junk };
    });
    if (starts.some(s => !s)) return null;

    // 4. Turn plan. The winner's last need comes on their last turn; players
    //    who show (dublee, seen) get theirs in the first part of the game.
    const winnerSeat = roles.indexOf('winner');
    const T = needs[winnerSeat].length + 2 + Math.floor(r() * 3);
    const plans = finals.map((f, i) => {
      const turns = i <= winnerSeat ? T : T - 1;
      const plan = Array(turns).fill(null);
      if (f.role === 'winner') {
        const slots = shuffle(r, [...Array(T - 1).keys()]).slice(0, needs[i].length - 1);
        slots.forEach((s, k) => { plan[s] = needs[i][k]; });
        plan[T - 1] = needs[i][needs[i].length - 1];
      } else {
        const limit = f.role === 'unseen' ? turns : Math.max(needs[i].length, Math.floor(turns * 0.75));
        const slots = shuffle(r, [...Array(limit).keys()]).slice(0, needs[i].length);
        if (slots.length < needs[i].length) return null;
        slots.forEach((s, k) => { plan[s] = needs[i][k]; });
      }
      return plan;
    });
    if (plans.some(p => !p)) return null;

    // 5. Play it out, building the draw pile as we go.
    const firstDiscard = randomFrom(r, counts, c => !isPower(c));
    const hands = starts.map(s => [...s.hand]);
    const junkLeft = starts.map(s => shuffle(r, s.junk));
    const shown = roles.map(() => null);
    const events = [];
    let discardTop = firstDiscard;

    // One discard pickup per game where it fits: the player before someone
    // throws exactly the card that someone needs next.
    let pickup = null;
    for (let t = 1; t < T - 1 && !pickup; t++) {
      for (let seat = 0; seat < 4 && !pickup; seat++) {
        const prev = (seat + 3) % 4;
        const prevTurn = seat === 0 ? t - 1 : t;
        if (roles[seat] === 'winner' || !plans[seat][t] || !plans[prev][prevTurn]) continue;
        const c = plans[seat][t];
        if (!starts[prev].junk.length || hands[prev].includes(c)) continue;
        // Swap one of prev's junk cards for c (put the junk back in the shoe).
        const old = junkLeft[prev].pop();
        counts.set(old, (counts.get(old) || 0) + 1);
        hands[prev][hands[prev].lastIndexOf(old)] = c;
        starts[prev].hand = [...hands[prev]];
        junkLeft[prev].push(c); // thrown on prevTurn (pushed last = popped first)
        pickup = { seat, turn: t, prevSeat: prev, prevTurn, card: c };
      }
    }

    for (let t = 0; t < T; t++) {
      for (let seat = 0; seat < 4; seat++) {
        if (t >= plans[seat].length) continue;
        const need = plans[seat][t];
        let draw, from = 'pile', discard;
        if (pickup && pickup.seat === seat && pickup.turn === t) { draw = discardTop; from = 'discard'; }
        else if (need) draw = need; // already counted out of the shoe as part of their final hand
        else draw = randomFrom(r, counts, c => c !== PUTALI && c !== SUPERMAN);
        if (!draw) return null;
        hands[seat].push(draw);
        if (need && draw === need) {
          // Throw a junk card. On the turn right before a pickup, throw the card being picked up.
          if (pickup && pickup.prevSeat === seat && pickup.prevTurn === t) discard = pickup.card;
          else discard = junkLeft[seat].find(c => !(pickup && c === pickup.card && pickup.prevSeat === seat)) || junkLeft[seat][0];
          junkLeft[seat].splice(junkLeft[seat].indexOf(discard), 1);
        } else discard = draw; // nothing useful: straight back out
        hands[seat].splice(hands[seat].lastIndexOf(discard), 1);
        discardTop = discard;

        const ev = { type: 'turn', seat, round: t, from, draw, discard, useful: !!need };
        // Show when the hand really allows it.
        if (!shown[seat]) {
          if (roles[seat] === 'dublee') {
            const ps = pairs(hands[seat]);
            if (ps.length >= 7) { shown[seat] = { kind: 'pairs', groups: ps.slice(0, 7) }; ev.show = shown[seat]; }
          } else if (roles[seat] !== 'unseen') {
            const sets = findSets(hands[seat], 3);
            if (sets) { shown[seat] = { kind: 'sets', groups: sets }; ev.show = shown[seat]; }
          } else if (findSets(hands[seat], 3)) return null; // the unseen player must stay unseen
        }
        if (roles[seat] === 'winner' && shown[seat]) {
          const rest = remove(hands[seat], shown[seat].groups.flat());
          const restSets = rest && findSets(rest, 4);
          if (restSets) {
            if (t !== T - 1) return null; // finished early: try another deal
            ev.win = { groups: [...shown[seat].groups, ...restSets] };
            events.push(ev);
            return finish();
          }
        }
        events.push(ev);
      }
    }
    return null;

    function finish() {
      if (!shown.every((s, i) => roles[i] === 'unseen' ? !s : !!s)) return null;
      const players = roles.map((role, i) => {
        const status = role === 'winner' ? 'won' : role === 'dublee' ? 'dublee' : role === 'seen' ? 'seen' : 'unseen';
        const sets = role === 'winner' ? events[events.length - 1].win.groups : shown[i] && shown[i].kind === 'sets' ? shown[i].groups : [];
        const m = maal(hands[i], tiplu, sets);
        if (hands[i].filter(c => c === PUTALI).length > 2) return null;
        return { name: names[i], role, status, start: sortCards(starts[i].hand), end: sortCards(hands[i]), shown: shown[i], maalItems: m.items, maal: m.total };
      });
      if (players.some(p => !p)) return null;
      const pts = score(players);
      players.forEach((p, i) => { p.points = pts[i]; });
      return { tiplu, firstDiscard, players, events, winnerSeat, pickup };
    }
  }

  /** A complete random game for four named players. */
  function game(names, seed = Date.now()) {
    const r = rng(seed);
    for (let attempt = 0; attempt < 400; attempt++) {
      const g = buildGame(r, names);
      if (g) return g;
    }
    throw new Error('Could not build a game');
  }

  const api = { RANKS, SUITS, SUPERMAN, PUTALI, MAAL, rng, shoe, isSet, isSequence, isTunnela, findSets, pairs, maal, maalRole, score, heroHand, game, sortCards, rankOf, suitOf, isPower };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
