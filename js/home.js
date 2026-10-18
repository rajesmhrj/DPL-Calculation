/* Home page: the dealing animation and the live tally from the ledger. */
(function () {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- The deal ----------
   * A fresh random hand every time (js/sim.js): 21 cards fly from the deck
   * into a fanned hand, the sets (or seven dublees) lift as the player shows,
   * the joker turns over and whatever maal is in this hand lights up. */
  const stage = document.getElementById('deal');
  const caption = document.getElementById('deal-caption');
  const replay = document.getElementById('replay');
  let timers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, reduceMotion ? 0 : ms));
  const list = items => items.length <= 1 ? items.join('') : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];

  function layout(n) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const w = Math.max(40, Math.min(66, W / 8.2));
    const margin = 30;
    const step = Math.min(w * 0.62, (W - 2 * margin - w) / (n - 1));
    const left = (W - (step * (n - 1) + w)) / 2;
    const slots = [...Array(n)].map((_, i) => {
      const t = i / (n - 1) - 0.5;
      return { x: left + i * step, y: H - w * 1.42 - 34 + t * t * 56, rot: t * 26 };
    });
    return { w, slots, deck: { x: W / 2 - w - 8, y: 30 }, joker: { x: W / 2 + 8, y: 30 } };
  }

  const place = (card, x, y, rot = 0, lift = 0) => {
    card.style.transform = `translate(${x}px, ${y - lift}px) rotate(${rot}deg)`;
  };

  function addLabel(text, x, y) {
    const label = document.createElement('span');
    label.className = 'set-label';
    label.textContent = text;
    label.style.left = x + 'px';
    label.style.top = Math.max(4, y) + 'px';
    stage.append(label);
    requestAnimationFrame(() => label.classList.add('show'));
  }

  function deal() {
    timers.forEach(clearTimeout);
    timers = [];
    stage.replaceChildren();
    replay.hidden = true;
    const h = Sim.heroHand(Math.floor(Math.random() * 2 ** 31));
    const order = [...h.groups.flat(), ...h.rest];
    const L = layout(order.length);
    const size = L.w + 'px';

    // Deck: a few stacked backs for depth.
    for (let i = 0; i < 4; i++) {
      const d = Cards.make('A', '♠', { faceDown: true, size });
      d.style.transition = 'none';
      place(d, L.deck.x - i * 1.5, L.deck.y - i * 1.5);
      stage.append(d);
    }
    const joker = Cards.fromKey(h.tiplu, { faceDown: true, size });
    joker.style.transition = 'none';
    place(joker, L.joker.x, L.joker.y, 6);
    stage.append(joker);

    const cards = order.map((k, i) => {
      const c = Cards.fromKey(k, { faceDown: true, size });
      c.style.transition = 'none';
      place(c, L.deck.x - 6, L.deck.y - 6);
      c.style.zIndex = 10 + i;
      stage.append(c);
      return c;
    });
    caption.textContent = 'Dealing 21 cards…';
    stage.getBoundingClientRect(); // commit the start positions

    // Deal in a shuffled order so the hand fills in like real cards arriving.
    const dealOrder = [...order.keys()].sort(() => Math.random() - 0.5);
    dealOrder.forEach((i, n) => later(120 + n * 70, () => {
      cards[i].style.transition = '';
      const s = L.slots[i];
      place(cards[i], s.x, s.y, s.rot);
      later(260, () => Cards.flip(cards[i], true));
    }));

    const dealt = 120 + order.length * 70 + 600;
    let showDone;
    if (h.mode === 'sets') {
      let from = 0;
      h.groups.forEach((g, k) => {
        const at = from;
        from += g.length;
        later(dealt + k * 650, () => {
          for (let i = at; i < at + g.length; i++) { const s = L.slots[i]; cards[i].classList.add('lift'); place(cards[i], s.x, s.y, s.rot, 30); }
          const center = (L.slots[at].x + L.slots[at + g.length - 1].x + L.w) / 2;
          addLabel(Sim.isTunnela(g) ? 'Tunnela' : 'Sequence', center, L.slots[at + 1].y - 56 - (k % 2) * 26);
          if (k === h.groups.length - 1) caption.textContent = 'Three sets shown: this player is seen and gets to look at the joker.';
        });
      });
      showDone = dealt + h.groups.length * 650;
    } else {
      const pairCards = h.groups.length * 2;
      [...Array(h.groups.length).keys()].forEach(k => later(dealt + k * 260, () => {
        for (const i of [k * 2, k * 2 + 1]) { const s = L.slots[i]; cards[i].classList.add('lift'); place(cards[i], s.x, s.y, s.rot, 30); }
        if (k === h.groups.length - 1) {
          addLabel('7 dublees', (L.slots[0].x + L.slots[pairCards - 1].x + L.w) / 2, L.slots[6].y - 56);
          caption.textContent = 'Seven pairs of identical cards shown: this player is seen on dublee.';
        }
      }));
      showDone = dealt + h.groups.length * 260;
    }

    const reveal = showDone + 700;
    later(reveal, () => {
      joker.style.transition = '';
      Cards.flip(joker, true);
      const tag = document.createElement('span');
      tag.className = 'joker-tag';
      tag.textContent = 'Tiplu';
      tag.style.left = L.joker.x + L.w / 2 + 'px';
      tag.style.top = L.joker.y + L.w * 1.42 + 8 + 'px';
      stage.append(tag);
      requestAnimationFrame(() => tag.classList.add('show'));
    });
    later(reveal + 900, () => {
      order.forEach((k, i) => {
        if (Sim.maalRole(k, h.tiplu)) { cards[i].classList.add('maal'); const s = L.slots[i]; place(cards[i], s.x, s.y, s.rot, cards[i].classList.contains('lift') ? 40 : 16); }
      });
      const tip = Cards.label(h.tiplu);
      if (!h.maal.items.length) caption.textContent = `The tiplu is ${tip}. No maal in this hand. Deal again for another.`;
      else {
        const part = m => m.what === 'Marriage' ? `a marriage (${m.cards.map(Cards.label).join(' ')}) worth 10`
          : m.cards[0] === 'SUP' ? 'Superman 10'
          : m.cards[0] === 'PUT' ? (m.cards.length > 1 ? 'two Putalis 15' : 'a Putali 5')
          : `${Cards.label(m.cards[0])} as ${m.what.toLowerCase()} ${m.value}`;
        const parts = h.maal.items.map(part);
        caption.textContent = `The tiplu is ${tip}. Maal in this hand: ${list(parts)}. ${h.maal.total} in all.`;
      }
      replay.hidden = false;
    });
  }

  replay.addEventListener('click', deal);
  let resizeT;
  // Re-deal only when the width changes (phones change height as the address bar hides).
  let lastWidth = stage.clientWidth;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (stage.clientWidth !== lastWidth) { lastWidth = stage.clientWidth; deal(); } }, 250);
  });
  deal();

  /* ---------- Marriage in a minute: the tiplu and its maal ---------- */
  const minute = document.getElementById('minute-cards');
  [['6', '♠', 'Jhiplu'], ['7', '♠', 'Tiplu'], ['8', '♠', 'Poplu'], ['7', '♣', 'Alter']].forEach(([r, s, tag]) => {
    minute.append(Cards.make(r, s, { tag, maal: tag === 'Tiplu' }));
  });

  /* ---------- Live tally from the ledger ---------- */
  const XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.mini.min.js';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const money = n => 'Rs. ' + Math.abs(n).toLocaleString('en-IN');

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.append(s);
    });
  }

  function parse(wb) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Games, { header: 1, raw: false, defval: '' });
    const header = rows[0].map(String);
    const cols = header.map((h, i) => [h.trim(), i]).filter(([h]) => h && !['Game', 'Date', 'ID', 'Rate'].includes(h));
    const rateCol = header.indexOf('Rate');
    const games = rows.slice(1).map(r => {
      const scores = {};
      for (const [p, i] of cols) if (String(r[i]).trim() !== '') scores[p] = parseInt(r[i], 10);
      const rate = rateCol >= 0 ? parseFloat(r[rateCol]) : NaN;
      return { date: String(r[header.indexOf('Date')]), scores, ...(rate > 0 ? { rate } : {}) };
    }).filter(g => Object.keys(g.scores).length);
    const rate = wb.Sheets.Settings && Number(wb.Sheets.Settings.B1 && wb.Sheets.Settings.B1.v) > 0 ? Number(wb.Sheets.Settings.B1.v) : 10;
    return { games, names: cols.map(c => c[0]), rate };
  }

  async function tally() {
    try {
      const res = await fetch('/api/ledger', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (!j.content) return;
      await loadScript(XLSX_SRC);
      const { games, names, rate } = parse(XLSX.read(j.content, { type: 'base64' }));
      const g = Analytics.group(games, names, rate);
      if (!g.games) return;
      const ranked = [...g.players].sort((a, b) => b.net - a.net);
      const top = ranked[0], bottom = ranked[ranked.length - 1];
      const set = (id, main, sub, cls) => {
        const dd = document.getElementById(id);
        dd.textContent = main;
        if (cls) dd.className = cls;
        if (sub) { const s = document.createElement('small'); s.textContent = sub; dd.append(s); }
      };
      set('t-games', String(g.games), `${money(g.moneyMoved)} has changed hands`);
      set('t-leader', top.name, `up ${money(top.net)}`, 'up');
      set('t-trailer', bottom.name, `down ${money(bottom.net)}`, 'down');
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(g.lastDate);
      const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
      set('t-last', d ? `${DAYS[d.getUTCDay()]}` : g.lastDate, d ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : '');
      document.getElementById('tally').hidden = false;
    } catch (e) {
      // The tally is a bonus; the page works without it.
    }
  }
  tally();
})();
