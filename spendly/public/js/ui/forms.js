// Every add / edit form, shown in the bottom sheet.
import {
  app, esc, icon, money, moneyText, fmtDate, toast, ask, sheet, readForm, submitting, $, $$,
  endpointOptions, parseRef, categoryOptions, subcategoryOptions, categoryName, refName, TYPE_ICON, categoryIcon,
} from './dom.js';
import { TX_TYPES, PAYMENT_METHODS, ACCOUNT_TYPES, ASSET_TYPES, ASSET_STATUS, LIABILITY_TYPES, GOAL_KINDS } from '../core/defaults.js';
import { toInputValue, formatINR } from '../core/money.js';
import { reversibleAmount } from '../core/ledger.js';

const S = () => app.store;
const done = (msg) => {
  sheet.close();
  toast(msg);
  app.render();
};

const opt = (value, label, selected) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`;
const paymentOptions = (sel) => `<option value="">—</option>` + PAYMENT_METHODS.map((m) => opt(m, m, sel)).join('');
const field = (label, inner, { full = false, hint = '' } = {}) =>
  `<label class="field${full ? ' full' : ''}"><span>${esc(label)}</span>${inner}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;

// Which endpoints each type uses: [fromKinds, toKinds]
const ENDPOINTS = {
  expense: [['account', 'liability'], null],
  income: [null, ['account']],
  refund: [null, ['account', 'liability']],
  transfer: [['account', 'asset', 'liability'], ['account', 'asset', 'liability']],
  investment: [['account'], ['asset']],
  reversal: [null, null],
};
const FROM_LABEL = { expense: 'Paid from', transfer: 'From', investment: 'From account' };
const TO_LABEL = { income: 'Received in', refund: 'Refunded to', transfer: 'To', investment: 'Invested in (asset)' };

// ---------------------------------------------------------------------------
// Transaction form
// ---------------------------------------------------------------------------

/**
 * mode: 'new' | 'edit' | 'gmail' | 'reversal'
 * values: prefill (transaction-shaped), template: quick-add template used, candidate: Gmail import being edited
 */
