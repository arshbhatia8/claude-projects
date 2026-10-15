// Boot, lock screen, routing and the app shell.
import { createStore } from '../core/store.js';
import { app, actions, $, $$, esc, icon, toast, ask, sheet } from './dom.js';
import { dashboard, transactions, quick, reports } from './views-main.js';
import { assets, accounts, liabilities, goals } from './views-wealth.js';
import { gmailView, settings } from './views-settings.js';

const VIEWS = {
  dashboard: { ...dashboard, label: 'Dashboard', icon: 'home' },
  transactions: { ...transactions, label: 'Transactions', icon: 'list' },
  quick: { ...quick, label: 'Quick Add', icon: 'zap' },
  gmail: { ...gmailView, label: 'Gmail Imports', icon: 'mail' },
  assets: { ...assets, label: 'Assets & Investments', icon: 'pie' },
  accounts: { ...accounts, label: 'Bank Accounts & Cash', icon: 'bank' },
  liabilities: { ...liabilities, label: 'Liabilities', icon: 'card' },
  goals: { ...goals, label: 'Savings Goals', icon: 'target' },
  reports: { ...reports, label: 'Reports & Analytics', icon: 'chart' },
  settings: { ...settings, label: 'Settings', icon: 'settings' },
};

const store = createStore();
app.store = store;
let currentRoute = null;

// ---------------------------------------------------------------------------
// Theme & privacy
// ---------------------------------------------------------------------------

app.applyTheme = () => {
  const light = store.isUnlocked() && store.db.settings.theme === 'light';
  document.documentElement.classList.toggle('theme-light', light);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#eef8f0' : '#070d09');
  try { localStorage.setItem('spendly.theme', light ? 'light' : 'dark'); } catch { /* ignore */ }
};

function syncPrivacyButton() {
  const on = store.db.settings.revealAmounts;
  const btn = $('#privacy-toggle');
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Hide amounts' : 'Show amounts');
  btn.title = on ? 'Hide amounts' : 'Show amounts';
  btn.innerHTML = icon(on ? 'eye' : 'eye-off');
}

actions['toggle-privacy'] = async () => {
  await store.updateSettings({ revealAmounts: !store.db.settings.revealAmounts });
  app.render();
  toast(store.db.settings.revealAmounts ? 'Amounts shown' : 'Amounts hidden');
};

// ---------------------------------------------------------------------------
// Routing & rendering
// ---------------------------------------------------------------------------

function route() {
  const name = (location.hash.slice(1) || 'dashboard').split('?')[0];
  return VIEWS[name] ? name : 'dashboard';
}

function renderNav(active) {
  const pending = store.db.gmailCandidates.filter((c) => c.status === 'pending').length;
  $('#side-nav').innerHTML = Object.entries(VIEWS)
    .map(([key, v]) => `<a href="#${key}" class="${key === active ? 'active' : ''}" ${key === active ? 'aria-current="page"' : ''}>${icon(v.icon)}<span>${esc(v.label)}</span>${key === 'gmail' && pending ? `<span class="badge count">${pending}</span>` : ''}</a>`)
    .join('');
  const tabKey = ['dashboard', 'transactions', 'quick', 'assets'].includes(active) ? active : 'more';
  $$('.tabbar [data-tab]').forEach((el) => el.classList.toggle('active', el.dataset.tab === tabKey));
}

