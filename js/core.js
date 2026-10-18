/* Shared logic: image preprocessing, OCR parsing, name matching, settlement.
 * Works in the browser (window.Core) and in Node (module.exports) for tests. */
(function (root) {
  'use strict';

  // Starting list; the live list is stored in the shared Excel ("Players" sheet)
  // and players can be added from the site.
  const PLAYERS = ['Uttu', 'Utsu', 'Sanil', 'Harsh', 'Sargat', 'Subash', 'Rajesh', 'Suyog', 'Abhishek', 'Sajol'];

  // Names as they appear in the app (lowercase, letters only) -> player.
  // Abbreviations ("Hars.", "SARG", "raje") are matched automatically; this is
  // for nicknames that don't resemble the real name. More are learned on the
  // site and kept in the Excel.
  const DEFAULT_ALIASES = {
    subh: 'Subash',
    bh: 'Abhishek',
    bhuj: 'Abhishek',
    bhuju: 'Abhishek',
  };

  /* ---------- Image preprocessing ----------
   * The scoreboard has white-on-red header rows and dark/green/red text on light
   * cells. In the green channel every body text colour is dark; rows that are
   * mostly red (headers) are handled separately by picking out white pixels.
   * Operates in place on RGBA pixel data. */
  // Returns the red header bands as [{y0, y1}] (used to re-read missed names).
  function preprocess(data, width, height) {
    const bands = [];
    for (let y = 0; y < height; y++) {
      let red = 0;
      const row = y * width * 4;
      for (let x = 0; x < width; x++) {
        const i = row + x * 4;
        if (data[i] > 170 && data[i + 1] < 100 && data[i + 2] < 120) red++;
      }
      const invert = red > width * 0.3;
      if (invert) {
        const b = bands[bands.length - 1];
        if (b && y - b.y1 <= 8) b.y1 = y; else bands.push({ y0: y, y1: y });
      }
      for (let x = 0; x < width; x++) {
        const i = row + x * 4;
        const v = invert
          ? (data[i + 1] > 190 && data[i + 2] > 190 ? 0 : 255)
          : (data[i + 1] < 175 ? 0 : 255);
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return bands.filter(b => b.y1 - b.y0 >= 20);
  }

  /* ---------- OCR parsing ---------- */

  // words: [{text, x0, y0, x1, y1}] -> rows top-to-bottom, words left-to-right.
  function groupRows(words) {
    const ws = words
      .filter(w => w.text && w.text.trim())
      .map(w => ({ text: w.text.trim(), cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 }))
      .sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const w of ws) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(w.cy - r.cy) < Math.max(r.h, w.h) * 0.6) {
        r.words.push(w);
        r.cy = r.words.reduce((s, x) => s + x.cy, 0) / r.words.length;
      } else {
        rows.push({ cy: w.cy, h: w.h, words: [w] });
      }
    }
    for (const r of rows) {
      r.words.sort((a, b) => a.cx - b.cx);
      r.text = r.words.map(w => w.text).join(' ');
    }
    return rows;
  }

  function normalizeText(s) {
    return s.replace(/[−–—~]/g, '-');
  }

  // Numeric words in a row, with their x position.
  function rowNumbers(row) {
    const out = [];
    for (const w of row.words) {
      const t = normalizeText(w.text);
      if (/\/\s*pt/i.test(t)) continue; // "10/pt"
      const m = t.match(/^[|(\[]?(-?\d+)/);
      if (m) out.push({ value: parseInt(m[1], 10), cx: w.cx });
    }
    return out;
  }

  const STOPWORDS = new Set(['round', 'total', 'points', 'amt', 'rank', 'score', 'stream', 'home']);

  function rowWords(row) {
    return row.words
      .map(w => ({ text: w.text.replace(/[^A-Za-z]/g, ''), cx: w.cx }))
      .filter(w => w.text.length >= 2 && !STOPWORDS.has(w.text.toLowerCase()));
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // "October 1, 2026 @ 6:49 PM" -> "2026-10-01 18:49" (tolerant of OCR noise).
  function parseStartTime(text) {
    const m = text.match(/([A-Za-z]{3,})\s*(\d{1,2})?[.,]?\s*(\d{4})\s*@?\s*(\d{1,2})[:.](\d{2})\s*(\S?M)?/i);
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month < 0 || !m[2]) return null;
    let h = parseInt(m[4], 10);
    if (m[6] && /^[AP]/i.test(m[6])) {
      h = h % 12;
      if (/^P/i.test(m[6])) h += 12;
    }
    const pad = n => String(n).padStart(2, '0');
    return `${m[3]}-${pad(month + 1)}-${pad(m[2])} ${pad(h)}:${m[5]}`;
  }

  const sum = arr => arr.reduce((s, v) => s + v, 0);

  /* words: Tesseract word boxes. Returns {columns: [{name, total}], rate, startTime, warnings}. */
  function parseScoreboard(words, bands) {
    const rows = groupRows(words);
    const warnings = [];

    // The money row follows the last "Rs. 10/pt" label.
    let rsIdx = -1, rate = 10;
    rows.forEach((r, i) => {
      const m = r.text.match(/(\d+)\s*\/\s*pt/i);
      if (m || /\bRs\b/i.test(r.text)) { rsIdx = i; if (m) rate = parseInt(m[1], 10) || 10; }
    });
    let amt = null, amtIdx = -1;
    if (rsIdx >= 0) {
      for (let i = rsIdx; i <= Math.min(rsIdx + 2, rows.length - 1); i++) {
        const n = rowNumbers(rows[i]);
        if (n.length >= 2) { amt = n; amtIdx = i; break; }
      }
    }

    // Points row: last row with numbers above the money row (or a "Total" row).
    let pts = null, ptsIdx = -1;
    const limit = amtIdx >= 0 ? amtIdx : rows.length;
    for (let i = limit - 1; i >= 0; i--) {
      if (i === rsIdx) continue;
      const n = rowNumbers(rows[i]);
      if (n.length >= 2) { pts = n; ptsIdx = i; break; }
      if (amtIdx < 0 && i < limit - 4) break;
    }

    let cols = null;
    const derived = amt && amt.every(a => a.value % rate === 0)
      ? amt.map(a => ({ value: a.value / rate, cx: a.cx })) : null;
    const same = (a, b) => a && b && a.length === b.length && a.every((x, k) => x.value === b[k].value);
    const zero = a => a && sum(a.map(x => x.value)) === 0;
    if (pts && same(pts, derived)) cols = pts;
    else if (zero(derived)) cols = derived;
    else if (zero(pts)) cols = pts;
    else cols = (derived && (!pts || derived.length >= pts.length)) ? derived : pts;

    if (!cols || cols.length < 2) {
      return { columns: [], rate, startTime: null, warnings: ['Could not find the Total Points row. Enter the totals manually.'] };
    }
    if (!zero(cols)) warnings.push(`Totals add up to ${sum(cols.map(c => c.value))}, not 0 — a number was probably misread.`);

    // Header: nearest row above the totals whose words line up with the columns.
    const totalsIdx = ptsIdx >= 0 ? ptsIdx : amtIdx;
    const gaps = cols.slice(1).map((c, k) => c.cx - cols[k].cx);
    const tol = (gaps.length ? Math.min(...gaps) : 100) / 2;
    const align = row => cols.map(c => {
      let best = null;
      for (const w of rowWords(row)) {
        const d = Math.abs(w.cx - c.cx);
        if (d < tol && (!best || d < best.d)) best = { d, text: w.text };
      }
      return best ? best.text : '';
    });
    let names = cols.map(() => '');
    for (let i = totalsIdx - 1; i >= 0; i--) {
      const cand = align(rows[i]);
      if (cand.filter(Boolean).length >= Math.ceil(cols.length / 2)) { names = cand; break; }
    }
    if (names.some(n => !n)) warnings.push('Some player names could not be read; pick them manually.');

    let startTime = null;
    for (let i = totalsIdx; i < rows.length && !startTime; i++) {
      if (/\d{4}/.test(rows[i].text)) startTime = parseStartTime(rows[i].text);
    }

    // Red header band nearest above the totals, for re-reading names cell by cell.
    const totalsY = rows[totalsIdx].cy;
    const above = (bands || []).filter(b => b.y1 < totalsY);
    const header = above.length ? above[above.length - 1] : null;
    const half = gaps.length ? Math.min(...gaps) / 2 : 100;

    return {
      columns: cols.map((c, k) => ({ name: names[k], total: c.value, x0: c.cx - half, x1: c.cx + half })),
      header, rate, startTime, warnings,
    };
  }

  /* ---------- Name matching ---------- */

  // Lowercase letters only, with common OCR digit/letter mix-ups undone
  // ("5arg" -> "sarg", "Su8h" -> "subh").
  function keyOf(raw) {
    return (raw || '').toLowerCase()
      .replace(/0/g, 'o').replace(/[1|!]/g, 'l').replace(/5/g, 's').replace(/8/g, 'b').replace(/[69]/g, 'g')
      .replace(/[^a-z]/g, '');
  }

  // Letters OCR confuses with each other compare as equal.
  function canon(s) {
    return s.replace(/[il]/g, 'l').replace(/q/g, 'g').replace(/rn/g, 'm').replace(/vv/g, 'w');
  }

  // Levenshtein distance.
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  // How well an OCR'd key fits a name: 0 = it is the name or a prefix of it
  // (the app shortens long names, e.g. "Sarg." for Sargat).
  function fit(key, name) {
    const k = canon(key), n = canon(name);
    if (n.startsWith(k)) return 0;
    const prefix = distance(k, n.slice(0, k.length)) / k.length;
    const whole = distance(k, n) / Math.max(k.length, n.length);
    return Math.min(prefix, whole);
  }

  // OCR'd column header ("Hars.", "SARG", "subas", "5arg") -> player, or ''
  // when nothing fits well or two players fit equally well ("Ut", "Sa").
  function matchPlayer(raw, aliases, players) {
    const list = players && players.length ? players : PLAYERS;
    const key = keyOf(raw);
    if (key.length < 2) return '';
    const all = Object.assign({}, DEFAULT_ALIASES, aliases || {});
    const valid = p => list.includes(p);
    // A player's own name wins over any learned nickname.
    const exact = list.find(p => keyOf(p) === key);
    if (exact) return exact;
    if (all[key] && valid(all[key])) return all[key];

    const scores = new Map();
    const consider = (player, name) => {
      if (!valid(player) || !name) return;
      const sc = fit(key, name);
      if (!scores.has(player) || sc < scores.get(player)) scores.set(player, sc);
    };
    for (const p of list) consider(p, keyOf(p));
    for (const [k, p] of Object.entries(all)) if (k.length >= 3) consider(p, k);

    const ranked = [...scores.entries()].sort((a, b) => a[1] - b[1]);
    if (!ranked.length || ranked[0][1] > 0.34) return '';
    if (ranked.length > 1 && ranked[1][1] === ranked[0][1]) return '';
    return ranked[0][0];
  }

  /* For columns whose name didn't match, crop just that header cell and OCR it
   * again as a single word. ocrCell({left, top, width, height}) -> text. */
  async function rereadNames(parsed, ocrCell, aliases, players) {
    if (!parsed.header) return;
    const { y0, y1 } = parsed.header;
    for (const c of parsed.columns) {
      if (matchPlayer(c.name, aliases, players)) continue;
      const text = (await ocrCell({
        left: Math.max(0, Math.round(c.x0)), top: Math.max(0, y0 - 2),
        width: Math.round(c.x1 - c.x0), height: y1 - y0 + 4,
      })) || '';
      const word = text.split(/\s+/).map(w => w.trim()).filter(w => keyOf(w).length >= 2)
        .sort((a, b) => keyOf(b).length - keyOf(a).length)[0];
      if (word && (matchPlayer(word, aliases, players) || !c.name)) c.name = word.replace(/[^A-Za-z0-9.]/g, '');
    }
    if (parsed.columns.every(c => matchPlayer(c.name, aliases, players))) {
      parsed.warnings = parsed.warnings.filter(w => !/player names/.test(w));
    }
  }

  /* ---------- Settlement ----------
   * balances: {name: amount}; positive = receives, negative = pays.
   * Greedy largest-debtor-to-largest-creditor; at most n-1 transfers. */
  function settle(balances) {
    const creditors = [], debtors = [];
    for (const [name, amt] of Object.entries(balances)) {
      if (amt > 0) creditors.push({ name, amt });
      else if (amt < 0) debtors.push({ name, amt: -amt });
    }
    creditors.sort((a, b) => b.amt - a.amt);
    debtors.sort((a, b) => b.amt - a.amt);
    const transfers = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amt, creditors[j].amt);
      if (pay > 0) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
      debtors[i].amt -= pay;
      creditors[j].amt -= pay;
      if (debtors[i].amt === 0) i++;
      if (creditors[j].amt === 0) j++;
    }
    return transfers;
  }

  const api = { PLAYERS, DEFAULT_ALIASES, preprocess, groupRows, parseScoreboard, parseStartTime, matchPlayer, rereadNames, keyOf, settle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Core = api;
})(typeof window !== 'undefined' ? window : globalThis);
