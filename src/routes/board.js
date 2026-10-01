const express = require('express');
const db = require('../db');
const auth = require('../auth');
const { fail, str, requireStr, id, utc } = require('../util');

const router = express.Router();

function postDto(p, user) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    pinned: !!p.pinned,
    authorId: p.author_id,
    authorName: p.author_name || 'Gelöschtes Mitglied',
    authorAmt: p.author_amt || '',
    createdAt: utc(p.created_at),
    updatedAt: utc(p.updated_at),
    canEdit: !!user && (p.author_id === user.id || auth.atLeast(user, 'vorstand')),
  };
}

const select = `SELECT p.*, u.display_name AS author_name, u.amt AS author_amt FROM posts p LEFT JOIN users u ON u.id = p.author_id`;

router.get('/pinnwand', (req, res) => {
  const rows = db.prepare(`${select} ORDER BY p.pinned DESC, p.id DESC LIMIT 100`).all();
  res.json({ posts: rows.map((p) => postDto(p, req.user)) });
});

router.post('/pinnwand', (req, res) => {
  const title = requireStr(req.body.title, 'einen Titel', 140);
  const pinned = req.body.pinned && auth.atLeast(req.user, 'vorstand') ? 1 : 0;
  const info = db.prepare('INSERT INTO posts (author_id, title, body, pinned) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title, str(req.body.body, 8000), pinned);
  db.logActivity(req.user.id, `Neuer Beitrag an der Pinnwand: „${title}“`, '/pinnwand');
  res.status(201).json({ id: info.lastInsertRowid });
});

function loadPost(param) {
  const p = db.prepare(`${select} WHERE p.id = ?`).get(id(param));
  if (!p) fail(404, 'Diesen Beitrag gibt es nicht.');
  return p;
}

router.patch('/pinnwand/:id', (req, res) => {
  const p = loadPost(req.params.id);
  const isBoard = auth.atLeast(req.user, 'vorstand');
  if (p.author_id !== req.user.id && !isBoard) fail(403, 'Ändern kann nur, wer den Beitrag geschrieben hat, oder der SV-Vorstand.');
  if (req.body.pinned !== undefined && !isBoard) fail(403, 'Anheften kann nur der SV-Vorstand.');
  db.prepare("UPDATE posts SET title = ?, body = ?, pinned = ?, updated_at = CASE WHEN ? THEN datetime('now') ELSE updated_at END WHERE id = ?").run(
    req.body.title === undefined ? p.title : requireStr(req.body.title, 'einen Titel', 140),
    req.body.body === undefined ? p.body : str(req.body.body, 8000),
    req.body.pinned === undefined ? p.pinned : (req.body.pinned ? 1 : 0),
    req.body.title !== undefined || req.body.body !== undefined ? 1 : 0,
    p.id,
  );
  res.json({ ok: true });
});

router.delete('/pinnwand/:id', (req, res) => {
  const p = loadPost(req.params.id);
  if (p.author_id !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Löschen kann nur, wer den Beitrag geschrieben hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM posts WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.postDto = postDto;
module.exports.select = select;
