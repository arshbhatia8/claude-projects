// Assets & Investments, Bank Accounts & Cash, Liabilities, Savings & Goals.
import { app, actions, esc, icon, money, moneyText, pct, fmtDate, monthLabel, emptyState, toast, ask, $, refTypeLabel, sheet, periodControl } from './dom.js';
import { donut, donutLegend, colorAt } from './charts.js';
import { periodSummary, insights, daysBetween, shiftMonth } from '../core/ledger.js';
import { ASSET_TYPES, ASSET_STATUS, ACCOUNT_TYPES, LIABILITY_TYPES, GOAL_KINDS } from '../core/defaults.js';
import { openAssetForm, openAccountForm, openLiabilityForm, openGoalForm, openSnapshotForm, openCloseAssetForm, openTxForm } from './forms.js';

const S = () => app.store;
const kv = (label, valueHtml) => (valueHtml ? `<div><span>${esc(label)}</span><b>${valueHtml}</b></div>` : '');
const stat = (label, valueHtml, sub = '', cls = '') => `<article class="stat"><span class="stat-label">${esc(label)}</span><span class="stat-value ${cls}">${valueHtml}</span>${sub ? `<span class="stat-sub">${sub}</span>` : ''}</article>`;
const archivedToggle = (count) =>
  count ? `<button class="link-btn" data-act="toggle-archived">${app.state.showArchived ? 'Hide' : 'Show'} archived (${count})</button>` : '';
actions['toggle-archived'] = () => { app.state.showArchived = !app.state.showArchived; app.render(); };

// ---------------------------------------------------------------------------
// Assets & investments
// ---------------------------------------------------------------------------

const ASSET_ICON = { fd: 'bank', rd: 'refresh', stock: 'trend', mutual_fund: 'pie', etf: 'chart', other_investment: 'trend', gold: 'gold', other_asset: 'briefcase' };

function assetCard(a, today) {
  const t = ASSET_TYPES[a.type];
  const active = a.status === 'active';
  const gain = a.gain === null ? '' : `${money(a.gain, { sign: true, tone: 'auto' })}${a.gainPct !== null ? ` <span class="${a.gain >= 0 ? 'pos' : 'neg'}">(${a.gainPct >= 0 ? '+' : ''}${a.gainPct.toFixed(1)}%)</span>` : ''}`;
  const daysLeft = a.maturityDate && active ? daysBetween(today, a.maturityDate) : null;
  const updated = a.valuedOn || a.lastActivity;
  return `<article class="item">
    <div class="item-head">
      <span class="tx-ico t-investment">${icon(ASSET_ICON[a.type] || 'pie')}</span>
      <div style="min-width:0;flex:1"><div class="item-title">${esc(a.name)}</div><div class="item-sub">${esc([t.label, a.institution, a.symbol].filter(Boolean).join(' · '))}</div></div>
      <span class="badge ${active ? 'ok' : ''}">${esc(ASSET_STATUS[a.status] || a.status)}</span>
    </div>
    <div><div class="item-value">${money(a.value)}</div><div class="tiny muted">Recorded value${updated ? ` · updated ${esc(fmtDate(updated))}` : ''}${a.liquid ? ' · counts as liquid' : ''}</div></div>
    <div class="kv">
      ${kv(a.type === 'fd' ? 'Principal' : a.type === 'rd' ? 'Total deposited' : 'Invested', money(a.invested))}
      ${a.invested ? kv('Unrealized gain', gain) : ''}
      ${a.type === 'rd' ? kv('Installments paid', `${a.installmentsPaid}${a.tenureMonths ? ` / ${a.tenureMonths}` : ''}`) : ''}
      ${a.type === 'rd' && a.monthlyInstallment ? kv('Monthly installment', money(a.monthlyInstallment)) : ''}
      ${a.maturityDate ? kv('Matures', `${esc(fmtDate(a.maturityDate))}${daysLeft !== null && daysLeft >= 0 && daysLeft <= 60 ? ` <span class="badge warn">${daysLeft}d</span>` : ''}`) : ''}
      ${a.interestRate ? kv('Interest', `${esc(a.interestRate)}%${a.interestType ? ` · ${esc(a.interestType)}` : ''}`) : ''}
      ${a.maturityAmount ? kv('Maturity amount (bank)', money(a.maturityAmount)) : ''}
      ${a.quantity ? kv('Units', esc(a.quantity)) : ''}
      ${a.avgPrice ? kv('Avg price', money(a.avgPrice)) : ''}
      ${a.grams ? kv('Grams', esc(a.grams)) : ''}
      ${a.documentRef ? kv('Document', esc(a.documentRef)) : ''}
    </div>
    <div class="item-actions">
      <button class="btn btn-primary btn-sm" data-act="asset-value" data-id="${esc(a.id)}">${icon('edit')}Update value</button>
      ${active ? `<button class="btn btn-ghost btn-sm" data-act="asset-add" data-id="${esc(a.id)}">${icon('plus')}${a.type === 'rd' ? 'Record installment' : 'Add money'}</button>` : ''}
      ${active && (a.type === 'fd' || a.type === 'rd') ? `<button class="btn btn-ghost btn-sm" data-act="asset-close" data-id="${esc(a.id)}">${icon('check')}Mature / close</button>` : ''}
      ${active && a.type !== 'fd' && a.type !== 'rd' ? `<button class="btn btn-ghost btn-sm" data-act="asset-withdraw" data-id="${esc(a.id)}">${icon('out')}Withdraw / sell</button>` : ''}
      <button class="btn btn-ghost btn-sm" data-act="asset-edit" data-id="${esc(a.id)}">Edit</button>
      <button class="btn btn-ghost btn-sm" data-act="entity-archive" data-kind="asset" data-id="${esc(a.id)}">${a.archived ? 'Restore' : 'Archive'}</button>
    </div>
  </article>`;
}

