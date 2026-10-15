(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LedgerParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// Turns a bank / UPI / card / broker alert email into a transaction.
// Heuristic by nature: built around the common Indian bank alert formats
// ("Rs.500.00 debited from A/c XX1234 ... to VPA swiggy@icici") but tolerant
// of other wording. Returns null when the mail does not look like a transaction.

const AMOUNT = /(?:₹|rs\.?|inr|usd|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const AMOUNT_G = new RegExp(AMOUNT.source, 'gi');

// Balance / limit / due amounts that must not be mistaken for the transaction amount.
const NOISE_AMOUNTS = new RegExp(
  String.raw`(?:avl\.?|avbl\.?|available|total|closing|current|outstanding|ledger|min(?:imum)?\.?)\s*(?:bal(?:ance)?|limit|amount\s+due|due|amt)[^0-9₹]{0,25}` +
    AMOUNT.source,
  'gi'
);

const SKIP = /\b(otp|one[\s-]time\s+password|verification code|statement (?:is|for)|e-?statement|minimum amount due|payment due|due date|pre-?approved|offer|congratulations|login alert|password)\b/i;

const KEYWORDS = {
  investment: /\b(sip|systematic investment|mutual fund|units? (?:allotted|purchased)|allotment|nav\b|folio|purchase of units|investment of|invested|bought .* shares|order executed|buy order)/i,
  debit: /\b(debited|debit(?:ed)? from|spent|paid|payment of|withdrawn|withdrawal|sent|purchase|transferred to|charged|deducted|txn of|transaction of)\b/i,
  credit: /\b(credited|received|deposited|refund(?:ed)?|cashback|reversal|reversed|salary)\b/i,
};

const CATEGORY_HINTS = [
  [/swiggy|zomato|domino|pizza|mcdonald|kfc|starbucks|cafe|restaurant|eatsure|burger/i, 'Food & Dining'],
  [/bigbasket|blinkit|zepto|grofers|dmart|jiomart|instamart|grocer|more retail|reliance fresh/i, 'Groceries'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|croma|reliance digital/i, 'Shopping'],
  [/uber|ola|rapido|metro|irctc|redbus|fastag|parking/i, 'Transport'],
  [/petrol|fuel|hpcl|bpcl|iocl|indian ?oil|shell/i, 'Fuel'],
  [/makemytrip|goibibo|indigo|air ?india|vistara|cleartrip|booking\.com|airbnb|oyo|yatra/i, 'Travel'],
  [/netflix|spotify|prime|hotstar|youtube|apple\.com|google play|jiocinema|sony ?liv|zee5|openai|chatgpt/i, 'Subscriptions'],
  [/airtel|jio|vodafone|\bvi\b|bsnl|act fibernet|broadband|recharge/i, 'Mobile & Internet'],
  [/electricity|bescom|tata power|adani|msedcl|water bill|gas bill|bill ?desk|billpay|utility/i, 'Bills & Utilities'],
  [/rent|nobroker|housing/i, 'Rent'],
  [/hospital|pharma|apollo|medplus|1mg|netmeds|clinic|practo|doctor/i, 'Health'],
  [/insurance|lic\b|policybazaar|premium/i, 'Insurance'],
  [/emi|loan|bajaj finserv|home credit/i, 'EMI / Loan'],
  [/bookmyshow|pvr|inox|cinema|steam|playstation/i, 'Entertainment'],
  [/udemy|coursera|byju|unacademy|school|college|tuition|fees/i, 'Education'],
];

const INVESTMENT_HINTS = [
  [/\bsip\b|systematic/i, 'Mutual Fund (SIP)'],
  [/mutual fund|units? allotted|folio|nav\b/i, 'Mutual Fund (Lumpsum)'],
  [/\betf\b/i, 'ETF'],
  [/shares?|equity|order executed|buy order|stock/i, 'Stocks'],
  [/fixed deposit|\bfd\b/i, 'Fixed Deposit'],
  [/recurring deposit|\brd\b/i, 'Recurring Deposit'],
  [/\bppf\b/i, 'PPF'],
  [/\bnps\b|pension/i, 'NPS'],
  [/gold|sgb/i, 'Gold / SGB'],
  [/crypto|bitcoin|wazirx|coindcx|coinswitch/i, 'Crypto'],
];

const PLATFORMS = /\b(zerodha|coin by zerodha|groww|kuvera|upstox|angel ?one|paytm money|et money|smallcase|kite|indmoney|icici direct|hdfc securities|motilal|cams|kfintech|mf central)\b/i;

function htmlToText(html) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .trim();
}

function firstMatchIndex(re, text) {
  const m = re.exec(text);
  return m ? m.index : Infinity;
}

function detectType(text) {
  if (KEYWORDS.investment.test(text)) return 'investment';
  // A UPI debit alert often also says "... credited to VPA x": the keyword
  // that comes first describes what happened to *your* account.
  const d = firstMatchIndex(KEYWORDS.debit, text);
  const c = firstMatchIndex(KEYWORDS.credit, text);
  if (d === Infinity && c === Infinity) return null;
  return d <= c ? 'debit' : 'credit';
}

function extractAmount(text) {
  const cleaned = text.replace(NOISE_AMOUNTS, ' ');
  const m = AMOUNT.exec(cleaned);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tidyName(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,-]+|[\s:,.-]+$/g, '')
    .slice(0, 60);
}

