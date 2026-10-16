// Data store: an in-memory copy of every collection, kept live from a storage adapter.
//   ArtifactDbAdapter → the claude.ai artifact database (shared across your devices; the
//                       scheduled job search writes into the same `jobs` collection).
//   LocalAdapter      → this browser only (GitHub Pages copy, tests).
// Writes are optimistic, queued one at a time per document, and reported if they fail.
import { COLLECTIONS } from './schema.js';

export function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export class ArtifactDbAdapter {
  constructor(db) { this.db = db; this.kind = 'cloud'; }
  subscribe(coll, onDocs, onError) {
    return this.db.collection(coll).onSnapshot(
      (snap) => onDocs(snap.docs.filter((d) => d.exists !== false).map((d) => ({ id: d.id, data: d.data() || {} })), snap.metadata || {}),
      (e) => onError && onError(e),
    );
  }
  set(coll, id, data) { return this.db.doc(`${coll}/${id}`).set(data); }
  update(coll, id, data) { return this.db.doc(`${coll}/${id}`).update(data); }
  delete(coll, id) { return this.db.doc(`${coll}/${id}`).delete(); }
}

/** Browser storage (or any {getItem,setItem,removeItem}). Every save is read back to confirm it. */
export class LocalAdapter {
  constructor(storage, prefix = 'jobhunt:v1:') {
    this.s = storage; this.prefix = prefix; this.kind = 'local'; this.subs = new Map();
    if (typeof window !== 'undefined' && storage === globalThis.localStorage) {
      window.addEventListener('storage', (e) => {
        if (!e.key || !e.key.startsWith(prefix)) return;
        const coll = e.key.slice(prefix.length);
        this.emit(coll);
      });
    }
  }
  read(coll) {
    try { return JSON.parse(this.s.getItem(this.prefix + coll) || '{}') || {}; } catch { return {}; }
  }
  write(coll, obj) {
    const text = JSON.stringify(obj);
    try { this.s.setItem(this.prefix + coll, text); } catch (e) {
      const err = new Error(/quota/i.test(String(e && e.name) + String(e && e.message)) ? 'This browser has run out of storage space for JobHunt. Export a backup, then delete old records.' : `The browser refused to save (${e && e.message}).`);
      err.code = 'quota_exceeded'; throw err;
    }
    if (this.s.getItem(this.prefix + coll) !== text) { const err = new Error('The browser did not keep the save. Check that site data is allowed.'); err.code = 'unavailable'; throw err; }
    this.emit(coll);
  }
  emit(coll) {
    const docs = Object.entries(this.read(coll)).map(([id, data]) => ({ id, data }));
    for (const fn of this.subs.get(coll) || []) fn(docs, { fromCache: false });
  }
  subscribe(coll, onDocs) {
    if (!this.subs.has(coll)) this.subs.set(coll, new Set());
    this.subs.get(coll).add(onDocs);
    Promise.resolve().then(() => onDocs(Object.entries(this.read(coll)).map(([id, data]) => ({ id, data })), { fromCache: false }));
    return () => this.subs.get(coll).delete(onDocs);
  }
  async set(coll, id, data) { const o = this.read(coll); o[id] = clone(data); this.write(coll, o); }
  async update(coll, id, data) {
    const o = this.read(coll);
    if (!o[id]) { const e = new Error('Record not found'); e.code = 'invalid_argument'; throw e; }
    o[id] = deepMerge(o[id], clone(data)); this.write(coll, o);
  }
  async delete(coll, id) { const o = this.read(coll); delete o[id]; this.write(coll, o); }
}

