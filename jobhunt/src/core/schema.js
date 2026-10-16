// Data model: constants, default settings and field parsers.
//
// Collections (one shared document store):
//   jobs/<id>          discovery facts. Written by the scheduled job search and by imports.
//   jobMeta/<jobId>    your own data about a job: favourite, shortlist, notes, verification, history.
//   applications/<id>  the application pipeline.
//   tasks/<id>         to-dos, linked to a job and/or an application.
//   imports/<id>       one record per manual import (history).
//   mailEvents/<gmailMessageId>  one hiring-related email: who/when/subject, what it means, what was done.
//   runs/<id>          one record per automation run (scheduled discovery, Gmail sync, engine).
//   system/<name>      automation state: gmail (last sync), discovery (last run), engine, schedule.
//   settings/main      preferences.
// Scheduled tasks write only `jobs`, `mailEvents`, `runs` and `system`, so nothing they do can overwrite your notes.
import { str, isPlaceholder, toDay, slug } from './util.js';

export const COLLECTIONS = ['jobs', 'jobMeta', 'applications', 'tasks', 'imports', 'mailEvents', 'runs', 'system', 'settings'];

export const STAGES = [
  'Discovered', 'To Review', 'Shortlisted', 'Ready to Apply', 'Applied', 'Assessment Pending',
  'Interview Scheduled', 'Interview Completed', 'Follow-up Required', 'Offer Received',
  'Rejected', 'Withdrawn', 'Closed',
];
export const PRE_APPLY_STAGES = ['Discovered', 'To Review', 'Shortlisted', 'Ready to Apply'];
export const IN_PROGRESS_STAGES = ['Applied', 'Assessment Pending', 'Interview Scheduled', 'Interview Completed', 'Follow-up Required'];
export const ENDED_STAGES = ['Rejected', 'Withdrawn', 'Closed'];
export const isActiveStage = (s) => !ENDED_STAGES.includes(s);
/** Stages that mean the application was really submitted. */
export const isSubmittedStage = (s) => !PRE_APPLY_STAGES.includes(s) && s !== 'Withdrawn';

