// Import pipeline: parse (CSV, JSON or the scheduled task's Markdown tables) → map columns →
// validate → plan against existing jobs (new / update / unchanged / duplicate / review) → ops.
// Planning is pure; the store executes the returned ops. Re-importing the same file plans
// only "unchanged" rows, so imports are idempotent.
import { parseCsv, str, isPlaceholder, safeUrl, today, toDay, uid, now } from './util.js';
import { cleanJobDoc, detectRegion, detectWorkMode, normalizeEmploymentType, normalizePlatform, jobIdFor } from './schema.js';
import { keysOf, findMatch } from './dedupe.js';

export const FIELDS = [
  { key: 'title', label: 'Job title', required: true, aliases: ['job title', 'title', 'role', 'position', 'designation', 'job', 'job name'] },
  { key: 'company', label: 'Company', required: true, aliases: ['company', 'company name', 'employer', 'organisation', 'organization', 'firm'] },
  { key: 'location', label: 'Location', aliases: ['location', 'city', 'place', 'job location', 'locations'] },
  { key: 'workMode', label: 'Work mode', aliases: ['work mode', 'mode', 'workplace', 'workplace type', 'remote', 'remote/hybrid', 'work type'] },
  { key: 'employmentType', label: 'Employment type', aliases: ['type', 'employment type', 'job type', 'employment'] },
  { key: 'experience', label: 'Experience', aliases: ['experience', 'exp', 'years of experience', 'experience required', 'yoe', 'experience (years)'] },
  { key: 'ctc', label: 'Salary / CTC', aliases: ['ctc', 'salary', 'ctc / salary', 'ctc/salary', 'compensation', 'pay', 'salary range', 'package'] },
  { key: 'listedAt', label: 'Posting date', aliases: ['posted', 'posted (ist)', 'posting date', 'date posted', 'posted on', 'posted on (ist)', 'listed', 'listedat', 'posted at', 'post date'] },
  { key: 'foundOn', label: 'Discovery date', aliases: ['discovered', 'discovery date', 'found on', 'foundon', 'date found', 'found'] },
  { key: 'deadline', label: 'Application deadline', aliases: ['deadline', 'apply by', 'application deadline', 'closing date', 'last date'] },
  { key: 'link', label: 'Job URL', aliases: ['link', 'url', 'apply link', 'job url', 'job link', 'original url', 'listing url', 'posting url'] },
  { key: 'applyUrl', label: 'Application URL', aliases: ['application url', 'apply url', 'application link'] },
  { key: 'source', label: 'Source platform', aliases: ['source', 'platform', 'site', 'portal', 'job board', 'source platform'] },
  { key: 'requisitionId', label: 'Job / requisition ID', aliases: ['job id', 'requisition id', 'req id', 'requisition', 'reqid', 'job code', 'jobid'] },
  { key: 'description', label: 'Description', aliases: ['description', 'summary', 'job description', 'jd', 'details'] },
  { key: 'skills', label: 'Required skills', aliases: ['skills', 'required skills', 'key skills'] },
  { key: 'match', label: 'Match % (from search)', aliases: ['match', 'match %', 'match score', 'score', 'match%', 'fit'] },
  { key: 'note', label: 'Search note', aliases: ['note', 'notes', 'comments', 'remarks', 'why'] },
  { key: 'status', label: 'Applied status', aliases: ['status', 'application status', 'applied'] },
  { key: 'appliedOn', label: 'Applied on', aliases: ['applied on', 'applied date', 'date applied', 'appliedon'] },
  { key: 'region', label: 'Region', aliases: ['region'] },
  { key: 'category', label: 'Role group', aliases: ['category', 'role group', 'group', 'bucket'] },
];
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));
const normHeader = (h) => str(h).toLowerCase().replace(/[_*`]/g, ' ').replace(/\s+/g, ' ').trim();

export function autoMap(headers) {
  const map = {};
  const used = new Set();
  for (const h of headers) {
    const n = normHeader(h);
    // Several columns may feed one field (e.g. "link" and "url"); the first non-empty value wins.
    let f = FIELDS.find((x) => x.key.toLowerCase() === n.replace(/ /g, ''))
      || FIELDS.find((x) => x.aliases.includes(n));
    map[h] = f ? f.key : '';
    if (f) used.add(f.key);
  }
  return map;
}

// ---------- parsing ----------

const MD_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s|)<>]+/;
function mdCell(c) {
  const s = str(c);
  let url = '';
  const text = s.replace(MD_LINK, (_, t, u) => { url = url || u; return t; }).replace(/\*\*|__|`/g, '').trim();
  if (!url) { const m = text.match(BARE_URL); if (m) url = m[0]; }
  return { text, url };
}
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // Split on pipes that are not escaped.
  return s.split(/(?<!\\)\|/).map((x) => x.replace(/\\\|/g, '|').trim());
}
function contextFrom(line) {
  const s = line.replace(/[#*_`>]/g, ' ').toLowerCase();
  const ctx = {};
  if (/\bpm roles?\b|product manager roles?/.test(s)) ctx.category = 'PM';
  if (/related roles?/.test(s)) ctx.category = 'Related';
  if (/\bindia\b/.test(s)) ctx.region = 'India';
  if (/international|intl/.test(s)) ctx.region = 'International';
  return ctx;
}

/** Markdown tables (as the scheduled task sends them). Rows from all tables are combined. */
export function parseMarkdownTables(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let headers = null, ctx = {}, allHeaders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) {
      headers = null;
      if (line.trim()) { const c = contextFrom(line); if (c.category || c.region) ctx = { ...ctx, ...c }; }
      continue;
    }
    const cells = splitRow(line);
    if (!headers) {
      const next = lines[i + 1] || '';
      if (/^\s*\|?\s*:?-{2,}/.test(next)) { headers = cells.map((c) => mdCell(c).text); for (const h of headers) if (!allHeaders.includes(h)) allHeaders.push(h); i++; }
      continue;
    }
    if (cells.every((c) => !c || /^-+$/.test(c))) continue;
    const row = {};
    headers.forEach((h, j) => {
      const { text, url } = mdCell(cells[j] || '');
      row[h] = text;
      if (url) row[h + '__url'] = url;
    });
    // A sub-heading row such as "| Past 7 days (top-up) | | |"
    const filled = Object.keys(row).filter((k) => !k.endsWith('__url') && row[k]);
    if (filled.length <= 1 && !Object.keys(row).some((k) => k.endsWith('__url'))) continue;
    row.__ctx = { ...ctx };
    out.push(row);
  }
  return { headers: allHeaders, rows: out };
}

