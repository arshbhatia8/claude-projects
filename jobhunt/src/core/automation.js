// Runs the automation from the page: Gmail sync (through the claude.ai Gmail connector, read-only tools)
// and the engine that turns stored emails and jobs into tracker updates.
import { planAutomation } from './engine.js';
import { classifyEmail, gmailQuery } from './mail.js';
import { mergeSettings } from './schema.js';
import { now, toDay, addDays, str, uid } from './util.js';

const RUNS_KEPT = 150;
const runId = () => 'run_' + now().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + uid().slice(0, 5);

/** Plans and applies the engine. Uses a short lease so two open tabs/devices don't race. */
export async function runEngine(store, { by = 'page' } = {}) {
  const lease = await store.acquire('system', 'engine', 45000).catch(() => ({ acquired: true }));
  if (!lease.acquired) return { skipped: 'Another open copy is processing right now' };
  const startedAt = now().toISOString();
  const plan = planAutomation(store.state, { nowIso: startedAt, by });
  if (!plan.ops.length) return { ...plan, nothing: true };
  const res = await store.runOps(plan.ops);
  const finishedAt = now().toISOString();
  const summary = { kind: 'engine', by, startedAt, finishedAt, ok: !res.failed, counts: { ...plan.counts, writes: res.done, failedWrites: res.failed }, errors: res.errors.slice(0, 10) };
  await store.set('runs', runId(), summary).catch(() => {});
  await store.merge('system', 'engine', { lastRunAt: finishedAt, lastRunBy: by, lastOk: !res.failed, lastCounts: summary.counts, lastErrors: summary.errors }).catch(() => {});
  await pruneRuns(store);
  return { ...plan, result: res };
}

async function pruneRuns(store) {
  const runs = [...store.state.runs].sort((a, b) => str(b[1].startedAt).localeCompare(str(a[1].startedAt)));
  for (const [id] of runs.slice(RUNS_KEPT)) await store.delete('runs', id).catch(() => {});
}

/** Plain text without quoted replies or signatures, at most `n` characters. */
export function cleanBody(text, n = 2500) {
  const lines = str(text).replace(/\r/g, '').split('\n');
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^\s*On .{5,120} wrote:\s*$/.test(l) || /^-{2,}\s*Original Message/i.test(l) || /^\s*From: .+ Sent: /i.test(l)) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim().slice(0, n);
}

/**
 * Reads new hiring-related Gmail messages and stores them as mailEvents.
 * `call(tool, input)` runs one Gmail connector tool and resolves its payload.
 * Only `search_threads` and `get_thread` are ever called.
 */
