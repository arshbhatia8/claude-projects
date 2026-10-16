import { h, icon, btn, select, modal, confirm, saveFile, readFileText, toast, field, input } from '../dom.js';
import { saveSettings } from '../../core/actions.js';
import { FACTORS } from '../../core/matching.js';
import { STAGES, PRIORITIES, JOB_PRIORITIES, PLATFORMS, defaultSettings, COLLECTIONS } from '../../core/schema.js';
import { makeBackup, validateBackup, planRestore, planDeleteAll, jobsCsv, appsCsv, tasksCsv, fileStamp } from '../../core/backup.js';
import { fmtDay, fmtTime, str, uid } from '../../core/util.js';

const list = (s) => str(s).split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export default function settings(ctx) {
  const m = ctx.model;
  const S = JSON.parse(JSON.stringify(m.settings));
  let t;
  const save = (msg = 'Settings saved') => { clearTimeout(t); t = setTimeout(() => ctx.run(() => saveSettings(ctx.store, S), msg), 150); };
  const card = (title, sub, ...kids) => h('section.card.stack', h('div.card-head', { style: { marginBottom: 0 } }, h('h3', title), sub ? h('span.sub', sub) : null), ...kids);

  // Target roles
  const roleRows = h('div.stack.tight');
  const drawRoles = () => roleRows.replaceChildren(...S.targetRoles.map((r, i) => {
    const name = input('role-name-' + i, r.name, { 'aria-label': 'Role name' });
    const kw = input('role-kw-' + i, (r.keywords || []).join(', '), { 'aria-label': `Title keywords for ${r.name}` });
    const pr = select('role-prio-' + i, [['1', 'High'], ['2', 'Medium'], ['3', 'Low']], String(r.priority || 2), { 'aria-label': `Priority for ${r.name}` });
    name.addEventListener('change', () => { r.name = name.value.trim() || r.name; save(); });
    kw.addEventListener('change', () => { r.keywords = list(kw.value).map((x) => x.toLowerCase()); save(); });
    pr.addEventListener('change', () => { r.priority = Number(pr.value); save(); });
    return h('div.role-row', name, kw, pr,
      btn('', () => { S.targetRoles.splice(i, 1); drawRoles(); save('Role removed'); }, { kind: 'ghost', ico: 'trash', small: true, title: `Remove ${r.name}` }));
  }));
  drawRoles();
  const newRole = input('role-new', '', { placeholder: 'e.g. Growth Product Manager' });
  const roles = card('Target roles', 'Used for the role filter and the match score',
    h('p.small.muted', { style: { margin: 0 } }, 'A job’s title is matched against each role’s keywords; the longest match wins. Priority affects the role factor of the match score.'),
    h('div.role-row.hide-phone.small.faint', h('span', 'Role'), h('span', 'Title keywords'), h('span', 'Priority'), h('span')),
    roleRows,
    h('div.row', h('div', { style: { flex: 1, minWidth: '200px' } }, newRole), btn('Add role', () => { const n = newRole.value.trim(); if (!n) return; S.targetRoles.push({ id: uid('r'), name: n, keywords: [n.toLowerCase()], priority: 2 }); newRole.value = ''; drawRoles(); save('Role added'); }, { ico: 'plus' }),
      btn('Reset to defaults', async () => { if (await confirm({ title: 'Reset target roles?', text: 'Your role list goes back to the default 12 roles.', confirmLabel: 'Reset' })) { S.targetRoles = defaultSettings().targetRoles; drawRoles(); save('Roles reset'); } }, { kind: 'ghost', small: true })));

  // Preferences
  const locs = h('textarea', { id: 'set-locations', rows: 3 }); locs.value = S.locations.join(', ');
  locs.addEventListener('change', () => { S.locations = list(locs.value); save(); });
  const modes = h('div.row', ['Remote', 'Hybrid', 'On-site'].map((k) => h('label.check', h('input', { type: 'checkbox', id: 'mode-' + k, checked: S.workModes[k] !== false, onchange: (e) => { S.workModes[k] = e.target.checked; save(); } }), k)));
  const years = input('set-years', S.experienceYears, { type: 'number', min: 0, max: 40, step: 0.5, inputmode: 'decimal' });
  years.addEventListener('change', () => { S.experienceYears = Number(years.value) || 0; save(); });
  const senior = input('set-senior', S.seniorityExclude.join(', '));
  senior.addEventListener('change', () => { S.seniorityExclude = list(senior.value).map((x) => x.toLowerCase()); save(); });
  const skills = h('textarea', { id: 'set-skills', rows: 3 }); skills.value = S.skills.join(', ');
  skills.addEventListener('change', () => { S.skills = list(skills.value).map((x) => x.toLowerCase()); save(); });
  const minLPA = input('set-minlpa', S.compensation.minLPA ?? '', { type: 'number', min: 0, step: 1, inputmode: 'decimal', placeholder: 'No minimum' });
  minLPA.addEventListener('change', () => { S.compensation.minLPA = minLPA.value === '' ? null : Number(minLPA.value); save(); });
  const fx = h('div.grid-3', Object.keys(S.fxToINR).map((cur) => { const i = input('fx-' + cur, S.fxToINR[cur], { type: 'number', min: 0, step: 0.01, inputmode: 'decimal' }); i.addEventListener('change', () => { S.fxToINR[cur] = Number(i.value) || 0; save(); }); return field(`1 ${cur} in ₹`, i); }));
  const prefs = card('Search preferences', 'Locations, work modes, experience, skills and pay',
    h('div.grid-2',
      field('Preferred locations (most preferred first)', locs, 'Comma separated. Include “Remote” to score remote roles well.'),
      field('Your skills', skills, 'Matched against job descriptions and skill lists when a listing has them.'),
      h('div.field', h('span', 'Work modes you accept'), modes, h('span.hint', 'A mode you switch off lowers the location score.')),
      field('Your years of experience', years),
      field('Title words that mean “too senior”', senior),
      field('Minimum salary (LPA)', minLPA, 'Only used when a listing discloses pay. Blank = ignore pay.')),
    h('details', h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center', color: 'var(--fg-2)' } }, 'Currency rates for comparing salaries (approximate)'),
      h('p.small.faint', 'Used only to sort and filter disclosed salaries in other currencies. Update them yourself; JobHunt never fetches rates.'), fx));

  // Weights
  const total = () => Object.values(S.weights).reduce((n, v) => n + (Number(v) || 0), 0);
  const totalEl = h('span.sub');
  const updTotal = () => { totalEl.textContent = `Total weight ${total()} · each factor’s share is its weight ÷ total`; };
  updTotal();
  const weights = card('Match score weights', null, totalEl,
    h('div.grid-2', Object.entries(FACTORS).map(([k, label]) => {
      const out = h('span.mono', String(S.weights[k] ?? 0));
      const r = h('input', { type: 'range', id: 'w-' + k, min: 0, max: 50, step: 1, value: S.weights[k] ?? 0, 'aria-label': `${label} weight` });
      r.addEventListener('input', () => { out.textContent = r.value; S.weights[k] = Number(r.value); updTotal(); });
      r.addEventListener('change', () => save('Weights saved'));
      return h('label.field', h('span', { style: { display: 'flex', justifyContent: 'space-between' } }, label, out), r);
    })),
    h('p.small.faint', { style: { margin: 0 } }, 'Factors a listing has no data for (for example salary when it is not disclosed) are left out of that job’s score instead of counting as zero. “Scheduled search score” is the resume-based score your search task stores with each job.'),
    h('div.row', btn('Reset weights', () => { S.weights = defaultSettings().weights; save('Weights reset'); setTimeout(() => ctx.refresh(), 200); }, { small: true, kind: 'ghost' })));

  // Defaults & display
  const sel = (id, opts, val, set) => { const s = select(id, opts, val); s.addEventListener('change', () => { set(s.value); save(); }); return s; };
  const fuDays = input('set-fudays', S.defaults.followUpDays, { type: 'number', min: 1, max: 60, inputmode: 'numeric' });
  fuDays.addEventListener('change', () => { S.defaults.followUpDays = Math.max(1, Number(fuDays.value) || 7); save(); });
  const defaults = card('Defaults', null, h('div.grid-2',
    field('Stage for new applications', sel('set-stage', STAGES, S.defaults.applicationStage, (v) => { S.defaults.applicationStage = v; })),
    field('Priority for new tasks', sel('set-tprio', PRIORITIES, S.defaults.taskPriority, (v) => { S.defaults.taskPriority = v; })),
    field('Suggest a follow-up after (days)', fuDays),
    field('Priority when shortlisting', sel('set-jprio', JOB_PRIORITIES, S.defaults.jobPriority, (v) => { S.defaults.jobPriority = v; })),
    field('Default source for imports', sel('set-src', [['', 'Detect from the link'], ...PLATFORMS], S.importPrefs.defaultSource, (v) => { S.importPrefs.defaultSource = v; })),
    h('label.check', h('input', { type: 'checkbox', id: 'set-upd', checked: S.importPrefs.updateExisting !== false, onchange: (e) => { S.importPrefs.updateExisting = e.target.checked; save(); } }), 'Re-imports may refresh listing details of existing jobs'),
    field('Theme', sel('set-theme', [['dark', 'Dark (default)'], ['light', 'Light'], ['system', 'Match my device']], S.theme, (v) => { S.theme = v; document.documentElement.setAttribute('data-app-theme', v); }))));

  return h('div.stack', h('div.page-head', h('div', h('h1', 'Settings'), h('p', 'Changes save as you make them.'))),
    dataCard(ctx), roles, prefs, weights, defaults,
    h('p.faint.small', `JobHunt Command Center · build ${ctx.build} · ${ctx.mode === 'cloud' ? 'claude.ai artifact database' : 'browser storage'}`));
}

