// Servidor principal de Helena les dice
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { pool } = require('./db');
const { HttpError } = require('./http');
const { requireAuth, requireRole } = require('./middleware/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const INACTIVITY_MS = 30 * 60 * 1000; // RNF-09: 30 minutos sin actividad
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('Falta SESSION_SECRET en el archivo .env (mira .env.example)');
  process.exit(1);
}

if (isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

// Cabeceras de seguridad básicas
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use(express.json({ limit: '1mb' }));

app.use(session({
  name: 'helena.sid',
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 8 * 60 * 60 * 1000 },
}));

// Cierre automático por inactividad. Las consultas de fondo (contador de avisos, refresco del
// panel) envían "X-Background: 1" y no cuentan como actividad del usuario.
app.use('/api', (req, res, next) => {
  const s = req.session;
  if (s && s.user) {
    const now = Date.now();
    if (s.lastActivity && now - s.lastActivity > INACTIVITY_MS) {
      return s.destroy(() => next(new HttpError(401, 'Tu sesión se cerró por 30 minutos de inactividad.')));
    }
    if (req.get('X-Background') !== '1') s.lastActivity = now;
  }
  next();
});

// Las peticiones que modifican datos deben ser JSON (mitiga envíos de formularios de otros sitios)
app.use('/api', (req, _res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
    return next(new HttpError(415, 'Las peticiones deben enviarse en formato JSON.'));
  }
  next();
});

// ---------- Rutas de la API ----------
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/account', requireAuth, require('./routes/account'));
app.use('/api/sections', requireAuth, require('./routes/sections'));
app.use('/api/student', requireRole('estudiante'), require('./routes/student'));
app.use('/api/teacher', requireRole('docente'), require('./routes/teacher'));
app.use('/api/admin', requireRole('administrador'), require('./routes/admin'));

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada.')));

// ---------- Archivos del front ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// ---------- Manejador central de errores ----------
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') err = new HttpError(413, 'El contenido enviado es demasiado grande.');
  if (err.type === 'entity.parse.failed') err = new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  // Violaciones de restricciones de PostgreSQL convertidas en mensajes claros
  if (err.code === '23505') err = new HttpError(409, 'Ya existe un registro con esos datos.');
  if (err.code === '23503') err = new HttpError(409, 'El registro está relacionado con otros datos y no se puede modificar así.');
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 ? 'Ocurrió un error en el servidor. Intenta de nuevo.' : err.message,
    field: err.field,
  });
});

app.listen(PORT, () => {
  console.log(`Helena les dice escuchando en http://localhost:${PORT}`);
  require('./services/backup').scheduleWeekly();
});
