// Vista 13 · Gestión de equipos: tabla del periodo y formulario crear / editar (RF-03)
import { get, post, put } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, initials, emptyState, loading, toast, clearErrors, showError, withBusy, param, fmtPercent } from '../core/ui.js';
import { t, tError } from '../core/i18n.js';

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
      <h1 class="page-title">${t('menu.docente.equipos')}</h1>
      <p class="page-sub">${t('teacher.teams.lead')}</p>
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
    document.getElementById('list-card').innerHTML = emptyState('alert', t('teacher.teams.loadError'), err.message).value;
  }
}

function renderList() {
  const { periods, period, teams, summary } = state.data;
  const card = document.getElementById('list-card');
  if (!period) {
    card.innerHTML = emptyState('calendar', t('teacher.noPeriodsTitle'), t('teacher.noPeriodsText')).value;
    return;
  }
  card.innerHTML = html`
    <div class="card-head">
      <div class="stack" style="gap:4px">
        <h2 id="lista" class="card-title" style="font-size:18px">${t('teacher.panel.teamsOfPeriod', { name: period.name })}</h2>
        <span class="muted" style="font-weight:600">${t('teacher.teams.summaryTeams', { count: summary.teams })} · ${t('teacher.panel.students', { count: summary.students })} · ${t('teacher.teams.summaryNoTeam', { count: summary.without_team })}</span>
      </div>
      <div class="filters">
        <label class="sr-only" for="l-period">${t('teacher.teams.viewPeriod')}</label>
        <select class="select" id="l-period">
          ${periods.map((p) => h`<option value="${p.id}" ${p.id === period.id ? 'selected' : ''}>${t(p.active ? 'teacher.periodActive' : 'teacher.periodN', { name: p.name })}</option>`)}
        </select>
      </div>
    </div>
    ${teams.length === 0 ? emptyState('users', t('teacher.noTeamsInPeriod'), t(period.active ? 'teacher.teams.useForm' : 'teacher.teams.periodClosed')) : h`
    <div class="table-wrap">
      <table class="table" style="min-width:660px">
        <thead><tr><th scope="col">${t('teacher.teams.team')}</th><th scope="col">${t('menu.estudiante.integrantes')}</th><th scope="col">${t('teacher.teams.currentLevel')}</th><th scope="col" class="actions">${t('common.actions')}</th></tr></thead>
        <tbody>${teams.map(teamRow)}</tbody>
      </table>
    </div>`}`;
}

