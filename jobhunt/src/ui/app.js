// App shell: storage choice, layout (rail on desktop, tab bar on phone), routing,
// global search and live re-rendering whenever the data changes.
import { Store, ArtifactDbAdapter, LocalAdapter, errorText } from '../core/store.js';
import { buildModel } from '../core/model.js';
import { h, icon, clear, toast, btn, refreshDrawer, setDownloads, closeDrawer } from './dom.js';
import { openJob, openApp } from './detail.js';
import { jobDialog, taskDialog } from './forms.js';
import dashboard from './views/dashboard.js';
import discover from './views/discover.js';
import shortlist from './views/shortlist.js';
import tracker from './views/tracker.js';
import tasks from './views/tasks.js';
import calendar from './views/calendar.js';
import reports from './views/reports.js';
import importView from './views/import.js';
import settings from './views/settings.js';

const TARGET = typeof __TARGET__ !== 'undefined' ? __TARGET__ : 'pages';
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

const VIEWS = {
  dashboard: { title: 'Dashboard', icon: 'dashboard', render: dashboard },
  discover: { title: 'Discover Jobs', short: 'Discover', icon: 'discover', render: discover },
  shortlist: { title: 'Shortlist', icon: 'star', render: shortlist },
  tracker: { title: 'Application Tracker', short: 'Tracker', icon: 'tracker', render: tracker },
  tasks: { title: 'Tasks', icon: 'tasks', render: tasks },
  calendar: { title: 'Calendar', icon: 'calendar', render: calendar },
  reports: { title: 'Reports', icon: 'reports', render: reports },
  import: { title: 'Import Jobs', short: 'Import', icon: 'import', render: importView },
  settings: { title: 'Settings', icon: 'settings', render: settings },
};
const NAV = [['Overview', ['dashboard']], ['Jobs', ['discover', 'shortlist', 'import']], ['Pipeline', ['tracker', 'tasks', 'calendar']], ['Insights', ['reports', 'settings']]];
const TABS = ['dashboard', 'discover', 'tracker', 'tasks'];

const ctx = {
  target: TARGET, build: BUILD, store: null, model: null, ui: {}, route: 'dashboard', mode: 'local',
  get settings() { return this.model.settings; },
};
window.__jobhunt = ctx; // handy for debugging in the browser console

let viewEl, railEl, tabEl, searchEl, scheduled = false, deferred = false;

export async function boot() {
  const root = document.getElementById('app');
  root.replaceChildren(h('div.boot', h('div.card', h('div.spinner'), h('div', 'Loading your job search…'))));
  let adapter;
  if (TARGET === 'artifact') {
    const db = window.claude && window.claude.use ? await window.claude.use('db').catch(() => null) : null;
    if (!db) return root.replaceChildren(blocked());
    adapter = new ArtifactDbAdapter(db);
    ctx.mode = 'cloud';
    const dl = await window.claude.use('downloads').catch(() => null);
    setDownloads(dl);
  } else {
    let storage = null;
    try { storage = window.localStorage; storage.setItem('jobhunt:probe', '1'); storage.removeItem('jobhunt:probe'); } catch { storage = null; }
    if (!storage) return root.replaceChildren(h('div.boot', h('div.card', icon('alert', 28), h('h2', 'Browser storage is blocked'), h('p', 'JobHunt keeps your data in this browser, but site data is blocked here (for example in a private window). Open it in a normal Safari or Chrome window.'))));
    adapter = new LocalAdapter(storage);
    ctx.mode = 'local';
    try { if (navigator.storage && navigator.storage.persist) ctx.persisted = await navigator.storage.persist(); } catch { /* optional */ }
  }
  const store = new Store(adapter);
  ctx.store = store;
  store.onError((e, c) => {
    if (c && c.op === 'subscribe') { ctx.syncError = errorText(e); schedule(); return; }
    toast(`Not saved: ${errorText(e)}`, { tone: 'bad' });
  });
  await store.start();
  ctx.model = buildModel(store.state);
  applyTheme();
  root.replaceChildren(shell());
  window.addEventListener('hashchange', route);
  route();
  store.on(schedule);
  document.addEventListener('focusout', () => { if (deferred) setTimeout(() => { if (deferred && !typing()) { deferred = false; render(); } }, 0); });
  // Re-evaluate dates (overdue, today) when the day changes or the tab returns.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });
  setInterval(schedule, 5 * 60 * 1000);
}

