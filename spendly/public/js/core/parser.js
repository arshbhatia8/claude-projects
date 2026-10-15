// Turns a bank / UPI / card / broker alert email into a *suggested*
// transaction for review. Built around common Indian alert formats
// ("Rs.500.00 debited from A/c XX1234 ... to VPA swiggy@icici").
//
// It is deliberately conservative: an email needs both an amount and a clear
// money-movement phrase, and marketing, OTP and statement mails are skipped.
// Every result carries a confidence level, and nothing is posted without
// the user approving it.

import { parseAmount } from './money.js';

const AMOUNT = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;

// Balance / limit / due amounts that must not be mistaken for the transaction amount.
const NOISE_AMOUNTS = new RegExp(
  String.raw`(?:avl\.?|avbl\.?|available|total|closing|current|outstanding|ledger|min(?:imum)?\.?)\s*(?:bal(?:ance)?|limit|amount\s+due|due|amt)[^0-9₹]{0,25}` + AMOUNT.source,
  'gi'
);

const SKIP_SUBJECT = /\b(otp|one[\s-]time\s+password|verification code|statement (?:is|for)|e-?statement|minimum amount due|payment due|due date|pre-?approved|login alert|password|newsletter|webinar)\b/i;
const MARKETING = /\b(offer|congratulations|you have won|win\b|eligible for|apply now|limited period|exclusive|upgrade now|reward points? (?:expir|worth)|cashback of up to|get up to|% off)\b/i;

const KEYWORDS = {
  investment: /\b(sip\b|systematic investment|mutual fund|units? (?:allotted|purchased)|allotment of units|purchase of units|order (?:executed|placed) for|bought \d+ shares?)/i,
  refund: /\b(refund(?:ed)?|reversal|reversed|chargeback)\b/i,
  debit: /\b(debited|debit(?:ed)? from|spent|paid to|payment of|withdrawn|withdrawal|sent to|transferred to|charged|deducted|txn of|transaction of)\b/i,
  credit: /\b(credited|received|deposited|salary)\b/i,
};

const FINANCIAL_SENDER = /(bank|alerts?@|upi|card|hdfc|icici|sbi|axis|kotak|yes ?bank|indusind|idfc|federal|rbl|au ?bank|paytm|phonepe|gpay|google ?pay|amazon ?pay|cred\b|groww|zerodha|kuvera|upstox|angel|cams|kfintech|nsdl|cdsl)/i;

const CATEGORY_HINTS = [
  [/swiggy|zomato|domino|pizza|mcdonald|kfc|starbucks|cafe|restaurant|eatsure|burger|dosa|idli|hotel saravana|chai/i, 'Food and Dining'],
  [/bigbasket|blinkit|zepto|grofers|dmart|jiomart|instamart|grocer|more retail|reliance fresh|nature'?s basket/i, 'Groceries'],
  [/uber|ola\b|rapido|metro|irctc|redbus|fastag|parking|petrol|fuel|hpcl|bpcl|iocl|indian ?oil|makemytrip|goibibo|indigo|air ?india|cleartrip|yatra/i, 'Travel and Transport'],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|croma|reliance digital/i, 'Shopping'],
  [/netflix|spotify|prime video|hotstar|youtube|apple\.com|google play|jiocinema|sony ?liv|zee5|openai|chatgpt|airtel|jio\b|vodafone|bsnl|broadband|recharge/i, 'Subscriptions'],
  [/electricity|bescom|tata power|adani electricity|msedcl|rent\b|nobroker|landlord/i, 'Rent and Electricity'],
  [/udemy|coursera|byju|unacademy|school|college|tuition|course fee/i, 'Education'],
  [/canva|adobe|figma|camera|mic\b|envato|epidemic sound/i, 'Content Creation'],
];

const PLATFORMS = /\b(zerodha|coin by zerodha|groww|kuvera|upstox|angel ?one|paytm money|et money|smallcase|indmoney|icici direct|hdfc securities|motilal|cams|kfintech|mf central)\b/i;

export function htmlToText(html) {
  return String(html || '')
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

const firstIndex = (re, text) => {
  const m = re.exec(text);
  return m ? m.index : Infinity;
};

function detectType(text) {
  if (KEYWORDS.investment.test(text)) return 'investment';
  if (KEYWORDS.refund.test(text) && /credit|refund/i.test(text)) return 'refund';
  // A UPI debit alert often also says "... credited to VPA x": whichever
  // phrase comes first describes what happened to *your* account.
  const d = firstIndex(KEYWORDS.debit, text);
  const c = firstIndex(KEYWORDS.credit, text);
  if (d === Infinity && c === Infinity) return null;
  return d <= c ? 'expense' : 'income';
}

function extractAmount(text) {
  const m = AMOUNT.exec(text.replace(NOISE_AMOUNTS, ' '));
  if (!m) return null;
  const p = parseAmount(m[1]);
  return p && p > 0 ? { paise: p, index: m.index } : null;
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s:,-]+|[\s:,.-]+$/g, '').slice(0, 60);

