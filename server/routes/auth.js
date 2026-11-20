// Inicio de sesión, cierre y recuperación de contraseña (RF-01, RF-13, RF-15)
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { one, query, tx } = require('../db');
const { HttpError, ah, requireEmail, requireText, validateNewPassword } = require('../http');
const { logActivity } = require('../services/activity');
const { MAX_ATTEMPTS, LOCK_MINUTES, nextFailure, lockMinutesLeft, getTracked, setTracked } = require('../services/login-throttle');

const router = express.Router();

const RESET_TTL_MINUTES = 60;

/** Datos del usuario que se guardan en la sesión y se envían al front. */
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, lang: u.lang, mustChangePassword: u.must_change_password });

/** Hash bcrypt fijo (costo 10, igual que las contraseñas reales) para cuando el correo no existe. */
const DUMMY_HASH = '$2b$10$fCsxbstnhxLUuP1043jdyeNbeR1puiB9Kg57pQ2UoVzIBIvqGSt5.';

/** Guarda un intento fallido: en la tabla users si el usuario existe, si no en el contador en memoria. */
async function saveFailure(user, email, { attempts, lockedUntil }, now) {
  if (!user) return setTracked(email, { attempts, lockedUntil }, now);
  await query('UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [attempts, lockedUntil, user.id]);
}

const HOME = { estudiante: '/estudiante/tablero.html', docente: '/docente/panel.html', administrador: '/admin/panel.html' };

router.post('/login', ah(async (req, res, next) => {
  const email = requireEmail(req.body.email);
  const password = requireText(req.body.password, 'password', 'La contraseña', 128);
  const user = await one('SELECT * FROM users WHERE email = $1', [email]);
  const now = Date.now();
  // Un correo sin usuario usa el contador en memoria: la respuesta no revela si el correo existe
  const state = user ? { attempts: user.failed_attempts, lockedUntil: user.locked_until } : getTracked(email);

  const mins = lockMinutesLeft(state.lockedUntil, now);
  if (mins > 0) {
    throw new HttpError(423, `Tu cuenta está bloqueada por intentos fallidos. Intenta de nuevo en ${mins} minuto(s).`, undefined, { code: 'ACCOUNT_LOCKED', params: { minutes: mins } });
  }
  // Sin usuario se compara contra un hash ficticio para tardar lo mismo
  const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!(matches && user && user.active)) {
    const failure = nextFailure(state.attempts, now);
    await saveFailure(user, email, failure, now);
    if (failure.locked) throw new HttpError(423, `Superaste los ${MAX_ATTEMPTS} intentos. Tu cuenta quedó bloqueada ${LOCK_MINUTES} minutos.`, undefined, { code: 'ACCOUNT_LOCKED', params: { minutes: LOCK_MINUTES } });
    throw new HttpError(401, `Correo o contraseña incorrectos. Te quedan ${failure.remaining} intento(s) antes del bloqueo de ${LOCK_MINUTES} minutos.`, undefined, { code: 'AUTH_INVALID', params: { remaining: failure.remaining, lockMinutes: LOCK_MINUTES } });
  }

  await tx(async (client) => {
    await client.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = now() WHERE id = $1', [user.id]);
    await logActivity(client, { userId: user.id, action: 'inicio_sesion' });
  });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = publicUser(user);
    res.json({ user: req.session.user, redirect: user.must_change_password ? '/perfil.html?primer=1' : HOME[user.role] });
  });
}));

router.post('/logout', (req, res) => {
  // Si la sesión ya expiró, simplemente se responde OK y el front redirige (RF-15)
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('helena.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) throw new HttpError(401, 'Sin sesión', undefined, { code: 'NO_SESSION' });
  res.json({ user: req.session.user, home: HOME[req.session.user.role] });
});

// ---------- Recuperación de contraseña (RF-13) ----------
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

router.post('/forgot', ah(async (req, res) => {
  const email = requireEmail(req.body.email);
  const user = await one('SELECT id, name FROM users WHERE email = $1 AND active', [email]);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
      [user.id, hashToken(token), String(RESET_TTL_MINUTES)]
    );
    const link = `${process.env.APP_URL || 'http://localhost:3000'}/recuperar.html?token=${token}`;
    // Sin servidor SMTP configurado, el enlace se muestra en la consola del servidor.
    console.log(`[recuperación] Enlace para ${email}: ${link}`);
  }
  // Mensaje genérico: no revela si el correo existe
  res.json({ message: 'Si el correo es correcto, recibirás un enlace para restablecer tu contraseña.' });
}));

router.get('/reset/:token', ah(async (req, res) => {
  const row = await one(
    'SELECT id FROM password_resets WHERE token_hash = $1 AND NOT used AND expires_at > now()',
    [hashToken(req.params.token)]
  );
  if (!row) throw new HttpError(410, 'Este enlace expiró. Solicita uno nuevo.', undefined, { code: 'RESET_EXPIRED' });
  res.json({ valid: true });
}));

router.post('/reset', ah(async (req, res) => {
  const token = requireText(req.body.token, 'token', 'El enlace', 200);
  validateNewPassword(req.body.password, req.body.confirm);
  await tx(async (client) => {
    const { rows } = await client.query(
      `UPDATE password_resets SET used = TRUE
        WHERE token_hash = $1 AND NOT used AND expires_at > now() RETURNING user_id`,
      [hashToken(token)]
    );
    if (!rows[0]) throw new HttpError(410, 'Este enlace expiró. Solicita uno nuevo.', undefined, { code: 'RESET_EXPIRED' });
    const hash = await bcrypt.hash(req.body.password, 10);
    await client.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE, failed_attempts = 0, locked_until = NULL WHERE id = $2',
      [hash, rows[0].user_id]
    );
    await logActivity(client, { userId: rows[0].user_id, action: 'restablecio_contrasena' });
  });
  res.json({ message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión.' });
}));

module.exports = { router, publicUser, HOME };
