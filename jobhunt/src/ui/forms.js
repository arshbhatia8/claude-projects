// Dialog forms. Each validates in the data layer (actions.js) and shows errors in place.
import { h, modal, field, input, textarea, select, readForm, toast, pill, confirm } from './dom.js';
import * as A from '../core/actions.js';
import { STAGES, PRIORITIES, TASK_STATUSES, TASK_CATEGORIES, WORK_MODES, EMPLOYMENT_TYPES, PLATFORMS, JOB_PRIORITIES, isSubmittedStage, mergeSettings } from '../core/schema.js';
import { suggestForStage, suggestForInterview, suggestForAssessment } from '../core/suggestions.js';
import { today, fmtDay, addDays, str } from '../core/util.js';

const dateInput = (id, v, attrs = {}) => input(id, v, { type: 'date', ...attrs });

// ---------- jobs ----------
export async function jobDialog(ctx, jobId) {
  const j = jobId ? ctx.store.get('jobs', jobId) || {} : {};
  const body = h('div.grid-2',
    field('Job title *', input('title', j.title, { required: true, autofocus: true })),
    field('Company *', input('company', j.company, { required: true })),
    field('Location', input('location', j.location, { placeholder: 'e.g. Bengaluru (Hybrid)' })),
    field('Work mode', select('workMode', [['', 'Not stated'], ...WORK_MODES], j.workMode)),
    field('Employment type', select('employmentType', [['', 'Not stated'], ...EMPLOYMENT_TYPES], j.employmentType)),
    field('Experience required', input('experience', j.experience, { placeholder: 'e.g. 2–4 yrs' })),
    field('Salary / CTC', input('ctc', j.ctc, { placeholder: 'Only if the listing states it' })),
    field('Source platform', select('source', ['', ...PLATFORMS], PLATFORMS.includes(j.source) ? j.source : j.source ? 'Other' : '')),
    field('Original job URL', input('link', j.link, { type: 'url', inputmode: 'url', placeholder: 'https://' })),
    field('Application URL (if different)', input('applyUrl', j.applyUrl, { type: 'url', inputmode: 'url', placeholder: 'https://' })),
    field('Job / requisition ID', input('requisitionId', j.requisitionId)),
    field('Posting date', dateInput('listedAt', str(j.listedAt).slice(0, 10), { max: today() })),
    field('Application deadline', dateInput('deadline', j.deadline)),
    field('Required skills', input('skills', (j.skills || []).join(', '), { placeholder: 'Comma separated' })),
    h('div.span-all', field('Description or summary', textarea('description', j.description, { rows: 4 }))),
  );
  return modal({
    title: jobId ? 'Edit job details' : 'Add a job', intro: jobId ? 'Changes are kept in the job’s history.' : 'For listings you find yourself. Leave unknown details blank.', body, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: jobId ? 'Save changes' : 'Add job', kind: 'primary', run: async () => {
        const f = readForm(body);
        if (jobId) { await A.editJobFacts(ctx.store, jobId, f); toast('Job updated'); return jobId; }
        const dup = ctx.model.jobs.find((x) => !x.hidden && x.company.toLowerCase() === f.company.toLowerCase() && x.title.toLowerCase() === f.title.toLowerCase());
        const id = await A.createJob(ctx.store, f);
        toast(dup ? 'Job added. A job with the same title and company already exists; check Duplicates.' : 'Job added');
        return id;
      },
    }],
  });
}

export async function shortlistDialog(ctx, jobId) {
  const meta = ctx.store.get('jobMeta', jobId) || {};
  const body = h('div.stack',
    field('Why you like it', textarea('reason', meta.shortlistReason, { rows: 3, placeholder: 'e.g. Payments platform, hybrid in Bengaluru, team works on APIs', autofocus: true })),
    field('Priority', select('priority', [['', 'No priority'], ...JOB_PRIORITIES], meta.priority || mergeSettings(ctx.store.get('settings', 'main')).defaults.jobPriority)));
  return modal({
    title: meta.shortlisted ? 'Edit shortlist note' : 'Add to shortlist', body,
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', run: async () => {
      const f = readForm(body);
      await A.setShortlisted(ctx.store, jobId, true, f.reason);
      if (f.priority !== (meta.priority || '')) await A.setJobPriority(ctx.store, jobId, f.priority);
      toast('On your shortlist');
    } }],
  });
}

