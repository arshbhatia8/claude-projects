// Dashboard, Transactions, Quick Add, Reports.
import {
  app, actions, esc, icon, money, moneyText, pct, fmtDate, relDate, monthLabel, categoryName, categoryIcon, refName, TYPE_ICON,
  emptyState, toast, ask, download, $, isRevealed, endpointOptions, parseRef, periodControl, sheet,
} from './dom.js';
import { barChart, lineChart, donut, donutLegend, colorAt } from './charts.js';
import { periodSummary, monthsEnding, monthlySeries, shiftMonth, insights, pnlFor, indexById, reversibleAmount } from '../core/ledger.js';
import { TX_TYPES, ASSET_TYPES } from '../core/defaults.js';
import { formatINR, toInputValue } from '../core/money.js';
import { openTxForm, openTxDetail, openTemplateForm, openCategoryEntry } from './forms.js';
import { smartBar } from './smart-ui.js';

const S = () => app.store;

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

export function txRow(tx, { showDate = true } = {}) {
  const sign = tx.type === 'income' || tx.type === 'refund' ? '+' : tx.type === 'expense' ? '−' : '';
  const cat = tx.categoryId ? categoryName(tx.categoryId) : '';
  const ico = tx.categoryId ? categoryIcon(cat) : TYPE_ICON[tx.type];
  const where = tx.type === 'transfer' || tx.type === 'investment' ? `${refName(tx.from) || '—'} → ${refName(tx.to) || '—'}` : refName(tx.from || tx.to);
  const meta = [cat || TX_TYPES[tx.type].label, where, tx.paymentMethod, tx.source === 'gmail' ? 'Gmail' : tx.source === 'demo' ? 'Demo' : ''].filter(Boolean).join(' · ');
  return `<li><button class="tx t-${tx.type}" data-act="tx-open" data-id="${esc(tx.id)}">
    <span class="tx-ico">${icon(ico)}</span>
    <span style="min-width:0"><span class="tx-title" style="display:block">${esc(tx.description)}</span><span class="tx-meta" style="display:block">${esc(meta)}</span></span>
    <span class="tx-amt">${esc(sign)}${esc(moneyText(tx.amount))}${showDate ? `<small>${esc(relDate(tx.date))}</small>` : ''}</span>
  </button></li>`;
}

const sortTx = (list) => [...list].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.time || '') !== (b.time || '') ? ((a.time || '') < (b.time || '') ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));

actions['month-step'] = (el) => {
  app.state.month = shiftMonth(app.state.month, Number(el.dataset.step));
  app.render();
};

const stat = (label, valueHtml, sub = '', ic = '', cls = '') =>
  `<article class="stat"><span class="stat-label">${ic ? icon(ic) : ''}${esc(label)}</span><span class="stat-value ${cls}">${valueHtml}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</article>`;

