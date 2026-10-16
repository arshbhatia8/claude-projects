// Small SVG charts drawn at the container's real width (so text stays legible on a phone),
// with hover/tap tooltips and a table view for every chart.
import { h, clear } from './dom.js';
import { escapeHtml as e, fmtDay } from '../core/util.js';

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((entries) => {
  for (const en of entries) { const fn = en.target.__draw; if (fn && Math.abs((en.target.__w || 0) - en.contentRect.width) > 4) fn(); }
}) : null;

function mount(el, draw) {
  const run = () => { const w = Math.max(240, Math.floor(el.clientWidth || 600)); el.__w = w; draw(w); };
  el.__draw = run;
  requestAnimationFrame(run);
  if (ro) ro.observe(el);
}
function tipLayer(el) {
  const tip = h('div.chart-tip', { hidden: true, role: 'status' });
  el.append(tip);
  return {
    show(x, y, html) { tip.innerHTML = html; tip.hidden = false; const w = el.clientWidth; tip.style.left = Math.min(Math.max(x, 70), w - 70) + 'px'; tip.style.top = y + 'px'; },
    hide() { tip.hidden = true; },
  };
}
function niceMax(v) {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const ticks = (max) => { const step = max <= 4 ? 1 : max / 4; const t = []; for (let v = 0; v <= max + 1e-9; v += step) t.push(Math.round(v)); return [...new Set(t)]; };
const keyLabel = (k, unit) => (unit === 'month' ? fmtDay(k).replace(/^\d+ /, '') : fmtDay(k));
const compact = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K' : String(n));

export function emptyChart(text) { return h('div.chart-empty', text); }

function tableView(headers, rows) {
  return h('details.tableview', h('summary', 'Show as table'),
    h('table', h('thead', h('tr', headers.map((x) => h('th', x)))), h('tbody', rows.map((r) => h('tr', r.map((c) => h('td', String(c))))))));
}

/** Columns over time: points [{key, value}] */
export function columnChart(points, { unit = 'week', color = 'var(--s1)', height = 200, label = 'Count', emptyText = 'No data in this period yet.' } = {}) {
  const wrap = h('div');
  if (!points.length || points.every((p) => !p.value)) { wrap.append(emptyChart(emptyText)); return wrap; }
  const el = h('div.chart');
  wrap.append(el, tableView([unit === 'week' ? 'Week of' : 'Month', label], points.map((p) => [keyLabel(p.key, unit), p.value])));
  mount(el, (W) => {
    clear(el);
    const tip = tipLayer(el);
    const padL = 30, padR = 8, padT = 18, padB = 26, H = height;
    const max = niceMax(Math.max(...points.map((p) => p.value)));
    const iw = W - padL - padR, ih = H - padT - padB;
    const band = iw / points.length;
    const bw = Math.min(24, Math.max(4, band * 0.62));
    const y = (v) => padT + ih - (v / max) * ih;
    const every = Math.ceil(points.length / Math.max(2, Math.floor(iw / 64)));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${e(label)} by ${unit}">`;
    s += '<g class="grid">' + ticks(max).map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('') + '</g>';
    const maxV = Math.max(...points.map((p) => p.value));
    points.forEach((p, i) => {
      const cx = padL + band * i + band / 2;
      const top = y(p.value), hgt = padT + ih - top;
      if (p.value > 0) {
        const r = Math.min(4, bw / 2, hgt);
        s += `<path d="M${cx - bw / 2},${padT + ih} V${top + r} q0,-${r} ${r},-${r} H${cx + bw / 2 - r} q${r},0 ${r},${r} V${padT + ih} Z" fill="${color}"/>`;
      }
      if (p.value === maxV && p.value > 0) s += `<text class="val" x="${cx}" y="${top - 5}" text-anchor="middle">${p.value}</text>`;
      if (i % every === 0) s += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${e(keyLabel(p.key, unit))}</text>`;
      s += `<rect class="hit" data-i="${i}" x="${padL + band * i}" y="${padT}" width="${band}" height="${ih}" fill="transparent"/>`;
    });
    s += '</svg>';
    el.insertAdjacentHTML('afterbegin', s);
    el.querySelector('svg').addEventListener('pointermove', (ev) => {
      const i = ev.target.dataset && ev.target.dataset.i;
      if (i == null) return tip.hide();
      const p = points[+i];
      tip.show(padL + band * +i + band / 2, y(p.value), `${e(unit === 'week' ? 'Week of ' + keyLabel(p.key, unit) : keyLabel(p.key, unit))} · <b>${p.value}</b>`);
    });
    el.querySelector('svg').addEventListener('pointerleave', () => tip.hide());
  });
  return wrap;
}

/** Several series over the same buckets: series [{name, color, points:[{key,value}]}] */
export function lineChart(series, { unit = 'week', height = 220, emptyText = 'No activity in this period yet.' } = {}) {
  const wrap = h('div');
  const keys = series[0] ? series[0].points.map((p) => p.key) : [];
  if (!keys.length || series.every((s) => s.points.every((p) => !p.value))) { wrap.append(emptyChart(emptyText)); return wrap; }
  const legend = h('div.chart-legend', series.map((s) => h('span', h('i', { style: { background: s.color } }), s.name)));
  const el = h('div.chart');
  wrap.append(legend, el, tableView([unit === 'week' ? 'Week of' : 'Month', ...series.map((s) => s.name)], keys.map((k, i) => [keyLabel(k, unit), ...series.map((s) => s.points[i].value)])));
  mount(el, (W) => {
    clear(el);
    const tip = tipLayer(el);
    const padL = 30, padR = 12, padT = 12, padB = 26, H = height;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.value))));
    const iw = W - padL - padR, ih = H - padT - padB;
    const x = (i) => padL + (keys.length === 1 ? iw / 2 : (i / (keys.length - 1)) * iw);
    const y = (v) => padT + ih - (v / max) * ih;
    const every = Math.ceil(keys.length / Math.max(2, Math.floor(iw / 64)));
    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly activity">`;
    s += '<g class="grid">' + ticks(max).map((t) => `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${compact(t)}</text>`).join('') + '</g>';
    keys.forEach((k, i) => { if (i % every === 0) s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${e(keyLabel(k, unit))}</text>`; });
    for (const se of series) {
      const d = se.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
      s += `<path d="${d} L${x(keys.length - 1)},${padT + ih} L${x(0)},${padT + ih} Z" fill="${se.color}" opacity="0.08"/>`;
      s += `<path d="${d}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      const last = se.points.length - 1;
      s += `<circle cx="${x(last)}" cy="${y(se.points[last].value)}" r="4" fill="${se.color}" stroke="var(--card)" stroke-width="2"/>`;
    }
    s += `<line class="xh" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="var(--line-2)" stroke-width="1" visibility="hidden"/>`;
    s += `<rect class="hit" x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent"/>`;
    s += '</svg>';
    el.insertAdjacentHTML('afterbegin', s);
    const svg = el.querySelector('svg'), xh = svg.querySelector('.xh');
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const i = Math.max(0, Math.min(keys.length - 1, Math.round(((px - padL) / iw) * (keys.length - 1))));
      xh.setAttribute('x1', x(i)); xh.setAttribute('x2', x(i)); xh.setAttribute('visibility', 'visible');
      tip.show(x(i), padT + 10, `${e(keyLabel(keys[i], unit))}<br>` + series.map((se) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${se.color};margin-right:5px"></span>${e(se.name)} <b>${se.points[i].value}</b>`).join('<br>'));
    });
    svg.addEventListener('pointerleave', () => { tip.hide(); xh.setAttribute('visibility', 'hidden'); });
  });
  return wrap;
}

/** Horizontal bars for categories: items [{label, value}] */
export function barList(items, { color = 'var(--s1)', limit = 10, emptyText = 'Nothing to show yet.', label = 'Count', onPick } = {}) {
  const wrap = h('div');
  const list = items.filter((x) => x.value > 0);
  if (!list.length) { wrap.append(emptyChart(emptyText)); return wrap; }
  let shown = list.slice(0, limit);
  if (list.length > limit) shown = [...shown, { label: `${list.length - limit} more`, value: list.slice(limit).reduce((n, x) => n + x.value, 0), other: true }];
  const max = Math.max(...shown.map((x) => x.value));
  const total = list.reduce((n, x) => n + x.value, 0);
  const el = h('div.stack.tight', { role: 'list' });
  for (const it of shown) {
    const pct = Math.round((it.value / total) * 100);
    const row = h(onPick && !it.other ? 'button' : 'div', {
      role: 'listitem', type: onPick && !it.other ? 'button' : null, class: 'bar-row', title: `${it.label}: ${it.value} (${pct}%)`,
      style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', background: 'none', border: 0, padding: '4px 0', textAlign: 'left', cursor: onPick && !it.other ? 'pointer' : 'default', width: '100%' },
      onclick: onPick && !it.other ? () => onPick(it.label) : null,
    },
    h('span', { style: { fontSize: '13.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--fg-2)' } }, it.label),
    h('span.mono', { style: { fontSize: '13px' } }, String(it.value), h('span.faint', ` · ${pct}%`)),
    h('span', { style: { gridColumn: '1 / -1', height: '8px', borderRadius: '0 4px 4px 0', background: 'var(--card-2)', display: 'block', overflow: 'hidden' } },
      h('i', { style: { display: 'block', height: '100%', width: `${Math.max(2, (it.value / max) * 100)}%`, background: it.other ? 'var(--fg-3)' : color, borderRadius: '0 4px 4px 0' } })));
    el.append(row);
  }
  wrap.append(el, tableView(['Category', label, 'Share'], list.map((x) => [x.label, x.value, Math.round((x.value / total) * 100) + '%'])));
  return wrap;
}

/** Conversion funnel: steps [{label, value}] */
export function funnel(steps, { emptyText = 'Add applications to see your funnel.' } = {}) {
  const wrap = h('div');
  if (!steps.length || !steps[0].value) { wrap.append(emptyChart(emptyText)); return wrap; }
  const top = steps[0].value;
  const el = h('div.stack.tight');
  steps.forEach((s, i) => {
    const prev = i ? steps[i - 1].value : null;
    const conv = prev ? Math.round((s.value / prev) * 100) : null;
    el.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(84px, 120px) minmax(0, 1fr) auto', gap: '10px', alignItems: 'center' } },
      h('span', { style: { fontSize: '13.5px', color: 'var(--fg-2)' } }, s.label),
      h('span', { style: { height: '22px', background: 'var(--card-2)', borderRadius: '0 5px 5px 0', overflow: 'hidden', display: 'block' } },
        h('i', { style: { display: 'block', height: '100%', width: `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%`, background: 'var(--s1)', opacity: String(1 - i * 0.09), borderRadius: '0 5px 5px 0' } })),
      h('span.mono', { style: { fontSize: '13px', minWidth: '84px', textAlign: 'right' } }, String(s.value), conv != null ? h('span.faint', ` · ${prev ? conv + '%' : '—'}`) : null)));
  });
  wrap.append(el, h('p.faint.small', { style: { margin: '8px 0 0' } }, 'Percent = share of the step above.'),
    tableView(['Step', 'Count', 'From previous step'], steps.map((s, i) => [s.label, s.value, i && steps[i - 1].value ? Math.round((s.value / steps[i - 1].value) * 100) + '%' : '—'])));
  return wrap;
}
