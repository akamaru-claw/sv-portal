const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { fail, str, requireStr, id, optDate, optDateTime, utc } = require('../util');

const router = express.Router();
const TYPES = ['sitzung', 'aktion', 'frist', 'schule', 'sonstiges'];
const TYPE_LABEL = { sitzung: 'Sitzung', aktion: 'Aktion', frist: 'Frist', schule: 'Schultermin', sonstiges: 'Termin' };

const baseSelect = `
  SELECT e.*, p.title AS project_title, u.display_name AS creator_name,
    (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'ja') AS yes_count,
    (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'nein') AS no_count,
    (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'vielleicht') AS maybe_count,
    (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = @me) AS my_rsvp,
    (SELECT COUNT(*) FROM agenda_items a WHERE a.event_id = e.id) AS agenda_count
  FROM events e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN users u ON u.id = e.created_by
`;

function eventDto(e) {
  return {
    id: e.id,
    type: e.type,
    typeLabel: TYPE_LABEL[e.type],
    title: e.title,
    description: e.description,
    location: e.location,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    allDay: !!e.all_day,
    projectId: e.project_id,
    projectTitle: e.project_title || null,
    createdBy: e.created_by,
    creatorName: e.creator_name || null,
    rsvp: { ja: e.yes_count, nein: e.no_count, vielleicht: e.maybe_count, mine: e.my_rsvp || null },
    agendaCount: e.agenda_count,
    hasProtocol: !!(e.protocol && e.protocol.trim()),
  };
}

function loadEvent(param, me) {
  const e = db.prepare(`${baseSelect} WHERE e.id = @id`).get({ id: id(param), me });
  if (!e) fail(404, 'Diesen Termin gibt es nicht.');
  return e;
}

const canEditEvent = (user, e) => auth.atLeast(user, 'vorstand') || e.created_by === user.id;

const NEW_EVENT = { type: 'sonstiges', title: undefined, description: '', location: '', starts_at: undefined, ends_at: null, all_day: 0, project_id: null };

function readEventBody(body, existing = NEW_EVENT) {
  const type = TYPES.includes(body.type) ? body.type : existing.type || 'sonstiges';
  const allDay = body.allDay === undefined ? !!existing.all_day : !!body.allDay;
  let startsAt = body.startsAt === undefined ? existing.starts_at : body.startsAt;
  let endsAt = body.endsAt === undefined ? existing.ends_at : body.endsAt;
  if (allDay) {
    startsAt = `${optDate(startsAt) || fail(400, 'Bitte gib ein Datum an.')}T00:00`;
    endsAt = endsAt ? `${optDate(endsAt)}T23:59` : null;
  } else {
    startsAt = optDateTime(startsAt) || fail(400, 'Bitte gib Datum und Uhrzeit an.');
    endsAt = optDateTime(endsAt);
  }
  if (endsAt && endsAt < startsAt) fail(400, 'Das Ende liegt vor dem Beginn.');
  const projectId = body.projectId === undefined ? existing.project_id : id(body.projectId);
  if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) fail(400, 'Dieses Projekt gibt es nicht.');
  return {
    type,
    title: body.title === undefined && existing.title ? existing.title : requireStr(body.title, 'einen Titel', 120),
    description: body.description === undefined ? existing.description : str(body.description, 5000),
    location: body.location === undefined ? existing.location : str(body.location, 120),
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: allDay ? 1 : 0,
    project_id: projectId || null,
  };
}

// Liste, optional mit Zeitraum (?von=YYYY-MM-DD&bis=YYYY-MM-DD)
router.get('/termine', (req, res) => {
  const von = optDate(req.query.von) || '0000-01-01';
  const bis = optDate(req.query.bis) || '9999-12-31';
  const rows = db.prepare(`${baseSelect}
    WHERE substr(e.starts_at, 1, 10) <= @bis AND substr(COALESCE(e.ends_at, e.starts_at), 1, 10) >= @von
    ORDER BY e.starts_at`).all({ me: req.user.id, von, bis });
  res.json({ events: rows.map(eventDto) });
});

router.get('/termine/:id', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  const agenda = db.prepare(`
    SELECT a.*, u.display_name AS proposer FROM agenda_items a
    LEFT JOIN users u ON u.id = a.proposed_by
    WHERE a.event_id = ? ORDER BY a.position, a.id
  `).all(e.id);
  const rsvps = db.prepare(`
    SELECT r.status, u.id, u.display_name FROM event_rsvps r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? ORDER BY u.display_name COLLATE NOCASE
  `).all(e.id);
  const polls = db.prepare('SELECT id, title, closed, closes_at FROM polls WHERE event_id = ? ORDER BY id').all(e.id);
  const protocolBy = e.protocol_by ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(e.protocol_by) : null;
  res.json({
    event: {
      ...eventDto(e),
      canEdit: canEditEvent(req.user, e),
      protocol: e.protocol,
      protocolBy: protocolBy?.display_name || null,
      protocolUpdatedAt: utc(e.protocol_updated_at),
      agenda: agenda.map((a) => ({
        id: a.id, title: a.title, note: a.note, done: !!a.done, proposer: a.proposer || null, proposedBy: a.proposed_by,
      })),
      rsvps: rsvps.map((r) => ({ userId: r.id, name: r.display_name, status: r.status })),
      polls: polls.map((p) => ({ id: p.id, title: p.title, closed: !!p.closed })),
    },
  });
});

