import { html, $$, get, post, patch, del, icon, md, avatar, attempt, formDialog, confirmDialog, menuButton, ago, stamp } from '../lib.js';

function postDialog(user, existing = null) {
  const board = user.role !== 'mitglied';
  const p = existing || {};
  return formDialog({
    title: existing ? 'Beitrag bearbeiten' : 'Neuer Beitrag',
    submitLabel: existing ? 'Speichern' : 'Veröffentlichen',
    fields: [
      { name: 'title', label: 'Überschrift', required: true, maxlength: 140, value: p.title || '' },
      { name: 'body', label: 'Text', type: 'textarea', rows: 8, max: 8000, value: p.body || '', hint: 'Formatierung: **fett**, *kursiv*, Listen mit „- “ am Zeilenanfang. Links werden automatisch klickbar.' },
      ...(board ? [{ name: 'pinned', label: 'Oben anheften', type: 'checkbox', value: !!p.pinned, hint: 'Angeheftete Beiträge stehen immer oben und auf der Übersicht.' }] : []),
    ],
    onSubmit: (v) => (existing ? patch(`/pinnwand/${existing.id}`, v) : post('/pinnwand', v)),
  });
}

export async function render(ctx) {
  const { main, user } = ctx;
  ctx.setTitle('Pinnwand');

  const load = async () => {
    const { posts } = await get('/pinnwand');
    if (!ctx.isCurrent()) return;
    main.innerHTML = String(html`
      <div class="page page-narrow">
        <div class="page-head">
          <div><h1>Pinnwand</h1><p>Ankündigungen, Infos und Fragen an das ganze SV-Team.</p></div>
          <div class="page-actions"><button type="button" class="btn btn-primary" data-new>${icon('plus')}Neuer Beitrag</button></div>
        </div>
        ${posts.length ? posts.map((p) => html`
          <article class="${p.pinned ? 'post pinned' : 'post'}">
            <div class="post-head">
              <div style="display:flex;gap:12px;align-items:flex-start">
                ${avatar(p.authorName)}
                <div><h2>${p.title}</h2>
                  <div class="post-meta">${p.authorName}${p.authorAmt ? `, ${p.authorAmt}` : ''}, <span title="${stamp(p.createdAt)}">${ago(p.createdAt)}</span>${p.updatedAt ? ' (bearbeitet)' : ''}</div></div>
              </div>
              <div style="display:flex;gap:6px;align-items:center">
                ${p.pinned ? html`<span class="tag tag-gruen">${icon('pin', 'icon-s')}Angeheftet</span>` : ''}
                ${p.canEdit ? menuButton([
                  { label: 'Bearbeiten', icon: 'edit', onClick: () => edit(p) },
                  ...(user.role !== 'mitglied' ? [{ label: p.pinned ? 'Nicht mehr anheften' : 'Oben anheften', icon: 'pin', onClick: () => pin(p) }] : []),
                  { label: 'Löschen', icon: 'trash', danger: true, onClick: () => remove(p) },
                ]) : ''}
              </div>
            </div>
            ${p.body ? html`<div class="post-body md">${md(p.body)}</div>` : ''}
          </article>`)
        : html`<section class="panel"><div class="empty"><strong>Noch leer hier.</strong>Schreib den ersten Beitrag, zum Beispiel die Termine der SV-Sitzungen für dieses Halbjahr.</div></section>`}
      </div>`);

    $$('[data-new]', main).forEach((b) => b.addEventListener('click', async () => { if (await postDialog(user)) load(); }));
  };

  async function edit(p) { if (await postDialog(user, p)) load(); }
  async function pin(p) { if (await attempt(() => patch(`/pinnwand/${p.id}`, { pinned: !p.pinned }))) load(); }
  async function remove(p) {
    if (!await confirmDialog({ title: 'Beitrag löschen?', text: `„${p.title}“ wird für alle gelöscht.`, confirmLabel: 'Löschen', danger: true })) return;
    if (await attempt(() => del(`/pinnwand/${p.id}`), 'Beitrag gelöscht')) load();
  }

  await load();
}
