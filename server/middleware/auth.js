// Autenticación y autorización por tipo de usuario (RF-01, RNF-07)
const { HttpError } = require('../http');

/** Exige una sesión activa. Las rutas /api responden 401 y el front redirige al login. */
function requireAuth(req, _res, next) {
  if (!req.session || !req.session.user) {
    return next(new HttpError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.'));
  }
  next();
}

/** Exige uno de los roles indicados. */
function requireRole(...roles) {
  return (req, _res, next) => {
    const user = req.session && req.session.user;
    if (!user) return next(new HttpError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.'));
    if (!roles.includes(user.role)) return next(new HttpError(403, 'No tienes permiso para esta acción.'));
    next();
  };
}

module.exports = { requireAuth, requireRole };
