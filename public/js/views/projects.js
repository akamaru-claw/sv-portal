import {
  html, $, $$, get, post, patch, put, del, upload, icon, md, avatar, attempt, toast, formDialog, confirmDialog, menuButton,
  fmtDate, fmtShort, today, daysBetween, ago, euro, bytes, plural, memberOptions,
} from '../lib.js';
import { eventRow, newEventDialog } from './events.js';

export const STATUS = [
  ['idee', 'Idee'], ['planung', 'In Planung'], ['aktiv', 'Läuft'], ['erledigt', 'Erledigt'], ['verworfen', 'Verworfen'],
];
const STATUS_LABEL = Object.fromEntries(STATUS);
const STATUS_TAG = { idee: 'tag-marker', planung: 'tag-blau', aktiv: 'tag-gruen', erledigt: '', verworfen: 'tag-leer' };
export const statusTag = (s) => html`<span class="tag ${STATUS_TAG[s]}">${STATUS_LABEL[s]}</span>`;

function projectCard(p) {
  const late = p.dueDate && !['erledigt', 'verworfen'].includes(p.status) && daysBetween(today(), p.dueDate) < 0;
  const pct = p.tasks.total ? Math.round((p.tasks.done / p.tasks.total) * 100) : 0;
  return html`<a class="pcard" href="/projekte/${p.id}">
    <div class="pcard-title">${p.title}</div>
    ${p.summary ? html`<div class="pcard-sum">${p.summary}</div>` : ''}
    <div class="pcard-meta">
      ${p.leadName ? html`<span>${avatar(p.leadName, 'avatar-s')}${p.leadName}</span>` : p.status === 'idee' ? html`<span class="muted">sucht Leitung</span>` : ''}
      ${p.dueDate ? html`<span class="${late ? 'over' : ''}">${icon('flag', 'icon-s')}${fmtDate(p.dueDate)}</span>` : ''}
      ${p.tasks.total ? html`<span>${icon('task', 'icon-s')}${p.tasks.done}/${p.tasks.total}</span>` : ''}
      ${p.likes ? html`<span title="Unterstützung">${icon('heart', 'icon-s')}${p.likes}</span>` : ''}
      ${p.commentCount ? html`<span>${icon('chat', 'icon-s')}${p.commentCount}</span>` : ''}
      ${p.isMember ? html`<span class="tag tag-gruen">dein Team</span>` : ''}
    </div>
    ${p.tasks.total && p.status !== 'idee' ? html`<div class="progress" aria-label="${pct} Prozent erledigt"><i style="width:${pct}%"></i></div>` : ''}
  </a>`;
}

export async function newProjectDialog(ctx, existing = null) {
  const { members } = await get('/mitglieder');
  const p = existing || {};
  return formDialog({
    title: existing ? 'Projekt bearbeiten' : 'Neue Idee oder neues Projekt',
    submitLabel: existing ? 'Änderungen speichern' : 'Anlegen',
    intro: existing ? null : 'Eine Idee können alle unterstützen. Sobald sich jemand kümmert, wird sie zum Projekt.',
    fields: [
      { name: 'title', label: 'Titel', required: true, maxlength: 120, value: p.title || '', placeholder: 'z. B. Nikolausaktion, Wasserspender, Schulparty' },
      { name: 'summary', label: 'Kurz gesagt', maxlength: 240, value: p.summary || '', placeholder: 'Ein Satz, worum es geht' },
      { row: [
        { name: 'status', label: 'Stand', type: 'select', options: STATUS.filter(([k]) => existing || k !== 'verworfen').map(([value, label]) => ({ value, label })), value: p.status || 'idee' },
        { name: 'dueDate', label: 'Fertig bis', type: 'date', value: p.dueDate || '' },
      ] },
      { name: 'leadId', label: 'Projektleitung', type: 'select', options: memberOptions(members, 'Noch niemand'), value: p.leadId ?? (existing ? '' : ''), hint: existing ? null : 'Leer lassen bei Ideen. Bei Projekten übernimmst sonst du die Leitung.' },
      { name: 'description', label: 'Beschreibung', type: 'textarea', rows: 7, max: 10000, value: p.description || '', placeholder: 'Was ist das Ziel? Was braucht ihr? Wer muss zustimmen?', hint: 'Formatierung: **fett**, Listen mit „- “ am Zeilenanfang.' },
    ],
    onSubmit: async (v) => {
      const body = { ...v, leadId: v.leadId || null, dueDate: v.dueDate || null };
      if (existing) { await patch(`/projekte/${existing.id}`, body); return existing.id; }
      return (await post('/projekte', body)).id;
    },
  });
}

