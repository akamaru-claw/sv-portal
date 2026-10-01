const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const auth = require('../auth');
const { fail, requireStr, id, utc } = require('../util');

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: config.FILES_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex')),
  }),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 20, fields: 10 },
});

function uploadMiddleware(req, res, next) {
  upload.array('files', 20)(req, res, (err) => {
    if (!err) return next();
    for (const f of req.files || []) fs.rm(f.path, { force: true }, () => {});
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Eine Datei ist größer als ${config.MAX_UPLOAD_MB} MB.` });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Höchstens 20 Dateien auf einmal.' });
    return res.status(400).json({ error: 'Der Upload hat nicht geklappt.' });
  });
}

// Dateinamen kommen bei multer als latin1 an
const fixName = (n) => {
  const s = Buffer.from(n, 'latin1').toString('utf8');
  return s.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200) || 'Datei';
};

// Manche Browser schicken keinen Dateityp mit; für die Vorschau reicht die Endung
const EXT_MIME = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};
function mimeOf(file) {
  const m = (file.mimetype || '').toLowerCase();
  if (m && m !== 'application/octet-stream') return m.slice(0, 100);
  return EXT_MIME[path.extname(fixName(file.originalname)).toLowerCase()] || 'application/octet-stream';
}

function fileDto(f) {
  return {
    id: f.id, name: f.name, size: f.size, mime: f.mime, folderId: f.folder_id,
    projectId: f.project_id, projectTitle: f.project_title || null,
    uploadedBy: f.uploaded_by, uploaderName: f.uploader_name || null, createdAt: utc(f.created_at),
  };
}

function loadFolder(folderId) {
  if (!folderId) return null;
  const f = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  if (!f) fail(404, 'Diesen Ordner gibt es nicht.');
  return f;
}

function breadcrumb(folder) {
  const trail = [];
  let cur = folder;
  while (cur) {
    trail.unshift({ id: cur.id, name: cur.name });
    cur = cur.parent_id ? db.prepare('SELECT * FROM folders WHERE id = ?').get(cur.parent_id) : null;
  }
  return trail;
}

router.get('/dateien', (req, res) => {
  const folder = loadFolder(id(req.query.ordner));
  const fid = folder ? folder.id : null;
  const folders = db.prepare(`
    SELECT f.*, (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id) + (SELECT COUNT(*) FROM folders y WHERE y.parent_id = f.id) AS item_count
    FROM folders f WHERE f.parent_id IS ? ORDER BY f.name COLLATE NOCASE
  `).all(fid);
  const files = db.prepare(`
    SELECT f.*, u.display_name AS uploader_name, p.title AS project_title FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN projects p ON p.id = f.project_id
    WHERE f.folder_id IS ? ORDER BY f.name COLLATE NOCASE
  `).all(fid);
  const allFolders = db.prepare('SELECT id, parent_id, name FROM folders ORDER BY name COLLATE NOCASE').all();
  res.json({
    folder: folder ? { id: folder.id, name: folder.name, parentId: folder.parent_id } : null,
    trail: breadcrumb(folder),
    folders: folders.map((f) => ({ id: f.id, name: f.name, itemCount: f.item_count, createdBy: f.created_by })),
    files: files.map(fileDto),
    allFolders: allFolders.map((f) => ({ id: f.id, parentId: f.parent_id, name: f.name })),
    canManageAll: auth.atLeast(req.user, 'vorstand'),
  });
});

router.get('/dateien/neueste', (req, res) => {
  const files = db.prepare(`
    SELECT f.*, u.display_name AS uploader_name, p.title AS project_title FROM files f
    LEFT JOIN users u ON u.id = f.uploaded_by LEFT JOIN projects p ON p.id = f.project_id
    ORDER BY f.id DESC LIMIT 8
  `).all();
  res.json({ files: files.map(fileDto) });
});

router.post('/ordner', (req, res) => {
  const parent = loadFolder(id(req.body.parentId));
  const name = requireStr(req.body.name, 'einen Ordnernamen', 80);
  const info = db.prepare('INSERT INTO folders (parent_id, name, created_by) VALUES (?, ?, ?)').run(parent ? parent.id : null, name, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/ordner/:id', (req, res) => {
  const f = loadFolder(id(req.params.id));
  if (f.created_by !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Umbenennen kann nur, wer den Ordner angelegt hat, oder der SV-Vorstand.');
  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(requireStr(req.body.name, 'einen Ordnernamen', 80), f.id);
  res.json({ ok: true });
});

router.delete('/ordner/:id', (req, res) => {
  const f = loadFolder(id(req.params.id));
  if (f.created_by !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Löschen kann nur, wer den Ordner angelegt hat, oder der SV-Vorstand.');
  const used = db.prepare('SELECT (SELECT COUNT(*) FROM files WHERE folder_id = ?) + (SELECT COUNT(*) FROM folders WHERE parent_id = ?) AS n').get(f.id, f.id).n;
  if (used) fail(400, 'Der Ordner ist nicht leer. Verschiebe oder lösche zuerst den Inhalt.');
  db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

router.post('/dateien', uploadMiddleware, (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) fail(400, 'Wähle mindestens eine Datei aus.');
    const folder = loadFolder(id(req.body.folderId));
    const projectId = id(req.body.projectId);
    if (projectId && !db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) fail(400, 'Dieses Projekt gibt es nicht.');
    const ins = db.prepare('INSERT INTO files (folder_id, project_id, name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    db.transaction(() => {
      for (const f of files) ins.run(folder ? folder.id : null, projectId, fixName(f.originalname), f.filename, mimeOf(f), f.size, req.user.id);
    })();
    const where = projectId ? db.prepare('SELECT title FROM projects WHERE id = ?').get(projectId).title : folder ? folder.name : 'Dateien';
    db.logActivity(req.user.id, `${files.length === 1 ? `„${fixName(files[0].originalname)}“` : `${files.length} Dateien`} hochgeladen (${where})`,
      projectId ? `/projekte/${projectId}` : `/dateien${folder ? `?ordner=${folder.id}` : ''}`);
    res.status(201).json({ count: files.length });
  } catch (err) {
    for (const f of files) fs.rm(f.path, { force: true }, () => {});
    throw err;
  }
});

function loadFile(param) {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(id(param));
  if (!f) fail(404, 'Diese Datei gibt es nicht.');
  return f;
}

// Nur harmlose Formate dürfen im Browser angezeigt werden; alles andere wird heruntergeladen.
const INLINE_OK = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'audio/mpeg', 'video/mp4']);

router.get('/dateien/:id/download', (req, res) => {
  const f = loadFile(req.params.id);
  const filePath = path.join(config.FILES_DIR, f.stored_name);
  if (!fs.existsSync(filePath)) fail(404, 'Die Datei fehlt auf dem Server.');
  const inline = req.query.inline === '1' && INLINE_OK.has(f.mime);
  res.set({
    'Content-Type': inline ? (f.mime === 'text/plain' ? 'text/plain; charset=utf-8' : f.mime) : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  });
  // Chrome zeigt PDFs in einer Sandbox nicht an; alle anderen Antworten bekommen sie.
  if (!(inline && f.mime === 'application/pdf')) {
    res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  }
  res.sendFile(filePath);
});

router.patch('/dateien/:id', (req, res) => {
  const f = loadFile(req.params.id);
  if (f.uploaded_by !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Ändern kann nur, wer die Datei hochgeladen hat, oder der SV-Vorstand.');
  const name = req.body.name === undefined ? f.name : requireStr(req.body.name, 'einen Dateinamen', 200).replace(/[\\/]/g, '_');
  const folderId = req.body.folderId === undefined ? f.folder_id : (loadFolder(id(req.body.folderId))?.id ?? null);
  db.prepare('UPDATE files SET name = ?, folder_id = ? WHERE id = ?').run(name, folderId, f.id);
  res.json({ ok: true });
});

router.delete('/dateien/:id', (req, res) => {
  const f = loadFile(req.params.id);
  if (f.uploaded_by !== req.user.id && !auth.atLeast(req.user, 'vorstand')) fail(403, 'Löschen kann nur, wer die Datei hochgeladen hat, oder der SV-Vorstand.');
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  fs.rm(path.join(config.FILES_DIR, f.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

module.exports = router;
