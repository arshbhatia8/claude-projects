import { h, icon, btn, pill, select, input, field, confirm, toast } from '../dom.js';
import * as A from '../../core/actions.js';
import { EVENT_LABEL, gmailQuery } from '../../core/mail.js';
import { companyMatches } from '../../core/engine.js';
import { fmtDay, fmtTime, str, safeUrl } from '../../core/util.js';
import { GMAIL_TOOLS } from '../runtime.js';

const TYPE_TONE = { applied: 'info', assessment: 'warn', interview: 'accent', reschedule: 'accent', rejection: 'bad', offer: 'good', info_request: 'warn', recruiter: 'muted', marketing: 'muted', other: 'muted' };
const when = (iso) => (iso ? `${fmtDay(str(iso).slice(0, 10))} · ${fmtTime(iso)}` : '');

export function connectionCard(ctx, { compact = false } = {}) {
  const g = ctx.gmail || {};
  const s = ctx.model.system.gmail || {};
  const sched = (ctx.model.runs || []).find((r) => r.kind === 'gmail-sync' && /scheduled/.test(r.by || ''));
  const lines = [
    s.lastSyncAt ? h('span', `Last successful sync ${ctx.relTime(s.lastSyncAt)} (${s.lastSyncBy || 'unknown'})`) : h('span', 'No successful sync yet'),
    s.lastAttemptOk === false ? h('span', { style: { color: 'var(--bad)' } }, `Last attempt failed ${ctx.relTime(s.lastAttemptAt)}: ${s.lastError}`) : null,
    sched ? h('span.faint', `Background (scheduled) sync last ran ${ctx.relTime(sched.finishedAt || sched.startedAt)}${sched.ok ? '' : ' with errors'}`) : h('span.faint', 'The background (scheduled) sync has not reported a run yet'),
  ];
  let state, actions = [];
  if (ctx.mode !== 'cloud') {
    state = pill('Not available here', 'muted');
    actions = [h('span.small.muted', 'Gmail sync works only in the claude.ai version of this page.')];
  } else if (!g.available) {
    state = pill('Unavailable in this view', 'warn');
    actions = [h('span.small.muted', 'Open this page in the Claude app or at claude.ai while signed in.')];
  } else if (g.state === 'granted') {
    state = pill(g.syncing ? 'Syncing…' : 'Connected · read-only', g.syncing ? 'info' : 'good', g.syncing ? 'refresh' : 'shield');
    actions = [btn(g.syncing ? 'Syncing…' : 'Sync now', () => g.sync({ userAction: true }), { kind: 'primary', ico: 'refresh', disabled: g.syncing, small: compact }),
      compact ? null : btn('Turn off for this page', () => ctx.run(() => g.manage()), { kind: 'ghost', small: true })];
  } else if (g.state === 'denied') {
    state = pill('Turned off for this page', 'warn');
    actions = [btn('Allow again', () => ctx.run(() => g.manage()), { ico: 'shield' })];
  } else {
    state = pill('Not connected yet', 'muted');
    actions = [btn(g.syncing ? 'Connecting…' : 'Connect Gmail (read-only)', () => g.connect(), { kind: 'primary', ico: 'mail', disabled: g.syncing })];
  }
  return h('div.card.stack', h('div.card-head', { style: { marginBottom: 0 } }, h('h3', 'Gmail connection'), state),
    g.error ? h('div.notice.bad', icon('alert'), h('div', g.error)) : null,
    h('div.stack.tight.small', lines),
    h('div.row', actions),
    compact ? null : h('details.small', h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center', color: 'var(--fg-2)' } }, 'What this page can do with Gmail'),
      h('div.stack.tight', { style: { marginTop: '6px' } },
        h('p', { style: { margin: 0 } }, 'This page uses your claude.ai Gmail connector and may call only two read tools: ', h('code', GMAIL_TOOLS.join(', ')), '. It cannot send, draft, label, move or delete mail. When you first press Connect, claude.ai asks you to allow Gmail for this page.'),
        h('p', { style: { margin: 0 } }, 'It searches only for hiring-related mail:'), h('pre.code', gmailQuery('YYYY-MM-DD')),
        h('p', { style: { margin: 0 } }, 'For each match it stores the sender, date, subject, a short snippet and what the email meant. A short text excerpt is kept only until the email is processed (or, if flagged, until you review it), then deleted.'),
        h('p', { style: { margin: 0 } }, 'To disconnect completely: claude.ai → Settings → Connectors → Gmail → Disconnect, and optionally revoke access in your Google Account → Security → Third-party connections. “Turn off for this page” only blocks this page.'))));
}

