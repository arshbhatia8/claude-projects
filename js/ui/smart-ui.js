// Smart Entry: type or say what happened, review, confirm.
// Parsing lives in core/smart.js; saving always goes through the normal,
// validated forms, so a Smart Entry is posted exactly once and only when the
// user taps Save in the review form.
import { app, actions, esc, icon, moneyText, toast, ask, sheet, $, $$, fmtDate } from './dom.js';
import { parseSmartEntry, describe } from '../core/smart.js';
import { createVoiceInput, speechSupport } from './voice.js';
import { openTxForm, openAssetForm, openSnapshotForm, openCloseAssetForm, openLiabilityForm } from './forms.js';
import { TX_TYPES } from '../core/defaults.js';

const S = () => app.store;
const DRAFT = 'smart';
const EXAMPLES = [
  'I spent ₹40 on dosa for breakfast today',
  'Spent ₹850 on groceries',
  'My salary of ₹54,000 was credited today',
  'Opened an FD with SBI for ₹50,000 at 6.5% maturing 16 October 2027',
  'I deposited ₹5,000 into my RD',
  'I invested ₹2,000 in stocks today',
];

// After any real save that started from Smart Entry, its draft text is no longer needed.
let pending = false;
export function initSmartEntry() {
  S().onChange(() => {
    if (!pending) return;
    pending = false;
    S().discardDraft(DRAFT).catch(() => {});
  });
}

/** The "Type or say what happened" bar used on Dashboard and Quick Add. */
export function smartBar() {
  return `<div class="smart-bar">
    <button class="smart-input" data-act="smart-open" aria-label="Smart Entry: type what happened">${icon('spark')}<span>Type or say what happened…</span></button>
    <button class="smart-mic" data-act="smart-voice" aria-label="Speak a Smart Entry">${icon('mic')}</button>
  </div>`;
}

function ctx() {
  const store = S();
  const t = store.totals();
  return { today: store.today(), categories: store.db.categories, accounts: t.accounts, liabilities: t.liabilities, assets: t.assets, rules: store.db.settings.smartRules };
}

