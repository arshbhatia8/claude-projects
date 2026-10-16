// Detail drawers for a job and for an application.
import { h, icon, btn, pill, openDrawer, closeDrawer, confirm, select, toast } from './dom.js';
import * as A from '../core/actions.js';
import { FACTORS, matchBand } from '../core/matching.js';
import { STAGES, VERIFICATION } from '../core/schema.js';
import { fmtDay, fmtTime, fmtClock, safeUrl, str, relDay } from '../core/util.js';
import { applicationDialog, jobDialog, shortlistDialog, notesDialog, taskDialog, interviewDialog, assessmentDialog, moveStageDialog, stagePill, stageTone } from './forms.js';

const missing = (t = 'Not stated in the listing') => h('span.missing', t);
const prov = (kind, text) => h(`span.prov.${kind}`, text);
const ext = (url, label, kind = '') => (safeUrl(url) ? h('a', { class: `btn ${kind}`, href: safeUrl(url), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), h('span.lbl', label)) : null);

export function scoreBadge(score, size = '') {
  return h(`span.score.${matchBand(score)}${size}`, { title: score == null ? 'Not enough data to score' : `Match score ${score} of 100 (an estimate)` }, score == null ? '—' : String(score));
}

function head(title, sub, extra) {
  return h('div.drawer-head', h('div', { style: { flex: 1, minWidth: 0 } }, h('h2', title), h('div.sub', sub), extra || null), btn('', () => closeDrawer(), { kind: 'ghost', ico: 'x', title: 'Close' }));
}
function section(title, ...kids) { return h('section.stack.tight', h('h2.section', title), ...kids); }
function timeline(items) {
  if (!items.length) return h('p.faint.small', { style: { margin: 0 } }, 'No activity recorded yet.');
  return h('div.timeline', items.slice().reverse().map((x) => h(`div.tl-item${x.type === 'stage' || x.type === 'created' ? '.stage' : ''}`,
    h('time', `${fmtDay(str(x.at).slice(0, 10))} · ${fmtTime(x.at)}`),
    describe(x))));
}
function describe(x) {
  if (x.type === 'stage') return h('span', 'Moved ', x.from ? h('b', x.from) : '', ' → ', h('b', x.to), x.text ? ` · ${x.text}` : '');
  if (x.type === 'created') return h('span', 'Added to tracker at ', h('b', x.to), x.text ? ` · ${x.text}` : '');
  if (x.type === 'import-update' || x.type === 'edit') {
    const ch = Object.entries(x.changes || {});
    return h('span', x.type === 'edit' ? 'You edited ' : 'Import updated ', ch.length ? ch.map(([k, [o, n]]) => `${k}: “${fmtVal(o)}” → “${fmtVal(n)}”`).join('; ') : (x.text || 'details'));
  }
  return h('span', x.text || x.type);
}
const fmtVal = (v) => (Array.isArray(v) ? v.join(', ') : v === '' || v == null ? 'blank' : String(v));