function reviewCard(ctx, e) {
  const m = ctx.model;
  const p = e.parsed || {};
  const apps = m.apps.slice().sort((a, b) => (companyMatches(b.company, p.company) ? 1 : 0) - (companyMatches(a.company, p.company) ? 1 : 0) || a.company.localeCompare(b.company));
  const appSel = select('rv-app-' + e.id, [['', 'Choose an application…'], ...apps.map((a) => [a.id, `${a.company} · ${a.title} (${a.stage})`])], (e.result.candidates || []).find((c) => !c.startsWith('job:')) || '', { 'aria-label': 'Application this email is about' });
  const typeSel = select('rv-type-' + e.id, [['', `Keep: ${EVENT_LABEL[p.type] || p.type}`], ...['applied', 'assessment', 'interview', 'reschedule', 'rejection', 'offer', 'info_request'].map((t) => [t, EVENT_LABEL[t]])], '', { 'aria-label': 'What the email means' });
  const co = input('rv-co-' + e.id, p.company || '', { placeholder: 'Company' });
  const ro = input('rv-ro-' + e.id, p.role || '', { placeholder: 'Role' });
  const resolve = (r) => ctx.run(() => A.resolveEvent(ctx.store, e.id, { ...r, type: typeSel.value }), 'Saved. The tracker updates in a moment.');
  return h('article.card.stack', { style: { padding: '14px' } },
    h('div.row.between', h('div', { style: { minWidth: 0 } }, h('b', { style: { overflowWrap: 'anywhere' } }, e.subject || '(no subject)'), h('div.small.muted', { style: { overflowWrap: 'anywhere' } }, `${e.from} · ${when(e.receivedAt)}`)),
      pill(EVENT_LABEL[p.type] || p.type, TYPE_TONE[p.type] || 'muted')),
    e.snippet ? h('p.small', { style: { margin: 0, color: 'var(--fg-2)' } }, `“${e.snippet}”`) : null,
    h('div.notice.warn', icon('alert'), h('div', h('b', 'Why it needs you: '), e.result.reason)),
    h('div.small.faint', `Read as: ${[p.company || 'no company', p.role || 'no role', p.deadline ? 'deadline ' + p.deadline : '', p.interviewDate ? 'interview ' + p.interviewDate + (p.interviewTime ? ' ' + p.interviewTime : '') : ''].filter(Boolean).join(' · ')} · ${Math.round((p.confidence || 0) * 100)}% sure`),
    h('div.grid-2', field('It is about', appSel), field('It means', typeSel)),
    h('div.row', btn('Apply to this application', () => { if (!appSel.value) return toast('Choose an application first.', { tone: 'bad' }); resolve({ action: 'app', appId: appSel.value }); }, { kind: 'primary', small: true }),
      btn('Ignore (not a hiring update)', () => resolve({ action: 'ignore' }), { small: true, kind: 'ghost' }),
      safeUrl(e.viewUrl) ? h('a.btn.sm.ghost', { href: safeUrl(e.viewUrl), target: '_blank', rel: 'noopener noreferrer' }, icon('external', 16), 'Open in Gmail') : null),
    h('details', h('summary', { style: { cursor: 'pointer', minHeight: '36px', display: 'flex', alignItems: 'center', color: 'var(--fg-2)' } }, 'Or start a new application from this email'),
      h('div.row', { style: { marginTop: '8px' } }, h('div', { style: { flex: 1, minWidth: '140px' } }, co), h('div', { style: { flex: 1, minWidth: '140px' } }, ro),
        btn('Create', () => resolve({ action: 'new', company: co.value, role: ro.value }), { small: true }))));
}

