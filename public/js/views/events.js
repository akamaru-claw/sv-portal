import {
  html, $, $$, get, post, patch, put, del, icon, md, avatar, attempt, toast, formDialog, confirmDialog, menuButton,
  fmtDate, fmtDateLong, fmtDateFull, eventTime, relDay, today, addDays, parts, weekday, monShort, MON_LONG, ago, plural, nowLocal,
} from '../lib.js';

export const TYPE_LABEL = { sitzung: 'Sitzung', aktion: 'Aktion', frist: 'Frist', schule: 'Schultermin', sonstiges: 'Termin' };
const TYPE_TAG = { sitzung: 'tag-gruen', aktion: 'tag-marker', frist: 'tag-signal', schule: 'tag-blau', sonstiges: '' };
const RSVP_LABEL = { ja: 'Zusage', vielleicht: 'Vielleicht', nein: 'Absage' };

export const typeTag = (t) => html`<span class="tag ${TYPE_TAG[t]}">${TYPE_LABEL[t]}</span>`;

export function eventRow(e) {
  const p = parts(e.startsAt);
  return html`<a class="row" href="/termine/${e.id}">
    <span class="datebox t-${e.type}"><b>${p.d}</b><small>${weekday(e.startsAt)} ${monShort(e.startsAt)}</small></span>
    <span class="row-main">
      <span class="row-title">${e.title}</span>
      <span class="row-sub">${typeTag(e.type)}<span>${icon('clock', 'icon-s')}${eventTime(e)}</span>
        ${e.location ? html`<span>${icon('place', 'icon-s')}${e.location}</span>` : ''}
        ${e.projectTitle ? html`<span>${icon('projects', 'icon-s')}${e.projectTitle}</span>` : ''}</span>
    </span>
    <span class="row-end">${e.rsvp.mine ? html`<span class="tag ${e.rsvp.mine === 'ja' ? 'tag-gruen' : 'tag-leer'}">${RSVP_LABEL[e.rsvp.mine]}</span>` : ''}</span>
  </a>`;
}

export function rsvpButtons(e) {
  const b = (status, label, cls = '') => html`<button type="button" class="btn btn-s ${cls}" data-rsvp="${status}" data-event="${e.id}" aria-pressed="${e.rsvp.mine === status}">${label}</button>`;
  return html`<div class="rsvp">${b('ja', 'Ich komme')}${b('vielleicht', 'Vielleicht')}${b('nein', 'Ich kann nicht', 'nein')}</div>`;
}

// ---------- Termin anlegen / bearbeiten ----------

async function projectOptions() {
  const { projects } = await get('/projekte');
  return [{ value: '', label: 'Kein Projekt' }, ...projects.filter((p) => !['verworfen'].includes(p.status)).map((p) => ({ value: p.id, label: p.title }))];
}

