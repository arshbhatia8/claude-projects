'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  meta: null,
  month: currentMonth(),
  filters: { q: '', type: '', month: '', source: '' },
  editing: null,
  txType: 'debit',
  cache: new Map(),
};

const TYPE_LABEL = { credit: 'Credit', debit: 'Debit', investment: 'Invested' };
const TYPE_ICON = { credit: '↓', debit: '↑', investment: '◆' };

// ---------- helpers ----------
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function today() {
  const d = new Date();
  return `${currentMonth()}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftMonth(month, step) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + step, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthName(month, style = 'long') {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: style, year: style === 'long' ? 'numeric' : undefined });
}
function money(n, { compact = false } = {}) {
  const currency = state.meta?.currency || 'INR';
  if (compact && currency === 'INR' && Math.abs(n) >= 1000) {
    const [div, unit] = Math.abs(n) >= 1e7 ? [1e7, 'Cr'] : Math.abs(n) >= 1e5 ? [1e5, 'L'] : [1e3, 'K'];
    return `₹${+(n / div).toFixed(1)}${unit}`;
  }
  const locale = currency === 'INR' ? 'en-IN' : undefined;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency,
    maximumFractionDigits: compact || Number.isInteger(n) ? 0 : 2,
    notation: compact ? 'compact' : 'standard',
  }).format(n || 0);
}
function currencySymbol() {
  const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.meta?.currency || 'INR' }).formatToParts(0);
  return parts.find((p) => p.type === 'currency')?.value || '';
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function prettyDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const t = new Date(today() + 'T00:00:00');
  const diff = Math.round((t - d) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/auth')) {
    showAuth();
    throw new Error('Signed out');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

// ---------- auth ----------
let authMode = 'login';
async function boot() {
  const s = await api('/auth/status');
  if (!s.signedIn) return showAuth(s.setUp ? 'login' : 'setup');
  await startApp();
}
function showAuth(mode = 'login') {
  authMode = mode;
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  const setup = mode === 'setup';
  $('#auth-hint').textContent = setup ? 'First time here — choose a password to keep your data private.' : 'Welcome back. Unlock your tracker.';
  $('#auth-label').textContent = setup ? 'New password' : 'Password';
  $('#auth-confirm-wrap').classList.toggle('hidden', !setup);
  $('#auth-submit').textContent = setup ? 'Create & continue' : 'Unlock';
  $('#auth-password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#auth-password').focus();
}
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#auth-password').value;
  $('#auth-error').textContent = '';
  try {
    if (authMode === 'setup') {
      if (password !== $('#auth-confirm').value) throw new Error('Passwords do not match');
      await api('/auth/setup', { method: 'POST', body: { password } });
    } else {
      await api('/auth/login', { method: 'POST', body: { password } });
    }
    $('#auth-password').value = $('#auth-confirm').value = '';
    await startApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

async function startApp() {
  state.meta = await api('/meta');
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#currency').value = state.meta.currency;
  const h = new Date().getHours();
  $('#greeting').textContent = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'} — here is your money at a glance.`;
  route();
}

// ---------- routing ----------
function route() {
  const [view, query] = (location.hash.slice(1) || 'dashboard').split('?');
  const name = ['dashboard', 'transactions', 'settings'].includes(view) ? view : 'dashboard';
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== `view-${name}`));
  $$('[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  if (name === 'dashboard') renderDashboard();
  if (name === 'transactions') renderTransactions();
  if (name === 'settings') renderSettings(new URLSearchParams(query));
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => !$('#app').classList.contains('hidden') && route());

// ---------- dashboard ----------
async function renderDashboard() {
  $('#month-label').textContent = monthName(state.month);
  const [sum, recent] = await Promise.all([
    api(`/summary?month=${state.month}`),
    api(`/transactions?limit=6`),
  ]);
  const { credit, debit, investment } = sum.totals;
  $('#s-credit').textContent = money(credit);
  $('#s-debit').textContent = money(debit);
  $('#s-invest').textContent = money(investment);
  $('#s-net').textContent = money(sum.net);
  const count = (type) => sum.byCategory.filter((c) => c.type === type).reduce((a, c) => a + c.count, 0);
  const plural = (n) => `${n} transaction${n === 1 ? '' : 's'}`;
  $('#s-credit-sub').textContent = plural(count('credit'));
  $('#s-debit-sub').textContent = plural(count('debit'));
  $('#s-invest-sub').textContent = `All time ${money(sum.allTime.investment, { compact: true })}`;
  $('#s-net-sub').textContent =
    sum.savingsRate === null ? 'Credit − debit − invested' : `You kept ${Math.round(sum.savingsRate * 100)}% of what came in`;

  renderTrend(sum.trend);
  renderBars('#spend-breakdown', sum.byCategory.filter((c) => c.type === 'debit'), 'debit', 'No spending this month 🎉');
  renderBars(
    '#invest-breakdown',
    sum.byCategory.filter((c) => c.type === 'investment'),
    'investment',
    'Nothing invested this month yet'
  );
  $('#recent-list').innerHTML = recent.length ? recent.map((t) => txRow(t)).join('') : '<li class="empty">No transactions yet — tap “Add transaction” to start.</li>';
}

