import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSmartEntry, wordsToDigits } from '../public/js/core/smart.js';
import { defaultCategories } from '../public/js/core/defaults.js';

const TODAY = '2026-10-16';
const cats = defaultCategories();
const cat = (name) => cats.find((c) => c.name === name).id;
const base = (extra = {}) => ({ today: TODAY, categories: cats, accounts: [], liabilities: [], assets: [], rules: [], ...extra });
const accounts = [
  { id: 'a1', name: 'HDFC Savings', institution: 'HDFC Bank', type: 'savings', identifier: '1234' },
  { id: 'a2', name: 'Cash in hand', institution: '', type: 'cash' },
];

test('number words and Indian amounts', () => {
  assert.equal(wordsToDigits('forty rupees'), '40 rupees');
  assert.equal(wordsToDigits('fifty-four thousand rupees'), '54000 rupees');
  assert.equal(wordsToDigits('one lakh twenty thousand'), '120000');
  assert.equal(wordsToDigits('eight hundred'), '800');
  assert.equal(wordsToDigits('a thousand'), '1000');
  assert.equal(parseSmartEntry('I spent 1.5 lakh on a bike', base()).tx.amount, 15000000);
  assert.equal(parseSmartEntry('paid 54k for rent', base()).tx.amount, 5400000);
});

test('Example A: dosa for breakfast → Breakfast / Dosa / ₹40 / today', () => {
  const r = parseSmartEntry('I spent ₹40 on dosa for breakfast today.', base());
  assert.equal(r.intent, 'expense');
  assert.equal(r.tx.categoryId, cat('Breakfast'));
  assert.equal(r.tx.description, 'Dosa');
  assert.equal(r.tx.amount, 4000);
  assert.equal(r.tx.date, TODAY);
  assert.deepEqual(r.questions, []);
});

test('category/description mapping examples', () => {
  const cases = [
    ['I ate dosa for breakfast for ₹40', 'Breakfast', 'Dosa'],
    ['I bought idli for breakfast ₹50', 'Breakfast', 'Idli'],
    ['I bought samosas for snacks ₹30', 'Snacks', 'Samosa'],
    ['I paid ₹600 for dinner', 'Dinner', 'Dinner'],
    ['I bought groceries for ₹850', 'Groceries', 'Groceries'],
    ['I spent ₹850 on groceries.', 'Groceries', 'Groceries'],
    ['spent ₹120 on lunch', 'Lunch', 'Lunch'],
    ['I spent forty rupees on dosa for breakfast', 'Breakfast', 'Dosa'],
    ['I paid eight hundred rupees for groceries', 'Groceries', 'Groceries'],
    ['paid ₹90 for auto to office', 'Transport', 'Auto'],
    ['haircut ₹200', 'Personal Care', 'Personal Care'],
  ];
  for (const [text, category, description] of cases) {
    const r = parseSmartEntry(text, base());
    assert.equal(r.intent, 'expense', text);
    assert.equal(r.tx.categoryId, cat(category), `${text} → category`);
    assert.equal(r.tx.description, description, `${text} → description`);
  }
  // Item keeps its own words and never becomes a category
  const g = parseSmartEntry('I bought milk, eggs and bread for ₹320 groceries', base());
  assert.equal(g.tx.categoryId, cat('Groceries'));
  assert.match(g.tx.description, /milk, eggs and bread/i);
});

test('Example C: salary credited → Income / Salary / ₹54,000 / today', () => {
  const r = parseSmartEntry('My salary of ₹54,000 was credited today.', base({ accounts }));
  assert.equal(r.intent, 'income');
  assert.equal(r.tx.categoryId, cats.find((c) => c.kind === 'income' && c.name === 'Salary').id);
  assert.equal(r.tx.description, 'Salary credited');
  assert.equal(r.tx.amount, 5400000);
  assert.equal(r.tx.date, TODAY);
  const spoken = parseSmartEntry('I received fifty-four thousand rupees as salary', base());
  assert.equal(spoken.intent, 'income');
  assert.equal(spoken.tx.amount, 5400000);
});

test('Example D: FD → asset, not an expense; details extracted', () => {
  const r = parseSmartEntry('I opened an FD with XYZ Bank for ₹50,000 at 6.5% interest, maturing on 16 October 2027.', base({ accounts }));
  assert.equal(r.intent, 'fd_create');
  assert.equal(r.asset.type, 'fd');
  assert.equal(r.asset.institution, 'XYZ Bank');
  assert.equal(r.asset.interestRate, '6.5');
  assert.equal(r.asset.maturityDate, '2027-10-16');
  assert.equal(r.funding.amount, 5000000);
  assert.equal(r.funding.mode, 'ask'); // which account paid is not invented
  assert.ok(r.questions.some((q) => /account/.test(q)));
  const plain = parseSmartEntry('I opened an FD for fifty thousand rupees', base());
  assert.equal(plain.intent, 'fd_create');
  assert.equal(plain.funding.amount, 5000000);
  assert.ok(plain.questions.some((q) => /bank/i.test(q)));
});

test('FD that matches an existing one is flagged so it is not duplicated', () => {
  const assets = [{ id: 'fd1', name: 'XYZ Bank FD', institution: 'XYZ Bank', type: 'fd', status: 'active', invested: 5000000 }];
  const r = parseSmartEntry('I opened an FD with XYZ Bank for ₹50,000', base({ assets }));
  assert.deepEqual(r.duplicates.map((d) => d.id), ['fd1']);
  const v = parseSmartEntry('My XYZ Bank FD is now worth ₹51,200', base({ assets }));
  assert.equal(v.intent, 'asset_value');
  assert.equal(v.assetId, 'fd1');
  assert.equal(v.snapshot.value, 5120000);
});

