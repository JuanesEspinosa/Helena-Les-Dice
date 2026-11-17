// Vista 01 · Inicio de sesión (RF-01, RF-13)
// También exporta los controles compartidos con la vista 08 (idioma, mostrar contraseña y alertas).
import { post, patch } from '../core/api.js';
import { t, tError, has, initI18n, readStoredLang, storeLang, langSelect, getLang } from '../core/i18n.js';
import { html, icon, clearErrors, showError, formData, withBusy, param } from '../core/ui.js';

/**
 * Selector de idioma de las pantallas de acceso: guarda la preferencia en el navegador y vuelve a
 * pintar la página sin recargar. `onChange` permite repintar las partes generadas por JS.
 * Devuelve una función que dice si el usuario cambió el idioma durante esta visita.
 */
export async function wireLangSelect(slot, onChange = () => {}) {
  let changed = false;
  const lang = await initI18n(readStoredLang());
  slot.replaceChildren(langSelect({
    id: 'lang-select',
    value: lang,
    onChange: async (next) => {
      changed = true;
      storeLang(next);
      await initI18n(next);
      onChange(next);
    },
  }));
  return () => changed;
}

/** Botón de ojo para mostrar u ocultar la contraseña. Devuelve la función que lo repinta. */
export function wirePasswordToggle(button, input) {
  const paint = () => {
    const visible = input.type === 'text';
    button.innerHTML = html`${icon(visible ? 'lock' : 'eye', 20)}`;
    button.setAttribute('aria-label', t(visible ? 'access.hidePassword' : 'access.showPassword'));
    button.setAttribute('aria-pressed', String(visible));
  };
  paint();
  button.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    paint();
    input.focus();
  });
  return paint;
}

/** Muestra una alerta dentro del contenedor .form-alert del formulario. */
export function showAlert(form, type, message) {
  const box = form.querySelector('.form-alert');
  const iconName = type === 'error' ? 'alert' : type === 'ok' ? 'checkCircle' : 'info';
  box.innerHTML = html`<div class="alert alert-${type}" role="${type === 'error' ? 'alert' : 'status'}">${icon(iconName, 20)}<div>${message}</div></div>`;
}

/** Si ya hay una sesión abierta, lleva directo a la pantalla de inicio del rol. */
async function redirectIfLogged() {
  try {
    // fetch directo: api.js redirige al login en 401 y aquí ya estamos en el login
    const res = await fetch('/api/auth/me', { headers: { Accept: 'application/json', 'X-Background': '1' }, credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.home) location.replace(data.home);
  } catch { /* sin conexión: se queda en el formulario */ }
}

/** Mensajes que llegan por la URL: sesión expirada o contraseña restablecida. */
function urlNotice() {
  const expired = param('expirada');
  if (param('restablecida') === '1') return { type: 'ok', key: 'access.login.passwordReset' };
  if (!expired) return null;
  // El código llega por la URL: solo se aceptan claves conocidas (no se muestra texto arbitrario)
  if (expired === 'NO_SESSION' || !has(`errors.${expired}`)) return { type: 'info', key: 'access.login.loginToContinue' };
  return { type: 'info', key: `errors.${expired}` };
}

/** Texto de un error de inicio de sesión, con los intentos restantes cuando el servidor los envía. */
function loginErrorText(err) {
  const remaining = err.params && err.params.remaining;
  if (err.code !== 'AUTH_INVALID' || typeof remaining !== 'number') return tError(err);
  return `${tError(err)} ${t('access.login.attemptsLeft', { count: remaining, minutes: err.params.lockMinutes })}`;
}

let langChangedHere = () => false;

/**
 * Tras autenticarse manda el idioma de la cuenta, salvo que el usuario lo haya cambiado en esta
 * pantalla durante esta visita: entonces ese idioma se guarda en la cuenta antes de redirigir.
 */
async function syncLang(user) {
  if (langChangedHere() && getLang() !== user.lang) {
    try {
      await patch('/account/lang', { lang: getLang() });
      return;
    } catch { /* si falla, se sigue con el idioma de la cuenta */ }
  }
  storeLang(user.lang);
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const { email, password } = formData(form);
  if (!email.trim()) return showError(form, { field: 'email', message: t('access.emailRequired') });
  if (!password) return showError(form, { field: 'password', message: t('access.login.passwordRequired') });
  const button = form.querySelector('[type="submit"]');
  await withBusy(button, async () => {
    try {
      const data = await post('/auth/login', { email: email.trim(), password });
      await syncLang(data.user);
      location.href = data.redirect;
    } catch (err) {
      // Con campo (formato de correo) se marca el campo; sin campo (credenciales, bloqueo) va en la alerta
      if (err.field) return showError(form, err);
      showAlert(form, 'error', loginErrorText(err));
      form.querySelector('[name="password"]').select();
    }
  });
}

async function init() {
  const form = document.getElementById('login-form');
  if (!form) return;
  redirectIfLogged();
  let notice = null;
  const paintNotice = () => notice && showAlert(form, notice.type, t(notice.key));
  let repaintToggle = () => {};
  langChangedHere = await wireLangSelect(document.getElementById('lang-slot'), () => {
    paintNotice();
    repaintToggle();
  });
  notice = urlNotice(); // después de cargar el diccionario: valida el código contra errors.*
  repaintToggle = wirePasswordToggle(document.getElementById('pw-toggle'), form.querySelector('[name="password"]'));
  paintNotice();
  form.addEventListener('submit', onSubmit);
  history.replaceState(null, '', location.pathname);
}

init();
