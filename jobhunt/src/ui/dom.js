// DOM helpers, icons, toasts, dialogs and file saving.
import { escapeHtml } from '../core/util.js';

/** h('div.card#id', {onclick, class, ...}, ...children) */
export function h(sel, attrs, ...kids) {
  if (attrs == null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { kids.unshift(attrs); attrs = {}; }
  const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false || k === true) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const frag = (...kids) => { const f = document.createDocumentFragment(); append(f, kids); return f; };
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };

// ---- icons (24×24 stroke) ----
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  discover: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  tracker: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="11" rx="1.5"/><rect x="17" y="4" width="4" height="7" rx="1.5"/>',
  tasks: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  reports: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  import: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  note: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>',
  filter: '<path d="M3 5h18l-7 9v6l-4-2v-4z"/>',
  sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  alert: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.5M3 12h.5M3 18h.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>', chevR: '<path d="m9 18 6-6-6-6"/>', chevD: '<path d="m6 9 6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  merge: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.3 7.2C12 9 13 12 15.5 12"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>',
};
export function icon(name, size = 18) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = P[name] || P.info;
  return s;
}

export function btn(label, onclick, { kind = '', ico, title, small, disabled, id, type = 'button', attrs = {} } = {}) {
  const { class: extra, ...rest } = attrs;
  const cls = ['btn', kind, small ? 'sm' : '', !label && ico ? 'icon' : '', extra || ''].filter(Boolean).join(' ');
  return h('button', { type, class: cls, onclick, title: title || (!label ? rest['aria-label'] : null), 'aria-label': !label ? title : null, disabled, id, ...rest }, ico ? icon(ico, small ? 16 : 18) : null, label ? h('span.lbl', label) : null);
}
export const pill = (text, tone = 'muted', ico) => h(`span.pill.t-${tone}`, ico ? icon(ico, 13) : null, text);

// ---- toasts ----
let toastBox;
export function toast(msg, { tone = 'good', action, ms = 3800 } = {}) {
  if (!toastBox) { toastBox = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastBox); }
  const t = h(`div.toast.${tone}`, icon(tone === 'bad' ? 'alert' : 'check'), h('span', msg), action ? btn(action.label, () => { action.run(); t.remove(); }, { small: true }) : null);
  toastBox.append(t);
  setTimeout(() => t.remove(), tone === 'bad' ? ms * 2 : ms);
}