/** Detects the format and returns {format, headers, rows: [object]} or {format:'backup'}. */
export function parseInput(text, fileName = '') {
  const s = String(text || '').replace(/^﻿/, '').trim();
  if (!s) throw new Error('The file or pasted text is empty.');
  const name = fileName.toLowerCase();
  if (name.endsWith('.json') || /^[[{]/.test(s)) {
    let data;
    try { data = JSON.parse(s); } catch (e) { throw new Error(`This is not valid JSON (${e.message}).`); }
    if (data && data.app === 'jobhunt-command-center') return { format: 'backup', backup: data };
    let list = Array.isArray(data) ? data : Array.isArray(data.jobs) ? data.jobs : Array.isArray(data.data) ? data.data : Array.isArray(data.results) ? data.results : null;
    if (!list && data && typeof data === 'object') list = Object.entries(data).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => ({ id, ...v }));
    if (!list) throw new Error('Expected a list of jobs, or an object with a "jobs" list.');
    const rows = list.filter((r) => r && typeof r === 'object').map((r) => (r.data && typeof r.data === 'object' && !r.title ? { id: r.id, ...r.data } : r));
    const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((h) => h !== 'id');
    return { format: 'json', headers, rows };
  }
  if (/^\s*\|.*\|\s*$/m.test(s) && /^\s*\|?\s*:?-{3,}/m.test(s)) {
    const md = parseMarkdownTables(s);
    if (md.rows.length) return { format: 'markdown', ...md };
  }
  const grid = parseCsv(s);
  if (grid.length < 2) throw new Error('Found a header row but no job rows.');
  const headers = grid[0].map((h, i) => str(h) || `Column ${i + 1}`);
  const rows = grid.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  return { format: 'csv', headers, rows };
}

// ---------- value parsing ----------

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
/** "16 Oct, 2:40 PM", "16 Oct, ~11 AM (approx)", "15 Oct (time not shown)", ISO, "2026-10-15". */
export function parsePosted(v, ref = now()) {
  const s = str(v);
  if (!s || isPlaceholder(s) || /not shown on posting/i.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { listedAt: s, listedTimeKnown: false };
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !Number.isNaN(Date.parse(s))) return { listedAt: s, listedTimeKnown: true };
  const rel = s.match(/(\d+)\s*(minute|min|hour|hr|day|week)s?\s*ago/i);
  if (rel) {
    const mult = { minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5 }[rel[2].toLowerCase()];
    const d = new Date(ref.getTime() - +rel[1] * mult);
    return /day|week/i.test(rel[2]) ? { listedAt: toDay(d), listedTimeKnown: false } : { listedAt: toIstIso(d), listedTimeKnown: true, approx: true };
  }
  const m = s.match(/(\d{1,2})\s*([a-z]{3,9})\.?,?\s*(\d{4})?/i) || null;
  const m2 = !m && s.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})?/i);
  let day, mon, year;
  if (m && MON[m[2].toLowerCase().slice(0, 4)] || m && MON[m[2].toLowerCase().slice(0, 3)]) { day = +m[1]; mon = MON[m[2].toLowerCase().slice(0, 3)]; year = m[3] && +m[3]; }
  else if (m2 && MON[m2[1].toLowerCase().slice(0, 3)]) { day = +m2[2]; mon = MON[m2[1].toLowerCase().slice(0, 3)]; year = m2[3] && +m2[3]; }
  else {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : { listedAt: toDay(new Date(t)), listedTimeKnown: false };
  }
  const refDay = toDay(ref);
  if (!year) {
    year = +refDay.slice(0, 4);
    const cand = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (cand > refDay) year -= 1; // "28 Dec" seen in January is last year
  }
  const date = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (tm && !/not shown/i.test(s)) {
    let h = +tm[1] % 12 + (/pm/i.test(tm[3]) ? 12 : 0);
    return { listedAt: `${date}T${String(h).padStart(2, '0')}:${tm[2] || '00'}:00+05:30`, listedTimeKnown: true, approx: /~|approx/i.test(s) };
  }
  return { listedAt: date, listedTimeKnown: false };
}
function toIstIso(d) {
  const ist = new Date(d.getTime() + 5.5 * 36e5);
  return ist.toISOString().slice(0, 16) + ':00+05:30';
}
function parseDate(v) {
  const p = parsePosted(v);
  return p ? toDay(p.listedAt) : '';
}