function blocked() {
  return h('div.boot', h('div.card', icon('shield', 28), h('h2', { style: { margin: 0 } }, 'Sign in to see your job search'),
    h('p', { style: { margin: 0 } }, 'JobHunt keeps your jobs, applications and tasks in this artifact’s private database. It loads only when you open it in the Claude app or at claude.ai while signed in as its owner.'),
    h('p.faint.small', { style: { margin: 0 } }, 'Nothing is stored in this view, so nothing is lost.')));
}

const typing = () => { const a = document.activeElement; return a && viewEl && viewEl.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'button'; };

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ctx.model = buildModel(ctx.store.state);
    applyTheme();
    updateChrome();
    refreshDrawer();
    if (typing()) { deferred = true; return; }
    render();
  });
}
ctx.refresh = () => { ctx.model = buildModel(ctx.store.state); updateChrome(); render(); };
ctx.go = (r) => { if (location.hash !== '#' + r) location.hash = r; else route(); };
ctx.openJob = (id) => openJob(ctx, id);
ctx.openApp = (id) => openApp(ctx, id);
/** Runs an action and reports the outcome. Returns the result or undefined on error. */
ctx.run = async (fn, okMsg) => {
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; } catch (e) { if (!e || !e.code) toast(e.message || String(e), { tone: 'bad' }); return undefined; }
};

function applyTheme() {
  const t = (ctx.model && ctx.model.settings.theme) || 'dark';
  document.documentElement.setAttribute('data-app-theme', t);
}

function route() {
  const r = (location.hash || '#dashboard').slice(1).split(/[?/]/)[0];
  ctx.route = VIEWS[r] ? r : 'dashboard';
  closeDrawer(true);
  document.querySelector('.more-sheet-wrap')?.remove();
  updateChrome();
  render(true);
}

function render(scrollTop) {
  if (!viewEl) return;
  const v = VIEWS[ctx.route];
  const y = window.scrollY;
  let node;
  try { node = v.render(ctx); } catch (e) {
    console.error(e);
    node = h('div.notice.bad', icon('alert'), h('div', h('b', 'This screen hit an error. '), String(e && e.message || e), '. Your data is safe; try another screen or reload.'));
  }
  viewEl.replaceChildren(node);
  document.title = `${v.title} · JobHunt`;
  if (scrollTop) window.scrollTo(0, 0); else window.scrollTo(0, y);
}

function badgeCounts() {
  const m = ctx.model;
  const overdueOrToday = m.tasks.filter((t) => t.status !== 'Completed' && t.dueDate && t.dueDate <= m.ref).length;
  const fresh = m.jobs.filter((j) => !j.hidden && !j.app && !j.meta.reviewed && !j.meta.notRelevant && !j.meta.shortlisted).length;
  const follow = m.apps.filter((a) => a.followUpDue).length;
  return { discover: fresh, tasks: overdueOrToday, tracker: follow, shortlist: m.jobs.filter((j) => j.meta.shortlisted && !j.hidden).length };
}

