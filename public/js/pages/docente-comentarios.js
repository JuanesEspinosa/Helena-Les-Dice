// Comentarios de las docentes: pendientes o todos, con enlace al editor (RF-10)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, ago, fmtDateTime, emptyState, loading, param } from '../core/ui.js';
import { t } from '../core/i18n.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const state = { status: param('estado') === 'todos' ? 'all' : 'pending' };

await initLayout({ roles: ['docente'], active: 'comentarios' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">${t('menu.docente.comentarios')}</h1>
      <p class="page-sub">${t('teacher.comments.lead')}</p>
    </div>
    <div class="segmented" role="group" aria-label="${t('teacher.comments.filter')}" id="filter">
      <button type="button" data-status="pending" aria-pressed="${state.status === 'pending'}">${t('teacher.comments.pending')}</button>
      <button type="button" data-status="all" aria-pressed="${state.status === 'all'}">${t('teacher.comments.all')}</button>
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
        <h2 id="c-title" class="card-title">${t(state.status === 'all' ? 'teacher.comments.allTitle' : 'teacher.comments.pendingTitle')}</h2>
        <span class="muted" style="font-weight:600">${t('teacher.comments.counts', { pending: data.counts.pending, count: data.counts.total })}</span>
      </div>
      ${data.comments.length === 0
        ? emptyState('checkCircle', t(state.status === 'all' ? 'teacher.comments.noneTitle' : 'teacher.comments.nonePendingTitle'),
          t(state.status === 'all' ? 'teacher.comments.noneText' : 'teacher.comments.nonePendingText'))
        : h`<div class="list">${data.comments.map(item)}</div>`}`;
  } catch (err) {
    box.innerHTML = emptyState('alert', t('teacher.comments.loadError'), err.message).value;
  }
}

function item(c) {
  return h`
    <article class="c-item">
      <div class="c-item__head">
        <div class="row" style="gap:8px">
          <strong>${c.team_name}</strong><span class="muted">·</span><span>${c.code} ${c.section_name}</span>
          <span class="tag">${t('teacher.periodN', { name: c.period_name })}</span>
        </div>
        <span class="pill ${c.resolved ? 'pill-atendido' : 'pill-pendiente'}">${t(c.resolved ? 'student.editor.resolved' : 'teacher.comments.pendingOne')}</span>
      </div>
      ${c.quote ? h`<div class="c-item__quote small">“${c.quote}”</div>` : ''}
      <p class="c-item__body">${c.body}</p>
      <div class="row between small">
        <span class="muted">
          ${c.author_name} · <time datetime="${c.created_at}" title="${fmtDateTime(c.created_at)}">${ago(c.created_at)}</time>
          ${c.replies ? ` · ${t('teacher.comments.replies', { count: c.replies })}` : ''}
          ${c.resolved ? ` · ${c.resolved_by_name ? t('student.editor.resolvedBy', { name: c.resolved_by_name }) : t('student.editor.resolved')} ${c.resolved_at ? ago(c.resolved_at).toLowerCase() : ''}` : ''}
        </span>
        <span class="row" style="gap:6px">
          <a class="btn btn-ghost btn-sm" href="/docente/equipo.html?id=${c.team_id}">${t('teacher.comments.seeTeam')}</a>
          <a class="btn btn-outline btn-sm" href="${c.link}">${icon('edit', 16)}${t('teacher.comments.openInEditor')}</a>
        </span>
      </div>
    </article>`;
}
