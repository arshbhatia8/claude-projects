import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, cat } from './helpers.js';
import { possibleDuplicate } from '../public/js/core/duplicates.js';

test('flags forwarded alerts and manually entered twins', async () => {
  const { store } = await freshStore();
  await store.createTransaction({ type: 'expense', amount: '450', date: '2026-10-14', categoryId: cat(store, 'expense', 'Food and Dining'), description: 'Swiggy (typed by hand)' });
  const parsed = { type: 'expense', amount: 45000, date: '2026-10-14', description: 'swiggy@icici', categoryName: 'Food and Dining', reference: '628312345678', confidence: 'high' };
  await store.addGmailCandidates([
    { messageId: 'orig', emailDate: '2026-10-14', sender: 'alerts@hdfcbank.net', subject: 'UPI', parsed },
    { messageId: 'fwd', emailDate: '2026-10-14', sender: 'me@gmail.com', subject: 'Fwd: UPI', parsed },
    { messageId: 'other', emailDate: '2026-10-01', sender: 'alerts@hdfcbank.net', subject: 'UPI', parsed: { ...parsed, amount: 99900, date: '2026-10-01', reference: '' } },
  ]);
  const [orig, fwd, other] = store.db.gmailCandidates;
  assert.match(possibleDuplicate(store.db, orig).reason, /same reference|Same amount/i);
  assert.match(possibleDuplicate(store.db, fwd).reason, /reference/);
  assert.equal(possibleDuplicate(store.db, other), null);
});
