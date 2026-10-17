// Motor de logros (RF-11): se evalúa cuando cambia una sección o un comentario
const { teamLevels } = require('./progress');
const { logActivity, notify, teamMemberIds } = require('./activity');

/** Criterios disponibles. El administrador los elige en el catálogo (RF-18). */
const CRITERIA = {
  first_submission: 'Enviar la primera sección a revisión',
  first_approved: 'Lograr la primera sección aprobada',
  sections_approved: 'Aprobar N secciones',
  level_completed: 'Superar el nivel N',
  all_levels_completed: 'Superar todos los niveles',
  comments_resolved: 'Atender N comentarios',
  all_comments_resolved: 'Atender todos los comentarios pendientes',
};

/** Cifras del equipo necesarias para evaluar todos los criterios. */
async function teamStats(client, teamId) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM activity_log WHERE team_id = $1 AND action = 'envio_revision')::int AS submissions,
       (SELECT COUNT(*) FROM sections WHERE team_id = $1 AND status = 'aprobado')::int AS approved,
       (SELECT COUNT(*) FROM comments c JOIN sections s ON s.id = c.section_id
         WHERE s.team_id = $1 AND c.parent_id IS NULL AND c.resolved)::int AS resolved,
       (SELECT COUNT(*) FROM comments c JOIN sections s ON s.id = c.section_id
         WHERE s.team_id = $1 AND c.parent_id IS NULL AND NOT c.resolved)::int AS pending`,
    [teamId]
  );
  const levels = await teamLevels(teamId, client);
  return { ...rows[0], levels };
}

function meets(a, st) {
  switch (a.criterion) {
    case 'first_submission': return st.submissions >= 1;
    case 'first_approved': return st.approved >= 1;
    case 'sections_approved': return st.approved >= a.param;
    case 'level_completed': return st.levels.some((l) => l.position === a.param && l.state === 'done');
    case 'all_levels_completed': return st.levels.length > 0 && st.levels.every((l) => l.state === 'done');
    case 'comments_resolved': return st.resolved >= a.param;
    case 'all_comments_resolved': return st.resolved > 0 && st.pending === 0;
    default: return false;
  }
}

/** Otorga al equipo los logros cuyos criterios ya cumple. Nunca otorga uno dos veces. */
async function evaluateAchievements(client, teamId, userId) {
  const { rows: pending } = await client.query(
    `SELECT a.* FROM achievements a
      WHERE NOT EXISTS (SELECT 1 FROM team_achievements ta WHERE ta.team_id = $1 AND ta.achievement_id = a.id)`,
    [teamId]
  );
  if (pending.length === 0) return [];
  const st = await teamStats(client, teamId);
  const earned = [];
  for (const a of pending.filter((x) => meets(x, st))) {
    const res = await client.query(
      `INSERT INTO team_achievements (team_id, achievement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [teamId, a.id]
    );
    if (res.rowCount === 0) continue;
    earned.push(a);
    await logActivity(client, { userId, teamId, action: 'logro', detail: a.name });
    await notify(client, await teamMemberIds(client, teamId), {
      type: 'insignia',
      title: `¡Ganaron la insignia "${a.name}"!`,
      body: `${a.description} · +${a.points} puntos`,
      link: '/estudiante/logros.html',
    });
  }
  return earned;
}

module.exports = { CRITERIA, evaluateAchievements };
