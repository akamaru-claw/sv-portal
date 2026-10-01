import { html, $, get, post, ROLE_LABEL } from '../lib.js';

function frame(root, inner) {
  root.innerHTML = String(html`
    <main class="auth">
      <div class="auth-card">
        <img class="auth-logo" src="/img/logo.png" alt="Mauritius-Gymnasium" width="900" height="619">
        <div class="auth-box">${inner}</div>
      </div>
    </main>`);
}

function bindForm(root, handler) {
  const form = $('form', root);
  const err = $('.form-error', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await handler(Object.fromEntries(new FormData(form)));
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });
  setTimeout(() => $('input', form)?.focus(), 20);
}

export async function login({ root, site, onDone, setTitle }) {
  setTitle('Anmelden');
  frame(root, html`
    <h1>${site.name}</h1>
    <p>Hier plant die SV ihre Sitzungen, Projekte und Abstimmungen.</p>
    <form novalidate>
      <div class="form-error" role="alert"></div>
      <label class="field"><span>Nutzername</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Passwort</span><input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="btn btn-primary btn-block">Anmelden</button>
    </form>
    <div class="auth-help">
      <p><strong>Noch kein Konto?</strong> Konten gibt es nur mit einem Einladungscode von euren SV-Lehrkräften. <a href="/einladung">Code eingeben</a></p>
      <p><strong>Passwort vergessen?</strong> Sag einer SV-Lehrkraft Bescheid. Sie setzt es zurück und gibt dir ein Einmal-Passwort.</p>
    </div>`);
  bindForm(root, async (v) => {
    if (!v.username.trim() || !v.password) throw new Error('Bitte gib Nutzername und Passwort ein.');
    await post('/login', { username: v.username.trim(), password: v.password });
    await onDone();
  });
}

export async function forcePassword({ root, user, onDone, setTitle }) {
  setTitle('Eigenes Passwort festlegen');
  frame(root, html`
    <h1>Eigenes Passwort festlegen</h1>
    <p>Du hast dich mit einem Einmal-Passwort angemeldet${user?.displayName ? html`, ${user.displayName}` : ''}. Leg jetzt ein Passwort fest, das nur du kennst.</p>
    <form novalidate>
      <div class="form-error" role="alert"></div>
      <label class="field"><span>Einmal-Passwort</span><input name="current" type="password" autocomplete="current-password" required></label>
      <label class="field"><span>Neues Passwort</span><input name="next" type="password" autocomplete="new-password" minlength="8" required><small>Mindestens 8 Zeichen.</small></label>
      <label class="field"><span>Neues Passwort wiederholen</span><input name="repeat" type="password" autocomplete="new-password" required></label>
      <button type="submit" class="btn btn-primary btn-block">Passwort speichern</button>
    </form>
    <div class="auth-help"><p><button type="button" class="btn btn-ghost btn-s" data-logout>Abmelden</button></p></div>`);
  bindForm(root, async (v) => {
    if (v.next.length < 8) throw new Error('Das neue Passwort braucht mindestens 8 Zeichen.');
    if (v.next !== v.repeat) throw new Error('Die beiden neuen Passwörter stimmen nicht überein.');
    await post('/passwort', { current: v.current, next: v.next });
    await onDone();
  });
}

export async function invite({ root, params, user, onDone, setTitle }) {
  setTitle('Einladung');
  const code = (params.code || '').toUpperCase();

  if (user) {
    frame(root, html`<h1>Du bist schon angemeldet</h1>
      <p>Du bist als ${user.displayName} angemeldet. Eine Einladung brauchst du nur für ein neues Konto.</p>
      <a class="btn btn-primary btn-block" href="/" data-home>Zur Übersicht</a>`);
    $('[data-home]', root).addEventListener('click', (e) => { e.preventDefault(); history.replaceState(null, '', '/'); onDone(); });
    return;
  }

  if (!code) {
    frame(root, html`<h1>Einladung einlösen</h1>
      <p>Gib den Code ein, den du von einer SV-Lehrkraft bekommen hast.</p>
      <form novalidate>
        <div class="form-error" role="alert"></div>
        <label class="field"><span>Einladungscode</span><input name="code" placeholder="ABCD-EFGH" autocapitalize="characters" autocomplete="off" spellcheck="false" required></label>
        <button type="submit" class="btn btn-primary btn-block">Weiter</button>
      </form>
      <div class="auth-help"><p><a href="/">Zurück zur Anmeldung</a></p></div>`);
    bindForm(root, async (v) => {
      let c = v.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (c.length !== 8) throw new Error('Der Code hat 8 Zeichen, zum Beispiel ABCD-EFGH.');
      c = `${c.slice(0, 4)}-${c.slice(4)}`;
      history.pushState(null, '', `/einladung/${c}`);
      await invite({ root, params: { code: c }, user, onDone, setTitle });
    });
    return;
  }

  const check = await get(`/einladung/${encodeURIComponent(code)}`);
  if (!check.valid) {
    frame(root, html`<h1>Einladung ungültig</h1><p>${check.error}</p>
      <p><a href="/einladung" data-again>Anderen Code eingeben</a></p><div class="auth-help"><p><a href="/">Zur Anmeldung</a></p></div>`);
    $('[data-again]', root).addEventListener('click', (e) => { e.preventDefault(); history.pushState(null, '', '/einladung'); invite({ root, params: {}, user, onDone, setTitle }); });
    return;
  }

  frame(root, html`
    <h1>Willkommen im SV-Portal</h1>
    <p>Du wurdest als <strong>${ROLE_LABEL[check.role]}</strong> eingeladen. Leg dir hier dein Konto an. Eine E-Mail-Adresse brauchst du nicht.</p>
    <form novalidate>
      <div class="form-error" role="alert"></div>
      <div class="field-row">
        <label class="field"><span>Dein Name</span><input name="displayName" value="${check.displayName}" maxlength="60" autocomplete="name" required><small>So sehen dich die anderen, z. B. „Mia S.“</small></label>
        <label class="field"><span>Klasse oder Stufe</span><input name="klasse" maxlength="20" placeholder="z. B. 9b oder Q1"></label>
      </div>
      <label class="field"><span>Nutzername</span><input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="24" required>
        <small>3 bis 24 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich. Damit meldest du dich an.</small></label>
      <label class="field"><span>Passwort</span><input name="password" type="password" autocomplete="new-password" minlength="8" required><small>Mindestens 8 Zeichen.</small></label>
      <label class="field"><span>Passwort wiederholen</span><input name="repeat" type="password" autocomplete="new-password" required></label>
      <button type="submit" class="btn btn-primary btn-block">Konto anlegen</button>
    </form>
    <div class="auth-help"><p>Merk dir Nutzername und Passwort gut. Wenn du das Passwort vergisst, setzt eine SV-Lehrkraft es zurück.</p></div>`);
  bindForm(root, async (v) => {
    if (!v.displayName.trim()) throw new Error('Bitte gib deinen Namen an.');
    if (v.password.length < 8) throw new Error('Das Passwort braucht mindestens 8 Zeichen.');
    if (v.password !== v.repeat) throw new Error('Die beiden Passwörter stimmen nicht überein.');
    await post(`/einladung/${encodeURIComponent(code)}`, { displayName: v.displayName, klasse: v.klasse, username: v.username.trim(), password: v.password });
    history.replaceState(null, '', '/');
    await onDone();
  });
}