function extractCounterparty(text, type) {
  const stop = String.raw`(?=\s+(?:on|ref|refno|reference|via|using|upi|txn|transaction|dated|at\s+\d|from|for\s+rs|avl|avbl|is|has|was)\b|[.,;\n(]|$)`;
  const patterns =
    type === 'credit'
      ? [
          new RegExp(String.raw`(?:from|by)\s+(?:vpa\s+|a\/c\s+)?([A-Za-z0-9@._&'/ -]{2,60}?)` + stop, 'i'),
        ]
      : [
          new RegExp(String.raw`\bVPA\s+([A-Za-z0-9@._-]{3,60})`, 'i'),
          new RegExp(String.raw`(?:\bat|\bto|towards|\bfor)\s+(?!your\b|a\/c|ac\b|account\b)([A-Za-z0-9@._&'/ -]{2,60}?)` + stop, 'i'),
          /info[:\s]+([A-Za-z0-9@._&'/ -]{3,60})/i,
        ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const name = tidyName(m[1]);
      if (name && !/^(rs|inr|your|the|a\/c|account|xx\d+)$/i.test(name)) return name;
    }
  }
  return '';
}

function extractAccount(text) {
  const m = /(?:a\/c|acct|account|card)\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?)?\s*[:\-]?\s*((?:[xX*]+\s*)?\d{3,6})\b/i.exec(text);
  return m ? m[1].replace(/\s+/g, '').replace(/\*/g, 'X').toUpperCase() : '';
}

function extractPaymentMode(text) {
  if (/\bupi\b|\bvpa\b/i.test(text)) return 'UPI';
  if (/credit card/i.test(text)) return 'Credit Card';
  if (/debit card/i.test(text)) return 'Debit Card';
  if (/\batm\b|cash withdrawal/i.test(text)) return 'Cash';
  if (/\b(neft|imps|rtgs|net ?banking)\b/i.test(text)) return 'Net Banking';
  if (/auto[\s-]?debit|nach|mandate|e-?mandate|standing instruction/i.test(text)) return 'Auto-debit';
  if (/\bcard\b/i.test(text)) return 'Debit Card';
  return '';
}

function guessCategory(type, text) {
  if (type === 'investment') {
    for (const [re, cat] of INVESTMENT_HINTS) if (re.test(text)) return cat;
    return 'Other';
  }
  if (type === 'credit') {
    if (/salary/i.test(text)) return 'Salary';
    if (/refund|reversal|reversed/i.test(text)) return 'Refund';
    if (/cashback/i.test(text)) return 'Cashback';
    if (/interest/i.test(text)) return 'Interest';
    if (/dividend/i.test(text)) return 'Dividend';
    return 'Transfer In';
  }
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat;
  if (/\batm\b|cash withdrawal/i.test(text)) return 'Other';
  return 'Other';
}

function toDate(ms) {
  const d = new Date(Number(ms));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {{subject?: string, from?: string, body?: string, snippet?: string, internalDate?: string|number}} mail
 */
function parseTransactionEmail(mail) {
  const subject = mail.subject || '';
  const body = mail.body || mail.snippet || '';
  const text = `${subject}\n${body}`.slice(0, 6000);

  if (SKIP.test(subject) || /\b(otp|one[\s-]time\s+password)\b/i.test(text)) return null;

  const type = detectType(text);
  if (!type) return null;
  const amount = extractAmount(text);
  if (!amount) return null;

  const counterparty = extractCounterparty(text, type);
  const platformMatch = PLATFORMS.exec(text) || PLATFORMS.exec(mail.from || '');
  const category = guessCategory(type, `${text} ${counterparty}`);

  const tx = {
    type,
    amount,
    date: mail.internalDate ? toDate(mail.internalDate) : toDate(Date.now()),
    category,
    description: counterparty || tidyName(subject) || 'Email transaction',
    payment_mode: extractPaymentMode(text),
    account: extractAccount(text),
    invested_in: '',
    platform: '',
    notes: `From email: ${tidyName(subject)}`.slice(0, 200),
  };
  if (type === 'investment') {
    tx.invested_in = counterparty;
    tx.platform = platformMatch ? tidyName(platformMatch[1]) : '';
  }
  return tx;
}

return { parseTransactionEmail, htmlToText };
});
