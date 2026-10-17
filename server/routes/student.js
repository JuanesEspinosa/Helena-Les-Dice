// Rutas del estudiante: tablero, integrantes, asignaciones, logros e historial (RF-04, RF-05, RF-07, RF-08, RF-11)
const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah } = require('../http');
const { studentTeam, requireStudentTeam, teamMembers } = require('../services/teams');
const { ensureTeamSections, teamSummary } = require('../services/progress');
const { logActivity } = require('../services/activity');

const router = express.Router();
const MAX_PENDING_COMMENTS = 5;

/** Equipo del estudiante con sus secciones al día según la plantilla de niveles. */
async function loadTeam(req) {
  const team = await requireStudentTeam(req.session.user.id);
  await ensureTeamSections(team.id);
  return team;
}

const publicTeam = (t) => ({ id: t.id, name: t.name, project: t.project, period_name: t.period_name });

/** Nivel en el que trabaja el equipo; si ya terminó todos, el último. */
const workingLevel = (summary) => summary.current || summary.levels[summary.levels.length - 1] || null;

/** Secciones de un nivel del equipo con responsable y revisor. */
function levelSections(teamId, levelId) {
  return query(
    `SELECT s.id, ls.name, ls.position, s.status, s.updated_at, s.responsible_id, s.reviewer_id,
            ru.name AS responsible_name, rv.name AS reviewer_name
       FROM sections s
       JOIN level_sections ls ON ls.id = s.level_section_id
       LEFT JOIN users ru ON ru.id = s.responsible_id
       LEFT JOIN users rv ON rv.id = s.reviewer_id
      WHERE s.team_id = $1 AND ls.level_id = $2
      ORDER BY ls.position`,
    [teamId, levelId]
  );
}

const person = (id, name) => (id ? { id, name } : null);

// ---------- Resumen para el menú lateral ----------
router.get('/summary', ah(async (req, res) => {
  const team = await studentTeam(req.session.user.id);
  if (!team) return res.json({ team: null });
  await ensureTeamSections(team.id);
  const s = await teamSummary(team.id);
  res.json({ team: publicTeam(team), pct: s.pct, approved: s.approved, total: s.total, points: s.points, badges: s.badges });
}));

// ---------- Tablero de niveles (vista 02) ----------
router.get('/board', ah(async (req, res) => {
  const team = await loadTeam(req);
  const summary = await teamSummary(team.id);
  const level = workingLevel(summary);
  const sections = level ? await levelSections(team.id, level.id) : [];
  const comments = await query(
    `SELECT c.id, c.body, c.quote, c.created_at, s.id AS section_id, ls.name AS section_name,
            u.name AS author_name, u.role AS author_role, (u.id = s.reviewer_id) AS author_is_reviewer
       FROM comments c
       JOIN sections s ON s.id = c.section_id
       JOIN level_sections ls ON ls.id = s.level_section_id
       JOIN users u ON u.id = c.author_id
      WHERE s.team_id = $1 AND c.parent_id IS NULL AND NOT c.resolved
      ORDER BY c.created_at DESC
      LIMIT $2`,
    [team.id, MAX_PENDING_COMMENTS]
  );
  const { pending } = await one(
    `SELECT COUNT(*)::int AS pending FROM comments c JOIN sections s ON s.id = c.section_id
      WHERE s.team_id = $1 AND c.parent_id IS NULL AND NOT c.resolved`,
    [team.id]
  );
  res.json({
    team: publicTeam(team),
    levels: summary.levels,
    current: level && { ...level, finished: !summary.current },
    sections: sections.map((s) => ({
      id: s.id, name: s.name, position: s.position, status: s.status, updated_at: s.updated_at,
      responsible: person(s.responsible_id, s.responsible_name),
      reviewer: person(s.reviewer_id, s.reviewer_name),
    })),
    counts: level
      ? { aprobado: level.approved, revision: level.in_review, redaccion: level.drafting, devuelto: level.returned }
      : { aprobado: 0, revision: 0, redaccion: 0, devuelto: 0 },
    pending_comments: comments,
    pending_total: pending,
    next_achievement: await nextForBoard(team.id, summary),
    points: summary.points,
    badges: summary.badges,
    pct: summary.pct,
  });
}));

