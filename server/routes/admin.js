// Rutas del administrador (RF-02, RF-16, RF-17, RF-18, RF-19). Montadas en /api/admin.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, one, tx } = require('../db');
const { HttpError, ah, requireText, requireEmail, requireInt } = require('../http');
const { logActivity } = require('../services/activity');
const { CRITERIA } = require('../services/achievements');
const { createBackup, backupFilePath, lastAutomatic, WEEK_MS } = require('../services/backup');

const router = express.Router();

const ROLES = ['estudiante', 'docente', 'administrador'];
const PARAM_CRITERIA = ['sections_approved', 'level_completed', 'comments_resolved'];
const MAX_ICON_BYTES = 200 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Claves de íconos disponibles en el front (PATHS de public/js/core/ui.js). */
const ICON_NAMES = (() => {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'core', 'ui.js'), 'utf8');
    const block = src.slice(src.indexOf('const PATHS = {'), src.indexOf('\n};', src.indexOf('const PATHS = {')));
    const keys = [...block.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]);
    if (keys.length) return new Set(keys);
  } catch { /* se usa la lista mínima */ }
  return new Set(['medal', 'trophy', 'star', 'flag', 'target', 'rocket', 'sparkles', 'message', 'checkCircle', 'zap', 'book', 'shield']);
})();

const me = (req) => req.session.user;
const idParam = (req) => requireInt(req.params.id, 'id', 'El identificador');

// =====================================================================
// Panel (RF-16)
// =====================================================================

router.get('/dashboard', ah(async (req, res) => {
  const myId = me(req).id;
  const counts = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE active)::int AS active,
            COUNT(*) FILTER (WHERE NOT active)::int AS inactive,
            COUNT(*) FILTER (WHERE role = 'estudiante')::int AS estudiante,
            COUNT(*) FILTER (WHERE role = 'docente')::int AS docente,
            COUNT(*) FILTER (WHERE role = 'administrador')::int AS administrador,
            COUNT(*) FILTER (WHERE id <> $1)::int AS others
       FROM users`,
    [myId]
  );
  const empty = counts.others === 0;
  const zero = { estudiante: 0, docente: 0, administrador: 0 };
  const period = await one(`SELECT name FROM periods WHERE active ORDER BY start_date DESC LIMIT 1`);
  const recent = empty ? [] : await query(
    `SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC, id DESC LIMIT 6`
  );
  const last = await lastAutomatic();
  res.json({
    empty,
    total: empty ? 0 : counts.total,
    active: empty ? 0 : counts.active,
    inactive: empty ? 0 : counts.inactive,
    byRole: empty ? zero : { estudiante: counts.estudiante, docente: counts.docente, administrador: counts.administrador },
    period: period ? period.name : null,
    recent,
    platform: {
      online: true,
      lastAutomatic: last,
      nextAutomatic: last ? new Date(last.getTime() + WEEK_MS) : null,
    },
  });
}));

// =====================================================================
// Usuarios (RF-02)
// =====================================================================

/** Contraseña temporal legible: 10 caracteres sin letras ambiguas y con al menos un número. */
function tempPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pwd = '';
  while (!/\d/.test(pwd) || !/[a-z]/i.test(pwd)) {
    pwd = Array.from({ length: 10 }, () => chars[crypto.randomInt(chars.length)]).join('');
  }
  return pwd;
}

function userInput(body) {
  const name = requireText(body.name, 'name', 'El nombre', 120);
  const email = requireEmail(body.email);
  if (!ROLES.includes(body.role)) throw new HttpError(400, 'Selecciona un tipo de usuario válido.', 'role');
  return { name, email, role: body.role };
}

async function ensureEmailFree(client, email, exceptId = 0) {
  const { rows } = await client.query('SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [email, exceptId]);
  if (rows.length) throw new HttpError(409, 'Ya existe una cuenta con este correo.', 'email');
}

async function findUser(client, id) {
  const { rows } = await client.query('SELECT id, name, email, role, active FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw new HttpError(404, 'La cuenta no existe.');
  return rows[0];
}

const HAS_CONTRIBUTIONS = `EXISTS (SELECT 1 FROM activity_log a WHERE a.user_id = u.id AND a.action <> 'inicio_sesion')`;

router.get('/users', ah(async (req, res) => {
  const where = [];
  const params = [];
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (ROLES.includes(req.query.role)) {
    params.push(req.query.role);
    where.push(`u.role = $${params.length}`);
  }
  if (req.query.status === 'activo') where.push('u.active');
  if (req.query.status === 'inactivo') where.push('NOT u.active');
  const users = await query(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.last_login, u.created_at, ${HAS_CONTRIBUTIONS} AS has_contributions
       FROM users u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.active DESC, u.name`,
    params
  );
  const counts = await one(
    `SELECT COUNT(*) FILTER (WHERE role = 'estudiante')::int AS estudiante,
            COUNT(*) FILTER (WHERE role = 'docente')::int AS docente,
            COUNT(*) FILTER (WHERE role = 'administrador')::int AS administrador,
            COUNT(*) FILTER (WHERE NOT active)::int AS inactive
       FROM users`
  );
  res.json({ users, counts, me: me(req).id });
}));