export async function notesDialog(ctx, jobId) {
  const meta = ctx.store.get('jobMeta', jobId) || {};
  const body = h('div', field('Your notes', textarea('notes', meta.notes, { rows: 6, autofocus: true })));
  return modal({ title: 'Notes', body, actions: [{ label: 'Cancel' }, { label: 'Save notes', kind: 'primary', run: async () => { await A.setJobNotes(ctx.store, jobId, readForm(body).notes); toast('Notes saved'); } }] });
}

// ---------- applications ----------
/** Create an application (from a job or blank) or edit one. */
export async function applicationDialog(ctx, { jobId, appId, stage } = {}) {
  const settings = mergeSettings(ctx.store.get('settings', 'main'));
  const a = appId ? ctx.store.get('applications', appId) : null;
  const j = jobId ? ctx.store.get('jobs', jobId) : null;
  const v = a || {
    company: j?.company, title: j?.title, location: j?.location, jobUrl: j?.link, applicationUrl: j?.applyUrl, requisitionId: j?.requisitionId, source: j?.source,
    stage: stage || (j && j.status === 'Applied' ? 'Applied' : settings.defaults.applicationStage), appliedOn: j && j.status === 'Applied' ? j.appliedOn : '',
  };
  const stageSel = appId ? null : select('stage', STAGES, v.stage);
  const applied = dateInput('appliedOn', v.appliedOn, { max: today() });
  const fu = dateInput('followUpDate', a ? a.followUpDate : '');
  const appliedWrap = field('Date applied', applied, 'Required once the application is sent. The app never marks a job applied just because you opened its link.');
  const syncApplied = () => {
    const s = stageSel ? stageSel.value : a.stage;
    appliedWrap.hidden = !isSubmittedStage(s) && !(a && a.appliedOn);
    if (stageSel && isSubmittedStage(s) && !applied.value && j && j.status === 'Applied' && j.appliedOn) applied.value = j.appliedOn;
  };
  if (stageSel) stageSel.addEventListener('change', syncApplied);
  applied.addEventListener('change', () => { if (!a && applied.value && !fu.value) fu.value = addDays(applied.value, Number(settings.defaults.followUpDays) || 7); });
  const r = (a && a.recruiter) || {};
  const gmailNote = j && j.status === 'Applied' && !a ? h('div.notice.info', '✓', h('div', `Your scheduled job search found a Gmail confirmation for this job${j.appliedOn ? ' dated ' + j.appliedOn : ''}. Check the date before saving.`)) : null;
  const body = h('div.stack', gmailNote,
    h('div.grid-2',
      field('Company *', input('company', v.company, { required: true })),
      field('Job title *', input('title', v.title, { required: true })),
      stageSel ? field('Stage', stageSel) : null,
      appliedWrap,
      field('Next follow-up', fu, a ? null : `Filled in ${settings.defaults.followUpDays} days after the applied date; change or clear it.`),
      field('Next action', input('nextAction', a?.nextAction, { placeholder: 'e.g. Send portfolio link to recruiter' })),
      field('Location', input('location', v.location)),
      field('Requisition ID', input('requisitionId', v.requisitionId)),
      field('Job URL', input('jobUrl', v.jobUrl, { type: 'url', inputmode: 'url' })),
      field('Application URL', input('applicationUrl', v.applicationUrl, { type: 'url', inputmode: 'url' })),
      field('Resume version used', input('resumeVersion', a?.resumeVersion, { placeholder: 'e.g. PM-payments-v3.pdf' })),
      field('Cover letter / documents', input('documents', a?.documents)),
      field('Referral', input('referral', a?.referral, { placeholder: 'Who referred you, if anyone' })),
      field('Expected compensation', input('expectedComp', a?.expectedComp)),
      a ? field('Offered compensation', input('offeredComp', a?.offeredComp)) : null,
    ),
    h('details', { open: !!(r.name || r.email) },
      h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center', color: 'var(--fg-2)' } }, 'Recruiter contact (only what you have)'),
      h('div.grid-2', { style: { marginTop: '8px' } },
        field('Name', input('r_name', r.name)), field('Email', input('r_email', r.email, { type: 'email', inputmode: 'email' })),
        field('Phone', input('r_phone', r.phone, { type: 'tel', inputmode: 'tel' })), field('LinkedIn', input('r_linkedin', r.linkedin, { type: 'url', inputmode: 'url' })))),
    field('Notes', textarea('notes', a?.notes, { rows: 3 })),
  );
  syncApplied();
  const save = async (force) => {
    const f = readForm(body);
    const recruiter = { name: f.r_name, email: f.r_email, phone: f.r_phone, linkedin: f.r_linkedin };
    if (a) { await A.updateApplication(ctx.store, appId, { ...f, recruiter }); toast('Application updated'); return appId; }
    const id = await A.createApplication(ctx.store, { ...f, recruiter, jobId: jobId || '' }, { force });
    return id;
  };
  const id = await modal({
    title: a ? 'Edit application' : 'Add to application tracker', intro: a ? `${a.company} · ${a.title}` : j ? 'The job record stays in Discover; this tracks your application.' : 'Track an application for a job that is not in Discover.', body, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: a ? 'Save' : 'Add to tracker', kind: 'primary', run: async (close, setError) => {
        try { return await save(false); } catch (e) {
          if (!e.duplicate) throw e;
          setError('');
          const choice = await modal({
            title: 'Possible duplicate application', body: h('p', { style: { margin: 0 } }, e.message + ' Adding another may double-count this application.'),
            actions: [{ label: 'Open existing', value: 'open' }, { label: 'Add anyway', kind: 'primary', value: 'force', run: () => 'force' }],
          });
          if (choice === 'open') { close(false); ctx.openApp(e.duplicate.id); return false; }
          if (choice === 'force') return save(true);
          return false;
        }
      },
    }],
  });
  if (id && typeof id === 'string' && !a) {
    toast('Added to tracker', { action: { label: 'Open', run: () => ctx.openApp(id) } });
    const created = ctx.store.get('applications', id);
    if (created) await offerSuggestions(ctx, suggestForStage({ id, ...created }, created.stage, settings));
  }
  return id;
}

