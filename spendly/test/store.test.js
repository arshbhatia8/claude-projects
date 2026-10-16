import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, VAULT_KEY, LEGACY_VAULT_KEY } from '../public/js/core/store.js';
import { memoryStorage, freshStore, cat, acc, NOW } from './helpers.js';
import { periodSummary } from '../public/js/core/ledger.js';

test('vault is encrypted and needs the password', async () => {
  const { store, storage } = await freshStore();
  await store.createTransaction({ type: 'expense', amount: '60', date: '2026-10-15', description: 'Masala dosa', categoryId: cat(store, 'expense', 'Breakfast') });
  assert.ok(!storage.getItem(VAULT_KEY).includes('dosa'));
  store.lock();
  const again = createStore({ storage, session: memoryStorage(), now: () => NOW });
  assert.deepEqual(await again.status(), { setUp: true, signedIn: false });
  await assert.rejects(again.unlock('wrong password'), /Wrong password/);
  await again.unlock('correct horse');
  assert.equal(again.db.transactions[0].description, 'Masala dosa');
  assert.equal(again.db.settings.revealAmounts, false); // amounts hidden on open
});

test('templates: create, use repeatedly, pin, edit and delete without touching transactions', async () => {
  const { store } = await freshStore();
  const food = cat(store, 'expense', 'Breakfast');
  const bank = await store.saveAccount({ name: 'HDFC', type: 'savings', openingBalance: '1000' });
  const tpl = await store.saveTemplate({ name: 'Breakfast – Dosa', type: 'expense', amount: '60', categoryId: food, from: acc(bank.id), paymentMethod: 'UPI' });
  // Creating a template alone posts nothing.
  assert.equal(store.db.transactions.length, 0);
  assert.equal(store.totals().accounts[0].balance, 100000);

  await store.createTransaction({ type: 'expense', amount: '60', date: '2026-10-14', categoryId: food, from: acc(bank.id), description: 'Dosa' }, { templateId: tpl.id });
  await store.createTransaction({ type: 'expense', amount: '70', date: '2026-10-15', categoryId: food, from: acc(bank.id), description: 'Dosa' }, { templateId: tpl.id });
  assert.equal(store.db.transactions.length, 2);
  assert.deepEqual(store.db.transactions.map((t) => t.amount), [6000, 7000]);
  assert.equal(store.db.templates[0].useCount, 2);
  assert.equal(periodSummary(store.db, '2026-10').expenses, 13000);

  await store.setTemplatePinned(tpl.id, false);
  assert.equal(store.db.templates[0].pinned, false);
  await store.saveTemplate({ ...store.db.templates[0], amount: '80', name: 'Breakfast – Dosa' }, tpl.id);
  assert.deepEqual(store.db.transactions.map((t) => t.amount), [6000, 7000]); // history unchanged
  await assert.rejects(store.saveTemplate({ name: 'breakfast - dosa', type: 'expense', categoryId: food }), /already exists/);
  await store.deleteTemplate(tpl.id);
  assert.equal(store.db.templates.length, 0);
  assert.equal(store.db.transactions.length, 2);
});

test('save-as-template does not create duplicates', async () => {
  const { store } = await freshStore();
  const food = cat(store, 'expense', 'Breakfast');
  const a = await store.createTransaction({ type: 'expense', amount: '20', date: '2026-10-15', categoryId: food, description: 'Chai' }, { saveAsTemplate: { name: 'Tea / Coffee' } });
  assert.ok(a.template);
  const b = await store.createTransaction({ type: 'expense', amount: '25', date: '2026-10-15', categoryId: food, description: 'Chai' }, { saveAsTemplate: { name: 'Tea / coffee' } });
  assert.equal(b.template, null);
  assert.equal(b.templateExists, true);
  assert.equal(store.db.templates.length, 1);
});

test('gmail candidates stay pending, approve exactly once, and resync does not duplicate', async () => {
  const { store } = await freshStore();
  const bank = await store.saveAccount({ name: 'HDFC', type: 'savings', identifier: '1234', openingBalance: '1000' });
  const item = {
    messageId: 'm1', emailDate: '2026-10-14', sender: 'alerts@hdfcbank.net', subject: 'UPI txn', excerpt: 'Rs.450 debited',
    parsed: { type: 'expense', amount: 45000, date: '2026-10-14', description: 'swiggy@icici', categoryName: 'Breakfast', paymentMethod: 'UPI', accountHint: 'XX1234', reference: '987654321012', confidence: 'high' },
  };
  assert.equal(await store.addGmailCandidates([item], { scanned: 1 }), 1);
  assert.equal(store.db.transactions.length, 0); // nothing posted before approval
  assert.equal(periodSummary(store.db, '2026-10').expenses, 0);
  const c = store.db.gmailCandidates[0];
  assert.equal(c.status, 'pending');
  assert.deepEqual(c.suggestion.endpoint, { kind: 'account', id: bank.id });

  const [t1, t2] = await Promise.all([store.approveGmailCandidate(c.id), store.approveGmailCandidate(c.id)]);
  assert.equal(t1.id, t2.id);
  assert.equal(store.db.transactions.length, 1);
  assert.equal(store.totals().accounts[0].balance, 100000 - 45000);

  assert.equal(await store.addGmailCandidates([item], { scanned: 1 }), 0); // re-sync
  assert.equal(store.db.gmailCandidates.length, 1);

  await assert.rejects(store.setGmailCandidateStatus(c.id, 'rejected'), /already imported/);
  // Deleting the imported transaction does not let the email come back on the next sync.
  await store.deleteTransaction(t1.id);
  assert.equal(store.db.gmailCandidates[0].status, 'reviewed');
  assert.equal(await store.addGmailCandidates([item]), 0);
});

