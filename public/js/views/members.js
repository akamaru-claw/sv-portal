import {
  html, $, get, post, patch, del, icon, avatar, attempt, toast, formDialog, confirmDialog, menuButton, openDialog, copyText, mark,
  ago, stamp, ROLE_LABEL, plural,
} from '../lib.js';

const ROLE_OPTIONS = [
  { value: 'mitglied', label: 'SV-Mitglied' },
  { value: 'vorstand', label: 'SV-Vorstand (Schülersprecher/-in, Stellvertretung)' },
  { value: 'lehrkraft', label: 'Lehrkraft (verwaltet Konten)' },
];
const ROLE_HINT = 'SV-Mitglieder können Ideen, Termine, Aufgaben und Dateien anlegen. Der Vorstand plant zusätzlich Sitzungen, startet Abstimmungen und bucht in der Kasse. Lehrkräfte verwalten außerdem die Konten.';

function statusTag(s) {
  const cls = { gültig: 'tag-gruen', verbraucht: '', abgelaufen: '', zurückgezogen: 'tag-leer' }[s];
  return html`<span class="tag ${cls}">${s}</span>`;
}

function beamer(inv) {
  const el = document.createElement('div');
  el.className = 'beamer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Einladung für den Beamer');
  const url = new URL(inv.link);
  el.innerHTML = String(html`
    <button type="button" class="btn" data-x>${icon('x')}Schließen</button>
    ${mark('beamer-mark')}
    <p><strong>Konto fürs SV-Portal anlegen</strong></p>
    <img class="qr" src="/api/einladungen/${inv.id}/qr.svg" alt="QR-Code zur Einladung">
    <div class="code-big">${inv.code}</div>
    <p>oder ${url.host}/einladung öffnen und den Code eingeben</p>
    <p class="muted">${inv.maxUses > 1 ? `Noch ${inv.maxUses - inv.uses} von ${inv.maxUses} Plätzen frei. ` : ''}Gültig bis ${stamp(inv.expiresAt)}</p>`);
  document.body.append(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('[data-x]').addEventListener('click', close);
  el.querySelector('[data-x]').focus();
  el.requestFullscreen?.().catch(() => {});
}

function showInvite(inv) {
  openDialog({
    title: 'Einladung',
    wide: true,
    body: html`
      <div class="invite-result">
        <img class="qr" src="/api/einladungen/${inv.id}/qr.svg" alt="QR-Code zur Einladung">
        <div>
          <div class="small muted">Einladungscode</div>
          <div class="code-big">${inv.code}</div>
          <p class="small">${inv.roleLabel}${inv.displayName ? ` für ${inv.displayName}` : ''}, ${inv.maxUses > 1 ? `${inv.uses} von ${inv.maxUses} Plätzen genutzt` : (inv.uses ? 'bereits genutzt' : 'für eine Person')}, gültig bis ${stamp(inv.expiresAt)}.</p>
          <div class="copy-row"><input type="text" value="${inv.link}" readonly aria-label="Einladungslink"><button type="button" class="btn" data-copy>${icon('copy', 'icon-s')}Kopieren</button></div>
        </div>
      </div>
      <div class="notice" style="margin-top:16px">${icon('info')}<div>Wer den Code hat, kann ein Konto anlegen. Gib ihn nur an die richtigen Personen weiter, zum Beispiel über den Beamer in der Sitzung oder persönlich.</div></div>
      <div class="form-actions">
        <button type="button" class="btn" data-beamer>${icon('screen')}Beamer-Ansicht</button>
        <button type="button" class="btn btn-primary" data-close>Fertig</button>
      </div>`,
    onMount: (dlg, close) => {
      $('[data-copy]', dlg).addEventListener('click', () => copyText(inv.link));
      $('[data-beamer]', dlg).addEventListener('click', () => { close(); beamer(inv); });
    },
  });
}

