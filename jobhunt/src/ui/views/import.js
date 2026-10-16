import { h, icon, btn, pill, select, saveFile, readFileText, toast, textarea } from '../dom.js';
import { parseInput, autoMap, planImport, buildImportOps, FIELDS } from '../../core/importer.js';
import { PLATFORMS } from '../../core/schema.js';
import { fmtDay, fmtTime, str, toCsv } from '../../core/util.js';
import { restoreFlow } from './settings.js';

const ACTION = {
  new: ['New', 'good'], update: ['Update', 'info'], unchanged: ['Already here', 'muted'], 'duplicate-in-file': ['Repeat in file', 'muted'], review: ['Possible duplicate', 'warn'], invalid: ['Invalid', 'bad'],
};

export default function importView(ctx) {
  const m = ctx.model;
  const st = ctx.ui.import = ctx.ui.import || { tab: 'file', text: '', parsed: null, mapping: null, fileName: '', decisions: {}, defaultSource: m.settings.importPrefs.defaultSource || '', result: null, busy: false, showMap: false, error: '' };
  const rer = () => ctx.refresh();

  const fromTask = m.jobs.filter((j) => !j.origin);
  const lastFound = fromTask.map((j) => j.foundDay).filter(Boolean).sort().pop();
  const sync = ctx.mode === 'cloud'
    ? h('div.card', h('div.card-head', h('h3', h('span.sync-dot' + (ctx.syncError ? '.off' : '')), 'Automatic sync from your scheduled job search'), pill(ctx.syncError ? 'Problem' : 'Connected', ctx.syncError ? 'bad' : 'good')),
      h('p', { style: { margin: '0 0 8px' } }, 'Your Claude scheduled task writes each job it finds straight into this tracker’s database (collection ', h('code', 'jobs'), '). New jobs appear here on their own, with no import step. Your notes, shortlist, applications and tasks are stored separately, so a search run can never overwrite them.'),
      h('div.stat-row', h('div.stat', h('b', String(fromTask.length)), h('span', 'jobs from the scheduled search')), h('div.stat', h('b', lastFound ? fmtDay(lastFound) : '—'), h('span', 'latest discovery date')), h('div.stat', h('b', ctx.store.lastSyncAt ? fmtTime(ctx.store.lastSyncAt.toISOString()) : '—'), h('span', 'last update received'))),
      h('p.faint.small', { style: { margin: '8px 0 0' } }, 'The search runs on the schedule set in Claude (Scheduled tasks). If a run is paused or fails, nothing new arrives; check the task there. Use the import below for anything else, such as a file from another tool.'))
    : h('div.card', h('div.card-head', h('h3', h('span.sync-dot.local'), 'Scheduled search: not connected in this copy'), pill('This browser only', 'warn')),
      h('p', { style: { margin: 0 } }, 'This copy runs on GitHub Pages and keeps data in this browser. Your scheduled task cannot write here, because a static site has no database the task can reach. To bring jobs in: paste the tables from a search notification below, import a CSV/JSON file, or restore a backup exported from the claude.ai version (Settings → Back up).'));

  const tabs = h('div.chips', { role: 'tablist' },
    h('button.chip', { type: 'button', role: 'tab', 'aria-pressed': st.tab === 'file' ? 'true' : 'false', onclick: () => { st.tab = 'file'; rer(); } }, icon('upload', 14), 'Upload file'),
    h('button.chip', { type: 'button', role: 'tab', 'aria-pressed': st.tab === 'paste' ? 'true' : 'false', onclick: () => { st.tab = 'paste'; rer(); } }, icon('copy', 14), 'Paste text'));

  const load = (text, fileName) => {
    st.error = ''; st.result = null; st.decisions = {};
    try {
      const parsed = parseInput(text, fileName);
      if (parsed.format === 'backup') { st.parsed = null; st.error = ''; restoreFlow(ctx, parsed.backup, fileName); return; }
      st.parsed = parsed; st.fileName = fileName || 'Pasted text'; st.mapping = autoMap(parsed.headers);
      st.showMap = parsed.format === 'csv' && !Object.values(st.mapping).includes('title');
    } catch (e) { st.parsed = null; st.error = e.message; }
    rer();
  };
  const fileInput = h('input', { type: 'file', id: 'import-file', accept: '.csv,.json,.md,.txt,text/csv,application/json,text/plain,text/markdown', class: 'sr', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { load(await readFileText(f), f.name); } catch (err) { st.error = err.message; rer(); }
    e.target.value = '';
  } });
  const drop = h('label.dropzone', { for: 'import-file' }, icon('upload', 26), h('b', 'Choose a CSV, JSON or Markdown file'), h('span.small', 'or drop it here. Files never leave this page until you press Import.'), fileInput, h('span.btn.primary', { role: 'presentation' }, 'Choose file'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) { try { load(await readFileText(f), f.name); } catch (err) { st.error = err.message; rer(); } } });
  const ta = textarea('import-text', st.text, { rows: 8, placeholder: 'Paste CSV rows (with a header row), a JSON list, or the Markdown tables from your job-search notification.', spellcheck: 'false', style: 'font-family: var(--mono); font-size: 13px' });
  ta.addEventListener('input', () => { st.text = ta.value; });
  const paste = h('div.stack', ta, h('div.row', btn('Preview import', () => load(ta.value, ''), { kind: 'primary' }), btn('Clear', () => { st.text = ''; st.parsed = null; rer(); }, { kind: 'ghost' })));

  const templates = h('div.row',
    btn('CSV template', async () => { try { if (await saveFile('jobhunt-import-template.csv', toCsv([], FIELDS.map((f) => ({ label: f.label, key: f.key }))), 'text/csv')) toast('Template saved'); } catch (e) { toast(e.message, { tone: 'bad' }); } }, { small: true, kind: 'ghost', ico: 'download' }),
    h('span.faint.small', 'Column names are matched automatically (e.g. “Job Title”, “Company”, “Apply Link”, “Posted (IST)”, “CTC / Salary”); you can change any match.'));

  return h('div.stack',
    h('div.page-head', h('div', h('h1', 'Import Jobs'), h('p', 'Bring in jobs from your scheduled search, a spreadsheet or another tool. Re-importing the same file never creates duplicates.'))),
    sync,
    h('div.card', h('div.card-head', h('h3', 'Import a file or pasted results'), tabs), st.tab === 'file' ? drop : paste, h('div', { style: { marginTop: '12px' } }, templates)),
    st.error ? h('div.notice.bad', icon('alert'), h('div', st.error)) : null,
    st.parsed ? preview(ctx, st) : null,
    st.result ? resultCard(st.result) : null,
    history(ctx));
}

