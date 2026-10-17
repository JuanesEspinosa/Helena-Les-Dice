// Comentarios de las docentes: pendientes o todos, con enlace al editor (RF-10)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, ago, fmtDateTime, emptyState, loading, param } from '../core/ui.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const state = { status: param('estado') === 'todos' ? 'all' : 'pending' };

await initLayout({ roles: ['docente'], active: 'comentarios' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">Comentarios</h1>
      <p class="page-sub">Observaciones que las docentes dejaron en las secciones de los equipos y si ya fueron atendidas.</p>
    </div>
    <div class="segmented" role="group" aria-label="Filtrar comentarios" id="filter">
      <button type="button" data-status="pending" aria-pressed="${state.status === 'pending'}">Pendientes</button>
      <button type="button" data-status="all" aria-pressed="${state.status === 'all'}">Todos</button>
    </div>
  </div>
  <section class="card" aria-labelledby="c-title" id="list">${loading()}</section>`);

document.getElementById('filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-status]');
  if (!b || b.dataset.status === state.status) return;
  state.status = b.dataset.status;
  document.querySelectorAll('#filter [data-status]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  history.replaceState(null, '', state.status === 'all' ? '?estado=todos' : location.pathname);
  load();
});

load();

async function load() {
  const box = document.getElementById('list');
  box.innerHTML = loading().value;
  try {
    const data = await get(`/teacher/comments?status=${state.status}`);
    box.innerHTML = html`
      <div class="card-head">
        <h2 id="c-title" class="card-title">${state.status === 'all' ? 'Todos los comentarios' : 'Comentarios sin atender'}</h2>
        <span class="muted" style="font-weight:600">${data.counts.pending} pendientes de ${data.counts.total}</span>
      </div>
      ${data.comments.length === 0
        ? emptyState('checkCircle', state.status === 'all' ? 'Todavía no hay comentarios' : 'No hay comentarios pendientes',
          state.status === 'all' ? 'Los comentarios que dejes en el editor aparecerán aquí.' : 'Los equipos atendieron todas las observaciones.')
        : h`<div class="list">${data.comments.map(item)}</div>`}`;
  } catch (err) {
    box.innerHTML = emptyState('alert', 'No se pudieron cargar los comentarios', err.message).value;
  }
}

function item(c) {
  return h`
    <article class="c-item">
      <div class="c-item__head">
        <div class="row" style="gap:8px">
          <strong>${c.team_name}</strong><span class="muted">·</span><span>${c.code} ${c.section_name}</span>
          <span class="tag">Periodo ${c.period_name}</span>
        </div>
        <span class="pill ${c.resolved ? 'pill-atendido' : 'pill-pendiente'}">${c.resolved ? 'Atendido' : 'Pendiente'}</span>
      </div>
      ${c.quote ? h`<div class="c-item__quote small">“${c.quote}”</div>` : ''}
      <p class="c-item__body">${c.body}</p>
      <div class="row between small">
        <span class="muted">
          ${c.author_name} · <time datetime="${c.created_at}" title="${fmtDateTime(c.created_at)}">${ago(c.created_at)}</time>
          ${c.replies ? ` · ${c.replies} ${c.replies === 1 ? 'respuesta' : 'respuestas'}` : ''}
          ${c.resolved ? ` · Atendido${c.resolved_by_name ? ` por ${c.resolved_by_name}` : ''} ${c.resolved_at ? ago(c.resolved_at).toLowerCase() : ''}` : ''}
        </span>
        <span class="row" style="gap:6px">
          <a class="btn btn-ghost btn-sm" href="/docente/equipo.html?id=${c.team_id}">Ver equipo</a>
          <a class="btn btn-outline btn-sm" href="${c.link}">${icon('edit', 16)}Abrir en el editor</a>
        </span>
      </div>
    </article>`;
}