function categoryBars(rows, total, kind = 'expense', month = '') {
  if (!rows.length) return emptyState('pie', kind === 'expense' ? 'No spending recorded' : 'Nothing yet', 'Transactions you add for this period appear here.');
  return `<div class="bars">${rows.slice(0, 8).map((r, i) => {
    const share = total > 0 ? (r.total / total) * 100 : 0;
    return `<button class="bar-row bar-link" data-act="filter-cat" data-id="${esc(r.categoryId || '')}" data-month="${esc(month)}" aria-label="${esc(`Show ${categoryName(r.categoryId) || 'Uncategorised'} transactions, ${share.toFixed(0)}% of spending`)}"><span class="bar-top"><span>${esc(categoryName(r.categoryId) || 'Uncategorised')}</span><span>${money(r.total)} · ${share.toFixed(0)}%</span></span>
      <span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(2, Math.min(100, share)).toFixed(1)}%;background:${colorAt(i)}"></span></span></button>`;
  }).join('')}</div>`;
}

// Category drill-down: every item (Dosa, Idli, …) recorded under it that month.
actions['filter-cat'] = (el) => {
  Object.assign(app.state.txFilter, { categoryId: el.dataset.id, type: '', q: '', source: '', account: '', ...(el.dataset.month ? { period: 'month', month: el.dataset.month } : {}) });
  location.hash = 'transactions';
};

function allocationItems(totals) {
  const items = Object.entries(totals.byAssetType).filter(([, v]) => v > 0).map(([type, value]) => ({ label: ASSET_TYPES[type]?.label || type, value }));
  if (totals.liquid > 0) items.unshift({ label: 'Cash & bank', value: totals.liquid });
  return items.sort((a, b) => b.value - a.value).map((it, i) => ({ ...it, color: colorAt(i) }));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: S().db.settings.timezone }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** Months shown in trend charts: 6 on phones keeps labels readable, 12 elsewhere. */
export const trendLength = () => (window.innerWidth < 600 ? 6 : 12);

function favouriteTemplates(db, limit = 10) {
  const pinned = db.templates.filter((t) => t.pinned);
  const frequent = db.templates.filter((t) => !t.pinned && t.useCount > 0).sort((a, b) => b.useCount - a.useCount);
  return [...pinned.sort((a, b) => (b.useCount || 0) - (a.useCount || 0)), ...frequent].slice(0, limit);
}

export const dashboard = {
  title: 'My Finance',
  render() {
    const store = S();
    const db = store.db;
    const month = app.state.month;
    const t = store.totals();
    const s = periodSummary(db, month);
    const isEmpty = !db.transactions.length && !db.accounts.length && !db.assets.length && !db.liabilities.length;
    const favs = favouriteTemplates(db);
    const recent = sortTx(db.transactions).slice(0, 5);
    const tips = insights(db, month, store.today(), t);
    const revealed = isRevealed();
    const short = monthLabel(month, true);

    const welcome = isEmpty ? `
      <article class="card section">
        <h2>Welcome to Spendly</h2>
        <p class="muted small">Start with what you already have. Everything is entered by you and stays on this device.</p>
        <div class="menu-list">
          <a class="btn btn-primary" href="#accounts">${icon('bank')}Add a bank account</a>
          <a class="btn btn-ghost" href="#quick">${icon('zap')}Set up Quick Add</a>
          <button class="btn btn-ghost" data-act="demo-load">${icon('spark')}Try with demo data</button>
        </div>
      </article>` : '';

    return `
      <div class="page-head">
        <div><p class="eyebrow">${esc(greeting())}</p><h1>My Finance</h1></div>
        ${periodControl()}
      </div>
      ${store.hasDemoData() ? `<div class="notice warn section">${icon('alert')}<div>Demo data is loaded. Remove it in Settings → Data.</div></div>` : ''}
      ${backupReminder()}
      ${welcome}
      <section class="hero fade-in" aria-label="Net worth">
        <div class="hero-label">Total Net Worth
          <button class="icon-btn" data-act="toggle-privacy" aria-pressed="${revealed}" aria-label="${revealed ? 'Hide amounts' : 'Show amounts'}">${icon(revealed ? 'eye' : 'eye-off')}</button>
        </div>
        <div class="hero-value">${money(t.netWorth)}</div>
        <div class="hero-pills">
          <div class="hero-pill"><span class="dot in">${icon('in')}</span><span style="min-width:0"><small>Income · ${esc(short)}</small><b>${money(s.income)}</b></span></div>
          <div class="hero-pill"><span class="dot out">${icon('out')}</span><span style="min-width:0"><small>Expenses · ${esc(short)}</small><b>${money(s.expenses)}</b></span></div>
        </div>
        <div class="hero-foot"><span>Net cash flow</span>${money(s.net, { sign: true })}<span class="spacer"></span><span>${s.savingsRate === null ? 'No income yet' : `Saved ${pct(s.savingsRate)}`}</span></div>
      </section>

      <div class="actions-row" style="margin:12px 0">
        <a class="action-tile" href="#quick">${icon('zap')}Quick Add</a>
        <button class="action-tile" data-act="new-tx">${icon('plus')}Transaction</button>
        <button class="action-tile" data-act="add-asset">${icon('pie')}Add asset</button>
      </div>

      <section class="section">${smartBar()}</section>

      <section class="section" aria-label="Quick Add favourites">
        <div class="quick-strip fav-strip">
          ${quickCategories(db, store.today()).slice(0, 6).map(({ c }) => `<button class="chip" data-act="cat-use" data-id="${esc(c.id)}">${icon(categoryIcon(c.name))}${esc(c.name)}</button>`).join('')}
          ${favs.map((tp) => `<button class="chip" data-act="tpl-use" data-id="${esc(tp.id)}">${icon('pin')}${esc(tp.name)}</button>`).join('')}
          <a class="chip" href="#quick">${icon('more')}All</a>
        </div>
      </section>

      <div class="stats section">
        ${stat('Liquid balance', money(t.liquid), 'Bank, cash & wallets', 'wallet')}
        ${stat('Investments', money(t.investments), 'Recorded values', 'trend', 'inv')}
        ${stat('Total assets', money(t.totalAssets), 'Everything you own', 'pie')}
        ${stat('Liabilities', money(t.totalLiabilities), 'Cards & loans', 'card', 'lia')}
      </div>

      <div class="dash-grid">
        <article class="card w-8">
          <div class="section-head"><h2>Income vs expenses</h2><div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Expenses</span></div></div>
          <div class="chart" id="ch-ie"></div>
        </article>
        <article class="card w-4">
          <div class="section-head"><h2>Insights</h2></div>
          ${tips.length ? `<ul class="insights">${tips.map((x) => `<li class="${x.tone}">${esc(x.text)}</li>`).join('')}</ul>` : emptyState('spark', 'Nothing to point out yet', 'Insights appear as you record income, expenses, assets and goals.')}
        </article>
        <article class="card w-6">
          <div class="section-head"><h2>Expense breakdown</h2><span class="muted small">${esc(monthLabel(month))}</span></div>
          ${categoryBars(s.expenseByCategory.filter((r) => r.total > 0), s.expenses, 'expense', month)}
        </article>
        <article class="card w-6">
          <div class="section-head"><h2>Recent</h2><a class="small" href="#transactions">See all →</a></div>
          ${recent.length ? `<ul class="tx-list">${recent.map((tx) => txRow(tx)).join('')}</ul>` : emptyState('list', 'No transactions yet', 'Use Quick Add to record your first one.', `<a class="btn btn-primary btn-sm" href="#quick">${icon('zap')}Quick Add</a>`)}
        </article>
        <article class="card w-6">
          <div class="section-head"><h2>Portfolio allocation</h2><a class="small" href="#assets">Assets →</a></div>
          <div id="alloc"></div>
        </article>
        <article class="card w-6">
          <div class="section-head"><h2>Net cash flow by month</h2></div>
          <div class="chart" id="ch-net"></div>
        </article>
        <article class="card w-12">
          <div class="section-head"><h2>Assets vs liabilities</h2></div>
          <div class="vs">
            <div class="vs-bar" role="img" aria-label="Assets compared with liabilities"><div style="flex:${Math.max(t.totalAssets, 0)}"></div><div style="flex:${Math.max(t.totalLiabilities, 0)}"></div></div>
            <div class="row small"><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--accent)"></i> Assets ${money(t.totalAssets)}</span><span class="spacer"></span><span><i style="display:inline-block;width:9px;height:9px;border-radius:3px;background:var(--liability)"></i> Liabilities ${money(t.totalLiabilities)}</span></div>
          </div>
          <h3 style="margin-top:16px">Net worth trend</h3>
          <div class="chart" id="ch-nw" style="min-height:120px"></div>
        </article>
      </div>`;
  },
  after(root) {
    const db = S().db;
    const n = trendLength();
    const months = monthsEnding(app.state.month, n);
    const series = monthlySeries(db, months);
    const labels = months.map((m) => monthLabel(m, true));
    const any = series.some((m) => m.transactionCount);
    const ie = $('#ch-ie', root);
    if (any) barChart(ie, { labels, highlight: n - 1, series: [
      { label: 'Income', color: 'var(--income)', values: series.map((m) => m.income) },
      { label: 'Expenses', color: 'var(--expense)', values: series.map((m) => m.expenses) },
    ] });
    else ie.innerHTML = emptyState('chart', 'No history yet', 'Bars appear for months that have transactions.');
    const net = $('#ch-net', root);
    if (any) lineChart(net, { labels, highlight: n - 1, series: [{ label: 'Net cash flow', color: 'var(--accent)', area: true, values: series.map((m) => (m.transactionCount ? m.net : null)) }] });
    else net.innerHTML = emptyState('transfer', 'No cash flow yet', 'Shows income minus expenses for each month with data.');
    const t = S().totals();
    const items = allocationItems(t);
    const alloc = $('#alloc', root);
    if (items.length) {
      alloc.innerHTML = `<div class="donut-wrap"><div class="chart" id="ch-alloc"></div>${donutLegend(items, (v) => money(v, { compact: true }))}</div>`;
      donut($('#ch-alloc', root), items);
    } else alloc.innerHTML = emptyState('pie', 'No assets recorded', 'Add accounts and investments to see how your money is spread.', `<button class="btn btn-ghost btn-sm" data-act="add-asset">${icon('plus')}Add asset</button>`);
    const hist = db.netWorthHistory;
    const nw = $('#ch-nw', root);
    if (hist.length >= 2) lineChart(nw, { labels: hist.map((h) => monthLabel(h.month, true)), series: [{ label: 'Net worth', color: 'var(--accent)', area: true, values: hist.map((h) => h.netWorth) }] });
    else nw.innerHTML = `<p class="muted small">Spendly saves a net-worth snapshot each month you use it. The trend appears once two months are recorded — earlier months are never estimated.</p>`;
  },
};

/** Shown when there is data worth protecting and no recent backup. */
export function backupReminder() {
  const db = S().db;
  const hasData = db.transactions.some((t) => !t.sample) || db.accounts.some((a) => !a.sample) || db.assets.some((a) => !a.sample);
  if (!hasData) return '';
  const last = db.settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - Date.parse(last)) / 864e5) : null;
  if (days !== null && days < 7) return '';
  return `<div class="notice warn section backup-banner">${icon('download')}<div>${last ? `Last backup ${days} days ago.` : 'No backup yet.'} Your data lives only in this browser — keep an encrypted copy.</div><button class="btn btn-ghost btn-sm" data-act="backup">Back up</button></div>`;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export function filterTransactions(db, f, today) {
  const q = (f.q || '').trim().toLowerCase();
  let list = db.transactions.filter((t) => {
    if (f.type && t.type !== f.type) return false;
    if (f.period === 'month' && !t.date.startsWith(f.month || today.slice(0, 7))) return false;
    if (f.period === 'year' && !t.date.startsWith(f.year || today.slice(0, 4))) return false;
    if (f.period === 'range') {
      if (f.from && t.date < f.from) return false;
      if (f.to && t.date > f.to) return false;
    }
    if (f.categoryId && t.categoryId !== f.categoryId && t.subcategoryId !== f.categoryId) return false;
    if (f.account) {
      const ref = parseRef(f.account);
      if (![t.from, t.to].some((r) => r && r.kind === ref.kind && r.id === ref.id)) return false;
    }
    if (f.source && t.source !== f.source) return false;
    if (q) {
      const hay = [t.description, t.notes, t.externalRef, categoryName(t.categoryId), refName(t.from), refName(t.to)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (f.sort === 'amount-desc') list.sort((a, b) => b.amount - a.amount);
  else if (f.sort === 'amount-asc') list.sort((a, b) => a.amount - b.amount);
  else {
    list = sortTx(list);
    if (f.sort === 'date-asc') list.reverse();
  }
  return list;
}

function summarize(db, list) {
  const byId = indexById(db.transactions);
  let income = 0;
  let expenses = 0;
  for (const t of list) for (const l of pnlFor(t, byId)) (l.kind === 'income' ? (income += l.delta) : (expenses += l.delta));
  return { income, expenses, net: income - expenses };
}

export function transactionsToCsv(db, list) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rupees = (p) => (p / 100).toFixed(2);
  const cols = ['id', 'date', 'time', 'type', 'amount_inr', 'description', 'category', 'subcategory', 'payment_method', 'from', 'to', 'reverses_id', 'notes', 'source', 'external_ref', 'gmail_message_id', 'created_at', 'updated_at'];
  const rows = list.map((t) => [t.id, t.date, t.time, t.type, rupees(t.amount), t.description, categoryName(t.categoryId), categoryName(t.subcategoryId), t.paymentMethod, refName(t.from), refName(t.to), t.reversesId || '', t.notes, t.source, t.externalRef, t.gmailMessageId || '', t.createdAt, t.updatedAt]);
  return [cols.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\n');
}

export const transactions = {
  title: 'Transactions',
  render() {
    const store = S();
    const db = store.db;
    const f = app.state.txFilter;
    if (!f.month) f.month = app.state.month;
    if (!f.year) f.year = store.today().slice(0, 4);
    const list = filterTransactions(db, f, store.today());
    const sum = summarize(db, list);
    const years = [...new Set([store.today().slice(0, 4), ...db.transactions.map((t) => t.date.slice(0, 4))])].sort().reverse();
    const cats = db.categories.filter((c) => !c.parentId);
    const groups = new Map();
    const byDate = !f.sort.startsWith('amount');
    if (byDate) for (const t of list) (groups.get(t.date) || groups.set(t.date, []).get(t.date)).push(t);
    const opt = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`;

    return `
      <div class="page-head">
        <div><h1>Transactions</h1><p class="muted">${list.length} shown</p></div>
        <div class="page-actions">
          <button class="btn btn-ghost" data-act="tx-export" aria-label="Export CSV">${icon('download')}<span class="lbl">Export CSV</span></button>
          <button class="btn btn-primary" data-act="new-tx">${icon('plus')}<span class="lbl">Add</span></button>
        </div>
      </div>
      <form class="filters card" id="tx-filters" style="margin-bottom:14px" onsubmit="return false">
        <div class="searchbar">${icon('search')}<input type="search" name="q" value="${esc(f.q)}" placeholder="Search description, notes, reference…" aria-label="Search" /></div>
        <select name="type" aria-label="Type">${opt('', 'All types', f.type)}${Object.entries(TX_TYPES).map(([k, v]) => opt(k, v.label, f.type)).join('')}</select>
        <select name="period" aria-label="Period">${opt('month', 'Month', f.period)}${opt('year', 'Year', f.period)}${opt('range', 'Date range', f.period)}${opt('all', 'All time', f.period)}</select>
        <select name="sort" aria-label="Sort">${opt('date-desc', 'Newest first', f.sort)}${opt('date-asc', 'Oldest first', f.sort)}${opt('amount-desc', 'Largest amount', f.sort)}${opt('amount-asc', 'Smallest amount', f.sort)}</select>
        <details class="more-wrap" ${f.categoryId || f.account || f.source || f.period !== 'month' || app.state.txMoreOpen ? 'open' : ''}>
        <summary class="small">More filters</summary>
        <div class="more-filters">
          ${f.period === 'month' ? `<input type="month" name="month" value="${esc(f.month)}" aria-label="Month" />` : ''}
          ${f.period === 'year' ? `<select name="year" aria-label="Year">${years.map((y) => opt(y, y, f.year)).join('')}</select>` : ''}
          ${f.period === 'range' ? `<input type="date" name="from" value="${esc(f.from)}" aria-label="From date" /><input type="date" name="to" value="${esc(f.to)}" aria-label="To date" />` : ''}
          <select name="categoryId" aria-label="Category"><option value="">All categories</option>${cats.map((c) => opt(c.id, `${c.kind === 'income' ? 'Income · ' : ''}${c.name}`, f.categoryId)).join('')}</select>
          <select name="account" aria-label="Account">${endpointOptions(['account', 'liability', 'asset'], parseRef(f.account), { blank: 'All accounts' })}</select>
          <select name="source" aria-label="Source">${opt('', 'All sources', f.source)}${opt('manual', 'Manual', f.source)}${opt('gmail', 'Gmail', f.source)}${opt('demo', 'Demo', f.source)}</select>
        </div>
        </details>
      </form>
      <div class="summary-strip" style="margin:0 4px 12px">
        <span>Income <b class="pos">${money(sum.income)}</b></span>
        <span>Expenses <b class="neg">${money(sum.expenses)}</b></span>
        <span>Net <b>${money(sum.net, { sign: true })}</b></span>
      </div>
      ${!list.length
        ? `<div class="card">${emptyState('list', 'No transactions match', 'Change the filters or add a transaction.', `<button class="btn btn-primary btn-sm" data-act="new-tx">${icon('plus')}Add transaction</button>`)}</div>`
        : byDate
          ? [...groups].map(([date, items]) => `<section class="tx-day"><div class="tx-day-head"><span>${esc(relDate(date))}</span></div><ul class="tx-list">${items.map((t) => txRow(t, { showDate: false })).join('')}</ul></section>`).join('')
          : `<ul class="tx-list">${list.map((t) => txRow(t)).join('')}</ul>`}`;
  },
  after(root) {
    const form = $('#tx-filters', root);
    let timer;
    const apply = () => {
      const fd = Object.fromEntries(new FormData(form).entries());
      Object.assign(app.state.txFilter, fd);
      app.render({ keepFocus: true });
    };
    form.addEventListener('change', (e) => { if (e.target.name !== 'q') apply(); });
    $('.more-wrap', form).addEventListener('toggle', (e) => { app.state.txMoreOpen = e.target.open; });
    form.q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(apply, 250); });
  },
};

