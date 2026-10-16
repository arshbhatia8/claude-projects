import { h, icon, btn, pill, confirm } from '../dom.js';
import * as A from '../../core/actions.js';
import { filterTasks } from '../../core/metrics.js';
import { fmtDay, fmtClock, relDay, addDays } from '../../core/util.js';
import { taskDialog } from '../forms.js';
import { TASK_CATEGORIES } from '../../core/schema.js';

const VIEWS = [['today', 'Today'], ['upcoming', 'Upcoming'], ['overdue', 'Overdue'], ['week', 'This week'], ['all', 'All open'], ['completed', 'Completed']];

export function taskRow(ctx, t) {
  const ref = ctx.model.ref;
  const late = t.status !== 'Completed' && t.dueDate && t.dueDate < ref;
  const app = t.appId ? ctx.model.appById[t.appId] : null;
  const job = t.jobId ? ctx.model.jobById[t.jobId] : null;
  const done = t.status === 'Completed';
  return h(`div.task${done ? '.done' : ''}${late ? '.overdue' : ''}`,
    h('button.task-hit', { type: 'button', 'aria-label': done ? `Mark “${t.title}” not done` : `Complete “${t.title}”`, onclick: () => ctx.run(() => A.completeTask(ctx.store, t.id, !done), done ? 'Task reopened' : 'Task completed') },
      h('span.task-check', done ? icon('check', 15) : null)),
    h('div', { style: { minWidth: 0, cursor: 'pointer' }, onclick: () => taskDialog(ctx, { id: t.id }), role: 'button', tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') taskDialog(ctx, { id: t.id }); } },
      h('div.task-title', t.title),
      h('div.task-meta',
        t.dueDate ? h('span', { class: late ? 'late' : '' }, late ? `Overdue · ${fmtDay(t.dueDate)}` : `${relDay(t.dueDate, ref).replace(/^./, (c) => c.toUpperCase())} · ${fmtDay(t.dueDate, { weekday: true })}`, t.dueTime ? ` · ${fmtClock(t.dueTime)}` : '') : h('span', 'No due date'),
        h('span.prio', { class: t.priority }, t.priority),
        t.category && t.category !== 'Other' ? h('span', t.category) : null,
        t.status === 'In Progress' ? h('span', { style: { color: 'var(--info)' } }, 'In progress') : null,
        app ? h('button.linkbtn', { type: 'button', onclick: (e) => { e.stopPropagation(); ctx.openApp(app.id); } }, `${app.company} · ${app.stage}`) : job ? h('button.linkbtn', { type: 'button', onclick: (e) => { e.stopPropagation(); ctx.openJob(job.id); } }, job.company) : t.company ? h('span', t.company) : null,
        done && t.completedAt ? h('span', `Done ${fmtDay(t.completedAt.slice(0, 10))}`) : null)),
    done ? h('div.task-side') : h('div.task-side.row', { style: { gap: '4px' } },
      btn('+1 day', () => ctx.run(() => A.snoozeTask(ctx.store, t.id, 1), 'Moved to tomorrow'), { small: true, kind: 'ghost', title: 'Move one day later' }),
      btn('', async () => { if (await confirm({ title: 'Delete this task?', text: `“${t.title}” will be removed.`, confirmLabel: 'Delete', danger: true })) ctx.run(() => A.deleteTask(ctx.store, t.id), 'Task deleted'); }, { small: true, kind: 'ghost', ico: 'trash', title: 'Delete task' })));
}

export default function tasks(ctx) {
  const m = ctx.model;
  const st = ctx.ui.tasks = { view: 'today', category: '', ...(ctx.ui.tasks || {}) };
  const counts = Object.fromEntries(VIEWS.map(([v]) => [v, filterTasks(m.tasks, v, m.ref).length]));
  if (st.view === 'today' && !counts.today && counts.overdue && !st.userPicked) st.view = 'overdue';
  let list = filterTasks(m.tasks, st.view, m.ref);
  if (st.category) list = list.filter((t) => t.category === st.category);
  const head = h('div.page-head', h('div', h('h1', 'Tasks'), h('p', `${counts.all} open · ${counts.overdue} overdue · ${counts.today} due today`)),
    h('div.head-actions', btn('New task', () => taskDialog(ctx, { prefill: { dueDate: st.view === 'today' ? m.ref : st.view === 'week' ? addDays(m.ref, 1) : '' } }), { kind: 'primary', ico: 'plus' })));
  const chips = h('div.chips', { role: 'tablist', 'aria-label': 'Task views' }, VIEWS.map(([v, l]) => h('button.chip', { type: 'button', role: 'tab', 'aria-selected': st.view === v ? 'true' : 'false', 'aria-pressed': st.view === v ? 'true' : 'false', onclick: () => { st.view = v; st.userPicked = true; ctx.refresh(); } },
    v === 'overdue' && counts.overdue ? h('span.stage-dot.d-bad') : null, l, h('span.n', String(counts[v])))));
  const cats = h('div.chips', { role: 'group', 'aria-label': 'Category' }, h('button.chip', { type: 'button', 'aria-pressed': !st.category ? 'true' : 'false', onclick: () => { st.category = ''; ctx.refresh(); } }, 'All categories'),
    ...TASK_CATEGORIES.filter((c) => m.tasks.some((t) => t.category === c)).map((c) => h('button.chip', { type: 'button', 'aria-pressed': st.category === c ? 'true' : 'false', onclick: () => { st.category = c; ctx.refresh(); } }, c)));
  const emptyText = {
    today: 'Nothing due today.', upcoming: 'No upcoming tasks with a due date.', overdue: 'Nothing overdue. Nice.', week: 'Nothing due this week.', all: 'No open tasks.', completed: 'No completed tasks yet.',
  }[st.view];
  return h('div.stack', head, chips, m.tasks.length > 3 ? cats : null,
    list.length ? h('div.task-list', list.map((t) => taskRow(ctx, t))) : h('div.empty', icon('tasks', 28), h('h3', emptyText),
      h('p', m.tasks.length ? 'Pick another view above, or add a task.' : 'Tasks can link to a job or an application. When you move an application forward, JobHunt suggests follow-ups and interview prep for you to accept or skip.'),
      btn('New task', () => taskDialog(ctx, { prefill: { dueDate: st.view === 'today' ? m.ref : '' } }), { ico: 'plus' })),
    st.view === 'overdue' && list.length > 1 ? h('div.row', btn(`Move all ${list.length} to today`, async () => {
      if (!(await confirm({ title: 'Move overdue tasks to today?', text: `${list.length} tasks will be due today.`, confirmLabel: 'Move to today' }))) return;
      for (const t of list) await ctx.run(() => A.rescheduleTask(ctx.store, t.id, m.ref));
    }, { small: true, kind: 'ghost' })) : null,
    pill ? null : null);
}
