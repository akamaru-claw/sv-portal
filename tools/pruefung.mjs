/*
 * Funktionsprüfung — geht einmal durch alles, was das Portal kann.
 *
 * Läuft gegen eine **Wegwerf-Instanz** mit eigenem DATA_DIR, nie gegen die
 * echte Datenbank. Prüft die API so, wie die Oberfläche sie benutzt: mit
 * Sitzungs-Cookie, `X-SV-Request`-Header und passender Herkunft.
 *
 *   node tools/pruefung.mjs [basis-url] [nutzer] [einmal-passwort]
 *
 * Gibt am Ende eine Zeile je Prüfung aus und endet mit Code 1, sobald eine
 * fehlschlägt — damit ein Durchlauf ohne Hinsehen aussagekräftig ist.
 */
const BASIS = process.argv[2] || 'http://127.0.0.1:3450';
const NUTZER = process.argv[3] || 'lehrer';
const EINMAL = process.argv[4];
if (!EINMAL) { console.error('Einmal-Passwort fehlt (Argument 3).'); process.exit(1); }

const NEUES_PW = 'PruefungGeheim!2026';
let kekse = '';
const ergebnisse = [];

function keksAufnehmen(res) {
  const roh = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of roh) {
    const [paar] = c.split(';');
    const name = paar.split('=')[0];
    const rest = kekse.split('; ').filter((k) => k && k.split('=')[0] !== name);
    rest.push(paar);
    kekse = rest.join('; ');
  }
}

async function ruf(pfad, { methode = 'GET', koerper, roh, erwartet = [200, 201] } = {}) {
  const kopf = { 'X-SV-Request': '1', Origin: BASIS };
  if (kekse) kopf.Cookie = kekse;
  let body;
  if (roh) { body = roh; }
  else if (koerper !== undefined) { kopf['Content-Type'] = 'application/json'; body = JSON.stringify(koerper); }
  const res = await fetch(BASIS + pfad, { method: methode, headers: kopf, body, redirect: 'manual' });
  keksAufnehmen(res);
  const typ = res.headers.get('content-type') || '';
  const daten = typ.includes('json') ? await res.json().catch(() => null) : await res.text();
  const okCodes = Array.isArray(erwartet) ? erwartet : [erwartet];
  if (!okCodes.includes(res.status)) {
    const err = new Error(`${methode} ${pfad} → ${res.status} (erwartet ${okCodes.join('/')}): ${JSON.stringify(daten).slice(0, 200)}`);
    err.daten = daten;
    throw err;
  }
  return daten;
}

async function pruefe(name, fn) {
  try {
    const wert = await fn();
    ergebnisse.push(['ok', name]);
    return wert;
  } catch (e) {
    ergebnisse.push(['FEHLER', name + ' — ' + e.message]);
    return null;
  }
}

const heute = new Date();
const inTagen = (n) => new Date(heute.getTime() + n * 864e5).toISOString().slice(0, 16);

