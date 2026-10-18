/* Live scorer: score a Marriage game round by round, then save the totals
 * to the shared ledger as one game. The game in progress is kept on this
 * phone (localStorage) so a refresh or closed tab doesn't lose it. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const KEY = 'marriage-live-game-v1';
  const STATUS_LABEL = { seen: 'Seen', unseen: 'Unseen', dublee: 'Dublee', foul: 'Foul', hold: 'Hold' };

  let game = null;     // { startedAt, players, mode, rounds: [{ winner, entries }] }
  let draft = null;    // round being edited: { index | null, winner, entries }
  let picked = [];     // setup: chosen players, in seat order
  let mode = 'murder';
  let rateText = '';
  let done = null;     // message after saving
  let busy = false;

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  };
  const fmt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
  const sign = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');

  function load() { try { game = JSON.parse(localStorage.getItem(KEY)) || null; } catch { game = null; } }
  function save() { try { if (game) localStorage.setItem(KEY, JSON.stringify(game)); else localStorage.removeItem(KEY); } catch { /* private mode */ } }
  const rules = () => ({ ...Scoring.DEFAULT_RULES, mode: game ? game.mode : mode });
  const totals = () => Scoring.totals(game.rounds, game.players, rules());
  const gameRate = () => (game && game.rate > 0 ? game.rate : Ledger.rate());
  const rs = v => `${v < 0 ? '−' : ''}Rs. ${Math.abs(Math.round(v * 100) / 100).toLocaleString('en-IN')}`;

  /* ---------- Open / close ---------- */
  function open() {
    load();
    done = null;
    $('#live').hidden = false;
    document.body.classList.add('detail-open');
    render();
    $('#live-close').focus();
  }
  function close() {
    $('#live').hidden = true;
    document.body.classList.remove('detail-open');
    updateOpenButton();
  }
  function updateOpenButton() {
    load();
    const b = $('#live-open');
    b.textContent = game ? `Continue the game in progress (${game.rounds.length} round${game.rounds.length === 1 ? '' : 's'})` : 'Score a game live';
  }

  /* ---------- Views ---------- */
  function render() {
    const body = $('#live-body');
    $('#live-title').textContent = game ? `Game started ${game.startedAt.slice(11)} · Rs. ${gameRate()}/pt` : 'Score a game';
    body.replaceChildren(done ? doneView() : game ? playView() : setupView());
  }

  function setupView() {
    const all = Ledger.players();
    const chips = el('div', { class: 'live-chips' }, all.map(p => {
      const i = picked.indexOf(p);
      return el('button', {
        type: 'button', class: 'live-chip' + (i >= 0 ? ' on' : ''), 'aria-pressed': String(i >= 0),
        onclick: () => { picked = i >= 0 ? picked.filter(x => x !== p) : [...picked, p]; render(); },
      }, i >= 0 ? el('span', { class: 'seat-no' }, String(i + 1)) : null, p);
    }));
    const newName = el('input', { type: 'text', placeholder: 'New player name', maxlength: '30', autocomplete: 'off' });
    return el('div', { class: 'live-setup' },
      el('h3', {}, "Who's playing?"),
      el('p', { class: 'hint' }, 'Tap players in the order they sit. Their totals go into the ledger when you end the game.'),
      chips,
      el('form', { class: 'add-player', onsubmit: async e => {
        e.preventDefault();
        const name = await Ledger.addPlayer(newName.value);
        if (name) { if (!picked.includes(name)) picked.push(name); newName.value = ''; render(); }
      } }, newName, el('button', { class: 'btn', type: 'submit' }, 'Add player')),
      el('h3', {}, 'Rupees per point'),
      el('div', { class: 'live-rate' },
        el('span', {}, 'Rs.'),
        el('input', { type: 'number', min: '0.01', step: 'any', inputmode: 'decimal', class: 'maal-in', 'aria-label': 'Rupees per point for this game',
          value: rateText || String(Ledger.rate()), oninput: e => { rateText = e.target.value; } }),
        el('span', {}, 'per point'),
        el('div', { class: 'live-chips' }, [5, 10, 20, 50, 100].map(v => el('button', {
          type: 'button', class: 'live-chip' + (Number(rateText || Ledger.rate()) === v ? ' on' : ''), onclick: () => { rateText = String(v); render(); },
        }, `Rs. ${v}`)))),
      el('h3', {}, 'Unseen maal'),
      el('div', { class: 'live-chips', role: 'radiogroup', 'aria-label': 'Unseen maal rule' },
        [['murder', 'Murder: doesn\'t count'], ['kidnap', 'Kidnap: goes to the winner']].map(([v, t]) =>
          el('button', { type: 'button', role: 'radio', 'aria-checked': String(mode === v), class: 'live-chip' + (mode === v ? ' on' : ''), onclick: () => { mode = v; render(); } }, t))),
      el('div', { class: 'live-actions' },
        el('button', {
          class: 'btn primary', type: 'button', disabled: picked.length < 2,
          onclick: () => {
            const rate = parseFloat(rateText || Ledger.rate());
            if (!(rate > 0)) { alert('Enter how many rupees a point is worth.'); return; }
            game = { startedAt: Ledger.now(), players: [...picked], mode, rate, rounds: [] };
            save(); draft = newDraft(); render();
          },
        }, picked.length < 2 ? 'Pick at least 2 players' : `Start game with ${picked.length}`)),
    );
  }

  function newDraft(index = null) {
    if (index !== null) {
      const r = game.rounds[index];
      return { index, winner: r.winner, entries: r.entries.map(e => ({ ...e })), maalText: Object.fromEntries(r.entries.map(e => [e.player, e.maal ? String(e.maal) : ''])) };
    }
    const last = game.rounds[game.rounds.length - 1];
    return {
      index: null, winner: '',
      entries: game.players.map(p => ({ player: p, status: last && last.entries.find(e => e.player === p && e.status === 'hold') ? 'hold' : 'seen', maal: 0 })),
      maalText: {},
    };
  }

  function playView() {
    const t = totals();
    const wrap = el('div', { class: 'live-play' });

    // Running totals
    wrap.append(el('div', { class: 'live-totals' }, game.players.map(p =>
      el('div', { class: 'live-total' }, el('span', { class: 'lt-name' }, p), el('span', { class: 'lt-val ' + sign(t[p]) }, fmt(t[p])),
        el('span', { class: 'lt-rs ' + sign(t[p]) }, rs(t[p] * gameRate()))))));

    // Rounds so far
    if (game.rounds.length) {
      const head = el('tr', {}, el('th', { scope: 'col' }, 'Round'), game.players.map(p => el('th', { scope: 'col' }, p)));
      const rows = game.rounds.map((r, i) => {
        const pts = Scoring.scoreRound(r, rules());
        return el('tr', { class: 'clickable' + (draft && draft.index === i ? ' editing' : ''), tabindex: '0', title: 'Edit this round',
          onclick: () => { draft = newDraft(i); render(); }, onkeydown: e => { if (e.key === 'Enter') { draft = newDraft(i); render(); } } },
        el('th', { scope: 'row' }, String(i + 1)),
        game.players.map(p => {
          const st = r.entries.find(e => e.player === p).status;
          return el('td', { class: sign(pts[p]) }, r.winner === p ? '👑 ' : '', st === 'hold' ? '—' : fmt(pts[p]),
            st !== 'seen' && st !== 'hold' && r.winner !== p ? el('small', { class: 'st' }, ' ' + STATUS_LABEL[st].toLowerCase()) : null);
        }));
      });
      const foot = el('tr', { class: 'total-row' }, el('th', { scope: 'row' }, 'Total'), game.players.map(p => el('td', { class: sign(t[p]) }, fmt(t[p]))));
      const footRs = el('tr', { class: 'total-row rs-row' }, el('th', { scope: 'row' }, `Rs. ${gameRate()}/pt`), game.players.map(p => el('td', { class: sign(t[p]) }, rs(t[p] * gameRate()))));
      wrap.append(el('div', { class: 'table-wrap' }, el('table', { class: 'live-table' }, el('thead', {}, head), el('tbody', {}, rows, foot, footRs))));
      wrap.append(el('p', { class: 'hint' }, 'Tap a round to change it.'));
    } else if (!draft) {
      wrap.append(el('p', { class: 'hint' }, 'No rounds yet.'));
    }

    if (draft) wrap.append(roundEditor());
    else {
      wrap.append(el('div', { class: 'live-actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: () => { draft = newDraft(); render(); } }, `+ Round ${game.rounds.length + 1}`),
        el('button', { class: 'btn', type: 'button', disabled: !game.rounds.length || busy, onclick: endGame }, busy ? 'Saving…' : 'End game and save to ledger'),
        el('button', { class: 'btn danger', type: 'button', onclick: discard }, 'Discard game')));
    }
    return wrap;
  }

  function roundEditor() {
    const r = { winner: draft.winner, entries: draft.entries };
    const problems = Scoring.validate(r);
    let pts = null;
    if (!problems.length) pts = Scoring.scoreRound(r, rules());
    const set = (p, patch) => { Object.assign(draft.entries.find(e => e.player === p), patch); render(); };

    const card = el('section', { class: 'round-editor', 'aria-label': draft.index === null ? `Round ${game.rounds.length + 1}` : `Edit round ${draft.index + 1}` },
      el('h3', {}, draft.index === null ? `Round ${game.rounds.length + 1}` : `Round ${draft.index + 1}`),
      el('p', { class: 'hint' }, 'Tap 👑 for the winner, then set everyone\'s status and maal.'));

    for (const e of draft.entries) {
      const isW = draft.winner === e.player;
      const maalOff = e.status === 'hold' || e.status === 'foul' || (e.status === 'unseen' && game.mode === 'murder' && !isW);
      const maal = el('input', {
        type: 'number', inputmode: 'numeric', min: '0', max: '200', placeholder: '0', class: 'maal-in',
        'aria-label': `${e.player}'s maal`, value: draft.maalText[e.player] ?? '', disabled: maalOff,
      });
      maal.addEventListener('input', () => {
        draft.maalText[e.player] = maal.value.replace(/[^0-9]/g, '');
        e.maal = draft.maalText[e.player] ? parseInt(draft.maalText[e.player], 10) : 0;
        // Update the points without re-rendering, so the keyboard stays open.
        refreshPoints(card);
      });
      const p = pts ? pts[e.player] : null;
      card.append(el('div', { class: 'pr' + (isW ? ' winner' : ''), 'data-player': e.player },
        el('div', { class: 'pr-top' },
          el('button', { type: 'button', class: 'crown' + (isW ? ' on' : ''), 'aria-pressed': String(isW), 'aria-label': `${e.player} won the round`,
            onclick: () => { draft.winner = e.player; if (['unseen', 'hold', 'foul'].includes(e.status)) e.status = 'seen'; render(); } }, '👑'),
          el('span', { class: 'pr-name' }, e.player),
          maalOff ? el('span', { class: 'maal-off' }, e.status === 'unseen' ? 'maal murdered' : '—') : maal,
          el('span', { class: 'pr-pts ' + sign(p ?? 0) }, p === null ? '' : fmt(p))),
        el('div', { class: 'status-row', role: 'radiogroup', 'aria-label': `${e.player}'s status` },
          Scoring.STATUSES.map(s => el('button', {
            type: 'button', role: 'radio', 'aria-checked': String(e.status === s), class: 'st-btn st-' + s + (e.status === s ? ' on' : ''),
            onclick: () => { set(e.player, { status: s }); if (isW && ['unseen', 'hold', 'foul'].includes(s)) { draft.winner = ''; render(); } },
          }, STATUS_LABEL[s])))));
    }
    card.append(el('p', { class: 'round-check' + (problems.length ? '' : ' ok') }, problems.length ? problems[0] : 'Adds up to 0 ✓'));
    card.append(el('div', { class: 'live-actions' },
      el('button', { class: 'btn primary', type: 'button', disabled: problems.length > 0, onclick: saveRound }, 'Save round'),
      el('button', { class: 'btn', type: 'button', onclick: () => { draft = null; render(); } }, 'Cancel'),
      draft.index !== null ? el('button', { class: 'btn danger', type: 'button', onclick: deleteRound }, 'Delete round') : null));
    return card;
  }

  // Recompute points in place while typing maal.
  function refreshPoints(card) {
    const r = { winner: draft.winner, entries: draft.entries };
    const problems = Scoring.validate(r);
    const pts = problems.length ? null : Scoring.scoreRound(r, rules());
    card.querySelectorAll('.pr').forEach(row => {
      const v = pts ? pts[row.dataset.player] : null;
      const out = row.querySelector('.pr-pts');
      out.textContent = v === null ? '' : fmt(v);
      out.className = 'pr-pts ' + sign(v ?? 0);
    });
    const check = card.querySelector('.round-check');
    check.textContent = problems.length ? problems[0] : 'Adds up to 0 ✓';
    check.className = 'round-check' + (problems.length ? '' : ' ok');
    card.querySelector('.live-actions .btn.primary').disabled = problems.length > 0;
  }

  function saveRound() {
    const round = { winner: draft.winner, entries: draft.entries.map(e => ({ player: e.player, status: e.status, maal: e.maal || 0 })) };
    if (draft.index === null) game.rounds.push(round); else game.rounds[draft.index] = round;
    save();
    draft = null;
    render();
    updateOpenButton();
  }

  function deleteRound() {
    if (!confirm(`Delete round ${draft.index + 1}?`)) return;
    game.rounds.splice(draft.index, 1);
    save();
    draft = null;
    render();
  }

  function discard() {
    if (!confirm('Throw away this game? Nothing has been saved to the ledger yet.')) return;
    game = null; draft = null; picked = [];
    save(); render(); updateOpenButton();
  }

  async function endGame() {
    const t = totals();
    const summary = game.players.map(p => `${p} ${fmt(t[p])} (${rs(t[p] * gameRate())})`).join(', ');
    if (!confirm(`End the game after ${game.rounds.length} round${game.rounds.length === 1 ? '' : 's'} and save to the ledger at Rs. ${gameRate()} a point?\n\n${summary}`)) return;
    busy = true; render();
    try {
      const result = await Ledger.addGame(game.startedAt, t, gameRate());
      if (result === 'added') {
        done = `Saved to the ledger: ${summary}.`;
        game = null; draft = null; picked = []; rateText = '';
        save();
      } else if (result === 'duplicate') {
        alert('This game is already in the ledger.');
      }
      // 'cancelled' (no password): keep the game so it can be saved later.
    } catch (e) {
      alert('Could not save: ' + e.message + '\nThe game is still here; try again.');
    }
    busy = false;
    render();
    updateOpenButton();
  }

  function doneView() {
    return el('div', { class: 'live-done' },
      el('p', { class: 'done-msg' }, '✓ ' + done),
      el('div', { class: 'live-actions' },
        el('button', { class: 'btn primary', type: 'button', onclick: close }, 'Back to the ledger'),
        el('button', { class: 'btn', type: 'button', onclick: () => { done = null; render(); } }, 'Score another game')));
  }

  /* ---------- Wiring ---------- */
  $('#live-open').addEventListener('click', open);
  $('#live-close').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#live').hidden) close(); });
  updateOpenButton();
})();