router.post('/users', ah(async (req, res) => {
  const data = userInput(req.body);
  const password = tempPassword();
  const hash = await bcrypt.hash(password, 10);
  const user = await tx(async (client) => {
    await ensureEmailFree(client, data.email);
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password)
       VALUES ($1, $2, $3, $4, TRUE) RETURNING id, name, email, role, active, created_at`,
      [data.name, data.email, hash, data.role]
    );
    await logActivity(client, { userId: me(req).id, action: 'creo_usuario', detail: `${data.email} (${data.role})` });
    return rows[0];
  });
  // La contraseña temporal se devuelve una única vez para que el administrador la comunique
  res.status(201).json({ user, tempPassword: password });
}));

router.put('/users/:id', ah(async (req, res) => {
  const id = idParam(req);
  const data = userInput(req.body);
  if (id === me(req).id && data.role !== 'administrador') {
    throw new HttpError(400, 'No puedes quitarte a ti mismo el rol de administrador.', 'role');
  }
  const user = await tx(async (client) => {
    await findUser(client, id);
    await ensureEmailFree(client, data.email, id);
    const { rows } = await client.query(
      `UPDATE users SET name = $1, email = $2, role = $3 WHERE id = $4 RETURNING id, name, email, role, active`,
      [data.name, data.email, data.role, id]
    );
    await logActivity(client, { userId: me(req).id, action: 'edito_usuario', detail: data.email });
    return rows[0];
  });
  if (id === me(req).id) req.session.user = { ...req.session.user, name: user.name, email: user.email };
  res.json({ user });
}));

async function setActive(req, active) {
  const id = idParam(req);
  if (!active && id === me(req).id) throw new HttpError(400, 'No puedes desactivar tu propia cuenta.');
  return tx(async (client) => {
    const u = await findUser(client, id);
    await client.query('UPDATE users SET active = $1, failed_attempts = 0, locked_until = NULL WHERE id = $2', [active, id]);
    // Una cuenta desactivada pierde sus sesiones abiertas
    if (!active) await client.query(`DELETE FROM session WHERE sess->'user'->>'id' = $1`, [String(id)]);
    await logActivity(client, { userId: me(req).id, action: active ? 'reactivo_usuario' : 'desactivo_usuario', detail: u.email });
    return { id, active };
  });
}

router.post('/users/:id/deactivate', ah(async (req, res) => res.json(await setActive(req, false))));
router.post('/users/:id/reactivate', ah(async (req, res) => res.json(await setActive(req, true))));

router.delete('/users/:id', ah(async (req, res) => {
  const id = idParam(req);
  if (id === me(req).id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta.');
  await tx(async (client) => {
    const u = await findUser(client, id);
    const { rows } = await client.query(`SELECT ${HAS_CONTRIBUTIONS} AS has FROM users u WHERE u.id = $1`, [id]);
    if (rows[0].has) {
      throw new HttpError(409, 'La cuenta tiene aportes registrados; solo se puede desactivar para conservar el historial.');
    }
    await client.query('SAVEPOINT del_user');
    try {
      await client.query('DELETE FROM users WHERE id = $1', [id]);
    } catch (err) {
      if (err.code !== '23503') throw err;
      await client.query('ROLLBACK TO SAVEPOINT del_user');
      throw new HttpError(409, 'La cuenta está vinculada a equipos o a registros de acceso; solo se puede desactivar para conservar el historial.');
    }
    await logActivity(client, { userId: me(req).id, action: 'elimino_usuario', detail: u.email });
  });
  res.json({ deleted: true });
}));

router.post('/users/:id/reset-password', ah(async (req, res) => {
  const id = idParam(req);
  const password = tempPassword();
  const hash = await bcrypt.hash(password, 10);
  await tx(async (client) => {
    const u = await findUser(client, id);
    await client.query(
      `UPDATE users SET password_hash = $1, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL WHERE id = $2`,
      [hash, id]
    );
    await logActivity(client, { userId: me(req).id, action: 'restablecio_clave_usuario', detail: u.email });
  });
  res.json({ tempPassword: password });
}));

// =====================================================================
// Periodos académicos (RF-17)
// =====================================================================

const PERIOD_COLS = `p.id, p.name, to_char(p.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(p.end_date, 'YYYY-MM-DD') AS end_date, p.active, p.created_at`;

function validDate(value, field, label) {
  const ok = typeof value === 'string' && DATE_RE.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().startsWith(value);
  if (!ok) throw new HttpError(400, `${label} no es válida.`, field);
  return value;
}

function periodInput(body) {
  const name = requireText(body.name, 'name', 'El nombre del periodo', 20);
  const start = validDate(body.start_date, 'start_date', 'La fecha de inicio');
  const end = validDate(body.end_date, 'end_date', 'La fecha de fin');
  if (end <= start) throw new HttpError(400, 'La fecha de fin debe ser posterior a la de inicio.', 'end_date');
  return { name, start, end, active: body.active === true || body.active === 'true' || body.active === 'on' };
}

async function ensurePeriodNameFree(client, name, exceptId = 0) {
  const { rows } = await client.query('SELECT 1 FROM periods WHERE lower(name) = lower($1) AND id <> $2', [name, exceptId]);
  if (rows.length) throw new HttpError(409, `Ya existe un periodo con el nombre ${name}.`, 'name');
}

async function findPeriod(client, id) {
  const { rows } = await client.query(
    `SELECT ${PERIOD_COLS}, (SELECT COUNT(*) FROM teams t WHERE t.period_id = p.id)::int AS teams FROM periods p WHERE p.id = $1`,
    [id]
  );
  if (!rows[0]) throw new HttpError(404, 'El periodo no existe.');
  return rows[0];
}

router.get('/periods', ah(async (_req, res) => {
  const periods = await query(
    `SELECT ${PERIOD_COLS}, (SELECT COUNT(*) FROM teams t WHERE t.period_id = p.id)::int AS teams
       FROM periods p ORDER BY p.start_date DESC`
  );
  res.json({ periods });
}));

router.post('/periods', ah(async (req, res) => {
  const d = periodInput(req.body);
  const period = await tx(async (client) => {
    await ensurePeriodNameFree(client, d.name);
    const { rows } = await client.query(
      'INSERT INTO periods (name, start_date, end_date, active) VALUES ($1, $2, $3, $4) RETURNING id',
      [d.name, d.start, d.end, d.active]
    );
    await logActivity(client, { userId: me(req).id, action: 'creo_periodo', detail: d.name });
    return findPeriod(client, rows[0].id);
  });
  res.status(201).json({ period });
}));

router.put('/periods/:id', ah(async (req, res) => {
  const id = idParam(req);
  const d = periodInput(req.body);
  const period = await tx(async (client) => {
    await findPeriod(client, id);
    await ensurePeriodNameFree(client, d.name, id);
    await client.query(
      'UPDATE periods SET name = $1, start_date = $2, end_date = $3, active = $4 WHERE id = $5',
      [d.name, d.start, d.end, d.active, id]
    );
    await logActivity(client, { userId: me(req).id, action: 'edito_periodo', detail: d.name });
    return findPeriod(client, id);
  });
  res.json({ period });
}));

router.post('/periods/:id/toggle', ah(async (req, res) => {
  const id = idParam(req);
  const period = await tx(async (client) => {
    const p = await findPeriod(client, id);
    await client.query('UPDATE periods SET active = NOT active WHERE id = $1', [id]);
    await logActivity(client, { userId: me(req).id, action: p.active ? 'inactivo_periodo' : 'activo_periodo', detail: p.name });
    return findPeriod(client, id);
  });
  res.json({ period });
}));

router.delete('/periods/:id', ah(async (req, res) => {
  const id = idParam(req);
  await tx(async (client) => {
    const p = await findPeriod(client, id);
    if (p.teams > 0) {
      const n = p.teams === 1 ? '1 equipo' : `${p.teams} equipos`;
      throw new HttpError(409, `No se puede eliminar el periodo ${p.name} porque tiene ${n} con avances registrados. Puedes dejarlo inactivo para conservar el historial.`);
    }
    await client.query('DELETE FROM periods WHERE id = $1', [id]);
    await logActivity(client, { userId: me(req).id, action: 'elimino_periodo', detail: p.name });
  });
  res.json({ deleted: true });
}));

// =====================================================================
// Catálogo de logros (RF-18)
// =====================================================================

/** Valida el ícono: clave conocida o imagen PNG/SVG en data URI de máximo 200 KB. */
function validIcon(value) {
  if (typeof value !== 'string' || !value) return 'medal';
  if (ICON_NAMES.has(value)) return value;
  const m = /^data:image\/(png|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m) throw new HttpError(400, 'El ícono debe ser una imagen PNG o SVG.', 'icon');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_ICON_BYTES) throw new HttpError(400, 'El ícono supera el máximo de 200 KB.', 'icon');
  if (m[1] === 'png' && buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new HttpError(400, 'El archivo no es una imagen PNG válida.', 'icon');
  }
  if (m[1] === 'svg+xml') {
    const svg = buf.toString('utf8');
    if (!/<svg[\s>]/i.test(svg)) throw new HttpError(400, 'El archivo no es una imagen SVG válida.', 'icon');
    if (/<script/i.test(svg) || /\son\w+\s*=/i.test(svg) || /javascript:/i.test(svg)) {
      throw new HttpError(400, 'El SVG contiene código no permitido.', 'icon');
    }
  }
  return value;
}

function achievementInput(body) {
  const name = requireText(body.name, 'name', 'El nombre', 80);
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  const icon = validIcon(body.icon);
  if (!Object.prototype.hasOwnProperty.call(CRITERIA, body.criterion)) {
    throw new HttpError(400, 'Selecciona un criterio válido.', 'criterion');
  }
  let param = 0;
  if (PARAM_CRITERIA.includes(body.criterion)) {
    param = requireInt(body.param, 'param', 'El valor N');
    if (param < 1 || param > 1000) throw new HttpError(400, 'El valor N debe estar entre 1 y 1000.', 'param');
  }
  const points = requireInt(body.points, 'points', 'Los puntos');
  if (points < 0 || points > 10000) throw new HttpError(400, 'Los puntos deben estar entre 0 y 10000.', 'points');
  return { name, description, icon, criterion: body.criterion, param, points };
}

async function ensureAchievementNameFree(client, name, exceptId = 0) {
  const { rows } = await client.query('SELECT 1 FROM achievements WHERE lower(name) = lower($1) AND id <> $2', [name, exceptId]);
  if (rows.length) throw new HttpError(409, 'Ya existe un logro con ese nombre.', 'name');
}

const ACH_SELECT = `SELECT a.id, a.name, a.description, a.icon, a.criterion, a.param, a.points, a.created_at,
  (SELECT COUNT(*) FROM team_achievements ta WHERE ta.achievement_id = a.id)::int AS teams FROM achievements a`;

router.get('/achievements', ah(async (_req, res) => {
  const achievements = await query(`${ACH_SELECT} ORDER BY a.id`);
  res.json({ achievements, criteria: CRITERIA, paramCriteria: PARAM_CRITERIA });
}));

router.post('/achievements', ah(async (req, res) => {
  const d = achievementInput(req.body);
  const achievement = await tx(async (client) => {
    await ensureAchievementNameFree(client, d.name);
    const { rows } = await client.query(
      `INSERT INTO achievements (name, description, icon, criterion, param, points) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [d.name, d.description, d.icon, d.criterion, d.param, d.points]
    );
    await logActivity(client, { userId: me(req).id, action: 'creo_logro', detail: d.name });
    return (await client.query(`${ACH_SELECT} WHERE a.id = $1`, [rows[0].id])).rows[0];
  });
  res.status(201).json({ achievement });
}));