app.render = ({ keepFocus = false } = {}) => {
  if (!store.isUnlocked()) return;
  const name = route();
  const view = VIEWS[name];
  const root = $('#view');
  const sameRoute = name === currentRoute;
  const scroll = window.scrollY;
  const active = document.activeElement;
  const focus = keepFocus && active && root.contains(active) ? { id: active.id, name: active.name, start: active.selectionStart, end: active.selectionEnd } : null;

  renderNav(name);
  syncPrivacyButton();
  $('#topbar-title').textContent = view.label;
  document.title = name === 'dashboard' ? 'Spendly' : `${view.label} · Spendly`;
  try {
    root.innerHTML = view.render();
    view.after?.(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="card">${icon('alert')}<h2>Something went wrong showing this screen</h2><p class="muted small">${esc(err.message)}</p><p class="small">Your data is safe. Try another section or reload the page.</p></div>`;
  }
  currentRoute = name;
  if (sameRoute) window.scrollTo(0, scroll);
  else {
    window.scrollTo(0, 0);
    root.focus({ preventScroll: true });
  }
  if (focus) {
    const el = (focus.id && document.getElementById(focus.id)) || (focus.name && root.querySelector(`[name="${focus.name}"]`));
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ }
    }
  }
};

window.addEventListener('hashchange', () => {
  if (sheet.isOpen) sheet.close();
  app.render();
});

let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastWidth) < 40) return; // ignore mobile toolbar show/hide
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => app.render(), 200);
});

// One click handler for every [data-act] button in the app.
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try {
    await fn(el, e);
  } catch (err) {
    console.error(err);
    toast(err.message || 'Something went wrong', { bad: true });
  }
});

$('#sheet').addEventListener('close', () => { $('#sheet-body').innerHTML = ''; });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') sheet.close(); });

actions['close-sheet'] = () => sheet.close();
actions['more'] = () => {
  const items = ['gmail', 'accounts', 'liabilities', 'goals', 'reports', 'settings'];
  const pending = store.db.gmailCandidates.filter((c) => c.status === 'pending').length;
  sheet.open({
    title: 'More',
    html: `<nav class="tx-list">${items.map((k) => `<a class="tx" href="#${k}" style="text-decoration:none"><span class="tx-ico">${icon(VIEWS[k].icon)}</span><span class="tx-title">${esc(VIEWS[k].label)}</span><span>${k === 'gmail' && pending ? `<span class="badge count">${pending}</span>` : icon('right')}</span></a>`).join('')}</nav>
      <div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-block" data-act="add-asset">${icon('plus')}Add Asset</button></div>`,
  });
};
actions['lock'] = () => {
  sheet.close();
  store.lock();
  showLock('login');
};

// ---------------------------------------------------------------------------
// Lock screen
// ---------------------------------------------------------------------------

let lockMode = 'login';
function showLock(mode) {
  lockMode = mode;
  $('#shell').hidden = true;
  $('#lock').hidden = false;
  const setup = mode === 'setup';
  $('#lock-label').textContent = setup ? 'Create a password' : 'Password';
  $('#lock-confirm-wrap').hidden = !setup;
  $('#lock-note').hidden = !setup;
  $('#lock-reset').hidden = setup;
  $('#lock-submit').textContent = setup ? 'Create & continue' : 'Unlock';
  $('#lock-password').autocomplete = setup ? 'new-password' : 'current-password';
  $('#lock-password').value = '';
  $('#lock-confirm').value = '';
  $('#lock-error').textContent = '';
  document.title = 'Spendly';
  setTimeout(() => $('#lock-password').focus(), 50);
}

$('#lock-peek').addEventListener('click', () => {
  const inp = $('#lock-password');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('#lock-peek').innerHTML = icon(show ? 'eye-off' : 'eye');
  $('#lock-peek').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#lock-submit');
  const password = $('#lock-password').value;
  $('#lock-error').textContent = '';
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = lockMode === 'setup' ? 'Creating…' : 'Unlocking…';
  try {
    if (lockMode === 'setup') {
      if (password !== $('#lock-confirm').value) throw new Error('The two passwords do not match');
      await store.setup(password);
    } else {
      await store.unlock(password);
    }
    enterApp();
  } catch (err) {
    $('#lock-error').textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('#lock-reset').addEventListener('click', async () => {
  const ok = await ask({
    title: 'Start over?',
    message: 'Without the password your data cannot be decrypted. Starting over permanently deletes everything Spendly saved in this browser. If you have a backup and remember its password, you can restore it afterwards.',
    confirmText: 'Delete everything',
    danger: true,
    typeToConfirm: 'DELETE',
  });
  if (!ok) return;
  store.resetEverything();
  showLock('setup');
});

function enterApp() {
  $('#lock').hidden = true;
  $('#shell').hidden = false;
  app.state.month = store.today().slice(0, 7);
  app.applyTheme();
  currentRoute = null;
  app.render();
}

(async function boot() {
  try {
    const s = await store.status();
    if (s.signedIn) enterApp();
    else showLock(s.setUp ? 'login' : 'setup');
  } catch (err) {
    console.error(err);
    showLock('login');
    $('#lock-error').textContent = err.message;
  }
})();
