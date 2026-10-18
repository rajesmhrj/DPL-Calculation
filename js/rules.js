/* Rules page: card strips, the joker flip, the maal explorer, the scoring
 * calculator and the "on this page" highlight. */
(function () {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Card strips: data-cards="4♥ 5♥ 6♥ · K♦ K♦ K♦" ("?" = face down) ---------- */
  for (const row of document.querySelectorAll('[data-cards]')) {
    for (const token of row.dataset.cards.split(/\s+/)) {
      if (token === '·') { const g = document.createElement('span'); g.className = 'gap'; row.append(g); continue; }
      if (token === '?') { row.append(Cards.make('A', '♠', { faceDown: true })); continue; }
      row.append(Cards.fromKey(token));
    }
  }

  /* ---------- Getting seen: look at the joker ---------- */
  const seenBox = document.getElementById('seen-joker');
  const seenJoker = Cards.make('7', '♠', { faceDown: true, tag: 'Tiplu' });
  seenJoker.querySelector('.pc-tag').hidden = true;
  seenBox.append(seenJoker);
  const seenBtn = document.getElementById('seen-flip');
  seenBtn.addEventListener('click', () => {
    const up = seenJoker.classList.contains('face-down');
    Cards.flip(seenJoker, up);
    seenJoker.querySelector('.pc-tag').hidden = !up;
    seenBtn.textContent = up ? 'Put it back' : 'Look at the joker';
  });

  /* ---------- Maal explorer ---------- */
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];
  const SUIT_NAME = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
  const ALTER = { '♠': '♣', '♣': '♠', '♥': '♦', '♦': '♥' };
  let tiplu = { rank: '7', suit: '♠' };

  function radios(box, values, current, label, onPick) {
    box.replaceChildren(...values.map(v => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(v === current));
      b.setAttribute('aria-label', label(v));
      b.tabIndex = v === current ? 0 : -1;
      b.textContent = v;
      if (Cards.RED.has(v)) b.className = 'red-suit';
      b.addEventListener('click', () => onPick(v));
      b.addEventListener('keydown', e => {
        const i = values.indexOf(v);
        const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? values[(i + 1) % values.length]
          : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? values[(i - 1 + values.length) % values.length] : null;
        if (next) { e.preventDefault(); onPick(next); box.querySelector('[aria-checked="true"]').focus(); }
      });
      return b;
    }));
  }

  function renderMaal() {
    radios(document.getElementById('pick-rank'), RANKS, tiplu.rank, r => `Tiplu rank ${r}`, r => { tiplu.rank = r; renderMaal(); });
    radios(document.getElementById('pick-suit'), SUITS, tiplu.suit, s => `Tiplu suit ${SUIT_NAME[s]}`, s => { tiplu.suit = s; renderMaal(); });
    const i = RANKS.indexOf(tiplu.rank);
    const below = RANKS[(i + 12) % 13], above = RANKS[(i + 1) % 13];
    const cards = [
      [below, tiplu.suit, 'Jhiplu', 2],
      [tiplu.rank, tiplu.suit, 'Tiplu', 3],
      [above, tiplu.suit, 'Poplu', 2],
      [tiplu.rank, ALTER[tiplu.suit], 'Alter', 5],
    ];
    const box = document.getElementById('maal-cards');
    box.replaceChildren(...cards.map(([r, s, name, pts], k) => {
      const c = Cards.make(r, s, { faceDown: !reduceMotion, maal: name === 'Tiplu', tag: `${name}\n${pts} maal` });
      if (!reduceMotion) setTimeout(() => Cards.flip(c, true), 40 + k * 90);
      return c;
    }));
  }
  renderMaal();

  /* ---------- Scoring calculator ----------
   * Same formula the ledger uses: n × own maal − total maal − game points. */
  const RULES = { seen: 3, unseen: 10, dublee: 0, foul: 15, dubleeWinBonus: 5 };
  const STATUS = [['seen', 'Seen'], ['unseen', 'Unseen'], ['dublee', 'Dublee'], ['foul', 'Foul'], ['hold', 'Hold']];
  // A real hand from our table: Abhishek finished, Suyog was on dublee.
  const players = [
    { name: 'Harsh', status: 'seen', maal: 3 },
    { name: 'Sanil', status: 'seen', maal: 0 },
    { name: 'Suyog', status: 'dublee', maal: 7 },
    { name: 'Subash', status: 'seen', maal: 2 },
    { name: 'Abhishek', status: 'seen', maal: 5 },
  ];
  let winner = 'Abhishek';

  function score(mode) {
    const active = players.filter(p => p.status !== 'hold');
    const w = players.find(p => p.name === winner);
    if (active.length < 2) return { error: 'At least two people need to play the hand.' };
    if (!w || w.status === 'hold') return { error: 'Pick a winner who played the hand.' };
    if (w.status === 'unseen' || w.status === 'foul') return { error: 'The winner has to be seen.' };
    const n = active.length;
    const work = [];
    let kidnapped = 0;
    const maal = new Map();
    for (const p of active) {
      let m = p.maal;
      if (p.status === 'foul') m = 0;
      if (p.status === 'unseen' && p !== w) {
        if (mode === 'murder') m = 0;
        else { kidnapped += m; m = 0; }
      }
      maal.set(p.name, m);
    }
    maal.set(w.name, maal.get(w.name) + kidnapped);
    const total = [...maal.values()].reduce((a, b) => a + b, 0);
    work.push(`${n} people played. Counted maal adds up to ${total}${kidnapped ? ` (including ${kidnapped} kidnapped by ${w.name})` : ''}.`);
    const pts = {};
    let collected = 0;
    for (const p of players) {
      if (p.status === 'hold') { pts[p.name] = 0; continue; }
      if (p === w) continue;
      const pay = RULES[p.status] + (w.status === 'dublee' ? RULES.dubleeWinBonus : 0);
      const m = maal.get(p.name);
      pts[p.name] = n * m - total - pay;
      collected -= pts[p.name];
      const why = p.status === 'unseen' && mode === 'murder' && p.maal ? ' (unseen, so their maal is murdered)' : p.status === 'foul' ? ' (foul, so no maal)' : '';
      work.push(`${p.name}: ${n} × ${m} − ${total} − ${pay} game points = ${fmt(pts[p.name])}${why}`);
    }
    pts[w.name] = collected;
    work.push(`${w.name} won, so takes whatever the others pay: ${fmt(collected)}.`);
    return { pts, work };
  }

  const fmt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  const mode = () => document.querySelector('input[name="mode"]:checked').value;

  function renderCalc() {
    const tbody = document.getElementById('calc-rows');
    const res = score(mode());
    if (!tbody.children.length) {
      tbody.append(...players.map(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<th scope="row"></th><td><input type="radio" name="winner"></td><td><select></select></td><td><input type="number" min="0" max="99" inputmode="numeric"></td><td class="pts"></td>`;
        tr.querySelector('th').textContent = p.name;
        const radio = tr.querySelector('input[type="radio"]');
        radio.setAttribute('aria-label', `${p.name} won`);
        radio.addEventListener('change', () => {
          winner = p.name;
          if (p.status === 'unseen' || p.status === 'foul' || p.status === 'hold') { p.status = 'seen'; tr.querySelector('select').value = 'seen'; }
          renderCalc();
        });
        const sel = tr.querySelector('select');
        sel.setAttribute('aria-label', `${p.name}'s status`);
        for (const [v, l] of STATUS) sel.append(new Option(l, v));
        sel.addEventListener('change', () => { p.status = sel.value; renderCalc(); });
        const num = tr.querySelector('input[type="number"]');
        num.setAttribute('aria-label', `${p.name}'s maal`);
        num.addEventListener('input', () => { p.maal = Math.max(0, parseInt(num.value, 10) || 0); renderCalc(); });
        return tr;
      }));
    }
    players.forEach((p, i) => {
      const tr = tbody.children[i];
      tr.querySelector('input[type="radio"]').checked = p.name === winner;
      tr.querySelector('select').value = p.status;
      const num = tr.querySelector('input[type="number"]');
      if (document.activeElement !== num) num.value = p.maal;
      num.disabled = p.status === 'hold';
      const cell = tr.querySelector('.pts');
      const v = res.pts ? res.pts[p.name] : null;
      cell.textContent = v === null ? '' : fmt(v);
      cell.className = 'pts' + (v > 0 ? ' pos' : v < 0 ? ' neg' : '');
    });
    document.getElementById('calc-sum').textContent = res.error
      ? res.error
      : `Adds up to ${Object.values(res.pts).reduce((a, b) => a + b, 0)}. At Rs. 10 a point, ${winner} takes Rs. ${(res.pts[winner] * 10).toLocaleString('en-IN')} this hand.`;
    document.getElementById('calc-work').replaceChildren(...(res.work || []).map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
  }
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', renderCalc));
  renderCalc();

  /* ---------- "On this page": highlight the section being read ---------- */
  const links = new Map([...document.querySelectorAll('.toc a')].map(a => [a.getAttribute('href').slice(1), a]));
  const seen = new Set();
  const io = new IntersectionObserver(entries => {
    for (const e of entries) { if (e.isIntersecting) seen.add(e.target.id); else seen.delete(e.target.id); }
    const first = [...links.keys()].find(id => seen.has(id));
    if (!first) return;
    links.forEach((a, id) => {
      a.classList.toggle('active', id === first);
      if (id === first) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-20% 0px -60% 0px' });
  links.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
})();
