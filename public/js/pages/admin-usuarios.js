// Vista 07 · Gestión de usuarios (RF-02, RF-16)
import { get, post, put, del } from '../core/api.js';
import { html, icon, safe, ago, toast, clearErrors, showError, formData, withBusy, confirmDialog, emptyState, loading, fmtNumber } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';
import { t } from '../core/i18n.js';

const roleLabel = (role) => t(`roles.${role}`);
const DEBOUNCE_MS = 300;

let users = [];
let myId = 0;
let editing = null; // usuario en edición o null
let seq = 0;

await initLayout({ roles: ['administrador'], active: 'usuarios' });
const main = setMain(html`
  <div class="page-head"><div>
    <h1 class="page-title">${t('menu.administrador.usuarios')}</h1>
    <p class="page-sub">${t('admin.users.lead')}</p>
  </div></div>
  <div class="grid grid-4" id="counts" aria-live="polite"></div>
  <div class="split">
    <section class="card grow" aria-label="${t('admin.users.listLabel')}">
      <div class="card-head filters">
        <div class="field" style="flex:2 1 240px">
          <label class="sr-only" for="buscar">${t('admin.users.search')}</label>
          <div class="input-icon">${icon('search', 18)}<input class="input" id="buscar" type="search" placeholder="${t('teacher.teams.searchPlaceholder')}" autocomplete="off"></div>
        </div>
        <div class="field" style="flex:1 1 150px">
          <label class="sr-only" for="tipo-f">${t('admin.users.userType')}</label>
          <select class="select" id="tipo-f"><option value="">${t('admin.users.allTypes')}</option>
            <option value="estudiante">${roleLabel('estudiante')}</option><option value="docente">${roleLabel('docente')}</option><option value="administrador">${roleLabel('administrador')}</option></select>
        </div>
        <div class="field" style="flex:1 1 150px">
          <label class="sr-only" for="estado-f">${t('common.status')}</label>
          <select class="select" id="estado-f"><option value="">${t('admin.users.allStatuses')}</option>
            <option value="activo">${t('admin.active')}</option><option value="inactivo">${t('admin.inactiveM')}</option></select>
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
  main.querySelector('#counts').innerHTML = html`${stat(t('admin.panel.byRole.estudiante'), fmtNumber(c.estudiante))}${stat(t('admin.panel.byRole.docente'), fmtNumber(c.docente))}${stat(t('admin.panel.byRole.administrador'), fmtNumber(c.administrador))}${stat(t('admin.panel.inactiveAccounts'), fmtNumber(c.inactive))}`;
}

function renderList() {
  const box = main.querySelector('#list');
  const filtered = search.value.trim() || roleFilter.value || statusFilter.value;
  if (users.length === 0) {
    box.innerHTML = filtered
      ? emptyState('search', t('admin.users.noMatchTitle'), t('admin.users.noMatchText')).value
      : emptyState('users', t('admin.users.emptyTitle'), t('admin.users.emptyText')).value;
    return;
  }
  box.innerHTML = html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">${t('fields.name')}</th><th scope="col">${t('access.emailLabel')}</th><th scope="col">${t('admin.type')}</th>
      <th scope="col">${t('common.status')}</th><th scope="col">${t('admin.users.lastAccess')}</th><th scope="col" class="actions">${t('common.actions')}</th></tr></thead>
    <tbody>${users.map(row)}</tbody></table></div>`;
}

