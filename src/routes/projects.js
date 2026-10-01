const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { fail, str, requireStr, id, optDate, utc } = require('../util');
const { eventDto, baseSelect: eventSelect } = require('./events');

const router = express.Router();
const STATUSES = ['idee', 'planung', 'aktiv', 'erledigt', 'verworfen'];
const STATUS_LABEL = { idee: 'Idee', planung: 'In Planung', aktiv: 'Läuft', erledigt: 'Erledigt', verworfen: 'Verworfen' };

const listSelect = `
  SELECT p.*, l.display_name AS lead_name,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_total,
    (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.done = 1) AS task_done,
    (SELECT COUNT(*) FROM project_likes k WHERE k.project_id = p.id) AS likes,
    EXISTS (SELECT 1 FROM project_likes k WHERE k.project_id = p.id AND k.user_id = @me) AS liked,
    EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = @me) AS is_member,
    (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count,
    (SELECT COUNT(*) FROM comments c WHERE c.project_id = p.id) AS comment_count
  FROM projects p
  LEFT JOIN users l ON l.id = p.lead_id
`;

function projectDto(p, user) {
  return {
    id: p.id,
    title: p.title,
    summary: p.summary,
    status: p.status,
    statusLabel: STATUS_LABEL[p.status],
    leadId: p.lead_id,
    leadName: p.lead_name || null,
    dueDate: p.due_date,
    tasks: { total: p.task_total, done: p.task_done },
    likes: p.likes,
    liked: !!p.liked,
    isMember: !!p.is_member,
    memberCount: p.member_count,
    commentCount: p.comment_count,
    createdBy: p.created_by,
    updatedAt: utc(p.updated_at),
    canEdit: canEdit(user, p),
  };
}

function canEdit(user, p) {
  if (auth.atLeast(user, 'vorstand') || p.lead_id === user.id || p.created_by === user.id) return true;
  return !!db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(p.id, user.id);
}

function loadProject(param, me) {
  const p = db.prepare(`${listSelect} WHERE p.id = @id`).get({ id: id(param), me });
  if (!p) fail(404, 'Dieses Projekt gibt es nicht.');
  return p;
}

const touch = (projectId) => db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").run(projectId);

function checkUser(userId) {
  if (!userId) return null;
  const u = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(userId);
  if (!u) fail(400, 'Dieses Mitglied gibt es nicht.');
  return u.id;
}

router.get('/projekte', (req, res) => {
  const rows = db.prepare(`${listSelect} ORDER BY
    CASE p.status WHEN 'aktiv' THEN 1 WHEN 'planung' THEN 2 WHEN 'idee' THEN 3 WHEN 'erledigt' THEN 4 ELSE 5 END,
    p.updated_at DESC`).all({ me: req.user.id });
  res.json({ projects: rows.map((p) => projectDto(p, req.user)) });
});

