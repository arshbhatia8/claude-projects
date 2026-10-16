// End-to-end browser tests (headless Chromium). Run after `npm run build`:  npm run e2e
// A. GitHub Pages copy (browser storage) at desktop size: import, dedupe, tracker, tasks, backup, restore.
// B. iPhone 15 size (393×852): every screen, no sideways scroll, tap targets, drawers, dialogs.
// C. Artifact copy with a stand-in for claude.ai's db capability: loads scheduled-task-shaped jobs,
//    shows a job the "scheduled task" writes while the page is open, and keeps your data separate.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '../../dist');
const shots = join(here, 'out');
mkdirSync(shots, { recursive: true });

const results = [];
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };

// --- static server; /artifact/ wraps the artifact page in the skeleton the host adds ---
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/artifact/') {
    const body = readFileSync(join(dist, 'artifact/index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}</style></head><body>${body}</body></html>`);
  }
  let p = join(dist, 'pages', decodeURIComponent(url.pathname.replace(/^\/jobhunt\//, '/')));
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await pw.chromium.launch();
const CSV = `Job Title,Company,Location,Source,Posted,Salary,Experience,Job URL,Job ID
Product Manager,Nimbus Labs,Pune (Remote),Naukri,2026-10-14,₹18–25 LPA,2-4 years,https://www.naukri.com/job-listings-pm-nimbus-123,REQ-77
Associate Product Manager,Orbit Finance,Mumbai,Indeed,2026-10-12,Not disclosed,1-3 yrs,https://in.indeed.com/viewjob?jk=abc123,
Business Analyst,Kite Retail,Chennai,Wellfound,2026-10-10,,3+ years,https://wellfound.com/jobs/999-business-analyst,BA-1
`;

async function noJunk(page) {
  return page.evaluate(() => !/(^|\s)(null|undefined|NaN|\[object Object\])(\s|$)/.test(document.querySelector('#view')?.innerText || ''));
}
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
function watchErrors(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(NAME|INTERNET|CONNECTION|TUNNEL)|net::/.test(m.text())) errs.push(m.text()); });
  return errs;
}
async function go(page, route) { await page.evaluate((r) => { location.hash = r; }, route); await page.waitForTimeout(250); }
const clickText = (page, text, sel = 'button') => page.locator(sel, { hasText: text }).first().click();

// ======================= A. desktop, browser storage =======================
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await page.goto(base + '/jobhunt/');
  await page.waitForSelector('.rail');
  ok('A1 empty dashboard shows a useful empty state', await page.locator('.empty h3', { hasText: 'No jobs yet' }).count() === 1);
  ok('A1 local-only banner explains no sync', await page.locator('.notice.warn', { hasText: 'browser only' }).count() === 1);

  // Import CSV (paste)
  await go(page, 'import');
  await clickText(page, 'Paste text');
  await page.fill('#import-text', CSV);
  await clickText(page, 'Preview import');
  await page.waitForSelector('text=Preview · Pasted text');
  const newCount = await page.locator('.stat', { hasText: 'new' }).first().locator('b').textContent();
  ok('A2 CSV preview counts 3 new rows', newCount === '3', `new=${newCount}`);
  await clickText(page, 'Import 3 jobs');
  await page.waitForSelector('text=Import of Pasted text finished');
  ok('A2 import summary is accurate', await page.locator('text=3 imported · 0 updated').count() === 1);
  ok('A2 import history lists the run', await page.locator('h3:has-text("Import history") ~ * td', { hasText: 'Pasted text' }).count() >= 1 || (await page.locator('td', { hasText: 'Pasted text' }).count()) >= 1);

  // Re-import: idempotent
  await clickText(page, 'Paste text');
  await page.fill('#import-text', CSV);
  await clickText(page, 'Preview import');
  await page.waitForSelector('text=Preview · Pasted text');
  const dupStat = await page.locator('.stat', { hasText: 'duplicates' }).first().locator('b').textContent();
  ok('A3 re-import finds 3 duplicates and 0 new', dupStat === '3' && (await page.locator('.stat', { hasText: 'new' }).first().locator('b').textContent()) === '0');
  await page.locator('button', { hasText: 'Nothing new' }).click();
  await page.waitForSelector('text=Import of Pasted text finished');

  // JSON import with an invalid row
  const json = JSON.stringify([{ title: 'Solutions Engineer', company: 'Zeta Cloud', location: 'Singapore', url: 'https://boards.greenhouse.io/zeta/jobs/55' }, { title: '', company: 'Broken' }]);
  await clickText(page, 'Paste text');
  await page.fill('#import-text', json);
  await clickText(page, 'Preview import');
  await page.waitForSelector('text=Invalid');
  ok('A4 JSON preview flags the invalid row', await page.locator('td', { hasText: 'Missing job title' }).count() === 1);
  await clickText(page, 'Import 1 job');
  await page.waitForSelector('text=1 imported');

  // Discover + search + filter
  await go(page, 'discover');
  ok('A5 discover lists 4 jobs', await page.locator('.job-card').count() === 4);
  await page.fill('#discover-q', 'nimbus');
  await page.waitForTimeout(400);
  ok('A5 search narrows to the matching job', await page.locator('.job-card').count() === 1);
  await page.fill('#discover-q', '');
  await page.waitForTimeout(400);
  await clickText(page, 'Filters');
  await page.selectOption('#f-platform', 'Indeed');
  await page.waitForTimeout(250);
  ok('A5 platform filter returns only Indeed jobs', await page.locator('.job-card').count() === 1 && (await page.locator('.job-card').first().textContent()).includes('Orbit Finance'));
  await clickText(page, 'Clear 1 filter');
  await page.waitForTimeout(200);

  // Shortlist + favourite from a card
  const nimbus = page.locator('.job-card', { hasText: 'Nimbus Labs' });
  await nimbus.locator('button[aria-label="Add to favourites"]').click();
  await nimbus.locator('button[aria-label="Shortlist"]').click();
  await page.fill('#reason', 'Remote and payments');
  await clickText(page, 'Save', '.modal-foot button');
  await page.waitForTimeout(300);
  await go(page, 'shortlist');
  ok('A6 shortlist shows the job with its reason', await page.locator('.job-card', { hasText: 'Remote and payments' }).count() === 1);

  // Add to tracker: Applied requires a date
  await go(page, 'discover');
  await page.locator('.job-card', { hasText: 'Nimbus Labs' }).locator('button', { hasText: 'Track' }).click();
  await page.selectOption('#stage', 'Applied');
  await page.fill('#appliedOn', '');
  await clickText(page, 'Add to tracker', '.modal-foot button');
  ok('A7 applied stage without a date is refused', await page.locator('.modal-err', { hasText: 'date you applied' }).isVisible());
  await page.fill('#appliedOn', '2026-10-15');
  await clickText(page, 'Add to tracker', '.modal-foot button');
  await page.waitForSelector('text=Suggested next steps');
  ok('A7 follow-up task is suggested, not created automatically', (await page.evaluate(() => window.__jobhunt.store.all('tasks').filter((t) => t.category === 'Follow-up').length)) === 0);
  await clickText(page, 'Create selected', '.modal-foot button');
  await page.waitForTimeout(300);
  ok('A7 accepted suggestion creates one follow-up task', (await page.evaluate(() => window.__jobhunt.store.all('tasks').filter((t) => t.category === 'Follow-up').length)) === 1);

  // Duplicate application guard
  await go(page, 'tracker');
  await clickText(page, 'Add application');
  await page.fill('#company', 'Nimbus Labs Pvt Ltd');
  await page.fill('#title', 'Product Manager');
  await page.fill('#requisitionId', 'REQ-77');
  await page.selectOption('#stage', 'Shortlisted');
  await clickText(page, 'Add to tracker', '.modal-foot button');
  await page.waitForSelector('text=Possible duplicate application');
  ok('A8 duplicate application to the same requisition is caught', true);
  await clickText(page, 'Cancel', '.modal-foot button').catch(() => {});
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Kanban stage move via the card's stage menu
  await go(page, 'tracker');
  await page.locator('.chip', { hasText: 'Board' }).click();
  await page.locator('.kcard', { hasText: 'Nimbus Labs' }).locator('select').selectOption('Interview Scheduled');
  await page.waitForSelector('text=Suggested next steps');
  await clickText(page, 'Not now', '.modal-foot button');
  await page.waitForTimeout(250);
  const stage = await page.evaluate(() => window.__jobhunt.store.all('applications')[0].stage);
  ok('A9 Kanban move changes the stage', stage === 'Interview Scheduled', stage);
  ok('A9 stage history is timestamped', await page.evaluate(() => window.__jobhunt.store.all('applications')[0].history.filter((x) => x.type === 'stage' && /T\d\d:/.test(x.at)).length === 1));
  // Drag and drop a card to another column
  const card = page.locator('.kcard', { hasText: 'Nimbus Labs' });
  await card.dragTo(page.locator('.kcol[aria-label^="Interview Completed"]'));
  await page.waitForTimeout(300);
  if (await page.locator('text=Suggested next steps').count()) await clickText(page, 'Not now', '.modal-foot button');
  ok('A9 drag and drop moves the card', (await page.evaluate(() => window.__jobhunt.store.all('applications')[0].stage)) === 'Interview Completed');

  // Interview + notes in the application drawer
  await page.locator('.kcard', { hasText: 'Nimbus Labs' }).click();
  await clickText(page, 'Interview', '.drawer button');
  await page.fill('#round', 'Round 2 – Hiring manager');
  await page.fill('#date', '2026-10-22');
  await page.fill('#time', '15:30');
  await clickText(page, 'Save interview', '.modal-foot button');
  await page.waitForSelector('text=Suggested next steps');
  await clickText(page, 'Not now', '.modal-foot button');
  await page.waitForTimeout(200);
  ok('A10 interview appears in the application', await page.locator('.drawer', { hasText: 'Round 2 – Hiring manager' }).count() === 1);
  await page.keyboard.press('Escape');

  // Tasks: create, overdue, complete, reschedule
  await go(page, 'tasks');
  await page.locator('.head-actions button', { hasText: 'New task' }).click();
  await page.fill('#title', 'Research Orbit Finance');
  await page.fill('#dueDate', '2026-10-01');
  await clickText(page, 'Add task', '.modal-foot button');
  await page.waitForTimeout(300);
  await page.locator('.chip', { hasText: 'Overdue' }).click();
  ok('A11 overdue view shows the past-due task', await page.locator('.task.overdue', { hasText: 'Research Orbit Finance' }).count() === 1);
  await page.locator('.task', { hasText: 'Research Orbit Finance' }).locator('button', { hasText: '+1 day' }).click();
  await page.waitForTimeout(250);
  const due = await page.evaluate(() => window.__jobhunt.store.all('tasks').find((t) => t.title === 'Research Orbit Finance').dueDate);
  ok('A11 reschedule moves an overdue task to tomorrow', due > '2026-10-01', due);
  await page.locator('.chip', { hasText: 'All open' }).click();
  await page.locator('.task', { hasText: 'Research Orbit Finance' }).locator('.task-hit').click();
  await page.waitForTimeout(250);
  ok('A11 completing a task records completion time', await page.evaluate(() => !!window.__jobhunt.store.all('tasks').find((t) => t.title === 'Research Orbit Finance').completedAt));

  // Calendar shows interview + follow-up
  await go(page, 'calendar');
  await clickText(page, 'List');
  ok('A12 calendar list shows the interview', await page.locator('.agenda-item', { hasText: 'Round 2 – Hiring manager' }).count() === 1);

  // Dashboard numbers
  await go(page, 'dashboard');
  const kv = async (label) => page.locator('.kpi', { hasText: label }).locator('.value').textContent();
  ok('A13 KPI: applications submitted = 1', (await kv('Applications submitted')) === '1');
  ok('A13 KPI: interviews scheduled = 1', (await kv('Interviews scheduled')) === '1');
  await page.locator('.chip', { hasText: 'All time' }).click();
  ok('A13 KPI: new jobs found = 4 (all time)', (await kv('New jobs found')) === '4');
  await go(page, 'reports');
  ok('A13 charts render from records (Reports)', await page.locator('.chart svg').count() >= 1 && (await page.locator('.bar-row').count()) >= 2);
  await go(page, 'dashboard');
  await page.screenshot({ path: join(shots, 'desktop-dashboard.png'), fullPage: true });

  // Persistence across reload
  await page.reload();
  await page.waitForSelector('.rail');
  ok('A14 data survives a reload', (await page.evaluate(() => window.__jobhunt.store.all('jobs').length)) === 4 && (await page.evaluate(() => window.__jobhunt.store.all('applications').length)) === 1);

  // Backup → delete all → restore
  await go(page, 'settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), clickText(page, 'Back up everything')]);
  const backupPath = join(shots, 'backup.json');
  await dl.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const nTasks = await page.evaluate(() => window.__jobhunt.store.all('tasks').length);
  ok('A15 backup contains every collection', backup.app === 'jobhunt-command-center' && backup.collections.jobs.length === 4 && backup.collections.applications.length === 1 && backup.collections.tasks.length === nTasks && 'mailEvents' in backup.collections);
  await page.locator('summary', { hasText: 'Delete all data' }).click();
  await clickText(page, 'Delete all data…');
  await clickText(page, 'Delete everything', '.modal-foot button');
  ok('A15 delete-all requires typing DELETE', await page.locator('.modal-err', { hasText: 'DELETE' }).isVisible());
  await page.fill('#confirm-word', 'DELETE');
  await clickText(page, 'Delete everything', '.modal-foot button');
  await page.waitForTimeout(500);
  ok('A15 delete-all empties the data', (await page.evaluate(() => window.__jobhunt.store.all('jobs').length + window.__jobhunt.store.all('tasks').length)) === 0);
  await page.setInputFiles('#restore-file', backupPath);
  await page.waitForSelector('text=Restore backup');
  await clickText(page, 'Restore', '.modal-foot button');
  await page.waitForTimeout(600);
  ok('A15 restore brings everything back', (await page.evaluate(() => [window.__jobhunt.store.all('jobs').length, window.__jobhunt.store.all('applications').length, window.__jobhunt.store.all('tasks').length].join())) === `4,1,${nTasks}`);
  ok('A15 restored application keeps its history and interview', await page.evaluate(() => { const a = window.__jobhunt.store.all('applications')[0]; return a.interviews.length === 1 && a.history.length >= 3; }));

  // CSV export
  const [csv] = await Promise.all([page.waitForEvent('download'), clickText(page, 'Applications CSV')]);
  const csvPath = join(shots, 'apps.csv'); await csv.saveAs(csvPath);
  ok('A16 applications CSV exports', readFileSync(csvPath, 'utf8').split('\n')[0].startsWith('Company,Job title,Stage'));

  // Every screen renders without errors or overflow
  for (const r of ['dashboard', 'discover', 'shortlist', 'tracker', 'tasks', 'calendar', 'reports', 'import', 'settings', 'inbox', 'automation']) {
    await go(page, r);
    const bad = await page.locator('.notice.bad', { hasText: 'This screen hit an error' }).count();
    ok(`A17 desktop ${r} renders (no overflow, no null/undefined text)`, !bad && await noOverflow(page) && await noJunk(page));
    await page.screenshot({ path: join(shots, `desktop-${r}.png`), fullPage: false });
  }
  ok('A18 no script errors on desktop', errs.length === 0, errs.slice(0, 3).join(' | '));
  writeFileSync(join(shots, 'state.json'), JSON.stringify(await page.evaluate(() => ({ jobs: window.__jobhunt.store.all('jobs').length }))));
  await ctx.close();
}

// ======================= B. iPhone 15 size =======================
{
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: 'Asia/Kolkata',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await page.goto(base + '/jobhunt/');
  await page.waitForSelector('.tabbar');
  // seed via the app's own import
  await go(page, 'import');
  await page.locator('.chip', { hasText: 'Paste text' }).tap();
  await page.fill('#import-text', CSV);
  await page.locator('button', { hasText: 'Preview import' }).tap();
  await page.locator('button', { hasText: 'Import 3 jobs' }).tap();
  await page.waitForSelector('text=3 imported');
  ok('B1 tab bar visible, rail hidden', await page.locator('.tabbar').isVisible() && !(await page.locator('.rail').isVisible()));
  const tabSizes = await page.$$eval('.tabbar .tab', (els) => els.map((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height]));
  ok('B2 tab targets are at least 44×44', tabSizes.every(([w, hh]) => w >= 44 && hh >= 44), JSON.stringify(tabSizes));
  for (const r of ['dashboard', 'discover', 'shortlist', 'tracker', 'tasks', 'calendar', 'reports', 'import', 'settings', 'inbox', 'automation']) {
    await go(page, r);
    const of = await noOverflow(page);
    const bad = await page.locator('.notice.bad', { hasText: 'This screen hit an error' }).count();
    ok(`B3 iPhone ${r}: renders, no horizontal overflow, no junk text`, of && !bad && await noJunk(page));
    await page.screenshot({ path: join(shots, `iphone-${r}.png`), fullPage: true });
  }
  const small = await page.evaluate(() => [...document.querySelectorAll('.content button, .content a.btn, .tabbar .tab')].filter((b) => b.offsetParent && !b.closest('.chart') && !b.closest('details:not([open])')).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 20), h: r.height, w: r.width }; }).filter((x) => x.h < 38 || x.w < 38));
  ok('B4 buttons on Settings are ≥38px (most ≥44px)', small.length === 0, JSON.stringify(small.slice(0, 5)));
  await go(page, 'discover');
  await page.locator('.job-card').first().tap();
  await page.waitForSelector('.drawer');
  const dw = await page.$eval('.drawer', (e) => e.getBoundingClientRect().width);
  ok('B5 job drawer is full width on phone', Math.round(dw) === 393, String(dw));
  await page.screenshot({ path: join(shots, 'iphone-job-drawer.png') });
  await page.locator('.drawer button', { hasText: 'Add to tracker' }).tap();
  await page.waitForSelector('.modal');
  await page.waitForTimeout(400); // let the slide-up finish
  const mb = await page.$eval('.modal', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
  ok('B6 dialog fits the screen as a bottom sheet', mb.bottom <= mb.h + 1 && mb.top >= 0, JSON.stringify(mb));
  const footVisible = await page.$eval('.modal-foot', (e) => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight + 1; });
  ok('B6 primary action stays on screen', footVisible);
  const fontOk = await page.$$eval('.modal input, .modal select', (els) => els.every((e) => parseFloat(getComputedStyle(e).fontSize) >= 16));
  ok('B7 form fields use 16px text (no iOS zoom on focus)', fontOk);
  await page.screenshot({ path: join(shots, 'iphone-modal.png') });
  await page.keyboard.press('Escape'); // closes the dialog
  await page.keyboard.press('Escape'); // closes the drawer
  await page.waitForTimeout(200);
  await page.locator('.tabbar button', { hasText: 'More' }).tap();
  ok('B8 More sheet opens with the other sections', await page.locator('.more-sheet a').count() === 6);
  await page.locator('.more-sheet a', { hasText: 'Calendar' }).tap();
  await page.waitForTimeout(200);
  ok('B8 More sheet navigates', (await page.evaluate(() => location.hash)) === '#calendar');
  ok('B9 no script errors on iPhone', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

// ======================= C. artifact build with a db stand-in =======================
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(() => {
    // Minimal stand-in for claude.use('db'): collections of docs, onSnapshot, set/update/delete with deep-merge update.
    const data = { jobs: new Map(), jobMeta: new Map(), applications: new Map(), tasks: new Map(), imports: new Map(), mailEvents: new Map(), runs: new Map(), system: new Map(), settings: new Map() };
    const subs = new Map();
    const snap = (c) => { const docs = [...data[c]].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) })); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } }; };
    const emit = (c) => setTimeout(() => (subs.get(c) || []).forEach((fn) => fn(snap(c))), 30);
    const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], v) : v; return o; };
    const db = {
      collection: (c) => ({ onSnapshot: (next) => { if (!subs.has(c)) subs.set(c, []); subs.get(c).push(next); setTimeout(() => next(snap(c)), 60); return () => {}; } }),
      doc: (path) => { const [c, id] = path.split('/'); return {
        set: async (d) => { data[c].set(id, JSON.parse(JSON.stringify(d))); emit(c); },
        update: async (d) => { if (!data[c].has(id)) { const e = new Error('missing'); e.code = 'invalid_argument'; throw e; } data[c].set(id, merge(data[c].get(id), JSON.parse(JSON.stringify(d)))); emit(c); },
        delete: async () => { data[c].delete(id); emit(c); },
      }; },
    };
    // Seed: two jobs exactly as the scheduled search writes them (fictional companies).
    const job = (o) => ({ appliedOn: '', category: 'PM', company: 'Acme Pay', ctc: 'Not disclosed', employmentType: 'Full-time', experience: '2–3 yrs', foundOn: '2026-10-16', freshness: '24h', link: 'https://www.linkedin.com/jobs/view/4400000001/', listedAt: '2026-10-15T16:45:00+05:30', listedTimeKnown: true, location: 'Bengaluru (Hybrid)', match: 88, note: 'Payments platform', region: 'India', source: 'LinkedIn', status: 'Not applied', statusSource: 'Gmail', title: 'Product Manager – Payments', ...o });
    data.jobs.set('acme-pay-pm-00001', job({}));
    data.jobs.set('byte-rail-se-00002', job({ title: 'Solutions Engineer', company: 'Byte Rail', category: 'Related', link: 'https://www.linkedin.com/jobs/view/4400000002/', status: 'Applied', appliedOn: '2026-10-13', match: 76 }));
    window.__mockdb = { data, write: (c, id, d) => { data[c].set(id, d); emit(c); } };
    window.__mockJob = job;
    window.claude = { use: async (name) => (name === 'db' ? db : name === 'downloads' ? { save: async () => ({ status: 'saved' }) } : null) };
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await page.goto(base + '/artifact/');
  await page.waitForSelector('.rail');
  ok('C1 artifact mode shows the live database', await page.locator('.rail-foot', { hasText: 'Database live on claude.ai' }).count() === 1);
  await go(page, 'discover');
  ok('C2 jobs written by the scheduled task appear', await page.locator('.job-card').count() === 2);
  ok('C3 Gmail-confirmed application is offered, not auto-tracked', await page.locator('.job-card', { hasText: 'Applied (not tracked)' }).count() === 1 && (await page.evaluate(() => window.__mockdb.data.applications.size)) === 0);
  // The scheduled task writes a new job while the page is open
  await page.evaluate(() => window.__mockdb.write('jobs', 'kappa-tpm-00003', window.__mockJob({ title: 'Technical Program Manager', company: 'Kappa Systems', category: 'Related', link: 'https://www.linkedin.com/jobs/view/4400000003/', match: 81 })));
  await page.waitForTimeout(400);
  ok('C4 a job the scheduled task adds while the page is open appears live', await page.locator('.job-card', { hasText: 'Kappa Systems' }).count() === 1);
  // Your actions go to jobMeta / applications, not over the task's fields
  await page.locator('.job-card', { hasText: 'Acme Pay' }).locator('button[aria-label="Add notes"]').click();
  await page.fill('#notes', 'Ask about UPI autopay');
  await clickText(page, 'Save notes', '.modal-foot button');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ meta: window.__mockdb.data.jobMeta.get('acme-pay-pm-00001'), job: window.__mockdb.data.jobs.get('acme-pay-pm-00001') }));
  ok('C5 your notes are stored separately from the task-written job', st.meta && st.meta.notes === 'Ask about UPI autopay' && !('notes' in st.job));
  // Task re-runs and updates the same job (as its prompt says: update freshness/match only)
  await page.evaluate(() => { const j = window.__mockdb.data.jobs.get('acme-pay-pm-00001'); window.__mockdb.write('jobs', 'acme-pay-pm-00001', { ...j, freshness: 'week', match: 90 }); });
  await page.waitForTimeout(400);
  ok('C6 notes survive a scheduled-task update of the job', (await page.evaluate(() => window.__mockdb.data.jobMeta.get('acme-pay-pm-00001').notes)) === 'Ask about UPI autopay');
  // Track the Gmail-confirmed one → status written back with statusSource You
  await page.locator('.job-card', { hasText: 'Byte Rail' }).locator('button', { hasText: 'Track' }).click();
  ok('C7 applied date prefilled from the Gmail confirmation', (await page.inputValue('#appliedOn')) === '2026-10-13');
  await clickText(page, 'Add to tracker', '.modal-foot button');
  await page.waitForSelector('text=Suggested next steps');
  await clickText(page, 'Not now', '.modal-foot button');
  await page.waitForTimeout(300);
  const bj = await page.evaluate(() => window.__mockdb.data.jobs.get('byte-rail-se-00002'));
  ok('C7 tracking sets status Applied / statusSource You (the task will not overwrite it)', bj.status === 'Applied' && bj.statusSource === 'You');
  for (const r of ['dashboard', 'tracker', 'reports', 'import', 'settings']) {
    await go(page, r);
    ok(`C8 artifact ${r} renders`, !(await page.locator('.notice.bad', { hasText: 'This screen hit an error' }).count()));
  }
  ok('C8 import page reports the automatic sync', await (async () => { await go(page, 'import'); return page.locator('text=Automatic sync from your scheduled job search').count(); })() === 1);
  await page.screenshot({ path: join(shots, 'artifact-import.png') });
  ok('C9 no script errors in artifact mode', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();

  // Signed-out view: db resolves null → a clear message, no local fallback
  const c2 = await browser.newContext();
  await c2.addInitScript(() => { window.claude = { use: async () => null }; });
  const p2 = await c2.newPage();
  await p2.goto(base + '/artifact/');
  await p2.waitForSelector('text=Sign in to see your job search');
  ok('C10 signed-out view explains where the data is, without faking it', true);
  await c2.close();
}