export const STAGE_TONE = {
  Discovered: 'muted', 'To Review': 'muted', Shortlisted: 'accent', 'Ready to Apply': 'accent',
  Applied: 'info', 'Assessment Pending': 'warn', 'Interview Scheduled': 'warn', 'Interview Completed': 'info',
  'Follow-up Required': 'warn', 'Offer Received': 'good', Rejected: 'bad', Withdrawn: 'muted', Closed: 'muted',
};

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const JOB_PRIORITIES = ['Low', 'Medium', 'High'];
export const TASK_STATUSES = ['To Do', 'In Progress', 'Completed'];
export const TASK_CATEGORIES = ['Review', 'Resume', 'Application', 'Assessment', 'Research', 'Interview prep', 'Networking', 'Follow-up', 'Thank-you', 'Other'];
export const VERIFICATION = ['Unverified', 'Verified open', 'Possibly expired', 'Closed'];
export const WORK_MODES = ['Remote', 'Hybrid', 'On-site'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
export const EXPERIENCE_LEVELS = ['Entry (0–1 yrs)', 'Early (1–3 yrs)', 'Mid (3–6 yrs)', 'Senior (6+ yrs)', 'Not stated'];

export const PLATFORMS = ['LinkedIn', 'Naukri', 'Indeed', 'Wellfound', 'Instahyre', 'Cutshort', 'Foundit', 'Dice', 'ZipRecruiter', 'Glassdoor', 'iimjobs', 'Hirist', 'startup.jobs', 'Company careers page', 'Referral', 'Other'];

export const DEFAULT_ROLES = [
  { name: 'Product Manager', keywords: ['product manager', 'product owner'], priority: 1 },
  { name: 'Technical Product Manager', keywords: ['technical product manager', 'technical product owner'], priority: 1 },
  { name: 'Associate Product Manager', keywords: ['associate product manager', 'apm'], priority: 1 },
  { name: 'Product Operations Analyst', keywords: ['product operations analyst', 'product ops analyst'], priority: 2 },
  { name: 'Product Operations Manager', keywords: ['product operations manager', 'product ops manager', 'product operations'], priority: 2 },
  { name: 'Product Analyst', keywords: ['product analyst'], priority: 2 },
  { name: 'Program Manager', keywords: ['program manager', 'programme manager'], priority: 2 },
  { name: 'Technical Program Manager', keywords: ['technical program manager', 'technical programme manager', 'tpm'], priority: 2 },
  { name: 'Solutions Engineer', keywords: ['solutions engineer', 'solution engineer', 'solutions consultant', 'solution consultant', 'presales', 'pre sales', 'forward deployed engineer', 'customer product engineer'], priority: 2 },
  { name: 'Business Analyst', keywords: ['business analyst'], priority: 3 },
  { name: 'Technical Consultant', keywords: ['technical consultant', 'technical account manager', 'technology account management', 'customer success'], priority: 2 },
  { name: 'Product Implementation Manager', keywords: ['implementation manager', 'implementation specialist', 'implementation engineer', 'implementation consultant', 'integration engineer', 'integration specialist', 'implementation'], priority: 2 },
];

export const INDIA_CITIES = ['bengaluru', 'bangalore', 'gurugram', 'gurgaon', 'delhi', 'new delhi', 'ncr', 'noida', 'mumbai', 'navi mumbai', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'kochi', 'chandigarh', 'indore', 'coimbatore', 'thane', 'mohali', 'india'];

export function defaultSettings() {
  return {
    schema: 1,
    targetRoles: DEFAULT_ROLES.map((r, i) => ({ id: 'r' + (i + 1), ...r })),
    locations: ['Bengaluru', 'Gurugram', 'Delhi NCR', 'Noida', 'Mumbai', 'Pune', 'Hyderabad', 'Chennai', 'India', 'Remote'],
    workModes: { Remote: true, Hybrid: true, 'On-site': true },
    experienceYears: 3,
    seniorityExclude: ['senior', 'sr', 'lead', 'principal', 'staff', 'head', 'director', 'vp', 'vice president', 'chief'],
    skills: ['product strategy', 'roadmap', 'prd', 'prioritisation', 'kpi', 'agile', 'go-to-market', 'user research', 'api', 'webhook', 'payments', 'fintech', 'integration', 'sql', 'tableau', 'jira', 'postman', 'analytics', 'stakeholder'],
    compensation: { minLPA: null },
    fxToINR: { USD: 85, SGD: 65, AED: 23, MYR: 19, EUR: 95, GBP: 112 },
    weights: { role: 25, skills: 15, experience: 20, location: 15, compensation: 5, freshness: 10, seniority: 10, searchScore: 15 },
    defaults: { applicationStage: 'Applied', taskPriority: 'Medium', followUpDays: 7, jobPriority: 'Medium' },
    importPrefs: { updateExisting: true, defaultSource: '' },
    automation: {
      autoTasks: true, autoMerge: true, minConfidence: 0.6, reviewTaskThreshold: 85, reviewTasksPerRun: 5,
      relevanceThreshold: 70, gmailLookbackDays: 45, syncGmailOnOpen: true, watchCompanies: [],
    },
    theme: 'dark',
  };
}

/** Fills gaps in stored settings from the defaults (new fields added later). */
export function mergeSettings(stored) {
  const d = defaultSettings();
  if (!stored || typeof stored !== 'object') return d;
  const out = { ...d, ...stored };
  for (const k of ['workModes', 'compensation', 'fxToINR', 'weights', 'defaults', 'importPrefs', 'automation']) out[k] = { ...d[k], ...(stored[k] || {}) };
  if (!Array.isArray(out.targetRoles)) out.targetRoles = d.targetRoles;
  if (!Array.isArray(out.locations)) out.locations = d.locations;
  if (!Array.isArray(out.skills)) out.skills = d.skills;
  if (!Array.isArray(out.seniorityExclude)) out.seniorityExclude = d.seniorityExclude;
  if (!Array.isArray(out.automation.watchCompanies)) out.automation.watchCompanies = [];
  return out;
}

// ---------- parsers ----------

/** "2–3 yrs", "2+ years", "1 to 3", "Min 4 years" → {min, max}. Unknown → null. */
export function parseExperience(text) {
  const s = str(text).toLowerCase();
  if (!s || isPlaceholder(s) || /not (shown|stated)/.test(s)) return null;
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/);
  if (m) return { min: +m[1], max: +m[2] };
  m = s.match(/(\d+(?:\.\d+)?)\s*\+/) || s.match(/(?:min(?:imum)?|at least|over)\s*(\d+(?:\.\d+)?)/) || s.match(/(\d+(?:\.\d+)?)\s*(?:yrs?|years?)/);
  if (m) return { min: +m[1], max: null };
  if (/fresher|entry|no experience/.test(s)) return { min: 0, max: 1 };
  return null;
}
export function experienceLevel(exp) {
  if (!exp) return 'Not stated';
  const m = exp.min;
  if (m < 1) return EXPERIENCE_LEVELS[0];
  if (m < 3) return EXPERIENCE_LEVELS[1];
  if (m < 6) return EXPERIENCE_LEVELS[2];
  return EXPERIENCE_LEVELS[3];
}