/** Moves an application, asking for the applied date when needed, then offers related tasks. */
export async function moveStageDialog(ctx, appId, stage) {
  const a = ctx.store.get('applications', appId);
  if (!a || a.stage === stage) return false;
  let appliedOn = a.appliedOn;
  if (isSubmittedStage(stage) && !appliedOn) {
    const d = dateInput('appliedOn', today(), { max: today(), autofocus: true });
    const ok = await modal({
      title: `Move to “${stage}”`, intro: `${a.company} · ${a.title}`,
      body: h('div.stack', h('p', { style: { margin: 0 } }, 'When did you send this application? Only applications you have actually sent count as applied.'), field('Date applied', d)),
      actions: [{ label: 'Cancel' }, { label: 'Confirm', kind: 'primary', run: () => { if (!d.value) throw new Error('Enter the date you applied.'); if (d.value > today()) throw new Error('The date cannot be in the future.'); appliedOn = d.value; return true; } }],
    });
    if (!ok) return false;
  }
  const r = await ctx.run(() => A.moveStage(ctx.store, appId, stage, { appliedOn }), `Moved to ${stage}`);
  if (r) {
    const settings = mergeSettings(ctx.store.get('settings', 'main'));
    await offerSuggestions(ctx, suggestForStage({ id: appId, ...ctx.store.get('applications', appId) }, stage, settings));
  }
  return r;
}

