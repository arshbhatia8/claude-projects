// Gmail Imports and Settings.
import { app, actions, esc, icon, money, fmtDate, emptyState, toast, ask, sheet, $, $$, refName, categoryName, readForm, submitting, download, IS_IOS } from './dom.js';
import { possibleDuplicate } from '../core/duplicates.js';
import { DATE_FORMATS, TX_TYPES } from '../core/defaults.js';
import { DRAFT_RETENTION_DAYS } from '../core/store.js';
import * as gmail from '../core/gmail.js';
import { openTxForm, openCategoryManager } from './forms.js';
import { transactionsToCsv, assetsToCsv } from './views-main.js';

const S = () => app.store;
export const EMBEDDED = (() => { try { return window.self !== window.top; } catch { return true; } })();

// ---------------------------------------------------------------------------
// Gmail Imports
// ---------------------------------------------------------------------------

const CONF = { high: ['ok', 'High confidence'], medium: ['info', 'Medium confidence'], low: ['warn', 'Low confidence'] };
const DIR = { expense: ['bad', 'Debit'], income: ['ok', 'Credit'], refund: ['ok', 'Refund'], investment: ['info', 'Investment'] };

function candidateCard(c, db) {
  const p = c.parsed;
  const dup = c.status === 'pending' ? possibleDuplicate(db, c) : null;
  const [dirCls, dirLabel] = p ? DIR[p.type] || ['', p.type] : ['bad', 'Unreadable'];
  const [confCls, confLabel] = CONF[c.confidence] || CONF.low;
  const acct = c.suggestion?.endpoint ? refName(c.suggestion.endpoint) : p?.accountHint ? `${p.accountHint} (no matching account — set last digits on the account)` : '';
  const actionsHtml = {
    pending: `<button class="btn btn-primary btn-sm" data-act="gm-approve" data-id="${esc(c.id)}">${icon('check')}Approve & import</button>
      <button class="btn btn-ghost btn-sm" data-act="gm-edit" data-id="${esc(c.id)}">${icon('edit')}Edit first</button>
      <button class="btn btn-ghost btn-sm" data-act="gm-status" data-status="reviewed" data-id="${esc(c.id)}">Mark reviewed</button>
      <button class="btn btn-danger btn-sm" data-act="gm-status" data-status="rejected" data-id="${esc(c.id)}">Reject</button>`,
    failed: `<button class="btn btn-primary btn-sm" data-act="gm-retry" data-id="${esc(c.id)}">${icon('refresh')}Retry</button>
      <button class="btn btn-ghost btn-sm" data-act="gm-edit" data-id="${esc(c.id)}">Enter manually</button>
      <button class="btn btn-danger btn-sm" data-act="gm-status" data-status="rejected" data-id="${esc(c.id)}">Reject</button>`,
    approved: c.transactionId ? `<button class="btn btn-ghost btn-sm" data-act="tx-open" data-id="${esc(c.transactionId)}">View transaction</button>` : '',
    rejected: `<button class="btn btn-ghost btn-sm" data-act="gm-status" data-status="pending" data-id="${esc(c.id)}">Move back to pending</button>`,
    reviewed: `<button class="btn btn-ghost btn-sm" data-act="gm-status" data-status="pending" data-id="${esc(c.id)}">Move back to pending</button>`,
  }[c.status];
  return `<article class="item candidate">
    <div class="row"><span class="badge ${dirCls}">${esc(dirLabel)}</span>${p ? `<span class="badge ${confCls}">${esc(confLabel)}</span>` : ''}<span class="spacer"></span><span class="tiny muted">${esc(fmtDate(c.emailDate))}</span></div>
    <div><div class="subject">${esc(c.subject || '(no subject)')}</div><div class="tiny muted">${esc(c.sender)}</div></div>
    ${p ? `<div class="row"><div class="item-value">${money(p.amount)}</div><span class="spacer"></span><span class="small">${esc(p.description)}</span></div>
      <div class="kv">
        <div><span>Suggested category</span><b>${esc(categoryName(c.suggestion?.categoryId) || (p.type === 'investment' ? 'Pick an asset' : '—'))}</b></div>
        <div><span>Account</span><b>${esc(acct || 'Not identified')}</b></div>
        ${p.paymentMethod ? `<div><span>Method</span><b>${esc(p.paymentMethod)}</b></div>` : ''}
        ${p.reference ? `<div><span>Reference</span><b>${esc(p.reference)}</b></div>` : ''}
      </div>` : `<p class="small neg">${esc(c.error || 'Could not read this email.')}</p>`}
    ${dup ? `<div class="notice warn">${icon('alert')}<div>Possible duplicate: ${esc(dup.reason)}.</div></div>` : ''}
    ${c.note ? `<p class="tiny muted">${esc(c.note)}</p>` : ''}
    ${c.excerpt ? `<div class="excerpt">${esc(c.excerpt)}</div>` : ''}
    <div class="item-actions">${actionsHtml}</div>
  </article>`;
}

