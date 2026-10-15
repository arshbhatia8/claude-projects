// Spendly's data layer. It plays the role a server + database would play,
// but runs inside your browser so the app can be hosted for free as static
// files and your data never leaves your device.
//
// • Storage: one encrypted "vault" in localStorage. AES-256-GCM, with the key
//   derived from your password (PBKDF2-SHA256, 310k rounds). Without the
//   password the data is unreadable.
// • Schema: versioned. Older vaults are migrated forward on unlock and nothing
//   is dropped.
// • Writes: every change runs through mutate(), which validates, applies the
//   change to a copy, saves, and rolls back if anything fails. Changes are
//   queued one at a time, so a double-tap cannot post the same thing twice.

import {
  defaultCategories, buildDemoData, SUGGESTED_TEMPLATES, ACCOUNT_TYPES, ASSET_TYPES, ASSET_STATUS,
  LIABILITY_TYPES, GOAL_KINDS, PAYMENT_METHODS, TX_TYPES, DATE_FORMATS,
} from './defaults.js';
import { parseAmount, MAX_PAISE, formatINR } from './money.js';
import { computeTotals, reversibleAmount } from './ledger.js';

export const SCHEMA = 2;
export const VAULT_KEY = 'spendly.vault';
export const LEGACY_VAULT_KEY = 'ledger.vault.v1';
const SESSION_KEY = 'spendly.session';
const PBKDF2_ROUNDS = 310000;

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function newId(prefix) {
  const r = globalThis.crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}${r[0].toString(36)}${r[1].toString(36)}`.slice(0, 32);
}

function deriveKey(password, salt) {
  return subtle
    .importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      )
    );
}

async function encryptJson(key, salt, value) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value)));
  return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

async function decryptJson(key, vault) {
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, key, unb64(vault.data));
  return JSON.parse(dec.decode(plain));
}

function blankAsset(extra) {
  return {
    name: '', type: 'other_investment', institution: '', symbol: '', quantity: '', avgPrice: null, grams: '',
    openedOn: '', maturityDate: '', interestRate: '', interestType: '', maturityAmount: null, monthlyInstallment: null,
    tenureMonths: 0, installmentsBefore: 0, status: 'active', linkedAccountId: null, liquid: false, notes: '', documentRef: '',
    openingInvested: 0, openingValue: 0, archived: false, ...extra,
  };
}

// ---------------------------------------------------------------------------
// Schema & migrations
// ---------------------------------------------------------------------------

export function emptyDb(now = new Date()) {
  return {
    schema: SCHEMA,
    createdAt: now.toISOString(),
    settings: {
      currency: 'INR',
      theme: 'dark',
      hideOnOpen: true,
      revealAmounts: false,
      dateFormat: 'DD MMM YYYY',
      timezone: 'Asia/Kolkata',
      lastBackupAt: null,
    },
    categories: defaultCategories(),
    accounts: [],
    assets: [],
    liabilities: [],
    transactions: [],
    templates: [],
    goals: [],
    snapshots: [], // reconciliations (accounts, liabilities) and valuations (assets)
    netWorthHistory: [],
    gmail: { clientId: '', email: null, filter: '', lastSyncAt: null, lastSuccessAt: null, lastResult: null, lastError: null, processedIds: [] },
    gmailCandidates: [],
  };
}

const V1_CATEGORY_MAP = {
  'Food & Dining': 'Food and Dining', Transport: 'Travel and Transport', Fuel: 'Travel and Transport', Travel: 'Travel and Transport',
  Rent: 'Rent and Electricity', 'Bills & Utilities': 'Rent and Electricity', 'Mobile & Internet': 'Subscriptions',
  Health: 'Personal Expenses', 'Personal Care': 'Personal Expenses', Entertainment: 'Personal Expenses', 'Gifts & Donations': 'Personal Expenses',
  'EMI / Loan': 'Other Expenses', Insurance: 'Other Expenses', Taxes: 'Other Expenses', 'Transfer Out': 'Other Expenses',
  Freelance: 'Freelance Income', Business: 'Business Income', Interest: 'Interest Income', Dividend: 'Dividends', Refund: 'Refunds',
  Cashback: 'Other Income', Gift: 'Other Income', 'Rental Income': 'Other Income', 'Investment Return': 'Other Income', 'Transfer In': 'Other Income',
};
const V1_ASSET_TYPE = {
  'Mutual Fund (SIP)': 'mutual_fund', 'Mutual Fund (Lumpsum)': 'mutual_fund', Stocks: 'stock', ETF: 'etf', 'Fixed Deposit': 'fd',
  'Recurring Deposit': 'rd', 'Gold / SGB': 'gold',
};

/** Ledger (v1) → Spendly (v2). Every v1 record is carried over. */
function migrateV1(old, now) {
  const db = emptyDb(now);
  const s = old.settings || {};
  db.gmail.clientId = s.googleClientId || '';
  db.gmail.filter = s.gmailFilter || '';
  db.gmail.email = s.gmailEmail || null;
  db.gmail.processedIds = Array.isArray(old.gmailSeen) ? old.gmailSeen.map(String) : [];

  const categoryId = (kind, rawName) => {
    let name = V1_CATEGORY_MAP[rawName] || rawName || '';
    if (!name || name === 'Other') name = kind === 'income' ? 'Other Income' : 'Other Expenses';
    let cat = db.categories.find((c) => c.kind === kind && !c.parentId && c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { id: newId('cat'), kind, name: name.slice(0, 60), parentId: null, archived: false };
      db.categories.push(cat);
    }
    return cat.id;
  };
  const assetFor = (t) => {
    const name = (t.invested_in || t.category || 'Investment').slice(0, 60);
    let asset = db.assets.find((a) => a.name === name);
    if (!asset) {
      asset = blankAsset({ id: newId('ast'), name, type: V1_ASSET_TYPE[t.category] || 'other_investment', institution: (t.platform || '').slice(0, 60), status: 'active' });
      db.assets.push(asset);
    }
    return asset.id;
  };

  for (const t of old.transactions || []) {
    const amount = Math.round(Number(t.amount) * 100);
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) continue;
    const extraNotes = [t.account && `Account: ${t.account}`, t.platform && `Platform: ${t.platform}`].filter(Boolean).join(' · ');
    const base = {
      id: newId('tx'), date: t.date, time: '', amount, description: String(t.description || '').slice(0, 200),
      paymentMethod: PAYMENT_METHODS.includes(t.payment_mode) ? t.payment_mode : '',
      notes: [t.notes, extraNotes].filter(Boolean).join('\n').slice(0, 1000),
      categoryId: null, subcategoryId: null, from: null, to: null, reversesId: null, externalRef: '',
      source: t.source === 'gmail' ? 'gmail' : 'manual', gmailMessageId: t.gmail_id || null, templateId: null,
      createdAt: t.created_at || now.toISOString(), updatedAt: t.updated_at || now.toISOString(),
    };
    if (t.type === 'credit') db.transactions.push({ ...base, type: 'income', categoryId: categoryId('income', t.category) });
    else if (t.type === 'debit') db.transactions.push({ ...base, type: 'expense', categoryId: categoryId('expense', t.category) });
    else if (t.type === 'investment') db.transactions.push({ ...base, type: 'investment', to: { kind: 'asset', id: assetFor(t) } });
  }
  return db;
}

export function migrate(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new Error('Unreadable data');
  let db = raw;
  if (!db.schema) db = migrateV1(db, now);
  if (db.schema > SCHEMA) throw new Error('This data was saved by a newer version of Spendly. Reload the page to update.');
  // Fill in anything a future field addition needs, without touching existing data.
  const fresh = emptyDb(now);
  for (const key of Object.keys(fresh)) if (db[key] === undefined) db[key] = fresh[key];
  db.settings = { ...fresh.settings, ...db.settings };
  db.gmail = { ...fresh.gmail, ...db.gmail };
  db.schema = SCHEMA;
  return db;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const clip = (v, max) => String(v ?? '').trim().slice(0, max);

function checkDate(v, field, { required = true, label = 'date' } = {}) {
  const s = String(v || '');
  if (!s) {
    if (required) throw new ValidationError(`Choose a ${label}`, field);
    return '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw new ValidationError(`Enter a valid ${label}`, field);
  const [y, m, d] = s.split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1, d));
  if (back.getUTCDate() !== d) throw new ValidationError(`Enter a valid ${label}`, field);
  return s;
}

function money(v, field, { required = true, allowZero = false, label = 'amount' } = {}) {
  if (v === null || v === undefined || v === '') {
    if (required) throw new ValidationError(`Enter the ${label}`, field);
    return null;
  }
  const p = parseAmount(v);
  if (p === null) throw new ValidationError(`Enter the ${label} as a number, e.g. 1250 or 1250.50`, field);
  if (!allowZero && p <= 0) throw new ValidationError(`The ${label} must be more than ₹0`, field);
  if (p > MAX_PAISE) throw new ValidationError(`That ${label} is too large`, field);
  return p;
}

function decimalText(v, field, label, max = 1e9) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s) || Number(s) > max) throw new ValidationError(`Enter ${label} as a number`, field);
  return s;
}

function intValue(v, field, label, max = 1000) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new ValidationError(`Enter ${label} as a whole number`, field);
  return n;
}

const normName = (s) => String(s || '').toLowerCase().replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();

const COLLECTION = { account: 'accounts', asset: 'assets', liability: 'liabilities' };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function createStore({ storage = globalThis.localStorage, session = globalThis.sessionStorage, now = () => new Date() } = {}) {
  let key = null;
  let salt = null;
  let db = null;
  let queue = Promise.resolve();
  const listeners = new Set();

  const safeGet = (k) => { try { return storage.getItem(k); } catch { return null; } };
  const readVault = (k = VAULT_KEY) => { try { return JSON.parse(safeGet(k)); } catch { return null; } };

  async function persist() {
    const vault = await encryptJson(key, salt, db);
    storage.setItem(VAULT_KEY, JSON.stringify(vault)); // throws on quota errors → caller rolls back
  }

  async function rememberSession() {
    try { session?.setItem(SESSION_KEY, b64(await subtle.exportKey('raw', key))); } catch { /* ask again next time */ }
  }

  function requireUnlocked() {
    if (!db) {
      const err = new Error('Spendly is locked');
      err.status = 401;
      throw err;
    }
  }

  const nowIso = () => now().toISOString();

  function today() {
    const tz = db?.settings?.timezone || 'Asia/Kolkata';
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
    } catch {
      return now().toISOString().slice(0, 10);
    }
  }

  function recordNetWorth(d) {
    if (!d.accounts.length && !d.assets.length && !d.liabilities.length) return;
    const t = computeTotals(d);
    const date = today();
    const month = date.slice(0, 7);
    const hasSample = [...d.accounts, ...d.assets, ...d.liabilities].some((x) => x.sample);
    const entry = { month, date, assets: t.totalAssets, liabilities: t.totalLiabilities, netWorth: t.netWorth, sample: hasSample };
    const i = d.netWorthHistory.findIndex((h) => h.month === month);
    if (i >= 0) d.netWorthHistory[i] = entry;
    else d.netWorthHistory.push(entry);
    d.netWorthHistory.sort((a, b) => (a.month < b.month ? -1 : 1));
  }

  /** Apply a change atomically: validate + mutate a copy, save, or roll back. */
  function mutate(fn) {
    const run = async () => {
      requireUnlocked();
      const before = db;
      const draft = structuredClone(db);
      try {
        const result = fn(draft);
        recordNetWorth(draft);
        db = draft;
        await persist();
        listeners.forEach((l) => l());
        return result;
      } catch (err) {
        db = before;
        throw err;
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  // ---------- auth ----------

  async function status() {
    if (db) return { setUp: true, signedIn: true };
    const vault = readVault() || readVault(LEGACY_VAULT_KEY);
    if (!vault) return { setUp: false, signedIn: false };
    const raw = (() => { try { return session?.getItem(SESSION_KEY); } catch { return null; } })();
    if (raw && readVault()) {
      try {
        const k = await subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
        const v = readVault();
        db = migrate(await decryptJson(k, v), now());
        key = k;
        salt = unb64(v.salt);
        return { setUp: true, signedIn: true };
      } catch {
        try { session.removeItem(SESSION_KEY); } catch { /* ignore */ }
      }
    }
    return { setUp: true, signedIn: false };
  }

  async function setup(password) {
    if (readVault() || readVault(LEGACY_VAULT_KEY)) throw new ValidationError('A password is already set');
    if (!password || password.length < 8) throw new ValidationError('Use at least 8 characters', 'password');
    salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    key = await deriveKey(password, salt);
    db = emptyDb(now());
    await persist();
    await rememberSession();
  }

  async function unlock(password) {
    const current = readVault();
    const legacy = !current && readVault(LEGACY_VAULT_KEY);
    const vault = current || legacy;
    if (!vault) throw new ValidationError('Nothing to unlock');
    const s = unb64(vault.salt);
    const k = await deriveKey(password || '', s);
    let raw;
    try {
      raw = await decryptJson(k, vault);
    } catch {
      throw new ValidationError('Wrong password', 'password');
    }
    key = k;
    salt = s;
    db = migrate(raw, now());
    if (db.settings.hideOnOpen) db.settings.revealAmounts = false;
    if (legacy || raw.schema !== SCHEMA) {
      await persist(); // save the migrated copy first …
      if (legacy) storage.removeItem(LEGACY_VAULT_KEY); // … then retire the old vault
    }
    await rememberSession();
  }

  function lock() {
    key = null;
    db = null;
    try { session?.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  async function changePassword(current, next) {
    requireUnlocked();
    const vault = readVault();
    try {
      await decryptJson(await deriveKey(current || '', unb64(vault.salt)), vault);
    } catch {
      throw new ValidationError('Current password is wrong', 'current');
    }
    if (!next || next.length < 8) throw new ValidationError('Use at least 8 characters for the new password', 'next');
    const newSalt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const newKey = await deriveKey(next, newSalt);
    const old = [key, salt];
    [key, salt] = [newKey, newSalt];
    try {
      await persist();
    } catch (e) {
      [key, salt] = old;
      throw e;
    }
    await rememberSession();
  }

  function resetEverything() {
    storage.removeItem(VAULT_KEY);
    storage.removeItem(LEGACY_VAULT_KEY);
    lock();
  }

  // ---------- lookups ----------

  const findIn = (d, coll, id) => d[coll].find((x) => x.id === id);
  const entity = (d, ref) => (ref ? findIn(d, COLLECTION[ref.kind], ref.id) : null);

  function endpoint(d, value, allowed, field, required, existing) {
    if (!value || !value.id) {
      if (required) throw new ValidationError(field === 'from' ? 'Choose where the money comes from' : 'Choose where the money goes', field);
      return null;
    }
    if (!allowed.includes(value.kind)) throw new ValidationError('That choice is not allowed for this type', field);
    const e = findIn(d, COLLECTION[value.kind], value.id);
    if (!e) throw new ValidationError('That account no longer exists', field);
    const wasUsed = existing && [existing.from, existing.to].some((r) => r && r.kind === value.kind && r.id === value.id);
    if (e.archived && !wasUsed) throw new ValidationError(`${e.name} is archived`, field);
    return { kind: value.kind, id: value.id };
  }

  function category(d, input, kind, existing) {
    const c = d.categories.find((x) => x.id === input.categoryId && x.kind === kind && !x.parentId);
    if (!c) throw new ValidationError('Choose a category', 'categoryId');
    if (c.archived && existing?.categoryId !== c.id) throw new ValidationError(`${c.name} is archived`, 'categoryId');
    let sub = null;
    if (input.subcategoryId) {
      const s = d.categories.find((x) => x.id === input.subcategoryId && x.parentId === c.id);
      if (!s) throw new ValidationError('Choose a subcategory that belongs to this category', 'subcategoryId');
      sub = s.id;
    }
    return { categoryId: c.id, subcategoryId: sub, name: c.name };
  }

  /** Validate and normalise transaction input. */
  function normalizeTx(d, input, existing = null) {
    const type = input.type;
    if (!TX_TYPES[type]) throw new ValidationError('Choose a transaction type', 'type');
    const amount = money(input.amount, 'amount');
    const date = checkDate(input.date, 'date');
    const time = String(input.time || '');
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new ValidationError('Enter a valid time', 'time');
    const tx = {
      type, amount, date, time,
      description: clip(input.description, 200),
      notes: clip(input.notes, 1000),
      paymentMethod: PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : '',
      externalRef: clip(input.externalRef, 64),
      categoryId: null, subcategoryId: null, from: null, to: null, reversesId: null,
    };
    let catName = '';
    const setCat = (kind) => {
      const c = category(d, input, kind, existing);
      tx.categoryId = c.categoryId;
      tx.subcategoryId = c.subcategoryId;
      catName = c.name;
    };
    switch (type) {
      case 'income':
        setCat('income');
        tx.to = endpoint(d, input.to, ['account'], 'to', false, existing);
        break;
      case 'expense':
        setCat('expense');
        tx.from = endpoint(d, input.from, ['account', 'liability'], 'from', false, existing);
        break;
      case 'refund':
        setCat('expense');
        tx.to = endpoint(d, input.to, ['account', 'liability'], 'to', false, existing);
        break;
      case 'transfer':
        tx.from = endpoint(d, input.from, ['account', 'asset', 'liability'], 'from', true, existing);
        tx.to = endpoint(d, input.to, ['account', 'asset', 'liability'], 'to', true, existing);
        if (tx.from.kind === tx.to.kind && tx.from.id === tx.to.id) throw new ValidationError('From and To must be different', 'to');
        break;
      case 'investment':
        tx.from = endpoint(d, input.from, ['account'], 'from', false, existing);
        tx.to = endpoint(d, input.to, ['asset'], 'to', true, existing);
        break;
      case 'reversal': {
        const orig = d.transactions.find((t) => t.id === input.reversesId);
        if (!orig) throw new ValidationError('Choose the transaction to reverse', 'reversesId');
        if (orig.type === 'reversal') throw new ValidationError('A reversal cannot be reversed. Delete it instead.', 'reversesId');
        const left = reversibleAmount(d, orig.id, existing?.id || null);
        if (amount > left) throw new ValidationError(`You can reverse at most ${formatINR(left)} of this transaction`, 'amount');
        Object.assign(tx, { reversesId: orig.id, categoryId: orig.categoryId, subcategoryId: orig.subcategoryId, from: orig.from, to: orig.to });
        if (!tx.description) tx.description = `Reversal: ${orig.description || TX_TYPES[orig.type].label}`.slice(0, 200);
        break;
      }
    }
    if (!tx.description) tx.description = catName || TX_TYPES[type].label;
    if (existing) {
      const reversed = existing.amount - reversibleAmount(d, existing.id);
      if (reversed > 0 && (amount < reversed || type !== existing.type)) {
        throw new ValidationError(`This transaction has reversals totalling ${formatINR(reversed)}. Delete them before lowering the amount or changing the type.`, 'amount');
      }
    }
    return tx;
  }

  function normalizeTemplate(d, input, existing = null) {
    const name = clip(input.name, 60);
    if (!name) throw new ValidationError('Give the template a name', 'name');
    if (d.templates.some((t) => t.id !== existing?.id && normName(t.name) === normName(name))) {
      throw new ValidationError(`A template called “${name}” already exists`, 'name');
    }
    const type = input.type;
    if (!['expense', 'income', 'refund', 'transfer', 'investment'].includes(type)) throw new ValidationError('Choose a transaction type', 'type');
    const t = {
      name, type,
      amount: money(input.amount, 'amount', { required: false, label: 'default amount' }),
      description: clip(input.description, 200),
      notes: clip(input.notes, 1000),
      paymentMethod: PAYMENT_METHODS.includes(input.paymentMethod) ? input.paymentMethod : '',
      categoryId: null, subcategoryId: null, from: null, to: null,
      pinned: Boolean(input.pinned),
    };
    if (type === 'income' || type === 'expense' || type === 'refund') {
      const c = category(d, input, type === 'income' ? 'income' : 'expense', existing);
      t.categoryId = c.categoryId;
      t.subcategoryId = c.subcategoryId;
    }
    const allowedFrom = { expense: ['account', 'liability'], transfer: ['account', 'asset', 'liability'], investment: ['account'] }[type];
    const allowedTo = { income: ['account'], refund: ['account', 'liability'], transfer: ['account', 'asset', 'liability'], investment: ['asset'] }[type];
    if (allowedFrom) t.from = endpoint(d, input.from, allowedFrom, 'from', false, existing);
    if (allowedTo) t.to = endpoint(d, input.to, allowedTo, 'to', false, existing);
    return t;
  }

  function addTx(d, tx, extra = {}) {
    const stamp = nowIso();
    const record = { id: newId('tx'), ...tx, source: 'manual', gmailMessageId: null, templateId: null, createdAt: stamp, updatedAt: stamp, ...extra };
    d.transactions.push(record);
    return record;
  }

  function templateFromTx(d, tx, name, pinned) {
    const stamp = nowIso();
    const t = {
      id: newId('tpl'), name: clip(name, 60), type: tx.type, amount: tx.amount, description: tx.description, notes: '',
      paymentMethod: tx.paymentMethod, categoryId: tx.categoryId, subcategoryId: tx.subcategoryId, from: tx.from, to: tx.to,
      pinned: Boolean(pinned), useCount: 1, lastUsedAt: stamp, createdAt: stamp, updatedAt: stamp,
    };
    d.templates.push(t);
    return t;
  }

  // ---------- transactions ----------

  /**
   * Create a transaction. Optional:
   *   templateId     – record that a quick-add template was used (usage stats only)
   *   saveAsTemplate – { name, pinned } to also keep it as a reusable template
   */
  function createTransaction(input, { templateId = null, saveAsTemplate = null } = {}) {
    return mutate((d) => {
      const tx = addTx(d, normalizeTx(d, input), { templateId: templateId || null });
      let template = null;
      let templateExists = false;
      if (templateId) {
        const t = findIn(d, 'templates', templateId);
        if (t) {
          t.useCount = (t.useCount || 0) + 1;
          t.lastUsedAt = nowIso();
        }
      }
      if (saveAsTemplate && saveAsTemplate.name) {
        const existing = d.templates.find((t) => normName(t.name) === normName(saveAsTemplate.name));
        if (existing) templateExists = true;
        else template = templateFromTx(d, tx, saveAsTemplate.name, saveAsTemplate.pinned);
      }
      return { transaction: tx, template, templateExists };
    });
  }

  function updateTransaction(id, input) {
    return mutate((d) => {
      const tx = findIn(d, 'transactions', id);
      if (!tx) throw new ValidationError('That transaction no longer exists');
      if (tx.type === 'reversal' && input.type !== 'reversal') throw new ValidationError('A reversal stays a reversal. Delete it instead.');
      Object.assign(tx, normalizeTx(d, { ...input, reversesId: tx.reversesId }, tx), { updatedAt: nowIso() });
      return tx;
    });
  }

  function deleteTransaction(id) {
    return mutate((d) => {
      const tx = findIn(d, 'transactions', id);
      if (!tx) throw new ValidationError('That transaction no longer exists');
      if (d.transactions.some((t) => t.type === 'reversal' && t.reversesId === id)) {
        throw new ValidationError('This transaction has a reversal. Delete the reversal first.');
      }
      d.transactions = d.transactions.filter((t) => t.id !== id);
      // An imported email stays "handled", so the next sync will not bring it back.
      for (const c of d.gmailCandidates) {
        if (c.transactionId === id) Object.assign(c, { status: 'reviewed', transactionId: null, note: 'Transaction deleted after import', updatedAt: nowIso() });
      }
      return true;
    });
  }

  // ---------- templates ----------

  function saveTemplate(input, id = null) {
    return mutate((d) => {
      const existing = id ? findIn(d, 'templates', id) : null;
      if (id && !existing) throw new ValidationError('That template no longer exists');
      const t = normalizeTemplate(d, input, existing);
      if (existing) {
        Object.assign(existing, t, { updatedAt: nowIso() }); // past transactions are separate records and stay as they were
        return existing;
      }
      const stamp = nowIso();
      const created = { id: newId('tpl'), ...t, useCount: 0, lastUsedAt: null, createdAt: stamp, updatedAt: stamp };
      d.templates.push(created);
      return created;
    });
  }

  function setTemplatePinned(id, pinned) {
    return mutate((d) => {
      const t = findIn(d, 'templates', id);
      if (!t) throw new ValidationError('That template no longer exists');
      t.pinned = Boolean(pinned);
      return t;
    });
  }

  function deleteTemplate(id) {
    return mutate((d) => {
      d.templates = d.templates.filter((t) => t.id !== id); // transactions made from it are kept
      return true;
    });
  }

  function addSuggestedTemplates() {
    return mutate((d) => {
      let added = 0;
      const stamp = nowIso();
      for (const s of SUGGESTED_TEMPLATES) {
        if (d.templates.some((t) => normName(t.name) === normName(s.name))) continue;
        const cat = d.categories.find((c) => c.kind === 'expense' && !c.parentId && c.name === s.category);
        if (!cat) continue;
        d.templates.push({
          id: newId('tpl'), name: s.name, type: 'expense', amount: s.amount, description: s.name.replace(' – ', ' · '), notes: '',
          paymentMethod: '', categoryId: cat.id, subcategoryId: null, from: null, to: null, pinned: Boolean(s.pinned),
          useCount: 0, lastUsedAt: null, createdAt: stamp, updatedAt: stamp,
        });
        added++;
      }
      return added;
    });
  }

  // ---------- categories ----------

  function addCategory({ kind, name, parentId = null }) {
    return mutate((d) => {
      if (!['income', 'expense'].includes(kind)) throw new ValidationError('Choose income or expense', 'kind');
      const n = clip(name, 60);
      if (!n) throw new ValidationError('Enter a name', 'name');
      if (parentId && !d.categories.some((c) => c.id === parentId && c.kind === kind && !c.parentId)) throw new ValidationError('Parent category not found');
      if (d.categories.some((c) => c.kind === kind && (c.parentId || null) === (parentId || null) && normName(c.name) === normName(n))) {
        throw new ValidationError(`“${n}” already exists`, 'name');
      }
      const c = { id: newId('cat'), kind, name: n, parentId: parentId || null, archived: false };
      d.categories.push(c);
      return c;
    });
  }

  function renameCategory(id, name) {
    return mutate((d) => {
      const c = findIn(d, 'categories', id);
      if (!c) throw new ValidationError('Category not found');
      const n = clip(name, 60);
      if (!n) throw new ValidationError('Enter a name', 'name');
      if (d.categories.some((x) => x.id !== id && x.kind === c.kind && (x.parentId || null) === (c.parentId || null) && normName(x.name) === normName(n))) {
        throw new ValidationError(`“${n}” already exists`, 'name');
      }
      c.name = n;
      return c;
    });
  }

  function setCategoryArchived(id, archived) {
    return mutate((d) => {
      const c = findIn(d, 'categories', id);
      if (!c) throw new ValidationError('Category not found');
      c.archived = Boolean(archived);
      return c;
    });
  }

  // ---------- accounts ----------

  function normalizeAccount(d, input, existing) {
    const name = clip(input.name, 60);
    if (!name) throw new ValidationError('Give the account a name', 'name');
    if (!ACCOUNT_TYPES[input.type]) throw new ValidationError('Choose an account type', 'type');
    if (d.accounts.some((a) => a.id !== existing?.id && !a.archived && normName(a.name) === normName(name))) throw new ValidationError('You already have an account with this name', 'name');
    const identifier = clip(input.identifier, 8);
    if (identifier && !/^[A-Za-z0-9]+$/.test(identifier)) throw new ValidationError('Use only the last digits, e.g. 1234', 'identifier');
    return {
      name, type: input.type, institution: clip(input.institution, 60), identifier,
      openingBalance: money(input.openingBalance, 'openingBalance', { required: false, allowZero: true, label: 'opening balance' }) || 0,
      openingDate: checkDate(input.openingDate, 'openingDate', { required: false }),
      notes: clip(input.notes, 500),
    };
  }

  function saveAccount(input, id = null) {
    return mutate((d) => {
      const existing = id ? findIn(d, 'accounts', id) : null;
      const a = normalizeAccount(d, input, existing);
      if (existing) return Object.assign(existing, a, { updatedAt: nowIso() });
      const created = { id: newId('acc'), ...a, archived: false, createdAt: nowIso(), updatedAt: nowIso() };
      d.accounts.push(created);
      return created;
    });
  }

  const isReferenced = (d, kind, id) =>
    d.transactions.some((t) => [t.from, t.to].some((r) => r && r.kind === kind && r.id === id)) ||
    d.snapshots.some((s) => s.kind === kind && s.refId === id);

  function setArchived(kind, id, archived) {
    return mutate((d) => {
      const e = findIn(d, COLLECTION[kind], id);
      if (!e) throw new ValidationError('Not found');
      e.archived = Boolean(archived);
      return e;
    });
  }

  function deleteEntity(kind, id) {
    return mutate((d) => {
      if (isReferenced(d, kind, id)) throw new ValidationError('This has transactions or balance updates linked to it. Archive it instead so your history stays correct.');
      d[COLLECTION[kind]] = d[COLLECTION[kind]].filter((x) => x.id !== id);
      for (const t of d.templates) {
        if (t.from?.kind === kind && t.from.id === id) t.from = null;
        if (t.to?.kind === kind && t.to.id === id) t.to = null;
      }
      return true;
    });
  }

  /** Manual reconciliation (accounts, liabilities) or valuation (assets): "on <date> the true figure was <value>". */
  function recordSnapshot(kind, refId, { date, value, note }) {
    return mutate((d) => {
      if (!findIn(d, COLLECTION[kind], refId)) throw new ValidationError('Not found');
      const snap = {
        id: newId('snap'), kind, refId,
        date: checkDate(date, 'date'),
        value: money(value, 'value', { allowZero: true, label: kind === 'asset' ? 'current value' : kind === 'liability' ? 'outstanding amount' : 'balance' }),
        note: clip(note, 200),
        createdAt: nowIso(),
      };
      d.snapshots.push(snap);
      return snap;
    });
  }

  function deleteSnapshot(id) {
    return mutate((d) => {
      d.snapshots = d.snapshots.filter((s) => s.id !== id);
      return true;
    });
  }

  // ---------- assets ----------

  function normalizeAsset(d, input) {
    const name = clip(input.name, 60);
    if (!name) throw new ValidationError('Give the asset a name', 'name');
    if (!ASSET_TYPES[input.type]) throw new ValidationError('Choose an asset type', 'type');
    const openedOn = checkDate(input.openedOn, 'openedOn', { required: false, label: 'opening date' });
    const maturityDate = checkDate(input.maturityDate, 'maturityDate', { required: false, label: 'maturity date' });
    if (openedOn && maturityDate && maturityDate < openedOn) throw new ValidationError('Maturity date must be after the opening date', 'maturityDate');
    if (input.linkedAccountId && !findIn(d, 'accounts', input.linkedAccountId)) throw new ValidationError('Linked account not found', 'linkedAccountId');
    if (input.status && !ASSET_STATUS[input.status]) throw new ValidationError('Choose a status', 'status');
    return {
      name, type: input.type,
      institution: clip(input.institution, 60),
      symbol: clip(input.symbol, 20),
      quantity: decimalText(input.quantity, 'quantity', 'quantity'),
      avgPrice: money(input.avgPrice, 'avgPrice', { required: false, label: 'average price' }),
      grams: decimalText(input.grams, 'grams', 'grams'),
      openedOn, maturityDate,
      interestRate: decimalText(input.interestRate, 'interestRate', 'the interest rate', 100),
      interestType: clip(input.interestType, 40),
      maturityAmount: money(input.maturityAmount, 'maturityAmount', { required: false, label: 'maturity amount' }),
      monthlyInstallment: money(input.monthlyInstallment, 'monthlyInstallment', { required: false, label: 'monthly installment' }),
      tenureMonths: intValue(input.tenureMonths, 'tenureMonths', 'tenure in months', 600),
      installmentsBefore: intValue(input.installmentsBefore, 'installmentsBefore', 'installments already paid', 600),
      status: input.status || 'active',
      linkedAccountId: input.linkedAccountId || null,
      liquid: input.type === 'other_asset' && Boolean(input.liquid),
      notes: clip(input.notes, 1000),
      documentRef: clip(input.documentRef, 200),
    };
  }

  /**
   * Add an asset. funding:
   *   { mode: 'account', accountId, amount, date } – money moved from a tracked account (posts an investment transfer,
   *                                                   so total assets do not change)
   *   { mode: 'existing', invested, value }         – something you already own; recorded at its current value
   */
  function addAsset(input, funding = { mode: 'existing' }) {
    return mutate((d) => {
      const asset = { id: newId('ast'), ...blankAsset(), ...normalizeAsset(d, input), createdAt: nowIso(), updatedAt: nowIso() };
      if (funding.mode === 'account') {
        asset.openingInvested = 0;
        asset.openingValue = 0;
        d.assets.push(asset);
        const tx = normalizeTx(d, {
          type: 'investment', amount: funding.amount, date: funding.date || asset.openedOn || today(),
          from: { kind: 'account', id: funding.accountId }, to: { kind: 'asset', id: asset.id },
          description: `Invested in ${asset.name}`, paymentMethod: funding.paymentMethod || 'Net Banking',
        });
        if (!tx.from) throw new ValidationError('Choose the account the money came from', 'fundingAccount');
        addTx(d, tx);
      } else {
        asset.openingInvested = money(funding.invested, 'invested', { required: false, allowZero: true, label: 'invested amount' }) || 0;
        const value = money(funding.value, 'value', { required: false, allowZero: true, label: 'current value' });
        asset.openingValue = value === null ? asset.openingInvested : value;
        d.assets.push(asset);
      }
      return asset;
    });
  }

  function updateAsset(id, input, { invested, value } = {}) {
    return mutate((d) => {
      const asset = findIn(d, 'assets', id);
      if (!asset) throw new ValidationError('That asset no longer exists');
      Object.assign(asset, normalizeAsset(d, input), { updatedAt: nowIso() });
      if (invested !== undefined) asset.openingInvested = money(invested, 'invested', { required: false, allowZero: true, label: 'invested amount' }) || 0;
      if (value !== undefined) asset.openingValue = money(value, 'value', { required: false, allowZero: true, label: 'value' }) || 0;
      return asset;
    });
  }

  /**
   * FD / RD maturity or closure. The current recorded value moves back to the
   * payout account as a transfer (no income, no expense). Anything received on
   * top is recorded as Interest Income; a shortfall (e.g. premature-closure
   * penalty) lowers the asset's value to zero on that date instead of being
   * booked as spending.
   */
  function closeAsset(id, { accountId, amountReceived, date, status = 'matured' }) {
    return mutate((d) => {
      const asset = findIn(d, 'assets', id);
      if (!asset) throw new ValidationError('That asset no longer exists');
      if (asset.status !== 'active') throw new ValidationError('This asset is already closed');
      if (!['matured', 'closed'].includes(status)) throw new ValidationError('Choose matured or closed');
      const when = checkDate(date, 'date');
      const received = money(amountReceived, 'amountReceived', { allowZero: true, label: 'amount received' });
      const acct = endpoint(d, { kind: 'account', id: accountId }, ['account'], 'accountId', true, null);
      const value = computeTotals(d).assets.find((a) => a.id === id).value;
      const principal = Math.min(value, received);
      if (principal > 0) {
        addTx(d, { type: 'transfer', amount: principal, date: when, time: '', description: `${asset.name} — ${status === 'matured' ? 'maturity' : 'closure'} payout`, notes: '', paymentMethod: 'Net Banking', externalRef: '', categoryId: null, subcategoryId: null, from: { kind: 'asset', id }, to: acct, reversesId: null });
      }
      if (received > value) {
        const cat = d.categories.find((c) => c.kind === 'income' && !c.parentId && c.name === 'Interest Income') || d.categories.find((c) => c.kind === 'income' && !c.parentId);
        addTx(d, { type: 'income', amount: received - value, date: when, time: '', description: `Interest — ${asset.name}`, notes: '', paymentMethod: 'Net Banking', externalRef: '', categoryId: cat.id, subcategoryId: null, from: null, to: acct, reversesId: null });
      }
      if (received < value) {
        d.snapshots.push({ id: newId('snap'), kind: 'asset', refId: id, date: when, value: 0, note: `Closed with ${formatINR(value - received)} less than recorded value`, createdAt: nowIso() });
      }
      asset.status = status;
      asset.closedOn = when;
      asset.updatedAt = nowIso();
      return asset;
    });
  }

  // ---------- liabilities ----------

  function saveLiability(input, id = null) {
    return mutate((d) => {
      const existing = id ? findIn(d, 'liabilities', id) : null;
      const name = clip(input.name, 60);
      if (!name) throw new ValidationError('Give it a name', 'name');
      if (!LIABILITY_TYPES[input.type]) throw new ValidationError('Choose a type', 'type');
      if (input.linkedAccountId && !findIn(d, 'accounts', input.linkedAccountId)) throw new ValidationError('Linked account not found', 'linkedAccountId');
      const identifier = clip(input.identifier, 8);
      if (identifier && !/^[A-Za-z0-9]+$/.test(identifier)) throw new ValidationError('Use only the last digits, e.g. 4321', 'identifier');
      const l = {
        name, type: input.type, institution: clip(input.institution, 60), identifier,
        originalAmount: money(input.originalAmount, 'originalAmount', { required: false, label: 'original amount' }),
        openingOutstanding: money(input.openingOutstanding, 'openingOutstanding', { required: false, allowZero: true, label: 'outstanding amount' }) || 0,
        startDate: checkDate(input.startDate, 'startDate', { required: false, label: 'start date' }),
        dueDate: checkDate(input.dueDate, 'dueDate', { required: false, label: 'due date' }),
        interestRate: decimalText(input.interestRate, 'interestRate', 'the interest rate', 100),
        linkedAccountId: input.linkedAccountId || null,
        notes: clip(input.notes, 1000),
      };
      if (existing) return Object.assign(existing, l, { updatedAt: nowIso() });
      const created = { id: newId('lia'), ...l, archived: false, createdAt: nowIso(), updatedAt: nowIso() };
      d.liabilities.push(created);
      return created;
    });
  }

  // ---------- goals ----------

  function saveGoal(input, id = null) {
    return mutate((d) => {
      const existing = id ? findIn(d, 'goals', id) : null;
      const name = clip(input.name, 60);
      if (!name) throw new ValidationError('Give the goal a name', 'name');
      if (!GOAL_KINDS[input.kind]) throw new ValidationError('Choose a goal type', 'kind');
      const g = {
        name, kind: input.kind,
        target: money(input.target, 'target', { label: 'target amount' }),
        current: money(input.current, 'current', { required: false, allowZero: true, label: 'current amount' }) || 0,
        targetDate: checkDate(input.targetDate, 'targetDate', { required: false, label: 'target date' }),
        notes: clip(input.notes, 1000),
      };
      if (existing) return Object.assign(existing, g, { updatedAt: nowIso() });
      const created = { id: newId('goal'), ...g, archived: false, createdAt: nowIso(), updatedAt: nowIso() };
      d.goals.push(created);
      return created;
    });
  }

  function deleteGoal(id) {
    return mutate((d) => {
      d.goals = d.goals.filter((g) => g.id !== id);
      return true;
    });
  }

  // ---------- settings ----------

  function updateSettings(patch) {
    return mutate((d) => {
      const s = d.settings;
      if ('theme' in patch) {
        if (!['dark', 'light'].includes(patch.theme)) throw new ValidationError('Choose dark or light');
        s.theme = patch.theme;
      }
      if ('hideOnOpen' in patch) s.hideOnOpen = Boolean(patch.hideOnOpen);
      if ('revealAmounts' in patch) s.revealAmounts = Boolean(patch.revealAmounts);
      if ('dateFormat' in patch) {
        if (!DATE_FORMATS[patch.dateFormat]) throw new ValidationError('Choose a date format');
        s.dateFormat = patch.dateFormat;
      }
      if ('timezone' in patch) {
        try { new Intl.DateTimeFormat('en', { timeZone: patch.timezone }); } catch { throw new ValidationError('Unknown timezone'); }
        s.timezone = patch.timezone;
      }
      return { ...s };
    });
  }

  function recordBackup() {
    return mutate((d) => {
      d.settings.lastBackupAt = nowIso();
      return d.settings.lastBackupAt;
    });
  }

  // ---------- Gmail (review-and-approve) ----------

  function setGmail(patch) {
    return mutate((d) => {
      const g = d.gmail;
      if ('clientId' in patch) {
        const id = clip(patch.clientId, 200);
        if (id && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(id)) throw new ValidationError('A Google client ID ends in .apps.googleusercontent.com', 'clientId');
        g.clientId = id;
      }
      if ('filter' in patch) g.filter = clip(patch.filter, 300);
      if ('email' in patch) g.email = patch.email ? clip(patch.email, 120) : null;
      if ('lastError' in patch) g.lastError = patch.lastError ? clip(patch.lastError, 300) : null;
      return { ...g };
    });
  }

  function suggestFor(d, parsed) {
    const kind = parsed.type === 'income' ? 'income' : 'expense';
    const cat =
      d.categories.find((c) => c.kind === kind && !c.parentId && !c.archived && c.name === parsed.categoryName) ||
      d.categories.find((c) => c.kind === kind && !c.parentId && !c.archived && c.name === (kind === 'income' ? 'Other Income' : 'Other Expenses'));
    let endpointRef = null;
    const digits = (parsed.accountHint || '').replace(/\D/g, '').slice(-4);
    if (digits) {
      const acc = d.accounts.find((a) => !a.archived && a.identifier && a.identifier.endsWith(digits));
      const card = d.liabilities.find((l) => !l.archived && l.identifier && l.identifier.endsWith(digits));
      if (card && (parsed.paymentMethod === 'Credit Card' || !acc)) endpointRef = { kind: 'liability', id: card.id };
      else if (acc) endpointRef = { kind: 'account', id: acc.id };
    }
    if (parsed.type === 'income' && endpointRef?.kind === 'liability') endpointRef = null;
    return { categoryId: cat?.id || null, endpoint: endpointRef };
  }

  /** Store newly detected emails as *pending* candidates. Nothing is posted here. */
  function addGmailCandidates(items, { processedIds = [], scanned = 0, failed = 0 } = {}) {
    return mutate((d) => {
      const known = new Set([...d.gmailCandidates.map((c) => c.messageId), ...d.gmail.processedIds]);
      let added = 0;
      for (const item of items) {
        if (known.has(item.messageId)) continue;
        known.add(item.messageId);
        const stamp = nowIso();
        d.gmailCandidates.push({
          id: newId('gmc'),
          messageId: item.messageId,
          emailDate: item.emailDate,
          sender: clip(item.sender, 120),
          subject: clip(item.subject, 200),
          excerpt: clip(item.excerpt, 240),
          parsed: item.parsed || null,
          suggestion: item.parsed ? suggestFor(d, item.parsed) : null,
          confidence: item.parsed?.confidence || 'low',
          status: item.error ? 'failed' : 'pending',
          error: item.error ? clip(item.error, 200) : null,
          transactionId: null,
          createdAt: stamp,
          updatedAt: stamp,
        });
        added++;
      }
      for (const id of processedIds) if (!known.has(id)) d.gmail.processedIds.push(id);
      if (d.gmail.processedIds.length > 5000) d.gmail.processedIds = d.gmail.processedIds.slice(-5000);
      const at = nowIso();
      d.gmail.lastSyncAt = at;
      d.gmail.lastSuccessAt = at;
      d.gmail.lastError = null;
      d.gmail.lastResult = { scanned, detected: added, failed };
      return added;
    });
  }

  /** Replace a failed candidate with the result of a retry. */
  function updateGmailCandidate(id, { parsed, error, sender, subject, excerpt, emailDate }) {
    return mutate((d) => {
      const c = findIn(d, 'gmailCandidates', id);
      if (!c) throw new ValidationError('Import not found');
      if (c.status === 'approved') return c;
      if (!parsed && !error) {
        // Turned out not to be a transaction.
        d.gmailCandidates = d.gmailCandidates.filter((x) => x.id !== id);
        d.gmail.processedIds.push(c.messageId);
        return null;
      }
      Object.assign(c, {
        parsed: parsed || c.parsed,
        suggestion: parsed ? suggestFor(d, parsed) : c.suggestion,
        confidence: parsed?.confidence || c.confidence,
        status: error ? 'failed' : 'pending',
        error: error ? clip(error, 200) : null,
        sender: sender ? clip(sender, 120) : c.sender,
        subject: subject ? clip(subject, 200) : c.subject,
        excerpt: excerpt ? clip(excerpt, 240) : c.excerpt,
        emailDate: emailDate || c.emailDate,
        updatedAt: nowIso(),
      });
      return c;
    });
  }

  function candidateToInput(c) {
    const p = c.parsed || {};
    const input = { type: p.type, amount: p.amount, date: p.date || c.emailDate, description: p.description, paymentMethod: p.paymentMethod, externalRef: p.reference, categoryId: c.suggestion?.categoryId };
    const ep = c.suggestion?.endpoint;
    if (p.type === 'income' || p.type === 'refund') input.to = ep;
    else input.from = ep;
    return input;
  }

  /**
   * Approve an import, optionally with edited values. Idempotent: approving the
   * same email twice returns the transaction created the first time.
   */
  function approveGmailCandidate(id, edited = null) {
    return mutate((d) => {
      const c = findIn(d, 'gmailCandidates', id);
      if (!c) throw new ValidationError('Import not found');
      const existingTx = d.transactions.find((t) => t.gmailMessageId === c.messageId);
      if (existingTx) {
        Object.assign(c, { status: 'approved', transactionId: existingTx.id, updatedAt: nowIso() });
        return existingTx;
      }
      if (!c.parsed && !edited) throw new ValidationError('Nothing to import from this email. Use Edit to enter the details.');
      const tx = normalizeTx(d, edited || candidateToInput(c));
      const record = addTx(d, tx, { source: 'gmail', gmailMessageId: c.messageId });
      Object.assign(c, { status: 'approved', transactionId: record.id, error: null, updatedAt: nowIso() });
      return record;
    });
  }

  function setGmailCandidateStatus(id, status) {
    return mutate((d) => {
      const c = findIn(d, 'gmailCandidates', id);
      if (!c) throw new ValidationError('Import not found');
      if (c.status === 'approved') throw new ValidationError('This email is already imported. Delete the transaction instead.');
      if (!['rejected', 'reviewed', 'pending'].includes(status)) throw new ValidationError('Unknown status');
      Object.assign(c, { status, updatedAt: nowIso() });
      return c;
    });
  }

  function recordGmailError(message) {
    return mutate((d) => {
      d.gmail.lastSyncAt = nowIso();
      d.gmail.lastError = clip(message, 300);
      return true;
    });
  }

  // ---------- demo data ----------

  function hasDemoData() {
    return Boolean(db) && ['accounts', 'assets', 'liabilities', 'transactions', 'goals'].some((k) => db[k].some((x) => x.sample));
  }

  function loadDemoData() {
    return mutate((d) => {
      if (['accounts', 'assets', 'liabilities', 'transactions', 'goals'].some((k) => d[k].some((x) => x.sample))) {
        throw new ValidationError('Demo data is already loaded');
      }
      const demo = buildDemoData(today());
      const stamp = nowIso();
      for (const a of demo.accounts) d.accounts.push({ ...a, notes: 'Demo record', archived: false, sample: true, createdAt: stamp, updatedAt: stamp });
      for (const l of demo.liabilities) d.liabilities.push({ originalAmount: null, interestRate: '', linkedAccountId: null, notes: 'Demo record', ...l, archived: false, sample: true, createdAt: stamp, updatedAt: stamp });
      for (const a of demo.assets) d.assets.push({ ...blankAsset(), ...a, notes: 'Demo record', sample: true, createdAt: stamp, updatedAt: stamp });
      for (const g of demo.goals) d.goals.push({ notes: 'Demo record', ...g, archived: false, sample: true, createdAt: stamp, updatedAt: stamp });
      for (const t of demo.transactions) {
        const tx = normalizeTx(d, t);
        addTx(d, tx, { source: 'demo', sample: true });
      }
      return true;
    });
  }

  function removeDemoData() {
    return mutate((d) => {
      const gone = (kind) => new Set(d[COLLECTION[kind]].filter((x) => x.sample).map((x) => x.id));
      const removed = { account: gone('account'), asset: gone('asset'), liability: gone('liability') };
      const isGone = (r) => r && removed[r.kind]?.has(r.id);
      d.transactions = d.transactions.filter((t) => !t.sample);
      // Real records that pointed at a demo account keep their amounts but lose the link.
      for (const t of d.transactions) {
        if (isGone(t.from)) t.from = null;
        if (isGone(t.to)) t.to = null;
      }
      for (const t of d.templates) {
        if (isGone(t.from)) t.from = null;
        if (isGone(t.to)) t.to = null;
      }
      d.transactions = d.transactions.filter((t) => !(t.type === 'transfer' && (!t.from || !t.to)) && !(t.type === 'investment' && !t.to));
      for (const k of ['accounts', 'assets', 'liabilities', 'goals']) d[k] = d[k].filter((x) => !x.sample);
      d.snapshots = d.snapshots.filter((s) => !removed[s.kind]?.has(s.refId));
      d.netWorthHistory = d.netWorthHistory.filter((h) => !h.sample);
      return true;
    });
  }

  // ---------- backup ----------

  async function exportBackup() {
    requireUnlocked();
    const vault = await encryptJson(key, salt, db);
    return JSON.stringify({ app: 'spendly', kind: 'encrypted-backup', schema: SCHEMA, exportedAt: nowIso(), vault });
  }

  /** Restore an encrypted backup (needs the password it was made with). Replaces current data. */
  async function importBackup(text, password) {
    requireUnlocked();
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ValidationError('That file is not a Spendly backup'); }
    let raw;
    if (parsed?.app === 'spendly' && parsed.vault) {
      try {
        raw = await decryptJson(await deriveKey(password || '', unb64(parsed.vault.salt)), parsed.vault);
      } catch {
        throw new ValidationError('Wrong password for this backup', 'password');
      }
    } else if (parsed?.app === 'ledger' && parsed.data) {
      raw = parsed.data; // plain backup from the earlier version of this app
    } else {
      throw new ValidationError('That file is not a Spendly backup');
    }
    const restored = migrate(raw, now());
    return mutate((d) => {
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, restored);
      return { transactions: restored.transactions.length };
    });
  }

  return {
    // auth
    status, setup, unlock, lock, changePassword, resetEverything,
    // reading
    get db() { requireUnlocked(); return db; },
    isUnlocked: () => Boolean(db),
    today, totals: () => computeTotals(db), onChange: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    // transactions & templates
    createTransaction, updateTransaction, deleteTransaction, normalizeTx: (input) => normalizeTx(db, input),
    saveTemplate, setTemplatePinned, deleteTemplate, addSuggestedTemplates,
    // categories
    addCategory, renameCategory, setCategoryArchived,
    // accounts / assets / liabilities / goals
    saveAccount, setArchived, deleteEntity, recordSnapshot, deleteSnapshot,
    addAsset, updateAsset, closeAsset, saveLiability, saveGoal, deleteGoal,
    // settings
    updateSettings, recordBackup,
    // gmail
    setGmail, addGmailCandidates, updateGmailCandidate, approveGmailCandidate, setGmailCandidateStatus, recordGmailError, candidateToInput,
    // demo & backup
    hasDemoData, loadDemoData, removeDemoData, exportBackup, importBackup,
  };
}
