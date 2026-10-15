const express = require('express');
const { categories, paymentModes } = require('./categories');
const { getSetting, setSetting } = require('./db');

const TYPES = ['credit', 'debit', 'investment'];
const TEXT_FIELDS = ['category', 'description', 'payment_mode', 'account', 'invested_in', 'platform', 'notes'];

// Validate and normalise a transaction body. Returns { value } or { error }.
function clean(body = {}) {
  const type = String(body.type || '').toLowerCase();
  if (!TYPES.includes(type)) return { error: 'Type must be credit, debit or investment' };

  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Amount must be a positive number' };

  const date = String(body.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return { error: 'Date must be YYYY-MM-DD' };
  }

  const value = { type, amount, date };
  for (const f of TEXT_FIELDS) value[f] = String(body[f] ?? '').trim().slice(0, 500);
  if (!value.category) value.category = 'Other';
  return { value };
}

function buildFilter(q) {
  const where = [];
  const params = {};
  if (TYPES.includes(q.type)) { where.push('type = :type'); params.type = q.type; }
  if (/^\d{4}-\d{2}$/.test(q.month || '')) { where.push("substr(date, 1, 7) = :month"); params.month = q.month; }
  if (/^\d{4}$/.test(q.year || '')) { where.push("substr(date, 1, 4) = :year"); params.year = q.year; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) { where.push('date >= :from'); params.from = q.from; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) { where.push('date <= :to'); params.to = q.to; }
  if (q.category) { where.push('category = :category'); params.category = q.category; }
  if (q.source === 'manual' || q.source === 'gmail') { where.push('source = :source'); params.source = q.source; }
  if (q.q) {
    where.push('(description LIKE :q OR category LIKE :q OR notes LIKE :q OR invested_in LIKE :q OR platform LIKE :q OR account LIKE :q)');
    params.q = `%${q.q}%`;
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function router(db) {
  const r = express.Router();

  r.get('/meta', (req, res) => {
    res.json({ categories, paymentModes, currency: getSetting(db, 'currency', 'INR') });
  });

  r.put('/settings', (req, res) => {
    const { currency } = req.body || {};
    if (currency && /^[A-Z]{3}$/.test(currency)) setSetting(db, 'currency', currency);
    res.json({ currency: getSetting(db, 'currency', 'INR') });
  });

  r.get('/transactions', (req, res) => {
    const { sql, params } = buildFilter(req.query);
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const rows = db
      .prepare(`SELECT * FROM transactions ${sql} ORDER BY date DESC, id DESC LIMIT ${limit}`)
      .all(params);
    res.json(rows);
  });

  r.post('/transactions', (req, res) => {
    const { value, error } = clean(req.body);
    if (error) return res.status(400).json({ error });
    const info = db
      .prepare(`INSERT INTO transactions (type, amount, date, ${TEXT_FIELDS.join(', ')})
                VALUES (:type, :amount, :date, ${TEXT_FIELDS.map((f) => ':' + f).join(', ')})`)
      .run(value);
    res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/transactions/:id', (req, res) => {
    const { value, error } = clean(req.body);
    if (error) return res.status(400).json({ error });
    const info = db
      .prepare(`UPDATE transactions SET type = :type, amount = :amount, date = :date,
                ${TEXT_FIELDS.map((f) => `${f} = :${f}`).join(', ')}, updated_at = datetime('now')
                WHERE id = :id`)
      .run({ ...value, id: Number(req.params.id) });
    if (!info.changes) return res.status(404).json({ error: 'Not found' });
    res.json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(Number(req.params.id)));
  });

  // Deletes from this app's database only. Nothing in Gmail is ever touched.
  r.delete('/transactions/:id', (req, res) => {
    const info = db.prepare('DELETE FROM transactions WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  r.get('/summary', (req, res) => {
    const { sql, params } = buildFilter(req.query);
    const totals = { credit: 0, debit: 0, investment: 0 };
    for (const row of db.prepare(`SELECT type, SUM(amount) AS total FROM transactions ${sql} GROUP BY type`).all(params)) {
      totals[row.type] = row.total;
    }
    const byCategory = db
      .prepare(`SELECT type, category, SUM(amount) AS total, COUNT(*) AS count
                FROM transactions ${sql} GROUP BY type, category ORDER BY total DESC`)
      .all(params);
    // Last 12 months trend, independent of the month filter.
    const trend = db
      .prepare(`SELECT substr(date, 1, 7) AS month, type, SUM(amount) AS total
                FROM transactions WHERE date >= date('now', 'start of month', '-11 months')
                GROUP BY month, type ORDER BY month`)
      .all();

    const allTime = { credit: 0, debit: 0, investment: 0 };
    for (const row of db.prepare('SELECT type, SUM(amount) AS total FROM transactions GROUP BY type').all()) {
      allTime[row.type] = row.total;
    }

    res.json({
      totals,
      net: totals.credit - totals.debit - totals.investment,
      savingsRate: totals.credit ? (totals.credit - totals.debit) / totals.credit : null,
      byCategory,
      trend,
      allTime,
    });
  });

  r.get('/export.csv', (req, res) => {
    const { sql, params } = buildFilter(req.query);
    const rows = db.prepare(`SELECT * FROM transactions ${sql} ORDER BY date DESC, id DESC`).all(params);
    const cols = ['date', 'type', 'amount', ...TEXT_FIELDS, 'source'];
    const csv = [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(csv);
  });

  return r;
}

module.exports = { router, clean };
