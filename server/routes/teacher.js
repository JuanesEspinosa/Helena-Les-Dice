// Rutas de la docente: panel de seguimiento, equipos, niveles y comentarios (RF-03, RF-04, RF-08, RF-09, RF-10)
const express = require('express');
const { query, one, tx } = require('../db');
const { HttpError, ah, requireText, requireInt } = require('../http');
const { logActivity, notify } = require('../services/activity');
const { ensureTeamSections, teamSummary } = require('../services/progress');
const { reviewSection } = require('../services/sections');

const router = express.Router();

const INACTIVE_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const LOW_SHARE = 0.5; // participación desigual: menos del 50 % del promedio del equipo
const LOG_LIMIT = 50;
const SEARCH_LIMIT = 20;
const MAX_MEMBERS = 12;
const EXCERPT_LEN = 420;

/** Texto legible de cada acción del registro (RF-08). */
const ACTION_LABEL = {
  guardo_version: 'guardó una versión de',
  envio_revision: 'envió a revisión',
  aprobo: 'aprobó',
  devolvio: 'devolvió con observaciones',
  comento: 'comentó en',
  atendio_comentario: 'marcó como atendido un comentario de',
  asigno: 'asignó roles en',
  nivel_superado: 'completó el',
  logro: 'ganó el logro',
  creo_equipo: 'creó el equipo',
  edito_equipo: 'editó el equipo',
};
const actionLabel = (a) => ACTION_LABEL[a] || a.replace(/_/g, ' ');

// ---------- Utilidades ----------

/** Id entero positivo de la URL o del cuerpo; 400 si no es válido. */
function idParam(value, label = 'El identificador') {
  const n = requireInt(value, 'id', label);
  if (n <= 0) throw new HttpError(400, `${label} no es válido.`, 'id');
  return n;
}

