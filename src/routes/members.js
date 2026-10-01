const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const { fail, str, id, utc } = require('../util');

const router = express.Router();
const ROLES = ['lehrkraft', 'vorstand', 'mitglied'];
const ROLE_LABEL = { lehrkraft: 'Lehrkraft', vorstand: 'SV-Vorstand', mitglied: 'SV-Mitglied' };

function memberDto(u, forTeacher) {
  const dto = {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    amt: u.amt,
    klasse: u.klasse,
    active: !!u.active,
  };
  if (forTeacher) {
    dto.mustChangePassword = !!u.must_change_pw;
    dto.lastLoginAt = utc(u.last_login_at);
    dto.createdAt = utc(u.created_at);
  }
  return dto;
}

router.get('/mitglieder', (req, res) => {
  const teacher = auth.atLeast(req.user, 'lehrkraft');
  const rows = db.prepare(`
    SELECT * FROM users ${teacher ? '' : 'WHERE active = 1'}
    ORDER BY active DESC,
      CASE role WHEN 'lehrkraft' THEN 1 WHEN 'vorstand' THEN 2 ELSE 3 END,
      display_name COLLATE NOCASE
  `).all();
  res.json({ members: rows.map((u) => memberDto(u, teacher)) });
});

// ---------- Ab hier nur Lehrkräfte ----------

const teacherOnly = auth.requireRole('lehrkraft');

function activeTeacherCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'lehrkraft' AND active = 1").get().n;
}

function loadMember(param) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id(param));
  if (!u) fail(404, 'Dieses Mitglied gibt es nicht.');
  return u;
}

router.patch('/mitglieder/:id', teacherOnly, (req, res) => {
  const u = loadMember(req.params.id);
  const role = req.body.role ?? u.role;
  if (!ROLES.includes(role)) fail(400, 'Unbekannte Rolle.');
  const active = req.body.active === undefined ? !!u.active : !!req.body.active;
  const displayName = req.body.displayName === undefined ? u.display_name : str(req.body.displayName, 60);
  if (!displayName) fail(400, 'Der Name darf nicht leer sein.');
  const amt = req.body.amt === undefined ? u.amt : str(req.body.amt, 60);
  const klasse = req.body.klasse === undefined ? u.klasse : str(req.body.klasse, 20);

  const losesTeacher = u.role === 'lehrkraft' && u.active && (role !== 'lehrkraft' || !active);
  if (losesTeacher && activeTeacherCount() <= 1) fail(400, 'Es muss mindestens eine aktive Lehrkraft bleiben.');
  if (u.id === req.user.id && !active) fail(400, 'Du kannst dein eigenes Konto nicht deaktivieren.');

  db.prepare('UPDATE users SET role = ?, active = ?, display_name = ?, amt = ?, klasse = ? WHERE id = ?')
    .run(role, active ? 1 : 0, displayName, amt, klasse, u.id);
  if (!active) auth.destroyAllSessions(u.id);
  res.json({ member: memberDto(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id), true) });
});

router.post('/mitglieder/:id/passwort-zuruecksetzen', teacherOnly, (req, res) => {
  const u = loadMember(req.params.id);
  if (u.id === req.user.id) fail(400, 'Dein eigenes Passwort änderst du im Profil.');
  const temp = auth.tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change_pw = 1 WHERE id = ?').run(auth.hashPassword(temp), u.id);
  auth.destroyAllSessions(u.id);
  auth.clearFailures(`user:${u.username.toLowerCase()}`);
  db.logActivity(req.user.id, `Passwort von ${u.display_name} wurde zurückgesetzt`, '/mitglieder');
  res.json({ tempPassword: temp, username: u.username });
});

router.delete('/mitglieder/:id', teacherOnly, (req, res) => {
  const u = loadMember(req.params.id);
  if (u.id === req.user.id) fail(400, 'Du kannst dein eigenes Konto nicht löschen.');
  if (u.role === 'lehrkraft' && u.active && activeTeacherCount() <= 1) fail(400, 'Es muss mindestens eine aktive Lehrkraft bleiben.');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  res.json({ ok: true });
});

// ---------- Einladungen ----------

function inviteDto(i) {
  const expired = new Date(utc(i.expires_at)) < new Date();
  return {
    id: i.id,
    code: i.code,
    link: `${config.PUBLIC_URL}/einladung/${i.code}`,
    role: i.role,
    roleLabel: ROLE_LABEL[i.role],
    displayName: i.display_name,
    note: i.note,
    maxUses: i.max_uses,
    uses: i.uses,
    expiresAt: utc(i.expires_at),
    createdBy: i.creator_name || null,
    createdAt: utc(i.created_at),
    status: i.revoked ? 'zurückgezogen' : i.uses >= i.max_uses ? 'verbraucht' : expired ? 'abgelaufen' : 'gültig',
  };
}

router.get('/einladungen', teacherOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, u.display_name AS creator_name FROM invites i
    LEFT JOIN users u ON u.id = i.created_by
    ORDER BY i.id DESC LIMIT 100
  `).all();
  res.json({ invites: rows.map(inviteDto) });
});

router.post('/einladungen', teacherOnly, (req, res) => {
  const role = ROLES.includes(req.body.role) ? req.body.role : 'mitglied';
  const maxUses = Math.min(Math.max(parseInt(req.body.maxUses, 10) || 1, 1), 60);
  const days = Math.min(Math.max(parseInt(req.body.days, 10) || 7, 1), 60);
  const displayName = maxUses === 1 ? str(req.body.displayName, 60) : '';
  const note = str(req.body.note, 120);
  let code;
  do { code = auth.inviteCode(); } while (db.prepare('SELECT 1 FROM invites WHERE code = ?').get(code));
  const info = db.prepare(`
    INSERT INTO invites (code, role, display_name, note, max_uses, expires_at, created_by)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?)
  `).run(code, role, displayName, note, maxUses, `+${days} days`, req.user.id);
  const row = db.prepare('SELECT * FROM invites WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ invite: inviteDto({ ...row, creator_name: req.user.display_name }) });
});

router.delete('/einladungen/:id', teacherOnly, (req, res) => {
  db.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').run(id(req.params.id));
  res.json({ ok: true });
});

router.get('/einladungen/:id/qr.svg', teacherOnly, async (req, res) => {
  const inv = db.prepare('SELECT * FROM invites WHERE id = ?').get(id(req.params.id));
  if (!inv) fail(404, 'Diese Einladung gibt es nicht.');
  const svg = await QRCode.toString(`${config.PUBLIC_URL}/einladung/${inv.code}`, {
    type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0F630E', light: '#FFFFFF' },
  });
  res.type('image/svg+xml').send(svg);
});

module.exports = router;
