// Rutas de una sección: lectura, guardado, revisión, comentarios y versiones (RF-06, RF-07, RF-10)
const express = require('express');
const { diffWords } = require('diff');
const { query, one, tx } = require('../db');
const { HttpError, ah, requireText, requireInt } = require('../http');
const { loadSectionFor } = require('../services/teams');
const { isSectionUnlocked } = require('../services/progress');
const { saveSection, submitSection, reviewSection } = require('../services/sections');
const { logActivity, notify, teamMemberIds } = require('../services/activity');
const { evaluateAchievements } = require('../services/achievements');

const router = express.Router();
const RECENT_VERSIONS = 4;
const MAX_COMMENT = 2000;
const MAX_QUOTE = 500;

const sectionId = (req) => requireInt(req.params.id, 'id', 'La sección');

/** Es integrante del equipo dueño de la sección (loadSectionFor ya validó la pertenencia). */
const isMember = (user) => user.role === 'estudiante';

/** Qué puede hacer el usuario con la sección (RF-06, RF-07, RF-10). */
function permissionsFor(user, section, unlocked) {
  const member = isMember(user);
  const canEdit = member && section.responsible_id === user.id && unlocked
    && ['redaccion', 'devuelto'].includes(section.status);
  const isReviewer = member && section.reviewer_id === user.id;
  return {
    canEdit,
    canSubmit: canEdit && Boolean(section.reviewer_id),
    canReview: (isReviewer || user.role === 'docente') && section.status === 'revision',
    canComment: member || user.role === 'docente',
    canResolve: member,
  };
}

/** Comentarios de la sección como hilos: los de nivel superior con sus respuestas. */
async function commentThreads(id) {
  const rows = await query(
    `SELECT c.id, c.parent_id, c.body, c.quote, c.resolved, c.resolved_at, c.created_at,
            u.id AS author_id, u.name AS author_name, u.role AS author_role, rb.name AS resolved_by_name
       FROM comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN users rb ON rb.id = c.resolved_by
      WHERE c.section_id = $1
      ORDER BY c.created_at`,
    [id]
  );
  const roots = rows.filter((c) => !c.parent_id).map((c) => ({ ...c, replies: [] }));
  const byId = new Map(roots.map((c) => [c.id, c]));
  rows.filter((c) => c.parent_id).forEach((c) => { if (byId.has(c.parent_id)) byId.get(c.parent_id).replies.push(c); });
  // Los pendientes primero, y entre ellos el más reciente arriba
  return roots.sort((a, b) => Number(a.resolved) - Number(b.resolved) || new Date(b.created_at) - new Date(a.created_at));
}

function versionList(id, limit = null) {
  return query(
    `SELECT v.number, v.kind, v.created_at, u.name AS author_name
       FROM section_versions v JOIN users u ON u.id = v.author_id
      WHERE v.section_id = $1
      ORDER BY v.number DESC
      ${limit ? 'LIMIT $2' : ''}`,
    limit ? [id, limit] : [id]
  );
}

// ---------- Leer una sección ----------
router.get('/:id', ah(async (req, res) => {
  const user = req.session.user;
  const s = await loadSectionFor(user, sectionId(req));
  const unlocked = await isSectionUnlocked(s);
  res.json({
    section: {
      id: s.id, name: s.name, position: s.section_position, content: s.content, status: s.status,
      updated_at: s.updated_at, locked: !unlocked,
      level: { id: s.level_id, position: s.level_position, name: s.level_name },
      team: { id: s.team_id, name: s.team_name },
      responsible: s.responsible_id ? { id: s.responsible_id, name: s.responsible_name } : null,
      reviewer: s.reviewer_id ? { id: s.reviewer_id, name: s.reviewer_name } : null,
    },
    permissions: permissionsFor(user, s, unlocked),
    comments: await commentThreads(s.id),
    versions: await versionList(s.id, RECENT_VERSIONS),
  });
}));

// ---------- Guardar, enviar y revisar (la lógica vive en services/sections.js) ----------
router.put('/:id', ah(async (req, res) => {
  const { content, auto } = req.body || {};
  if (typeof content !== 'string') throw new HttpError(400, 'Falta el contenido de la sección.', 'content');
  res.json(await saveSection(req.session.user, sectionId(req), content, auto === true ? 'automatico' : 'manual'));
}));

router.post('/:id/submit', ah(async (req, res) => {
  const { content } = req.body || {};
  if (content !== undefined && typeof content !== 'string') throw new HttpError(400, 'El contenido no es válido.', 'content');
  res.json(await submitSection(req.session.user, sectionId(req), content));
}));

router.post('/:id/review', ah(async (req, res) => {
  const { decision, observation } = req.body || {};
  res.json(await reviewSection(req.session.user, sectionId(req), decision, observation));
}));

// ---------- Comentarios (RF-10) ----------

/** Destinatarios del aviso de un comentario nuevo. */
async function commentRecipients(client, user, section, parent) {
  const fromReviewer = user.role === 'docente' || section.reviewer_id === user.id;
  let ids = [];
  if (fromReviewer) ids = [section.responsible_id, ...(await teamMemberIds(client, section.team_id))];
  else if (parent) ids = [parent.author_id];
  return ids.filter((id) => id && id !== user.id);
}