// ---------- Board ----------

export async function list(ctx) {
  const { main, query } = ctx;
  ctx.setTitle('Projekte');
  const mine = query.get('filter') === 'meine';
  const showDropped = query.get('verworfen') === '1';
  const { projects } = await get('/projekte');
  if (!ctx.isCurrent()) return;
  const shown = projects.filter((p) => !mine || p.isMember);
  const lanes = ['idee', 'planung', 'aktiv', 'erledigt'];
  const dropped = shown.filter((p) => p.status === 'verworfen');
  const byLane = (s) => shown.filter((p) => p.status === s).sort((a, b) => (s === 'idee' ? b.likes - a.likes : 0));

  main.innerHTML = String(html`
    <div class="page">
      <div class="page-head">
        <div><h1>Projekte</h1><p>Von der Idee bis zur fertigen Aktion. Unterstütze Ideen, die du gut findest, und tritt Teams bei.</p></div>
        <div class="page-actions"><button type="button" class="btn btn-primary" data-new>${icon('plus')}Idee oder Projekt</button></div>
      </div>
      <div class="filters">
        <a class="chip" href="/projekte" aria-current="${!mine}">Alle</a>
        <a class="chip" href="/projekte?filter=meine" aria-current="${mine}">Meine Teams</a>
      </div>
      ${shown.length ? html`
        <div class="board">${lanes.map((s) => {
          const items = byLane(s);
          return html`<section class="lane" aria-label="${STATUS_LABEL[s]}">
            <div class="lane-head"><h2>${STATUS_LABEL[s]}</h2><span>${items.length}</span></div>
            ${items.length ? items.map(projectCard) : html`<p class="small muted" style="padding:0 4px">${{ idee: 'Noch keine Ideen.', planung: 'Nichts in Planung.', aktiv: 'Gerade läuft nichts.', erledigt: 'Noch nichts abgeschlossen.' }[s]}</p>`}
          </section>`;
        })}</div>
        ${dropped.length ? html`<p style="margin-top:18px"><a href="/projekte?${mine ? 'filter=meine&' : ''}verworfen=${showDropped ? '0' : '1'}">${showDropped ? 'Verworfene ausblenden' : `Verworfene Ideen zeigen (${dropped.length})`}</a></p>
          ${showDropped ? html`<div class="board" style="margin-top:10px">${dropped.map((p) => html`<div>${projectCard(p)}</div>`)}</div>` : ''}` : ''}`
      : html`<section class="panel"><div class="empty"><strong>${mine ? 'Du bist noch in keinem Projektteam.' : 'Noch keine Projekte'}</strong>
          ${mine ? 'Öffne ein Projekt und tritt dem Team bei.' : 'Sammelt eure Ideen für das Schuljahr, zum Beispiel aus der ersten Sitzung.'}</div></section>`}
    </div>`);

  $('[data-new]', main).addEventListener('click', async () => {
    const id = await newProjectDialog(ctx);
    if (id) ctx.go(`/projekte/${id}`);
  });
}

// ---------- Detail ----------

