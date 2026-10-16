import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newStore, taskJob } from './helpers.js';
import { planAutomation, interpret, companyMatches } from '../src/core/engine.js';
import { runEngine, syncGmail, cleanBody } from '../src/core/automation.js';
import { classifyEmail, gmailQuery } from '../src/core/mail.js';
import * as A from '../src/core/actions.js';
import { buildModel } from '../src/core/model.js';
import { kpis } from '../src/core/metrics.js';

const NOW = '2026-10-16T10:00:00+05:30';
const ev = (id, o) => ({ messageId: id, threadId: 't' + id, receivedAt: '2026-10-15T09:00:00Z', capturedAt: NOW, capturedBy: 'test', ...o });
const run = async (store) => { const r = await runEngine(store, { by: 'test' }); return r; };

const MAIL = {
  appliedAcme: ev('m1', { from: 'Acme Pay Recruiting <no-reply@greenhouse.io>', subject: 'Thank you for applying to Acme Pay!', excerpt: 'Hi Arsh, thank you for applying for the Product Manager – Payments role at Acme Pay. We have received your application and will be in touch.' }),
  assessAcme: ev('m2', { receivedAt: '2026-10-16T03:00:00Z', from: 'talent@acmepay.com', subject: 'Acme Pay | Next step: online assessment', excerpt: 'Hi Arsh, as the next step for the Product Manager – Payments position, please complete the HackerRank assessment by 20 October 2026, 11:59 PM IST.' }),
  interviewAcme: ev('m3', { receivedAt: '2026-10-16T04:00:00Z', from: 'Priya at Acme Pay <priya@acmepay.com>', subject: 'Interview invitation – Product Manager – Payments', excerpt: 'We would like to invite you to an interview for the Product Manager – Payments role at Acme Pay on 22 Oct 2026 at 3:30 PM IST via Google Meet.' }),
  rejectAcme: ev('m4', { receivedAt: '2026-10-16T05:00:00Z', from: 'careers@acmepay.com', subject: 'Update on your application', excerpt: 'Thank you for your interest in Acme Pay. Unfortunately, we have decided to move forward with other candidates for the Product Manager – Payments position.' }),
  spam: ev('s1', { from: 'sanjoli.raj@freshersindia.in', subject: 'Final Reminder: Request for Complete Registration', snippet: 'We recently received your resume, and we appreciate your interest in joining our team.', excerpt: 'Dear [[name]],\nWe recently received your resume, and we appreciate your interest in joining our team. However, it appears that some crucial details are missing from your submission.\nTo ensure that we can thoroughly evaluate your application, we kindly requet you to please provide Complete 90% Profile to invite the interview (Mandatory)\nHR Team\nNote: If you don\'t want Email Alerts from us you can unsubscribe with the below option.' }),
  card: ev('s2', { from: 'donotreply@mybobcard.co.in', subject: 'Arsh, 5 days left: your pre-approved card and 1,000 points', snippet: 'Pre-filled application. Opt in by 20 Oct. Your pre-approved Lifetime Free card is waiting.', excerpt: 'Pre-filled application. Opt in by 20 Oct. A quick reminder: your pre-approved Lifetime Free card with an additional credit limit is waiting. Unsubscribe' }),
  alert: ev('s3', { from: 'jobalerts-noreply@linkedin.com', subject: '30+ new Product Manager jobs in Bengaluru', snippet: 'Jobs you may be interested in. Apply now.', excerpt: 'New jobs for you: Product Manager at Acme Pay. Apply now. Unsubscribe' }),
};

const seed = (extra = {}) => ({
  jobs: { acme: taskJob(), byte: taskJob({ title: 'Solutions Engineer', company: 'Byte Rail', link: 'https://www.linkedin.com/jobs/view/4400000002/', category: 'Related' }) },
  ...extra,
});