function renderBars(sel, rows, cls, emptyMsg) {
  const total = rows.reduce((a, r) => a + r.total, 0);
  const top = rows.slice(0, 7);
  $(sel).innerHTML = top.length
    ? top
        .map((r) => {
          const pct = total ? (r.total / total) * 100 : 0;
          return `<div class="bar-row">
            <div class="bar-top"><span><b>${esc(r.category)}</b></span><span>${money(r.total)} · ${pct.toFixed(0)}%</span></div>
            <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.max(pct, 2)}%"></div></div>
          </div>`;
        })
        .join('')
    : `<p class="empty">${emptyMsg}</p>`;
}

function renderTrend(trend) {
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(currentMonth(), i - 11));
  const data = months.map((m) => ({
    m,
    credit: trend.find((t) => t.month === m && t.type === 'credit')?.total || 0,
    debit: trend.find((t) => t.month === m && t.type === 'debit')?.total || 0,
    investment: trend.find((t) => t.month === m && t.type === 'investment')?.total || 0,
  }));
  const max = Math.max(1, ...data.flatMap((d) => [d.credit, d.debit, d.investment]));
  const el = $('#trend-chart');
  const W = Math.max(300, el.clientWidth || 720), H = el.clientHeight || 220, padL = 46, padB = 24, padT = 8;
  const innerW = W - padL, innerH = H - padB - padT;
  const groupW = innerW / 12, barW = Math.min(12, (groupW - 6) / 3);
  const colors = { credit: 'var(--credit)', debit: 'var(--debit)', investment: 'var(--invest)' };

  let svg = '';
  for (let i = 0; i <= 3; i++) {
    const y = padT + innerH - (innerH * i) / 3;
    svg += `<line class="grid" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/>`;
    svg += `<text class="axis" x="${padL - 8}" y="${y + 4}" text-anchor="end">${esc(money((max * i) / 3, { compact: true }))}</text>`;
  }
  data.forEach((d, i) => {
    const x0 = padL + i * groupW + (groupW - barW * 3 - 4) / 2;
    ['credit', 'debit', 'investment'].forEach((k, j) => {
      const h = (d[k] / max) * innerH;
      if (h > 0) {
        svg += `<rect x="${x0 + j * (barW + 2)}" y="${padT + innerH - h}" width="${barW}" height="${h}" rx="3" fill="${colors[k]}">
          <title>${monthName(d.m)} · ${TYPE_LABEL[k]}: ${money(d[k])}</title></rect>`;
      }
    });
    svg += `<text class="axis ${d.m === state.month ? 'current' : ''}" x="${padL + i * groupW + groupW / 2}" y="${H - 4}" text-anchor="middle">${esc(monthName(d.m, 'short').slice(0, W < 500 ? 1 : 3))}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly credit, debit and investment">${svg}</svg>`;
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => !$('#view-dashboard').classList.contains('hidden') && !$('#app').classList.contains('hidden') && renderDashboard(), 200);
});

$$('[data-month-step]').forEach((b) =>
  b.addEventListener('click', () => {
    state.month = shiftMonth(state.month, Number(b.dataset.monthStep));
    renderDashboard();
  })
);

// ---------- transactions ----------
function txRow(t, { showDate = true } = {}) {
  state.cache.set(t.id, t);
  const sign = t.type === 'credit' ? '+' : '−';
  const title = t.type === 'investment' ? t.invested_in || t.description || t.category : t.description || t.category;
  const meta = [
    t.category !== title ? t.category : '',
    t.type === 'investment' ? t.platform : '',
    t.payment_mode,
    t.account,
  ].filter(Boolean).join(' · ');
  return `<li class="tx ${t.type}" data-id="${t.id}" tabindex="0">
    <div class="tx-icon">${TYPE_ICON[t.type]}</div>
    <div class="tx-main">
      <div class="tx-title">${esc(title)}${t.source === 'gmail' ? '<span class="src">GMAIL</span>' : ''}</div>
      <div class="tx-meta">${esc(meta || TYPE_LABEL[t.type])}</div>
    </div>
    <div class="tx-amt">${sign}${esc(money(t.amount))}${showDate ? `<div class="tx-meta">${esc(prettyDate(t.date))}</div>` : ''}</div>
  </li>`;
}

