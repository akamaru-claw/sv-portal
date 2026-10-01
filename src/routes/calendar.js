const express = require('express');
const db = require('../db');
const config = require('../config');
const { TYPE_LABEL } = require('./events');

const router = express.Router();

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Zeilen nach RFC 5545 auf 75 Oktette falten
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const out = [];
  let start = 0;
  while (start < buf.length) {
    let end = Math.min(start + (out.length ? 74 : 75), buf.length);
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--; // nicht mitten im UTF-8-Zeichen trennen
    out.push((out.length ? ' ' : '') + buf.slice(start, end).toString('utf8'));
    start = end;
  }
  return out.join('\r\n');
}

const dt = (s) => s.replace(/[-:]/g, '').slice(0, 13) + '00'; // 2026-10-05T14:30 -> 20261005T143000
const d = (s) => s.slice(0, 10).replace(/-/g, '');
function nextDay(s) {
  const x = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10).replace(/-/g, '');
}
function plusHour(s) {
  const x = new Date(`${s}:00Z`);
  x.setUTCHours(x.getUTCHours() + 1);
  return x.toISOString().slice(0, 16);
}

router.get('/kalender/:token.ics', (req, res) => {
  if (!config.CALENDAR_FEED) return res.status(404).send('Nicht verfügbar');
  const user = db.prepare('SELECT id, active FROM users WHERE calendar_token = ?').get(String(req.params.token));
  if (!user || !user.active) return res.status(404).send('Unbekannter Kalender');

  const events = db.prepare(`
    SELECT * FROM events WHERE starts_at >= date('now', '-120 days') ORDER BY starts_at
  `).all();
  const host = new URL(config.PUBLIC_URL).host;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${esc(config.SITE_NAME)}//DE`, 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${esc(config.SITE_NAME)}`, 'X-WR-TIMEZONE:Europe/Berlin',
    'BEGIN:VTIMEZONE', 'TZID:Europe/Berlin',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:sv-termin-${e.id}@${host}`, `DTSTAMP:${stamp}`);
    if (e.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${d(e.starts_at)}`, `DTEND;VALUE=DATE:${nextDay(e.ends_at || e.starts_at)}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Berlin:${dt(e.starts_at)}`, `DTEND;TZID=Europe/Berlin:${dt(e.ends_at || plusHour(e.starts_at))}`);
    }
    lines.push(`SUMMARY:${esc(`${e.type === 'sonstiges' ? '' : `${TYPE_LABEL[e.type]}: `}${e.title}`)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    const desc = [e.description, `${config.PUBLIC_URL}/termine/${e.id}`].filter(Boolean).join('\n\n');
    lines.push(`DESCRIPTION:${esc(desc)}`, `URL:${config.PUBLIC_URL}/termine/${e.id}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  res.set('Cache-Control', 'no-store');
  res.type('text/calendar; charset=utf-8').send(lines.map(fold).join('\r\n') + '\r\n');
});

module.exports = router;
