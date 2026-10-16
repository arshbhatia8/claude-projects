// Small shared helpers: dates (India Standard Time), ids, text and CSV.

export const TZ = 'Asia/Kolkata';
const DAY = 86400000;

/** Current time; tests replace it with setNow(). */
let nowFn = () => new Date();
export const now = () => nowFn();
export function setNow(fn) { nowFn = typeof fn === 'function' ? fn : () => new Date(fn); }

/** YYYY-MM-DD for a Date (or ISO string) in IST. */
export function isoDay(d = now()) {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}
export const today = () => isoDay(now());

/** Accepts YYYY-MM-DD or an ISO timestamp; returns YYYY-MM-DD (IST) or ''. */
export function toDay(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return isoDay(s);
}

/** Whole days from day a to day b (both YYYY-MM-DD). */
export function daysBetween(a, b) {
  if (!a || !b) return NaN;
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
}
export function addDays(day, n) {
  const t = Date.parse(day + 'T00:00:00Z') + n * DAY;
  return new Date(t).toISOString().slice(0, 10);
}
/** Monday of the week containing `day`. */
export function weekStart(day) {
  const dow = new Date(day + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}
export function monthStart(day) { return day.slice(0, 7) + '-01'; }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "16 Oct" or "16 Oct 2025" when not the current year. */
export function fmtDay(day, { weekday = false, year } = {}) {
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  const showYear = year ?? (String(y) !== today().slice(0, 4));
  const wd = weekday ? DOW[new Date(day + 'T00:00:00Z').getUTCDay()] + ' ' : '';
  return `${wd}${d} ${MONTHS[m - 1]}${showYear ? ' ' + y : ''}`;
}
/** "2:40 PM" for an ISO timestamp, in IST. */
export function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).toUpperCase();
}
/** "14:30" → "2:30 PM". */
export function fmtClock(hhmm) {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
/** "today", "yesterday", "3 days ago", "in 2 days". */
export function relDay(day, ref = today()) {
  const n = daysBetween(ref, day);
  if (Number.isNaN(n)) return '';
  if (n === 0) return 'today';
  if (n === -1) return 'yesterday';
  if (n === 1) return 'tomorrow';
  return n < 0 ? `${-n} days ago` : `in ${n} days`;
}

/** Random id, url- and db-path-safe. */
export function uid(prefix = '') {
  const a = new Uint8Array(9);
  globalThis.crypto.getRandomValues(a);
  return prefix + Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

/** Lowercase slug of letters, digits and hyphens. */
export function slug(s, max = 60) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, max).replace(/-+$/, '');
}

/** Short stable hash (FNV-1a, base 36). */
export function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const isBlank = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
export const str = (v) => (v == null ? '' : String(v).trim());

/** Values a source writes when it has no data. */
const PLACEHOLDER = /^(n\/?a|na|none|null|undefined|-|–|—|not (disclosed|stated|shown|specified|mentioned|available)( in listing)?|unknown|tbd)$/i;
export const isPlaceholder = (v) => isBlank(v) || PLACEHOLDER.test(String(v).trim());

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Only http(s) links are ever rendered as links. */
export function safeUrl(u) {
  const s = str(u);
  if (!s) return '';
  try {
    const url = new URL(s);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch { return ''; }
}

// ---- CSV ----
export function csvCell(v) {
  if (v == null) return '';
  let s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Stop spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

/** RFC 4180 CSV parser. Returns an array of string arrays. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
