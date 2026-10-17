// Vista 05 · Panel de seguimiento de la docente (RF-09)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, ago, emptyState, loading, param } from '../core/ui.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const REFRESH_MS = 45 * 1000; // RNF-03: el panel se actualiza solo

const state = { level: param('level') || '', period: param('period') || '', data: null, timer: null };

await initLayout({ roles: ['docente'], active: 'panel' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">Panel de seguimiento</h1>
      <p class="page-sub">Avance real de cada equipo, actualizado cada 45 segundos.</p>
    </div>
    <div class="filters" id="filters"></div>
  </div>
  <div id="dash">${loading()}</div>`);

document.getElementById('filters').addEventListener('change', (e) => {
  if (e.target.name === 'period') { state.period = e.target.value; state.level = ''; }
  if (e.target.name === 'level') state.level = e.target.value;
  const qs = new URLSearchParams({ ...(state.period && { period: state.period }), ...(state.level && { level: state.level }) });
  history.replaceState(null, '', `${location.pathname}${qs.toString() ? `?${qs}` : ''}`);
  load(false);
});

load(false);

async function load(background) {
  const qs = new URLSearchParams({ period: state.period, level: state.level });
  try {
    state.data = await get(`/teacher/dashboard?${qs}`, { background });
    renderFilters(state.data);
    renderDash(state.data);
  } catch (err) {
    if (background) {
      const note = document.getElementById('refresh-note');
      if (note) note.textContent = 'No se pudo actualizar. Se intentará de nuevo en unos segundos.';
    } else {
      document.getElementById('dash').innerHTML = emptyState('alert', 'No se pudo cargar el panel', err.message).value;
    }
  }
  clearTimeout(state.timer);
  state.timer = setTimeout(() => load(true), REFRESH_MS);
}

function renderFilters({ periods, period, levels }) {
  const box = document.getElementById('filters');
  if (box.contains(document.activeElement)) return; // no interrumpir a quien está eligiendo
  box.innerHTML = html`
    <label class="sr-only" for="f-period">Periodo académico</label>
    <select class="select" id="f-period" name="period">
      ${periods.map((p) => h`<option value="${p.id}" ${period && p.id === period.id ? 'selected' : ''}>Periodo ${p.name}${p.active ? ' (activo)' : ''}</option>`)}
    </select>
    <label class="sr-only" for="f-level">Filtrar por nivel actual</label>
    <select class="select" id="f-level" name="level">
      <option value="">Todos los niveles</option>
      ${levels.map((l) => h`<option value="${l.id}" ${String(l.id) === state.level ? 'selected' : ''}>Nivel ${l.position} · ${l.name}</option>`)}
    </select>
    <a class="btn btn-primary" href="/docente/equipos.html#crear">${icon('plus', 18)}Crear equipo</a>`;
}

function renderDash(d) {
  const el = document.getElementById('dash');
  el.innerHTML = html`
    <div class="stack" style="gap:24px">
      ${statsRow(d.indicators)}
      <div class="split">
        <section class="grow stack" aria-labelledby="eqs" style="gap:14px">
          <div class="row between">
            <h2 id="eqs" style="font-size:20px;font-weight:800">Equipos${d.period ? ` del periodo ${d.period.name}` : ''}</h2>
            <span class="refresh-note" id="refresh-note" aria-live="polite">Actualizado ${new Date().toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span>
          </div>
          ${teamsGrid(d)}
        </section>
        <aside class="side">
          ${reviewList(d.to_review)}
          ${alertsCard(d.teams)}
        </aside>
      </div>
    </div>`;
}

function statsRow(ind) {
  return h`
    <div class="grid grid-4">
      <div class="card stat">
        <div class="stat__label">Equipos activos</div>
        <div class="stat__value">${ind.teams}</div>
        <div class="stat__hint">${ind.students} estudiantes</div>
      </div>
      <div class="card stat">
        <div class="stat__label">Avance global</div>
        <div class="stat__value">${ind.avg_pct}%</div>
        <div class="progress progress-sm" role="img" aria-label="Avance global ${ind.avg_pct}%"><span style="width:${ind.avg_pct}%"></span></div>
      </div>
      <div class="card stat">
        <div class="stat__label">Comentarios pendientes</div>
        <div class="stat__value ${ind.pending_comments ? 'stat__value--back' : ''}">${ind.pending_comments}</div>
        <div class="stat__hint"><a href="/docente/comentarios.html">Sin atender por los equipos</a></div>
      </div>
      <div class="card stat">
        <div class="stat__label">Esperan tu revisión</div>
        <div class="stat__value ${ind.in_review ? 'stat__value--review' : ''}">${ind.in_review}</div>
        <div class="stat__hint">Secciones enviadas</div>
      </div>
    </div>`;
}

function teamsGrid({ teams, period }) {
  if (!period) return emptyState('calendar', 'No hay periodos académicos', 'El administrador debe crear un periodo antes de formar equipos.');
  if (teams.length === 0) {
    const filtered = Boolean(state.level);
    return h`<div class="card">${emptyState('users',
      filtered ? 'Ningún equipo está en ese nivel' : 'Todavía no hay equipos en este periodo',
      filtered ? 'Prueba con otro nivel o quita el filtro.' : 'Crea el primer equipo y agrega a sus integrantes.',
      filtered ? '' : h`<a class="btn btn-primary" href="/docente/equipos.html#crear">${icon('plus', 18)}Crear equipo</a>`)}</div>`;
  }
  return h`<div class="grid grid-2">${teams.map(teamCard)}</div>`;
}

function teamCard(t) {
  const levelLabel = t.current ? `Nivel ${t.current.position} de ${t.levels.length}` : 'Todos los niveles completos';
  const comments = t.pending_comments === 0 ? 'Sin comentarios pendientes'
    : `${t.pending_comments} ${t.pending_comments === 1 ? 'comentario pendiente' : 'comentarios pendientes'}`;
  return h`
    <article class="card team-card ${t.inactive ? 'team-card--quiet' : ''}" aria-labelledby="t-${t.id}">
      <div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
        <div style="min-width:0">
          <h3 id="t-${t.id}" style="font-size:17px;font-weight:800">${t.name}</h3>
          <div class="muted">${t.project || 'Sin proyecto definido'}</div>
        </div>
        <div class="team-card__pct" aria-label="Avance ${t.pct}%">${t.pct}%</div>
      </div>
      <div class="stack" style="gap:6px">
        <div class="sub-label"><span>Avance por nivel</span><span>${levelLabel}</span></div>
        <div class="lv-bars">
          ${t.levels.map((l) => {
            const w = l.total ? Math.round((l.approved / l.total) * 100) : 100;
            return h`<div class="lv-bar ${l.state === 'done' ? 'lv-bar--done' : ''}" role="img" aria-label="Nivel ${l.position}: ${l.approved} de ${l.total} secciones aprobadas" title="Nivel ${l.position} · ${l.name}: ${l.approved} de ${l.total}"><span style="width:${w}%"></span></div>`;
          })}
        </div>
      </div>
      <div class="stack" style="gap:8px">
        <div class="sub-label"><span>Participación individual</span></div>
        ${t.members.length === 0 ? safe('<p class="muted small">El equipo todavía no tiene integrantes.</p>') : t.members.map(memberRow)}
      </div>
      <div class="card-foot">
        <div class="row" style="gap:8px">
          <span class="pill pill--plain ${t.pending_comments ? 'pill-devuelto' : 'pill-aprobado'}">${comments}</span>
          ${t.inactive
            ? h`<span class="pill pill--plain pill-warn">${icon('clock', 14)}Sin movimiento reciente</span>`
            : h`<span class="muted">${ago(t.last_activity)}</span>`}
        </div>
        <a class="btn btn-outline btn-sm" href="/docente/equipo.html?id=${t.id}">Ver detalle${icon('chevronRight', 16)}</a>
      </div>
    </article>`;
}

function memberRow(m) {
  return h`
    <div class="part ${m.low ? 'part--low' : ''}">
      <span class="part__name" title="${m.name}">${m.name}</span>
      <div class="progress ${m.low ? 'progress-warn' : ''}" role="img" aria-label="${m.name}: ${m.pct}% de los aportes${m.low ? ', participación baja' : ''}"><span style="width:${m.pct}%"></span></div>
      <span class="part__pct">${m.pct}%</span>
    </div>`;
}

function reviewList(items) {
  return h`
    <section class="card card-pad stack" aria-labelledby="rev">
      <h2 id="rev" class="card-title">Esperan tu revisión <span class="tag">${items.length}</span></h2>
      ${items.length === 0
        ? h`<p class="muted">No hay secciones esperando revisión.</p>`
        : items.map((r) => h`
          <a class="review-link" href="${r.link}">
            <span style="font-weight:700">${r.code} ${r.name}</span>
            <span class="muted">${r.team_name} · enviada ${ago(r.updated_at).toLowerCase()}</span>
          </a>`)}
    </section>`;
}

function alertsCard(teams) {
  const quiet = teams.filter((t) => t.inactive);
  const unequal = teams.filter((t) => t.unequal && !t.inactive);
  if (quiet.length === 0 && unequal.length === 0) {
    return h`<section class="card card-pad stack" aria-labelledby="alerta">
      <h2 id="alerta" class="card-title">${icon('checkCircle', 18)}Sin alertas</h2>
      <p class="muted">Todos los equipos tienen actividad reciente y una participación equilibrada.</p>
    </section>`;
  }
  return h`
    <section class="card card-pad stack alerts-card" aria-labelledby="alerta">
      <h2 id="alerta" class="card-title">${icon('warning', 18)}Alertas</h2>
      ${quiet.map((t) => h`<p>El <a href="/docente/equipo.html?id=${t.id}"><strong>${t.name}</strong></a> ${t.last_activity ? `no registra aportes desde ${ago(t.last_activity).toLowerCase()}.` : 'todavía no registra ningún aporte.'}</p>`)}
      ${unequal.map((t) => {
        const low = t.members.filter((m) => m.low);
        return h`<p>En el <a href="/docente/equipo.html?id=${t.id}"><strong>${t.name}</strong></a>, ${low.map((m) => m.name).join(', ')} ${low.length === 1 ? 'tiene' : 'tienen'} una participación muy baja.</p>`;
      })}
    </section>`;
}