function shell() {
  railEl = h('nav.rail', { 'aria-label': 'Main' });
  tabEl = h('nav.tabbar', { 'aria-label': 'Main' });
  viewEl = h('main.content', { id: 'view', tabindex: '-1' });
  const results = h('div.search-results', { hidden: true, role: 'listbox' });
  searchEl = h('input', { type: 'search', id: 'global-search', placeholder: 'Search jobs, companies, applications, tasks', autocomplete: 'off', 'aria-label': 'Search everything', enterkeyhint: 'search' });
  searchEl.addEventListener('input', () => showResults(results));
  searchEl.addEventListener('focus', () => showResults(results));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchEl.value = ''; results.hidden = true; searchEl.blur(); }
    if (e.key === 'Enter') { e.preventDefault(); ctx.ui.discover = { ...(ctx.ui.discover || {}), q: searchEl.value.trim() }; results.hidden = true; searchEl.blur(); ctx.go('discover'); }
    if (e.key === 'ArrowDown') { const f = results.querySelector('button'); if (f) { e.preventDefault(); f.focus(); } }
  });
  document.addEventListener('click', (e) => { if (!results.contains(e.target) && e.target !== searchEl) results.hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); searchEl.focus(); }
  });
  const top = h('header.topbar',
    h('a.brand-mark.hide-desktop', { href: '#dashboard', 'aria-label': 'Dashboard' }, icon('bolt', 18)),
    h('div.search', icon('discover', 17), searchEl, results),
    h('div.top-actions',
      btn('Add job', () => jobDialog(ctx), { ico: 'plus', title: 'Add a job by hand', attrs: { class: 'hide-phone' } }),
      btn('Task', () => taskDialog(ctx, {}), { ico: 'tasks', title: 'New task' }),
      btn('Import', () => ctx.go('import'), { kind: 'primary', ico: 'import', title: 'Import jobs' })));
  return h('div.shell', railEl, h('div.main', top, ctx.mode === 'local' ? localBanner() : null, viewEl), tabEl);
}

function localBanner() {
  const key = 'jobhunt:hide-local-banner';
  let hidden = false; try { hidden = sessionStorage.getItem(key) === '1'; } catch { /* ignore */ }
  if (hidden) return null;
  const el = h('div', { style: { paddingInline: 'max(16px, env(safe-area-inset-left, 0px))', paddingTop: '12px' } },
    h('div.notice.warn', icon('info'), h('div', { style: { flex: 1 } }, h('b', 'This copy keeps data in this browser only. '),
      'It does not sync with your scheduled job search or your other devices. Import the search results here, and use Settings → Back up regularly.'),
    btn('', () => { try { sessionStorage.setItem(key, '1'); } catch { /* ignore */ } el.remove(); }, { kind: 'ghost', ico: 'x', small: true, title: 'Hide for now' })));
  return el;
}

function updateChrome() {
  if (!railEl) return;
  const c = badgeCounts();
  const link = (id) => {
    const v = VIEWS[id];
    const n = c[id];
    return h('a.nav-link', { href: '#' + id, 'aria-current': ctx.route === id ? 'page' : null }, icon(v.icon), v.title, n ? h(`span.count${id === 'tasks' || id === 'tracker' ? '.hot' : ''}`, String(n)) : null);
  };
  const sync = ctx.mode === 'cloud'
    ? h('div', h('span.sync-dot' + (ctx.syncError ? '.off' : '')), ctx.syncError ? 'Sync problem: ' + ctx.syncError : 'Synced with claude.ai')
    : h('div', h('span.sync-dot.local'), 'This browser only');
  railEl.replaceChildren(
    h('a.brand', { href: '#dashboard', style: { textDecoration: 'none', color: 'inherit' } }, h('span.brand-mark', icon('bolt', 17)), h('span', h('div.brand-name', 'JobHunt'), h('div.brand-sub', 'Command Center'))),
    ...NAV.flatMap(([g, ids]) => [h('div.nav-group', g), ...ids.map(link)]),
    h('div.rail-foot', sync, h('div', `${ctx.model.jobs.filter((j) => !j.hidden).length} jobs · ${ctx.model.apps.length} applications`)),
  );
  const tab = (id) => {
    const v = VIEWS[id];
    const n = id === 'tasks' ? c.tasks : id === 'tracker' ? c.tracker : 0;
    return h('a.tab', { href: '#' + id, 'aria-current': ctx.route === id ? 'page' : null }, icon(v.icon, 22), v.short || v.title, n ? h('span.badge', String(n)) : null);
  };
  const moreActive = !TABS.includes(ctx.route);
  tabEl.replaceChildren(...TABS.map(tab), h('button.tab', { type: 'button', 'aria-current': moreActive ? 'page' : null, onclick: openMore, 'aria-haspopup': 'dialog' }, icon('more', 22), moreActive ? (VIEWS[ctx.route].short || VIEWS[ctx.route].title) : 'More'));
}