router.put('/achievements/:id', ah(async (req, res) => {
  const id = idParam(req);
  const d = achievementInput(req.body);
  const achievement = await tx(async (client) => {
    await ensureAchievementNameFree(client, d.name, id);
    // Solo cambia el catálogo: team_achievements (y su earned_at) no se toca
    const { rowCount } = await client.query(
      `UPDATE achievements SET name = $1, description = $2, icon = $3, criterion = $4, param = $5, points = $6 WHERE id = $7`,
      [d.name, d.description, d.icon, d.criterion, d.param, d.points, id]
    );
    if (!rowCount) throw new HttpError(404, 'El logro no existe.');
    await logActivity(client, { userId: me(req).id, action: 'edito_logro', detail: d.name });
    return (await client.query(`${ACH_SELECT} WHERE a.id = $1`, [id])).rows[0];
  });
  res.json({ achievement });
}));

router.delete('/achievements/:id', ah(async (req, res) => {
  const id = idParam(req);
  const teams = await tx(async (client) => {
    const { rows } = await client.query(`${ACH_SELECT} WHERE a.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, 'El logro no existe.');
    await client.query('DELETE FROM achievements WHERE id = $1', [id]); // team_achievements se borra en cascada
    await logActivity(client, { userId: me(req).id, action: 'elimino_logro', detail: `${rows[0].name} (${rows[0].teams} equipos)` });
    return rows[0].teams;
  });
  res.json({ deleted: true, teams });
}));

// =====================================================================
// Copias de seguridad (RF-19)
// =====================================================================

router.get('/backups', ah(async (_req, res) => {
  const rows = await query(
    `SELECT b.id, b.kind, b.filename, b.size_bytes, b.status, b.error, b.created_at, u.name AS created_by_name
       FROM backups b LEFT JOIN users u ON u.id = b.created_by
      ORDER BY b.created_at DESC, b.id DESC LIMIT 100`
  );
  const backups = rows.map((b) => ({ ...b, size_bytes: b.size_bytes == null ? null : Number(b.size_bytes), available: Boolean(backupFilePath(b.filename)) }));
  res.json({ backups });
}));

router.post('/backups', ah(async (req, res) => {
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!password) throw new HttpError(400, 'Escribe tu contraseña para confirmar.', 'password');
  const row = await one('SELECT password_hash FROM users WHERE id = $1', [me(req).id]);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new HttpError(401, 'La contraseña no es correcta.', 'password');
  }
  const backup = await createBackup({ kind: 'manual', userId: me(req).id });
  await tx((client) => logActivity(client, { userId: me(req).id, action: 'genero_backup', detail: backup.filename }));
  res.status(201).json({ backup });
}));

router.get('/backups/:id/download', ah(async (req, res) => {
  const id = idParam(req);
  const row = await one('SELECT filename FROM backups WHERE id = $1', [id]);
  const file = row && backupFilePath(row.filename);
  if (!file) throw new HttpError(404, 'El archivo de esta copia ya no está disponible en el servidor.');
  res.download(file, row.filename, { headers: { 'Content-Type': 'application/gzip' } });
}));

module.exports = router;
