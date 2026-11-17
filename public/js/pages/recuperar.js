// Vista 08 · Recuperar contraseña (RF-13): solicitar enlace → revisa tu correo → nueva contraseña
import { get, post } from '../core/api.js';
import { html, safe, icon, toast, clearErrors, showError, formData, withBusy, param } from '../core/ui.js';
import { t, tError } from '../core/i18n.js';
import { wireLangSelect, wirePasswordToggle } from './login.js';

const stepBox = document.getElementById('step');
const EXPIRED_STATUS = 410;
const STEPS = 3;

/** Paso que está en pantalla, para volver a pintarlo si cambia el idioma. */
let repaint = () => {};

/** Etiqueta "Paso N de 3". */
const tag = (n) => safe(html`<span class="step-tag">${t('access.recover.step', { n, total: STEPS })}</span>`);

/** Quita el token de la barra de direcciones para que no quede en el historial. */
function dropTokenFromUrl() {
  history.replaceState(null, '', location.pathname);
}

// ---------- Paso 1: solicitar enlace ----------
function renderRequest(email = '') {
  repaint = () => renderRequest(document.getElementById('email')?.value ?? email);
  stepBox.innerHTML = html`
    ${tag(1)}
    <h1 class="auth__heading">${t('access.recover.title')}</h1>
    <p class="muted" style="font-size:16px">${t('access.recover.lead')}</p>
    <form id="forgot-form" class="stack" style="gap:18px" novalidate>
      <div class="field">
        <label class="label" for="email">${t('access.emailLabel')}</label>
        <input class="input" id="email" name="email" type="email" autocomplete="email" placeholder="${t('access.emailPlaceholder')}" value="${email}" required>
      </div>
      <button type="submit" class="btn btn-primary btn-block btn-lg">${icon('send', 18)}${t('access.recover.send')}</button>
    </form>`;
  const form = document.getElementById('forgot-form');
  form.addEventListener('submit', onRequest);
  form.querySelector('[name="email"]').focus();
}

async function onRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  const email = formData(form).email.trim();
  if (!email) return showError(form, { field: 'email', message: t('access.emailRequired') });
  await withBusy(form.querySelector('[type="submit"]'), async () => {
    try {
      await post('/auth/forgot', { email });
      renderSent(email);
    } catch (err) {
      showError(form, err);
    }
  });
}