test('gmail: edit before import, reject, retry failed', async () => {
  const { store } = await freshStore();
  await store.addGmailCandidates([
    { messageId: 'a', emailDate: '2026-10-10', sender: 'x', subject: 'Credited', parsed: { type: 'income', amount: 500000, date: '2026-10-10', description: 'NEFT', categoryName: 'Salary', confidence: 'medium' } },
    { messageId: 'b', emailDate: '2026-10-11', sender: 'y', subject: 'Spent', parsed: { type: 'expense', amount: 100, date: '2026-10-11', description: 'x', categoryName: 'Nope', confidence: 'low' } },
    { messageId: 'c', emailDate: '2026-10-12', sender: 'z', subject: '?', error: 'Network error' },
  ]);
  const [a, b, c] = store.db.gmailCandidates;
  assert.equal(b.suggestion.categoryId, cat(store, 'expense', 'Other Expenses'));
  assert.equal(c.status, 'failed');
  const edited = { ...store.candidateToInput(a), amount: '5100', categoryId: cat(store, 'income', 'Freelance Income') };
  const tx = await store.approveGmailCandidate(a.id, edited);
  assert.equal(tx.amount, 510000);
  assert.equal(tx.source, 'gmail');
  await store.setGmailCandidateStatus(b.id, 'rejected');
  assert.equal(store.db.gmailCandidates[1].status, 'rejected');
  await store.updateGmailCandidate(c.id, { parsed: { type: 'expense', amount: 999, date: '2026-10-12', description: 'Retry ok', categoryName: 'Shopping', confidence: 'medium' } });
  assert.equal(store.db.gmailCandidates[2].status, 'pending');
  assert.equal(store.db.transactions.length, 1);
});

test('migrates an old Ledger (v1) vault without losing records', async () => {
  // Build a v1 vault with the old format, encrypted the same way.
  const storage = memoryStorage();
  const v1 = {
    transactions: [
      { id: 1, type: 'credit', amount: 85000, date: '2026-09-01', category: 'Salary', description: 'Acme', payment_mode: 'Net Banking', account: 'HDFC XX1234', source: 'manual' },
      { id: 2, type: 'debit', amount: 450.5, date: '2026-09-03', category: 'Food & Dining', description: 'Swiggy', payment_mode: 'UPI', source: 'gmail', gmail_id: 'g1' },
      { id: 3, type: 'investment', amount: 5000, date: '2026-09-05', category: 'Mutual Fund (SIP)', invested_in: 'Parag Parikh Flexi Cap', platform: 'Groww' },
      { id: 4, type: 'debit', amount: 99, date: '2026-09-06', category: 'Pet care', description: 'Custom category' },
    ],
    nextId: 5, gmailSeen: ['g1', 'g2'], settings: { currency: 'INR', googleClientId: 'abc.apps.googleusercontent.com' },
  };
  const subtle = globalThis.crypto.subtle;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle.importKey('raw', new TextEncoder().encode('old-password'), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(v1)));
  const b64 = (u) => Buffer.from(u).toString('base64');
  storage.setItem(LEGACY_VAULT_KEY, JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), data: b64(new Uint8Array(data)) }));

  const store = createStore({ storage, session: memoryStorage(), now: () => NOW });
  assert.deepEqual(await store.status(), { setUp: true, signedIn: false });
  await store.unlock('old-password');
  const db = store.db;
  assert.equal(db.schema, 3);
  assert.equal(db.transactions.length, 4);
  assert.deepEqual(db.transactions.map((t) => t.type), ['income', 'expense', 'investment', 'expense']);
  assert.equal(db.transactions[1].amount, 45050);
  assert.equal(db.transactions[1].gmailMessageId, 'g1');
  assert.equal(db.categories.find((c) => c.id === db.transactions[1].categoryId).name, 'Eating Out');
  assert.equal(db.categories.find((c) => c.id === db.transactions[3].categoryId).name, 'Pet care');
  assert.equal(db.assets[0].name, 'Parag Parikh Flexi Cap');
  assert.equal(db.assets[0].type, 'mutual_fund');
  assert.equal(store.totals().assets[0].value, 500000);
  assert.equal(db.gmail.clientId, 'abc.apps.googleusercontent.com');
  // Old vault retired only after the new one was written.
  assert.equal(storage.getItem(LEGACY_VAULT_KEY), null);
  assert.ok(storage.getItem(VAULT_KEY));
});

test('encrypted backup round-trip needs the backup password', async () => {
  const { store } = await freshStore();
  await store.createTransaction({ type: 'expense', amount: '10', date: '2026-10-15', categoryId: cat(store, 'expense', 'Groceries') });
  const backup = await store.exportBackup();
  assert.ok(!backup.includes('Groceries'));
  await store.deleteTransaction(store.db.transactions[0].id);
  await assert.rejects(store.importBackup(backup, 'nope'), /Wrong password/);
  await store.importBackup(backup, 'correct horse');
  assert.equal(store.db.transactions.length, 1);
});

test('change password re-encrypts', async () => {
  const { store, storage } = await freshStore();
  await store.changePassword('correct horse', 'battery staple');
  const s2 = createStore({ storage, session: memoryStorage(), now: () => NOW });
  await assert.rejects(s2.unlock('correct horse'), /Wrong/);
  await s2.unlock('battery staple');
});
