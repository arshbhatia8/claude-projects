import { h, icon, btn, pill } from '../dom.js';
import { kpis, rangeFor, calendarEvents } from '../../core/metrics.js';
import { attentionItems, suggestForStage, suggestForAssessment, suggestForInterview } from '../../core/suggestions.js';
import { EVENT_LABEL } from '../../core/mail.js';
import { applicationDialog, taskDialog, shortlistDialog, offerSuggestions, stageTone } from '../forms.js';
import { scoreBadge } from '../detail.js';
import { healthList } from './automation.js';
import { fmtDay, fmtClock, fmtTime, addDays, today, str, daysBetween } from '../../core/util.js';

export function rangePicker(ctx, key, onChange) {
  const st = ctx.ui[key] = ctx.ui[key] || { preset: '7d', from: '', to: '' };
  const presets = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['all', 'All time'], ['custom', 'Custom']];
  const from = h('input', { type: 'date', id: key + '-from', value: st.from, 'aria-label': 'From date', max: today() });
  const to = h('input', { type: 'date', id: key + '-to', value: st.to, 'aria-label': 'To date', max: today() });
  const apply = () => { st.from = from.value; st.to = to.value; if (st.from && st.to) onChange(); };
  from.addEventListener('change', apply); to.addEventListener('change', apply);
  return h('div.stack.tight',
    h('div.chips', { role: 'group', 'aria-label': 'Date range' }, presets.map(([v, l]) => h('button.chip', { type: 'button', 'aria-pressed': st.preset === v ? 'true' : 'false', onclick: () => { st.preset = v; if (v === 'custom' && !st.from) { st.from = addDays(today(), -13); st.to = today(); } onChange(); } }, l))),
    st.preset === 'custom' ? h('div.row', { style: { maxWidth: '420px' } }, h('div', { style: { flex: 1 } }, from), h('span.faint', 'to'), h('div', { style: { flex: 1 } }, to)) : null);
}
export const currentRange = (ctx, key) => { const st = ctx.ui[key] || { preset: '7d' }; return rangeFor(st.preset, st, ctx.model.ref); };

const TYPES = { interview: ['Interview', 'accent'], assessment: ['Assessment', 'warn'], deadline: ['Deadline', 'bad'], followup: ['Follow-up', 'info'], task: ['Task', 'good'] };