export async function render(ctx) {
  const { main, user } = ctx;
  const teacher = user.role === 'lehrkraft';
  ctx.setTitle('Mitglieder');

  const load = async () => {
    const [{ members }, inv] = await Promise.all([get('/mitglieder'), teacher ? get('/einladungen') : Promise.resolve({ invites: [] })]);
    if (!ctx.isCurrent()) return;
    const active = members.filter((m) => m.active);
    const inactive = members.filter((m) => !m.active);
    const groups = [['lehrkraft', 'Lehrkräfte'], ['vorstand', 'SV-Vorstand'], ['mitglied', 'SV-Mitglieder']];
    const validInvites = inv.invites.filter((i) => i.status === 'gültig');
    const oldInvites = inv.invites.filter((i) => i.status !== 'gültig').slice(0, 10);

    const person = (m) => html`<div class="person ${m.active ? '' : 'inactive'}">
      ${avatar(m.displayName)}
      <div class="person-main">
        <div class="person-name">${m.displayName}${m.id === user.id ? html` <span class="small muted">(du)</span>` : ''}</div>
        <div class="person-sub">@${m.username}${m.klasse ? `, ${m.klasse}` : ''}</div>
        <div class="person-tags">
          ${m.amt ? html`<span class="tag tag-gruen">${m.amt}</span>` : ''}
          ${teacher && m.mustChangePassword ? html`<span class="tag tag-marker">${icon('key', 'icon-s')}Einmal-Passwort offen</span>` : ''}
          ${!m.active ? html`<span class="tag">deaktiviert</span>` : ''}
        </div>
        ${teacher ? html`<div class="person-sub" style="margin-top:6px">${m.lastLoginAt ? `Zuletzt angemeldet ${ago(m.lastLoginAt)}` : 'Noch nie angemeldet'}</div>
          ${m.id !== user.id ? html`<div class="person-actions">
            <button type="button" class="btn btn-s" data-reset="${m.id}">${icon('key', 'icon-s')}Passwort zurücksetzen</button>
            ${menuButton([
              { label: 'Bearbeiten', icon: 'edit', onClick: () => edit(m) },
              { label: m.active ? 'Deaktivieren' : 'Wieder aktivieren', icon: m.active ? 'lock' : 'check', onClick: () => toggle(m) },
              { label: 'Konto löschen', icon: 'trash', danger: true, onClick: () => remove(m) },
            ], `Aktionen für ${m.displayName}`)}
          </div>` : html`<div class="person-actions"><button type="button" class="btn btn-s" data-edit-self>${icon('edit', 'icon-s')}Amt und Klasse</button></div>`}` : ''}
      </div>
    </div>`;

    main.innerHTML = String(html`
      <div class="page">
        <div class="page-head">
          <div><h1>Mitglieder</h1><p>${plural(active.filter((m) => m.role !== 'lehrkraft').length, 'Schülerin oder Schüler', 'Schülerinnen und Schüler')} im SV-Team.${teacher ? ' Neue Konten entstehen nur über Einladungen.' : ''}</p></div>
          ${teacher ? html`<div class="page-actions"><button type="button" class="btn btn-primary" data-invite>${icon('plus')}Einladen</button></div>` : ''}
        </div>

        ${teacher && validInvites.length ? html`
          <section class="panel" style="margin-bottom:24px">
            <div class="panel-head"><h2>Offene Einladungen</h2></div>
            <ul class="rows">${validInvites.map((i) => html`<li><div class="row">
              <span class="ficon">${icon('qr')}</span>
              <span class="row-main"><span class="row-title">${i.code}</span>
                <span class="row-sub"><span>${i.roleLabel}${i.displayName ? ` für ${i.displayName}` : ''}</span>
                <span>${i.maxUses > 1 ? `${i.uses} von ${i.maxUses} genutzt` : 'für eine Person'}</span>
                <span>bis ${stamp(i.expiresAt)}</span>${i.note ? html`<span>${i.note}</span>` : ''}</span></span>
              <button type="button" class="btn btn-s" data-show-invite="${i.id}">${icon('qr', 'icon-s')}Anzeigen</button>
              ${menuButton([{ label: 'Zurückziehen', icon: 'x', danger: true, onClick: () => revoke(i) }])}
            </div></li>`)}</ul>
          </section>` : ''}

        ${groups.map(([role, title]) => {
          const list = active.filter((m) => m.role === role);
          return list.length ? html`<h2 class="section-title">${title}</h2><div class="people">${list.map(person)}</div>` : '';
        })}
        ${teacher && inactive.length ? html`<h2 class="section-title">Deaktiviert</h2><p class="muted small">Deaktivierte Konten können sich nicht anmelden. Ihre Beiträge bleiben erhalten. Nutzt das zum Beispiel für Mitglieder aus dem letzten Schuljahr.</p><div class="people">${inactive.map(person)}</div>` : ''}

        ${teacher && oldInvites.length ? html`
          <details class="panel" style="margin-top:28px"><summary><strong>Frühere Einladungen</strong></summary>
            <ul class="rows" style="margin-top:8px">${oldInvites.map((i) => html`<li><div class="row"><span class="row-main"><span class="row-title">${i.code}</span>
              <span class="row-sub"><span>${i.roleLabel}</span><span>${i.uses} von ${i.maxUses} genutzt</span><span>erstellt von ${i.createdBy || 'Unbekannt'}, ${ago(i.createdAt)}</span></span></span>
              ${statusTag(i.status)}</div></li>`)}</ul></details>` : ''}
      </div>`);

    $('[data-invite]', main)?.addEventListener('click', createInvite);
    main.querySelectorAll('[data-show-invite]').forEach((b) => b.addEventListener('click', () => showInvite(inv.invites.find((i) => i.id === Number(b.dataset.showInvite)))));
    main.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => reset(members.find((m) => m.id === Number(b.dataset.reset)))));
    $('[data-edit-self]', main)?.addEventListener('click', () => edit(members.find((m) => m.id === user.id)));
  };

  async function createInvite() {
    const inv = await formDialog({
      title: 'Einladung erstellen',
      submitLabel: 'Einladung erstellen',
      fields: [
        { name: 'role', label: 'Rolle', type: 'select', options: ROLE_OPTIONS, value: 'mitglied', hint: ROLE_HINT },
        { name: 'maxUses', label: 'Für wie viele Personen?', type: 'number', min: 1, max: 60, value: 1, hint: 'Für die erste Sitzung: so viele, wie im Raum sind. Den Code zeigst du dann per Beamer.' },
        { name: 'displayName', label: 'Name (optional, nur für eine Person)', maxlength: 60, placeholder: 'wird im Formular vorausgefüllt' },
        { row: [
          { name: 'days', label: 'Gültig für', type: 'select', value: '7', options: [1, 2, 3, 7, 14, 30].map((d) => ({ value: d, label: d === 1 ? '1 Tag' : `${d} Tage` })) },
          { name: 'note', label: 'Notiz (nur für Lehrkräfte)', maxlength: 120, placeholder: 'z. B. Sitzung 7.10.' },
        ] },
      ],
      onMount: (dlg) => {
        const f = $('form', dlg);
        const sync = () => { $('[data-field=displayName]', dlg).hidden = Number(f.elements.maxUses.value) > 1; };
        f.elements.maxUses.addEventListener('input', sync);
        sync();
      },
      onSubmit: async (v) => (await post('/einladungen', { ...v, maxUses: Number(v.maxUses) || 1, days: Number(v.days) })).invite,
    });
    if (inv) { showInvite(inv); load(); }
  }

  async function revoke(i) {
    if (!await confirmDialog({ title: 'Einladung zurückziehen?', text: `Mit dem Code ${i.code} kann danach niemand mehr ein Konto anlegen. Bestehende Konten bleiben.`, confirmLabel: 'Zurückziehen', danger: true })) return;
    if (await attempt(() => del(`/einladungen/${i.id}`), 'Einladung zurückgezogen')) load();
  }

  async function reset(m) {
    if (!await confirmDialog({ title: `Passwort von ${m.displayName} zurücksetzen?`, text: `${m.displayName} wird auf allen Geräten abgemeldet und bekommt ein Einmal-Passwort. Beim nächsten Anmelden legt ${m.displayName} ein eigenes Passwort fest.`, confirmLabel: 'Zurücksetzen' })) return;
    const r = await attempt(() => post(`/mitglieder/${m.id}/passwort-zuruecksetzen`));
    if (!r) return;
    openDialog({
      title: 'Neues Einmal-Passwort',
      body: html`
        <p>Gib diese Daten persönlich an <strong>${m.displayName}</strong> weiter:</p>
        <dl class="facts" style="margin-bottom:12px"><dt>Nutzername</dt><dd>${r.username}</dd></dl>
        <div class="temp-pw">${r.tempPassword}</div>
        <p class="small muted" style="margin-top:12px">Das Passwort wird nur jetzt angezeigt. Es gilt, bis ${m.displayName} beim Anmelden ein eigenes festlegt.</p>
        <div class="form-actions"><button type="button" class="btn" data-copy>${icon('copy', 'icon-s')}Kopieren</button><button type="button" class="btn btn-primary" data-close>Fertig</button></div>`,
      onMount: (dlg) => $('[data-copy]', dlg).addEventListener('click', () => copyText(`Nutzername: ${r.username}\nEinmal-Passwort: ${r.tempPassword}`)),
    });
    load();
  }

  async function edit(m) {
    const self = m.id === user.id;
    const r = await formDialog({
      title: `${m.displayName} bearbeiten`,
      fields: [
        { name: 'displayName', label: 'Name', required: true, maxlength: 60, value: m.displayName },
        { row: [
          { name: 'amt', label: 'Amt in der SV', maxlength: 60, value: m.amt, placeholder: 'z. B. Schülersprecherin, Kasse, Protokoll' },
          { name: 'klasse', label: 'Klasse oder Stufe', maxlength: 20, value: m.klasse },
        ] },
        ...(self ? [] : [{ name: 'role', label: 'Rolle', type: 'select', options: ROLE_OPTIONS, value: m.role, hint: ROLE_HINT }]),
      ],
      onSubmit: (v) => patch(`/mitglieder/${m.id}`, v),
    });
    if (r) { toast('Gespeichert'); if (self) ctx.refreshUser(); else load(); }
  }

  async function toggle(m) {
    if (m.active && !await confirmDialog({ title: `${m.displayName} deaktivieren?`, text: 'Das Konto wird abgemeldet und kann sich nicht mehr anmelden. Beiträge, Aufgaben und Dateien bleiben erhalten. Du kannst es jederzeit wieder aktivieren.', confirmLabel: 'Deaktivieren' })) return;
    if (await attempt(() => patch(`/mitglieder/${m.id}`, { active: !m.active }), m.active ? 'Konto deaktiviert' : 'Konto wieder aktiv')) load();
  }

  async function remove(m) {
    if (!await confirmDialog({ title: `Konto von ${m.displayName} löschen?`, text: 'Das Konto wird endgültig gelöscht. Beiträge und Dateien bleiben und erscheinen als „Gelöschtes Mitglied“. Stimmen in Abstimmungen und Zusagen werden entfernt. Wenn du unsicher bist, deaktiviere das Konto lieber.', confirmLabel: 'Endgültig löschen', danger: true })) return;
    if (await attempt(() => del(`/mitglieder/${m.id}`), 'Konto gelöscht')) load();
  }

  await load();
}
