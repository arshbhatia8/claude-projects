const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTransactionEmail, htmlToText } = require('../public/js/parser');

const at = Date.parse('2026-10-10T10:00:00');

test('UPI debit to a merchant', () => {
  const tx = parseTransactionEmail({
    subject: 'You have done a UPI txn. Check details!',
    body: 'Dear Customer, Rs.450.00 has been debited from account **1234 to VPA swiggy@icici SWIGGY on 10-10-26. Your UPI transaction reference number is 123456789. Avl Bal Rs 25,000.00',
    internalDate: at,
  });
  assert.equal(tx.type, 'debit');
  assert.equal(tx.amount, 450);
  assert.equal(tx.payment_mode, 'UPI');
  assert.equal(tx.category, 'Food & Dining');
  assert.equal(tx.account, 'XX1234');
  assert.equal(tx.date, '2026-10-10');
  assert.match(tx.description, /swiggy/i);
});

test('salary credit ignores the balance amount', () => {
  const tx = parseTransactionEmail({
    subject: 'Account credited',
    body: 'Available Balance: INR 1,20,000.00. Your A/c XX5678 is credited with INR 85,000.00 on 01-10-26 by NEFT from ACME CORP SALARY.',
    internalDate: at,
  });
  assert.equal(tx.type, 'credit');
  assert.equal(tx.amount, 85000);
  assert.equal(tx.category, 'Salary');
  assert.equal(tx.payment_mode, 'Net Banking');
});

test('credit card spend', () => {
  const tx = parseTransactionEmail({
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    body: 'INR 2,499.00 spent on ICICI Bank Credit Card XX4321 on 09-Oct-26 at AMAZON PAY INDIA. Avl Limit: INR 1,50,000.00',
    internalDate: at,
  });
  assert.equal(tx.type, 'debit');
  assert.equal(tx.amount, 2499);
  assert.equal(tx.payment_mode, 'Credit Card');
  assert.equal(tx.category, 'Shopping');
});

test('SIP investment', () => {
  const tx = parseTransactionEmail({
    subject: 'SIP installment processed',
    from: 'Groww <noreply@groww.in>',
    body: 'Your SIP of ₹5,000 in Parag Parikh Flexi Cap Fund has been processed. Units allotted at NAV 78.12.',
    internalDate: at,
  });
  assert.equal(tx.type, 'investment');
  assert.equal(tx.amount, 5000);
  assert.equal(tx.category, 'Mutual Fund (SIP)');
  assert.equal(tx.platform.toLowerCase(), 'groww');
});

test('refund is a credit', () => {
  const tx = parseTransactionEmail({ subject: 'Refund processed', body: 'Refund of Rs. 799 has been credited to your account.', internalDate: at });
  assert.equal(tx.type, 'credit');
  assert.equal(tx.category, 'Refund');
  assert.equal(tx.amount, 799);
});

test('OTP and statements are ignored', () => {
  assert.equal(parseTransactionEmail({ subject: 'OTP for transaction', body: 'Your OTP for txn of Rs 500 is 123456' }), null);
  assert.equal(parseTransactionEmail({ subject: 'Your credit card statement is ready', body: 'Total amount due Rs 4,000' }), null);
  assert.equal(parseTransactionEmail({ subject: 'Hello', body: 'Lunch tomorrow?' }), null);
});

test('htmlToText strips markup', () => {
  assert.equal(htmlToText('<p>Rs&nbsp;100 <b>debited</b></p><style>x{}</style>'), 'Rs 100 debited');
});
