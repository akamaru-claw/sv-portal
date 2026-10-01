const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { fail, str, requireStr, id, optDateTime, nowLocal, utc } = require('../util');

const router = express.Router();

function isOpen(p) {
  return !p.closed && (!p.closes_at || p.closes_at > nowLocal());
}

function eligibleCount(p) {
  const roles = p.teachers_vote ? "('lehrkraft','vorstand','mitglied')" : "('vorstand','mitglied')";
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE active = 1 AND role IN ${roles}`).get().n;
}

const mayVote = (user, p) => user.role !== 'lehrkraft' || !!p.teachers_vote;
const canManage = (user, p) => auth.atLeast(user, 'vorstand') || p.created_by === user.id;

function loadPoll(param) {
  const p = db.prepare(`
    SELECT p.*, u.display_name AS creator_name, e.title AS event_title FROM polls p
    LEFT JOIN users u ON u.id = p.created_by LEFT JOIN events e ON e.id = p.event_id WHERE p.id = ?
  `).get(id(param));
  if (!p) fail(404, 'Diese Abstimmung gibt es nicht.');
  return p;
}

function pollSummary(p, user) {
  const ballots = db.prepare('SELECT COUNT(*) AS n FROM poll_ballots WHERE poll_id = ?').get(p.id).n;
  const voted = !!db.prepare('SELECT 1 FROM poll_ballots WHERE poll_id = ? AND user_id = ?').get(p.id, user.id);
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    multi: !!p.multi,
    maxChoices: p.max_choices,
    anonymous: !!p.anonymous,
    resultsAfterClose: !!p.results_after_close,
    teachersVote: !!p.teachers_vote,
    closesAt: p.closes_at,
    open: isOpen(p),
    ballots,
    eligible: eligibleCount(p),
    voted,
    mayVote: mayVote(user, p),
    eventId: p.event_id,
    eventTitle: p.event_title || null,
    creatorName: p.creator_name || null,
    createdAt: utc(p.created_at),
    canManage: canManage(user, p),
  };
}

router.get('/abstimmungen', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, u.display_name AS creator_name, e.title AS event_title FROM polls p
    LEFT JOIN users u ON u.id = p.created_by LEFT JOIN events e ON e.id = p.event_id
    ORDER BY p.id DESC LIMIT 200
  `).all();
  res.json({ polls: rows.map((p) => pollSummary(p, req.user)) });
});

router.get('/abstimmungen/:id', (req, res) => {
  const p = loadPoll(req.params.id);
  const summary = pollSummary(p, req.user);
  const options = db.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY position, id').all(p.id);
  // Ergebnisse sofort sichtbar, außer "erst nach Ende zeigen" ist gewählt (gilt auch für Vorstand und Lehrkräfte)
  const resultsVisible = !p.results_after_close || !summary.open;

  let myChoices = [];
  if (!p.anonymous) {
    myChoices = db.prepare('SELECT option_id FROM poll_votes WHERE poll_id = ? AND user_id = ?').all(p.id, req.user.id).map((r) => r.option_id);
  }

  let results = null;
  if (resultsVisible) {
    results = options.map((o) => {
      if (p.anonymous) return { optionId: o.id, votes: o.anon_votes, voters: null };
      const voters = db.prepare(`
        SELECT u.display_name FROM poll_votes v JOIN users u ON u.id = v.user_id
        WHERE v.option_id = ? ORDER BY u.display_name COLLATE NOCASE
      `).all(o.id).map((r) => r.display_name);
      return { optionId: o.id, votes: voters.length, voters };
    });
  }

  // Wer hat schon teilgenommen? Bei anonymen Abstimmungen nur die Zahl.
  const participants = p.anonymous ? null : db.prepare(`
    SELECT u.display_name FROM poll_ballots b JOIN users u ON u.id = b.user_id
    WHERE b.poll_id = ? ORDER BY u.display_name COLLATE NOCASE
  `).all(p.id).map((r) => r.display_name);

  res.json({
    poll: {
      ...summary,
      options: options.map((o) => ({ id: o.id, label: o.label })),
      myChoices,
      results,
      participants,
    },
  });
});

