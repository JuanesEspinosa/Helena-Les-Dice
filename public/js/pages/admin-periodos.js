// Vista 16 · Periodos académicos (RF-17)
import { get, post, put, del } from '../core/api.js';
import { html, icon, safe, fmtDate, toast, clearErrors, showError, withBusy, confirmDialog, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

let periods = [];
let editing = null;

// Las fechas llegan como "AAAA-MM-DD": se leen en hora local para no correr un día
const fmtDay = (s) => fmtDate(`${s}T00:00:00`);

await initLayout({ roles: ['administrador'], active: 'periodos' });
const main = setMain(html`
  <div class="page-head"><div>
    <h1 class="page-title">Periodos académicos</h1>
    <p class="page-sub">Solo en los periodos activos el docente puede crear equipos.</p>
  </div></div>
  <div id="notice" aria-live="assertive"></div>
  <div class="split">
    <section class="card grow" aria-label="Lista de periodos"><div id="list">${loading()}</div></section>
    <aside class="side"><form class="card card-pad stack" id="period-form" novalidate aria-labelledby="form-title"></form></aside>
  </div>`);

const form = main.querySelector('#period-form');
const notice = main.querySelector('#notice');

renderForm();
await load();
if (location.hash === '#nuevo') form.querySelector('[name="name"]').focus();

main.querySelector('#list').addEventListener('click', onListClick);
notice.addEventListener('click', (e) => { if (e.target.closest('[data-dismiss]')) notice.innerHTML = ''; });
form.addEventListener('submit', onSubmit);
form.addEventListener('click', (e) => { if (e.target.closest('[data-act="cancel"]')) cancelEdit(); });
form.addEventListener('change', (e) => { if (e.target.type === 'date') checkDates(false); });

async function load() {
  try {
    ({ periods } = await get('/admin/periods'));
    renderList();
  } catch (err) {
    main.querySelector('#list').innerHTML = html`<div class="card-body"><div class="alert alert-error" role="alert">${icon('alert')}<div>${err.message}</div></div></div>`;
  }
}

function renderList() {
  const box = main.querySelector('#list');
  if (periods.length === 0) {
    box.innerHTML = emptyState('calendar', 'Aún no hay periodos', 'Crea el primer semestre con el formulario para que los docentes puedan armar equipos.').value;
    return;
  }
  box.innerHTML = html`<div class="table-wrap"><table class="table">
    <thead><tr><th scope="col">Periodo</th><th scope="col">Inicio</th><th scope="col">Fin</th>
      <th scope="col" class="num">Equipos</th><th scope="col">Estado</th><th scope="col" class="actions">Acciones</th></tr></thead>
    <tbody>${periods.map((p) => safe(html`<tr>
      <td><strong>${p.name}</strong></td>
      <td>${fmtDay(p.start_date)}</td>
      <td>${fmtDay(p.end_date)}</td>
      <td class="num">${p.teams}</td>
      <td>${p.active ? safe('<span class="pill pill-activo">Activo</span>') : safe('<span class="pill pill-inactivo">Inactivo</span>')}</td>
      <td class="actions">
        <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${p.id}">${icon('edit', 16)}Editar</button>
        <button type="button" class="btn ${p.active ? 'btn-danger-outline' : 'btn-outline'} btn-sm" data-act="toggle" data-id="${p.id}">${p.active ? 'Inactivar' : 'Activar'}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${p.id}" aria-label="Eliminar el periodo ${p.name}" title="Eliminar">${icon('trash', 16)}</button>
      </td>
    </tr>`))}</tbody></table></div>`;
}

async function onListClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const p = periods.find((x) => x.id === Number(btn.dataset.id));
  if (!p) return;
  if (btn.dataset.act === 'edit') return startEdit(p);
  if (btn.dataset.act === 'toggle') return toggle(btn, p);
  if (btn.dataset.act === 'delete') return remove(btn, p);
}

