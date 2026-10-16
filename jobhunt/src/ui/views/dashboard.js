import { h, icon, btn, pill } from '../dom.js';
import { kpis, series, rangeFor, calendarEvents } from '../../core/metrics.js';
import { attentionItems } from '../../core/suggestions.js';
import { columnChart, barList, funnel, lineChart } from '../charts.js';
import { applicationDialog, taskDialog, interviewDialog } from '../forms.js';
import { suggestForStage, suggestForAssessment, suggestForInterview } from '../../core/suggestions.js';
import { fmtDay, fmtClock, addDays, today } from '../../core/util.js';
import { offerSuggestions } from '../forms.js';

export function rangePicker(ctx, key, onChange) {
  const st = ctx.ui[key] = ctx.ui[key] || { preset: '30d', from: '', to: '' };
  const presets = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time'], ['custom', 'Custom']];
  const from = h('input', { type: 'date', id: key + '-from', value: st.from, 'aria-label': 'From date', max: today() });
  const to = h('input', { type: 'date', id: key + '-to', value: st.to, 'aria-label': 'To date', max: today() });
  const apply = () => { st.from = from.value; st.to = to.value; if (st.from && st.to) onChange(); };
  from.addEventListener('change', apply); to.addEventListener('change', apply);
  return h('div.stack.tight',
    h('div.chips', { role: 'group', 'aria-label': 'Date range' }, presets.map(([v, l]) => h('button.chip', { type: 'button', 'aria-pressed': st.preset === v ? 'true' : 'false', onclick: () => { st.preset = v; if (v === 'custom' && !st.from) { st.from = addDays(today(), -13); st.to = today(); } onChange(); } }, l))),
    st.preset === 'custom' ? h('div.row', { style: { maxWidth: '420px' } }, h('div', { style: { flex: 1 } }, from), h('span.faint', 'to'), h('div', { style: { flex: 1 } }, to)) : null);
}
export const currentRange = (ctx, key) => { const st = ctx.ui[key] || { preset: '30d' }; return rangeFor(st.preset, st, ctx.model.ref); };

