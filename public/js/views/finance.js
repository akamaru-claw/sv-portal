import { html, $, get, post, patch, del, icon, attempt, formDialog, confirmDialog, menuButton, euro, fmtShort, today } from '../lib.js';

async function entryDialog(existing, categories) {
  const { projects } = await get('/projekte');
  const e = existing || {};
  return formDialog({
    title: existing ? 'Buchung bearbeiten' : 'Neue Buchung',
    submitLabel: existing ? 'Speichern' : 'Buchen',
    fields: [
      { row: [
        { name: 'kind', label: 'Art', type: 'select', options: [{ value: 'einnahme', label: 'Einnahme' }, { value: 'ausgabe', label: 'Ausgabe' }], value: e.amountCents < 0 ? 'ausgabe' : 'einnahme' },
        { name: 'amount', label: 'Betrag in Euro', inputmode: 'decimal', required: true, value: e.amountCents ? (Math.abs(e.amountCents) / 100).toFixed(2).replace('.', ',') : '', placeholder: '12,50' },
      ] },
      { name: 'title', label: 'Wofür?', required: true, maxlength: 160, value: e.title || '', placeholder: 'z. B. Einkauf Schoko-Nikoläuse' },
      { row: [
        { name: 'date', label: 'Datum', type: 'date', value: e.date || today() },
        { name: 'category', label: 'Kategorie', maxlength: 60, value: e.category || '', placeholder: categories[0] || 'z. B. Einkauf, Verkauf, Spende' },
      ] },
      { name: 'projectId', label: 'Projekt', type: 'select', value: e.projectId || '', options: [{ value: '', label: 'Kein Projekt' }, ...projects.map((p) => ({ value: p.id, label: p.title }))] },
    ],
    onSubmit: (v) => {
      const body = { ...v, projectId: v.projectId || null };
      return existing ? patch(`/kasse/${existing.id}`, body) : post('/kasse', body);
    },
  });
}

export async function render(ctx) {
  const { main } = ctx;
  ctx.setTitle('Kasse');

  const load = async () => {
    const d = await get('/kasse');
    if (!ctx.isCurrent()) return;
    main.innerHTML = String(html`
      <div class="page">
        <div class="page-head">
          <div><h1>SV-Kasse</h1><p>Einnahmen und Ausgaben der SV, für alle einsehbar. Buchen können der SV-Vorstand und die Lehrkräfte.</p></div>
          ${d.canEdit ? html`<div class="page-actions"><button type="button" class="btn btn-primary" data-new>${icon('plus')}Neue Buchung</button></div>` : ''}
        </div>
        <section class="panel">
          <div class="money-sum">
            <div><small>Kassenstand</small><b class="${d.totals.balance < 0 ? 'minus' : ''}">${euro(d.totals.balance)}</b></div>
            <div><small>Einnahmen gesamt</small><b class="plus">${euro(d.totals.income)}</b></div>
            <div><small>Ausgaben gesamt</small><b class="minus">${euro(d.totals.expense)}</b></div>
          </div>
        </section>
        <div class="cols">
          <section class="panel">
            <div class="panel-head"><h2>Buchungen</h2></div>
            ${d.entries.length ? html`<div class="table-wrap"><table class="tbl">
              <thead><tr><th>Datum</th><th>Wofür</th><th class="num">Betrag</th>${d.canEdit ? html`<th><span class="sr">Aktionen</span></th>` : ''}</tr></thead>
              <tbody>${d.entries.map((e) => html`<tr>
                <td class="nowrap">${fmtShort(e.date)}</td>
                <td><div>${e.title}</div><div class="small muted">${[e.category, e.projectTitle].filter(Boolean).join(', ')}${e.createdByName ? ` (gebucht von ${e.createdByName})` : ''}</div></td>
                <td class="num ${e.amountCents < 0 ? 'minus' : 'plus'}">${e.amountCents > 0 ? '+' : ''}${euro(e.amountCents)}</td>
                ${d.canEdit ? html`<td>${menuButton([
                  { label: 'Bearbeiten', icon: 'edit', onClick: () => edit(e, d.categories) },
                  { label: 'Löschen', icon: 'trash', danger: true, onClick: () => remove(e) },
                ])}</td>` : ''}
              </tr>`)}</tbody></table></div>`
            : html`<div class="empty"><strong>Noch keine Buchungen.</strong>${d.canEdit ? 'Tragt zuerst den Anfangsbestand der SV-Kasse als Einnahme ein.' : ''}</div>`}
          </section>
          <section class="panel">
            <div class="panel-head"><h2>Nach Projekt</h2></div>
            ${d.byProject.length ? html`<table class="tbl"><tbody>${d.byProject.map((p) => html`<tr>
              <td><a href="/projekte/${p.id}">${p.title}</a></td><td class="num ${p.sum < 0 ? 'minus' : 'plus'}">${euro(p.sum)}</td></tr>`)}</tbody></table>`
            : html`<div class="empty">Ordnet Buchungen einem Projekt zu, dann seht ihr hier, was eine Aktion eingebracht oder gekostet hat.</div>`}
          </section>
        </div>
      </div>`);
    $('[data-new]', main)?.addEventListener('click', async () => { if (await entryDialog(null, d.categories)) load(); });
  };

  async function edit(e, cats) { if (await entryDialog(e, cats)) load(); }
  async function remove(e) {
    if (!await confirmDialog({ title: 'Buchung löschen?', text: `„${e.title}“ über ${euro(e.amountCents)} wird gelöscht.`, confirmLabel: 'Löschen', danger: true })) return;
    if (await attempt(() => del(`/kasse/${e.id}`), 'Buchung gelöscht')) load();
  }
  await load();
}