test('3. a Gmail application confirmation creates the application for the matching job', async () => {
  const { store } = await newStore(seed({ mailEvents: { m1: MAIL.appliedAcme } }));
  const r = await run(store);
  assert.equal(r.counts.applied, 1);
  const app = store.all('applications')[0];
  assert.equal(app.jobId, 'acme');
  assert.equal(app.stage, 'Applied');
  assert.equal(app.appliedOn, '2026-10-15');
  assert.equal(app.stageSource, 'gmail');
  assert.equal(app.history[0].messageId, 'm1');
  assert.equal(store.get('jobs', 'acme').status, 'Applied');
  const ev1 = store.get('mailEvents', 'm1');
  assert.equal(ev1.result.status, 'applied');
  assert.equal(ev1.excerpt, '', 'email body excerpt is dropped after processing');
  const fu = store.get('tasks', 'auto-fu-m1');
  assert.ok(fu, 'follow-up task created from the follow-up rule');
  assert.equal(fu.dueKind, 'suggested');
  assert.equal(fu.dueDate, '2026-10-22');
  assert.equal(store.get('applications', app.id).followUpDate, '2026-10-22');
});

test('3b. a confirmation moves an existing shortlisted application to Applied', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'acme', stage: 'Shortlisted' });
  await store.set('mailEvents', 'm1', MAIL.appliedAcme);
  await run(store);
  const a = store.get('applications', id);
  assert.equal(a.stage, 'Applied');
  assert.equal(a.appliedOn, '2026-10-15');
  assert.equal(store.all('applications').length, 1, 'no second application');
});

test('4–6. assessment, interview and rejection emails update stage, dates and tasks', async () => {
  const { store } = await newStore(seed({ mailEvents: { m1: MAIL.appliedAcme } }));
  await run(store);
  await store.set('mailEvents', 'm2', MAIL.assessAcme);
  await run(store);
  let a = store.all('applications')[0];
  assert.equal(a.stage, 'Assessment Pending');
  assert.equal(a.assessments[0].due, '2026-10-20');
  assert.equal(a.assessments[0].time, '23:59');
  const at = store.get('tasks', 'auto-as-m2');
  assert.equal(at.dueKind, 'confirmed');
  assert.equal(at.dueDate, '2026-10-20');
  await store.set('mailEvents', 'm3', MAIL.interviewAcme);
  await run(store);
  a = store.all('applications')[0];
  assert.equal(a.stage, 'Interview Scheduled');
  assert.deepEqual([a.interviews[0].date, a.interviews[0].time], ['2026-10-22', '15:30']);
  assert.equal(store.get('tasks', 'auto-prep-m3').dueDate, '2026-10-21');
  assert.equal(store.get('tasks', 'auto-ty-m3').dueDate, '2026-10-23');
  await store.set('mailEvents', 'm4', MAIL.rejectAcme);
  await run(store);
  a = store.all('applications')[0];
  assert.equal(a.stage, 'Rejected');
  assert.equal(store.get('tasks', 'auto-prep-m3').status, 'Completed', 'open auto tasks close on rejection');
  assert.deepEqual(a.history.filter((h) => h.type === 'stage').map((h) => h.to), ['Assessment Pending', 'Interview Scheduled', 'Rejected']);
  assert.ok(a.history.every((h) => h.at));
});

test('7. unrelated emails (job-board spam, card offer, job alert) change nothing', async () => {
  const { store } = await newStore(seed({ mailEvents: { s1: MAIL.spam, s2: MAIL.card, s3: MAIL.alert } }));
  const id = await A.createApplication(store, { jobId: 'acme', stage: 'Shortlisted' });
  const before = JSON.stringify(store.get('applications', id));
  const r = await run(store);
  assert.equal(r.counts.ignored, 3);
  assert.equal(JSON.stringify(store.get('applications', id)), before);
  assert.equal(store.all('applications').length, 1);
  assert.equal(store.all('tasks').filter((t) => t.source && t.source.kind === 'gmail').length, 0);
  for (const s of ['s1', 's2', 's3']) assert.equal(store.get('mailEvents', s).result.status, 'ignored');
});

