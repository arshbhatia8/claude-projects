const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackend } = require('../public/js/backend');

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
}

test('encrypted vault: setup, CRUD, summary, lock/unlock', async () => {
  const storage = memoryStorage();
  const be = createBackend({ storage, session: memoryStorage() });
  assert.deepEqual(await be.status(), { setUp: false, signedIn: false });
  await assert.rejects(be.request('/transactions'), /Locked/);
  await be.setup('secret123');

  const month = new Date().toISOString().slice(0, 7);
  const add = (b) => be.request('/transactions', { method: 'POST', body: { date: `${month}-01`, ...b } });
  await add({ type: 'credit', amount: 50000, category: 'Salary' });
  await add({ type: 'debit', amount: 1200.5, category: 'Groceries', payment_mode: 'UPI' });
  const inv = await add({ type: 'investment', amount: 5000, category: 'Mutual Fund (SIP)', invested_in: 'Nifty 50 Index', platform: 'Groww' });
  await assert.rejects(add({ type: 'other', amount: 1 }), /Type/);
  await assert.rejects(add({ type: 'debit', amount: -5 }), /Amount/);

  const updated = await be.request(`/transactions/${inv.id}`, { method: 'PUT', body: { ...inv, amount: 6000 } });
  assert.equal(updated.amount, 6000);

  const sum = await be.request(`/summary?month=${month}`);
  assert.deepEqual(sum.totals, { credit: 50000, debit: 1200.5, investment: 6000 });
  assert.equal(sum.net, 50000 - 1200.5 - 6000);
  assert.equal((await be.request('/transactions?type=investment')).length, 1);
  assert.equal((await be.request('/transactions?q=nifty')).length, 1);
  assert.match(await be.request('/export.csv'), /^date,type,amount/);

  // Nothing readable is stored in plain text.
  const stored = storage.getItem('ledger.vault.v1');
  assert.ok(!stored.includes('Nifty'));

  be.lock();
  const fresh = createBackend({ storage, session: memoryStorage() });
  assert.deepEqual(await fresh.status(), { setUp: true, signedIn: false });
  await assert.rejects(fresh.unlock('wrong-pass'), /Wrong password/);
  await fresh.unlock('secret123');
  assert.equal((await fresh.request('/transactions')).length, 3);

  await fresh.changePassword('secret123', 'newpass99');
  const again = createBackend({ storage, session: memoryStorage() });
  await assert.rejects(again.unlock('secret123'), /Wrong password/);
  await again.unlock('newpass99');

  // Backup round trip
  const backup = again.exportBackup();
  await again.request(`/transactions/${inv.id}`, { method: 'DELETE' });
  assert.equal((await again.request('/transactions')).length, 2);
  assert.equal((await again.importBackup(backup)).imported, 3);

  // Gmail dedupe: a seen email is never imported twice
  assert.equal(again.importParsed('m1', { type: 'debit', amount: 99, date: `${month}-02`, category: 'Food & Dining' }), true);
  assert.equal(again.isSeen('m1'), true);
  assert.equal(again.importParsed('m1', { type: 'debit', amount: 99, date: `${month}-02` }), false);
});