// ---------- Paso 2: revisa tu correo ----------
function renderSent(email) {
  repaint = () => renderSent(email);
  stepBox.innerHTML = html`
    ${tag(2)}
    <div class="step-icon" aria-hidden="true">${icon('mail', 30)}</div>
    <h1 class="auth__heading">${t('access.recover.sentTitle')}</h1>
    <p style="font-size:16px;line-height:1.55">${t('access.recover.sentText')}</p>
    <p class="muted">${t('access.recover.sentSpam')}</p>
    <div class="stack">
      <button type="button" class="btn btn-outline btn-block btn-lg" id="resend">${icon('refresh', 18)}${t('access.recover.resend')}</button>
      <button type="button" class="btn btn-ghost btn-block" id="other">${t('access.recover.otherEmail')}</button>
    </div>`;
  const resend = document.getElementById('resend');
  resend.addEventListener('click', () => withBusy(resend, async () => {
    try {
      await post('/auth/forgot', { email });
      toast(t('access.recover.resent'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
  document.getElementById('other').addEventListener('click', () => renderRequest(email));
  resend.focus();
}

// ---------- Paso 3: nueva contraseña ----------
function renderExpired(err = { code: 'RESET_EXPIRED' }) {
  dropTokenFromUrl();
  repaint = () => renderExpired(err);
  stepBox.innerHTML = html`
    ${tag(3)}
    <div class="step-icon step-icon--warn" aria-hidden="true">${icon('clock', 30)}</div>
    <h1 class="auth__heading">${t('access.recover.invalidTitle')}</h1>
    <div class="alert alert-warn" role="alert">${icon('warning', 20)}<div>${tError(err)}</div></div>
    <button type="button" class="btn btn-primary btn-block btn-lg" id="restart">${t('access.recover.restart')}</button>`;
  const restart = document.getElementById('restart');
  restart.addEventListener('click', () => renderRequest());
  restart.focus();
}

/** Requisitos de la nueva contraseña (los mismos que valida el servidor). */
const RULES = [
  { key: 'len', test: (p) => p.length >= 8 },
  { key: 'num', test: (p) => /\d/.test(p) },
  { key: 'same', test: (p, c) => p.length > 0 && p === c },
];

const ruleLabel = (r) => t(`access.rules.${r.key}`);

function renderNewPassword(token) {
  repaint = () => renderNewPassword(token);
  stepBox.innerHTML = html`
    ${tag(3)}
    <h1 class="auth__heading">${t('access.recover.newTitle')}</h1>
    <form id="reset-form" class="stack" style="gap:16px" novalidate>
      <div class="form-alert"></div>
      <div class="field">
        <label class="label" for="password">${t('access.recover.newPassword')}</label>
        <div class="pw-wrap">
          <input class="input" id="password" name="password" type="password" autocomplete="new-password" required aria-describedby="reqs">
          <button type="button" class="pw-toggle" id="pw-toggle"></button>
        </div>
      </div>
      <div class="field">
        <label class="label" for="confirm">${t('access.recover.confirmPassword')}</label>
        <input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" required aria-describedby="reqs">
      </div>
      <ul class="reqs" id="reqs" aria-label="${t('access.rules.label')}">
        ${RULES.map((r) => safe(html`<li data-rule="${r.key}">${icon('x', 18)}<span>${ruleLabel(r)}</span></li>`))}
      </ul>
      <button type="submit" class="btn btn-primary btn-block btn-lg">${t('access.recover.saveAndLogin')}</button>
    </form>`;
  const form = document.getElementById('reset-form');
  wirePasswordToggle(document.getElementById('pw-toggle'), form.querySelector('[name="password"]'));
  form.addEventListener('input', () => paintRules(form));
  form.addEventListener('submit', (e) => onReset(e, token));
  form.querySelector('[name="password"]').focus();
}

/** Checklist en vivo: cada requisito se pone verde con un chulo cuando se cumple. */
function paintRules(form) {
  const { password, confirm } = formData(form);
  RULES.forEach((r) => {
    const li = form.querySelector(`[data-rule="${r.key}"]`);
    const ok = r.test(password, confirm);
    li.classList.toggle('ok', ok);
    li.innerHTML = html`${icon(ok ? 'check' : 'x', 18)}<span>${ruleLabel(r)}</span><span class="sr-only">${t(ok ? 'access.rules.met' : 'access.rules.pending')}</span>`;
  });
  return RULES.every((r) => r.test(password, confirm));
}

async function onReset(event, token) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  const { password, confirm } = formData(form);
  if (!paintRules(form)) {
    const passwordOk = RULES[0].test(password) && RULES[1].test(password);
    return showError(form, passwordOk
      ? { field: 'confirm', message: t('errors.PASSWORD_MISMATCH') }
      : { field: 'password', message: t('access.rules.notMet') });
  }
  await withBusy(form.querySelector('[type="submit"]'), async () => {
    try {
      await post('/auth/reset', { token, password, confirm });
      location.href = '/index.html?restablecida=1';
    } catch (err) {
      if (err.status === EXPIRED_STATUS) return renderExpired(err);
      showError(form, err);
    }
  });
}

async function checkToken(token) {
  try {
    await get(`/auth/reset/${encodeURIComponent(token)}`);
    renderNewPassword(token);
  } catch (err) {
    if (err.status === EXPIRED_STATUS) return renderExpired(err);
    repaint = () => {};
    stepBox.innerHTML = html`<div class="alert alert-error" role="alert">${icon('alert', 20)}<div>${err.message}</div></div>`;
  }
}

async function init() {
  await wireLangSelect(document.getElementById('lang-slot'), () => repaint());
  const token = param('token');
  if (token) checkToken(token);
  else renderRequest();
}

init();
