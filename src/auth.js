const crypto = require('crypto');
const db = require('./db');
const config = require('./config');

const COOKIE = 'sv_session';
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ---------- Passwörter ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(expected, actual);
}

// Gut vorlesbare Einmal-Passwörter, z. B. "wolke-tiger-482"
const WORDS = (
  'ahorn amsel anker apfel ballon banane berg birke blitz blume boot brise burg dach delfin drache eiche eule ' +
  'fackel falke farn feder fels fenster fisch flamme floss fluss fuchs garten gecko geige gipfel glocke hafen ' +
  'hammer hase hecht himmel hirsch honig igel insel jaguar kaktus kamel kanu kerze kiesel kiwi koala komet ' +
  'krone kugel lampe laterne lava leuchte linde luchs magnet mantel marder melone mond moos muschel nebel ' +
  'nashorn orkan otter palme panda papagei pfeil pinsel planet pony quelle rabe radar rakete regen riese ' +
  'robbe sattel segel sonne spatz stern sturm tanne teich tiger tukan turm ufer uhu vulkan wal welle wiese ' +
  'wolke wolf zebra zirkus zitrone'
).split(' ');

function tempPassword() {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${w()}-${w()}-${crypto.randomInt(100, 1000)}`;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- Sitzungen ----------

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.SECURE_COOKIES) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function createSession(res, userId) {
  const token = randomToken();
  const maxAge = config.SESSION_DAYS * 24 * 3600;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + maxAge * 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  setSessionCookie(res, token, maxAge);
}

function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  setSessionCookie(res, '', 0);
}

function destroyAllSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

const sessionUser = db.prepare(`
  SELECT u.*, s.expires_at AS session_expires, s.token_hash
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
`);

/** Lädt req.user aus dem Sitzungs-Cookie (falls vorhanden). */
function loadUser(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  const row = sessionUser.get(sha256(token));
  if (!row || row.session_expires < Date.now() || !row.active) {
    if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return next();
  }
  // Gleitende Verlängerung, höchstens einmal am Tag
  const maxAgeMs = config.SESSION_DAYS * 24 * 3600 * 1000;
  if (row.session_expires - Date.now() < maxAgeMs - 24 * 3600 * 1000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + maxAgeMs, row.token_hash);
    setSessionCookie(res, token, maxAgeMs / 1000);
  }
  req.user = row;
  next();
}

// ---------- Rechte ----------

const ROLE_RANK = { mitglied: 1, vorstand: 2, lehrkraft: 3 };
const atLeast = (user, role) => !!user && ROLE_RANK[user.role] >= ROLE_RANK[role];

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Bitte melde dich an.' });
  if (req.user.must_change_pw) {
    return res.status(403).json({ error: 'Bitte lege zuerst ein eigenes Passwort fest.', code: 'MUST_CHANGE_PW' });
  }
  next();
}

const requireRole = (role) => (req, res, next) => {
  if (!atLeast(req.user, role)) {
    const msg = role === 'lehrkraft' ? 'Das dürfen nur Lehrkräfte.' : 'Das dürfen nur Lehrkräfte und der SV-Vorstand.';
    return res.status(403).json({ error: msg });
  }
  next();
};

// ---------- Schutz gegen Durchprobieren ----------

const attempts = new Map(); // key -> { count, until }
const WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(key, limit) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) return false;
  return a.count >= limit;
}
function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + WINDOW_MS });
  else a.count++;
}
function clearFailures(key) { attempts.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (a.until < now) attempts.delete(k);
}, 60 * 1000).unref();

module.exports = {
  hashPassword, verifyPassword, tempPassword, inviteCode, randomToken,
  createSession, destroySession, destroyAllSessions, loadUser,
  requireAuth, requireRole, atLeast, ROLE_RANK,
  tooManyAttempts, recordFailure, clearFailures,
};
