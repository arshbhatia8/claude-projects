import { h, icon, btn, select } from '../dom.js';
import { STAGES, ENDED_STAGES, IN_PROGRESS_STAGES, STAGE_TONE } from '../../core/schema.js';
import { fmtDay, fmtClock, relDay, str, safeUrl } from '../../core/util.js';
import { pill, icon as ico2 } from '../dom.js';
import { applicationDialog, moveStageDialog, stagePill } from '../forms.js';

function filtered(ctx, st) {
  const q = (st.q || '').toLowerCase().trim();
  return ctx.model.apps.filter((a) => {
    if (st.stage === '__progress' && !IN_PROGRESS_STAGES.includes(a.stage)) return false;
    if (st.stage === '__followup' && !a.followUpDue) return false;
    if (st.stage && !st.stage.startsWith('__') && a.stage !== st.stage) return false;
    if (!st.showEnded && !st.stage && ENDED_STAGES.includes(a.stage) && st.view === 'table') return false;
    if (q && ![a.company, a.title, a.notes, a.nextAction, a.location, a.recruiter && a.recruiter.name].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
const SORTS = {
  updated: (a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)),
  company: (a, b) => a.company.localeCompare(b.company),
  stage: (a, b) => STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage),
  applied: (a, b) => str(b.appliedOn).localeCompare(str(a.appliedOn)),
  followup: (a, b) => str(a.followUpDate || '9999').localeCompare(str(b.followUpDate || '9999')),
};

export default function tracker(ctx) {
  const st = ctx.ui.tracker = { view: 'table', stage: '', q: '', sort: 'updated', dir: 1, showEnded: false, ...(ctx.ui.tracker || {}) };
  const m = ctx.model;
  const head = h('div.page-head',
    h('div', h('h1', 'Application Tracker'), h('p', 'Only applications you have actually sent count as applied. Every stage change is timestamped.')),
    h('div.head-actions', btn('Add application', () => applicationDialog(ctx, {}), { kind: 'primary', ico: 'plus' })));
  if (!m.apps.length) {
    return h('div.stack', head, h('div.empty', icon('tracker', 30), h('h3', 'No applications yet'),
      h('p', 'Open a job in Discover and choose “Track”, or add an application for a job you found elsewhere.'),
      h('div.row', btn('Go to Discover', () => ctx.go('discover'), { kind: 'primary' }), btn('Add application', () => applicationDialog(ctx, {}), { ico: 'plus' }))));
  }
  const q = h('input', { type: 'search', id: 'tracker-q', value: st.q, placeholder: 'Search company, role, notes', 'aria-label': 'Search applications' });
  const box = h('div');
  const stageSel = select('tracker-stage', [['', 'All stages'], ['__progress', 'In progress'], ['__followup', 'Follow-up due'], ...STAGES], st.stage, { 'aria-label': 'Stage filter' });
  stageSel.addEventListener('change', () => { st.stage = stageSel.value; ctx.refresh(); });
  const viewChips = h('div.chips', { role: 'group', 'aria-label': 'View' },
    h('button.chip', { type: 'button', 'aria-pressed': st.view === 'kanban' ? 'true' : 'false', onclick: () => { st.view = 'kanban'; ctx.refresh(); } }, icon('tracker', 14), 'Board'),
    h('button.chip', { type: 'button', 'aria-pressed': st.view === 'table' ? 'true' : 'false', onclick: () => { st.view = 'table'; ctx.refresh(); } }, icon('list', 14), 'Table'));
  const fill = () => { box.replaceChildren(st.view === 'kanban' ? kanban(ctx, filtered(ctx, st)) : table(ctx, st, filtered(ctx, st))); };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { st.q = q.value; fill(); }, 200); });
  fill();
  const ended = m.apps.filter((a) => ENDED_STAGES.includes(a.stage)).length;
  const review = m.mailEvents.filter((e) => e.result && e.result.status === 'review').length;
  const autoCount = m.apps.filter((a) => a.stageSource === 'gmail').length;
  return h('div.stack', head,
    review ? h('div.notice.warn', ico2('mail'), h('div', { style: { flex: 1 } }, h('b', `${review} Gmail email${review === 1 ? '' : 's'} need${review === 1 ? 's' : ''} your review `), 'before the tracker can use them.'), btn('Review', () => ctx.go('inbox'), { small: true })) : null,
    autoCount ? h('p.small.muted', { style: { margin: 0 } }, `${autoCount} application${autoCount === 1 ? ' is' : 's are'} kept up to date from Gmail automatically. Change any stage yourself; your change is kept and newer emails won’t undo it.`) : null,
    h('div.card', h('div.toolbar', h('div.grow', q), h('div', { style: { minWidth: '180px' } }, stageSel), viewChips,
      st.view === 'table' && !st.stage && ended ? h('label.check.small', h('input', { type: 'checkbox', checked: st.showEnded, onchange: (e) => { st.showEnded = e.target.checked; ctx.refresh(); } }), `Show ${ended} closed`) : null)),
    box);
}

