// ---------- Sichere HTML-Templates ----------

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(String(s ?? ''));

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

/** Tagged Template: alle Werte werden escaped, außer raw()/html``. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- API ----------

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

let onAuthLost = () => {};
export const setAuthHandler = (fn) => { onAuthLost = fn; };

export async function api(method, path, body) {
  const opts = { method, headers: { 'X-SV-Request': '1' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch {
    throw new ApiError('Keine Verbindung zum Server. Prüf dein Internet und versuch es noch einmal.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
  if (!res.ok) {
    const err = new ApiError(data?.error || `Fehler ${res.status}`, res.status, data?.code);
    if (res.status === 401 && path !== '/login' || err.code === 'MUST_CHANGE_PW') onAuthLost(err);
    throw err;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);
export const del = (p) => api('DELETE', p);

/** Upload mit Fortschrittsanzeige. */
export function upload(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/dateien');
    xhr.setRequestHeader('X-SV-Request', '1');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* leer */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || 'Der Upload hat nicht geklappt.', xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Keine Verbindung zum Server.', 0));
    xhr.send(formData);
  });
}

// ---------- Datum und Zahlen ----------

const TZ = 'Europe/Berlin';
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WD_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MON = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
export const MON_LONG = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** 'YYYY-MM-DD' oder 'YYYY-MM-DDTHH:MM' (Ortszeit) → Teile */
export function parts(s) {
  const [d, t] = String(s).split('T');
  const [y, m, day] = d.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, day, 12));
  return { y, m, d: day, time: t ? t.slice(0, 5) : null, wd: date.getUTCDay(), date: d };
}

/** Heutiges Datum in Deutschland, 'YYYY-MM-DD' */
export function today() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date());
}
export function nowLocal() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function daysBetween(a, b) {
  const pa = parts(a), pb = parts(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function addDays(dateStr, n) {
  const p = parts(dateStr);
  const x = new Date(Date.UTC(p.y, p.m - 1, p.d + n, 12));
  return x.toISOString().slice(0, 10);
}

/** "Di, 7. Okt." */
export const fmtDate = (s) => { const p = parts(s); return `${WD[p.wd]}, ${p.d}. ${MON[p.m - 1]}`; };
/** "Dienstag, 7. Oktober" */
export const fmtDateLong = (s) => { const p = parts(s); return `${WD_LONG[p.wd]}, ${p.d}. ${MON_LONG[p.m - 1]}`; };
export const fmtDateFull = (s) => { const p = parts(s); return `${p.d}. ${MON_LONG[p.m - 1]} ${p.y}`; };
export const fmtShort = (s) => { const p = parts(s); return `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}.${p.y}`; };
export const weekday = (s) => WD[parts(s).wd];
export const monShort = (s) => MON[parts(s).m - 1];

export function relDay(dateStr) {
  const n = daysBetween(today(), dateStr);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n > 1 && n < 14) return `in ${n} Tagen`;
  if (n < -1 && n > -14) return `vor ${-n} Tagen`;
  if (n >= 14 && n < 60) return `in ${Math.round(n / 7)} Wochen`;
  return null;
}

/** Zeitspanne eines Termins als Text */
export function eventTime(e) {
  if (e.allDay) {
    if (e.endsAt && e.endsAt.slice(0, 10) !== e.startsAt.slice(0, 10)) return `bis ${fmtDate(e.endsAt)}`;
    return 'ganztägig';
  }
  const s = parts(e.startsAt).time;
  if (!e.endsAt) return `${s} Uhr`;
  if (e.endsAt.slice(0, 10) === e.startsAt.slice(0, 10)) return `${s}–${parts(e.endsAt).time} Uhr`;
  return `${s} Uhr bis ${fmtDate(e.endsAt)}`;
}

/** UTC-ISO-Zeitstempel → "vor 5 Min.", "gestern", "12.03." */
export function ago(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  const d = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(new Date(iso));
  const n = daysBetween(d, today());
  if (n === 1) return 'gestern';
  if (n < 7) return `vor ${n} Tagen`;
  return fmtShort(d);
}
export function stamp(iso) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) + ' Uhr';
}

const EUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const euro = (cents) => EUR.format((cents || 0) / 100);

export function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const avatar = (name, cls = '') => html`<span class="avatar ${cls}" aria-hidden="true">${initials(name)}</span>`;

