// Pure accounting engine. Nothing here touches storage or the DOM, so every
// rule can be unit-tested.
//
// Model
// -----
// Each transaction turns into:
//   • postings — balance changes on accounts, assets and liabilities
//   • P&L lines — what counts as income or expense in reports
//
//   type        postings                                     P&L
//   income      to account +a                                income +a
//   expense     from account −a  | from liability +a (card)  expense +a
//   refund      to account +a    | to liability −a           expense −a (same category)
//   transfer    from −a / to +a (liability: from +a, to −a)  none
//   investment  from account −a, to asset +a                 none
//   reversal    exact negative of the original (or part)     negative of original
//
// So transfers and investments never touch income/expense, a card purchase is
// an expense once (when incurred) and the bill payment is just a transfer that
// lowers both cash and the card's outstanding amount.
//
// Balances: opening value + every posting. If the user recorded a manual
// reconciliation / valuation ("snapshot"), the latest one replaces the opening
// value and only postings dated after it are added. Snapshots are never
// changed by imports, so a reconciled balance is never silently overwritten.

import { ASSET_TYPES } from './defaults.js';

const LIABILITY = 'liability';

function sideDelta(kind, side, amount) {
  if (kind === LIABILITY) return side === 'from' ? amount : -amount;
  return side === 'from' ? -amount : amount;
}

/** Balance changes caused by one transaction. */
export function postingsFor(tx, txById) {
  const a = tx.amount;
  if (tx.type === 'reversal') {
    const orig = txById.get(tx.reversesId);
    if (!orig || orig.type === 'reversal') return [];
    return postingsFor(orig, txById).map((p) => ({ ...p, delta: -Math.sign(p.delta) * a }));
  }
  const out = [];
  if (tx.from && ['expense', 'transfer', 'investment'].includes(tx.type)) {
    out.push({ kind: tx.from.kind, id: tx.from.id, delta: sideDelta(tx.from.kind, 'from', a) });
  }
  if (tx.to && ['income', 'refund', 'transfer', 'investment'].includes(tx.type)) {
    out.push({ kind: tx.to.kind, id: tx.to.id, delta: sideDelta(tx.to.kind, 'to', a) });
  }
  return out;
}

/** Income / expense effect of one transaction. */
export function pnlFor(tx, txById) {
  const a = tx.amount;
  switch (tx.type) {
    case 'income':
      return [{ kind: 'income', categoryId: tx.categoryId, subcategoryId: tx.subcategoryId || null, delta: a }];
    case 'expense':
      return [{ kind: 'expense', categoryId: tx.categoryId, subcategoryId: tx.subcategoryId || null, delta: a }];
    case 'refund':
      return [{ kind: 'expense', categoryId: tx.categoryId, subcategoryId: tx.subcategoryId || null, delta: -a, refund: true }];
    case 'reversal': {
      const orig = txById.get(tx.reversesId);
      if (!orig || orig.type === 'reversal') return [];
      return pnlFor(orig, txById).map((l) => ({ ...l, delta: -Math.sign(l.delta) * a, reversal: true }));
    }
    default:
      return [];
  }
}

export function indexById(list) {
  return new Map(list.map((x) => [x.id, x]));
}

function latestSnapshots(snapshots) {
  const latest = new Map();
  for (const s of snapshots) {
    const key = `${s.kind}:${s.refId}`;
    const cur = latest.get(key);
    if (!cur || s.date > cur.date || (s.date === cur.date && s.createdAt > cur.createdAt)) latest.set(key, s);
  }
  return latest;
}

