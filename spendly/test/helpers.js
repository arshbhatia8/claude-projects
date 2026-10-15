import { createStore } from '../public/js/core/store.js';

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    map: m,
  };
}

// Fixed clock: 15 Oct 2026, 10:00 IST
export const NOW = new Date('2026-10-15T04:30:00Z');

export async function freshStore({ storage = memoryStorage(), now = () => NOW } = {}) {
  const store = createStore({ storage, session: memoryStorage(), now });
  await store.setup('correct horse');
  return { store, storage };
}

export const cat = (store, kind, name) => store.db.categories.find((c) => c.kind === kind && c.name === name).id;
export const acc = (id) => ({ kind: 'account', id });
export const card = (id) => ({ kind: 'liability', id });
export const asset = (id) => ({ kind: 'asset', id });