function extractCounterparty(text, type) {
  const stop = String.raw`(?=\s+(?:on|ref|refno|reference|via|using|upi|txn|transaction|dated|at\s+\d|from|for\s+rs|avl|avbl|is|has|was)\b|[.,;\n(]|$)`;
  const patterns =
    type === 'income' || type === 'refund'
      ? [new RegExp(String.raw`(?:from|by)\s+(?:vpa\s+|a\/c\s+)?([A-Za-z0-9@._&'/ -]{2,60}?)` + stop, 'i')]
      : [
          /\bVPA\s+([A-Za-z0-9@._-]{3,60})/i,
          new RegExp(String.raw`(?:\bat|\bto|towards|\bfor|\bin)\s+(?!your\b|a\/c|ac\b|account\b)([A-Za-z0-9@._&'/ -]{2,60}?)` + stop, 'i'),
          /info[:\s]+([A-Za-z0-9@._&'/ -]{3,60})/i,
        ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const name = tidy(m[1]);
      if (name && !/^(rs|inr|your|the|a\/c|account|xx\d+|\d+)$/i.test(name)) return name;
    }
  }
  return '';
}

function extractAccountHint(text) {
  const m = /(?:a\/c|acct|account|card)\s*(?:no\.?|number)?\s*(?:ending\s*(?:with|in)?)?\s*[:\-]?\s*((?:[xX*]+\s*)?\d{3,6})\b/i.exec(text);
  return m ? m[1].replace(/\s+/g, '').replace(/\*/g, 'X').toUpperCase() : '';
}

function extractReference(text) {
  const re = /(?:upi|ref(?:erence)?|txn|transaction|rrn|utr)(?:\s*(?:no\.?|number|num|id|ref(?:erence)?\.?))*\s*(?:is\b)?\s*[:.#-]?\s*([A-Za-z0-9]{6,22})/gi;
  for (const m of text.matchAll(re)) {
    if (/\d{4,}/.test(m[1])) return m[1].toUpperCase();
  }
  return '';
}

function extractPaymentMethod(text) {
  if (/\bupi\b|\bvpa\b/i.test(text)) return 'UPI';
  if (/credit card/i.test(text)) return 'Credit Card';
  if (/debit card/i.test(text)) return 'Debit Card';
  if (/\batm\b|cash withdrawal/i.test(text)) return 'Cash';
  if (/\b(neft|imps|rtgs|net ?banking)\b/i.test(text)) return 'Net Banking';
  if (/auto[\s-]?debit|nach|e-?mandate|standing instruction/i.test(text)) return 'Auto-debit';
  if (/\bcard\b/i.test(text)) return 'Debit Card';
  return '';
}

function guessCategory(type, text) {
  if (type === 'income') {
    if (/salary|payroll/i.test(text)) return 'Salary';
    if (/interest/i.test(text)) return 'Interest Income';
    if (/dividend/i.test(text)) return 'Dividends';
    return 'Other Income';
  }
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return 'Other Expenses';
}

/** YYYY-MM-DD of a timestamp in the given timezone. */
export function dateInZone(ms, timeZone = 'Asia/Kolkata') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Number(ms)));
  } catch {
    return new Date(Number(ms)).toISOString().slice(0, 10);
  }
}

/**
 * @param {{subject?: string, from?: string, body?: string, snippet?: string, internalDate?: string|number}} mail
 * @returns {null | {type, amount, date, description, categoryName, paymentMethod, accountHint, reference, platform, confidence}}
 */
export function parseTransactionEmail(mail, { timeZone = 'Asia/Kolkata' } = {}) {
  const subject = mail.subject || '';
  const body = mail.body || mail.snippet || '';
  const from = mail.from || '';
  const text = `${subject}\n${body}`.slice(0, 6000);

  if (SKIP_SUBJECT.test(subject) || /\b(otp|one[\s-]time\s+password)\b/i.test(text)) return null;
  const accountHint = extractAccountHint(text);
  if (MARKETING.test(text) && !accountHint) return null;

  const type = detectType(text);
  if (!type) return null;
  const amount = extractAmount(text);
  if (!amount) return null;

  const reference = extractReference(text);
  const paymentMethod = extractPaymentMethod(text);
  const counterparty = extractCounterparty(text, type);
  const platformMatch = PLATFORMS.exec(text) || PLATFORMS.exec(from);

  // Confidence: how many independent signals agree that this is a real transaction alert.
  let score = 1; // amount + direction phrase
  if (FINANCIAL_SENDER.test(from)) score++;
  if (accountHint) score++;
  if (reference) score++;
  if (paymentMethod) score++;
  if (MARKETING.test(text)) score -= 2;
  const confidence = score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low';

  return {
    type,
    amount: amount.paise,
    date: mail.internalDate ? dateInZone(mail.internalDate, timeZone) : null,
    description: counterparty || tidy(subject) || 'Email transaction',
    categoryName: guessCategory(type, `${text} ${counterparty}`),
    paymentMethod,
    accountHint,
    reference,
    platform: platformMatch ? tidy(platformMatch[1]) : '',
    confidence,
  };
}

/** A short excerpt around the amount, so the review screen has context without storing the whole email. */
export function excerptAround(text, max = 220) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const m = AMOUNT.exec(clean);
  const start = m ? Math.max(0, m.index - 60) : 0;
  return (start > 0 ? '…' : '') + clean.slice(start, start + max) + (clean.length > start + max ? '…' : '');
}
