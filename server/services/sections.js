// Flujo de una sección: guardar, enviar a revisión, aprobar y devolver (RF-06, RF-07)
const sanitizeHtml = require('sanitize-html');
const { tx } = require('../db');
const { HttpError } = require('../http');
const { logActivity, notify, teamMemberIds, teacherIds } = require('./activity');
const { isSectionUnlocked, afterApproval } = require('./progress');
const { evaluateAchievements } = require('./achievements');
const { loadSectionFor } = require('./teams');

const MAX_CONTENT = 200000;

/** Solo se permite el formato que ofrece la barra del editor; se elimina cualquier script. */
function cleanHtml(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'blockquote', 'span', 'div'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });
}

async function nextVersionNumber(client, sectionId) {
  const { rows } = await client.query('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM section_versions WHERE section_id = $1', [sectionId]);
  return rows[0].n;
}

function assertResponsible(user, section) {
  if (user.role !== 'estudiante' || section.responsible_id !== user.id) {
    throw new HttpError(403, 'Solo el responsable de la sección puede editarla. Tú la ves en modo lectura.');
  }
}

/**
 * Guarda el contenido y crea una versión (manual o automática).
 * Una sección en revisión o aprobada no se edita; una devuelta vuelve a "en redacción".
 */
async function saveSection(user, sectionId, rawContent, kind = 'manual') {
  return tx(async (client) => {
    const section = await loadSectionFor(user, sectionId, client);
    assertResponsible(user, section);
    if (!(await isSectionUnlocked(section, client))) throw new HttpError(409, 'Este nivel todavía está bloqueado.');
    if (section.status === 'revision') throw new HttpError(409, 'La sección está en revisión y no se puede editar hasta que la revisen.');
    if (section.status === 'aprobado') throw new HttpError(409, 'La sección ya fue aprobada y no se puede editar.');
    const content = cleanHtml(rawContent);
    if (content.length > MAX_CONTENT) throw new HttpError(413, 'El texto es demasiado largo para una sección.');
    if (kind === 'automatico' && content === section.content) {
      return { saved: false, updated_at: section.updated_at };
    }
    const { rows } = await client.query(
      `UPDATE sections SET content = $1, status = 'redaccion', updated_at = now(), updated_by = $2
        WHERE id = $3 RETURNING updated_at`,
      [content, user.id, sectionId]
    );
    const number = await nextVersionNumber(client, sectionId);
    await client.query(
      'INSERT INTO section_versions (section_id, number, author_id, content, kind) VALUES ($1, $2, $3, $4, $5)',
      [sectionId, number, user.id, content, kind]
    );
    await logActivity(client, {
      userId: user.id, teamId: section.team_id, sectionId,
      action: 'guardo_version', detail: `${section.name} · v${number} (${kind === 'manual' ? 'manual' : 'automático'})`,
    });
    return { saved: true, version: number, updated_at: rows[0].updated_at };
  });
}

/** El responsable envía a revisión: se guarda una versión "enviada" y se avisa al revisor y a la docente. */
async function submitSection(user, sectionId, rawContent) {
  return tx(async (client) => {
    const section = await loadSectionFor(user, sectionId, client);
    assertResponsible(user, section);
    if (!(await isSectionUnlocked(section, client))) throw new HttpError(409, 'Este nivel todavía está bloqueado.');
    if (!['redaccion', 'devuelto'].includes(section.status)) throw new HttpError(409, 'La sección ya está en revisión o aprobada.');
    if (!section.reviewer_id) throw new HttpError(409, 'Asignen un revisor antes de enviar la sección a revisión.');
    const content = rawContent === undefined ? section.content : cleanHtml(rawContent);
    if (!content.replace(/<[^>]*>/g, '').trim()) throw new HttpError(400, 'No puedes enviar una sección vacía.');
    await client.query(
      `UPDATE sections SET content = $1, status = 'revision', updated_at = now(), updated_by = $2 WHERE id = $3`,
      [content, user.id, sectionId]
    );
    const number = await nextVersionNumber(client, sectionId);
    await client.query(
      `INSERT INTO section_versions (section_id, number, author_id, content, kind) VALUES ($1, $2, $3, $4, 'enviada')`,
      [sectionId, number, user.id, content]
    );
    await logActivity(client, { userId: user.id, teamId: section.team_id, sectionId, action: 'envio_revision', detail: section.name });
    await notify(client, [section.reviewer_id, ...(await teacherIds(client))], {
      type: 'revision',
      title: `${section.team_name} envió "${section.name}" a revisión`,
      body: `${user.name} terminó la sección y espera tu revisión.`,
      link: `/editor.html?id=${sectionId}`,
    });
    await evaluateAchievements(client, section.team_id, user.id);
    return { status: 'revision' };
  });
}

/** Puede revisar: el revisor asignado (estudiante) o cualquier docente. */
function assertCanReview(user, section) {
  const isReviewer = user.role === 'estudiante' && section.reviewer_id === user.id;
  if (!isReviewer && user.role !== 'docente') throw new HttpError(403, 'Solo el revisor asignado o la docente pueden revisar esta sección.');
}

/** Aprueba o devuelve una sección. Devolver exige una observación escrita (RF-07). */
async function reviewSection(user, sectionId, decision, observation) {
  const note = typeof observation === 'string' ? observation.trim() : '';
  if (!['aprobar', 'devolver'].includes(decision)) throw new HttpError(400, 'Decisión no válida.');
  if (decision === 'devolver' && !note) {
    throw new HttpError(400, 'Escribe una observación para devolver la sección.', 'observation');
  }
  return tx(async (client) => {
    const section = await loadSectionFor(user, sectionId, client);
    assertCanReview(user, section);
    if (section.status !== 'revision') throw new HttpError(409, 'Solo se pueden revisar secciones que están en revisión.');
    const status = decision === 'aprobar' ? 'aprobado' : 'devuelto';
    await client.query('UPDATE sections SET status = $1, updated_at = now(), updated_by = $2 WHERE id = $3', [status, user.id, sectionId]);
    if (note) {
      await client.query('INSERT INTO comments (section_id, author_id, body) VALUES ($1, $2, $3)', [sectionId, user.id, note]);
      await logActivity(client, { userId: user.id, teamId: section.team_id, sectionId, action: 'comento', detail: section.name });
    }
    await logActivity(client, {
      userId: user.id, teamId: section.team_id, sectionId,
      action: decision === 'aprobar' ? 'aprobo' : 'devolvio', detail: section.name,
    });
    const members = await teamMemberIds(client, section.team_id);
    await notify(client, decision === 'aprobar' ? members : [section.responsible_id], {
      type: decision === 'aprobar' ? 'aprobada' : 'devuelta',
      title: decision === 'aprobar' ? `"${section.name}" fue aprobada` : `"${section.name}" fue devuelta con observaciones`,
      body: note ? `${user.name}: “${note.slice(0, 160)}”` : `Revisada por ${user.name}.`,
      link: `/editor.html?id=${sectionId}`,
    });
    if (decision === 'aprobar') await afterApproval(client, section.team_id, section.level_id, user.id);
    await evaluateAchievements(client, section.team_id, user.id);
    return { status };
  });
}

module.exports = { cleanHtml, saveSection, submitSection, reviewSection };
