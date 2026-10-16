// The automation engine. Given the stored data, it works out what to change and returns ops;
// it never writes by itself, so it can be tested and re-run safely (every step is idempotent).
//   1. Gmail events  → match to an application/job → status, dates, history, tasks (or "needs review")
//   2. Job records   → merge certain duplicates (same listing, same requisition, same company/title/place)
//   3. Best matches  → a "review this job" task for strong new matches
import { classifyEmail, EVENT_LABEL } from './mail.js';
import { buildModel } from './model.js';
import { normCompany, normTitle, titleSimilarity, normReq, normUrl, duplicatePairs } from './dedupe.js';
import { STAGES, ENDED_STAGES, isSubmittedStage, mergeSettings } from './schema.js';
import { addDays, toDay, str, now, daysBetween, fmtDay } from './util.js';

export const HIRING = ['applied', 'assessment', 'interview', 'reschedule', 'rejection', 'offer', 'info_request'];
const TARGET = { applied: 'Applied', assessment: 'Assessment Pending', interview: 'Interview Scheduled', reschedule: 'Interview Scheduled', rejection: 'Rejected', offer: 'Offer Received' };
const RANK = { Discovered: 0, 'To Review': 1, Shortlisted: 2, 'Ready to Apply': 3, Applied: 4, 'Follow-up Required': 4, 'Assessment Pending': 5, 'Interview Scheduled': 6, 'Interview Completed': 7, 'Offer Received': 9, Rejected: 10, Withdrawn: 10, Closed: 10 };
const cap = (a, n) => (a.length > n ? a.slice(a.length - n) : a);
const short = (s, n = 120) => { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function companyMatches(a, b) {
  const x = normCompany(a), y = normCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const cx = x.replace(/\s/g, ''), cy = y.replace(/\s/g, '');
  if (cx === cy) return true;
  const [fx] = x.split(' '), [fy] = y.split(' ');
  // "Razorpay" vs "Razorpay Software"; "PayU" vs "PayU Payments". Short first words must match exactly.
  return (fx === fy && fx.length >= 4) || (cx.length >= 5 && cy.startsWith(cx)) || (cy.length >= 5 && cx.startsWith(cy));
}
const LEVELS = ['associate', 'assistant', 'senior', 'junior', 'lead', 'principal', 'staff', 'head', 'intern', 'trainee', 'chief', 'vp', 'director', '1', '2', '3'];
export function roleMatches(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // "Product Manager" is not "Associate Product Manager": level words must agree.
  const lv = (t) => LEVELS.filter((w) => new RegExp(`\\b${w}\\b`).test(t)).sort().join(',');
  const sameLevel = lv(x) === lv(y);
  let s = x.includes(y) || y.includes(x) ? 0.85 : titleSimilarity(x, y);
  if (!sameLevel) s = Math.min(s, 0.4);
  return s;
}

/** Merges the page's own reading of an email with the scheduled reader's hint (if any). */
export function interpret(ev) {
  // Already read once (the body is dropped after processing): reuse that reading.
  if (!ev.excerpt && ev.parsed && ev.parsed.type) return { reasons: [], ...ev.parsed, source: ev.parsed.source || 'rules' };
  const det = classifyEmail({ from: ev.from, subject: ev.subject, snippet: ev.snippet, excerpt: ev.excerpt, receivedAt: ev.receivedAt });
  const hint = ev.hint && typeof ev.hint === 'object' ? ev.hint : null;
  const out = { ...det, source: 'rules' };
  if (!hint || !hint.type) return out;
  const ht = String(hint.type);
  const hiring = (t) => HIRING.includes(t);
  if (det.type === ht || (!hiring(det.type) && !hiring(ht))) {
    // Both agree on what it is. The scheduled reader saw the whole email, so its names win; the rules' dates fill gaps.
    if (hint.company) out.company = str(hint.company);
    if (hint.role) out.role = str(hint.role);
    for (const k of ['requisitionId', 'deadline', 'deadlineTime', 'interviewDate', 'interviewTime']) if (!out[k] && hint[k]) out[k] = str(hint[k]);
    if (det.type === ht && hint.company) out.confidence = Math.min(0.97, Math.max(out.confidence, 0.6) + 0.15);
    if (Array.isArray(hint.items)) out.items = hint.items;
    return out;
  }
  if (hiring(det.type) && !hiring(ht) && Number(hint.confidence || 0) >= 0.8) {
    // The rules saw a hiring phrase, but the reader (full email) says it isn't one: e.g. a newsletter quoting a rejection.
    return { ...out, readerSaysNotHiring: true, readerType: ht, company: str(hint.company) || out.company };
  }
  if (!hiring(det.type) && det.type !== 'marketing' && hiring(ht) && Number(hint.confidence || 0) >= 0.75) {
    // The rules found nothing; the scheduled reader (Claude) did. Trust it only for a clear match later.
    return { ...out, type: ht, company: str(hint.company) || det.company, role: str(hint.role) || det.role, requisitionId: str(hint.requisitionId) || det.requisitionId,
      deadline: str(hint.deadline), deadlineTime: str(hint.deadlineTime), interviewDate: str(hint.interviewDate), interviewTime: str(hint.interviewTime),
      confidence: Math.min(0.7, Number(hint.confidence)), source: 'scheduled reader', needsExistingMatch: true };
  }
  return { ...out, conflict: `The page’s rules read this as “${EVENT_LABEL[det.type] || det.type}” but the scheduled reader read it as “${EVENT_LABEL[ht] || ht}”` };
}

/** Finds which application (or job) an event is about. */
export function matchEvent(p, apps, jobs) {
  if (!p.company) return { kind: 'review', reason: 'The email does not name the company clearly' };
  const reqN = normReq(p.requisitionId);
  const atCo = apps.filter((a) => companyMatches(a.company, p.company));
  if (reqN) {
    const r = atCo.filter((a) => normReq(a.requisitionId) === reqN);
    if (r.length === 1) return { kind: 'app', app: r[0], how: `requisition ${p.requisitionId}` };
  }
  if (p.role) {
    const scored = atCo.map((a) => ({ a, s: roleMatches(a.title, p.role) })).filter((x) => x.s >= 0.6).sort((x, y) => y.s - x.s);
    if (scored.length === 1 || (scored.length > 1 && scored[0].s === 1 && scored[1].s < 1)) return { kind: 'app', app: scored[0].a, how: 'company and role' };
    if (scored.length > 1) return { kind: 'review', reason: `Matches ${scored.length} of your applications at ${p.company}`, candidates: scored.map((x) => x.a.id) };
  } else {
    const live = atCo.filter((a) => !ENDED_STAGES.includes(a.stage));
    if (live.length === 1 && atCo.length === 1) return { kind: 'app', app: live[0], how: 'company (your only application there)' };
    if (atCo.length > 1) return { kind: 'review', reason: `The email doesn’t name the role and you have ${atCo.length} applications at ${p.company}`, candidates: atCo.map((a) => a.id) };
  }
  if (p.needsExistingMatch) return { kind: 'review', reason: 'Only the scheduled reader recognised this email, and it did not match one application clearly' };
  // No application yet: look for the job.
  const jc = jobs.filter((j) => !j.hidden && companyMatches(j.company, p.company));
  if (reqN) { const r = jc.filter((j) => normReq(j.requisitionId) === reqN); if (r.length === 1) return { kind: 'job', job: r[0], how: `requisition ${p.requisitionId}` }; }
  if (!p.role) {
    if (atCo.length === 1) return { kind: 'review', reason: `The email doesn’t name the role; your application at ${p.company} is already closed` , candidates: [atCo[0].id] };
    return { kind: 'review', reason: `The email names ${p.company} but not the role`, candidates: jc.map((j) => 'job:' + j.id).slice(0, 5) };
  }
  const js = jc.map((j) => ({ j, s: roleMatches(j.title, p.role) })).filter((x) => x.s >= 0.6).sort((x, y) => y.s - x.s);
  if (js.length === 1 || (js.length > 1 && js[0].s === 1 && js[1].s < 1)) return { kind: 'job', job: js[0].j, how: 'company and role' };
  if (js.length > 1) return { kind: 'review', reason: `Matches ${js.length} jobs at ${p.company}`, candidates: js.map((x) => 'job:' + x.j.id) };
  return { kind: 'new', how: 'company and role from the email' };
}

/**
 * Plans everything the automation should change right now.
 * Returns {ops, counts, log}. `nowIso` is the processing time.
 */
export function planAutomation(state, { nowIso = now().toISOString(), by = 'page', maxEvents = 200 } = {}) {
  const ref = toDay(nowIso);
  const model = buildModel(state, ref);
  const settings = model.settings;
  const auto = settings.automation;
  const ops = [];
  const counts = { events: 0, applied: 0, review: 0, ignored: 0, created: 0, tasks: 0, merged: 0, reviewTasks: 0 };
  const log = [];
  // Working copies so later events see earlier changes.
  const apps = new Map(model.apps.map((a) => [a.id, { ...state.applications.get(a.id), id: a.id }]));
  const touched = new Set();
  const taskIds = new Set([...state.tasks.keys()]);
  const jobsById = model.jobById;

  const followUps = new Set();
  const hasOpenFollowUp = (appId) => followUps.has(appId) || [...state.tasks.values()].some((t) => t.appId === appId && t.category === 'Follow-up' && t.status !== 'Completed');
  const addTask = (id, t, list) => {
    if (!auto.autoTasks || taskIds.has(id)) return;
    taskIds.add(id);
    ops.push({ op: 'set', coll: 'tasks', id, data: { title: t.title, description: t.description || '', company: t.company || '', jobId: t.jobId || '', appId: t.appId || '', priority: t.priority || 'Medium', dueDate: t.dueDate || '', dueTime: t.dueTime || '', status: 'To Do', category: t.category || 'Other', notes: '', dueKind: t.dueKind || (t.dueDate ? 'suggested' : 'none'), source: t.source || {}, origin: 'auto', createdAt: nowIso, updatedAt: nowIso, completedAt: '' } });
    counts.tasks++;
    list && list.push(id);
  };

  // ---------- 1. Gmail events ----------
  const events = [...state.mailEvents].map(([id, e]) => ({ id, ...e }))
    .filter((e) => !e.result || (e.result.status === 'review' && e.resolution && !e.resolution.doneAt))
    .sort((a, b) => str(a.receivedAt).localeCompare(str(b.receivedAt)))
    .slice(0, maxEvents);

  for (const ev of events) {
    counts.events++;
    const p = interpret(ev);
    const res = { at: nowIso, by, type: p.type, company: p.company, role: p.role, confidence: p.confidence, source: p.source, tasks: [] };
    const evDay = toDay(ev.receivedAt) || ref;
    const label = EVENT_LABEL[p.type] || p.type;
    let m;
    const resolution = ev.resolution && !ev.resolution.doneAt ? ev.resolution : null;
    if (resolution) {
      if (resolution.action === 'ignore') m = { kind: 'ignore', reason: 'You marked it as not relevant' };
      else if (resolution.action === 'app' && apps.get(resolution.appId)) m = { kind: 'app', app: apps.get(resolution.appId), how: 'chosen by you' };
      else if (resolution.action === 'job' && jobsById[resolution.jobId]) m = { kind: 'job', job: jobsById[resolution.jobId], how: 'chosen by you' };
      else if (resolution.action === 'new') m = { kind: 'new', how: 'created by you' };
      else m = { kind: 'review', reason: 'The record you chose no longer exists' };
      if (resolution.type && HIRING.includes(resolution.type)) p.type = resolution.type;
      if (resolution.company) p.company = resolution.company;
      if (resolution.role) p.role = resolution.role;
    } else if (p.readerSaysNotHiring) {
      const live = p.company ? [...apps.values()].filter((a) => companyMatches(a.company, p.company) && !ENDED_STAGES.includes(a.stage)) : [];
      if (live.length && ['rejection', 'offer', 'interview'].includes(p.type)) m = { kind: 'review', reason: `Looks like a ${EVENT_LABEL[p.type].toLowerCase()} for ${p.company}, but the full email reads as ${EVENT_LABEL[p.readerType] || p.readerType}. Please check.`, candidates: live.map((a) => a.id) };
      else m = { kind: 'ignore', reason: `Read in full by the scheduled sync: ${EVENT_LABEL[p.readerType] || p.readerType}, not a hiring update` };
    } else if (!HIRING.includes(p.type)) {
      if (p.type === 'recruiter' && p.company) {
        const mm = matchEvent(p, [...apps.values()], model.jobs);
        if (mm.kind === 'app') m = { kind: 'activity', app: mm.app, how: mm.how };
      }
      if (!m) m = { kind: 'ignore', reason: p.type === 'recruiter' ? 'Recruiter outreach is not evidence of an application' : (p.reasons[0] || `Not a hiring update (${label})`) };
    } else if (p.conflict) m = { kind: 'review', reason: p.conflict };
    else if (p.confidence < auto.minConfidence) m = { kind: 'review', reason: `Not sure enough (${Math.round(p.confidence * 100)}%) about what this email means` };
    else if (p.digestCount > 1 && !(p.items && p.items.length)) m = { kind: 'review', reason: `This email confirms ${p.digestCount} applications but doesn’t list them clearly. Add them from the email.` };
    else if (p.items && p.items.length > 1 && p.type === 'applied') m = { kind: 'items' };
    else m = matchEvent(p, [...apps.values()], model.jobs);

    if (m.kind === 'items') {
      // One email confirming several applications: handle each listed job on its own.
      const done = [];
      for (let i = 0; i < p.items.length; i++) {
        const it = p.items[i] || {};
        const sub = { ...p, company: str(it.company), role: str(it.role), items: null };
        const mm = matchEvent(sub, [...apps.values()], model.jobs);
        if (mm.kind === 'review') { done.push(`${sub.company || '?'} · ${sub.role || '?'}: needs review`); continue; }
        let app = mm.app ? apps.get(mm.app.id) : null;
        if (!app) {
          const job = mm.kind === 'job' ? state.jobs.get(mm.job.id) : null;
          const id = `app_m_${ev.id}_${i}`;
          app = { id, jobId: job ? mm.job.id : '', company: (job && job.company) || sub.company, title: (job && job.title) || sub.role, location: (job && job.location) || '', jobUrl: (job && job.link) || '', applicationUrl: '', requisitionId: '', source: (job && job.source) || '', stage: 'Applied', appliedOn: evDay,
            resumeVersion: '', documents: '', recruiter: { name: '', email: '', phone: '', linkedin: '' }, referral: '', assessments: [], interviews: [], followUpDate: '', expectedComp: '', offeredComp: '', notes: '', nextAction: '', priority: '',
            history: [{ at: nowIso, type: 'created', to: 'Applied', source: 'gmail', messageId: ev.id + '#' + i, text: `${label} from Gmail: “${short(ev.subject)}” (${mm.how})` }],
            createdAt: nowIso, updatedAt: nowIso, stageChangedAt: nowIso, stageSource: 'gmail', stageEvidence: { messageId: ev.id, receivedAt: ev.receivedAt, type: 'applied' }, lastActivityAt: ev.receivedAt, lastActivity: label, origin: 'gmail' };
          apps.set(id, app); counts.created++;
        } else if (!(app.history || []).some((h) => h.messageId === ev.id + '#' + i)) {
          applyEvent(app, sub, { ...ev, id: ev.id + '#' + i }, { nowIso, evDay, label, how: mm.how });
        }
        touched.add(app.id);
        done.push(`${app.company} · ${app.title}`);
        const fu = Number(settings.defaults.followUpDays) || 0;
        if (fu > 0 && app.stage === 'Applied' && !hasOpenFollowUp(app.id)) {
          const due = addDays(app.appliedOn || evDay, fu);
          if (!app.followUpDate) app.followUpDate = due < ref ? ref : due;
          addTask(`auto-fu-${ev.id}-${i}`, { company: app.company, appId: app.id, jobId: app.jobId, source: { kind: 'gmail', messageId: ev.id, type: 'applied' }, title: `Follow up with ${app.company} on ${app.title}`, category: 'Follow-up', dueDate: app.followUpDate, dueKind: 'suggested', description: `Suggested by your ${fu}-day follow-up rule.` }, res.tasks);
          followUps.add(app.id);
        }
      }
      Object.assign(res, { status: 'applied', action: `${p.items.length} applications`, reason: done.join('; ') });
      counts.applied++;
    } else if (m.kind === 'ignore') {
      Object.assign(res, { status: 'ignored', reason: m.reason });
      counts.ignored++;
    } else if (m.kind === 'review') {
      Object.assign(res, { status: 'review', reason: m.reason, candidates: m.candidates || [] });
      counts.review++;
    } else {
      // Resolve the application this event belongs to (creating it when the evidence allows).
      let app = m.app ? apps.get(m.app.id) : null;
      let created = false;
      if (m.kind === 'job' || m.kind === 'new') {
        if (p.type === 'info_request' || !p.role && m.kind === 'new') {
          Object.assign(res, { status: 'review', reason: 'Not enough detail to start a new application from this email' });
          counts.review++;
        } else {
          const job = m.kind === 'job' ? state.jobs.get(m.job.id) : null;
          const id = 'app_m_' + ev.id;
          const target = TARGET[p.type] || 'Applied';
          app = {
            id, jobId: m.kind === 'job' ? m.job.id : '', company: (job && job.company) || p.company, title: (job && job.title) || p.role,
            location: (job && job.location) || '', jobUrl: (job && job.link) || '', applicationUrl: (job && job.applyUrl) || '', requisitionId: p.requisitionId || (job && job.requisitionId) || '',
            source: (job && job.source) || '', stage: target, appliedOn: p.type === 'applied' ? evDay : '',
            resumeVersion: '', documents: '', recruiter: { name: '', email: '', phone: '', linkedin: '' }, referral: '', assessments: [], interviews: [],
            followUpDate: '', expectedComp: '', offeredComp: '', notes: '', nextAction: '', priority: (state.jobMeta.get(m.kind === 'job' ? m.job.id : '') || {}).priority || '',
            history: [{ at: nowIso, type: 'created', to: target, source: 'gmail', messageId: ev.id, text: `${label} from Gmail: “${short(ev.subject)}” (${m.how})` }],
            createdAt: nowIso, updatedAt: nowIso, stageChangedAt: nowIso, stageSource: 'gmail', stageEvidence: { messageId: ev.id, receivedAt: ev.receivedAt, type: p.type },
            lastActivityAt: ev.receivedAt, lastActivity: label, origin: 'gmail',
          };
          if (p.type !== 'applied') app.history.push({ at: nowIso, type: 'gmail', messageId: ev.id + ':note', text: 'Applied date unknown: the first email found was not an application confirmation' });
          apps.set(id, app); touched.add(id); created = true; counts.created++;
        }
      }
      if (app) {
        const already = (app.history || []).some((h) => h.messageId === ev.id) && !created;
        if (already) {
          Object.assign(res, { status: 'applied', action: 'already recorded', appId: app.id, reason: 'This email was already applied to the application' });
        } else {
          const action = applyEvent(app, p, ev, { nowIso, evDay, label, how: m.how, activityOnly: m.kind === 'activity', created, settings, chosen: !!resolution });
          touched.add(app.id);
          Object.assign(res, { status: 'applied', action: action.text, appId: app.id, jobId: app.jobId || '', reason: action.reason || m.how });
          if (action.conflict) { res.status = 'review'; res.reason = action.conflict; res.candidates = [app.id]; counts.review++; }
          else counts.applied++;
          // Tasks (deterministic ids, created once per email)
          if (!action.conflict && !action.stale) {
            const base = { company: app.company, appId: app.id, jobId: app.jobId, source: { kind: 'gmail', messageId: ev.id, type: p.type } };
            const fu = Number(settings.defaults.followUpDays) || 0;
            if (p.type === 'applied' && fu > 0 && app.stage === 'Applied' && !hasOpenFollowUp(app.id)) {
              followUps.add(app.id);
              const due = addDays(app.appliedOn || evDay, fu);
              if (!app.followUpDate) app.followUpDate = due < ref ? ref : due;
              addTask('auto-fu-' + ev.id, { ...base, title: `Follow up with ${app.company} on ${app.title}`, category: 'Follow-up', dueDate: app.followUpDate, dueKind: 'suggested', description: `Suggested by your ${fu}-day follow-up rule. Applied ${app.appliedOn || 'date unknown'}.` }, res.tasks);
            }
            if (p.type === 'assessment') {
              const soon = p.deadline && daysBetween(ref, p.deadline) <= 2;
              addTask('auto-as-' + ev.id, { ...base, title: `Complete the assessment for ${app.company}${p.deadline ? '' : ' (deadline not stated)'}`, category: 'Assessment', priority: soon ? 'Urgent' : 'High', dueDate: p.deadline || '', dueTime: p.deadlineTime || '', dueKind: p.deadline ? 'confirmed' : 'none', description: p.deadlinePhrase ? `From the email: “${p.deadlinePhrase}”` : 'The email gives no deadline. Check it.' }, res.tasks);
            }
            if (p.type === 'interview') {
              const d = p.interviewDate;
              addTask('auto-prep-' + ev.id, { ...base, title: `Prepare for the ${app.company} interview${d ? '' : ' (date not stated)'}`, category: 'Interview prep', priority: 'High', dueDate: d ? (addDays(d, -1) < ref ? ref : addDays(d, -1)) : '', dueKind: d ? 'suggested' : 'none', description: d ? `Interview on ${fmtDay(d, { weekday: true })}${p.interviewTime ? ' at ' + p.interviewTime + ' IST' : ''}.` : 'Reply with your availability if the email asks for it.' }, res.tasks);
              if (d) addTask('auto-ty-' + ev.id, { ...base, title: `Send a thank-you note after the ${app.company} interview`, category: 'Thank-you', dueDate: addDays(d, 1), dueKind: 'suggested' }, res.tasks);
            }
            if (p.type === 'offer') addTask('auto-offer-' + ev.id, { ...base, title: `Review the offer from ${app.company}`, category: 'Other', priority: 'High', dueDate: addDays(ref, 2), dueKind: 'suggested' }, res.tasks);
            if (p.type === 'info_request') addTask('auto-info-' + ev.id, { ...base, title: `Reply to ${app.company}’s request for information`, category: 'Follow-up', priority: 'High', dueDate: addDays(evDay, 1) < ref ? ref : addDays(evDay, 1), dueKind: 'suggested', description: `Email: “${short(ev.subject, 90)}”` }, res.tasks);
            if (p.type === 'rejection') {
              for (const [tid, t] of state.tasks) {
                if (t.appId === app.id && t.origin === 'auto' && t.status !== 'Completed' && /^auto-(fu|prep|as|info)-/.test(tid)) {
                  ops.push({ op: 'merge', coll: 'tasks', id: tid, data: { status: 'Completed', completedAt: nowIso, updatedAt: nowIso, notes: 'Closed automatically: the application was rejected.' } });
                }
              }
            }
          }
        }
      }
    }
    // Mark the email processed, keep only what explains the decision, drop the body excerpt.
    // Keep the body excerpt only while you still need to review the email.
    const data = { result: res, parsed: { type: p.type, company: p.company, role: p.role, requisitionId: p.requisitionId, deadline: p.deadline, deadlineTime: p.deadlineTime || '', deadlinePhrase: p.deadlinePhrase || '', interviewDate: p.interviewDate, interviewTime: p.interviewTime, confidence: p.confidence, evidence: short(p.evidence, 120), source: p.source } };
    if (res.status !== 'review') data.excerpt = '';
    if (resolution) data.resolution = { ...resolution, doneAt: nowIso };
    ops.push({ op: 'merge', coll: 'mailEvents', id: ev.id, data });
    log.push(`${ev.id}: ${res.status}${res.reason ? ' — ' + res.reason : ''}`);
  }

  for (const id of touched) {
    const a = apps.get(id);
    const { id: _id, ...doc } = a;
    ops.push({ op: state.applications.has(id) ? 'merge' : 'set', coll: 'applications', id, data: doc });
    if (a.jobId && state.jobs.has(a.jobId) && isSubmittedStage(a.stage)) {
      const j = state.jobs.get(a.jobId);
      if (j.status !== 'Applied' && j.statusSource !== 'You') ops.push({ op: 'merge', coll: 'jobs', id: a.jobId, data: { status: 'Applied', statusSource: 'Gmail', appliedOn: a.appliedOn || j.appliedOn || '' } });
      const meta = state.jobMeta.get(a.jobId) || {};
      if (!meta.reviewed) ops.push({ op: 'merge', coll: 'jobMeta', id: a.jobId, data: { reviewed: true, updatedAt: nowIso } });
    }
  }

  // ---------- 2. Certain duplicate jobs ----------
  if (auto.autoMerge) {
    const metaById = Object.fromEntries([...state.jobMeta]);
    const merged = new Set();
    for (const pr of duplicatePairs(model.jobs.filter((j) => !j.hidden), metaById)) {
      if (pr.level !== 'same' || merged.has(pr.a) || merged.has(pr.b)) continue;
      const A = jobsById[pr.a], B = jobsById[pr.b];
      if (A.app && B.app) continue; // two applications: leave it to you
      const [keep, dup] = B.app && !A.app ? [B, A] : (A.app || str(A.foundDay) <= str(B.foundDay)) ? [A, B] : [B, A];
      const km = metaById[keep.id] || {}, dm = metaById[dup.id] || {};
      const sources = [...(km.sources || [])];
      if (dup.link && !sources.some((s) => s.link === dup.link)) sources.push({ platform: dup.platform, link: dup.link, seenOn: dup.foundDay });
      ops.push({ op: 'merge', coll: 'jobMeta', id: keep.id, data: {
        sources, notes: [km.notes, dm.notes].filter(Boolean).join('\n\n'), favorite: !!(km.favorite || dm.favorite), shortlisted: !!(km.shortlisted || dm.shortlisted),
        history: cap([...(km.history || []), { at: nowIso, type: 'merge', text: `Merged automatically with “${dup.title}” from ${dup.platform} (${pr.reason})` }], 50), updatedAt: nowIso } });
      ops.push({ op: 'merge', coll: 'jobMeta', id: dup.id, data: { mergedInto: keep.id, mergedAuto: true, mergedReason: pr.reason, updatedAt: nowIso } });
      if (dup.app) ops.push({ op: 'merge', coll: 'applications', id: dup.app.id, data: { jobId: keep.id, updatedAt: nowIso } });
      merged.add(keep.id); merged.add(dup.id);
      counts.merged++;
    }
  }

  // ---------- 3. Best new matches → review task ----------
  if (auto.autoTasks && auto.reviewTaskThreshold > 0) {
    // At most N open review tasks at a time, and at most N new ones per day, so a big batch of jobs never floods your list.
    const reviewTasks = [...state.tasks].filter(([id]) => id.startsWith('auto-review-'));
    const open = reviewTasks.filter(([, t]) => t.status !== 'Completed').length;
    const today = reviewTasks.filter(([, t]) => toDay(t.createdAt) === ref).length;
    const room = Math.max(0, Math.min(auto.reviewTasksPerRun - open, auto.reviewTasksPerRun - today));
    const fresh = model.jobs.filter((j) => !j.hidden && !j.app && !j.meta.reviewed && !j.meta.notRelevant && !j.meta.autoTaskAt && j.score >= auto.reviewTaskThreshold && j.foundDay && daysBetween(j.foundDay, ref) <= 2)
      .sort((a, b) => b.score - a.score).slice(0, room);
    for (const j of fresh) {
      addTask('auto-review-' + j.id, { title: `Review new match: ${j.title} at ${j.company}`, company: j.company, jobId: j.id, category: 'Review', priority: j.score >= 90 ? 'High' : 'Medium', dueDate: addDays(ref, 1), dueKind: 'suggested', description: `Match score ${j.score}. Found ${j.foundDay}.`, source: { kind: 'discovery', jobId: j.id } });
      ops.push({ op: 'merge', coll: 'jobMeta', id: j.id, data: { autoTaskAt: nowIso, updatedAt: nowIso } });
      counts.reviewTasks++;
    }
  }
  return { ops, counts, log };
}

/** Applies one event to an application (mutates the working copy). */
function applyEvent(app, p, ev, { nowIso, evDay, label, how, activityOnly, created, chosen }) {
  const subj = `“${short(ev.subject)}”`;
  app.history = [...(app.history || [])];
  const note = (text) => app.history.push({ at: nowIso, type: 'gmail', source: 'gmail', messageId: ev.id, text });
  if (!app.lastActivityAt || str(ev.receivedAt) > str(app.lastActivityAt)) { app.lastActivityAt = ev.receivedAt; app.lastActivity = label; }
  app.updatedAt = nowIso;
  if (activityOnly) { note(`${label} from Gmail: ${subj}`); return { text: 'activity recorded' }; }

  // Dates the email states.
  if (p.type === 'assessment') {
    const list = [...(app.assessments || [])];
    if (!list.some((x) => x.id === 'as_' + ev.id)) list.push({ id: 'as_' + ev.id, title: p.evidence && /hackerrank|codility|hackerearth|testgorilla|mettl|case study|assignment/i.test(p.evidence) ? short(p.evidence, 60) : 'Assessment', due: p.deadline || '', time: p.deadlineTime || '', link: '', status: 'Pending', notes: p.deadline ? '' : 'Deadline not stated in the email', source: 'gmail', messageId: ev.id });
    app.assessments = list;
  }
  if (p.type === 'interview') {
    const list = [...(app.interviews || [])];
    if (!list.some((x) => x.id === 'iv_' + ev.id)) list.push({ id: 'iv_' + ev.id, round: 'Interview', date: p.interviewDate || '', time: p.interviewTime || '', mode: '', with: '', status: 'Scheduled', notes: p.interviewDate ? '' : 'Date not stated in the email', source: 'gmail', messageId: ev.id });
    app.interviews = list;
  }
  if (p.type === 'reschedule') {
    const list = [...(app.interviews || [])];
    const cur = list.filter((x) => x.status !== 'Done' && x.status !== 'Cancelled').sort((a, b) => str(b.date).localeCompare(str(a.date)))[0];
    if (cur && p.interviewDate) Object.assign(cur, { date: p.interviewDate, time: p.interviewTime || cur.time, status: 'Rescheduled' });
    else if (!cur) list.push({ id: 'iv_' + ev.id, round: 'Interview', date: p.interviewDate || '', time: p.interviewTime || '', status: 'Scheduled', notes: 'Rescheduled (from Gmail)', source: 'gmail', messageId: ev.id });
    app.interviews = list;
  }
  if (p.type === 'offer' && !app.offeredComp) app.offeredComp = '';
  if (p.type === 'applied' && !app.appliedOn) app.appliedOn = evDay;

  const target = TARGET[p.type];
  if (!target || created) { note(`${label} from Gmail: ${subj}${created ? '' : ` (${how})`}`); return { text: created ? `created at ${app.stage}` : 'activity recorded' }; }
  const from = app.stage;
  // A manual change made after this email wins: the email is older news.
  const rf0 = RANK[from] ?? 0, rt0 = RANK[target] ?? 0;
  // A manual decision made after this email wins (e.g. you withdrew). Pre-apply stages don't block a confirmation.
  if (!chosen && app.stageSource === 'You' && str(app.stageChangedAt) > str(ev.receivedAt) && (rf0 >= RANK.Applied || rt0 <= rf0)) {
    note(`${label} from Gmail ${subj}: stage left at “${from}” because you changed it after this email arrived`);
    return { text: 'kept your newer manual stage', stale: true };
  }
  const rf = RANK[from] ?? 0, rt = RANK[target] ?? 0;
  if (target === from) { note(`${label} from Gmail: ${subj}`); return { text: 'confirmed current stage' }; }
  if (['Rejected', 'Withdrawn', 'Closed', 'Offer Received'].includes(from)) {
    note(`${label} from Gmail ${subj} after the application was “${from}”; stage not changed`);
    return { text: 'not changed', conflict: `New “${label}” email for an application that is already “${from}”. It may be about a different role.` };
  }
  if (rt < rf && !['Rejected', 'Offer Received'].includes(target)) {
    note(`${label} from Gmail ${subj}; already further along (“${from}”), stage not moved back`);
    return { text: 'stage already further along', stale: true };
  }
  app.stage = target; app.stageChangedAt = nowIso; app.stageSource = 'gmail';
  app.stageEvidence = { messageId: ev.id, receivedAt: ev.receivedAt, type: p.type };
  app.history.push({ at: nowIso, type: 'stage', from, to: target, source: 'gmail', messageId: ev.id, text: `${label} from Gmail: ${subj} (${how})` });
  if (target === 'Applied' && !app.appliedOn) app.appliedOn = evDay;
  return { text: `moved ${from} → ${target}`, reason: how };
}

export { STAGES };
