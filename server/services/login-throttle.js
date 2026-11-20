// Intentos fallidos de inicio de sesión: reglas de bloqueo y contador en memoria para correos sin usuario.
// Así un correo inexistente se bloquea igual que uno real y el login no revela qué correos existen.

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
/** Tope de correos inexistentes que se siguen a la vez; al llenarse se descarta el más antiguo. */
const MAX_TRACKED_EMAILS = 10000;
const MINUTE_MS = 60000;

/** Estado tras un intento fallido (mismas reglas que users.failed_attempts / locked_until). */
function nextFailure(attempts, now) {
  const next = attempts + 1;
  const locked = next >= MAX_ATTEMPTS;
  return {
    attempts: locked ? 0 : next,
    lockedUntil: locked ? new Date(now + LOCK_MINUTES * MINUTE_MS) : null,
    locked,
    remaining: MAX_ATTEMPTS - next,
  };
}

/** Minutos de bloqueo que quedan, o 0 si no hay bloqueo vigente. */
function lockMinutesLeft(lockedUntil, now) {
  if (!lockedUntil) return 0;
  const ms = new Date(lockedUntil).getTime() - now;
  return ms > 0 ? Math.ceil(ms / MINUTE_MS) : 0;
}

/** Una entrada vence cuando su bloqueo ya pasó y no acumula intentos. */
const isExpired = (entry, now) => entry.attempts === 0 && lockMinutesLeft(entry.lockedUntil, now) === 0;

// ---------- Contador en memoria (correos sin usuario) ----------
const tracked = new Map();

/** Intentos y bloqueo de un correo sin usuario. */
const getTracked = (email) => tracked.get(email) || { attempts: 0, lockedUntil: null };

/** Guarda el estado de un correo sin usuario, limpiando vencidas y respetando el tope. */
function setTracked(email, { attempts, lockedUntil }, now) {
  for (const [key, entry] of tracked) if (isExpired(entry, now)) tracked.delete(key);
  tracked.delete(email);
  if (tracked.size >= MAX_TRACKED_EMAILS) tracked.delete(tracked.keys().next().value);
  tracked.set(email, { attempts, lockedUntil });
}

module.exports = { MAX_ATTEMPTS, LOCK_MINUTES, MAX_TRACKED_EMAILS, nextFailure, lockMinutesLeft, getTracked, setTracked };
