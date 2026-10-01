const path = require('path');

const env = process.env;
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|ja|yes|on)$/i.test(v));

const config = {
  PORT: parseInt(env.PORT || '3000', 10),
  DATA_DIR: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  // Öffentliche Adresse, unter der das Portal erreichbar ist (für Einladungslinks, QR-Codes, Kalender-Abo)
  PUBLIC_URL: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  SITE_NAME: env.SITE_NAME || 'SV-Portal',
  SCHOOL_NAME: env.SCHOOL_NAME || 'Mauritius-Gymnasium Büren',
  MAX_UPLOAD_MB: parseInt(env.MAX_UPLOAD_MB || '25', 10),
  SESSION_DAYS: parseInt(env.SESSION_DAYS || '30', 10),
  // Anzahl Reverse-Proxy-Hops vor der App (Caddy/nginx = 1)
  TRUST_PROXY: parseInt(env.TRUST_PROXY || '1', 10),
  // Kalender-Abo (ICS) per geheimem Link erlauben
  CALENDAR_FEED: bool(env.CALENDAR_FEED, true),
};

config.FILES_DIR = path.join(config.DATA_DIR, 'files');
config.DB_FILE = path.join(config.DATA_DIR, 'sv-portal.db');
config.SECURE_COOKIES = config.PUBLIC_URL.startsWith('https://');
config.PUBLIC_ORIGIN = new URL(config.PUBLIC_URL).origin;

module.exports = config;