function openMore() {
  const ids = ['shortlist', 'calendar', 'import', 'reports', 'settings', 'dashboard'];
  const close = () => wrap.remove();
  const wrap = h('div.more-sheet-wrap', h('div.scrim', { onclick: close }),
    h('div.more-sheet', { role: 'dialog', 'aria-label': 'More sections' }, h('div.grab'),
      h('div.more-grid', ids.map((id) => h('a', { href: '#' + id, onclick: close, 'aria-current': ctx.route === id ? 'page' : null }, icon(VIEWS[id].icon, 22), VIEWS[id].short || VIEWS[id].title))),
      h('div', { style: { marginTop: '12px' } }, btn('Add a job by hand', () => { close(); jobDialog(ctx); }, { ico: 'plus', attrs: { style: 'width:100%' } }))));
  document.body.append(wrap);
  wrap.querySelector('a').focus();
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function showResults(box) {
  const q = searchEl.value.trim().toLowerCase();
  if (q.length < 2) { box.hidden = true; return; }
  const m = ctx.model;
  const hit = (...xs) => xs.some((x) => String(x || '').toLowerCase().includes(q));
  const jobs = m.jobs.filter((j) => !j.hidden && hit(j.title, j.company, j.location, j.note, j.description, j.meta.notes, j.requisitionId)).slice(0, 6);
  const apps = m.apps.filter((a) => hit(a.title, a.company, a.notes, a.recruiter && a.recruiter.name)).slice(0, 5);
  const tasks = m.tasks.filter((t) => hit(t.title, t.company, t.description, t.notes)).slice(0, 5);
  const item = (title, sub, run) => h('button.sr-item', { type: 'button', role: 'option', onclick: () => { box.hidden = true; searchEl.blur(); run(); } }, title, h('small', sub));
  clear(box);
  if (!jobs.length && !apps.length && !tasks.length) box.append(h('div.sr-group', `No matches for “${searchEl.value.trim()}”`));
  if (jobs.length) box.append(h('div.sr-group', 'Jobs'), ...jobs.map((j) => item(j.title, `${j.company} · ${j.location || 'Location not stated'}`, () => ctx.openJob(j.id))));
  if (apps.length) box.append(h('div.sr-group', 'Applications'), ...apps.map((a) => item(a.title, `${a.company} · ${a.stage}`, () => ctx.openApp(a.id))));
  if (tasks.length) box.append(h('div.sr-group', 'Tasks'), ...tasks.map((t) => item(t.title, `${t.status}${t.dueDate ? ' · due ' + t.dueDate : ''}`, () => taskDialog(ctx, { id: t.id }))));
  box.append(h('button.sr-item', { type: 'button', onclick: () => { ctx.ui.discover = { ...(ctx.ui.discover || {}), q: searchEl.value.trim() }; box.hidden = true; ctx.go('discover'); } }, h('span.faint', `Search all jobs for “${searchEl.value.trim()}” →`)));
  box.hidden = false;
  box.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : searchEl).focus(); }
  }, { once: true });
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').replaceChildren(h('div.boot', h('div.card', icon('alert', 28), h('h2', 'JobHunt could not start'), h('p', String(e && e.message || e)), h('p.faint.small', 'Your saved data has not been changed. Reload the page to try again.'))));
});