router.post('/termine', (req, res) => {
  const data = readEventBody(req.body);
  if (data.type === 'sitzung' && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Sitzungen legen Lehrkräfte oder der SV-Vorstand an.');
  const info = db.prepare(`
    INSERT INTO events (type, title, description, location, starts_at, ends_at, all_day, project_id, created_by)
    VALUES (@type, @title, @description, @location, @starts_at, @ends_at, @all_day, @project_id, @created_by)
  `).run({ ...data, created_by: req.user.id });
  db.logActivity(req.user.id, `${TYPE_LABEL[data.type]} „${data.title}“ eingetragen`, `/termine/${info.lastInsertRowid}`);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/termine/:id', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  if (!canEditEvent(req.user, e)) fail(403, 'Diesen Termin kann nur ändern, wer ihn angelegt hat, oder der SV-Vorstand.');
  const data = readEventBody(req.body, e);
  if (data.type === 'sitzung' && e.type !== 'sitzung' && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Sitzungen legen Lehrkräfte oder der SV-Vorstand an.');
  db.prepare(`
    UPDATE events SET type=@type, title=@title, description=@description, location=@location,
      starts_at=@starts_at, ends_at=@ends_at, all_day=@all_day, project_id=@project_id WHERE id=@id
  `).run({ ...data, id: e.id });
  res.json({ ok: true });
});

router.delete('/termine/:id', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  if (!canEditEvent(req.user, e)) fail(403, 'Diesen Termin kann nur löschen, wer ihn angelegt hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM events WHERE id = ?').run(e.id);
  res.json({ ok: true });
});

router.put('/termine/:id/zusage', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  const status = req.body.status;
  if (status === null || status === '') {
    db.prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(e.id, req.user.id);
  } else {
    if (!['ja', 'nein', 'vielleicht'].includes(status)) fail(400, 'Unbekannte Antwort.');
    db.prepare(`
      INSERT INTO event_rsvps (event_id, user_id, status) VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')
    `).run(e.id, req.user.id, status);
  }
  res.json({ ok: true });
});

// ---------- Tagesordnung ----------

router.post('/termine/:id/tagesordnung', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  const title = requireStr(req.body.title, 'einen Tagesordnungspunkt', 160);
  const note = str(req.body.note, 2000);
  const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM agenda_items WHERE event_id = ?').get(e.id).p;
  db.prepare('INSERT INTO agenda_items (event_id, title, note, position, proposed_by) VALUES (?, ?, ?, ?, ?)')
    .run(e.id, title, note, pos, req.user.id);
  db.logActivity(req.user.id, `TOP „${title}“ für ${e.title} vorgeschlagen`, `/termine/${e.id}`);
  res.status(201).json({ ok: true });
});

function loadAgendaItem(param) {
  const a = db.prepare('SELECT * FROM agenda_items WHERE id = ?').get(id(param));
  if (!a) fail(404, 'Diesen Tagesordnungspunkt gibt es nicht.');
  return a;
}

router.patch('/tagesordnung/:id', (req, res) => {
  const a = loadAgendaItem(req.params.id);
  const mayEdit = auth.atLeast(req.user, 'vorstand') || a.proposed_by === req.user.id;
  const onlyDone = Object.keys(req.body).every((k) => k === 'done');
  if (!mayEdit && !onlyDone) fail(403, 'Diesen Punkt kann nur ändern, wer ihn vorgeschlagen hat, oder der SV-Vorstand.');
  db.prepare('UPDATE agenda_items SET title = ?, note = ?, done = ? WHERE id = ?').run(
    req.body.title === undefined ? a.title : requireStr(req.body.title, 'einen Titel', 160),
    req.body.note === undefined ? a.note : str(req.body.note, 2000),
    req.body.done === undefined ? a.done : (req.body.done ? 1 : 0),
    a.id,
  );
  res.json({ ok: true });
});

router.post('/tagesordnung/:id/verschieben', auth.requireRole('vorstand'), (req, res) => {
  const a = loadAgendaItem(req.params.id);
  const dir = req.body.dir === -1 ? -1 : 1;
  const items = db.prepare('SELECT id FROM agenda_items WHERE event_id = ? ORDER BY position, id').all(a.event_id);
  const i = items.findIndex((x) => x.id === a.id);
  const j = i + dir;
  if (j < 0 || j >= items.length) return res.json({ ok: true });
  [items[i], items[j]] = [items[j], items[i]];
  const upd = db.prepare('UPDATE agenda_items SET position = ? WHERE id = ?');
  db.transaction(() => items.forEach((x, k) => upd.run(k + 1, x.id)))();
  res.json({ ok: true });
});

router.delete('/tagesordnung/:id', (req, res) => {
  const a = loadAgendaItem(req.params.id);
  if (!auth.atLeast(req.user, 'vorstand') && a.proposed_by !== req.user.id) fail(403, 'Diesen Punkt kann nur löschen, wer ihn vorgeschlagen hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM agenda_items WHERE id = ?').run(a.id);
  res.json({ ok: true });
});

// ---------- Protokoll ----------

router.put('/termine/:id/protokoll', (req, res) => {
  const e = loadEvent(req.params.id, req.user.id);
  const text = str(req.body.text, 50000);
  db.prepare("UPDATE events SET protocol = ?, protocol_by = ?, protocol_updated_at = datetime('now') WHERE id = ?")
    .run(text, req.user.id, e.id);
  if (text && !e.protocol) db.logActivity(req.user.id, `Protokoll zu „${e.title}“ angelegt`, `/termine/${e.id}`);
  res.json({ ok: true });
});

module.exports = router;
module.exports.eventDto = eventDto;
module.exports.baseSelect = baseSelect;
module.exports.TYPE_LABEL = TYPE_LABEL;