export const gmailView = {
  title: 'Gmail Imports',
  render() {
    const db = S().db;
    const g = db.gmail;
    const all = db.gmailCandidates;
    const count = (st) => all.filter((c) => st.includes(c.status)).length;
    const tabs = { pending: ['pending'], approved: ['approved'], closed: ['rejected', 'reviewed'], failed: ['failed'] };
    const tab = app.state.gmailTab;
    const shown = all.filter((c) => tabs[tab].includes(c.status)).sort((a, b) => String(b.emailDate).localeCompare(String(a.emailDate)));
    const connected = Boolean(g.email);
    const last = g.lastResult;
    const origin = location.origin;
    const setupSteps = `
      <details class="card-flat" ${g.clientId ? '' : 'open'}>
        <summary class="small"><b>One-time setup: get a free Google client ID (about 5 minutes)</b></summary>
        <ol class="small muted" style="padding-left:18px;display:grid;gap:6px;margin:12px 0 0">
          <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">Google Cloud Console</a> and create a project (free, no billing).</li>
          <li>Enable the <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">Gmail API</a>.</li>
          <li>Google Auth Platform → <b>Audience</b>: choose <b>External</b>, and add your own Gmail under <b>Test users</b>.</li>
          <li>Google Auth Platform → <b>Data access</b>: add the scope <code>.../auth/gmail.readonly</code> only.</li>
          <li><b>Clients → Create client → Web application</b>. Under <b>Authorized JavaScript origins</b> add <code>${esc(origin)}</code>. No redirect URI or client secret is needed.</li>
          <li>Paste the Client ID (ends in <code>.apps.googleusercontent.com</code>) below and press Connect.</li>
        </ol>
      </details>`;
    return `
      <div class="page-head">
        <div><h1>Gmail Imports</h1><p class="muted">Finds bank, UPI and card alerts. You approve each one before it counts.</p></div>
        <div class="page-actions">${connected ? `<select id="sync-days" aria-label="Look back" style="width:auto">${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['180', '6 months'], ['365', '1 year']].map(([v, l]) => `<option value="${v}" ${v === app.state.syncDays ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn btn-primary" data-act="gm-sync" id="gm-sync">${icon('refresh')}Sync now</button>` : ''}</div>
      </div>
      ${EMBEDDED ? `<div class="notice warn" style="margin-bottom:14px">${icon('alert')}<div>This is an embedded preview. Google sign-in only works when Spendly is opened on its own page (e.g. the GitHub Pages link).</div></div>` : ''}
      ${window.navigator.standalone === true ? `<div class="notice warn" style="margin-bottom:14px">${icon('alert')}<div>You opened Spendly from the Home Screen. Google's sign-in window can fail inside Home Screen apps on iPhone; if Connect or Sync does not finish, that is the reason. Gmail imports are optional — Smart Entry and Quick Add work everywhere.</div></div>` : ''}
      <article class="card section">
        <div class="section-head"><h2>Connection</h2><span class="badge ${connected ? 'ok' : ''}">${connected ? `${icon('check')}Connected · ${esc(g.email)}` : 'Not connected'}</span></div>
        <div class="notice">${icon('lock')}<div><b>Read-only access.</b> Spendly asks Google only for <code>gmail.readonly</code>, so it cannot delete, send, archive, label or change any email. It never sees your Gmail password. The access token lives in memory for this tab only and is never saved. Only a short excerpt and the sender, subject and date of matching alerts are kept, encrypted with your data.</div></div>
        ${connected ? `
          <form class="row" id="gm-filter-form">
            <label class="field" style="flex:1;min-width:240px"><span>Only these senders (optional Gmail search filter)</span><input name="filter" value="${esc(g.filter)}" placeholder="from:(alerts@hdfcbank.net OR credit_cards@icicibank.com)" /></label>
            <button class="btn btn-ghost" type="submit" style="align-self:end">Save filter</button>
            <button class="btn btn-danger" type="button" data-act="gm-disconnect" style="align-self:end">Disconnect</button>
          </form>` : `
          ${setupSteps}
          <form class="row" id="gm-connect-form" novalidate>
            <label class="field" style="flex:1;min-width:240px"><span>Google OAuth Client ID</span><input name="clientId" value="${esc(g.clientId)}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off" /></label>
            <button class="btn btn-primary" type="submit" style="align-self:end">${icon('mail')}Connect Gmail</button>
          </form>
          <p class="form-error" id="gm-connect-error"></p>`}
      </article>
      <div class="stats section">
        <article class="stat"><span class="stat-label">Last successful sync</span><span class="stat-value" style="font-size:16px">${g.lastSuccessAt ? esc(new Date(g.lastSuccessAt).toLocaleString()) : 'Never'}</span></article>
        <article class="stat"><span class="stat-label">Emails scanned (last sync)</span><span class="stat-value">${last ? last.scanned : '—'}</span></article>
        <article class="stat"><span class="stat-label">Transactions detected</span><span class="stat-value">${last ? last.detected : '—'}</span></article>
        <article class="stat"><span class="stat-label">Pending approval</span><span class="stat-value">${count(['pending'])}</span></article>
        <article class="stat"><span class="stat-label">Failed</span><span class="stat-value ${count(['failed']) ? 'neg' : ''}">${count(['failed'])}</span></article>
      </div>
      ${g.lastError ? `<div class="notice warn section">${icon('alert')}<div><b>Last sync problem:</b> ${esc(g.lastError)}${g.lastSyncAt ? ` (${esc(new Date(g.lastSyncAt).toLocaleString())})` : ''}. Your existing records were not changed.</div></div>` : ''}
      <div class="tabs section" role="tablist">
        ${[['pending', 'Pending'], ['approved', 'Imported'], ['closed', 'Reviewed & rejected'], ['failed', 'Failed']].map(([k, l]) => `<button class="chip" role="tab" data-act="gm-tab" data-tab="${k}" aria-pressed="${tab === k}">${l} <span class="badge ${k === 'pending' && count(tabs[k]) ? 'count' : ''}">${count(tabs[k])}</span></button>`).join('')}
      </div>
      ${shown.length ? `<div class="items">${shown.map((c) => candidateCard(c, db)).join('')}</div>` : `<div class="card">${emptyState('mail', tab === 'pending' ? 'Nothing waiting for review' : 'Nothing here', connected ? 'Press Sync now to look for new transaction emails.' : 'Connect Gmail to start finding transaction alerts.')}</div>`}`;
  },
  after(root) {
    if (!EMBEDDED) gmail.preload();
    $('#sync-days', root)?.addEventListener('change', (e) => { app.state.syncDays = e.target.value; });
    $('#gm-filter-form', root)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await S().setGmail({ filter: e.target.elements.filter.value }); toast('Filter saved'); } catch (err) { toast(err.message, { bad: true }); }
    });
    $('#gm-connect-form', root)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errEl = $('#gm-connect-error', root);
      errEl.textContent = '';
      const btn = e.target.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        const clientId = e.target.elements.clientId.value.trim();
        if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('A Google client ID ends in .apps.googleusercontent.com');
        const pending = gmail.connect(clientId); // opens Google's popup straight from this tap
        await S().setGmail({ clientId });
        const email = await pending;
        await S().setGmail({ email, lastError: null });
        toast(`Gmail connected (read-only): ${email}`);
        app.render();
      } catch (err) {
        errEl.textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });
  },
};

actions['gm-tab'] = (el) => { app.state.gmailTab = el.dataset.tab; app.render(); };
actions['gm-sync'] = async (el) => {
  el.disabled = true;
  const label = el.innerHTML;
  el.textContent = 'Signing in…';
  try {
    const r = await gmail.sync({ store: S(), days: Number(app.state.syncDays), onProgress: (d, n) => { el.textContent = `Reading ${d}/${n}…`; } });
    toast(`Scanned ${r.scanned} new email${r.scanned === 1 ? '' : 's'} · ${r.detected} to review${r.failed ? ` · ${r.failed} failed` : ''}`);
    app.state.gmailTab = 'pending';
  } catch (e) {
    toast(e.message, { bad: true });
  } finally {
    el.disabled = false;
    el.innerHTML = label;
    app.render();
  }
};
actions['gm-retry'] = async (el) => {
  el.disabled = true;
  try {
    const n = await gmail.retryFailed({ store: S(), ids: [el.dataset.id] });
    toast(n ? 'Email read successfully — review it in Pending' : 'Still could not read it');
  } catch (e) {
    toast(e.message, { bad: true });
  }
  app.render();
};
actions['gm-disconnect'] = async () => {
  if (!(await ask({ title: 'Disconnect Gmail?', message: 'Spendly will stop reading your mail and revoke its access token. Imported transactions and the review history stay.', confirmText: 'Disconnect', danger: true }))) return;
  gmail.disconnect();
  await S().setGmail({ email: null });
  toast('Gmail disconnected');
  app.render();
};
actions['gm-status'] = async (el) => {
  try {
    await S().setGmailCandidateStatus(el.dataset.id, el.dataset.status);
    toast({ rejected: 'Rejected', reviewed: 'Marked as reviewed', pending: 'Moved back to pending' }[el.dataset.status]);
    app.render();
  } catch (e) {
    toast(e.message, { bad: true });
  }
};
function editCandidate(c, err) {
  const store = S();
  const input = c.parsed ? store.candidateToInput(c) : { type: 'expense', date: c.emailDate || store.today() };
  openTxForm({ mode: 'gmail', candidate: c, values: input });
  if (err) toast(err, { bad: true });
}
actions['gm-edit'] = (el) => editCandidate(S().db.gmailCandidates.find((c) => c.id === el.dataset.id));
actions['gm-approve'] = async (el) => {
  const c = S().db.gmailCandidates.find((x) => x.id === el.dataset.id);
  el.disabled = true;
  try {
    await S().approveGmailCandidate(c.id);
    toast('Imported — it now counts in your totals');
    app.render();
  } catch (e) {
    el.disabled = false;
    editCandidate(c, `${e.message}. Fix it below, then approve.`);
  }
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

export const settings = {
  title: 'Settings',
  render() {
    const store = S();
    const s = store.db.settings;
    const tzs = TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES];
    return `
      <div class="page-head"><div><h1>Settings</h1><p class="muted">Single-user, encrypted, stays on this device.</p></div></div>
      <div class="grid grid-2">
        <article class="card form span-2" id="data-card">
          <h2>Storage & data safety</h2>
          <p class="small"><b>Spendly never deletes your records on its own</b> — not after 7 days, 30 days, a closed tab, a lock, or disconnecting Gmail. Only unsaved drafts are tidied up, and only after ${DRAFT_RETENTION_DAYS} days.</p>
          <dl class="detail-list small" id="storage-status"><dt>Checking…</dt><dd></dd></dl>
          <details class="card-flat small">
            <summary><b>What can still remove data, and how to protect it</b></summary>
            <p class="muted" style="margin-top:8px">Your data is stored encrypted in this browser. Browsers can still remove website data: you can clear it yourself (on iPhone: Settings → Apps → Safari → Clear History and Website Data), Private Browsing keeps nothing, and <b>Safari deletes a website's stored data after 7 days of using Safari without opening that website</b> (Apple's tracking prevention). That rule — not Spendly — is the likely cause of data vanishing after a week. A “persistent storage” grant asks the browser not to clear data automatically, but browsers do not promise it. The dependable protection is an encrypted backup kept in Files or iCloud Drive.</p>
            ${IS_IOS ? `<p class="muted"><b>iPhone tip:</b> add Spendly to your Home Screen (Share → Add to Home Screen) and open it from there. It then runs as its own app with its own storage, which the 7-day Safari rule does not clear while you keep using it. That app starts empty: tap “Download encrypted backup” here in Safari, then open the Home Screen app and restore the backup there.</p>` : ''}
          </details>
          ${IS_IOS ? `<p class="small muted">Backups and CSVs open the share sheet — choose <b>Save to Files</b>.</p>` : ''}
          ${EMBEDDED ? `<div class="notice warn">${icon('alert')}<div>Downloads are blocked in this embedded preview. They work on the GitHub Pages version.</div></div>` : ''}
          <div class="row">
            <button class="btn btn-primary" data-act="backup">${icon('download')}Download encrypted backup</button>
            <label class="btn btn-ghost">${icon('refresh')}Restore backup<input type="file" id="restore-file" accept=".json,application/json,text/plain" hidden /></label>
            <button class="btn btn-ghost" data-act="export-all">${icon('download')}Transactions CSV</button>
            <button class="btn btn-ghost" data-act="export-assets">${icon('download')}Assets CSV</button>
          </div>
          <h3 style="margin-top:8px">Demo data</h3>
          <p class="small muted">Adds clearly marked sample accounts, assets, a credit card, a goal and two illustrative months of income and expenses to explore Spendly. Your own records are never changed, and “Remove demo data” deletes only the sample records.</p>
          <div class="row">${store.hasDemoData()
            ? `<button class="btn btn-danger" data-act="demo-remove">${icon('trash')}Remove demo data</button>`
            : `<button class="btn btn-ghost" data-act="demo-load">${icon('spark')}Load demo data</button>`}</div>
        </article>
        <article class="card form">
          <h2>Appearance</h2>
          <div class="chips">${['dark', 'light'].map((t) => `<button class="chip" data-act="set-theme" data-theme="${t}" aria-pressed="${s.theme === t}">${icon(t === 'dark' ? 'moon' : 'sun')}${t === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}</div>
          <h2 style="margin-top:8px">Privacy</h2>
          <label class="check"><input type="checkbox" id="set-hide" ${s.hideOnOpen ? 'checked' : ''}/> Hide amounts every time Spendly opens</label>
          <label class="check"><input type="checkbox" id="set-voice" ${s.voiceConsent ? 'checked' : ''}/> Allow voice entry (uses this device's speech recognition)</label>
          <p class="tiny muted">Use the eye button at the top to show or hide every amount at once. Hiding never changes your data.</p>
          <button class="btn btn-ghost" data-act="toggle-privacy">${icon(s.revealAmounts ? 'eye-off' : 'eye')}${s.revealAmounts ? 'Hide amounts now' : 'Show amounts now'}</button>
        </article>
        <article class="card form">
          <h2>Region</h2>
          <label class="field"><span>Currency</span><input value="Indian Rupee (₹ INR)" disabled /></label>
          <label class="field"><span>Date format</span><select id="set-datefmt">${Object.entries(DATE_FORMATS).map(([k, ex]) => `<option value="${k}" ${k === s.dateFormat ? 'selected' : ''}>${ex}</option>`).join('')}</select></label>
          <label class="field"><span>Timezone</span><select id="set-tz">${tzs.map((z) => `<option ${z === s.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select><span class="hint">Decides what “today” and month boundaries mean</span></label>
        </article>
        <article class="card form">
          <h2>Organise</h2>
          <div class="row">
            <button class="btn btn-ghost" data-act="manage-categories">${icon('list')}Categories</button>
            <a class="btn btn-ghost" href="#accounts">${icon('bank')}Accounts</a>
            <a class="btn btn-ghost" href="#quick">${icon('zap')}Templates</a>
            <a class="btn btn-ghost" href="#gmail">${icon('mail')}Gmail</a>
          </div>
        </article>
        <article class="card form">
          <h2>Security</h2>
          <form class="form" id="pw-form" novalidate>
            <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" /></label>
            <label class="field"><span>New password (8+ characters)</span><input type="password" name="next" autocomplete="new-password" /></label>
            <p class="form-error"></p>
            <div class="row"><button class="btn btn-ghost" type="submit">Change password</button><button class="btn btn-ghost" type="button" data-act="lock">${icon('lock')}Lock now</button></div>
          </form>
        </article>
      </div>
      <p class="version" style="margin-top:16px">Spendly · build ${esc(document.querySelector('meta[name="spendly-build"]')?.content || 'local')}</p>
      <div>
      </div>`;
  },
  after(root) {
    const store = S();
    renderStorageStatus(root);
    $('#set-voice', root).addEventListener('change', async (e) => { await store.updateSettings({ voiceConsent: e.target.checked }); toast(e.target.checked ? 'Voice entry allowed' : 'Voice entry off'); });
    $('#set-hide', root).addEventListener('change', async (e) => { await store.updateSettings({ hideOnOpen: e.target.checked }); toast('Saved'); });
    $('#set-datefmt', root).addEventListener('change', async (e) => { await store.updateSettings({ dateFormat: e.target.value }); toast('Date format saved'); app.render(); });
    $('#set-tz', root).addEventListener('change', async (e) => { await store.updateSettings({ timezone: e.target.value }); toast('Timezone saved'); app.render(); });
    $('#pw-form', root).addEventListener('submit', (e) => {
      e.preventDefault();
      submitting(e.target, async () => {
        const v = readForm(e.target);
        await store.changePassword(v.current, v.next);
        e.target.reset();
        toast('Password changed. Older backups still need the old password.');
      });
    });
    $('#restore-file', root).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      sheet.open({
        title: 'Restore backup',
        html: `<form class="form" id="restore-form" novalidate>
          <div class="notice warn">${icon('alert')}<div>Restoring <b>replaces everything</b> currently in Spendly with the contents of <b>${esc(file.name)}</b>. Download a backup of the current data first if you might need it.</div></div>
          <label class="field"><span>Password the backup was made with</span><input type="password" name="password" autocomplete="off" /></label>
          <p class="form-error"></p>
          <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button class="btn btn-danger-solid btn" type="submit">Replace my data</button></div>
        </form>`,
        onMount(r) {
          const form = $('#restore-form', r);
          form.addEventListener('submit', (ev) => {
            ev.preventDefault();
            submitting(form, async () => {
              const res = await store.importBackup(await file.text(), form.elements.password.value);
              sheet.close();
              toast(`Restored ${res.transactions} transactions`);
              app.render();
            });
          });
        },
      });
    });
  },
};

actions['set-theme'] = async (el) => {
  await S().updateSettings({ theme: el.dataset.theme });
  app.applyTheme();
  app.render();
};
actions['manage-categories'] = () => openCategoryManager('expense');

const kb = (chars) => (chars < 1024 * 1024 ? `${Math.max(1, Math.round(chars / 1024))} KB` : `${(chars / 1024 / 1024).toFixed(1)} MB`);

async function renderStorageStatus(root) {
  const el = $('#storage-status', root);
  if (!el) return;
  const store = S();
  const info = store.storageInfo();
  const supported = Boolean(navigator.storage?.persist);
  let persisted = false;
  let estimate = null;
  try { persisted = supported && (await navigator.storage.persisted()); } catch { /* unsupported */ }
  try { estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { /* unsupported */ }
  app.state.persisted = persisted;
  const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const pctUsed = (info.vaultChars / info.approxLimitChars) * 100;
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  el.innerHTML = [
    row('Saved in', 'This browser, encrypted'),
    row('Last successful save', info.lastSavedAt ? esc(new Date(info.lastSavedAt).toLocaleString()) : 'Not yet'),
    row('Last backup', store.db.settings.lastBackupAt ? esc(new Date(store.db.settings.lastBackupAt).toLocaleString()) : '<span class="neg">Never — download one below</span>'),
    row('Persistent storage', !supported ? 'Not supported by this browser' : persisted ? '<span class="pos">Granted</span> (the browser has agreed not to clear it automatically — not a guarantee)' : `Not granted <button class="btn btn-ghost btn-sm" id="ask-persist" type="button">Ask again</button>`),
    row('Space used', `${kb(info.vaultChars)} of about 5 MB the browser allows (${pctUsed < 1 ? '<1' : pctUsed.toFixed(0)}%)${pctUsed > 70 ? ' <span class="neg">— nearly full: download a backup</span>' : ''}${estimate?.quota ? `<br><span class="muted tiny">Browser estimate: ${kb(estimate.usage || 0)} used of ${kb(estimate.quota)}</span>` : ''}`),
    row('Opened as', standalone ? 'Home Screen app' : IS_IOS ? 'Safari tab (see the iPhone tip below)' : 'Browser tab'),
  ].join('');
  $('#ask-persist', el)?.addEventListener('click', async () => {
    let ok = false;
    try { ok = await navigator.storage.persist(); } catch { ok = false; }
    toast(ok ? 'The browser granted persistent storage' : 'The browser did not grant it — keep backups (and on iPhone, consider the Home Screen app)');
    renderStorageStatus(root);
  });
}
actions['backup'] = async () => {
  const text = await S().exportBackup();
  const r = await download(`spendly-backup-${S().today()}.json`, text, 'application/json');
  if (r === 'cancelled') return toast('Backup not saved');
  await S().recordBackup();
  toast(r === 'shared' ? 'Backup ready — choose “Save to Files” to keep it' : 'Encrypted backup downloaded — keep it somewhere safe');
  app.render();
};
actions['export-all'] = async () => {
  const db = S().db;
  const list = [...db.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const r = await download(`spendly-transactions-${S().today()}.csv`, transactionsToCsv(db, list), 'text/csv');
  if (r !== 'cancelled') toast(`Exported ${list.length} transactions`);
};
actions['demo-load'] = async () => {
  if (!(await ask({ title: 'Load demo data?', message: 'Sample accounts, assets, a credit card, a goal and two months of transactions will be added, each marked “demo”. Your own records stay untouched.', confirmText: 'Load demo data' }))) return;
  try {
    await S().loadDemoData();
    toast('Demo data loaded');
    app.render();
  } catch (e) { toast(e.message, { bad: true }); }
};
actions['demo-remove'] = async () => {
  if (!(await ask({ title: 'Remove demo data?', message: 'Every record marked “demo” is deleted. Records you created yourself stay.', confirmText: 'Remove', danger: true }))) return;
  await S().removeDemoData();
  toast('Demo data removed');
  app.render();
};

export { TX_TYPES, $$ };
