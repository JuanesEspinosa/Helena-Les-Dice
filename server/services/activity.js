// Registro de aportes (RF-08) y notificaciones (RF-12)

/**
 * Guarda una acción en el registro inmodificable. Se llama dentro de la misma transacción
 * que la acción original: si el registro falla, la acción tampoco se confirma (RF-08).
 */
async function logActivity(client, { userId, teamId = null, sectionId = null, action, detail = '' }) {
  await client.query(
    `INSERT INTO activity_log (user_id, team_id, section_id, action, detail) VALUES ($1, $2, $3, $4, $5)`,
    [userId, teamId, sectionId, action, detail]
  );
}

/**
 * Crea avisos para varios usuarios. Usa un SAVEPOINT: si falla, el evento original se completa
 * igual (RF-12, situaciones anormales).
 */
async function notify(client, userIds, { type, title, body = '', link = '' }) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return;
  try {
    await client.query('SAVEPOINT notify_sp');
    await client.query(
      `INSERT INTO notifications (user_id, type, title, body, link)
       SELECT unnest($1::int[]), $2, $3, $4, $5`,
      [ids, type, title, body, link]
    );
    await client.query('RELEASE SAVEPOINT notify_sp');
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT notify_sp');
    console.error('[notify] no se pudo crear el aviso:', err.message);
  }
}

/** Ids de los integrantes de un equipo. */
async function teamMemberIds(client, teamId) {
  const { rows } = await client.query('SELECT user_id FROM team_members WHERE team_id = $1', [teamId]);
  return rows.map((r) => r.user_id);
}

/** Ids de todos los docentes activos (reciben avisos de secciones enviadas a revisión). */
async function teacherIds(client) {
  const { rows } = await client.query(`SELECT id FROM users WHERE role = 'docente' AND active`);
  return rows.map((r) => r.id);
}

module.exports = { logActivity, notify, teamMemberIds, teacherIds };