/** Próximo logro: el de superar el nivel actual si existe; si no, el no ganado de menos puntos. */
async function nextForBoard(teamId, summary) {
  const pending = await query(
    `SELECT a.id, a.name, a.description, a.icon, a.criterion, a.param, a.points
       FROM achievements a
      WHERE NOT EXISTS (SELECT 1 FROM team_achievements ta WHERE ta.team_id = $1 AND ta.achievement_id = a.id)
      ORDER BY a.points, a.id`,
    [teamId]
  );
  const cur = summary.current;
  const levelBadge = cur && pending.find((a) => a.criterion === 'level_completed' && a.param === cur.position);
  const pick = levelBadge || pending[0];
  if (!pick) return null;
  const stats = await teamStats(teamId, summary.levels);
  return { ...pick, progress: progressOf(pick, stats) };
}

// ---------- Integrantes y asignaciones (vista 11) ----------
router.get('/members', ah(async (req, res) => {
  const team = await loadTeam(req);
  const members = await query(
    `SELECT u.id, u.name, u.email,
            (SELECT MAX(a.created_at) FROM activity_log a WHERE a.team_id = $1 AND a.user_id = u.id) AS last_activity,
            (SELECT COUNT(*) FROM activity_log a WHERE a.team_id = $1 AND a.user_id = u.id)::int AS contributions,
            (SELECT COUNT(*) FROM sections s WHERE s.team_id = $1 AND s.responsible_id = u.id)::int AS writes,
            (SELECT COUNT(*) FROM sections s WHERE s.team_id = $1 AND s.reviewer_id = u.id)::int AS reviews
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1
      ORDER BY contributions DESC, u.name`,
    [team.id]
  );
  const summary = await teamSummary(team.id);
  const level = workingLevel(summary);
  const sections = level ? await levelSections(team.id, level.id) : [];
  res.json({
    team: publicTeam(team),
    members,
    level: level && { id: level.id, position: level.position, name: level.name },
    assignments: sections.map((s) => ({
      section_id: s.id, name: s.name, position: s.position, status: s.status,
      responsible_id: s.responsible_id, reviewer_id: s.reviewer_id,
    })),
  });
}));

/** Valida una fila de asignación contra los integrantes del equipo (RF-05). */
function checkAssignment(row, memberIds) {
  const sectionId = Number(row && row.section_id);
  if (!Number.isInteger(sectionId)) throw new HttpError(400, 'Sección no válida.');
  const resp = Number(row.responsible_id);
  const rev = Number(row.reviewer_id);
  if (!memberIds.has(resp)) throw new HttpError(400, 'Solo puedes asignar integrantes de tu equipo.', `resp-${sectionId}`);
  if (!memberIds.has(rev)) throw new HttpError(400, 'Solo puedes asignar integrantes de tu equipo.', `rev-${sectionId}`);
  if (resp === rev) throw new HttpError(400, 'El responsable y el revisor no pueden ser la misma persona.', `rev-${sectionId}`);
  return { sectionId, resp, rev };
}

router.put('/assignments', ah(async (req, res) => {
  const user = req.session.user;
  const team = await loadTeam(req);
  const list = req.body && req.body.assignments;
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'No hay asignaciones para guardar.');
  if (list.length > 100) throw new HttpError(400, 'Demasiadas asignaciones en una sola petición.');
  const names = new Map((await teamMembers(team.id)).map((m) => [m.id, m.name]));
  const memberIds = new Set(names.keys());
  const rows = list.map((r) => checkAssignment(r, memberIds));

  const changed = await tx(async (client) => {
    let count = 0;
    for (const r of rows) {
      const { rows: found } = await client.query(
        `SELECT s.id, s.status, s.responsible_id, s.reviewer_id, ls.name
           FROM sections s JOIN level_sections ls ON ls.id = s.level_section_id
          WHERE s.id = $1 AND s.team_id = $2 FOR UPDATE OF s`,
        [r.sectionId, team.id]
      );
      const sec = found[0];
      if (!sec) throw new HttpError(400, 'Solo puedes asignar secciones de tu equipo.');
      if (sec.responsible_id === r.resp && sec.reviewer_id === r.rev) continue;
      if (sec.status === 'aprobado') {
        throw new HttpError(409, `"${sec.name}" ya fue aprobada y no se puede reasignar.`, `resp-${sec.id}`);
      }
      await client.query('UPDATE sections SET responsible_id = $1, reviewer_id = $2 WHERE id = $3', [r.resp, r.rev, sec.id]);
      await logActivity(client, {
        userId: user.id, teamId: team.id, sectionId: sec.id, action: 'asigno',
        detail: `${sec.name} · responsable ${names.get(r.resp)}, revisor ${names.get(r.rev)}`,
      });
      count++;
    }
    return count;
  });
  res.json({ updated: changed });
}));

// ---------- Logros e insignias (vista 04) ----------

