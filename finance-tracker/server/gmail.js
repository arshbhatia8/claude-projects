// Read-only Gmail import.
//
// Safety: the only OAuth scope requested is gmail.readonly, so Google itself
// refuses any attempt to delete, modify, label, send or archive mail with this
// token. On top of that, this file only ever issues GET requests to the Gmail API.
const crypto = require('node:crypto');
const express = require('express');
const { getSetting, setSetting } = require('./db');
const { parseTransactionEmail, htmlToText } = require('./parser');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const DEFAULT_QUERY =
  '(debited OR credited OR spent OR withdrawn OR "transaction" OR "payment received" OR "sent to" OR SIP OR "units allotted" OR "order executed") -subject:OTP -category:promotions -category:social';

function config(db) {
  const port = process.env.PORT || 4000;
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || getSetting(db, 'google_client_id', ''),
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || getSetting(db, 'google_client_secret', ''),
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || getSetting(db, 'google_redirect_uri', '') || `http://localhost:${port}/api/gmail/callback`,
  };
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || 'Token request failed');
  return json;
}

async function accessToken(db) {
  const tokens = getSetting(db, 'gmail_tokens');
  if (!tokens) throw new Error('Gmail is not connected');
  if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const { clientId, clientSecret } = config(db);
  const fresh = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    grant_type: 'refresh_token',
  });
  const updated = { ...tokens, access_token: fresh.access_token, expires_at: Date.now() + fresh.expires_in * 1000 };
  setSetting(db, 'gmail_tokens', updated);
  return updated.access_token;
}

// GET only — read access.
async function gmailGet(db, path, params = {}) {
  const token = await accessToken(db);
  const url = `${API}${path}${Object.keys(params).length ? '?' + new URLSearchParams(params) : ''}`;
  const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gmail request failed (${res.status})`);
  return json;
}

function decodeBase64Url(data = '') {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(payload) {
  let plain = '';
  let html = '';
  (function walk(part) {
    if (!part) return;
    if (part.mimeType === 'text/plain' && part.body?.data) plain += decodeBase64Url(part.body.data) + '\n';
    else if (part.mimeType === 'text/html' && part.body?.data) html += decodeBase64Url(part.body.data) + '\n';
    (part.parts || []).forEach(walk);
  })(payload);
  return (plain.trim() ? plain : htmlToText(html)).replace(/\s+/g, ' ').trim();
}

function header(payload, name) {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sync(db, { days = 30, max = 300 } = {}) {
  const extra = getSetting(db, 'gmail_filter', '');
  const q = `${getSetting(db, 'gmail_query', DEFAULT_QUERY)} newer_than:${days}d ${extra}`.trim();

  const ids = [];
  let pageToken;
  do {
    const page = await gmailGet(db, '/messages', { q, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
    ids.push(...(page.messages || []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);

  const seen = db.prepare('SELECT 1 FROM gmail_seen WHERE message_id = ?');
  const fresh = ids.slice(0, max).filter((id) => !seen.get(id));

  const insert = db.prepare(`INSERT OR IGNORE INTO transactions
    (type, amount, date, category, description, payment_mode, account, invested_in, platform, notes, source, gmail_id)
    VALUES (:type, :amount, :date, :category, :description, :payment_mode, :account, :invested_in, :platform, :notes, 'gmail', :gmail_id)`);
  const markSeen = db.prepare('INSERT OR IGNORE INTO gmail_seen (message_id) VALUES (?)');

  let imported = 0;
  const errors = [];
  await mapLimit(fresh, 5, async (id) => {
    try {
      const msg = await gmailGet(db, `/messages/${id}`, { format: 'full' });
      const tx = parseTransactionEmail({
        subject: header(msg.payload, 'Subject'),
        from: header(msg.payload, 'From'),
        body: extractBody(msg.payload),
        snippet: msg.snippet,
        internalDate: msg.internalDate,
      });
      if (tx && insert.run({ ...tx, gmail_id: id }).changes) imported++;
      markSeen.run(id);
    } catch (e) {
      errors.push(e.message);
    }
  });

  const result = { query: q, matched: ids.length, scanned: fresh.length, imported, errors: errors.slice(0, 5), at: new Date().toISOString() };
  setSetting(db, 'gmail_last_sync', result);
  return result;
}

function router(db) {
  const r = express.Router();
  const pendingStates = new Map();

  r.get('/status', (req, res) => {
    const { clientId, redirectUri } = config(db);
    const tokens = getSetting(db, 'gmail_tokens');
    res.json({
      configured: Boolean(clientId && config(db).clientSecret),
      clientIdFromEnv: Boolean(process.env.GOOGLE_CLIENT_ID),
      redirectUri,
      connected: Boolean(tokens),
      email: tokens?.email || null,
      scope: SCOPE,
      lastSync: getSetting(db, 'gmail_last_sync'),
      filter: getSetting(db, 'gmail_filter', ''),
      autoSync: getSetting(db, 'gmail_auto_sync', false),
    });
  });

  // Save Google OAuth client credentials from the Settings page.
  r.put('/config', (req, res) => {
    const { clientId, clientSecret, redirectUri, filter, autoSync } = req.body || {};
    if (clientId !== undefined) setSetting(db, 'google_client_id', String(clientId).trim() || null);
    if (clientSecret !== undefined && clientSecret !== '') setSetting(db, 'google_client_secret', String(clientSecret).trim());
    if (redirectUri !== undefined) setSetting(db, 'google_redirect_uri', String(redirectUri).trim() || null);
    if (filter !== undefined) setSetting(db, 'gmail_filter', String(filter).trim());
    if (autoSync !== undefined) setSetting(db, 'gmail_auto_sync', Boolean(autoSync));
    res.json({ ok: true });
  });

  r.get('/connect', (req, res) => {
    const { clientId, clientSecret, redirectUri } = config(db);
    if (!clientId || !clientSecret) return res.status(400).send('Add your Google OAuth client ID and secret in Settings first.');
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.set(state, Date.now());
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    })}`;
    res.redirect(url);
  });

  r.get('/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`/#settings?gmail=${encodeURIComponent(error)}`);
    if (!state || !pendingStates.delete(state)) return res.status(400).send('Invalid or expired sign-in attempt. Try again from Settings.');
    try {
      const { clientId, clientSecret, redirectUri } = config(db);
      const t = await tokenRequest({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
      if (!String(t.scope || '').split(' ').includes(SCOPE)) throw new Error('Read-only Gmail permission was not granted');
      setSetting(db, 'gmail_tokens', {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Date.now() + t.expires_in * 1000,
      });
      const profile = await gmailGet(db, '/profile');
      setSetting(db, 'gmail_tokens', { ...getSetting(db, 'gmail_tokens'), email: profile.emailAddress });
      res.redirect('/#settings?gmail=connected');
    } catch (e) {
      res.redirect(`/#settings?gmail=${encodeURIComponent(e.message)}`);
    }
  });

  r.post('/sync', async (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.body?.days) || 30, 1), 365);
      res.json(await sync(db, { days }));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // Disconnect: revokes this app's access token at Google and forgets it locally.
  r.post('/disconnect', async (req, res) => {
    const tokens = getSetting(db, 'gmail_tokens');
    if (tokens) {
      await fetch(`${REVOKE_URL}?token=${encodeURIComponent(tokens.refresh_token || tokens.access_token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }).catch(() => {});
    }
    setSetting(db, 'gmail_tokens', null);
    res.json({ ok: true });
  });

  return r;
}

module.exports = { router, sync, DEFAULT_QUERY };