export async function newEventDialog(ctx, preset = {}, existing = null) {
  const board = ctx.user.role !== 'mitglied';
  const e = existing || {};
  const type = e.type || preset.type || (board ? 'sitzung' : 'aktion');
  const types = Object.entries(TYPE_LABEL)
    .filter(([k]) => board || k !== 'sitzung' || k === e.type)
    .map(([value, label]) => ({ value, label }));
  const start = e.startsAt ? parts(e.startsAt) : null;
  const end = e.endsAt ? parts(e.endsAt) : null;
  const multi = end && end.date !== start.date;
  const projects = await projectOptions();

  return formDialog({
    title: existing ? 'Termin bearbeiten' : 'Termin eintragen',
    submitLabel: existing ? 'Änderungen speichern' : 'Termin eintragen',
    fields: [
      { row: [
        { name: 'type', label: 'Art', type: 'select', options: types, value: type },
        { name: 'title', label: 'Titel', required: true, maxlength: 120, value: e.title ?? (type === 'sitzung' ? 'SV-Sitzung' : ''), placeholder: 'z. B. Nikolausverkauf' },
      ] },
      { name: 'allDay', label: 'Ganztägig', type: 'checkbox', value: !!e.allDay },
      { row: [
        { name: 'date', label: 'Datum', type: 'date', required: true, value: start?.date || preset.date || '' },
        { name: 'endDate', label: 'Mehrtägig bis', type: 'date', value: multi ? end.date : '', hint: 'Nur bei mehrtägigen Terminen' },
      ] },
      { row: [
        { name: 'start', label: 'Beginn', type: 'time', value: start && !e.allDay ? start.time : (type === 'sitzung' ? '13:30' : '') },
        { name: 'end', label: 'Ende', type: 'time', value: end && !e.allDay ? end.time : '' },
      ] },
      { name: 'location', label: 'Ort', maxlength: 120, value: e.location || '', placeholder: 'z. B. SV-Raum im Lernzentrum' },
      { name: 'projectId', label: 'Gehört zu Projekt', type: 'select', options: projects, value: e.projectId || preset.projectId || '' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', rows: 4, value: e.description || '', max: 5000, hint: 'Formatierung: **fett**, Listen mit „- “ am Zeilenanfang.' },
    ],
    onMount: (dlg) => {
      const f = $('form', dlg);
      const sync = () => {
        const allDay = f.elements.allDay.checked;
        $('[data-field=start]', dlg).closest('.field-row').hidden = allDay;
      };
      f.elements.allDay.addEventListener('change', sync);
      f.elements.type.addEventListener('change', () => {
        if (f.elements.type.value === 'sitzung' && !f.elements.title.value) f.elements.title.value = 'SV-Sitzung';
      });
      sync();
    },
    onSubmit: async (v) => {
      let startsAt; let endsAt = null;
      if (v.allDay) {
        startsAt = v.date;
        endsAt = v.endDate || null;
      } else {
        if (!v.start) throw new Error('Bitte gib eine Uhrzeit für den Beginn an oder wähle „Ganztägig“.');
        startsAt = `${v.date}T${v.start}`;
        if (v.end) endsAt = `${v.endDate || v.date}T${v.end}`;
        else if (v.endDate) throw new Error('Gib für mehrtägige Termine auch eine Uhrzeit fürs Ende an.');
      }
      const body = { type: v.type, title: v.title, allDay: v.allDay, startsAt, endsAt, location: v.location, projectId: v.projectId || null, description: v.description };
      if (existing) { await patch(`/termine/${existing.id}`, body); return existing.id; }
      const r = await post('/termine', body);
      toast('Termin eingetragen');
      return r.id;
    },
  }).then((r) => (r === null ? null : r));
}

// ---------- Liste und Monat ----------

const FILTERS = [['', 'Alle'], ['sitzung', 'Sitzungen'], ['aktion', 'Aktionen'], ['frist', 'Fristen'], ['schule', 'Schultermine']];

export async function list(ctx) {
  const { main, query } = ctx;
  ctx.setTitle('Termine');
  const view = query.get('ansicht') === 'monat' ? 'monat' : 'liste';
  const filter = query.get('art') || '';
  const past = query.get('vergangen') === '1';
  const qs = (over) => {
    const q = new URLSearchParams({ ansicht: view, art: filter, ...(past ? { vergangen: '1' } : {}), ...(query.get('monat') ? { monat: query.get('monat') } : {}), ...over });
    for (const [k, v] of [...q]) if (!v || (k === 'ansicht' && v === 'liste')) q.delete(k);
    const s = q.toString();
    return `/termine${s ? `?${s}` : ''}`;
  };

  const t = today();
  let body;
  if (view === 'monat') {
    const month = /^\d{4}-\d{2}$/.test(query.get('monat') || '') ? query.get('monat') : t.slice(0, 7);
    const first = `${month}-01`;
    const offset = (parts(first).wd + 6) % 7; // Montag zuerst
    const gridStart = addDays(first, -offset);
    const gridEnd = addDays(gridStart, 41);
    const { events } = await get(`/termine?von=${gridStart}&bis=${gridEnd}`);
    const shown = events.filter((e) => !filter || e.type === filter);
    const p = parts(first);
    const prev = addDays(first, -1).slice(0, 7);
    const next = addDays(first, 32).slice(0, 7);
    const weeks = parts(addDays(gridStart, 35)).m === p.m ? 6 : 5;
    const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
    body = html`
      <div class="cal-nav">
        <a class="btn btn-icon" href="${qs({ monat: prev })}" aria-label="Voriger Monat">${icon('left')}</a>
        <h2>${MON_LONG[p.m - 1]} ${p.y}</h2>
        <a class="btn btn-icon" href="${qs({ monat: next })}" aria-label="Nächster Monat">${icon('right')}</a>
        ${month !== t.slice(0, 7) ? html`<a class="btn btn-s" href="${qs({ monat: '' })}">Heute</a>` : ''}
      </div>
      <div class="cal" role="grid">
        ${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => html`<div class="cal-dow" role="columnheader">${d}</div>`)}
        ${days.map((day) => {
          const evs = shown.filter((e) => e.startsAt.slice(0, 10) <= day && (e.endsAt || e.startsAt).slice(0, 10) >= day);
          const cls = ['cal-day', day.slice(0, 7) !== month ? 'other' : '', day === t ? 'today' : ''].join(' ');
          return html`<div class="${cls}" role="gridcell"><span class="cal-num">${parts(day).d}</span>
            ${evs.map((e) => html`<a class="cal-ev t-${e.type}" href="/termine/${e.id}" title="${e.title}">${!e.allDay && e.startsAt.slice(0, 10) === day ? `${parts(e.startsAt).time} ` : ''}${e.title}</a>`)}</div>`;
        })}
      </div>
      ${shown.length ? html`<section class="panel" style="margin-top:16px"><ul class="rows">${shown.filter((e) => e.startsAt.slice(0, 7) === month).map((e) => html`<li>${eventRow(e)}</li>`)}</ul></section>` : ''}`;
  } else {
    const url = past ? `/termine?von=${addDays(t, -365)}&bis=${addDays(t, -1)}` : `/termine?von=${t}`;
    const { events } = await get(url);
    let shown = events.filter((e) => !filter || e.type === filter);
    if (past) shown = shown.filter((e) => (e.endsAt || e.startsAt).slice(0, 10) < t).reverse();
    const groups = [];
    for (const e of shown) {
      const key = e.startsAt.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
      groups[groups.length - 1].items.push(e);
    }
    body = html`
      ${groups.length ? html`<section class="panel">${groups.map((g) => html`
        <h2 class="month-head">${MON_LONG[Number(g.key.slice(5)) - 1]} ${g.key.slice(0, 4)}</h2>
        <ul class="rows">${g.items.map((e) => html`<li>${eventRow(e)}</li>`)}</ul>`)}</section>`
      : html`<section class="panel"><div class="empty"><strong>${past ? 'Keine vergangenen Termine' : 'Keine anstehenden Termine'}</strong>${past ? '' : 'Trag den ersten Termin ein, zum Beispiel die nächste Sitzung oder eine Aktion.'}</div></section>`}
      <p style="margin-top:16px"><a href="${qs({ vergangen: past ? '' : '1' })}">${past ? 'Anstehende Termine zeigen' : 'Vergangene Termine und Protokolle zeigen'}</a></p>`;
  }

  main.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><h1>Termine</h1><p>Sitzungen, Aktionen und Fristen der SV. <a href="/profil#kalender">Als Kalender aufs Handy holen</a></p></div>
        <div class="page-actions">
          <div class="seg"><a href="${qs({ ansicht: 'liste', monat: '' })}" aria-current="${view === 'liste' ? 'page' : 'false'}">Liste</a><a href="${qs({ ansicht: 'monat' })}" aria-current="${view === 'monat' ? 'page' : 'false'}">Monat</a></div>
          <button type="button" class="btn btn-primary" data-new>${icon('plus')}Termin eintragen</button>
        </div>
      </div>
      <div class="filters" role="group" aria-label="Nach Art filtern">
        ${FILTERS.map(([k, label]) => html`<a class="chip" href="${qs({ art: k })}" aria-current="${filter === k}">${label}</a>`)}
      </div>
      ${body}
    </div>`);

  $('[data-new]', main).addEventListener('click', async () => {
    const id = await newEventDialog(ctx);
    if (id) ctx.go(`/termine/${id}`);
  });
}

// ---------- Detail ----------

function protocolTemplate(ev) {
  const present = ev.rsvps.filter((r) => r.status === 'ja').map((r) => r.name).join(', ');
  const lines = [
    `# Protokoll ${ev.title}, ${fmtDateFull(ev.startsAt)}`,
    '',
    `**Anwesend:** ${present}`,
    '**Protokoll:** ',
    '',
  ];
  ev.agenda.forEach((a, i) => { lines.push(`## TOP ${i + 1}: ${a.title}`, '- ', '**Beschluss:** ', ''); });
  lines.push('## Aufgaben bis zur nächsten Sitzung', '- Wer? Was? Bis wann?');
  return lines.join('\n');
}

