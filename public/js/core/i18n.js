// Internacionalización: diccionarios JSON por idioma, t(), formatos con Intl y selector de idioma.
// El español es la fuente de verdad y el respaldo de toda clave que falte en otro idioma.

export const DEFAULT_LANG = 'es';
export const LANGS = {
  es: { name: 'Español', locale: 'es-CO' },
  en: { name: 'English', locale: 'en-US' },
  pt: { name: 'Português (Brasil)', locale: 'pt-BR' },
  fr: { name: 'Français', locale: 'fr-FR' },
  de: { name: 'Deutsch', locale: 'de-DE' },
  it: { name: 'Italiano', locale: 'it-IT' },
};

const AREAS = ['common', 'access', 'student', 'teacher', 'admin', 'errors', 'notif'];
const STORAGE_KEY = 'helena.lang';
const SECOND = 1;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const RELATIVE_DAYS_LIMIT = 30;

let lang = DEFAULT_LANG;
let dict = {};
let fallback = {};

export const isLang = (value) => Object.prototype.hasOwnProperty.call(LANGS, value);
export const getLang = () => lang;
export const getLocale = () => LANGS[lang].locale;

async function fetchArea(code, area) {
  try {
    const res = await fetch(`/js/i18n/${code}/${area}.json`);
    return res.ok ? await res.json() : {};
  } catch {
    return {}; // sin conexión o archivo ausente: se usa el respaldo en español
  }
}

/** Cada área declara sus propios espacios de nombres de primer nivel, así que basta con unirlas. */
async function fetchLang(code) {
  const parts = await Promise.all(AREAS.map((area) => fetchArea(code, area)));
  return Object.assign({}, ...parts);
}

/** Carga el idioma (y el español de respaldo), fija <html lang> y traduce el HTML estático. */
export async function initI18n(code) {
  const next = isLang(code) ? code : DEFAULT_LANG;
  const [active, base] = await Promise.all([fetchLang(next), next === DEFAULT_LANG ? null : fetchLang(DEFAULT_LANG)]);
  lang = next;
  dict = active;
  fallback = base || active;
  document.documentElement.lang = getLocale();
  applyI18n();
  return lang;
}

const lookup = (obj, key) => key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), obj);

/** true si la clave existe en el idioma activo o en el español. */
export const has = (key) => lookup(dict, key) !== undefined || lookup(fallback, key) !== undefined;

function interpolate(text, params) {
  return text.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    const value = params[name];
    return typeof value === 'number' ? fmtNumber(value) : String(value ?? '');
  });
}

/**
 * Traduce una clave. Busca en el idioma activo, luego en español y, si no existe, devuelve la clave.
 * Un valor {one, other, …} se resuelve con Intl.PluralRules sobre params.count.
 */
export function t(key, params = {}) {
  let value = lookup(dict, key);
  if (value === undefined) value = lookup(fallback, key);
  if (value === undefined) return key;
  if (value && typeof value === 'object') {
    const count = Number(params.count) || 0;
    // "zero" es opcional y explícito: Intl.PluralRules no lo devuelve en estos idiomas
    const form = count === 0 && value.zero !== undefined ? 'zero' : new Intl.PluralRules(getLocale()).select(count);
    value = value[form] ?? value.other ?? key;
  }
  return interpolate(String(value), params);
}

/** Mensaje de un error de la API: traducción por código, con respaldo en el mensaje del servidor. */
export function tError(err) {
  if (!err) return t('errors.UNEXPECTED');
  const key = `errors.${err.code}`;
  if (err.code && has(key)) {
    const field = err.field && has(`fields.${err.field}`) ? t(`fields.${err.field}`) : t('fields.generic');
    return t(key, { field, ...(err.params || {}) });
  }
  return err.message || t('errors.UNEXPECTED');
}

/** Traduce los elementos con data-i18n="clave" y data-i18n-attr="atributo:clave;atributo:clave". */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(';').forEach((pair) => {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

// ---------- Formatos ----------

const toDate = (d) => (d instanceof Date ? d : new Date(d));
const capitalize = (s) => s.charAt(0).toLocaleUpperCase(getLocale()) + s.slice(1);

export const fmtDate = (d) => (d ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(d)) : '—');
export const fmtDateTime = (d) => (d ? new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(toDate(d)) : '—');
export const fmtTime = (d) => (d ? new Intl.DateTimeFormat(getLocale(), { hour: 'numeric', minute: '2-digit' }).format(toDate(d)) : '—');
export const fmtLongDate = (d) => (d ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(toDate(d)) : '—');
export const fmtNumber = (n, opts) => new Intl.NumberFormat(getLocale(), opts).format(Number(n) || 0);
/** Porcentaje a partir de un valor 0–100 ("85 %", "85%"…, según el idioma). */
export const fmtPercent = (pct) => fmtNumber((Number(pct) || 0) / 100, { style: 'percent', maximumFractionDigits: 0 });

/** "Hace 5 min", "Hoy, 9:02", "Ayer, 18:15", "Hace 3 días"… */
export function ago(d) {
  if (!d) return t('time.never');
  const date = toDate(d);
  const diff = (Date.now() - date) / 1000;
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always', style: 'short' });
  if (diff < MINUTE * SECOND) return t('time.justNow');
  if (diff < HOUR) return capitalize(rtf.format(-Math.floor(diff / MINUTE), 'minute'));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (date >= today) return t('time.todayAt', { time: fmtTime(date) });
  if (date >= yesterday) return t('time.yesterdayAt', { time: fmtTime(date) });
  const days = Math.floor(diff / DAY);
  if (days < RELATIVE_DAYS_LIMIT) return capitalize(rtf.format(-days, 'day'));
  return fmtDate(date);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
export function fmtBytes(n) {
  if (n == null) return '—';
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < BYTE_UNITS.length - 1) { v /= 1024; i++; }
  return fmtNumber(v, { style: 'unit', unit: BYTE_UNITS[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 });
}

// ---------- Preferencia antes de iniciar sesión ----------

/** Idioma guardado en el navegador; si el almacenamiento está bloqueado o el valor no sirve, español. */
export function readStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

export function storeLang(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch { /* almacenamiento no disponible: la preferencia solo dura en esta página */ }
}

/**
 * Selector nativo de idioma con su <label> (oculto visualmente). Cada opción lleva el nombre del
 * idioma en ese idioma y su atributo lang. Llama a onChange(codigo) al cambiar.
 */
export function langSelect({ id, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'lang-select';
  const label = document.createElement('label');
  label.className = 'sr-only';
  label.htmlFor = id;
  label.dataset.i18n = 'lang.label';
  label.textContent = t('lang.label');
  const select = document.createElement('select');
  select.id = id;
  select.className = 'select';
  Object.entries(LANGS).forEach(([code, info]) => {
    const option = document.createElement('option');
    option.value = code;
    option.lang = code;
    option.textContent = info.name;
    option.selected = code === value;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  wrap.append(label, select);
  return wrap;
}
