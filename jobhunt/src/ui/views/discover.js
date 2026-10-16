import { h, icon, btn, pill, select, modal, confirm } from '../dom.js';
import * as A from '../../core/actions.js';
import { PLATFORMS, WORK_MODES, EXPERIENCE_LEVELS, VERIFICATION, STAGES } from '../../core/schema.js';
import { fmtDay, daysBetween, safeUrl, relDay, addDays } from '../../core/util.js';
import { scoreBadge } from '../detail.js';
import { applicationDialog, shortlistDialog, notesDialog, taskDialog, stageTone, jobDialog } from '../forms.js';

const DEFAULTS = { q: '', status: 'all', platform: '', role: '', location: '', region: '', workMode: '', expLevel: '', comp: '', compMin: '', posted: '', found: '', scoreMin: '', priority: '', verification: '', appStatus: '', favorites: false, sort: 'newest', limit: 60, showFilters: false };

export function filterJobs(m, f) {
  const q = (f.q || '').toLowerCase().trim();
  const terms = q ? q.split(/\s+/) : [];
  const ref = m.ref;
  return m.jobs.filter((j) => {
    if (j.hidden) return false;
    if (f.status === 'notrelevant') { if (!j.meta.notRelevant) return false; } else if (j.meta.notRelevant && f.status !== 'all-incl') return false;
    if (f.status === 'new' && (j.meta.reviewed || j.app || j.meta.shortlisted)) return false;
    if (f.status === 'reviewed' && !j.meta.reviewed) return false;
    if (f.status === 'shortlisted' && !j.meta.shortlisted) return false;
    if (f.status === 'applied' && !(j.app && j.app.appliedOn) && j.status !== 'Applied') return false;
    if (f.favorites && !j.meta.favorite) return false;
    if (terms.length) {
      const hay = [j.title, j.company, j.location, j.note, j.description, (j.skills || []).join(' '), j.meta.notes, j.requisitionId, j.platform, j.role].join(' ').toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (f.platform && j.platform !== f.platform) return false;
    if (f.role && j.role !== f.role) return false;
    if (f.region && j.region !== f.region) return false;
    if (f.location && !(j.location || '').toLowerCase().includes(f.location.toLowerCase())) return false;
    if (f.workMode && (f.workMode === 'unknown' ? j.workMode : j.workMode !== f.workMode)) return false;
    if (f.expLevel && j.expLevel !== f.expLevel) return false;
    if (f.comp === 'disclosed' && !j.comp) return false;
    if (f.comp === 'undisclosed' && j.comp) return false;
    if (f.compMin && !(j.lpa && j.lpa.max >= Number(f.compMin))) return false;
    if (f.posted) { if (!j.postedDay || daysBetween(j.postedDay, ref) > Number(f.posted)) return false; }
    if (f.found === 'today') { if (j.foundDay !== ref) return false; } else if (f.found) { if (!j.foundDay || daysBetween(j.foundDay, ref) > Number(f.found)) return false; }
    if (f.scoreMin && !((j.score ?? -1) >= Number(f.scoreMin))) return false;
    if (f.priority && (j.meta.priority || 'none') !== f.priority) return false;
    if (f.verification && j.fresh.verification !== f.verification) return false;
    if (f.appStatus === 'none' && j.app) return false;
    if (f.appStatus === 'tracked' && !j.app) return false;
    if (f.appStatus && !['none', 'tracked'].includes(f.appStatus) && (!j.app || j.app.stage !== f.appStatus)) return false;
    return true;
  });
}
export function sortJobs(list, sort) {
  const by = {
    newest: (a, b) => (b.postedDay || b.foundDay || '').localeCompare(a.postedDay || a.foundDay || '') || (b.foundDay || '').localeCompare(a.foundDay || ''),
    found: (a, b) => (b.foundDay || '').localeCompare(a.foundDay || ''),
    match: (a, b) => (b.score ?? -1) - (a.score ?? -1),
    comp: (a, b) => ((b.lpa && b.lpa.max) ?? -1) - ((a.lpa && a.lpa.max) ?? -1),
    deadline: (a, b) => (a.fresh.deadline || '9999').localeCompare(b.fresh.deadline || '9999'),
    company: (a, b) => a.company.localeCompare(b.company),
  }[sort] || (() => 0);
  return list.slice().sort((a, b) => by(a, b) || (b.score ?? -1) - (a.score ?? -1));
}

export function jobCard(ctx, j, { compact = false } = {}) {
  const m = j.meta, s = ctx.store;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const iconBtn = (ico, title, fn, on) => h('button', { type: 'button', class: `btn ghost icon sm${on ? ' on' : ''}${on && ico === 'star' ? ' fav-on' : ''}`, title, 'aria-label': title, 'aria-pressed': on == null ? null : on ? 'true' : 'false', onclick: stop(fn) }, icon(ico, 17));
  const fresh = j.fresh.labels.filter((l) => l.key !== 'unverified').slice(0, 2);
  const date = j.postedDay ? `Posted ${relDay(j.postedDay)}` : j.foundDay ? `Found ${relDay(j.foundDay)}` : '';
  return h('article.job-card', {
    class: j.meta.notRelevant || j.fresh.verification === 'Closed' ? 'dim' : '', tabindex: '0', 'aria-label': `${j.title} at ${j.company}`,
    onclick: () => ctx.openJob(j.id), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) ctx.openJob(j.id); },
  },
  h('div.jc-top', h('div.jc-main', h('div.jc-title', j.title), h('div.jc-company', j.company)), scoreBadge(j.score)),
  h('div.jc-meta',
    h('span', icon('pin', 14), j.location || 'Location not stated', j.workMode && !new RegExp(j.workMode, 'i').test(j.location || '') ? ` · ${j.workMode}` : ''),
    h('span', icon('globe', 14), j.platform),
    date ? h('span', { title: `Posted: ${j.postedDay || 'not shown'} · Discovered: ${j.foundDay || 'unknown'}` }, icon('clock', 14), date) : null,
    h('span', icon('money', 14), j.comp ? j.ctc : h('span.faint', 'Salary not disclosed')),
    j.experience && !/not (shown|stated)/i.test(j.experience) ? h('span', icon('briefcase', 14), j.experience) : null),
  h('div.jc-tags',
    pill(j.status2, j.app ? stageTone(j.app.stage) : j.status2 === 'New' ? 'accent' : j.status2 === 'Shortlisted' ? 'accent' : j.status2 === 'Applied (not tracked)' ? 'info' : 'muted'),
    ...fresh.map((l) => h('span', { title: l.why }, pill(l.text, l.tone))),
    m.priority ? pill(m.priority, m.priority === 'High' ? 'accent' : 'muted') : null,
    j.role !== 'Other' ? h('span.pill.t-muted', j.role) : null),
  compact ? null : h('div.jc-actions',
    safeUrl(j.link) ? h('a', { class: 'btn ghost icon sm', href: safeUrl(j.link), target: '_blank', rel: 'noopener noreferrer', title: 'Open the original listing', 'aria-label': 'Open the original listing', onclick: (e) => e.stopPropagation() }, icon('external', 17)) : null,
    iconBtn('star', m.favorite ? 'Remove from favourites' : 'Add to favourites', () => ctx.run(() => A.toggleFavorite(s, j.id)), !!m.favorite),
    iconBtn('check', m.shortlisted ? 'Remove from shortlist' : 'Shortlist', () => (m.shortlisted ? ctx.run(() => A.setShortlisted(s, j.id, false), 'Removed from shortlist') : shortlistDialog(ctx, j.id)), !!m.shortlisted),
    iconBtn('eye', m.reviewed ? 'Mark as not reviewed' : 'Mark reviewed', () => ctx.run(() => A.markReviewed(s, j.id, !m.reviewed)), !!m.reviewed),
    iconBtn('ban', m.notRelevant ? 'Mark relevant again' : 'Not relevant', () => ctx.run(() => A.markNotRelevant(s, j.id, !m.notRelevant), m.notRelevant ? 'Marked relevant' : 'Hidden as not relevant'), !!m.notRelevant),
    iconBtn('note', m.notes ? 'Edit notes' : 'Add notes', () => notesDialog(ctx, j.id), !!m.notes),
    iconBtn('tasks', 'Create a task', () => taskDialog(ctx, { prefill: { jobId: j.id, company: j.company, title: `Review ${j.title} at ${j.company}`, category: 'Review', appId: j.app ? j.app.id : '' } })),
    h('span.spacer'),
    j.app ? btn('Tracked', (e) => { e.stopPropagation(); ctx.openApp(j.app.id); }, { small: true, kind: 'ghost', ico: 'tracker' }) : btn('Track', (e) => { e.stopPropagation(); applicationDialog(ctx, { jobId: j.id }); }, { small: true, ico: 'plus', title: 'Add to application tracker' })));
}

