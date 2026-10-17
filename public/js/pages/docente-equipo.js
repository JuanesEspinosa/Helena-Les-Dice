// Vista 06 · Detalle de equipo: avance, aportes, registro de actividad y revisión (RF-08, RF-09, RF-10)
import { get, post } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, avatar, pill, ago, fmtDateTime, emptyState, toast, clearErrors, showError, withBusy, param } from '../core/ui.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const teamId = Number(param('id'));
const state = { data: null, reviewId: null };

await initLayout({ roles: ['docente'], active: 'panel' });

if (!Number.isInteger(teamId) || teamId <= 0) {
  setMain(html`${emptyState('users', 'Elige un equipo', 'Abre el detalle desde el panel de seguimiento.', html`<a class="btn btn-primary" href="/docente/panel.html">Ir al panel</a>`)}`);
} else {
  await load();
}

async function load() {
  try {
    state.data = await get(`/teacher/teams/${teamId}`);
  } catch (err) {
    setMain(html`${emptyState('alert', err.status === 404 ? 'El equipo no existe' : 'No se pudo cargar el equipo', err.message,
      html`<a class="btn btn-outline" href="/docente/panel.html">Volver al panel</a>`)}`);
    return;
  }
  const ids = state.data.in_review.map((s) => s.id);
  if (!ids.includes(state.reviewId)) state.reviewId = ids[0] || null;
  render();
}

function render() {
  const { team, summary, members } = state.data;
  document.title = `${team.name} · Helena les dice`;
  const levelText = summary.current ? `Nivel ${summary.current.position} de ${summary.levels_count}` : 'Todos los niveles completos';
  setMain(html`
    <div>
      <nav class="crumbs" aria-label="Ruta"><a href="/docente/panel.html">Panel de seguimiento</a><span aria-hidden="true">/</span><span>${team.name}</span></nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">${team.name}${team.project ? ` · ${team.project}` : ''}</h1>
          <p class="page-sub">${members.length} integrantes · ${levelText} · ${summary.pct} % del documento aprobado · Periodo ${team.period_name}</p>
        </div>
        ${team.period_active ? h`<a class="btn btn-outline" href="/docente/equipos.html?editar=${team.id}">${icon('edit', 18)}Editar equipo</a>` : ''}
      </div>
    </div>
    <div class="split">
      <div class="grow stack" style="gap:24px">
        ${levelsCard()}
        ${membersCard()}
        ${activityCard()}
      </div>
      <aside class="side">
        <div id="review-box">${reviewCard()}</div>
        ${commentsCard()}
      </aside>
    </div>`);
  wireReview();
}

function levelsCard() {
  return h`
    <section class="card card-body stack" aria-labelledby="niv" style="gap:14px">
      <h2 id="niv" class="card-title" style="font-size:18px">Avance por nivel</h2>
      ${state.data.levels.length === 0 ? h`<p class="muted">Todavía no hay niveles configurados.</p>` : state.data.levels.map((l) => {
        const locked = l.state === 'locked';
        const cap = locked ? 'Bloqueado' : `${l.approved} de ${l.total}`;
        return h`
          <div class="lv-row ${locked ? 'lv-row--locked' : ''}">
            <span style="font-weight:700">${l.position} · ${l.name}</span>
            <div class="progress" role="img" aria-label="Nivel ${l.position}: ${l.approved} de ${l.total} secciones aprobadas"><span style="width:${l.pct === 100 && l.total === 0 ? 0 : l.pct}%"></span></div>
            <span class="lv-row__cap">${cap}${l.in_review ? h` <span class="tag" title="Secciones en revisión">${l.in_review} en rev.</span>` : ''}</span>
          </div>`;
      })}
    </section>`;
}

function membersCard() {
  const { members } = state.data;
  return h`
    <section class="card" aria-labelledby="int">
      <div class="card-head"><h2 id="int" class="card-title" style="font-size:18px">Aportes por integrante</h2></div>
      ${members.length === 0 ? emptyState('users', 'El equipo no tiene integrantes', 'Agrégalos desde Equipos.') : h`
      <div class="table-wrap">
        <table class="table" style="min-width:680px">
          <thead><tr><th scope="col">Integrante</th><th scope="col">Responsable</th><th scope="col">Revisor</th><th scope="col" class="num">Aportes</th><th scope="col">Última actividad</th><th scope="col" style="width:190px">Participación</th></tr></thead>
          <tbody>
            ${members.map((m) => h`
              <tr>
                <td><div class="person">${avatar(m.name, 'avatar-sm')}<strong>${m.name}</strong></div></td>
                <td>${m.responsible} ${m.responsible === 1 ? 'sección' : 'secciones'}</td>
                <td>${m.reviewer} ${m.reviewer === 1 ? 'sección' : 'secciones'}</td>
                <td class="num" style="font-weight:700">${m.contributions}</td>
                <td class="muted">${m.last_activity ? ago(m.last_activity) : 'Sin movimiento reciente'}</td>
                <td><div class="part-cell ${m.low ? 'low' : ''}">
                  <div class="progress ${m.low ? 'progress-warn' : ''}" role="img" aria-label="${m.pct}% de los aportes${m.low ? ', participación baja' : ''}"><span style="width:${m.pct}%"></span></div>
                  <span>${m.pct}%</span></div></td>
              </tr>`)}
          </tbody>
        </table>
      </div>`}
    </section>`;
}

