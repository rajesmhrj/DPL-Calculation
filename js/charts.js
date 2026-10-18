/* Small SVG charts for the stats views: per-game bars, running-total lines,
 * and a standings bar list. No library; colors come from CSS variables so
 * light/dark mode just works. Every chart has a table elsewhere on the page
 * with the same numbers. */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceTicks(min, max, count = 4) {
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
    return ticks;
  }

  const short = v => {
    const a = Math.abs(v);
    const s = a >= 100000 ? (a / 100000).toFixed(a >= 1000000 ? 0 : 1) + 'L' : a >= 1000 ? (a / 1000).toFixed(a >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(a);
    return (v < 0 ? '−' : '') + s;
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : d; };

  // Charts redraw at their container's width when the window resizes.
  const live = new Set();
  let resizeTimer;
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { for (const c of live) if (c.box.isConnected) c.draw(); else live.delete(c); }, 120);
    });
  }

  function frame(box, height, draw) {
    box.classList.add('chart');
    const c = { box, draw: () => { box.replaceChildren(); draw(box.clientWidth || 320, height); } };
    live.add(c);
    c.draw();
  }

  function tooltip(box) {
    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    box.appendChild(tip);
    return {
      show(x, y, lines) {
        tip.replaceChildren(...lines.map(([text, cls]) => { const d = document.createElement('div'); d.textContent = text; if (cls) d.className = cls; return d; }));
        tip.hidden = false;
        const w = tip.offsetWidth, bw = box.clientWidth;
        tip.style.left = Math.max(0, Math.min(bw - w, x - w / 2)) + 'px';
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
      },
      hide() { tip.hidden = true; },
    };
  }

  function yAxis(svg, ticks, y, left, right) {
    for (const t of ticks) {
      el('line', { x1: left, x2: right, y1: y(t), y2: y(t), stroke: t === 0 ? css('--chart-axis') : css('--chart-grid'), 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
      const label = el('text', { x: left - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'chart-label' }, svg);
      label.textContent = short(t);
    }
  }

  // A bar whose 4px rounded end points away from the zero line.
  function barPath(x, w, y0, y1) {
    const r = Math.min(4, w / 2, Math.abs(y1 - y0));
    if (y1 < y0) return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
    return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
  }

  /** Vertical bars, one per game (oldest first). items: [{value, date, lines: [[text, cls]]}] */
  function gameBars(box, items, { height = 200, label = '' } = {}) {
    frame(box, height, (width, h) => {
      const pad = { l: 44, r: 8, t: 10, b: 24 };
      const svg = el('svg', { width, height: h, role: 'img', 'aria-label': label }, box);
      const vals = items.map(i => i.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
      const lo = ticks[0], hi = ticks[ticks.length - 1];
      const y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
      yAxis(svg, ticks, y, pad.l, width - pad.r);
      const slot = (width - pad.l - pad.r) / Math.max(items.length, 1);
      const bw = Math.max(2, Math.min(28, slot - 2));
      const tip = tooltip(box);
      items.forEach((it, i) => {
        const x = pad.l + i * slot + (slot - bw) / 2;
        if (it.value !== 0) {
          el('path', { d: barPath(x, bw, y(0), y(it.value)), fill: it.value > 0 ? css('--chart-pos') : css('--chart-neg') }, svg);
        }
        // Full-height hit area, wider than the bar.
        const hit = el('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: h - pad.t - pad.b, fill: 'transparent', tabindex: 0, 'aria-label': it.lines.map(l => l[0]).join(', ') }, svg);
        const show = () => tip.show(x + bw / 2, Math.min(y(it.value), y(0)), it.lines);
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', tip.hide);
        hit.addEventListener('blur', tip.hide);
      });
      // A few date labels along the bottom.
      const marks = items.length <= 1 ? [0] : [0, Math.floor((items.length - 1) / 2), items.length - 1];
      for (const i of [...new Set(marks)]) {
        const t = el('text', { x: pad.l + i * slot + slot / 2, y: h - 6, 'text-anchor': i === 0 ? 'start' : i === items.length - 1 ? 'end' : 'middle', class: 'chart-label' }, svg);
        if (i === 0) t.setAttribute('x', pad.l);
        if (i === items.length - 1 && items.length > 1) t.setAttribute('x', width - pad.r);
        t.textContent = shortDate(items[i].date);
      }
    });
  }

  /**
   * Running totals. series: [{name, values, color}] where color is a CSS
   * variable name for highlighted lines or null for gray context lines.
   * dates: label per point.
   */
  function lines(box, dates, series, { height = 240, label = '' } = {}) {
    frame(box, height, (width, h) => {
      const pad = { l: 44, r: 72, t: 12, b: 24 };
      const svg = el('svg', { width, height: h, role: 'img', 'aria-label': label }, box);
      const all = series.flatMap(s => s.values);
      const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
      const lo = ticks[0], hi = ticks[ticks.length - 1];
      const n = dates.length;
      const x = i => pad.l + (n <= 1 ? 0 : i / (n - 1)) * (width - pad.l - pad.r);
      const y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
      yAxis(svg, ticks, y, pad.l, width - pad.r);

      const ordered = [...series.filter(s => !s.color), ...series.filter(s => s.color)]; // highlights on top
      for (const s of ordered) {
        const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
        el('path', { d, fill: 'none', stroke: s.color ? css(s.color) : css('--chart-context'), 'stroke-width': s.color ? 2 : 1, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      }
      // Direct labels at the end of highlighted lines, nudged apart.
      const ends = series.filter(s => s.color).map(s => ({ s, y: y(s.values[s.values.length - 1]) })).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
      for (const e of ends) {
        el('circle', { cx: x(n - 1), cy: y(e.s.values[n - 1]), r: 4, fill: css(e.s.color), stroke: css('--surface'), 'stroke-width': 2 }, svg);
        const t = el('text', { x: x(n - 1) + 8, y: e.y + 4, class: 'chart-label chart-label-strong' }, svg);
        t.textContent = e.s.name.length > 9 ? e.s.name.slice(0, 8) + '…' : e.s.name;
      }
      // Date labels.
      for (const i of [...new Set([0, n - 1])]) {
        const t = el('text', { x: x(i), y: h - 6, 'text-anchor': i === 0 ? 'start' : 'end', class: 'chart-label' }, svg);
        t.textContent = shortDate(dates[i]);
      }

      // Crosshair + tooltip for the nearest game.
      const cross = el('line', { y1: pad.t, y2: h - pad.b, stroke: css('--chart-axis'), 'stroke-width': 1, visibility: 'hidden' }, svg);
      const dots = series.filter(s => s.color).map(s => el('circle', { r: 4, fill: css(s.color), stroke: css('--surface'), 'stroke-width': 2, visibility: 'hidden' }, svg));
      const tip = tooltip(box);
      const hit = el('rect', { x: pad.l, y: 0, width: Math.max(1, width - pad.l - pad.r), height: h, fill: 'transparent' }, svg);
      const at = evt => {
        const r = svg.getBoundingClientRect();
        const i = Math.max(0, Math.min(n - 1, Math.round((evt.clientX - r.left - pad.l) / Math.max(1, width - pad.l - pad.r) * (n - 1))));
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        const hl = series.filter(s => s.color);
        hl.forEach((s, k) => { dots[k].setAttribute('cx', x(i)); dots[k].setAttribute('cy', y(s.values[i])); dots[k].setAttribute('visibility', 'visible'); });
        const rows = [...hl].sort((a, b) => b.values[i] - a.values[i]).map(s => [`${s.name}: ${s.format(s.values[i])}`]);
        tip.show(x(i), pad.t + 10, [[`After game ${i + 1} · ${shortDate(dates[i])}`, 'chart-tip-head'], ...rows]);
      };
      hit.addEventListener('pointermove', at);
      hit.addEventListener('pointerdown', at);
      hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tip.hide(); });
    });
  }

  /** Horizontal bars around zero, one row per player. rows: [{label, value, text, onClick}] */
  function standings(box, rows, { label = '' } = {}) {
    const rowH = 30;
    frame(box, rows.length * rowH + 8, (width, h) => {
      const nameW = Math.min(96, Math.max(64, width * 0.24)), valW = 72;
      const svg = el('svg', { width, height: h, role: 'img', 'aria-label': label }, box);
      const left = nameW + valW, right = width - valW;
      // Zero sits where the biggest loss and biggest win both just fit.
      const posMax = Math.max(0, ...rows.map(r => r.value)), negMax = Math.max(0, ...rows.map(r => -r.value));
      const span = posMax + negMax || 1;
      const z = left + (right - left) * (negMax / span);
      const sx = v => z + v / span * (right - left);
      el('line', { x1: z, x2: z, y1: 0, y2: h, stroke: css('--chart-axis'), 'stroke-width': 1, 'shape-rendering': 'crispEdges' }, svg);
      rows.forEach((r, i) => {
        const cy = i * rowH + rowH / 2 + 4;
        const g = el('g', { class: r.onClick ? 'chart-row' : '', tabindex: r.onClick ? 0 : -1, role: r.onClick ? 'button' : 'presentation', 'aria-label': `${r.label} ${r.text}` }, svg);
        el('rect', { x: 0, y: i * rowH + 4, width, height: rowH, fill: 'transparent' }, g);
        const name = el('text', { x: 0, y: cy + 4, class: 'chart-name' }, g);
        name.textContent = r.label;
        if (r.value !== 0) {
          const x0 = z, x1 = sx(r.value);
          const bh = 14, top = cy - bh / 2;
          const w = Math.abs(x1 - x0), rr = Math.min(4, w / 2);
          const d = r.value > 0
            ? `M${x0},${top}H${x1 - rr}Q${x1},${top} ${x1},${top + rr}V${top + bh - rr}Q${x1},${top + bh} ${x1 - rr},${top + bh}H${x0}Z`
            : `M${x0},${top}H${x1 + rr}Q${x1},${top} ${x1},${top + rr}V${top + bh - rr}Q${x1},${top + bh} ${x1 + rr},${top + bh}H${x0}Z`;
          el('path', { d, fill: r.value > 0 ? css('--chart-pos') : css('--chart-neg') }, g);
        }
        const val = el('text', { x: r.value >= 0 ? sx(r.value) + 6 : sx(r.value) - 6, y: cy + 4, 'text-anchor': r.value >= 0 ? 'start' : 'end', class: 'chart-label chart-num' }, g);
        val.textContent = short(r.value);
        if (r.onClick) {
          g.addEventListener('click', r.onClick);
          g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onClick(); } });
        }
      });
    });
  }

  /**
   * One column per category (e.g. weekday). items: [{label, value, lines, empty}]
   * diverging: blue above zero, red below; otherwise every bar is series 1.
   */
  function columns(box, items, { height = 180, label = '', diverging = false } = {}) {
    frame(box, height, (width, h) => {
      const pad = { l: 44, r: 8, t: 10, b: 26 };
      const svg = el('svg', { width, height: h, role: 'img', 'aria-label': label }, box);
      const vals = items.map(i => i.value);
      const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 3);
      const lo = ticks[0], hi = ticks[ticks.length - 1];
      const y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
      yAxis(svg, ticks, y, pad.l, width - pad.r);
      const slot = (width - pad.l - pad.r) / items.length;
      const bw = Math.max(4, Math.min(36, slot * 0.6));
      const tip = tooltip(box);
      items.forEach((it, i) => {
        const cx = pad.l + i * slot + slot / 2;
        if (it.value !== 0) {
          const fill = diverging ? (it.value > 0 ? css('--chart-pos') : css('--chart-neg')) : css('--series-1');
          el('path', { d: barPath(cx - bw / 2, bw, y(0), y(it.value)), fill }, svg);
        }
        const t = el('text', { x: cx, y: h - 8, 'text-anchor': 'middle', class: 'chart-label' + (it.empty ? '' : ' chart-label-strong') }, svg);
        t.textContent = it.label;
        const hit = el('rect', { x: pad.l + i * slot, y: pad.t, width: slot, height: h - pad.t, fill: 'transparent', tabindex: 0, 'aria-label': it.lines.map(l => l[0]).join(', ') }, svg);
        const show = () => tip.show(cx, Math.min(y(it.value), y(0)), it.lines);
        hit.addEventListener('pointerenter', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('pointerleave', tip.hide);
        hit.addEventListener('blur', tip.hide);
      });
    });
  }

  const api = { gameBars, lines, standings, columns, shortDate, short };
  root.Charts = api;
})(window);