async function toggle(btn, p) {
  const ok = await confirmDialog(p.active
    ? { title: `¿Inactivar el periodo ${p.name}?`, message: 'Los docentes no podrán crear equipos nuevos en él. Los equipos y avances existentes se conservan.', confirmText: 'Inactivar', danger: true }
    : { title: `¿Activar el periodo ${p.name}?`, message: 'Los docentes podrán crear equipos en este periodo.', confirmText: 'Activar' });
  if (!ok) return;
  try {
    await withBusy(btn, () => post(`/admin/periods/${p.id}/toggle`));
    toast(p.active ? `El periodo ${p.name} quedó inactivo.` : `El periodo ${p.name} quedó activo.`);
    await load();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function remove(btn, p) {
  notice.innerHTML = '';
  const ok = await confirmDialog({ title: `¿Eliminar el periodo ${p.name}?`, message: 'Esta acción no se puede deshacer.', confirmText: 'Eliminar', danger: true });
  if (!ok) return;
  try {
    await withBusy(btn, () => del(`/admin/periods/${p.id}`));
    toast(`Se eliminó el periodo ${p.name}.`);
    if (editing && editing.id === p.id) cancelEdit();
    await load();
  } catch (err) {
    if (err.status !== 409) return toast(err.message, 'error');
    notice.innerHTML = html`<div class="alert alert-warn" role="alert">${icon('warning')}
      <div style="flex:1">${err.message}</div>
      <button type="button" class="btn btn-outline btn-sm" data-dismiss>Entendido</button></div>`;
    notice.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---------- Formulario ----------

function renderForm() {
  const p = editing || { name: '', start_date: '', end_date: '', active: false };
  form.innerHTML = html`
    <h2 class="card-title" id="form-title" style="font-size:18px">${editing ? `Editar periodo ${p.name}` : 'Nuevo periodo'}</h2>
    <div class="form-alert"></div>
    <div class="field"><label class="label" for="p-nombre">Nombre del periodo</label>
      <input class="input" id="p-nombre" name="name" type="text" maxlength="20" placeholder="2027-1" required autocomplete="off" value="${p.name}"></div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field"><label class="label" for="p-ini">Fecha de inicio</label>
        <input class="input" id="p-ini" name="start_date" type="date" required value="${p.start_date}"></div>
      <div class="field"><label class="label" for="p-fin">Fecha de fin</label>
        <input class="input" id="p-fin" name="end_date" type="date" required value="${p.end_date}"></div>
    </div>
    <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}>${editing ? 'Periodo activo' : 'Activar al crear'}</label>
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${icon(editing ? 'save' : 'plus', 18)}${editing ? 'Guardar cambios' : 'Crear periodo'}</button>
      ${editing ? safe('<button type="button" class="btn btn-ghost" data-act="cancel">Cancelar</button>') : ''}
    </div>`;
}

function startEdit(p) {
  editing = p;
  renderForm();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  form.querySelector('[name="name"]').focus({ preventScroll: true });
}

function cancelEdit() {
  editing = null;
  renderForm();
}

/** Validación de fechas en el cliente (el servidor valida lo mismo). */
function checkDates(required) {
  clearErrors(form);
  const start = form.elements.start_date.value;
  const end = form.elements.end_date.value;
  if (required && !start) return showError(form, { field: 'start_date', message: 'La fecha de inicio es obligatoria.' }), false;
  if (required && !end) return showError(form, { field: 'end_date', message: 'La fecha de fin es obligatoria.' }), false;
  if (start && end && end <= start) return showError(form, { field: 'end_date', message: 'La fecha de fin debe ser posterior a la de inicio.' }), false;
  return true;
}

async function onSubmit(e) {
  e.preventDefault();
  form.querySelector('.form-alert').innerHTML = '';
  const name = form.elements.name.value.trim();
  clearErrors(form);
  if (!name) return showError(form, { field: 'name', message: 'El nombre del periodo es obligatorio.' });
  if (!checkDates(true)) return;
  const data = {
    name,
    start_date: form.elements.start_date.value,
    end_date: form.elements.end_date.value,
    active: form.elements.active.checked,
  };
  const btn = form.querySelector('[type="submit"]');
  try {
    if (editing) {
      await withBusy(btn, () => put(`/admin/periods/${editing.id}`, data));
      toast('Los cambios se guardaron.');
      cancelEdit();
    } else {
      await withBusy(btn, () => post('/admin/periods', data));
      toast(`Se creó el periodo ${name}.`);
      form.reset();
    }
    await load();
  } catch (err) {
    showError(form, err);
  }
}
