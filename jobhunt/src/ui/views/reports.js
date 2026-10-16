import { h, icon, btn, select, saveFile, toast } from '../dom.js';
import { series, conversion, followUpStats, kpis, inRange, filterTasks } from '../../core/metrics.js';
import { jobsCsv, appsCsv, tasksCsv, fileStamp } from '../../core/backup.js';
import { columnChart, barList, lineChart } from '../charts.js';
import { rangePicker, currentRange } from './dashboard.js';
import { fmtDay, toCsv, toDay } from '../../core/util.js';
import { taskRow } from './tasks.js';

export default function reports(ctx) {
  const full = ctx.model;
  const st = ctx.ui.reports = { role: '', ...(ctx.ui.reports || {}) };
  if (!ctx.ui.rep) ctx.ui.rep = { preset: '90d', from: '', to: '' };
  const range = currentRange(ctx, 'rep');
  const m = st.role ? { ...full, jobs: full.jobs.filter((j) => j.role === st.role), apps: full.apps.filter((a) => a.role === st.role) } : full;
  const s = series(m, range);
  const k = kpis(m, range);
  const conv = conversion(m, range);
  const fu = followUpStats(m, range);
  const overdue = filterTasks(m.tasks, 'overdue', m.ref);
  const roles = [...new Set([...full.jobs.map((j) => j.role), ...full.apps.map((a) => a.role)])].sort();
  const roleSel = select('rep-role', [['', 'All target roles'], ...roles], st.role, { 'aria-label': 'Target role' });
  roleSel.addEventListener('change', () => { st.role = roleSel.value; ctx.refresh(); });

  const save = async (name, text) => {
    try { if (await saveFile(name, text, 'text/csv')) toast(`Saved ${name}`); } catch (e) { toast(e.message, { tone: 'bad' }); }
  };
  const jobsIn = m.jobs.filter((j) => !j.hidden && inRange(j.foundDay, range));
  const appsIn = m.apps.filter((a) => inRange(a.appliedOn || toDay(a.createdAt), range));
  const tag = `${st.role ? st.role.toLowerCase().replace(/\W+/g, '-') + '-' : ''}${range.from || 'all'}-${range.to || fileStamp()}`;
  const weeklyCsv = () => toCsv(s.weekly.keys.map((key, i) => ({ key, d: s.weekly.discovered[i].value, a: s.weekly.applied[i].value, t: s.weekly.tasksDone[i].value, iv: s.interviewsOffers.interviews[i].value, of: s.interviewsOffers.offers[i].value })),
    [{ label: s.unit === 'week' ? 'Week starting' : 'Month', key: 'key' }, { label: 'Jobs discovered', key: 'd' }, { label: 'Applications submitted', key: 'a' }, { label: 'Interviews held', key: 'iv' }, { label: 'Offers', key: 'of' }, { label: 'Tasks completed', key: 't' }]);

  const card = (title, sub, body, cls = 'col-6') => h(`div.card.${cls}`, h('div.card-head', h('h3', title), sub ? h('span.sub', sub) : null), body);
  const stat = (label, value) => h('div.stat', h('b', value), h('span', label));
  return h('div.stack',
    h('div.page-head', h('div', h('h1', 'Reports'), h('p', `Every number comes from your saved records · ${range.label}${st.role ? ' · ' + st.role : ''}`)),
      h('div.head-actions', btn('Weekly summary CSV', () => save(`jobhunt-weekly-${tag}.csv`, weeklyCsv()), { ico: 'download' }))),
    h('div.card', h('div.toolbar', h('div.grow', rangePicker(ctx, 'rep', () => ctx.refresh())), h('div', { style: { minWidth: '220px' } }, roleSel))),
    h('div.stat-row',
      stat('Jobs discovered', k.discovered), stat('Applications', k.submitted), stat('In progress', k.inProgress),
      stat('Interviews held', s.interviewsOffers.interviews.reduce((n, x) => n + x.value, 0)), stat('Offers', s.interviewsOffers.offers.reduce((n, x) => n + x.value, 0)),
      stat('Rejections', k.rejections), stat('Overdue tasks', overdue.length), stat('Follow-ups done', fu.pct == null ? '—' : `${fu.pct}%`)),
    h('div.dash-grid',
      card('Jobs discovered', `per ${s.unit}`, columnChart(s.weekly.discovered, { unit: s.unit, label: 'Jobs discovered' })),
      card('Applications submitted', `per ${s.unit}`, columnChart(s.weekly.applied, { unit: s.unit, color: 'var(--s2)', label: 'Applications' })),
      card('Interviews and offers', `per ${s.unit}`, lineChart([{ name: 'Interviews', color: 'var(--s1)', points: s.interviewsOffers.interviews }, { name: 'Offers', color: 'var(--s3)', points: s.interviewsOffers.offers }], { unit: s.unit, emptyText: 'No interviews or offers in this period.' })),
      card('Conversion rates', 'applications submitted in this period', h('div.table-wrap', { style: { border: 0 } }, h('table.data', h('thead', h('tr', h('th', 'Step'), h('th', 'Count'), h('th', 'Rate'))),
        h('tbody', conv.map((c) => h('tr', { style: { cursor: 'default' } }, h('td', c.label), h('td.num', `${c.num} of ${c.den}`), h('td.num', c.pct == null ? h('span.faint', 'No data') : `${c.pct}%`))))))),
      card('Applications by stage', 'current stage', barList(s.byStage, { color: 'var(--s2)', label: 'Applications', emptyText: 'No applications in this period.' })),
      card('Applications by target role', '', barList(s.appsByRole, { color: 'var(--s2)', label: 'Applications', emptyText: 'No applications in this period.' })),
      card('Applications by source platform', '', barList(s.appsByPlatform, { color: 'var(--s2)', label: 'Applications', emptyText: 'No applications in this period.' })),
      card('Jobs by source platform', 'discovered', barList(s.byPlatform, { label: 'Jobs' })),
      card('Follow-up completion', 'Follow-up tasks due in this period', fu.total ? h('div.stack.tight', h('div', { style: { fontSize: '28px', fontWeight: 600 } }, `${fu.pct}%`), h('div.muted', `${fu.done} of ${fu.total} follow-up tasks completed`),
        h('div', { style: { height: '8px', background: 'var(--card-2)', borderRadius: '4px', overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: `${fu.pct}%`, background: 'var(--good)' } }))) : h('p.faint', { style: { margin: 0 } }, 'No follow-up tasks in this period. Accept the follow-up suggestion when you mark an application Applied.')),
      card(`Overdue tasks (${overdue.length})`, 'right now', overdue.length ? h('div.task-list', overdue.slice(0, 8).map((t) => taskRow(ctx, t))) : h('p.faint', { style: { margin: 0 } }, 'Nothing overdue.')),
    ),
    h('div.card', h('div.card-head', h('h3', 'Export'), h('span.sub', 'CSV files open in Excel, Numbers or Google Sheets')),
      h('div.row',
        btn(`Jobs (${jobsIn.length})`, () => save(`jobhunt-jobs-${tag}.csv`, jobsCsv(jobsIn)), { ico: 'download' }),
        btn(`Applications (${appsIn.length})`, () => save(`jobhunt-applications-${tag}.csv`, appsCsv(appsIn)), { ico: 'download' }),
        btn(`All tasks (${m.tasks.length})`, () => save(`jobhunt-tasks-${fileStamp()}.csv`, tasksCsv(m.tasks)), { ico: 'download' }),
        btn('Weekly summary', () => save(`jobhunt-weekly-${tag}.csv`, weeklyCsv()), { ico: 'download' })),
      h('p.faint.small', { style: { margin: '10px 0 0' } }, `Jobs and applications follow the period and role above (applications by applied date). For a full backup use Settings.`)),
    icon ? null : null, fmtDay ? null : null);
}