/** Lista de ids enteros sin repetir (puede venir vacía). */
function idList(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'La lista de estudiantes no es válida.', field);
  const ids = [...new Set(value.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new HttpError(400, 'La lista de estudiantes no es válida.', field);
  return ids;
}

function optionalText(value, field, label, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${label} no es válido.`, field);
  const text = value.trim();
  if (text.length > max) throw new HttpError(400, `${label} es demasiado largo (máximo ${max} caracteres).`, field);
  return text;
}

function pointsValue(value) {
  const n = requireInt(value, 'points', 'Los puntos');
  if (n < 0 || n > 10000) throw new HttpError(400, 'Los puntos deben estar entre 0 y 10000.', 'points');
  return n;
}

/** Extracto en texto plano del HTML (ya limpio) de una sección. */
function excerpt(htmlText, len = EXCERPT_LEN) {
  const text = String(htmlText || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
  return text.length > len ? `${text.slice(0, len).trimEnd()}…` : text;
}

const editorLink = (sectionId) => `/editor.html?id=${sectionId}`;

async function periodsList() {
  return query(`SELECT id, name, active, start_date, end_date FROM periods ORDER BY start_date DESC`);
}

/** Periodo pedido o, si no se indica, el activo más reciente (o el último que exista). */
async function pickPeriod(periods, raw) {
  if (raw !== undefined && raw !== '') {
    const id = idParam(raw, 'El periodo');
    const p = periods.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'El periodo no existe.', 'period');
    return p;
  }
  return periods.find((p) => p.active) || periods[0] || null;
}

async function requireActivePeriod(client, periodId) {
  const { rows } = await client.query('SELECT id, name, active FROM periods WHERE id = $1', [periodId]);
  const p = rows[0];
  if (!p) throw new HttpError(400, 'El periodo académico no existe.', 'period_id');
  if (!p.active) throw new HttpError(400, 'Solo se pueden crear o modificar equipos en un periodo activo.', 'period_id');
  return p;
}

/**
 * Integrantes de varios equipos con su número de aportes (acciones en el registro del equipo),
 * última actividad y porcentaje de participación. Marca `low` si alguien tiene menos del 50 %
 * del promedio del equipo.
 */
async function memberStats(teamIds) {
  if (teamIds.length === 0) return new Map();
  const rows = await query(
    `SELECT tm.team_id, u.id, u.name, u.email,
            COUNT(a.id)::int AS contributions, MAX(a.created_at) AS last_activity,
            (SELECT COUNT(*) FROM sections s WHERE s.team_id = tm.team_id AND s.responsible_id = u.id)::int AS responsible,
            (SELECT COUNT(*) FROM sections s WHERE s.team_id = tm.team_id AND s.reviewer_id = u.id)::int AS reviewer
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       LEFT JOIN activity_log a ON a.team_id = tm.team_id AND a.user_id = tm.user_id
      WHERE tm.team_id = ANY($1::int[])
      GROUP BY tm.team_id, u.id
      ORDER BY u.name`,
    [teamIds]
  );
  const byTeam = new Map(teamIds.map((id) => [id, []]));
  rows.forEach((r) => byTeam.get(r.team_id).push(r));
  for (const members of byTeam.values()) {
    const total = members.reduce((a, m) => a + m.contributions, 0);
    const n = members.length;
    members.forEach((m) => {
      m.pct = total ? Math.round((m.contributions / total) * 100) : 0;
      m.low = n > 1 && total > 0 && m.contributions / total < LOW_SHARE / n;
      delete m.team_id;
    });
  }
  return byTeam;
}

/** Comentarios de docentes sin atender, contados por equipo. */
async function pendingTeacherComments(teamIds) {
  const rows = await query(
    `SELECT s.team_id, COUNT(*)::int AS n
       FROM comments c
       JOIN sections s ON s.id = c.section_id
       JOIN users u ON u.id = c.author_id
      WHERE s.team_id = ANY($1::int[]) AND u.role = 'docente' AND c.parent_id IS NULL AND NOT c.resolved
      GROUP BY s.team_id`,
    [teamIds]
  );
  return new Map(rows.map((r) => [r.team_id, r.n]));
}

/** Secciones en revisión de uno o varios equipos, la más antigua primero. */
async function sectionsInReview(teamIds) {
  const rows = await query(
    `SELECT s.id, s.team_id, t.name AS team_name, ls.name, l.position AS level_position, l.name AS level_name,
            ls.position AS section_position, s.updated_at, s.content,
            ru.name AS responsible_name, rv.name AS reviewer_name
       FROM sections s
       JOIN teams t ON t.id = s.team_id
       JOIN level_sections ls ON ls.id = s.level_section_id
       JOIN levels l ON l.id = ls.level_id
       LEFT JOIN users ru ON ru.id = s.responsible_id
       LEFT JOIN users rv ON rv.id = s.reviewer_id
      WHERE s.team_id = ANY($1::int[]) AND s.status = 'revision'
      ORDER BY s.updated_at ASC NULLS LAST`,
    [teamIds]
  );
  return rows.map(({ content, ...r }) => ({ ...r, code: `${r.level_position}.${r.section_position}`, excerpt: excerpt(content), link: editorLink(r.id) }));
}

const isInactive = (last) => !last || Date.now() - new Date(last).getTime() > INACTIVE_DAYS * DAY_MS;

// ---------- RF-09: panel de seguimiento ----------

router.get('/dashboard', ah(async (req, res) => {
  const periods = await periodsList();
  const period = await pickPeriod(periods, req.query.period);
  const levels = await query('SELECT id, position, name FROM levels ORDER BY position');
  const levelFilter = req.query.level ? idParam(req.query.level, 'El nivel') : null;
  const teams = period
    ? await query('SELECT id, name, project, period_id FROM teams WHERE period_id = $1 ORDER BY name', [period.id])
    : [];
  const ids = teams.map((t) => t.id);
  for (const id of ids) await ensureTeamSections(id);

  const [members, pending, review] = await Promise.all([memberStats(ids), pendingTeacherComments(ids), sectionsInReview(ids)]);
  const cards = [];
  for (const t of teams) {
    const sum = await teamSummary(t.id);
    const ms = members.get(t.id) || [];
    const last = ms.reduce((a, m) => (m.last_activity && (!a || m.last_activity > a) ? m.last_activity : a), null);
    cards.push({
      ...t,
      period_name: period.name,
      pct: sum.pct,
      approved: sum.approved,
      total: sum.total,
      current: sum.current ? { id: sum.current.id, position: sum.current.position, name: sum.current.name } : null,
      levels: sum.levels.map((l) => ({ id: l.id, position: l.position, name: l.name, approved: l.approved, total: l.total, state: l.state })),
      members: ms.map(({ id, name, contributions, pct, low }) => ({ id, name, contributions, pct, low })),
      pending_comments: pending.get(t.id) || 0,
      in_review: review.filter((r) => r.team_id === t.id).length,
      last_activity: last,
      inactive: isInactive(last),
      unequal: ms.some((m) => m.low),
    });
  }
  const students = [...members.values()].reduce((a, m) => a + m.length, 0);
  res.json({
    periods,
    period,
    levels,
    indicators: {
      teams: cards.length,
      students,
      avg_pct: cards.length ? Math.round(cards.reduce((a, c) => a + c.pct, 0) / cards.length) : 0,
      pending_comments: cards.reduce((a, c) => a + c.pending_comments, 0),
      in_review: review.length,
    },
    teams: levelFilter ? cards.filter((c) => c.current && c.current.id === levelFilter) : cards,
    to_review: review.map(({ excerpt: _e, ...r }) => r),
  });
}));

// ---------- RF-08/09/10: detalle de equipo ----------

async function loadTeam(id) {
  const team = await one(
    `SELECT t.id, t.name, t.project, t.period_id, t.created_at, p.name AS period_name, p.active AS period_active
       FROM teams t JOIN periods p ON p.id = t.period_id WHERE t.id = $1`,
    [id]
  );
  if (!team) throw new HttpError(404, 'El equipo no existe.');
  return team;
}

async function teamActivity(teamId) {
  const rows = await query(
    `SELECT a.id, a.action, a.detail, a.created_at, a.section_id, u.name AS user_name, ls.name AS section_name
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN sections s ON s.id = a.section_id
       LEFT JOIN level_sections ls ON ls.id = s.level_section_id
      WHERE a.team_id = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${LOG_LIMIT}`,
    [teamId]
  );
  return rows.map((r) => ({
    id: r.id,
    user_name: r.user_name || 'Sistema',
    action: r.action,
    label: actionLabel(r.action),
    target: r.detail || r.section_name || '',
    section_id: r.section_id,
    created_at: r.created_at,
  }));
}

/** Comentarios de docentes que el equipo todavía no ha atendido. */
async function teamPendingComments(teamId) {
  return query(
    `SELECT c.id, c.body, c.quote, c.created_at, c.section_id, u.name AS author_name, ls.name AS section_name,
            l.position || '.' || ls.position AS code
       FROM comments c
       JOIN users u ON u.id = c.author_id
       JOIN sections s ON s.id = c.section_id
       JOIN level_sections ls ON ls.id = s.level_section_id
       JOIN levels l ON l.id = ls.level_id
      WHERE s.team_id = $1 AND u.role = 'docente' AND c.parent_id IS NULL AND NOT c.resolved
      ORDER BY c.created_at DESC`,
    [teamId]
  );
}

router.get('/teams/:id', ah(async (req, res) => {
  const team = await loadTeam(idParam(req.params.id, 'El equipo'));
  await ensureTeamSections(team.id);
  const sum = await teamSummary(team.id);
  const [members, log, review, comments] = await Promise.all([
    memberStats([team.id]), teamActivity(team.id), sectionsInReview([team.id]), teamPendingComments(team.id),
  ]);
  res.json({
    team,
    summary: {
      pct: sum.pct, approved: sum.approved, total: sum.total, points: sum.points, badges: sum.badges,
      current: sum.current ? { id: sum.current.id, position: sum.current.position, name: sum.current.name } : null,
      levels_count: sum.levels.length,
    },
    levels: sum.levels.map((l) => ({ id: l.id, position: l.position, name: l.name, approved: l.approved, total: l.total, in_review: l.in_review, state: l.state, pct: l.pct })),
    members: members.get(team.id) || [],
    activity: log,
    in_review: review,
    pending_comments: comments.map((c) => ({ ...c, link: editorLink(c.section_id) })),
  });
}));

// ---------- RF-03: equipos ----------

router.get('/teams', ah(async (req, res) => {
  const periods = await periodsList();
  const period = await pickPeriod(periods, req.query.period);
  if (!period) return res.json({ periods, period: null, teams: [], summary: { teams: 0, students: 0, without_team: 0 } });
  const teams = await query(
    `SELECT t.id, t.name, t.project, t.period_id, p.name AS period_name, p.active AS period_active
       FROM teams t JOIN periods p ON p.id = t.period_id WHERE t.period_id = $1 ORDER BY t.name`,
    [period.id]
  );
  const ids = teams.map((t) => t.id);
  const members = await memberStats(ids);
  const out = [];
  for (const t of teams) {
    await ensureTeamSections(t.id);
    const sum = await teamSummary(t.id);
    out.push({
      ...t,
      pct: sum.pct,
      current: sum.current ? { id: sum.current.id, position: sum.current.position, name: sum.current.name } : null,
      members: (members.get(t.id) || []).map(({ id, name, email, contributions }) => ({ id, name, email, contributions })),
    });
  }
  const free = await one(
    `SELECT COUNT(*)::int AS n FROM users u
      WHERE u.role = 'estudiante' AND u.active
        AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id = u.id AND tm.period_id = $1)`,
    [period.id]
  );
  res.json({
    periods,
    period,
    teams: out,
    summary: { teams: out.length, students: out.reduce((a, t) => a + t.members.length, 0), without_team: free.n },
  });
}));

router.get('/students', ah(async (req, res) => {
  const periods = await periodsList();
  const period = await pickPeriod(periods, req.query.period);
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await query(
    `SELECT u.id, u.name, u.email, t.id AS team_id, t.name AS team_name
       FROM users u
       LEFT JOIN team_members tm ON tm.user_id = u.id AND tm.period_id = $2
       LEFT JOIN teams t ON t.id = tm.team_id
      WHERE u.role = 'estudiante' AND u.active AND (u.name ILIKE $1 OR u.email ILIKE $1)
      ORDER BY (t.id IS NOT NULL), u.name
      LIMIT ${SEARCH_LIMIT}`,
    [like, period ? period.id : null]
  );
  res.json({ period, students: rows });
}));

/** Nombre único del equipo dentro del periodo. */
async function assertTeamName(client, name, periodId, exceptId = 0) {
  const { rows } = await client.query('SELECT 1 FROM teams WHERE lower(name) = lower($1) AND period_id = $2 AND id <> $3', [name, periodId, exceptId]);
  if (rows.length) throw new HttpError(409, 'Ya existe un equipo con ese nombre en el periodo.', 'name');
}

/**
 * Agrega estudiantes al equipo. Un estudiante que ya está en otro equipo del periodo no se
 * agrega y se devuelve en `skipped` con el aviso para la docente (RF-03).
 */
async function addMembers(client, team, period, studentIds) {
  const added = [];
  const skipped = [];
  if (studentIds.length === 0) return { added, skipped };
  const { rows: users } = await client.query(
    `SELECT u.id, u.name, u.role, u.active, t.id AS team_id, t.name AS team_name
       FROM users u
       LEFT JOIN team_members tm ON tm.user_id = u.id AND tm.period_id = $2
       LEFT JOIN teams t ON t.id = tm.team_id
      WHERE u.id = ANY($1::int[])`,
    [studentIds, period.id]
  );
  for (const id of studentIds) {
    const u = users.find((x) => x.id === id);
    if (!u || u.role !== 'estudiante' || !u.active) {
      skipped.push({ id, name: u ? u.name : `Usuario ${id}`, message: `${u ? u.name : 'El usuario'} no es un estudiante activo. No se agregó.` });
      continue;
    }
    if (u.team_id === team.id) continue;
    if (u.team_id) {
      skipped.push({ id, name: u.name, message: `${u.name} ya pertenece al ${u.team_name} en el periodo ${period.name}. No se agregó.` });
      continue;
    }
    const r = await client.query(
      `INSERT INTO team_members (team_id, user_id, period_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [team.id, id, period.id]
    );
    if (r.rowCount === 0) {
      skipped.push({ id, name: u.name, message: `${u.name} ya pertenece a otro equipo en el periodo ${period.name}. No se agregó.` });
    } else added.push({ id, name: u.name });
  }
  if (added.length) {
    await notify(client, added.map((a) => a.id), {
      type: 'equipo',
      title: `Te agregaron al ${team.name}`,
      body: `Ahora formas parte del ${team.name} en el periodo ${period.name}.`,
      link: '/estudiante/tablero.html',
    });
  }
  return { added, skipped };
}

