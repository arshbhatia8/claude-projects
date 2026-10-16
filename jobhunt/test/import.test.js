import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStore, taskJob, CSV } from './helpers.js';
import { parseInput, autoMap, planImport, buildImportOps, parsePosted, parseMarkdownTables } from '../src/core/importer.js';
import * as A from '../src/core/actions.js';

async function runImport(store, text, fileName = 'jobs.csv', decisions = {}) {
  const parsed = parseInput(text, fileName);
  const mapping = autoMap(parsed.headers);
  const existing = store.all('jobs');
  const plan = planImport(parsed, mapping, existing);
  const { ops, summary, record } = buildImportOps(plan, decisions, {
    existingById: Object.fromEntries(existing.map((j) => [j.id, j])),
    metaById: Object.fromEntries(store.all('jobMeta').map((m) => [m.id, m])),
    fileName, format: parsed.format,
  });
  await store.runOps(ops);
  return { parsed, mapping, plan, summary, record };
}

test('1. imports jobs from a valid CSV file', async () => {
  const { store } = await newStore();
  const { summary, mapping } = await runImport(store, CSV);
  assert.equal(mapping['Job Title'], 'title');
  assert.equal(mapping['Job ID'], 'requisitionId');
  assert.equal(summary.imported, 3);
  const jobs = store.all('jobs');
  assert.equal(jobs.length, 3);
  const n = jobs.find((j) => j.company === 'Nimbus Labs');
  assert.equal(n.source, 'Naukri');
  assert.equal(n.requisitionId, 'REQ-77');
  assert.equal(n.listedAt, '2026-10-14');
  assert.equal(n.workMode, 'Remote');
  assert.equal(n.ctc, '₹18–25 LPA');
  const o = jobs.find((j) => j.company === 'Orbit Finance');
  assert.equal(o.ctc, undefined, 'placeholder salary is not stored as a value');
  assert.equal(store.all('imports').length, 1);
});

test('2. imports jobs from a valid JSON file (task-shaped and plain)', async () => {
  const { store } = await newStore();
  const json = JSON.stringify([taskJob(), { title: 'Solutions Engineer', company: 'Zeta Cloud', location: 'Singapore', url: 'https://boards.greenhouse.io/zeta/jobs/55', platform: 'Company careers page' }]);
  const { summary, parsed } = await runImport(store, json, 'jobs.json');
  assert.equal(parsed.format, 'json');
  assert.equal(summary.imported, 2);
  const z = store.all('jobs').find((j) => j.company === 'Zeta Cloud');
  assert.equal(z.region, 'International');
  assert.equal(z.link, 'https://boards.greenhouse.io/zeta/jobs/55');
});

test('3. missing or invalid fields are handled safely', async () => {
  const { store } = await newStore();
  const text = `title,company,link,posted,match
,No Title Inc,https://x.com/1,2026-10-01,50
Data PM,,https://x.com/2,2026-10-01,50
Growth PM,Valid Co,javascript:alert(1),2027-12-01,140
`;
  const { summary, plan } = await runImport(store, text);
  assert.equal(summary.failed, 2);
  assert.equal(summary.imported, 1);
  const v = store.all('jobs')[0];
  assert.equal(v.link, undefined, 'unsafe link dropped');
  assert.equal(v.listedAt, undefined, 'future posting date dropped');
  assert.equal(v.match, null, 'out-of-range match dropped');
  assert.ok(plan.rows[2].warnings.length >= 3);
  assert.match(plan.rows[0].errors[0], /title/i);
});

test('4. import summary counts are accurate', async () => {
  const { store } = await newStore();
  const dupRow = 'Product Manager,Nimbus Labs,Pune (Remote),Naukri,2026-10-14,₹18–25 LPA,2-4 years,https://www.naukri.com/job-listings-pm-nimbus-123,REQ-77\n';
  const bad = ',Missing title,,,,,,,\n';
  const { summary, record } = await runImport(store, CSV + dupRow + bad);
  assert.deepEqual({ i: summary.imported, d: summary.duplicates, f: summary.failed }, { i: 3, d: 1, f: 1 });
  assert.equal(record.total, 5);
  assert.equal(record.errors.length, 1);
});

test('5. detects duplicate jobs across platforms', async () => {
  const { store } = await newStore({ jobs: { 'acme-pm': taskJob() } });
  // Same job seen on Naukri: same company + title + city → certain duplicate, new source recorded
  const text = `title,company,location,source,link\nProduct Manager - Payments,Acme Pay Pvt Ltd,"Bangalore, India",Naukri,https://www.naukri.com/acme-pm-1\nProduct Manager – Payments,Acme Pay,Singapore,LinkedIn,https://www.linkedin.com/jobs/view/4400000999/\n`;
  const { plan, summary } = await runImport(store, text);
  assert.equal(plan.rows[0].action, 'unchanged');
  assert.equal(plan.rows[0].matchId, 'acme-pm');
  assert.equal(plan.rows[1].action, 'review', 'different location is only a possible duplicate');
  assert.equal(summary.imported, 1, 'possible duplicate imported as new by default, never discarded');
  const meta = store.get('jobMeta', 'acme-pm');
  assert.equal(meta.sources[0].platform, 'Naukri');
});