// ---------------- job ----------------
export function openJob(ctx, id) {
  openDrawer((root) => {
    const j = ctx.model.jobById[id];
    if (!j) { root.append(head('Job not found', 'It may have been deleted.'), h('div.drawer-body')); return; }
    const m = j.meta;
    const s = ctx.store;
    const body = h('div.drawer-body');
    const tags = h('div.jc-tags', pill(j.status2, j.app ? stageTone(j.app.stage) : j.status2 === 'Not relevant' ? 'muted' : j.status2 === 'Shortlisted' ? 'accent' : j.status2 === 'Applied (not tracked)' ? 'info' : 'muted'),
      ...j.fresh.labels.map((l) => h('span', { title: l.why }, pill(l.text, l.tone))), m.priority ? pill(`${m.priority} priority`, m.priority === 'High' ? 'accent' : 'muted') : null);

    const actions = h('div.row',
      ext(j.link, 'Open listing', 'primary'), j.applyUrl && j.applyUrl !== j.link ? ext(j.applyUrl, 'Application page') : null,
      j.app ? btn('Open application', () => ctx.openApp(j.app.id), { ico: 'tracker' }) : btn('Add to tracker', () => applicationDialog(ctx, { jobId: id }), { ico: 'plus', kind: j.link ? '' : 'primary' }),
      btn(m.favorite ? 'Favourite' : 'Favourite', () => ctx.run(() => A.toggleFavorite(s, id)), { ico: 'star', attrs: { class: m.favorite ? 'on fav-on' : '', 'aria-pressed': m.favorite ? 'true' : 'false' } }),
      btn(m.shortlisted ? 'Shortlisted' : 'Shortlist', () => (m.shortlisted ? ctx.run(() => A.setShortlisted(s, id, false), 'Removed from shortlist') : shortlistDialog(ctx, id)), { ico: 'check', attrs: { class: m.shortlisted ? 'on' : '', 'aria-pressed': m.shortlisted ? 'true' : 'false' } }),
      btn(m.reviewed ? 'Reviewed' : 'Mark reviewed', () => ctx.run(() => A.markReviewed(s, id, !m.reviewed)), { ico: 'eye', attrs: { class: m.reviewed ? 'on' : '' } }),
      btn(m.notRelevant ? 'Not relevant' : 'Not relevant', () => ctx.run(() => A.markNotRelevant(s, id, !m.notRelevant)), { ico: 'ban', attrs: { class: m.notRelevant ? 'on' : '' } }),
      btn('Task', () => taskDialog(ctx, { prefill: { jobId: id, company: j.company, title: `Review ${j.title} at ${j.company}`, category: 'Review', appId: j.app ? j.app.id : '' } }), { ico: 'tasks' }),
    );

    // Verification
    const ver = select('verification', VERIFICATION, j.fresh.verification, { 'aria-label': 'Listing status' });
    ver.addEventListener('change', () => ctx.run(() => A.setVerification(s, id, ver.value), `Listing marked ${ver.value.toLowerCase()}`));
    const prio = select('jobPriority', [['', 'No priority'], 'High', 'Medium', 'Low'], m.priority || '', { 'aria-label': 'Priority' });
    prio.addEventListener('change', () => ctx.run(() => A.setJobPriority(s, id, prio.value)));

    const facts = h('dl.dl',
      h('dt', 'Location'), h('dd', j.location || missing()),
      h('dt', 'Work mode'), h('dd', j.workMode || missing()),
      h('dt', 'Employment type'), h('dd', j.employmentType && j.employmentType !== 'Not stated' ? j.employmentType : missing()),
      h('dt', 'Experience'), h('dd', j.experience && !/not (shown|stated)/i.test(j.experience) ? j.experience : missing()),
      h('dt', 'Salary / CTC'), h('dd', j.comp ? j.ctc : missing('Not disclosed'), j.lpa && j.lpa.approx ? h('span.faint.small', ` ≈ ${j.lpa.min.toFixed(0)}–${j.lpa.max.toFixed(0)} LPA at your Settings rates`) : null),
      h('dt', 'Posted'), h('dd', j.postedDay ? `${fmtDay(j.postedDay, { weekday: true })}${j.listedTimeKnown ? ', ' + fmtTime(j.listedAt) + ' IST' : ''}${j.listedApprox || /approx/i.test(j.note || '') ? ' (approx.)' : ''} · ${relDay(j.postedDay)}` : missing('Posting date not shown')),
      h('dt', 'Discovered'), h('dd', j.foundDay ? `${fmtDay(j.foundDay, { weekday: true })} · ${relDay(j.foundDay)}` : missing('Unknown')),
      h('dt', 'Deadline'), h('dd', j.fresh.deadline ? fmtDay(j.fresh.deadline, { weekday: true }) : missing('None given')),
      h('dt', 'Job / requisition ID'), h('dd', j.requisitionId ? h('span.mono', j.requisitionId) : missing('None given')),
      h('dt', 'Source'), h('dd', j.platform, j.source && j.source !== j.platform ? h('span.faint', ` (${j.source})`) : null,
        (m.sources || []).length ? h('div.small', 'Also seen on: ', (m.sources || []).map((x, i) => [i ? ', ' : '', safeUrl(x.link) ? h('a', { href: safeUrl(x.link), target: '_blank', rel: 'noopener noreferrer' }, x.platform || 'link') : x.platform])) : null),
      h('dt', 'Skills'), h('dd', (j.skills || []).length ? j.skills.join(', ') : missing('Not listed')),
      h('dt', 'Region · group'), h('dd', [j.region || '—', j.category || '—'].join(' · ')),
    );

    const f = j.scoreInfo;
    const factorRows = Object.keys(FACTORS).map((k) => {
      const x = f.factors[k];
      const w = Number(ctx.settings.weights[k]) || 0;
      if (!x) return h('div.factor', h('span.fname.faint', `${FACTORS[k]} · weight ${w}`), h('span.fval.faint', '—'), h('span.fnote', 'No data in this listing, so it is left out of the score.'));
      return h('div.factor', h('span.fname', `${FACTORS[k]} · weight ${w}`), h('span.fval', String(x.score)), h('span.bar', h('i', { style: { width: `${x.score}%`, opacity: w ? '1' : '0.35' } })), h('span.fnote', x.note));
    });

    const pairs = ctx.model.dupPairs.filter((p) => p.a === id || p.b === id);
    const dupBox = pairs.length ? section('Possible duplicates', ...pairs.map((p) => {
      const other = ctx.model.jobById[p.a === id ? p.b : p.a];
      return h('div.sub-item', h('div', h('div', h('b', other.title), ' · ', other.company), h('div.small.faint', `${other.location || 'No location'} · ${other.platform} · ${p.reason}`)),
        h('div.row', btn('Merge into this', () => ctx.run(() => A.mergeJobs(s, id, other.id), 'Merged. The duplicate is hidden and its link kept as a source.'), { small: true, ico: 'merge' }),
          btn('Not a duplicate', () => ctx.run(() => A.dismissDuplicate(s, id, other.id)), { small: true, kind: 'ghost' })));
    })) : null;

    const tasks = ctx.model.tasks.filter((t) => t.jobId === id || (j.app && t.appId === j.app.id));
    body.append(
      tags, actions,
      h('div.grid-2', h('label.field', h('span', 'Listing status'), ver, h('span.hint', j.fresh.verifiedOn ? `Last checked ${fmtDay(j.fresh.verifiedOn)}` : 'Check the listing, then set this')), h('label.field', h('span', 'Priority'), prio)),
      m.mergedInto ? h('div.notice.info', icon('merge'), h('div', 'This listing was merged into another job. ', btn('Show it', () => ctx.openJob(m.mergedInto), { small: true }), ' ', btn('Undo merge', () => ctx.run(() => A.unmergeJob(s, id), 'Merge undone'), { small: true, kind: 'ghost' }))) : null,
      j.status === 'Applied' && !j.app ? h('div.notice.info', icon('send'), h('div', `Your scheduled search found a Gmail confirmation for this job${j.appliedOn ? ' (' + j.appliedOn + ')' : ''}. `, btn('Add to tracker', () => applicationDialog(ctx, { jobId: id, stage: 'Applied' }), { small: true }))) : null,
      section(h('span', 'Listing details ', prov('fact', 'from the listing'))), facts,
      j.description ? section('Description', h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, j.description)) : null,
      j.note ? section(h('span', 'Search note ', prov('fact', 'from your scheduled search')), h('p', { style: { margin: 0 } }, j.note)) : null,
      section(h('span', 'Match score ', prov('estimate', 'estimate')),
        h('div.row', scoreBadge(j.score), h('span.small.muted', f.score == null ? 'Not enough data to score.' : `Uses ${f.coverage}% of your factor weight. Missing factors are left out, not guessed.`)),
        h('div', factorRows),
        h('p.faint.small', { style: { margin: 0 } }, 'A high score is a relevance estimate. It does not mean the job is still open; use Listing status for that. Change the weights in Settings.')),
      section(h('span', 'Your notes ', btn(m.notes ? 'Edit' : 'Add', () => notesDialog(ctx, id), { small: true, kind: 'ghost', ico: 'edit' })), m.notes ? h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, m.notes) : h('p.faint.small', { style: { margin: 0 } }, 'No notes yet.')),
      m.shortlisted ? section(h('span', 'Why it’s on your shortlist ', btn('Edit', () => shortlistDialog(ctx, id), { small: true, kind: 'ghost', ico: 'edit' })), h('p', { style: { margin: 0 } }, m.shortlistReason || h('span.faint', 'No reason recorded.'))) : null,
      dupBox,
      tasks.length ? section('Tasks', ...tasks.map((t) => h('button.sub-item', { type: 'button', style: { textAlign: 'left', cursor: 'pointer', color: 'inherit' }, onclick: () => taskDialog(ctx, { id: t.id }) }, h('span', t.title), h('span.small.faint', t.status === 'Completed' ? 'Done' : t.dueDate ? fmtDay(t.dueDate) : 'No date')))) : null,
      section('History', timeline(m.history || [])),
    );
    root.append(head(j.title, h('span', j.company, j.location ? ` · ${j.location}` : '', ' ', scoreBadge(j.score))), body,
      h('div.drawer-foot', btn('Edit details', () => jobDialog(ctx, id), { ico: 'edit' }),
        btn('Delete job', async () => {
          if (!(await confirm({ title: 'Delete this job?', text: `“${j.title}” at ${j.company} and your notes on it will be deleted. Linked applications and tasks are kept. If your scheduled search finds the listing again, it will come back as new.`, confirmLabel: 'Delete job', danger: true }))) return;
          await ctx.run(() => A.deleteJob(s, id), 'Job deleted'); closeDrawer();
        }, { kind: 'danger', ico: 'trash' })));
  });
}