actions['tx-export'] = async () => {
  const store = S();
  const list = filterTransactions(store.db, app.state.txFilter, store.today());
  const r = await download(`spendly-transactions-${store.today()}.csv`, transactionsToCsv(store.db, list), 'text/csv');
  if (r !== 'cancelled') toast(`Exported ${list.length} transactions`);
};
actions['new-tx'] = () => openTxForm({ values: { date: S().today() }, draftKey: 'tx:new' });
actions['tx-open'] = (el) => openTxDetail(el.dataset.id);
actions['tx-edit'] = (el) => {
  const tx = S().db.transactions.find((t) => t.id === el.dataset.id);
  if (tx.type === 'reversal') {
    const original = S().db.transactions.find((t) => t.id === tx.reversesId);
    return openTxForm({ mode: 'reversal', values: { ...tx }, original: { ...original, id: original.id } });
  }
  openTxForm({ mode: 'edit', values: { ...tx } });
};
actions['tx-repeat'] = (el) => {
  const tx = S().db.transactions.find((t) => t.id === el.dataset.id);
  const { id, createdAt, updatedAt, gmailMessageId, source, externalRef, templateId, ...rest } = tx;
  openTxForm({ values: { ...rest, date: S().today(), time: '' } });
};
actions['tx-reverse'] = (el) => {
  const tx = S().db.transactions.find((t) => t.id === el.dataset.id);
  openTxForm({ mode: 'reversal', original: tx, values: { date: S().today(), amount: reversibleAmount(S().db, tx.id) } });
};
actions['tx-to-template'] = (el) => {
  const tx = S().db.transactions.find((t) => t.id === el.dataset.id);
  openTemplateForm(null, { name: tx.description, type: tx.type === 'reversal' ? 'expense' : tx.type, amount: tx.amount, description: tx.description, categoryId: tx.categoryId, subcategoryId: tx.subcategoryId, paymentMethod: tx.paymentMethod, from: tx.from, to: tx.to });
};
actions['tx-delete'] = async (el) => {
  const tx = S().db.transactions.find((t) => t.id === el.dataset.id);
  const ok = await ask({ title: 'Delete transaction?', message: `“${tx.description}” will be removed and every balance and report recalculated.${tx.source === 'gmail' ? ' The email itself is not touched and will not be imported again.' : ''}`, confirmText: 'Delete', danger: true });
  if (!ok) return;
  try {
    await S().deleteTransaction(tx.id);
    const { sheet } = await import('./dom.js');
    sheet.close();
    toast('Transaction deleted');
    app.render();
  } catch (e) {
    toast(e.message, { bad: true });
  }
};