const CURRENCIES = [
  [/₹|\binr\b|\brs\.?\s|\blpa\b|\blakhs?\b|\bcrores?\b/i, 'INR'],
  [/\bs\$|\bsgd\b/i, 'SGD'],
  [/\baed\b|\bdhs?\b/i, 'AED'],
  [/\bmyr\b|\brm\s?\d/i, 'MYR'],
  [/€|\beur\b/i, 'EUR'],
  [/£|\bgbp\b/i, 'GBP'],
  [/\$|\busd\b/i, 'USD'],
];
/** "₹20–30 LPA", "SGD 6,000–8,000/month", "$120k" → {currency, min, max, period} (annual amounts). */
export function parseComp(text) {
  const s = str(text);
  if (!s || isPlaceholder(s)) return null;
  const cur = (CURRENCIES.find(([re]) => re.test(s)) || [null, null])[1];
  const lower = s.toLowerCase();
  const nums = [...lower.replace(/,/g, '').matchAll(/(\d+(?:\.\d+)?)\s*(k|m|l|lpa|lakhs?|lacs?|cr|crores?)?/g)]
    .map((m) => {
      let n = +m[1];
      const u = m[2] || '';
      if (u === 'k') n *= 1e3;
      else if (u === 'm') n *= 1e6;
      else if (/^(l|lpa|lakhs?|lacs?)$/.test(u)) n *= 1e5;
      else if (/^(cr|crores?)$/.test(u)) n *= 1e7;
      return n;
    })
    .filter((n) => n > 0);
  if (!nums.length) return null;
  let [min, max] = nums.length > 1 ? [nums[0], nums[1]] : [nums[0], nums[0]];
  // "20-30 LPA": the unit is written once, after the second number.
  if (/lpa|lakh|lac/.test(lower) && min < 1000 && max >= 1e5) min *= 1e5;
  if (/\d\s*k\b/.test(lower) && min < 1000 && max >= 1000) min *= 1e3;
  const monthly = /per month|\/\s?mo|\/\s?month|monthly|p\.?m\.?\b|a month/.test(lower);
  if (monthly) { min *= 12; max *= 12; }
  if (min > max) [min, max] = [max, min];
  if (min < 1000) return null; // a bare small number is not a salary
  return { currency: cur || (/lpa|lakh/.test(lower) ? 'INR' : null), min, max, period: monthly ? 'month' : 'year' };
}
/** Annual INR (lakhs) using the approximate rates in Settings. null if not comparable. */
export function compLPA(comp, fx = {}) {
  if (!comp || !comp.currency) return null;
  const rate = comp.currency === 'INR' ? 1 : fx[comp.currency];
  if (!rate) return null;
  return { min: (comp.min * rate) / 1e5, max: (comp.max * rate) / 1e5, approx: comp.currency !== 'INR' };
}

