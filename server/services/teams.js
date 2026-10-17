// Consultas de equipos y control de acceso a sus datos (RNF-07)
const { one, query } = require('../db');
const { HttpError } = require('../http');

/** Equipo del estudiante en el periodo activo más reciente (o el último que tuvo). */
async function studentTeam(userId) {
  return one(
    `SELECT t.*, p.name AS period_name, p.active AS period_active
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       JOIN periods p ON p.id = t.period_id
      WHERE tm.user_id = $1
      ORDER BY p.active DESC, p.start_date DESC
      LIMIT 1`,
    [userId]
  );
}

/** Igual que studentTeam pero lanza 404 si el estudiante no tiene equipo. */
async function requireStudentTeam(userId) {
  const team = await studentTeam(userId);
  if (!team) throw new HttpError(404, 'Todavía no perteneces a ningún equipo. Pídele a la docente que te agregue.');
  return team;
}

async function teamMembers(teamId) {
  return query(
    `SELECT u.id, u.name, u.email FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = $1 ORDER BY u.name`,
    [teamId]
  );
}

/**
 * Carga una sección con su nivel y verifica que el usuario pueda verla:
 * el estudiante solo ve las de su equipo; docente y administrador ven todas.
 */
async function loadSectionFor(user, sectionId, client) {
  const sql = `
    SELECT s.*, ls.name, ls.position AS section_position, ls.level_id,
           l.name AS level_name, l.position AS level_position,
           ru.name AS responsible_name, rv.name AS reviewer_name, t.name AS team_name
      FROM sections s
      JOIN level_sections ls ON ls.id = s.level_section_id
      JOIN levels l ON l.id = ls.level_id
      JOIN teams t ON t.id = s.team_id
      LEFT JOIN users ru ON ru.id = s.responsible_id
      LEFT JOIN users rv ON rv.id = s.reviewer_id
     WHERE s.id = $1`;
  const section = client ? (await client.query(sql, [sectionId])).rows[0] : await one(sql, [sectionId]);
  if (!section) throw new HttpError(404, 'La sección no existe.');
  if (user.role === 'estudiante') {
    const member = await one('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [section.team_id, user.id]);
    if (!member) throw new HttpError(403, 'Solo puedes ver las secciones de tu equipo.');
  }
  return section;
}

module.exports = { studentTeam, requireStudentTeam, teamMembers, loadSectionFor };