// ---------------------------------------------------------------------------
// Quick Add
// ---------------------------------------------------------------------------

function templateTile(tp) {
  const cat = categoryName(tp.categoryId);
  const amount = tp.amount ? moneyText(tp.amount) : 'Enter amount';
  return `<div class="tpl-cell">
    <button class="tpl" data-act="tpl-use" data-id="${esc(tp.id)}" aria-label="${esc(`Use ${tp.name}`)}">
      <span class="tpl-top"><span class="tx-ico t-${tp.type}">${icon(cat ? categoryIcon(cat || tp.name) : TYPE_ICON[tp.type])}</span></span>
      <span class="tpl-name">${tp.pinned ? icon('pin', 'tpl-pin') : ''}${esc(tp.name)}</span>
      <span class="tpl-amt">${esc(amount)}${cat ? ` · ${esc(cat)}` : ''}</span>
    </button>
    <span class="tpl-tools"><button class="tpl-menu" data-act="tpl-menu" data-id="${esc(tp.id)}" aria-label="Options for ${esc(tp.name)}">${icon('more')}</button></span>
  </div>`;
}

const grid = (list) => `<div class="tpl-grid">${list.map(templateTile).join('')}</div>`;

/** Quick Add categories, most-used in the last 60 days first. */
export function quickCategories(db, today) {
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 60 * 864e5).toISOString().slice(0, 10);
  const uses = new Map();
  const last = new Map();
  for (const t of db.transactions) {
    if (!t.categoryId || t.type !== 'expense') continue;
    if (t.date >= since) uses.set(t.categoryId, (uses.get(t.categoryId) || 0) + 1);
    const prev = last.get(t.categoryId);
    if (!prev || t.date > prev.date || (t.date === prev.date && t.createdAt > prev.createdAt)) last.set(t.categoryId, t);
  }
  return db.categories
    .filter((c) => c.quick && !c.archived && !c.parentId)
    .map((c, i) => ({ c, i, n: uses.get(c.id) || 0, last: last.get(c.id) || null }))
    .sort((a, b) => b.n - a.n || a.i - b.i);
}