export async function syncGmail(store, call, { by = 'page', maxThreads = 100 } = {}) {
  const settings = mergeSettings(store.get('settings', 'main'));
  const sys = store.get('system', 'gmail') || {};
  const startedAt = now().toISOString();
  const lookback = Number(settings.automation.gmailLookbackDays) || 45;
  // Incremental: start a day before the newest email already seen (Gmail's after: is by date).
  const since = sys.lastMessageDay ? addDays(sys.lastMessageDay, -1) : addDays(toDay(startedAt), -lookback);
  const query = gmailQuery(since);
  const counts = { threads: 0, messages: 0, new: 0, candidates: 0, stored: 0, skippedKnown: 0 };
  const errors = [];
  let newest = sys.lastMessageDay || '';
  try {
    let pageToken = '';
    const seen = [];
    do {
      const r = await call('search_threads', { query, pageSize: 25, view: 'THREAD_VIEW_MINIMAL', ...(pageToken ? { pageToken } : {}) });
      const threads = (r && r.threads) || [];
      counts.threads += threads.length;
      for (const t of threads) for (const m of t.messages || []) seen.push({ ...m, threadId: m.threadId || t.id });
      pageToken = (r && r.nextPageToken) || '';
    } while (pageToken && counts.threads < maxThreads);
    // Note: search previews show the oldest ~5 messages per thread, so long threads are re-read below.
    const byThread = new Map();
    for (const m of seen) { if (!byThread.has(m.threadId)) byThread.set(m.threadId, []); byThread.get(m.threadId).push(m); }
    for (const [threadId, msgs] of byThread) {
      counts.messages += msgs.length;
      const unknown = msgs.filter((m) => m.id && !store.get('mailEvents', m.id) && !(m.labelIds || []).includes('SENT') && !(m.labelIds || []).includes('DRAFT'));
      const needsFull = unknown.length || msgs.length >= 5;
      if (!needsFull) { counts.skippedKnown += msgs.length; continue; }
      // Quick look at subject + snippet: only fetch bodies for possible hiring mail.
      const quick = unknown.map((m) => ({ m, c: classifyEmail({ from: m.sender, subject: m.subject, snippet: m.snippet, receivedAt: m.date }) }));
      let full = null;
      if (quick.some((x) => x.c.type !== 'marketing') || msgs.length >= 5) {
        try { full = await call('get_thread', { threadId, messageFormat: 'PLAIN_TEXT' }); } catch (e) { errors.push(`Thread ${threadId}: ${e.message || e.code}`); }
      }
      const fullMsgs = (full && full.messages) || [];
      const all = new Map(msgs.map((m) => [m.id, m]));
      for (const fm of fullMsgs) all.set(fm.id, { ...all.get(fm.id), ...fm, threadId });
      for (const m of all.values()) {
        if (!m.id || store.get('mailEvents', m.id)) continue;
        if ((m.labelIds || []).includes('SENT') || (m.labelIds || []).includes('DRAFT')) continue;
        counts.new++;
        const excerpt = cleanBody(m.plaintextBody || m.plaintext_body || '');
        const c = classifyEmail({ from: m.sender, subject: m.subject, snippet: m.snippet, excerpt, receivedAt: m.date });
        if (c.type !== 'marketing' && c.type !== 'other') counts.candidates++;
        const keepBody = c.type !== 'marketing' && c.type !== 'other';
        await store.set('mailEvents', m.id, {
          messageId: m.id, threadId, receivedAt: m.date || '', from: str(m.sender).slice(0, 200), subject: str(m.subject).slice(0, 200), snippet: str(m.snippet).slice(0, 240),
          excerpt: keepBody ? excerpt : '', viewUrl: str(m.viewUrl).startsWith('https://mail.google.com/') ? m.viewUrl : '', capturedAt: now().toISOString(), capturedBy: by,
        });
        counts.stored++;
        const d = toDay(m.date);
        if (d && d > newest) newest = d;
      }
    }
  } catch (e) {
    errors.push(gmailErrorText(e));
  }
  const finishedAt = now().toISOString();
  const ok = !errors.length;
  const rec = { kind: 'gmail-sync', by, startedAt, finishedAt, ok, counts, errors: errors.slice(0, 10), query };
  await store.set('runs', runId(), rec).catch(() => {});
  const patch = { lastAttemptAt: finishedAt, lastAttemptBy: by, lastAttemptOk: ok, lastError: ok ? '' : errors[0] };
  if (ok || counts.stored) Object.assign(patch, { lastSyncAt: finishedAt, lastSyncBy: by, lastMessageDay: newest, lastCounts: counts });
  await store.merge('system', 'gmail', patch).catch(() => {});
  return rec;
}

export function gmailErrorText(e) {
  const code = e && e.code;
  return ({
    needs_reauth: 'Gmail needs to be reconnected: claude.ai → Settings → Connectors → Gmail.',
    server_not_connected: 'Gmail isn’t connected to your claude.ai account. Add it in claude.ai → Settings → Connectors.',
    selection_required: 'You have more than one Gmail connector. Choose one when claude.ai asks, then sync again.',
    not_in_manifest: 'Gmail access is turned off for this page. Allow it from the page’s Permissions menu.',
    approval_required: 'Gmail access needs your approval. Press Sync now and choose Allow.',
    consent_required: 'Gmail access needs your approval. Press Sync now and choose Allow.',
    blocked_by_policy: 'Your organisation’s policy blocks Gmail for this page.',
    server_unavailable: 'Gmail didn’t answer in time. The next sync will try again.',
    tool_error: `Gmail reported an error: ${(e && e.message) || 'unknown'}`,
    not_granted: 'This view can’t use connectors. Open the page in claude.ai.',
    capability_disabled: 'This view can’t use connectors. Open the page in claude.ai.',
  }[code]) || (e && e.message) || 'Unknown error';
}

/** Next scheduled times (IST) from stored cron-like schedules: [{label, hour, minute}] daily. */
export function nextRuns(schedules = [], ref = now()) {
  const out = [];
  const ist = new Date(ref.getTime() + 5.5 * 3600e3);
  const today = ist.toISOString().slice(0, 10);
  for (const s of schedules) {
    if (s.enabled === false) continue;
    const hhmm = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
    const nowHm = ist.toISOString().slice(11, 16);
    const day = hhmm > nowHm ? today : addDays(today, 1);
    out.push({ label: s.label, kind: s.kind, at: `${day}T${hhmm}:00+05:30` });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