function activityCard() {
  const { activity } = state.data;
  return h`
    <section class="card card-body stack" aria-labelledby="act" style="gap:4px">
      <div class="row between" style="margin-bottom:8px">
        <h2 id="act" class="card-title" style="font-size:18px">Registro de actividad</h2>
        <span class="muted small row" style="gap:6px">${icon('lock', 14)}Solo lectura · últimas ${activity.length} acciones</span>
      </div>
      ${activity.length === 0 ? h`<p class="muted">Sin movimiento reciente: el equipo todavía no registra acciones.</p>` : h`
        <div class="log-scroll">
          ${activity.map((a) => h`
            <div class="log-item">
              <span><strong>${a.user_name}</strong> ${a.label} ${a.target ? h`<strong>${a.target}</strong>` : ''}</span>
              <time class="log-item__when" datetime="${a.created_at}" title="${fmtDateTime(a.created_at)}">${ago(a.created_at)}</time>
            </div>`)}
        </div>`}
    </section>`;
}

function reviewCard() {
  const list = state.data.in_review;
  if (list.length === 0) {
    return h`<section class="card card-pad stack" aria-labelledby="revisar">
      <h2 id="revisar" class="card-title">Revisar sección</h2>
      <p class="muted">El equipo no tiene secciones esperando revisión.</p>
    </section>`;
  }
  const s = list.find((x) => x.id === state.reviewId) || list[0];
  return h`
    <section class="card card-pad stack review-card" aria-labelledby="revisar" style="gap:14px">
      <div class="row between">
        <h2 id="revisar" class="card-title">Revisar sección</h2>
        ${pill('revision')}
      </div>
      ${list.length > 1 ? h`
        <div class="field">
          <label class="label" for="rev-pick">Sección en revisión (${list.length})</label>
          <select class="select" id="rev-pick">
            ${list.map((x) => h`<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${x.code} ${x.name}</option>`)}
          </select>
        </div>` : ''}
      <div>
        <div style="font-size:17px;font-weight:800">${s.code} ${s.name}</div>
        <div class="muted">Responsable: ${s.responsible_name || 'sin asignar'} · Revisor: ${s.reviewer_name || 'sin asignar'}</div>
        <div class="muted small">Enviada ${ago(s.updated_at).toLowerCase()}</div>
      </div>
      <div class="excerpt">${s.excerpt || 'La sección no tiene texto.'}</div>
      <a href="${s.link}" class="row" style="gap:6px;font-weight:700">Abrir en el editor ${icon('chevronRight', 16)}</a>
      <form id="review-form" class="stack" novalidate>
        <div class="form-alert"></div>
        <div class="field">
          <label class="label" for="obs">Comentario para el equipo</label>
          <textarea class="textarea" id="obs" name="observation" rows="4" maxlength="5000" placeholder="Escribe tus observaciones…" aria-describedby="obs-hint"></textarea>
          <span class="hint" id="obs-hint">Obligatorio para devolver la sección. Opcional al aprobar.</span>
        </div>
        <div class="review-actions">
          <button type="submit" class="btn btn-primary" data-decision="aprobar">${icon('check', 18)}Aprobar</button>
          <button type="submit" class="btn btn-return" data-decision="devolver">${icon('undo', 18)}Devolver con observaciones</button>
        </div>
      </form>
    </section>`;
}

function wireReview() {
  const box = document.getElementById('review-box');
  box.addEventListener('change', (e) => {
    if (e.target.id !== 'rev-pick') return;
    state.reviewId = Number(e.target.value);
    box.innerHTML = reviewCard().value;
    document.getElementById('rev-pick').focus();
  });
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const button = e.submitter;
    const decision = button && button.dataset.decision;
    const observation = form.observation.value.trim();
    clearErrors(form);
    form.querySelector('.form-alert').innerHTML = '';
    if (decision === 'devolver' && !observation) {
      showError(form, { field: 'observation', message: 'Escribe una observación para devolver la sección.' });
      return;
    }
    try {
      await withBusy(button, () => post(`/teacher/sections/${state.reviewId}/review`, { decision, observation }));
      toast(decision === 'aprobar' ? 'La sección quedó aprobada y el equipo fue notificado.' : 'La sección se devolvió con tus observaciones.');
      await load();
    } catch (err) {
      showError(form, err);
    }
  });
}

function commentsCard() {
  const list = state.data.pending_comments;
  return h`
    <section class="card card-pad stack" aria-labelledby="pend2" style="gap:10px">
      <h2 id="pend2" class="card-title">Comentarios sin atender <span class="tag">${list.length}</span></h2>
      ${list.length === 0 ? h`<p class="muted">El equipo atendió todos los comentarios de las docentes.</p>` : list.map((c) => h`
        <a class="note note--warm" href="${c.link}" style="color:inherit;text-decoration:none">
          <strong>${c.code} ${c.section_name}</strong>
          ${c.quote ? h`<span class="muted small">Sobre: “${c.quote}”</span>` : ''}
          <span style="line-height:1.5">“${c.body}”</span>
          <span class="muted small">${c.author_name} · ${ago(c.created_at)}</span>
        </a>`)}
    </section>`;
}