function introHtml(text, r) {
  const summary = describe(r, ctx(), (p) => moneyText(p));
  return `<div class="smart-intro">
    <div class="tiny muted">You said</div>
    <div class="smart-quote">“${esc(text)}”</div>
    <div class="smart-summary">${icon('spark')}<b>${esc(summary)}</b></div>
    ${r.questions.length ? `<ul class="smart-q">${r.questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
    ${r.notes.length ? `<ul class="smart-n">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <p class="tiny muted">Check and edit anything below. Nothing is saved until you tap the button at the bottom.</p>
  </div>`;
}

/** Open the Smart Entry sheet. `listen` starts the microphone straight away (must be called from a tap). */
export function openSmartEntry({ text = '', listen = false } = {}) {
  const store = S();
  const draft = store.getDraft(DRAFT);
  const initial = text || draft?.data?.text || '';
  const { supported } = speechSupport();
  sheet.open({
    title: 'Smart Entry',
    html: `<form class="form" id="smart-form" novalidate>
      <label class="field"><span>What happened?</span>
        <textarea name="text" id="smart-text" rows="3" maxlength="400" autocapitalize="sentences" autocomplete="off" placeholder="e.g. I spent ₹40 on dosa for breakfast today">${esc(initial)}</textarea>
      </label>
      ${draft && !text ? `<p class="tiny muted">Restored your unsaved text from ${esc(new Date(draft.updatedAt).toLocaleString())}.</p>` : ''}
      <div class="row smart-voice-row">
        <button type="button" class="btn btn-ghost" id="smart-mic" aria-pressed="false">${icon('mic')}<span>${supported ? 'Speak' : 'Voice'}</span></button>
        <span class="small muted" id="smart-status" role="status" aria-live="polite">${supported ? 'Tap Speak, say it naturally, then check the text.' : 'Voice input isn’t available here — tap the text box and use the 🎤 key on your keyboard.'}</span>
      </div>
      <div class="chips smart-examples" role="group" aria-label="Examples">${EXAMPLES.map((e) => `<button type="button" class="chip" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" id="smart-cancel">Cancel</button>
        <button type="submit" class="btn btn-primary">${icon('check')}Review</button>
      </div>
    </form>`,
    onMount(root) {
      const form = $('#smart-form', root);
      const ta = form.elements.text;
      const status = $('#smart-status', form);
      const mic = $('#smart-mic', form);
      let timer;
      const saveDraft = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { if (ta.value.trim()) store.saveDraft(DRAFT, { text: ta.value }).catch(() => {}); }, 600);
      };
      ta.addEventListener('input', saveDraft);
      $('#smart-cancel', form).addEventListener('click', () => { clearTimeout(timer); voice.abort(); store.discardDraft(DRAFT).catch(() => {}); sheet.close(); });
      $$('[data-example]', form).forEach((b) => b.addEventListener('click', () => { ta.value = b.dataset.example; saveDraft(); ta.focus(); }));

      const voice = createVoiceInput({
        onText: (t) => { ta.value = t; saveDraft(); },
        onState: (st) => {
          const on = st === 'listening';
          mic.setAttribute('aria-pressed', String(on));
          mic.classList.toggle('recording', on);
          mic.innerHTML = `${icon(on ? 'stop' : 'mic')}<span>${on ? 'Stop' : 'Speak'}</span>`;
          if (on) status.classList.remove('neg');
          else if (status.classList.contains('neg')) return; // keep the error message visible
          status.textContent = on ? 'Listening… speak now. Tap Stop when done.' : ta.value.trim() ? 'Check the text, edit if needed, then tap Review.' : 'Tap Speak to try again, or type.';
        },
        onError: (err) => { status.textContent = err.message; status.classList.add('neg'); },
      });
      const startVoice = async () => {
        status.classList.remove('neg');
        if (voice.active) return voice.stop();
        if (!voice.supported) return voice.start(); // shows the keyboard-dictation fallback message
        if (!store.db.settings.voiceConsent) {
          const ok = await ask({
            title: 'Use voice entry?',
            message: 'Voice uses your browser’s built-in speech recognition. On iPhone that is Apple’s dictation service, which may process the audio on Apple’s servers. Spendly never records, keeps or uploads audio itself — only the text appears here for you to check. You can turn this off in Settings.',
            confirmText: 'Allow voice',
          });
          if (!ok) return;
          await store.updateSettings({ voiceConsent: true });
          status.textContent = 'Voice allowed. Tap Speak to start.';
          return; // a fresh tap is needed so the browser treats it as user-initiated
        }
        voice.start();
      };
      mic.addEventListener('click', startVoice);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        voice.abort();
        const t = ta.value.trim();
        if (!t) { $('.form-error', form).textContent = 'Type or say what happened first.'; return; }
        store.saveDraft(DRAFT, { text: t }).catch(() => {});
        review(t);
      });
      if (listen && supported) startVoice(); // asks for consent first if needed
      else if (listen) mic.focus();
      else ta.focus();
    },
  });
}

/** Turn the parsed proposal into the right review form. */
export function review(text) {
  const store = S();
  const r = parseSmartEntry(text, ctx());
  const intro = introHtml(text, r);
  const totals = store.totals();
  const asset = (id) => totals.assets.find((a) => a.id === id);
  pending = true;
  switch (r.intent) {
    case 'expense': case 'income': case 'refund': case 'transfer': case 'investment': case 'rd_contribution':
      return openTxForm({ title: 'Review Smart Entry', intro, values: r.tx, saveLabel: TX_TYPES[r.tx.type].verb, focus: r.tx.amount ? 'none' : 'amount' });
    case 'fd_create': case 'rd_create': case 'investment_new_asset':
      if (r.duplicates.length) return chooseDuplicate(text, r, intro);
      return openAssetForm(null, r.asset.type, { values: r.asset, funding: r.funding, intro });
    case 'asset_value':
      if (r.assetId) return openSnapshotForm('asset', asset(r.assetId), asset(r.assetId).value, { value: r.snapshot.value, date: r.snapshot.date, intro });
      return info('Nothing to update yet', intro, 'Add the FD first in Assets, then update its value.');
    case 'asset_close':
      if (r.assetId) return openCloseAssetForm(asset(r.assetId), { ...r.close, intro });
      return info('Which FD?', intro, 'Open the FD in Assets and use Mature / close.');
    case 'liability_create':
      return openLiabilityForm(null, r.liability, intro);
    case 'planned':
      pending = false;
      return info('Not recorded', intro, 'If it has already happened, edit the sentence (e.g. “I paid …”) and review again.', true);
    default:
      pending = false;
      return clarify(text, r, intro);
  }
}

function info(title, intro, message, allowEdit = false) {
  sheet.open({
    title,
    html: `<div class="form">${intro}<p class="small">${esc(message)}</p><div class="sheet-foot">${allowEdit ? '<button class="btn btn-ghost" data-act="smart-open">Edit sentence</button>' : ''}<button class="btn btn-primary" data-act="close-sheet">OK</button></div></div>`,
  });
}

/** Ask what kind of entry an unclear sentence is, then open that form. Nothing is guessed. */
function clarify(text, r, intro) {
  sheet.open({
    title: 'What was this?',
    html: `<div class="form">${intro}
      <div class="menu-list">
        <button class="btn btn-ghost" data-kind="expense">${icon('out')}Money I spent</button>
        <button class="btn btn-ghost" data-kind="income">${icon('in')}Money I received</button>
        <button class="btn btn-ghost" data-kind="investment">${icon('trend')}An investment</button>
        <button class="btn btn-ghost" data-kind="transfer">${icon('transfer')}A transfer between my accounts</button>
        <button class="btn btn-ghost" data-act="smart-open">${icon('edit')}Let me rephrase</button>
      </div></div>`,
    onMount(root) {
      $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => {
        pending = true;
        openTxForm({ title: 'Review Smart Entry', intro, values: { type: b.dataset.kind, amount: r.amount ?? null, date: r.date || S().today(), notes: `Smart Entry: “${text}”` } });
      }));
    },
  });
}

/** An FD/RD/holding like this already exists: update it, add to it, or create a new one. */
function chooseDuplicate(text, r, intro) {
  const totals = S().totals();
  const matches = r.duplicates.map((d) => totals.assets.find((a) => a.id === d.id)).filter(Boolean);
  const amount = r.funding?.amount ?? r.asset?.monthlyInstallment ?? null;
  sheet.open({
    title: 'Already in Spendly?',
    html: `<div class="form">${intro}
      <p class="small">You already have ${matches.map((a) => `<b>${esc(a.name)}</b>${a.maturityDate ? ` (matures ${esc(fmtDate(a.maturityDate))})` : ''}`).join(', ')}. Choose what this entry should do so nothing is counted twice:</p>
      <div class="menu-list">
        ${matches.map((a) => `
          <button class="btn btn-ghost" data-update="${esc(a.id)}">${icon('edit')}Update the value of ${esc(a.name)}</button>
          <button class="btn btn-ghost" data-add="${esc(a.id)}">${icon('plus')}Add money to ${esc(a.name)}</button>`).join('')}
        <button class="btn btn-primary" data-new="1">${icon('pie')}Create a new ${esc(r.asset.type === 'rd' ? 'RD' : r.asset.type === 'fd' ? 'FD' : 'holding')}</button>
      </div></div>`,
    onMount(root) {
      root.addEventListener('click', (e) => {
        const u = e.target.closest('[data-update]');
        const a = e.target.closest('[data-add]');
        const n = e.target.closest('[data-new]');
        if (u) { const x = totals.assets.find((y) => y.id === u.dataset.update); openSnapshotForm('asset', x, x.value, { value: amount, intro }); }
        if (a) openTxForm({ title: 'Review Smart Entry', intro, values: { type: 'investment', amount, date: S().today(), to: { kind: 'asset', id: a.dataset.add }, from: r.funding?.accountId ? { kind: 'account', id: r.funding.accountId } : null, description: `Added to ${totals.assets.find((y) => y.id === a.dataset.add).name}` } });
        if (n) openAssetForm(null, r.asset.type, { values: r.asset, funding: r.funding, intro });
      });
    },
  });
}

actions['smart-open'] = () => openSmartEntry();
actions['smart-voice'] = () => openSmartEntry({ listen: true });

export { toast };