export async function interviewDialog(ctx, appId, item) {
  const a = ctx.store.get('applications', appId);
  const v = item || {};
  const body = h('div.grid-2',
    field('Round', input('round', v.round, { placeholder: 'e.g. Round 1 – Hiring manager', autofocus: true })),
    field('Status', select('status', ['Scheduled', 'Done', 'Cancelled', 'Rescheduled'], v.status || 'Scheduled')),
    field('Date *', dateInput('date', v.date)), field('Time (IST)', input('time', v.time, { type: 'time' })),
    field('Format', select('mode', ['', 'Video', 'Phone', 'On-site', 'Take-home review'], v.mode)),
    field('With', input('with', v.with, { placeholder: 'Interviewer, if you know' })),
    h('div.span-all', field('Notes', textarea('notes', v.notes, { rows: 3, placeholder: 'Questions asked, how it went, follow-ups' }))));
  const saved = await modal({
    title: item ? 'Edit interview' : 'Add interview', intro: `${a.company} · ${a.title}`, body, wide: true,
    actions: [{ label: 'Cancel' }, { label: 'Save interview', kind: 'primary', run: async () => { const f = readForm(body); await A.saveItem(ctx.store, appId, 'interviews', { ...v, ...f }); return f; } }],
  });
  if (saved && !item) {
    toast('Interview saved');
    const fresh = ctx.store.get('applications', appId);
    const sug = suggestForInterview({ id: appId, ...fresh }, saved);
    if (fresh.stage !== 'Interview Scheduled' && ['Applied', 'Assessment Pending', 'Follow-up Required', 'Interview Completed'].includes(fresh.stage)) {
      sug.unshift({ moveStage: 'Interview Scheduled', appId, title: 'Move the application to “Interview Scheduled”' });
    }
    await offerSuggestions(ctx, sug);
  }
}

export async function assessmentDialog(ctx, appId, item) {
  const a = ctx.store.get('applications', appId);
  const v = item || {};
  const body = h('div.grid-2',
    field('What it is', input('title', v.title, { placeholder: 'e.g. Product case study, SQL test', autofocus: true })),
    field('Status', select('status', ['Pending', 'In progress', 'Done', 'Skipped'], v.status || 'Pending')),
    field('Deadline', dateInput('due', v.due)), field('Time (IST)', input('time', v.time, { type: 'time' })),
    h('div.span-all', field('Link', input('link', v.link, { type: 'url', inputmode: 'url' }))),
    h('div.span-all', field('Notes', textarea('notes', v.notes, { rows: 3 }))));
  const saved = await modal({
    title: item ? 'Edit assessment' : 'Add assessment', intro: `${a.company} · ${a.title}`, body, wide: true,
    actions: [{ label: 'Cancel' }, { label: 'Save assessment', kind: 'primary', run: async () => { const f = readForm(body); await A.saveItem(ctx.store, appId, 'assessments', { ...v, ...f }); return f; } }],
  });
  if (saved && !item) {
    toast('Assessment saved');
    const fresh = ctx.store.get('applications', appId);
    const sug = saved.due ? suggestForAssessment({ id: appId, ...fresh }, saved) : [];
    if (fresh.stage === 'Applied') sug.unshift({ moveStage: 'Assessment Pending', appId, title: 'Move the application to “Assessment Pending”' });
    await offerSuggestions(ctx, sug);
  }
}