export const ROLE_LABEL = { lehrkraft: 'Lehrkraft', vorstand: 'SV-Vorstand', mitglied: 'SV-Mitglied' };
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Text mit einfacher Formatierung ----------
// **fett**, *kursiv*, Listen mit "- " oder "1. ", Überschriften mit "# ", Links werden klickbar.

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)"'])/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function md(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara();
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(m[1]);
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push(`<h${m[1].length === 1 ? 3 : 4}>${inline(m[2])}</h${m[1].length === 1 ? 3 : 4}>`);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return raw(out.join(''));
}

// ---------- Icons (eigene, schlichte Linien) ----------

const ICONS = {
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  projects: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
  vote: '<path d="M4 12h16v8H4z"/><path d="m8 8 3 3 6-7"/>',
  pin: '<path d="M12 17v5"/><path d="M8 3h8l-1 6 3 4H6l3-4z"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M15 11c3.3 0 6 1.3 6 3s-2.7 3-6 3-6-1.3-6-3"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.3-5.5 6.5-5.5s5.9 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.2 2.5 3.5 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5"/>',
  logout: '<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  dots: '<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
  qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  place: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.3 12 20 12 20z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 5-6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="1"/><path d="M8 20h8M12 16v4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  move: '<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="m12 11 3 2.5-3 2.5M8 13.5h7"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`);

let markCache = '';
export async function loadMark() {
  if (!markCache) markCache = await (await fetch('/img/mark.svg')).text();
  return markCache;
}
export const mark = (cls = 'brand-mark') => raw(markCache.replace('<svg ', `<svg class="${cls}" aria-hidden="true" `));

// ---------- Meldungen ----------

export function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = `toast${isError ? ' err' : ''}`;
  t.textContent = msg;
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), isError ? 5000 : 2600);
}

/** Führt eine Aktion aus und zeigt Fehler als Meldung. */
export async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (err) {
    if (err.status !== 401 && err.code !== 'MUST_CHANGE_PW') toast(err.message, true);
    return false;
  }
}

// ---------- Dialoge ----------

export function openDialog({ title, body, wide = false, onMount }) {
  const dlg = document.createElement('dialog');
  dlg.className = `dlg${wide ? ' dlg-wide' : ''}`;
  dlg.innerHTML = String(html`
    <div class="dlg-head"><h2>${title}</h2>
      <button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Schließen">${icon('x')}</button></div>
    <div class="dlg-body">${body}</div>`);
  document.body.append(dlg);
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    if (e.target === dlg) close(); // Klick auf den Hintergrund
  });
  dlg.showModal();
  onMount?.(dlg, close);
  return { dlg, close };
}

