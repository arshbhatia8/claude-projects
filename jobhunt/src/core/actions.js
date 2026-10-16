// Everything you can do to your data, in one place, so every screen follows the same rules.
import { uid, now, today, str, addDays, safeUrl } from './util.js';
import { STAGES, isSubmittedStage, cleanJobDoc, jobIdFor, detectRegion, detectWorkMode, mergeSettings } from './schema.js';
import { normCompany, normTitle, normReq, normUrl, normLocation } from './dedupe.js';

const stamp = () => now().toISOString();
const cap = (arr, n) => (arr.length > n ? arr.slice(arr.length - n) : arr);

export class ActionError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

// ---------------- jobs ----------------

export async function setJobMeta(store, jobId, patch, historyText) {
  const meta = store.get('jobMeta', jobId) || {};
  const data = { ...patch, updatedAt: stamp() };
  if (historyText) data.history = cap([...(meta.history || []), { at: stamp(), type: 'note', text: historyText }], 50);
  return store.merge('jobMeta', jobId, data);
}
export const toggleFavorite = (store, jobId) => {
  const on = !(store.get('jobMeta', jobId) || {}).favorite;
  return setJobMeta(store, jobId, { favorite: on }, on ? 'Added to favourites' : 'Removed from favourites');
};
export const setShortlisted = (store, jobId, on, reason) => {
  const p = { shortlisted: !!on, reviewed: true, notRelevant: on ? false : (store.get('jobMeta', jobId) || {}).notRelevant || false };
  if (on) p.shortlistedAt = (store.get('jobMeta', jobId) || {}).shortlistedAt || stamp();
  if (reason != null) p.shortlistReason = str(reason);
  return setJobMeta(store, jobId, p, on ? 'Shortlisted' : 'Removed from shortlist');
};
export const markReviewed = (store, jobId, on = true) => setJobMeta(store, jobId, { reviewed: !!on, reviewedAt: on ? stamp() : '' }, on ? 'Marked reviewed' : 'Marked unreviewed');
export const markNotRelevant = (store, jobId, on = true) => setJobMeta(store, jobId, { notRelevant: !!on, reviewed: true, ...(on ? { shortlisted: false } : {}) }, on ? 'Marked not relevant' : 'Marked relevant again');
export const setJobPriority = (store, jobId, priority) => setJobMeta(store, jobId, { priority }, `Priority set to ${priority || 'none'}`);
export const setJobNotes = (store, jobId, notes) => setJobMeta(store, jobId, { notes: str(notes) });
export function setVerification(store, jobId, verification) {
  return setJobMeta(store, jobId, { verification, lastVerifiedAt: today() }, `Verification: ${verification}`);
}

/** Adds a job by hand. Same duplicate rules as imports. */
export async function createJob(store, fields) {
  const job = {
    title: str(fields.title), company: str(fields.company), location: str(fields.location),
    workMode: fields.workMode || detectWorkMode(fields.location), employmentType: str(fields.employmentType),
    experience: str(fields.experience), ctc: str(fields.ctc), source: str(fields.source) || 'Other',
    link: safeUrl(fields.link), applyUrl: safeUrl(fields.applyUrl), requisitionId: str(fields.requisitionId),
    description: str(fields.description), listedAt: str(fields.listedAt), listedTimeKnown: false, deadline: str(fields.deadline),
    skills: Array.isArray(fields.skills) ? fields.skills : str(fields.skills).split(',').map(str).filter(Boolean),
  };
  if (!job.title || !job.company) throw new ActionError('Enter at least a job title and a company.');
  job.region = detectRegion(job.location);
  let id = jobIdFor(job);
  while (store.get('jobs', id)) id += '-' + Math.random().toString(36).slice(2, 4);
  await store.set('jobs', id, cleanJobDoc({ ...job, status: 'Not applied', statusSource: 'You', appliedOn: '', foundOn: today(), origin: 'manual', createdAt: stamp(), updatedAt: stamp() }));
  return id;
}