export async function detail(ctx) {
  const { main, user } = ctx;
  const board = user.role !== 'mitglied';
  let editingProtocol = false;
  let draft = null;

  const load = async () => {
    const { event: ev } = await get(`/termine/${ctx.params.id}`);
    if (!ctx.isCurrent()) return;
    ctx.setTitle(ev.title);
    const isMeeting = ev.type === 'sitzung';
    const past = (ev.endsAt || ev.startsAt) < nowLocal();
    const byStatus = (s) => ev.rsvps.filter((r) => r.status === s);
    const rel = relDay(ev.startsAt);

    main.innerHTML = String(html`
      <div class="page">
        <a class="back" href="/termine">${icon('left', 'icon-s')}Termine</a>
        <div class="page-head">
          <div><div style="margin-bottom:8px">${typeTag(ev.type)}</div><h1>${ev.title}</h1></div>
          ${ev.canEdit ? html`<div class="page-actions">
            <button type="button" class="btn" data-edit>${icon('edit')}Bearbeiten</button>
            ${menuButton([{ label: 'Termin löschen', icon: 'trash', danger: true, onClick: remove }])}
          </div>` : ''}
        </div>
        <div class="cols cols-side-first">
          <div>
            ${isMeeting ? html`
              <section class="panel">
                <div class="panel-head"><h2>Tagesordnung</h2><span class="small muted">${plural(ev.agenda.length, 'Punkt', 'Punkte')}</span></div>
                ${ev.agenda.length ? html`<ol class="agenda">${ev.agenda.map((a, i) => {
                  const mine = a.proposedBy === user.id;
                  const items = [];
                  if (board || mine) items.push({ label: 'Bearbeiten', icon: 'edit', onClick: () => editTop(a) });
                  if (board && i > 0) items.push({ label: 'Nach oben', icon: 'up', onClick: () => moveTop(a, -1) });
                  if (board && i < ev.agenda.length - 1) items.push({ label: 'Nach unten', icon: 'down', onClick: () => moveTop(a, 1) });
                  if (board || mine) items.push({ label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeTop(a) });
                  return html`<li class="${a.done ? 'done' : ''}">
                    <span class="num">${i + 1}</span>
                    <div class="row-main">
                      <div class="agenda-title">${a.title}</div>
                      ${a.note ? html`<div class="agenda-note">${a.note}</div>` : ''}
                      <div class="agenda-by">${a.proposer ? `vorgeschlagen von ${a.proposer}` : ''}</div>
                    </div>
                    <label class="nowrap small muted" style="display:flex;gap:6px;align-items:center" title="Als besprochen markieren">
                      <input type="checkbox" class="check" data-top-done="${a.id}" ${a.done ? 'checked' : ''}><span class="sr">Besprochen</span></label>
                    ${items.length ? menuButton(items, 'Aktionen für diesen Punkt') : ''}
                  </li>`;
                })}</ol>` : html`<div class="empty">Noch keine Punkte auf der Tagesordnung.</div>`}
                <form class="inline-form" data-add-top>
                  <label class="sr" for="top-title">Neuer Tagesordnungspunkt</label>
                  <input type="text" id="top-title" name="title" maxlength="160" placeholder="Thema, das besprochen werden soll" required>
                  <button type="submit" class="btn btn-primary">${icon('plus')}Vorschlagen</button>
                </form>
              </section>

              <section class="panel" id="protokoll">
                <div class="panel-head"><h2>Protokoll</h2>
                  ${!editingProtocol ? html`<button type="button" class="btn btn-s" data-proto-edit>${icon('edit')}${ev.protocol ? 'Bearbeiten' : 'Protokoll schreiben'}</button>` : ''}</div>
                ${editingProtocol ? html`
                  <form data-proto-form>
                    <textarea name="text" rows="16" maxlength="50000" aria-label="Protokoll">${draft ?? ev.protocol}</textarea>
                    <div class="form-actions" style="justify-content:space-between">
                      <button type="button" class="btn btn-ghost" data-proto-template>Vorlage aus Tagesordnung einfügen</button>
                      <span style="display:flex;gap:8px"><button type="button" class="btn" data-proto-cancel>Abbrechen</button>
                      <button type="submit" class="btn btn-primary">Protokoll speichern</button></span>
                    </div>
                  </form>`
                : ev.protocol ? html`<div class="md">${md(ev.protocol)}</div>
                    <p class="small muted" style="margin-top:12px">Zuletzt bearbeitet von ${ev.protocolBy || 'Unbekannt'}, ${ago(ev.protocolUpdatedAt)}</p>`
                  : html`<div class="empty">${past ? 'Für diese Sitzung gibt es noch kein Protokoll.' : 'Das Protokoll wird während oder nach der Sitzung geschrieben. Die Vorlage übernimmt die Tagesordnung.'}</div>`}
              </section>` : ''}

            ${ev.description ? html`<section class="panel"><div class="panel-head"><h2>Beschreibung</h2></div><div class="md">${md(ev.description)}</div></section>` : ''}

            ${isMeeting || ev.polls.length ? html`
              <section class="panel">
                <div class="panel-head"><h2>Abstimmungen</h2>
                  ${board ? html`<button type="button" class="btn btn-s" data-new-poll>${icon('plus')}Abstimmung anlegen</button>` : ''}</div>
                ${ev.polls.length ? html`<ul class="rows">${ev.polls.map((p) => html`<li><a class="row" href="/abstimmungen/${p.id}">
                  <span class="row-main"><span class="row-title">${p.title}</span></span>
                  <span class="row-end"><span class="tag ${p.closed ? '' : 'tag-marker'}">${p.closed ? 'beendet' : 'läuft'}</span></span></a></li>`)}</ul>`
                : html`<div class="empty">Keine Abstimmungen zu dieser Sitzung.</div>`}
              </section>` : ''}
          </div>

          <div>
            <section class="panel">
              <dl class="facts">
                <dt>${icon('calendar', 'icon-s')}Datum</dt><dd>${fmtDateLong(ev.startsAt)}${rel ? html` <span class="muted">(${rel})</span>` : ''}</dd>
                <dt>${icon('clock', 'icon-s')}Zeit</dt><dd>${eventTime(ev)}</dd>
                ${ev.location ? html`<dt>${icon('place', 'icon-s')}Ort</dt><dd>${ev.location}</dd>` : ''}
                ${ev.projectId ? html`<dt>${icon('projects', 'icon-s')}Projekt</dt><dd><a href="/projekte/${ev.projectId}">${ev.projectTitle}</a></dd>` : ''}
                ${ev.creatorName ? html`<dt>${icon('user', 'icon-s')}Eingetragen</dt><dd>${ev.creatorName}</dd>` : ''}
              </dl>
            </section>
            <section class="panel">
              <div class="panel-head"><h2>Wer ist dabei?</h2></div>
              ${!past ? rsvpButtons(ev) : ''}
              <div style="margin-top:14px">
                ${['ja', 'vielleicht', 'nein'].map((s) => byStatus(s).length ? html`<div class="who-group">
                  <h3>${{ ja: 'Zusagen', vielleicht: 'Vielleicht', nein: 'Absagen' }[s]} (${byStatus(s).length})</h3>
                  <div class="who">${byStatus(s).map((r) => html`<span class="tag tag-leer">${avatar(r.name, 'avatar-s')}${r.name}</span>`)}</div></div>` : '')}
                ${!ev.rsvps.length ? html`<div class="empty">Noch keine Rückmeldungen.</div>` : ''}
              </div>
            </section>
          </div>
        </div>
      </div>`);

    // Ereignisse
    $('[data-edit]', main)?.addEventListener('click', async () => {
      if (await newEventDialog(ctx, {}, ev)) { toast('Gespeichert'); load(); }
    });
    $$('[data-rsvp]', main).forEach((b) => b.addEventListener('click', async () => {
      const status = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.rsvp;
      if (await attempt(() => put(`/termine/${ev.id}/zusage`, { status }))) load();
    }));
    $('[data-add-top]', main)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = e.target.elements.title.value.trim();
      if (!title) return;
      if (await attempt(() => post(`/termine/${ev.id}/tagesordnung`, { title }), 'Punkt vorgeschlagen')) {
        await load();
        $('#top-title', main)?.focus();
      }
    });
    $$('[data-top-done]', main).forEach((c) => c.addEventListener('change', async () => {
      if (await attempt(() => patch(`/tagesordnung/${c.dataset.topDone}`, { done: c.checked }))) load();
    }));
    $('[data-proto-edit]', main)?.addEventListener('click', () => {
      editingProtocol = true; draft = null; load().then(() => $('[data-proto-form] textarea', main)?.focus());
    });
    const form = $('[data-proto-form]', main);
    if (form) {
      const ta = form.elements.text;
      ta.addEventListener('input', () => { draft = ta.value; });
      $('[data-proto-cancel]', form).addEventListener('click', () => { editingProtocol = false; draft = null; load(); });
      $('[data-proto-template]', form).addEventListener('click', () => {
        const tpl = protocolTemplate(ev);
        ta.value = ta.value.trim() ? `${ta.value}\n\n${tpl}` : tpl;
        draft = ta.value;
        ta.focus();
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await attempt(() => put(`/termine/${ev.id}/protokoll`, { text: ta.value }), 'Protokoll gespeichert')) {
          editingProtocol = false; draft = null; load();
        }
      });
    }
    $('[data-new-poll]', main)?.addEventListener('click', async () => {
      const { newPollDialog } = await import('./polls.js');
      const id = await newPollDialog(ctx, { eventId: ev.id });
      if (id) ctx.go(`/abstimmungen/${id}`);
    });

    async function remove() {
      if (!await confirmDialog({ title: 'Termin löschen?', text: `„${ev.title}“ wird mit Tagesordnung, Zusagen und Protokoll gelöscht.`, confirmLabel: 'Termin löschen', danger: true })) return;
      if (await attempt(() => del(`/termine/${ev.id}`), 'Termin gelöscht')) ctx.go('/termine');
    }
    async function editTop(a) {
      const r = await formDialog({
        title: 'Tagesordnungspunkt bearbeiten',
        fields: [
          { name: 'title', label: 'Thema', required: true, value: a.title, maxlength: 160 },
          { name: 'note', label: 'Notiz', type: 'textarea', rows: 3, value: a.note, max: 2000, hint: 'Z. B. Hintergrund oder was entschieden werden soll' },
        ],
        onSubmit: (v) => patch(`/tagesordnung/${a.id}`, v),
      });
      if (r) load();
    }
    async function moveTop(a, dir) {
      if (await attempt(() => post(`/tagesordnung/${a.id}/verschieben`, { dir }))) load();
    }
    async function removeTop(a) {
      if (!await confirmDialog({ title: 'Punkt löschen?', text: `„${a.title}“ wird von der Tagesordnung genommen.`, confirmLabel: 'Löschen', danger: true })) return;
      if (await attempt(() => del(`/tagesordnung/${a.id}`))) load();
    }
  };
  await load();
}