function fieldHtml(f) {
  const v = f.value ?? '';
  const req = f.required ? raw(' required') : '';
  const common = raw(`name="${esc(f.name)}" id="f-${esc(f.name)}"`);
  if (f.type === 'hidden') return html`<input type="hidden" ${common} value="${v}">`;
  if (f.type === 'checkbox') {
    return html`<label class="checkline"><input type="checkbox" class="check" ${common} ${f.value ? raw('checked') : ''}>
      <span>${f.label}${f.hint ? html`<small>${f.hint}</small>` : ''}</span></label>`;
  }
  if (f.type === 'html') return f.html;
  let control;
  if (f.type === 'textarea') {
    control = html`<textarea ${common}${req} maxlength="${f.max || 10000}" rows="${f.rows || 5}" placeholder="${f.placeholder || ''}">${v}</textarea>`;
  } else if (f.type === 'select') {
    control = html`<select ${common}${req}>${f.options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(v) ? raw('selected') : ''}>${o.label}</option>`)}</select>`;
  } else {
    const extra = raw([
      f.min !== undefined ? `min="${esc(f.min)}"` : '', f.max !== undefined && f.type === 'number' ? `max="${esc(f.max)}"` : '',
      f.maxlength ? `maxlength="${f.maxlength}"` : '', f.autocomplete ? `autocomplete="${esc(f.autocomplete)}"` : '',
      f.step ? `step="${esc(f.step)}"` : '', f.inputmode ? `inputmode="${esc(f.inputmode)}"` : '',
    ].join(' '));
    control = html`<input type="${f.type || 'text'}" ${common} value="${v}" placeholder="${f.placeholder || ''}" ${extra}${req}>`;
  }
  return html`<label class="field" data-field="${f.name}"><span>${f.label}</span>${control}${f.hint ? html`<small>${f.hint}</small>` : ''}</label>`;
}

/** Formular-Dialog. fields: [{name,label,type,value,options,required,hint}] oder {row:[...]}. */
export function formDialog({ title, fields, submitLabel = 'Speichern', onSubmit, wide = false, intro, danger, onMount }) {
  return new Promise((resolve) => {
    let done = false;
    const body = html`
      <form novalidate>
        ${intro ? html`<p class="muted">${intro}</p>` : ''}
        <div class="form-error" role="alert"></div>
        ${fields.map((f) => (f.row ? html`<div class="field-row">${f.row.map(fieldHtml)}</div>` : fieldHtml(f)))}
        <div class="form-actions">
          <button type="button" class="btn" data-close>Abbrechen</button>
          <button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button>
        </div>
      </form>`;
    const { dlg, close } = openDialog({ title, body, wide, onMount: (d, c) => onMount?.(d, c) });
    const form = dlg.querySelector('form');
    const errBox = dlg.querySelector('.form-error');
    dlg.addEventListener('close', () => { if (!done) resolve(null); });
    setTimeout(() => form.querySelector('input:not([type=hidden]):not([type=checkbox]), textarea, select')?.focus(), 30);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.textContent = '';
      const values = {};
      const all = fields.flatMap((f) => f.row || [f]);
      for (const f of all) {
        if (f.type === 'html') continue;
        const el = form.elements[f.name];
        if (!el) continue;
        values[f.name] = f.type === 'checkbox' ? el.checked : el.value;
        if (f.required && !String(values[f.name]).trim()) {
          errBox.textContent = `Bitte fülle „${f.label}“ aus.`;
          el.focus();
          return;
        }
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const result = await onSubmit(values, form);
        done = true;
        close();
        resolve(result ?? values);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.scrollIntoView({ block: 'nearest' });
      } finally {
        btn.disabled = false;
      }
    });
  });
}

export function confirmDialog({ title, text, confirmLabel = 'Bestätigen', danger = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const { dlg, close } = openDialog({
      title,
      body: html`<p>${text}</p><div class="form-actions">
        <button type="button" class="btn" data-close>Abbrechen</button>
        <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${confirmLabel}</button></div>`,
    });
    dlg.querySelector('[data-ok]').addEventListener('click', () => { ok = true; close(); });
    dlg.addEventListener('close', () => resolve(ok));
    setTimeout(() => dlg.querySelector('[data-ok]').focus(), 30);
  });
}

/** Kleines Aufklapp-Menü; items: [{label, icon, danger, onClick}] */
export function menuButton(items, label = 'Weitere Aktionen') {
  const idAttr = `m${Math.random().toString(36).slice(2, 8)}`;
  menuRegistry.set(idAttr, items);
  return html`<div class="menu" data-menu="${idAttr}">
    <button type="button" class="btn btn-ghost btn-icon" aria-haspopup="true" aria-expanded="false" aria-label="${label}">${icon('dots')}</button>
    <div class="menu-list" role="menu">${items.map((it, i) => html`<button type="button" role="menuitem" data-mi="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? icon(it.icon) : ''}${it.label}</button>`)}</div>
  </div>`;
}
const menuRegistry = new Map();
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.menu > button');
  const item = e.target.closest('.menu-list button');
  const openMenus = $$('.menu.open');
  if (item) {
    const menu = item.closest('.menu');
    menu.classList.remove('open');
    const fn = menuRegistry.get(menu.dataset.menu)?.[Number(item.dataset.mi)]?.onClick;
    fn?.();
    return;
  }
  openMenus.forEach((m) => { if (!trigger || m !== trigger.parentElement) { m.classList.remove('open'); m.querySelector('button').setAttribute('aria-expanded', 'false'); } });
  if (trigger) {
    const m = trigger.parentElement;
    const open = !m.classList.contains('open');
    m.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.menu.open').forEach((m) => m.classList.remove('open'));
});

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Kopiert');
  } catch {
    toast('Kopieren ging nicht. Markiere den Text und kopiere ihn von Hand.', true);
  }
}

/** Optionen für Mitglieder-Auswahlfelder */
export function memberOptions(members, emptyLabel = 'Niemand') {
  return [{ value: '', label: emptyLabel }, ...members.filter((m) => m.active !== false).map((m) => ({ value: m.id, label: m.displayName + (m.klasse ? ` (${m.klasse})` : '') }))];
}
