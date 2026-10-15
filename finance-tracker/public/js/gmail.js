// Read-only Gmail import, straight from the browser.
//
// Safety: the only permission requested from Google is gmail.readonly, so Google
// itself refuses any attempt to delete, send, archive, label or change mail with
// this token. This file also only ever makes GET requests to the Gmail API.
(function (root) {
  'use strict';

  const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const DEFAULT_QUERY =
    '(debited OR credited OR spent OR withdrawn OR "transaction" OR "payment received" OR "sent to" OR SIP OR "units allotted" OR "order executed") -subject:OTP -category:promotions -category:social';

  let token = null;
  let tokenExpires = 0;
  let gisLoading = null;

  function loadGis() {
    if (root.google?.accounts?.oauth2) return Promise.resolve();
    if (!gisLoading) {
      gisLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = GIS_SRC;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { gisLoading = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
        document.head.appendChild(s);
      });
    }
    return gisLoading;
  }

  // Opens Google's consent popup (or reuses a still-valid token).
  async function getToken(clientId, { prompt = '' } = {}) {
    if (token && Date.now() < tokenExpires - 60_000) return token;
    if (!clientId) throw new Error('Add your Google client ID first');
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = root.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        prompt,
        callback: (res) => {
          if (res.error) return reject(new Error(res.error_description || res.error));
          if (!root.google.accounts.oauth2.hasGrantedAllScopes(res, SCOPE)) {
            return reject(new Error('Read-only Gmail permission was not granted'));
          }
          token = res.access_token;
          tokenExpires = Date.now() + Number(res.expires_in || 3600) * 1000;
          resolve(token);
        },
        error_callback: (err) => reject(new Error(err?.message || err?.type || 'Google sign-in was closed')),
      });
      client.requestAccessToken();
    });
  }

  async function gmailGet(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) { token = null; throw new Error('Google sign-in expired — click Sync again'); }
    if (!res.ok) throw new Error(json.error?.message || `Gmail request failed (${res.status})`);
    return json;
  }

  function decodeBase64Url(data = '') {
    const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
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
    return (plain.trim() ? plain : root.LedgerParser.htmlToText(html)).replace(/\s+/g, ' ').trim();
  }

  const header = (payload, name) =>
    payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

  async function connect(clientId) {
    await getToken(clientId, { prompt: 'consent' });
    const profile = await gmailGet('/profile');
    return profile.emailAddress;
  }

  async function sync({ clientId, days = 30, filter = '', max = 300, backend, onProgress = () => {} }) {
    await getToken(clientId);
    const q = `${DEFAULT_QUERY} newer_than:${days}d ${filter || ''}`.trim();

    const ids = [];
    let pageToken;
    do {
      const page = await gmailGet('/messages', { q, maxResults: 100, ...(pageToken ? { pageToken } : {}) });
      ids.push(...(page.messages || []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);

    const fresh = ids.slice(0, max).filter((id) => !backend.isSeen(id));
    let imported = 0;
    let done = 0;
    const errors = [];
    let i = 0;
    const worker = async () => {
      while (i < fresh.length) {
        const id = fresh[i++];
        try {
          const msg = await gmailGet(`/messages/${id}`, { format: 'full' });
          const tx = root.LedgerParser.parseTransactionEmail({
            subject: header(msg.payload, 'Subject'),
            from: header(msg.payload, 'From'),
            body: extractBody(msg.payload),
            snippet: msg.snippet,
            internalDate: msg.internalDate,
          });
          if (backend.importParsed(id, tx)) imported++;
        } catch (e) {
          errors.push(e.message);
        }
        onProgress(++done, fresh.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(5, fresh.length) }, worker));
    await backend.persist();
    return { matched: ids.length, scanned: fresh.length, imported, errors: errors.slice(0, 5), at: new Date().toISOString() };
  }

  function disconnect() {
    if (token && root.google?.accounts?.oauth2) root.google.accounts.oauth2.revoke(token, () => {});
    token = null;
    tokenExpires = 0;
  }

  root.LedgerGmail = { connect, sync, disconnect, SCOPE };
})(self);