export default function dashboard(ctx) {
  const m = ctx.model;
  const range = currentRange(ctx, 'dash');
  const k = kpis(m, range);
  const go = (route, patch) => () => { if (patch) ctx.ui[route] = { ...(ctx.ui[route] || {}), ...patch }; ctx.go(route); };
  const kpi = (label, value, foot, onclick, tone) => h('button.kpi', { type: 'button', onclick },
    tone && value ? h('span.dot', { style: { background: `var(--${tone})` } }) : null,
    h('span.label', label), h('span.value', String(value)), h('span.foot', foot));
  const g = m.system.gmail || {};
  const d = m.system.discovery || {};
  const head = h('div.page-head',
    h('div', h('h1', 'Command Center'), h('p', `${fmtDay(m.ref, { weekday: true, year: true })} · Gmail ${g.lastSyncAt ? 'synced ' + ctx.relTime(g.lastSyncAt) : 'not synced yet'} · job search ${d.lastRunAt ? 'ran ' + ctx.relTime(d.lastRunAt) : 'has not reported since the upgrade'}`)),
    rangePicker(ctx, 'dash', () => ctx.refresh()));

  const grid = h('div.kpis.kpis-10',
    kpi('New jobs found', k.discovered, range.label, go('discover', { found: range.from ? '' : '', status: 'all' })),
    kpi('Relevant jobs', k.relevant, `score ≥ ${m.settings.automation.relevanceThreshold} · ${range.label.toLowerCase()}`, go('discover', { scoreMin: String(m.settings.automation.relevanceThreshold) })),
    kpi('Applications submitted', k.submitted, range.label, go('tracker', { stage: '' })),
    kpi('In progress', k.inProgress, 'applied, not closed', go('tracker', { stage: '__progress' })),
    kpi('Assessments pending', k.assessmentsPending, 'not done yet', go('tracker', { stage: 'Assessment Pending' }), 'warn'),
    kpi('Interviews scheduled', k.interviewsScheduled, 'today or later', go('calendar'), 'accent'),
    kpi('Follow-ups due', k.followUpsDue, 'today or overdue', go('tracker', { stage: '__followup' }), 'warn'),
    kpi('Overdue tasks', k.overdueTasks, 'past their due date', go('tasks', { view: 'overdue', userPicked: true }), 'bad'),
    kpi('Offers', k.offers, 'at Offer Received', go('tracker', { stage: 'Offer Received' }), 'good'),
    kpi('Rejections', k.rejections, 'at Rejected', go('tracker', { stage: 'Rejected' })),
  );

  // Needs attention
  const items = attentionItems(m).filter((x) => x.kind !== 'gmail').slice(0, 8);
  const overdue = m.tasks.filter((t) => t.status !== 'Completed' && t.dueDate && t.dueDate < m.ref).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const attention = h('div.card', h('div.card-head', h('h3', 'Needs attention'), h('span.sub', `${items.length + (k.needsReview ? 1 : 0) + (overdue.length ? 1 : 0)} item(s)`)),
    h('div.stack.tight',
      k.needsReview ? h('div.sub-item', h('div', h('b', `${k.needsReview} Gmail email${k.needsReview === 1 ? '' : 's'} to review`), h('div.small.muted', 'The app wasn’t sure which application they belong to.')), btn('Review', go('inbox'), { small: true, kind: 'primary' })) : null,
      overdue.length ? h('div.sub-item', h('div', h('b', `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`), h('div.small.muted', overdue.slice(0, 2).map((t) => t.title).join(' · '))), btn('Open', go('tasks', { view: 'overdue', userPicked: true }), { small: true })) : null,
      ...items.map((it) => attentionRow(ctx, it)),
      !items.length && !k.needsReview && !overdue.length ? h('p.faint', { style: { margin: 0 } }, 'Nothing needs you right now. Follow-ups, deadlines, interviews and flagged emails appear here.') : null));

  // Upcoming
  const upcoming = calendarEvents(m).filter((e) => !e.done && e.type !== 'task' && e.date >= m.ref && e.date <= addDays(m.ref, 14)).slice(0, 8);
  const upcomingCard = h('div.card', h('div.card-head', h('h3', 'Upcoming'), h('span.sub', 'next 14 days')),
    upcoming.length ? h('div.stack.tight', upcoming.map((e) => h('div.agenda-item', { class: `ev-${e.type}`, role: 'button', tabindex: '0', onclick: () => (e.appId ? ctx.openApp(e.appId) : e.jobId ? ctx.openJob(e.jobId) : null) },
      h('span.time', e.date === m.ref ? 'Today' : fmtDay(e.date, { weekday: true }).replace(/ \d{4}$/, ''), e.time ? h('div', fmtClock(e.time)) : null),
      h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 500, overflowWrap: 'anywhere' } }, e.title), h('div.small.faint', { style: { overflowWrap: 'anywhere' } }, e.sub)),
      pill(TYPES[e.type][0], TYPES[e.type][1])))) : h('p.faint', { style: { margin: 0 } }, 'No interviews, assessments, deadlines or follow-ups in the next two weeks.'));

  // Recent activity: Gmail updates, stage changes, new jobs.
  const feed = [];
  for (const e of m.mailEvents) {
    if (!e.result || e.result.status !== 'applied') continue;
    const app = m.appById[e.result.appId];
    feed.push({ at: e.receivedAt, kind: 'gmail', title: `${EVENT_LABEL[e.parsed && e.parsed.type] || 'Email'}: ${app ? app.company + ' · ' + app.title : e.result.company || ''}`, sub: e.result.action || '', open: app ? () => ctx.openApp(app.id) : null });
  }
  for (const a of m.apps) for (const hh of a.history || []) if (hh.type === 'stage' && hh.source !== 'gmail') feed.push({ at: hh.at, kind: 'stage', title: `${a.company} · ${a.title}`, sub: `You moved it ${hh.from} → ${hh.to}`, open: () => ctx.openApp(a.id) });
  const recentJobs = m.jobs.filter((j) => !j.hidden && j.foundDay && daysBetween(j.foundDay, m.ref) <= 3);
  const byDay = {};
  for (const j of recentJobs) byDay[j.foundDay] = (byDay[j.foundDay] || 0) + 1;
  for (const [day, n] of Object.entries(byDay)) feed.push({ at: day + 'T12:00:00+05:30', kind: 'jobs', title: `${n} job${n === 1 ? '' : 's'} discovered`, sub: day === m.ref ? 'today' : fmtDay(day, { weekday: true }), open: go('discover', { found: '3', status: 'all' }) });
  feed.sort((a, b) => str(b.at).localeCompare(str(a.at)));
  const activity = h('div.card', h('div.card-head', h('h3', 'Recent activity'), btn('Gmail updates', go('inbox'), { small: true, kind: 'ghost' })),
    feed.length ? h('div.stack.tight', feed.slice(0, 8).map((f) => h('div.sub-item', { style: { cursor: f.open ? 'pointer' : 'default' }, onclick: f.open || null },
      h('div', { style: { minWidth: 0 } }, h('div', { style: { overflowWrap: 'anywhere' } }, h('span', { style: { color: 'var(--fg-3)', marginRight: '6px' } }, icon(f.kind === 'gmail' ? 'mail' : f.kind === 'jobs' ? 'discover' : 'tracker', 14)), h('b', f.title)), h('div.small.muted', f.sub)),
      h('span.small.faint.nowrap', f.kind === 'jobs' ? '' : `${fmtDay(str(f.at).slice(0, 10))} ${fmtTime(f.at)}`)))) : h('p.faint', { style: { margin: 0 } }, 'No activity yet. New jobs and Gmail updates show up here.'));

  // Best matches
  const best = m.jobs.filter((j) => !j.hidden && !j.app && !j.meta.notRelevant && j.foundDay && daysBetween(j.foundDay, m.ref) <= 7 && j.fresh.verification !== 'Closed')
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 6);
  const bestCard = h('div.card', h('div.card-head', h('h3', 'Best new matches'), btn('All jobs', go('discover', { sort: 'match', status: 'all' }), { small: true, kind: 'ghost' })),
    best.length ? h('div.stack.tight', best.map((j) => h('div.sub-item', { style: { cursor: 'pointer' }, onclick: () => ctx.openJob(j.id) },
      h('div', { style: { minWidth: 0, display: 'flex', gap: '10px', alignItems: 'flex-start' } }, scoreBadge(j.score),
        h('div', { style: { minWidth: 0 } }, h('b', { style: { overflowWrap: 'anywhere' } }, j.title), h('div.small.muted', { style: { overflowWrap: 'anywhere' } }, `${j.company} · ${j.location || 'Location not stated'} · ${j.platform}`))),
      h('div.row', { onclick: (e) => e.stopPropagation() },
        j.meta.shortlisted ? pill('Shortlisted', 'accent') : btn('', () => shortlistDialog(ctx, j.id), { small: true, kind: 'ghost', ico: 'star', title: 'Shortlist' }),
        btn('Track', () => applicationDialog(ctx, { jobId: j.id }), { small: true }))))) : h('p.faint', { style: { margin: 0 } }, 'No new jobs in the last 7 days.'));

  const health = h('div.card', h('div.card-head', h('h3', 'Automation health'), btn('Details', go('automation'), { small: true, kind: 'ghost' })), healthList(ctx, { compact: true }));

  const empty = !m.jobs.length && !m.apps.length ? h('div.empty', icon('bolt', 30), h('h3', 'No jobs yet'),
    h('p', ctx.mode === 'cloud' ? 'Your scheduled job search adds openings here after its next run, and Gmail updates arrive once Gmail is connected. Nothing to upload.' : 'This browser-only copy does not receive the scheduled search or Gmail. Use the claude.ai version for automation.'),
    h('div.row', { style: { justifyContent: 'center' } }, btn('Gmail connection', go('inbox'), { kind: 'primary', ico: 'mail' }), btn('Automation status', go('automation'), { ico: 'bolt' }))) : null;
  return h('div.stack', { style: { gap: '22px' } }, head, empty, grid,
    h('div.dash-grid', h('div.col-7', attention), h('div.col-5', upcomingCard)),
    h('div.dash-grid', h('div.col-7', activity), h('div.col-5', bestCard)),
    health);
}

