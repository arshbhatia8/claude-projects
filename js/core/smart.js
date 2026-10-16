// Smart Entry: turns a sentence like "I spent ₹40 on dosa for breakfast today"
// into a *proposal* — an action plus pre-filled fields — for the user to review.
//
// Rules this module follows:
//  • It never saves anything. The UI shows the proposal in the normal,
//    validated forms and only the user's tap on Save posts it.
//  • It never invents data. Anything it cannot read from the text (amount,
//    category, account, bank, rate, dates) is left empty and listed in
//    `questions`, so the form asks for it.
//  • Items ("dosa", "samosa") go in the description; the category stays short
//    ("Breakfast", "Snacks"). New descriptions never create categories.
//  • Statements about the future ("will pay", "due tomorrow") are flagged as
//    planned and are not recorded as money that has moved.

import { parseAmount } from './money.js';

// ---------------------------------------------------------------------------
// Numbers spoken or typed as words: "fifty-four thousand" → 54000
// ---------------------------------------------------------------------------

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, million: 1e6, crore: 1e7, crores: 1e7 };

export function wordsToDigits(text) {
  const tokens = [...String(text).matchAll(/[A-Za-z]+|[^A-Za-z]+/g)].map((m) => m[0]);
  const out = [];
  let i = 0;
  const isNum = (w) => w && (w.toLowerCase() in UNITS || w.toLowerCase() in TENS || w.toLowerCase() in SCALES);
  while (i < tokens.length) {
    // "1.5 lakh" / "2 thousand": a scale word right after digits is left for the amount reader.
    const afterDigits = /\d\s*$/.test(out.join('').slice(-12)) && tokens[i] && tokens[i].toLowerCase() in SCALES;
    if (afterDigits || (!isNum(tokens[i]) && !(tokens[i]?.toLowerCase() === 'a' && isNum(tokens[i + 2]) && tokens[i + 2].toLowerCase() in SCALES))) {
      out.push(tokens[i++]);
      continue;
    }
    // Collect a run of number words separated by spaces/hyphens (and "and").
    let j = i;
    const words = [];
    while (j < tokens.length) {
      const w = tokens[j].toLowerCase();
      if (isNum(w) || (w === 'a' && words.length === 0) || (w === 'and' && words.length && isNum(tokens[j + 2]))) {
        words.push(w);
        j++;
        if (j < tokens.length && /^[\s-]+$/.test(tokens[j]) && (isNum(tokens[j + 1]) || ['and', 'a'].includes(tokens[j + 1]?.toLowerCase()))) j++;
        else break;
      } else break;
    }
    let total = 0;
    let cur = 0;
    let counted = false;
    for (const w of words) {
      if (w in UNITS) { cur += UNITS[w]; counted = true; } else if (w in TENS) { cur += TENS[w]; counted = true; } else if (w === 'hundred') { cur = (cur || 1) * 100; counted = true; } else if (w in SCALES) { total += (cur || 1) * SCALES[w]; cur = 0; counted = true; } else if (w === 'a') cur = cur || 0;
    }
    if (counted) out.push(String(total + cur));
    else out.push(tokens.slice(i, j).join(''));
    i = j;
  }
  return out.join('');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
};
export const addDays = (isoDate, n) => new Date(Date.parse(isoDate + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const addMonths = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(d, last));
};

/** All explicit dates in the text with their positions. */
function findDates(text, today) {
  const year = Number(today.slice(0, 4));
  const found = [];
  const push = (m, date) => { if (date) found.push({ start: m.index, end: m.index + m[0].length, date }); };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m, iso(+m[1], +m[2], +m[3]));
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g)) push(m, iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+${MONTH_RE}\\.?,?(?:\\s+(\\d{4}))?\\b`, 'gi'))) {
    push(m, iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]));
  }
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?\\b`, 'gi'))) {
    if (found.some((f) => m.index >= f.start && m.index < f.end)) continue;
    push(m, iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]));
  }
  return found.sort((a, b) => a.start - b.start);
}

