import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStore, taskJob } from './helpers.js';
import * as A from '../src/core/actions.js';
import { buildModel } from '../src/core/model.js';
import { kpis, series, rangeFor, filterTasks, calendarEvents, conversion } from '../src/core/metrics.js';
import { makeBackup, validateBackup, planRestore, planDeleteAll, jobsCsv, appsCsv } from '../src/core/backup.js';
import { suggestForStage, suggestForInterview, attentionItems } from '../src/core/suggestions.js';
import { Store, LocalAdapter } from '../src/core/store.js';
import { scoreJob } from '../src/core/matching.js';
import { defaultSettings, parseComp, parseExperience, classifyRole } from '../src/core/schema.js';
import { compareJobs, normUrl, duplicatePairs } from '../src/core/dedupe.js';
import { freshnessOf } from '../src/core/freshness.js';
import { parseCsv } from '../src/core/util.js';

const seed = () => ({
  jobs: {
    j1: taskJob(),
    j2: taskJob({ title: 'Solutions Engineer', company: 'Byte Rail', link: 'https://www.linkedin.com/jobs/view/4400000002/', location: 'Remote', category: 'Related', source: 'LinkedIn', foundOn: '2026-10-10', listedAt: '2026-10-09' }),
    j3: taskJob({ title: 'Senior Director of Product', company: 'Mega Corp', link: 'https://in.indeed.com/viewjob?jk=zz9', source: 'Indeed', foundOn: '2026-10-01', listedAt: '2026-09-01', location: 'London', region: 'International', match: 40 }),
  },
});

test('8. search and filters return the right records (model fields)', async () => {
  const { store } = await newStore(seed());
  const m = buildModel(store.state);
  const byRole = m.jobs.filter((j) => j.role === 'Solutions Engineer');
  assert.deepEqual(byRole.map((j) => j.id), ['j2']);
  assert.deepEqual(m.jobs.filter((j) => j.platform === 'Indeed').map((j) => j.id), ['j3']);
  assert.deepEqual(m.jobs.filter((j) => j.workMode === 'Remote').map((j) => j.id), ['j2']);
  assert.deepEqual(m.jobs.filter((j) => j.region === 'International').map((j) => j.id), ['j3']);
  const j1 = m.jobById.j1;
  assert.ok(j1.score > m.jobById.j3.score, 'better fit scores higher');
  assert.ok(m.jobById.j3.fresh.labels.some((l) => l.key === 'expired'), 'old unverified posting flagged possibly expired');
  assert.notEqual(m.jobById.j3.fresh.verification, 'Closed', 'age alone never closes a job');
});

test('9–10. add a job to the tracker and change its status', async () => {
  const { store } = await newStore(seed());
  await assert.rejects(A.createApplication(store, { jobId: 'j1', stage: 'Applied' }), /date you applied/);
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Shortlisted' });
  assert.equal(store.get('jobs', 'j1').status, 'Not applied', 'shortlisting does not mark applied');
  assert.ok(store.get('jobs', 'j1').title, 'original job record kept');
  await assert.rejects(A.moveStage(store, id, 'Applied'), /date you applied/);
  await A.moveStage(store, id, 'Applied', { appliedOn: '2026-10-16' });
  const a = store.get('applications', id);
  assert.equal(a.stage, 'Applied');
  assert.equal(a.appliedOn, '2026-10-16');
  assert.equal(store.get('jobs', 'j1').status, 'Applied');
  assert.equal(store.get('jobs', 'j1').statusSource, 'You', 'scheduled search will not overwrite it');
});

test('11. moves through Kanban stages with timestamped history', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-14' });
  for (const s of ['Assessment Pending', 'Interview Scheduled', 'Interview Completed', 'Offer Received']) await A.moveStage(store, id, s);
  const h = store.get('applications', id).history;
  assert.deepEqual(h.filter((x) => x.type === 'stage').map((x) => x.to), ['Assessment Pending', 'Interview Scheduled', 'Interview Completed', 'Offer Received']);
  assert.ok(h.every((x) => /^\d{4}-\d{2}-\d{2}T/.test(x.at)));
  assert.equal(await A.moveStage(store, id, 'Offer Received'), false, 'no-op move is ignored');
});

