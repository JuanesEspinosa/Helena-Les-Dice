// Vista 13 · Gestión de equipos: tabla del periodo y formulario crear / editar (RF-03)
import { get, post, put } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, initials, emptyState, loading, toast, clearErrors, showError, withBusy, param } from '../core/ui.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const SEARCH_DELAY_MS = 250;

const state = {
  period: param('period') || '',
  data: null,
  mode: 'create', // create | edit
  team: null, // equipo en edición
  chips: new Map(), // id → { id, name, existing }
  removed: new Set(), // integrantes existentes que se quitarán
  results: [],
  searchTimer: null,
  warnings: [],
};

await initLayout({ roles: ['docente'], active: 'equipos' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">Equipos</h1>
      <p class="page-sub">Crea los equipos del periodo y vincula a cada estudiante. Cada estudiante puede estar en un solo equipo por periodo.</p>
    </div>
  </div>
  <div class="split">
    <section class="grow card" aria-labelledby="lista" id="list-card">${loading()}</section>
    <aside class="side"><div class="card form-card" id="form-card" aria-labelledby="form-title"></div></aside>
  </div>`);

wireList();
wireForm();
await loadTeams();
const editId = Number(param('editar'));
if (editId) startEdit(editId);
else renderForm();
if (location.hash === '#crear') focusForm();

// ---------- Tabla de equipos ----------

async function loadTeams() {
  try {
    state.data = await get(`/teacher/teams?period=${encodeURIComponent(state.period)}`);
    if (!state.period && state.data.period) state.period = String(state.data.period.id);
    renderList();
  } catch (err) {
    document.getElementById('list-card').innerHTML = emptyState('alert', 'No se pudieron cargar los equipos', err.message).value;
  }
}

function renderList() {
  const { periods, period, teams, summary } = state.data;
  const card = document.getElementById('list-card');
  if (!period) {
    card.innerHTML = emptyState('calendar', 'No hay periodos académicos', 'El administrador debe crear un periodo antes de formar equipos.').value;
    return;
  }
  card.innerHTML = html`
    <div class="card-head">
      <div class="stack" style="gap:4px">
        <h2 id="lista" class="card-title" style="font-size:18px">Equipos del periodo ${period.name}</h2>
        <span class="muted" style="font-weight:600">${summary.teams} equipos · ${summary.students} estudiantes · ${summary.without_team} sin equipo</span>
      </div>
      <div class="filters">
        <label class="sr-only" for="l-period">Ver periodo</label>
        <select class="select" id="l-period">
          ${periods.map((p) => h`<option value="${p.id}" ${p.id === period.id ? 'selected' : ''}>Periodo ${p.name}${p.active ? ' (activo)' : ''}</option>`)}
        </select>
      </div>
    </div>
    ${teams.length === 0 ? emptyState('users', 'Todavía no hay equipos en este periodo', period.active ? 'Usa el formulario "Crear equipo" para formar el primero.' : 'Este periodo está cerrado.') : h`
    <div class="table-wrap">
      <table class="table" style="min-width:660px">
        <thead><tr><th scope="col">Equipo</th><th scope="col">Integrantes</th><th scope="col">Nivel actual</th><th scope="col" class="actions">Acciones</th></tr></thead>
        <tbody>${teams.map(teamRow)}</tbody>
      </table>
    </div>`}`;
}

function teamRow(t) {
  const n = t.members.length;
  return h`
    <tr>
      <td><div style="font-weight:800;font-size:15px">${t.name}</div><div class="muted">${t.project || 'Sin proyecto definido'}</div></td>
      <td>${n === 0 ? h`<span class="muted">Sin integrantes</span>` : h`
        <div class="avatars" title="${t.members.map((m) => m.name).join(', ')}">
          ${t.members.slice(0, 5).map((m) => h`<span class="avatar avatar-sm" aria-hidden="true">${initials(m.name)}</span>`)}
          <span class="avatars__count">${n} ${n === 1 ? 'integrante' : 'integrantes'}</span>
        </div>`}</td>
      <td>${t.current ? `Nivel ${t.current.position} · ${t.current.name}` : 'Documento completo'}<div class="muted small">${t.pct}% aprobado</div></td>
      <td class="actions">
        <div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn btn-outline btn-sm" data-edit="${t.id}" ${t.period_active ? '' : safe('disabled title="El periodo está cerrado"')}>${icon('edit', 16)}Editar</button>
          <a class="btn btn-ghost btn-sm" href="/docente/equipo.html?id=${t.id}">Ver avance</a>
        </div>
      </td>
    </tr>`;
}

function wireList() {
  const card = document.getElementById('list-card');
  card.addEventListener('change', async (e) => {
    if (e.target.id !== 'l-period') return;
    state.period = e.target.value;
    await loadTeams();
    if (state.mode === 'create') renderForm();
  });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) startEdit(Number(b.dataset.edit));
  });
}

// ---------- Formulario crear / editar ----------

function activePeriods() {
  return (state.data ? state.data.periods : []).filter((p) => p.active);
}

/** Periodo en el que se buscan estudiantes: el del equipo en edición o el elegido en el formulario. */
function formPeriodId() {
  if (state.mode === 'edit') return state.team.period_id;
  const sel = document.getElementById('f-period');
  return sel ? Number(sel.value) : null;
}

function resetForm() {
  state.mode = 'create';
  state.team = null;
  state.chips = new Map();
  state.removed = new Set();
  state.results = [];
}

function startEdit(id) {
  const t = state.data && state.data.teams.find((x) => x.id === id);
  if (!t) {
    toast('Ese equipo no está en el periodo que estás viendo.', 'error');
    renderForm();
    return;
  }
  resetForm();
  state.mode = 'edit';
  state.team = t;
  state.warnings = [];
  t.members.forEach((m) => state.chips.set(m.id, { id: m.id, name: m.name, existing: true, contributions: m.contributions }));
  renderForm();
  focusForm();
}

function focusForm() {
  const card = document.getElementById('form-card');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const input = card.querySelector('[name="name"]');
  if (input) input.focus({ preventScroll: true });
}

function renderForm() {
  const card = document.getElementById('form-card');
  const editing = state.mode === 'edit';
  const periods = activePeriods();
  card.classList.toggle('form-card--edit', editing);
  if (!editing && periods.length === 0) {
    card.innerHTML = html`<h2 id="form-title" class="card-title" style="font-size:18px">Crear equipo</h2>
      ${emptyState('calendar', 'No hay periodos activos', 'Solo se pueden crear equipos en un periodo académico activo.')}`;
    return;
  }
  const t = state.team;
  card.innerHTML = html`
    <h2 id="form-title" class="card-title" style="font-size:18px">${editing ? `Editar ${t.name}` : 'Crear equipo'}</h2>
    <form id="team-form" class="stack" style="gap:14px" novalidate>
      <div class="form-alert"></div>
      <div class="field">
        <label class="label" for="f-name">Nombre del equipo</label>
        <input class="input" id="f-name" name="name" maxlength="80" required value="${editing ? t.name : ''}" placeholder="Equipo 6" autocomplete="off">
      </div>
      <div class="field">
        <label class="label" for="f-project">Proyecto</label>
        <input class="input" id="f-project" name="project" maxlength="160" value="${editing ? t.project : ''}" placeholder="Nombre del proyecto del equipo" autocomplete="off">
      </div>
      <div class="field">
        <label class="label" for="f-period">Periodo académico</label>
        ${editing
          ? h`<input class="input" id="f-period" value="${t.period_name}" readonly>`
          : h`<select class="select" id="f-period" name="period_id">
              ${periods.map((p) => h`<option value="${p.id}" ${String(p.id) === state.period ? 'selected' : ''}>${p.name} (activo)</option>`)}
            </select>`}
      </div>
      <div class="field">
        <label class="label" for="f-search">Agregar estudiantes</label>
        <div class="input-icon">${icon('search', 18)}<input class="input" id="f-search" name="student_ids" type="search" placeholder="Buscar por nombre o correo" autocomplete="off" aria-controls="results" aria-describedby="search-hint"></div>
        <span class="hint" id="search-hint">Escribe al menos dos letras.</span>
      </div>
      <div id="results" aria-live="polite"></div>
      <div class="stack" style="gap:6px">
        <span class="label" id="chips-label">Integrantes (${memberCount()})</span>
        <div class="chips" id="chips">${chipsHtml()}</div>
      </div>
      <div id="warnings" class="stack" style="gap:8px">${warningsHtml()}</div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" style="flex:1 1 auto;min-height:48px">${editing ? 'Guardar cambios' : 'Crear equipo'}</button>
        ${editing ? h`<button type="button" class="btn btn-outline" id="cancel-edit" style="min-height:48px">Cancelar</button>` : ''}
      </div>
    </form>`;
}

function memberCount() { return [...state.chips.keys()].filter((id) => !state.removed.has(id)).length; }

function chipsHtml() {
  const list = [...state.chips.values()].filter((c) => !state.removed.has(c.id));
  if (list.length === 0) return h`<span class="muted small">Todavía no agregas estudiantes.</span>`;
  return h`${list.map((c) => h`
    <span class="chip ${c.existing ? '' : 'chip--new'}">${c.name}
      <button type="button" data-remove="${c.id}" aria-label="Quitar a ${c.name}">${icon('x', 16)}</button>
    </span>`)}`;
}

function warningsHtml() {
  return h`${state.warnings.map((w) => h`
    <div class="alert alert-warn" role="alert">${icon('warning', 20)}<div>${w}</div></div>`)}`;
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  if (state.results === null) { box.innerHTML = html`<p class="muted small">Buscando…</p>`; return; }
  if (state.results.length === 0) { box.innerHTML = ''; return; }
  const ownTeam = state.mode === 'edit' ? state.team.id : null;
  box.innerHTML = html`<div class="results">${state.results.map((s) => {
    const added = state.chips.has(s.id) && !state.removed.has(s.id);
    const elsewhere = s.team_id && s.team_id !== ownTeam;
    return h`
      <div class="result">
        <div class="result__text"><span style="font-weight:700">${s.name}</span><span class="muted small">${elsewhere ? `En el ${s.team_name}` : s.email}</span></div>
        <button type="button" class="btn btn-sm ${added ? 'btn-ghost' : 'btn-outline'}" data-add="${s.id}" ${added ? 'disabled' : ''}>${added ? 'Agregado' : 'Agregar'}</button>
      </div>`;
  })}</div>`;
}

async function search(q) {
  if (q.length < 2) { state.results = []; renderResults(); return; }
  state.results = null;
  renderResults();
  try {
    const { students } = await get(`/teacher/students?q=${encodeURIComponent(q)}&period=${formPeriodId() || ''}`);
    state.results = students;
  } catch (err) {
    state.results = [];
    toast(err.message, 'error');
  }
  renderResults();
}

function refreshChips() {
  document.getElementById('chips').innerHTML = chipsHtml().value;
  document.getElementById('chips-label').textContent = `Integrantes (${memberCount()})`;
  renderResults();
}

function addStudent(id) {
  const s = state.results.find((x) => x.id === id);
  if (!s) return;
  const ownTeam = state.mode === 'edit' ? state.team.id : null;
  if (s.team_id && s.team_id !== ownTeam) {
    const periodName = state.mode === 'edit' ? state.team.period_name : (activePeriods().find((p) => p.id === formPeriodId()) || {}).name;
    state.warnings = [`${s.name} ya pertenece al ${s.team_name} en el periodo ${periodName}. No se agregó.`];
    document.getElementById('warnings').innerHTML = warningsHtml().value;
    return;
  }
  if (state.removed.has(id)) state.removed.delete(id);
  else state.chips.set(id, { id, name: s.name, existing: false });
  refreshChips();
}

async function removeStudent(id) {
  const c = state.chips.get(id);
  if (!c) return;
  if (c.existing) {
    if (c.contributions > 0) {
      state.warnings = [`${c.name} ya tiene ${c.contributions} aporte(s) en el equipo y no se puede quitar.`];
      document.getElementById('warnings').innerHTML = warningsHtml().value;
      return;
    }
    state.removed.add(id);
  } else state.chips.delete(id);
  refreshChips();
}

function wireForm() {
  const card = document.getElementById('form-card');
  card.addEventListener('input', (e) => {
    if (e.target.id !== 'f-search') return;
    clearTimeout(state.searchTimer);
    const q = e.target.value.trim();
    state.searchTimer = setTimeout(() => search(q), SEARCH_DELAY_MS);
  });
  card.addEventListener('change', (e) => {
    if (e.target.id === 'f-period') { state.chips = new Map(); state.results = []; state.warnings = []; refreshChips(); }
  });
  card.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) return addStudent(Number(add.dataset.add));
    const rm = e.target.closest('[data-remove]');
    if (rm) return removeStudent(Number(rm.dataset.remove));
    if (e.target.closest('#cancel-edit')) {
      resetForm();
      state.warnings = [];
      history.replaceState(null, '', location.pathname);
      renderForm();
    }
  });
  // Enter en el buscador no debe enviar el formulario
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'f-search') e.preventDefault();
  });
  card.addEventListener('submit', onSubmit);
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const button = form.querySelector('[type="submit"]');
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const name = form.querySelector('[name="name"]').value.trim();
  if (!name) { showError(form, { field: 'name', message: 'El nombre del equipo es obligatorio.' }); return; }
  const project = form.querySelector('[name="project"]').value.trim();
  const ids = [...state.chips.keys()].filter((id) => !state.removed.has(id));
  try {
    let result;
    if (state.mode === 'edit') {
      const add = ids.filter((id) => !state.chips.get(id).existing);
      result = await withBusy(button, () => put(`/teacher/teams/${state.team.id}`, { name, project, add_ids: add, remove_ids: [...state.removed] }));
      toast(`Se guardaron los cambios de ${result.team.name}.`);
    } else {
      const periodId = Number(form.querySelector('[name="period_id"]').value);
      result = await withBusy(button, () => post('/teacher/teams', { name, project, period_id: periodId, student_ids: ids }));
      toast(`Se creó el ${result.team.name} con ${result.added.length} integrante(s).`);
    }
    state.warnings = (result.skipped || []).map((s) => s.message);
    resetForm();
    history.replaceState(null, '', location.pathname);
    await loadTeams();
    renderForm();
  } catch (err) {
    showError(form, err);
  }
}