test('8. an ambiguous email is flagged, then applied after you choose', async () => {
  const { store } = await newStore(seed());
  const a1 = await A.createApplication(store, { company: 'Acme Pay', title: 'Product Manager – Payments', stage: 'Applied', appliedOn: '2026-10-10' });
  const a2 = await A.createApplication(store, { company: 'Acme Pay', title: 'Data Analyst', stage: 'Applied', appliedOn: '2026-10-11' });
  await store.set('mailEvents', 'x1', ev('x1', { from: 'careers@acmepay.com', subject: 'Your application', excerpt: 'Thank you for your interest in Acme Pay. Unfortunately, we will not be moving forward with your application.' }));
  await run(store);
  const e = store.get('mailEvents', 'x1');
  assert.equal(e.result.status, 'review');
  assert.match(e.result.reason, /2 applications at/);
  assert.deepEqual([store.get('applications', a1).stage, store.get('applications', a2).stage], ['Applied', 'Applied']);
  await A.resolveEvent(store, 'x1', { action: 'app', appId: a2 });
  await run(store);
  assert.equal(store.get('applications', a2).stage, 'Rejected');
  assert.equal(store.get('applications', a1).stage, 'Applied');
  assert.equal(store.get('mailEvents', 'x1').result.status, 'applied');
  // An email with no company at all also goes to review.
  await store.set('mailEvents', 'x2', ev('x2', { from: 'no-reply@greenhouse.io', subject: 'Thank you for your application', excerpt: 'Thank you for your application. We will review it shortly.' }));
  await run(store);
  assert.equal(store.get('mailEvents', 'x2').result.status, 'review');
});

test('9. reprocessing is idempotent: no duplicate events, history or tasks', async () => {
  const { store } = await newStore(seed({ mailEvents: { m1: MAIL.appliedAcme, m3: MAIL.interviewAcme } }));
  await run(store);
  const snap = JSON.stringify([store.all('applications'), store.all('tasks')]);
  const again = planAutomation(store.state, { nowIso: '2026-10-16T11:00:00+05:30' });
  assert.equal(again.ops.length, 0, 'second pass plans nothing');
  // Even if a processed marker is lost, the message id in history prevents a repeat.
  await A.reprocessEvent(store, 'm3');
  await run(store);
  const apps = store.all('applications');
  assert.equal(apps.length, 1);
  assert.equal(apps[0].history.filter((h) => h.messageId === 'm3').length, 1);
  assert.equal(apps[0].interviews.length, 1);
  assert.equal(JSON.stringify([store.all('applications').map((a) => a.stage), store.all('tasks').length]), JSON.stringify([JSON.parse(snap)[0].map((a) => a.stage), JSON.parse(snap)[1].length]));
});

test('10. your notes and history survive synchronisation; newer manual changes win', async () => {
  const { store } = await newStore(seed());
  const id = await A.createApplication(store, { jobId: 'acme', stage: 'Applied', appliedOn: '2026-10-14', notes: 'Referred by Priya' });
  await A.setJobNotes(store, 'acme', 'Ask about UPI');
  await A.moveStage(store, id, 'Withdrawn'); // after the email below arrived
  await store.set('mailEvents', 'm3', MAIL.interviewAcme);
  await run(store);
  const a = store.get('applications', id);
  assert.equal(a.notes, 'Referred by Priya');
  assert.equal(store.get('jobMeta', 'acme').notes, 'Ask about UPI');
  assert.equal(a.stage, 'Withdrawn', 'your newer manual stage is not overridden');
  assert.ok(a.history.some((h) => h.type === 'created') && a.history.some((h) => h.to === 'Withdrawn'));
});

test('terminal stages are protected: a later interview email after a rejection is flagged', async () => {
  const { store } = await newStore(seed({ mailEvents: { m4: { ...MAIL.rejectAcme, receivedAt: '2026-10-14T05:00:00Z' } } }));
  const id = await A.createApplication(store, { jobId: 'acme', stage: 'Applied', appliedOn: '2026-10-10' });
  await store.update('applications', id, { stageChangedAt: '2026-10-10T00:00:00Z' });
  await run(store);
  assert.equal(store.get('applications', id).stage, 'Rejected');
  await store.set('mailEvents', 'm3', MAIL.interviewAcme);
  await run(store);
  assert.equal(store.get('applications', id).stage, 'Rejected');
  assert.equal(store.get('mailEvents', 'm3').result.status, 'review');
});

