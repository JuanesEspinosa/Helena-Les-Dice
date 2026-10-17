// Cliente de la API: fetch con JSON, manejo de errores y redirección al login en 401

export class ApiError extends Error {
  constructor(status, message, field) {
    super(message);
    this.status = status;
    this.field = field;
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
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    const msg = encodeURIComponent(data.error || 'Tu sesión terminó.');
    location.href = `/index.html?expirada=${msg}`;
    throw new ApiError(401, data.error || 'Sesión terminada');
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Ocurrió un error inesperado.', data.field);
  return data;
}

export const get = (p, opts) => api(p, { ...opts, method: 'GET' });
export const post = (p, body, opts) => api(p, { ...opts, method: 'POST', body: body ?? {} });
export const put = (p, body, opts) => api(p, { ...opts, method: 'PUT', body: body ?? {} });
export const patch = (p, body, opts) => api(p, { ...opts, method: 'PATCH', body: body ?? {} });
export const del = (p, opts) => api(p, { ...opts, method: 'DELETE', body: {} });
