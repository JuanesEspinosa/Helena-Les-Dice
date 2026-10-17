// Vista 01 · Inicio de sesión (RF-01, RF-13)
// También exporta los controles compartidos con la vista 08 (idioma y mostrar contraseña).
import { post } from '../core/api.js';
import { html, icon, clearErrors, showError, formData, withBusy, param } from '../core/ui.js';

const LANG_KEY = 'helena.lang';
const LANG_LABEL = { es: 'Español', en: 'English' };

/** Lee la preferencia de idioma guardada; si el navegador bloquea el almacenamiento, usa español. */
function readLang() {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'es';
  } catch {
    return 'es';
  }
}

function saveLang(lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* almacenamiento no disponible: la preferencia solo dura en esta página */ }
}

/** Selector ES/EN de las pantallas de acceso. Por ahora es solo visual: recuerda la preferencia. */
export function wireLangToggle(button, label) {
  let lang = readLang();
  const paint = () => {
    label.textContent = LANG_LABEL[lang];
    button.setAttribute('aria-label', `Cambiar idioma (actual: ${LANG_LABEL[lang]})`);
  };
  paint();
  button.addEventListener('click', () => {
    lang = lang === 'es' ? 'en' : 'es';
    saveLang(lang);
    paint();
  });
}

/** Botón de ojo para mostrar u ocultar la contraseña. */
export function wirePasswordToggle(button, input) {
  const paint = () => {
    const visible = input.type === 'text';
    button.innerHTML = html`${icon(visible ? 'lock' : 'eye', 20)}`;
    button.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    button.setAttribute('aria-pressed', String(visible));
  };
  paint();
  button.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    paint();
    input.focus();
  });
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
function showUrlNotice(form) {
  const expired = param('expirada');
  if (param('restablecida') === '1') {
    showAlert(form, 'ok', 'Tu contraseña se actualizó. Ya puedes iniciar sesión.');
  } else if (expired) {
    showAlert(form, 'info', expired === 'Sin sesión' ? 'Inicia sesión para continuar.' : expired);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const { email, password } = formData(form);
  if (!email.trim()) return showError(form, { field: 'email', message: 'Escribe tu correo institucional.' });
  if (!password) return showError(form, { field: 'password', message: 'Escribe tu contraseña.' });
  const button = form.querySelector('[type="submit"]');
  await withBusy(button, async () => {
    try {
      const data = await post('/auth/login', { email: email.trim(), password });
      location.href = data.redirect;
    } catch (err) {
      // Con campo (formato de correo) se marca el campo; sin campo (credenciales, bloqueo) va en la alerta
      if (err.field) return showError(form, err);
      showAlert(form, 'error', err.message);
      form.querySelector('[name="password"]').select();
    }
  });
}

function init() {
  const form = document.getElementById('login-form');
  if (!form) return;
  redirectIfLogged();
  wireLangToggle(document.getElementById('lang-btn'), document.getElementById('lang-label'));
  wirePasswordToggle(document.getElementById('pw-toggle'), form.querySelector('[name="password"]'));
  showUrlNotice(form);
  form.addEventListener('submit', onSubmit);
  history.replaceState(null, '', location.pathname);
}

init();