/** Current balances for every account, asset and liability. */
export function computeBalances(db) {
  const txById = indexById(db.transactions);
  const latest = latestSnapshots(db.snapshots || []);
  const state = new Map();
  const init = (kind, entity, opening) => {
    const snap = latest.get(`${kind}:${entity.id}`);
    state.set(`${kind}:${entity.id}`, {
      value: snap ? snap.value : opening || 0,
      after: snap ? snap.date : null,
      snapshot: snap || null,
      lastActivity: snap ? snap.date : entity.openingDate || entity.openedOn || entity.startDate || null,
      invested: entity.openingInvested || 0,
      contributions: 0,
    });
  };
  for (const a of db.accounts) init('account', a, a.openingBalance);
  for (const a of db.assets) init('asset', a, a.openingValue);
  for (const l of db.liabilities) init(LIABILITY, l, l.openingOutstanding);

  for (const tx of db.transactions) {
    for (const p of postingsFor(tx, txById)) {
      const s = state.get(`${p.kind}:${p.id}`);
      if (!s) continue;
      if (s.after === null || tx.date > s.after) s.value += p.delta;
      if (!s.lastActivity || tx.date > s.lastActivity) s.lastActivity = tx.date;
      if (p.kind === 'asset') {
        // Cost basis follows money moved in and out, whatever the valuation.
        s.invested += p.delta;
        if (tx.type === 'investment') s.contributions += 1;
        if (tx.type === 'reversal' && txById.get(tx.reversesId)?.type === 'investment') s.contributions -= 1;
      }
    }
  }
  return state;
}

/** Everything the dashboard and the asset/account/liability screens need. */
export function computeTotals(db) {
  const bal = computeBalances(db);
  const accounts = db.accounts.map((a) => {
    const s = bal.get(`account:${a.id}`);
    return { ...a, balance: s.value, reconciledOn: s.snapshot?.date || null, lastActivity: s.lastActivity };
  });
  const assets = db.assets.map((a) => {
    const s = bal.get(`asset:${a.id}`);
    const invested = Math.max(0, s.invested);
    const gain = invested > 0 ? s.value - invested : null;
    return {
      ...a,
      value: s.value,
      invested,
      gain,
      gainPct: invested > 0 ? (gain / invested) * 100 : null,
      valuedOn: s.snapshot?.date || null,
      lastActivity: s.lastActivity,
      installmentsPaid: (a.installmentsBefore || 0) + s.contributions,
    };
  });
  const liabilities = db.liabilities.map((l) => {
    const s = bal.get(`${LIABILITY}:${l.id}`);
    return { ...l, outstanding: s.value, reconciledOn: s.snapshot?.date || null, lastActivity: s.lastActivity };
  });

  let liquid = 0;
  for (const a of accounts) if (!a.archived) liquid += a.balance;
  let investments = 0;
  let otherAssets = 0;
  let liquidOther = 0;
  const byAssetType = {};
  for (const a of assets) {
    if (a.archived) continue;
    const group = ASSET_TYPES[a.type]?.group || 'other';
    if (group === 'investment') investments += a.value;
    else if (a.liquid) liquidOther += a.value;
    else otherAssets += a.value;
    byAssetType[a.type] = (byAssetType[a.type] || 0) + a.value;
  }
  liquid += liquidOther; // "other assets" the user marked as liquid cash
  let totalLiabilities = 0;
  for (const l of liabilities) if (!l.archived) totalLiabilities += l.outstanding;

  const totalAssets = liquid + investments + otherAssets;
  return {
    accounts,
    assets,
    liabilities,
    liquid,
    investments,
    otherAssets,
    totalAssets,
    totalLiabilities,
    netWorth: totalAssets - totalLiabilities,
    byAssetType,
  };
}

