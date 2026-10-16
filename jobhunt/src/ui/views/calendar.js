import { h, icon, btn, pill } from '../dom.js';
import { calendarEvents } from '../../core/metrics.js';
import { fmtDay, fmtClock, addDays, weekStart, monthStart } from '../../core/util.js';
import { taskDialog } from '../forms.js';

const TYPES = { interview: ['Interview', 'accent'], assessment: ['Assessment', 'warn'], deadline: ['Application deadline', 'bad'], followup: ['Follow-up', 'info'], task: ['Task', 'good'] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function openEvent(ctx, e) {
  if (e.appId) ctx.openApp(e.appId); else if (e.jobId) ctx.openJob(e.jobId); else if (e.taskId) taskDialog(ctx, { id: e.taskId });
}
function agendaItem(ctx, e) {
  return h('div.agenda-item', { class: `ev-${e.type}${e.done ? ' ev-done' : ''}`, role: 'button', tabindex: '0', onclick: () => openEvent(ctx, e), onkeydown: (k) => { if (k.key === 'Enter') openEvent(ctx, e); } },
    h('span.time', e.time ? fmtClock(e.time) : 'All day'),
    h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 500, overflowWrap: 'anywhere' } }, e.title), h('div.small.faint', { style: { overflowWrap: 'anywhere' } }, e.sub)),
    pill(TYPES[e.type][0], TYPES[e.type][1]));
}

export default function calendar(ctx) {
  const m = ctx.model;
  const st = ctx.ui.calendar = { view: 'month', month: monthStart(m.ref), sel: m.ref, types: Object.keys(TYPES), showDone: false, ...(ctx.ui.calendar || {}) };
  const all = calendarEvents(m).filter((e) => st.types.includes(e.type) && (st.showDone || !e.done));
  const head = h('div.page-head', h('div', h('h1', 'Calendar'), h('p', 'Interviews, assessments, deadlines, follow-ups and tasks from your own records. Times are IST.')),
    h('div.chips', { role: 'group', 'aria-label': 'View' },
      h('button.chip', { type: 'button', 'aria-pressed': st.view === 'month' ? 'true' : 'false', onclick: () => { st.view = 'month'; ctx.refresh(); } }, icon('calendar', 14), 'Month'),
      h('button.chip', { type: 'button', 'aria-pressed': st.view === 'list' ? 'true' : 'false', onclick: () => { st.view = 'list'; ctx.refresh(); } }, icon('list', 14), 'List')));
  const legend = h('div.legend', Object.entries(TYPES).map(([k, [label]]) => {
    const on = st.types.includes(k);
    return h('button.chip', { type: 'button', 'aria-pressed': on ? 'true' : 'false', onclick: () => { st.types = on ? st.types.filter((x) => x !== k) : [...st.types, k]; ctx.refresh(); } }, h('i', { class: `ev-${k}`, style: { width: '10px', height: '10px', borderRadius: '3px', display: 'inline-block', background: `var(--${{ interview: 'accent', assessment: 'warn', deadline: 'bad', followup: 'info', task: 'good' }[k]})` } }), label);
  }), h('label.check.small', h('input', { type: 'checkbox', checked: st.showDone, onchange: (e) => { st.showDone = e.target.checked; ctx.refresh(); } }), 'Show done'));

  if (st.view === 'list') {
    const upcoming = all.filter((e) => e.date >= m.ref);
    const past = all.filter((e) => e.date < m.ref && !e.done).reverse();
    const group = (list) => {
      const days = [...new Set(list.map((e) => e.date))];
      return days.map((d) => h('div.agenda-day', h('h4', d === m.ref ? `Today · ${fmtDay(d, { weekday: true })}` : fmtDay(d, { weekday: true })), list.filter((e) => e.date === d).map((e) => agendaItem(ctx, e))));
    };
    return h('div.stack', head, legend,
      past.length ? h('div.card', h('div.card-head', h('h3', 'Past and not done'), h('span.sub', `${past.length}`)), h('div.agenda', group(past.slice(0, 20)))) : null,
      upcoming.length ? h('div.agenda', group(upcoming.slice(0, 120))) : h('div.empty', icon('calendar', 28), h('h3', 'Nothing coming up'), h('p', 'Add interviews and assessments to an application, set follow-up dates, or give tasks a due date.')));
  }

  const first = st.month;
  const [y, mo] = first.split('-').map(Number);
  const gridStart = weekStart(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const lastRowNeeded = days.slice(35).some((d) => d.slice(0, 7) === first.slice(0, 7));
  const shown = lastRowNeeded ? days : days.slice(0, 35);
  const byDay = new Map();
  for (const e of all) (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e);
  const nav = (n) => { const d = new Date(Date.UTC(y, mo - 1 + n, 1)); st.month = d.toISOString().slice(0, 10); ctx.refresh(); };
  const cal = h('div.cal', { role: 'grid', 'aria-label': `${MONTHS[mo - 1]} ${y}` },
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => h('div.cal-dow', { role: 'columnheader' }, d)),
    shown.map((d) => {
      const ev = byDay.get(d) || [];
      const other = d.slice(0, 7) !== first.slice(0, 7);
      return h('button.cal-day', { type: 'button', role: 'gridcell', class: `${other ? 'other' : ''} ${d === m.ref ? 'today' : ''} ${d === st.sel ? 'sel' : ''}`, 'aria-label': `${fmtDay(d, { weekday: true })}: ${ev.length} item${ev.length === 1 ? '' : 's'}`, onclick: () => { st.sel = d; ctx.refresh(); } },
        h('span.cal-n', String(+d.slice(8))),
        ev.slice(0, 3).map((e) => h('span.cal-ev', { class: `ev-${e.type}${e.done ? ' ev-done' : ''}`, title: `${TYPES[e.type][0]}: ${e.title} · ${e.sub}` }, e.time ? fmtClock(e.time).replace(':00', '') + ' ' : '', e.title)),
        ev.length > 3 ? h('span.cal-more', `+${ev.length - 3}`) : null);
    }));
  const selEv = byDay.get(st.sel) || [];
  return h('div.stack', head,
    h('div.row.between', h('div.row', btn('', () => nav(-1), { ico: 'chevL', title: 'Previous month' }), h('h2.section', { style: { minWidth: '150px', justifyContent: 'center' } }, `${MONTHS[mo - 1]} ${y}`), btn('', () => nav(1), { ico: 'chevR', title: 'Next month' })),
      btn('Today', () => { st.month = monthStart(m.ref); st.sel = m.ref; ctx.refresh(); }, { small: true })),
    legend, cal,
    h('div.card', h('div.card-head', h('h3', st.sel === m.ref ? `Today · ${fmtDay(st.sel, { weekday: true })}` : fmtDay(st.sel, { weekday: true })),
      btn('Task on this day', () => taskDialog(ctx, { prefill: { dueDate: st.sel } }), { small: true, ico: 'plus' })),
    selEv.length ? h('div.agenda', selEv.map((e) => agendaItem(ctx, e))) : h('p.faint', { style: { margin: 0 } }, 'Nothing on this day.')));
}
