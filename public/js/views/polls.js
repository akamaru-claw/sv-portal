import {
  html, $, $$, get, post, put, del, icon, md, attempt, toast, formDialog, confirmDialog, menuButton,
  fmtDate, relDay, ago, plural, nowLocal,
} from '../lib.js';

function closesText(p) {
  if (!p.open) return 'beendet';
  if (!p.closesAt) return 'läuft ohne Enddatum';
  return `endet ${relDay(p.closesAt) || fmtDate(p.closesAt)} um ${p.closesAt.slice(11)} Uhr`;
}

export async function newPollDialog(ctx, preset = {}) {
  const { events } = await get(`/termine?von=${nowLocal().slice(0, 10)}`);
  const meetings = events.filter((e) => e.type === 'sitzung');
  const optionsHtml = html`<div class="field"><span>Antwortmöglichkeiten</span>
    <div class="options-edit" data-options>
      ${['', '', ''].map((v, i) => html`<div class="opt-row"><input type="text" name="opt" maxlength="200" placeholder="Antwort ${i + 1}" value="${v}" aria-label="Antwort ${i + 1}">
        <button type="button" class="btn btn-ghost btn-icon" data-rm-opt aria-label="Antwort entfernen">${icon('x', 'icon-s')}</button></div>`)}
    </div>
    <button type="button" class="btn btn-s" data-add-opt style="margin-top:8px">${icon('plus', 'icon-s')}Weitere Antwort</button>
    <small>Leere Felder werden ignoriert.</small></div>`;

  return formDialog({
    title: 'Neue Abstimmung',
    submitLabel: 'Abstimmung starten',
    wide: true,
    fields: [
      { name: 'title', label: 'Frage', required: true, maxlength: 200, placeholder: 'z. B. Welches Motto hat die Mottowoche?' },
      { name: 'description', label: 'Erklärung (optional)', type: 'textarea', rows: 3, max: 4000 },
      { name: 'opts', type: 'html', html: optionsHtml },
      { name: 'multi', label: 'Mehrere Antworten erlauben', type: 'checkbox' },
      { name: 'maxChoices', label: 'Höchstens so viele Antworten', type: 'number', min: 1, value: 2, hint: 'Nur bei mehreren Antworten' },
      { name: 'anonymous', label: 'Anonym abstimmen', type: 'checkbox', hint: 'Niemand sieht, wer was gewählt hat. Die Stimme kann danach nicht mehr geändert werden.' },
      { name: 'resultsAfterClose', label: 'Ergebnis erst nach dem Ende zeigen', type: 'checkbox', hint: 'Verhindert, dass Zwischenstände die Abstimmung beeinflussen.' },
      { name: 'teachersVote', label: 'Lehrkräfte stimmen mit ab', type: 'checkbox', hint: 'Sinnvoll z. B. bei Terminfragen. Sonst stimmen nur Schülerinnen und Schüler ab.' },
      { row: [
        { name: 'closesAt', label: 'Ende (optional)', type: 'datetime-local', hint: 'Ohne Ende läuft sie, bis jemand sie beendet.' },
        { name: 'eventId', label: 'Gehört zu Sitzung', type: 'select', value: preset.eventId || '', options: [{ value: '', label: 'Keine' }, ...meetings.map((m) => ({ value: m.id, label: `${fmtDate(m.startsAt)}: ${m.title}` })), ...(preset.eventId && !meetings.some((m) => m.id === preset.eventId) ? [{ value: preset.eventId, label: 'Diese Sitzung' }] : [])] },
      ] },
    ],
    onMount: (dlg) => {
      const box = $('[data-options]', dlg);
      const form = $('form', dlg);
      const sync = () => { $('[data-field=maxChoices]', dlg).hidden = !form.elements.multi.checked; };
      form.elements.multi.addEventListener('change', sync);
      sync();
      $('[data-add-opt]', dlg).addEventListener('click', () => {
        const n = $$('input', box).length + 1;
        const row = document.createElement('div');
        row.className = 'opt-row';
        row.innerHTML = String(html`<input type="text" name="opt" maxlength="200" placeholder="Antwort ${n}" aria-label="Antwort ${n}">
          <button type="button" class="btn btn-ghost btn-icon" data-rm-opt aria-label="Antwort entfernen">${icon('x', 'icon-s')}</button>`);
        box.append(row);
        row.querySelector('input').focus();
      });
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-rm-opt]');
        if (b && $$('.opt-row', box).length > 2) b.closest('.opt-row').remove();
      });
    },
    onSubmit: async (v, form) => {
      const options = $$('input[name=opt]', form).map((i) => i.value.trim()).filter(Boolean);
      if (options.length < 2) throw new Error('Gib mindestens zwei Antwortmöglichkeiten ein.');
      const r = await post('/abstimmungen', {
        title: v.title, description: v.description, options,
        multi: v.multi, maxChoices: Number(v.maxChoices) || options.length,
        anonymous: v.anonymous, resultsAfterClose: v.resultsAfterClose, teachersVote: v.teachersVote,
        closesAt: v.closesAt || null, eventId: v.eventId || null,
      });
      toast('Abstimmung gestartet');
      return r.id;
    },
  });
}