async function renderTransactions() {
  const params = new URLSearchParams(Object.entries(state.filters).filter(([, v]) => v));
  const qs = params.toString();
  $('#export-link').href = `/api/export.csv${qs ? '?' + qs : ''}`;
  const rows = await api(`/transactions?limit=2000${qs ? '&' + qs : ''}`);
  $('#tx-count').textContent = `${rows.length} transaction${rows.length === 1 ? '' : 's'}`;

  const sums = { credit: 0, debit: 0, investment: 0 };
  rows.forEach((r) => (sums[r.type] += r.amount));
  $('#tx-summary').innerHTML = `
    <span>Credit <b style="color:var(--credit)">${money(sums.credit)}</b></span>
    <span>Debit <b style="color:var(--debit)">${money(sums.debit)}</b></span>
    <span>Invested <b style="color:var(--invest)">${money(sums.investment)}</b></span>`;

  const groups = new Map();
  rows.forEach((r) => {
    if (!groups.has(r.date)) groups.set(r.date, []);
    groups.get(r.date).push(r);
  });
  $('#tx-groups').innerHTML = rows.length
    ? [...groups]
        .map(([date, list]) => {
          const net = list.reduce((a, t) => a + (t.type === 'credit' ? t.amount : -t.amount), 0);
          return `<section class="tx-group glass"><h3><span>${esc(prettyDate(date))}</span><span>${net >= 0 ? '+' : '−'}${esc(money(Math.abs(net)))}</span></h3>
            <ul class="tx-list">${list.map((t) => txRow(t, { showDate: false })).join('')}</ul></section>`;
        })
        .join('')
    : '<p class="empty glass" style="padding:40px">No transactions match these filters.</p>';
}