// ---------- row → job ----------

/** Turns one mapped row into a clean job draft with errors and warnings. */
export function rowToJob(raw, mapping, { defaultSource = '', ref = now() } = {}) {
  const v = {};
  for (const [h, key] of Object.entries(mapping)) {
    if (!key || !FIELD_KEYS.has(key)) continue;
    const val = raw[h];
    if (val == null || val === '') continue;
    if (v[key] == null || v[key] === '') v[key] = Array.isArray(val) ? val : typeof val === 'object' ? JSON.stringify(val) : String(val).trim();
    if (key === 'link' || key === 'applyUrl') { if (raw[h + '__url']) v[key] = raw[h + '__url']; }
  }
  // Markdown title cells often carry the link.
  if (!v.link) for (const h of Object.keys(mapping)) if (raw[h + '__url'] && mapping[h] === 'title') v.link = raw[h + '__url'];
  const errors = [], warnings = [];
  const job = {};
  job.title = str(v.title).replace(/^🆕\s*/, '');
  job.company = str(v.company);
  if (!job.title) errors.push('Missing job title');
  if (!job.company) errors.push('Missing company');
  if (isPlaceholder(job.title) && job.title) errors.push('Job title is a placeholder');

  const opt = (k) => (isPlaceholder(v[k]) ? '' : str(v[k]));
  job.location = opt('location');
  job.experience = opt('experience');
  job.ctc = opt('ctc');
  job.employmentType = normalizeEmploymentType(v.employmentType);
  job.workMode = detectWorkMode(v.workMode) || detectWorkMode(job.location);
  job.description = opt('description');
  job.requisitionId = opt('requisitionId');
  job.note = opt('note');
  if (v.skills) job.skills = (Array.isArray(v.skills) ? v.skills : String(v.skills).split(/[,;|]/)).map(str).filter(Boolean);

  for (const k of ['link', 'applyUrl']) {
    const raw = opt(k);
    if (!raw) continue;
    const u = safeUrl(raw);
    if (u) job[k] = u; else warnings.push(`${k === 'link' ? 'Job URL' : 'Application URL'} “${raw.slice(0, 40)}” is not a web link and was left out`);
  }
  job.source = normalizePlatform(v.source || defaultSource, job.link) || str(v.source || defaultSource);
  if (str(v.source) && job.source === 'Other') job.source = str(v.source);

  if (v.listedAt) {
    const p = parsePosted(v.listedAt, ref);
    if (!p) warnings.push(`Posting date “${v.listedAt}” was not understood`);
    else if (toDay(p.listedAt) > toDay(ref)) warnings.push(`Posting date ${toDay(p.listedAt)} is in the future and was left out`);
    else { job.listedAt = p.listedAt; job.listedTimeKnown = p.listedTimeKnown; if (p.approx) job.listedApprox = true; }
  }
  for (const k of ['foundOn', 'deadline', 'appliedOn']) {
    if (!v[k] || isPlaceholder(v[k])) continue;
    const d = parseDate(v[k]);
    if (d) job[k] = d; else warnings.push(`${k === 'foundOn' ? 'Discovery date' : k === 'deadline' ? 'Deadline' : 'Applied date'} “${v[k]}” was not understood`);
  }
  if (v.match != null && v.match !== '') {
    const n = Number(String(v.match).replace(/[%\s]/g, ''));
    if (Number.isFinite(n) && n >= 0 && n <= 100) job.match = Math.round(n);
    else warnings.push(`Match “${v.match}” is not a number from 0 to 100 and was left out`);
  }
  if (v.status) {
    const s = String(v.status);
    if (/applied/i.test(s) && !/not applied/i.test(s)) {
      job.status = 'Applied';
      const d = s.match(/\d{4}-\d{2}-\d{2}/) || s.match(/\(([^)]+)\)/);
      if (!job.appliedOn && d) job.appliedOn = parseDate(d[1] || d[0]) || '';
    } else if (/not applied/i.test(s)) job.status = 'Not applied';
  }
  const ctx = raw.__ctx || {};
  job.region = detectRegion(job.location, str(v.region) || ctx.region);
  const cat = str(v.category) || ctx.category || '';
  if (cat) job.category = /^pm$/i.test(cat) ? 'PM' : /related/i.test(cat) ? 'Related' : cat;
  for (const k of Object.keys(job)) if (job[k] === '' || job[k] == null) delete job[k];
  return { job, errors, warnings };
}