export function openTxForm({ mode = 'new', values = {}, template = null, candidate = null, original = null } = {}) {
  const store = S();
  let type = values.type || 'expense';
  const isReversal = mode === 'reversal';
  if (isReversal) type = 'reversal';
  const title = template ? template.name : mode === 'edit' ? 'Edit transaction' : mode === 'gmail' ? 'Review import' : isReversal ? 'Reverse transaction' : 'Add transaction';
  const maxReverse = isReversal ? reversibleAmount(store.db, original.id) : 0;

  const typeChips = isReversal
    ? ''
    : `<div class="type-toggle" role="radiogroup" aria-label="Transaction type">${['expense', 'income', 'transfer', 'investment', 'refund']
        .map((t) => `<button type="button" class="chip" data-type="${t}" role="radio" aria-pressed="${t === type}">${icon(TYPE_ICON[t])}${TX_TYPES[t].label}</button>`)
        .join('')}</div>`;

  const html = `
    <form class="form" id="tx-form" novalidate>
      ${typeChips}
      ${isReversal ? `<div class="notice">${icon('undo')}<div>Reversing <b>${esc(original.description)}</b> (${esc(TX_TYPES[original.type].label)}, ${esc(fmtDate(original.date))}). Up to <b>${esc(formatINR(maxReverse))}</b> can still be reversed. The reversal undoes its effect on balances and reports.</div></div>` : ''}
      ${candidate ? `<div class="notice">${icon('mail')}<div><b>${esc(candidate.subject)}</b><br><span class="tiny muted">${esc(candidate.sender)} · ${esc(fmtDate(candidate.emailDate))}</span></div></div>` : ''}
      <div class="amount-box field">
        <span>Amount</span>
        <div class="amount-input"><b>₹</b><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(toInputValue(isReversal ? values.amount ?? maxReverse : values.amount))}" aria-label="Amount in rupees" /></div>
      </div>
      <div id="tx-fields" class="form-grid"></div>
      <p class="confirm-line" id="tx-confirm"></p>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot">
        <button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button>
        <button type="submit" class="btn btn-primary" id="tx-save">${esc(mode === 'gmail' ? 'Approve & import' : TX_TYPES[type].verb)}</button>
      </div>
    </form>`;

  sheet.open({
    title,
    html,
    onMount(root) {
      const form = $('#tx-form', root);
      const state = { ...values };

      const renderFields = () => {
        const [fromKinds, toKinds] = ENDPOINTS[type];
        const catKind = type === 'income' ? 'income' : 'expense';
        const usesCategory = ['income', 'expense', 'refund'].includes(type);
        const cat = usesCategory ? state.categoryId : null;
        const hasSubs = cat && store.db.categories.some((c) => c.parentId === cat && !c.archived);
        const showTemplate = mode === 'new' && !template && !isReversal;
        $('#tx-fields', form).innerHTML = `
          ${usesCategory ? field(type === 'refund' ? 'Refund for (category)' : 'Category', `<select name="categoryId">${categoryOptions(catKind, cat, { blank: 'Choose…' })}</select>`) : ''}
          ${hasSubs ? field('Subcategory', `<select name="subcategoryId">${subcategoryOptions(cat, state.subcategoryId)}</select>`) : ''}
          ${fromKinds ? field(FROM_LABEL[type], `<select name="from">${endpointOptions(fromKinds, state.from, { blank: type === 'transfer' ? 'Choose…' : 'Not linked to an account' })}</select>`, { hint: type === 'expense' ? 'Pick a credit card to record a card purchase' : '' }) : ''}
          ${toKinds ? field(TO_LABEL[type], `<select name="to">${endpointOptions(toKinds, state.to, { blank: type === 'transfer' || type === 'investment' ? 'Choose…' : 'Not linked to an account' })}</select>`, { hint: type === 'transfer' ? 'Paying a credit card bill? Choose the card here.' : '' }) : ''}
          ${field('Date', `<input type="date" name="date" value="${esc(state.date || store.today())}" />`)}
          ${field('Time (optional)', `<input type="time" name="time" value="${esc(state.time || '')}" />`)}
          ${field('Description', `<input name="description" maxlength="200" autocomplete="off" value="${esc(state.description || '')}" placeholder="${type === 'income' ? 'e.g. October salary' : 'e.g. Masala dosa'}" />`, { full: true })}
          ${!isReversal ? field('Payment method', `<select name="paymentMethod">${paymentOptions(state.paymentMethod || '')}</select>`) : ''}
          ${!isReversal ? field('Reference (optional)', `<input name="externalRef" maxlength="64" autocomplete="off" value="${esc(state.externalRef || '')}" placeholder="UPI ref / txn id" />`) : ''}
          ${field('Notes', `<textarea name="notes" rows="2" maxlength="1000">${esc(state.notes || '')}</textarea>`, { full: true })}
          ${showTemplate ? `<label class="check full"><input type="checkbox" name="saveTemplate" ${state.saveTemplate ? 'checked' : ''}/> Save as reusable template</label>
            <label class="field full" id="tpl-name-wrap" ${state.saveTemplate ? '' : 'hidden'}><span>Template name</span><input name="templateName" maxlength="60" value="${esc(state.templateName || state.description || '')}" placeholder="e.g. Breakfast – Dosa" /></label>` : ''}
        `;
        if (type === 'investment' && !store.db.assets.some((a) => a.status === 'active' && !a.archived)) {
          $('#tx-fields', form).insertAdjacentHTML('afterbegin', `<div class="notice warn full">${icon('alert')}<div>Add the asset first (Assets → Add Asset), then record money going into it.</div></div>`);
        }
        updateConfirm();
      };

      const capture = () => Object.assign(state, readForm(form), { from: parseRef(form.from?.value), to: parseRef(form.to?.value) });

      const updateConfirm = () => {
        const v = readForm(form);
        const parts = [`<b>${esc(TX_TYPES[type].label)}</b>`];
        if (v.categoryId) parts.push(esc(categoryName(v.categoryId)));
        if (v.from) parts.push(`from ${esc(refName(parseRef(v.from)))}`);
        if (v.to) parts.push(`to ${esc(refName(parseRef(v.to)))}`);
        parts.push(esc(v.date === store.today() ? 'today' : fmtDate(v.date)));
        const amt = v.amount ? `₹${esc(v.amount)}` : 'amount not entered';
        $('#tx-confirm', form).innerHTML = `${amt} · ${parts.join(' · ')}`;
      };

      $$('[data-type]', form).forEach((b) =>
        b.addEventListener('click', () => {
          capture();
          const prevKind = type === 'income' ? 'income' : 'expense';
          type = b.dataset.type;
          const kind = type === 'income' ? 'income' : 'expense';
          if (kind !== prevKind) { state.categoryId = ''; state.subcategoryId = ''; }
          const [fk, tk] = ENDPOINTS[type];
          if (state.from && !(fk || []).includes(state.from.kind)) state.from = null;
          if (state.to && !(tk || []).includes(state.to.kind)) state.to = null;
          $$('[data-type]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          if (mode !== 'gmail') $('#tx-save', form).textContent = TX_TYPES[type].verb;
          renderFields();
        })
      );
      form.addEventListener('change', (e) => {
        if (e.target.name === 'categoryId') { capture(); state.subcategoryId = ''; renderFields(); return; }
        if (e.target.name === 'saveTemplate') $('#tpl-name-wrap', form).hidden = !e.target.checked;
        updateConfirm();
      });
      form.addEventListener('input', updateConfirm);

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          const v = readForm(form);
          const input = {
            type, amount: v.amount, date: v.date, time: v.time, description: v.description, notes: v.notes,
            categoryId: v.categoryId, subcategoryId: v.subcategoryId, paymentMethod: v.paymentMethod, externalRef: v.externalRef,
            from: parseRef(v.from), to: parseRef(v.to),
          };
          if (isReversal) {
            await store.createTransaction({ type: 'reversal', amount: v.amount, date: v.date, time: v.time, description: v.description, notes: v.notes, reversesId: original.id });
            return done('Reversal saved');
          }
          if (mode === 'edit') {
            await store.updateTransaction(values.id, input);
            return done('Transaction updated');
          }
          if (mode === 'gmail') {
            await store.approveGmailCandidate(candidate.id, input);
            return done('Imported from Gmail');
          }
          const saveAs = v.saveTemplate ? { name: v.templateName || v.description } : null;
          if (saveAs && !saveAs.name) throw Object.assign(new Error('Give the template a name'), { field: 'templateName' });
          const res = await store.createTransaction(input, { templateId: template?.id || null, saveAsTemplate: saveAs });
          let msg = `${TX_TYPES[type].label} saved`;
          if (res.template) msg += ' · template created';
          if (res.templateExists) msg += ' · a template with that name already exists';
          done(msg);
        });
      });

      renderFields();
      const amountInput = form.amount;
      if (!amountInput.value) amountInput.focus();
    },
  });
}