function teamRow(team) {
  const n = team.members.length;
  return h`
    <tr>
      <td><div style="font-weight:800;font-size:15px">${team.name}</div><div class="muted">${team.project || t('teacher.noProject')}</div></td>
      <td>${n === 0 ? h`<span class="muted">${t('teacher.teams.noMembers')}</span>` : h`
        <div class="avatars" title="${team.members.map((m) => m.name).join(', ')}">
          ${team.members.slice(0, 5).map((m) => h`<span class="avatar avatar-sm" aria-hidden="true">${initials(m.name)}</span>`)}
          <span class="avatars__count">${t('teacher.teams.memberCount', { count: n })}</span>
        </div>`}</td>
      <td>${team.current ? t('common.levelNamed', { n: team.current.position, name: team.current.name }) : t('teacher.teams.docComplete')}<div class="muted small">${t('teacher.teams.pctApproved', { pct: fmtPercent(team.pct) })}</div></td>
      <td class="actions">
        <div class="row" style="justify-content:flex-end;gap:6px;flex-wrap:nowrap">
          <button type="button" class="btn btn-outline btn-sm" data-edit="${team.id}" ${team.period_active ? '' : safe(html`disabled title="${t('teacher.teams.periodClosedShort')}"`)}>${icon('edit', 16)}${t('common.edit')}</button>
          <a class="btn btn-ghost btn-sm" href="/docente/equipo.html?id=${team.id}">${t('teacher.teams.seeProgress')}</a>
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
  const team = state.data && state.data.teams.find((x) => x.id === id);
  if (!team) {
    toast(t('teacher.teams.notInPeriod'), 'error');
    renderForm();
    return;
  }
  resetForm();
  state.mode = 'edit';
  state.team = team;
  state.warnings = [];
  team.members.forEach((m) => state.chips.set(m.id, { id: m.id, name: m.name, existing: true, contributions: m.contributions }));
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
    card.innerHTML = html`<h2 id="form-title" class="card-title" style="font-size:18px">${t('teacher.createTeam')}</h2>
      ${emptyState('calendar', t('teacher.teams.noActiveTitle'), t('teacher.teams.noActiveText'))}`;
    return;
  }
  const team = state.team;
  card.innerHTML = html`
    <h2 id="form-title" class="card-title" style="font-size:18px">${editing ? t('teacher.teams.editTitle', { name: team.name }) : t('teacher.createTeam')}</h2>
    <form id="team-form" class="stack" style="gap:14px" novalidate>
      <div class="form-alert"></div>
      <div class="field">
        <label class="label" for="f-name">${t('fields.teamName')}</label>
        <input class="input" id="f-name" name="name" maxlength="80" required value="${editing ? team.name : ''}" placeholder="${t('teacher.teams.namePlaceholder')}" autocomplete="off">
      </div>
      <div class="field">
        <label class="label" for="f-project">${t('fields.project')}</label>
        <input class="input" id="f-project" name="project" maxlength="160" value="${editing ? team.project : ''}" placeholder="${t('teacher.teams.projectPlaceholder')}" autocomplete="off">
      </div>
      <div class="field">
        <label class="label" for="f-period">${t('teacher.academicPeriod')}</label>
        ${editing
          ? h`<input class="input" id="f-period" value="${team.period_name}" readonly>`
          : h`<select class="select" id="f-period" name="period_id">
              ${periods.map((p) => h`<option value="${p.id}" ${String(p.id) === state.period ? 'selected' : ''}>${t('teacher.teams.periodOptionActive', { name: p.name })}</option>`)}
            </select>`}
      </div>
      <div class="field">
        <label class="label" for="f-search">${t('teacher.teams.addStudents')}</label>
        <div class="input-icon">${icon('search', 18)}<input class="input" id="f-search" name="student_ids" type="search" placeholder="${t('teacher.teams.searchPlaceholder')}" autocomplete="off" aria-controls="results" aria-describedby="search-hint"></div>
        <span class="hint" id="search-hint">${t('teacher.teams.searchHint')}</span>
      </div>
      <div id="results" aria-live="polite"></div>
      <div class="stack" style="gap:6px">
        <span class="label" id="chips-label">${t('teacher.teams.membersCount', { count: memberCount() })}</span>
        <div class="chips" id="chips">${chipsHtml()}</div>
      </div>
      <div id="warnings" class="stack" style="gap:8px">${warningsHtml()}</div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" style="flex:1 1 auto;min-height:48px">${editing ? t('common.saveChanges') : t('teacher.createTeam')}</button>
        ${editing ? h`<button type="button" class="btn btn-outline" id="cancel-edit" style="min-height:48px">${t('common.cancel')}</button>` : ''}
      </div>
    </form>`;
}

function memberCount() { return [...state.chips.keys()].filter((id) => !state.removed.has(id)).length; }

function chipsHtml() {
  const list = [...state.chips.values()].filter((c) => !state.removed.has(c.id));
  if (list.length === 0) return h`<span class="muted small">${t('teacher.teams.noStudentsAdded')}</span>`;
  return h`${list.map((c) => h`
    <span class="chip ${c.existing ? '' : 'chip--new'}">${c.name}
      <button type="button" data-remove="${c.id}" aria-label="${t('teacher.teams.removeNamed', { name: c.name })}">${icon('x', 16)}</button>
    </span>`)}`;
}

function warningsHtml() {
  return h`${state.warnings.map((w) => h`
    <div class="alert alert-warn" role="alert">${icon('warning', 20)}<div>${w}</div></div>`)}`;
}

function renderResults() {
  const box = document.getElementById('results');
  if (!box) return;
  if (state.results === null) { box.innerHTML = html`<p class="muted small">${t('teacher.teams.searching')}</p>`; return; }
  if (state.results.length === 0) { box.innerHTML = ''; return; }
  const ownTeam = state.mode === 'edit' ? state.team.id : null;
  box.innerHTML = html`<div class="results">${state.results.map((s) => {
    const added = state.chips.has(s.id) && !state.removed.has(s.id);
    const elsewhere = s.team_id && s.team_id !== ownTeam;
    return h`
      <div class="result">
        <div class="result__text"><span style="font-weight:700">${s.name}</span><span class="muted small">${elsewhere ? t('teacher.teams.inTeam', { team: s.team_name }) : s.email}</span></div>
        <button type="button" class="btn btn-sm ${added ? 'btn-ghost' : 'btn-outline'}" data-add="${s.id}" ${added ? 'disabled' : ''}>${t(added ? 'teacher.teams.added' : 'teacher.teams.add')}</button>
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
  document.getElementById('chips-label').textContent = t('teacher.teams.membersCount', { count: memberCount() });
  renderResults();
}

function addStudent(id) {
  const s = state.results.find((x) => x.id === id);
  if (!s) return;
  const ownTeam = state.mode === 'edit' ? state.team.id : null;
  if (s.team_id && s.team_id !== ownTeam) {
    const periodName = state.mode === 'edit' ? state.team.period_name : (activePeriods().find((p) => p.id === formPeriodId()) || {}).name;
    state.warnings = [t('errors.STUDENT_IN_OTHER_TEAM', { name: s.name, team: s.team_name, period: periodName })];
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
      state.warnings = [t('errors.MEMBER_HAS_CONTRIBUTIONS', { name: c.name, count: c.contributions })];
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
  if (!name) { showError(form, { field: 'name', message: t('teacher.teams.nameRequired') }); return; }
  const project = form.querySelector('[name="project"]').value.trim();
  const ids = [...state.chips.keys()].filter((id) => !state.removed.has(id));
  try {
    let result;
    if (state.mode === 'edit') {
      const add = ids.filter((id) => !state.chips.get(id).existing);
      result = await withBusy(button, () => put(`/teacher/teams/${state.team.id}`, { name, project, add_ids: add, remove_ids: [...state.removed] }));
      toast(t('teacher.teams.saved', { name: result.team.name }));
    } else {
      const periodId = Number(form.querySelector('[name="period_id"]').value);
      result = await withBusy(button, () => post('/teacher/teams', { name, project, period_id: periodId, student_ids: ids }));
      toast(t('teacher.teams.created', { name: result.team.name, count: result.added.length }));
    }
    state.warnings = (result.skipped || []).map(tError);
    resetForm();
    history.replaceState(null, '', location.pathname);
    await loadTeams();
    renderForm();
  } catch (err) {
    showError(form, err);
  }
}
