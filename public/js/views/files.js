import { html, $, get, post, patch, del, upload, icon, attempt, toast, formDialog, confirmDialog, menuButton, bytes, ago } from '../lib.js';

const PREVIEW = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'audio/mpeg', 'video/mp4'];

function folderPaths(all) {
  const byId = new Map(all.map((f) => [f.id, f]));
  const pathOf = (f) => { const parts = []; let c = f; while (c) { parts.unshift(c.name); c = byId.get(c.parentId); } return parts.join(' / '); };
  return all.map((f) => ({ id: f.id, label: pathOf(f) })).sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

export async function render(ctx) {
  const { main, user, site } = ctx;
  ctx.setTitle('Dateien');

  const load = async () => {
    const folderId = ctx.query.get('ordner') || '';
    const d = await get(`/dateien${folderId ? `?ordner=${encodeURIComponent(folderId)}` : ''}`);
    if (!ctx.isCurrent()) return;
    const here = d.folder;
    const canManage = (ownerId) => d.canManageAll || ownerId === user.id;

    main.innerHTML = String(html`
      <div class="page page-narrow">
        <div class="page-head">
          <div><h1>Dateien</h1><p>Protokolle, Plakate, Vorlagen und alles, was die SV aufheben will.</p></div>
          <div class="page-actions">
            <button type="button" class="btn" data-new-folder>${icon('folder')}Neuer Ordner</button>
            <button type="button" class="btn btn-primary" data-pick>${icon('upload')}Hochladen</button>
            <input type="file" multiple hidden data-upload>
          </div>
        </div>

        <nav class="crumbs" aria-label="Ordnerpfad">
          <a href="/dateien">Alle Dateien</a>
          ${d.trail.map((t, i) => html`<span class="sep">/</span>${i === d.trail.length - 1 ? html`<span aria-current="page">${t.name}</span>` : html`<a href="/dateien?ordner=${t.id}">${t.name}</a>`}`)}
        </nav>

        <div class="dropzone" data-drop>Dateien hierher ziehen oder <button type="button" class="btn btn-s" data-pick>auswählen</button>
          <div class="small">Höchstens ${site.maxUploadMb} MB pro Datei${here ? `, landet in „${here.name}“` : ''}</div>
          <div class="upload-progress" hidden><i></i></div></div>

        <section class="panel">
          ${d.folders.length || d.files.length ? html`<ul class="rows">
            ${here ? html`<li><a class="row" href="${here.parentId ? `/dateien?ordner=${here.parentId}` : '/dateien'}"><span class="ficon folder">${icon('up')}</span><span class="row-main"><span class="row-title">Eine Ebene höher</span></span></a></li>` : ''}
            ${d.folders.map((f) => html`<li><div class="row">
              <span class="ficon folder">${icon('folder')}</span>
              <a class="row-main" href="/dateien?ordner=${f.id}" style="text-decoration:none;color:inherit"><span class="row-title">${f.name}</span>
                <span class="row-sub"><span>${f.itemCount === 1 ? '1 Eintrag' : `${f.itemCount} Einträge`}</span></span></a>
              ${canManage(f.createdBy) ? menuButton([
                { label: 'Umbenennen', icon: 'edit', onClick: () => renameFolder(f) },
                { label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeFolder(f) },
              ]) : ''}
            </div></li>`)}
            ${d.files.map((f) => {
              const isImg = f.mime.startsWith('image/') && PREVIEW.includes(f.mime);
              const canPreview = PREVIEW.includes(f.mime);
              return html`<li><div class="row">
                <span class="ficon">${isImg ? html`<img src="/api/dateien/${f.id}/download?inline=1" alt="" loading="lazy">` : icon('file')}</span>
                <span class="row-main">
                  <a class="row-title" href="/api/dateien/${f.id}/download${canPreview ? '?inline=1' : ''}" ${canPreview ? html`target="_blank" rel="noopener"` : html`download`}>${f.name}</a>
                  <span class="row-sub"><span>${bytes(f.size)}</span><span>${f.uploaderName || 'Gelöschtes Mitglied'}, ${ago(f.createdAt)}</span>
                  ${f.projectId ? html`<span>${icon('projects', 'icon-s')}<a href="/projekte/${f.projectId}">${f.projectTitle}</a></span>` : ''}</span>
                </span>
                <a class="btn btn-ghost btn-icon" href="/api/dateien/${f.id}/download" download aria-label="${f.name} herunterladen">${icon('download', 'icon-s')}</a>
                ${canManage(f.uploadedBy) ? menuButton([
                  { label: 'Umbenennen', icon: 'edit', onClick: () => renameFile(f) },
                  { label: 'Verschieben', icon: 'move', onClick: () => moveFile(f, d.allFolders) },
                  { label: 'Löschen', icon: 'trash', danger: true, onClick: () => removeFile(f) },
                ]) : ''}
              </div></li>`;
            })}
          </ul>` : html`<div class="empty"><strong>${here ? 'Dieser Ordner ist leer.' : 'Noch keine Dateien.'}</strong>${here ? '' : 'Tipp: Legt Ordner wie „Protokolle“, „Plakate“ und „Vorlagen“ an.'}</div>`}
        </section>
      </div>`);

    // Hochladen
    const input = $('[data-upload]', main);
    main.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => input.click()));
    input.addEventListener('change', () => send([...input.files]));
    const drop = $('[data-drop]', main);
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => send([...(e.dataTransfer?.files || [])]));

    async function send(files) {
      if (!files.length) return;
      const tooBig = files.find((f) => f.size > site.maxUploadMb * 1024 * 1024);
      if (tooBig) return toast(`„${tooBig.name}“ ist größer als ${site.maxUploadMb} MB.`, true);
      const fd = new FormData();
      if (here) fd.append('folderId', String(here.id));
      files.forEach((f) => fd.append('files', f));
      const bar = $('.upload-progress', main);
      bar.hidden = false;
      const ok = await attempt(() => upload(fd, (x) => { bar.firstElementChild.style.width = `${Math.round(x * 100)}%`; }),
        files.length === 1 ? 'Datei hochgeladen' : `${files.length} Dateien hochgeladen`);
      if (ok) load(); else bar.hidden = true;
    }

    $('[data-new-folder]', main).addEventListener('click', async () => {
      const r = await formDialog({
        title: 'Neuer Ordner',
        submitLabel: 'Ordner anlegen',
        intro: here ? `Der Ordner wird in „${here.name}“ angelegt.` : null,
        fields: [{ name: 'name', label: 'Name', required: true, maxlength: 80, placeholder: 'z. B. Protokolle 2026/27' }],
        onSubmit: (v) => post('/ordner', { name: v.name, parentId: here ? here.id : null }),
      });
      if (r) load();
    });
  };

  async function renameFolder(f) {
    const r = await formDialog({ title: 'Ordner umbenennen', fields: [{ name: 'name', label: 'Name', required: true, maxlength: 80, value: f.name }], onSubmit: (v) => patch(`/ordner/${f.id}`, v) });
    if (r) load();
  }
  async function removeFolder(f) {
    if (!await confirmDialog({ title: 'Ordner löschen?', text: `„${f.name}“ wird gelöscht. Das geht nur, wenn der Ordner leer ist.`, confirmLabel: 'Löschen', danger: true })) return;
    if (await attempt(() => del(`/ordner/${f.id}`), 'Ordner gelöscht')) load();
  }
  async function renameFile(f) {
    const r = await formDialog({ title: 'Datei umbenennen', fields: [{ name: 'name', label: 'Dateiname', required: true, maxlength: 200, value: f.name }], onSubmit: (v) => patch(`/dateien/${f.id}`, v) });
    if (r) load();
  }
  async function moveFile(f, all) {
    const options = [{ value: '', label: 'Alle Dateien (oberste Ebene)' }, ...folderPaths(all).map((x) => ({ value: x.id, label: x.label }))];
    const r = await formDialog({
      title: 'Datei verschieben', submitLabel: 'Verschieben',
      fields: [{ name: 'folderId', label: 'Zielordner', type: 'select', options, value: f.folderId || '' }],
      onSubmit: (v) => patch(`/dateien/${f.id}`, { folderId: v.folderId || null }),
    });
    if (r) { toast('Verschoben'); load(); }
  }
  async function removeFile(f) {
    if (!await confirmDialog({ title: 'Datei löschen?', text: `„${f.name}“ wird endgültig gelöscht.`, confirmLabel: 'Löschen', danger: true })) return;
    if (await attempt(() => del(`/dateien/${f.id}`), 'Datei gelöscht')) load();
  }

  await load();
}