function appCard(ctx, a, { draggable }) {
  const sel = select('mv-' + a.id, STAGES, a.stage, { 'aria-label': `Stage for ${a.company} ${a.title}` });
  sel.addEventListener('click', (e) => e.stopPropagation());
  sel.addEventListener('change', async (e) => { e.stopPropagation(); const to = sel.value; sel.value = a.stage; await moveStageDialog(ctx, a.id, to); });
  const iv = a.nextInterview;
  const el = h('div.kcard', {
    draggable: draggable ? 'true' : null, tabindex: '0', role: 'button', 'aria-label': `${a.title} at ${a.company}, ${a.stage}`,
    onclick: () => ctx.openApp(a.id), onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) ctx.openApp(a.id); },
  },
  h('div.t', a.title), h('div.c', a.company, a.stageSource === 'gmail' ? h('span', { title: 'Status confirmed by a Gmail email', style: { marginLeft: '6px', color: 'var(--good)' } }, ico2('mail', 13)) : null),
  h('div.m', a.appliedOn ? h('span', `Applied ${fmtDay(a.appliedOn)}`) : h('span', 'Not applied yet'),
    iv ? h('span', { style: { color: 'var(--accent)' } }, `Interview ${fmtDay(iv.date)}${iv.time ? ' ' + fmtClock(iv.time) : ''}`) : null,
    a.pendingAssessments.length ? h('span', { style: { color: 'var(--warn)' } }, `${a.pendingAssessments.length} assessment${a.pendingAssessments.length > 1 ? 's' : ''}`) : null,
    a.followUpDue ? h('span', { style: { color: 'var(--bad)' } }, 'Follow-up due') : a.followUpDate && a.active ? h('span', `Follow up ${fmtDay(a.followUpDate)}`) : null),
  a.nextAction ? h('div.small', { style: { color: 'var(--fg-2)' } }, '→ ', a.nextAction) : a.active ? h('div.small', { style: { color: 'var(--warn)' } }, 'No next action set') : null,
  sel);
  if (draggable) {
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  }
  return el;
}

function kanban(ctx, apps) {
  const fine = window.matchMedia ? window.matchMedia('(pointer: fine)').matches : true;
  const byStage = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const a of apps) (byStage[a.stage] || byStage.Discovered).push(a);
  const board = h('div.kanban', { role: 'list', 'aria-label': 'Applications by stage' });
  for (const s of STAGES) {
    const items = byStage[s].sort(SORTS.updated);
    const col = h('section.kcol', { role: 'listitem', class: items.length ? '' : 'empty', 'aria-label': `${s}: ${items.length}` },
      h('div.kcol-head', h('span.stage-dot', { class: `d-${STAGE_TONE[s]}` }), s, h('span.n', String(items.length))),
      h('div.kcol-body', items.length ? items.map((a) => appCard(ctx, a, { draggable: fine })) : h('div.faint.small', { style: { padding: '8px 2px' } }, fine ? 'Drop here' : 'Empty')));
    col.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drop'); });
    col.addEventListener('drop', async (e) => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) await moveStageDialog(ctx, id, s); });
    board.append(col);
  }
  // Open on the first stage that has cards, so active applications are in view.
  requestAnimationFrame(() => { const c = board.querySelector('.kcol:not(.empty)'); if (c && board.scrollLeft === 0 && c.offsetLeft - board.offsetLeft > 40) board.scrollLeft = c.offsetLeft - board.offsetLeft - 8; });
  return h('div.stack.tight', board, h('p.faint.small', { style: { margin: 0 } }, fine ? 'Drag a card to another column, or use its stage menu. Scroll sideways for more stages.' : 'Swipe sideways for more stages. Change a card’s stage with its menu.'));
}

