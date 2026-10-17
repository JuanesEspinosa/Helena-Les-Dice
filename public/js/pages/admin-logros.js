// Vista 17 · Catálogo de logros (RF-18)
import { get, post, put, del } from '../core/api.js';
import { html, icon, safe, badgeIcon, toast, clearErrors, showError, withBusy, confirmDialog, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

const ICON_CHOICES = ['medal', 'trophy', 'star', 'flag', 'target', 'rocket', 'sparkles', 'message', 'checkCircle', 'zap', 'book', 'shield'];
const MAX_ICON_BYTES = 200 * 1024;
const ICON_TYPES = ['image/png', 'image/svg+xml'];

let items = [];
let criteria = {};
let paramCriteria = [];
let selected = null; // logro en edición o null (nuevo)
let iconValue = 'medal';

await initLayout({ roles: ['administrador'], active: 'logros' });
const main = setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">Catálogo de logros</h1>
      <p class="page-sub">Insignias globales que la plataforma otorga a los equipos al cumplir cada criterio.</p>
    </div>
    <button type="button" class="btn btn-primary" id="new-btn">${icon('plus', 18)}Nuevo logro</button>
  </div>
  <div class="split">
    <section class="grow" aria-label="Logros"><div id="grid">${loading()}</div></section>
    <aside class="side"><form class="card card-pad stack" id="ach-form" novalidate aria-labelledby="form-title"></form></aside>
  </div>`);

const form = main.querySelector('#ach-form');

main.querySelector('#new-btn').addEventListener('click', () => select(null, true));
main.querySelector('#grid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-edit]');
  if (btn) select(items.find((a) => a.id === Number(btn.dataset.edit)), true);
});
form.addEventListener('submit', onSubmit);
form.addEventListener('click', onFormClick);
form.addEventListener('change', onFormChange);

await load();
select(items[0] || null, false);

async function load() {
  try {
    ({ achievements: items, criteria, paramCriteria } = await get('/admin/achievements'));
    renderGrid();
  } catch (err) {
    main.querySelector('#grid').innerHTML = html`<div class="alert alert-error" role="alert">${icon('alert')}<div>${err.message}</div></div>`;
  }
}

/** "Aprobar N secciones" + param 3 → "aprobar 3 secciones". */
function ruleText(a) {
  const base = criteria[a.criterion] || a.criterion;
  const text = paramCriteria.includes(a.criterion) ? base.replace('N', a.param) : base;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function wonText(n) { return n === 0 ? 'ningún equipo' : n === 1 ? '1 equipo' : `${n} equipos`; }

function renderGrid() {
  const box = main.querySelector('#grid');
  if (items.length === 0) {
    box.innerHTML = emptyState('medal', 'El catálogo está vacío', 'Crea el primer logro para motivar a los equipos.').value;
    return;
  }
  box.innerHTML = html`<div class="ach-grid">${items.map((a) => safe(html`
    <article class="card ach ${selected && selected.id === a.id ? 'ach--selected' : ''}">
      <span class="badge-icon">${badgeIcon(a.icon, 26)}</span>
      <span class="ach__body">
        <span class="ach__name">${a.name}</span>
        <span class="muted small">Criterio: ${ruleText(a)}</span>
        <span class="small"><strong>${a.points} puntos</strong> · ganado por ${wonText(a.teams)}</span>
      </span>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-edit="${a.id}" aria-label="Editar ${a.name}">${icon('edit', 18)}</button>
    </article>`))}</div>`;
}

function select(a, focus) {
  selected = a;
  iconValue = a ? a.icon : 'medal';
  renderForm();
  renderGrid();
  if (focus) {
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.querySelector('[name="name"]').focus({ preventScroll: true });
  }
}

// ---------- Formulario ----------

function renderForm() {
  const a = selected || { name: '', description: '', criterion: 'first_submission', param: 1, points: 50, teams: 0 };
  form.innerHTML = html`
    <h2 class="card-title" id="form-title" style="font-size:18px">${selected ? 'Editar logro' : 'Nuevo logro'}</h2>
    <div class="form-alert"></div>
    <div class="field">
      <span class="label" id="icon-label">Ícono</span>
      <div class="row" style="flex-wrap:nowrap">
        <span class="badge-icon" id="icon-preview">${badgeIcon(iconValue, 28)}</span>
        <div class="stack" style="gap:4px">
          <label class="btn btn-outline btn-sm" style="align-self:flex-start">${icon('download', 16)}Subir PNG o SVG
            <input type="file" name="icon_file" accept="image/png,image/svg+xml" class="sr-only"></label>
          <span class="hint">PNG o SVG, máximo 200 KB. O elige uno de la lista.</span>
        </div>
      </div>
      <input type="hidden" name="icon" value="${iconValue}">
      <div class="icon-grid" role="radiogroup" aria-labelledby="icon-label">${ICON_CHOICES.map((k) => safe(html`
        <button type="button" class="icon-opt" role="radio" aria-checked="${iconValue === k}" data-icon="${k}" aria-label="Ícono ${k}">${icon(k, 20)}</button>`))}</div>
    </div>
    <div class="field"><label class="label" for="l-nombre">Nombre</label>
      <input class="input" id="l-nombre" name="name" type="text" maxlength="80" required autocomplete="off" value="${a.name}"></div>
    <div class="field"><label class="label" for="l-desc">Descripción</label>
      <textarea class="textarea" id="l-desc" name="description" rows="2" maxlength="500">${a.description}</textarea></div>
    <div class="field"><label class="label" for="l-crit">Criterio</label>
      <select class="select" id="l-crit" name="criterion">${Object.entries(criteria).map(([k, label]) => safe(html`
        <option value="${k}" ${k === a.criterion ? 'selected' : ''}>${label}</option>`))}</select></div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field" id="param-field" ${paramCriteria.includes(a.criterion) ? '' : 'hidden'}><label class="label" for="l-param">Valor de N</label>
        <input class="input" id="l-param" name="param" type="number" min="1" max="1000" value="${a.param || 1}"></div>
      <div class="field"><label class="label" for="l-pts">Puntos</label>
        <input class="input" id="l-pts" name="points" type="number" min="0" max="10000" required value="${a.points}"></div>
    </div>
    ${selected && a.teams > 0 ? safe(html`<p class="note note--blue small">${wonText(a.teams).replace(/^./, (c) => c.toUpperCase())} ya ${a.teams === 1 ? 'ganó' : 'ganaron'} este logro. Si cambias el nombre o el ícono, lo verán actualizado y conservarán su fecha de obtención.</p>`) : ''}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${icon('save', 18)}${selected ? 'Guardar' : 'Crear logro'}</button>
      ${selected ? safe(html`<button type="button" class="btn btn-danger-outline" data-act="delete">${icon('trash', 18)}Eliminar</button>`) : ''}
    </div>`;
}

function setIcon(value) {
  iconValue = value;
  form.elements.icon.value = value;
  form.querySelector('#icon-preview').innerHTML = badgeIcon(value, 28).value;
  form.querySelectorAll('.icon-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.icon === value)));
}

function onFormClick(e) {
  const opt = e.target.closest('.icon-opt');
  if (opt) {
    clearErrors(form);
    return setIcon(opt.dataset.icon);
  }
  if (e.target.closest('[data-act="delete"]')) remove(e.target.closest('button'));
}

function onFormChange(e) {
  if (e.target.name === 'criterion') {
    form.querySelector('#param-field').hidden = !paramCriteria.includes(e.target.value);
  }
  if (e.target.name === 'icon_file') readIcon(e.target);
}

/** Lee el archivo como data URI tras validar tipo, peso y contenido (el servidor lo valida de nuevo). */
async function readIcon(input) {
  clearErrors(form);
  const file = input.files && input.files[0];
  input.value = '';
  if (!file) return;
  const fail = (message) => showError(form, { field: 'icon_file', message });
  if (!ICON_TYPES.includes(file.type)) return fail('El ícono debe ser una imagen PNG o SVG.');
  if (file.size > MAX_ICON_BYTES) return fail(`El archivo pesa ${Math.ceil(file.size / 1024)} KB; el máximo es 200 KB.`);
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    if (/<script/i.test(text) || /\son\w+\s*=/i.test(text)) return fail('El SVG contiene código no permitido.');
  }
  const reader = new FileReader();
  reader.onload = () => setIcon(String(reader.result));
  reader.onerror = () => fail('No se pudo leer el archivo. Intenta con otro.');
  reader.readAsDataURL(file);
}

async function onSubmit(e) {
  e.preventDefault();
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const f = form.elements;
  const data = {
    name: f.name.value.trim(),
    description: f.description.value.trim(),
    icon: iconValue,
    criterion: f.criterion.value,
    param: Number(f.param.value),
    points: Number(f.points.value),
  };
  if (!data.name) return showError(form, { field: 'name', message: 'El nombre es obligatorio.' });
  if (paramCriteria.includes(data.criterion) && !(Number.isInteger(data.param) && data.param >= 1)) {
    return showError(form, { field: 'param', message: 'Escribe un número entero mayor que cero.' });
  }
  if (!Number.isInteger(data.points) || data.points < 0 || f.points.value === '') {
    return showError(form, { field: 'points', message: 'Los puntos deben ser un número entero de 0 en adelante.' });
  }
  const btn = form.querySelector('[type="submit"]');
  try {
    const res = selected
      ? await withBusy(btn, () => put(`/admin/achievements/${selected.id}`, data))
      : await withBusy(btn, () => post('/admin/achievements', data));
    toast(selected ? 'El logro se actualizó.' : `Se creó el logro "${data.name}".`);
    await load();
    select(items.find((a) => a.id === res.achievement.id) || null, false);
  } catch (err) {
    showError(form, err.field === 'icon' ? { ...err, message: err.message, field: 'icon_file' } : err);
  }
}

async function remove(btn) {
  const a = selected;
  const extra = a.teams > 0 ? ` ${wonText(a.teams).replace(/^./, (c) => c.toUpperCase())} ${a.teams === 1 ? 'lo tiene' : 'lo tienen'} y ${a.teams === 1 ? 'lo perderá' : 'lo perderán'}.` : '';
  const ok = await confirmDialog({ title: `¿Eliminar el logro "${a.name}"?`, message: `Esta acción no se puede deshacer.${extra}`, confirmText: 'Eliminar', danger: true });
  if (!ok) return;
  try {
    const { teams } = await withBusy(btn, () => del(`/admin/achievements/${a.id}`));
    toast(teams > 0 ? `Se eliminó el logro y se retiró de ${wonText(teams)}.` : 'Se eliminó el logro.');
    await load();
    select(items[0] || null, false);
  } catch (err) {
    toast(err.message, 'error');
  }
}