router.post('/abstimmungen', auth.requireRole('vorstand'), (req, res) => {
  const title = requireStr(req.body.title, 'eine Frage', 200);
  const labels = (Array.isArray(req.body.options) ? req.body.options : [])
    .map((o) => str(o, 200)).filter(Boolean);
  const unique = [...new Set(labels.map((l) => l.toLowerCase()))];
  if (labels.length < 2) fail(400, 'Eine Abstimmung braucht mindestens zwei Antwortmöglichkeiten.');
  if (unique.length !== labels.length) fail(400, 'Zwei Antwortmöglichkeiten sind gleich.');
  if (labels.length > 30) fail(400, 'Höchstens 30 Antwortmöglichkeiten.');
  const multi = !!req.body.multi;
  const maxChoices = multi ? Math.min(Math.max(parseInt(req.body.maxChoices, 10) || labels.length, 1), labels.length) : 1;
  const closesAt = optDateTime(req.body.closesAt);
  if (closesAt && closesAt <= nowLocal()) fail(400, 'Das Abstimmungsende liegt in der Vergangenheit.');
  const eventId = id(req.body.eventId);
  if (eventId && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) fail(400, 'Diesen Termin gibt es nicht.');

  const pollId = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO polls (title, description, multi, max_choices, anonymous, results_after_close, teachers_vote, closes_at, event_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, str(req.body.description, 4000), multi ? 1 : 0, maxChoices, req.body.anonymous ? 1 : 0,
      req.body.resultsAfterClose ? 1 : 0, req.body.teachersVote ? 1 : 0, closesAt, eventId, req.user.id);
    const ins = db.prepare('INSERT INTO poll_options (poll_id, label, position) VALUES (?, ?, ?)');
    labels.forEach((l, i) => ins.run(info.lastInsertRowid, l, i));
    return info.lastInsertRowid;
  })();
  db.logActivity(req.user.id, `Neue Abstimmung: „${title}“`, `/abstimmungen/${pollId}`);
  res.status(201).json({ id: pollId });
});

router.put('/abstimmungen/:id/stimme', (req, res) => {
  const p = loadPoll(req.params.id);
  if (!isOpen(p)) fail(400, 'Diese Abstimmung ist beendet.');
  if (!mayVote(req.user, p)) fail(403, 'Bei dieser Abstimmung stimmen nur Schülerinnen und Schüler ab.');
  const valid = new Set(db.prepare('SELECT id FROM poll_options WHERE poll_id = ?').all(p.id).map((o) => o.id));
  const choices = [...new Set((Array.isArray(req.body.optionIds) ? req.body.optionIds : []).map(id))];
  if (!choices.length) fail(400, 'Wähle mindestens eine Antwort aus.');
  if (choices.some((c) => !valid.has(c))) fail(400, 'Diese Antwort gehört nicht zur Abstimmung.');
  if (!p.multi && choices.length > 1) fail(400, 'Hier ist nur eine Antwort möglich.');
  if (choices.length > p.max_choices) fail(400, `Du kannst höchstens ${p.max_choices} Antworten wählen.`);
  const hasBallot = !!db.prepare('SELECT 1 FROM poll_ballots WHERE poll_id = ? AND user_id = ?').get(p.id, req.user.id);

  db.transaction(() => {
    if (p.anonymous) {
      if (hasBallot) fail(400, 'Du hast schon abgestimmt. Anonyme Stimmen lassen sich nicht ändern.');
      db.prepare('INSERT INTO poll_ballots (poll_id, user_id) VALUES (?, ?)').run(p.id, req.user.id);
      const inc = db.prepare('UPDATE poll_options SET anon_votes = anon_votes + 1 WHERE id = ?');
      choices.forEach((c) => inc.run(c));
    } else {
      db.prepare('INSERT OR IGNORE INTO poll_ballots (poll_id, user_id) VALUES (?, ?)').run(p.id, req.user.id);
      db.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?').run(p.id, req.user.id);
      const ins = db.prepare('INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (?, ?, ?)');
      choices.forEach((c) => ins.run(p.id, c, req.user.id));
    }
  })();
  res.json({ ok: true });
});

router.post('/abstimmungen/:id/beenden', (req, res) => {
  const p = loadPoll(req.params.id);
  if (!canManage(req.user, p)) fail(403, 'Beenden kann nur, wer die Abstimmung erstellt hat, oder der SV-Vorstand.');
  db.prepare('UPDATE polls SET closed = 1 WHERE id = ?').run(p.id);
  db.logActivity(req.user.id, `Abstimmung beendet: „${p.title}“`, `/abstimmungen/${p.id}`);
  res.json({ ok: true });
});

router.delete('/abstimmungen/:id', (req, res) => {
  const p = loadPoll(req.params.id);
  if (!canManage(req.user, p)) fail(403, 'Löschen kann nur, wer die Abstimmung erstellt hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM polls WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.isOpen = isOpen;
