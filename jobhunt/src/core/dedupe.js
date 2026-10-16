// Duplicate detection. A job can reach the tracker from several platforms; these
// helpers decide whether two records are the same opening.
//   'same'     → certain: same listing URL, or same requisition ID at the same company,
//                or same company + title + location.
//   'possible' → needs your review: same company and (nearly) the same title, but a
//                different or missing location. Never merged automatically.
import { str } from './util.js';

const COMPANY_SUFFIX = /\b(private|pvt|limited|ltd|llp|llc|inc|incorporated|corp|corporation|co|company|plc|gmbh|pte|sdn bhd|bhd|technologies|technology|tech|solutions|services|software|labs|india|global|group|holdings)\b/g;

export function normCompany(s) {
  return str(s).toLowerCase().replace(/&/g, ' and ').replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
}

const TITLE_ABBR = [
  [/\bsr\b\.?/g, 'senior'], [/\bjr\b\.?/g, 'junior'], [/\bmgr\b/g, 'manager'], [/\bpm\b/g, 'product manager'],
  [/\bapm\b/g, 'associate product manager'], [/\btpm\b/g, 'technical program manager'], [/\bpo\b/g, 'product owner'],
  [/\beng\b/g, 'engineer'], [/\bprogramme\b/g, 'program'], [/\bii\b/g, '2'], [/\biii\b/g, '3'], [/\bi\b/g, '1'],
];
export function normTitle(s) {
  // Bracketed text often names the team ("Product Manager (Payments)"), so it is kept.
  let t = str(s).toLowerCase().replace(/[–—]/g, '-');
  t = t.replace(/[^a-z0-9 ]+/g, ' ');
  for (const [re, rep] of TITLE_ABBR) t = t.replace(re, rep);
  return t.replace(/\b(full time|fulltime|permanent|remote|hybrid|onsite|on site|job|opening|hiring)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

const CITY_ALIASES = [[/bangalore/g, 'bengaluru'], [/gurgaon/g, 'gurugram'], [/new delhi/g, 'delhi'], [/delhi ncr|ncr/g, 'delhi'], [/bombay/g, 'mumbai']];
export function normLocation(s) {
  let t = str(s).toLowerCase().replace(/\(.*?\)/g, ' ');
  for (const [re, rep] of CITY_ALIASES) t = t.replace(re, rep);
  t = t.replace(/\b(india|hybrid|remote|on site|onsite|office|area|metropolitan|region)\b/g, ' ');
  return t.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ');
}

/** Canonical form of a listing URL: no tracking parameters; LinkedIn/Indeed ids extracted. */
export function normUrl(u) {
  const s = str(u);
  if (!s) return '';
  try {
    const url = new URL(s);
    const host = url.hostname.replace(/^www\.|^in\.|^m\./, '');
    const li = (url.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1] || url.searchParams.get('currentJobId');
    if (host.endsWith('linkedin.com') && li) return 'linkedin:' + li;
    const jk = url.searchParams.get('jk') || url.searchParams.get('vjk');
    if (host.endsWith('indeed.com') && jk) return 'indeed:' + jk;
    const keep = [...url.searchParams].filter(([k]) => /^(id|jobid|job_id|gh_jid|req|requisition|jid)$/i.test(k)).map(([k, v]) => `${k}=${v}`).sort();
    return (host + url.pathname.replace(/\/+$/, '')).toLowerCase() + (keep.length ? '?' + keep.join('&') : '');
  } catch { return s.toLowerCase(); }
}

export function normReq(s) { return str(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function tokens(s) { return new Set(s.split(' ').filter(Boolean)); }
export function titleSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Precomputed keys for fast comparison. */
export function keysOf(job) {
  return {
    company: normCompany(job.company),
    title: normTitle(job.title),
    location: normLocation(job.location),
    urls: [job.link, job.applyUrl, ...(job.sourceUrls || [])].map(normUrl).filter(Boolean),
    req: normReq(job.requisitionId),
  };
}

/** Compares two jobs: {level: 'same'|'possible'|null, reason}. */
export function compareJobs(a, b, ka = keysOf(a), kb = keysOf(b)) {
  if (ka.urls.length && kb.urls.length && ka.urls.some((u) => kb.urls.includes(u))) return { level: 'same', reason: 'Same listing URL' };
  if (!ka.company || ka.company !== kb.company) return { level: null };
  if (ka.req && kb.req) {
    return ka.req === kb.req ? { level: 'same', reason: 'Same requisition ID' } : { level: null };
  }
  const sim = ka.title === kb.title ? 1 : titleSimilarity(ka.title, kb.title);
  if (sim < 0.75) return { level: null };
  const bothLoc = ka.location && kb.location;
  // Two different listing ids on the same site are separate postings unless you merge them.
  const distinctListings = ka.urls.length && kb.urls.length && ka.urls.some((u) => kb.urls.some((v) => u.split(':')[0] === v.split(':')[0] && /^(linkedin|indeed):/.test(u)));
  if (sim === 1 && bothLoc && ka.location === kb.location && !distinctListings) return { level: 'same', reason: 'Same company, title and location' };
  if (sim === 1 && bothLoc && ka.location === kb.location) return { level: 'possible', reason: 'Same company, title and location, but a different listing' };
  if (bothLoc && ka.location !== kb.location) return { level: 'possible', reason: 'Same company and title, different location' };
  return { level: 'possible', reason: sim === 1 ? 'Same company and title' : 'Same company, very similar title' };
}

/** Finds the best existing match for `job` among `existing` [{id, job, keys}]. */
export function findMatch(job, existing) {
  const k = keysOf(job);
  let possible = null;
  for (const e of existing) {
    const r = compareJobs(job, e.job, k, e.keys);
    if (r.level === 'same') return { id: e.id, level: 'same', reason: r.reason };
    if (r.level === 'possible' && !possible) possible = { id: e.id, level: 'possible', reason: r.reason };
  }
  return possible;
}

/** Possible duplicate pairs among existing jobs, minus pairs you marked "not duplicates" and merged ones. */
export function duplicatePairs(jobs, metaById = {}) {
  const list = jobs.filter((j) => !(metaById[j.id] || {}).mergedInto).map((j) => ({ id: j.id, job: j, keys: keysOf(j) }));
  const byCompany = new Map();
  for (const e of list) { if (!e.keys.company) continue; (byCompany.get(e.keys.company) || byCompany.set(e.keys.company, []).get(e.keys.company)).push(e); }
  const pairs = [];
  for (const group of byCompany.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      const dismissed = ((metaById[a.id] || {}).notDuplicateOf || []).includes(b.id) || ((metaById[b.id] || {}).notDuplicateOf || []).includes(a.id);
      if (dismissed) continue;
      const r = compareJobs(a.job, b.job, a.keys, b.keys);
      if (r.level) pairs.push({ a: a.id, b: b.id, level: r.level, reason: r.reason });
    }
  }
  // URL matches across companies (rare: a re-posted listing under a renamed company).
  return pairs;
}
