const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { fail, str, requireStr, id, optDate, todayLocal, utc } = require('../util');

const router = express.Router();

function entryDto(e) {
  return {
    id: e.id, date: e.date, title: e.title, amountCents: e.amount_cents, category: e.category,
    projectId: e.project_id, projectTitle: e.project_title || null,
    createdByName: e.creator_name || null, createdAt: utc(e.created_at),
  };
}

const NEW_ENTRY = { date: null, title: null, amount_cents: 0, category: '', project_id: null };

function readBody(b, existing = NEW_ENTRY) {
  let cents = existing.amount_cents;
  if (b.amount !== undefined) {
    const n = Number(String(b.amount).replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) fail(400, 'Bitte gib einen Betrag größer als 0 an.');
    if (n > 100000) fail(400, 'Der Betrag ist unrealistisch hoch.');
    cents = Math.round(n * 100);
  }
  const kind = b.kind === undefined ? (existing.amount_cents < 0 ? 'ausgabe' : 'einnahme') : b.kind;
  if (!['einnahme', 'ausgabe'].includes(kind)) fail(400, 'Wähle Einnahme oder Ausgabe.');
  if (!cents) fail(400, 'Bitte gib einen Betrag an.');
  cents = Math.abs(cents) * (kind === 'ausgabe' ? -1 : 1);
  const projectId = b.projectId === undefined ? existing.project_id : id(b.projectId);
  if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) fail(400, 'Dieses Projekt gibt es nicht.');
  return {
    date: b.date === undefined && existing.date ? existing.date : (optDate(b.date) || todayLocal()),
    title: b.title === undefined && existing.title ? existing.title : requireStr(b.title, 'eine Beschreibung', 160),
    amount_cents: cents,
    category: b.category === undefined ? existing.category : str(b.category, 60),
    project_id: projectId || null,
  };
}

router.get('/kasse', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, p.title AS project_title, u.display_name AS creator_name FROM finance f
    LEFT JOIN projects p ON p.id = f.project_id LEFT JOIN users u ON u.id = f.created_by
    ORDER BY f.date DESC, f.id DESC
  `).all();
  const totals = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS balance,
      COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS income,
      COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS expense
    FROM finance
  `).get();
  const byProject = db.prepare(`
    SELECT p.id, p.title, SUM(f.amount_cents) AS sum FROM finance f JOIN projects p ON p.id = f.project_id
    GROUP BY p.id ORDER BY p.title COLLATE NOCASE
  `).all();
  const categories = db.prepare("SELECT DISTINCT category FROM finance WHERE category != '' ORDER BY category COLLATE NOCASE").all().map((r) => r.category);
  res.json({
    entries: rows.map(entryDto),
    totals,
    byProject,
    categories,
    canEdit: auth.atLeast(req.user, 'vorstand'),
  });
});

const boardOnly = auth.requireRole('vorstand');

router.post('/kasse', boardOnly, (req, res) => {
  const d = readBody(req.body);
  db.prepare('INSERT INTO finance (date, title, amount_cents, category, project_id, created_by) VALUES (@date, @title, @amount_cents, @category, @project_id, @by)')
    .run({ ...d, by: req.user.id });
  res.status(201).json({ ok: true });
});

function loadEntry(param) {
  const e = db.prepare('SELECT * FROM finance WHERE id = ?').get(id(param));
  if (!e) fail(404, 'Diese Buchung gibt es nicht.');
  return e;
}

router.patch('/kasse/:id', boardOnly, (req, res) => {
  const e = loadEntry(req.params.id);
  const d = readBody(req.body, e);
  db.prepare('UPDATE finance SET date=@date, title=@title, amount_cents=@amount_cents, category=@category, project_id=@project_id WHERE id=@id')
    .run({ ...d, id: e.id });
  res.json({ ok: true });
});

router.delete('/kasse/:id', boardOnly, (req, res) => {
  const e = loadEntry(req.params.id);
  db.prepare('DELETE FROM finance WHERE id = ?').run(e.id);
  res.json({ ok: true });
});

module.exports = router;