router.get('/projekte/:id', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  const members = db.prepare(`
    SELECT u.id, u.display_name, u.klasse FROM project_members m JOIN users u ON u.id = m.user_id
    WHERE m.project_id = ? ORDER BY u.display_name COLLATE NOCASE
  `).all(p.id);
  const tasks = db.prepare(`
    SELECT t.*, u.display_name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = ? ORDER BY t.done, COALESCE(t.due_date, '9999'), t.id
  `).all(p.id);
  const comments = db.prepare(`
    SELECT c.*, u.display_name AS author_name FROM comments c LEFT JOIN users u ON u.id = c.author_id
    WHERE c.project_id = ? ORDER BY c.id DESC
  `).all(p.id);
  const files = db.prepare(`
    SELECT f.id, f.name, f.size, f.mime, f.created_at, u.display_name AS uploader FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.project_id = ? ORDER BY f.id DESC
  `).all(p.id);
  const events = db.prepare(`${eventSelect} WHERE e.project_id = @pid ORDER BY e.starts_at`).all({ pid: p.id, me: req.user.id });
  const money = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS income,
           COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS expense
    FROM finance WHERE project_id = ?
  `).get(p.id);
  const creator = p.created_by ? db.prepare('SELECT display_name FROM users WHERE id = ?').get(p.created_by) : null;

  res.json({
    project: {
      ...projectDto(p, req.user),
      description: p.description,
      creatorName: creator?.display_name || null,
      createdAt: utc(p.created_at),
      canDelete: auth.atLeast(req.user, 'vorstand') || p.lead_id === req.user.id || p.created_by === req.user.id,
      members: members.map((m) => ({ id: m.id, name: m.display_name, klasse: m.klasse })),
      taskList: tasks.map((t) => ({
        id: t.id, title: t.title, assigneeId: t.assignee_id, assigneeName: t.assignee_name || null,
        dueDate: t.due_date, done: !!t.done,
      })),
      comments: comments.map((c) => ({
        id: c.id, body: c.body, authorId: c.author_id, authorName: c.author_name || 'Gelöschtes Mitglied', createdAt: utc(c.created_at),
      })),
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, uploader: f.uploader, createdAt: utc(f.created_at) })),
      events: events.map(eventDto),
      money: { income: money.income, expense: money.expense },
    },
  });
});

router.post('/projekte', (req, res) => {
  const title = requireStr(req.body.title, 'einen Titel', 120);
  const status = STATUSES.includes(req.body.status) ? req.body.status : 'idee';
  const leadId = checkUser(id(req.body.leadId)) || (status === 'idee' ? null : req.user.id);
  const info = db.prepare(`
    INSERT INTO projects (title, summary, description, status, lead_id, due_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(title, str(req.body.summary, 240), str(req.body.description, 10000), status, leadId, optDate(req.body.dueDate), req.user.id);
  const pid = info.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(pid, req.user.id);
  if (leadId) db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(pid, leadId);
  db.logActivity(req.user.id, status === 'idee' ? `Neue Idee: „${title}“` : `Neues Projekt: „${title}“`, `/projekte/${pid}`);
  res.status(201).json({ id: pid });
});