// ---------- planning ----------

const UPDATABLE = ['location', 'workMode', 'employmentType', 'experience', 'ctc', 'listedAt', 'listedTimeKnown', 'deadline', 'applyUrl', 'description', 'skills', 'requisitionId', 'match', 'region', 'category', 'note'];
const same = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '');

/** Fields a re-import would change on an existing job. Never touches title, company or your data. */
export function diffJob(existing, incoming, { fillOnly = false } = {}) {
  const changes = {};
  for (const k of UPDATABLE) {
    const nv = incoming[k];
    if (nv == null || nv === '' || (Array.isArray(nv) && !nv.length)) continue;
    // A copy from another platform only fills gaps; the original listing's details stay.
    if (fillOnly && existing[k] != null && existing[k] !== '' && !(k === 'match' && existing[k] === null)) continue;
    if (k === 'listedTimeKnown' && !incoming.listedAt) continue;
    if (!same(existing[k], nv)) changes[k] = [existing[k] ?? '', nv];
  }
  if (!existing.link && incoming.link) changes.link = ['', incoming.link];
  if (incoming.status === 'Applied' && existing.status !== 'Applied' && existing.statusSource !== 'You') {
    changes.status = [existing.status || '', 'Applied'];
    if (incoming.appliedOn) changes.appliedOn = [existing.appliedOn || '', incoming.appliedOn];
  }
  return changes;
}

/**
 * Plans an import. `existing` is an array of job docs ({id, ...}).
 * Returns rows: {index, job, errors, warnings, action, matchId, matchReason, changes}.
 * action ∈ new | update | unchanged | duplicate-in-file | review | invalid
 */
export function planImport(parsed, mapping, existing, opts = {}) {
  const pool = existing.map((j) => ({ id: j.id, job: j, keys: keysOf(j) }));
  const planned = [];
  const rows = parsed.rows.map((raw, index) => {
    const { job, errors, warnings } = rowToJob(raw, mapping, opts);
    const r = { index, job, errors, warnings, action: 'invalid' };
    if (errors.length) return r;
    const inFile = findMatch(job, planned);
    if (inFile && inFile.level === 'same') { r.action = 'duplicate-in-file'; r.matchReason = `${inFile.reason} as row ${inFile.id + 1}`; return r; }
    const m = findMatch(job, pool);
    if (m && m.level === 'same') {
      r.matchId = m.id; r.matchReason = m.reason;
      r.changes = diffJob(pool.find((p) => p.id === m.id).job, job, { fillOnly: m.reason !== 'Same listing URL' });
      r.action = Object.keys(r.changes).length ? 'update' : 'unchanged';
      r.extraSource = sourceDiffers(pool.find((p) => p.id === m.id).job, job);
    } else if (m && m.level === 'possible') {
      r.matchId = m.id; r.matchReason = m.reason; r.action = 'review';
    } else r.action = 'new';
    planned.push({ id: index, job, keys: keysOf(job) });
    return r;
  });
  const count = (a) => rows.filter((r) => r.action === a).length;
  return {
    rows,
    counts: { total: rows.length, new: count('new'), update: count('update'), unchanged: count('unchanged'), duplicateInFile: count('duplicate-in-file'), review: count('review'), invalid: count('invalid') },
  };
}
function sourceDiffers(a, b) {
  if (!b.link && !b.source) return null;
  if (b.link && a.link && keysOf(a).urls.includes(keysOf(b).urls[0])) return null;
  if (!b.link && b.source === a.source) return null;
  return { platform: b.source || '', link: b.link || '' };
}