const FACT_FIELDS = ['title', 'company', 'location', 'workMode', 'employmentType', 'experience', 'ctc', 'link', 'applyUrl', 'requisitionId', 'description', 'listedAt', 'deadline', 'source', 'skills'];
/** Edits discovery facts; each change is kept in the job's history. */
export async function editJobFacts(store, jobId, patch) {
  const cur = store.get('jobs', jobId) || {};
  const data = {}, changes = {};
  for (const k of FACT_FIELDS) {
    if (!(k in patch)) continue;
    let v = patch[k];
    if (k === 'link' || k === 'applyUrl') v = safeUrl(v);
    if (k === 'skills') v = Array.isArray(v) ? v : str(v).split(',').map(str).filter(Boolean);
    else v = str(v);
    if (JSON.stringify(cur[k] ?? '') !== JSON.stringify(v)) { data[k] = v; changes[k] = [cur[k] ?? '', v]; }
  }
  if (!Object.keys(data).length) return false;
  if ('title' in data && !data.title) throw new ActionError('The job title cannot be empty.');
  if ('company' in data && !data.company) throw new ActionError('The company cannot be empty.');
  if ('listedAt' in data) data.listedTimeKnown = /T\d/.test(data.listedAt);
  await store.update('jobs', jobId, { ...data, updatedAt: stamp() });
  const meta = store.get('jobMeta', jobId) || {};
  await store.merge('jobMeta', jobId, { history: cap([...(meta.history || []), { at: stamp(), type: 'edit', changes }], 50), updatedAt: stamp() });
  return true;
}

export async function deleteJob(store, jobId) {
  for (const a of store.all('applications').filter((a) => a.jobId === jobId)) {
    const j = store.get('jobs', jobId) || {};
    await store.update('applications', a.id, { jobId: '', jobUrl: a.jobUrl || j.link || '', updatedAt: stamp() });
  }
  await store.delete('jobs', jobId);
  if (store.get('jobMeta', jobId)) await store.delete('jobMeta', jobId);
}

/** Keeps `keepId`, hides `dupId` behind it and moves its links, sources, applications and tasks. */
export async function mergeJobs(store, keepId, dupId) {
  if (keepId === dupId) return;
  const dup = store.get('jobs', dupId) || {};
  const keepMeta = store.get('jobMeta', keepId) || {};
  const dupMeta = store.get('jobMeta', dupId) || {};
  const sources = [...(keepMeta.sources || [])];
  if (dup.link && !sources.some((s) => s.link === dup.link)) sources.push({ platform: dup.source || '', link: dup.link, seenOn: (dup.foundOn || today()) });
  for (const s of dupMeta.sources || []) if (!sources.some((x) => x.link === s.link)) sources.push(s);
  const notes = [keepMeta.notes, dupMeta.notes].filter(Boolean).join('\n\n');
  await store.merge('jobMeta', keepId, {
    sources, notes,
    favorite: !!(keepMeta.favorite || dupMeta.favorite), shortlisted: !!(keepMeta.shortlisted || dupMeta.shortlisted),
    history: cap([...(keepMeta.history || []), { at: stamp(), type: 'merge', text: `Merged duplicate “${dup.title}” (${dup.source || 'unknown source'})` }], 50),
    updatedAt: stamp(),
  });
  await store.merge('jobMeta', dupId, { mergedInto: keepId, updatedAt: stamp() });
  for (const a of store.all('applications').filter((a) => a.jobId === dupId)) await store.update('applications', a.id, { jobId: keepId, updatedAt: stamp() });
  for (const t of store.all('tasks').filter((t) => t.jobId === dupId)) await store.update('tasks', t.id, { jobId: keepId, updatedAt: stamp() });
}
export async function unmergeJob(store, dupId) { await store.merge('jobMeta', dupId, { mergedInto: '', updatedAt: stamp() }); }
export async function dismissDuplicate(store, a, b) {
  const m = store.get('jobMeta', a) || {};
  await store.merge('jobMeta', a, { notDuplicateOf: [...new Set([...(m.notDuplicateOf || []), b])], updatedAt: stamp() });
}

