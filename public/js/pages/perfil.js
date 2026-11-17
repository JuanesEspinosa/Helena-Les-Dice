// Vista 09 · Mi perfil (RF-14, RF-15): datos de la cuenta, cambio de contraseña y cierre de sesión
import { get, post, patch } from '../core/api.js';
import { html, safe, icon, initials, fmtDate, fmtDateTime, toast, clearErrors, showError, formData, withBusy, param } from '../core/ui.js';
import { initLayout, setMain, logout } from '../core/layout.js';
import { t, LANGS, storeLang } from '../core/i18n.js';

/** Enlace de vuelta: el estudiante vuelve a su tablero; docente y administrador, a su panel. */
const backLabel = (role) => t(role === 'estudiante' ? 'account.backToBoard' : 'account.backToPanel');

/** Aviso destacado cuando la cuenta entra con una contraseña temporal. */
const firstLoginAlert = () => safe(html`
  <div class="alert alert-warn" role="alert" id="first-alert">
    ${icon('key', 20)}
    <div><strong>${t('account.profile.firstTitle')}</strong><br>
    ${t('account.profile.firstText')}</div>
  </div>`);

function accountCard(p) {
  const rows = [[t('admin.users.userType'), t(`roles.${p.role}`)]];
  if (p.role === 'estudiante') {
    rows.push([t('teacher.teams.team'), p.team ? p.team.name : t('account.profile.noTeam')]);
    rows.push([t('admin.periods.period'), p.period ? p.period.name : '—']);
  }
  rows.push([t('account.profile.memberSince'), fmtDate(p.created_at)]);
  rows.push([t('account.profile.lastLogin'), fmtDateTime(p.last_login)]);
  return safe(html`
  <section class="card card-pad stack grow" style="gap:20px" aria-labelledby="datos">
    <div class="profile-head">
      <span class="avatar" aria-hidden="true">${initials(p.name)}</span>
      <div style="min-width:0">
        <h2 id="datos" style="font-size:20px;font-weight:800">${p.name}</h2>
        <div class="profile-email">${p.email}</div>
      </div>
    </div>
    <dl class="kv">${rows.map(([k, v]) => safe(html`<dt>${k}</dt><dd>${v}</dd>`))}</dl>
    <div class="field">
      <label class="label" for="lang">${t('account.profile.language')}</label>
      <select class="select" id="lang" name="lang">
        ${Object.entries(LANGS).map(([code, info]) => safe(html`<option value="${code}" lang="${code}" ${p.lang === code ? 'selected' : ''}>${info.name}</option>`))}
      </select>
    </div>
    <p class="muted row" style="flex-wrap:nowrap;align-items:flex-start">${icon('info', 18)}<span>${t('account.profile.contactAdmin')}</span></p>
  </section>`);
}

const passwordCard = () => safe(html`
  <section class="card card-pad side" aria-labelledby="clave">
    <h2 id="clave" style="font-size:20px;font-weight:800">${t('account.profile.changePassword')}</h2>
    <form id="pw-form" class="stack" style="gap:16px" novalidate>
      <div class="field">
        <label class="label" for="current">${t('fields.current')}</label>
        <input class="input" id="current" name="current" type="password" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label class="label" for="password">${t('access.recover.newPassword')}</label>
        <input class="input" id="password" name="password" type="password" autocomplete="new-password" aria-describedby="pw-hint" required>
        <span class="hint" id="pw-hint">${t('account.profile.passwordHint')}</span>
      </div>
      <div class="field">
        <label class="label" for="confirm">${t('account.profile.confirmNew')}</label>
        <input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" required>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${t('account.profile.updatePassword')}</button>
        <button type="reset" class="btn btn-outline">${t('common.cancel')}</button>
      </div>
    </form>
  </section>`);

const sessionCard = () => safe(html`
  <section class="card card-pad row between" style="gap:16px" aria-labelledby="sesion">
    <div>
      <h2 id="sesion" style="font-size:16px;font-weight:800">${t('account.profile.session')}</h2>
      <p class="muted" style="margin-top:4px">${t('account.profile.sessionText')}</p>
    </div>
    <button type="button" class="btn btn-danger-outline" id="logout-session">${icon('logout', 18)}${t('layout.logout')}</button>
  </section>`);

async function onPasswordSubmit(event, home) {
  event.preventDefault();
  const form = event.currentTarget;
  clearErrors(form);
  const { current, password, confirm } = formData(form);
  if (!current) return showError(form, { field: 'current', message: t('errors.CURRENT_PASSWORD_REQUIRED') });
  await withBusy(form.querySelector('[type="submit"]'), async () => {
    try {
      await post('/account/password', { current, password, confirm });
      form.reset();
      toast(t('account.profile.passwordUpdated'));
      markFirstLoginDone(home);
    } catch (err) {
      showError(form, err);
    }
  });
}

/** Tras cambiar la contraseña temporal, el aviso destacado pasa a confirmación. */
function markFirstLoginDone(home) {
  const alert = document.getElementById('first-alert');
  if (!alert) return;
  alert.className = 'alert alert-ok';
  alert.setAttribute('role', 'status');
  alert.innerHTML = html`${icon('checkCircle', 20)}<div><strong>${t('account.profile.firstDone')}</strong><br><a href="${home}">${t('account.profile.continueHome')}</a></div>`;
  history.replaceState(null, '', location.pathname);
}

async function onLangChange(event) {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    await patch('/account/lang', { lang: select.value });
    storeLang(select.value);
    location.reload();
  } catch (err) {
    select.disabled = false;
    toast(err.message, 'error');
  }
}

async function main() {
  const { user, home } = await initLayout({});
  let profile;
  try {
    profile = await get('/account/profile');
  } catch (err) {
    setMain(html`<div class="alert alert-error" role="alert">${icon('alert', 20)}<div>${err.message}</div></div>`);
    return;
  }
  const isFirst = param('primer') === '1';
  setMain(html`
    <div class="page-head">
      <div>
        <a class="back-link" href="${home}">${icon('arrowLeft', 18)}${backLabel(user.role)}</a>
        <h1 class="page-title" style="margin-top:6px">${t('layout.myProfile')}</h1>
      </div>
    </div>
    ${isFirst ? firstLoginAlert() : ''}
    <div class="split">
      ${accountCard(profile)}
      ${passwordCard()}
    </div>
    ${sessionCard()}`);

  const form = document.getElementById('pw-form');
  form.addEventListener('submit', (e) => onPasswordSubmit(e, home));
  form.addEventListener('reset', () => clearErrors(form));
  document.getElementById('lang').addEventListener('change', onLangChange);
  document.getElementById('logout-session').addEventListener('click', () => logout());
  if (isFirst) form.querySelector('[name="current"]').focus();
}

main();
