// Backups (JSON) and CSV exports.
import { COLLECTIONS } from './schema.js';
import { now, toCsv, str, fmtDay } from './util.js';

export const BACKUP_APP = 'jobhunt-command-center';
export const BACKUP_VERSION = 1;

export function makeBackup(store, source = '') {
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = store.all(c);
  return { app: BACKUP_APP, version: BACKUP_VERSION, exportedAt: now().toISOString(), source, collections };
}

export function validateBackup(b) {
  const errors = [];
  if (!b || typeof b !== 'object') return { ok: false, errors: ['This file is not a JobHunt backup.'], counts: {} };
  if (b.app !== BACKUP_APP) errors.push('This file is not a JobHunt Command Center backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) errors.push(`Backup version ${b.version} is not supported by this version of the app.`);
  const counts = {};
  if (!b.collections || typeof b.collections !== 'object') errors.push('The backup has no data section.');
  else for (const c of COLLECTIONS) {
    const list = b.collections[c];
    if (list == null) { counts[c] = 0; continue; }
    if (!Array.isArray(list)) { errors.push(`“${c}” should be a list.`); continue; }
    const bad = list.filter((r) => !r || typeof r !== 'object' || typeof r.id !== 'string' || !/^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(r.id) || r.id === '.' || r.id === '..');
    if (bad.length) errors.push(`${bad.length} ${c} record(s) have a missing or invalid id.`);
    if (c === 'jobs') { const n = list.filter((r) => !str(r.title) || !str(r.company)).length; if (n) errors.push(`${n} job(s) have no title or company.`); }
    if (c === 'applications') { const n = list.filter((r) => !str(r.company) || !str(r.title)).length; if (n) errors.push(`${n} application(s) have no company or title.`); }
    if (c === 'tasks') { const n = list.filter((r) => !str(r.title)).length; if (n) errors.push(`${n} task(s) have no title.`); }
    counts[c] = list.length;
  }
  return { ok: !errors.length, errors, counts, exportedAt: b.exportedAt };
}

const strip = ({ id, ...rest }) => rest;
function unionHistory(a = [], b = []) {
  const seen = new Set(), out = [];
  for (const h of [...a, ...b]) { const k = JSON.stringify(h); if (!seen.has(k)) { seen.add(k); out.push(h); } }
  return out.sort((x, y) => str(x.at).localeCompare(str(y.at)));
}

/**
 * mode 'merge'  : adds missing records; for records in both, the newer one wins, history is combined
 *                 and notes are never emptied. Nothing is deleted.
 * mode 'replace': the data becomes exactly the backup (records not in it are deleted).
 */
export function planRestore(b, store, mode = 'merge') {
  const ops = [];
  const counts = { add: 0, update: 0, keep: 0, remove: 0 };
  for (const c of COLLECTIONS) {
    const incoming = new Map((b.collections[c] || []).map((r) => [r.id, strip(r)]));
    for (const [id, data] of incoming) {
      const cur = store.get(c, id);
      if (!cur) { ops.push({ op: 'set', coll: c, id, data }); counts.add++; continue; }
      if (mode === 'replace') { if (JSON.stringify(cur) !== JSON.stringify(data)) { ops.push({ op: 'set', coll: c, id, data }); counts.update++; } else counts.keep++; continue; }
      const newer = str(data.updatedAt) > str(cur.updatedAt);
      const merged = newer ? { ...cur, ...data } : { ...data, ...cur };
      if (Array.isArray(cur.history) || Array.isArray(data.history)) merged.history = unionHistory(cur.history, data.history);
      if (!str(merged.notes) && (str(cur.notes) || str(data.notes))) merged.notes = str(cur.notes) || str(data.notes);
      if (JSON.stringify(merged) !== JSON.stringify(cur)) { ops.push({ op: 'set', coll: c, id, data: merged }); counts.update++; } else counts.keep++;
    }
    if (mode === 'replace') for (const [id] of store.state[c]) if (!incoming.has(id)) { ops.push({ op: 'delete', coll: c, id }); counts.remove++; }
  }
  return { ops, counts };
}

/** Deletes every record in every collection (the explicit "delete all data" flow). */
export function planDeleteAll(store) {
  const ops = [];
  for (const c of COLLECTIONS) for (const [id] of store.state[c]) ops.push({ op: 'delete', coll: c, id });
  return ops;
}

// ---------- CSV ----------

export const JOB_COLUMNS = [
  { label: 'Job title', key: 'title' }, { label: 'Company', key: 'company' }, { label: 'Location', key: 'location' },
  { label: 'Work mode', key: 'workMode' }, { label: 'Region', key: 'region' }, { label: 'Employment type', key: 'employmentType' },
  { label: 'Experience', key: 'experience' }, { label: 'Salary / CTC', key: 'ctc' }, { label: 'Source', key: 'platform' },
  { label: 'Job URL', key: 'link' }, { label: 'Application URL', key: 'applyUrl' }, { label: 'Requisition ID', key: 'requisitionId' },
  { label: 'Posted', get: (j) => j.postedDay }, { label: 'Discovered', get: (j) => j.foundDay }, { label: 'Deadline', get: (j) => j.fresh.deadline },
  { label: 'Target role', key: 'role' }, { label: 'Match score', get: (j) => j.score ?? '' }, { label: 'Search score', get: (j) => j.match ?? '' },
  { label: 'Priority', get: (j) => j.meta.priority || '' }, { label: 'Favourite', get: (j) => (j.meta.favorite ? 'Yes' : '') },
  { label: 'Shortlisted', get: (j) => (j.meta.shortlisted ? 'Yes' : '') }, { label: 'Status', get: (j) => j.status2 },
  { label: 'Verification', get: (j) => j.fresh.verification }, { label: 'Last verified', get: (j) => j.meta.lastVerifiedAt || '' },
  { label: 'My notes', get: (j) => j.meta.notes || '' }, { label: 'Search note', key: 'note' }, { label: 'Id', key: 'id' },
];
export const APP_COLUMNS = [
  { label: 'Company', key: 'company' }, { label: 'Job title', key: 'title' }, { label: 'Stage', key: 'stage' },
  { label: 'Applied on', key: 'appliedOn' }, { label: 'Location', key: 'location' }, { label: 'Job URL', key: 'jobUrl' },
  { label: 'Application URL', key: 'applicationUrl' }, { label: 'Requisition ID', key: 'requisitionId' }, { label: 'Source', key: 'platform' },
  { label: 'Resume version', key: 'resumeVersion' }, { label: 'Documents', key: 'documents' }, { label: 'Referral', key: 'referral' },
  { label: 'Recruiter', get: (a) => [a.recruiter?.name, a.recruiter?.email, a.recruiter?.phone].filter(Boolean).join(' · ') },
  { label: 'Next follow-up', key: 'followUpDate' }, { label: 'Next action', key: 'nextAction' },
  { label: 'Interviews', get: (a) => a.interviews.map((i) => `${i.round} ${i.date}${i.time ? ' ' + i.time : ''} (${i.status})`).join('; ') },
  { label: 'Assessments', get: (a) => a.assessments.map((x) => `${x.title}${x.due ? ' due ' + x.due : ''} (${x.status})`).join('; ') },
  { label: 'Expected compensation', key: 'expectedComp' }, { label: 'Offered compensation', key: 'offeredComp' },
  { label: 'Notes', key: 'notes' }, { label: 'Created', get: (a) => str(a.createdAt).slice(0, 10) }, { label: 'Id', key: 'id' },
];
export const TASK_COLUMNS = [
  { label: 'Title', key: 'title' }, { label: 'Status', key: 'status' }, { label: 'Priority', key: 'priority' },
  { label: 'Due date', key: 'dueDate' }, { label: 'Due time', key: 'dueTime' }, { label: 'Category', key: 'category' },
  { label: 'Company', key: 'company' }, { label: 'Description', key: 'description' }, { label: 'Notes', key: 'notes' },
  { label: 'Created', get: (t) => str(t.createdAt).slice(0, 16).replace('T', ' ') }, { label: 'Completed', get: (t) => str(t.completedAt).slice(0, 16).replace('T', ' ') },
  { label: 'Job id', key: 'jobId' }, { label: 'Application id', key: 'appId' }, { label: 'Id', key: 'id' },
];
export const jobsCsv = (jobs) => toCsv(jobs, JOB_COLUMNS);
export const appsCsv = (apps) => toCsv(apps, APP_COLUMNS);
export const tasksCsv = (tasks) => toCsv(tasks, TASK_COLUMNS);
export const fileStamp = () => now().toISOString().slice(0, 10);
export { fmtDay };
