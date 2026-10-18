/* Watch a game: plays a simulated 4-player game (js/sim.js) card by card. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FRIENDS = ['Uttu', 'Utsu', 'Sanil', 'Harsh', 'Sargat', 'Subash', 'Rajesh', 'Suyog', 'Abhishek', 'Sajol', 'Rujan', 'Anvesh'];
  const STATUS_TEXT = { playing: 'Playing', seen: 'Seen', dublee: 'Dublee', won: 'Won', unseen: 'Unseen' };
  const label = Cards.label;

  let g, steps, pos, state, runId = 0;
  let focus = 'all', speed = 1, paused = false, skipping = false, gateOpen = null;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const sleep = ms => (skipping ? Promise.resolve() : new Promise(r => setTimeout(r, ms / speed)));
  const name = s => g.players[s].name;

  /* ---------- Steps ---------- */
  function newGame() {
    runId++;
    const names = [...FRIENDS].sort(() => Math.random() - 0.5).slice(0, 4);
    g = Sim.game(names, Math.floor(Math.random() * 2 ** 31));
    steps = [{ type: 'deal' }, { type: 'open' }];
    for (const ev of g.events) {
      steps.push({ type: 'draw', ev }, { type: 'discard', ev });
      if (ev.show) steps.push({ type: 'show', ev });
      if (ev.win) steps.push({ type: 'win', ev });
    }
    steps.push({ type: 'end' });
    pos = 0;
    state = {
      hands: [[], [], [], []], shown: [null, null, null, null], status: Array(4).fill('playing'),
      last: Array(4).fill(''), moments: [[], [], [], []], fresh: [null, null, null, null],
      discard: null, pile: 160 - 84 - 2, tipluUp: false, turn: -1, over: false, round: 0,
    };
    $('#final').hidden = true;
    narrate(`New game: ${list(names)}. Shuffling three decks, the Superman and three Putalis.`);
    renderAll();
    if (!paused) run(runId);
    else setControls();
  }

  const list = xs => xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];
  function narrate(text) { $('#narration').textContent = text; }
  function moment(seat, text, key = false) { state.moments[seat].push({ text, key, round: state.round }); }

  async function run(id) {
    setControls();
    while (pos < steps.length) {
      if (id !== runId) return;
      if (paused && !skipping) { await new Promise(r => { gateOpen = r; }); if (id !== runId) return; }
      await perform(steps[pos], id);
      if (id !== runId) return;
      pos++;
    }
    skipping = false;
    setControls();
  }

  async function perform(step, id) {
    const ev = step.ev;
    if (step.type === 'deal') {
      narrate('Dealing 21 cards to each player, one at a time.');
      const orders = g.players.map(p => [...p.start].sort(() => Math.random() - 0.5));
      for (let k = 0; k < 21; k++) {
        for (let s = 0; s < 4; s++) {
          state.hands[s].push(orders[s][k]);
          if (!skipping && !reduceMotion && k % 3 === 0) fly($('#pile'), seatEl(s), null, 260);
        }
        renderSeats();
        await sleep(110);
        if (id !== runId) return;
      }
      g.players.forEach((p, s) => moment(s, 'Dealt 21 cards.'));
      renderAll();
      await sleep(400);
    } else if (step.type === 'open') {
      state.discard = g.firstDiscard;
      state.pile--;
      narrate(`The joker goes face down in the middle, and ${label(g.firstDiscard)} is turned up to start the discards. ${name(0)} goes first.`);
      renderCenter();
      await sleep(1400);
    } else if (step.type === 'draw') {
      state.turn = ev.seat;
      state.round = ev.round + 1;
      const from = ev.from === 'discard' ? $('#discard') : $('#pile');
      if (ev.from === 'discard') state.discard = null; else state.pile--;
      renderSeats(); renderCenter();
      await fly(from, seatEl(ev.seat), ev.from === 'discard' ? ev.draw : null, 420);
      state.hands[ev.seat].push(ev.draw);
      state.fresh[ev.seat] = ev.draw;
      narrate(ev.from === 'discard'
        ? `${name(ev.seat)} picks up ${label(ev.draw)} from the discards.`
        : `${name(ev.seat)} draws from the pile.`);
      renderSeats(); renderPanels();
      await sleep(260);
    } else if (step.type === 'discard') {
      const h = state.hands[ev.seat];
      h.splice(h.lastIndexOf(ev.discard), 1);
      await fly(seatEl(ev.seat), $('#discard'), ev.discard, 420);
      state.discard = ev.discard;
      if (ev.discard === ev.draw && ev.from === 'pile') {
        state.fresh[ev.seat] = null;
        state.last[ev.seat] = `Drew ${label(ev.draw)}, threw it back`;
        moment(ev.seat, `Round ${state.round}: drew ${label(ev.draw)} from the pile and threw it straight back.`);
        narrate(`${name(ev.seat)} doesn't need ${label(ev.draw)} and throws it.`);
      } else {
        const took = ev.from === 'discard' ? `picked up ${label(ev.draw)} from the discards` : `drew ${label(ev.draw)} from the pile`;
        state.last[ev.seat] = `${ev.from === 'discard' ? 'Took' : 'Kept'} ${label(ev.draw)}, threw ${label(ev.discard)}`;
        moment(ev.seat, `Round ${state.round}: ${took}, kept it and threw ${label(ev.discard)}.`, ev.from === 'discard');
        narrate(`${name(ev.seat)} keeps ${ev.from === 'discard' ? label(ev.draw) : 'the card'} and throws ${label(ev.discard)}.`);
      }
      renderAll();
      await sleep(320);
    } else if (step.type === 'show') {
      state.shown[ev.seat] = ev.show;
      const dub = ev.show.kind === 'pairs';
      state.status[ev.seat] = dub ? 'dublee' : 'seen';
      const firstSeen = !state.tipluUp;
      state.tipluUp = true;
      const groups = ev.show.groups.map(gr => gr.map(label).join(' ')).join(' · ');
      moment(ev.seat, dub ? `Round ${state.round}: showed seven dublees (${groups}). Seen on dublee.` : `Round ${state.round}: showed three sets (${groups}). Seen, and can look at the joker.`, true);
      state.last[ev.seat] = dub ? 'Showed 7 dublees' : 'Showed 3 sets';
      narrate(dub
        ? `${name(ev.seat)} lays down seven dublees: seen on dublee!${firstSeen ? ` The joker is ${label(g.tiplu)}.` : ''}`
        : `${name(ev.seat)} lays down three sets and is seen!${firstSeen ? ` The joker is ${label(g.tiplu)}.` : ''}`);
      renderAll();
      await sleep(2000);
    } else if (step.type === 'win') {
      state.status[ev.seat] = 'won';
      state.shown[ev.seat] = { kind: 'sets', groups: ev.win.groups };
      state.last[ev.seat] = 'Declared!';
      moment(ev.seat, `Round ${state.round}: every card in sets. Declared and won the hand.`, true);
      narrate(`${name(ev.seat)} declares! All 21 cards are in sets.`);
      renderAll();
      await sleep(2000);
    } else if (step.type === 'end') {
      state.over = true;
      state.turn = -1;
      state.tipluUp = true;
      g.players.forEach((p, s) => {
        if (p.status === 'unseen') {
          state.status[s] = 'unseen';
          moment(s, 'Never showed three sets, so stayed unseen. Their maal doesn\'t count.', true);
        }
        const counted = p.status === 'unseen' ? 'not counted (unseen)' : `${p.maal} maal`;
        state.last[s] = `${p.points > 0 ? '+' : ''}${p.points} points · ${counted}`;
      });
      narrate(`Hand over. ${name(g.winnerSeat)} won in round ${state.round}. The scores are below.`);
      renderAll();
      renderFinal();
    }
  }

  /* ---------- Flying cards ---------- */
  function seatEl(s) { return document.querySelector(`.seat[data-seat="${s}"]`); }
  function fly(fromEl, toEl, cardKey, ms) {
    if (skipping || reduceMotion || document.hidden) return Promise.resolve();
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    const box = el('div', 'flying');
    const card = cardKey ? Cards.fromKey(cardKey) : Cards.make('A', '♠', { faceDown: true });
    box.append(card);
    document.body.append(box);
    const w = 40, h = 57;
    const x0 = a.left + a.width / 2 - w / 2, y0 = a.top + a.height / 2 - h / 2;
    const x1 = b.left + b.width / 2 - w / 2, y1 = b.top + Math.min(b.height / 2, 50) - h / 2;
    box.style.left = '0px'; box.style.top = '0px';
    const anim = box.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(-8deg)` },
      { transform: `translate(${x1}px, ${y1}px) rotate(4deg)` },
    ], { duration: ms / speed, easing: 'cubic-bezier(.3,.7,.2,1)' });
    return anim.finished.catch(() => {}).then(() => box.remove());
  }

  /* ---------- Rendering ---------- */
  const badge = (status, extra = '') => el('span', `badge badge-${status} ${extra}`, STATUS_TEXT[status]);

  function cardsRow(keys, cls, opts = {}) {
    const row = el('div', 'hand' + (cls ? ' ' + cls : ''));
    for (const k of keys) {
      const c = Cards.fromKey(k);
      if (opts.maal && Sim.maalRole(k, g.tiplu)) c.classList.add('maal');
      row.append(c);
    }
    return row;
  }

  /** A player's hand: shown groups in boxes first, then the rest sorted. */
  function handView(s, small) {
    const hand = [...state.hands[s]];
    const row = el('div', 'hand' + (small ? ' small' : ''));
    const showMaal = state.tipluUp && state.status[s] !== 'playing' && state.status[s] !== 'unseen' || state.over;
    const sh = state.shown[s];
    if (sh) {
      for (const grp of sh.groups) {
        const box = el('div', 'grp' + (sh.kind === 'pairs' ? ' grp-pairs' : ''));
        for (const k of grp) {
          hand.splice(hand.indexOf(k), 1);
          const c = Cards.fromKey(k);
          if (showMaal && Sim.maalRole(k, g.tiplu)) c.classList.add('maal');
          box.append(c);
        }
        row.append(box);
      }
    }
    let freshMarked = false;
    for (const k of Sim.sortCards(hand)) {
      const c = Cards.fromKey(k);
      if (showMaal && Sim.maalRole(k, g.tiplu)) c.classList.add('maal');
      if (!freshMarked && k === state.fresh[s]) { c.classList.add('new'); freshMarked = true; }
      row.append(c);
    }
    return row;
  }

  function renderSeats() {
    for (let s = 0; s < 4; s++) {
      const seat = seatEl(s);
      seat.className = 'seat' + (state.turn === s ? ' turn' : '') + (focus === s ? ' focused' : '');
      seat.setAttribute('role', 'button');
      seat.setAttribute('tabindex', '0');
      seat.setAttribute('aria-label', `Follow ${name(s)}`);
      const top = el('div', 'seat-top');
      top.append(el('span', 'seat-name', name(s)), badge(state.status[s]), el('span', 'seat-count', `${state.hands[s].length} cards`));
      const fan = el('div', 'seat-fan');
      const n = Math.min(8, Math.ceil(state.hands[s].length / 3));
      for (let i = 0; i < n; i++) fan.append(Cards.make('A', '♠', { faceDown: true }));
      const shown = el('div', 'seat-shown');
      if (state.shown[s]) {
        for (const grp of state.shown[s].groups) {
          const b = el('div', 'grp');
          for (const k of grp) b.append(Cards.fromKey(k));
          shown.append(b);
        }
      }
      seat.replaceChildren(top, state.shown[s] ? shown : fan, el('div', 'seat-last', state.last[s]));
    }
  }

  function renderCenter() {
    const pile = $('#pile');
    pile.replaceChildren(...(state.pile > 0 ? [Cards.make('A', '♠', { faceDown: true })] : []));
    $('#pile-count').textContent = `Pile · ${state.pile}`;
    $('#discard').replaceChildren(...(state.discard ? [Cards.fromKey(state.discard)] : []));
    const tiplu = $('#tiplu');
    const c = Cards.fromKey(g.tiplu, { faceDown: !state.tipluUp });
    tiplu.replaceChildren(c);
    $('#tiplu-label').textContent = state.tipluUp ? `Tiplu ${label(g.tiplu)}` : 'Joker';
  }

  function renderTabs() {
    const tabs = $('#tabs');
    const opts = [['all', 'Everyone'], ...g.players.map((p, s) => [s, p.name])];
    tabs.replaceChildren(...opts.map(([v, text]) => {
      const b = el('button', '', text);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(focus === v));
      b.addEventListener('click', () => setFocus(v));
      return b;
    }));
  }

  function panel(s, full) {
    const p = g.players[s];
    const box = el('article', 'panel');
    const head = el('div', 'panel-head');
    head.append(el('h3', '', p.name), badge(state.status[s]));
    if (state.over) head.append(el('strong', p.points > 0 ? 'pos' : 'neg', `${p.points > 0 ? '+' : ''}${p.points} points`));
    box.append(head);
    if (state.over) box.append(el('p', 'panel-story', story(s)));
    if (full) {
      box.append(el('p', 'hand-label', 'Dealt'));
      box.append(cardsRow(p.start, 'small'));
    }
    box.append(el('p', 'hand-label', state.over ? 'Finished with' : 'Hand now'));
    box.append(handView(s, !full));
    if (state.over && p.status !== 'unseen' && p.maalItems.length) {
      const ul = el('ul', 'maal-list');
      for (const m of p.maalItems) ul.append(el('li', '', `${m.what === 'Marriage' ? 'Marriage ' + m.cards.map(label).join(' ') : m.cards[0] === 'SUP' || m.cards[0] === 'PUT' ? m.what : m.what + ' ' + label(m.cards[0])}: ${m.value}`));
      box.append(ul);
    }
    const moms = full ? state.moments[s] : state.moments[s].slice(-2);
    if (moms.length) {
      const ol = el('ol', 'moments');
      for (const m of moms) ol.append(el('li', m.key ? 'key' : '', m.text));
      box.append(ol);
      if (full) requestAnimationFrame(() => { ol.scrollTop = ol.scrollHeight; });
    }
    return box;
  }

  function story(s) {
    const p = g.players[s];
    const shows = p.shown ? state.moments[s].find(m => m.key && /showed/.test(m.text)) : null;
    const kept = g.events.filter(e => e.seat === s && e.discard !== e.draw).length;
    if (p.status === 'won') return `Kept ${kept} useful cards over ${state.round} rounds. ${shows ? `Showed three sets in round ${shows.round}, then` : 'Then'} declared in round ${state.round}${p.maal ? ` with ${p.maal} maal` : ''}.${p.points < 0 ? ' Won the hand but still lost points: the others held more maal.' : ''}`;
    if (p.status === 'dublee') return `Went for pairs instead of sequences and showed seven dublees in round ${shows ? shows.round : '?'}. Pays no game points, and counts ${p.maal} maal.`;
    if (p.status === 'seen') return `Showed three sets in round ${shows ? shows.round : '?'}. Counts ${p.maal} maal and pays the winner 3.`;
    const had = p.maalItems.reduce((a, m) => a + m.value, 0);
    return `Never got three sets down, so stayed unseen and pays the winner 10.${had ? ` Was holding ${had} maal that didn't count.` : ''}`;
  }

  function renderPanels() {
    const box = $('#panels');
    if (focus === 'all') box.replaceChildren(...g.players.map((_, s) => panel(s, false)));
    else box.replaceChildren(panel(focus, true));
  }

  function renderFinal() {
    const rows = g.players.map((p, s) => {
      const tr = el('tr');
      tr.append(el('td', '', p.name), el('td', '', STATUS_TEXT[p.status]),
        el('td', '', p.status === 'unseen' ? (p.maalItems.length ? `0 (had ${p.maalItems.reduce((a, m) => a + m.value, 0)})` : '0') : String(p.maal)),
        el('td', p.points > 0 ? 'pos' : p.points < 0 ? 'neg' : '', `${p.points > 0 ? '+' : ''}${p.points}`),
        el('td', p.points > 0 ? 'pos' : p.points < 0 ? 'neg' : '', `${p.points < 0 ? '−' : ''}Rs. ${Math.abs(p.points * 10).toLocaleString('en-IN')}`));
      tr.addEventListener('click', () => setFocus(s));
      return tr;
    });
    $('#score-rows').replaceChildren(...rows);
    $('#final-note').textContent = `${name(g.winnerSeat)} declared in round ${state.round}. The tiplu was ${label(g.tiplu)}.${g.pickup ? ` ${name(g.pickup.seat)} grabbed ${label(g.pickup.card)} straight off the discards in round ${g.pickup.turn + 1}.` : ''}`;
    $('#final').hidden = false;
  }

  function renderAll() { renderSeats(); renderCenter(); renderTabs(); renderPanels(); }

  function setFocus(v) {
    focus = v;
    renderSeats(); renderTabs(); renderPanels();
    if (v !== 'all') $('#follow-title').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- Controls ---------- */
  function setControls() {
    const done = pos >= steps.length;
    $('#play').textContent = done ? 'Watch again' : paused ? 'Play' : 'Pause';
    $('#step').disabled = !paused || done;
    $('#skip').disabled = done;
  }

  $('#play').addEventListener('click', () => {
    if (pos >= steps.length) { paused = false; newGame(); return; }
    paused = !paused;
    if (!paused && gateOpen) { const r = gateOpen; gateOpen = null; r(); }
    setControls();
  });
  $('#step').addEventListener('click', () => {
    if (gateOpen) { const r = gateOpen; gateOpen = null; r(); }
    // Pause again before the next step.
  });
  $('#skip').addEventListener('click', () => {
    skipping = true;
    if (gateOpen) { const r = gateOpen; gateOpen = null; r(); }
    setControls();
  });
  $('#new').addEventListener('click', () => { if (gateOpen) { gateOpen = null; } newGame(); });
  $('#speed').addEventListener('change', e => { speed = Number(e.target.value) || 1; });
  for (let s = 0; s < 4; s++) {
    const seat = seatEl(s);
    seat.addEventListener('click', () => setFocus(focus === s ? 'all' : s));
    seat.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFocus(focus === s ? 'all' : s); } });
  }

  newGame();
})();