/** Cifras del equipo para calcular cuánto falta en cada logro. */
async function teamStats(teamId, levels) {
  const st = await one(
    `SELECT
       (SELECT COUNT(*) FROM activity_log WHERE team_id = $1 AND action = 'envio_revision')::int AS submissions,
       (SELECT COUNT(*) FROM sections WHERE team_id = $1 AND status = 'aprobado')::int AS approved,
       (SELECT COUNT(*) FROM comments c JOIN sections s ON s.id = c.section_id
         WHERE s.team_id = $1 AND c.parent_id IS NULL AND c.resolved)::int AS resolved,
       (SELECT COUNT(*) FROM comments c JOIN sections s ON s.id = c.section_id
         WHERE s.team_id = $1 AND c.parent_id IS NULL AND NOT c.resolved)::int AS pending`,
    [teamId]
  );
  return { ...st, levels };
}

/** Avance hacia un logro: { current, target, pct, label } con lo que falta en palabras. */
function progressOf(a, st) {
  const of = (current, target, label) => {
    const c = Math.min(current, target);
    return { current: c, target, pct: target ? Math.round((c / target) * 100) : 0, label };
  };
  const missing = (n, one1, many) => (n === 1 ? `Falta 1 ${one1}` : `Faltan ${n} ${many}`);
  switch (a.criterion) {
    case 'first_submission': return of(st.submissions, 1, 'Envíen una sección a revisión');
    case 'first_approved': return of(st.approved, 1, 'Logren su primera sección aprobada');
    case 'sections_approved':
      return of(st.approved, a.param, `${Math.min(st.approved, a.param)} de ${a.param} secciones aprobadas`);
    case 'level_completed': {
      const lv = st.levels.find((l) => l.position === a.param);
      if (!lv) return of(0, 1, 'Nivel no disponible');
      const left = lv.total - lv.approved;
      return of(lv.approved, lv.total || 1, left > 0 ? missing(left, 'sección por aprobar', 'secciones por aprobar') : 'Nivel completo');
    }
    case 'all_levels_completed': {
      const done = st.levels.filter((l) => l.state === 'done').length;
      return of(done, st.levels.length || 1, `${done} de ${st.levels.length} niveles superados`);
    }
    case 'comments_resolved':
      return of(st.resolved, a.param, `${Math.min(st.resolved, a.param)} de ${a.param} comentarios atendidos`);
    case 'all_comments_resolved': {
      const total = st.resolved + st.pending;
      if (total === 0) return of(0, 1, 'Atiendan su primer comentario');
      return of(st.resolved, total, st.pending ? missing(st.pending, 'comentario pendiente', 'comentarios pendientes') : 'Sin pendientes');
    }
    default: return of(0, 1, '');
  }
}

router.get('/achievements', ah(async (req, res) => {
  const team = await loadTeam(req);
  const summary = await teamSummary(team.id);
  const catalog = await query(
    `SELECT a.id, a.name, a.description, a.icon, a.criterion, a.param, a.points, ta.earned_at
       FROM achievements a
       LEFT JOIN team_achievements ta ON ta.achievement_id = a.id AND ta.team_id = $1
      ORDER BY (ta.earned_at IS NULL), ta.earned_at, a.points, a.id`,
    [team.id]
  );
  const stats = await teamStats(team.id, summary.levels);
  const items = catalog.map((a) => (a.earned_at ? a : { ...a, progress: progressOf(a, stats) }));
  const pending = items.filter((a) => !a.earned_at);
  // La siguiente insignia es la pendiente más cercana a lograrse (a igual avance, la de menos puntos).
  const next = pending.slice().sort((x, y) => y.progress.pct - x.progress.pct || x.points - y.points)[0] || null;
  res.json({
    team: publicTeam(team),
    points: summary.points,
    badges_earned: summary.badges,
    badges_total: catalog.length,
    levels_done: summary.levelsDone,
    levels_total: summary.levels.length,
    next: next && { id: next.id, name: next.name, points: next.points, progress: next.progress },
    achievements: items,
  });
}));

// ---------- Selector del historial (vista 12) ----------
router.get('/history-sections', ah(async (req, res) => {
  const team = await loadTeam(req);
  const sections = await query(
    `SELECT s.id, ls.name, ls.position, l.position AS level_position, l.name AS level_name, s.status,
            (SELECT COUNT(*) FROM section_versions v WHERE v.section_id = s.id)::int AS versions
       FROM sections s
       JOIN level_sections ls ON ls.id = s.level_section_id
       JOIN levels l ON l.id = ls.level_id
      WHERE s.team_id = $1
      ORDER BY l.position, ls.position`,
    [team.id]
  );
  res.json({ team: publicTeam(team), sections });
}));

module.exports = router;