test('12. prevents duplicate applications to the same requisition, allows other roles at the company', async () => {
  const { store } = await newStore(seed());
  await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-14' });
  await assert.rejects(A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-15' }), (e) => !!e.duplicate);
  await assert.rejects(A.createApplication(store, { company: 'Acme Pay Pvt Ltd', title: 'Product Manager - Payments', stage: 'Shortlisted' }), (e) => !!e.duplicate);
  await A.createApplication(store, { company: 'Acme Pay', title: 'Data Analyst', stage: 'Shortlisted' });
  const r1 = await A.createApplication(store, { company: 'Kappa', title: 'PM', requisitionId: 'R-1', stage: 'Shortlisted' });
  await A.createApplication(store, { company: 'Kappa', title: 'PM', requisitionId: 'R-2', stage: 'Shortlisted' });
  await assert.rejects(A.createApplication(store, { company: 'Kappa', title: 'Product Manager', requisitionId: 'r 1', stage: 'Shortlisted' }), (e) => e.duplicate.id === r1);
  await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-15' }, { force: true });
  assert.equal(store.all('applications').length, 5);
});

test('13. notes, interviews and activity history are preserved through edits', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-14', notes: 'Referred by Priya' });
  await A.saveItem(store, id, 'interviews', { round: 'Round 1 – PM screen', date: '2026-10-20', time: '15:00' });
  await A.updateApplication(store, id, { notes: 'Referred by Priya. HM is Ravi.', recruiter: { name: 'Asha', email: 'asha@example.com' } });
  await A.moveStage(store, id, 'Interview Scheduled');
  const iv = store.get('applications', id).interviews[0];
  await A.saveItem(store, id, 'interviews', { ...iv, notes: 'Case on UPI autopay', status: 'Done' });
  const a = store.get('applications', id);
  assert.equal(a.notes, 'Referred by Priya. HM is Ravi.');
  assert.equal(a.recruiter.name, 'Asha');
  assert.equal(a.interviews.length, 1);
  assert.equal(a.interviews[0].notes, 'Case on UPI autopay');
  assert.deepEqual(a.history.map((h) => h.type), ['created', 'interview', 'edit', 'stage', 'interview']);
});

test('14. follow-up dates show as due', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-08', followUpDate: '2026-10-15' });
  await A.createApplication(store, { jobId: 'j2', stage: 'Applied', appliedOn: '2026-10-15', followUpDate: '2026-10-22' });
  const m = buildModel(store.state);
  assert.deepEqual(m.apps.filter((a) => a.followUpDue).map((a) => a.id), [id]);
  assert.equal(kpis(m, null).followUpsDue, 1);
  assert.ok(attentionItems(m).some((x) => x.kind === 'followup' && x.appId === id));
  const s = suggestForStage(m.appById[id], 'Applied', m.settings);
  assert.equal(s[0].category, 'Follow-up');
  assert.equal(s[0].dueDate, '2026-10-16', 'past due suggestion moves to today');
});

test('15–16. create, complete, edit and reschedule a task', async () => {
  const { store } = await newStore();
  await assert.rejects(A.createTask(store, { title: '  ' }), /title/);
  const id = await A.createTask(store, { title: 'Tailor resume for Acme', dueDate: '2026-10-17', priority: 'High', category: 'Resume' });
  let t = store.get('tasks', id);
  assert.equal(t.status, 'To Do');
  assert.ok(t.createdAt);
  await A.updateTask(store, id, { title: 'Tailor resume for Acme Pay', description: 'Lead with UPI work' });
  await A.rescheduleTask(store, id, '2026-10-18', '09:30');
  t = store.get('tasks', id);
  assert.equal(t.dueDate, '2026-10-18');
  assert.equal(t.dueTime, '09:30');
  await A.completeTask(store, id);
  t = store.get('tasks', id);
  assert.equal(t.status, 'Completed');
  assert.ok(t.completedAt);
  await A.completeTask(store, id, false);
  assert.equal(store.get('tasks', id).completedAt, '');
});

