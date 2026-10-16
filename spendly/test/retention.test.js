// Data retention: permanent records never expire; only drafts have a (≥30-day) lifetime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, VAULT_KEY, DRAFT_RETENTION_DAYS } from '../public/js/core/store.js';
import { memoryStorage, cat } from './helpers.js';

const DAY = 864e5;
const T0 = Date.parse('2026-10-16T04:30:00Z');

/** A store whose clock can be moved forward to simulate not opening Spendly. */
function clockedStore(storage, clock) {
  return createStore({ storage, session: memoryStorage(), now: () => new Date(clock.t) });
}

async function richBook() {
  const storage = memoryStorage();
  const clock = { t: T0 };
  const store = clockedStore(storage, clock);
  await store.setup('correct horse');
  const bank = await store.saveAccount({ name: 'HDFC Savings', type: 'savings', openingBalance: '50000' });
  await store.saveLiability({ name: 'Card', type: 'credit_card', openingOutstanding: '1000' });
  await store.createTransaction({ type: 'expense', amount: '40', date: '2026-10-16', categoryId: cat(store, 'expense', 'Breakfast'), description: 'Dosa', from: { kind: 'account', id: bank.id } });
  await store.createTransaction({ type: 'income', amount: '54000', date: '2026-10-16', categoryId: cat(store, 'income', 'Salary'), to: { kind: 'account', id: bank.id } });
  const fd = await store.addAsset({ name: 'XYZ FD', type: 'fd', maturityDate: '2027-10-16' }, { mode: 'account', accountId: bank.id, amount: '10000', date: '2026-10-16' });
  await store.addAsset({ name: 'RD', type: 'rd', monthlyInstallment: '5000' }, { mode: 'existing', invested: '0', value: '0' });
  await store.addAsset({ name: 'NIFTYBEES', type: 'etf' }, { mode: 'existing', invested: '2000', value: '2100' });
  await store.recordSnapshot('asset', fd.id, { date: '2026-10-16', value: '10050' });
  await store.saveGoal({ name: 'Emergency', kind: 'emergency', target: '100000', current: '1000' });
  await store.saveTemplate({ name: 'Breakfast', type: 'expense', categoryId: cat(store, 'expense', 'Breakfast') });
  await store.addCategory({ kind: 'expense', name: 'Pets', quick: true });
  await store.updateSettings({ dateFormat: 'DD/MM/YYYY' });
  return { storage, clock, store };
}

const fingerprint = (db) => JSON.stringify({
  t: db.transactions.length, a: db.accounts.length, as: db.assets.length, l: db.liabilities.length, g: db.goals.length,
  c: db.categories.length, tp: db.templates.length, sn: db.snapshots.length, df: db.settings.dateFormat,
});

for (const days of [8, 31, 400]) {
  test(`permanent records survive ${days} days without opening Spendly`, async () => {
    const { storage, clock, store } = await richBook();
    const before = fingerprint(store.db);
    store.lock(); // tab closed / session ended
    clock.t += days * DAY;
    const later = clockedStore(storage, clock);
    assert.deepEqual(await later.status(), { setUp: true, signedIn: false });
    await later.unlock('correct horse');
    assert.equal(fingerprint(later.db), before);
    assert.equal(later.db.transactions.find((t) => t.description === 'Dosa').amount, 4000);
  });
}

test(`drafts are kept for at least ${DRAFT_RETENTION_DAYS} days, then cleaned up — and cleanup touches nothing else`, async () => {
  assert.ok(DRAFT_RETENTION_DAYS >= 30);
  const { storage, clock, store } = await richBook();
  await store.saveDraft('tx:new', { amount: '45', description: 'Poha' });
  const before = fingerprint(store.db);

  store.lock();
  clock.t += 29 * DAY;
  let s = clockedStore(storage, clock);
  await s.unlock('correct horse');
  assert.equal(s.getDraft('tx:new').data.description, 'Poha', 'kept at 29 days');
  s.lock();

  clock.t += 2 * DAY; // 31 days after the draft was written
  s = clockedStore(storage, clock);
  await s.unlock('correct horse');
  assert.equal(s.getDraft('tx:new'), null, 'removed after 30 days');
  assert.equal(fingerprint(s.db), before, 'financial records untouched by cleanup');
});

test('a draft updated recently is not cleaned up', async () => {
  const { storage, clock, store } = await richBook();
  await store.saveDraft('smart', { text: 'spent 40 on dosa' });
  clock.t += 25 * DAY;
  await store.saveDraft('smart', { text: 'spent 45 on dosa' });
  store.lock();
  clock.t += 20 * DAY; // 45 days after first write, 20 after last
  const s = clockedStore(storage, clock);
  await s.unlock('correct horse');
  assert.equal(s.getDraft('smart').data.text, 'spent 45 on dosa');
});

test('session expiry, locking and Gmail disconnect never delete data', async () => {
  const { storage, clock, store } = await richBook();
  await store.setGmail({ email: 'me@example.com' });
  await store.setGmail({ email: null }); // disconnect
  const before = fingerprint(store.db);
  store.lock();
  // Session key gone (tab closed): a fresh store sees the vault and asks for the password.
  const s = clockedStore(storage, clock);
  assert.equal((await s.status()).signedIn, false);
  assert.ok(storage.getItem(VAULT_KEY));
  await s.unlock('correct horse');
  assert.equal(fingerprint(s.db), before);
});

test('a failed or silently dropped write is never reported as saved', async () => {
  const { storage, store } = await richBook();
  const n = store.db.transactions.length;
  const savedAt = store.storageInfo().lastSavedAt;
  // 1. The browser throws (quota)
  const realSet = storage.setItem;
  storage.setItem = (k, v) => { if (k === VAULT_KEY) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; } return realSet(k, v); };
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-16', categoryId: cat(store, 'expense', 'Snacks') }), /Not saved/);
  // 2. The browser accepts the call but does not keep the data
  storage.setItem = (k, v) => { if (k !== VAULT_KEY) realSet(k, v); };
  await assert.rejects(store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-16', categoryId: cat(store, 'expense', 'Snacks') }), /did not keep/);
  storage.setItem = realSet;
  assert.equal(store.db.transactions.length, n, 'in-memory data rolled back');
  assert.equal(store.storageInfo().lastSavedAt, savedAt, 'last-saved time not advanced');
  // Next real save works and is recorded
  await store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-16', categoryId: cat(store, 'expense', 'Snacks') });
  assert.equal(store.db.transactions.length, n + 1);
  assert.ok(store.storageInfo().lastSavedAt >= savedAt);
});

test('the code has no expiry or cleanup for anything except drafts', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/js/core/store.js', import.meta.url), 'utf8');
  // Every removal from storage is one of: retiring the migrated legacy vault, the explicit reset, the session key.
  const removals = [...src.matchAll(/removeItem\(([^)]+)\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(removals)].sort(), ['LEGACY_VAULT_KEY', 'SESSION_KEY', 'VAULT_KEY'].sort());
  assert.ok(!/localStorage\.clear|indexedDB\.deleteDatabase/.test(src));
});