function preview(ctx, st) {
  const m = ctx.model;
  const existing = ctx.store.all('jobs');
  const plan = planImport(st.parsed, st.mapping, existing, { defaultSource: st.defaultSource });
  const c = plan.counts;
  const rer = () => ctx.refresh();
  const mapGrid = h('div.map-grid', st.parsed.headers.map((hd) => {
    const s = select('map-' + hd.replace(/\W+/g, '_'), [['', '— Ignore —'], ...FIELDS.map((f) => [f.key, f.label + (f.required ? ' *' : '')])], st.mapping[hd]);
    s.addEventListener('change', () => { st.mapping[hd] = s.value; rer(); });
    const sample = st.parsed.rows.map((r) => r[hd]).find((v) => v != null && String(v).trim() !== '');
    return h('label.field', h('span', { style: { overflowWrap: 'anywhere' } }, hd), s, h('span.hint', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, sample != null ? `e.g. ${String(typeof sample === 'object' ? JSON.stringify(sample) : sample).slice(0, 48)}` : 'empty'));
  }));
  const missingReq = FIELDS.filter((f) => f.required && !Object.values(st.mapping).includes(f.key));
  const srcSel = select('import-source', [['', 'Detect from the link'], ...PLATFORMS], st.defaultSource);
  srcSel.addEventListener('change', () => { st.defaultSource = srcSel.value; rer(); });

  const rows = plan.rows.slice(0, 200);
  const table = h('div.table-wrap', h('table.data',
    h('thead', h('tr', h('th', '#'), h('th', 'Result'), h('th', 'Job'), h('th', 'Details'), h('th', 'Notes'))),
    h('tbody', rows.map((r) => {
      const [label, tone] = ACTION[r.action];
      let decision = null;
      if (r.action === 'review') {
        const other = ctx.model.jobById[r.matchId];
        const s = select('dec-' + r.index, [['new', 'Import as a separate job'], ['merge', 'Same job: add as a source'], ['skip', 'Skip this row']], st.decisions[r.index] || 'new');
        s.addEventListener('change', () => { st.decisions[r.index] = s.value; });
        decision = h('div.stack.tight', h('span.small', `${r.matchReason}: “${other ? other.title + ' · ' + (other.location || 'no location') : r.matchId}”`), s);
      }
      const notes = [
        ...r.errors.map((e) => h('div', { style: { color: 'var(--bad)' } }, e)),
        ...r.warnings.map((w) => h('div', { style: { color: 'var(--warn)' } }, w)),
        r.action === 'update' ? h('div', 'Will update: ', Object.keys(r.changes).join(', ')) : null,
        r.action === 'unchanged' || r.action === 'duplicate-in-file' ? h('div.faint', r.matchReason) : null,
        decision,
      ];
      return h('tr', { style: { cursor: 'default' } },
        h('td.faint.num', String(r.index + 1)), h('td', pill(label, tone)),
        h('td', h('span.t-strong', r.job.title || h('span.faint', 'No title')), h('span.cell-sub', r.job.company || 'No company')),
        h('td.small', [r.job.location, r.job.source, r.job.listedAt ? 'posted ' + str(r.job.listedAt).slice(0, 10) : null, r.job.ctc].filter(Boolean).join(' · ') || h('span.faint', '—')),
        h('td.small', { style: { minWidth: '220px' } }, notes));
    }))));
  const toWrite = c.new + c.update + c.review;
  const go = async () => {
    st.busy = true; rer();
    const existingById = Object.fromEntries(existing.map((j) => [j.id, j]));
    const metaById = Object.fromEntries(ctx.store.all('jobMeta').map((x) => [x.id, x]));
    const { ops, summary } = buildImportOps(plan, st.decisions, { existingById, metaById, fileName: st.fileName, format: st.parsed.format, updateExisting: m.settings.importPrefs.updateExisting !== false });
    const res = await ctx.store.runOps(ops);
    st.busy = false;
    st.result = { ...summary, failedWrites: res.failed, writeErrors: res.errors, fileName: st.fileName };
    st.parsed = null; st.text = '';
    rer();
    toast(res.failed ? `Import finished with ${res.failed} save error${res.failed === 1 ? '' : 's'}` : `Imported ${summary.imported} new, updated ${summary.updated}`, { tone: res.failed ? 'bad' : 'good' });
  };
  return h('div.card.stack',
    h('div.card-head', h('h3', `Preview · ${st.fileName}`), h('span.sub', `${st.parsed.format.toUpperCase()} · ${c.total} row${c.total === 1 ? '' : 's'}`)),
    h('div.stat-row',
      h('div.stat', h('b', String(c.new)), h('span', 'new')), h('div.stat', h('b', String(c.update)), h('span', 'will update')),
      h('div.stat', h('b', String(c.unchanged + c.duplicateInFile)), h('span', 'duplicates / already here')), h('div.stat', h('b', String(c.review)), h('span', 'possible duplicates')),
      h('div.stat', h('b', String(c.invalid)), h('span', 'invalid'))),
    missingReq.length ? h('div.notice.warn', icon('alert'), h('div', `Match a column to ${missingReq.map((f) => f.label).join(' and ')} to import. `, btn('Show column matching', () => { st.showMap = true; rer(); }, { small: true }))) : null,
    h('details', { open: st.showMap }, h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center' }, onclick: () => { st.showMap = !st.showMap; } }, `Column matching (${Object.values(st.mapping).filter(Boolean).length} of ${st.parsed.headers.length} columns used)`),
      h('div.stack', { style: { marginTop: '10px' } }, mapGrid, h('label.field', { style: { maxWidth: '320px' } }, h('span', 'Source for rows without one'), srcSel))),
    h('p.small.muted', { style: { margin: 0 } }, 'Updates only fill in or refresh listing details. Your notes, shortlist, applications, tasks and any status you set yourself are never changed. Possible duplicates are imported as separate jobs unless you choose otherwise, and stay flagged for review.'),
    table,
    plan.rows.length > 200 ? h('p.faint.small', `Showing the first 200 of ${plan.rows.length} rows. All rows will be imported.`) : null,
    h('div.row', btn(st.busy ? 'Importing…' : toWrite ? `Import ${toWrite} job${toWrite === 1 ? '' : 's'}` : c.unchanged ? 'Nothing new · record this import' : 'Nothing to import', go, { kind: 'primary', ico: 'import', disabled: st.busy || (!toWrite && !c.unchanged && !c.duplicateInFile && !c.invalid) }),
      btn('Cancel', () => { st.parsed = null; rer(); }, { kind: 'ghost' })));
}

