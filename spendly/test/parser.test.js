import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTransactionEmail, htmlToText, excerptAround } from '../public/js/core/parser.js';

const at = Date.parse('2026-10-10T10:00:00+05:30');

test('UPI debit to a merchant (high confidence)', () => {
  const tx = parseTransactionEmail({
    subject: 'You have done a UPI txn. Check details!',
    from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.net>',
    body: 'Dear Customer, Rs.450.00 has been debited from account **1234 to VPA swiggy@icici SWIGGY on 10-10-26. Your UPI transaction reference number is 628312345678. Avl Bal Rs 25,000.00',
    internalDate: at,
  });
  assert.equal(tx.type, 'expense');
  assert.equal(tx.amount, 45000);
  assert.equal(tx.paymentMethod, 'UPI');
  assert.equal(tx.categoryName, 'Food and Dining');
  assert.equal(tx.accountHint, 'XX1234');
  assert.equal(tx.reference, '628312345678');
  assert.equal(tx.date, '2026-10-10');
  assert.equal(tx.confidence, 'high');
  assert.match(tx.description, /swiggy/i);
});

test('salary credit ignores the balance amount', () => {
  const tx = parseTransactionEmail({
    subject: 'Account credited',
    from: 'alerts@axisbank.com',
    body: 'Available Balance: INR 1,20,000.00. Your A/c XX5678 is credited with INR 85,000.00 on 01-10-26 by NEFT from ACME CORP SALARY.',
    internalDate: at,
  });
  assert.equal(tx.type, 'income');
  assert.equal(tx.amount, 8500000);
  assert.equal(tx.categoryName, 'Salary');
  assert.equal(tx.paymentMethod, 'Net Banking');
});

test('credit card spend', () => {
  const tx = parseTransactionEmail({
    subject: 'Transaction alert for your ICICI Bank Credit Card',
    from: 'credit_cards@icicibank.com',
    body: 'INR 2,499.00 spent on ICICI Bank Credit Card XX4321 on 09-Oct-26 at AMAZON PAY INDIA. Avl Limit: INR 1,50,000.00',
    internalDate: at,
  });
  assert.equal(tx.type, 'expense');
  assert.equal(tx.amount, 249900);
  assert.equal(tx.paymentMethod, 'Credit Card');
  assert.equal(tx.categoryName, 'Shopping');
  assert.equal(tx.accountHint, 'XX4321');
});

test('SIP is an investment and refunds are refunds', () => {
  const sip = parseTransactionEmail({ subject: 'SIP installment processed', from: 'Groww <noreply@groww.in>', body: 'Your SIP of ₹5,000 in Parag Parikh Flexi Cap Fund has been processed. Units allotted at NAV 78.12.', internalDate: at });
  assert.equal(sip.type, 'investment');
  assert.equal(sip.amount, 500000);
  assert.equal(sip.platform.toLowerCase(), 'groww');
  const refund = parseTransactionEmail({ subject: 'Refund processed', body: 'Refund of Rs. 799 has been credited to your account.', internalDate: at });
  assert.equal(refund.type, 'refund');
  assert.equal(refund.amount, 79900);
});

test('OTP, statements, marketing and chatter are not transactions', () => {
  assert.equal(parseTransactionEmail({ subject: 'OTP for transaction', body: 'Your OTP for txn of Rs 500 is 123456' }), null);
  assert.equal(parseTransactionEmail({ subject: 'Your credit card statement is ready', body: 'Total amount due Rs 4,000' }), null);
  assert.equal(parseTransactionEmail({ subject: 'Big Diwali offer!', body: 'Get up to Rs 500 cashback when you pay. Exclusive offer, apply now.' }), null);
  assert.equal(parseTransactionEmail({ subject: 'Lunch?', body: 'I paid to Rahul ₹200 last time, your turn' }).confidence, 'low');
  assert.equal(parseTransactionEmail({ subject: 'Hello', body: 'Lunch tomorrow?' }), null);
});

test('html and excerpts', () => {
  assert.equal(htmlToText('<p>Rs&nbsp;100 <b>debited</b></p><style>x{}</style>'), 'Rs 100 debited');
  const ex = excerptAround('x'.repeat(300) + ' Rs 500 debited from your account ' + 'y'.repeat(300));
  assert.ok(ex.includes('Rs 500 debited'));
  assert.ok(ex.length <= 230);
});