/** Quita integrantes que todavía no tienen aportes; a los que sí tienen los deja con un aviso. */
async function removeMembers(client, team, studentIds) {
  const removed = [];
  const kept = [];
  if (studentIds.length === 0) return { removed, kept };
  const { rows } = await client.query(
    `SELECT u.id, u.name,
            (SELECT COUNT(*) FROM activity_log a WHERE a.team_id = $1 AND a.user_id = u.id)::int AS contributions
       FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1 AND tm.user_id = ANY($2::int[])`,
    [team.id, studentIds]
  );
  for (const m of rows) {
    if (m.contributions > 0) {
      kept.push({ id: m.id, name: m.name, message: `${m.name} ya tiene ${m.contributions} aporte(s) en el equipo y no se puede quitar.` });
      continue;
    }
    await client.query('UPDATE sections SET responsible_id = NULL WHERE team_id = $1 AND responsible_id = $2', [team.id, m.id]);
    await client.query('UPDATE sections SET reviewer_id = NULL WHERE team_id = $1 AND reviewer_id = $2', [team.id, m.id]);
    await client.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [team.id, m.id]);
    removed.push({ id: m.id, name: m.name });
  }
  return { removed, kept };
}

router.post('/teams', ah(async (req, res) => {
  const name = requireText(req.body.name, 'name', 'El nombre del equipo', 80);
  const project = optionalText(req.body.project, 'project', 'El proyecto', 160);
  const periodId = idParam(req.body.period_id, 'El periodo académico');
  const studentIds = idList(req.body.student_ids, 'student_ids');
  if (studentIds.length > MAX_MEMBERS) throw new HttpError(400, `Un equipo puede tener como máximo ${MAX_MEMBERS} integrantes.`, 'student_ids');
  const user = req.session.user;

  const result = await tx(async (client) => {
    const period = await requireActivePeriod(client, periodId);
    await assertTeamName(client, name, period.id);
    const { rows } = await client.query(
      `INSERT INTO teams (name, project, period_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id, name, project, period_id`,
      [name, project, period.id, user.id]
    );
    const team = rows[0];
    const { added, skipped } = await addMembers(client, team, period, studentIds);
    await ensureTeamSections(team.id, client);
    // El registro va sin team_id: es una acción de la docente, no un aporte del equipo
    await logActivity(client, {
      userId: user.id, action: 'creo_equipo',
      detail: `${team.name} (id ${team.id}) · periodo ${period.name} · ${added.length} integrante(s)`,
    });
    return { team: { ...team, period_name: period.name }, added, skipped };
  });
  res.status(201).json(result);
}));