function resultCard(r) {
  return h('div.notice' + (r.failedWrites || r.failed ? '.warn' : '.good'), icon(r.failedWrites ? 'alert' : 'check'),
    h('div.stack.tight', h('b', `Import of ${r.fileName} finished`),
      h('span', `${r.imported} imported · ${r.updated} updated · ${r.unchanged} already up to date · ${r.duplicates} repeated in the file · ${r.skipped} skipped · ${r.failed} invalid`),
      r.writeErrors && r.writeErrors.length ? h('span', { style: { color: 'var(--bad)' } }, `${r.writeErrors.length} could not be saved: ${r.writeErrors.slice(0, 3).join('; ')}`) : null));
}

function history(ctx) {
  const list = ctx.model.imports.slice(0, 20);
  return h('div.card', h('div.card-head', h('h3', 'Import history'), h('span.sub', `${ctx.model.imports.length} import${ctx.model.imports.length === 1 ? '' : 's'}`)),
    list.length ? h('div.table-wrap', { style: { border: 0 } }, h('table.data',
      h('thead', h('tr', h('th', 'When'), h('th', 'Source'), h('th', 'Imported'), h('th', 'Updated'), h('th', 'Duplicates'), h('th', 'Skipped'), h('th', 'Failed'))),
      h('tbody', list.map((r) => h('tr', { style: { cursor: 'default' }, title: (r.errors || []).join('\n') },
        h('td.nowrap', `${fmtDay(str(r.at).slice(0, 10))} ${fmtTime(r.at)}`), h('td', { style: { overflowWrap: 'anywhere' } }, r.fileName || '—', h('span.cell-sub', (r.format || '').toUpperCase())),
        h('td.num', String(r.imported ?? 0)), h('td.num', String(r.updated ?? 0)), h('td.num', String((r.unchanged ?? 0) + (r.duplicates ?? 0))), h('td.num', String(r.skipped ?? 0)),
        h('td.num', r.failed ? h('span', { style: { color: 'var(--bad)' } }, String(r.failed)) : '0')))))) : h('p.faint', { style: { margin: 0 } }, 'No imports yet. Jobs from the scheduled search arrive directly and are not listed here.'));
}