let searchTimer;
$('#f-q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filters.q = e.target.value.trim(); renderTransactions(); }, 250);
});
$('#f-month').addEventListener('change', (e) => { state.filters.month = e.target.value; renderTransactions(); });
$('#f-source').addEventListener('change', (e) => { state.filters.source = e.target.value; renderTransactions(); });
$$('#f-type .chip').forEach((chip) =>
  chip.addEventListener('click', () => {
    $$('#f-type .chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.filters.type = chip.dataset.type;
    renderTransactions();
  })
);

document.addEventListener('click', (e) => {
  const row = e.target.closest('.tx[data-id]');
  if (row) openDialog(state.cache.get(Number(row.dataset.id)));
  if (e.target.closest('[data-action="add"]')) openDialog();
});
document.addEventListener('keydown', (e) => {
  const row = e.target.closest?.('.tx[data-id]');
  if (row && e.key === 'Enter') openDialog(state.cache.get(Number(row.dataset.id)));
});

// ---------- add / edit dialog ----------
const dialog = $('#tx-dialog');

function setTxType(type) {
  state.txType = type;
  $$('#tx-type button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  $('#tx-form').classList.toggle('is-investment', type === 'investment');
  $('#dl-category').innerHTML = state.meta.categories[type].map((c) => `<option value="${esc(c)}">`).join('');
  $('#lbl-category').textContent = type === 'investment' ? 'Invested where (type)' : 'Category';
  $('#lbl-description').textContent =
    type === 'credit' ? 'Received from / description' : type === 'debit' ? 'Paid to / description' : 'Description';
  $('#tx-category').placeholder = state.meta.categories[type][0];
}
$$('#tx-type button').forEach((b) => b.addEventListener('click', () => {
  const prev = state.txType;
  setTxType(b.dataset.type);
  // Clear a category that belonged to the previous type.
  if (prev !== b.dataset.type && state.meta.categories[prev].includes($('#tx-category').value)) $('#tx-category').value = '';
}));

function openDialog(tx) {
  state.editing = tx || null;
  $('#tx-title').textContent = tx ? 'Edit transaction' : 'Add transaction';
  $('#tx-delete').classList.toggle('hidden', !tx);
  $('#tx-error').textContent = '';
  $('#cur-symbol').textContent = currencySymbol();
  $('#tx-mode').innerHTML = ['<option value="">—</option>', ...state.meta.paymentModes.map((m) => `<option>${esc(m)}</option>`)].join('');
  setTxType(tx?.type || 'debit');
  $('#tx-amount').value = tx?.amount ?? '';
  $('#tx-date').value = tx?.date || today();
  $('#tx-category').value = tx?.category || '';
  $('#tx-description').value = tx?.description || '';
  $('#tx-invested-in').value = tx?.invested_in || '';
  $('#tx-platform').value = tx?.platform || '';
  $('#tx-mode').value = tx?.payment_mode || '';
  $('#tx-account').value = tx?.account || '';
  $('#tx-notes').value = tx?.notes || '';
  dialog.showModal();
  if (!tx) $('#tx-amount').focus();
}
$$('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

$('#tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const investment = state.txType === 'investment';
  const body = {
    type: state.txType,
    amount: $('#tx-amount').value,
    date: $('#tx-date').value,
    category: $('#tx-category').value || state.meta.categories[state.txType][0],
    description: $('#tx-description').value,
    invested_in: investment ? $('#tx-invested-in').value : '',
    platform: investment ? $('#tx-platform').value : '',
    payment_mode: $('#tx-mode').value,
    account: $('#tx-account').value,
    notes: $('#tx-notes').value,
  };
  try {
    $('#tx-save').disabled = true;
    if (state.editing) await api(`/transactions/${state.editing.id}`, { method: 'PUT', body });
    else await api('/transactions', { method: 'POST', body });
    dialog.close();
    toast(state.editing ? 'Saved' : 'Transaction added');
    route();
  } catch (err) {
    $('#tx-error').textContent = err.message;
  } finally {
    $('#tx-save').disabled = false;
  }
});

$('#tx-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('Delete this transaction from the tracker? (Your emails are never touched.)')) return;
  await api(`/transactions/${state.editing.id}`, { method: 'DELETE' });
  dialog.close();
  toast('Deleted');
  route();
});

// ---------- settings ----------
async function renderSettings(params) {
  const msg = params?.get('gmail');
  if (msg) {
    toast(msg === 'connected' ? 'Gmail connected (read-only) ✓' : `Gmail: ${msg}`);
    history.replaceState(null, '', '#settings');
  }
  const s = await api('/gmail/status');
  $('#gmail-pill').textContent = s.connected ? `Connected · ${s.email || ''}` : 'Not connected';
  $('#gmail-pill').classList.toggle('on', s.connected);
  $('#gmail-connected').classList.toggle('hidden', !s.connected);
  $('#gmail-setup').classList.toggle('hidden', s.connected);
  $('#redirect-uri').textContent = s.redirectUri;
  $('#connect-btn').classList.toggle('hidden', !s.configured);
  if (!s.configured) $('.steps').open = true;
  $('#g-client-id').disabled = s.clientIdFromEnv;
  if (s.clientIdFromEnv) $('#g-client-id').placeholder = 'Set in .env';
  $('#gmail-filter').value = s.filter || '';
  $('#gmail-auto').checked = s.autoSync;
  $('#sync-result').textContent = s.lastSync
    ? `Last sync ${new Date(s.lastSync.at).toLocaleString()}: ${s.lastSync.imported} imported from ${s.lastSync.scanned} new emails.`
    : 'Not synced yet.';
}

$('#gmail-config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/gmail/config', { method: 'PUT', body: { clientId: $('#g-client-id').value, clientSecret: $('#g-client-secret').value } });
    $('#g-client-secret').value = '';
    toast('Credentials saved — now click Connect Gmail');
    renderSettings();
  } catch (err) { toast(err.message); }
});

$('#save-filter-btn').addEventListener('click', async () => {
  await api('/gmail/config', { method: 'PUT', body: { filter: $('#gmail-filter').value, autoSync: $('#gmail-auto').checked } });
  toast('Saved');
});

$('#sync-btn').addEventListener('click', async () => {
  const btn = $('#sync-btn');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  try {
    const r = await api('/gmail/sync', { method: 'POST', body: { days: Number($('#sync-days').value) } });
    toast(`Imported ${r.imported} transaction${r.imported === 1 ? '' : 's'} from ${r.scanned} new emails`);
    if (r.errors.length) console.warn('Sync errors', r.errors);
    renderSettings();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync now';
  }
});

$('#disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Disconnect Gmail? Already imported transactions stay.')) return;
  await api('/gmail/disconnect', { method: 'POST' });
  toast('Gmail disconnected');
  renderSettings();
});

$('#currency').addEventListener('change', async (e) => {
  const r = await api('/settings', { method: 'PUT', body: { currency: e.target.value } });
  state.meta.currency = r.currency;
  toast(`Currency set to ${r.currency}`);
});

$('#pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/auth/change-password', { method: 'POST', body: { current: $('#pw-current').value, next: $('#pw-next').value } });
    e.target.reset();
    toast('Password changed');
  } catch (err) { toast(err.message); }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  showAuth('login');
});

boot().catch((e) => toast(e.message));