export default function dashboard(ctx) {
  const m = ctx.model;
  const range = currentRange(ctx, 'dash');
  const k = kpis(m, range);
  const s = series(m, range);
  const discover = (patch) => () => { ctx.ui.discover = { ...(ctx.ui.discover || {}), ...patch }; ctx.go('discover'); };
  const tracker = (stage) => () => { ctx.ui.tracker = { ...(ctx.ui.tracker || {}), stage }; ctx.go('tracker'); };
  const kpi = (label, value, foot, onclick, tone, hero) => h(`button.kpi${hero ? '.hero' : ''}`, { type: 'button', onclick: () => onclick && onclick() },
    tone ? h('span.dot', { style: { background: `var(--${tone})` } }) : null,
    h('span.label', label), h('span.value', hero ? h('span', String(value)) : String(value)), foot ? h('span.foot', foot) : null);

  const head = h('div.page-head',
    h('div', h('h1', 'Dashboard'), h('p', `${fmtDay(m.ref, { weekday: true, year: true })} · ${ctx.mode === 'cloud' ? 'live from your tracker database' : 'data in this browser'} · counts for ${range.label.toLowerCase()}`)),
    rangePicker(ctx, 'dash', () => ctx.refresh()));

  if (!m.jobs.length && !m.apps.length && !m.tasks.length) {
    return h('div.stack', head, h('div.empty', icon('bolt', 30), h('h3', 'No jobs yet'),
      h('p', ctx.mode === 'cloud'
        ? 'Your scheduled job search writes new openings here after each run. You can also import a CSV or JSON file, paste the tables from a search notification, or add a job by hand.'
        : 'Import a CSV or JSON file, paste the tables from a scheduled-search notification, or add a job by hand. This copy does not receive the scheduled search automatically.'),
      h('div.row', { style: { justifyContent: 'center' } }, btn('Import jobs', () => ctx.go('import'), { kind: 'primary', ico: 'import' }), btn('New task', () => taskDialog(ctx), { ico: 'tasks' }))));
  }

  const grid = h('div.kpis',
    kpi('Applications submitted', k.submitted, range.label, tracker(''), null, true),
    kpi('Jobs discovered', k.discovered, `${k.discoveredAll} in total`, discover({ preset: 'all' })),
    kpi('New today', k.newToday, 'found today', discover({ found: 'today' }), k.newToday ? 'accent' : null),
    kpi('Awaiting review', k.awaitingReview, 'not reviewed yet', discover({ status: 'new' }), k.awaitingReview ? 'warn' : null),
    kpi('Shortlisted', k.shortlisted, 'on your shortlist', () => ctx.go('shortlist')),
    kpi('In progress', k.inProgress, 'applied, not closed', tracker('__progress')),
    kpi('Assessments pending', k.assessmentsPending, 'not done yet', tracker('Assessment Pending'), k.assessmentsPending ? 'warn' : null),
    kpi('Interviews scheduled', k.interviewsScheduled, 'today or later', () => ctx.go('calendar'), k.interviewsScheduled ? 'info' : null),
    kpi('Follow-ups due', k.followUpsDue, 'today or overdue', tracker('__followup'), k.followUpsDue ? 'bad' : null),
    kpi('Offers', k.offers, 'at Offer Received', tracker('Offer Received'), k.offers ? 'good' : null),
    kpi('Rejections', k.rejections, 'at Rejected', tracker('Rejected')),
  );

  const items = attentionItems(m).slice(0, 8);
  const attention = h('div.card', h('div.card-head', h('h3', 'Needs your attention'), h('span.sub', items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : '')),
    items.length ? h('div.stack.tight', items.map((it) => attentionRow(ctx, it))) : h('p.faint', { style: { margin: 0 } }, 'Nothing urgent. Follow-ups, deadlines and interviews show up here when they are close.'));

  const upcoming = calendarEvents(m).filter((e) => !e.done && e.date >= m.ref && e.date <= addDays(m.ref, 7)).slice(0, 8);
  const agenda = h('div.card', h('div.card-head', h('h3', 'Next 7 days'), btn('Calendar', () => ctx.go('calendar'), { small: true, kind: 'ghost' })),
    upcoming.length ? h('div.stack.tight', upcoming.map((e) => h('div.agenda-item', { class: `ev-${e.type}`, onclick: () => (e.appId ? ctx.openApp(e.appId) : e.jobId ? ctx.openJob(e.jobId) : taskDialog(ctx, { id: e.taskId })) },
      h('span.time', e.date === m.ref ? 'Today' : fmtDay(e.date, { weekday: true }).replace(/ \d{4}$/, ''), e.time ? h('div', fmtClock(e.time)) : null),
      h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 500, overflowWrap: 'anywhere' } }, e.title), h('div.small.faint', { style: { overflowWrap: 'anywhere' } }, e.sub)),
      pill({ interview: 'Interview', assessment: 'Assessment', deadline: 'Deadline', followup: 'Follow-up', task: 'Task' }[e.type], { interview: 'accent', assessment: 'warn', deadline: 'bad', followup: 'info', task: 'good' }[e.type])))) : h('p.faint', { style: { margin: 0 } }, 'Nothing scheduled in the next week.'));

  const card = (title, sub, chart, cls) => h(`div.card.${cls}`, h('div.card-head', h('h3', title), sub ? h('span.sub', sub) : null), chart);
  const charts = h('div.dash-grid',
    card('Applications submitted', `per ${s.unit} · ${range.label}`, columnChart(s.appsOverTime, { unit: s.unit, label: 'Applications', emptyText: 'No applications submitted in this period.' }), 'col-7'),
    card('Application status', 'current stage', barList(s.byStage, { label: 'Applications', emptyText: 'No applications in this period.', onPick: (st) => tracker(st)() }), 'col-5'),
    card('Conversion funnel', range.label, funnel(s.funnel), 'col-6'),
    card('Weekly activity', range.label, lineChart([
      { name: 'Jobs discovered', color: 'var(--s1)', points: s.weekly.discovered },
      { name: 'Applications', color: 'var(--s2)', points: s.weekly.applied },
      { name: 'Tasks done', color: 'var(--s3)', points: s.weekly.tasksDone },
    ], { unit: s.unit }), 'col-6'),
    card('Jobs by platform', `discovered · ${range.label}`, barList(s.byPlatform, { label: 'Jobs', emptyText: 'No jobs discovered in this period.', onPick: (p) => discover({ platform: p, preset: range.from ? undefined : 'all' })() }), 'col-6'),
    card('Jobs by target role', `discovered · ${range.label}`, barList(s.byRole, { label: 'Jobs', emptyText: 'No jobs discovered in this period.', onPick: (r) => discover({ role: r })() }), 'col-6'),
  );
  return h('div.stack', { style: { gap: '22px' } }, head, grid, h('div.dash-grid', h('div.col-7', attention), h('div.col-5', agenda)), charts);
}

function attentionRow(ctx, it) {
  const m = ctx.model;
  const a = it.appId ? m.appById[it.appId] : null;
  let action = null;
  if (it.kind === 'gmail') action = btn('Add to tracker', () => applicationDialog(ctx, { jobId: it.jobId, stage: 'Applied' }), { small: true, kind: 'primary' });
  if (it.kind === 'followup' && !it.hasTask) action = btn('Plan follow-up', () => offerSuggestions(ctx, suggestForStage(a, 'Applied', m.settings).map((x) => ({ ...x, dueDate: m.ref, setFollowUp: undefined }))), { small: true });
  if (it.kind === 'assessment' && !it.hasTask) action = btn('Create task', () => offerSuggestions(ctx, suggestForAssessment(a, a.assessments.find((x) => x.id === it.itemId))), { small: true });
  if (it.kind === 'interview') action = btn('Plan prep', () => offerSuggestions(ctx, suggestForInterview(a, a.nextInterview)), { small: true });
  if (it.kind === 'nextaction') action = btn('Set', () => ctx.openApp(it.appId), { small: true, kind: 'ghost' });
  const open = () => (it.appId ? ctx.openApp(it.appId) : ctx.openJob(it.jobId));
  return h('div.sub-item', h('button', { type: 'button', onclick: open, style: { all: 'unset', cursor: 'pointer', minWidth: 0, display: 'grid', gap: '2px' } },
    h('span', { style: { fontWeight: 500, overflowWrap: 'anywhere' } }, h('span.stage-dot', { class: `d-${it.tone}`, style: { display: 'inline-block', marginRight: '8px', verticalAlign: '1px' } }), it.title),
    h('span.small.muted', it.text)), action || h('span'));
}
void interviewDialog;
