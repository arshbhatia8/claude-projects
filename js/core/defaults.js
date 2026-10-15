// Built-in lists and starting data. Everything here is a starting point the
// user can rename, archive or extend from Settings.

export const TX_TYPES = {
  expense: { label: 'Expense', verb: 'Save Expense' },
  income: { label: 'Income', verb: 'Save Income' },
  transfer: { label: 'Transfer', verb: 'Save Transfer' },
  investment: { label: 'Investment', verb: 'Save Investment' },
  refund: { label: 'Refund', verb: 'Save Refund' },
  reversal: { label: 'Reversal', verb: 'Save Reversal' },
};

export const INCOME_CATEGORIES = [
  'Salary', 'Mentorship Income', 'Brand Collaborations', 'Freelance Income', 'Business Income',
  'Interest Income', 'Dividends', 'Refunds', 'Other Income',
];

export const EXPENSE_CATEGORIES = [
  'Rent and Electricity', 'Family Contribution', 'Food and Dining', 'Groceries', 'Travel and Transport',
  'Shopping', 'Subscriptions', 'Credit Card Purchases', 'Education', 'Content Creation',
  'Personal Expenses', 'Other Expenses',
];

export const PAYMENT_METHODS = ['UPI', 'Debit Card', 'Credit Card', 'Net Banking', 'Cash', 'Wallet', 'Cheque', 'Auto-debit', 'Other'];

export const ACCOUNT_TYPES = {
  savings: 'Savings Account',
  current: 'Current Account',
  wallet: 'Wallet',
  cash: 'Cash',
  other_liquid: 'Other Liquid Account',
};

// `group` decides which dashboard total an asset counts towards.
export const ASSET_TYPES = {
  fd: { label: 'Fixed Deposit', group: 'investment', section: 'fd' },
  rd: { label: 'Recurring Deposit', group: 'investment', section: 'rd' },
  stock: { label: 'Stock', group: 'investment', section: 'market' },
  mutual_fund: { label: 'Mutual Fund', group: 'investment', section: 'market' },
  etf: { label: 'ETF', group: 'investment', section: 'market' },
  other_investment: { label: 'Other Investment', group: 'investment', section: 'market' },
  gold: { label: 'Digital Gold', group: 'investment', section: 'gold' },
  other_asset: { label: 'Other Asset', group: 'other', section: 'other' },
};

export const ASSET_STATUS = { active: 'Active', matured: 'Matured', closed: 'Closed' };

export const LIABILITY_TYPES = {
  credit_card: 'Credit Card',
  personal_loan: 'Personal Loan',
  other_loan: 'Other Loan',
  other: 'Other Liability',
};

export const GOAL_KINDS = {
  emergency: 'Emergency Fund',
  savings: 'Savings Target',
  investment: 'Investment Target',
  custom: 'Custom Goal',
};

export const DATE_FORMATS = {
  'DD MMM YYYY': '15 Oct 2026',
  'DD/MM/YYYY': '15/10/2026',
  'YYYY-MM-DD': '2026-10-15',
};

// Optional quick-add shortcuts. Added only when the user asks for them.
export const SUGGESTED_TEMPLATES = [
  { name: 'Breakfast – Dosa', category: 'Food and Dining', amount: 6000, pinned: true },
  { name: 'Breakfast – Idli', category: 'Food and Dining', amount: 5000 },
  { name: 'Breakfast – Other', category: 'Food and Dining', amount: null },
  { name: 'Lunch', category: 'Food and Dining', amount: null, pinned: true },
  { name: 'Dinner', category: 'Food and Dining', amount: null },
  { name: 'Tea / Coffee', category: 'Food and Dining', amount: 2000, pinned: true },
  { name: 'Snacks', category: 'Food and Dining', amount: null },
  { name: 'Groceries', category: 'Groceries', amount: null, pinned: true },
  { name: 'Cab / Auto', category: 'Travel and Transport', amount: null },
  { name: 'Petrol', category: 'Travel and Transport', amount: null },
  { name: 'Shopping', category: 'Shopping', amount: null },
];

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function defaultCategories() {
  const cats = [];
  for (const name of INCOME_CATEGORIES) cats.push({ id: `cat_in_${slug(name)}`, kind: 'income', name, parentId: null, archived: false });
  for (const name of EXPENSE_CATEGORIES) cats.push({ id: `cat_ex_${slug(name)}`, kind: 'expense', name, parentId: null, archived: false });
  return cats;
}

/**
 * Clearly-marked demonstration data. Every record carries `sample: true`, so
 * "Remove demo data" can take it all out again without touching real records.
 * Dates are placed in the current and previous month so the dashboard shows them.
 */