test('2. certain duplicate jobs merge automatically; possible ones wait for review', async () => {
  const { store } = await newStore({ jobs: {
    a: taskJob({ foundOn: '2026-10-14' }),
    b: taskJob({ source: 'Naukri', link: 'https://www.linkedin.com/jobs/view/4400000001/?trk=x', foundOn: '2026-10-16' }),
    c: taskJob({ location: 'Singapore', link: 'https://careers.acme.example/42' }),
  } });
  await A.setJobNotes(store, 'b', 'note on b');
  const r = await run(store);
  assert.equal(r.counts.merged, 1);
  assert.equal(store.get('jobMeta', 'b').mergedInto, 'a');
  assert.match(store.get('jobMeta', 'a').notes, /note on b/);
  const m = buildModel(store.state);
  assert.equal(m.jobs.filter((j) => !j.hidden).length, 2);
  assert.equal(m.dupPairs.length, 1, 'the Singapore listing stays a possible duplicate for you');
  assert.equal(planAutomation(store.state).counts.merged, 0, 'merging is not repeated');
});

test('8b. best new matches get one review task each, never twice', async () => {
  const { store } = await newStore(seed());
  const r = await run(store);
  assert.ok(r.counts.reviewTasks >= 1);
  const t = store.get('tasks', 'auto-review-acme');
  assert.ok(t && t.source.kind === 'discovery');
  await A.deleteTask(store, 'auto-review-acme');
  await run(store);
  assert.equal(store.get('tasks', 'auto-review-acme'), undefined, 'a task you deleted is not recreated');
});

test('recruiter outreach and marketing never count as an application', async () => {
  const { store } = await newStore(seed({ mailEvents: { r1: ev('r1', { from: 'Neha <neha@talentfirm.in>', subject: 'Exciting opportunity', excerpt: 'Hi Arsh, I came across your profile and have an exciting PM opportunity at a fintech. Are you open to a chat?' }) } }));
  await run(store);
  assert.equal(store.all('applications').length, 0);
  assert.equal(store.get('mailEvents', 'r1').result.status, 'ignored');
});

test('scheduled-reader hints help only when the rules agree or a clear match exists', () => {
  const base = { from: 'x@acmepay.com', subject: 'Hello', excerpt: 'Quick note about next week.' };
  const p = interpret({ ...base, hint: { type: 'interview', company: 'Acme Pay', confidence: 0.9 } });
  assert.equal(p.type, 'interview');
  assert.ok(p.needsExistingMatch && p.confidence <= 0.7);
  const c = interpret({ ...MAIL.card, hint: { type: 'applied', company: 'Bob', confidence: 0.9 } });
  assert.ok(c.conflict, 'rules say promotion, hint says application → review');
  assert.ok(companyMatches('PayU Payments Pvt Ltd', 'PayU'));
  assert.ok(!companyMatches('Zeta', 'Zepto'));
});

test('classifier: confirmations, dates and look-alikes', () => {
  const li = classifyEmail({ from: 'jobs-noreply@linkedin.com', subject: 'Arsh, your application was sent to Razorpay', excerpt: 'Your application was sent to Razorpay\nProduct Manager - Payments\nRazorpay · Bengaluru\n', receivedAt: '2026-10-14T10:00:00Z' });
  assert.deepEqual([li.type, li.company, li.role], ['applied', 'Razorpay', 'Product Manager - Payments']);
  const multi = classifyEmail({ from: 'hr@zeta.tech', subject: 'Interview invitation', excerpt: 'We invite you to an interview for the Product Manager role at Zeta. Please pick a slot: 21 Oct 2026 at 11 AM or 22 Oct 2026 at 3 PM.', receivedAt: '2026-10-15T10:00:00Z' });
  assert.equal(multi.type, 'interview');
  assert.equal(multi.interviewDate, '', 'several options → no date recorded');
  const rel = classifyEmail({ from: 'talent@kappa.com', subject: 'Assignment', excerpt: 'Please complete the case study assignment for the Product Analyst role within 3 days.', receivedAt: '2026-10-15T10:00:00Z' });
  assert.deepEqual([rel.type, rel.deadline], ['assessment', '2026-10-18']);
  for (const m of [MAIL.spam, MAIL.card, MAIL.alert]) assert.ok(['marketing', 'other'].includes(classifyEmail(m).type), m.subject);
  assert.match(gmailQuery('2026-10-10'), /after:2026\/10\/10/);
  assert.equal(cleanBody('Thanks!\n> quoted\nOn Mon, 1 Jan 2026 at 10:00, A <a@b.c> wrote:\nold text'), 'Thanks!');
});

