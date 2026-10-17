// Vista 07 · Gestión de usuarios (RF-02, RF-16)
import { get, post, put, del } from '../core/api.js';
import { html, icon, safe, ago, toast, clearErrors, showError, formData, withBusy, confirmDialog, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

const ROLE_LABEL = { estudiante: 'Estudiante', docente: 'Docente', administrador: 'Administrador' };
const DEBOUNCE_MS = 300;

let users = [];
let myId = 0;
let editing = null; // usuario en edición o null
let seq = 0;

await initLayout({ roles: ['administrador'], active: 'usuarios' });
const main = setMain(html`
  <div class="page-head"><div>
    <h1 class="page-title">Usuarios</h1>
    <p class="page-sub">Crea, edita y desactiva cuentas, y define el tipo de cada usuario.</p>
  </div></div>
  <div class="grid grid-4" id="counts" aria-live="polite"></div>
  <div class="split">
    <section class="card grow" aria-label="Lista de usuarios">
      <div class="card-head filters">
        <div class="field" style="flex:2 1 240px">
          <label class="sr-only" for="buscar">Buscar usuario</label>
          <div class="input-icon">${icon('search', 18)}<input class="input" id="buscar" type="search" placeholder="Buscar por nombre o correo" autocomplete="off"></div>
        </div>
        <div class="field" style="flex:1 1 150px">
          <label class="sr-only" for="tipo-f">Tipo de usuario</label>
          <select class="select" id="tipo-f"><option value="">Todos los tipos</option>
            <option value="estudiante">Estudiante</option><option value="docente">Docente</option><option value="administrador">Administrador</option></select>
        </div>
        <div class="field" style="flex:1 1 150px">
          <label class="sr-only" for="estado-f">Estado</label>
          <select class="select" id="estado-f"><option value="">Todos los estados</option>
            <option value="activo">Activo</option><option value="inactivo">Inactivo</option></select>
        </div>
      </div>
      <div id="list">${loading()}</div>
    </section>
    <aside class="side">
      <form class="card card-pad stack" id="user-form" novalidate aria-labelledby="form-title"></form>
    </aside>
  </div>`);

const form = main.querySelector('#user-form');
const search = main.querySelector('#buscar');
const roleFilter = main.querySelector('#tipo-f');
const statusFilter = main.querySelector('#estado-f');

renderForm();
await load();
if (location.hash === '#nuevo') form.querySelector('[name="name"]').focus();

let timer;
search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, DEBOUNCE_MS); });
roleFilter.addEventListener('change', load);
statusFilter.addEventListener('change', load);
main.querySelector('#list').addEventListener('click', onListClick);
form.addEventListener('submit', onSubmit);
form.addEventListener('click', onFormClick);

async function load() {
  const id = ++seq;
  const qs = new URLSearchParams({ q: search.value.trim(), role: roleFilter.value, status: statusFilter.value });
  try {
    const data = await get(`/admin/users?${qs}`);
    if (id !== seq) return; // llegó una respuesta más nueva
    users = data.users;
    myId = data.me;
    renderCounts(data.counts);
    renderList();
  } catch (err) {
    if (id !== seq) return;
    main.querySelector('#list').innerHTML = html`<div class="card-body"><div class="alert alert-error" role="alert">${icon('alert')}<div>${err.message}</div></div></div>`;
  }
}

function renderCounts(c) {
  const stat = (label, value) => safe(html`<div class="card stat"><div class="stat__label">${label}</div><div class="stat__value">${value}</div></div>`);
  main.querySelector('#counts').innerHTML = html`${stat('Estudiantes', c.estudiante)}${stat('Docentes', c.docente)}${stat('Administradores', c.administrador)}${stat('Cuentas inactivas', c.inactive)}`;
}