router.post('/:id/comments', ah(async (req, res) => {
  const user = req.session.user;
  const id = sectionId(req);
  const { quote, parent_id: parentRaw } = req.body || {};
  const body = requireText(req.body && req.body.body, 'body', 'El comentario', MAX_COMMENT);
  const cleanQuote = typeof quote === 'string' && quote.trim() ? quote.trim().slice(0, MAX_QUOTE) : null;

  const comment = await tx(async (client) => {
    const section = await loadSectionFor(user, id, client);
    if (!permissionsFor(user, section, true).canComment) {
      throw new HttpError(403, 'Solo la docente y los integrantes del equipo pueden comentar.');
    }
    let parent = null;
    if (parentRaw !== undefined && parentRaw !== null && parentRaw !== '') {
      const { rows } = await client.query('SELECT id, parent_id, author_id FROM comments WHERE id = $1 AND section_id = $2',
        [requireInt(parentRaw, 'parent_id', 'El comentario al que respondes'), id]);
      if (!rows[0]) throw new HttpError(404, 'El comentario al que respondes no existe.');
      parent = rows[0];
      // Las respuestas se cuelgan siempre del comentario principal del hilo
      if (parent.parent_id) parent = (await client.query('SELECT id, parent_id, author_id FROM comments WHERE id = $1', [parent.parent_id])).rows[0];
    }
    const { rows } = await client.query(
      `INSERT INTO comments (section_id, author_id, parent_id, body, quote) VALUES ($1, $2, $3, $4, $5)
       RETURNING id, parent_id, body, quote, resolved, created_at`,
      [id, user.id, parent ? parent.id : null, body, parent ? null : cleanQuote]
    );
    await logActivity(client, { userId: user.id, teamId: section.team_id, sectionId: id, action: 'comento', detail: section.name });
    await notify(client, await commentRecipients(client, user, section, parent), {
      type: 'comentario',
      title: parent ? `${user.name} respondió en "${section.name}"` : `Nuevo comentario en "${section.name}"`,
      body: `${user.name}: “${body.slice(0, 160)}”`,
      link: `/editor.html?id=${id}`,
    });
    await evaluateAchievements(client, section.team_id, user.id);
    return rows[0];
  });
  res.status(201).json({ comment: { ...comment, author_id: user.id, author_name: user.name, author_role: user.role, replies: [] } });
}));

router.post('/comments/:cid/resolve', ah(async (req, res) => {
  const user = req.session.user;
  const cid = requireInt(req.params.cid, 'cid', 'El comentario');
  const found = await one('SELECT id, section_id, parent_id, resolved FROM comments WHERE id = $1', [cid]);
  if (!found) throw new HttpError(404, 'El comentario no existe.');
  const result = await tx(async (client) => {
    const section = await loadSectionFor(user, found.section_id, client);
    if (!isMember(user)) throw new HttpError(403, 'Solo los integrantes del equipo pueden marcar comentarios como atendidos.');
    if (found.parent_id) throw new HttpError(400, 'Marca como atendido el comentario principal del hilo.');
    // El comentario nunca se borra: solo queda marcado como atendido (RF-10)
    const upd = await client.query(
      `UPDATE comments SET resolved = TRUE, resolved_by = $1, resolved_at = now()
        WHERE id = $2 AND NOT resolved RETURNING resolved_at`,
      [user.id, cid]
    );
    if (upd.rowCount === 0) throw new HttpError(409, 'El comentario ya estaba marcado como atendido.');
    await logActivity(client, { userId: user.id, teamId: section.team_id, sectionId: section.id, action: 'atendio_comentario', detail: section.name });
    await evaluateAchievements(client, section.team_id, user.id);
    return { resolved: true, resolved_at: upd.rows[0].resolved_at, resolved_by_name: user.name };
  });
  res.json(result);
}));

// ---------- Versiones (vista 12) ----------
router.get('/:id/versions', ah(async (req, res) => {
  const s = await loadSectionFor(req.session.user, sectionId(req));
  res.json({ section: { id: s.id, name: s.name, status: s.status }, versions: await versionList(s.id) });
}));

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/** Texto plano de un HTML limpio: los bloques se vuelven saltos de línea y se quitan las etiquetas. */
function plainText(htmlText) {
  return String(htmlText || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h2|h3|h4|li|tr|blockquote|div)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

router.get('/:id/versions/:n/diff', ah(async (req, res) => {
  const s = await loadSectionFor(req.session.user, sectionId(req));
  const n = requireInt(req.params.n, 'n', 'La versión');
  const sql = `SELECT v.number, v.kind, v.content, v.created_at, u.name AS author_name
                 FROM section_versions v JOIN users u ON u.id = v.author_id
                WHERE v.section_id = $1 AND v.number = $2`;
  const version = await one(sql, [s.id, n]);
  if (!version) throw new HttpError(404, 'Esa versión no existe.');
  const previous = n > 1 ? await one(sql, [s.id, n - 1]) : null;
  const parts = diffWords(plainText(previous && previous.content), plainText(version.content))
    .map((p) => ({ value: p.value, added: Boolean(p.added), removed: Boolean(p.removed) }));
  res.json({ version, previous: previous && { number: previous.number }, diff: parts });
}));

module.exports = router;
