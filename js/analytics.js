/* Analytics over the ledger: group stats, per-player stats, head-to-head.
 * Pure functions on {date, scores} games. Works in the browser (window.Analytics)
 * and in Node (module.exports) for tests.
 *
 * A game is "won" by everyone who finished with positive points; in a
 * head-to-head, a player "finished ahead" when they scored more than the other
 * in a game they both played. Money is points × that game's rate (or the
 * ledger's usual rate for games that don't have their own). */
(function (root) {
  'use strict';

  const byDate = games => [...games].sort((a, b) => a.date.localeCompare(b.date));
  // Each game can have its own rupees per point; otherwise the ledger's usual rate.
  const rateOf = (g, rate) => (g.rate > 0 ? g.rate : rate);

  function streaks(results) {
    // results: points per game, oldest first.
    let longestWin = 0, longestLoss = 0, run = 0, runSign = 0;
    for (const v of results) {
      const s = Math.sign(v);
      if (s !== 0 && s === runSign) run++;
      else { run = s === 0 ? 0 : 1; runSign = s; }
      if (runSign > 0) longestWin = Math.max(longestWin, run);
      if (runSign < 0) longestLoss = Math.max(longestLoss, run);
    }
    return { current: runSign === 0 ? null : { type: runSign > 0 ? 'win' : 'loss', length: run }, longestWin, longestLoss };
  }

  /** Stats for one player. Points are converted to money with `rate`. */
  function player(games, name, rate) {
    const played = byDate(games).filter(g => name in g.scores);
    let cum = 0;
    const series = played.map(g => {
      const v = g.scores[name] * rateOf(g, rate);
      cum += v;
      const others = Object.keys(g.scores).length;
      const place = 1 + Object.values(g.scores).filter(x => x > g.scores[name]).length;
      return { id: g.id, date: g.date, value: v, cum, place, players: others };
    });
    const values = series.map(s => s.value);
    const wins = values.filter(v => v > 0).length;
    const losses = values.filter(v => v < 0).length;
    const best = series.reduce((b, s) => (!b || s.value > b.value ? s : b), null);
    const worst = series.reduce((b, s) => (!b || s.value < b.value ? s : b), null);
    const topFinishes = series.filter(s => s.place === 1).length;
    return {
      name,
      games: played.length,
      share: games.length ? played.length / games.length : 0,
      wins, losses, evens: played.length - wins - losses,
      winRate: played.length ? wins / played.length : 0,
      net: cum,
      avg: played.length ? cum / played.length : 0,
      totalWon: values.filter(v => v > 0).reduce((a, b) => a + b, 0),
      totalLost: values.filter(v => v < 0).reduce((a, b) => a + b, 0),
      best, worst, topFinishes,
      streak: streaks(values),
      series,
    };
  }

  /** Everything about the group. `names` fixes the player order. */
  function group(games, names, rate) {
    const sorted = byDate(games);
    const all = [...names];
    for (const g of sorted) for (const p of Object.keys(g.scores)) if (!all.includes(p)) all.push(p);
    const players = all.map(n => player(sorted, n, rate)).filter(p => p.games > 0);

    let biggestWin = null, biggestLoss = null, moneyMoved = 0;
    for (const g of sorted) {
      for (const [p, pts] of Object.entries(g.scores)) {
        const v = pts * rateOf(g, rate);
        if (v > 0) moneyMoved += v;
        if (!biggestWin || v > biggestWin.value) biggestWin = { name: p, value: v, date: g.date };
        if (!biggestLoss || v < biggestLoss.value) biggestLoss = { name: p, value: v, date: g.date };
      }
    }
    const sizes = sorted.map(g => Object.keys(g.scores).length);
    return {
      games: sorted.length,
      moneyMoved,
      avgPlayers: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
      firstDate: sorted.length ? sorted[0].date : null,
      lastDate: sorted.length ? sorted[sorted.length - 1].date : null,
      biggestWin, biggestLoss,
      players,
      // Running money per player after each game, for the timeline chart.
      timeline: sorted.map((g, i) => ({ date: g.date, index: i + 1 })),
      cumulative: Object.fromEntries(players.map(p => {
        let c = 0;
        return [p.name, sorted.map(g => (c += (g.scores[p.name] || 0) * rateOf(g, rate)))];
      })),
    };
  }

  /** a vs b over the games they both played. */
  function headToHead(games, a, b, rate) {
    const shared = byDate(games).filter(g => a in g.scores && b in g.scores).map(g => ({
      id: g.id, date: g.date, a: g.scores[a] * rateOf(g, rate), b: g.scores[b] * rateOf(g, rate),
    }));
    let aCum = 0, bCum = 0;
    for (const s of shared) { aCum += s.a; bCum += s.b; s.aCum = aCum; s.bCum = bCum; }
    const aAhead = shared.filter(s => s.a > s.b).length;
    const bAhead = shared.filter(s => s.b > s.a).length;
    const biggestGap = shared.reduce((m, s) => (!m || Math.abs(s.a - s.b) > Math.abs(m.a - m.b) ? s : m), null);
    return {
      a, b,
      games: shared.length,
      aAhead, bAhead, ties: shared.length - aAhead - bAhead,
      aNet: aCum, bNet: bCum,
      avgMargin: shared.length ? (aCum - bCum) / shared.length : 0,
      bothWon: shared.filter(s => s.a > 0 && s.b > 0).length,
      biggestGap,
      shared,
    };
  }

  /** Head-to-head of one player against everyone they've played with. */
  function rivals(games, name, names, rate) {
    return names.filter(n => n !== name)
      .map(n => headToHead(games, name, n, rate))
      .filter(h => h.games > 0)
      .sort((x, y) => y.games - x.games || x.b.localeCompare(y.b));
  }

  /* ---------- Days of the week ---------- */
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** 0 = Sunday … 6 = Saturday, from "YYYY-MM-DD HH:MM" (the game's own local date). */
  function weekday(date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay() : -1;
  }

  /** One player's results split by weekday (always 7 rows, Sunday first). */
  function playerWeekdays(games, name, rate) {
    const rows = DAYS.map((day, i) => ({ day, index: i, games: 0, wins: 0, losses: 0, net: 0 }));
    for (const g of games) {
      if (!(name in g.scores)) continue;
      const d = weekday(g.date);
      if (d < 0) continue;
      const v = g.scores[name] * rateOf(g, rate);
      const r = rows[d];
      r.games++; r.net += v;
      if (v > 0) r.wins++; else if (v < 0) r.losses++;
    }
    for (const r of rows) { r.avg = r.games ? r.net / r.games : 0; r.winRate = r.games ? r.wins / r.games : 0; }
    return rows;
  }

  /**
   * The weekday a player did best on, by average money per game (ties: win
   * rate, then more games). Days with fewer than `minGames` games are skipped
   * so one lucky night doesn't count as a pattern.
   */
  function bestDay(rows, minGames = 2) {
    const ok = rows.filter(r => r.games >= minGames);
    return ok.sort((a, b) => b.avg - a.avg || b.winRate - a.winRate || b.games - a.games)[0] || null;
  }
  function luckiestDay(rows, minGames = 2) {
    const ok = rows.filter(r => r.games >= minGames);
    return ok.sort((a, b) => b.winRate - a.winRate || b.avg - a.avg || b.games - a.games)[0] || null;
  }
  function worstDay(rows, minGames = 2) {
    const ok = rows.filter(r => r.games >= minGames);
    return ok.sort((a, b) => a.avg - b.avg || a.winRate - b.winRate)[0] || null;
  }

  /** Games and money per weekday for the whole group. */
  function groupWeekdays(games, rate) {
    const rows = DAYS.map((day, i) => ({ day, index: i, games: 0, players: 0, moneyMoved: 0 }));
    for (const g of games) {
      const d = weekday(g.date);
      if (d < 0) continue;
      rows[d].games++;
      rows[d].players += Object.keys(g.scores).length;
      rows[d].moneyMoved += Object.values(g.scores).filter(v => v > 0).reduce((a, b) => a + b, 0) * rateOf(g, rate);
    }
    for (const r of rows) r.avgPlayers = r.games ? r.players / r.games : 0;
    return rows;
  }

  const api = { player, group, headToHead, rivals, streaks, DAYS, weekday, playerWeekdays, groupWeekdays, bestDay, luckiestDay, worstDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analytics = api;
})(typeof window !== 'undefined' ? window : globalThis);