function renderList() {
  const box = main.querySelector('#list');
  const filtered = search.value.trim() || roleFilter.value || statusFilter.value;
  if (users.length === 0) {
    box.innerHTML = filtered
      ? emptyState('search', 'Ningún usuario coincide con la búsqueda', 'Prueba con otro nombre, correo o filtro.').value
      : emptyState('users', 'Aún no hay usuarios', 'Crea la primera cuenta con el formulario.').value;
    return;
  }
  box.innerHTML = html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Nombre</th><th scope="col">Correo institucional</th><th scope="col">Tipo</th>
      <th scope="col">Estado</th><th scope="col">Último acceso</th><th scope="col" class="actions">Acciones</th></tr></thead>
    <tbody>${users.map(row)}</tbody></table></div>`;
}

function row(u) {
  const self = u.id === myId;
  const canDelete = !self && !u.has_contributions;
  return safe(html`<tr>
    <td><strong>${u.name}</strong>${self ? safe(' <span class="tag">Tú</span>') : ''}</td>
    <td class="muted">${u.email}</td>
    <td><span class="tag role-${u.role}">${ROLE_LABEL[u.role]}</span></td>
    <td>${u.active ? safe('<span class="pill pill-activo">Activo</span>') : safe('<span class="pill pill-inactivo">Inactivo</span>')}</td>
    <td class="muted">${u.last_login ? ago(u.last_login) : 'Nunca'}</td>
    <td class="actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}">${icon('edit', 16)}Editar</button>
      ${self ? '' : u.active
        ? safe(html`<button type="button" class="btn btn-danger-outline btn-sm" data-act="deactivate" data-id="${u.id}">Desactivar</button>`)
        : safe(html`<button type="button" class="btn btn-outline btn-sm" data-act="reactivate" data-id="${u.id}">Reactivar</button>`)}
      ${canDelete ? safe(html`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${u.id}" aria-label="Eliminar ${u.name}" title="Eliminar (no tiene aportes)">${icon('trash', 16)}</button>`) : ''}
    </td>
  </tr>`);
}

async function onListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const u = users.find((x) => x.id === Number(btn.dataset.id));
  if (!u) return;
  if (btn.dataset.act === 'edit') return startEdit(u);
  if (btn.dataset.act === 'deactivate') return changeState(btn, u, false);
  if (btn.dataset.act === 'reactivate') return changeState(btn, u, true);
  if (btn.dataset.act === 'delete') return remove(btn, u);
}

async function changeState(btn, u, active) {
  const ok = await confirmDialog(active
    ? { title: `¿Reactivar a ${u.name}?`, message: 'La persona podrá volver a iniciar sesión con su contraseña.', confirmText: 'Reactivar' }
    : { title: `¿Desactivar a ${u.name}?`, message: 'No podrá iniciar sesión, pero sus aportes y su historial se conservan. Puedes reactivarla cuando quieras.', confirmText: 'Desactivar', danger: true });
  if (!ok) return;
  try {
    await withBusy(btn, () => post(`/admin/users/${u.id}/${active ? 'reactivate' : 'deactivate'}`));
    toast(active ? `Se reactivó la cuenta de ${u.name}.` : `Se desactivó la cuenta de ${u.name}.`);
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function remove(btn, u) {
  const ok = await confirmDialog({ title: `¿Eliminar la cuenta de ${u.name}?`, message: 'La cuenta no tiene aportes registrados. Esta acción no se puede deshacer.', confirmText: 'Eliminar', danger: true });
  if (!ok) return;
  try {
    await withBusy(btn, () => del(`/admin/users/${u.id}`));
    toast(`Se eliminó la cuenta de ${u.name}.`);
    if (editing && editing.id === u.id) cancelEdit();
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Formulario ----------

function renderForm() {
  const u = editing || { name: '', email: '', role: 'estudiante' };
  const radio = (value) => html`<label class="check"><input type="radio" name="role" value="${value}" ${u.role === value ? 'checked' : ''}>${ROLE_LABEL[value]}</label>`;
  form.innerHTML = html`
    <h2 class="card-title" id="form-title" style="font-size:18px">${editing ? `Editar usuario` : 'Nuevo usuario'}</h2>
    <div class="form-alert"></div>
    <div class="field"><label class="label" for="n-nombre">Nombre completo</label>
      <input class="input" id="n-nombre" name="name" type="text" maxlength="120" required autocomplete="off" value="${u.name}"></div>
    <div class="field"><label class="label" for="n-correo">Correo institucional</label>
      <input class="input" id="n-correo" name="email" type="email" maxlength="160" required autocomplete="off" placeholder="nombre@elpoli.edu.co" value="${u.email}"></div>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:4px">Tipo de usuario</legend>
      ${safe(radio('estudiante'))}${safe(radio('docente'))}${safe(radio('administrador'))}</fieldset>
    ${editing
      ? safe(html`<div class="note small">${icon('key', 16)}<span>Si la persona olvidó su contraseña, puedes asignarle una temporal nueva.</span>
          <button type="button" class="btn btn-outline btn-sm" data-act="reset" style="align-self:flex-start">Asignar contraseña temporal</button></div>`)
      : safe(html`<p class="note small muted">Se asignará una contraseña temporal que el usuario deberá cambiar en su primer ingreso.</p>`)}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${icon(editing ? 'save' : 'plus', 18)}${editing ? 'Guardar cambios' : 'Crear usuario'}</button>
      ${editing ? safe('<button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>') : ''}
    </div>`;
}

function startEdit(u) {
  editing = u;
  renderForm();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.querySelector('[name="name"]').focus({ preventScroll: true });
}

function cancelEdit() {
  editing = null;
  renderForm();
}

async function onFormClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'cancel') return cancelEdit();
  if (btn.dataset.act === 'reset') {
    const u = editing;
    const ok = await confirmDialog({ title: `¿Asignar una contraseña temporal a ${u.name}?`, message: 'Su contraseña actual dejará de funcionar y deberá cambiar la nueva en su siguiente ingreso.', confirmText: 'Asignar' });
    if (!ok) return;
    try {
      const { tempPassword } = await withBusy(btn, () => post(`/admin/users/${u.id}/reset-password`));
      showTempPassword(u, tempPassword, 'Nueva contraseña temporal');
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function validate(data) {
  if (!data.name.trim()) return { field: 'name', message: 'El nombre es obligatorio.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return { field: 'email', message: 'Escribe un correo con formato válido.' };
  if (!data.role) return { field: 'role', message: 'Selecciona un tipo de usuario.' };
  return null;
}

async function onSubmit(e) {
  e.preventDefault();
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const data = formData(form);
  const invalid = validate(data);
  if (invalid) return showError(form, invalid);
  const btn = form.querySelector('[type="submit"]');
  try {
    if (editing) {
      await withBusy(btn, () => put(`/admin/users/${editing.id}`, data));
      toast('Los cambios se guardaron.');
      cancelEdit();
    } else {
      const res = await withBusy(btn, () => post('/admin/users', data));
      form.reset();
      showTempPassword(res.user, res.tempPassword, 'Cuenta creada');
    }
    await load();
  } catch (err) {
    showError(form, err);
  }
}

/** Muestra la contraseña temporal una sola vez, con botón para copiarla. */
function showTempPassword(u, password, title) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.setAttribute('aria-labelledby', 'tmp-title');
  dlg.innerHTML = html`<div class="modal__body">
    <h2 class="modal__title" id="tmp-title">${title}</h2>
    <p class="muted">Comunica esta contraseña temporal a <strong>${u.name}</strong> (${u.email}). Deberá cambiarla en su primer ingreso.</p>
    <div class="field"><label class="label" for="tmp-pass">Contraseña temporal</label>
      <div class="row" style="flex-wrap:nowrap"><input class="input" id="tmp-pass" readonly value="${password}" style="font-family:ui-monospace,Consolas,monospace;font-size:18px;letter-spacing:.06em">
      <button type="button" class="btn btn-outline" data-copy>${icon('file', 18)}Copiar</button></div></div>
    <div class="alert alert-warn">${icon('warning')}<div>Por seguridad no se volverá a mostrar. Si se pierde, asigna una nueva desde Editar.</div></div>
    <div class="form-actions" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-close>Listo</button></div>
  </div>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.querySelector('[data-copy]').addEventListener('click', () => copy(dlg.querySelector('#tmp-pass')));
  dlg.showModal();
  dlg.querySelector('#tmp-pass').select();
}

async function copy(input) {
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  toast('Contraseña copiada al portapapeles.');
}
