import { h, icon, btn } from '../dom.js';
import * as A from '../../core/actions.js';
import { jobCard, sortJobs } from './discover.js';
import { scoreBadge } from '../detail.js';
import { applicationDialog, taskDialog, shortlistDialog } from '../forms.js';
import { fmtDay, safeUrl } from '../../core/util.js';

export default function shortlist(ctx) {
  const m = ctx.model;
  const st = ctx.ui.shortlist = ctx.ui.shortlist || { compare: [], sort: 'priority' };
  const jobs = m.jobs.filter((j) => !j.hidden && j.meta.shortlisted);
  const prioRank = { High: 0, Medium: 1, Low: 2 };
  const list = st.sort === 'priority'
    ? jobs.slice().sort((a, b) => (prioRank[a.meta.priority] ?? 3) - (prioRank[b.meta.priority] ?? 3) || (b.score ?? -1) - (a.score ?? -1))
    : sortJobs(jobs, st.sort);
  st.compare = st.compare.filter((id) => jobs.some((j) => j.id === id));
  const head = h('div.page-head', h('div', h('h1', 'Shortlist'), h('p', 'Jobs you are seriously considering. Removing one keeps the job in Discover.')));
  if (!jobs.length) {
    return h('div.stack', head, h('div.empty', icon('star', 30), h('h3', 'Your shortlist is empty'),
      h('p', 'Use the ✓ button on a job in Discover to shortlist it and note why you like it.'), btn('Go to Discover', () => ctx.go('discover'), { kind: 'primary' })));
  }
  const toggle = (id) => { st.compare = st.compare.includes(id) ? st.compare.filter((x) => x !== id) : [...st.compare, id].slice(-4); ctx.refresh(); };
  const sorts = [['priority', 'Priority'], ['match', 'Best match'], ['newest', 'Newest'], ['comp', 'Salary'], ['deadline', 'Deadline']];
  const cards = h('div.job-list', list.map((j) => {
    const card = jobCard(ctx, j);
    const on = st.compare.includes(j.id);
    card.querySelector('.jc-tags').after(
      h('div.small', { style: { color: j.meta.shortlistReason ? 'var(--fg-2)' : 'var(--fg-3)' } }, j.meta.shortlistReason ? `“${j.meta.shortlistReason}”` : 'No reason recorded yet.'),
      h('div.row', { onclick: (e) => e.stopPropagation() },
        h('label.check', { style: { minHeight: '36px', fontSize: '13.5px' } }, h('input', { type: 'checkbox', checked: on, onchange: () => toggle(j.id), 'aria-label': `Compare ${j.title}` }), 'Compare'),
        btn('Why', () => shortlistDialog(ctx, j.id), { small: true, kind: 'ghost', ico: 'edit' }),
        btn('Apply task', () => taskDialog(ctx, { prefill: { jobId: j.id, company: j.company, title: `Tailor resume and apply: ${j.title} at ${j.company}`, category: 'Application', priority: j.meta.priority === 'High' ? 'High' : undefined } }), { small: true, kind: 'ghost', ico: 'tasks' }),
        btn('Remove', () => ctx.run(() => A.setShortlisted(ctx.store, j.id, false), 'Removed from shortlist. The job is still in Discover.'), { small: true, kind: 'ghost', ico: 'x' })));
    return card;
  }));
  return h('div.stack', head,
    h('div.row.between', h('div.chips', { role: 'group', 'aria-label': 'Sort' }, sorts.map(([v, l]) => h('button.chip', { type: 'button', 'aria-pressed': st.sort === v ? 'true' : 'false', onclick: () => { st.sort = v; ctx.refresh(); } }, l))),
      h('span.small.muted', st.compare.length ? `${st.compare.length} selected to compare (up to 4)` : 'Tick “Compare” on 2–4 jobs to compare them')),
    st.compare.length >= 2 ? compareTable(ctx, st.compare.map((id) => m.jobById[id])) : null,
    cards);
}

function compareTable(ctx, jobs) {
  const miss = (t = 'Not stated') => h('span.faint', { style: { fontStyle: 'italic' } }, t);
  const rows = [
    ['Role', (j) => h('div', h('b', j.title), h('div.small.faint', j.role))],
    ['Company', (j) => j.company],
    ['Location', (j) => [j.location || miss(), j.workMode ? h('div.small.faint', j.workMode) : null]],
    ['Salary', (j) => (j.comp ? j.ctc : miss('Not disclosed'))],
    ['Experience', (j) => (j.experience && !/not (shown|stated)/i.test(j.experience) ? j.experience : miss())],
    ['Match score', (j) => h('div', scoreBadge(j.score), h('div.small.faint', 'estimate'))],
    ['Source', (j) => j.platform],
    ['Posted', (j) => (j.postedDay ? fmtDay(j.postedDay) : miss('Not shown'))],
    ['Deadline', (j) => (j.fresh.deadline ? fmtDay(j.fresh.deadline) : miss('None given'))],
    ['Listing status', (j) => j.fresh.verification],
    ['Priority', (j) => j.meta.priority || miss('None')],
    ['Why you like it', (j) => j.meta.shortlistReason || miss('Not recorded')],
    ['', (j) => h('div.row', safeUrl(j.link) ? h('a.btn.sm', { href: safeUrl(j.link), target: '_blank', rel: 'noopener noreferrer' }, 'Listing') : null, j.app ? btn('Tracked', () => ctx.openApp(j.app.id), { small: true, kind: 'ghost' }) : btn('Track', () => applicationDialog(ctx, { jobId: j.id }), { small: true, kind: 'primary' }))],
  ];
  return h('div.card', h('div.card-head', h('h3', 'Compare'), btn('Clear', () => { ctx.ui.shortlist.compare = []; ctx.refresh(); }, { small: true, kind: 'ghost' })),
    h('div.table-wrap', { style: { border: 0 } }, h('table.compare',
      h('thead', h('tr', h('th', ''), jobs.map((j) => h('th', j.company)))),
      h('tbody', rows.map(([label, get]) => h('tr', h('th', label), jobs.map((j) => h('td', get(j)))))))));
}