test('17. overdue, today, this week and completed views', async () => {
  const { store } = await newStore();
  await A.createTask(store, { title: 'old', dueDate: '2026-10-10' });
  await A.createTask(store, { title: 'now', dueDate: '2026-10-16' });
  await A.createTask(store, { title: 'soon', dueDate: '2026-10-18' });
  await A.createTask(store, { title: 'later', dueDate: '2026-11-30' });
  const done = await A.createTask(store, { title: 'done', dueDate: '2026-10-09' });
  await A.completeTask(store, done);
  const tasks = store.all('tasks');
  const titles = (v) => filterTasks(tasks, v, '2026-10-16').map((t) => t.title);
  assert.deepEqual(titles('overdue'), ['old']);
  assert.deepEqual(titles('today'), ['now']);
  assert.deepEqual(titles('week'), ['now', 'soon']);
  assert.deepEqual(titles('upcoming'), ['soon', 'later']);
  assert.deepEqual(titles('completed'), ['done']);
  assert.equal(titles('all').length, 4);
});

test('18–19. tasks link to jobs/applications; interviews and assessments appear on the calendar', async () => {
  const { store } = await newStore(seed());
  const app = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-14' });
  await A.saveItem(store, app, 'assessments', { title: 'Product case study', due: '2026-10-18' });
  await A.saveItem(store, app, 'interviews', { round: 'Hiring manager', date: '2026-10-21', time: '11:00' });
  const m0 = buildModel(store.state);
  const sug = suggestForInterview(m0.appById[app], m0.appById[app].interviews[0]);
  assert.equal(sug[1].dueDate, '2026-10-20', 'prep due the day before');
  await A.createTask(store, { ...sug[1], origin: 'suggestion' });
  await store.merge('jobMeta', 'j2', { deadline: '2026-10-19' });
  const m = buildModel(store.state);
  const t = m.tasks[0];
  assert.equal(t.appId, app);
  assert.equal(t.jobId, 'j1');
  const ev = calendarEvents(m);
  const types = ev.map((e) => `${e.type}:${e.date}`);
  assert.ok(types.includes('assessment:2026-10-18'));
  assert.ok(types.includes('interview:2026-10-21'));
  assert.ok(types.includes('deadline:2026-10-19'));
  assert.ok(types.includes('task:2026-10-20'));
  assert.equal(kpis(m, null).assessmentsPending, 1);
  assert.equal(kpis(m, null).interviewsScheduled, 1);
});

test('20–21. KPIs and chart data follow the records', async () => {
  const { store } = await newStore(seed());
  let m = buildModel(store.state);
  let k = kpis(m, rangeFor('all'));
  assert.equal(k.discovered, 3);
  assert.equal(k.newToday, 1);
  assert.equal(k.submitted, 0);
  assert.equal(k.awaitingReview, 3);
  await A.setShortlisted(store, 'j2', true, 'Remote + API work');
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-15' });
  await A.moveStage(store, id, 'Rejected');
  m = buildModel(store.state);
  k = kpis(m, rangeFor('all'));
  assert.equal(k.shortlisted, 1);
  assert.equal(k.submitted, 1);
  assert.equal(k.rejections, 1);
  assert.equal(k.awaitingReview, 1);
  assert.equal(kpis(m, rangeFor('today')).discovered, 1);
  const s = series(m, rangeFor('30d'));
  assert.equal(s.appsOverTime.reduce((n, x) => n + x.value, 0), 1);
  assert.deepEqual(s.byPlatform.map((x) => x.label).sort(), ['Indeed', 'LinkedIn']);
  assert.equal(s.funnel.find((f) => f.label === 'Applied').value, 1);
  assert.equal(conversion(m, null)[3].pct, 100);
  const empty = buildModel((await newStore()).store.state);
  assert.equal(kpis(empty, null).discovered, 0);
  assert.equal(series(empty, null).byPlatform.length, 0);
});