function table(ctx, st, apps) {
  if (!apps.length) return h('div.empty', h('h3', 'No applications match'), h('p', 'Change the stage filter or search.'));
  const list = apps.slice().sort((a, b) => SORTS[st.sort](a, b) * st.dir);
  const th = (key, label) => h('th', h('button', { type: 'button', onclick: () => { if (st.sort === key) st.dir *= -1; else { st.sort = key; st.dir = 1; } ctx.refresh(); }, 'aria-sort': st.sort === key ? (st.dir > 0 ? 'ascending' : 'descending') : null }, label, st.sort === key ? (st.dir > 0 ? ' ↑' : ' ↓') : ''));
  const dash = () => h('span.faint', '—');
  const desktop = h('div.table-wrap.hide-phone', h('table.data.tracker-table',
    h('thead', h('tr', th('company', 'Company · role'), th('stage', 'Status'), th('applied', 'Applied'), h('th', 'Source'), h('th', 'Job'), th('updated', 'Last activity'), h('th', 'Next action'), th('followup', 'Follow-up'), h('th', 'Assessment due'), h('th', 'Interview'), h('th', 'Priority'), h('th', 'Notes'), h('th', 'Verified by'))),
    h('tbody', list.map((a) => h('tr', { onclick: () => ctx.openApp(a.id), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') ctx.openApp(a.id); } },
      h('td', h('span.t-strong', a.company), h('span.cell-sub', a.title)),
      h('td', stagePill(a.stage)),
      h('td.nowrap.num', a.appliedOn ? fmtDay(a.appliedOn) : dash()),
      h('td.small', a.platform || a.source || dash()),
      h('td', safeUrl(a.jobUrl || (a.job && a.job.link)) ? h('a', { href: safeUrl(a.jobUrl || a.job.link), target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation(), 'aria-label': `Open the ${a.company} listing` }, ico2('external', 16)) : dash()),
      h('td.small', a.lastActivityAt ? h('span', a.lastActivity || 'Activity', h('span.cell-sub', fmtDay(str(a.lastActivityAt).slice(0, 10)))) : h('span', 'Updated', h('span.cell-sub', fmtDay(str(a.updatedAt).slice(0, 10))))),
      h('td.small', { style: { minWidth: '160px' } }, a.nextAction || (a.active ? h('span', { style: { color: 'var(--warn)' } }, 'Not set') : dash())),
      h('td.nowrap', a.followUpDate && a.active ? h('span', { style: { color: a.followUpDue ? 'var(--bad)' : null } }, fmtDay(a.followUpDate), h('span.cell-sub', relDay(a.followUpDate))) : dash()),
      h('td.nowrap', a.nextAssessment ? h('span', { style: { color: 'var(--warn)' } }, fmtDay(a.nextAssessment.due), h('span.cell-sub', relDay(a.nextAssessment.due))) : a.pendingAssessments.length ? h('span.small', 'Date not stated') : dash()),
      h('td.nowrap', a.nextInterview ? h('span', fmtDay(a.nextInterview.date), a.nextInterview.time ? h('span.cell-sub', fmtClock(a.nextInterview.time)) : null) : a.interviews.some((i) => !i.date && i.status === 'Scheduled') ? h('span.small', 'Date not stated') : dash()),
      h('td', a.priority ? h('span.prio', { class: a.priority }, a.priority) : dash()),
      h('td', a.notes ? h('span', { title: a.notes.slice(0, 200) }, ico2('note', 16)) : dash()),
      h('td', pill(a.verification, a.verification === 'Confirmed by Gmail' ? 'good' : a.verification === 'Gmail activity' ? 'info' : 'muted')))))));
  const phone = h('div.stack.tight.hide-desktop', list.map((a) => appCard(ctx, a, { draggable: false })));
  return h('div', desktop, phone);
}