test('6. re-importing the same data does not create duplicates', async () => {
  const { store } = await newStore();
  await runImport(store, CSV);
  const second = await runImport(store, CSV);
  assert.equal(second.summary.imported, 0);
  assert.equal(second.summary.unchanged, 3);
  assert.equal(store.all('jobs').length, 3);
  const md = `## PM roles · India\n| # | Posted (IST) | Job Title | Company | Location | Experience | Type | CTC / Salary | Match % | Status | Apply Link |\n|---|---|---|---|---|---|---|---|---|---|---|\n| 🆕 1 | 15 Oct, 4:45 PM | Product Manager – Payments | Acme Pay | Bengaluru (Hybrid) | 2–3 yrs | Full-time | Not disclosed | 88% | Not applied | [Apply](https://www.linkedin.com/jobs/view/4400000001/) |\n`;
  const a = await runImport(store, md, 'paste.md');
  const b = await runImport(store, md, 'paste.md');
  assert.equal(a.summary.imported, 1);
  assert.equal(b.summary.imported, 0);
  assert.equal(store.all('jobs').length, 4);
});

test('7. updating matching jobs keeps application, notes and history', async () => {
  const { store } = await newStore({ jobs: { 'acme-pm': taskJob() } });
  await A.setJobNotes(store, 'acme-pm', 'Ask about the UPI team');
  const appId = await A.createApplication(store, { jobId: 'acme-pm', stage: 'Applied', appliedOn: '2026-10-15' });
  const text = `title,company,location,link,salary,experience\nProduct Manager – Payments,Acme Pay,Bengaluru (Hybrid),https://www.linkedin.com/jobs/view/4400000001/,₹30–40 LPA,2–4 yrs\n`;
  const { plan, summary } = await runImport(store, text);
  assert.equal(plan.rows[0].action, 'update');
  assert.equal(summary.updated, 1);
  const job = store.get('jobs', 'acme-pm');
  assert.equal(job.ctc, '₹30–40 LPA');
  assert.equal(job.status, 'Applied', 'status you set is not overwritten');
  assert.equal(job.statusSource, 'You');
  const meta = store.get('jobMeta', 'acme-pm');
  assert.equal(meta.notes, 'Ask about the UPI team');
  assert.ok(meta.history.some((h) => h.type === 'import-update' && h.changes.ctc));
  const app = store.get('applications', appId);
  assert.equal(app.stage, 'Applied');
  assert.equal(app.history.length, 1);
});

test('parses the scheduled task Markdown tables with headings, links and dates', () => {
  const md = `Jobs · 16 Oct
### PM roles · International
| # | Posted (IST) | Job Title | Company | Location | Experience | Type | CTC / Salary | Match % | Status | Apply Link |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 16 Oct, ~11 AM (approx) | PM – Wallet | Lion Bank | Singapore | 2–4 yrs | Full-time | SGD 8,000/month | 81% | Applied ✓ (2026-10-14) | [Link](https://careers.lionbank.sg/job/42) |
| | **Past 7 days (top-up)** | | | | | | | | | |
| 2 | 12 Oct (time not shown) | Product Owner | Dune Co | Dubai | 3 yrs | Not stated | Not disclosed | 70% | Not applied | https://dune.example/jobs/7 |
`;
  const p = parseMarkdownTables(md);
  assert.equal(p.rows.length, 2);
  const parsed = { rows: p.rows, headers: p.headers };
  const plan = planImport(parsed, autoMap(p.headers), []);
  const [a, b] = plan.rows.map((r) => r.job);
  assert.equal(a.category, 'PM');
  assert.equal(a.region, 'International');
  assert.equal(a.link, 'https://careers.lionbank.sg/job/42');
  assert.equal(a.listedAt, '2026-10-16T11:00:00+05:30');
  assert.equal(a.status, 'Applied');
  assert.equal(a.appliedOn, '2026-10-14');
  assert.equal(b.listedAt, '2026-10-12');
  assert.equal(b.listedTimeKnown, false);
});

test('parsePosted handles relative and year-less dates', () => {
  const ref = new Date('2026-01-05T10:00:00+05:30');
  assert.equal(parsePosted('28 Dec', ref).listedAt, '2025-12-28');
  assert.equal(parsePosted('3 days ago', ref).listedAt, '2026-01-02');
  assert.equal(parsePosted('Not shown on posting', ref), null);
});

test('field mapping can be overridden for unusual headers', async () => {
  const text = 'Role Name,Org,Where\nProduct Analyst,Quill,Hyderabad\n';
  const parsed = parseInput(text, 'x.csv');
  const auto = autoMap(parsed.headers);
  assert.equal(auto['Role Name'], '');
  const plan = planImport(parsed, { 'Role Name': 'title', Org: 'company', Where: 'location' }, []);
  assert.equal(plan.rows[0].action, 'new');
  assert.equal(plan.rows[0].job.location, 'Hyderabad');
});