export function buildDemoData(today) {
  const [y, m] = today.split('-').map(Number);
  const ym = (offset) => {
    const d = new Date(Date.UTC(y, m - 1 + offset, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const cur = ym(0);
  const prev = ym(-1);
  const day = (month, d) => `${month}-${String(d).padStart(2, '0')}`;
  // Keep every demo date on or before today so nothing sits in the future.
  const clampDay = (d) => Math.min(d, Number(today.slice(8, 10)));
  const c = (name, kind = 'expense') => `cat_${kind === 'income' ? 'in' : 'ex'}_${slug(name)}`;

  const accounts = [
    { id: 'demo_acc_bank', name: 'HDFC Savings (demo)', institution: 'HDFC Bank', type: 'savings', identifier: '1234', openingBalance: 12000000, openingDate: day(prev, 1) },
    { id: 'demo_acc_cash', name: 'Cash in hand (demo)', institution: '', type: 'cash', identifier: '', openingBalance: 300000, openingDate: day(prev, 1) },
  ];
  const liabilities = [
    { id: 'demo_lia_card', name: 'Millennia Card (demo)', institution: 'HDFC Bank', type: 'credit_card', identifier: '4321', openingOutstanding: 0, startDate: day(prev, 1), dueDate: day(cur, 25) },
  ];
  const assets = [
    { id: 'demo_ast_fd', name: 'SBI FD (demo)', type: 'fd', institution: 'State Bank of India', openingInvested: 10000000, openingValue: 10420000, openedOn: '2025-11-10', maturityDate: '2026-11-10', interestRate: '7.1', interestType: 'Quarterly compounding', status: 'active' },
    { id: 'demo_ast_rd', name: 'Post Office RD (demo)', type: 'rd', institution: 'India Post', openingInvested: 2500000, openingValue: 2580000, monthlyInstallment: 500000, tenureMonths: 60, installmentsBefore: 5, openedOn: '2026-05-05', maturityDate: '2031-05-05', status: 'active' },
    { id: 'demo_ast_stock', name: 'NIFTYBEES (demo)', type: 'etf', symbol: 'NIFTYBEES', institution: 'Zerodha', quantity: '150', openingInvested: 4000000, openingValue: 4650000, status: 'active' },
    { id: 'demo_ast_gold', name: 'Digital Gold (demo)', type: 'gold', institution: 'SafeGold', grams: '2.1', openingInvested: 1500000, openingValue: 1720000, status: 'active' },
  ];

  const t = (date, type, amount, extra) => ({ date, type, amount, ...extra });
  const transactions = [
    // Previous month
    t(day(prev, 1), 'income', 6000000, { description: 'Salary', categoryId: c('Salary', 'income'), to: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'Net Banking' }),
    t(day(prev, 18), 'income', 500000, { description: 'Mentorship session', categoryId: c('Mentorship Income', 'income'), to: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(prev, 3), 'expense', 1400000, { description: 'Rent + electricity', categoryId: c('Rent and Electricity'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'Net Banking' }),
    t(day(prev, 5), 'expense', 300000, { description: 'Sent home', categoryId: c('Family Contribution'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(prev, 9), 'expense', 380000, { description: 'Swiggy & cafés', categoryId: c('Food and Dining'), from: { kind: 'liability', id: 'demo_lia_card' }, paymentMethod: 'Credit Card' }),
    t(day(prev, 12), 'expense', 230000, { description: 'Blinkit', categoryId: c('Groceries'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(prev, 20), 'expense', 70000, { description: 'Netflix + Spotify', categoryId: c('Subscriptions'), from: { kind: 'liability', id: 'demo_lia_card' }, paymentMethod: 'Credit Card' }),
    t(day(prev, 6), 'investment', 500000, { description: 'RD installment', from: { kind: 'account', id: 'demo_acc_bank' }, to: { kind: 'asset', id: 'demo_ast_rd' }, paymentMethod: 'Auto-debit' }),
    // Current month: income ₹65,000, expenses ₹25,500, net cash flow ₹39,500
    t(day(cur, 1), 'income', 6000000, { description: 'Salary', categoryId: c('Salary', 'income'), to: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'Net Banking' }),
    t(day(cur, clampDay(10)), 'income', 500000, { description: 'Mentorship session', categoryId: c('Mentorship Income', 'income'), to: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(cur, clampDay(3)), 'expense', 1400000, { description: 'Rent + electricity', categoryId: c('Rent and Electricity'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'Net Banking' }),
    t(day(cur, clampDay(5)), 'expense', 300000, { description: 'Sent home', categoryId: c('Family Contribution'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(cur, clampDay(8)), 'expense', 250000, { description: 'Swiggy & cafés', categoryId: c('Food and Dining'), from: { kind: 'liability', id: 'demo_lia_card' }, paymentMethod: 'Credit Card' }),
    t(day(cur, clampDay(9)), 'expense', 170000, { description: 'Breakfast – Dosa (month)', categoryId: c('Food and Dining'), from: { kind: 'account', id: 'demo_acc_cash' }, paymentMethod: 'Cash' }),
    t(day(cur, clampDay(11)), 'expense', 240000, { description: 'Groceries', categoryId: c('Groceries'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(cur, clampDay(12)), 'expense', 125100, { description: 'Cab / Auto', categoryId: c('Travel and Transport'), from: { kind: 'account', id: 'demo_acc_bank' }, paymentMethod: 'UPI' }),
    t(day(cur, clampDay(13)), 'expense', 64900, { description: 'Netflix', categoryId: c('Subscriptions'), from: { kind: 'liability', id: 'demo_lia_card' }, paymentMethod: 'Credit Card' }),
    t(day(cur, clampDay(6)), 'investment', 500000, { description: 'RD installment', from: { kind: 'account', id: 'demo_acc_bank' }, to: { kind: 'asset', id: 'demo_ast_rd' }, paymentMethod: 'Auto-debit' }),
    t(day(cur, clampDay(7)), 'transfer', 450000, { description: 'Card bill payment', from: { kind: 'account', id: 'demo_acc_bank' }, to: { kind: 'liability', id: 'demo_lia_card' }, paymentMethod: 'Net Banking' }),
  ];

  const goals = [
    { id: 'demo_goal_ef', name: 'Emergency Fund (demo)', kind: 'emergency', target: 30000000, current: 12000000, targetDate: `${y + 1}-03-31` },
  ];

  return { accounts, liabilities, assets, transactions, goals };
}