// ---------- tasks ----------
export async function taskDialog(ctx, { id, prefill = {} } = {}) {
  const t = id ? ctx.store.get('tasks', id) : null;
  const settings = mergeSettings(ctx.store.get('settings', 'main'));
  const v = t || { priority: settings.defaults.taskPriority, status: 'To Do', category: 'Other', ...prefill };
  const apps = ctx.model.apps.slice().sort((x, y) => x.company.localeCompare(y.company));
  const jobs = ctx.model.jobs.filter((j) => !j.hidden && (j.meta.shortlisted || j.meta.favorite || j.id === v.jobId || j.app)).sort((x, y) => x.company.localeCompare(y.company));
  const appSel = select('appId', [['', 'None'], ...apps.map((a) => [a.id, `${a.company} · ${a.title}`])], v.appId);
  const jobSel = select('jobId', [['', 'None'], ...jobs.map((j) => [j.id, `${j.company} · ${j.title}`])], v.jobId);
  const company = input('company', v.company);
  appSel.addEventListener('change', () => { const a = ctx.model.appById[appSel.value]; if (a) { company.value = a.company; if (a.jobId) jobSel.value = a.jobId; } });
  jobSel.addEventListener('change', () => { const j = ctx.model.jobById[jobSel.value]; if (j && !company.value) company.value = j.company; });
  const body = h('div.grid-2',
    h('div.span-all', field('Task *', input('title', v.title, { autofocus: true, placeholder: 'e.g. Tailor resume for the PayU role' }))),
    field('Due date', dateInput('dueDate', v.dueDate)), field('Due time (optional)', input('dueTime', v.dueTime, { type: 'time' })),
    field('Priority', select('priority', PRIORITIES, v.priority)), field('Status', select('status', TASK_STATUSES, v.status)),
    field('Category', select('category', TASK_CATEGORIES, v.category)), field('Company', company),
    field('Linked application', appSel), field('Linked job', jobSel),
    h('div.span-all', field('Description', textarea('description', v.description, { rows: 2 }))),
    h('div.span-all', field('Notes', textarea('notes', v.notes, { rows: 2 }))),
    t ? h('p.faint.small.span-all', { style: { margin: 0 } }, `Created ${str(t.createdAt).slice(0, 16).replace('T', ' ')}${t.completedAt ? ' · completed ' + str(t.completedAt).slice(0, 16).replace('T', ' ') : ''}`) : null);
  const actions = [{ label: 'Cancel' }];
  if (t) actions.push({ label: 'Delete', kind: '', run: async (close) => { close(false); if (await confirm({ title: 'Delete this task?', text: `“${t.title}” will be removed. This cannot be undone.`, confirmLabel: 'Delete task', danger: true })) await ctx.run(() => A.deleteTask(ctx.store, id), 'Task deleted'); return false; } });
  actions.push({ label: t ? 'Save task' : 'Add task', kind: 'primary', run: async () => {
    const f = readForm(body);
    if (t) { await A.updateTask(ctx.store, id, f); toast('Task saved'); return id; }
    const nid = await A.createTask(ctx.store, { ...f, origin: prefill.origin || 'manual' }); toast('Task added'); return nid;
  } });
  return modal({ title: t ? 'Edit task' : 'New task', body, wide: true, actions });
}

/** Shows suggested tasks with checkboxes; creates only the ones you keep ticked. */
export async function offerSuggestions(ctx, list) {
  if (!list || !list.length) return;
  const rows = list.map((s, i) => {
    const cb = h('input', { type: 'checkbox', checked: true, id: 'sug' + i });
    return { s, cb, el: h('label.check', { style: { alignItems: 'flex-start', minHeight: '0', padding: '6px 0' } }, cb,
      h('span', h('span', s.title), s.moveStage ? null : h('span.faint.small', { style: { display: 'block' } }, [s.category, s.dueDate ? 'due ' + fmtDay(s.dueDate, { weekday: true }) : null, s.priority].filter(Boolean).join(' · ')))) };
  });
  const res = await modal({
    title: 'Suggested next steps', intro: 'Untick anything you don’t want. Nothing is created until you confirm.',
    body: h('div.stack.tight', rows.map((r) => r.el)),
    actions: [{ label: 'Not now', value: false }, { label: 'Create selected', kind: 'primary', run: () => rows.filter((r) => r.cb.checked).map((r) => r.s) }],
  });
  if (!Array.isArray(res) || !res.length) return;
  let n = 0;
  for (const s of res) {
    if (s.moveStage) { await ctx.run(() => A.moveStage(ctx.store, s.appId, s.moveStage)); continue; }
    const { setFollowUp, ...task } = s;
    if (setFollowUp && task.appId) await ctx.run(() => A.updateApplication(ctx.store, task.appId, { followUpDate: setFollowUp }));
    if (await ctx.run(() => A.createTask(ctx.store, { ...task, origin: 'suggestion' }))) n++;
  }
  if (n) toast(`${n} task${n === 1 ? '' : 's'} added`);
}

export const stageTone = (s) => ({ Discovered: 'muted', 'To Review': 'muted', Shortlisted: 'accent', 'Ready to Apply': 'accent', Applied: 'info', 'Assessment Pending': 'warn', 'Interview Scheduled': 'warn', 'Interview Completed': 'info', 'Follow-up Required': 'warn', 'Offer Received': 'good', Rejected: 'bad', Withdrawn: 'muted', Closed: 'muted' }[s] || 'muted');
export const stagePill = (s) => pill(s, stageTone(s));