// ---------- Gmail sync (connector stand-in) ----------
function fakeGmail(messages, { failWith } = {}) {
  const calls = [];
  const call = async (tool, input) => {
    calls.push({ tool, input });
    if (failWith) { const e = new Error('x'); e.code = failWith; throw e; }
    if (tool === 'search_threads') {
      const threads = {};
      for (const m of messages) (threads[m.threadId] = threads[m.threadId] || { id: m.threadId, messages: [] }).messages.push({ id: m.id, threadId: m.threadId, date: m.date, sender: m.sender, subject: m.subject, snippet: m.snippet, labelIds: m.labelIds || ['INBOX'] });
      return { threads: Object.values(threads) };
    }
    if (tool === 'get_thread') return { id: input.threadId, messages: messages.filter((m) => m.threadId === input.threadId) };
    throw new Error('unexpected tool ' + tool);
  };
  return { call, calls };
}

test('Gmail sync: stores new hiring mail once, uses read-only tools, incremental query', async () => {
  const { store } = await newStore(seed());
  const msgs = [
    { id: 'g1', threadId: 'T1', date: '2026-10-15T09:00:00Z', sender: 'Acme Pay Recruiting <no-reply@greenhouse.io>', subject: 'Thank you for applying to Acme Pay!', snippet: 'Thank you for applying', plaintextBody: MAIL.appliedAcme.excerpt },
    { id: 'g2', threadId: 'T2', date: '2026-10-15T10:00:00Z', sender: 'donotreply@mybobcard.co.in', subject: MAIL.card.subject, snippet: MAIL.card.snippet, plaintextBody: MAIL.card.excerpt },
    { id: 'g3', threadId: 'T1', date: '2026-10-15T11:00:00Z', sender: 'me@example.com', subject: 'Re: Thank you', snippet: 'my reply', labelIds: ['SENT'] },
  ];
  const g = fakeGmail(msgs);
  const r1 = await syncGmail(store, g.call, { by: 'test' });
  assert.ok(r1.ok);
  assert.deepEqual(new Set(g.calls.map((c) => c.tool)), new Set(['search_threads', 'get_thread']));
  assert.ok(store.get('mailEvents', 'g1') && store.get('mailEvents', 'g2'));
  assert.equal(store.get('mailEvents', 'g3'), undefined, 'your own sent mail is skipped');
  assert.equal(store.get('mailEvents', 'g2').excerpt, '', 'no body kept for promotions');
  assert.equal(store.get('system', 'gmail').lastMessageDay, '2026-10-15');
  const g2 = fakeGmail(msgs);
  const r2 = await syncGmail(store, g2.call, { by: 'test' });
  assert.equal(r2.counts.stored, 0, 'second sync stores nothing new');
  assert.match(g2.calls[0].input.query, /after:2026\/10\/14/, 'incremental from the last email day');
  await runEngine(store, { by: 'test' });
  assert.equal(store.all('applications')[0].stage, 'Applied');
});

test('15. sync errors are recorded and never shown as a successful sync', async () => {
  const { store } = await newStore();
  const r = await syncGmail(store, fakeGmail([], { failWith: 'needs_reauth' }).call, { by: 'test' });
  assert.equal(r.ok, false);
  const s = store.get('system', 'gmail');
  assert.equal(s.lastSyncAt, undefined, 'no fake success time');
  assert.match(s.lastError, /reconnected/);
  assert.equal(s.lastAttemptOk, false);
  assert.ok(store.all('runs').some((x) => x.kind === 'gmail-sync' && !x.ok));
});

test('deleting email data keeps applications, scrubs subjects from history', async () => {
  const { store } = await newStore(seed({ mailEvents: { m1: MAIL.appliedAcme } }));
  await run(store);
  const n = await A.deleteEmailData(store);
  assert.equal(n, 1);
  assert.equal(store.all('mailEvents').length, 0);
  const a = store.all('applications')[0];
  assert.equal(a.stage, 'Applied');
  assert.ok(!JSON.stringify(a.history).includes('Thank you for applying'));
});

test('11. dashboard counts come from the processed records', async () => {
  const { store } = await newStore(seed({ mailEvents: { m1: MAIL.appliedAcme, m3: MAIL.interviewAcme } }));
  await run(store);
  const k = kpis(buildModel(store.state), null);
  assert.equal(k.submitted, 1);
  assert.equal(k.interviewsScheduled, 1);
  assert.equal(k.relevant >= 1, true);
  assert.equal(k.overdueTasks, 0);
});