// ---------------- applications ----------------

/** An existing application this one would duplicate, or null. Different roles at one company are fine. */
export function findDuplicateApplication(apps, draft) {
  const c = normCompany(draft.company), t = normTitle(draft.title), r = normReq(draft.requisitionId), u = normUrl(draft.jobUrl || draft.applicationUrl);
  for (const a of apps) {
    if (draft.jobId && a.jobId === draft.jobId) return { app: a, reason: 'You already track an application for this job.' };
    if (r && normReq(a.requisitionId) === r && normCompany(a.company) === c) return { app: a, reason: `You already applied to requisition ${draft.requisitionId} at ${a.company}.` };
    if (u && [a.jobUrl, a.applicationUrl].map(normUrl).includes(u)) return { app: a, reason: 'You already track an application with this listing URL.' };
    if (c && c === normCompany(a.company) && t === normTitle(a.title) && !r && (!draft.location || !a.location || normLocation(draft.location) === normLocation(a.location))) {
      return { app: a, reason: `You already track “${a.title}” at ${a.company}.` };
    }
  }
  return null;
}

export async function createApplication(store, draft, { force = false } = {}) {
  const job = draft.jobId ? store.get('jobs', draft.jobId) : null;
  const settings = mergeSettings(store.get('settings', 'main'));
  const d = {
    jobId: draft.jobId || '',
    company: str(draft.company || (job && job.company)),
    title: str(draft.title || (job && job.title)),
    location: str(draft.location || (job && job.location)),
    jobUrl: safeUrl(draft.jobUrl || (job && job.link)),
    applicationUrl: safeUrl(draft.applicationUrl || (job && job.applyUrl)),
    requisitionId: str(draft.requisitionId || (job && job.requisitionId)),
    source: str(draft.source || (job && job.source)),
    stage: STAGES.includes(draft.stage) ? draft.stage : settings.defaults.applicationStage,
    appliedOn: str(draft.appliedOn),
  };
  if (!d.company || !d.title) throw new ActionError('Enter the company and job title.');
  if (isSubmittedStage(d.stage) && !d.appliedOn) throw new ActionError('Enter the date you applied. Only applications you have actually sent count as applied.', { needsDate: true });
  if (d.appliedOn && d.appliedOn > today()) throw new ActionError('The applied date cannot be in the future.');
  if (!force) {
    const dup = findDuplicateApplication(store.all('applications'), d);
    if (dup) throw new ActionError(dup.reason, { duplicate: dup.app });
  }
  const id = uid('app_');
  const at = stamp();
  const doc = {
    ...d,
    resumeVersion: str(draft.resumeVersion), documents: str(draft.documents),
    recruiter: { name: '', email: '', phone: '', linkedin: '', ...(draft.recruiter || {}) },
    referral: str(draft.referral), assessments: [], interviews: [],
    followUpDate: str(draft.followUpDate), expectedComp: str(draft.expectedComp), offeredComp: '',
    notes: str(draft.notes), nextAction: str(draft.nextAction),
    history: [{ at, type: 'created', to: d.stage, text: d.appliedOn ? `Applied on ${d.appliedOn}` : `Added at ${d.stage}` }],
    createdAt: at, updatedAt: at, stageChangedAt: at,
  };
  await store.set('applications', id, doc);
  if (job) await syncJobStatus(store, d.jobId, doc);
  return id;
}

/** Keeps the job's status (read by the scheduled search) in line with your application. */
async function syncJobStatus(store, jobId, app) {
  if (!jobId || !store.get('jobs', jobId)) return;
  if (isSubmittedStage(app.stage) && app.appliedOn) await store.update('jobs', jobId, { status: 'Applied', statusSource: 'You', appliedOn: app.appliedOn });
  await store.merge('jobMeta', jobId, { reviewed: true, updatedAt: stamp() });
}