function relativeDate(lower, today) {
  if (/\bday before yesterday\b/.test(lower)) return addDays(today, -2);
  if (/\byesterday\b/.test(lower)) return addDays(today, -1);
  if (/\btomorrow\b/.test(lower)) return addDays(today, 1);
  if (/\btoday\b|\bthis morning\b|\btonight\b|\bjust now\b/.test(lower)) return today;
  return null;
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

const MULT = { k: 1e3, thousand: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, l: 1e5, crore: 1e7, crores: 1e7, cr: 1e7 };

/** Money amounts (in paise) with positions; percentages and date parts are skipped. */
function findAmounts(text, dateSpans) {
  const out = [];
  const re = /(₹|\brs\.?|\binr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakhs?|lacs?|l|crores?|cr)?\b\s*(%|percent|per\s*cent|rupees?|rs\.?|inr|₹|bucks)?/gi;
  for (const m of text.matchAll(re)) {
    const start = m.index + m[0].indexOf(m[2]);
    if (dateSpans.some((d) => start >= d.start && start < d.end)) continue;
    const suffix = (m[4] || '').toLowerCase();
    if (/%|percent|per\s*cent/.test(suffix)) continue;
    if (/^(st|nd|rd|th)/i.test(text.slice(start + m[2].length))) continue;
    const mult = m[3] ? MULT[m[3].toLowerCase()] || 1 : 1;
    const currency = Boolean(m[1]) || Boolean(suffix) || mult > 1;
    const digits = m[2].replace(/,/g, '');
    if (!currency && /^(19|20)\d{2}$/.test(digits)) continue; // a year
    let paise;
    if (mult === 1) paise = parseAmount(digits);
    else {
      const rupees = Number(digits) * mult;
      paise = Number.isFinite(rupees) ? Math.round(rupees * 100) : null;
    }
    if (paise && paise > 0) out.push({ paise, start, currency });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Categories, items and accounts
// ---------------------------------------------------------------------------

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks', 'snack', 'groceries', 'grocery'];
const MEAL_CATEGORY = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snacks: 'Snacks', snack: 'Snacks', groceries: 'Groceries', grocery: 'Groceries' };

// Word → category name. Checked after explicit meal words and your own rules.
const KEYWORD_CATEGORIES = [
  [/\b(vegetables?|veggies|milk|fruits?|kirana|supermarket|dmart|bigbasket|blinkit|zepto|instamart|eggs|atta|dal|rice bag)\b/, 'Groceries'],
  [/\b(auto|autorickshaw|rickshaw|cab|uber|ola|rapido|metro|bus|train|taxi|petrol|diesel|fuel|parking|toll|flight|ticket)\b/, 'Transport'],
  [/\b(electricity|water bill|wi-?fi|internet|broadband|mobile bill|phone bill|recharge|gas bill|dth|bill)\b/, 'Bills'],
  [/\b(haircut|hair cut|salon|spa|barber|shampoo|soap|toothpaste|grooming|cosmetics|skincare|facial)\b/, 'Personal Care'],
  [/\b(clothes|shirt|t-shirt|jeans|shoes|amazon|flipkart|myntra|shopping|dress|kurta|bag)\b/, 'Shopping'],
  [/\b(swiggy|zomato|restaurant|cafe|café|eating out|dine|dined)\b/, 'Eating Out'],
  [/\b(rent)\b/, 'Rent'],
  [/\b(medicines?|doctor|pharmacy|hospital|clinic|tablets?)\b/, 'Health'],
  [/\b(netflix|spotify|subscription|prime|hotstar)\b/, 'Subscriptions'],
  [/\b(course|books?|tuition|fees|exam)\b/, 'Education'],
  [/\b(dosa|idli|idly|poha|upma|paratha|uttapam|pongal|aloo puri|puri|vada)\b/, 'Breakfast'],
  [/\b(samosa|samosas|chai|tea|coffee|biscuits?|chips|pakoda|pakora|vada pav|puff|bhel|pani puri|chaat)\b/, 'Snacks'],
];

const STOP = new Set(['for', 'at', 'from', 'in', 'on', 'with', 'today', 'yesterday', 'tomorrow', 'using', 'via', 'by', 'and', 'to', 'this', 'morning', 'evening', 'night', 'tonight', 'rupees', 'rupee', 'rs', 'inr', 'my', 'the', 'paid', 'which', 'that', 'cost', 'costs', 'worth', 'only']);
const NOT_ITEMS = new Set([...MEALS, 'it', 'that', 'this', 'something', 'stuff', 'food', 'money', 'cash', 'upi', 'card', 'me', 'myself', 'total', 'expense', 'expenses', 'payment']);

const titleCase = (s) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const singular = (w) => (/(ss|us|is)$/.test(w) || w.length < 4 ? w : w.replace(/ies$/, 'y').replace(/(?<=[^aeiou])es$/, 'e').replace(/s$/, ''));

/** The item bought ("dosa", "milk, eggs and bread"), kept out of the category. */
function extractItem(lower) {
  const clean = lower.replace(/[₹]\s*[\d,.]+|\b\d[\d,.]*\b/g, ' ').replace(/\s+/g, ' ');
  const tryItem = (raw) => {
    if (!raw) return '';
    const words = [];
    for (const w of raw.trim().split(/\s+/)) {
      const inList = w === 'and' && words.some((x) => x.endsWith(','));
      if (!inList && (STOP.has(w) || /^(a|an|some|two|three|few|plate|plates|of)$/.test(w) && !words.length)) { if (words.length) break; continue; }
      words.push(w);
      if (words.length >= 5) break;
    }
    let item = words.join(' ').replace(/[^a-z0-9&'\- ,]/g, '').replace(/^[ ,]+|[ ,]+$/g, '');
    if (!item || NOT_ITEMS.has(item) || /^(rs|inr|rupees?)$/.test(item)) return '';
    if (!item.includes(',')) item = item.split(' ').map((w, i, a) => (i === a.length - 1 && a.length <= 2 ? singular(w) : w)).join(' ');
    return item;
  };
  const meal = `(?:${MEALS.join('|')})`;
  const patterns = [
    new RegExp(`\\b(?:on|for)\\s+(?:a |an |some |the )?([a-z][a-z ,&'-]*?)\\s+(?:for|as)\\s+${meal}\\b`),
    new RegExp(`\\b(?:ate|had|bought|ordered|got|purchased|took)\\s+(?:a |an |some |the )?([a-z][a-z ,&'-]*?)(?:\\s+(?:for|as|at|from|in|on|with|today|yesterday|this|using|via|by|and paid|which|that)\\b|$)`),
    new RegExp(`\\b${meal}\\s*(?:was|:|-|—)\\s*([a-z][a-z ,&'-]*?)(?:\\s+(?:for|at|from|today|yesterday)\\b|$)`),
    /\b(?:spent|paid|pay)\b.*?\b(?:on|for)\s+(?:a |an |some |the )?([a-z][a-z ,&'-]*?)(?:\s+(?:for|at|from|in|on|with|today|yesterday|this|using|via|by)\b|$)/,
    /\bfor\s+(?:a |an |some |the )?([a-z][a-z ,&'-]*?)(?:\s+(?:at|from|in|on|with|today|yesterday|this|using|via|by)\b|$)/,
    /\bon\s+(?:a |an |some |the )?([a-z][a-z ,&'-]*?)(?:\s+(?:for|at|from|in|with|today|yesterday|this|using|via|by)\b|$)/,
  ];
  for (const re of patterns) {
    const item = tryItem(clean.match(re)?.[1]);
    if (item) return item;
  }
  return '';
}

function findCategory(ctx, kind, name) {
  return ctx.categories.find((c) => c.kind === kind && !c.parentId && !c.archived && c.name.toLowerCase() === name.toLowerCase()) || null;
}

function expenseCategory(lower, ctx) {
  const mealWord = MEALS.find((m) => new RegExp(`\\b${m}\\b`).test(lower));
  if (mealWord) {
    const c = findCategory(ctx, 'expense', MEAL_CATEGORY[mealWord]);
    if (c) return { category: c, how: `“${mealWord}”` };
  }
  for (const r of ctx.rules || []) {
    if (new RegExp(`\\b${r.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      const c = ctx.categories.find((x) => x.id === r.categoryId && !x.archived);
      if (c) return { category: c, how: `your rule “${r.keyword}”` };
    }
  }
  for (const [re, name] of KEYWORD_CATEGORIES) {
    const m = lower.match(re);
    if (m) {
      const c = findCategory(ctx, 'expense', name);
      if (c) return { category: c, how: `“${m[1]}”` };
    }
  }
  return { category: null, how: '' };
}

const INCOME_HINTS = [
  [/\b(salary|payroll|bonus|stipend)\b/, 'Salary'],
  [/\b(freelanc\w*|client)\b/, 'Freelance Income'],
  [/\b(mentor\w*|coaching)\b/, 'Mentorship Income'],
  [/\b(brand|collab\w*|sponsor\w*)\b/, 'Brand Collaborations'],
  [/\b(interest)\b/, 'Interest Income'],
  [/\b(dividends?)\b/, 'Dividends'],
  [/\b(business|sales?)\b/, 'Business Income'],
];

const GENERIC_ACCOUNT_WORDS = new Set(['savings', 'saving', 'account', 'current', 'bank', 'card', 'credit', 'debit', 'demo', 'wallet', 'cash', 'in', 'hand', 'my', 'the', 'and', 'of', 'a', 'fd', 'rd']);

function tokensOf(x) {
  const words = `${x.name || ''} ${x.institution || ''}`.toLowerCase().replace(/[()]/g, ' ').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_ACCOUNT_WORDS.has(w));
  if (x.identifier) words.push(String(x.identifier).toLowerCase());
  return words;
}

/** Find accounts / cards / assets the sentence names. Returns all matches so the UI can ask when unsure. */
function matchEntities(lower, list) {
  return list.filter((x) => !x.archived && tokensOf(x).some((w) => new RegExp(`\\b${w}\\b`).test(lower)));
}

function bankName(text) {
  const m = text.match(/\b(?:with|at|in|from|of)\s+((?:[A-Z][\w&.']*\s+){0,3}?(?:bank|post office|[A-Z]{2,}(?:\s+bank)?))\b/i);
  if (m) return m[1].trim().replace(/\s+/g, ' ').replace(/\b(\w)/g, (c) => c.toUpperCase()).replace(/\b(Sbi|Hdfc|Icici|Pnb|Idfc|Rbl|Bob|Au|Xyz)\b/g, (w) => w.toUpperCase());
  const known = text.match(/\b(sbi|hdfc|icici|axis|kotak|pnb|canara|idfc|indusind|yes bank|bank of baroda|union bank|post office)\b/i);
  return known ? known[1].toUpperCase().replace('BANK OF BARODA', 'Bank of Baroda').replace('POST OFFICE', 'Post Office').replace('YES BANK', 'Yes Bank').replace('UNION BANK', 'Union Bank') : '';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {string} input
 * @param {{ today: string, categories: any[], accounts: any[], liabilities: any[], assets: any[], rules?: any[] }} ctx
 * @returns {{ intent: string, tx?: object, asset?: object, funding?: object, assetId?: string, snapshot?: object, liability?: object,
 *             questions: string[], notes: string[], duplicates: object[], text: string }}
 */
export function parseSmartEntry(input, ctx) {
  const text = wordsToDigits(String(input || '').trim()).replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const today = ctx.today;
  const result = { intent: 'unknown', questions: [], notes: [], duplicates: [], text: input };
  if (!text) {
    result.questions.push('Type or say what happened, e.g. “I spent ₹40 on dosa for breakfast today”.');
    return result;
  }

  const dates = findDates(text, today);
  const amounts = findAmounts(text, dates);
  const amount = (amounts.find((a) => a.currency) || amounts[0])?.paise ?? null;
  const rate = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|per\s*cent)/i)?.[1] || '';
  const maturityIdx = lower.search(/\b(matur\w*|till|until|ends? on)\b/);
  const maturity = dates.find((d) => maturityIdx >= 0 && d.start > maturityIdx && d.start - maturityIdx < 40) || null;
  const eventDate = dates.find((d) => d !== maturity)?.date || relativeDate(lower, today);
  const date = eventDate || today;
  const accounts = ctx.accounts.filter((a) => !a.archived);
  const cards = ctx.liabilities.filter((l) => !l.archived);
  const assets = ctx.assets.filter((a) => !a.archived && a.status === 'active');
  const mentioned = matchEntities(lower, accounts);
  const mentionedCards = matchEntities(lower, cards);
  const paymentMethod = /\b(upi|gpay|google pay|phonepe|paytm)\b/.test(lower) ? 'UPI'
    : /\bcredit card\b/.test(lower) ? 'Credit Card'
      : /\bdebit card\b/.test(lower) ? 'Debit Card'
        : /\b(cash)\b/.test(lower) ? 'Cash'
          : /\b(neft|imps|rtgs|net ?banking|bank transfer)\b/.test(lower) ? 'Net Banking' : '';
  const needAmount = () => { if (!amount) result.questions.push('How much was it? No amount was found in what you said.'); };
  const noteDate = () => { if (!eventDate) result.notes.push('No date mentioned — using today. Change it if needed.'); };
  const oneAccount = (list, label) => {
    if (list.length === 1) return list[0];
    if (list.length > 1) result.questions.push(`Which ${label}? More than one matches: ${list.map((x) => x.name).join(', ')}.`);
    return null;
  };
  const cashAccount = () => (/\bcash\b/.test(lower) ? accounts.filter((a) => a.type === 'cash') : []);

  // Future or expected money is never recorded as moved.
  const pastMoneyVerb = /\b(spent|paid|bought|ate|had|received|got|credited|debited|opened|started|invested|deposited|transferred|sent|withdrew|ordered|purchased|took)\b/.test(lower);
  const futureWords = /\b(will|shall|going to|gonna|have to|need to|due|next (?:week|month|year)|upcoming|expect\w*|plan(?:ning)? to|remind me|tomorrow)\b/.test(lower);
  const futureDate = eventDate && eventDate > today;
  if ((futureWords && !pastMoneyVerb) || (futureDate && !/\b(fd|fixed deposit|rd|recurring deposit)\b/.test(lower)) || /\b(will|going to|due)\b/.test(lower) && /\b(pay|receive|get|be credited)\b/.test(lower)) {
    result.intent = 'planned';
    result.planned = { amount, date: eventDate || null, description: text };
    result.notes.push('This sounds like something that has not happened yet. Spendly only records money that has actually moved, so nothing will be saved. Record it on the day it happens.');
    return result;
  }

  // ---------------- Fixed deposits ----------------
  if (/\b(fd|f\.d\.|fixed deposits?)\b/.test(lower)) {
    const institution = bankName(text);
    const fds = assets.filter((a) => a.type === 'fd');
    const similar = fds.filter((a) => (institution && `${a.institution} ${a.name}`.toLowerCase().includes(institution.toLowerCase().replace(/\s*bank$/, ''))) || (amount && a.invested === amount));
    if (/\b(matured|maturity amount|closed|broke|break|redeemed|withdrew)\b/.test(lower)) {
      result.intent = 'asset_close';
      result.assetId = oneAccount(similar.length ? similar : fds, 'FD')?.id || null;
      if (!fds.length) result.questions.push('There is no active FD to close yet.');
      result.close = { amountReceived: amount, date, accountId: oneAccount(mentioned, 'account')?.id || null };
      if (!amount) result.questions.push('How much did you receive at maturity?');
      return result;
    }
    if (/\b(now worth|worth|current value|value is|valued at|grown to|updated? value)\b/.test(lower)) {
      result.intent = 'asset_value';
      const target = oneAccount(similar.length ? similar : fds, 'FD');
      result.assetId = target?.id || null;
      if (!target && !fds.length) result.questions.push('There is no FD yet to update. Add it first.');
      result.snapshot = { value: amount, date };
      needAmount();
      return result;
    }
    result.intent = 'fd_create';
    const tenure = lower.match(/\bfor\s+(\d+)\s*(years?|yrs?|months?)\b/);
    let maturityDate = maturity?.date || '';
    if (!maturityDate && tenure) {
      maturityDate = addMonths(date, Number(tenure[1]) * (/^y/.test(tenure[2]) ? 12 : 1));
      result.notes.push(`Maturity date worked out from “${tenure[0]}”.`);
    }
    result.asset = { type: 'fd', name: institution ? `${institution} FD` : 'Fixed Deposit', institution, interestRate: rate, openedOn: date, maturityDate, status: 'active' };
    const from = oneAccount(mentioned, 'account');
    result.funding = from ? { mode: 'account', accountId: from.id, amount, date } : { mode: accounts.length ? 'ask' : 'existing', amount, invested: amount, value: amount, date };
    if (!amount) result.questions.push('What is the FD principal amount?');
    if (!institution) result.questions.push('Which bank or institution is the FD with?');
    if (!rate) result.notes.push('No interest rate mentioned — add it if you know it (optional).');
    if (!maturityDate) result.questions.push('When does it mature? (optional, but useful for reminders)');
    if (!from && accounts.length) result.questions.push('Did the money come from one of your accounts? Choose it so your bank balance goes down — or choose “I already own it”.');
    result.duplicates = similar.map((a) => ({ id: a.id, name: a.name }));
    noteDate();
    return result;
  }

  // ---------------- Recurring deposits ----------------
  if (/\b(rd|r\.d\.|recurring deposits?)\b/.test(lower)) {
    const institution = bankName(text);
    const rds = assets.filter((a) => a.type === 'rd');
    const similar = rds.filter((a) => institution && `${a.institution} ${a.name}`.toLowerCase().includes(institution.toLowerCase().replace(/\s*bank$/, '')));
    const opening = /\b(started|start|opened|open|new|created|booked|set up|setup)\b/.test(lower);
    if (!opening && /\b(deposited|deposit|paid|installment|instalment|added|put|transferred|contributed)\b/.test(lower)) {
      result.intent = 'rd_contribution';
      const target = oneAccount(similar.length ? similar : rds, 'RD');
      if (!rds.length) result.questions.push('There is no RD yet. Add the RD first, then record installments.');
      result.assetId = target?.id || null;
      result.tx = {
        type: 'investment', amount, date, description: target ? `${target.name} installment` : 'RD installment',
        from: (() => { const a = oneAccount(mentioned, 'account'); return a ? { kind: 'account', id: a.id } : null; })(),
        to: target ? { kind: 'asset', id: target.id } : null, paymentMethod,
      };
      if (!amount && target?.monthlyInstallment) {
        result.tx.amount = target.monthlyInstallment;
        result.notes.push('No amount mentioned — filled in the RD’s monthly installment. Check it.');
      } else needAmount();
      result.notes.push('Recorded as an investment: money moves from your account into the RD. It is not an expense.');
      noteDate();
      return result;
    }
    result.intent = 'rd_create';
    const tenure = lower.match(/\bfor\s+(\d+)\s*(years?|yrs?|months?)\b/);
    const tenureMonths = tenure ? Number(tenure[1]) * (/^y/.test(tenure[2]) ? 12 : 1) : 0;
    const maturityDate = maturity?.date || (tenureMonths ? addMonths(date, tenureMonths) : '');
    result.asset = { type: 'rd', name: institution ? `${institution} RD` : 'Recurring Deposit', institution, monthlyInstallment: amount, interestRate: rate, openedOn: date, maturityDate, tenureMonths, installmentsBefore: 0, status: 'active' };
    result.funding = { mode: 'existing', invested: 0, value: 0 };
    if (!amount) result.questions.push('What is the monthly installment?');
    if (!institution) result.questions.push('Which bank or post office is the RD with?');
    result.notes.push('No installments are counted as paid yet. Record each one when it is debited (Assets → Record installment, or say “I deposited ₹5,000 into my RD”).');
    result.duplicates = similar.map((a) => ({ id: a.id, name: a.name }));
    noteDate();
    return result;
  }

  // ---------------- Investments (stocks, MF, ETF, gold) ----------------
  const investWord = /\b(invest(?:ed|ing)?|bought|buy|purchased|sip|put)\b/.test(lower);
  const assetKind = lower.match(/\b(stocks?|shares?|equity|mutual funds?|mf|sip|etf|index fund|gold|sgb|crypto|bitcoin|nifty\w*)\b/)?.[1];
  if (investWord && assetKind) {
    const type = /gold|sgb/.test(assetKind) ? 'gold' : /mutual|mf|sip|index/.test(assetKind) ? 'mutual_fund' : /etf|nifty/.test(assetKind) ? 'etf' : /crypto|bitcoin/.test(assetKind) ? 'other_investment' : 'stock';
    const byName = matchEntities(lower, assets);
    const byType = assets.filter((a) => a.type === type || (type === 'stock' && ['stock', 'etf'].includes(a.type)));
    const candidates = byName.length ? byName : byType;
    const from = oneAccount(mentioned, 'account');
    if (candidates.length === 1) {
      result.intent = 'investment';
      result.assetId = candidates[0].id;
      result.tx = { type: 'investment', amount, date, description: `Invested in ${candidates[0].name}`, from: from ? { kind: 'account', id: from.id } : null, to: { kind: 'asset', id: candidates[0].id }, paymentMethod };
    } else {
      result.intent = 'investment_new_asset';
      const label = { stock: 'Stocks', mutual_fund: 'Mutual Funds', etf: 'ETF', gold: 'Digital Gold', other_investment: 'Crypto' }[type];
      result.asset = { type, name: label, status: 'active', openedOn: date };
      result.funding = from ? { mode: 'account', accountId: from.id, amount, date } : { mode: accounts.length ? 'ask' : 'existing', amount, invested: amount, value: amount, date };
      if (candidates.length > 1) result.questions.push(`Which holding? You have ${candidates.map((a) => a.name).join(', ')}. Pick one in Assets → Add money, or add a new holding here.`);
      else result.notes.push(`No ${label.toLowerCase()} holding exists yet, so this adds one.`);
      if (!from && accounts.length) result.questions.push('Which account did the money come from? Choose it so the balance goes down — investing is not an expense.');
    }
    needAmount();
    result.notes.push('Investments move money into an asset; they are not counted as spending.');
    noteDate();
    return result;
  }

  // ---------------- Loans ----------------
  if (/\b(took|taken|got|availed)\b.*\bloan\b|\bborrowed\b/.test(lower)) {
    result.intent = 'liability_create';
    const institution = bankName(text);
    result.liability = { name: institution ? `${institution} loan` : 'Loan', type: /personal/.test(lower) ? 'personal_loan' : 'other_loan', institution, openingOutstanding: amount, originalAmount: amount, startDate: date, interestRate: rate };
    needAmount();
    result.notes.push('Adds the loan to Liabilities. If the money landed in one of your accounts, also record a Transfer from the loan to that account so the balance is right.');
    return result;
  }

  // ---------------- Credit card bill / transfers ----------------
  if (/\b(paid|pay|cleared|settled)\b.*\b(credit card|card)\b.*\bbill\b|\bcard bill\b.*\bpaid\b/.test(lower)) {
    result.intent = 'transfer';
    const card = oneAccount(mentionedCards.length ? mentionedCards : cards.filter((c) => c.type === 'credit_card'), 'card');
    const from = oneAccount(mentioned, 'account');
    result.tx = { type: 'transfer', amount, date, description: card ? `${card.name} bill payment` : 'Credit card bill payment', from: from ? { kind: 'account', id: from.id } : null, to: card ? { kind: 'liability', id: card.id } : null, paymentMethod: paymentMethod || 'Net Banking' };
    if (!card) result.questions.push('Which credit card was paid?');
    if (!from) result.questions.push('Which account paid the bill?');
    result.notes.push('A card bill payment is a transfer: the card purchases were already counted as expenses when you made them.');
    needAmount();
    noteDate();
    return result;
  }
  if (/\b(transferred|moved|withdrew|withdrawn|withdrawal|atm)\b/.test(lower) || (/\bsent\b/.test(lower) && /\bfrom\b.*\bto\b/.test(lower) && mentioned.length >= 2)) {
    const fromMatch = lower.match(/\bfrom\s+(?:my\s+)?([a-z0-9 ]+?)(?:\s+(?:to|into|account|a\/c)\b|$)/)?.[1] || '';
    const toMatch = lower.match(/\b(?:to|into)\s+(?:my\s+)?([a-z0-9 ]+?)(?:\s+(?:account|a\/c|from|on|today|yesterday)\b|$)/)?.[1] || '';
    let from = fromMatch ? oneAccount(matchEntities(fromMatch, accounts), 'account to take money from') : null;
    let to = toMatch ? oneAccount(matchEntities(toMatch, accounts), 'account to put money into') : null;
    if (/\b(withdrew|withdrawn|withdrawal|atm)\b/.test(lower) && !to) to = oneAccount(accounts.filter((a) => a.type === 'cash'), 'cash account');
    if (!from && mentioned.length === 1 && mentioned[0] !== to) from = mentioned[0];
    if (from || to || /\b(withdrew|withdrawn|atm|transferred)\b/.test(lower)) {
      result.intent = 'transfer';
      result.tx = { type: 'transfer', amount, date, description: /atm|withdr/.test(lower) ? 'Cash withdrawal' : 'Transfer', from: from ? { kind: 'account', id: from.id } : null, to: to ? { kind: 'account', id: to.id } : null, paymentMethod };
      if (!from) result.questions.push('Which account did the money leave?');
      if (!to) result.questions.push('Which account did it go to?');
      result.notes.push('Transfers between your own accounts are not income or spending.');
      needAmount();
      noteDate();
      return result;
    }
  }

  // ---------------- Refunds ----------------
  if (/\b(refund|refunded|cashback|reversed|reversal)\b/.test(lower)) {
    result.intent = 'refund';
    const { category, how } = expenseCategory(lower, ctx);
    const to = oneAccount(mentioned.length ? mentioned : cashAccount(), 'account');
    const card = !to ? oneAccount(mentionedCards, 'card') : null;
    result.tx = { type: 'refund', amount, date, categoryId: category?.id || '', description: extractItem(lower) ? titleCase(`${extractItem(lower)} refund`) : 'Refund', to: to ? { kind: 'account', id: to.id } : card ? { kind: 'liability', id: card.id } : null, paymentMethod };
    if (!category) result.questions.push('Which spending category is this refund for?');
    else result.notes.push(`Category ${category.name} (from ${how}). Refunds reduce that category's spending.`);
    needAmount();
    noteDate();
    return result;
  }

  // ---------------- Income ----------------
  const incomeWord = /\b(salary|credited|received|receive|got paid|earned|income|stipend|bonus|dividend|interest)\b/.test(lower);
  const spendWord = /\b(spent|spend|paid|pay|bought|buy|ate|had|purchased|cost|ordered|took)\b/.test(lower);
  if (incomeWord && !(spendWord && !/\b(salary|credited)\b/.test(lower))) {
    result.intent = 'income';
    const hint = INCOME_HINTS.find(([re]) => re.test(lower));
    const category = hint ? findCategory(ctx, 'income', hint[1]) : null;
    const to = oneAccount(mentioned.length ? mentioned : cashAccount(), 'account');
    const from = lower.match(/\bfrom\s+([a-z][a-z0-9 &.'-]{1,40}?)(?:\s+(?:for|today|yesterday|on|into|in)\b|$)/)?.[1];
    const credited = /\bcredited\b/.test(lower);
    const description = hint ? `${hint[1].replace(' Income', '')}${credited ? ' credited' : ''}` : from && !matchEntities(from, accounts).length ? `From ${titleCase(from)}` : 'Income';
    result.tx = { type: 'income', amount, date, categoryId: category?.id || '', description, to: to ? { kind: 'account', id: to.id } : null, paymentMethod };
    if (!category) result.questions.push('What kind of income is this (salary, freelance, interest…)? Pick a category.');
    if (!to) result.notes.push('Account: not linked. Choose the account it went into so the balance goes up.');
    needAmount();
    noteDate();
    return result;
  }

  // ---------------- Expenses ----------------
  const mealSaid = MEALS.some((m) => new RegExp(`\\b${m}\\b`).test(lower));
  const knownSpend = amount && expenseCategory(lower, ctx).category;
  if (spendWord || mealSaid || knownSpend || /\b(on|for)\b/.test(lower) && amount) {
    result.intent = 'expense';
    const { category, how } = expenseCategory(lower, ctx);
    const item = extractItem(lower);
    const card = oneAccount(mentionedCards, 'card');
    const from = !card ? oneAccount(mentioned.length ? mentioned : cashAccount(), 'account') : null;
    const description = item && (!category || item.toLowerCase() !== category.name.toLowerCase()) ? titleCase(item) : category?.name || '';
    result.tx = {
      type: 'expense', amount, date, categoryId: category?.id || '', description,
      from: card ? { kind: 'liability', id: card.id } : from ? { kind: 'account', id: from.id } : null,
      paymentMethod: card ? 'Credit Card' : paymentMethod,
    };
    if (category) result.notes.push(`Category ${category.name} (from ${how})${item ? `; “${titleCase(item)}” goes in the description` : ''}.`);
    else result.questions.push(`Which category is this?${item ? ` (“${titleCase(item)}” stays as the description.)` : ''}`);
    if (!description) result.notes.push('Add a short description if you like.');
    if (!card && !from) result.notes.push('Account: not linked. Choose where it was paid from if you want that balance updated.');
    needAmount();
    noteDate();
    return result;
  }

  result.questions.push('Was this money you spent, money you received, an investment or a transfer? Choose below.');
  result.amount = amount;
  result.date = date;
  return result;
}

/** Plain-language one-liner describing the proposal (amounts passed through `fmt` so privacy mode can mask them). */
export function describe(result, ctx, fmt) {
  const cat = (id) => ctx.categories.find((c) => c.id === id)?.name;
  const t = result.tx;
  switch (result.intent) {
    case 'expense': return `Expense · ${cat(t.categoryId) || 'category?'} · ${t.description || '—'} · ${t.amount ? fmt(t.amount) : 'amount?'}`;
    case 'income': return `Income · ${cat(t.categoryId) || 'category?'} · ${t.description} · ${t.amount ? fmt(t.amount) : 'amount?'}`;
    case 'refund': return `Refund · ${cat(t.categoryId) || 'category?'} · ${t.amount ? fmt(t.amount) : 'amount?'}`;
    case 'transfer': return `Transfer · ${t.description} · ${t.amount ? fmt(t.amount) : 'amount?'}`;
    case 'investment': case 'rd_contribution': return `Investment · ${t.description} · ${t.amount ? fmt(t.amount) : 'amount?'}`;
    case 'investment_new_asset': return `New ${result.asset.name} holding · ${result.funding.amount ? fmt(result.funding.amount) : 'amount?'}`;
    case 'fd_create': return `New Fixed Deposit · ${result.asset.institution || 'bank?'} · ${result.funding.amount ? fmt(result.funding.amount) : 'principal?'}${result.asset.interestRate ? ` · ${result.asset.interestRate}%` : ''}${result.asset.maturityDate ? ` · matures ${result.asset.maturityDate}` : ''}`;
    case 'rd_create': return `New Recurring Deposit · ${result.asset.institution || 'bank?'} · ${result.asset.monthlyInstallment ? fmt(result.asset.monthlyInstallment) : 'installment?'} a month`;
    case 'asset_value': return `Update FD value · ${result.snapshot.value ? fmt(result.snapshot.value) : 'value?'}`;
    case 'asset_close': return 'FD maturity / closure';
    case 'liability_create': return `New loan · ${result.liability.openingOutstanding ? fmt(result.liability.openingOutstanding) : 'amount?'}`;
    case 'planned': return 'Not recorded: this is about the future';
    default: return 'Not sure what this is yet';
  }
}
