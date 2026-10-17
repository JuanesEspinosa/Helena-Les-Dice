// Cuenta del usuario: perfil, cambio de contraseña, idioma y notificaciones (RF-12, RF-14, RF-15)
// Montado en /api/account con requireAuth: aquí siempre existe req.session.user.
const express = require('express');
const bcrypt = require('bcryptjs');
const { one, query, tx } = require('../db');
const { HttpError, ah, validateNewPassword } = require('../http');
const { logActivity } = require('../services/activity');
const { studentTeam } = require('../services/teams');

const router = express.Router();

const LANGS = ['es', 'en'];
const NOTIFICATIONS_LIMIT = 100;
const BCRYPT_ROUNDS = 10;

/** Guarda la sesión antes de responder para que el cambio quede persistido en el almacén. */
const saveSession = (req) => new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())));

// ---------- Perfil (vista 09) ----------
router.get('/profile', ah(async (req, res) => {
  const user = await one(
    'SELECT id, name, email, role, lang, created_at, last_login FROM users WHERE id = $1',
    [req.session.user.id]
  );
  if (!user) throw new HttpError(404, 'La cuenta ya no existe.');
  let team = null;
  let period = null;
  if (user.role === 'estudiante') {
    const row = await studentTeam(user.id);
    if (row) {
      team = { id: row.id, name: row.name };
      period = { name: row.period_name, active: row.period_active };
    }
  }
  res.json({ ...user, team, period });
}));

// ---------- Cambio de contraseña (RF-14) ----------
router.post('/password', ah(async (req, res) => {
  const { current } = req.body;
  if (typeof current !== 'string' || !current) throw new HttpError(400, 'Escribe tu contraseña actual.', 'current');
  validateNewPassword(req.body.password, req.body.confirm);
  const userId = req.session.user.id;
  const row = await one('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) {
    throw new HttpError(400, 'La contraseña actual no es correcta.', 'current');
  }
  const hash = await bcrypt.hash(req.body.password, BCRYPT_ROUNDS);
  await tx(async (client) => {
    await client.query('UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2', [hash, userId]);
    await logActivity(client, { userId, action: 'cambio_contrasena' });
  });
  req.session.user = { ...req.session.user, mustChangePassword: false };
  await saveSession(req);
  res.json({ message: 'Tu contraseña se actualizó correctamente.' });
}));

// ---------- Idioma de la interfaz ----------
router.patch('/lang', ah(async (req, res) => {
  const { lang } = req.body;
  if (!LANGS.includes(lang)) throw new HttpError(400, 'El idioma debe ser "es" o "en".', 'lang');
  await query('UPDATE users SET lang = $1 WHERE id = $2', [lang, req.session.user.id]);
  req.session.user = { ...req.session.user, lang };
  await saveSession(req);
  res.json({ lang });
}));

// ---------- Notificaciones (RF-12, vista 10) ----------
router.get('/notifications', ah(async (req, res) => {
  const filter = req.query.filter === 'unread' ? 'unread' : 'all';
  const rows = await query(
    `SELECT id, type, title, body, link, read, created_at
       FROM notifications
      WHERE user_id = $1 AND ($2::boolean IS FALSE OR NOT read)
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [req.session.user.id, filter === 'unread', NOTIFICATIONS_LIMIT]
  );
  res.json({ filter, notifications: rows });
}));

router.get('/notifications/count', ah(async (req, res) => {
  const row = await one('SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND NOT read', [req.session.user.id]);
  res.json({ unread: row.unread });
}));

// Debe ir antes de /:id/read para que "read-all" no se interprete como un id
router.post('/notifications/read-all', ah(async (req, res) => {
  const rows = await query(
    'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND NOT read RETURNING id',
    [req.session.user.id]
  );
  res.json({ updated: rows.length });
}));

router.post('/notifications/:id/read', ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'La notificación no existe.');
  // Solo se marcan las propias: si el id es de otro usuario se responde 404 sin revelar que existe
  const row = await one(
    'UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, req.session.user.id]
  );
  if (!row) throw new HttpError(404, 'La notificación no existe.');
  res.json({ id: row.id, read: true });
}));

module.exports = router;