export async function moveStage(store, appId, stage, { appliedOn, note } = {}) {
  const a = store.get('applications', appId);
  if (!a) throw new ActionError('Application not found.');
  if (!STAGES.includes(stage)) throw new ActionError(`Unknown stage “${stage}”.`);
  if (a.stage === stage) return false;
  const date = str(appliedOn || a.appliedOn);
  if (isSubmittedStage(stage) && !date) throw new ActionError('Enter the date you applied before moving past “Ready to Apply”.', { needsDate: true });
  if (date && date > today()) throw new ActionError('The applied date cannot be in the future.');
  const at = stamp();
  const patch = {
    stage, stageChangedAt: at, updatedAt: at,
    history: cap([...(a.history || []), { at, type: 'stage', from: a.stage, to: stage, ...(note ? { text: str(note) } : {}) }], 300),
  };
  if (isSubmittedStage(stage) && !a.appliedOn) patch.appliedOn = date;
  await store.update('applications', appId, patch);
  if (a.jobId) await syncJobStatus(store, a.jobId, { ...a, ...patch });
  return true;
}

const APP_FIELDS = ['company', 'title', 'location', 'jobUrl', 'applicationUrl', 'requisitionId', 'source', 'appliedOn', 'resumeVersion', 'documents', 'referral', 'followUpDate', 'expectedComp', 'offeredComp', 'notes', 'nextAction'];
const LABEL = { jobUrl: 'job URL', applicationUrl: 'application URL', requisitionId: 'requisition ID', appliedOn: 'applied date', resumeVersion: 'resume version', followUpDate: 'follow-up date', expectedComp: 'expected compensation', offeredComp: 'offered compensation', nextAction: 'next action' };
export async function updateApplication(store, appId, patch) {
  const a = store.get('applications', appId);
  if (!a) throw new ActionError('Application not found.');
  const data = {}, changed = [];
  for (const k of APP_FIELDS) {
    if (!(k in patch)) continue;
    const v = k === 'jobUrl' || k === 'applicationUrl' ? safeUrl(patch[k]) : str(patch[k]);
    if ((a[k] ?? '') !== v) { data[k] = v; changed.push(LABEL[k] || k); }
  }
  if (patch.recruiter) {
    const r = { name: '', email: '', phone: '', linkedin: '', ...(a.recruiter || {}) };
    const nr = { ...r }; for (const k of Object.keys(r)) if (k in patch.recruiter) nr[k] = str(patch.recruiter[k]);
    if (JSON.stringify(r) !== JSON.stringify(nr)) { data.recruiter = nr; changed.push('recruiter'); }
  }
  if ('company' in data && !data.company) throw new ActionError('The company cannot be empty.');
  if ('title' in data && !data.title) throw new ActionError('The job title cannot be empty.');
  if (data.appliedOn && data.appliedOn > today()) throw new ActionError('The applied date cannot be in the future.');
  if ('appliedOn' in data && !data.appliedOn && isSubmittedStage(a.stage)) throw new ActionError('An application at this stage needs its applied date.');
  if (!changed.length) return false;
  const at = stamp();
  data.updatedAt = at;
  data.history = cap([...(a.history || []), { at, type: 'edit', text: `Edited ${changed.join(', ')}` }], 300);
  await store.update('applications', appId, data);
  if (data.appliedOn && a.jobId) await syncJobStatus(store, a.jobId, { ...a, ...data });
  return true;
}

