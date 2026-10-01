const express = require('express');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const { fail, str, requireStr, utc } = require('../util');

const router = express.Router();

const USERNAME_RE = /^[\p{L}\p{N}._-]{3,24}$/u;
const MIN_PW = 8;

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PW) fail(400, `Das Passwort braucht mindestens ${MIN_PW} Zeichen.`);
  if (pw.length > 200) fail(400, 'Das Passwort ist zu lang.');
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    amt: u.amt,
    klasse: u.klasse,
    mustChangePassword: !!u.must_change_pw,
  };
}

const clientIp = (req) => req.ip || 'unbekannt';

// Wer bin ich? Liefert auch Seiteneinstellungen für die Oberfläche.
router.get('/me', (req, res) => {
  res.json({
    user: req.user ? publicUser(req.user) : null,
    site: {
      name: config.SITE_NAME,
      school: config.SCHOOL_NAME,
      maxUploadMb: config.MAX_UPLOAD_MB,
      calendarFeed: config.CALENDAR_FEED,
    },
  });
});

router.post('/login', (req, res) => {
  const username = str(req.body.username, 40);
  const password = String(req.body.password ?? '');
  const ipKey = `ip:${clientIp(req)}`;
  const userKey = `user:${username.toLowerCase()}`;
  if (auth.tooManyAttempts(ipKey, 30) || auth.tooManyAttempts(userKey, 8)) {
    fail(429, 'Zu viele Fehlversuche. Warte 15 Minuten oder lass dein Passwort von einer Lehrkraft zurücksetzen.');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    auth.recordFailure(ipKey);
    auth.recordFailure(userKey);
    fail(401, 'Nutzername oder Passwort stimmt nicht.');
  }
  if (!user.active) fail(403, 'Dieses Konto ist deaktiviert. Wende dich an eine SV-Lehrkraft.');
  auth.clearFailures(userKey);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  auth.createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req, res);
  res.json({ ok: true });
});

// Eigenes Passwort ändern (auch das Pflicht-Ändern nach einem Zurücksetzen)
router.post('/passwort', (req, res) => {
  if (!req.user) fail(401, 'Bitte melde dich an.');
  const current = String(req.body.current ?? '');
  const next = req.body.next;
  if (!auth.verifyPassword(current, req.user.password_hash)) fail(400, 'Das aktuelle Passwort stimmt nicht.');
  checkPassword(next);
  if (next === current) fail(400, 'Das neue Passwort muss sich vom alten unterscheiden.');
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 0 WHERE id = ?').run(auth.hashPassword(next), req.user.id);
  // Alle anderen Geräte abmelden, dieses Gerät neu anmelden
  auth.destroyAllSessions(req.user.id);
  auth.createSession(res, req.user.id);
  res.json({ ok: true });
});

// ---------- Einladung einlösen ----------

const findInvite = db.prepare('SELECT * FROM invites WHERE code = ?');

function validInvite(code) {
  const inv = findInvite.get(String(code || '').toUpperCase().trim());
  if (!inv || inv.revoked) return { error: 'Diesen Einladungscode gibt es nicht oder er wurde zurückgezogen.' };
  if (inv.uses >= inv.max_uses) return { error: 'Dieser Einladungscode wurde schon vollständig benutzt.' };
  if (new Date(utc(inv.expires_at)) < new Date()) return { error: 'Dieser Einladungscode ist abgelaufen. Frag eine SV-Lehrkraft nach einem neuen.' };
  return { inv };
}

router.get('/einladung/:code', (req, res) => {
  if (auth.tooManyAttempts(`inv:${clientIp(req)}`, 20)) fail(429, 'Zu viele Versuche. Warte 15 Minuten.');
  const { inv, error } = validInvite(req.params.code);
  if (error) {
    auth.recordFailure(`inv:${clientIp(req)}`);
    return res.json({ valid: false, error });
  }
  res.json({ valid: true, role: inv.role, displayName: inv.display_name });
});

router.post('/einladung/:code', (req, res) => {
  if (auth.tooManyAttempts(`inv:${clientIp(req)}`, 20)) fail(429, 'Zu viele Versuche. Warte 15 Minuten.');
  const { inv, error } = validInvite(req.params.code);
  if (error) {
    auth.recordFailure(`inv:${clientIp(req)}`);
    fail(400, error);
  }
  const username = str(req.body.username, 40);
  if (!USERNAME_RE.test(username)) fail(400, 'Der Nutzername braucht 3 bis 24 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich.');
  const displayName = requireStr(req.body.displayName || inv.display_name, 'deinen Namen', 60);
  const klasse = str(req.body.klasse, 20);
  checkPassword(req.body.password);
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'Diesen Nutzernamen gibt es schon. Wähle einen anderen.');

  const create = db.transaction(() => {
    const fresh = findInvite.get(inv.code);
    if (fresh.uses >= fresh.max_uses) fail(400, 'Dieser Einladungscode wurde gerade vollständig benutzt.');
    db.prepare('UPDATE invites SET uses = uses + 1 WHERE id = ?').run(inv.id);
    const info = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, klasse, invited_by, calendar_token, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(username, displayName, auth.hashPassword(req.body.password), inv.role, klasse, inv.created_by, auth.randomToken(24));
    return info.lastInsertRowid;
  });
  const userId = create();
  db.logActivity(userId, `${displayName} ist dem SV-Portal beigetreten`, '/mitglieder');
  auth.createSession(res, userId);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
});

// ---------- Eigenes Profil ----------

router.patch('/profil', auth.requireAuth, (req, res) => {
  const displayName = requireStr(req.body.displayName, 'deinen Namen', 60);
  const klasse = str(req.body.klasse, 20);
  db.prepare('UPDATE users SET display_name = ?, klasse = ? WHERE id = ?').run(displayName, klasse, req.user.id);
  res.json({ ok: true });
});

function calendarUrl(token) {
  return `${config.PUBLIC_URL}/kalender/${token}.ics`;
}

router.get('/profil/kalender', auth.requireAuth, (req, res) => {
  if (!config.CALENDAR_FEED) return res.json({ url: null });
  let token = req.user.calendar_token;
  if (!token) {
    token = auth.randomToken(24);
    db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, req.user.id);
  }
  res.json({ url: calendarUrl(token) });
});

router.post('/profil/kalender/neu', auth.requireAuth, (req, res) => {
  const token = auth.randomToken(24);
  db.prepare('UPDATE users SET calendar_token = ? WHERE id = ?').run(token, req.user.id);
  res.json({ url: calendarUrl(token) });
});

module.exports = router;
module.exports.publicUser = publicUser;
module.exports.USERNAME_RE = USERNAME_RE;