// ---------------- application ----------------
export function openApp(ctx, id) {
  openDrawer((root) => {
    const a = ctx.model.appById[id];
    if (!a) { root.append(head('Application not found', 'It may have been deleted.'), h('div.drawer-body')); return; }
    const s = ctx.store;
    const stageSel = select('stage-move', STAGES, a.stage, { 'aria-label': 'Stage' });
    stageSel.addEventListener('change', async () => { const to = stageSel.value; stageSel.value = a.stage; await moveStageDialog(ctx, id, to); });
    const r = a.recruiter || {};
    const body = h('div.drawer-body',
      h('div.grid-2',
        h('label.field', h('span', 'Stage'), stageSel),
        h('div.field', h('span', 'Next follow-up'), h('div', { style: { minHeight: '42px', display: 'flex', alignItems: 'center', gap: '8px' } }, a.followUpDate ? h('span', fmtDay(a.followUpDate, { weekday: true }), ' ', a.followUpDue ? pill('Due', 'warn') : h('span.faint', `(${relDay(a.followUpDate)})`)) : h('span.faint', 'Not set')))),
      h('div.notice' + (a.nextAction ? '' : '.warn'), icon('bolt'), h('div', { style: { flex: 1 } }, h('b', 'Next action: '), a.nextAction || (a.active ? 'Not set. Every active application should have one.' : 'None (closed).'))),
      h('div.row',
        btn('Edit details', () => applicationDialog(ctx, { appId: id }), { ico: 'edit' }),
        btn('Interview', () => interviewDialog(ctx, id), { ico: 'plus' }),
        btn('Assessment', () => assessmentDialog(ctx, id), { ico: 'plus' }),
        btn('Task', () => taskDialog(ctx, { prefill: { appId: id, jobId: a.jobId, company: a.company, category: 'Follow-up' } }), { ico: 'tasks' }),
        ext(a.jobUrl, 'Listing'), ext(a.applicationUrl, 'Application page'),
        a.job ? btn('Job details', () => ctx.openJob(a.job.id), { ico: 'briefcase' }) : null),
      section(h('span', 'Interviews ', h('span.faint', `${a.interviews.length}`)),
        a.interviews.length ? h('div.sub-list', a.interviews.map((iv) => h('div.sub-item',
          h('div', h('div', h('b', iv.round), ' ', pill(iv.status, iv.status === 'Done' ? 'good' : iv.status === 'Cancelled' ? 'muted' : 'warn')),
            h('div.small.muted', `${fmtDay(iv.date, { weekday: true })}${iv.time ? ' · ' + fmtClock(iv.time) + ' IST' : ''}${iv.mode ? ' · ' + iv.mode : ''}${iv.with ? ' · ' + iv.with : ''}`),
            iv.notes ? h('div.small', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, iv.notes) : null),
          h('div.row', btn('', () => interviewDialog(ctx, id, iv), { small: true, kind: 'ghost', ico: 'edit', title: 'Edit interview' }),
            btn('', async () => { if (await confirm({ title: 'Remove this interview?', text: `${iv.round} on ${iv.date}`, confirmLabel: 'Remove', danger: true })) ctx.run(() => A.saveItem(s, id, 'interviews', iv, { remove: true })); }, { small: true, kind: 'ghost', ico: 'trash', title: 'Remove interview' }))))) : h('p.faint.small', { style: { margin: 0 } }, 'No interviews yet.')),
      section(h('span', 'Assessments ', h('span.faint', `${a.assessments.length}`)),
        a.assessments.length ? h('div.sub-list', a.assessments.map((x) => h('div.sub-item',
          h('div', h('div', h('b', x.title), ' ', pill(x.status, x.status === 'Done' ? 'good' : x.status === 'Skipped' ? 'muted' : 'warn')),
            h('div.small.muted', x.due ? `Due ${fmtDay(x.due, { weekday: true })}${x.time ? ' · ' + fmtClock(x.time) : ''} · ${relDay(x.due)}` : 'No deadline'),
            safeUrl(x.link) ? h('a.small', { href: safeUrl(x.link), target: '_blank', rel: 'noopener noreferrer' }, 'Open assessment') : null),
          h('div.row', btn('', () => assessmentDialog(ctx, id, x), { small: true, kind: 'ghost', ico: 'edit', title: 'Edit assessment' }),
            btn('', async () => { if (await confirm({ title: 'Remove this assessment?', text: x.title, confirmLabel: 'Remove', danger: true })) ctx.run(() => A.saveItem(s, id, 'assessments', x, { remove: true })); }, { small: true, kind: 'ghost', ico: 'trash', title: 'Remove assessment' }))))) : h('p.faint.small', { style: { margin: 0 } }, 'No assessments yet.')),
      section('Details', h('dl.dl',
        h('dt', 'Applied on'), h('dd', a.appliedOn ? fmtDay(a.appliedOn, { weekday: true }) : missing('Not applied yet')),
        h('dt', 'Location'), h('dd', a.location || missing('Not recorded')),
        h('dt', 'Requisition ID'), h('dd', a.requisitionId ? h('span.mono', a.requisitionId) : missing('Not recorded')),
        h('dt', 'Resume version'), h('dd', a.resumeVersion || missing('Not recorded')),
        h('dt', 'Documents'), h('dd', a.documents || missing('Not recorded')),
        h('dt', 'Referral'), h('dd', a.referral || missing('None recorded')),
        h('dt', 'Recruiter'), h('dd', r.name || r.email || r.phone || r.linkedin ? h('div', [r.name, r.email, r.phone].filter(Boolean).join(' · '), safeUrl(r.linkedin) ? h('div', h('a', { href: safeUrl(r.linkedin), target: '_blank', rel: 'noopener noreferrer' }, 'LinkedIn profile')) : null) : missing('Only what you add')),
        h('dt', 'Expected comp.'), h('dd', a.expectedComp || missing('Not recorded')),
        h('dt', 'Offered comp.'), h('dd', a.offeredComp || missing('No offer recorded')),
      )),
      section('Notes', a.notes ? h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, a.notes) : h('p.faint.small', { style: { margin: 0 } }, 'No notes yet. Use Edit details.')),
      (() => { const t = ctx.model.tasks.filter((x) => x.appId === id); return t.length ? section('Tasks', ...t.map((x) => h('button.sub-item', { type: 'button', style: { textAlign: 'left', cursor: 'pointer', color: 'inherit' }, onclick: () => taskDialog(ctx, { id: x.id }) }, h('span', x.title), h('span.small.faint', x.status === 'Completed' ? 'Done' : x.dueDate ? fmtDay(x.dueDate) : 'No date')))) : null; })(),
      section('Activity', timeline(a.history || [])),
    );
    root.append(head(a.title, h('span', a.company, ' ', stagePill(a.stage))), body,
      h('div.drawer-foot', btn('Delete application', async () => {
        if (!(await confirm({ title: 'Delete this application?', text: `${a.company} · ${a.title}, with its interviews, assessments and history, will be deleted. The job stays in Discover; linked tasks are kept.`, confirmLabel: 'Delete', danger: true, typeToConfirm: a.history && a.history.length > 2 ? 'DELETE' : undefined }))) return;
        await ctx.run(() => A.deleteApplication(s, id), 'Application deleted'); closeDrawer();
      }, { kind: 'danger', ico: 'trash' })));
  });
}
export { toast };