router.put('/teams/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'El equipo');
  const name = requireText(req.body.name, 'name', 'El nombre del equipo', 80);
  const project = optionalText(req.body.project, 'project', 'El proyecto', 160);
  const addIds = idList(req.body.add_ids, 'student_ids');
  const removeIds = idList(req.body.remove_ids, 'student_ids').filter((x) => !addIds.includes(x));
  const user = req.session.user;

  const result = await tx(async (client) => {
    const { rows } = await client.query('SELECT id, name, project, period_id FROM teams WHERE id = $1 FOR UPDATE', [id]);
    const current = rows[0];
    if (!current) throw new HttpError(404, 'El equipo no existe.');
    const period = await requireActivePeriod(client, current.period_id);
    await assertTeamName(client, name, period.id, id);
    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS n FROM team_members WHERE team_id = $1', [id]);
    if (countRows[0].n + addIds.length - removeIds.length > MAX_MEMBERS) {
      throw new HttpError(400, `Un equipo puede tener como máximo ${MAX_MEMBERS} integrantes.`, 'student_ids');
    }
    await client.query('UPDATE teams SET name = $1, project = $2 WHERE id = $3', [name, project, id]);
    const team = { ...current, name, project };
    const { removed, kept } = await removeMembers(client, team, removeIds);
    const { added, skipped } = await addMembers(client, team, period, addIds);
    await logActivity(client, {
      userId: user.id, action: 'edito_equipo',
      detail: `${name} (id ${id}) · +${added.length} / -${removed.length} integrante(s)`,
    });
    return { team: { ...team, period_name: period.name }, added, removed, skipped: [...skipped, ...kept] };
  });
  res.json(result);
}));