export default function discover(ctx) {
  const m = ctx.model;
  const f = ctx.ui.discover = { ...DEFAULTS, ...(ctx.ui.discover || {}) };
  const rerender = () => ctx.refresh();
  const set = (patch) => { Object.assign(f, patch, 'limit' in patch ? {} : { limit: 60 }); rerender(); };
  const base = m.jobs.filter((j) => !j.hidden);
  const counts = {
    all: base.filter((j) => !j.meta.notRelevant).length,
    new: base.filter((j) => !j.meta.notRelevant && !j.meta.reviewed && !j.app && !j.meta.shortlisted).length,
    shortlisted: base.filter((j) => j.meta.shortlisted).length,
    applied: base.filter((j) => (j.app && j.app.appliedOn) || j.status === 'Applied').length,
    notrelevant: base.filter((j) => j.meta.notRelevant).length,
    fav: base.filter((j) => j.meta.favorite).length,
  };
  const q = h('input', { type: 'search', id: 'discover-q', value: f.q, placeholder: 'Search title, company, keywords', 'aria-label': 'Search jobs', enterkeyhint: 'search' });
  let t;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { f.q = q.value; f.limit = 60; fill(); }, 200); });

  const chip = (v, l, n) => h('button.chip', { type: 'button', 'aria-pressed': f.status === v && !f.favorites ? 'true' : 'false', onclick: () => set({ status: v, favorites: false }) }, l, n != null ? h('span.n', String(n)) : null);
  const statusChips = h('div.chips', { role: 'group', 'aria-label': 'Show' },
    chip('all', 'All', counts.all), chip('new', 'New / unreviewed', counts.new), chip('shortlisted', 'Shortlisted', counts.shortlisted), chip('applied', 'Applied', counts.applied),
    h('button.chip', { type: 'button', 'aria-pressed': f.favorites ? 'true' : 'false', onclick: () => set({ favorites: !f.favorites, status: f.favorites ? f.status : 'all' }) }, icon('star', 14), 'Favourites', h('span.n', String(counts.fav))),
    chip('notrelevant', 'Not relevant', counts.notrelevant));

  const opts = (vals) => [['', 'Any'], ...vals];
  const roles = [...new Set(base.map((j) => j.role))].sort();
  const platforms = [...new Set([...base.map((j) => j.platform)])].sort((a, b) => PLATFORMS.indexOf(a) - PLATFORMS.indexOf(b));
  const sel = (key, label, options) => { const s = select('f-' + key, options, f[key]); s.addEventListener('change', () => set({ [key]: s.value })); return h('label.field', h('span', label), s); };
  const locInput = h('input', { type: 'text', id: 'f-location', value: f.location, placeholder: 'e.g. Pune', autocomplete: 'off' });
  locInput.addEventListener('change', () => set({ location: locInput.value.trim() }));
  const filterKeys = ['platform', 'role', 'region', 'location', 'workMode', 'expLevel', 'comp', 'compMin', 'posted', 'found', 'scoreMin', 'priority', 'verification', 'appStatus'];
  const active = filterKeys.filter((k) => f[k]).length;
  const filters = h('div.filter-panel', { hidden: !f.showFilters && !active },
    h('div.filters',
      sel('platform', 'Source platform', opts(platforms)), sel('role', 'Target role', opts(roles)),
      sel('region', 'Region', opts(['India', 'International'])), h('label.field', h('span', 'Location contains'), locInput),
      sel('workMode', 'Work mode', opts([...WORK_MODES, ['unknown', 'Not stated']])), sel('expLevel', 'Experience', opts(EXPERIENCE_LEVELS)),
      sel('comp', 'Salary', opts([['disclosed', 'Disclosed only'], ['undisclosed', 'Not disclosed']])), sel('compMin', 'Disclosed salary at least', opts([['5', '5 LPA'], ['10', '10 LPA'], ['15', '15 LPA'], ['20', '20 LPA'], ['30', '30 LPA'], ['50', '50 LPA']])),
      sel('posted', 'Posted within', opts([['1', '24 hours'], ['3', '3 days'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']])), sel('found', 'Discovered', opts([['today', 'Today'], ['3', 'Last 3 days'], ['7', 'Last 7 days'], ['30', 'Last 30 days']])),
      sel('scoreMin', 'Match score', opts([['80', '80+'], ['70', '70+'], ['60', '60+'], ['50', '50+']])), sel('priority', 'Priority', opts(['High', 'Medium', 'Low', ['none', 'No priority']])),
      sel('verification', 'Listing status', opts(VERIFICATION)), sel('appStatus', 'Application', opts([['none', 'Not in tracker'], ['tracked', 'In tracker'], ...STAGES]))),
    active ? h('div.row', { style: { marginTop: '10px' } }, btn(`Clear ${active} filter${active === 1 ? '' : 's'}`, () => set(Object.fromEntries(filterKeys.map((k) => [k, '']))), { small: true, kind: 'ghost', ico: 'x' })) : null);
  const sortSel = select('discover-sort', [['newest', 'Newest posted'], ['found', 'Newest discovered'], ['match', 'Best match'], ['comp', 'Highest disclosed salary'], ['deadline', 'Nearest deadline'], ['company', 'Company A–Z']], f.sort, { 'aria-label': 'Sort' });
  sortSel.addEventListener('change', () => set({ sort: sortSel.value }));

  const dupCount = m.dupPairs.length;
  const head = h('div.page-head',
    h('div', h('h1', 'Discover Jobs'), h('p', `${base.length} jobs from your scheduled search, imports and manual entries. Posting and discovery dates are kept separately.`)),
    h('div.head-actions', btn('Add job', () => jobDialog(ctx), { ico: 'plus' }), btn('Import', () => ctx.go('import'), { ico: 'import', kind: 'primary' })));

  const resultsBox = h('div.stack');
  const fill = () => {
    const list = sortJobs(filterJobs(m, f), f.sort);
    const results = list.slice(0, f.limit);
    const body = !base.length
      ? h('div.empty', icon('discover', 30), h('h3', 'No jobs yet'), h('p', ctx.mode === 'cloud' ? 'Your scheduled job search adds openings here after each run. You can also import a file or add a job yourself.' : 'Import a file from your scheduled search, or add a job yourself.'), h('div.row', btn('Import jobs', () => ctx.go('import'), { kind: 'primary', ico: 'import' }), btn('Add job', () => jobDialog(ctx), { ico: 'plus' })))
      : !list.length
        ? h('div.empty', icon('filter', 28), h('h3', 'No jobs match'), h('p', 'Try fewer filters or a different search.'), btn('Reset search and filters', () => { ctx.ui.discover = { ...DEFAULTS }; rerender(); }, { kind: 'ghost' }))
        : h('div.job-list', results.map((j) => jobCard(ctx, j)));
    resultsBox.replaceChildren(...[
      list.length ? h('div.row.between', h('span.muted.small', { role: 'status' }, `${list.length} job${list.length === 1 ? '' : 's'}${f.q ? ` matching “${f.q}”` : ''}`),
        f.status === 'new' && list.length ? btn(`Mark ${results.length} shown as reviewed`, async () => {
          if (!(await confirm({ title: 'Mark these as reviewed?', text: `${results.length} jobs will move out of “New”. You can undo this per job.`, confirmLabel: 'Mark reviewed' }))) return;
          for (const j of results) await ctx.run(() => A.markReviewed(ctx.store, j.id, true));
        }, { small: true, kind: 'ghost', ico: 'eye' }) : null) : null,
      body,
      list.length > f.limit ? h('div.row', { style: { justifyContent: 'center' } }, btn(`Show ${Math.min(60, list.length - f.limit)} more`, () => set({ limit: f.limit + 60 }))) : null].filter(Boolean));
  };
  fill();

  return h('div.stack',
    head,
    dupCount ? h('div.notice.warn', icon('merge'), h('div', { style: { flex: 1 } }, h('b', `${dupCount} possible duplicate${dupCount === 1 ? '' : 's'} `), 'need your review. Nothing is merged without you.'), btn('Review', () => duplicatesDialog(ctx), { small: true })) : null,
    h('div.card', h('div.toolbar', h('div.grow', q), h('div', { style: { minWidth: '170px' } }, sortSel),
      btn(active ? `Filters (${active})` : 'Filters', () => set({ showFilters: !(f.showFilters || active) }), { ico: 'filter', attrs: { class: active ? 'on' : '', 'aria-expanded': String(!filters.hidden) } })),
    h('div', { style: { marginTop: '12px' } }, statusChips), filters),
    resultsBox);
}
export function duplicatesDialog(ctx) {
  const render = () => {
    const pairs = ctx.model.dupPairs;
    if (!pairs.length) return h('p', { style: { margin: 0 } }, 'No possible duplicates left to review.');
    return h('div.stack', pairs.slice(0, 30).map((p) => {
      const a = ctx.model.jobById[p.a], b = ctx.model.jobById[p.b];
      const side = (j) => h('div', { style: { minWidth: 0 } }, h('div', h('b', j.title)), h('div.small.muted', `${j.company} · ${j.location || 'No location'}`), h('div.small.faint', `${j.platform} · found ${fmtDay(j.foundDay)}${j.app ? ' · in tracker' : ''}`));
      return h('div.card', { style: { padding: '12px' } }, h('div.small', { style: { color: 'var(--warn)', marginBottom: '8px' } }, p.reason),
        h('div.grid-2', side(a), side(b)),
        h('div.row', { style: { marginTop: '10px' } },
          btn('Keep left, merge right', async () => { await ctx.run(() => A.mergeJobs(ctx.store, a.id, b.id), 'Merged'); refresh(); }, { small: true, ico: 'merge' }),
          btn('Keep right, merge left', async () => { await ctx.run(() => A.mergeJobs(ctx.store, b.id, a.id), 'Merged'); refresh(); }, { small: true }),
          btn('Different jobs', async () => { await ctx.run(() => A.dismissDuplicate(ctx.store, a.id, b.id)); refresh(); }, { small: true, kind: 'ghost' })));
    }));
  };
  const box = h('div', render());
  const refresh = () => setTimeout(() => box.replaceChildren(render()), 50);
  return modal({ title: 'Review possible duplicates', intro: 'Merging keeps one record, hides the other and keeps its link as an extra source. Applications and tasks move to the kept job.', body: box, wide: true, actions: [{ label: 'Done', kind: 'primary', run: () => true }] });
}
void addDays;