test('22. export and restore a backup (merge keeps newer data and history; replace mirrors it)', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'j1', stage: 'Applied', appliedOn: '2026-10-15', notes: 'keep me' });
  await A.createTask(store, { title: 'Follow up', appId: id });
  const backup = JSON.parse(JSON.stringify(makeBackup(store)));
  const v = validateBackup(backup);
  assert.ok(v.ok, v.errors.join());
  assert.equal(v.counts.applications, 1);
  const { store: fresh } = await newStore();
  const plan = planRestore(backup, fresh, 'merge');
  await fresh.runOps(plan.ops);
  assert.equal(fresh.all('jobs').length, 3);
  assert.equal(fresh.get('applications', id).notes, 'keep me');
  // Merge into a store where the app moved on: the newer state and both histories survive.
  await A.moveStage(fresh, id, 'Interview Scheduled');
  const again = planRestore(backup, fresh, 'merge');
  await fresh.runOps(again.ops);
  assert.equal(fresh.get('applications', id).stage, 'Interview Scheduled');
  assert.equal(fresh.get('applications', id).history.length, 2);
  const extra = await A.createTask(fresh, { title: 'not in backup' });
  const rep = planRestore(backup, fresh, 'replace');
  assert.ok(rep.counts.remove >= 1);
  await fresh.runOps(rep.ops);
  assert.equal(fresh.get('tasks', extra), undefined);
  assert.equal(fresh.get('applications', id).stage, 'Applied');
  assert.ok(!validateBackup({ app: 'other' }).ok);
  assert.ok(!validateBackup({ ...backup, collections: { jobs: [{ id: '../x', title: 'a', company: 'b' }] } }).ok);
  await fresh.runOps(planDeleteAll(fresh));
  assert.equal(fresh.all('jobs').length + fresh.all('tasks').length, 0);
});

test('CSV exports are well-formed and guard against formula injection', async () => {
  const { store } = await newStore({ jobs: { x: taskJob({ title: '=HYPERLINK("bad")', note: 'a, "quoted"\nline' }) } });
  await A.createApplication(store, { jobId: 'x', stage: 'Applied', appliedOn: '2026-10-15' });
  const m = buildModel(store.state);
  const rows = parseCsv(jobsCsv(m.jobs));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][0], `'=HYPERLINK("bad")`);
  assert.ok(rows[1].includes('a, "quoted"\nline'));
  assert.equal(parseCsv(appsCsv(m.apps))[1][2], 'Applied');
});

test('23. data survives a reload (new store on the same storage)', async () => {
  const { store, storage } = await newStore(seed());
  const id = await A.createTask(store, { title: 'Persist me' });
  await A.setJobNotes(store, 'j1', 'note');
  const reloaded = new Store(new LocalAdapter(storage));
  await reloaded.start();
  assert.equal(reloaded.get('tasks', id).title, 'Persist me');
  assert.equal(reloaded.get('jobMeta', 'j1').notes, 'note');
  assert.equal(reloaded.all('jobs').length, 3);
});

