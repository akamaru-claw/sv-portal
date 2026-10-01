const express = require('express');
const db = require('../db');
const { nowLocal, todayLocal, utc } = require('../util');
const { eventDto, baseSelect } = require('./events');
const { isOpen } = require('./polls');
const board = require('./board');

const router = express.Router();

router.get('/uebersicht', (req, res) => {
  const me = req.user.id;
  const now = nowLocal();
  const today = todayLocal();

  const nextMeetingRow = db.prepare(`${baseSelect}
    WHERE e.type = 'sitzung' AND COALESCE(e.ends_at, e.starts_at) >= @now
    ORDER BY e.starts_at LIMIT 1`).get({ me, now: minusHours(now, 3) });
  let nextMeeting = null;
  if (nextMeetingRow) {
    const agenda = db.prepare('SELECT title FROM agenda_items WHERE event_id = ? ORDER BY position, id LIMIT 8').all(nextMeetingRow.id);
    nextMeeting = { ...eventDto(nextMeetingRow), agendaPreview: agenda.map((a) => a.title) };
  }

  const upcoming = db.prepare(`${baseSelect}
    WHERE substr(COALESCE(e.ends_at, e.starts_at), 1, 10) >= @today AND (@skip IS NULL OR e.id != @skip)
    ORDER BY e.starts_at LIMIT 6`).all({ me, today, skip: nextMeetingRow ? nextMeetingRow.id : null }).map(eventDto);

  const polls = db.prepare(`
    SELECT p.* FROM polls p WHERE p.closed = 0 ORDER BY COALESCE(p.closes_at, '9999'), p.id DESC
  `).all().filter(isOpen).map((p) => {
    const voted = !!db.prepare('SELECT 1 FROM poll_ballots WHERE poll_id = ? AND user_id = ?').get(p.id, me);
    const mayVote = req.user.role !== 'lehrkraft' || !!p.teachers_vote;
    return { id: p.id, title: p.title, closesAt: p.closes_at, voted, mayVote };
  });

  const myTasks = db.prepare(`
    SELECT t.id, t.title, t.due_date, t.project_id, p.title AS project_title FROM tasks t
    JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_id = ? AND t.done = 0 AND p.status NOT IN ('erledigt', 'verworfen')
    ORDER BY COALESCE(t.due_date, '9999'), t.id LIMIT 8
  `).all(me).map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, projectId: t.project_id, projectTitle: t.project_title }));

  const posts = db.prepare(`${board.select} ORDER BY p.pinned DESC, p.id DESC LIMIT 3`).all().map((p) => board.postDto(p, req.user));

  const activity = db.prepare(`
    SELECT a.*, u.display_name FROM activity a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 12
  `).all().map((a) => ({ text: a.text, link: a.link, who: a.display_name || null, at: utc(a.created_at) }));

  const projects = db.prepare(`
    SELECT status, COUNT(*) AS n FROM projects GROUP BY status
  `).all().reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {});

  res.json({ nextMeeting, upcoming, polls, myTasks, posts, activity, projects });
});

// Eine Sitzung bleibt bis 3 Stunden nach Ende (bzw. Beginn) als "nächste Sitzung" sichtbar
function minusHours(now, h) {
  const d = new Date(`${now}:00Z`);
  d.setUTCHours(d.getUTCHours() - h);
  return d.toISOString().slice(0, 16);
}

module.exports = router;