function categoryTile({ c, last }) {
  const lastText = last ? `Last: ${last.description && last.description.toLowerCase() !== c.name.toLowerCase() ? `${last.description} · ` : ''}${moneyText(last.amount)}` : 'Tap to add';
  return `<button class="tpl cat-tile" data-act="cat-use" data-id="${esc(c.id)}" aria-label="Add ${esc(c.name)} expense">
    <span class="tx-ico t-expense">${icon(categoryIcon(c.name))}</span>
    <span class="tpl-name">${esc(c.name)}</span>
    <span class="tpl-amt">${esc(lastText)}</span>
  </button>`;
}

export const quick = {
  title: 'Quick Add',
  render() {
    const store = S();
    const db = store.db;
    const st = app.state.quick;
    const q = st.q.trim().toLowerCase();
    let cats = quickCategories(db, store.today());
    let templates = [...db.templates].sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.useCount || 0) - (a.useCount || 0) || a.name.localeCompare(b.name));
    if (q) {
      // Search categories, templates and the descriptions you have used ("dosa" finds Breakfast).
      const descHit = new Set(db.transactions.filter((t) => t.description?.toLowerCase().includes(q)).map((t) => t.categoryId));
      cats = cats.filter(({ c }) => c.name.toLowerCase().includes(q) || descHit.has(c.id));
      templates = templates.filter((t) => `${t.name} ${t.description} ${categoryName(t.categoryId)}`.toLowerCase().includes(q));
    }
    const recentTx = sortTx(db.transactions.filter((t) => t.type !== 'reversal')).slice(0, 5);
    return `
      <div class="page-head">
        <div><h1>Quick Add</h1><p class="muted">Tap a category, type what it was, save.</p></div>
        <div class="page-actions">
          <button class="btn btn-ghost" data-act="new-template" aria-label="New template">${icon('plus')}<span class="lbl">New template</span></button>
          <button class="btn btn-primary" data-act="new-tx">${icon('edit')}<span class="lbl">Manual</span></button>
        </div>
      </div>
      <section class="section">${smartBar()}</section>
      <div class="section">
        <div class="searchbar">${icon('search')}<input type="search" id="quick-q" value="${esc(st.q)}" placeholder="Search, e.g. Breakfast or Dosa" aria-label="Search categories, templates and past items" /></div>
      </div>
      <section class="section" aria-label="Categories">
        <div class="section-head"><h3>Categories</h3><button class="link-btn" data-act="manage-categories">Edit</button></div>
        ${cats.length ? `<div class="tpl-grid">${cats.map(categoryTile).join('')}</div>` : `<p class="muted small">No category matches “${esc(st.q)}”.</p>`}
      </section>
      <section class="section" aria-label="Your templates">
        <div class="section-head"><h3>Your templates</h3></div>
        ${templates.length ? grid(templates) : q ? '<p class="muted small">No template matches.</p>' : `<p class="muted small">Optional. Save a fixed entry you repeat — e.g. a fixed-amount “Office lunch” paid by UPI — from any transaction (More details → Save as reusable template), or tap <b>+</b> above.</p>`}
      </section>
      ${recentTx.length && !q ? `<section class="section"><div class="section-head"><h3>Repeat a recent transaction</h3></div>
        <ul class="tx-list">${recentTx.map((t) => `<li class="row card-flat"><span class="tx-ico t-${t.type}" style="width:36px;height:36px">${icon(t.categoryId ? categoryIcon(categoryName(t.categoryId)) : TYPE_ICON[t.type])}</span><span style="min-width:0;flex:1"><span class="tx-title" style="display:block">${esc(t.description)}</span><span class="tx-meta" style="display:block">${esc(categoryName(t.categoryId) || TX_TYPES[t.type].label)} · ${esc(relDate(t.date))}</span></span><button class="btn btn-ghost btn-sm" data-act="tx-repeat" data-id="${esc(t.id)}">${icon('refresh')}Repeat</button></li>`).join('')}</ul></section>` : ''}`;
  },
  after(root) {
    const inp = $('#quick-q', root);
    let timer;
    inp?.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { app.state.quick.q = inp.value; app.render({ keepFocus: true }); }, 200);
    });
  },
};