function attentionRow(ctx, it) {
  const m = ctx.model;
  const a = it.appId ? m.appById[it.appId] : null;
  let action = null;
  if (it.kind === 'followup' && !it.hasTask) action = btn('Plan follow-up', () => offerSuggestions(ctx, suggestForStage(a, 'Applied', m.settings).map((x) => ({ ...x, dueDate: m.ref, setFollowUp: undefined }))), { small: true });
  if (it.kind === 'assessment' && !it.hasTask) action = btn('Create task', () => offerSuggestions(ctx, suggestForAssessment(a, a.assessments.find((x) => x.id === it.itemId))), { small: true });
  if (it.kind === 'interview') action = btn('Plan prep', () => offerSuggestions(ctx, suggestForInterview(a, a.nextInterview)), { small: true });
  if (it.kind === 'nextaction') action = btn('Set', () => ctx.openApp(it.appId), { small: true, kind: 'ghost' });
  const open = () => (it.appId ? ctx.openApp(it.appId) : ctx.openJob(it.jobId));
  return h('div.sub-item', h('button', { type: 'button', onclick: open, style: { all: 'unset', cursor: 'pointer', minWidth: 0, display: 'grid', gap: '2px' } },
    h('span', { style: { fontWeight: 500, overflowWrap: 'anywhere' } }, h('span.stage-dot', { class: `d-${it.tone}`, style: { display: 'inline-block', marginRight: '8px', verticalAlign: '1px' } }), it.title),
    h('span.small.muted', it.text)), action || h('span'));
}
void stageTone; void taskDialog;