export async function list(ctx) {
  const { main, user } = ctx;
  ctx.setTitle('Abstimmungen');
  const { polls } = await get('/abstimmungen');
  if (!ctx.isCurrent()) return;
  const open = polls.filter((p) => p.open);
  const closed = polls.filter((p) => !p.open);
  const board = user.role !== 'mitglied';

  const row = (p) => html`<li><a class="row" href="/abstimmungen/${p.id}">
    <span class="ficon">${icon('vote')}</span>
    <span class="row-main"><span class="row-title">${p.title}</span>
      <span class="row-sub"><span>${closesText(p)}</span><span>${p.ballots} von ${p.eligible} abgestimmt</span>
      ${p.anonymous ? html`<span>${icon('lock', 'icon-s')}anonym</span>` : ''}${p.eventTitle ? html`<span>${icon('calendar', 'icon-s')}${p.eventTitle}</span>` : ''}</span></span>
    <span class="row-end">${p.open && p.mayVote && !p.voted ? html`<span class="tag tag-marker">Deine Stimme fehlt</span>` : p.voted ? html`<span class="tag tag-gruen">${icon('check', 'icon-s')}abgestimmt</span>` : ''}</span>
  </a></li>`;

  main.innerHTML = String(html`
    <div class="page page-narrow">
      <div class="page-head">
        <div><h1>Abstimmungen</h1><p>Entscheidungen, die nicht bis zur nächsten Sitzung warten müssen.</p></div>
        ${board ? html`<div class="page-actions"><button type="button" class="btn btn-primary" data-new>${icon('plus')}Neue Abstimmung</button></div>` : ''}
      </div>
      <section class="panel">
        <div class="panel-head"><h2>Laufen gerade</h2></div>
        ${open.length ? html`<ul class="rows">${open.map(row)}</ul>` : html`<div class="empty">Gerade läuft keine Abstimmung.${board ? '' : ' Wenn etwas entschieden werden muss, startet der SV-Vorstand hier eine.'}</div>`}
      </section>
      ${closed.length ? html`<section class="panel"><div class="panel-head"><h2>Beendet</h2></div><ul class="rows">${closed.map(row)}</ul></section>` : ''}
    </div>`);

  $('[data-new]', main)?.addEventListener('click', async () => {
    const id = await newPollDialog(ctx);
    if (id) ctx.go(`/abstimmungen/${id}`);
  });
}

