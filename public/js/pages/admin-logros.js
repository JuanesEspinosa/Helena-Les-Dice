// Vista 17 · Catálogo de logros (RF-18)
import { get, post, put, del } from '../core/api.js';
import { html, icon, safe, badgeIcon, toast, clearErrors, showError, withBusy, confirmDialog, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';
import { t, has } from '../core/i18n.js';

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
      <h1 class="page-title">${t('menu.administrador.logros')}</h1>
      <p class="page-sub">${t('admin.achievements.lead')}</p>
    </div>
    <button type="button" class="btn btn-primary" id="new-btn">${icon('plus', 18)}${t('admin.achievements.new')}</button>
  </div>
  <div class="split">
    <section class="grow" aria-label="${t('admin.achievements.listLabel')}"><div id="grid">${loading()}</div></section>
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

/**
 * Texto de un criterio: admin.criteria.<clave> con {n}; si no hay traducción, el del servidor.
 * Sin valor se muestra la "N" genérica ("Aprobar N secciones"); con valor, el número.
 */
function criterionText(key, n = 'N') {
  if (has(`admin.criteria.${key}`)) return t(`admin.criteria.${key}`, { n });
  const base = criteria[key] || key;
  return n === 'N' ? base : base.replace('N', n);
}

// Declaraciones de función (no const): el módulo usa await de primer nivel y las llama antes de estas líneas
function ruleText(a) {
  return criterionText(a.criterion, paramCriteria.includes(a.criterion) ? a.param : 'N');
}

function wonText(count) {
  return t('admin.achievements.wonBy', { count });
}

function renderGrid() {
  const box = main.querySelector('#grid');
  if (items.length === 0) {
    box.innerHTML = emptyState('medal', t('admin.achievements.emptyTitle'), t('admin.achievements.emptyText')).value;
    return;
  }
  box.innerHTML = html`<div class="ach-grid">${items.map((a) => safe(html`
    <article class="card ach ${selected && selected.id === a.id ? 'ach--selected' : ''}">
      <span class="badge-icon">${badgeIcon(a.icon, 26)}</span>
      <span class="ach__body">
        <span class="ach__name">${a.name}</span>
        <span class="muted small">${t('admin.achievements.criterionRule', { rule: ruleText(a) })}</span>
        <span class="small"><strong>${t('student.points', { count: a.points })}</strong> · ${wonText(a.teams)}</span>
      </span>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" data-edit="${a.id}" aria-label="${t('admin.achievements.editNamed', { name: a.name })}">${icon('edit', 18)}</button>
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
    <h2 class="card-title" id="form-title" style="font-size:18px">${t(selected ? 'admin.achievements.editTitle' : 'admin.achievements.new')}</h2>
    <div class="form-alert"></div>
    <div class="field">
      <span class="label" id="icon-label">${t('fields.icon')}</span>
      <div class="row" style="flex-wrap:nowrap">
        <span class="badge-icon" id="icon-preview">${badgeIcon(iconValue, 28)}</span>
        <div class="stack" style="gap:4px">
          <label class="btn btn-outline btn-sm" style="align-self:flex-start">${icon('download', 16)}${t('admin.achievements.upload')}
            <input type="file" name="icon_file" accept="image/png,image/svg+xml" class="sr-only"></label>
          <span class="hint">${t('admin.achievements.uploadHint')}</span>
        </div>
      </div>
      <input type="hidden" name="icon" value="${iconValue}">
      <div class="icon-grid" role="radiogroup" aria-labelledby="icon-label">${ICON_CHOICES.map((k) => safe(html`
        <button type="button" class="icon-opt" role="radio" aria-checked="${iconValue === k}" data-icon="${k}" aria-label="${t('admin.achievements.iconNamed', { name: k })}">${icon(k, 20)}</button>`))}</div>
    </div>
    <div class="field"><label class="label" for="l-nombre">${t('fields.name')}</label>
      <input class="input" id="l-nombre" name="name" type="text" maxlength="80" required autocomplete="off" value="${a.name}"></div>
    <div class="field"><label class="label" for="l-desc">${t('fields.description')}</label>
      <textarea class="textarea" id="l-desc" name="description" rows="2" maxlength="500">${a.description}</textarea></div>
    <div class="field"><label class="label" for="l-crit">${t('fields.criterion')}</label>
      <select class="select" id="l-crit" name="criterion">${Object.keys(criteria).map((k) => safe(html`
        <option value="${k}" ${k === a.criterion ? 'selected' : ''}>${criterionText(k)}</option>`))}</select></div>
    <div class="grid grid-2" style="gap:12px">
      <div class="field" id="param-field" ${paramCriteria.includes(a.criterion) ? '' : 'hidden'}><label class="label" for="l-param">${t('fields.param')}</label>
        <input class="input" id="l-param" name="param" type="number" min="1" max="1000" value="${a.param || 1}"></div>
      <div class="field"><label class="label" for="l-pts">${t('fields.points')}</label>
        <input class="input" id="l-pts" name="points" type="number" min="0" max="10000" required value="${a.points}"></div>
    </div>
    ${selected && a.teams > 0 ? safe(html`<p class="note note--blue small">${t('admin.achievements.alreadyWon', { count: a.teams })}</p>`) : ''}
    <div class="form-actions">
      <button type="submit" class="btn btn-primary">${icon('save', 18)}${t(selected ? 'common.save' : 'admin.achievements.create')}</button>
      ${selected ? safe(html`<button type="button" class="btn btn-danger-outline" data-act="delete">${icon('trash', 18)}${t('common.delete')}</button>`) : ''}
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
  if (!ICON_TYPES.includes(file.type)) return fail(t('errors.ICON_TYPE_INVALID'));
  if (file.size > MAX_ICON_BYTES) return fail(t('admin.achievements.fileTooBig', { size: Math.ceil(file.size / 1024), max: MAX_ICON_BYTES / 1024 }));
  if (file.type === 'image/svg+xml') {
    const text = await file.text();
    if (/<script/i.test(text) || /\son\w+\s*=/i.test(text)) return fail(t('errors.ICON_SVG_UNSAFE'));
  }
  const reader = new FileReader();
  reader.onload = () => setIcon(String(reader.result));
  reader.onerror = () => fail(t('admin.achievements.readError'));
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
  if (!data.name) return showError(form, { field: 'name', message: t('admin.users.nameRequired') });
  if (paramCriteria.includes(data.criterion) && !(Number.isInteger(data.param) && data.param >= 1)) {
    return showError(form, { field: 'param', message: t('errors.PARAM_INVALID') });
  }
  if (!Number.isInteger(data.points) || data.points < 0 || f.points.value === '') {
    return showError(form, { field: 'points', message: t('admin.achievements.pointsInvalid') });
  }
  const btn = form.querySelector('[type="submit"]');
  try {
    const res = selected
      ? await withBusy(btn, () => put(`/admin/achievements/${selected.id}`, data))
      : await withBusy(btn, () => post('/admin/achievements', data));
    toast(selected ? t('admin.achievements.updated') : t('admin.achievements.created', { name: data.name }));
    await load();
    select(items.find((a) => a.id === res.achievement.id) || null, false);
  } catch (err) {
    showError(form, err.field === 'icon' ? { ...err, message: err.message, field: 'icon_file' } : err);
  }
}

async function remove(btn) {
  const a = selected;
  const extra = a.teams > 0 ? ` ${t('admin.achievements.willLose', { count: a.teams })}` : '';
  const ok = await confirmDialog({ title: t('admin.achievements.deleteTitle', { name: a.name }), message: `${t('common.cannotUndo')}${extra}`, confirmText: t('common.delete'), danger: true });
  if (!ok) return;
  try {
    const { teams } = await withBusy(btn, () => del(`/admin/achievements/${a.id}`));
    toast(teams > 0 ? t('admin.achievements.deletedFrom', { count: teams }) : t('admin.achievements.deleted'));
    await load();
    select(items[0] || null, false);
  } catch (err) {
    toast(err.message, 'error');
  }
}
