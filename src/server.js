const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const { HttpError } = require('./util');

const app = express();
app.set('trust proxy', config.TRUST_PROXY);
app.disable('x-powered-by');

// ---------- Sicherheits-Header ----------
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (!res.get('Content-Security-Policy')) {
    res.set('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '));
  }
  next();
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Kalender-Abo (ohne Login, per geheimem Link) ----------
app.use(require('./routes/calendar'));

// ---------- API ----------
const api = express.Router();
api.use(express.json({ limit: '200kb' }));
api.use(auth.loadUser);

// Schutz gegen Cross-Site-Anfragen: schreibende Aufrufe nur mit eigenem Header und passender Herkunft
api.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-SV-Request') !== '1') return res.status(403).json({ error: 'Ungültige Anfrage.' });
  const origin = req.get('Origin');
  if (origin) {
    let host = '';
    try { host = new URL(origin).host; } catch { /* ungültig */ }
    if (origin !== config.PUBLIC_ORIGIN && host !== req.get('host')) return res.status(403).json({ error: 'Ungültige Herkunft der Anfrage.' });
  }
  next();
});
api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

api.use(require('./routes/account'));          // /me, /login, /logout, /passwort, /einladung/:code, /profil
api.use(auth.requireAuth);                        // ab hier nur angemeldet (und mit eigenem Passwort)
api.use(require('./routes/dashboard'));
api.use(require('./routes/members'));
api.use(require('./routes/board'));
api.use(require('./routes/events'));
api.use(require('./routes/projects'));
api.use(require('./routes/polls'));
api.use(require('./routes/files'));
api.use(require('./routes/finance'));
api.use((req, res) => res.status(404).json({ error: 'Diese Schnittstelle gibt es nicht.' }));

app.use('/api', api);

// ---------- Oberfläche ----------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const assetVersion = crypto.createHash('sha1')
  .update(fs.readdirSync(path.join(PUBLIC_DIR, 'js', 'views')).join() + Date.now())
  .digest('hex').slice(0, 8);
const indexHtml = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8')
  .replaceAll('__V__', assetVersion)
  .replaceAll('__SITE_NAME__', config.SITE_NAME);

app.use(express.static(PUBLIC_DIR, {
  index: false,
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (/\.(js|css)$/.test(filePath)) res.set('Cache-Control', 'no-cache');
  },
}));

// Alle übrigen Seitenaufrufe liefern die App aus (clientseitiges Routing)
app.use((req, res, next) => {
  if (req.method !== 'GET' || path.extname(req.path)) return next();
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(indexHtml);
});

// ---------- Fehlerbehandlung ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Die Anfrage ist zu groß.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Ungültige Anfrage.' });
  console.error(err);
  res.status(500).json({ error: 'Auf dem Server ist ein Fehler passiert. Versuch es gleich noch einmal.' });
});

const teacherCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'lehrkraft'").get().n;

app.listen(config.PORT, () => {
  console.log(`${config.SITE_NAME} läuft auf Port ${config.PORT} (${config.PUBLIC_URL})`);
  if (!teacherCount) {
    console.log('\nNoch keine Lehrkraft angelegt. Erstes Konto anlegen mit:');
    console.log('  docker compose exec sv-portal node src/cli.js lehrkraft-anlegen <nutzername> "<Anzeigename>"\n');
  }
});
