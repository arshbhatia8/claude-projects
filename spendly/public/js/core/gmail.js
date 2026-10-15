// Read-only Gmail discovery.
//
// Safety:
//  • The only permission requested is gmail.readonly. Google rejects any
//    delete, send, archive, label or modify call made with this token.
//  • This file only ever sends GET requests to the Gmail API.
//  • The access token is kept in memory for this tab only — never written to
//    storage — and Google's browser sign-in issues no refresh token.
//  • Results become *pending* candidates. Nothing reaches your totals until
//    you approve it on the Gmail Imports screen.

import { parseTransactionEmail, htmlToText, excerptAround, dateInZone } from './parser.js';

export const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const DEFAULT_QUERY =
  '(debited OR credited OR spent OR withdrawn OR refund OR "transaction" OR "payment received" OR "sent to" OR SIP OR "units allotted") -subject:OTP -category:promotions -category:social';

let token = null;
let tokenExpires = 0;
let gisLoading = null;

export class GmailError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => {
        gisLoading = null;
        reject(new GmailError('Could not load Google sign-in. Check your internet connection.', 'network'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/** Ask Google for a short-lived read-only token (opens a popup the first time). */
async function getToken(clientId, { prompt = '' } = {}) {
  if (token && Date.now() < tokenExpires - 60_000) return token;
  if (!clientId) throw new GmailError('Add your Google client ID first.', 'config');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      prompt,
      callback: (res) => {
        if (res.error) return reject(new GmailError(res.error_description || res.error, 'auth'));
        if (!globalThis.google.accounts.oauth2.hasGrantedAllScopes(res, SCOPE)) {
          return reject(new GmailError('Read-only Gmail access was not granted.', 'auth'));
        }
        token = res.access_token;
        tokenExpires = Date.now() + Number(res.expires_in || 3600) * 1000;
        resolve(token);
      },
      error_callback: (err) => reject(new GmailError(err?.type === 'popup_closed' ? 'Google sign-in was closed before finishing.' : err?.message || 'Google sign-in failed.', 'auth')),
    });
    client.requestAccessToken();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gmailGet(path, params = {}, attempt = 0) {
  const qs = new URLSearchParams(params).toString();
  let res;
  try {
    res = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new GmailError('Network error while talking to Gmail.', 'network');
  }
  if (res.status === 401) {
    token = null;
    throw new GmailError('Your Google sign-in expired or was revoked. Click Sync again to sign in.', 'auth');
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(800 * 2 ** attempt);
    return gmailGet(path, params, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 403) throw new GmailError(json.error?.message || 'Gmail refused the request. The permission may have been removed.', 'auth');
  if (!res.ok) throw new GmailError(json.error?.message || `Gmail request failed (${res.status}).`, 'api');
  return json;
}

function decodeBase64Url(data = '') {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function extractBody(payload) {
  let plain = '';
  let html = '';
  (function walk(part, depth) {
    if (!part || depth > 8) return;
    try {
      if (part.mimeType === 'text/plain' && part.body?.data) plain += decodeBase64Url(part.body.data) + '\n';
      else if (part.mimeType === 'text/html' && part.body?.data) html += decodeBase64Url(part.body.data) + '\n';
    } catch { /* malformed part: skip it */ }
    (part.parts || []).forEach((p) => walk(p, depth + 1));
  })(payload, 0);
  return (plain.trim() ? plain : htmlToText(html)).replace(/\s+/g, ' ').trim().slice(0, 8000);
}

const header = (payload, name) => payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/** Fetch one message and turn it into a candidate record (or null if it is not a transaction). */
async function readMessage(id, timeZone) {
  const msg = await gmailGet(`/messages/${encodeURIComponent(id)}`, { format: 'full' });
  const subject = header(msg.payload, 'Subject');
  const sender = header(msg.payload, 'From');
  const body = extractBody(msg.payload);
  const parsed = parseTransactionEmail({ subject, from: sender, body, snippet: msg.snippet, internalDate: msg.internalDate }, { timeZone });
  return {
    messageId: id,
    emailDate: dateInZone(msg.internalDate || Date.now(), timeZone),
    sender,
    subject,
    excerpt: excerptAround(body || msg.snippet || ''),
    parsed,
  };
}

export async function connect(clientId) {
  token = null;
  await getToken(clientId, { prompt: 'consent' });
  const profile = await gmailGet('/profile');
  return profile.emailAddress;
}

export function isSignedIn() {
  return Boolean(token && Date.now() < tokenExpires - 60_000);
}

/**
 * Scan recent mail and add new transaction-like emails as pending candidates.
 * `store` is the Spendly store; it de-duplicates by Gmail message id.
 */
export async function sync({ store, days = 30, max = 300, onProgress = () => {} }) {
  const { clientId, filter, processedIds } = store.db.gmail;
  const timeZone = store.db.settings.timezone;
  try {
    await getToken(clientId);
    const q = `${DEFAULT_QUERY} newer_than:${days}d ${filter || ''}`.trim();
    const ids = [];
    let pageToken;
    do {
      const page = await gmailGet('/messages', { q, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      ids.push(...(page.messages || []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);

    const known = new Set([...store.db.gmailCandidates.map((c) => c.messageId), ...processedIds]);
    const fresh = ids.slice(0, max).filter((id) => !known.has(id));
    const found = [];
    const notTransactions = [];
    let failed = 0;
    let done = 0;
    let i = 0;
    const worker = async () => {
      while (i < fresh.length) {
        const id = fresh[i++];
        try {
          const item = await readMessage(id, timeZone);
          if (item.parsed) found.push(item);
          else notTransactions.push(id);
        } catch (e) {
          if (e.code === 'auth') throw e;
          failed++;
          found.push({ messageId: id, emailDate: null, sender: '', subject: '(could not read this email)', excerpt: '', parsed: null, error: e.message });
        }
        onProgress(++done, fresh.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, fresh.length) }, worker));
    found.sort((a, b) => String(a.emailDate).localeCompare(String(b.emailDate)));
    const added = await store.addGmailCandidates(found, { processedIds: notTransactions, scanned: fresh.length, failed });
    return { matched: ids.length, scanned: fresh.length, detected: added, failed };
  } catch (e) {
    await store.recordGmailError(e.message).catch(() => {});
    throw e;
  }
}

/** Re-read emails whose import failed earlier. */
export async function retryFailed({ store, ids }) {
  const { clientId } = store.db.gmail;
  const timeZone = store.db.settings.timezone;
  await getToken(clientId);
  let fixed = 0;
  for (const candidateId of ids) {
    const c = store.db.gmailCandidates.find((x) => x.id === candidateId);
    if (!c) continue;
    try {
      const item = await readMessage(c.messageId, timeZone);
      await store.updateGmailCandidate(c.id, { ...item, error: null });
      fixed++;
    } catch (e) {
      if (e.code === 'auth') throw e;
      await store.updateGmailCandidate(c.id, { parsed: null, error: e.message });
    }
  }
  return fixed;
}

/** Revoke the token at Google and forget it. */
export function disconnect() {
  if (token && globalThis.google?.accounts?.oauth2) globalThis.google.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExpires = 0;
}