// ---------- RF-04: niveles ----------

/** Equipos que ya empezaron cada nivel (alguna sección con contenido o fuera de "en redacción"). */
async function levelsWithUsage(client) {
  const run = (sql, p) => (client ? client.query(sql, p).then((r) => r.rows) : query(sql, p));
  const levels = await run(
    `SELECT l.id, l.position, l.name, l.description, l.points,
            (SELECT COUNT(DISTINCT s.team_id) FROM sections s JOIN level_sections ls ON ls.id = s.level_section_id
              WHERE ls.level_id = l.id AND (s.content <> '' OR s.status <> 'redaccion'))::int AS teams_started
       FROM levels l ORDER BY l.position`
  );
  const sections = await run(
    `SELECT ls.id, ls.level_id, ls.position, ls.name,
            (SELECT COUNT(DISTINCT s.team_id) FROM sections s
              WHERE s.level_section_id = ls.id AND (s.content <> '' OR s.status <> 'redaccion'))::int AS teams_started
       FROM level_sections ls ORDER BY ls.level_id, ls.position, ls.id`
  );
  return levels.map((l) => ({ ...l, sections: sections.filter((s) => s.level_id === l.id).map(({ level_id: _l, ...s }) => s) }));
}

router.get('/levels', ah(async (_req, res) => {
  res.json({ levels: await levelsWithUsage() });
}));

