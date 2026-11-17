// Vista 18 · Copias de seguridad (RF-19)
import { get, ApiError } from '../core/api.js';
import { html, icon, safe, fmtBytes, toast, clearErrors, showError, withBusy, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';
import { t, has, getLocale } from '../core/i18n.js';

/** Tipo de copia que guarda el servidor (automatica | manual) → texto. */
const kindLabel = (kind) => (has(`admin.backups.kind.${kind}`) ? t(`admin.backups.kind.${kind}`) : kind);
const fmtLong = (d) => {
  const s = new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
  return s.charAt(0).toLocaleUpperCase(getLocale()) + s.slice(1);
};
const downloadUrl = (id) => `/api/admin/backups/${id}/download`;

let backups = [];

await initLayout({ roles: ['administrador'], active: 'backups' });
const main = setMain(html`
  <div class="page-head"><div>
    <h1 class="page-title">${t('menu.administrador.backups')}</h1>
    <p class="page-sub">${t('admin.backups.lead')}</p>
  </div></div>
  <section class="card card-pad" aria-labelledby="manual">
    <div class="row between" style="align-items:center">
      <div class="stack" style="gap:6px;flex:1 1 320px">
        <h2 id="manual" class="card-title" style="font-size:18px">${t('admin.backups.manualTitle')}</h2>
        <p class="muted">${t('admin.backups.manualText')}</p>
      </div>
      <button type="button" class="btn btn-primary" id="gen-btn">${icon('database', 18)}${t('admin.backups.generate')}</button>
    </div>
  </section>
  <section class="card" aria-labelledby="hist">
    <div class="card-head"><h2 id="hist" class="card-title">${t('admin.panel.backupHistory')}</h2></div>
    <div id="list">${loading()}</div>
  </section>
  <dialog class="modal" id="confirm-dlg" aria-labelledby="conf">
    <form class="modal__body" id="confirm-form" novalidate>
      <span class="stat__icon" aria-hidden="true">${icon('lock', 20)}</span>
      <h2 class="modal__title" id="conf">${t('admin.backups.confirmTitle')}</h2>
      <p class="muted">${t('admin.backups.confirmText')}</p>
      <div class="field"><label class="label" for="c-clave">${t('fields.password')}</label>
        <input class="input" id="c-clave" name="password" type="password" autocomplete="current-password" required></div>
      <div class="form-actions" style="justify-content:flex-end">
        <button type="button" class="btn btn-ghost" data-cancel>${t('common.cancel')}</button>
        <button type="submit" class="btn btn-primary">${icon('download', 18)}${t('admin.backups.confirmDownload')}</button>
      </div>
    </form>
  </dialog>`);

const dlg = main.querySelector('#confirm-dlg');
const form = main.querySelector('#confirm-form');

main.querySelector('#gen-btn').addEventListener('click', openDialog);
form.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
form.addEventListener('submit', onConfirm);
await load();

async function load() {
  try {
    ({ backups } = await get('/admin/backups'));
    renderList();
  } catch (err) {
    main.querySelector('#list').innerHTML = html`<div class="card-body"><div class="alert alert-error" role="alert">${icon('alert')}<div>${err.message}</div></div></div>`;
  }
}

function renderList() {
  const box = main.querySelector('#list');
  if (backups.length === 0) {
    box.innerHTML = emptyState('database', t('admin.backups.emptyTitle'), t('admin.backups.emptyText')).value;
    return;
  }
  box.innerHTML = html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">${t('admin.backups.date')}</th><th scope="col">${t('admin.type')}</th><th scope="col">${t('admin.backups.by')}</th>
      <th scope="col" class="num">${t('admin.backups.size')}</th><th scope="col">${t('admin.backups.result')}</th><th scope="col" class="actions"><span class="sr-only">${t('admin.backups.download')}</span></th></tr></thead>
    <tbody>${backups.map((b) => safe(html`<tr>
      <td>${fmtLong(b.created_at)}</td>
      <td>${kindLabel(b.kind)}</td>
      <td>${b.created_by_name || t('teacher.team.system')}</td>
      <td class="num">${fmtBytes(b.size_bytes)}</td>
      <td>${b.status === 'exitosa'
        ? safe(html`<span class="pill pill-aprobado">${t('admin.backups.done')}</span>`)
        : safe(html`<span class="pill pill-fallida">${t('admin.backups.failed')}</span><div class="small" style="color:var(--danger);margin-top:4px;max-width:320px">${b.error || t('admin.backups.unknownError')}</div>`)}</td>
      <td class="actions">${b.available
        ? safe(html`<a class="btn btn-outline btn-sm" href="${downloadUrl(b.id)}" download="${b.filename}">${icon('download', 16)}${t('admin.backups.download')}</a>`)
        : safe(b.status === 'exitosa' ? html`<span class="muted small">${t('admin.backups.unavailable')}</span>` : '')}</td>
    </tr>`))}</tbody></table></div>`;
}

function openDialog() {
  form.reset();
  clearErrors(form);
  dlg.showModal();
  form.elements.password.focus();
}

/**
 * Pide la copia. Se usa fetch directo porque api.js redirige al login ante cualquier 401,
 * y aquí un 401 con field "password" solo significa que la contraseña no coincide.
 */
async function requestBackup(password) {
  let res;
  try {
    res = await fetch('/api/admin/backups', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new ApiError(0, { code: 'OFFLINE', error: t('errors.OFFLINE') });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.field !== 'password') {
    location.href = `/index.html?expirada=${encodeURIComponent(data.code || 'SESSION_ENDED')}`;
  }
  if (!res.ok) throw new ApiError(res.status, { ...data, error: data.error || t('errors.UNEXPECTED') });
  return data.backup;
}

async function onConfirm(e) {
  e.preventDefault();
  clearErrors(form);
  const password = form.elements.password.value;
  if (!password) return showError(form, { field: 'password', message: t('admin.backups.passwordRequired') });
  const btn = form.querySelector('[type="submit"]');
  try {
    const backup = await withBusy(btn, () => requestBackup(password));
    dlg.close();
    download(backup);
    toast(t('admin.backups.generated', { size: fmtBytes(backup.size_bytes) }));
  } catch (err) {
    if (err.field === 'password') return showError(form, err);
    dlg.close();
    toast(err.message, 'error');
  }
  await load();
}

function download(backup) {
  const a = document.createElement('a');
  a.href = downloadUrl(backup.id);
  a.download = backup.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