/**
 * Turns a plan into store ops. decisions[index] for "review" rows: 'new' (default) | 'merge' | 'skip'.
 * Personal data (jobMeta notes, applications, tasks) is never replaced; jobMeta only gains history/sources.
 */
export function buildImportOps(plan, decisions, { existingById = {}, metaById = {}, importId = uid('imp_'), fileName = '', format = '', updateExisting = true } = {}) {
  const at = now().toISOString();
  const ops = [];
  const summary = { imported: 0, updated: 0, unchanged: 0, duplicates: 0, skipped: 0, failed: 0, review: 0 };
  const errors = [];
  const usedIds = new Set(Object.keys(existingById));
  const metaPatch = {};
  const touchMeta = (id) => (metaPatch[id] = metaPatch[id] || { history: [...((metaById[id] || {}).history || [])], sources: [...((metaById[id] || {}).sources || [])] });

  for (const r of plan.rows) {
    const decision = r.action === 'review' ? (decisions[r.index] || 'new') : null;
    if (r.action === 'invalid') { summary.failed++; errors.push(`Row ${r.index + 1}: ${r.errors.join('; ')}`); continue; }
    if (r.action === 'duplicate-in-file') { summary.duplicates++; continue; }
    if (r.action === 'unchanged') {
      summary.unchanged++;
      if (r.extraSource) addSource(touchMeta(r.matchId), r.extraSource, at);
      continue;
    }
    if (decision === 'skip') { summary.skipped++; continue; }
    if (r.action === 'update' || decision === 'merge') {
      const id = r.matchId;
      const changes = r.action === 'update' ? r.changes : diffJob(existingById[id] || {}, r.job, { fillOnly: true });
      if (decision === 'merge') addSource(touchMeta(id), { platform: r.job.source || '', link: r.job.link || '' }, at);
      if (!updateExisting || !Object.keys(changes).length) { summary.unchanged++; continue; }
      const data = { updatedAt: at, lastImportId: importId };
      for (const [k, [, nv]] of Object.entries(changes)) data[k] = nv;
      if (data.status) data.statusSource = 'Import';
      ops.push({ op: 'update', coll: 'jobs', id, data });
      const m = touchMeta(id);
      m.history.push({ at, type: 'import-update', importId, changes: Object.fromEntries(Object.entries(changes).map(([k, [o, n]]) => [k, [short(o), short(n)]])) });
      if (r.extraSource) addSource(m, r.extraSource, at);
      summary.updated++;
      continue;
    }
    // new
    let id = jobIdFor(r.job);
    while (usedIds.has(id)) id = id + '-' + Math.random().toString(36).slice(2, 5);
    usedIds.add(id);
    const doc = cleanJobDoc({
      status: 'Not applied', statusSource: 'Import', appliedOn: '',
      ...r.job,
      foundOn: r.job.foundOn || today(),
      origin: 'import', importId, createdAt: at, updatedAt: at,
    });
    if (doc.status === 'Applied') doc.statusSource = 'Import';
    if (r.action === 'review') touchMeta(id).possibleDuplicateOf = r.matchId;
    ops.push({ op: 'set', coll: 'jobs', id, data: doc });
    summary.imported++;
  }
  for (const [id, m] of Object.entries(metaPatch)) {
    m.history = m.history.slice(-50);
    ops.push({ op: 'merge', coll: 'jobMeta', id, data: { ...m, updatedAt: at } });
  }
  summary.review = plan.counts.review;
  const record = { at, fileName, format, total: plan.counts.total, ...summary, errors: errors.slice(0, 50) };
  ops.push({ op: 'set', coll: 'imports', id: importId, data: record });
  return { ops, summary, record };
}
function addSource(m, src, at) {
  if (!src || (!src.link && !src.platform)) return;
  if (m.sources.some((s) => (src.link && s.link === src.link) || (!src.link && s.platform === src.platform))) return;
  m.sources.push({ ...src, seenOn: at.slice(0, 10) });
}
const short = (v) => (typeof v === 'string' && v.length > 80 ? v.slice(0, 77) + '…' : v);