export const assets = {
  title: 'Assets & Investments',
  render() {
    const store = S();
    const t = store.totals();
    const today = store.today();
    const visible = t.assets.filter((a) => app.state.showArchived || !a.archived);
    const active = t.assets.filter((a) => !a.archived);
    const invested = active.reduce((s, a) => s + a.invested, 0);
    const withBasis = active.filter((a) => a.invested > 0);
    const gain = withBasis.reduce((s, a) => s + (a.value - a.invested), 0);
    const basis = withBasis.reduce((s, a) => s + a.invested, 0);
    const sections = [
      ['fd', 'Fixed Deposits'], ['rd', 'Recurring Deposits'], ['market', 'Stocks, Mutual Funds & ETFs'], ['gold', 'Digital Gold'], ['other', 'Other Assets'],
    ];
    const bySection = (sec) => visible.filter((a) => ASSET_TYPES[a.type].section === sec);
    const fdStats = () => {
      const fds = active.filter((a) => a.type === 'fd');
      if (!fds.length) return '';
      const next = fds.filter((a) => a.status === 'active' && a.maturityDate && a.maturityDate >= today).sort((a, b) => (a.maturityDate < b.maturityDate ? -1 : 1))[0];
      return `<div class="stats">${stat('Total principal', money(fds.reduce((s, a) => s + a.invested, 0)))}${stat('Current recorded value', money(fds.reduce((s, a) => s + a.value, 0)))}${stat('Active FDs', String(fds.filter((a) => a.status === 'active').length))}${stat('Next maturity', next ? esc(fmtDate(next.maturityDate)) : '—', next ? esc(next.name) : '')}</div>`;
    };
    const rdStats = () => {
      const rds = active.filter((a) => a.type === 'rd');
      if (!rds.length) return '';
      const next = rds.filter((a) => a.status === 'active' && a.maturityDate).sort((a, b) => (a.maturityDate < b.maturityDate ? -1 : 1))[0];
      return `<div class="stats">${stat('Total deposited', money(rds.reduce((s, a) => s + a.invested, 0)))}${stat('Current recorded value', money(rds.reduce((s, a) => s + a.value, 0)))}${stat('Next maturity', next ? esc(fmtDate(next.maturityDate)) : '—', next ? esc(next.name) : '')}</div>`;
    };
    return `
      <div class="page-head">
        <div><h1>Assets & Investments</h1><p class="muted">Maintained by you — no live prices, brokers or bank links.</p></div>
        <div class="page-actions">${archivedToggle(t.assets.filter((a) => a.archived).length)}<button class="btn btn-primary" data-act="add-asset">${icon('plus')}<span class="lbl">Add asset</span></button></div>
      </div>
      <div class="stats" style="margin-bottom:14px">
        ${stat('Total investments', money(t.investments), 'Current recorded values', 'inv')}
        ${stat('Other assets', money(t.otherAssets), 'Non-liquid, e.g. vehicle')}
        ${stat('Amount invested', money(invested), 'Cost basis')}
        ${stat('Unrealized gain / loss', basis ? money(gain, { sign: true, tone: 'auto' }) : '—', basis ? `${pct((gain / basis) * 100, 1)} on cost` : 'Needs an invested amount')}
      </div>
      ${active.length ? `<article class="card section"><div class="section-head"><h2>Portfolio allocation</h2></div><div id="as-alloc"></div></article>` : ''}
      ${!visible.length ? `<div class="card">${emptyState('pie', 'No assets yet', 'Add FDs, RDs, stocks, mutual funds, gold or anything else you own.', `<button class="btn btn-primary btn-sm" data-act="add-asset">${icon('plus')}Add asset</button>`)}</div>` : ''}
      ${sections.map(([sec, title]) => {
        const list = bySection(sec);
        if (!list.length) return '';
        return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><button class="btn btn-ghost btn-sm" data-act="add-asset" data-type="${sec === 'market' ? 'mutual_fund' : sec === 'other' ? 'other_asset' : sec}">${icon('plus')}Add</button></div>
          ${sec === 'fd' ? fdStats() : sec === 'rd' ? rdStats() : ''}
          <div class="items">${list.map((a) => assetCard(a, today)).join('')}</div></section>`;
      }).join('')}`;
  },
  after(root) {
    const t = S().totals();
    const el = $('#as-alloc', root);
    if (!el) return;
    const items = t.assets.filter((a) => !a.archived && a.value > 0).sort((a, b) => b.value - a.value).map((a, i) => ({ label: a.name, value: a.value, color: colorAt(i) }));
    if (!items.length) { el.innerHTML = '<p class="muted small">Nothing with a value yet.</p>'; return; }
    el.innerHTML = `<div class="donut-wrap"><div class="chart" id="as-alloc-ch"></div>${donutLegend(items, (v) => money(v, { compact: true }))}</div>`;
    donut($('#as-alloc-ch', root), items);
  },
};

const findAsset = (id) => S().totals().assets.find((a) => a.id === id);
actions['add-asset'] = (el) => openAssetForm(null, el?.dataset?.type || null);
actions['asset-edit'] = (el) => openAssetForm(S().db.assets.find((a) => a.id === el.dataset.id));
actions['asset-value'] = (el) => { const a = findAsset(el.dataset.id); openSnapshotForm('asset', a, a.value); };
actions['asset-close'] = (el) => openCloseAssetForm(findAsset(el.dataset.id));
actions['asset-add'] = (el) => {
  const a = findAsset(el.dataset.id);
  const from = a.linkedAccountId ? { kind: 'account', id: a.linkedAccountId } : null;
  openTxForm({ values: { type: 'investment', to: { kind: 'asset', id: a.id }, from, amount: a.type === 'rd' ? a.monthlyInstallment : null, description: a.type === 'rd' ? `${a.name} installment` : `Invested in ${a.name}`, date: S().today() } });
};
actions['asset-withdraw'] = (el) => {
  const a = findAsset(el.dataset.id);
  openTxForm({ values: { type: 'transfer', from: { kind: 'asset', id: a.id }, to: a.linkedAccountId ? { kind: 'account', id: a.linkedAccountId } : null, description: `Withdrawn from ${a.name}`, date: S().today() } });
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accounts = {
  title: 'Bank Accounts & Cash',
  render() {
    const store = S();
    const t = store.totals();
    const list = t.accounts.filter((a) => app.state.showArchived || !a.archived);
    return `
      <div class="page-head">
        <div><h1>Bank Accounts & Cash</h1><p class="muted">Opening balance + your transactions, or your latest adjustment.</p></div>
        <div class="page-actions">${archivedToggle(t.accounts.filter((a) => a.archived).length)}<button class="btn btn-ghost" data-act="new-transfer" aria-label="Transfer between accounts">${icon('transfer')}<span class="lbl">Transfer</span></button><button class="btn btn-primary" data-act="add-account">${icon('plus')}<span class="lbl">Add</span></button></div>
      </div>
      <div class="stats" style="margin-bottom:14px">${stat('Total liquid balance', money(t.liquid), 'Includes other assets marked liquid')}${stat('Accounts', String(t.accounts.filter((a) => !a.archived).length))}</div>
      ${list.length ? `<div class="items">${list.map((a) => `
        <article class="item">
          <div class="item-head">
            <span class="tx-ico">${icon(a.type === 'cash' ? 'wallet' : a.type === 'wallet' ? 'wallet' : 'bank')}</span>
            <div style="min-width:0;flex:1"><div class="item-title">${esc(a.name)}</div><div class="item-sub">${esc([ACCOUNT_TYPES[a.type], a.institution, a.identifier && `••${a.identifier}`].filter(Boolean).join(' · '))}</div></div>
            ${a.archived ? '<span class="badge">Archived</span>' : a.reconciledOn ? `<span class="badge ok" title="Manually adjusted">${icon('check')}Reconciled</span>` : ''}
          </div>
          <div><div class="item-value">${money(a.balance)}</div><div class="tiny muted">${a.reconciledOn ? `Adjusted to your actual balance on ${esc(fmtDate(a.reconciledOn))}` : `Opening ${moneyText(a.openingBalance)}${a.openingDate ? ` on ${esc(fmtDate(a.openingDate))}` : ''}`}${a.lastActivity ? ` · last activity ${esc(fmtDate(a.lastActivity))}` : ''}</div></div>
          <div class="item-actions">
            <button class="btn btn-primary btn-sm" data-act="account-adjust" data-id="${esc(a.id)}">${icon('edit')}Adjust balance</button>
            <button class="btn btn-ghost btn-sm" data-act="new-transfer" data-from="${esc(a.id)}">${icon('transfer')}Transfer</button>
            <button class="btn btn-ghost btn-sm" data-act="account-edit" data-id="${esc(a.id)}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-act="entity-archive" data-kind="account" data-id="${esc(a.id)}">${a.archived ? 'Restore' : 'Archive'}</button>
            <button class="btn btn-ghost btn-sm" data-act="entity-delete" data-kind="account" data-id="${esc(a.id)}" aria-label="Delete ${esc(a.name)}">${icon('trash')}</button>
          </div>
        </article>`).join('')}</div>` : `<div class="card">${emptyState('bank', 'No accounts yet', 'Add your savings account, wallet and cash so income and expenses update real balances.', `<button class="btn btn-primary btn-sm" data-act="add-account">${icon('plus')}Add account</button>`)}</div>`}`;
  },
};

actions['add-account'] = () => openAccountForm();
actions['account-edit'] = (el) => openAccountForm(S().db.accounts.find((a) => a.id === el.dataset.id));
actions['account-adjust'] = (el) => { const a = S().totals().accounts.find((x) => x.id === el.dataset.id); openSnapshotForm('account', a, a.balance); };
actions['new-transfer'] = (el) => openTxForm({ values: { type: 'transfer', from: el?.dataset?.from ? { kind: 'account', id: el.dataset.from } : null, date: S().today() } });

actions['entity-archive'] = async (el) => {
  const kind = el.dataset.kind;
  const coll = { account: 'accounts', asset: 'assets', liability: 'liabilities' }[kind];
  const item = S().db[coll].find((x) => x.id === el.dataset.id);
  if (!item.archived && !(await ask({ title: `Archive ${item.name}?`, message: 'It disappears from totals and pickers but its history stays intact. You can restore it any time.', confirmText: 'Archive' }))) return;
  await S().setArchived(kind, item.id, !item.archived);
  toast(item.archived ? 'Restored' : 'Archived');
  app.render();
};
actions['entity-delete'] = async (el) => {
  const kind = el.dataset.kind;
  const coll = { account: 'accounts', asset: 'assets', liability: 'liabilities' }[kind];
  const item = S().db[coll].find((x) => x.id === el.dataset.id);
  if (!(await ask({ title: `Delete ${item.name}?`, message: 'Only possible when nothing is linked to it. Otherwise archive it to keep your history correct.', confirmText: 'Delete', danger: true }))) return;
  try {
    await S().deleteEntity(kind, item.id);
    toast('Deleted');
    app.render();
  } catch (e) {
    toast(e.message, { bad: true });
  }
};
actions['snapshot-delete'] = async (el) => {
  if (!(await ask({ title: 'Delete this entry?', message: 'The balance will be recalculated from the previous entry or the opening amount.', confirmText: 'Delete', danger: true }))) return;
  await S().deleteSnapshot(el.dataset.id);
  sheet.close();
  toast('Entry deleted');
  app.render();
};

// ---------------------------------------------------------------------------
// Liabilities
// ---------------------------------------------------------------------------

export const liabilities = {
  title: 'Liabilities',
  render() {
    const store = S();
    const t = store.totals();
    const list = t.liabilities.filter((l) => app.state.showArchived || !l.archived);
    const today = store.today();
    return `
      <div class="page-head">
        <div><h1>Liabilities</h1><p class="muted">Credit cards, loans and other money you owe.</p></div>
        <div class="page-actions">${archivedToggle(t.liabilities.filter((l) => l.archived).length)}<button class="btn btn-primary" data-act="add-liability">${icon('plus')}<span class="lbl">Add</span></button></div>
      </div>
      <div class="notice" style="margin-bottom:14px">${icon('card')}<div>Record card purchases as <b>Expenses paid from the card</b> — they count as spending once, when you buy. Paying the bill is a <b>Transfer</b> from your bank to the card: cash and the amount owed both go down, and nothing is counted as spending again.</div></div>
      <div class="stats" style="margin-bottom:14px">${stat('Total liabilities', money(t.totalLiabilities), 'Included in net worth', 'lia')}</div>
      ${list.length ? `<div class="items">${list.map((l) => {
        const due = l.dueDate ? daysBetween(today, l.dueDate) : null;
        return `<article class="item">
          <div class="item-head">
            <span class="tx-ico t-refund">${icon('card')}</span>
            <div style="min-width:0;flex:1"><div class="item-title">${esc(l.name)}</div><div class="item-sub">${esc([LIABILITY_TYPES[l.type], l.institution, l.identifier && `••${l.identifier}`].filter(Boolean).join(' · '))}</div></div>
            ${l.archived ? '<span class="badge">Archived</span>' : due !== null && due >= 0 && due <= 10 ? `<span class="badge warn">Due in ${due}d</span>` : ''}
          </div>
          <div><div class="item-value lia">${money(l.outstanding)}</div><div class="tiny muted">Outstanding${l.reconciledOn ? ` · adjusted on ${esc(fmtDate(l.reconciledOn))}` : ''}</div></div>
          <div class="kv">
            ${kv('Due date', l.dueDate ? esc(fmtDate(l.dueDate)) : '')}
            ${kv('Interest', l.interestRate ? `${esc(l.interestRate)}%` : '')}
            ${kv('Original amount', l.originalAmount ? money(l.originalAmount) : '')}
            ${kv('Started', l.startDate ? esc(fmtDate(l.startDate)) : '')}
          </div>
          <div class="item-actions">
            <button class="btn btn-primary btn-sm" data-act="liability-pay" data-id="${esc(l.id)}">${icon('transfer')}Pay</button>
            <button class="btn btn-ghost btn-sm" data-act="liability-adjust" data-id="${esc(l.id)}">Update outstanding</button>
            <button class="btn btn-ghost btn-sm" data-act="liability-edit" data-id="${esc(l.id)}">Edit</button>
            <button class="btn btn-ghost btn-sm" data-act="entity-archive" data-kind="liability" data-id="${esc(l.id)}">${l.archived ? 'Restore' : 'Archive'}</button>
          </div>
        </article>`;
      }).join('')}</div>` : `<div class="card">${emptyState('card', 'No liabilities', 'Add a credit card or loan to track what you owe.', `<button class="btn btn-primary btn-sm" data-act="add-liability">${icon('plus')}Add liability</button>`)}</div>`}`;
  },
};

actions['add-liability'] = () => openLiabilityForm();
actions['liability-edit'] = (el) => openLiabilityForm(S().db.liabilities.find((l) => l.id === el.dataset.id));
actions['liability-adjust'] = (el) => { const l = S().totals().liabilities.find((x) => x.id === el.dataset.id); openSnapshotForm('liability', l, l.outstanding); };
actions['liability-pay'] = (el) => {
  const l = S().totals().liabilities.find((x) => x.id === el.dataset.id);
  openTxForm({ values: { type: 'transfer', to: { kind: 'liability', id: l.id }, from: l.linkedAccountId ? { kind: 'account', id: l.linkedAccountId } : null, amount: l.outstanding > 0 ? l.outstanding : null, description: `${l.name} payment`, paymentMethod: 'Net Banking', date: S().today() } });
};

// ---------------------------------------------------------------------------
// Savings & goals
// ---------------------------------------------------------------------------

export const goals = {
  title: 'Savings & Goals',
  render() {
    const store = S();
    const db = store.db;
    const month = app.state.month;
    const s = periodSummary(db, month);
    const t = store.totals();
    const byType = (types) => t.assets.filter((a) => !a.archived && types.includes(a.type)).reduce((x, a) => x + a.value, 0);
    const list = db.goals.filter((g) => !g.archived);
    const tips = insights(db, month, store.today(), t);
    return `
      <div class="page-head">
        <div><h1>Savings & Goals</h1></div>
        ${periodControl()}
      </div>
      <section class="section">
        <h3>This month</h3>
        <div class="stats">
          ${stat('Monthly income', money(s.income), '', 'pos')}
          ${stat('Monthly expenses', money(s.expenses), '', 'neg')}
          ${stat('Net cash flow', money(s.net, { sign: true }), '')}
          ${stat('Savings rate', s.savingsRate === null ? 'Not available' : pct(s.savingsRate, 1), s.savingsRate === null ? 'No income recorded this month' : '')}
        </div>
        <p class="tiny muted">Savings rate = (Income − Expenses) ÷ Income × 100. Transfers and investment contributions are not expenses, so moving money into an FD or SIP does not lower it. Refunds reduce expenses.</p>
      </section>
      <section class="section">
        <h3>Where your money is</h3>
        <div class="stats">
          ${stat('Liquid balance', money(t.liquid))}
          ${stat('FD value', money(byType(['fd'])))}
          ${stat('RD value', money(byType(['rd'])))}
          ${stat('Stocks, MF & ETFs', money(byType(['stock', 'mutual_fund', 'etf', 'other_investment'])))}
          ${stat('Digital gold', money(byType(['gold'])))}
          ${stat('Other assets', money(t.otherAssets))}
          ${stat('Total liabilities', money(t.totalLiabilities), '', 'lia')}
          ${stat('Total net worth', money(t.netWorth), 'Assets − liabilities', 'pos')}
        </div>
      </section>
      <section class="section">
        <div class="section-head"><h2>Goals</h2><button class="btn btn-primary btn-sm" data-act="add-goal">${icon('plus')}New goal</button></div>
        ${list.length ? `<div class="items">${list.map((g) => {
          const p = g.target ? Math.min(100, (g.current / g.target) * 100) : 0;
          return `<article class="item">
            <div class="item-head"><span class="tx-ico">${icon('target')}</span><div style="flex:1;min-width:0"><div class="item-title">${esc(g.name)}</div><div class="item-sub">${esc(GOAL_KINDS[g.kind])}${g.targetDate ? ` · by ${esc(fmtDate(g.targetDate))}` : ''}</div></div><b>${p.toFixed(0)}%</b></div>
            <div class="progress" role="progressbar" aria-valuenow="${p.toFixed(0)}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(g.name)} progress"><div style="width:${p.toFixed(1)}%"></div></div>
            <div class="row small"><span>${money(g.current)} saved</span><span class="spacer"></span><span class="muted">of ${money(g.target)}</span></div>
            ${g.notes ? `<p class="tiny muted">${esc(g.notes)}</p>` : ''}
            <div class="item-actions"><button class="btn btn-ghost btn-sm" data-act="goal-edit" data-id="${esc(g.id)}">${icon('edit')}Update</button></div>
          </article>`;
        }).join('')}</div>` : `<div class="card">${emptyState('target', 'No goals yet', 'Set an emergency fund, savings or investment target and update what you have saved.', `<button class="btn btn-primary btn-sm" data-act="add-goal">${icon('plus')}New goal</button>`)}</div>`}
      </section>
      <section class="section"><h2>Insights</h2>
        ${tips.length ? `<ul class="insights card">${tips.map((x) => `<li class="${x.tone}">${esc(x.text)}</li>`).join('')}</ul>` : `<p class="muted small">No insights yet — they appear once there is enough data (for example two months of expenses).</p>`}
      </section>`;
  },
};

actions['add-goal'] = () => openGoalForm();
actions['goal-edit'] = (el) => openGoalForm(S().db.goals.find((g) => g.id === el.dataset.id));

export { refTypeLabel, shiftMonth };