// ======================= D. Gmail automation end to end (artifact + connector stand-ins) =======================
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, timezoneId: 'Asia/Kolkata' });
  await ctx.addInitScript(() => {
    const data = { jobs: new Map(), jobMeta: new Map(), applications: new Map(), tasks: new Map(), imports: new Map(), mailEvents: new Map(), runs: new Map(), system: new Map(), settings: new Map() };
    const subs = new Map();
    const snap = (c) => { const docs = [...data[c]].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) })); return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } }; };
    const emit = (c) => setTimeout(() => (subs.get(c) || []).forEach((fn) => fn(snap(c))), 20);
    const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merge(o[k], v) : v; return o; };
    const db = {
      collection: (c) => ({ onSnapshot: (next) => { if (!subs.has(c)) subs.set(c, []); subs.get(c).push(next); setTimeout(() => next(snap(c)), 40); return () => {}; } }),
      doc: (path) => { const [c, id] = path.split('/'); return {
        set: async (d) => { data[c].set(id, JSON.parse(JSON.stringify(d))); emit(c); },
        update: async (d) => { if (!data[c].has(id)) { const e = new Error('missing'); e.code = 'invalid_argument'; throw e; } data[c].set(id, merge(data[c].get(id), JSON.parse(JSON.stringify(d)))); emit(c); },
        delete: async () => { data[c].delete(id); emit(c); },
        acquire: async () => ({ acquired: true }),
      }; },
    };
    const job = (o) => ({ appliedOn: '', category: 'PM', company: 'Acme Pay', ctc: 'Not disclosed', employmentType: 'Full-time', experience: '2–3 yrs', foundOn: new Date().toISOString().slice(0, 10), freshness: '24h', link: 'https://www.linkedin.com/jobs/view/4400000001/', listedAt: '', listedTimeKnown: false, location: 'Bengaluru (Hybrid)', match: 88, note: '', region: 'India', source: 'LinkedIn', status: 'Not applied', statusSource: 'Discovery', title: 'Product Manager – Payments', ...o });
    data.jobs.set('acme', job({}));
    data.jobs.set('zeta1', job({ company: 'Zeta', title: 'Product Manager', link: 'https://www.linkedin.com/jobs/view/4400000010/' }));
    data.jobs.set('zeta2', job({ company: 'Zeta', title: 'Business Analyst', link: 'https://www.linkedin.com/jobs/view/4400000011/' }));
    // Gmail stand-in: the same shapes the real connector returns.
    const d = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const msgs = [
      { id: 'g1', threadId: 'T1', date: d(30), sender: 'Acme Pay Recruiting <no-reply@greenhouse.io>', subject: 'Thank you for applying to Acme Pay!', snippet: 'Thank you for applying', labelIds: ['INBOX'], plaintextBody: 'Hi Arsh, thank you for applying for the Product Manager – Payments role at Acme Pay. We have received your application.' },
      { id: 'g2', threadId: 'T2', date: d(5), sender: 'Priya <priya@acmepay.com>', subject: 'Interview invitation – Product Manager – Payments', snippet: 'We would like to invite you', labelIds: ['INBOX'], plaintextBody: 'We would like to invite you to an interview for the Product Manager – Payments role at Acme Pay on 28 Oct 2026 at 3:30 PM IST.' },
      { id: 'g3', threadId: 'T3', date: d(4), sender: 'sanjoli.raj@freshersindia.in', subject: 'Congrats Arsh | Your Application is required', snippet: 'WFH Job | Submit your application now! Unsubscribe', labelIds: ['INBOX'], plaintextBody: 'WFH Job. How to Apply: Submit your application now! If you wish to opt out click Unsubscribe.' },
      { id: 'g4', threadId: 'T4', date: d(3), sender: 'careers@zeta.tech', subject: 'Your application to Zeta', snippet: 'Thank you for your interest', labelIds: ['INBOX'], plaintextBody: 'Thank you for applying to Zeta. We have received your application.' },
    ];
    const calls = [];
    let allowed = false;
    window.__gmail = { calls, msgs };
    window.__mockdb = { data, write: (c, id, v) => { data[c].set(id, v); emit(c); } };
    const mcp = {
      callTool: async (server, tool, input) => {
        calls.push({ server, tool, input });
        allowed = true;
        if (server !== 'Gmail') throw Object.assign(new Error('x'), { code: 'not_in_manifest' });
        if (tool === 'search_threads') {
          const th = {}; for (const m of msgs) (th[m.threadId] = th[m.threadId] || { id: m.threadId, messages: [] }).messages.push({ ...m, plaintextBody: undefined });
          return { payload: { threads: Object.values(th) } };
        }
        if (tool === 'get_thread') return { payload: { id: input.threadId, messages: msgs.filter((m) => m.threadId === input.threadId) } };
        throw Object.assign(new Error('x'), { code: 'not_in_manifest' });
      },
    };
    const permissions = { state: async () => (allowed ? 'granted' : 'prompt'), request: async () => ({}), manage: async () => {} };
    window.claude = { use: async (n) => (n === 'db' ? db : n === 'mcp' ? mcp : n === 'permissions' ? permissions : n === 'downloads' ? { save: async () => ({ status: 'saved' }) } : null) };
  });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await page.goto(base + '/artifact/');
  await page.waitForSelector('.rail');
  await page.waitForTimeout(1800);
  ok('D1 nothing is read from Gmail before you connect it', (await page.evaluate(() => window.__gmail.calls.length)) === 0);
  await go(page, 'inbox');
  await page.locator('button', { hasText: 'Connect Gmail (read-only)' }).click();
  await page.waitForTimeout(3500);
  const calls = await page.evaluate(() => window.__gmail.calls.map((c) => c.server + '.' + c.tool));
  ok('D2 only read tools are called (search_threads, get_thread)', calls.length > 0 && calls.every((c) => c === 'Gmail.search_threads' || c === 'Gmail.get_thread'), [...new Set(calls)].join(','));
  const st = await page.evaluate(() => ({ apps: [...window.__mockdb.data.applications.values()], ev: Object.fromEntries([...window.__mockdb.data.mailEvents].map(([k, v]) => [k, v.result && v.result.status])), tasks: [...window.__mockdb.data.tasks.keys()] }));
  const acme = st.apps.find((a) => a.company === 'Acme Pay');
  ok('D3 confirmation + interview emails update the right application automatically', acme && acme.stage === 'Interview Scheduled' && acme.jobId === 'acme' && acme.appliedOn, acme && acme.stage);
  ok('D4 interview date and time recorded from the email', acme && acme.interviews[0] && acme.interviews[0].date === '2026-10-28' && acme.interviews[0].time === '15:30');
  ok('D5 spam email ignored, no application from it', st.ev.g3 === 'ignored' && st.apps.length === 1);
  ok('D6 ambiguous email (2 Zeta jobs, no role) flagged for review', st.ev.g4 === 'review');
  ok('D7 tasks created from confirmed events (follow-up, interview prep)', st.tasks.some((t) => t.startsWith('auto-fu-g1')) && st.tasks.some((t) => t.startsWith('auto-prep-g2')));
  ok('D8 bodies of processed emails are not kept', await page.evaluate(() => [...window.__mockdb.data.mailEvents.values()].filter((e) => e.result && e.result.status !== 'review').every((e) => !e.excerpt)));
  ok('D9 last sync time shown only after a real sync', await page.locator('text=Last successful sync').count() >= 1);
  // Resolve the flagged email from the review queue
  await page.locator('article', { hasText: 'Your application to Zeta' }).locator('details summary').click();
  await page.locator('article', { hasText: 'Your application to Zeta' }).locator('input[placeholder="Role"]').fill('Product Manager');
  await page.locator('article', { hasText: 'Your application to Zeta' }).locator('button', { hasText: 'Create' }).click();
  await page.waitForTimeout(2500);
  const zeta = await page.evaluate(() => [...window.__mockdb.data.applications.values()].find((a) => a.company === 'Zeta'));
  ok('D10 your review decision is applied by the engine', zeta && zeta.stage === 'Applied', zeta && zeta.stage);
  // Re-sync: nothing duplicated
  await page.locator('button', { hasText: 'Sync now' }).first().click();
  await page.waitForTimeout(2500);
  const again = await page.evaluate(() => ({ apps: window.__mockdb.data.applications.size, tasks: window.__mockdb.data.tasks.size, ev: window.__mockdb.data.mailEvents.size, hist: [...window.__mockdb.data.applications.values()].find((a) => a.company === 'Acme Pay').history.length }));
  ok('D11 re-syncing the same mail creates no duplicates', again.apps === 2 && again.ev === 4, JSON.stringify(again));
  // Background (scheduled) Gmail pass writes an email record while the page is open → applied with no click
  await page.evaluate(() => window.__mockdb.write('mailEvents', 'bg1', { messageId: 'bg1', threadId: 'B1', receivedAt: new Date().toISOString(), from: 'careers@acmepay.com', subject: 'Update on your application', snippet: '', excerpt: 'Thank you for your interest in Acme Pay. Unfortunately, we have decided to move forward with other candidates for the Product Manager – Payments position.', capturedBy: 'scheduled', capturedAt: new Date().toISOString(), hint: { type: 'rejection', company: 'Acme Pay', role: 'Product Manager – Payments', confidence: 0.95 } }));
  await page.waitForTimeout(2500);
  ok('D12 an email stored by the scheduled task updates the tracker with no clicks', (await page.evaluate(() => [...window.__mockdb.data.applications.values()].find((a) => a.company === 'Acme Pay').stage)) === 'Rejected');
  // Scheduled discovery writes a duplicate of an existing job + a run record
  await page.evaluate(() => {
    const j = window.__mockdb.data.jobs.get('zeta1');
    window.__mockdb.write('jobs', 'zeta-pm-dup', { ...j, source: 'Naukri', link: 'https://www.linkedin.com/jobs/view/4400000010/?trk=x' });
    window.__mockdb.write('runs', 'run_disc1', { kind: 'discovery', by: 'scheduled', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), ok: true, counts: { found: 12, added: 1, updated: 3 } });
    window.__mockdb.write('system', 'discovery', { lastRunAt: new Date().toISOString(), lastRunOk: true });
  });
  await page.waitForTimeout(2500);
  ok('D13 a duplicate job from the scheduled search is merged automatically', (await page.evaluate(() => (window.__mockdb.data.jobMeta.get('zeta-pm-dup') || {}).mergedInto)) === 'zeta1');
  await go(page, 'dashboard');
  ok('D14 automation health shows the discovery run', await page.locator('.card', { hasText: 'Automation health' }).locator('text=Job discovery').count() === 1 && (await page.locator('.card', { hasText: 'Automation health' }).locator('.pill', { hasText: 'OK' }).count()) >= 2);
  ok('D15 dashboard counts reflect the stored data', (await page.locator('.kpi', { hasText: 'Rejections' }).locator('.value').textContent()) === '1' && (await page.locator('.kpi', { hasText: 'Applications submitted' }).locator('.value').textContent()) === '2');
  await page.screenshot({ path: join(shots, 'artifact-command-center.png'), fullPage: true });
  await go(page, 'tracker');
  ok('D16 tracker table shows Gmail verification', await page.locator('td .pill', { hasText: 'Confirmed by Gmail' }).count() >= 1);
  await page.screenshot({ path: join(shots, 'artifact-tracker.png'), fullPage: false });
  await go(page, 'inbox');
  await page.screenshot({ path: join(shots, 'artifact-inbox.png'), fullPage: true });
  // Delete email data keeps applications
  await page.locator('button', { hasText: 'Delete email data…' }).click();
  await clickText(page, 'Delete email data', '.modal-foot button');
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({ ev: window.__mockdb.data.mailEvents.size, apps: window.__mockdb.data.applications.size }));
  ok('D17 deleting email data keeps applications', after.ev === 0 && after.apps === 2, JSON.stringify(after));
  ok('D18 no script errors with Gmail automation', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
writeFileSync(join(shots, 'results.json'), JSON.stringify(results, null, 1));
process.exit(failed.length ? 1 : 0);
