/* Stats views: the group "Stats" section, a page per player (tap a name),
 * and head-to-head between two players. Pages open over the site via the URL
 * hash (#p=Name, #vs=A~B) so the phone's back button closes them. */
(function () {
  'use strict';
  const A = window.Analytics, C = window.Charts;
  const $ = s => document.querySelector(s);

  let ctx = null; // { state(), players(), money(n) }
  const SLOTS = ['--series-1', '--series-2', '--series-3'];
  let highlighted = null; // [{name, slot}] for the running-totals chart

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
    return e;
  }

  const signed = v => (v > 0 ? '+' : v < 0 ? '−' : '') + ctx.money(Math.abs(v)).replace(/^-/, '');
  const sign = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const pct = x => `${Math.round(x * 100)}%`;
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');
  const date = d => C.shortDate(d);
  const when = d => `${C.shortDate(d)}${/\d{2}:\d{2}/.test(d) ? ' ' + d.match(/\d{2}:\d{2}/)[0] : ''}`;

  const personLink = name => h('button', { class: 'link', type: 'button', onclick: () => openPerson(name) }, name);
  const tile = (label, value, sub, cls) => h('div', { class: 'tile' }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value ' + (cls || '') }, value), sub ? h('div', { class: 'tile-sub' }, sub) : null);
  const section = (title, ...body) => h('section', { class: 'stats-block' }, h('h3', {}, title), ...body);
  const table = (head, rows, cls) => h('div', { class: 'table-wrap' }, h('table', { class: 'stats-table ' + (cls || '') },
    h('thead', {}, h('tr', {}, head.map(x => h('th', {}, x)))),
    h('tbody', {}, rows)));

  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MIN_DAY_GAMES = 2;
  const dayTile = (label, r, text, cls) => r
    ? tile(label, r.day, text(r), cls)
    : tile(label, '—', `Needs ${MIN_DAY_GAMES}+ games on a day`);

  /** Tinted cell for the who-plays-when grid: blue when up, red when down. */
  function heatCell(r, maxAbs) {
    if (!r.games) return h('td', { class: 'heat empty' }, '—');
    const pctTint = Math.round(8 + 37 * Math.min(1, Math.abs(r.avg) / (maxAbs || 1)));
    const color = r.avg > 0 ? 'var(--chart-pos)' : r.avg < 0 ? 'var(--chart-neg)' : 'var(--chart-context)';
    return h('td', { class: 'heat', style: `background: color-mix(in srgb, ${color} ${pctTint}%, var(--surface))`, title: `${r.day}: ${r.games} game${r.games > 1 ? 's' : ''}, ${r.wins}–${r.losses}, ${signed(Math.round(r.avg))} a game` },
      h('div', {}, (r.avg > 0 ? '+' : r.avg < 0 ? '−' : '') + Math.abs(Math.round(r.avg)).toLocaleString('en-IN')), h('div', { class: 'heat-sub' }, `${r.games} game${r.games > 1 ? 's' : ''}`));
  }

  function data() {
    const st = ctx.state();
    return { games: st.games, names: ctx.players(), rate: st.rate };
  }

  /* ---------- Group stats ---------- */
  function renderGroup() {
    const box = $('#stats');
    if (!box) return;
    const { games, names, rate } = data();
    const g = A.group(games, names, rate);
    box.replaceChildren();
    if (!g.games) { box.append(h('p', { class: 'muted' }, 'Stats appear once games are added.')); return; }

    box.append(h('div', { class: 'tiles' },
      tile('Games played', String(g.games), `${date(g.firstDate)} – ${date(g.lastDate)}`),
      tile('Money changed hands', ctx.money(g.moneyMoved), `about ${ctx.money(Math.round(g.moneyMoved / g.games))} a game`),
      tile('Biggest win', signed(g.biggestWin.value), `${g.biggestWin.name} · ${date(g.biggestWin.date)}`, 'pos'),
      tile('Biggest loss', signed(g.biggestLoss.value), `${g.biggestLoss.name} · ${date(g.biggestLoss.date)}`, 'neg'),
    ));

    const ranked = [...g.players].sort((a, b) => b.net - a.net);
    const standBox = h('div');
    box.append(section('Standings', h('p', { class: 'hint' }, 'Money won or lost over all games. Tap a name for their stats.'), standBox));
    C.standings(standBox, ranked.map(p => ({ label: p.name, value: p.net, text: signed(p.net), onClick: () => openPerson(p.name) })), { label: 'Net money per player' });

    // Running totals: everyone in gray, up to three highlighted.
    const valid = new Set(g.players.map(p => p.name));
    if (!highlighted || highlighted.some(x => !valid.has(x.name))) {
      highlighted = [...g.players].sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).slice(0, 3).map((p, i) => ({ name: p.name, slot: SLOTS[i] }));
    }
    const lineBox = h('div');
    const chips = h('div', { class: 'chips stats-chips' }, g.players.map(p => {
      const on = highlighted.find(x => x.name === p.name);
      return h('button', {
        type: 'button', class: 'chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
        onclick: () => {
          if (on) highlighted = highlighted.filter(x => x.name !== p.name);
          else {
            const free = SLOTS.find(s => !highlighted.some(x => x.slot === s));
            if (!free) highlighted.shift();
            highlighted.push({ name: p.name, slot: free || SLOTS.find(s => !highlighted.some(x => x.slot === s)) });
          }
          renderGroup();
        },
      }, on ? h('span', { class: 'swatch', style: `background: var(${on.slot})` }) : null, p.name);
    }));
    box.append(section('Running totals', h('p', { class: 'hint' }, 'Each line is a player\'s total after every game. Highlight up to three.'), chips, lineBox));
    C.lines(lineBox, g.timeline.map(t => t.date), g.players.map(p => {
      const on = highlighted.find(x => x.name === p.name);
      return { name: p.name, values: g.cumulative[p.name], color: on ? on.slot : null, format: signed };
    }), { label: 'Running total per player' });

    // Days of the week.
    const days = A.groupWeekdays(games, rate);
    const busiest = [...days].sort((x, y) => y.games - x.games)[0];
    const richest = days.filter(d => d.games).sort((x, y) => y.moneyMoved / y.games - x.moneyMoved / x.games)[0];
    const dayChart = h('div');
    const perPlayer = g.players.map(p => ({ p, rows: A.playerWeekdays(games, p.name, rate) })).sort((x, y) => y.p.games - x.p.games);
    const maxAbs = Math.max(1, ...perPlayer.flatMap(x => x.rows.filter(r => r.games).map(r => Math.abs(r.avg))));
    box.append(section('Days of the week',
      h('div', { class: 'tiles' },
        tile('Most games on', busiest.day, `${busiest.games} of ${g.games} games`),
        tile('Biggest stakes on', richest.day, `about ${ctx.money(Math.round(richest.moneyMoved / richest.games))} changes hands a game`),
      ),
      h('p', { class: 'hint' }, 'Games played on each day.'),
      dayChart,
      h('h3', { class: 'sub-h' }, 'Who plays when, and how they do'),
      h('p', { class: 'hint' }, `Average rupees won or lost per game on each day (blue up, red down), with the number of games. "Best day" needs at least ${MIN_DAY_GAMES} games on that day. Tap a name for details.`),
      table(['Player', ...SHORT_DAYS, 'Best day'], perPlayer.map(({ p, rows }) => {
        const best = A.bestDay(rows, MIN_DAY_GAMES);
        return h('tr', {}, h('td', {}, personLink(p.name)), rows.map(r => heatCell(r, maxAbs)), h('td', {}, best ? best.day.slice(0, 3) : '—'));
      }), 'heat-table'),
    ));
    C.columns(dayChart, days.map((d, i) => ({
      label: SHORT_DAYS[i], value: d.games, empty: !d.games,
      lines: [[d.day, 'chart-tip-head'], [d.games ? `${d.games} game${d.games > 1 ? 's' : ''} · ${d.avgPlayers.toFixed(1)} players on average` : 'No games']],
    })), { label: 'Games per day of the week' });

    box.append(section('Leaderboard', table(
      ['Player', 'Games', 'Won–Lost', 'Win %', 'Avg / game', 'Best', 'Worst', 'Net'],
      ranked.map(p => h('tr', {},
        h('td', {}, personLink(p.name)),
        h('td', {}, p.games),
        h('td', {}, `${p.wins}–${p.losses}`),
        h('td', {}, pct(p.winRate)),
        h('td', { class: sign(p.avg) }, signed(Math.round(p.avg))),
        h('td', { class: 'pos' }, signed(p.best.value)),
        h('td', { class: 'neg' }, signed(p.worst.value)),
        h('td', { class: sign(p.net) }, h('strong', {}, signed(p.net))),
      )),
    )));

    // Head-to-head picker.
    const opts = sel => g.players.map(p => h('option', { value: p.name, selected: p.name === sel }, p.name));
    const a = h('select', { 'aria-label': 'First player' }, opts(ranked[0].name));
    const b = h('select', { 'aria-label': 'Second player' }, opts(ranked[ranked.length - 1].name));
    box.append(section('Head to head', h('p', { class: 'hint' }, 'Pick two players to see their record in games they both played.'),
      h('div', { class: 'vs-pick' }, a, h('span', { class: 'muted' }, 'vs'), b,
        h('button', { class: 'btn primary', type: 'button', onclick: () => a.value !== b.value && openVs(a.value, b.value) }, 'Compare'))));
  }

  /* ---------- Player page ---------- */
  function personView(name) {
    const { games, names, rate } = data();
    const p = A.player(games, name, rate);
    const body = [];
    if (!p.games) return [h('p', { class: 'muted' }, `${name} hasn't played a game yet.`)];

    body.push(h('div', { class: 'hero' },
      h('div', { class: 'hero-label' }, p.net >= 0 ? 'Up overall' : 'Down overall'),
      h('div', { class: 'hero-value ' + sign(p.net) }, signed(p.net)),
      h('div', { class: 'hero-sub' }, `${p.games} of ${games.length} games · ${p.wins} won, ${p.losses} lost${p.evens ? `, ${p.evens} even` : ''}`)));

    const streak = p.streak.current ? `${p.streak.current.length} ${p.streak.current.type === 'win' ? 'win' : 'loss'}${p.streak.current.length > 1 ? (p.streak.current.type === 'win' ? 's' : 'es') : ''} in a row` : '—';
    body.push(h('div', { class: 'tiles' },
      tile('Win rate', pct(p.winRate), `${p.wins} of ${p.games} games`),
      tile('Average per game', signed(Math.round(p.avg)), null, sign(p.avg)),
      tile('Best game', signed(p.best.value), date(p.best.date), 'pos'),
      tile('Worst game', signed(p.worst.value), date(p.worst.date), 'neg'),
      tile('Finished top', String(p.topFinishes), `${pct(p.topFinishes / p.games)} of games`),
      tile('Current form', streak, `Longest: ${p.streak.longestWin} wins, ${p.streak.longestLoss} losses`),
      tile('Total won', signed(p.totalWon), 'in winning games', 'pos'),
      tile('Total lost', signed(p.totalLost), 'in losing games', 'neg'),
    ));

    const bars = h('div');
    const line = h('div');
    body.push(section('Result per game', bars));
    body.push(section('Running total', line));

    const days = A.playerWeekdays(games, name, rate);
    const best = A.bestDay(days, MIN_DAY_GAMES), lucky = A.luckiestDay(days, MIN_DAY_GAMES), worst = A.worstDay(days, MIN_DAY_GAMES);
    const most = [...days].sort((x, y) => y.games - x.games)[0];
    const dayChart = h('div');
    body.push(section('Days of the week',
      h('div', { class: 'tiles' },
        dayTile('Best day', best, r => `${signed(Math.round(r.avg))} a game over ${r.games} games`, best ? sign(best.avg) : ''),
        dayTile('Most likely to win on', lucky, r => `won ${r.wins} of ${r.games} (${pct(r.winRate)})`),
        dayTile('Toughest day', worst && worst.avg < 0 ? worst : null, r => `${signed(Math.round(r.avg))} a game over ${r.games} games`, 'neg'),
        tile('Plays most on', most.day, `${most.games} of ${p.games} games`),
      ),
      h('p', { class: 'hint' }, `Average won or lost per game on each day. Based on past games only — a guide, not a promise. Days with fewer than ${MIN_DAY_GAMES} games aren't used for "best" or "most likely".`),
      dayChart,
      table(['Day', 'Games', 'Won–Lost', 'Win %', 'Avg / game', 'Net'], days.filter(r => r.games).map(r => h('tr', {},
        h('td', {}, h('strong', {}, r.day)),
        h('td', {}, r.games),
        h('td', {}, `${r.wins}–${r.losses}`),
        h('td', {}, pct(r.winRate)),
        h('td', { class: sign(r.avg) }, signed(Math.round(r.avg))),
        h('td', { class: sign(r.net) }, signed(r.net)),
      )))));

    const rivals = A.rivals(games, name, names, rate);
    body.push(section(`${name} against each player`,
      h('p', { class: 'hint' }, `In games both played: how often ${name} finished ahead, and what each made. Tap a row for the full head-to-head.`),
      table(['Opponent', 'Games', `Ahead–Behind`, name, 'Them', 'Gap / game'],
        rivals.map(r => h('tr', { class: 'clickable', tabindex: 0, onclick: () => openVs(name, r.b), onkeydown: e => e.key === 'Enter' && openVs(name, r.b) },
          h('td', {}, h('strong', {}, r.b)),
          h('td', {}, r.games),
          h('td', {}, `${r.aAhead}–${r.bAhead}${r.ties ? ` (${r.ties} tied)` : ''}`),
          h('td', { class: sign(r.aNet) }, signed(r.aNet)),
          h('td', { class: sign(r.bNet) }, signed(r.bNet)),
          h('td', { class: sign(r.avgMargin) }, signed(Math.round(r.avgMargin))),
        )))));

    body.push(section('Recent games', table(['Date', 'Result', 'Place', 'Running total'],
      [...p.series].reverse().slice(0, 15).map(s => h('tr', {},
        h('td', {}, when(s.date)),
        h('td', { class: sign(s.value) }, signed(s.value)),
        h('td', {}, `${ordinal(s.place)} of ${s.players}`),
        h('td', { class: sign(s.cum) }, signed(s.cum)),
      )))));

    // Charts draw after the page is in the document (they need its width).
    return [body, () => {
      C.gameBars(bars, p.series.map(s => ({ value: s.value, date: s.date, lines: [[when(s.date), 'chart-tip-head'], [`${signed(s.value)} · ${ordinal(s.place)} of ${s.players}`]] })), { label: `${name}'s result per game` });
      C.lines(line, p.series.map(s => s.date), [{ name, values: p.series.map(s => s.cum), color: '--series-1', format: signed }], { label: `${name}'s running total` });
      C.columns(dayChart, days.map((r, i) => ({
        label: SHORT_DAYS[i], value: Math.round(r.avg), empty: !r.games,
        lines: [[r.day, 'chart-tip-head'], [r.games ? `${signed(Math.round(r.avg))} a game · won ${r.wins} of ${r.games}` : 'No games']],
      })), { label: `${name}'s average per game by day of the week`, diverging: true });
    }];
  }

  /* ---------- Head to head ---------- */
  function vsView(a, b) {
    const { games, names, rate } = data();
    const r = A.headToHead(games, a, b, rate);
    const pick = (sel, other, onchange) => h('select', { onchange }, names.filter(n => n !== other).map(n => h('option', { value: n, selected: n === sel }, n)));
    const body = [h('div', { class: 'vs-pick' },
      pick(a, b, e => openVs(e.target.value, b, true)), h('span', { class: 'muted' }, 'vs'), pick(b, a, e => openVs(a, e.target.value, true)),
      h('button', { class: 'btn', type: 'button', onclick: () => openVs(b, a, true) }, '⇄ Swap'))];
    if (!r.games) return [body.concat(h('p', { class: 'muted' }, `${a} and ${b} haven't played a game together yet.`))];

    body.push(h('div', { class: 'hero' },
      h('div', { class: 'hero-label' }, `Finished ahead, in ${r.games} games together`),
      h('div', { class: 'record' },
        h('span', {}, h('span', { class: 'swatch', style: 'background: var(--series-1)' }), a), h('strong', {}, `${r.aAhead} – ${r.bAhead}`), h('span', {}, b, h('span', { class: 'swatch', style: 'background: var(--series-2)' }))),
      h('div', { class: 'hero-sub' }, r.ties ? `${r.ties} tied` : r.aAhead === r.bAhead ? 'Dead even' : `${r.aAhead > r.bAhead ? a : b} leads`)));

    const gap = r.biggestGap;
    body.push(h('div', { class: 'tiles' },
      tile(`${a} in these games`, signed(r.aNet), `avg ${signed(Math.round(r.aNet / r.games))} a game`, sign(r.aNet)),
      tile(`${b} in these games`, signed(r.bNet), `avg ${signed(Math.round(r.bNet / r.games))} a game`, sign(r.bNet)),
      tile('Average gap', signed(Math.round(Math.abs(r.avgMargin))), r.avgMargin === 0 ? 'level' : `in ${r.avgMargin > 0 ? a : b}'s favour`),
      tile('Biggest gap', ctx.money(Math.abs(gap.a - gap.b)), `${gap.a > gap.b ? a : b} · ${date(gap.date)}`),
      tile('Both won', String(r.bothWon), `games where both finished up`),
    ));

    const line = h('div'), bars = h('div');
    body.push(section('Running totals in shared games', h('div', { class: 'legend' },
      h('span', {}, h('span', { class: 'swatch', style: 'background: var(--series-1)' }), a),
      h('span', {}, h('span', { class: 'swatch', style: 'background: var(--series-2)' }), b)), line));
    body.push(section(`Gap per game (${a} minus ${b})`, h('p', { class: 'hint' }, `Above the line: ${a} finished ahead. Below: ${b} did.`), bars));
    body.push(section('Games together', table(['Date', a, b, 'Ahead'],
      [...r.shared].reverse().map(s => h('tr', {},
        h('td', {}, when(s.date)),
        h('td', { class: sign(s.a) }, signed(s.a)),
        h('td', { class: sign(s.b) }, signed(s.b)),
        h('td', {}, s.a > s.b ? a : s.b > s.a ? b : 'Tied'),
      )))));

    return [body, () => {
      C.lines(line, r.shared.map(s => s.date), [
        { name: a, values: r.shared.map(s => s.aCum), color: '--series-1', format: signed },
        { name: b, values: r.shared.map(s => s.bCum), color: '--series-2', format: signed },
      ], { label: `${a} and ${b} running totals in shared games` });
      C.gameBars(bars, r.shared.map(s => ({ value: s.a - s.b, date: s.date, lines: [[when(s.date), 'chart-tip-head'], [`${a} ${signed(s.a)} · ${b} ${signed(s.b)}`]] })), { label: `Gap per game, ${a} minus ${b}` });
    }];
  }

  /* ---------- Page routing ---------- */
  let openedHere = false;
  function openPerson(name) { openedHere = true; location.hash = 'p=' + encodeURIComponent(name); }
  function openVs(a, b, replace) {
    const hash = '#vs=' + encodeURIComponent(a) + '~' + encodeURIComponent(b);
    if (replace) { history.replaceState(null, '', hash); route(); } else { openedHere = true; location.hash = hash; }
  }
  function close() {
    if (openedHere) { openedHere = false; history.back(); }
    else { history.replaceState(null, '', location.pathname + location.search); route(); }
  }

  function route() {
    const panel = $('#detail');
    const m = /^#(p|vs)=(.+)$/.exec(location.hash);
    if (!m || !ctx) { panel.hidden = true; document.body.classList.remove('detail-open'); return; }
    const [title, [content, after]] = m[1] === 'p'
      ? [decodeURIComponent(m[2]), personView(decodeURIComponent(m[2]))]
      : (() => { const [a, b] = m[2].split('~').map(decodeURIComponent); return [`${a} vs ${b}`, vsView(a, b)]; })();
    const wasHidden = panel.hidden;
    panel.hidden = false;
    document.body.classList.add('detail-open');
    $('#detail-title').textContent = title;
    const body = $('#detail-body');
    body.replaceChildren(...[content].flat(Infinity));
    if (after) after();
    if (wasHidden) { body.scrollTop = 0; $('#detail-back').focus(); }
  }

  window.Stats = {
    init(c) {
      ctx = c;
      window.addEventListener('hashchange', route);
      $('#detail-back').addEventListener('click', close);
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#detail').hidden) close(); });
    },
    /** Call after the ledger changes. */
    render() { renderGroup(); route(); },
    openPerson,
  };
})();
