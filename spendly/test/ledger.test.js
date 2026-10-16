// Accounting invariants from the spec, exercised through the real store.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, cat, acc, card, asset } from './helpers.js';
import { periodSummary } from '../public/js/core/ledger.js';
import { parseAmount, formatINR } from '../public/js/core/money.js';

async function setupBook() {
  const { store } = await freshStore();
  const bank = await store.saveAccount({ name: 'HDFC Savings', type: 'savings', openingBalance: '100000', identifier: '1234' });
  const wallet = await store.saveAccount({ name: 'Cash', type: 'cash', openingBalance: '2000' });
  const cc = await store.saveLiability({ name: 'Millennia Card', type: 'credit_card', openingOutstanding: '0', identifier: '4321' });
  return { store, bank, wallet, cc };
}

const bal = (store, id) => store.totals().accounts.find((a) => a.id === id).balance;
const owed = (store, id) => store.totals().liabilities.find((l) => l.id === id).outstanding;

test('money is exact integer paise', () => {
  assert.equal(parseAmount('1,250.5'), 125050);
  assert.equal(parseAmount('₹60'), 6000);
  assert.equal(parseAmount('Rs. 0.1'), 10);
  assert.equal(parseAmount('12.345'), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(formatINR(12345650), '₹1,23,456.50');
  assert.equal(formatINR(-6000), '−₹60');
  // 0.1 + 0.2 style drift cannot happen
  let total = 0;
  for (let i = 0; i < 10; i++) total += parseAmount('0.10');
  assert.equal(total, 100);
});

test('income raises and expense lowers the linked account', async () => {
  const { store, bank } = await setupBook();
  await store.createTransaction({ type: 'income', amount: '65000', date: '2026-10-01', categoryId: cat(store, 'income', 'Salary'), to: acc(bank.id) });
  await store.createTransaction({ type: 'expense', amount: '60', date: '2026-10-02', categoryId: cat(store, 'expense', 'Breakfast'), from: acc(bank.id) });
  assert.equal(bal(store, bank.id), (100000 + 65000 - 60) * 100);
  const s = periodSummary(store.db, '2026-10');
  assert.equal(s.income, 6500000);
  assert.equal(s.expenses, 6000);
  assert.equal(s.net, 6500000 - 6000);
});

test('transfers between accounts are neither income nor expense', async () => {
  const { store, bank, wallet } = await setupBook();
  const before = store.totals().netWorth;
  await store.createTransaction({ type: 'transfer', amount: '5000', date: '2026-10-03', from: acc(bank.id), to: acc(wallet.id) });
  const s = periodSummary(store.db, '2026-10');
  assert.equal(s.income, 0);
  assert.equal(s.expenses, 0);
  assert.equal(bal(store, bank.id), 9500000);
  assert.equal(bal(store, wallet.id), 700000);
  assert.equal(store.totals().netWorth, before);
});

test('investment moves cash into an asset without an expense or a jump in total assets', async () => {
  const { store, bank } = await setupBook();
  const fd = await store.addAsset({ name: 'SBI FD', type: 'fd', openedOn: '2026-10-05' }, { mode: 'account', accountId: bank.id, amount: '50000', date: '2026-10-05' });
  const t = store.totals();
  assert.equal(t.assets.find((a) => a.id === fd.id).value, 5000000);
  assert.equal(t.assets.find((a) => a.id === fd.id).invested, 5000000);
  assert.equal(bal(store, bank.id), 5000000);
  assert.equal(t.totalAssets, (100000 + 2000) * 100); // unchanged: just moved
  assert.equal(periodSummary(store.db, '2026-10').expenses, 0);
});

test('credit card purchase is an expense once; paying the bill is a transfer', async () => {
  const { store, bank, cc } = await setupBook();
  await store.createTransaction({ type: 'expense', amount: '2500', date: '2026-10-08', categoryId: cat(store, 'expense', 'Shopping'), from: card(cc.id), paymentMethod: 'Credit Card' });
  assert.equal(owed(store, cc.id), 250000);
  assert.equal(bal(store, bank.id), 10000000); // cash untouched until the bill is paid
  const nwAfterPurchase = store.totals().netWorth;
  await store.createTransaction({ type: 'transfer', amount: '2500', date: '2026-10-20', from: acc(bank.id), to: card(cc.id) });
  assert.equal(owed(store, cc.id), 0);
  assert.equal(bal(store, bank.id), 9750000);
  assert.equal(store.totals().netWorth, nwAfterPurchase); // paying the bill does not change net worth
  assert.equal(periodSummary(store.db, '2026-10').expenses, 250000); // counted once
});

test('refunds and reversals net out correctly', async () => {
  const { store, bank, cc } = await setupBook();
  const shop = cat(store, 'expense', 'Shopping');
  const { transaction: buy } = await store.createTransaction({ type: 'expense', amount: '3000', date: '2026-10-09', categoryId: shop, from: card(cc.id) });
  await store.createTransaction({ type: 'refund', amount: '1000', date: '2026-10-12', categoryId: shop, to: card(cc.id) });
  let s = periodSummary(store.db, '2026-10');
  assert.equal(s.expenses, 200000);
  assert.equal(s.refunds, 100000);
  assert.equal(owed(store, cc.id), 200000);

  await store.createTransaction({ type: 'reversal', amount: '2000', date: '2026-10-13', reversesId: buy.id });
  s = periodSummary(store.db, '2026-10');
  assert.equal(s.expenses, 0);
  assert.equal(owed(store, cc.id), 0);
  assert.equal(bal(store, bank.id), 10000000);

  await assert.rejects(store.createTransaction({ type: 'reversal', amount: '1001', date: '2026-10-13', reversesId: buy.id }), /at most ₹1,000/);
  await assert.rejects(store.deleteTransaction(buy.id), /reversal first/);
});

test('editing and deleting transactions update totals', async () => {
  const { store, bank } = await setupBook();
  const food = cat(store, 'expense', 'Breakfast');
  const { transaction } = await store.createTransaction({ type: 'expense', amount: '500', date: '2026-10-10', categoryId: food, from: acc(bank.id) });
  await store.updateTransaction(transaction.id, { ...transaction, amount: '750' });
  assert.equal(bal(store, bank.id), 10000000 - 75000);
  await store.deleteTransaction(transaction.id);
  assert.equal(bal(store, bank.id), 10000000);
  assert.equal(periodSummary(store.db, '2026-10').expenses, 0);
});

test('manual reconciliation is respected and later postings add on top', async () => {
  const { store, bank } = await setupBook();
  const food = cat(store, 'expense', 'Breakfast');
  await store.createTransaction({ type: 'expense', amount: '100', date: '2026-10-05', categoryId: food, from: acc(bank.id) });
  await store.recordSnapshot('account', bank.id, { date: '2026-10-10', value: '90000', note: 'Bank app balance' });
  assert.equal(bal(store, bank.id), 9000000);
  // A late import dated before the reconciliation does not move the reconciled balance …
  await store.createTransaction({ type: 'expense', amount: '200', date: '2026-10-08', categoryId: food, from: acc(bank.id) });
  assert.equal(bal(store, bank.id), 9000000);
  // … but it still shows in the month's spending, and newer activity adds on top.
  assert.equal(periodSummary(store.db, '2026-10').expenses, 30000);
  await store.createTransaction({ type: 'expense', amount: '50', date: '2026-10-11', categoryId: food, from: acc(bank.id) });
  assert.equal(bal(store, bank.id), 8995000);
});

test('asset valuations, gains and FD maturity without double counting', async () => {
  const { store, bank } = await setupBook();
  const fd = await store.addAsset({ name: 'FD', type: 'fd', openedOn: '2026-01-01' }, { mode: 'account', accountId: bank.id, amount: '50000', date: '2026-01-01' });
  await store.recordSnapshot('asset', fd.id, { date: '2026-09-30', value: '52000' });
  let a = store.totals().assets.find((x) => x.id === fd.id);
  assert.equal(a.value, 5200000);
  assert.equal(a.gain, 200000);
  assert.equal(Math.round(a.gainPct), 4);
  const nwBefore = store.totals().netWorth;

  await store.closeAsset(fd.id, { accountId: bank.id, amountReceived: '52500', date: '2026-10-14', status: 'matured' });
  a = store.totals().assets.find((x) => x.id === fd.id);
  assert.equal(a.value, 0);
  assert.equal(a.status, 'matured');
  assert.equal(bal(store, bank.id), 5000000 + 5250000);
  // Only the extra ₹500 is new income; returned principal is a transfer.
  const s = periodSummary(store.db, '2026-10');
  assert.equal(s.income, 50000);
  assert.equal(store.totals().netWorth, nwBefore + 50000);
});

test('zero cost basis gives no gain percentage', async () => {
  const { store } = await setupBook();
  const gift = await store.addAsset({ name: 'Gifted shares', type: 'stock' }, { mode: 'existing', invested: '0', value: '1000' });
  const a = store.totals().assets.find((x) => x.id === gift.id);
  assert.equal(a.gain, null);
  assert.equal(a.gainPct, null);
});

test('net worth = assets − liabilities, liquid excludes investments', async () => {
  const { store, bank, cc } = await setupBook();
  await store.addAsset({ name: 'Gold', type: 'gold' }, { mode: 'existing', invested: '10000', value: '12000' });
  await store.addAsset({ name: 'Locker cash', type: 'other_asset', liquid: true }, { mode: 'existing', value: '500' });
  await store.addAsset({ name: 'Bike', type: 'other_asset' }, { mode: 'existing', value: '40000' });
  await store.createTransaction({ type: 'expense', amount: '1000', date: '2026-10-10', categoryId: cat(store, 'expense', 'Shopping'), from: card(cc.id) });
  const t = store.totals();
  assert.equal(t.liquid, (100000 + 2000 + 500) * 100);
  assert.equal(t.investments, 1200000);
  assert.equal(t.otherAssets, 4000000);
  assert.equal(t.totalAssets, t.liquid + t.investments + t.otherAssets);
  assert.equal(t.totalLiabilities, 100000);
  assert.equal(t.netWorth, t.totalAssets - t.totalLiabilities);
  assert.ok(bank);
});

test('validation rejects bad input', async () => {
  const { store, bank } = await setupBook();
  const food = cat(store, 'expense', 'Breakfast');
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '0', date: '2026-10-10', categoryId: food }), /more than ₹0/);
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '10', date: '2026-02-30', categoryId: food }), /valid date/);
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-10', categoryId: cat(store, 'income', 'Salary') }), /category/);
  await assert.rejects(store.createTransaction({ type: 'transfer', amount: '10', date: '2026-10-10', from: acc(bank.id), to: acc(bank.id) }), /different/);
  await assert.rejects(store.createTransaction({ type: 'investment', amount: '10', date: '2026-10-10', from: acc(bank.id) }), /where the money goes/);
  assert.equal(store.db.transactions.length, 0);
});

test('a failed save rolls back the change', async () => {
  const storage = (await import('./helpers.js')).memoryStorage();
  const { store } = await freshStore({ storage });
  const food = cat(store, 'expense', 'Breakfast');
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-10', categoryId: food }), /run out of storage/);
  assert.equal(store.db.transactions.length, 0);
});

test('demo data matches the illustrative October figures and removes cleanly', async () => {
  const { store } = await setupBook();
  const real = await store.createTransaction({ type: 'expense', amount: '99', date: '2026-10-10', categoryId: cat(store, 'expense', 'Groceries') });
  await store.loadDemoData();
  const s = periodSummary(store.db, '2026-10');
  assert.equal(s.income, 6500000);
  assert.equal(s.expenses, 2550000 + 9900);
  await assert.rejects(store.loadDemoData(), /already loaded/);
  await store.removeDemoData();
  assert.equal(store.hasDemoData(), false);
  assert.deepEqual(store.db.transactions.map((t) => t.id), [real.transaction.id]);
  assert.equal(store.db.accounts.length, 2);
  assert.ok(store.db.netWorthHistory.every((h) => !h.sample));
});