test('Example E and RD installments', () => {
  const r = parseSmartEntry('I started an RD with XYZ Bank for ₹5,000 per month.', base());
  assert.equal(r.intent, 'rd_create');
  assert.equal(r.asset.monthlyInstallment, 500000);
  assert.equal(r.asset.installmentsBefore, 0);
  assert.equal(r.funding.invested, 0); // future installments are not assumed paid
  const rds = [{ id: 'rd1', name: 'XYZ Bank RD', institution: 'XYZ Bank', type: 'rd', status: 'active', monthlyInstallment: 500000 }];
  const c = parseSmartEntry('I deposited five thousand rupees into my RD', base({ assets: rds, accounts }));
  assert.equal(c.intent, 'rd_contribution');
  assert.equal(c.tx.type, 'investment');
  assert.deepEqual(c.tx.to, { kind: 'asset', id: 'rd1' });
  assert.equal(c.tx.amount, 500000);
});

test('Example F: investment is not an expense', () => {
  const r = parseSmartEntry('I invested ₹2,000 in stocks today.', base({ accounts }));
  assert.equal(r.intent, 'investment_new_asset');
  assert.equal(r.asset.type, 'stock');
  assert.equal(r.funding.amount, 200000);
  const withHolding = parseSmartEntry('I invested ₹2,000 in stocks from HDFC', base({ accounts, assets: [{ id: 's1', name: 'My stocks', type: 'stock', status: 'active' }] }));
  assert.equal(withHolding.intent, 'investment');
  assert.equal(withHolding.tx.type, 'investment');
  assert.deepEqual(withHolding.tx.from, { kind: 'account', id: 'a1' });
});

test('accounts, cards and payment methods are matched, never invented', () => {
  const liabilities = [{ id: 'c1', name: 'ICICI Amazon card', institution: 'ICICI', type: 'credit_card', identifier: '4321' }];
  const r = parseSmartEntry('Paid ₹499 for shoes on my ICICI card', base({ accounts, liabilities }));
  assert.deepEqual(r.tx.from, { kind: 'liability', id: 'c1' });
  assert.equal(r.tx.categoryId, cat('Shopping'));
  const cash = parseSmartEntry('spent 30 on chai in cash', base({ accounts }));
  assert.deepEqual(cash.tx.from, { kind: 'account', id: 'a2' });
  assert.equal(cash.tx.categoryId, cat('Snacks'));
  const none = parseSmartEntry('spent ₹30 on samosa for snacks', base({ accounts }));
  assert.equal(none.tx.from, null);
  const bill = parseSmartEntry('Paid ₹4,500 credit card bill from HDFC', base({ accounts, liabilities }));
  assert.equal(bill.intent, 'transfer');
  assert.deepEqual(bill.tx.to, { kind: 'liability', id: 'c1' });
  assert.deepEqual(bill.tx.from, { kind: 'account', id: 'a1' });
});

test('ambiguous, incomplete and future statements ask instead of guessing', () => {
  const noAmount = parseSmartEntry('I had dosa for breakfast', base());
  assert.equal(noAmount.tx.amount, null);
  assert.ok(noAmount.questions.some((q) => /how much/i.test(q)));
  const noCategory = parseSmartEntry('I paid ₹500', base());
  assert.equal(noCategory.tx.categoryId, '');
  assert.ok(noCategory.questions.some((q) => /category/i.test(q)));
  const unclear = parseSmartEntry('₹500 Rahul', base());
  assert.ok(['unknown', 'expense'].includes(unclear.intent));
  assert.ok(unclear.questions.length > 0);
  const vague = parseSmartEntry('hello there', base());
  assert.equal(vague.intent, 'unknown');
  const future = parseSmartEntry('I will pay ₹14,000 rent next month', base());
  assert.equal(future.intent, 'planned');
  const expected = parseSmartEntry('Salary of ₹54,000 is expected on 1 November', base());
  assert.equal(expected.intent, 'planned');
  const income = parseSmartEntry('I received ₹500', base());
  assert.equal(income.intent, 'income');
  assert.equal(income.tx.categoryId, '');
  assert.ok(income.questions.some((q) => /kind of income/i.test(q)));
});

test('dates: yesterday and explicit dates; a year alone is not an amount', () => {
  assert.equal(parseSmartEntry('spent ₹60 on idli for breakfast yesterday', base()).tx.date, '2026-10-15');
  assert.equal(parseSmartEntry('paid ₹300 for dinner on 3 October', base()).tx.date, '2026-10-03');
  assert.equal(parseSmartEntry('paid ₹300 for dinner on 03/10/2026', base()).tx.date, '2026-10-03');
  const r = parseSmartEntry('opened FD with SBI for ₹10,000 maturing 16 Oct 2027', base());
  assert.equal(r.funding.amount, 1000000);
  assert.equal(r.asset.maturityDate, '2027-10-16');
});

test('your own keyword rules override the built-in mapping', () => {
  const r = parseSmartEntry('spent ₹250 on chai with team', base({ rules: [{ keyword: 'chai', categoryId: cat('Other Expenses') }] }));
  assert.equal(r.tx.categoryId, cat('Other Expenses'));
  assert.equal(r.tx.description, 'Chai');
});
