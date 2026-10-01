#!/usr/bin/env node
/* Verwaltung über die Kommandozeile, z. B.:
 *   node src/cli.js lehrkraft-anlegen mueller "Herr Müller"
 *   node src/cli.js passwort-zuruecksetzen mueller
 *   node src/cli.js konten
 *   node src/cli.js sicherung
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { USERNAME_RE } = require('./routes/account');

const [cmd, username, displayName] = process.argv.slice(2);

function out(lines) { console.log(lines.join('\n')); }

switch (cmd) {
  case 'lehrkraft-anlegen': {
    if (!username || !USERNAME_RE.test(username)) {
      out(['Aufruf: node src/cli.js lehrkraft-anlegen <nutzername> "<Anzeigename>"',
        'Nutzername: 3–24 Zeichen, Buchstaben, Ziffern, Punkt, Unterstrich, Bindestrich.']);
      process.exit(1);
    }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
      out([`Den Nutzernamen „${username}“ gibt es schon.`]);
      process.exit(1);
    }
    const temp = auth.tempPassword();
    db.prepare(`INSERT INTO users (username, display_name, password_hash, role, must_change_pw, calendar_token)
      VALUES (?, ?, ?, 'lehrkraft', 1, ?)`).run(username, displayName || username, auth.hashPassword(temp), auth.randomToken(24));
    out(['Lehrkraft angelegt.', `  Nutzername:        ${username}`, `  Einmal-Passwort:   ${temp}`,
      'Beim ersten Anmelden wird ein eigenes Passwort festgelegt.']);
    break;
  }
  case 'passwort-zuruecksetzen': {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
    if (!u) { out([`Kein Konto „${username}“ gefunden.`]); process.exit(1); }
    const temp = auth.tempPassword();
    db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1, active = 1 WHERE id = ?').run(auth.hashPassword(temp), u.id);
    auth.destroyAllSessions(u.id);
    out([`Passwort für „${u.username}“ zurückgesetzt.`, `  Einmal-Passwort:   ${temp}`]);
    break;
  }
  case 'konten': {
    const rows = db.prepare('SELECT username, display_name, role, active FROM users ORDER BY role, username').all();
    out(rows.length ? rows.map((r) => `${r.active ? ' ' : 'x'} ${r.role.padEnd(10)} ${r.username.padEnd(24)} ${r.display_name}`) : ['Noch keine Konten.']);
    break;
  }
  case 'sicherung': {
    // Konsistente Kopie der Datenbank auch im laufenden Betrieb
    const dir = path.join(config.DATA_DIR, 'sicherungen');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `sv-portal-${new Date().toISOString().slice(0, 10)}.db`);
    db.backup(file).then(() => out([`Datenbank gesichert: ${file}`, 'Hochgeladene Dateien liegen in: ' + config.FILES_DIR]))
      .catch((e) => { out([`Sicherung fehlgeschlagen: ${e.message}`]); process.exit(1); });
    break;
  }
  default:
    out(['Befehle:',
      '  lehrkraft-anlegen <nutzername> "<Anzeigename>"   Lehrkraft-Konto anlegen (Einmal-Passwort)',
      '  passwort-zuruecksetzen <nutzername>             Notfall-Reset, z. B. wenn beide Lehrkräfte ausgesperrt sind',
      '  konten                                          Alle Konten auflisten',
      '  sicherung                                       Datenbank nach DATA_DIR/sicherungen kopieren']);
}
