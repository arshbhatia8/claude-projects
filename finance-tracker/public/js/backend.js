// The app's "backend": runs in your browser, so there is no server to host.
//
// - Data lives in this browser's localStorage, encrypted with AES-GCM using a
//   key derived from your password (PBKDF2-SHA256). Nobody can read it without
//   the password — not even someone who opens the same website on another device,
//   since each browser has its own separate storage.
// - The rest of the app talks to it through request(path, { method, body }),
//   the same shape as an HTTP API, so it can be swapped for a real server later.
(function (root) {
  'use strict';

  const { categories, paymentModes } =
    typeof module === 'object' && module.exports ? require('./categories') : root.LedgerCategories;

  const VAULT_KEY = 'ledger.vault.v1';
  const SESSION_KEY = 'ledger.session.v1';
  const PBKDF2_ROUNDS = 310000;
  const TYPES = ['credit', 'debit', 'investment'];
  const TEXT_FIELDS = ['category', 'description', 'payment_mode', 'account', 'invested_in', 'platform', 'notes'];

  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function createBackend({ storage = root.localStorage, session = root.sessionStorage, now = () => new Date() } = {}) {
    let key = null; // CryptoKey while unlocked
    let salt = null;
    let db = null;

    // ---------- crypto helpers ----------
    const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

    async function deriveKey(password, saltBytes) {
      const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
      return subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
        base,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    }

    async function encryptDb() {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(db)));
      return { v: 1, salt: b64(salt), iv: b64(iv), data: b64(data) };
    }

    async function decryptVault(vault, k) {
      const plain = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(vault.iv) }, k, unb64(vault.data));
      return JSON.parse(dec.decode(plain));
    }

    let saving = Promise.resolve();
    function persist() {
      // Serialise writes so an older snapshot never overwrites a newer one.
      saving = saving.then(async () => storage.setItem(VAULT_KEY, JSON.stringify(await encryptDb())));
      return saving;
    }

    async function rememberSession() {
      try {
        session.setItem(SESSION_KEY, b64(await subtle.exportKey('raw', key)));
      } catch { /* private mode etc. — just ask for the password again next time */ }
    }

    function emptyDb() {
      return { transactions: [], nextId: 1, gmailSeen: [], settings: { currency: 'INR' } };
    }

    // ---------- auth ----------
    function readVault() {
      try { return JSON.parse(storage.getItem(VAULT_KEY)); } catch { return null; }
    }

    async function status() {
      const vault = readVault();
      if (!vault) return { setUp: false, signedIn: false };
      if (db) return { setUp: true, signedIn: true };
      // Same tab, page refreshed: reuse the key kept for this tab only.
      const raw = session && session.getItem(SESSION_KEY);
      if (raw) {
        try {
          const k = await subtle.importKey('raw', unb64(raw), 'AES-GCM', true, ['encrypt', 'decrypt']);
          db = await decryptVault(vault, k);
          key = k;
          salt = unb64(vault.salt);
          return { setUp: true, signedIn: true };
        } catch { session.removeItem(SESSION_KEY); }
      }
      return { setUp: true, signedIn: false };
    }

    async function setup(password) {
      if (readVault()) throw new Error('Password already set');
      if (!password || password.length < 6) throw new Error('Use at least 6 characters');
      salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(password, salt);
      db = emptyDb();
      await persist();
      await rememberSession();
    }

    async function unlock(password) {
      const vault = readVault();
      if (!vault) throw new Error('Nothing to unlock');
      const s = unb64(vault.salt);
      const k = await deriveKey(password || '', s);
      try {
        db = await decryptVault(vault, k);
      } catch {
        throw new Error('Wrong password');
      }
      key = k;
      salt = s;
      await rememberSession();
    }

    function lock() {
      key = null;
      db = null;
      session && session.removeItem(SESSION_KEY);
    }

    async function changePassword(current, next) {
      const vault = readVault();
      try {
        await decryptVault(vault, await deriveKey(current || '', unb64(vault.salt)));
      } catch {
        throw new Error('Current password is wrong');
      }
      if (!next || next.length < 6) throw new Error('Use at least 6 characters');
      salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(next, salt);
      await persist();
      await rememberSession();
    }

    // Forgot password: the only way out is to start fresh.
    function resetEverything() {
      storage.removeItem(VAULT_KEY);
      lock();
    }

    function requireUnlocked() {
      if (!db) {
        const err = new Error('Locked');
        err.status = 401;
        throw err;
      }
    }

    // ---------- transactions ----------
    function clean(body = {}) {
      const type = String(body.type || '').toLowerCase();
      if (!TYPES.includes(type)) throw new Error('Type must be credit, debit or investment');
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be a positive number');
      const date = String(body.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error('Date must be YYYY-MM-DD');
      const value = { type, amount, date };
      for (const f of TEXT_FIELDS) value[f] = String(body[f] ?? '').trim().slice(0, 500);
      if (!value.category) value.category = 'Other';
      return value;
    }

    function matches(t, q) {
      if (TYPES.includes(q.type) && t.type !== q.type) return false;
      if (q.month && t.date.slice(0, 7) !== q.month) return false;
      if (q.year && t.date.slice(0, 4) !== q.year) return false;
      if (q.from && t.date < q.from) return false;
      if (q.to && t.date > q.to) return false;
      if (q.category && t.category !== q.category) return false;
      if ((q.source === 'manual' || q.source === 'gmail') && t.source !== q.source) return false;
      if (q.q) {
        const needle = q.q.toLowerCase();
        const hay = [t.description, t.category, t.notes, t.invested_in, t.platform, t.account].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }

    function sorted(list) {
      return [...list].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
    }

    function addTransaction(value, extra = {}) {
      const stamp = now().toISOString();
      const tx = { id: db.nextId++, ...value, source: 'manual', gmail_id: null, created_at: stamp, updated_at: stamp, ...extra };
      db.transactions.push(tx);
      return tx;
    }

    function monthKey(d) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    function summary(q) {
      const list = db.transactions.filter((t) => matches(t, q));
      const totals = { credit: 0, debit: 0, investment: 0 };
      const cats = new Map();
      for (const t of list) {
        totals[t.type] += t.amount;
        const k = `${t.type}|${t.category}`;
        const c = cats.get(k) || { type: t.type, category: t.category, total: 0, count: 0 };
        c.total += t.amount;
        c.count++;
        cats.set(k, c);
      }
      const n = now();
      const firstMonth = monthKey(new Date(n.getFullYear(), n.getMonth() - 11, 1));
      const trendMap = new Map();
      const allTime = { credit: 0, debit: 0, investment: 0 };
      for (const t of db.transactions) {
        allTime[t.type] += t.amount;
        const m = t.date.slice(0, 7);
        if (m >= firstMonth) {
          const k = `${m}|${t.type}`;
          trendMap.set(k, (trendMap.get(k) || 0) + t.amount);
        }
      }
      const trend = [...trendMap].map(([k, total]) => {
        const [month, type] = k.split('|');
        return { month, type, total };
      });
      return {
        totals,
        net: totals.credit - totals.debit - totals.investment,
        savingsRate: totals.credit ? (totals.credit - totals.debit) / totals.credit : null,
        byCategory: [...cats.values()].sort((a, b) => b.total - a.total),
        trend,
        allTime,
      };
    }

    function csv(q) {
      const cell = (v) => {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const cols = ['date', 'type', 'amount', ...TEXT_FIELDS, 'source'];
      const rows = sorted(db.transactions.filter((t) => matches(t, q)));
      return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
    }

    // ---------- backup ----------
    function exportBackup() {
      return JSON.stringify({ app: 'ledger', version: 1, exportedAt: now().toISOString(), data: db }, null, 2);
    }

    async function importBackup(text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error('That file is not a Ledger backup'); }
      const data = parsed && parsed.app === 'ledger' ? parsed.data : null;
      if (!data || !Array.isArray(data.transactions)) throw new Error('That file is not a Ledger backup');
      const restored = emptyDb();
      for (const raw of data.transactions) {
        try {
          const value = clean(raw);
          restored.transactions.push({
            id: restored.nextId++,
            ...value,
            source: raw.source === 'gmail' ? 'gmail' : 'manual',
            gmail_id: raw.gmail_id || null,
            created_at: raw.created_at || now().toISOString(),
            updated_at: raw.updated_at || now().toISOString(),
          });
        } catch { /* skip broken rows */ }
      }
      restored.gmailSeen = Array.isArray(data.gmailSeen) ? data.gmailSeen.map(String) : [];
      restored.settings = { ...restored.settings, ...(data.settings || {}) };
      db = restored;
      await persist();
      return { imported: restored.transactions.length };
    }

    // ---------- router ----------
    async function request(path, { method = 'GET', body } = {}) {
      requireUnlocked();
      const [pathname, qs = ''] = path.split('?');
      const q = Object.fromEntries(new URLSearchParams(qs));
      const idMatch = /^\/transactions\/(\d+)$/.exec(pathname);

      if (pathname === '/meta' && method === 'GET') {
        return { categories, paymentModes, currency: db.settings.currency || 'INR' };
      }
      if (pathname === '/settings' && method === 'GET') return { ...db.settings };
      if (pathname === '/settings' && method === 'PUT') {
        const b = body || {};
        if (b.currency && /^[A-Z]{3}$/.test(b.currency)) db.settings.currency = b.currency;
        for (const k of ['googleClientId', 'gmailFilter', 'gmailEmail', 'gmailLastSync']) {
          if (k in b) db.settings[k] = b[k];
        }
        await persist();
        return { ...db.settings };
      }
      if (pathname === '/transactions' && method === 'GET') {
        const limit = Math.min(Number(q.limit) || 500, 5000);
        return sorted(db.transactions.filter((t) => matches(t, q))).slice(0, limit);
      }
      if (pathname === '/transactions' && method === 'POST') {
        const tx = addTransaction(clean(body));
        await persist();
        return tx;
      }
      if (idMatch && method === 'PUT') {
        const tx = db.transactions.find((t) => t.id === Number(idMatch[1]));
        if (!tx) throw new Error('Not found');
        Object.assign(tx, clean(body), { updated_at: now().toISOString() });
        await persist();
        return tx;
      }
      // Removes it from this app only. Your emails are never touched.
      if (idMatch && method === 'DELETE') {
        const before = db.transactions.length;
        db.transactions = db.transactions.filter((t) => t.id !== Number(idMatch[1]));
        if (db.transactions.length === before) throw new Error('Not found');
        await persist();
        return { ok: true };
      }
      if (pathname === '/summary' && method === 'GET') return summary(q);
      if (pathname === '/export.csv' && method === 'GET') return csv(q);
      throw new Error(`No route for ${method} ${pathname}`);
    }

    // ---------- Gmail import bookkeeping ----------
    function isSeen(id) {
      requireUnlocked();
      return db.gmailSeen.includes(id);
    }

    function importParsed(id, tx) {
      requireUnlocked();
      if (!db.gmailSeen.includes(id)) db.gmailSeen.push(id);
      if (!tx || db.transactions.some((t) => t.gmail_id === id)) return false;
      addTransaction(clean(tx), { source: 'gmail', gmail_id: id });
      return true;
    }

    return {
      status, setup, unlock, lock, changePassword, resetEverything,
      request, exportBackup, importBackup, isSeen, importParsed, persist,
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { createBackend };
  else root.LedgerBackend = createBackend();
})(typeof self !== 'undefined' ? self : this);