function dataCard(ctx) {
  const m = ctx.model;
  const counts = Object.fromEntries(COLLECTIONS.map((c) => [c, ctx.store.state[c].size]));
  const where = ctx.mode === 'cloud'
    ? h('div.notice.good', icon('shield'), h('div', h('b', 'Stored in this artifact’s private database on claude.ai. '), 'The same data appears on your laptop and iPhone when you open this page signed in, and your scheduled job search writes into it. It is kept until you delete it or delete the artifact. Keep an occasional JSON backup anyway.'))
    : h('div.notice.warn', icon('alert'), h('div', h('b', 'Stored only in this browser. '), 'It does not sync between devices or browsers. Clearing site data, private browsing, or Safari removing data from sites you have not opened in a while can erase it. ', ctx.persisted ? 'The browser agreed to keep this site’s data persistently, which lowers but does not remove that risk. ' : '', 'Back up regularly.'));
  const save = async (name, text, type) => { try { if (await saveFile(name, text, type)) toast(`Saved ${name}`); } catch (e) { toast(e.message, { tone: 'bad' }); } };
  const restoreInput = h('input', { type: 'file', id: 'restore-file', accept: '.json,application/json', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const data = JSON.parse(await readFileText(f)); await restoreFlow(ctx, data, f.name); } catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, { tone: 'bad' }); }
  } });
  return h('section.card.stack', h('div.card-head', { style: { marginBottom: 0 } }, h('h3', 'Your data, backup and restore'), h('span.sub', ctx.store.lastSyncAt ? `Last update ${fmtTime(ctx.store.lastSyncAt.toISOString())}` : '')),
    where,
    h('div.stat-row', h('div.stat', h('b', String(counts.jobs)), h('span', 'jobs')), h('div.stat', h('b', String(counts.applications)), h('span', 'applications')), h('div.stat', h('b', String(counts.tasks)), h('span', 'tasks')), h('div.stat', h('b', String(counts.jobMeta)), h('span', 'jobs with your notes/flags')), h('div.stat', h('b', String(counts.imports)), h('span', 'imports'))),
    h('div.row',
      btn('Back up everything (JSON)', () => save(`jobhunt-backup-${fileStamp()}.json`, JSON.stringify(makeBackup(ctx.store, ctx.mode), null, 1), 'application/json'), { kind: 'primary', ico: 'download' }),
      h('label.btn', { for: 'restore-file', tabindex: '0', role: 'button', onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restoreInput.click(); } } }, icon('upload'), h('span.lbl', 'Restore a backup'), restoreInput)),
    h('div.row',
      btn('Jobs CSV', () => save(`jobhunt-jobs-${fileStamp()}.csv`, jobsCsv(m.jobs.filter((j) => !j.hidden)), 'text/csv'), { small: true, ico: 'download' }),
      btn('Applications CSV', () => save(`jobhunt-applications-${fileStamp()}.csv`, appsCsv(m.apps), 'text/csv'), { small: true, ico: 'download' }),
      btn('Tasks CSV', () => save(`jobhunt-tasks-${fileStamp()}.csv`, tasksCsv(m.tasks), 'text/csv'), { small: true, ico: 'download' })),
    h('details', h('summary', { style: { cursor: 'pointer', minHeight: '40px', display: 'flex', alignItems: 'center', color: 'var(--bad)' } }, 'Delete all data'),
      h('div.stack', { style: { marginTop: '8px' } }, h('p.small', { style: { margin: 0 } }, `This deletes every job, note, application, task, import record and setting${ctx.mode === 'cloud' ? ' from the tracker database, on all your devices. Your scheduled search will start adding new jobs again on its next run' : ' in this browser'}. Download a backup first.`),
        h('div', btn('Delete all data…', async () => {
          if (!(await confirm({ title: 'Delete all JobHunt data?', text: `${counts.jobs} jobs, ${counts.applications} applications and ${counts.tasks} tasks will be permanently deleted. This cannot be undone.`, confirmLabel: 'Delete everything', danger: true, typeToConfirm: 'DELETE' }))) return;
          const ops = planDeleteAll(ctx.store);
          const r = await ctx.store.runOps(ops);
          toast(r.failed ? `Deleted ${r.done}; ${r.failed} could not be deleted` : 'All data deleted', { tone: r.failed ? 'bad' : 'good' });
        }, { kind: 'danger', ico: 'trash' })))));
}

