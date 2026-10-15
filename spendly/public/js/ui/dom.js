// Small UI toolkit shared by every screen.
import { formatINR, MASK } from '../core/money.js';
import { ASSET_TYPES, ACCOUNT_TYPES, LIABILITY_TYPES } from '../core/defaults.js';

/** Global app context. `store` is set at boot; `render()` redraws the current screen. */
export const app = {
  store: null,
  render: () => {},
  state: {
    month: null, // YYYY-MM shown on dashboard / savings
    reportYear: null,
    txFilter: { q: '', type: '', period: 'month', month: null, year: null, from: '', to: '', categoryId: '', account: '', source: '', sort: 'date-desc' },
    quick: { q: '', categoryId: '' },
    gmailTab: 'pending',
    syncDays: '30',
    showArchived: false,
  },
};

/** Click handlers registered by screens: <button data-act="name" data-id="…"> */
export const actions = {};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const icon = (name, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} aria-hidden="true"><use href="#i-${name}"/></svg>`;

// ---------- privacy-aware money ----------

export function isRevealed() {
  return Boolean(app.store?.isUnlocked() && app.store.db.settings.revealAmounts);
}

/** Text form of an amount: masked as ₹•••••• unless amounts are revealed. */
export function moneyText(paise, opts = {}) {
  if (!isRevealed()) return MASK;
  return formatINR(paise, opts);
}

/** HTML span for an amount. opts.tone: 'auto' colours +/−. */
export function money(paise, { sign = false, compact = false, cls = '', tone = '' } = {}) {
  let c = cls;
  if (tone === 'auto') c += paise > 0 ? ' pos' : paise < 0 ? ' neg' : '';
  return `<span class="amt ${c}">${esc(moneyText(paise, { sign, compact }))}</span>`;
}

export function pct(value, digits = 0) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`;
}

