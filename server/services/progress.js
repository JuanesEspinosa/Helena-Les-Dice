// Avance por niveles de un equipo (RF-04, RF-07)
const { query, one } = require('../db');
const { logActivity, notify, teamMemberIds } = require('./activity');

/**
 * Crea las secciones del equipo que todavía no existen según la plantilla de niveles.
 * Así, cuando el docente agrega una sección a un nivel, todos los equipos la reciben (RF-04).
 */
async function ensureTeamSections(teamId, client) {
  const sql = `INSERT INTO sections (team_id, level_section_id)
               SELECT $1, ls.id FROM level_sections ls
               ON CONFLICT (team_id, level_section_id) DO NOTHING`;
  if (client) await client.query(sql, [teamId]);
  else await query(sql, [teamId]);
}

/**
 * Niveles del equipo con su estado: done (todas aprobadas), current (el primero sin terminar)
 * o locked (los siguientes). Un nivel sin secciones cuenta como terminado.
 */
async function teamLevels(teamId, client) {
  const sql = `
    SELECT l.id, l.position, l.name, l.description, l.points,
           COUNT(s.id)::int AS total,
           COUNT(s.id) FILTER (WHERE s.status = 'aprobado')::int AS approved,
           COUNT(s.id) FILTER (WHERE s.status = 'revision')::int AS in_review,
           COUNT(s.id) FILTER (WHERE s.status = 'redaccion')::int AS drafting,
           COUNT(s.id) FILTER (WHERE s.status = 'devuelto')::int AS returned
      FROM levels l
      LEFT JOIN level_sections ls ON ls.level_id = l.id
      LEFT JOIN sections s ON s.level_section_id = ls.id AND s.team_id = $1
     GROUP BY l.id
     ORDER BY l.position`;
  const rows = client ? (await client.query(sql, [teamId])).rows : await query(sql, [teamId]);
  let foundCurrent = false;
  return rows.map((lv) => {
    const complete = lv.total === lv.approved;
    let state;
    if (complete && !foundCurrent) state = 'done';
    else if (!foundCurrent) {
      state = 'current';
      foundCurrent = true;
    } else state = 'locked';
    return { ...lv, state, pct: lv.total ? Math.round((lv.approved / lv.total) * 100) : 100 };
  });
}

/** Resumen global del equipo: avance, nivel actual y puntos. */
async function teamSummary(teamId) {
  const levels = await teamLevels(teamId);
  const total = levels.reduce((a, l) => a + l.total, 0);
  const approved = levels.reduce((a, l) => a + l.approved, 0);
  const current = levels.find((l) => l.state === 'current') || null;
  const levelPoints = levels.filter((l) => l.state === 'done').reduce((a, l) => a + l.points, 0);
  const ach = await one(
    `SELECT COALESCE(SUM(a.points), 0)::int AS points, COUNT(*)::int AS badges
       FROM team_achievements ta JOIN achievements a ON a.id = ta.achievement_id
      WHERE ta.team_id = $1`,
    [teamId]
  );
  return {
    levels,
    total,
    approved,
    pct: total ? Math.round((approved / total) * 100) : 0,
    current,
    levelsDone: levels.filter((l) => l.state === 'done').length,
    points: levelPoints + ach.points,
    badges: ach.badges,
  };
}

/** Indica si la sección pertenece a un nivel ya desbloqueado (no se puede saltar un nivel, RF-07). */
async function isSectionUnlocked(section, client) {
  const levels = await teamLevels(section.team_id, client);
  const lv = levels.find((l) => l.id === section.level_id);
  return Boolean(lv && lv.state !== 'locked');
}

/**
 * Tras aprobar una sección: si el nivel quedó completo, registra el nivel superado y avisa
 * al equipo que se desbloqueó el siguiente.
 */
async function afterApproval(client, teamId, levelId, userId) {
  const levels = await teamLevels(teamId, client);
  const idx = levels.findIndex((l) => l.id === levelId);
  const lv = levels[idx];
  if (!lv || lv.total !== lv.approved) return;
  await logActivity(client, { userId, teamId, action: 'nivel_superado', detail: `Nivel ${lv.position} · ${lv.name}` });
  const next = levels[idx + 1];
  const members = await teamMemberIds(client, teamId);
  await notify(client, members, {
    type: 'nivel',
    title: next ? `¡Se desbloqueó el nivel ${next.position}: ${next.name}!` : '¡Completaron todos los niveles del documento!',
    body: `Superaron el nivel ${lv.position} · ${lv.name} y ganaron ${lv.points} puntos.`,
    link: '/estudiante/tablero.html',
  });
}

module.exports = { ensureTeamSections, teamLevels, teamSummary, isSectionUnlocked, afterApproval };