actions['cat-use'] = (el) => openCategoryEntry(el.dataset.id);
actions['quick-cat'] = (el) => { app.state.quick.categoryId = el.dataset.id; app.render(); };
actions['new-template'] = () => openTemplateForm();
actions['tpl-edit'] = (el) => openTemplateForm(S().db.templates.find((t) => t.id === el.dataset.id));
actions['tpl-menu'] = (el) => {
  const tp = S().db.templates.find((t) => t.id === el.dataset.id);
  if (!tp) return;
  const id = esc(tp.id);
  sheet.open({
    title: tp.name,
    html: `<div class="menu-list">
      <button class="btn btn-primary" data-act="tpl-use" data-id="${id}">${icon('zap')}Use now</button>
      <button class="btn btn-ghost" data-act="tpl-pin" data-id="${id}">${icon('pin')}${tp.pinned ? 'Unpin from favourites' : 'Pin to favourites'}</button>
      <button class="btn btn-ghost" data-act="tpl-edit" data-id="${id}">${icon('edit')}Edit template</button>
      <button class="btn btn-danger" data-act="tpl-delete" data-id="${id}">${icon('trash')}Delete template</button>
      <p class="tiny muted">Used ${tp.useCount || 0} time${tp.useCount === 1 ? '' : 's'}. Editing or deleting a template never changes transactions already saved.</p>
    </div>`,
  });
};
actions['tpl-delete'] = async (el) => {
  const tp = S().db.templates.find((t) => t.id === el.dataset.id);
  if (!(await ask({ title: 'Delete template?', message: `“${tp.name}” will be removed from Quick Add. Transactions you already recorded with it stay as they are.`, confirmText: 'Delete', danger: true }))) return;
  await S().deleteTemplate(tp.id);
  sheet.close();
  toast('Template deleted');
  app.render();
};
actions['tpl-pin'] = async (el) => {
  const t = S().db.templates.find((x) => x.id === el.dataset.id);
  await S().setTemplatePinned(t.id, !t.pinned);
  sheet.close();
  toast(t.pinned ? `Unpinned ${t.name}` : `Pinned ${t.name}`);
  app.render();
};
actions['tpl-use'] = (el) => {
  const tp = S().db.templates.find((t) => t.id === el.dataset.id);
  if (!tp) return;
  openTxForm({
    template: tp,
    draftKey: `tx:tpl:${tp.id}`,
    focus: tp.description ? 'amount' : 'description',
    values: {
      type: tp.type, amount: tp.amount, categoryId: tp.categoryId, subcategoryId: tp.subcategoryId, paymentMethod: tp.paymentMethod,
      from: tp.from, to: tp.to, description: tp.description || tp.name, notes: tp.notes, date: S().today(),
    },
  });
};


// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function assetsToCsv(totals) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const r = (p) => (p === null || p === undefined ? '' : (p / 100).toFixed(2));
  const cols = ['kind', 'id', 'name', 'type', 'institution', 'status', 'invested_inr', 'current_value_inr', 'unrealized_gain_inr', 'last_updated', 'maturity_date', 'notes'];
  const rows = [
    ...totals.accounts.map((a) => ['account', a.id, a.name, a.type, a.institution, a.archived ? 'archived' : 'active', '', r(a.balance), '', a.reconciledOn || a.lastActivity || '', '', a.notes]),
    ...totals.assets.map((a) => ['asset', a.id, a.name, a.type, a.institution, a.status, r(a.invested), r(a.value), r(a.gain), a.valuedOn || a.lastActivity || '', a.maturityDate, a.notes]),
    ...totals.liabilities.map((l) => ['liability', l.id, l.name, l.type, l.institution, l.archived ? 'archived' : 'active', '', r(-l.outstanding), '', l.reconciledOn || l.lastActivity || '', l.dueDate, l.notes]),
  ];
  return [cols.join(','), ...rows.map((row) => row.map(cell).join(','))].join('\n');
}

export const reports = {
  title: 'Reports & Analytics',
  render() {
    const store = S();
    const db = store.db;
    const year = app.state.reportYear || store.today().slice(0, 4);
    const years = [...new Set([store.today().slice(0, 4), ...db.transactions.map((t) => t.date.slice(0, 4))])].sort().reverse();
    const ys = periodSummary(db, year);
    const month = app.state.month;
    const cur = periodSummary(db, month);
    const prev = periodSummary(db, shiftMonth(month, -1));
    const catIds = [...new Set([...cur.expenseByCategory, ...prev.expenseByCategory].map((r) => r.categoryId))];
    const val = (s, id) => s.expenseByCategory.find((r) => r.categoryId === id)?.total || 0;
    const t = store.totals();
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const ms = monthlySeries(db, months);
    const topCats = ys.expenseByCategory.filter((r) => r.total > 0).slice(0, 8);
    const change = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : a ? 'new' : '—');

    return `
      <div class="page-head">
        <div><h1>Reports & Analytics</h1><p class="muted">Every figure comes from your saved records.</p></div>
        <div class="page-actions">
          <select id="report-year" aria-label="Year" style="width:auto">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
          <button class="btn btn-ghost" data-act="export-year" data-year="${esc(year)}" aria-label="Export ${esc(year)} transactions as CSV">${icon('download')}<span class="lbl">${esc(year)} CSV</span></button>
        </div>
      </div>
      <div class="stats" style="margin-bottom:18px">
        ${stat(`Income ${year}`, money(ys.income), '', 'in', 'pos')}
        ${stat(`Expenses ${year}`, money(ys.expenses), ys.refunds ? `After ${moneyText(ys.refunds)} refunds/reversals` : '', 'out', 'neg')}
        ${stat(`Net cash flow ${year}`, money(ys.net, { sign: true }), '', 'transfer')}
        ${stat('Savings rate', pct(ys.savingsRate), '(Income − Expenses) ÷ Income', 'target')}
      </div>
      <div class="dash-grid">
        <article class="card w-12"><div class="section-head"><h2>Monthly income vs expenses · ${esc(year)}</h2><div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Expenses</span></div></div><div class="chart" id="r-ie"></div></article>
        <article class="card w-6"><div class="section-head"><h2>Monthly net cash flow</h2></div><div class="chart" id="r-net"></div></article>
        <article class="card w-6"><div class="section-head"><h2>Savings-rate trend</h2><span class="muted small">Months with income only</span></div><div class="chart" id="r-rate"></div></article>
        <article class="card w-12">
          <div class="section-head"><h2>Month-on-month · ${esc(monthLabel(month))} vs ${esc(monthLabel(shiftMonth(month, -1)))}</h2>${periodControl()}</div>
          ${catIds.length ? `<div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">${esc(monthLabel(shiftMonth(month, -1), true))}</th><th class="r">${esc(monthLabel(month, true))}</th><th class="r">Change</th></tr></thead><tbody>
            ${catIds.map((id) => `<tr><td>${esc(categoryName(id))}</td><td class="r">${money(val(prev, id))}</td><td class="r">${money(val(cur, id))}</td><td class="r">${esc(change(val(cur, id), val(prev, id)))}</td></tr>`).join('')}
            <tr><td><b>Total expenses</b></td><td class="r"><b>${money(prev.expenses)}</b></td><td class="r"><b>${money(cur.expenses)}</b></td><td class="r"><b>${esc(change(cur.expenses, prev.expenses))}</b></td></tr>
            <tr><td><b>Income</b></td><td class="r">${money(prev.income)}</td><td class="r">${money(cur.income)}</td><td class="r">${esc(change(cur.income, prev.income))}</td></tr>
          </tbody></table></div>` : emptyState('chart', 'No expenses in these two months', 'Pick another month above.')}
        </article>
        <article class="card w-12">
          <div class="section-head"><h2>Category trends · ${esc(year)}</h2><span class="muted small">Top expense categories by month</span></div>
          ${topCats.length ? `<div class="table-wrap"><table><thead><tr><th>Category</th>${months.map((m) => `<th class="r">${esc(monthLabel(m, true))}</th>`).join('')}<th class="r">Total</th></tr></thead><tbody>
            ${topCats.map((c) => `<tr><td>${esc(categoryName(c.categoryId))}</td>${ms.map((m) => `<td class="r">${(() => { const v = m.expenseByCategory.find((r) => r.categoryId === c.categoryId)?.total || 0; return v ? money(v, { compact: true }) : '<span class="muted">·</span>'; })()}</td>`).join('')}<td class="r"><b>${money(c.total, { compact: true })}</b></td></tr>`).join('')}
          </tbody></table></div>` : emptyState('chart', 'No expenses this year', 'Category trends appear once you record expenses.')}
        </article>
        <article class="card w-6"><div class="section-head"><h2>Asset allocation</h2></div><div id="r-alloc"></div></article>
        <article class="card w-6">
          <div class="section-head"><h2>Liabilities</h2><span>${money(t.totalLiabilities)}</span></div>
          ${t.liabilities.filter((l) => !l.archived).length ? `<ul class="tx-list">${t.liabilities.filter((l) => !l.archived).map((l) => `<li class="row card-flat"><span class="tx-ico" style="width:34px;height:34px">${icon('card')}</span><span style="flex:1;min-width:0">${esc(l.name)}<br><span class="tiny muted">${esc(l.dueDate ? `Due ${fmtDate(l.dueDate)}` : 'No due date')}</span></span><b class="lia">${money(l.outstanding)}</b></li>`).join('')}</ul>` : emptyState('card', 'No liabilities recorded', 'Credit cards and loans you add appear here.')}
        </article>
        <article class="card w-12">
          <div class="section-head"><h2>Net-worth history</h2><span class="badge">${db.netWorthHistory.length} recorded month${db.netWorthHistory.length === 1 ? '' : 's'}</span></div>
          <div class="chart" id="r-nw"></div>
          <p class="muted tiny">Snapshots are saved when you use Spendly in a month. Months without a snapshot are left out, never estimated, so this history is incomplete before you started.</p>
        </article>
      </div>`;
  },
  after(root) {
    const db = S().db;
    const year = app.state.reportYear || S().today().slice(0, 4);
    $('#report-year', root).addEventListener('change', (e) => { app.state.reportYear = e.target.value; app.render(); });
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const ms = monthlySeries(db, months);
    const labels = months.map((m) => monthLabel(m, true));
    const any = ms.some((m) => m.transactionCount);
    const none = (id, text) => { $(id, root).innerHTML = emptyState('chart', 'No data for this year', text); };
    if (any) {
      barChart($('#r-ie', root), { labels, series: [
        { label: 'Income', color: 'var(--income)', values: ms.map((m) => m.income) },
        { label: 'Expenses', color: 'var(--expense)', values: ms.map((m) => m.expenses) },
      ] });
      lineChart($('#r-net', root), { labels, series: [{ label: 'Net cash flow', color: 'var(--accent)', area: true, values: ms.map((m) => (m.transactionCount ? m.net : null)) }] });
      const rates = ms.map((m) => m.savingsRate);
      if (rates.some((r) => r !== null)) lineChart($('#r-rate', root), { labels, percent: true, series: [{ label: 'Savings rate', color: 'var(--invest)', values: rates }] });
      else none('#r-rate', 'A savings rate needs income in the month.');
    } else {
      none('#r-ie', 'Record transactions to see monthly reports.');
      none('#r-net', 'Shows income minus expenses per month.');
      none('#r-rate', 'A savings rate needs income in the month.');
    }
    const items = allocationItems(S().totals());
    const alloc = $('#r-alloc', root);
    if (items.length) {
      alloc.innerHTML = `<div class="donut-wrap"><div class="chart" id="r-alloc-ch"></div>${donutLegend(items, (v) => money(v, { compact: true }))}</div>`;
      donut($('#r-alloc-ch', root), items);
    } else alloc.innerHTML = emptyState('pie', 'No assets recorded', 'Add accounts and investments first.');
    const hist = db.netWorthHistory;
    if (hist.length >= 2) {
      lineChart($('#r-nw', root), { labels: hist.map((h) => monthLabel(h.month, true) + ' ' + h.month.slice(2, 4)), series: [
        { label: 'Net worth', color: 'var(--accent)', area: true, values: hist.map((h) => h.netWorth) },
        { label: 'Liabilities', color: 'var(--liability)', values: hist.map((h) => h.liabilities) },
      ] });
    } else $('#r-nw', root).innerHTML = emptyState('trend', 'Not enough history yet', 'Two monthly snapshots are needed to draw a trend.');
  },
};

actions['export-year'] = async (el) => {
  const store = S();
  const list = filterTransactions(store.db, { period: 'year', year: el.dataset.year, sort: 'date-asc' }, store.today());
  const r = await download(`spendly-${el.dataset.year}.csv`, transactionsToCsv(store.db, list), 'text/csv');
  if (r !== 'cancelled') toast(`Exported ${list.length} transactions`);
};
actions['export-assets'] = async () => {
  const store = S();
  const r = await download(`spendly-assets-${store.today()}.csv`, assetsToCsv(store.totals()), 'text/csv');
  if (r !== 'cancelled') toast('Assets exported');
};

export { formatINR, toInputValue };