export default function inbox(ctx) {
  const m = ctx.model;
  const st = ctx.ui.inbox = ctx.ui.inbox || { show: 'updates' };
  const events = m.mailEvents;
  const review = events.filter((e) => e.result && e.result.status === 'review');
  const pending = events.filter((e) => !e.result);
  const applied = events.filter((e) => e.result && e.result.status === 'applied');
  const ignored = events.filter((e) => e.result && e.result.status === 'ignored');
  const row = (e) => {
    const r = e.result || {}, p = e.parsed || {};
    const app = r.appId ? m.appById[r.appId] : null;
    return h('div.sub-item', h('div', { style: { minWidth: 0 } },
      h('div', { style: { overflowWrap: 'anywhere' } }, pill(EVENT_LABEL[p.type] || p.type || 'Email', TYPE_TONE[p.type] || 'muted'), ' ', h('b', e.subject || '(no subject)')),
      h('div.small.muted', { style: { overflowWrap: 'anywhere' } }, `${e.from} · ${when(e.receivedAt)}`),
      h('div.small', { style: { color: r.status === 'ignored' ? 'var(--fg-3)' : 'var(--fg-2)' } }, r.status === 'applied' ? `${app ? `${app.company} · ${app.title}: ` : ''}${r.action || 'recorded'}${r.reason ? ' — ' + r.reason : ''}` : r.reason || 'Waiting to be processed')),
    h('div.row', app ? btn('Open', () => ctx.openApp(app.id), { small: true, kind: 'ghost' }) : null,
      r.status === 'ignored' ? btn('Re-check', () => ctx.run(() => A.reprocessEvent(ctx.store, e.id), 'Re-checking'), { small: true, kind: 'ghost' }) : null));
  };
  const tabs = [['updates', `Tracker updates (${applied.length})`], ['ignored', `Ignored (${ignored.length})`]];
  return h('div.stack',
    h('div.page-head', h('div', h('h1', 'Gmail Updates'), h('p', 'Hiring emails are read automatically and turned into tracker updates. Anything the app isn’t sure about waits here for you.'))),
    connectionCard(ctx),
    review.length ? h('section.stack', h('h2.section', `Needs your review `, h('span.faint', String(review.length))), ...review.slice(0, 30).map((e) => reviewCard(ctx, e)))
      : h('div.notice.good', icon('check'), h('div', 'Nothing to review. Every processed email was either matched with confidence or ignored as unrelated.')),
    pending.length ? h('div.notice.info', icon('refresh'), h('div', `${pending.length} email${pending.length === 1 ? '' : 's'} waiting to be processed. This happens automatically within seconds while the page is open.`)) : null,
    h('section.card.stack', h('div.chips', { role: 'tablist' }, tabs.map(([v, l]) => h('button.chip', { type: 'button', role: 'tab', 'aria-pressed': st.show === v ? 'true' : 'false', onclick: () => { st.show = v; ctx.refresh(); } }, l))),
      (() => {
        const list = st.show === 'ignored' ? ignored : applied;
        if (!list.length) return h('p.faint', { style: { margin: 0 } }, events.length ? 'Nothing here yet.' : 'No emails have been read yet. Connect Gmail above, or wait for the scheduled sync.');
        return h('div.sub-list', list.slice(0, 80).map(row));
      })(),
      st.show === 'ignored' ? h('p.faint.small', { style: { margin: 0 } }, 'Ignored emails changed nothing. Only the sender, date, subject, snippet and the reason are kept.') : null),
    h('section.card.stack', h('div.card-head', { style: { marginBottom: 0 } }, h('h3', 'Email data stored'), h('span.sub', `${events.length} email record${events.length === 1 ? '' : 's'}`)),
      h('p.small.muted', { style: { margin: 0 } }, 'Deleting email data removes every stored email record and the Gmail sync state, and removes email subjects from application histories. Applications, jobs, tasks and your notes stay. The next sync reads recent mail again.'),
      h('div', btn('Delete email data…', async () => {
        if (!(await confirm({ title: 'Delete stored email data?', text: `${events.length} email records will be deleted and subjects removed from application histories. Applications, jobs and tasks are kept.`, confirmLabel: 'Delete email data', danger: true }))) return;
        const n = await ctx.run(() => A.deleteEmailData(ctx.store));
        if (n != null) toast(`Deleted ${n} email records`);
      }, { kind: 'danger', ico: 'trash', small: true }))));
}
