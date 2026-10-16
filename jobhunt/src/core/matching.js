// Transparent 0–100 match score. Each factor scores 0–100 or is left out when the
// listing has no data for it; the total is the weighted average of the factors that
// have data. A score is an estimate of relevance, never proof a job is open.
import { parseExperience, parseComp, compLPA, detectWorkMode, classifyRole } from './schema.js';
import { str, daysBetween, today, toDay } from './util.js';

export const FACTORS = {
  role: 'Role alignment',
  skills: 'Required skills',
  experience: 'Experience fit',
  location: 'Location & work mode',
  compensation: 'Compensation',
  freshness: 'Posting freshness',
  seniority: 'Seniority fit',
  searchScore: 'Scheduled search score',
};

const has = (text, kw) => {
  const k = str(kw).toLowerCase().trim();
  if (!k) return false;
  return new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(text);
};

export function scoreJob(job, settings, ref = today()) {
  const f = {};
  const title = str(job.title);

  // Role
  const role = classifyRole(title, settings.targetRoles);
  if (role) {
    const s = { 1: 100, 2: 85, 3: 70 }[role.role.priority || 2] ?? 80;
    f.role = { score: s, note: `Matches “${role.role.name}” (${['', 'high', 'medium', 'low'][role.role.priority || 2]} priority)` };
  } else {
    f.role = { score: 15, note: 'Title does not match any target role' };
  }

  // Skills: only when the listing carries a description or a skills list.
  const jobSkills = Array.isArray(job.skills) ? job.skills.filter(Boolean) : [];
  const text = [job.description, jobSkills.join(', ')].map(str).join(' ').toLowerCase();
  if (jobSkills.length) {
    const mine = settings.skills || [];
    const hit = jobSkills.filter((s) => mine.some((m) => has(s.toLowerCase(), m) || has(m.toLowerCase(), s)));
    f.skills = { score: Math.round((hit.length / jobSkills.length) * 100), note: `${hit.length} of ${jobSkills.length} listed skills match yours` };
  } else if (text.trim().length > 40) {
    const hit = (settings.skills || []).filter((m) => has(text, m));
    f.skills = { score: Math.min(100, hit.length * 15), note: hit.length ? `Mentions ${hit.slice(0, 4).join(', ')}${hit.length > 4 ? '…' : ''}` : 'None of your skills are mentioned' };
  } else f.skills = null;

  // Experience
  const exp = parseExperience(job.experience);
  const y = Number(settings.experienceYears);
  if (exp && Number.isFinite(y)) {
    let s;
    if (y < exp.min) s = Math.max(0, 100 - 35 * (exp.min - y));
    else if (exp.max != null && y > exp.max) s = Math.max(0, 100 - 15 * (y - exp.max));
    else s = 100;
    const range = exp.max != null ? `${exp.min}–${exp.max} yrs` : `${exp.min}+ yrs`;
    f.experience = { score: Math.round(s), note: s === 100 ? `Asks ${range}; you have ${y}` : `Asks ${range}; you have ${y}` };
  } else f.experience = null;

  // Location & work mode
  const loc = str(job.location).toLowerCase();
  const mode = job.workMode || detectWorkMode(job.location, job.note, job.title);
  if (loc || mode) {
    const prefs = (settings.locations || []).map((l) => str(l).toLowerCase()).filter(Boolean);
    const alias = (p) => [p, ...({ bengaluru: ['bangalore'], gurugram: ['gurgaon'], 'delhi ncr': ['delhi', 'ncr', 'noida', 'gurugram', 'gurgaon'], mumbai: ['bombay'] }[p] || [])];
    let idx = prefs.findIndex((p) => p !== 'remote' && alias(p).some((a) => loc.includes(a)));
    let s, note;
    if (idx >= 0) { s = Math.max(70, 100 - idx * 3); note = `In ${settings.locations[idx]}`; }
    else if ((mode === 'Remote' || /remote/.test(loc)) && prefs.includes('remote')) { s = 90; note = 'Remote'; }
    else if (!loc) { s = 50; note = 'Location not stated'; }
    else { s = 30; note = 'Not one of your preferred locations'; }
    if (mode && settings.workModes && settings.workModes[mode] === false) { s = Math.round(s * 0.3); note += ` · ${mode} is switched off in Settings`; }
    else if (mode) note += ` · ${mode}`;
    f.location = { score: s, note };
  } else f.location = null;

  // Compensation: only when disclosed and you set a minimum.
  const comp = parseComp(job.ctc);
  const lpa = compLPA(comp, settings.fxToINR);
  const minLPA = settings.compensation && Number(settings.compensation.minLPA);
  if (lpa && minLPA > 0) {
    const s = lpa.max >= minLPA ? 100 : Math.round((lpa.max / minLPA) * 100);
    f.compensation = { score: s, note: `Up to ${lpa.max.toFixed(1)} LPA${lpa.approx ? ' (converted, approx.)' : ''} vs your minimum ${minLPA} LPA` };
  } else f.compensation = null;

  // Freshness from the posting date (or the discovery date when the posting date is unknown).
  const posted = toDay(job.listedAt);
  const basis = posted || toDay(job.foundOn);
  if (basis) {
    const d = Math.max(0, daysBetween(basis, ref));
    const s = d <= 1 ? 100 : d <= 3 ? 90 : d <= 7 ? 75 : d <= 14 ? 55 : d <= 30 ? 35 : 20;
    f.freshness = { score: s, note: `${posted ? 'Posted' : 'Found'} ${d === 0 ? 'today' : d + ' day' + (d === 1 ? '' : 's') + ' ago'}` };
  } else f.freshness = null;

  // Seniority
  const words = (settings.seniorityExclude || []).filter((w) => has(title.toLowerCase(), w));
  f.seniority = words.length ? { score: 20, note: `Title says “${words[0]}”` } : { score: 100, note: 'No seniority mismatch in the title' };

  // The scheduled search's own resume-based score, if it gave one.
  if (job.match != null && Number.isFinite(Number(job.match))) f.searchScore = { score: Number(job.match), note: 'Resume-based score from the scheduled job search' };
  else f.searchScore = null;

  const w = settings.weights || {};
  let sum = 0, wsum = 0, wall = 0;
  for (const k of Object.keys(FACTORS)) {
    const wk = Math.max(0, Number(w[k]) || 0);
    wall += wk;
    if (!f[k] || !wk) continue;
    sum += f[k].score * wk; wsum += wk;
  }
  const score = wsum ? Math.round(sum / wsum) : null;
  return { score, factors: f, coverage: wall ? Math.round((wsum / wall) * 100) : 0, role: role ? role.role.name : null };
}

export function matchBand(score) {
  if (score == null) return 'none';
  return score >= 80 ? 'high' : score >= 60 ? 'mid' : 'low';
}
