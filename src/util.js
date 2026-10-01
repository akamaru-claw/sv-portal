/** Fehler, die als verständliche Meldung an die Oberfläche gehen. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => { throw new HttpError(status, message); };

/** String säubern und kürzen. */
const str = (v, max = 200) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);

function requireStr(v, label, max = 200) {
  const s = str(v, max);
  if (!s) fail(400, `Bitte gib ${label} an.`);
  return s;
}

const id = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function optDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s)) fail(400, 'Das Datum hat nicht das Format JJJJ-MM-TT.');
  return s;
}

function optDateTime(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 16);
  if (!DATETIME_RE.test(s)) fail(400, 'Datum und Uhrzeit fehlen oder sind unvollständig.');
  return s;
}

/** Aktuelle Ortszeit in Deutschland als 'YYYY-MM-DDTHH:MM'. */
function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const todayLocal = () => nowLocal().slice(0, 10);

/** SQLite-UTC-Zeitstempel ('YYYY-MM-DD HH:MM:SS') als ISO mit Z. */
const utc = (s) => (s ? `${s.replace(' ', 'T')}Z` : null);

const userName = (row, prefix = '') => row[`${prefix}display_name`] || (row[`${prefix}id`] ? '' : 'Gelöschtes Mitglied');

module.exports = { HttpError, fail, str, requireStr, id, optDate, optDateTime, nowLocal, todayLocal, utc, userName };
