const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function open(file = path.join(DATA_DIR, 'finance.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS transactions (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT    NOT NULL CHECK (type IN ('credit', 'debit', 'investment')),
      amount        REAL    NOT NULL CHECK (amount > 0),
      date          TEXT    NOT NULL,              -- YYYY-MM-DD
      category      TEXT    NOT NULL DEFAULT 'Other',
      description   TEXT    NOT NULL DEFAULT '',
      payment_mode  TEXT    NOT NULL DEFAULT '',   -- UPI, Card, Cash, ...
      account       TEXT    NOT NULL DEFAULT '',   -- e.g. HDFC xx1234
      invested_in   TEXT    NOT NULL DEFAULT '',   -- where the money went (investments)
      platform      TEXT    NOT NULL DEFAULT '',   -- Zerodha, Groww, bank, ...
      notes         TEXT    NOT NULL DEFAULT '',
      source        TEXT    NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'gmail')),
      gmail_id      TEXT    UNIQUE,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_tx_type ON transactions(type);

    -- Gmail messages we already looked at, so a sync never imports the same mail
    -- twice (and a transaction you deleted in the app does not come back).
    CREATE TABLE IF NOT EXISTS gmail_seen (
      message_id TEXT PRIMARY KEY,
      seen_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  return db;
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

function setSetting(db, key, value) {
  if (value === null || value === undefined) {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
}

module.exports = { open, getSetting, setSetting, DATA_DIR };