/** Income, expense and cash-flow figures for transactions whose date starts with `prefix` (YYYY-MM or YYYY). */
export function periodSummary(db, prefix) {
  const txById = indexById(db.transactions);
  let income = 0;
  let grossExpenses = 0;
  let refunds = 0;
  const expenseByCat = new Map();
  const incomeByCat = new Map();
  let count = 0;
  for (const tx of db.transactions) {
    if (prefix && !tx.date.startsWith(prefix)) continue;
    count++;
    for (const line of pnlFor(tx, txById)) {
      if (line.kind === 'income') {
        income += line.delta;
        incomeByCat.set(line.categoryId, (incomeByCat.get(line.categoryId) || 0) + line.delta);
      } else {
        if (line.delta > 0 && !line.reversal) grossExpenses += line.delta;
        else refunds -= line.delta;
        expenseByCat.set(line.categoryId, (expenseByCat.get(line.categoryId) || 0) + line.delta);
      }
    }
  }
  const expenses = grossExpenses - refunds;
  const net = income - expenses;
  const toList = (m) => [...m].map(([categoryId, total]) => ({ categoryId, total })).filter((x) => x.total !== 0).sort((a, b) => b.total - a.total);
  return {
    income,
    expenses,
    grossExpenses,
    refunds,
    net,
    savingsRate: income > 0 ? (net / income) * 100 : null,
    expenseByCategory: toList(expenseByCat),
    incomeByCategory: toList(incomeByCat),
    transactionCount: count,
  };
}

export function shiftMonth(month, step) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + step, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthsEnding(month, count) {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, i - count + 1));
}

export function monthlySeries(db, months) {
  return months.map((month) => ({ month, ...periodSummary(db, month) }));
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
}

/** Plain-language observations backed by the user's own numbers. Never invents data. */
export function insights(db, month, today, totals = computeTotals(db)) {
  const out = [];
  const cur = periodSummary(db, month);
  const prev = periodSummary(db, shiftMonth(month, -1));
  const catName = (id) => db.categories.find((c) => c.id === id)?.name || 'Uncategorised';

  if (cur.expenses > 0 && prev.expenses > 0) {
    const change = ((cur.expenses - prev.expenses) / prev.expenses) * 100;
    if (Math.abs(change) >= 5) {
      out.push({ tone: change > 0 ? 'warn' : 'good', text: `Expenses are ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(0)}% compared with last month.` });
    }
  }
  if (cur.expenses > 0 && cur.expenseByCategory.length) {
    const top = cur.expenseByCategory[0];
    const share = (top.total / cur.expenses) * 100;
    if (share >= 25) out.push({ tone: 'info', text: `${catName(top.categoryId)} is ${share.toFixed(0)}% of this month's spending.` });
  }
  if (cur.savingsRate !== null && prev.savingsRate !== null && cur.income > 0 && prev.income > 0) {
    const diff = cur.savingsRate - prev.savingsRate;
    if (Math.abs(diff) >= 3) out.push({ tone: diff > 0 ? 'good' : 'warn', text: `Your savings rate ${diff > 0 ? 'rose' : 'fell'} from ${prev.savingsRate.toFixed(0)}% to ${cur.savingsRate.toFixed(0)}%.` });
  }
  for (const a of totals.assets) {
    if (a.archived || a.status !== 'active' || !a.maturityDate) continue;
    const days = daysBetween(today, a.maturityDate);
    if (days >= 0 && days <= 45) out.push({ tone: 'info', text: `${a.name} matures in ${days} day${days === 1 ? '' : 's'} (${a.maturityDate}).` });
  }
  for (const g of db.goals) {
    if (g.archived || !g.target) continue;
    const pct = (g.current / g.target) * 100;
    if (pct >= 100) out.push({ tone: 'good', text: `Goal reached: ${g.name}.` });
    else if (pct >= 50) out.push({ tone: 'good', text: `${g.name} is ${pct.toFixed(0)}% of the way to its target.` });
  }
  return out;
}

/** Remaining amount of a transaction that can still be reversed. */
export function reversibleAmount(db, txId, excludeId = null) {
  const orig = db.transactions.find((t) => t.id === txId);
  if (!orig || orig.type === 'reversal') return 0;
  let reversed = 0;
  for (const t of db.transactions) if (t.type === 'reversal' && t.reversesId === txId && t.id !== excludeId) reversed += t.amount;
  return orig.amount - reversed;
}
