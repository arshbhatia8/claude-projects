// Task suggestions. These are offered to you; nothing here creates a task by itself.
import { addDays, today, str, daysBetween } from './util.js';

const base = (a) => ({ appId: a.id, jobId: a.jobId || '', company: a.company });

/** Suggestions after an application moves to `stage`. */
export function suggestForStage(a, stage, settings) {
  const days = Number(settings.defaults.followUpDays) || 7;
  const ref = today();
  const out = [];
  if (stage === 'Applied') {
    const due = addDays(a.appliedOn || ref, days);
    out.push({ ...base(a), title: `Follow up with ${a.company} on ${a.title}`, category: 'Follow-up', priority: 'Medium', dueDate: due < ref ? ref : due, setFollowUp: due < ref ? ref : due });
  }
  if (stage === 'Interview Scheduled') {
    const iv = (a.interviews || []).filter((i) => i.date >= ref && i.status !== 'Done').sort((x, y) => x.date.localeCompare(y.date))[0];
    out.push(...suggestForInterview(a, iv || { round: 'interview', date: '' }));
  }
  if (stage === 'Assessment Pending') {
    const as = (a.assessments || []).find((x) => x.status !== 'Done');
    out.push({ ...base(a), title: `Complete ${as ? as.title : 'the assessment'} for ${a.company}`, category: 'Assessment', priority: 'High', dueDate: (as && as.due) || ref });
  }
  if (stage === 'Interview Completed') out.push({ ...base(a), title: `Send a thank-you note to ${a.company}`, category: 'Thank-you', priority: 'Medium', dueDate: ref });
  if (stage === 'Offer Received') out.push({ ...base(a), title: `Review the offer from ${a.company}`, category: 'Other', priority: 'High', dueDate: addDays(ref, 2) });
  if (stage === 'Ready to Apply') out.push({ ...base(a), title: `Tailor resume and apply to ${a.company}`, category: 'Resume', priority: 'High', dueDate: addDays(ref, 1) });
  return out;
}

export function suggestForInterview(a, iv) {
  const ref = today();
  const before = iv.date ? addDays(iv.date, -1) : ref;
  const round = iv.round || 'interview';
  return [
    { ...base(a), title: `Research ${a.company} before the ${round}`, category: 'Research', priority: 'High', dueDate: before < ref ? ref : before },
    { ...base(a), title: `Prepare for ${round} at ${a.company}`, category: 'Interview prep', priority: 'High', dueDate: before < ref ? ref : before, dueTime: '' },
    ...(iv.date ? [{ ...base(a), title: `Send a thank-you email after the ${round}`, category: 'Thank-you', priority: 'Medium', dueDate: addDays(iv.date, 1) }] : []),
  ];
}

export function suggestForAssessment(a, as) {
  return [{ ...base(a), title: `Complete “${as.title}” for ${a.company}`, category: 'Assessment', priority: as.due && daysBetween(today(), as.due) <= 2 ? 'Urgent' : 'High', dueDate: as.due || today(), dueTime: as.time || '' }];
}

/** Things worth your attention now, shown on the dashboard. Each one links to an action. */
export function attentionItems(model) {
  const ref = model.ref;
  const openTasks = model.tasks.filter((t) => t.status !== 'Completed');
  const hasTask = (appId, cat) => openTasks.some((t) => t.appId === appId && (!cat || t.category === cat));
  const items = [];
  for (const j of model.jobs) {
    if (j.hidden || j.app || j.status !== 'Applied') continue;
    items.push({ kind: 'gmail', tone: 'info', jobId: j.id, title: `${j.company}: ${j.title}`, text: `Your job search found an application confirmation${j.appliedOn ? ' from ' + j.appliedOn : ''}. Add it to the tracker?` });
  }
  for (const a of model.apps) {
    if (a.followUpDue) items.push({ kind: 'followup', tone: 'warn', appId: a.id, title: `${a.company}: ${a.title}`, text: `Follow-up ${a.followUpDate === ref ? 'due today' : 'overdue since ' + a.followUpDate}`, hasTask: hasTask(a.id, 'Follow-up') });
    for (const x of a.pendingAssessments) {
      if (!x.due) continue;
      const d = daysBetween(ref, x.due);
      if (d <= 3) items.push({ kind: 'assessment', tone: d < 0 ? 'bad' : 'warn', appId: a.id, itemId: x.id, title: `${a.company}: ${x.title}`, text: d < 0 ? `Assessment deadline passed on ${x.due}` : d === 0 ? 'Assessment due today' : `Assessment due in ${d} day${d === 1 ? '' : 's'}`, hasTask: hasTask(a.id, 'Assessment') });
    }
    if (a.nextInterview && daysBetween(ref, a.nextInterview.date) <= 3 && !hasTask(a.id, 'Interview prep')) {
      items.push({ kind: 'interview', tone: 'info', appId: a.id, itemId: a.nextInterview.id, title: `${a.company}: ${a.nextInterview.round}`, text: `Interview ${a.nextInterview.date === ref ? 'today' : 'on ' + a.nextInterview.date}${a.nextInterview.time ? ' at ' + a.nextInterview.time : ''}. No prep task yet.` });
    }
    if (a.active && !['Offer Received'].includes(a.stage) && !str(a.nextAction) && !['Discovered', 'To Review'].includes(a.stage)) {
      items.push({ kind: 'nextaction', tone: 'muted', appId: a.id, title: `${a.company}: ${a.title}`, text: 'No next action set' });
    }
  }
  for (const j of model.jobs) {
    if (j.hidden || j.meta.notRelevant || (j.app && !['Discovered', 'To Review', 'Shortlisted', 'Ready to Apply'].includes(j.app.stage))) continue;
    const dl = j.fresh.deadline;
    if (dl && dl >= ref && daysBetween(ref, dl) <= 3) items.push({ kind: 'deadline', tone: 'warn', jobId: j.id, title: `${j.company}: ${j.title}`, text: `Apply by ${dl}` });
  }
  const order = { bad: 0, warn: 1, info: 2, muted: 3 };
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}
