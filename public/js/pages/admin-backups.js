// Vista 18 · Copias de seguridad (RF-19)
import { get, ApiError } from '../core/api.js';
import { html, icon, safe, fmtBytes, toast, clearErrors, showError, withBusy, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

const KIND_LABEL = { automatica: 'Automática', manual: 'Manual' };
const longDate = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const fmtLong = (d) => {
  const s = longDate.format(new Date(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const downloadUrl = (id) => `/api/admin/backups/${id}/download`;

let backups = [];

await initLayout({ roles: ['administrador'], active: 'backups' });
const main = setMain(html`
  <div class="page-head"><div>
    <h1 class="page-title">Copias de seguridad</h1>
    <p class="page-sub">La plataforma hace una copia automática cada semana. También puedes generar una manual cuando lo necesites.</p>
  </div></div>
  <section class="card card-pad" aria-labelledby="manual">
    <div class="row between" style="align-items:center">
      <div class="stack" style="gap:6px;flex:1 1 320px">
        <h2 id="manual" class="card-title" style="font-size:18px">Copia manual</h2>
        <p class="muted">Incluye usuarios, equipos, secciones, versiones, comentarios, logros y registros de actividad. Se descarga como archivo comprimido (.sql.gz).</p>
      </div>
      <button type="button" class="btn btn-primary" id="gen-btn">${icon('database', 18)}Generar backup de seguridad</button>
    </div>
  </section>
  <section class="card" aria-labelledby="hist">
    <div class="card-head"><h2 id="hist" class="card-title">Historial de copias</h2></div>
    <div id="list">${loading()}</div>
  </section>
  <dialog class="modal" id="confirm-dlg" aria-labelledby="conf">
    <form class="modal__body" id="confirm-form" novalidate>
      <span class="stat__icon" aria-hidden="true">${icon('lock', 20)}</span>
      <h2 class="modal__title" id="conf">Confirma tu identidad</h2>
      <p class="muted">Para generar la copia, escribe de nuevo tu contraseña.</p>
      <div class="field"><label class="label" for="c-clave">Contraseña</label>
        <input class="input" id="c-clave" name="password" type="password" autocomplete="current-password" required></div>
      <div class="form-actions" style="justify-content:flex-end">
        <button type="button" class="btn btn-ghost" data-cancel>Cancelar</button>
        <button type="submit" class="btn btn-primary">${icon('download', 18)}Confirmar y descargar</button>
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
    box.innerHTML = emptyState('database', 'Aún no hay copias', 'La primera copia automática se generará en la próxima hora, o puedes generar una manual ahora.').value;
    return;
  }
  box.innerHTML = html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Fecha</th><th scope="col">Tipo</th><th scope="col">Generada por</th>
      <th scope="col" class="num">Tamaño</th><th scope="col">Resultado</th><th scope="col" class="actions"><span class="sr-only">Descargar</span></th></tr></thead>
    <tbody>${backups.map((b) => safe(html`<tr>
      <td>${fmtLong(b.created_at)}</td>
      <td>${KIND_LABEL[b.kind] || b.kind}</td>
      <td>${b.created_by_name || 'Sistema'}</td>
      <td class="num">${fmtBytes(b.size_bytes)}</td>
      <td>${b.status === 'exitosa'
        ? safe('<span class="pill pill-aprobado">Completada</span>')
        : safe(html`<span class="pill pill-fallida">Fallida</span><div class="small" style="color:var(--danger);margin-top:4px;max-width:320px">${b.error || 'Error desconocido.'}</div>`)}</td>
      <td class="actions">${b.available
        ? safe(html`<a class="btn btn-outline btn-sm" href="${downloadUrl(b.id)}" download="${b.filename}">${icon('download', 16)}Descargar</a>`)
        : safe(b.status === 'exitosa' ? '<span class="muted small">Archivo no disponible</span>' : '')}</td>
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
    throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.field !== 'password') {
    location.href = `/index.html?expirada=${encodeURIComponent(data.error || 'Tu sesión terminó.')}`;
  }
  if (!res.ok) throw new ApiError(res.status, data.error || 'Ocurrió un error inesperado.', data.field);
  return data.backup;
}

async function onConfirm(e) {
  e.preventDefault();
  clearErrors(form);
  const password = form.elements.password.value;
  if (!password) return showError(form, { field: 'password', message: 'Escribe tu contraseña para confirmar.' });
  const btn = form.querySelector('[type="submit"]');
  try {
    const backup = await withBusy(btn, () => requestBackup(password));
    dlg.close();
    download(backup);
    toast(`Copia generada (${fmtBytes(backup.size_bytes)}). La descarga comenzó.`);
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
