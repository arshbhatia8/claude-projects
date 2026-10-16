// Builds the read model the screens use: jobs joined with your notes, scores,
// freshness and their application. Everything shown is computed from stored records.
import { cleanJobDoc, parseExperience, experienceLevel, parseComp, compLPA, detectWorkMode, detectRegion, normalizePlatform, mergeSettings, isActiveStage, isSubmittedStage } from './schema.js';
import { scoreJob } from './matching.js';
import { freshnessOf } from './freshness.js';
import { duplicatePairs } from './dedupe.js';
import { today, toDay, str } from './util.js';

export function jobStatus(job) {
  if (job.app) return job.app.stage;
  const m = job.meta;
  if (m.notRelevant) return 'Not relevant';
  if (m.shortlisted) return 'Shortlisted';
  if (job.status === 'Applied') return 'Applied (not tracked)';
  if (m.reviewed) return 'Reviewed';
  return 'New';
}

export function buildModel(state, ref = today()) {
  const settings = mergeSettings(state.settings && state.settings.main);
  const metaById = Object.fromEntries([...state.jobMeta].map(([id, m]) => [id, m]));
  const apps = [...state.applications].map(([id, a]) => ({ id, ...a }));
  const appsByJob = new Map();
  for (const a of apps) if (a.jobId) (appsByJob.get(a.jobId) || appsByJob.set(a.jobId, []).get(a.jobId)).push(a);

  const jobs = [...state.jobs].map(([id, raw]) => {
    const d = cleanJobDoc({ id, ...raw });
    const meta = metaById[id] || {};
    const linked = (appsByJob.get(id) || []).sort((x, y) => str(y.createdAt).localeCompare(str(x.createdAt)));
    const j = {
      ...d,
      meta,
      platform: normalizePlatform(d.source, d.link) || 'Other',
      workMode: d.workMode || detectWorkMode(d.location, d.note) || '',
      region: detectRegion(d.location, d.region),
      exp: parseExperience(d.experience),
      comp: parseComp(d.ctc),
      priority: meta.priority || '',
      apps: linked,
      app: linked[0] || null,
    };
    j.expLevel = experienceLevel(j.exp);
    j.lpa = compLPA(j.comp, settings.fxToINR);
    j.fresh = freshnessOf(j, meta, ref);
    j.scoreInfo = scoreJob(j, settings, ref);
    j.score = j.scoreInfo.score;
    j.role = j.scoreInfo.role || 'Other';
    j.foundDay = toDay(d.foundOn) || toDay(d.createdAt) || '';
    j.postedDay = toDay(d.listedAt);
    j.hidden = !!meta.mergedInto;
    j.status2 = jobStatus(j);
    return j;
  });
  const jobById = Object.fromEntries(jobs.map((j) => [j.id, j]));

  const enrichedApps = apps.map((a) => {
    const job = a.jobId ? jobById[a.jobId] : null;
    const interviews = Array.isArray(a.interviews) ? a.interviews : [];
    const assessments = Array.isArray(a.assessments) ? a.assessments : [];
    const nextInterview = interviews.filter((i) => i.date && i.date >= ref && i.status !== 'Done' && i.status !== 'Cancelled').sort((x, y) => (x.date + (x.time || '')).localeCompare(y.date + (y.time || '')))[0] || null;
    const pendingAssessments = assessments.filter((x) => x.status !== 'Done' && x.status !== 'Skipped');
    return {
      ...a,
      job,
      company: a.company || (job && job.company) || '',
      title: a.title || (job && job.title) || '',
      interviews, assessments, nextInterview, pendingAssessments,
      active: isActiveStage(a.stage),
      submitted: !!a.appliedOn || isSubmittedStage(a.stage),
      followUpDue: isActiveStage(a.stage) && a.followUpDate && a.followUpDate <= ref,
      role: job ? job.role : (scoreJob({ title: a.title }, settings, ref).role || 'Other'),
      platform: job ? job.platform : (a.source || 'Other'),
    };
  });

  const tasks = [...state.tasks].map(([id, t]) => ({ id, ...t }));
  const imports = [...state.imports].map(([id, r]) => ({ id, ...r })).sort((a, b) => str(b.at).localeCompare(str(a.at)));
  const dupPairs = duplicatePairs(jobs.filter((j) => !j.hidden), metaById);
  return { settings, jobs, jobById, apps: enrichedApps, appById: Object.fromEntries(enrichedApps.map((a) => [a.id, a])), tasks, taskById: Object.fromEntries(tasks.map((t) => [t.id, t])), imports, dupPairs, ref };
}
