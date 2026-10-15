// Lightweight SVG charts drawn from saved data. In privacy mode they keep
// shapes, trends and percentages but drop every rupee figure from axis
// labels and tooltips.
import { formatINR } from '../core/money.js';
import { esc, isRevealed } from './dom.js';

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
export const colorAt = (i) => PALETTE[i % PALETTE.length];

const fmtAxis = (paise) => formatINR(paise, { compact: true });

function niceMax(v) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function size(el, ratio = 0.42, min = 170, max = 280) {
  const w = Math.max(280, Math.floor(el.clientWidth || 600));
  const h = Math.max(min, Math.min(max, Math.round(w * ratio)));
  return { w, h };
}

/** Grouped bar chart. series: [{ label, color, values: [paise…] }] */
export function barChart(el, { labels, series, highlight = -1, percent = false }) {
  const hidden = !isRevealed() && !percent;
  const { w, h } = size(el);
  const padL = hidden ? 10 : 52;
  const padB = 24;
  const padT = 10;
  const innerW = w - padL - 4;
  const innerH = h - padB - padT;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const groupW = innerW / labels.length;
  const n = series.length;
  const barW = Math.max(3, Math.min(14, (groupW - 8) / n - 2));
  const y = (v) => padT + innerH - (Math.max(0, v) / max) * innerH;
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    const yy = y(v);
    svg += `<line class="gridline" x1="${padL}" x2="${w - 4}" y1="${yy}" y2="${yy}"/>`;
    if (!hidden) svg += `<text class="axis" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${esc(percent ? `${Math.round(v)}%` : fmtAxis(v))}</text>`;
  }
  labels.forEach((label, i) => {
    const gx = padL + i * groupW + (groupW - (barW + 2) * n) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] || 0;
      if (v <= 0) return;
      const top = y(v);
      const tip = hidden ? `${label} · ${s.label}` : `${label} · ${s.label}: ${percent ? `${v.toFixed(0)}%` : formatINR(v)}`;
      svg += `<rect x="${gx + j * (barW + 2)}" y="${top}" width="${barW}" height="${padT + innerH - top}" rx="${Math.min(4, barW / 2)}" style="fill:${s.color}"><title>${esc(tip)}</title></rect>`;
    });
    const showLabel = labels.length <= 12 || i % 2 === 0;
    if (showLabel) svg += `<text class="axis${i === highlight ? ' strong' : ''}" x="${padL + i * groupW + groupW / 2}" y="${h - 6}" text-anchor="middle">${esc(label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.label).join(' and '))} by month">${svg}</svg>`;
}

/** Line chart that handles negatives and gaps (null). */
export function lineChart(el, { labels, series, percent = false, highlight = -1 }) {
  const hidden = !isRevealed() && !percent;
  const { w, h } = size(el, 0.36, 160, 240);
  const padL = hidden ? 10 : 52;
  const padB = 24;
  const padT = 12;
  const innerW = w - padL - 10;
  const innerH = h - padB - padT;
  const all = series.flatMap((s) => s.values).filter((v) => v !== null && v !== undefined);
  if (!all.length) {
    el.innerHTML = '';
    return;
  }
  let hi = Math.max(0, ...all);
  let lo = Math.min(0, ...all);
  if (hi === lo) hi = lo + 1;
  const span = niceMax(hi - lo);
  hi = lo < 0 ? Math.max(hi, lo + span) : span;
  const x = (i) => padL + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v) => padT + ((hi - v) / (hi - lo)) * innerH;
  let svg = '';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    svg += `<line class="gridline" x1="${padL}" x2="${w - 6}" y1="${y(v)}" y2="${y(v)}"/>`;
    if (!hidden) svg += `<text class="axis" x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(percent ? `${Math.round(v)}%` : fmtAxis(v))}</text>`;
  }
  if (lo < 0) svg += `<line class="zero" x1="${padL}" x2="${w - 6}" y1="${y(0)}" y2="${y(0)}"/>`;
  for (const s of series) {
    let d = '';
    let area = '';
    let started = false;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) { started = false; return; }
      d += `${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      started = true;
    });
    const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)])).filter(Boolean);
    if (s.area && pts.length > 1) {
      const base = y(Math.max(lo, 0));
      area = `<path d="M${pts[0][0]},${base} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0]},${base} Z" style="fill:${s.color};opacity:.12"/>`;
    }
    svg += `${area}<path d="${d}" style="fill:none;stroke:${s.color};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round"/>`;
    s.values.forEach((v, i) => {
      if (v === null || v === undefined) return;
      const tip = hidden ? `${labels[i]} · ${s.label}` : `${labels[i]} · ${s.label}: ${percent ? `${v.toFixed(1)}%` : formatINR(v)}`;
      const big = i === pts.length - 1 || i === highlight;
      svg += `<circle cx="${x(i)}" cy="${y(v)}" r="${big ? 4.5 : 3}" style="fill:${s.color};stroke:var(--surface);stroke-width:2"><title>${esc(tip)}</title></circle>`;
    });
  }
  labels.forEach((label, i) => {
    if (labels.length > 12 && i % 2) return;
    svg += `<text class="axis${i === highlight ? ' strong' : ''}" x="${x(i)}" y="${h - 6}" text-anchor="middle">${esc(label)}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(series.map((s) => s.label).join(', '))} trend">${svg}</svg>`;
}

/** Donut chart; returns nothing, draws into el. items: [{ label, value, color }] */
export function donut(el, items) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let offset = 0;
  let rings = '';
  for (const it of items) {
    if (it.value <= 0) continue;
    const len = (it.value / total) * c;
    const share = ((it.value / total) * 100).toFixed(0);
    const tip = isRevealed() ? `${it.label}: ${formatINR(it.value)} (${share}%)` : `${it.label}: ${share}%`;
    rings += `<circle r="${r}" cx="80" cy="80" style="fill:none;stroke:${it.color};stroke-width:22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"><title>${esc(tip)}</title></circle>`;
    offset += len;
  }
  el.innerHTML = `<svg viewBox="0 0 160 160" role="img" aria-label="Allocation">${rings || `<circle r="${r}" cx="80" cy="80" style="fill:none;stroke:var(--surface-3);stroke-width:22"/>`}</svg>`;
}

/** Legend for a donut, with shares (and amounts when revealed). */
export function donutLegend(items, moneyFn) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  return `<ul class="donut-legend">${items
    .filter((i) => i.value > 0)
    .map((i) => `<li><i style="background:${i.color}"></i><span>${esc(i.label)}</span><span class="muted">${total ? ((i.value / total) * 100).toFixed(0) : 0}% · ${moneyFn(i.value)}</span></li>`)
    .join('')}</ul>`;
}
