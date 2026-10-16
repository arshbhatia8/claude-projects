import { h, icon, btn, pill } from '../dom.js';
import { nextRuns } from '../../core/automation.js';
import { fmtDay, fmtTime, str } from '../../core/util.js';
import { connectionCard } from './inbox.js';

const KIND = { discovery: 'Job discovery', 'gmail-sync': 'Gmail sync', engine: 'Tracker engine' };
const when = (iso) => (iso ? `${fmtDay(str(iso).slice(0, 10))} ${fmtTime(iso)}` : '—');

export function healthItems(ctx) {
  const sys = ctx.model.system;
  const runs = ctx.model.runs;
  const last = (kind, okOnly) => runs.find((r) => r.kind === kind && (!okOnly || r.ok));
  const d = sys.discovery || {}, g = sys.gmail || {}, e = sys.engine || {};
  const lastDisc = last('discovery');
  const next = nextRuns((sys.schedule && sys.schedule.items) || []);
  const nextOf = (kind) => next.find((x) => x.kind === kind);
  return [
    { key: 'discovery', title: 'Job discovery (scheduled)', ok: lastDisc ? lastDisc.ok : null,
      last: d.lastRunAt || (lastDisc && (lastDisc.finishedAt || lastDisc.startedAt)), next: nextOf('discovery'),
      detail: lastDisc ? `${lastDisc.counts ? `${lastDisc.counts.found ?? '?'} found · ${lastDisc.counts.added ?? 0} new · ${lastDisc.counts.updated ?? 0} updated` : ''}${lastDisc.errors && lastDisc.errors.length ? ` · ${lastDisc.errors.length} source error(s)` : ''}` : 'No run recorded since the upgrade' },
    { key: 'gmail', title: 'Gmail sync', ok: g.lastAttemptOk ?? (g.lastSyncAt ? true : null), last: g.lastSyncAt, next: nextOf('gmail'),
      detail: g.lastSyncAt ? `${g.lastCounts ? `${g.lastCounts.stored ?? 0} new email record(s) from ${g.lastCounts.threads ?? 0} matching thread(s)` : ''} · by ${g.lastSyncBy || '—'}` : 'No successful sync yet', error: g.lastAttemptOk === false ? g.lastError : '' },
    { key: 'engine', title: 'Tracker engine', ok: e.lastRunAt ? e.lastOk !== false : null, last: e.lastRunAt,
      detail: e.lastCounts ? `${e.lastCounts.events || 0} email(s) · ${e.lastCounts.applied || 0} update(s) · ${e.lastCounts.review || 0} to review · ${e.lastCounts.tasks || 0} task(s) · ${e.lastCounts.merged || 0} duplicate(s) merged` : 'Runs whenever new data arrives while the page is open', error: (e.lastErrors || [])[0] },
  ];
}

export function healthList(ctx, { compact = false } = {}) {
  return h('div.stack.tight', healthItems(ctx).map((x) => h('div.sub-item',
    h('div', { style: { minWidth: 0 } },
      h('div', h('span.stage-dot', { class: x.ok == null ? 'd-muted' : x.ok ? 'd-good' : 'd-bad', style: { display: 'inline-block', marginRight: '8px' } }), h('b', x.title)),
      h('div.small.muted', x.last ? `Last: ${when(x.last)} (${ctx.relTime(x.last)})` : 'Last: never', x.next ? ` · Next: ${when(x.next.at)}` : ''),
      compact ? null : h('div.small.faint', x.detail),
      x.error ? h('div.small', { style: { color: 'var(--bad)' } }, x.error) : null),
    pill(x.ok == null ? 'No data yet' : x.ok ? 'OK' : 'Problem', x.ok == null ? 'muted' : x.ok ? 'good' : 'bad'))));
}

export default function automation(ctx) {
  const m = ctx.model;
  const sched = (m.system.schedule && m.system.schedule.items) || [];
  return h('div.stack',
    h('div.page-head', h('div', h('h1', 'Automation'), h('p', 'How jobs and Gmail updates reach your tracker, when it last worked, and what went wrong.'))),
    h('section.card.stack', h('h3', { style: { margin: 0 } }, 'Pipeline'),
      h('ol.steps',
        h('li', h('div', h('b', 'Find jobs. '), 'A Claude scheduled task searches public job sources and writes new openings straight into this tracker’s database. No upload step.')),
        h('li', h('div', h('b', 'Read Gmail. '), 'A scheduled Gmail pass (while your browser is closed) and this page (when open, if you allowed it) store hiring-related emails as records. Read-only.')),
        h('li', h('div', h('b', 'Update the tracker. '), 'The tracker engine matches each email to an application and updates its status, dates, history and tasks. It runs on the next open of this page on any device, automatically.')),
        h('li', h('div', h('b', 'Ask when unsure. '), 'Emails it can’t match confidently wait in Gmail Updates. Nothing is guessed.'))),
      h('p.small.faint', { style: { margin: 0 } }, 'Scheduled tasks run on Anthropic’s servers as part of your Claude plan: no extra billing. They run even when this page is closed. Status updates from those emails are applied the next time this page opens on any device.')),
    h('section.card.stack', h('h3', { style: { margin: 0 } }, 'Health'), healthList(ctx)),
    connectionCard(ctx, { compact: true }),
    h('section.card.stack', h('h3', { style: { margin: 0 } }, 'Schedule'),
      sched.length ? h('div.table-wrap', { style: { border: 0 } }, h('table.data', h('thead', h('tr', h('th', 'Task'), h('th', 'Runs (IST)'), h('th', 'Next'))),
        h('tbody', sched.map((s) => { const n = nextRuns([s])[0]; return h('tr', { style: { cursor: 'default' } }, h('td', s.label), h('td', s.text || `Daily ${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`), h('td.nowrap', s.enabled === false ? 'Paused' : n ? when(n.at) : '—')); }))))
        : h('p.faint', { style: { margin: 0 } }, 'No schedule recorded yet.'),
      h('p.small.faint', { style: { margin: 0 } }, 'Change or pause these in claude.ai → Scheduled tasks. If a scheduled run fails, the next one tries again; nothing is charged.')),
    h('section.card.stack', h('h3', { style: { margin: 0 } }, 'Recent runs'),
      m.runs.length ? h('div.table-wrap', { style: { border: 0 } }, h('table.data', h('thead', h('tr', h('th', 'When'), h('th', 'What'), h('th', 'By'), h('th', 'Result'), h('th', 'Details'))),
        h('tbody', m.runs.slice(0, 40).map((r) => h('tr', { style: { cursor: 'default' } }, h('td.nowrap', when(r.startedAt || r.finishedAt)), h('td', KIND[r.kind] || r.kind), h('td.small', r.by || ''),
          h('td', pill(r.ok ? 'OK' : 'Errors', r.ok ? 'good' : 'bad')),
          h('td.small', { style: { minWidth: '220px' } }, Object.entries(r.counts || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ') || '—', (r.errors || []).length ? h('div', { style: { color: 'var(--bad)' } }, r.errors.slice(0, 3).join('; ')) : null))))))
        : h('p.faint', { style: { margin: 0 } }, 'No runs recorded yet. The first scheduled run or Gmail sync will appear here.')),
    h('section.card.stack', h('h3', { style: { margin: 0 } }, 'Exceptions'),
      h('p.small.muted', { style: { margin: 0 } }, 'For a job found somewhere the automation can’t reach, add it by hand or import a file. This is not needed for normal use.'),
      h('div.row', btn('Manual import', () => ctx.go('import'), { small: true, ico: 'import' }))),
    icon ? null : null);
}
