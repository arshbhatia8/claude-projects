// Background work inside the open page: the engine runs whenever new data arrives, and Gmail is
// synced through the claude.ai Gmail connector (read-only tools) when you have allowed it.
import { runEngine, syncGmail, gmailErrorText } from '../core/automation.js';
import { planAutomation } from '../core/engine.js';
import { mergeSettings } from '../core/schema.js';
import { now } from '../core/util.js';

export const GMAIL_SERVER = 'Gmail';
export const GMAIL_TOOLS = ['search_threads', 'get_thread']; // the only Gmail tools this page may call
const SYNC_EVERY_MS = 30 * 60 * 1000;

export function startRuntime(ctx) {
  const g = ctx.gmail = { available: false, state: 'unavailable', syncing: false, lastResult: null, error: '' };
  let mcp = null, perms = null, engineBusy = false, engineAgain = false, timer = null;

  const call = async (tool, input) => {
    if (!GMAIL_TOOLS.includes(tool)) throw new Error(`Tool ${tool} is not allowed`);
    let attempt = 0;
    for (;;) {
      try {
        const r = await mcp.callTool(GMAIL_SERVER, tool, input, { cache: false });
        return r.payload ?? r.structuredContent ?? r;
      } catch (e) {
        if (e && e.retryable && attempt === 0) { attempt++; await new Promise((res) => setTimeout(res, (e.retryAfterMs || 1500) + Math.random() * 800)); continue; }
        throw e;
      }
    }
  };

  async function refreshState() {
    if (!mcp) { g.state = 'unavailable'; return; }
    g.state = perms ? await perms.state('mcp:' + GMAIL_SERVER).catch(() => 'unavailable') : 'prompt';
    if (g.state === 'unavailable') g.state = 'prompt'; // mcp resolved, so the connector can be asked for
  }

  g.sync = async ({ userAction = false } = {}) => {
    if (!mcp || g.syncing) return null;
    g.syncing = true; g.error = ''; ctx.refreshChrome && ctx.refreshChrome();
    let res;
    try {
      res = await syncGmail(ctx.store, call, { by: userAction ? 'page (you)' : 'page (automatic)' });
      g.lastResult = res;
      if (!res.ok) g.error = res.errors[0];
    } catch (e) { g.error = gmailErrorText(e); }
    g.syncing = false;
    await refreshState();
    ctx.refreshChrome && ctx.refreshChrome();
    kickEngine();
    return res;
  };
  g.connect = () => g.sync({ userAction: true }); // the first call shows claude.ai's consent prompt
  g.manage = async () => {
    if (!perms) throw new Error('Open the artifact’s Permissions menu to turn Gmail off for this page.');
    await perms.manage();
    await refreshState();
    ctx.refreshChrome && ctx.refreshChrome();
  };

  function kickEngine() {
    if (engineBusy) { engineAgain = true; return; }
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!ctx.store.ready) return;
      let plan;
      try { plan = planAutomation(ctx.store.state, { nowIso: now().toISOString() }); } catch (e) { console.error(e); return; }
      if (!plan.ops.length) return;
      engineBusy = true;
      try {
        const r = await runEngine(ctx.store, { by: 'page' });
        if (r && r.counts && (r.counts.applied || r.counts.review || r.counts.created)) ctx.notify && ctx.notify(r.counts);
      } catch (e) { console.error(e); }
      engineBusy = false;
      if (engineAgain) { engineAgain = false; kickEngine(); }
    }, 1200);
  }
  ctx.store.on(kickEngine);
  kickEngine();

  // Connector access (claude.ai only).
  (async () => {
    if (ctx.mode !== 'cloud' || !window.claude || !window.claude.use) return;
    mcp = await window.claude.use('mcp').catch(() => null);
    perms = await window.claude.use('permissions').catch(() => null);
    g.available = !!mcp;
    await refreshState();
    ctx.refreshChrome && ctx.refreshChrome();
    const due = () => {
      const s = ctx.store.get('system', 'gmail') || {};
      const last = Date.parse(s.lastAttemptAt || s.lastSyncAt || 0) || 0;
      return Date.now() - last > SYNC_EVERY_MS;
    };
    const auto = async () => {
      const st = mergeSettings(ctx.store.get('settings', 'main'));
      if (g.state === 'granted' && st.automation.syncGmailOnOpen && due() && !document.hidden) await g.sync();
    };
    await auto();
    // While the page stays open, check again every 30 minutes (only while visible).
    setInterval(auto, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) auto(); });
  })();
}
