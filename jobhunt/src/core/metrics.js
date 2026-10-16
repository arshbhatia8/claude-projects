// Dashboard and report numbers. Every figure is counted from stored records.
import { STAGES, IN_PROGRESS_STAGES } from './schema.js';
import { addDays, weekStart, monthStart, daysBetween, today, toDay, str } from './util.js';

/** {from, to} for a preset ('today' | '7d' | '30d' | '90d' | 'all') or a custom range. */
export function rangeFor(preset, custom = {}, ref = today()) {
  if (preset === 'today') return { from: ref, to: ref, label: 'Today' };
  if (preset === '7d') return { from: addDays(ref, -6), to: ref, label: 'Last 7 days' };
  if (preset === '30d') return { from: addDays(ref, -29), to: ref, label: 'Last 30 days' };
  if (preset === '90d') return { from: addDays(ref, -89), to: ref, label: 'Last 90 days' };
  if (preset === 'custom' && custom.from && custom.to) {
    const [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { from, to, label: `${from} to ${to}` };
  }
  return { from: null, to: null, label: 'All time' };
}
export const inRange = (day, r) => !!day && (!r || ((!r.from || day >= r.from) && (!r.to || day <= r.to)));

const reached = (a, stage) => a.stage === stage || (a.history || []).some((h) => h.type === 'stage' && h.to === stage);
const reachedDay = (a, stage) => {
  const h = (a.history || []).find((x) => x.type === 'stage' && x.to === stage);
  return h ? toDay(h.at) : a.stage === stage ? toDay(a.stageChangedAt || a.updatedAt) : '';
};
export const hadInterview = (a) => a.interviews.length > 0 || ['Interview Scheduled', 'Interview Completed', 'Offer Received'].some((s) => reached(a, s));
export const hadAssessment = (a) => a.assessments.length > 0 || reached(a, 'Assessment Pending');
export const hadOffer = (a) => reached(a, 'Offer Received');

export function kpis(model, range) {
  const ref = model.ref;
  const jobs = model.jobs.filter((j) => !j.hidden);
  const apps = model.apps;
  const awaiting = jobs.filter((j) => !j.app && !j.meta.reviewed && !j.meta.notRelevant && !j.meta.shortlisted && j.fresh.verification !== 'Closed');
  const interviews = apps.flatMap((a) => a.interviews.filter((i) => i.date && i.date >= ref && i.status !== 'Done' && i.status !== 'Cancelled'));
  const pendingAssess = apps.filter((a) => a.active).reduce((n, a) => n + (a.pendingAssessments.length || (a.stage === 'Assessment Pending' ? 1 : 0)), 0);
  return {
    discovered: jobs.filter((j) => inRange(j.foundDay, range)).length,
    discoveredAll: jobs.length,
    newToday: jobs.filter((j) => j.foundDay === ref).length,
    awaitingReview: awaiting.length,
    shortlisted: jobs.filter((j) => j.meta.shortlisted).length,
    submitted: apps.filter((a) => a.submitted && inRange(a.appliedOn || toDay(a.createdAt), range)).length,
    inProgress: apps.filter((a) => IN_PROGRESS_STAGES.includes(a.stage)).length,
    assessmentsPending: pendingAssess,
    interviewsScheduled: interviews.length,
    followUpsDue: apps.filter((a) => a.followUpDue).length,
    offers: apps.filter((a) => a.stage === 'Offer Received').length,
    rejections: apps.filter((a) => a.stage === 'Rejected').length,
    gmailApplied: jobs.filter((j) => !j.app && j.status === 'Applied').length,
    relevant: jobs.filter((j) => !j.meta.notRelevant && j.fresh.verification !== 'Closed' && (j.score ?? 0) >= (model.settings.automation.relevanceThreshold || 70) && inRange(j.foundDay, range)).length,
    overdueTasks: model.tasks.filter((t) => t.status !== 'Completed' && t.dueDate && t.dueDate < ref).length,
    needsReview: (model.mailEvents || []).filter((e) => e.result && e.result.status === 'review').length,
  };
}

/** Bucket keys (weeks, or months for long ranges) covering the range or the data. */
export function buckets(range, days, ref = today()) {
  let from = range && range.from, to = (range && range.to) || ref;
  if (!from) { const d = days.filter(Boolean).sort(); from = d[0] && d[0] < addDays(ref, -7 * 11) ? d[0] : addDays(ref, -7 * 11); }
  const span = daysBetween(from, to);
  const unit = span > 7 * 26 ? 'month' : 'week';
  const keys = [];
  if (unit === 'week') { for (let w = weekStart(from); w <= to; w = addDays(w, 7)) keys.push(w); }
  else { for (let m = monthStart(from); m <= to; m = monthStart(addDays(m, 32))) keys.push(m); }
  return { unit, keys, keyOf: (day) => (unit === 'week' ? weekStart(day) : monthStart(day)) };
}
function countBy(days, b) {
  const map = Object.fromEntries(b.keys.map((k) => [k, 0]));
  for (const d of days) { if (!d) continue; const k = b.keyOf(d); if (k in map) map[k]++; }
  return b.keys.map((k) => ({ key: k, value: map[k] }));
}

export function series(model, range) {
  const jobs = model.jobs.filter((j) => !j.hidden);
  const apps = model.apps;
  const appliedDays = apps.filter((a) => a.submitted).map((a) => a.appliedOn || toDay(a.createdAt));
  const foundDays = jobs.map((j) => j.foundDay);
  const doneDays = model.tasks.filter((t) => t.status === 'Completed').map((t) => toDay(t.completedAt));
  const b = buckets(range, [...appliedDays, ...foundDays], model.ref);
  const inR = (d) => inRange(d, range);
  const jobsIn = jobs.filter((j) => inR(j.foundDay));
  const appsIn = apps.filter((a) => inR(a.appliedOn || toDay(a.createdAt)) || (!a.submitted && inR(toDay(a.createdAt))));

  const tally = (list, key) => {
    const m = new Map();
    for (const x of list) m.set(x[key] || 'Other', (m.get(x[key] || 'Other') || 0) + 1);
    return [...m].map(([label, value]) => ({ label, value })).sort((a, c) => c.value - a.value);
  };
  const submittedIn = apps.filter((a) => a.submitted && inR(a.appliedOn || toDay(a.createdAt)));
  const funnel = [
    { label: 'Discovered', value: jobsIn.length },
    { label: 'Reviewed', value: jobsIn.filter((j) => j.meta.reviewed || j.meta.shortlisted || j.meta.notRelevant || j.app).length },
    { label: 'Shortlisted', value: jobsIn.filter((j) => j.meta.shortlisted || j.app).length },
    { label: 'Applied', value: submittedIn.length },
    { label: 'Assessment', value: submittedIn.filter(hadAssessment).length },
    { label: 'Interview', value: submittedIn.filter(hadInterview).length },
    { label: 'Offer', value: submittedIn.filter(hadOffer).length },
  ];
  const interviewDays = apps.flatMap((a) => a.interviews.map((i) => i.date)).filter((d) => d && d <= model.ref);
  const offerDays = apps.map((a) => reachedDay(a, 'Offer Received')).filter(Boolean);
  return {
    unit: b.unit,
    appsOverTime: countBy(appliedDays.filter(inR), b),
    weekly: {
      keys: b.keys,
      discovered: countBy(foundDays.filter(inR), b),
      applied: countBy(appliedDays.filter(inR), b),
      tasksDone: countBy(doneDays.filter(inR), b),
    },
    interviewsOffers: { interviews: countBy(interviewDays.filter(inR), b), offers: countBy(offerDays.filter(inR), b) },
    byStage: STAGES.map((s) => ({ label: s, value: appsIn.filter((a) => a.stage === s).length })).filter((x) => x.value),
    byPlatform: tally(jobsIn, 'platform'),
    byRole: tally(jobsIn, 'role'),
    appsByRole: tally(submittedIn, 'role'),
    appsByPlatform: tally(submittedIn, 'platform'),
    funnel,
  };
}

export function conversion(model, range) {
  const sub = model.apps.filter((a) => a.submitted && inRange(a.appliedOn || toDay(a.createdAt), range));
  const n = sub.length;
  const iv = sub.filter(hadInterview).length, of = sub.filter(hadOffer).length, rj = sub.filter((a) => a.stage === 'Rejected').length;
  const pct = (x, d) => (d ? Math.round((x / d) * 100) : null);
  return [
    { label: 'Applied → interview', num: iv, den: n, pct: pct(iv, n) },
    { label: 'Interview → offer', num: of, den: iv, pct: pct(of, iv) },
    { label: 'Applied → offer', num: of, den: n, pct: pct(of, n) },
    { label: 'Applied → rejected', num: rj, den: n, pct: pct(rj, n) },
  ];
}

export function followUpStats(model, range) {
  const fu = model.tasks.filter((t) => t.category === 'Follow-up' && inRange(t.dueDate || toDay(t.createdAt), range));
  const done = fu.filter((t) => t.status === 'Completed').length;
  return { total: fu.length, done, pct: fu.length ? Math.round((done / fu.length) * 100) : null };
}

// ---------- tasks ----------

export function taskBucket(t, ref = today()) {
  if (t.status === 'Completed') return 'completed';
  if (!t.dueDate) return 'nodate';
  if (t.dueDate < ref) return 'overdue';
  if (t.dueDate === ref) return 'today';
  return 'upcoming';
}
export function filterTasks(tasks, view, ref = today()) {
  const ws = weekStart(ref), we = addDays(ws, 6);
  const open = tasks.filter((t) => t.status !== 'Completed');
  const byDue = (a, b) => str(a.dueDate || '9999').localeCompare(str(b.dueDate || '9999')) || str(a.dueTime || '99').localeCompare(str(b.dueTime || '99')) || prio(b) - prio(a);
  const list = {
    today: open.filter((t) => t.dueDate === ref),
    upcoming: open.filter((t) => t.dueDate && t.dueDate > ref),
    overdue: open.filter((t) => t.dueDate && t.dueDate < ref),
    week: open.filter((t) => t.dueDate && t.dueDate >= ws && t.dueDate <= we),
    all: open,
    completed: tasks.filter((t) => t.status === 'Completed'),
  }[view] || open;
  return view === 'completed' ? list.sort((a, b) => str(b.completedAt).localeCompare(str(a.completedAt))) : list.sort(byDue);
}
const prio = (t) => ['Low', 'Medium', 'High', 'Urgent'].indexOf(t.priority);

// ---------- calendar ----------

/** Every dated item: interviews, assessments, deadlines, follow-ups, tasks. */
export function calendarEvents(model) {
  const ev = [];
  for (const a of model.apps) {
    const who = `${a.company} · ${a.title}`;
    for (const i of a.interviews) if (i.date) ev.push({ type: 'interview', date: i.date, time: i.time || '', title: `${i.round || 'Interview'}`, sub: who, appId: a.id, done: i.status === 'Done' || i.status === 'Cancelled' });
    for (const x of a.assessments) if (x.due) ev.push({ type: 'assessment', date: x.due, time: x.time || '', title: x.title || 'Assessment', sub: who, appId: a.id, done: x.status === 'Done' || x.status === 'Skipped' });
    if (a.followUpDate && a.active) ev.push({ type: 'followup', date: a.followUpDate, time: '', title: 'Follow up', sub: who, appId: a.id, done: false });
  }
  for (const j of model.jobs) {
    if (j.hidden || !j.fresh.deadline) continue;
    if (j.app && !['Discovered', 'To Review', 'Shortlisted', 'Ready to Apply'].includes(j.app.stage)) continue;
    if (j.meta.notRelevant) continue;
    ev.push({ type: 'deadline', date: j.fresh.deadline, time: '', title: 'Application deadline', sub: `${j.company} · ${j.title}`, jobId: j.id, done: false });
  }
  for (const t of model.tasks) if (t.dueDate) ev.push({ type: 'task', date: t.dueDate, time: t.dueTime || '', title: t.title, sub: t.company || '', taskId: t.id, done: t.status === 'Completed' });
  return ev.sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
}