router.patch('/projekte/:id', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  if (!canEdit(req.user, p)) fail(403, 'Ändern kann dieses Projekt nur das Projektteam oder der SV-Vorstand. Tritt dem Team bei, um mitzuarbeiten.');
  const b = req.body;
  const status = b.status === undefined ? p.status : (STATUSES.includes(b.status) ? b.status : fail(400, 'Unbekannter Status.'));
  const leadId = b.leadId === undefined ? p.lead_id : checkUser(id(b.leadId));
  db.prepare(`
    UPDATE projects SET title = ?, summary = ?, description = ?, status = ?, lead_id = ?, due_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    b.title === undefined ? p.title : requireStr(b.title, 'einen Titel', 120),
    b.summary === undefined ? p.summary : str(b.summary, 240),
    b.description === undefined ? p.description : str(b.description, 10000),
    status, leadId, b.dueDate === undefined ? p.due_date : optDate(b.dueDate), p.id,
  );
  if (leadId) db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(p.id, leadId);
  if (status !== p.status) db.logActivity(req.user.id, `„${p.title}“ ist jetzt: ${STATUS_LABEL[status]}`, `/projekte/${p.id}`);
  res.json({ ok: true });
});

router.delete('/projekte/:id', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  if (!(auth.atLeast(req.user, 'vorstand') || p.lead_id === req.user.id || p.created_by === req.user.id)) {
    fail(403, 'Löschen kann nur die Projektleitung, wer es angelegt hat, oder der SV-Vorstand.');
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

router.put('/projekte/:id/team', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  const targetId = id(req.body.userId) || req.user.id;
  if (targetId !== req.user.id && !canEdit(req.user, p)) fail(403, 'Andere ins Team holen kann nur das Projektteam.');
  checkUser(targetId);
  if (req.body.member) {
    db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)').run(p.id, targetId);
  } else {
    if (p.lead_id === targetId) fail(400, 'Die Projektleitung kann das Team nicht verlassen. Übergib vorher die Leitung.');
    db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(p.id, targetId);
  }
  touch(p.id);
  res.json({ ok: true });
});

router.put('/projekte/:id/unterstuetzen', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  if (req.body.like) db.prepare('INSERT OR IGNORE INTO project_likes (project_id, user_id) VALUES (?, ?)').run(p.id, req.user.id);
  else db.prepare('DELETE FROM project_likes WHERE project_id = ? AND user_id = ?').run(p.id, req.user.id);
  res.json({ ok: true });
});

// ---------- Aufgaben ----------

router.post('/projekte/:id/aufgaben', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  if (!canEdit(req.user, p)) fail(403, 'Aufgaben anlegen kann nur das Projektteam. Tritt dem Team bei, um mitzuarbeiten.');
  const title = requireStr(req.body.title, 'eine Aufgabe', 200);
  db.prepare('INSERT INTO tasks (project_id, title, assignee_id, due_date, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(p.id, title, checkUser(id(req.body.assigneeId)), optDate(req.body.dueDate), req.user.id);
  touch(p.id);
  res.status(201).json({ ok: true });
});

function loadTask(param) {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id(param));
  if (!t) fail(404, 'Diese Aufgabe gibt es nicht.');
  return t;
}

router.patch('/aufgaben/:id', (req, res) => {
  const t = loadTask(req.params.id);
  const p = loadProject(t.project_id, req.user.id);
  if (!canEdit(req.user, p) && t.assignee_id !== req.user.id) fail(403, 'Diese Aufgabe kann nur das Projektteam ändern.');
  const b = req.body;
  const done = b.done === undefined ? t.done : (b.done ? 1 : 0);
  db.prepare(`UPDATE tasks SET title = ?, assignee_id = ?, due_date = ?, done = ?,
    done_at = CASE WHEN ? = 1 AND done = 0 THEN datetime('now') WHEN ? = 0 THEN NULL ELSE done_at END WHERE id = ?`).run(
    b.title === undefined ? t.title : requireStr(b.title, 'eine Aufgabe', 200),
    b.assigneeId === undefined ? t.assignee_id : checkUser(id(b.assigneeId)),
    b.dueDate === undefined ? t.due_date : optDate(b.dueDate),
    done, done, done, t.id,
  );
  if (done && !t.done) db.logActivity(req.user.id, `Aufgabe erledigt: „${t.title}“ (${p.title})`, `/projekte/${p.id}`);
  touch(p.id);
  res.json({ ok: true });
});

router.delete('/aufgaben/:id', (req, res) => {
  const t = loadTask(req.params.id);
  const p = loadProject(t.project_id, req.user.id);
  if (!canEdit(req.user, p)) fail(403, 'Diese Aufgabe kann nur das Projektteam löschen.');
  db.prepare('DELETE FROM tasks WHERE id = ?').run(t.id);
  res.json({ ok: true });
});

router.get('/aufgaben/meine', (req, res) => {
  const rows = db.prepare(`
    SELECT t.*, p.title AS project_title FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.assignee_id = ? AND t.done = 0 AND p.status NOT IN ('erledigt', 'verworfen')
    ORDER BY COALESCE(t.due_date, '9999'), t.id
  `).all(req.user.id);
  res.json({ tasks: rows.map((t) => ({ id: t.id, title: t.title, dueDate: t.due_date, projectId: t.project_id, projectTitle: t.project_title })) });
});

// ---------- Kommentare / Neuigkeiten im Projekt ----------

router.post('/projekte/:id/kommentare', (req, res) => {
  const p = loadProject(req.params.id, req.user.id);
  const body = requireStr(req.body.body, 'einen Text', 4000);
  db.prepare('INSERT INTO comments (project_id, author_id, body) VALUES (?, ?, ?)').run(p.id, req.user.id, body);
  touch(p.id);
  db.logActivity(req.user.id, `Kommentar zu „${p.title}“`, `/projekte/${p.id}`);
  res.status(201).json({ ok: true });
});

router.delete('/kommentare/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(id(req.params.id));
  if (!c) fail(404, 'Diesen Kommentar gibt es nicht.');
  if (c.author_id !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Löschen kann nur, wer den Kommentar geschrieben hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.STATUS_LABEL = STATUS_LABEL;