test('24. a failed save is reported and rolled back, never shown as saved', async () => {
  const { store } = await newStore();
  store.adapter.s.setItem = () => { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  const errors = [];
  store.onError((e) => errors.push(e));
  await assert.rejects(A.createTask(store, { title: 'x' }), /storage space/);
  assert.equal(store.all('tasks').length, 0);
  assert.equal(errors[0].code, 'quota_exceeded');
});

test('matching: transparent factors, missing data excluded, weights respected', () => {
  const s = defaultSettings();
  const r = scoreJob(taskJob(), s, '2026-10-16');
  assert.ok(r.score >= 80);
  assert.equal(r.factors.skills, null, 'no description → skills factor left out');
  assert.equal(r.factors.compensation, null, 'salary not disclosed → left out');
  assert.equal(r.role, 'Product Manager');
  const senior = scoreJob(taskJob({ title: 'Senior Product Manager', experience: '8+ yrs', match: null }), s, '2026-10-16');
  assert.ok(senior.score < r.score);
  const onlyRole = scoreJob(taskJob({ title: 'Business Analyst' }), { ...s, weights: { role: 1 } }, '2026-10-16');
  assert.equal(onlyRole.score, 70);
  assert.equal(scoreJob({ title: 'x' }, { ...s, weights: {} }).score, null);
});

test('parsers: salary, experience, role classification', () => {
  assert.deepEqual(parseComp('₹18–25 LPA'), { currency: 'INR', min: 1.8e6, max: 2.5e6, period: 'year' });
  assert.equal(parseComp('SGD 6,000 – 8,000 / month').max, 96000);
  assert.equal(parseComp('$120k–$150k').min, 120000);
  assert.equal(parseComp('Not disclosed'), null);
  assert.deepEqual(parseExperience('2–3 yrs'), { min: 2, max: 3 });
  assert.deepEqual(parseExperience('2+ years'), { min: 2, max: null });
  assert.equal(parseExperience('Not shown in listing'), null);
  const roles = defaultSettings().targetRoles;
  assert.equal(classifyRole('Technical Product Manager – Payments', roles).role.name, 'Technical Product Manager');
  assert.equal(classifyRole('Associate Product Manager / Product Manager', roles).role.name, 'Associate Product Manager');
  assert.equal(classifyRole('TPM, Enterprise', roles).role.name, 'Technical Program Manager');
  assert.equal(classifyRole('Chef', roles), null);
});

test('duplicates: URLs normalise, ambiguous pairs need review, dismissals stick', () => {
  assert.equal(normUrl('https://in.linkedin.com/jobs/view/product-manager-at-acme-4400000001?trk=x'), 'linkedin:4400000001');
  assert.equal(normUrl('https://www.linkedin.com/jobs/view/4400000001/'), 'linkedin:4400000001');
  const a = taskJob(), b = taskJob({ link: 'https://naukri.com/x', location: 'Singapore' });
  assert.equal(compareJobs(a, b).level, 'possible');
  assert.equal(compareJobs(a, taskJob({ link: '', title: 'Product Manager - Payments', company: 'ACME PAY Private Limited' })).level, 'same');
  assert.equal(compareJobs(a, taskJob({ link: '', requisitionId: '1', title: 'Product Manager – Payments' }), undefined, undefined).level, 'same');
  const jobs = [{ id: 'a', ...a }, { id: 'b', ...b }];
  assert.equal(duplicatePairs(jobs).length, 1);
  assert.equal(duplicatePairs(jobs, { a: { notDuplicateOf: ['b'] } }).length, 0);
});

test('team names in brackets and separate listing ids are not merged automatically', () => {
  const a = taskJob({ title: 'Product Manager (Platforms)', company: 'Monetary Authority', location: 'Singapore' });
  const b = taskJob({ title: 'Product Manager (Trust Framework)', company: 'Monetary Authority', location: 'Singapore', link: 'https://www.linkedin.com/jobs/view/4400000777/' });
  assert.equal(compareJobs(a, b).level, null);
  const c = taskJob({ link: 'https://www.linkedin.com/jobs/view/4400000555/' });
  assert.equal(compareJobs(taskJob(), c).level, 'possible', 'same title/place but another LinkedIn id needs review');
});

test('merge duplicates moves applications and keeps both sources', async () => {
  const { store } = await newStore({ jobs: { a: taskJob(), b: taskJob({ link: 'https://naukri.com/x', source: 'Naukri', location: 'Bengaluru' }) } });
  const app = await A.createApplication(store, { jobId: 'b', stage: 'Shortlisted' });
  await A.mergeJobs(store, 'a', 'b');
  const m = buildModel(store.state);
  assert.ok(m.jobById.b.hidden);
  assert.equal(store.get('applications', app).jobId, 'a');
  assert.equal(store.get('jobMeta', 'a').sources[0].link, 'https://naukri.com/x');
  assert.equal(m.dupPairs.length, 0);
});

test('freshness labels never claim a job is closed without your input', () => {
  const f = freshnessOf({ listedAt: '2026-01-01', foundOn: '2026-01-02' }, {}, '2026-10-16');
  assert.ok(f.labels.some((l) => l.key === 'expired'));
  assert.ok(!f.labels.some((l) => l.key === 'closed'));
  const v = freshnessOf({ listedAt: '2026-01-01' }, { verification: 'Verified open', lastVerifiedAt: '2026-10-15' }, '2026-10-16');
  assert.ok(v.labels.some((l) => l.key === 'verified'));
  assert.ok(!v.labels.some((l) => l.key === 'expired'));
  const d = freshnessOf({ foundOn: '2026-10-16' }, { deadline: '2026-10-17' }, '2026-10-16');
  assert.ok(d.labels.some((l) => l.key === 'deadline-soon'));
  assert.ok(d.labels.some((l) => l.key === 'new'));
});

test('30. no paid service or network dependency in the core', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/', import.meta.url);
  const files = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(new URL(e.name + '/', d)) : [new URL(e.name, d)]));
  for (const f of files(dir).filter((u) => u.pathname.endsWith('.js'))) {
    const code = readFileSync(f, 'utf8');
    assert.ok(!/fetch\(|XMLHttpRequest|api[_-]?key|apikey|secret/i.test(code), `${f.pathname} must not call external services`);
  }
});