export function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _map: m };
}

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = Object.fromEntries(COLLECTIONS.map((c) => [c, new Map()]));
    this.loaded = new Set();
    this.listeners = new Set();
    this.errorListeners = new Set();
    this.queues = new Map();
    this.pending = 0;
    this.unsubs = [];
    this.version = 0;
    this.lastSyncAt = null;
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onError(fn) { this.errorListeners.add(fn); return () => this.errorListeners.delete(fn); }
  emit() { this.version++; for (const fn of this.listeners) fn(this); }
  fail(err, context) { for (const fn of this.errorListeners) fn(err, context); }

  /** Subscribes to every collection; resolves when each has delivered once (or after 12 s). */
  start() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      for (const c of COLLECTIONS) {
        const unsub = this.adapter.subscribe(c, (docs) => {
          const m = new Map();
          for (const d of docs) m.set(d.id, d.data);
          this.state[c] = m;
          this.loaded.add(c);
          this.lastSyncAt = new Date();
          this.emit();
          if (this.loaded.size === COLLECTIONS.length) finish();
        }, (e) => { this.fail(e, { op: 'subscribe', coll: c }); this.loaded.add(c); if (this.loaded.size === COLLECTIONS.length) finish(); });
        this.unsubs.push(unsub);
      }
      setTimeout(finish, 12000);
    });
  }
  stop() { for (const u of this.unsubs) try { u(); } catch { /* ignore */ } this.unsubs = []; }
  get ready() { return this.loaded.size === COLLECTIONS.length; }

  get(coll, id) { return this.state[coll].get(id); }
  all(coll) { return [...this.state[coll]].map(([id, d]) => ({ id, ...d })); }

  /** One write at a time per document. */
  queue(key, fn) {
    const prev = this.queues.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.queues.set(key, next);
    this.pending++;
    return next.finally(() => { this.pending--; if (this.queues.get(key) === next) this.queues.delete(key); });
  }

  async write(op, coll, id, data) {
    const key = coll + '/' + id;
    const before = this.state[coll].get(id);
    // Optimistic local change.
    if (op === 'delete') this.state[coll].delete(id);
    else if (op === 'set') this.state[coll].set(id, clone(data));
    else this.state[coll].set(id, deepMerge(before || {}, clone(data)));
    this.emit();
    try {
      await this.queue(key, () => withRetry(async () => {
        if (op === 'delete') return this.adapter.delete(coll, id);
        if (op === 'set') return this.adapter.set(coll, id, clone(data));
        // update / merge: update if it exists on the server, otherwise create.
        if (before === undefined) return this.adapter.set(coll, id, clone(data));
        return this.adapter.update(coll, id, clone(data));
      }));
    } catch (e) {
      // Put the previous value back, so the screen never shows a save that did not happen.
      if (before === undefined) this.state[coll].delete(id); else this.state[coll].set(id, before);
      this.emit();
      this.fail(e, { op, coll, id });
      throw e;
    }
  }
  set(coll, id, data) { return this.write('set', coll, id, data); }
  update(coll, id, patch) { return this.write(this.state[coll].has(id) ? 'update' : 'merge', coll, id, patch); }
  merge(coll, id, patch) { return this.write('merge', coll, id, patch); }
  delete(coll, id) { return this.write('delete', coll, id); }

  /** Runs import/restore ops in order. Returns {done, failed, errors}. */
  async runOps(ops, onProgress) {
    let done = 0, failed = 0;
    const errors = [];
    for (const o of ops) {
      try {
        if (o.op === 'set') await this.set(o.coll, o.id, o.data);
        else if (o.op === 'delete') await this.delete(o.coll, o.id);
        else await this.merge(o.coll, o.id, o.data);
        done++;
      } catch (e) { failed++; errors.push(`${o.coll}/${o.id}: ${errorText(e)}`); }
      if (onProgress) onProgress(done + failed, ops.length);
    }
    return { done, failed, errors };
  }
}

async function withRetry(fn, tries = 4) {
  let delay = 400;
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const code = e && e.code;
      if (i >= tries - 1 || !(code === 'unavailable' || code === 'resource_exhausted')) throw e;
      await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
      delay *= 2;
    }
  }
}

export function errorText(e) {
  const code = e && e.code;
  if (code === 'quota_exceeded') return e.message || 'Storage is full. Export a backup and delete old records.';
  if (code === 'resource_exhausted') return 'Too many saves at once. Wait a moment and try again.';
  if (code === 'revoked' || code === 'not_granted') return 'This page lost access to your data. Reload the page.';
  if (code === 'invalid_argument') return 'You can view this tracker but not change it, or the record was too large.';
  if (code === 'unavailable') return e.message || 'The connection dropped. Check your network and try again.';
  return (e && e.message) || 'Unknown error';
}
