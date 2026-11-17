// Cliente de la API: fetch con JSON, manejo de errores y redirección al login en 401
import { t, tError } from './i18n.js';

/**
 * Error de la API. `message` ya viene traducido por `code` (con respaldo en el español del
 * servidor, que queda en `serverMessage`), así que las páginas pueden mostrarlo tal cual.
 */
export class ApiError extends Error {
  constructor(status, { error, field, code, params } = {}) {
    super(tError({ code, params, field, message: error }));
    this.status = status;
    this.field = field;
    this.code = code;
    this.params = params;
    this.serverMessage = error;
  }
}

/**
 * Llama a la API. `background: true` marca la petición como de fondo para que no cuente
 * como actividad del usuario (cierre automático a los 30 minutos, RNF-09).
 */
export async function api(path, { method = 'GET', body, background = false, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (background) headers['X-Background'] = '1';
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'OFFLINE', error: t('errors.OFFLINE') });
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    location.href = `/index.html?expirada=${encodeURIComponent(data.code || 'SESSION_ENDED')}`;
    throw new ApiError(401, { code: data.code || 'SESSION_ENDED', error: data.error });
  }
  if (!res.ok) throw new ApiError(res.status, { ...data, error: data.error || t('errors.UNEXPECTED') });
  return data;
}

export const get = (p, opts) => api(p, { ...opts, method: 'GET' });
export const post = (p, body, opts) => api(p, { ...opts, method: 'POST', body: body ?? {} });
export const put = (p, body, opts) => api(p, { ...opts, method: 'PUT', body: body ?? {} });
export const patch = (p, body, opts) => api(p, { ...opts, method: 'PATCH', body: body ?? {} });
export const del = (p, opts) => api(p, { ...opts, method: 'DELETE', body: {} });
