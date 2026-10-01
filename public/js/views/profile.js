import { html, $, get, post, patch, icon, avatar, attempt, toast, confirmDialog, copyText, ROLE_LABEL } from '../lib.js';

export async function render(ctx) {
  const { main, user, site } = ctx;
  ctx.setTitle('Mein Profil');
  const cal = site.calendarFeed ? await get('/profil/kalender') : { url: null };
  if (!ctx.isCurrent()) return;

  main.innerHTML = String(html`
    <div class="page page-narrow">
      <div class="page-head">
        <div style="display:flex;gap:14px;align-items:center">${avatar(user.displayName)}<div><h1>${user.displayName}</h1>
          <p style="margin:2px 0 0">@${user.username}, ${user.amt || ROLE_LABEL[user.role]}</p></div></div>
      </div>

      <section class="panel">
        <div class="panel-head"><h2>Angaben</h2></div>
        <form data-profile novalidate>
          <div class="form-error" role="alert"></div>
          <div class="field-row">
            <label class="field"><span>Name</span><input name="displayName" value="${user.displayName}" maxlength="60" required></label>
            <label class="field"><span>Klasse oder Stufe</span><input name="klasse" value="${user.klasse}" maxlength="20"></label>
          </div>
          <p class="small muted">Rolle und Amt in der SV legen die SV-Lehrkräfte fest.</p>
          <div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn btn-primary">Speichern</button></div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Passwort ändern</h2></div>
        <form data-password novalidate>
          <div class="form-error" role="alert"></div>
          <input type="text" name="username" value="${user.username}" autocomplete="username" hidden>
          <label class="field"><span>Aktuelles Passwort</span><input type="password" name="current" autocomplete="current-password" required></label>
          <div class="field-row">
            <label class="field"><span>Neues Passwort</span><input type="password" name="next" autocomplete="new-password" minlength="8" required><small>Mindestens 8 Zeichen.</small></label>
            <label class="field"><span>Wiederholen</span><input type="password" name="repeat" autocomplete="new-password" required></label>
          </div>
          <p class="small muted">Danach wirst du auf allen anderen Geräten abgemeldet.</p>
          <div class="form-actions" style="justify-content:flex-start"><button type="submit" class="btn btn-primary">Passwort ändern</button></div>
        </form>
      </section>

      ${cal.url ? html`
        <section class="panel" id="kalender">
          <div class="panel-head"><h2>Termine im eigenen Kalender</h2></div>
          <p>Abonniere diesen Link in deiner Kalender-App (iPhone: Einstellungen, Kalender, Accounts, Kalenderabo hinzufügen; Google Kalender am PC: Weitere Kalender, Per URL). Neue SV-Termine erscheinen dann automatisch.</p>
          <div class="copy-row"><input type="text" value="${cal.url}" readonly aria-label="Kalender-Link" data-cal-url>
            <button type="button" class="btn" data-copy-cal>${icon('copy', 'icon-s')}Kopieren</button></div>
          <p class="small muted" style="margin-top:10px">Der Link ist persönlich. Wer ihn hat, sieht die Termine der SV. Falls er in falsche Hände geraten ist: <button type="button" class="btn btn-s" data-new-cal>Neuen Link erzeugen</button></p>
        </section>` : ''}

      <section class="panel">
        <div class="panel-head"><h2>Abmelden</h2></div>
        <p class="muted">Auf fremden oder geteilten Geräten solltest du dich immer abmelden.</p>
        <button type="button" class="btn" data-logout>${icon('logout')}Abmelden</button>
      </section>
    </div>`);

  if (location.hash === '#kalender') $('#kalender', main)?.scrollIntoView();

  const bind = (sel, handler) => {
    const form = $(sel, main);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      err.textContent = '';
      const btn = $('button[type=submit]', form);
      btn.disabled = true;
      try { await handler(Object.fromEntries(new FormData(form)), form); } catch (ex) { err.textContent = ex.message; } finally { btn.disabled = false; }
    });
  };

  bind('[data-profile]', async (v) => {
    if (!v.displayName.trim()) throw new Error('Der Name darf nicht leer sein.');
    await patch('/profil', v);
    toast('Gespeichert');
    ctx.refreshUser();
  });
  bind('[data-password]', async (v, form) => {
    if (v.next.length < 8) throw new Error('Das neue Passwort braucht mindestens 8 Zeichen.');
    if (v.next !== v.repeat) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
    await post('/passwort', { current: v.current, next: v.next });
    form.reset();
    toast('Passwort geändert');
  });
  $('[data-copy-cal]', main)?.addEventListener('click', () => copyText($('[data-cal-url]', main).value));
  $('[data-new-cal]', main)?.addEventListener('click', async () => {
    if (!await confirmDialog({ title: 'Neuen Kalender-Link erzeugen?', text: 'Der alte Link funktioniert danach nicht mehr. Du musst den neuen Link in deiner Kalender-App eintragen.', confirmLabel: 'Neuen Link erzeugen' })) return;
    const r = await attempt(() => post('/profil/kalender/neu'));
    if (r) { $('[data-cal-url]', main).value = r.url; toast('Neuer Link erzeugt'); }
  });
}