/** kind: 'interviews' | 'assessments'. item without id → added; with id → replaced; remove → deleted. */
export async function saveItem(store, appId, kind, item, { remove = false } = {}) {
  const a = store.get('applications', appId);
  if (!a) throw new ActionError('Application not found.');
  const list = [...(a[kind] || [])];
  const at = stamp();
  let text;
  if (remove) {
    const i = list.findIndex((x) => x.id === item.id);
    if (i < 0) return;
    text = `Removed ${kind === 'interviews' ? 'interview' : 'assessment'} “${list[i].round || list[i].title || ''}”`;
    list.splice(i, 1);
  } else if (kind === 'interviews') {
    const v = { id: item.id || uid('iv_'), round: str(item.round) || 'Interview', date: str(item.date), time: str(item.time), mode: str(item.mode), with: str(item.with), status: item.status || 'Scheduled', notes: str(item.notes) };
    if (!v.date) throw new ActionError('Enter the interview date.');
    const i = list.findIndex((x) => x.id === v.id);
    text = i >= 0 ? `Updated interview “${v.round}”` : `Interview “${v.round}” on ${v.date}${v.time ? ' ' + v.time : ''}`;
    if (i >= 0) list[i] = v; else list.push(v);
  } else {
    const v = { id: item.id || uid('as_'), title: str(item.title) || 'Assessment', due: str(item.due), time: str(item.time), link: safeUrl(item.link), status: item.status || 'Pending', notes: str(item.notes) };
    const i = list.findIndex((x) => x.id === v.id);
    text = i >= 0 ? `Updated assessment “${v.title}”` : `Assessment “${v.title}”${v.due ? ' due ' + v.due : ''}`;
    if (i >= 0) list[i] = v; else list.push(v);
  }
  list.sort((x, y) => str(x.date || x.due).localeCompare(str(y.date || y.due)));
  await store.update('applications', appId, { [kind]: list, updatedAt: at, history: cap([...(a.history || []), { at, type: kind === 'interviews' ? 'interview' : 'assessment', text }], 300) });
}

export async function deleteApplication(store, appId) {
  const a = store.get('applications', appId);
  await store.delete('applications', appId);
  if (a && a.jobId && store.get('jobs', a.jobId)) {
    const j = store.get('jobs', a.jobId);
    const others = store.all('applications').some((x) => x.jobId === a.jobId);
    if (!others && j.statusSource === 'You') await store.update('jobs', a.jobId, { status: 'Not applied', statusSource: 'You', appliedOn: '' });
  }
}

// ---------------- tasks ----------------

export async function createTask(store, t) {
  const title = str(t.title);
  if (!title) throw new ActionError('Give the task a title.');
  const settings = mergeSettings(store.get('settings', 'main'));
  const id = uid('task_');
  const at = stamp();
  await store.set('tasks', id, {
    title, description: str(t.description), company: str(t.company), jobId: str(t.jobId), appId: str(t.appId),
    priority: ['Low', 'Medium', 'High', 'Urgent'].includes(t.priority) ? t.priority : settings.defaults.taskPriority,
    dueDate: str(t.dueDate), dueTime: str(t.dueTime), status: ['To Do', 'In Progress', 'Completed'].includes(t.status) ? t.status : 'To Do',
    category: str(t.category) || 'Other', notes: str(t.notes), createdAt: at, updatedAt: at, completedAt: t.status === 'Completed' ? at : '',
    origin: str(t.origin) || 'manual',
  });
  return id;
}
export async function updateTask(store, id, patch) {
  const t = store.get('tasks', id);
  if (!t) throw new ActionError('Task not found.');
  const data = {};
  for (const k of ['title', 'description', 'company', 'jobId', 'appId', 'priority', 'dueDate', 'dueTime', 'status', 'category', 'notes']) if (k in patch) data[k] = str(patch[k]);
  if ('title' in data && !data.title) throw new ActionError('Give the task a title.');
  if (data.status === 'Completed' && t.status !== 'Completed') data.completedAt = stamp();
  if (data.status && data.status !== 'Completed') data.completedAt = '';
  data.updatedAt = stamp();
  await store.update('tasks', id, data);
}
export const completeTask = (store, id, done = true) => updateTask(store, id, { status: done ? 'Completed' : 'To Do' });
export const rescheduleTask = (store, id, dueDate, dueTime) => updateTask(store, id, dueTime == null ? { dueDate } : { dueDate, dueTime });
export const deleteTask = (store, id) => store.delete('tasks', id);
export const snoozeTask = (store, id, days = 1) => {
  const t = store.get('tasks', id);
  const base = t.dueDate && t.dueDate > today() ? t.dueDate : today();
  return rescheduleTask(store, id, addDays(base, days));
};

// ---------------- settings ----------------
export const saveSettings = (store, settings) => store.set('settings', 'main', { ...settings, updatedAt: stamp() });