function row(u) {
  const self = u.id === myId;
  const canDelete = !self && !u.has_contributions;
  return safe(html`<tr>
    <td><strong>${u.name}</strong>${self ? safe(html` <span class="tag">${t('admin.users.you')}</span>`) : ''}</td>
    <td class="muted">${u.email}</td>
    <td><span class="tag role-${u.role}">${roleLabel(u.role)}</span></td>
    <td>${u.active ? safe(html`<span class="pill pill-activo">${t('admin.active')}</span>`) : safe(html`<span class="pill pill-inactivo">${t('admin.inactiveM')}</span>`)}</td>
    <td class="muted">${u.last_login ? ago(u.last_login) : t('admin.users.never')}</td>
    <td class="actions">
      <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}">${icon('edit', 16)}${t('common.edit')}</button>
      ${self ? '' : u.active
        ? safe(html`<button type="button" class="btn btn-danger-outline btn-sm" data-act="deactivate" data-id="${u.id}">${t('admin.users.deactivate')}</button>`)
        : safe(html`<button type="button" class="btn btn-outline btn-sm" data-act="reactivate" data-id="${u.id}">${t('admin.users.reactivate')}</button>`)}
      ${canDelete ? safe(html`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${u.id}" aria-label="${t('admin.users.deleteNamed', { name: u.name })}" title="${t('admin.users.deleteHint')}">${icon('trash', 16)}</button>`) : ''}
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
    ? { title: t('admin.users.reactivateTitle', { name: u.name }), message: t('admin.users.reactivateText'), confirmText: t('admin.users.reactivate') }
    : { title: t('admin.users.deactivateTitle', { name: u.name }), message: t('admin.users.deactivateText'), confirmText: t('admin.users.deactivate'), danger: true });
  if (!ok) return;
  try {
    await withBusy(btn, () => post(`/admin/users/${u.id}/${active ? 'reactivate' : 'deactivate'}`));
    toast(t(active ? 'admin.users.reactivated' : 'admin.users.deactivated', { name: u.name }));
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function remove(btn, u) {
  const ok = await confirmDialog({ title: t('admin.users.deleteTitle', { name: u.name }), message: t('admin.users.deleteText'), confirmText: t('common.delete'), danger: true });
  if (!ok) return;
  try {
    await withBusy(btn, () => del(`/admin/users/${u.id}`));
    toast(t('admin.users.deleted', { name: u.name }));
    if (editing && editing.id === u.id) cancelEdit();
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Formulario ----------

function renderForm() {
  const u = editing || { name: '', email: '', role: 'estudiante' };
  const radio = (value) => html`<label class="check"><input type="radio" name="role" value="${value}" ${u.role === value ? 'checked' : ''}>${roleLabel(value)}</label>`;
  form.innerHTML = html`
    <h2 class="card-title" id="form-title" style="font-size:18px">${t(editing ? 'admin.users.editTitle' : 'admin.users.newTitle')}</h2>
    <div class="form-alert"></div>
    <div class="field"><label class="label" for="n-nombre">${t('fields.fullName')}</label>
      <input class="input" id="n-nombre" name="name" type="text" maxlength="120" required autocomplete="off" value="${u.name}"></div>
    <div class="field"><label class="label" for="n-correo">${t('access.emailLabel')}</label>
      <input class="input" id="n-correo" name="email" type="email" maxlength="160" required autocomplete="off" placeholder="${t('admin.users.emailPlaceholder')}" value="${u.email}"></div>
    <fieldset class="field" style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:4px">${t('admin.users.userType')}</legend>
      ${safe(radio('estudiante'))}${safe(radio('docente'))}${safe(radio('administrador'))}</fieldset>
    ${editing
      ? safe(html`<div class="note small">${icon('key', 16)}<span>${t('admin.users.resetHint')}</span>
          <button type="button" class="btn btn-outline btn-sm" data-act="reset" style="align-self:flex-start">${t('admin.users.assignTemp')}</button></div>`)
      : safe(html`<p class="note small muted">${t('admin.users.tempNote')}</p>`)}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${icon(editing ? 'save' : 'plus', 18)}${t(editing ? 'common.saveChanges' : 'admin.panel.quick.userTitle')}</button>
      ${editing ? safe(html`<button type="button" class="btn btn-ghost" data-act="cancel">${t('common.cancel')}</button>`) : ''}
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
    const ok = await confirmDialog({ title: t('admin.users.resetTitle', { name: u.name }), message: t('admin.users.resetText'), confirmText: t('admin.users.assign') });
    if (!ok) return;
    try {
      const { tempPassword } = await withBusy(btn, () => post(`/admin/users/${u.id}/reset-password`));
      showTempPassword(u, tempPassword, t('admin.users.newTemp'));
    } catch (err) {
      toast(err.message, 'error');
    }
  }
}

function validate(data) {
  if (!data.name.trim()) return { field: 'name', message: t('admin.users.nameRequired') };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim())) return { field: 'email', message: t('errors.EMAIL_INVALID') };
  if (!data.role) return { field: 'role', message: t('admin.users.roleRequired') };
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
      toast(t('common.saved'));
      cancelEdit();
    } else {
      const res = await withBusy(btn, () => post('/admin/users', data));
      form.reset();
      showTempPassword(res.user, res.tempPassword, t('admin.users.created'));
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
    <p class="muted">${t('admin.users.tempShare', { name: u.name, email: u.email })}</p>
    <div class="field"><label class="label" for="tmp-pass">${t('admin.users.tempPassword')}</label>
      <div class="row" style="flex-wrap:nowrap"><input class="input" id="tmp-pass" readonly value="${password}" style="font-family:ui-monospace,Consolas,monospace;font-size:18px;letter-spacing:.06em">
      <button type="button" class="btn btn-outline" data-copy>${icon('file', 18)}${t('admin.users.copy')}</button></div></div>
    <div class="alert alert-warn">${icon('warning')}<div>${t('admin.users.tempOnce')}</div></div>
    <div class="form-actions" style="justify-content:flex-end"><button type="button" class="btn btn-primary" data-close>${t('admin.users.done')}</button></div>
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
  toast(t('admin.users.copied'));
}
