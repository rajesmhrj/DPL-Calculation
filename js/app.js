/* UI: upload screenshots -> OCR -> review -> ledger -> settlement. */
(function () {
  'use strict';
  const { PLAYERS, preprocess, parseScoreboard, rereadNames, matchPlayer, keyOf, settle } = window.Core;
  const $ = sel => document.querySelector(sel);

  const STORE_KEY = 'marriage-ledger-v1';
  const PW_KEY = 'marriage-edit-password';

  // players: names in display order; aliases: {ocr key: player} learned on the site;
  // games: [{id, date: 'YYYY-MM-DD HH:MM', scores: {player: points}}]
  const emptyLedger = () => ({ rate: 10, players: [...PLAYERS], aliases: {}, games: [] });
  let state = emptyLedger();

  function normalize(st) {
    return Object.assign(emptyLedger(), st, {
      players: st.players && st.players.length ? st.players : [...PLAYERS],
      aliases: st.aliases || {},
    });
  }

  // The player list plus anyone who appears in a game but was removed from it.
  function players(st = state) {
    const list = [...st.players];
    for (const g of st.games) for (const p of Object.keys(g.scores)) if (!list.includes(p)) list.push(p);
    return list;
  }

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { return null; }
  }


  /* ---------- Storage ----------
   * Normally the ledger is one Excel file shared by everyone, read and written
   * through /api/ledger (see api/ledger.js). If that isn't available (e.g. the
   * server isn't configured), the ledger lives in this browser only. */
  let remote = false;
  let sha = null;
  let passwordRequired = false;

  async function fetchRemote() {
    const r = await fetch('api/ledger', { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Server returned ${r.status}`);
    sha = j.sha;
    passwordRequired = !!j.passwordRequired;
    return j.content ? parseWorkbook(XLSX.read(j.content, { type: 'base64' })) : emptyLedger();
  }

  async function load() {
    try {
      state = await fetchRemote();
      remote = true;
    } catch (e) {
      console.warn('Shared ledger unavailable:', e.message);
      remote = false;
      try {
        const s = JSON.parse(store(STORE_KEY));
        if (s && Array.isArray(s.games)) state = normalize(s);
      } catch (err) { /* start empty */ }
    }
  }

  async function refresh() {
    if (!remote) return;
    try { state = await fetchRemote(); render(); } catch (e) { renderLedgerStatus('Could not refresh: ' + e.message); }
  }

  function password(reask) {
    if (!passwordRequired) return '';
    let pw = reask ? null : store(PW_KEY);
    if (!pw) {
      pw = prompt(reask ? 'Wrong edit password. Try again:' : 'Edit password (ask the group admin):') || '';
      store(PW_KEY, pw || null);
    }
    return pw;
  }

  // Every change goes through here, one at a time. With the shared ledger it
  // reloads the latest version first, so two people adding games at once
  // don't overwrite each other. mutate(st) may return false to cancel.
  let lock = Promise.resolve();
  function commit(mutate, message) {
    const run = lock.then(() => doCommit(mutate, message));
    lock = run.catch(() => {});
    return run;
  }

  async function doCommit(mutate, message) {
    if (!remote) {
      if (mutate(state) === false) return false;
      store(STORE_KEY, JSON.stringify(state));
      render();
      return true;
    }
    let reask = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      renderLedgerStatus('Saving…');
      const latest = await fetchRemote();
      if (mutate(latest) === false) { state = latest; render(); return false; }
      const pw = password(reask);
      if (passwordRequired && !pw) { render(); throw new Error('Edit password needed to save.'); }
      const content = XLSX.write(buildWorkbook(latest), { type: 'base64', bookType: 'xlsx' });
      const res = await fetch('api/ledger', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, sha, message, password: pw }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 401) { reask = true; continue; }
      if (res.status === 409) continue; // someone else saved first: reload and redo
      if (!res.ok) { render(); throw new Error(j.error || `Server returned ${res.status}`); }
      sha = j.sha;
      state = latest;
      render();
      return true;
    }
    render();
    throw new Error('Could not save, please try again.');
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const money = n => (n < 0 ? '-' : '') + 'Rs. ' + Math.abs(n).toLocaleString('en-IN');
  const nowStamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /* ---------- Totals & settlement ---------- */
  function sameScores(a, b) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => a[k] === b[k]);
  }

  function totals(st = state) {
    const t = Object.fromEntries(players(st).map(p => [p, 0]));
    for (const g of st.games) for (const [p, v] of Object.entries(g.scores)) t[p] = (t[p] || 0) + v;
    return t;
  }

  // Each game can have its own rupees per point; games without one use the usual rate.
  const rateOf = (g, st = state) => (g.rate > 0 ? g.rate : st.rate);

  function moneyTotals(st = state) {
    const m = Object.fromEntries(players(st).map(p => [p, 0]));
    for (const g of st.games) for (const [p, v] of Object.entries(g.scores)) m[p] = (m[p] || 0) + v * rateOf(g, st);
    return m;
  }

  function settlement(st = state) {
    const balances = moneyTotals(st);
    return { balances, transfers: settle(balances) };
  }

  /* ---------- Rendering ---------- */
  function cell(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  function signClass(v) { return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; }

  function renderGames() {
    const table = $('#games');
    table.replaceChildren();
    const games = [...state.games].sort((a, b) => a.date.localeCompare(b.date));
    if (!games.length) {
      table.append(cell('caption', 'No games yet.'));
      return;
    }
    const shown = players().filter(p => games.some(g => p in g.scores));
    const head = document.createElement('tr');
    head.append(cell('th', 'Game'), ...shown.map(p => cell('th', p)), cell('th', ''));
    table.append(document.createElement('thead'));
    table.tHead.append(head);
    const body = table.createTBody();
    games.forEach((g, i) => {
      const tr = body.insertRow();
      const label = cell('td', `#${i + 1}`, 'game-label');
      label.append(cell('small', g.date));
      const rateBtn = cell('button', `Rs. ${rateOf(g)}/pt${g.rate > 0 ? '' : ' (usual)'}`, 'rate-btn');
      rateBtn.type = 'button';
      rateBtn.title = 'Change this game\'s rupees per point';
      rateBtn.onclick = () => {
        const v = parseFloat(prompt(`Rupees per point for game #${i + 1} (${g.date}):`, String(rateOf(g))) || '');
        if (!(v > 0)) return;
        commit(st => { const x = st.games.find(y => y.id === g.id); if (x) x.rate = v; }, `Set rate of game ${g.date} to ${v}`)
          .catch(e => alert(e.message));
      };
      label.append(rateBtn);
      tr.append(label);
      for (const p of shown) {
        const v = g.scores[p];
        tr.append(cell('td', v === undefined ? '–' : String(v), v === undefined ? 'muted' : signClass(v)));
      }
      const del = cell('button', '✕', 'icon-btn');
      del.title = 'Delete game';
      del.onclick = () => {
        if (!confirm(`Delete game #${i + 1} (${g.date})?`)) return;
        commit(st => { st.games = st.games.filter(x => x.id !== g.id); }, `Delete game ${g.date}`)
          .catch(e => alert(e.message));
      };
      const td = document.createElement('td');
      td.append(del);
      tr.append(td);
    });
    const t = totals();
    const foot = table.createTFoot();
    const r1 = foot.insertRow();
    r1.append(cell('th', 'Total pts'), ...shown.map(p => cell('td', String(t[p]), signClass(t[p]))), cell('td', ''));
    const m = moneyTotals();
    const r2 = foot.insertRow();
    r2.append(cell('th', 'Total Rs.'), ...shown.map(p => cell('td', String(m[p]), signClass(m[p]))), cell('td', ''));
  }

  function renderSettlement() {
    const { balances, transfers } = settlement();
    const bal = $('#balances');
    bal.replaceChildren();
    for (const p of players().sort((a, b) => balances[b] - balances[a])) {
      const row = cell('div', '', 'balance ' + signClass(balances[p]));
      const name = cell('button', p, 'link');
      name.type = 'button';
      name.title = `${p}'s stats`;
      name.onclick = () => Stats.openPerson(p);
      row.append(name, cell('span', balances[p] > 0 ? 'gets ' + money(balances[p])
        : balances[p] < 0 ? 'owes ' + money(-balances[p]) : 'even'));
      bal.append(row);
    }
    const list = $('#transfers');
    list.replaceChildren();
    if (!transfers.length) list.append(cell('li', state.games.length ? 'Everyone is even.' : 'Add games to see who pays whom.', 'muted'));
    for (const t of transfers) {
      const li = document.createElement('li');
      li.append(cell('strong', t.from), document.createTextNode(' pays '), cell('strong', t.to),
        cell('span', money(t.amount), 'amount'));
      list.append(li);
    }
    const off = Object.values(balances).reduce((s, v) => s + v, 0);
    if (off !== 0) list.append(cell('li', `Warning: balances are off by ${money(off)} — check the games table.`, 'warn'));
  }

  function renderLedgerStatus(msg) {
    const n = state.games.length;
    $('#ledger-status').textContent = msg || (remote
      ? `${n} game(s). Shared — everyone with the link sees this.`
      : `${n} game(s). Shared ledger not connected — saved on this device only.`);
    $('#ledger-status').className = 'hint ' + (remote ? '' : 'warn');
  }

  function render() {
    $('#rate').value = state.rate;
    renderPlayers();
    refreshSelects();
    renderGames();
    renderSettlement();
    renderLedgerStatus();
    Stats.render();
  }

  /* ---------- Review cards ---------- */
  // Dropdown value for "+ New player…". Never a player name (names start with a letter).
  const NEW_PLAYER = '__new';

  function fillPlayerOptions(sel, value) {
    sel.replaceChildren(new Option('— pick —', ''));
    for (const p of players()) sel.append(new Option(p, p, false, p === value));
    sel.append(new Option('+ New player…', NEW_PLAYER));
    sel.value = value || '';
  }

  function playerSelect(value) {
    const sel = document.createElement('select');
    fillPlayerOptions(sel, value);
    return sel;
  }

  // Refresh every review card's dropdowns after the player list changes.
  function refreshSelects() {
    for (const sel of document.querySelectorAll('.review select')) fillPlayerOptions(sel, sel.value === NEW_PLAYER ? '' : sel.value);
  }

  function addColumnRow(card, col) {
    const tr = card.querySelector('.cols tbody').insertRow();
    tr.dataset.raw = col.name || '';
    const sel = playerSelect(col.name ? matchPlayer(col.name, state.aliases, players()) : '');
    const num = document.createElement('input');
    num.type = 'number';
    num.step = '1';
    num.value = col.total ?? '';
    const rm = cell('button', '✕', 'icon-btn');
    rm.onclick = () => { tr.remove(); updateSum(card); };
    num.oninput = () => updateSum(card);
    sel.onchange = async () => {
      if (sel.value === NEW_PLAYER) {
        // Keep the card from being saved until the new player exists.
        sel.disabled = true;
        card.querySelector('.save').disabled = true;
        try {
          const name = await addPlayer(prompt('New player name:', (col.name || '').replace(/\.$/, '')) || '');
          fillPlayerOptions(sel, name || '');
        } finally {
          sel.disabled = false;
          card.querySelector('.save').disabled = false;
        }
      }
      updateSum(card);
    };
    const raw = cell('td', col.name || '—', 'muted');
    const tdSel = document.createElement('td'); tdSel.append(sel);
    const tdNum = document.createElement('td'); tdNum.append(num);
    const tdRm = document.createElement('td'); tdRm.append(rm);
    tr.append(raw, tdSel, tdNum, tdRm);
  }

  function readCard(card) {
    return [...card.querySelectorAll('.cols tbody tr')].map(tr => ({
      raw: tr.dataset.raw,
      player: tr.querySelector('select').value === NEW_PLAYER ? '' : tr.querySelector('select').value,
      value: tr.querySelector('input').value === '' ? null : parseInt(tr.querySelector('input').value, 10),
    }));
  }

  function updateSum(card) {
    const rows = readCard(card);
    const total = rows.reduce((s, r) => s + (r.value || 0), 0);
    const el = card.querySelector('.sum');
    el.textContent = total === 0 ? 'Sum: 0 ✓' : `Sum: ${total} (should be 0)`;
    el.className = 'sum ' + (total === 0 ? 'pos' : 'neg');
  }

  function toLocalInput(stamp) { return stamp ? stamp.replace(' ', 'T') : ''; }

  function makeCard(imgUrl) {
    const card = $('#review-tpl').content.firstElementChild.cloneNode(true);
    const img = card.querySelector('img');
    if (imgUrl) img.src = imgUrl; else img.remove();
    card.querySelector('.date').value = toLocalInput(nowStamp());
    card.querySelector('.game-rate').value = state.rate;
    card.querySelector('.add-col').onclick = () => { addColumnRow(card, {}); updateSum(card); };
    card.querySelector('.discard').onclick = () => { if (imgUrl) URL.revokeObjectURL(imgUrl); card.remove(); };
    card.querySelector('.save').onclick = () => saveCard(card, imgUrl).catch(e => alert(e.message));
    $('#pending').prepend(card);
    return card;
  }

  function fillCard(card, parsed) {
    card.querySelector('.cols tbody').replaceChildren();
    for (const c of parsed.columns) addColumnRow(card, c);
    if (!parsed.columns.length) { addColumnRow(card, {}); addColumnRow(card, {}); }
    if (parsed.startTime) card.querySelector('.date').value = toLocalInput(parsed.startTime);
    const warn = card.querySelector('.warnings');
    warn.replaceChildren(...parsed.warnings.map(w => cell('li', w)));
    card.querySelector('.game-rate').value = parsed.rate > 0 ? parsed.rate : state.rate;
    updateSum(card);
  }

  // auto: called right after OCR; adds the game only if nothing needs a human
  // decision, otherwise resolves to the reason and leaves the card for review.
  async function saveCard(card, imgUrl, auto) {
    const rows = readCard(card).filter(r => r.player || r.value !== null);
    const problems = [];
    if (rows.length < 2) problems.push('Need at least 2 players.');
    if (rows.some(r => !r.player || !players().includes(r.player))) problems.push('Pick a player for every row.');
    if (rows.some(r => r.value === null || Number.isNaN(r.value))) problems.push('Enter points for every row.');
    const seen = new Set();
    for (const r of rows) { if (r.player && seen.has(r.player)) problems.push(`${r.player} is listed twice.`); seen.add(r.player); }
    if (auto && card.querySelector('.warnings li')) problems.push('See the notes above.');
    if (problems.length) { if (auto) return problems.join(' '); alert(problems.join('\n')); return; }

    const total = rows.reduce((s, r) => s + r.value, 0);
    if (total !== 0) {
      if (auto) return `Points add up to ${total}, not 0.`;
      if (!confirm(`Points add up to ${total}, not 0. Add anyway?`)) return;
    }

    const date = (card.querySelector('.date').value || toLocalInput(nowStamp())).replace('T', ' ');
    const scores = Object.fromEntries(rows.map(r => [r.player, r.value]));
    const rate = parseFloat(card.querySelector('.game-rate').value);
    if (!(rate > 0)) { if (auto) return 'Enter the rupees per point.'; alert('Enter the rupees per point for this game.'); return; }
    // Remember how this screenshot's abbreviations map to players, for everyone.
    const learned = {};
    for (const r of rows) {
      const k = keyOf(r.raw);
      if (k.length >= 2 && matchPlayer(r.raw, state.aliases, players()) !== r.player) learned[k] = r.player;
    }

    // The duplicate check runs against the latest shared ledger.
    let dupe = false;
    const added = await commit(st => {
      const same = st.games.some(g => g.date === date && sameScores(g.scores, scores));
      if (same && (auto || !confirm('An identical game is already in the ledger. Add it again?'))) { dupe = true; return false; }
      st.games.push({ id: uid(), date, scores, rate });
      Object.assign(st.aliases, learned);
      for (const p of Object.keys(scores)) if (!st.players.includes(p)) st.players.push(p);
    }, `Add game ${date}`);
    if (!added) return dupe && auto ? 'This game is already in the ledger.' : undefined;

    if (imgUrl) URL.revokeObjectURL(imgUrl);
    const note = cell('p', `Added game (${date}, Rs. ${rate}/pt): ` + rows.map(r => `${r.player} ${r.value > 0 ? '+' : ''}${r.value}`).join(', '), 'added');
    card.replaceWith(note);
    render();
  }

  /* ---------- For the live scorer (js/scorer.js) ---------- */
  // Saves a finished game's totals to the shared ledger, like a screenshot would.
  async function addGame(date, scores, rate) {
    let dupe = false;
    const added = await commit(st => {
      if (st.games.some(g => g.date === date && sameScores(g.scores, scores))) { dupe = true; return false; }
      st.games.push({ id: uid(), date, scores, ...(rate > 0 ? { rate } : {}) });
      for (const p of Object.keys(scores)) if (!st.players.includes(p)) st.players.push(p);
    }, `Add game ${date}`);
    return added ? 'added' : dupe ? 'duplicate' : 'cancelled';
  }
  window.Ledger = { players: () => players(), addGame, addPlayer, now: () => nowStamp(), rate: () => state.rate };

  /* ---------- OCR ---------- */
  let workerPromise = null;
  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng').then(async w => {
        await w.setParameters({ tessedit_pageseg_mode: '11' });
        return w;
      });
    }
    return workerPromise;
  }

  async function imageToCanvas(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(3, Math.max(1, 1500 / bmp.width));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bands = preprocess(img.data, canvas.width, canvas.height);
    ctx.putImageData(img, 0, 0);
    return { canvas, bands };
  }

  async function processFile(file) {
    const url = URL.createObjectURL(file);
    const card = makeCard(url);
    const status = card.querySelector('.status');
    status.textContent = 'Reading screenshot…';
    card.classList.add('busy');
    try {
      const { canvas, bands } = await imageToCanvas(file);
      const worker = await getWorker();
      const { data } = await worker.recognize(canvas);
      const words = data.words.map(w => ({ text: w.text, ...w.bbox }));
      const parsed = parseScoreboard(words, bands);
      // Names that didn't match: read just that header cell again.
      await rereadNames(parsed, async rectangle => {
        await worker.setParameters({ tessedit_pageseg_mode: '7' });
        try { return (await worker.recognize(canvas, { rectangle })).data.text; }
        finally { await worker.setParameters({ tessedit_pageseg_mode: '11' }); }
      }, state.aliases, players());
      fillCard(card, parsed);
      card.classList.remove('busy');
      let reason;
      try { reason = await saveCard(card, url, true); } catch (e) { reason = e.message; }
      if (reason) status.textContent = 'Needs a check: ' + reason;
    } catch (e) {
      console.error(e);
      fillCard(card, { columns: [], warnings: ['Could not read this image. Enter the totals manually.'] });
      status.textContent = '';
    }
    card.classList.remove('busy');
  }

  // Run one at a time so the single OCR worker isn't flooded.
  let queue = Promise.resolve();
  function handleFiles(files) {
    for (const f of files) if (f.type.startsWith('image/')) queue = queue.then(() => processFile(f));
  }

  /* ---------- Excel ---------- */
  function buildWorkbook(st) {
    const wb = XLSX.utils.book_new();
    const games = [...st.games].sort((a, b) => a.date.localeCompare(b.date));
    const ps = players(st);
    const rows = [['Game', 'Date', ...ps, 'Rate', 'ID']];
    games.forEach((g, i) => rows.push([i + 1, g.date, ...ps.map(p => g.scores[p] ?? ''), g.rate > 0 ? g.rate : '', g.id]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Games');

    const t = totals(st), m = moneyTotals(st);
    const tot = [['Player', 'Points', 'Amount (Rs.)'], ...ps.map(p => [p, t[p], m[p]])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tot), 'Totals');

    const { transfers } = settlement(st);
    const sheet = [['From', 'To', 'Amount (Rs.)'], ...transfers.map(x => [x.from, x.to, x.amount])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), 'Settlement');

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rate (Rs. per point)', st.rate], ['', 'Used for games with no Rate of their own']]), 'Settings');

    const nick = p => Object.keys(st.aliases).filter(k => st.aliases[k] === p).join(', ');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Player', 'Nicknames'], ...st.players.map(p => [p, nick(p)])]), 'Players');
    return wb;
  }

  function parseWorkbook(wb) {
    const ws = wb.Sheets.Games;
    if (!ws) throw new Error('This Excel has no "Games" sheet.');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    const header = (rows[0] || []).map(String);
    const col = name => header.indexOf(name);
    const nameCols = header.map((h, i) => [h.trim(), i]).filter(([h]) => h && !['Game', 'Date', 'ID', 'Rate'].includes(h));
    const games = [];
    for (const r of rows.slice(1)) {
      const scores = {};
      for (const [p, i] of nameCols) {
        if (String(r[i]).trim() !== '') scores[p] = parseInt(r[i], 10);
      }
      if (Object.keys(scores).length) {
        const gameRate = col('Rate') >= 0 ? parseFloat(r[col('Rate')]) : NaN;
        games.push({ id: String((col('ID') >= 0 && r[col('ID')]) || uid()), date: String(r[col('Date')] || ''), scores, ...(gameRate > 0 ? { rate: gameRate } : {}) });
      }
    }
    let rate = 10;
    const settings = wb.Sheets.Settings;
    if (settings && settings.B1 && Number(settings.B1.v) > 0) rate = Number(settings.B1.v);

    // Players sheet (older files don't have one: use the default list).
    let list = [...PLAYERS];
    const aliases = {};
    if (wb.Sheets.Players) {
      const prow = XLSX.utils.sheet_to_json(wb.Sheets.Players, { header: 1, raw: false, defval: '' }).slice(1);
      list = prow.map(r => String(r[0]).trim()).filter(Boolean);
      for (const r of prow) {
        for (const k of String(r[1]).split(',').map(keyOf).filter(Boolean)) aliases[k] = String(r[0]).trim();
      }
    }
    for (const [p] of nameCols) if (!list.includes(p)) list.push(p);
    return normalize({ rate, players: list, aliases, games });
  }

  function exportXlsx() {
    XLSX.writeFile(buildWorkbook(state), `marriage-ledger-${nowStamp().slice(0, 10)}.xlsx`);
  }

  async function importXlsx(file) {
    const imported = parseWorkbook(XLSX.read(await file.arrayBuffer()));
    if (!confirm(`Replace the ${state.games.length} game(s) in the ledger with ${imported.games.length} from ${file.name}?`)) return;
    await commit(st => Object.assign(st, imported), `Replace ledger from ${file.name}`);
  }

  /* ---------- Players ---------- */
  // Resolves to the added (or existing) player's name, or '' if cancelled/failed.
  async function addPlayer(raw) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) return '';
    if (!/^[A-Za-z][A-Za-z .'-]{0,29}$/.test(name)) { alert('Use letters only (up to 30).'); return ''; }
    const existing = players().find(p => p.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const proper = name.charAt(0).toUpperCase() + name.slice(1);
    try {
      await commit(st => {
        if (st.players.some(p => p.toLowerCase() === proper.toLowerCase())) return;
        st.players.push(proper);
      }, `Add player ${proper}`);
      return players().find(p => p.toLowerCase() === proper.toLowerCase()) || '';
    } catch (e) { alert(e.message); return ''; }
  }

  function renderPlayers() {
    const box = $('#players');
    box.replaceChildren();
    for (const p of players()) {
      const chip = cell('span', p, 'chip');
      const played = state.games.some(g => p in g.scores);
      if (!played) {
        const rm = cell('button', '✕', 'icon-btn');
        rm.title = `Remove ${p}`;
        rm.onclick = () => {
          if (!confirm(`Remove ${p} from the player list?`)) return;
          commit(st => {
            if (st.games.some(g => p in g.scores)) return false;
            st.players = st.players.filter(x => x !== p);
            for (const k of Object.keys(st.aliases)) if (st.aliases[k] === p) delete st.aliases[k];
          }, `Remove player ${p}`).catch(e => alert(e.message));
        };
        chip.append(rm);
      }
      box.append(chip);
    }
  }

  /* ---------- Wiring ---------- */
  function copyText() {
    const { transfers } = settlement();
    const t = totals();
    const m = moneyTotals();
    const lines = ['Marriage settlement', ''];
    for (const p of players()) if (t[p] || m[p]) lines.push(`${p}: ${t[p] > 0 ? '+' : ''}${t[p]} pts (${money(m[p])})`);
    lines.push('');
    for (const x of transfers) lines.push(`${x.from} → ${x.to}: ${money(x.amount)}`);
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => { $('#copy').textContent = 'Copied!'; setTimeout(() => { $('#copy').textContent = 'Copy as text'; }, 1500); },
      () => prompt('Copy this:', lines.join('\n')));
  }

  async function init() {
    Stats.init({ state: () => state, players: () => players(), money });
    renderLedgerStatus('Loading ledger…');
    await load();
    render();
    $('#refresh').onclick = refresh;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    $('#photos').onchange = e => { handleFiles(e.target.files); e.target.value = ''; };
    const drop = $('#drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); };
    $('#manual').onclick = () => {
      const card = makeCard(null);
      fillCard(card, { columns: [], warnings: [] });
      card.querySelector('.status').textContent = 'Enter each player\'s Total Points.';
    };
    $('#rate').onchange = e => {
      const v = parseInt(e.target.value, 10);
      if (v > 0) commit(st => { st.rate = v; }, `Set rate to ${v}`).catch(err => { alert(err.message); render(); });
      else e.target.value = state.rate;
    };
    $('#xlsx-out').onclick = exportXlsx;
    $('#xlsx-in').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importXlsx(f).catch(err => alert('Could not use that Excel: ' + err.message)); };
    $('#clear').onclick = () => {
      if (!state.games.length || !confirm('Remove ALL games for everyone (e.g. after everyone has settled up)? Download the Excel first to keep a copy.')) return;
      commit(st => { st.games = []; }, 'Clear ledger').catch(e => alert(e.message));
    };
    $('#copy').onclick = copyText;
    $('#add-player').onsubmit = async e => {
      e.preventDefault();
      const input = $('#new-player');
      if (await addPlayer(input.value)) input.value = '';
    };
  }

  init();
})();