(async () => {
  // ── Anmeldung und eigenes Passwort ───────────────────────────────────────
  await pruefe('Anmeldung mit Einmal-Passwort', async () => {
    const d = await ruf('/api/login', { methode: 'POST', koerper: { username: NUTZER, password: EINMAL } });
    if (!d.user) throw new Error('kein Nutzer in der Antwort');
    if (!d.user.mustChangePassword) throw new Error('mustChangePassword sollte gesetzt sein');
  });
  await pruefe('Falsches Passwort wird abgewiesen', () =>
    ruf('/api/login', { methode: 'POST', koerper: { username: NUTZER, password: 'falsch' }, erwartet: 401 }));
  await pruefe('Eigenes Passwort festlegen', () =>
    ruf('/api/passwort', { methode: 'POST', koerper: { current: EINMAL, next: NEUES_PW } }));
  const ich = await pruefe('/me liefert das Konto', async () => {
    const d = await ruf('/api/me');
    if (d.user.role !== 'lehrkraft') throw new Error('Rolle stimmt nicht: ' + d.user.role);
    return d.user;
  });
  await pruefe('Schreiben ohne X-SV-Request wird abgewiesen', async () => {
    const res = await fetch(BASIS + '/api/pinnwand', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: kekse },
      body: JSON.stringify({ title: 'darf nicht durchkommen' }),
    });
    if (res.status !== 403) throw new Error('Status ' + res.status + ' statt 403');
  });

  // ── Übersicht ────────────────────────────────────────────────────────────
  await pruefe('Übersicht lädt', () => ruf('/api/uebersicht'));

  // ── Mitglieder und Einladungen ───────────────────────────────────────────
  await pruefe('Mitgliederliste lädt', () => ruf('/api/mitglieder'));
  const einladung = await pruefe('Einladung für 2 Personen anlegen', async () => {
    const d = await ruf('/api/einladungen', { methode: 'POST', koerper: { role: 'mitglied', uses: 2, days: 1 } });
    if (!d.invite?.code) throw new Error('kein Code');
    return d.invite;
  });
  if (einladung) {
    await pruefe('QR-Code zur Einladung', async () => {
      const svg = await ruf(`/api/einladungen/${einladung.id}/qr.svg`);
      if (!String(svg).includes('<svg')) throw new Error('kein SVG');
    });
    await pruefe('Einladungscode ist öffentlich prüfbar', () => ruf(`/api/einladung/${einladung.code}`));
  }

  // Zweites Konto über die Einladung anlegen — eigener Keks-Topf
  const merk = kekse; kekse = '';
  const schueler = { username: 'mia', password: 'MiaGeheim!2026', displayName: 'Mia B.', klasse: '9a' };
  await pruefe('Registrierung über Einladungscode', () =>
    ruf(`/api/einladung/${einladung?.code}`, { methode: 'POST', koerper: schueler }));
  await pruefe('Zweite Anmeldung als Mitglied', () =>
    ruf('/api/login', { methode: 'POST', koerper: { username: schueler.username, password: schueler.password } }));
  const mitgliedSieht = await pruefe('Mitglied darf keine Einladungen anlegen', () =>
    ruf('/api/einladungen', { methode: 'POST', koerper: { role: 'mitglied', uses: 1, days: 1 }, erwartet: 403 }));
  kekse = merk;

  // ── Termine, Tagesordnung, Protokoll ─────────────────────────────────────
  const termin = await pruefe('Sitzung anlegen', async () => {
    const d = await ruf('/api/termine', { methode: 'POST', koerper: {
      title: 'SV-Sitzung', type: 'sitzung', startsAt: inTagen(3), endsAt: inTagen(3),
      location: 'Raum 101', description: 'Erste Sitzung im Schuljahr',
    } });
    return d.event || d;
  });
  const terminId = termin?.id;
  await pruefe('Terminliste lädt', () => ruf('/api/termine'));
  if (terminId) {
    await pruefe('Termin im Detail', () => ruf(`/api/termine/${terminId}`));
    await pruefe('Zusage geben', () => ruf(`/api/termine/${terminId}/zusage`, { methode: 'PUT', koerper: { status: 'ja' } }));
    const top = await pruefe('Tagesordnungspunkt anlegen', async () => {
      const d = await ruf(`/api/termine/${terminId}/tagesordnung`, { methode: 'POST', koerper: { title: 'Sommerfest', note: 'Termin und Budget' } });
      return d.item || d;
    });
    if (top?.id) {
      await pruefe('Tagesordnungspunkt ändern', () => ruf(`/api/tagesordnung/${top.id}`, { methode: 'PATCH', koerper: { title: 'Sommerfest 2027' } }));
      await pruefe('Tagesordnungspunkt verschieben', () => ruf(`/api/tagesordnung/${top.id}/verschieben`, { methode: 'POST', koerper: { direction: 'down' } }));
    }
    await pruefe('Protokoll speichern', () => ruf(`/api/termine/${terminId}/protokoll`, { methode: 'PUT', koerper: { minutes: 'Beschlossen: Sommerfest am 12. Juni.' } }));
  }

  // ── Projekte, Team, Aufgaben, Kommentare ─────────────────────────────────
  const projekt = await pruefe('Projekt anlegen', async () => {
    const d = await ruf('/api/projekte', { methode: 'POST', koerper: { title: 'Pausenhof begrünen', summary: 'Mehr Schatten und Sitzplätze.' } });
    return d.project || d;
  });
  const pid = projekt?.id;
  await pruefe('Projektliste lädt', () => ruf('/api/projekte'));
  if (pid) {
    await pruefe('Projekt im Detail', () => ruf(`/api/projekte/${pid}`));
    await pruefe('Team beitreten', () => ruf(`/api/projekte/${pid}/team`, { methode: 'PUT', koerper: { join: true } }));
    await pruefe('Projekt unterstützen', () => ruf(`/api/projekte/${pid}/unterstuetzen`, { methode: 'PUT', koerper: { like: true } }));
    await pruefe('Aufgabe anlegen', () =>
      ruf(`/api/projekte/${pid}/aufgaben`, { methode: 'POST', koerper: { title: 'Angebote einholen' } }));
    /* Anlegen liefert nur `{ok:true}` - die IDs stehen im Projektdetail. */
    const detailP = await ruf(`/api/projekte/${pid}`);
    const aufgabe = (detailP.tasks || detailP.project?.tasks || [])[0];
    if (aufgabe?.id) {
      await pruefe('Aufgabe abhaken', () => ruf(`/api/aufgaben/${aufgabe.id}`, { methode: 'PATCH', koerper: { done: true } }));
      await pruefe('Eigene Aufgaben lädt', () => ruf('/api/aufgaben/meine'));
    }
    await pruefe('Kommentar schreiben', () =>
      ruf(`/api/projekte/${pid}/kommentare`, { methode: 'POST', koerper: { body: 'Ich bringe Pflanzen mit.' } }));
    const detailK = await ruf(`/api/projekte/${pid}`);
    const kommentar = (detailK.comments || detailK.project?.comments || [])[0];
    if (kommentar?.id) await pruefe('Kommentar löschen', () => ruf(`/api/kommentare/${kommentar.id}`, { methode: 'DELETE' }));
  }

  // ── Abstimmungen ─────────────────────────────────────────────────────────
  const umfrage = await pruefe('Abstimmung starten', async () => {
    const d = await ruf('/api/abstimmungen', { methode: 'POST', koerper: {
      title: 'Wann soll das Sommerfest sein?', options: ['12. Juni', '19. Juni'],
      anonymous: true, teachersVote: false, closesAt: inTagen(5),
    } });
    return d.poll || d;
  });
  await pruefe('Abstimmungsliste lädt', () => ruf('/api/abstimmungen'));
  if (umfrage?.id) {
    const detail = await pruefe('Abstimmung im Detail', () => ruf(`/api/abstimmungen/${umfrage.id}`));
    const optId = detail?.poll?.options?.[0]?.id ?? detail?.options?.[0]?.id;
    /* teachersVote war aus - die Lehrkraft MUSS hier abgewiesen werden. */
    if (optId) await pruefe('Lehrkraft wird bei Schüler-Abstimmung abgewiesen', () =>
      ruf(`/api/abstimmungen/${umfrage.id}/stimme`, { methode: 'PUT', koerper: { optionIds: [optId] }, erwartet: 403 }));
    /* …und die Schülerin darf. */
    if (optId) {
      const merk2 = kekse; kekse = '';
      await ruf('/api/login', { methode: 'POST', koerper: { username: schueler.username, password: schueler.password } });
      await pruefe('Mitglied gibt Stimme ab', () =>
        ruf(`/api/abstimmungen/${umfrage.id}/stimme`, { methode: 'PUT', koerper: { optionIds: [optId] } }));
      kekse = merk2;
    }
    await pruefe('Abstimmung beenden', () => ruf(`/api/abstimmungen/${umfrage.id}/beenden`, { methode: 'POST' }));
  }

  // ── Pinnwand ─────────────────────────────────────────────────────────────
  const beitrag = await pruefe('Pinnwand-Beitrag schreiben', async () => {
    const d = await ruf('/api/pinnwand', { methode: 'POST', koerper: { title: 'Nächste Sitzung', body: 'Nächste Sitzung in Raum 101.' } });
    return d.post || d;
  });
  await pruefe('Pinnwand lädt', () => ruf('/api/pinnwand'));
  if (beitrag?.id) {
    await pruefe('Beitrag anheften', () => ruf(`/api/pinnwand/${beitrag.id}`, { methode: 'PATCH', koerper: { pinned: true } }));
    await pruefe('Beitrag löschen', () => ruf(`/api/pinnwand/${beitrag.id}`, { methode: 'DELETE' }));
  }

  // ── Dateien ──────────────────────────────────────────────────────────────
  const ordner = await pruefe('Ordner anlegen', async () => {
    const d = await ruf('/api/ordner', { methode: 'POST', koerper: { name: 'Protokolle' } });
    return d.folder || d;
  });
  async function hochladen(name, inhalt, typ) {
    const fd = new FormData();
    fd.append('files', new Blob([inhalt], { type: typ }), name);
    if (ordner?.id) fd.append('folderId', String(ordner.id));
    const res = await fetch(BASIS + '/api/dateien', { method: 'POST', headers: { 'X-SV-Request': '1', Origin: BASIS, Cookie: kekse }, body: fd });
    const d = await res.json().catch(() => null);
    if (![200, 201].includes(res.status)) throw new Error(res.status + ': ' + JSON.stringify(d).slice(0, 160));
    /* Der Upload liefert nur die Anzahl - die ID steht in der Liste. */
    const liste = await ruf('/api/dateien/neueste');
    const alle = liste.files || liste.items || [];
    const treffer = alle.find((f) => f.name === name);
    if (!treffer) throw new Error('Datei taucht nicht in der Liste auf');
    return treffer;
  }
  const datei = await pruefe('Datei hochladen', () => hochladen('protokoll.txt', 'Protokoll der ersten Sitzung', 'text/plain'));
  await pruefe('Dateiliste lädt', () => ruf('/api/dateien'));
  await pruefe('Neueste Dateien lädt', () => ruf('/api/dateien/neueste'));
  if (datei?.id) {
    await pruefe('Datei herunterladen', async () => {
      const res = await fetch(BASIS + `/api/dateien/${datei.id}/download`, { headers: { Cookie: kekse } });
      if (res.status !== 200) throw new Error('Status ' + res.status);
      const cd = res.headers.get('content-disposition') || '';
      if (!/attachment/i.test(cd)) throw new Error('kein Anhang-Header: ' + cd);
    });
    await pruefe('Datei umbenennen', () => ruf(`/api/dateien/${datei.id}`, { methode: 'PATCH', koerper: { name: 'protokoll-1.txt' } }));
  }
  // Der wichtigste Sicherheitstest: HTML darf nie als Seite ausgeliefert werden.
  const htmlDatei = await pruefe('HTML-Datei hochladen', () =>
    hochladen('boese.html', '<script>alert(1)</script>', 'text/html'));
  if (htmlDatei?.id) {
    await pruefe('HTML wird nur als Download geliefert, nie als Seite', async () => {
      const res = await fetch(BASIS + `/api/dateien/${htmlDatei.id}/download`, { headers: { Cookie: kekse } });
      const ct = res.headers.get('content-type') || '';
      const cd = res.headers.get('content-disposition') || '';
      if (/text\/html/i.test(ct)) throw new Error('wird als HTML ausgeliefert: ' + ct);
      if (!/attachment/i.test(cd)) throw new Error('kein Anhang-Header: ' + cd);
    });
  }

  // ── Kasse ────────────────────────────────────────────────────────────────
  const buchung = await pruefe('Buchung anlegen', async () => {
    const d = await ruf('/api/kasse', { methode: 'POST', koerper: { title: 'Kuchenverkauf', amount: '42,50', kind: 'einnahme', date: new Date().toISOString().slice(0, 10) } });
    return d.entry || d;
  });
  await pruefe('Kasse lädt', () => ruf('/api/kasse'));
  if (buchung?.id) {
    await pruefe('Buchung ändern', () => ruf(`/api/kasse/${buchung.id}`, { methode: 'PATCH', koerper: { title: 'Kuchenverkauf (Pause)' } }));
    await pruefe('Buchung löschen', () => ruf(`/api/kasse/${buchung.id}`, { methode: 'DELETE' }));
  }

  // ── Profil und Kalender-Abo ──────────────────────────────────────────────
  await pruefe('Profil ändern', () => ruf('/api/profil', { methode: 'PATCH', koerper: { displayName: 'Frau Test', klasse: '' } }));
  const kal = await pruefe('Kalender-Abo-Link holen', () => ruf('/api/profil/kalender'));
  const token = kal?.token || (kal?.url || '').split('/').pop()?.replace('.ics', '');
  if (token) {
    await pruefe('Kalender-Abo liefert ICS', async () => {
      const res = await fetch(`${BASIS}/kalender/${token}.ics`);
      const txt = await res.text();
      if (res.status !== 200) throw new Error('Status ' + res.status);
      if (!txt.startsWith('BEGIN:VCALENDAR')) throw new Error('kein ICS: ' + txt.slice(0, 60));
    });
  }
  await pruefe('Kalender-Abo neu erzeugen', () => ruf('/api/profil/kalender/neu', { methode: 'POST' }));

  // ── Abmelden ─────────────────────────────────────────────────────────────
  await pruefe('Abmelden', () => ruf('/api/logout', { methode: 'POST' }));
  await pruefe('Danach kein Zugriff mehr', () => ruf('/api/uebersicht', { erwartet: 401 }));

  // ── Ausgabe ──────────────────────────────────────────────────────────────
  const fehler = ergebnisse.filter(([s]) => s !== 'ok');
  for (const [s, n] of ergebnisse) console.log((s === 'ok' ? '  ok   ' : '  FEHL ') + n);
  console.log(`\n${ergebnisse.length - fehler.length} von ${ergebnisse.length} Prüfungen bestanden.`);
  process.exit(fehler.length ? 1 : 0);
})();