export async function detail(ctx) {
  const { main, user } = ctx;
  let members = [];

  const load = async () => {
    const [{ project: p }, m] = await Promise.all([get(`/projekte/${ctx.params.id}`), get('/mitglieder')]);
    if (!ctx.isCurrent()) return;
    members = m.members;
    ctx.setTitle(p.title);
    const pct = p.taskList.length ? Math.round((p.tasks.done / p.tasks.total) * 100) : 0;
    const balance = p.money.income + p.money.expense;

    main.innerHTML = String(html`
      <div class="page">
        <a class="back" href="/projekte">${icon('left', 'icon-s')}Projekte</a>
        <div class="page-head">
          <div><div style="margin-bottom:8px">${statusTag(p.status)}</div><h1>${p.title}</h1>${p.summary ? html`<p>${p.summary}</p>` : ''}</div>
          <div class="page-actions">
            ${p.canEdit ? html`
              <label class="sr" for="status-select">Stand ändern</label>
              <select id="status-select" data-status style="width:auto">${STATUS.map(([k, l]) => html`<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`)}</select>
              <button type="button" class="btn" data-edit>${icon('edit')}Bearbeiten</button>` : ''}
            ${p.canDelete ? menuButton([{ label: 'Projekt löschen', icon: 'trash', danger: true, onClick: () => remove(p) }]) : ''}
          </div>
        </div>

        <div class="cols">
          <div>
            <section class="panel">
              <div class="panel-head"><h2>Worum geht es?</h2></div>
              ${p.description ? html`<div class="md">${md(p.description)}</div>` : html`<div class="empty">Noch keine Beschreibung.${p.canEdit ? ' Schreib auf, was das Ziel ist und was ihr braucht.' : ''}</div>`}
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Aufgaben</h2><span class="small muted">${p.taskList.length ? `${p.tasks.done} von ${p.tasks.total} erledigt` : ''}</span></div>
              ${p.taskList.length ? html`<div class="progress" style="margin:0 0 8px"><i style="width:${pct}%"></i></div>
                <ul class="tasks">${p.taskList.map((t) => {
                  const late = t.dueDate && !t.done && daysBetween(today(), t.dueDate) < 0;
                  const mayToggle = p.canEdit || t.assigneeId === user.id;
                  return html`<li class="${t.done ? 'done' : ''}">
                    <input type="checkbox" class="check" data-task="${t.id}" ${t.done ? 'checked' : ''} ${mayToggle ? '' : 'disabled'} aria-label="Erledigt: ${t.title}">
                    <div class="task-main"><div class="task-title">${t.title}</div>
                      <div class="task-meta">
                        ${t.assigneeName ? html`<span>${t.assigneeId === user.id ? 'du' : t.assigneeName}</span>` : html`<span>noch offen, wer's macht</span>`}
                        ${t.dueDate ? html`<span class="${late ? 'over' : ''}">${late ? 'überfällig: ' : 'bis '}${fmtDate(t.dueDate)}</span>` : ''}
                      </div></div>
                    ${!t.assigneeId && !t.done ? html`<button type="button" class="btn btn-s" data-take="${t.id}">Übernehmen</button>` : ''}
                    ${p.canEdit ? menuButton([
                      { label: 'Bearbeiten', icon: 'edit', onClick: () => editTask(t) },
                      { label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeTask(t) },
                    ], 'Aktionen für diese Aufgabe') : ''}
                  </li>`;
                })}</ul>`
              : html`<div class="empty">${p.canEdit ? 'Zerlegt das Projekt in kleine Aufgaben, dann weiß jede und jeder, was zu tun ist.' : 'Noch keine Aufgaben.'}</div>`}
              ${p.canEdit ? html`<form class="inline-form" data-add-task>
                <label class="sr" for="task-title">Neue Aufgabe</label>
                <input type="text" id="task-title" name="title" maxlength="200" placeholder="Neue Aufgabe, z. B. Flyer drucken" required>
                <label class="sr" for="task-who">Wer?</label>
                <select id="task-who" name="assigneeId" style="flex:0 1 180px">${memberOptions(members, 'Wer?').map((o) => html`<option value="${o.value}">${o.label}</option>`)}</select>
                <label class="sr" for="task-due">Bis wann?</label>
                <input type="date" id="task-due" name="dueDate" style="flex:0 1 160px">
                <button type="submit" class="btn btn-primary">${icon('plus')}Hinzufügen</button>
              </form>` : html`<p class="small muted" style="margin-top:10px">Tritt dem Team bei, um Aufgaben anzulegen.</p>`}
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Neuigkeiten und Fragen</h2></div>
              <form data-comment>
                <label class="sr" for="comment-body">Beitrag</label>
                <textarea id="comment-body" name="body" rows="3" maxlength="4000" placeholder="Stand, Fragen oder Ideen für das Team"></textarea>
                <div class="form-actions" style="margin-top:8px"><button type="submit" class="btn btn-primary">Posten</button></div>
              </form>
              ${p.comments.length ? html`<ul class="comments" style="margin-top:8px">${p.comments.map((c) => html`<li>
                ${avatar(c.authorName, 'avatar-s')}
                <div class="row-main"><div class="comment-head"><b>${c.authorName}</b><time datetime="${c.createdAt}">${ago(c.createdAt)}</time></div>
                  <div class="md">${md(c.body)}</div></div>
                ${c.authorId === user.id || user.role !== 'mitglied' ? html`<button type="button" class="btn btn-ghost btn-icon" data-del-comment="${c.id}" aria-label="Beitrag löschen">${icon('trash', 'icon-s')}</button>` : ''}
              </li>`)}</ul>` : ''}
            </section>
          </div>

          <div>
            <section class="panel">
              <dl class="facts">
                <dt>${icon('user', 'icon-s')}Leitung</dt><dd>${p.leadName || html`<span class="muted">noch niemand</span>`}</dd>
                ${p.dueDate ? html`<dt>${icon('flag', 'icon-s')}Fertig bis</dt><dd>${fmtShort(p.dueDate)}</dd>` : ''}
                <dt>${icon('edit', 'icon-s')}Angelegt</dt><dd>${p.creatorName || 'Unbekannt'}, ${ago(p.createdAt)}</dd>
              </dl>
              <div class="rsvp" style="margin-top:16px">
                <button type="button" class="btn btn-s like" data-like aria-pressed="${p.liked}">${icon('heart', 'icon-s')}${p.liked ? 'Unterstützt' : 'Unterstützen'} (${p.likes})</button>
              </div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Team</h2><span class="small muted">${plural(p.members.length, 'Person', 'Personen')}</span></div>
              ${p.members.length ? html`<ul class="rows">${p.members.map((mm) => html`<li><div class="row">${avatar(mm.name, 'avatar-s')}
                <span class="row-main"><span class="row-title">${mm.name}</span>${mm.klasse ? html` <span class="small muted">${mm.klasse}</span>` : ''}</span>
                ${mm.id === p.leadId ? html`<span class="tag tag-gruen">Leitung</span>` : ''}</div></li>`)}</ul>` : html`<div class="empty">Noch niemand im Team.</div>`}
              <div style="margin-top:10px">${p.isMember
                ? (p.leadId !== user.id ? html`<button type="button" class="btn btn-s" data-team="0">Team verlassen</button>` : '')
                : html`<button type="button" class="btn btn-s btn-primary" data-team="1">${icon('plus', 'icon-s')}Mitmachen</button>`}</div>
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Termine</h2><button type="button" class="btn btn-s" data-new-event>${icon('plus', 'icon-s')}Termin</button></div>
              ${p.events.length ? html`<ul class="rows">${p.events.map((e) => html`<li>${eventRow(e)}</li>`)}</ul>` : html`<div class="empty">Keine Termine verknüpft.</div>`}
            </section>

            <section class="panel">
              <div class="panel-head"><h2>Dateien</h2>
                <button type="button" class="btn btn-s" data-pick>${icon('upload', 'icon-s')}Hochladen</button><input type="file" multiple hidden data-upload></div>
              <div class="upload-progress" hidden><i></i></div>
              ${p.files.length ? html`<ul class="rows">${p.files.map((f) => html`<li><div class="row">
                <span class="ficon">${icon(f.mime.startsWith('image/') ? 'image' : 'file')}</span>
                <span class="row-main"><a class="row-title" href="/api/dateien/${f.id}/download?inline=1" target="_blank" rel="noopener">${f.name}</a>
                <span class="row-sub"><span>${bytes(f.size)}</span><span>${f.uploader || ''}</span></span></span>
                <a class="btn btn-ghost btn-icon" href="/api/dateien/${f.id}/download" download aria-label="Herunterladen">${icon('download', 'icon-s')}</a></div></li>`)}</ul>`
              : html`<div class="empty">Plakate, Listen, Angebote: alles, was zum Projekt gehört.</div>`}
            </section>

            ${p.money.income || p.money.expense ? html`
              <section class="panel">
                <div class="panel-head"><h2>Geld</h2><a href="/kasse">Zur Kasse</a></div>
                <dl class="facts">
                  <dt>Einnahmen</dt><dd class="plus">${euro(p.money.income)}</dd>
                  <dt>Ausgaben</dt><dd class="minus">${euro(p.money.expense)}</dd>
                  <dt>Ergebnis</dt><dd class="${balance < 0 ? 'minus' : 'plus'}">${euro(balance)}</dd>
                </dl>
              </section>` : ''}
          </div>
        </div>
      </div>`);

    // ----- Ereignisse -----
    $('[data-status]', main)?.addEventListener('change', async (e) => {
      if (await attempt(() => patch(`/projekte/${p.id}`, { status: e.target.value }), `Stand: ${STATUS_LABEL[e.target.value]}`)) load();
    });
    $('[data-edit]', main)?.addEventListener('click', async () => { if (await newProjectDialog(ctx, p)) { toast('Gespeichert'); load(); } });
    $('[data-like]', main).addEventListener('click', async () => {
      if (await attempt(() => put(`/projekte/${p.id}/unterstuetzen`, { like: !p.liked }))) load();
    });
    $$('[data-team]', main).forEach((b) => b.addEventListener('click', async () => {
      const join = b.dataset.team === '1';
      if (await attempt(() => put(`/projekte/${p.id}/team`, { member: join }), join ? 'Du bist jetzt im Team' : 'Du hast das Team verlassen')) load();
    }));
    $$('[data-task]', main).forEach((c) => c.addEventListener('change', async () => {
      if (await attempt(() => patch(`/aufgaben/${c.dataset.task}`, { done: c.checked }))) load();
      else c.checked = !c.checked;
    }));
    $$('[data-take]', main).forEach((b) => b.addEventListener('click', async () => {
      if (!p.isMember) await put(`/projekte/${p.id}/team`, { member: true }).catch(() => {});
      if (await attempt(() => patch(`/aufgaben/${b.dataset.take}`, { assigneeId: user.id }), 'Aufgabe übernommen')) load();
    }));
    $('[data-add-task]', main)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      if (!f.title.value.trim()) return;
      if (await attempt(() => post(`/projekte/${p.id}/aufgaben`, { title: f.title.value, assigneeId: f.assigneeId.value || null, dueDate: f.dueDate.value || null }))) {
        await load();
        $('#task-title', main)?.focus();
      }
    });
    $('[data-comment]', main).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = e.target.elements.body.value.trim();
      if (!body) return;
      if (await attempt(() => post(`/projekte/${p.id}/kommentare`, { body }))) load();
    });
    $$('[data-del-comment]', main).forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Beitrag löschen?', text: 'Der Beitrag wird für alle entfernt.', confirmLabel: 'Löschen', danger: true })) return;
      if (await attempt(() => del(`/kommentare/${b.dataset.delComment}`))) load();
    }));
    $('[data-new-event]', main).addEventListener('click', async () => {
      if (await newEventDialog(ctx, { projectId: p.id, type: 'aktion' })) load();
    });
    $('[data-pick]', main).addEventListener('click', () => $('[data-upload]', main).click());
    $('[data-upload]', main).addEventListener('change', async (e) => {
      const files = [...e.target.files];
      if (!files.length) return;
      const fd = new FormData();
      fd.append('projectId', String(p.id));
      files.forEach((f) => fd.append('files', f));
      const bar = $('.upload-progress', main);
      bar.hidden = false;
      if (await attempt(() => upload(fd, (x) => { bar.firstElementChild.style.width = `${Math.round(x * 100)}%`; }), files.length === 1 ? 'Datei hochgeladen' : `${files.length} Dateien hochgeladen`)) load();
      else bar.hidden = true;
    });

    async function editTask(t) {
      const r = await formDialog({
        title: 'Aufgabe bearbeiten',
        fields: [
          { name: 'title', label: 'Aufgabe', required: true, maxlength: 200, value: t.title },
          { row: [
            { name: 'assigneeId', label: 'Wer?', type: 'select', options: memberOptions(members, 'Noch offen'), value: t.assigneeId || '' },
            { name: 'dueDate', label: 'Bis wann?', type: 'date', value: t.dueDate || '' },
          ] },
        ],
        onSubmit: (v) => patch(`/aufgaben/${t.id}`, { title: v.title, assigneeId: v.assigneeId || null, dueDate: v.dueDate || null }),
      });
      if (r) load();
    }
    async function removeTask(t) {
      if (!await confirmDialog({ title: 'Aufgabe löschen?', text: `„${t.title}“ wird gelöscht.`, confirmLabel: 'Löschen', danger: true })) return;
      if (await attempt(() => del(`/aufgaben/${t.id}`))) load();
    }
  };

  async function remove(p) {
    if (!await confirmDialog({ title: 'Projekt löschen?', text: `„${p.title}“ wird mit Aufgaben und Beiträgen gelöscht. Dateien, Termine und Buchungen bleiben erhalten, sind aber nicht mehr verknüpft. Wenn das Projekt nur nicht stattfindet, setz den Stand lieber auf „Verworfen“.`, confirmLabel: 'Endgültig löschen', danger: true })) return;
    if (await attempt(() => del(`/projekte/${p.id}`), 'Projekt gelöscht')) ctx.go('/projekte');
  }

  await load();
}