// ---- modal ----
const stack = [];
function trapKeys(e) {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.close(); }
  if (e.key === 'Tab') {
    const f = [...top.el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}
document.addEventListener('keydown', trapKeys);

/**
 * Opens a modal. body: Node; actions: [{label, kind, run(close, setError) → result}]. Returns a promise of the result.
 * A <form> wraps the body so Return in a single-line field submits the primary action.
 */
export function modal({ title, intro, body, actions = [], wide = false, onClose }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const err = h('div.modal-err', { role: 'alert', hidden: true });
    const setError = (m) => { err.textContent = m || ''; err.hidden = !m; };
    let closed = false;
    const close = (result) => {
      if (closed) return; closed = true;
      wrap.remove(); stack.splice(stack.indexOf(entry), 1);
      if (!stack.length) document.body.style.overflow = '';
      if (prevFocus && prevFocus.focus) try { prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
      if (onClose) onClose(result);
      resolve(result);
    };
    const run = async (a) => {
      setError('');
      if (!a.run) return close(a.value);
      try {
        const r = await a.run(close, setError);
        if (r !== false && !closed) close(r === undefined ? true : r);
      } catch (e) { setError(e.message || String(e)); }
    };
    const primary = actions.find((a) => a.kind === 'primary' || a.kind === 'danger');
    const form = h('form.modal-body', { novalidate: true, onsubmit: (e) => { e.preventDefault(); if (primary) run(primary); } }, body, err);
    const titleId = 'm' + Math.random().toString(36).slice(2, 8);
    const el = h(`div.modal${wide ? '.wide' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      h('div.modal-head', h('div', { style: { flex: 1, minWidth: 0 } }, h('h2', { id: titleId }, title), intro ? h('p', intro) : null), btn('', () => close(undefined), { kind: 'ghost', ico: 'x', title: 'Close', small: true })),
      form,
      actions.length ? h('div.modal-foot', actions.map((a) => btn(a.label, () => run(a), { kind: a.kind || '', id: a.id }))) : null,
    );
    const wrap = h('div.modal-wrap', h('div.scrim', { onclick: () => close(undefined) }), el);
    const entry = { el, close };
    stack.push(entry);
    document.body.append(wrap);
    document.body.style.overflow = 'hidden';
    const auto = el.querySelector('[autofocus]') || el.querySelector('input, select, textarea') || el.querySelector('.modal-foot .btn.primary');
    setTimeout(() => auto && auto.focus({ preventScroll: true }), 30);
  });
}

/** A confirmation. With `typeToConfirm`, the action stays disabled until the word is typed. */
export function confirm({ title, text, confirmLabel = 'Confirm', danger = false, typeToConfirm }) {
  const input = typeToConfirm ? h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', 'aria-label': `Type ${typeToConfirm} to confirm`, placeholder: typeToConfirm, id: 'confirm-word' }) : null;
  const body = h('div.stack', h('p', { style: { margin: 0 } }, text), input ? h('label.field', h('span', `Type ${typeToConfirm} to confirm`), input) : null);
  return modal({
    title, body,
    actions: [
      { label: 'Cancel', value: false },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', run: () => { if (input && input.value.trim().toUpperCase() !== typeToConfirm) throw new Error(`Type ${typeToConfirm} exactly to continue.`); return true; } },
    ],
  }).then((r) => r === true);
}

// ---- drawer ----
let drawerEl = null;
export function openDrawer(build, { onClose } = {}) {
  closeDrawer(true);
  const body = h('div.drawer', { role: 'dialog', 'aria-modal': 'true' });
  const wrap = h('div', h('div.scrim', { onclick: () => closeDrawer() }), body);
  const entry = { el: body, close: () => closeDrawer() };
  stack.push(entry);
  drawerEl = { wrap, entry, onClose, build, body, prevFocus: document.activeElement };
  build(body);
  document.body.append(wrap);
  document.body.style.overflow = 'hidden';
  setTimeout(() => { const f = body.querySelector('.drawer-head button'); f && f.focus({ preventScroll: true }); }, 30);
  return drawerEl;
}
export function refreshDrawer() {
  if (!drawerEl) return;
  const active = document.activeElement;
  if (active && drawerEl.body.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return; // never disturb typing
  const scroll = drawerEl.body.querySelector('.drawer-body')?.scrollTop || 0;
  clear(drawerEl.body);
  drawerEl.build(drawerEl.body);
  const b = drawerEl.body.querySelector('.drawer-body');
  if (b) b.scrollTop = scroll;
}
export function closeDrawer(silent) {
  if (!drawerEl) return;
  const d = drawerEl; drawerEl = null;
  d.wrap.remove();
  const i = stack.indexOf(d.entry); if (i >= 0) stack.splice(i, 1);
  if (!stack.length) document.body.style.overflow = '';
  if (!silent && d.onClose) d.onClose();
  if (!silent && d.prevFocus && d.prevFocus.isConnected) try { d.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
}
export const drawerOpen = () => !!drawerEl;

// ---- form helpers ----
export function field(label, control, hint) {
  return h('label.field', h('span', label), control, hint ? h('span.hint', hint) : null);
}
export function input(id, value = '', attrs = {}) { return h('input', { id, name: id, type: 'text', value: value ?? '', ...attrs }); }
export function textarea(id, value = '', attrs = {}) { const t = h('textarea', { id, name: id, ...attrs }); t.value = value ?? ''; return t; }
export function select(id, options, value, attrs = {}) {
  const s = h('select', { id, name: id, ...attrs });
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    s.append(h('option', { value: v, selected: String(v) === String(value ?? '') }, l));
  }
  return s;
}
export function readForm(root) {
  const out = {};
  for (const el of root.querySelectorAll('input[name], select[name], textarea[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value.trim();
  }
  return out;
}

// ---- files ----
let downloadsApi = null;
export function setDownloads(api) { downloadsApi = api; }
/** Saves a generated file. Inside claude.ai it uses the viewer's save dialog; elsewhere a normal download. */
export async function saveFile(filename, text, type = 'text/plain') {
  if (downloadsApi) {
    try { await downloadsApi.save({ filename, data: text }); return true; } catch (e) {
      if (e && e.code === 'declined') return false;
      if (e && e.code === 'rate_limited') throw new Error('A save prompt is already open. Finish it, then try again.');
      throw new Error(`The file could not be saved here (${(e && (e.message || e.code)) || 'unknown error'}).`);
    }
  }
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: { display: 'none' } });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  return true;
}
export function readFileText(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 15 * 1024 * 1024) return reject(new Error('That file is larger than 15 MB.'));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsText(file);
  });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
export const esc = escapeHtml;
