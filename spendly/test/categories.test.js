import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, emptyDb } from '../public/js/core/store.js';
import { periodSummary } from '../public/js/core/ledger.js';
import { freshStore, cat } from './helpers.js';

test('fresh books: short Quick Add categories, no item names in categories', async () => {
  const { store } = await freshStore();
  const quick = store.db.categories.filter((c) => c.quick).map((c) => c.name);
  assert.deepEqual(quick, ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Personal Care', 'Other Expenses']);
  for (const c of store.db.categories) {
    assert.ok(c.name.split(' ').length <= 2, `${c.name} is one or two words`);
    assert.ok(!/–|-/.test(c.name), `${c.name} has no "Item – Detail" form`);
  }
});

test('dosa, idli and poha are descriptions grouped under Breakfast; descriptions never create categories', async () => {
  const { store } = await freshStore();
  const n = store.db.categories.length;
  const add = (category, description, amount) => store.createTransaction({ type: 'expense', amount, date: '2026-10-16', categoryId: cat(store, 'expense', category), description });
  await add('Breakfast', 'Dosa', '40');
  await add('Breakfast', 'Idli', '50');
  await add('Breakfast', 'Poha', '35');
  await add('Snacks', 'Samosa', '30');
  await add('Snacks', 'Tea', '15');
  await add('Lunch', 'Thali', '120');
  await add('Dinner', 'Dinner', '200');
  await add('Groceries', 'Milk, eggs and bread', '320');
  assert.equal(store.db.categories.length, n, 'no categories added');
  const s = periodSummary(store.db, '2026-10');
  const total = (name) => s.expenseByCategory.find((r) => r.categoryId === cat(store, 'expense', name))?.total;
  assert.equal(total('Breakfast'), 12500);
  assert.equal(total('Snacks'), 4500);
  assert.equal(total('Lunch'), 12000);
  assert.equal(total('Dinner'), 20000);
  assert.equal(total('Groceries'), 32000);
  assert.deepEqual(store.db.transactions.filter((t) => t.categoryId === cat(store, 'expense', 'Breakfast')).map((t) => t.description), ['Dosa', 'Idli', 'Poha']);
});

test('a Breakfast template has no item; each use can carry its own description and amount', async () => {
  const { store } = await freshStore();
  const tpl = await store.saveTemplate({ name: 'Breakfast', type: 'expense', categoryId: cat(store, 'expense', 'Breakfast') });
  assert.equal(store.db.transactions.length, 0, 'a template alone records nothing');
  await store.createTransaction({ type: 'expense', amount: '40', date: '2026-10-16', categoryId: tpl.categoryId, description: 'Dosa' }, { templateId: tpl.id });
  await store.createTransaction({ type: 'expense', amount: '50', date: '2026-10-16', categoryId: tpl.categoryId, description: 'Idli' }, { templateId: tpl.id });
  assert.deepEqual(store.db.transactions.map((t) => [t.description, t.amount]), [['Dosa', 4000], ['Idli', 5000]]);
  assert.equal(store.db.templates.length, 1);
});

test('Quick Add tiles are customisable', async () => {
  const { store } = await freshStore();
  await store.setCategoryQuick(cat(store, 'expense', 'Bills'), false);
  await store.addCategory({ kind: 'expense', name: 'Pets', quick: true });
  const quick = store.db.categories.filter((c) => c.quick).map((c) => c.name);
  assert.ok(!quick.includes('Bills') && quick.includes('Pets'));
  await store.saveSmartRule({ keyword: 'Chai', categoryId: cat(store, 'expense', 'Snacks') });
  assert.deepEqual(store.db.settings.smartRules, [{ keyword: 'chai', categoryId: cat(store, 'expense', 'Snacks') }]);
});

test('v2 → v3 migration renames defaults in place, converts old item templates, keeps every record', () => {
  // A schema-2 vault as written by the previous version.
  const v2 = emptyDb(new Date('2026-10-01T00:00:00Z'));
  v2.schema = 2;
  v2.categories = v2.categories.filter((c) => c.kind === 'income');
  const old = ['Rent and Electricity', 'Family Contribution', 'Food and Dining', 'Groceries', 'Travel and Transport', 'Shopping', 'Subscriptions', 'Credit Card Purchases', 'Education', 'Content Creation', 'Personal Expenses', 'Other Expenses'];
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  for (const name of old) v2.categories.push({ id: `cat_ex_${slug(name)}`, kind: 'expense', name, parentId: null, archived: false });
  v2.categories.find((c) => c.name === 'Shopping').name = 'My Shopping'; // user's own rename must survive
  delete v2.drafts;
  const t = (id, cat, description) => ({ id, type: 'expense', amount: 1000, date: '2026-10-01', time: '', description, categoryId: cat, subcategoryId: null, from: null, to: null, reversesId: null, notes: '', paymentMethod: '', externalRef: '', source: 'manual', gmailMessageId: null, templateId: null, createdAt: 'x', updatedAt: 'x' });
  v2.transactions = [t('t1', 'cat_ex_food_and_dining', 'Dosa'), t('t2', 'cat_ex_travel_and_transport', 'Auto'), t('t3', 'cat_ex_personal_expenses', 'Gift')];
  const tpl = (name, cat, extra) => ({ id: `tp_${slug(name)}`, name, type: 'expense', amount: null, description: name.replace(' – ', ' · '), notes: '', paymentMethod: '', categoryId: cat, subcategoryId: null, from: null, to: null, pinned: false, useCount: 0, lastUsedAt: null, createdAt: 'c', updatedAt: 'c', ...extra });
  v2.templates = [
    tpl('Breakfast – Dosa', 'cat_ex_food_and_dining', { useCount: 5, pinned: true, amount: 6000 }),
    tpl('Breakfast – Idli', 'cat_ex_food_and_dining'), // never used, never edited → removed
    tpl('Lunch', 'cat_ex_food_and_dining', { useCount: 2 }),
    tpl('Cab / Auto', 'cat_ex_travel_and_transport', { updatedAt: 'edited' }),
    tpl('Office coffee', 'cat_ex_food_and_dining', { useCount: 9 }), // the user's own template: untouched
  ];
  const before = JSON.stringify(v2.transactions);
  const db = migrate(structuredClone(v2), new Date('2026-10-16T00:00:00Z'));
  assert.equal(db.schema, 3);
  const name = (id) => db.categories.find((c) => c.id === id)?.name;
  assert.equal(name('cat_ex_travel_and_transport'), 'Transport');
  assert.equal(name('cat_ex_food_and_dining'), 'Eating Out');
  assert.equal(name('cat_ex_rent_and_electricity'), 'Rent');
  assert.equal(name('cat_ex_shopping'), 'My Shopping', 'user rename kept');
  assert.equal(db.categories.find((c) => c.id === 'cat_ex_credit_card_purchases').archived, true, 'unused confusing default archived');
  assert.equal(db.categories.find((c) => c.id === 'cat_ex_personal_expenses').archived, false, 'used category stays active');
  for (const n of ['Breakfast', 'Lunch', 'Snacks', 'Dinner', 'Bills', 'Personal Care']) assert.ok(db.categories.some((c) => c.name === n && c.quick), `${n} added`);
  assert.equal(JSON.stringify(db.transactions), before, 'transactions not modified');
  const tp = Object.fromEntries(db.templates.map((x) => [x.id, x]));
  assert.deepEqual([tp.tp_breakfast_dosa.name, tp.tp_breakfast_dosa.categoryId, tp.tp_breakfast_dosa.description, tp.tp_breakfast_dosa.useCount, tp.tp_breakfast_dosa.amount], ['Dosa', 'cat_ex_breakfast', 'Dosa', 5, 6000]);
  assert.equal(tp.tp_breakfast_idli, undefined);
  assert.equal(tp.tp_lunch.categoryId, 'cat_ex_lunch');
  assert.equal(tp.tp_cab_auto.categoryId, 'cat_ex_travel_and_transport');
  assert.equal(tp.tp_office_coffee.categoryId, 'cat_ex_food_and_dining');
  assert.equal(tp.tp_office_coffee.name, 'Office coffee');
  assert.deepEqual(db.drafts, []);
  // Running it again changes nothing
  assert.equal(JSON.stringify(migrate(structuredClone(db))), JSON.stringify(db));
});