/** Reasigna posiciones 1..n consecutivas (la restricción UNIQUE es diferida). */
async function renumberLevels(client, orderedIds) {
  await client.query(
    `UPDATE levels SET position = x.pos FROM unnest($1::int[]) WITH ORDINALITY AS x(id, pos) WHERE levels.id = x.id`,
    [orderedIds]
  );
}

router.post('/levels', ah(async (req, res) => {
  const name = requireText(req.body.name, 'name', 'El nombre del nivel', 120);
  const description = optionalText(req.body.description, 'description', 'La descripción', 2000);
  const points = req.body.points === undefined || req.body.points === '' ? 100 : pointsValue(req.body.points);
  const level = await tx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO levels (position, name, description, points)
       VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM levels), $1, $2, $3) RETURNING *`,
      [name, description, points]
    );
    await logActivity(client, { userId: req.session.user.id, action: 'creo_nivel', detail: `Nivel ${rows[0].position} · ${name}` });
    return rows[0];
  });
  res.status(201).json({ level: { ...level, teams_started: 0, sections: [] } });
}));

router.put('/levels/order', ah(async (req, res) => {
  const ids = idList(req.body.ids, 'ids');
  const levels = await tx(async (client) => {
    const { rows } = await client.query('SELECT id FROM levels FOR UPDATE');
    const all = rows.map((r) => r.id);
    if (ids.length !== all.length || !all.every((x) => ids.includes(x))) {
      throw new HttpError(400, 'El nuevo orden debe incluir todos los niveles una sola vez.', 'ids');
    }
    await renumberLevels(client, ids);
    await logActivity(client, { userId: req.session.user.id, action: 'ordeno_niveles', detail: `Orden: ${ids.join(', ')}` });
    return levelsWithUsage(client);
  });
  res.json({ levels });
}));

/** Valida la lista de secciones del cuerpo: [{ id?, name }]. */
function parseSections(value) {
  if (!Array.isArray(value)) throw new HttpError(400, 'La lista de secciones no es válida.', 'sections');
  if (value.length > 50) throw new HttpError(400, 'Un nivel puede tener como máximo 50 secciones.', 'sections');
  return value.map((s, i) => {
    const name = typeof s?.name === 'string' ? s.name.trim() : '';
    if (!name) throw new HttpError(400, `La sección ${i + 1} no tiene nombre.`, 'sections');
    if (name.length > 160) throw new HttpError(400, `El nombre de la sección ${i + 1} es demasiado largo.`, 'sections');
    const id = s.id === undefined || s.id === null || s.id === '' ? null : Number(s.id);
    if (id !== null && (!Number.isInteger(id) || id <= 0)) throw new HttpError(400, 'La lista de secciones no es válida.', 'sections');
    return { id, name };
  });
}

/** 409 si alguna sección que se quiere quitar ya tiene trabajo de algún equipo. */
async function assertRemovable(client, sectionIds) {
  if (sectionIds.length === 0) return;
  const { rows } = await client.query(
    `SELECT ls.name, COUNT(DISTINCT s.team_id)::int AS teams
       FROM level_sections ls JOIN sections s ON s.level_section_id = ls.id
      WHERE ls.id = ANY($1::int[])
        AND (s.content <> '' OR s.status <> 'redaccion'
             OR EXISTS (SELECT 1 FROM activity_log a WHERE a.section_id = s.id)
             OR EXISTS (SELECT 1 FROM comments c WHERE c.section_id = s.id))
      GROUP BY ls.id, ls.name`,
    [sectionIds]
  );
  if (rows.length) {
    const r = rows[0];
    throw new HttpError(409, `No se puede quitar la sección "${r.name}": ${r.teams} equipo(s) ya tienen contenido o actividad en ella.`, 'sections');
  }
}

router.put('/levels/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'El nivel');
  const name = requireText(req.body.name, 'name', 'El nombre del nivel', 120);
  const description = optionalText(req.body.description, 'description', 'La descripción', 2000);
  const points = pointsValue(req.body.points);
  const wanted = parseSections(req.body.sections ?? []);

  const levels = await tx(async (client) => {
    const { rows } = await client.query('SELECT id, position FROM levels WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw new HttpError(404, 'El nivel no existe.');
    const { rows: existing } = await client.query('SELECT id FROM level_sections WHERE level_id = $1', [id]);
    const existingIds = existing.map((r) => r.id);
    const foreign = wanted.find((s) => s.id !== null && !existingIds.includes(s.id));
    if (foreign) throw new HttpError(400, 'Una de las secciones no pertenece a este nivel.', 'sections');
    const keep = wanted.filter((s) => s.id !== null).map((s) => s.id);
    const toRemove = existingIds.filter((x) => !keep.includes(x));
    await assertRemovable(client, toRemove);

    await client.query('UPDATE levels SET name = $1, description = $2, points = $3 WHERE id = $4', [name, description, points, id]);
    if (toRemove.length) await client.query('DELETE FROM level_sections WHERE id = ANY($1::int[])', [toRemove]);
    for (const [i, s] of wanted.entries()) {
      if (s.id) await client.query('UPDATE level_sections SET name = $1, position = $2 WHERE id = $3', [s.name, i + 1, s.id]);
      else await client.query('INSERT INTO level_sections (level_id, position, name) VALUES ($1, $2, $3)', [id, i + 1, s.name]);
    }
    // Las secciones nuevas llegan de inmediato a todos los equipos (RF-04)
    await client.query(
      `INSERT INTO sections (team_id, level_section_id)
       SELECT t.id, ls.id FROM teams t CROSS JOIN level_sections ls WHERE ls.level_id = $1
       ON CONFLICT (team_id, level_section_id) DO NOTHING`,
      [id]
    );
    await logActivity(client, {
      userId: req.session.user.id, action: 'edito_nivel',
      detail: `Nivel ${rows[0].position} · ${name} · ${wanted.length} sección(es), ${toRemove.length} quitada(s)`,
    });
    return levelsWithUsage(client);
  });
  res.json({ levels });
}));

router.delete('/levels/:id', ah(async (req, res) => {
  const id = idParam(req.params.id, 'El nivel');
  const levels = await tx(async (client) => {
    const { rows } = await client.query('SELECT id, position, name FROM levels WHERE id = $1 FOR UPDATE', [id]);
    const level = rows[0];
    if (!level) throw new HttpError(404, 'El nivel no existe.');
    const usage = (await levelsWithUsage(client)).find((l) => l.id === id);
    if (usage.teams_started > 0) {
      throw new HttpError(409, `No se puede eliminar el nivel: ${usage.teams_started} equipo(s) ya están trabajando en él.`);
    }
    await assertRemovable(client, usage.sections.map((s) => s.id));
    await client.query('DELETE FROM levels WHERE id = $1', [id]);
    const { rows: rest } = await client.query('SELECT id FROM levels ORDER BY position');
    await renumberLevels(client, rest.map((r) => r.id));
    await logActivity(client, { userId: req.session.user.id, action: 'elimino_nivel', detail: `Nivel ${level.position} · ${level.name}` });
    return levelsWithUsage(client);
  });
  res.json({ levels });
}));

// ---------- RF-10: comentarios de las docentes ----------

router.get('/comments', ah(async (req, res) => {
  const status = req.query.status === 'all' ? 'all' : 'pending';
  const rows = await query(
    `SELECT c.id, c.body, c.quote, c.resolved, c.resolved_at, c.created_at, c.section_id,
            u.name AS author_name, ru.name AS resolved_by_name,
            ls.name AS section_name, l.position || '.' || ls.position AS code, s.status AS section_status,
            t.id AS team_id, t.name AS team_name, p.name AS period_name,
            (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id)::int AS replies
       FROM comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN users ru ON ru.id = c.resolved_by
       JOIN sections s ON s.id = c.section_id
       JOIN level_sections ls ON ls.id = s.level_section_id
       JOIN levels l ON l.id = ls.level_id
       JOIN teams t ON t.id = s.team_id
       JOIN periods p ON p.id = t.period_id
      WHERE u.role = 'docente' AND c.parent_id IS NULL AND ($1 = 'all' OR NOT c.resolved)
      ORDER BY c.resolved, c.created_at DESC
      LIMIT 300`,
    [status]
  );
  const counts = await one(
    `SELECT COUNT(*) FILTER (WHERE NOT c.resolved)::int AS pending, COUNT(*)::int AS total
       FROM comments c JOIN users u ON u.id = c.author_id
      WHERE u.role = 'docente' AND c.parent_id IS NULL`
  );
  res.json({ status, counts, comments: rows.map((c) => ({ ...c, link: editorLink(c.section_id) })) });
}));

// ---------- RF-07: atajo de revisión desde el detalle de equipo ----------

router.post('/sections/:id/review', ah(async (req, res) => {
  const id = idParam(req.params.id, 'La sección');
  const result = await reviewSection(req.session.user, id, req.body.decision, req.body.observation);
  res.json(result);
}));

module.exports = router;