export function detectWorkMode(...texts) {
  const s = texts.map(str).join(' ').toLowerCase();
  if (/hybrid/.test(s)) return 'Hybrid';
  if (/remote|work from home|\bwfh\b|anywhere/.test(s)) return 'Remote';
  if (/on-?site|in-?office|office based|work from office|\bwfo\b/.test(s)) return 'On-site';
  return '';
}
export function detectRegion(location, given) {
  if (given === 'India' || given === 'International') return given;
  const s = str(location).toLowerCase();
  if (!s) return '';
  if (INDIA_CITIES.some((c) => new RegExp(`\\b${c}\\b`).test(s))) return 'India';
  if (/remote/.test(s) && /india/.test(s)) return 'India';
  return 'International';
}
export function normalizeEmploymentType(t) {
  const s = str(t).toLowerCase();
  if (!s || isPlaceholder(s)) return '';
  if (/full|permanent|fte/.test(s)) return 'Full-time';
  if (/part/.test(s)) return 'Part-time';
  if (/contract|c2c|freelance/.test(s)) return 'Contract';
  if (/intern/.test(s)) return 'Internship';
  if (/temp/.test(s)) return 'Temporary';
  return str(t);
}
/** Maps a free-text source to a known platform name. */
export function normalizePlatform(src, link = '') {
  const s = (str(src) + ' ' + str(link)).toLowerCase();
  const table = [
    ['linkedin', 'LinkedIn'], ['naukri', 'Naukri'], ['indeed', 'Indeed'], ['wellfound', 'Wellfound'], ['angel.co', 'Wellfound'],
    ['instahyre', 'Instahyre'], ['cutshort', 'Cutshort'], ['foundit', 'Foundit'], ['monster', 'Foundit'], ['dice', 'Dice'],
    ['ziprecruiter', 'ZipRecruiter'], ['glassdoor', 'Glassdoor'], ['iimjobs', 'iimjobs'], ['hirist', 'Hirist'],
    ['startup.jobs', 'startup.jobs'], ['referral', 'Referral'],
    ['careers', 'Company careers page'], ['lever.co', 'Company careers page'], ['greenhouse', 'Company careers page'],
    ['workday', 'Company careers page'], ['ashby', 'Company careers page'], ['smartrecruiters', 'Company careers page'],
  ];
  for (const [k, v] of table) if (s.includes(k)) return v;
  return str(src) ? 'Other' : '';
}

/** The best target role for a title, or null. Longest keyword wins; ties go to higher priority. */
export function classifyRole(title, roles) {
  const t = ' ' + str(title).toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  let best = null;
  for (const r of roles || []) {
    for (const kw of r.keywords || []) {
      const k = str(kw).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!k || !t.includes(' ' + k + ' ')) continue;
      if (!best || k.length > best.len || (k.length === best.len && (r.priority || 3) < (best.role.priority || 3))) best = { role: r, len: k.length, keyword: kw };
    }
  }
  return best;
}

/** Normalises a job document from any writer (scheduled task, import, manual) to one shape. */
export function cleanJobDoc(d) {
  const o = { ...d };
  for (const k of ['title', 'company', 'location', 'experience', 'employmentType', 'ctc', 'link', 'applyUrl', 'source', 'note', 'description', 'requisitionId', 'workMode', 'region', 'category', 'status', 'statusSource', 'appliedOn', 'foundOn', 'listedAt', 'deadline']) {
    if (o[k] != null && typeof o[k] !== 'string') o[k] = String(o[k]);
  }
  if (o.match != null && o.match !== '') { const n = Number(o.match); o.match = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null; } else o.match = null;
  if (o.skills && !Array.isArray(o.skills)) o.skills = String(o.skills).split(/[,;|]/).map((x) => x.trim()).filter(Boolean);
  return o;
}

export function jobIdFor(job) {
  const base = slug(`${job.company}-${job.title}`, 70) || 'job';
  const key = job.link || job.requisitionId || job.location || '';
  return `${base}-${String(Math.abs(hashCode(key))).slice(-5).padStart(5, '0')}`;
}
function hashCode(s) { let h = 0; for (const c of String(s)) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0; return h; }

export const dayOf = toDay;