/** Read-only details of a transaction with its actions. */
export function openTxDetail(id) {
  const store = S();
  const tx = store.db.transactions.find((t) => t.id === id);
  if (!tx) return toast('That transaction no longer exists', { bad: true });
  const orig = tx.reversesId ? store.db.transactions.find((t) => t.id === tx.reversesId) : null;
  const reversals = store.db.transactions.filter((t) => t.reversesId === tx.id);
  const canReverse = tx.type !== 'reversal' && reversibleAmount(store.db, tx.id) > 0;
  const tpl = tx.templateId ? store.db.templates.find((t) => t.id === tx.templateId) : null;
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${v}</dd>` : '');
  const html = `
    <div class="form">
      <div class="amount-box"><span>${esc(TX_TYPES[tx.type].label)}</span><div class="item-value">${money(tx.amount)}</div><div class="muted small">${esc(tx.description)}</div></div>
      <dl class="detail-list">
        ${row('Date', esc(fmtDate(tx.date)) + (tx.time ? ` · ${esc(tx.time)}` : ''))}
        ${row('Category', esc(categoryName(tx.categoryId)) + (tx.subcategoryId ? ` › ${esc(categoryName(tx.subcategoryId))}` : ''))}
        ${row('From', esc(refName(tx.from)))}
        ${row('To', esc(refName(tx.to)))}
        ${row('Payment method', esc(tx.paymentMethod))}
        ${row('Reference', esc(tx.externalRef))}
        ${row('Reverses', orig ? `${esc(orig.description)} (${esc(fmtDate(orig.date))})` : '')}
        ${row('Reversed by', reversals.map((r) => `${moneyText(r.amount)} on ${esc(fmtDate(r.date))}`).join('<br>'))}
        ${row('Source', esc({ manual: 'Added manually', gmail: 'Gmail import (approved)', demo: 'Demo data' }[tx.source] || tx.source) + (tpl ? ` · via “${esc(tpl.name)}”` : ''))}
        ${row('Notes', esc(tx.notes).replace(/\n/g, '<br>'))}
        ${row('Created', esc(new Date(tx.createdAt).toLocaleString()))}
        ${tx.updatedAt !== tx.createdAt ? row('Updated', esc(new Date(tx.updatedAt).toLocaleString())) : ''}
        ${row('ID', `<code>${esc(tx.id)}</code>`)}
      </dl>
      <div class="sheet-foot">
        <button type="button" class="btn btn-danger" data-act="tx-delete" data-id="${esc(tx.id)}">${icon('trash')}Delete</button>
        <span class="spacer"></span>
        ${canReverse ? `<button type="button" class="btn btn-ghost" data-act="tx-reverse" data-id="${esc(tx.id)}">${icon('undo')}Reverse</button>` : ''}
        ${tx.type !== 'reversal' ? `<button type="button" class="btn btn-ghost" data-act="tx-repeat" data-id="${esc(tx.id)}">${icon('refresh')}Repeat</button>` : ''}
        ${tx.type !== 'reversal' ? `<button type="button" class="btn btn-ghost" data-act="tx-to-template" data-id="${esc(tx.id)}">${icon('zap')}Save as template</button>` : ''}
        <button type="button" class="btn btn-primary" data-act="tx-edit" data-id="${esc(tx.id)}">${icon('edit')}Edit</button>
      </div>
    </div>`;
  sheet.open({ title: 'Transaction', html });
}

// ---------------------------------------------------------------------------
// Template form
// ---------------------------------------------------------------------------

export function openTemplateForm(existing = null, prefill = {}) {
  const store = S();
  const v = { type: 'expense', pinned: false, ...prefill, ...(existing || {}) };
  let type = v.type;
  const html = `
    <form class="form" id="tpl-form" novalidate>
      <p class="muted small">A template is a shortcut. It never counts as spending by itself — each time you use it and press Save, a new transaction is recorded.</p>
      <div class="form-grid">
        ${field('Template name', `<input name="name" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. Breakfast – Dosa" required />`, { full: true, hint: 'Use “Group – Item” (e.g. Breakfast – Dosa) to group related templates.' })}
        <div class="full type-toggle" role="radiogroup" aria-label="Type">${['expense', 'income', 'transfer', 'investment', 'refund'].map((t) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${t === type}">${TX_TYPES[t].label}</button>`).join('')}</div>
        <div id="tpl-fields" class="form-grid full"></div>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot">
        ${existing ? `<button type="button" class="btn btn-danger" id="tpl-delete">${icon('trash')}Delete</button><span class="spacer"></span>` : ''}
        <button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button>
        <button type="submit" class="btn btn-primary">${existing ? 'Save template' : 'Create template'}</button>
      </div>
    </form>`;
  sheet.open({
    title: existing ? 'Edit template' : 'New template',
    html,
    onMount(root) {
      const form = $('#tpl-form', root);
      const state = { ...v };
      const render = () => {
        const [fk, tk] = ENDPOINTS[type];
        const usesCat = ['income', 'expense', 'refund'].includes(type);
        const hasSubs = usesCat && state.categoryId && store.db.categories.some((c) => c.parentId === state.categoryId && !c.archived);
        $('#tpl-fields', form).innerHTML = `
          ${usesCat ? field('Category', `<select name="categoryId">${categoryOptions(type === 'income' ? 'income' : 'expense', state.categoryId, { blank: 'Choose…' })}</select>`) : ''}
          ${hasSubs ? field('Subcategory', `<select name="subcategoryId">${subcategoryOptions(state.categoryId, state.subcategoryId)}</select>`) : ''}
          ${field('Default amount (optional)', `<input name="amount" inputmode="decimal" autocomplete="off" value="${esc(toInputValue(state.amount))}" placeholder="Leave empty to type each time" />`)}
          ${fk ? field(`Preferred ${FROM_LABEL[type].toLowerCase()}`, `<select name="from">${endpointOptions(fk, state.from, { blank: 'None' })}</select>`) : ''}
          ${tk ? field(`Preferred ${TO_LABEL[type].toLowerCase()}`, `<select name="to">${endpointOptions(tk, state.to, { blank: 'None' })}</select>`) : ''}
          ${field('Payment method', `<select name="paymentMethod">${paymentOptions(state.paymentMethod || '')}</select>`)}
          ${field('Default description', `<input name="description" maxlength="200" value="${esc(state.description || '')}" />`, { full: true })}
          ${field('Notes', `<textarea name="notes" rows="2">${esc(state.notes || '')}</textarea>`, { full: true })}
          <label class="check full"><input type="checkbox" name="pinned" ${state.pinned ? 'checked' : ''}/> Pin to favourites</label>`;
      };
      const capture = () => Object.assign(state, readForm(form), { from: parseRef(form.from?.value), to: parseRef(form.to?.value) });
      $$('[data-type]', form).forEach((b) => b.addEventListener('click', () => {
        capture();
        if ((b.dataset.type === 'income') !== (type === 'income')) { state.categoryId = ''; state.subcategoryId = ''; }
        type = b.dataset.type;
        const [fk, tk] = ENDPOINTS[type];
        if (state.from && !(fk || []).includes(state.from.kind)) state.from = null;
        if (state.to && !(tk || []).includes(state.to.kind)) state.to = null;
        $$('[data-type]', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        render();
      }));
      form.addEventListener('change', (e) => { if (e.target.name === 'categoryId') { capture(); state.subcategoryId = ''; render(); } });
      $('#tpl-delete', form)?.addEventListener('click', async () => {
        if (!(await ask({ title: 'Delete template?', message: `“${existing.name}” will be removed from Quick Add. Transactions you already recorded with it stay as they are.`, confirmText: 'Delete', danger: true }))) return;
        await store.deleteTemplate(existing.id);
        done('Template deleted');
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          const f = readForm(form);
          await store.saveTemplate({ ...f, type, from: parseRef(f.from), to: parseRef(f.to) }, existing?.id || null);
          done(existing ? 'Template saved' : 'Template created');
        });
      });
      render();
      if (!existing) form.elements.name.focus();
    },
  });
}

// ---------------------------------------------------------------------------
// Accounts, snapshots
// ---------------------------------------------------------------------------

export function openAccountForm(existing = null) {
  const v = existing || { type: 'savings', openingDate: S().today() };
  const html = `
    <form class="form" id="acc-form" novalidate>
      <div class="form-grid">
        ${field('Account nickname', `<input name="name" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. HDFC Savings" />`, { full: true })}
        ${field('Account type', `<select name="type">${Object.entries(ACCOUNT_TYPES).map(([k, l]) => opt(k, l, v.type)).join('')}</select>`)}
        ${field('Institution', `<input name="institution" maxlength="60" value="${esc(v.institution || '')}" placeholder="e.g. HDFC Bank" />`)}
        ${field('Last digits (optional)', `<input name="identifier" maxlength="8" inputmode="numeric" value="${esc(v.identifier || '')}" placeholder="1234" />`, { hint: 'Helps match Gmail alerts to this account' })}
        ${field('Opening balance', `<input name="openingBalance" inputmode="decimal" value="${esc(toInputValue(v.openingBalance ?? ''))}" placeholder="0" />`, { hint: 'Balance before the transactions you record here' })}
        ${field('Opening date', `<input type="date" name="openingDate" value="${esc(v.openingDate || '')}" />`)}
        ${field('Notes', `<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea>`, { full: true })}
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">${existing ? 'Save account' : 'Add account'}</button></div>
    </form>`;
  sheet.open({
    title: existing ? 'Edit account' : 'Add account',
    html,
    onMount(root) {
      const form = $('#acc-form', root);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          await S().saveAccount(readForm(form), existing?.id || null);
          done(existing ? 'Account saved' : 'Account added');
        });
      });
      if (!existing) form.elements.name.focus();
    },
  });
}

/** Reconcile an account / liability, or record an asset valuation. */
export function openSnapshotForm(kind, item, current) {
  const label = kind === 'asset' ? 'Current value' : kind === 'liability' ? 'Outstanding amount' : 'Actual balance';
  const title = kind === 'asset' ? `Update value — ${item.name}` : kind === 'liability' ? `Update outstanding — ${item.name}` : `Adjust balance — ${item.name}`;
  const explain = kind === 'asset'
    ? 'Enter the value shown by your bank, app or statement. Spendly does not fetch market prices. Money you add or withdraw after this date is added on top.'
    : 'Records the true figure on that date (e.g. from your bank app). Transactions dated on or before it no longer change the balance; later ones add to it. Gmail imports never overwrite it.';
  const history = S().db.snapshots.filter((s) => s.kind === kind && s.refId === item.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const html = `
    <form class="form" id="snap-form" novalidate>
      <p class="muted small">${esc(explain)}</p>
      <div class="card-flat row"><span class="muted small">Spendly currently shows</span><span class="spacer"></span><b>${money(current)}</b></div>
      <div class="form-grid">
        ${field(label, `<input name="value" inputmode="decimal" autocomplete="off" placeholder="0" />`)}
        ${field('As of', `<input type="date" name="date" value="${esc(S().today())}" />`)}
        ${field('Note (optional)', `<input name="note" maxlength="200" placeholder="e.g. From bank app" />`, { full: true })}
      </div>
      <p class="form-error" role="alert"></p>
      ${history.length ? `<h3>History</h3><ul class="tx-list">${history.map((s) => `<li class="row card-flat"><span>${esc(fmtDate(s.date))}</span><span class="muted small">${esc(s.note || '')}</span><span class="spacer"></span><b>${money(s.value)}</b><button type="button" class="icon-btn sm" data-act="snapshot-delete" data-id="${esc(s.id)}" aria-label="Delete entry">${icon('trash')}</button></li>`).join('')}</ul>` : ''}
      <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`;
  sheet.open({
    title,
    html,
    onMount(root) {
      const form = $('#snap-form', root);
      form.value.focus();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          await S().recordSnapshot(kind, item.id, readForm(form));
          done('Updated');
        });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ASSET_FIELDS = {
  institution: ['fd', 'rd', 'stock', 'mutual_fund', 'etf', 'other_investment', 'gold', 'other_asset'],
  symbol: ['stock', 'mutual_fund', 'etf', 'other_investment'],
  quantity: ['stock', 'mutual_fund', 'etf', 'other_investment'],
  avgPrice: ['stock', 'mutual_fund', 'etf', 'other_investment'],
  grams: ['gold'],
  openedOn: ['fd', 'rd', 'other_asset', 'other_investment'],
  maturityDate: ['fd', 'rd'],
  interestRate: ['fd', 'rd'],
  interestType: ['fd'],
  maturityAmount: ['fd', 'rd'],
  monthlyInstallment: ['rd'],
  tenureMonths: ['rd'],
  installmentsBefore: ['rd'],
  linkedAccountId: ['fd', 'rd', 'other_asset'],
  documentRef: ['fd', 'rd', 'other_asset'],
  liquid: ['other_asset'],
};

export function openAssetForm(existing = null, presetType = null) {
  const store = S();
  const v = existing || { type: presetType || 'fd', status: 'active', openedOn: store.today() };
  const accounts = store.db.accounts.filter((a) => !a.archived);
  const show = (name) => `data-show="${ASSET_FIELDS[name].join(' ')}"`;
  const f = (name, label, inner, opts = {}) => `<label class="field${opts.full ? ' full' : ''}" ${show(name)}><span>${esc(label)}</span>${inner}${opts.hint ? `<span class="hint">${esc(opts.hint)}</span>` : ''}</label>`;
  const accountOpts = (sel) => `<option value="">None</option>` + accounts.map((a) => opt(a.id, a.name, sel)).join('');
  const html = `
    <form class="form" id="asset-form" novalidate>
      <div class="notice">${icon('alert')}<div>Values here are maintained by you. Spendly never connects to banks, brokers or live prices.</div></div>
      <div class="form-grid">
        ${field('Asset type', `<select name="type">${Object.entries(ASSET_TYPES).map(([k, t]) => opt(k, t.label, v.type)).join('')}</select>`)}
        ${field('Name', `<input name="name" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. SBI FD 2027" />`)}
        ${f('institution', 'Institution / provider', `<input name="institution" maxlength="60" value="${esc(v.institution || '')}" />`)}
        ${f('symbol', 'Symbol / identifier', `<input name="symbol" maxlength="20" value="${esc(v.symbol || '')}" placeholder="e.g. NIFTYBEES" />`)}
        ${f('quantity', 'Quantity / units', `<input name="quantity" inputmode="decimal" value="${esc(v.quantity || '')}" />`)}
        ${f('avgPrice', 'Average purchase price', `<input name="avgPrice" inputmode="decimal" value="${esc(toInputValue(v.avgPrice))}" />`)}
        ${f('grams', 'Quantity (grams)', `<input name="grams" inputmode="decimal" value="${esc(v.grams || '')}" />`)}
        ${f('monthlyInstallment', 'Monthly installment', `<input name="monthlyInstallment" inputmode="decimal" value="${esc(toInputValue(v.monthlyInstallment))}" />`)}
        ${f('openedOn', 'Opening / purchase date', `<input type="date" name="openedOn" value="${esc(v.openedOn || '')}" />`)}
        ${f('maturityDate', 'Maturity date', `<input type="date" name="maturityDate" value="${esc(v.maturityDate || '')}" />`)}
        ${f('tenureMonths', 'Tenure (months)', `<input name="tenureMonths" inputmode="numeric" value="${esc(v.tenureMonths || '')}" />`)}
        ${f('installmentsBefore', 'Installments paid before tracking', `<input name="installmentsBefore" inputmode="numeric" value="${esc(v.installmentsBefore || '')}" />`, { hint: 'Installments you record later are counted automatically' })}
        ${f('interestRate', 'Interest rate % (optional)', `<input name="interestRate" inputmode="decimal" value="${esc(v.interestRate || '')}" />`)}
        ${f('interestType', 'Interest calculation (optional)', `<input name="interestType" maxlength="40" value="${esc(v.interestType || '')}" placeholder="e.g. Quarterly compounding" />`)}
        ${f('maturityAmount', 'Maturity amount (optional)', `<input name="maturityAmount" inputmode="decimal" value="${esc(toInputValue(v.maturityAmount))}" />`, { hint: 'As stated by your bank. Spendly does not calculate it.' })}
        ${f('linkedAccountId', 'Linked account (optional)', `<select name="linkedAccountId">${accountOpts(v.linkedAccountId)}</select>`)}
        ${f('documentRef', 'Document reference (optional)', `<input name="documentRef" maxlength="200" value="${esc(v.documentRef || '')}" placeholder="e.g. FD receipt no. / Drive link" />`)}
        <label class="check full" ${show('liquid')}><input type="checkbox" name="liquid" ${v.liquid ? 'checked' : ''}/> Counts as liquid cash</label>
        ${existing ? field('Status', `<select name="status">${Object.entries(ASSET_STATUS).map(([k, l]) => opt(k, l, v.status)).join('')}</select>`) : ''}
        ${field('Notes', `<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea>`, { full: true })}
      </div>
      ${existing ? `
        <details class="card-flat"><summary class="small">Amounts before tracking in Spendly</summary>
          <div class="form-grid" style="margin-top:12px">
            ${field('Invested before tracking', `<input name="openingInvested" inputmode="decimal" value="${esc(toInputValue(v.openingInvested))}" />`)}
            ${field('Value before tracking', `<input name="openingValue" inputmode="decimal" value="${esc(toInputValue(v.openingValue))}" />`)}
          </div>
        </details>` : `
        <fieldset class="card-flat form" style="border:0;margin:0">
          <legend class="small" style="font-weight:700;padding:0 0 8px">How is it funded?</legend>
          <label class="check"><input type="radio" name="fundingMode" value="existing" checked /> I already own it — record its current value</label>
          <label class="check"><input type="radio" name="fundingMode" value="account" ${accounts.length ? '' : 'disabled'} /> Paid now from one of my accounts${accounts.length ? '' : ' (add an account first)'}</label>
          <div class="form-grid" id="fund-existing">
            ${field('Amount invested', `<input name="invested" inputmode="decimal" placeholder="0" />`, { hint: 'Your cost basis' })}
            ${field('Current value', `<input name="value" inputmode="decimal" placeholder="Same as invested" />`)}
          </div>
          <div class="form-grid" id="fund-account" hidden>
            ${field('From account', `<select name="fundingAccount">${accountOpts('')}</select>`)}
            ${field('Amount', `<input name="fundingAmount" inputmode="decimal" placeholder="0" />`, { hint: 'Moves money out of the account — no expense is recorded' })}
            ${field('Date', `<input type="date" name="fundingDate" value="${esc(store.today())}" />`)}
          </div>
        </fieldset>`}
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">${existing ? 'Save asset' : 'Add asset'}</button></div>
    </form>`;
  sheet.open({
    title: existing ? `Edit ${existing.name}` : 'Add asset',
    html,
    onMount(root) {
      const form = $('#asset-form', root);
      const sync = () => {
        const t = form.type.value;
        $$('[data-show]', form).forEach((el) => { el.hidden = !el.dataset.show.split(' ').includes(t); });
        if (form.fundingMode) {
          const mode = form.querySelector('[name="fundingMode"]:checked').value;
          $('#fund-existing', form).hidden = mode !== 'existing';
          $('#fund-account', form).hidden = mode !== 'account';
        }
      };
      form.addEventListener('change', sync);
      sync();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          const d = readForm(form);
          if (existing) {
            await store.updateAsset(existing.id, d, { invested: d.openingInvested, value: d.openingValue });
            return done('Asset saved');
          }
          const funding = d.fundingMode === 'account'
            ? { mode: 'account', accountId: d.fundingAccount, amount: d.fundingAmount, date: d.fundingDate }
            : { mode: 'existing', invested: d.invested, value: d.value };
          await store.addAsset(d, funding);
          done('Asset added');
        });
      });
      if (!existing) form.elements.name.focus();
    },
  });
}

export function openCloseAssetForm(asset) {
  const accounts = S().db.accounts.filter((a) => !a.archived);
  const html = `
    <form class="form" id="close-form" novalidate>
      <p class="muted small">The recorded value (${esc(moneyText(asset.value))}) moves back to the payout account as a transfer. Anything received above it is recorded as Interest Income. If you receive less (e.g. a premature-closure penalty), the asset's value is written down instead of counting as spending.</p>
      <div class="form-grid">
        ${field('Paid out to', `<select name="accountId">${accounts.map((a) => opt(a.id, a.name, asset.linkedAccountId)).join('')}</select>`)}
        ${field('Total amount received', `<input name="amountReceived" inputmode="decimal" value="${esc(toInputValue(asset.maturityAmount || asset.value))}" />`)}
        ${field('Date', `<input type="date" name="date" value="${esc(S().today())}" />`)}
        ${field('New status', `<select name="status">${opt('matured', 'Matured', 'matured')}${opt('closed', 'Closed early', '')}</select>`)}
      </div>
      ${accounts.length ? '' : `<div class="notice warn">${icon('alert')}<div>Add a bank account first so the payout has somewhere to go.</div></div>`}
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary" ${accounts.length ? '' : 'disabled'}>Record payout</button></div>
    </form>`;
  sheet.open({
    title: `Mature / close — ${asset.name}`,
    html,
    onMount(root) {
      const form = $('#close-form', root);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          await S().closeAsset(asset.id, readForm(form));
          done('Payout recorded');
        });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Liabilities, goals
// ---------------------------------------------------------------------------

export function openLiabilityForm(existing = null) {
  const v = existing || { type: 'credit_card' };
  const accounts = S().db.accounts.filter((a) => !a.archived || a.id === v.linkedAccountId);
  const html = `
    <form class="form" id="lia-form" novalidate>
      <div class="form-grid">
        ${field('Name', `<input name="name" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. HDFC Millennia card" />`, { full: true })}
        ${field('Type', `<select name="type">${Object.entries(LIABILITY_TYPES).map(([k, l]) => opt(k, l, v.type)).join('')}</select>`)}
        ${field('Institution', `<input name="institution" maxlength="60" value="${esc(v.institution || '')}" />`)}
        ${field('Last digits (optional)', `<input name="identifier" maxlength="8" value="${esc(v.identifier || '')}" placeholder="4321" />`, { hint: 'Matches card alerts from Gmail' })}
        ${field('Outstanding amount', `<input name="openingOutstanding" inputmode="decimal" value="${esc(toInputValue(v.openingOutstanding ?? ''))}" placeholder="0" />`, { hint: 'What you owe before transactions recorded here' })}
        ${field('Original amount (optional)', `<input name="originalAmount" inputmode="decimal" value="${esc(toInputValue(v.originalAmount))}" />`)}
        ${field('Interest rate % (optional)', `<input name="interestRate" inputmode="decimal" value="${esc(v.interestRate || '')}" />`)}
        ${field('Start date', `<input type="date" name="startDate" value="${esc(v.startDate || '')}" />`)}
        ${field('Due date (optional)', `<input type="date" name="dueDate" value="${esc(v.dueDate || '')}" />`)}
        ${field('Usually paid from (optional)', `<select name="linkedAccountId"><option value="">None</option>${accounts.map((a) => opt(a.id, a.name, v.linkedAccountId)).join('')}</select>`)}
        ${field('Notes', `<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea>`, { full: true })}
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot"><button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add liability'}</button></div>
    </form>`;
  sheet.open({
    title: existing ? 'Edit liability' : 'Add liability',
    html,
    onMount(root) {
      const form = $('#lia-form', root);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          await S().saveLiability(readForm(form), existing?.id || null);
          done(existing ? 'Liability saved' : 'Liability added');
        });
      });
      if (!existing) form.elements.name.focus();
    },
  });
}

export function openGoalForm(existing = null) {
  const v = existing || { kind: 'emergency' };
  const html = `
    <form class="form" id="goal-form" novalidate>
      <div class="form-grid">
        ${field('Goal name', `<input name="name" maxlength="60" value="${esc(v.name || '')}" placeholder="e.g. Emergency Fund" />`, { full: true })}
        ${field('Type', `<select name="kind">${Object.entries(GOAL_KINDS).map(([k, l]) => opt(k, l, v.kind)).join('')}</select>`)}
        ${field('Target amount', `<input name="target" inputmode="decimal" value="${esc(toInputValue(v.target))}" />`)}
        ${field('Saved so far', `<input name="current" inputmode="decimal" value="${esc(toInputValue(v.current ?? ''))}" placeholder="0" />`, { hint: 'Update this yourself — a goal never assumes money was saved' })}
        ${field('Target date (optional)', `<input type="date" name="targetDate" value="${esc(v.targetDate || '')}" />`)}
        ${field('Notes', `<textarea name="notes" rows="2">${esc(v.notes || '')}</textarea>`, { full: true })}
      </div>
      <p class="form-error" role="alert"></p>
      <div class="sheet-foot">
        ${existing ? `<button type="button" class="btn btn-danger" id="goal-delete">${icon('trash')}Delete</button><span class="spacer"></span>` : ''}
        <button type="button" class="btn btn-ghost" data-act="close-sheet">Cancel</button><button type="submit" class="btn btn-primary">${existing ? 'Save goal' : 'Add goal'}</button>
      </div>
    </form>`;
  sheet.open({
    title: existing ? 'Edit goal' : 'New goal',
    html,
    onMount(root) {
      const form = $('#goal-form', root);
      $('#goal-delete', form)?.addEventListener('click', async () => {
        if (!(await ask({ title: 'Delete goal?', message: `“${existing.name}” will be removed. This does not change any balances.`, confirmText: 'Delete', danger: true }))) return;
        await S().deleteGoal(existing.id);
        done('Goal deleted');
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        submitting(form, async () => {
          await S().saveGoal(readForm(form), existing?.id || null);
          done(existing ? 'Goal saved' : 'Goal added');
        });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function openCategoryManager(kind = 'expense') {
  const store = S();
  const render = () => {
    const cats = store.db.categories.filter((c) => c.kind === kind && !c.parentId);
    const subs = (id) => store.db.categories.filter((c) => c.parentId === id);
    const rowHtml = (c, isSub = false) => `
      <li class="row card-flat" style="${isSub ? 'margin-left:24px' : ''}">
        ${isSub ? '' : `<span class="tx-ico" style="width:32px;height:32px">${icon(categoryIcon(c.name))}</span>`}
        <input class="cat-name" data-id="${esc(c.id)}" value="${esc(c.name)}" maxlength="60" aria-label="Category name" style="flex:1;min-width:120px" />
        ${c.archived ? '<span class="badge">Archived</span>' : ''}
        ${isSub ? '' : `<button type="button" class="icon-btn sm" data-sub="${esc(c.id)}" title="Add subcategory" aria-label="Add subcategory to ${esc(c.name)}">${icon('plus')}</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-archive="${esc(c.id)}">${c.archived ? 'Restore' : 'Archive'}</button>
      </li>`;
    return `
      <div class="form">
        <div class="tabs">${['expense', 'income'].map((k) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === kind}">${k === 'expense' ? 'Expense categories' : 'Income categories'}</button>`).join('')}</div>
        <p class="muted small">Rename by editing a name (saved when you leave the field). Archived categories stay on past transactions but are hidden from new ones.</p>
        <ul class="tx-list">${cats.map((c) => rowHtml(c) + subs(c.id).map((s) => rowHtml(s, true)).join('')).join('')}</ul>
        <form class="row" id="cat-add"><input name="name" maxlength="60" placeholder="New ${kind} category" style="flex:1" /><button class="btn btn-primary" type="submit">${icon('plus')}Add</button></form>
      </div>`;
  };
  const mount = (root) => {
    $$('[data-kind]', root).forEach((b) => b.addEventListener('click', () => openCategoryManager(b.dataset.kind)));
    $$('.cat-name', root).forEach((inp) => inp.addEventListener('change', async () => {
      try { await store.renameCategory(inp.dataset.id, inp.value); toast('Renamed'); } catch (e) { toast(e.message, { bad: true }); inp.value = categoryName(inp.dataset.id); }
    }));
    $$('[data-archive]', root).forEach((b) => b.addEventListener('click', async () => {
      const c = store.db.categories.find((x) => x.id === b.dataset.archive);
      await store.setCategoryArchived(c.id, !c.archived);
      openCategoryManager(kind);
    }));
    $$('[data-sub]', root).forEach((b) => b.addEventListener('click', async () => {
      const parent = store.db.categories.find((x) => x.id === b.dataset.sub);
      try {
        await store.addCategory({ kind, name: `New ${parent.name.split(' ')[0]} item`, parentId: parent.id });
        openCategoryManager(kind);
        toast('Subcategory added — rename it in the list');
      } catch (e) { toast(e.message, { bad: true }); }
    }));
    $('#cat-add', root).addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await store.addCategory({ kind, name: e.target.elements.name.value }); openCategoryManager(kind); toast('Category added'); } catch (err) { toast(err.message, { bad: true }); }
    });
  };
  sheet.open({ title: 'Categories', html: render(), onMount: mount });
}