export async function detail(ctx) {
  const { main } = ctx;
  let changing = false;

  const load = async () => {
    const { poll: p } = await get(`/abstimmungen/${ctx.params.id}`);
    if (!ctx.isCurrent()) return;
    ctx.setTitle(p.title);
    const canVote = p.open && p.mayVote && (!p.voted || (!p.anonymous && changing));
    const total = p.results ? p.results.reduce((s, r) => s + r.votes, 0) : 0;
    const max = p.results ? Math.max(0, ...p.results.map((r) => r.votes)) : 0;
    const labelOf = (id) => p.options.find((o) => o.id === id)?.label;

    let votePanel = '';
    if (canVote) {
      votePanel = html`<form data-vote>
        <p class="muted small">${p.multi ? `Du kannst bis zu ${p.maxChoices} Antworten wählen.` : 'Wähle eine Antwort.'}${p.anonymous ? ' Die Abstimmung ist anonym, deine Stimme lässt sich danach nicht mehr ändern.' : ''}</p>
        <div class="opts" role="${p.multi ? 'group' : 'radiogroup'}" aria-label="Antworten">
          ${p.options.map((o) => html`<label class="opt"><input type="${p.multi ? 'checkbox' : 'radio'}" name="choice" value="${o.id}" ${p.myChoices.includes(o.id) ? 'checked' : ''}><span>${o.label}</span></label>`)}
        </div>
        <div class="form-actions" style="justify-content:flex-start">
          <button type="submit" class="btn btn-primary">${p.voted ? 'Stimme ändern' : 'Stimme abgeben'}</button>
          ${changing ? html`<button type="button" class="btn" data-cancel-change>Abbrechen</button>` : ''}
        </div>
      </form>`;
    } else if (p.open && p.voted) {
      votePanel = html`<div class="notice">${icon('check')}<div>Du hast abgestimmt${!p.anonymous && p.myChoices.length ? html`: <strong>${p.myChoices.map(labelOf).join(', ')}</strong>` : ''}.
        ${!p.anonymous ? html` <button type="button" class="btn btn-s" data-change style="margin-left:6px">Stimme ändern</button>` : ''}</div></div>`;
    } else if (p.open && !p.mayVote) {
      votePanel = html`<div class="notice">${icon('info')}<div>Bei dieser Abstimmung stimmen nur Schülerinnen und Schüler ab.</div></div>`;
    }

    main.innerHTML = String(html`
      <div class="page page-narrow">
        <a class="back" href="/abstimmungen">${icon('left', 'icon-s')}Abstimmungen</a>
        <div class="page-head">
          <div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
              <span class="tag ${p.open ? 'tag-marker' : ''}">${p.open ? 'läuft' : 'beendet'}</span>
              ${p.anonymous ? html`<span class="tag">${icon('lock', 'icon-s')}anonym</span>` : html`<span class="tag">namentlich</span>`}
              ${p.multi ? html`<span class="tag">Mehrfachauswahl</span>` : ''}
            </div>
            <h1>${p.title}</h1>
            <p>${closesText(p)}${p.creatorName ? `, gestartet von ${p.creatorName} ${ago(p.createdAt)}` : ''}${p.eventId ? html`, zur <a href="/termine/${p.eventId}">${p.eventTitle}</a>` : ''}</p>
          </div>
          ${p.canManage ? html`<div class="page-actions">
            ${p.open ? html`<button type="button" class="btn" data-close-poll>Abstimmung beenden</button>` : ''}
            ${menuButton([{ label: 'Abstimmung löschen', icon: 'trash', danger: true, onClick: remove }])}
          </div>` : ''}
        </div>

        ${p.description ? html`<section class="panel"><div class="md">${md(p.description)}</div></section>` : ''}
        ${votePanel ? html`<section class="panel">${votePanel}</section>` : ''}

        <section class="panel">
          <div class="panel-head"><h2>Ergebnis</h2><span class="turnout">${p.ballots} von ${p.eligible} haben abgestimmt</span></div>
          ${p.results ? (p.ballots ? html`<div class="results">${p.options.map((o) => {
              const r = p.results.find((x) => x.optionId === o.id);
              const pct = total ? Math.round((r.votes / total) * 100) : 0;
              const cls = ['result', r.votes && r.votes === max ? 'win' : '', p.myChoices.includes(o.id) ? 'mine' : ''].join(' ');
              return html`<div class="${cls}">
                <div class="result-top"><span>${o.label}</span><span>${plural(r.votes, 'Stimme', 'Stimmen')} (${pct} %)</span></div>
                <div class="result-bar"><i style="width:${pct}%"></i></div>
                ${r.voters && r.voters.length ? html`<div class="result-voters">${r.voters.join(', ')}</div>` : ''}
              </div>`;
            })}</div>${p.multi ? html`<p class="small muted" style="margin-top:12px">Prozente beziehen sich auf alle abgegebenen Kreuze.</p>` : ''}`
            : html`<div class="empty">Noch keine Stimmen.</div>`)
          : html`<div class="empty"><strong>Das Ergebnis wird nach dem Ende angezeigt.</strong>${p.closesAt ? `Die Abstimmung ${closesText(p)}.` : 'Der SV-Vorstand beendet die Abstimmung.'}</div>`}
          ${p.participants && p.participants.length && !p.results ? html`<p class="small muted" style="margin-top:12px">Schon abgestimmt: ${p.participants.join(', ')}</p>` : ''}
          ${p.anonymous ? html`<p class="small muted" style="margin-top:12px">${icon('lock', 'icon-s')} Anonym: Gespeichert wird nur, wer teilgenommen hat, nicht was gewählt wurde.</p>` : ''}
        </section>
      </div>`);

    $('[data-vote]', main)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const optionIds = $$('input[name=choice]:checked', e.target).map((i) => Number(i.value));
      if (!optionIds.length) return toast('Wähle mindestens eine Antwort aus.', true);
      if (p.multi && optionIds.length > p.maxChoices) return toast(`Du kannst höchstens ${p.maxChoices} Antworten wählen.`, true);
      if (p.anonymous && !await confirmDialog({ title: 'Stimme abgeben?', text: `Deine Wahl: ${optionIds.map(labelOf).join(', ')}. Anonyme Stimmen lassen sich nicht mehr ändern.`, confirmLabel: 'Stimme abgeben' })) return;
      if (await attempt(() => put(`/abstimmungen/${p.id}/stimme`, { optionIds }), 'Deine Stimme ist gespeichert')) { changing = false; load(); }
    });
    $('[data-change]', main)?.addEventListener('click', () => { changing = true; load(); });
    $('[data-cancel-change]', main)?.addEventListener('click', () => { changing = false; load(); });
    $('[data-close-poll]', main)?.addEventListener('click', async () => {
      if (!await confirmDialog({ title: 'Abstimmung beenden?', text: 'Danach kann niemand mehr abstimmen und das Ergebnis ist für alle sichtbar.', confirmLabel: 'Beenden' })) return;
      if (await attempt(() => post(`/abstimmungen/${p.id}/beenden`), 'Abstimmung beendet')) load();
    });

    async function remove() {
      if (!await confirmDialog({ title: 'Abstimmung löschen?', text: 'Die Abstimmung und alle Stimmen werden gelöscht.', confirmLabel: 'Löschen', danger: true })) return;
      if (await attempt(() => del(`/abstimmungen/${p.id}`), 'Abstimmung gelöscht')) ctx.go('/abstimmungen');
    }
  };
  await load();
}