/** Validates a backup, shows what will change, then restores (merge or replace). */
export async function restoreFlow(ctx, backup, fileName = '') {
  const v = validateBackup(backup);
  if (!v.ok) {
    await modal({ title: 'This backup can’t be restored', body: h('div.stack', h('p', { style: { margin: 0 } }, fileName), h('ul', v.errors.map((e) => h('li', e)))), actions: [{ label: 'Close', kind: 'primary', run: () => true }] });
    return;
  }
  let mode = 'merge';
  const summary = h('div');
  const draw = () => {
    const p = planRestore(backup, ctx.store, mode);
    summary.replaceChildren(h('div.stat-row', h('div.stat', h('b', String(p.counts.add)), h('span', 'to add')), h('div.stat', h('b', String(p.counts.update)), h('span', 'to update')), h('div.stat', h('b', String(p.counts.keep)), h('span', 'unchanged')), h('div.stat', h('b', String(p.counts.remove)), h('span', { style: { color: p.counts.remove ? 'var(--bad)' : null } }, 'to delete'))));
  };
  const radio = (val, label, hint) => h('label.check', { style: { alignItems: 'flex-start' } }, h('input', { type: 'radio', name: 'restore-mode', value: val, checked: mode === val, onchange: () => { mode = val; draw(); } }), h('span', h('b', label), h('span.small.muted', { style: { display: 'block' } }, hint)));
  draw();
  const body = h('div.stack',
    h('p', { style: { margin: 0 } }, `${fileName || 'Backup'} · made ${v.exportedAt ? fmtDay(v.exportedAt.slice(0, 10)) + ' ' + fmtTime(v.exportedAt) : 'at an unknown time'}`),
    h('p.small.muted', { style: { margin: 0 } }, Object.entries(v.counts).map(([k, n]) => `${n} ${k}`).join(' · ')),
    radio('merge', 'Merge (recommended)', 'Adds what is missing. Where a record exists in both, the newer version wins, activity histories are combined and notes are never emptied. Nothing is deleted.'),
    radio('replace', 'Replace', 'Makes your data exactly match the backup. Records that are not in the backup are deleted.'),
    summary);
  const ok = await modal({
    title: 'Restore backup', body,
    actions: [{ label: 'Cancel' }, { label: 'Restore', kind: 'primary', run: async () => {
      if (mode === 'replace' && !(await confirm({ title: 'Replace all current data?', text: 'Anything not in the backup will be deleted.', confirmLabel: 'Replace', danger: true, typeToConfirm: 'REPLACE' }))) return false;
      return true;
    } }],
  });
  if (!ok) return;
  const plan = planRestore(backup, ctx.store, mode);
  const r = await ctx.store.runOps(plan.ops);
  toast(r.failed ? `Restored ${r.done} records; ${r.failed} failed: ${r.errors[0]}` : `Backup restored (${plan.counts.add} added, ${plan.counts.update} updated${plan.counts.remove ? ', ' + plan.counts.remove + ' deleted' : ''})`, { tone: r.failed ? 'bad' : 'good' });
}