// ---------- dates ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  const f = app.store?.isUnlocked() ? app.store.db.settings.dateFormat : 'DD MMM YYYY';
  if (f === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
  if (f === 'YYYY-MM-DD') return iso;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function relDate(iso) {
  const today = app.store.today();
  if (iso === today) return 'Today';
  const y = new Date(Date.parse(today + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);
  if (iso === y) return 'Yesterday';
  return fmtDate(iso);
}

export function monthLabel(ym, short = false) {
  const [y, m] = ym.split('-').map(Number);
  return short ? MONTHS[m - 1] : `${MONTHS_LONG[m - 1]} ${y}`;
}

// ---------- names & icons ----------

export function categoryName(id) {
  if (!id) return '';
  return app.store.db.categories.find((c) => c.id === id)?.name || 'Unknown category';
}

const CAT_ICONS = [
  [/food|dining|breakfast|lunch|dinner|tea|coffee|snack/i, 'food'],
  [/grocer/i, 'cart'],
  [/travel|transport|cab|auto|petrol|fuel/i, 'car'],
  [/shop/i, 'bag'],
  [/subscri/i, 'tv'],
  [/educat/i, 'book'],
  [/content/i, 'camera'],
  [/rent|electric/i, 'bolt-home'],
  [/family/i, 'users'],
  [/credit card/i, 'card'],
  [/salary|business|freelance|mentor|brand/i, 'briefcase'],
  [/interest|dividend/i, 'trend'],
  [/refund/i, 'undo'],
];

export function categoryIcon(name) {
  for (const [re, ic] of CAT_ICONS) if (re.test(name || '')) return ic;
  return 'spark';
}

export const TYPE_ICON = { income: 'in', expense: 'out', transfer: 'transfer', investment: 'trend', refund: 'undo', reversal: 'undo' };

export function refName(ref) {
  if (!ref) return '';
  const coll = { account: 'accounts', asset: 'assets', liability: 'liabilities' }[ref.kind];
  return app.store.db[coll].find((x) => x.id === ref.id)?.name || 'Removed';
}

export function refTypeLabel(kind, type) {
  if (kind === 'account') return ACCOUNT_TYPES[type] || 'Account';
  if (kind === 'asset') return ASSET_TYPES[type]?.label || 'Asset';
  return LIABILITY_TYPES[type] || 'Liability';
}

/** <option>s for picking an account / card / asset. kinds: ['account','liability','asset'] */
export function endpointOptions(kinds, selected, { blank = 'Not linked' } = {}) {
  const db = app.store.db;
  const sel = selected ? `${selected.kind}:${selected.id}` : '';
  const group = (label, kind, list) => {
    const items = list.filter((x) => !x.archived || `${kind}:${x.id}` === sel);
    if (!items.length) return '';
    return `<optgroup label="${esc(label)}">${items
      .map((x) => `<option value="${kind}:${esc(x.id)}" ${`${kind}:${x.id}` === sel ? 'selected' : ''}>${esc(x.name)}${x.identifier ? ` ••${esc(x.identifier)}` : ''}</option>`)
      .join('')}</optgroup>`;
  };
  let html = blank === null ? '' : `<option value="">${esc(blank)}</option>`;
  if (kinds.includes('account')) html += group('Bank accounts & cash', 'account', db.accounts);
  if (kinds.includes('liability')) html += group('Credit cards & loans', 'liability', db.liabilities);
  if (kinds.includes('asset')) html += group('Assets & investments', 'asset', db.assets.filter((a) => a.status === 'active' || `asset:${a.id}` === sel));
  return html;
}

export function parseRef(value) {
  if (!value) return null;
  const i = value.indexOf(':');
  return { kind: value.slice(0, i), id: value.slice(i + 1) };
}

export function categoryOptions(kind, selectedId, { includeArchived = false, blank = null } = {}) {
  const cats = app.store.db.categories.filter((c) => c.kind === kind && !c.parentId && (includeArchived || !c.archived || c.id === selectedId));
  return (blank !== null ? `<option value="">${esc(blank)}</option>` : '') +
    cats.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}${c.archived ? ' (archived)' : ''}</option>`).join('');
}

export function subcategoryOptions(parentId, selectedId) {
  const subs = app.store.db.categories.filter((c) => c.parentId === parentId && (!c.archived || c.id === selectedId));
  return `<option value="">None</option>` + subs.map((c) => `<option value="${esc(c.id)}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

// ---------- feedback ----------

let toastTimer;
export function toast(message, { bad = false } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3400);
}

/** In-app confirmation (browser confirm() is unreliable in embedded views). */
export function ask({ title, message, confirmText = 'OK', danger = false, typeToConfirm = '' }) {
  const dlg = $('#ask');
  $('#ask-title').textContent = title;
  $('#ask-message').textContent = message;
  const ok = $('#ask-ok');
  ok.textContent = confirmText;
  ok.className = `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`;
  const input = $('#ask-input');
  $('#ask-type-wrap').hidden = !typeToConfirm;
  $('#ask-word').textContent = typeToConfirm;
  input.value = '';
  ok.disabled = Boolean(typeToConfirm);
  input.oninput = () => { ok.disabled = input.value.trim() !== typeToConfirm; };
  dlg.returnValue = '';
  dlg.showModal();
  (typeToConfirm ? input : ok).focus();
  return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
}

// ---------- bottom sheet ----------

export const sheet = {
  open({ title, html, onMount }) {
    const dlg = $('#sheet');
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    if (!dlg.open) dlg.showModal();
    $('#sheet .sheet-inner').scrollTop = 0;
    onMount?.($('#sheet-body'));
  },
  close() {
    const dlg = $('#sheet');
    if (dlg.open) dlg.close();
    $('#sheet-body').innerHTML = '';
  },
  get isOpen() { return $('#sheet').open; },
};

// ---------- forms ----------

export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

export function clearErrors(form) {
  $$('.has-error', form).forEach((f) => f.classList.remove('has-error'));
  $$('.field-error', form).forEach((e) => e.remove());
  const fe = $('.form-error', form);
  if (fe) fe.textContent = '';
}

/** Show a store ValidationError next to its field (or at the bottom of the form). */
export function showError(form, err) {
  clearErrors(form);
  const field = err.field && form.querySelector(`[name="${err.field}"]`);
  if (field) {
    const wrap = field.closest('.field') || field.parentElement;
    wrap.classList.add('has-error');
    const msg = document.createElement('div');
    msg.className = 'field-error';
    msg.textContent = err.message;
    wrap.appendChild(msg);
    field.focus();
  } else {
    const fe = $('.form-error', form);
    if (fe) fe.textContent = err.message;
    else toast(err.message, { bad: true });
  }
}

/** Run an async save with the submit button disabled (blocks double submits). */
export async function submitting(form, fn) {
  const btn = form.querySelector('[type="submit"]');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;
  try {
    clearErrors(form);
    return await fn();
  } catch (err) {
    showError(form, err);
    if (!err.field && !(err.name === 'ValidationError')) console.error(err);
    return undefined;
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function emptyState(iconName, title, text, actionHtml = '') {
  return `<div class="empty">${icon(iconName)}<strong>${esc(title)}</strong><p class="small">${esc(text)}</p>${actionHtml}</div>`;
}
