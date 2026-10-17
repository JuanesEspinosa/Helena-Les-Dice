// Utilidades HTTP compartidas: errores con código, validación y envoltorio async

class HttpError extends Error {
  /**
   * @param {number} status código HTTP
   * @param {string} message mensaje claro para el usuario
   * @param {string} [field] campo del formulario que falló (el front lo marca en rojo)
   */
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/** Envuelve un handler async para que sus errores lleguen al manejador central. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Devuelve el texto recortado o lanza 400 si viene vacío. */
function requireText(value, field, label, max = 5000) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new HttpError(400, `Falta ${label.charAt(0).toLowerCase() + label.slice(1)}.`, field);
  if (text.length > max) throw new HttpError(400, `${label} es demasiado largo (máximo ${max} caracteres).`, field);
  return text;
}

function requireEmail(value, field = 'email') {
  const email = requireText(value, field, 'El correo', 160).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo con formato válido.', field);
  return email;
}

function requireInt(value, field, label) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `${label} no es válido.`, field);
  return n;
}

/** Reglas mínimas de contraseña (RF-13, RF-14): 8 caracteres y al menos un número. */
function validateNewPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.', 'password');
  }
  if (!/\d/.test(password)) throw new HttpError(400, 'La contraseña debe tener al menos un número.', 'password');
  if (password.length > 128) throw new HttpError(400, 'La contraseña es demasiado larga.', 'password');
  if (confirm !== undefined && password !== confirm) {
    throw new HttpError(400, 'Las contraseñas no coinciden.', 'confirm');
  }
}

module.exports = { HttpError, ah, requireText, requireEmail, requireInt, validateNewPassword };
