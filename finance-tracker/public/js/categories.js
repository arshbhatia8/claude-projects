// Options shown in the "Add transaction" form. Free text is still accepted,
// so these are suggestions, not a hard list.
(function (root) {
const LedgerCategories = {
  categories: {
    debit: [
      'Food & Dining', 'Groceries', 'Shopping', 'Transport', 'Fuel', 'Rent', 'Bills & Utilities',
      'Mobile & Internet', 'Health', 'Education', 'Entertainment', 'Travel', 'Subscriptions',
      'EMI / Loan', 'Insurance', 'Taxes', 'Gifts & Donations', 'Personal Care', 'Transfer Out', 'Other',
    ],
    credit: [
      'Salary', 'Freelance', 'Business', 'Interest', 'Dividend', 'Refund', 'Cashback',
      'Gift', 'Rental Income', 'Investment Return', 'Transfer In', 'Other',
    ],
    investment: [
      'Mutual Fund (SIP)', 'Mutual Fund (Lumpsum)', 'Stocks', 'ETF', 'Fixed Deposit',
      'Recurring Deposit', 'PPF', 'NPS', 'EPF / VPF', 'Gold / SGB', 'Bonds', 'Crypto',
      'Real Estate', 'Other',
    ],
  },
  paymentModes: ['UPI', 'Debit Card', 'Credit Card', 'Net Banking', 'Cash', 'Wallet', 'Cheque', 'Auto-debit', 'Other'],
};
if (typeof module === 'object' && module.exports) module.exports = LedgerCategories;
else root.LedgerCategories = LedgerCategories;
})(typeof self !== 'undefined' ? self : this);
