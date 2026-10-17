// Vista 02 · Tablero de niveles del estudiante (RF-04, RF-05, RF-07)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, badgeIcon, pill, avatar, ago, emptyState } from '../core/ui.js';

const COUNT_LABEL = {
  aprobado: (n) => `${n} ${n === 1 ? 'aprobada' : 'aprobadas'}`,
  revision: (n) => `${n} en revisión`,
  redaccion: (n) => `${n} en redacción`,
  devuelto: (n) => `${n} ${n === 1 ? 'devuelta' : 'devueltas'}`,
};

const ROLE_NAME = { docente: 'Docente', administrador: 'Administrador' };

function levelCard(lv, levels) {
  const prev = levels.find((l) => l.position === lv.position - 1);
  const caption = lv.state === 'locked'
    ? (prev && prev.state === 'current' ? `Se desbloquea al aprobar el nivel ${prev.position}` : 'Bloqueado')
    : `${lv.approved} de ${lv.total} ${lv.total === 1 ? 'aprobada' : 'aprobadas'}`;
  const mark = lv.state === 'done'
    ? icon('check', 20, 'role="img" aria-label="Completado"')
    : lv.state === 'locked' ? icon('lock', 18, 'role="img" aria-label="Bloqueado"') : '';
  const barClass = lv.state === 'done' ? 'progress progress-sm progress-light' : 'progress progress-sm';
  return safe(html`<li class="level-card level-card--${lv.state}" ${safe(lv.state === 'current' ? 'aria-current="step"' : '')}>
    <div class="level-card__top"><span>Nivel ${lv.position}</span>${mark}</div>
    <div class="level-card__name">${lv.name}</div>
    <div class="${barClass}" aria-hidden="true"><span style="width:${lv.state === 'locked' ? 0 : lv.pct}%"></span></div>
    <div class="level-card__cap">${caption}</div>
  </li>`);
}

const personCell = (p, cls) => (p
  ? safe(html`<div class="person">${avatar(p.name, `avatar-sm ${cls}`)}<span>${p.name}</span></div>`)
  : safe(html`<span class="muted">Sin asignar</span>`));

function sectionRow(s, levelPos) {
  return safe(html`<tr>
    <td><strong>${levelPos}.${s.position} ${s.name}</strong></td>
    <td>${personCell(s.responsible, '')}</td>
    <td>${personCell(s.reviewer, 'avatar-gray')}</td>
    <td>${pill(s.status)}</td>
    <td class="muted" style="white-space:nowrap">${s.updated_at ? ago(s.updated_at) : 'Sin editar'}</td>
    <td class="actions"><a class="btn btn-outline btn-sm" href="/editor.html?id=${s.id}" aria-label="Abrir ${s.name}">Abrir</a></td>
  </tr>`);
}

function currentLevel(d) {
  const lv = d.current;
  if (!lv) return emptyState('layers', 'Aún no hay niveles configurados', 'La docente todavía no ha definido los niveles del documento.');
  const counts = Object.entries(d.counts).filter(([, n]) => n > 0)
    .map(([st, n]) => safe(html`<span class="pill pill--plain pill-${st}">${COUNT_LABEL[st](n)}</span>`));
  const eyebrow = lv.finished ? '¡Documento completo!' : `Sprint actual · Periodo ${d.team.period_name}`;
  const rows = d.sections.length
    ? safe(html`<div class="table-wrap"><table class="table" style="min-width:720px">
        <thead><tr><th scope="col">Sección</th><th scope="col">Responsable</th><th scope="col">Revisor</th>
          <th scope="col">Estado</th><th scope="col">Última edición</th><th scope="col"><span class="sr-only">Acción</span></th></tr></thead>
        <tbody>${d.sections.map((s) => sectionRow(s, lv.position))}</tbody></table></div>`)
    : emptyState('file', 'Este nivel no tiene secciones', 'Cuando la docente agregue secciones aparecerán aquí.');
  return safe(html`<section class="card grow" aria-labelledby="nivel-actual" style="overflow:hidden">
    <div class="card-head">
      <div><div class="eyebrow">${eyebrow}</div>
        <h2 id="nivel-actual" style="margin-top:4px;font-size:22px;font-weight:800">Nivel ${lv.position} · ${lv.name}</h2></div>
      <div class="row">${counts}</div>
    </div>
    ${rows}
  </section>`);
}

function commentNote(c) {
  const who = c.author_role === 'estudiante'
    ? `${c.author_name}${c.author_is_reviewer ? ' (revisor)' : ''}`
    : ROLE_NAME[c.author_role] || c.author_name;
  const tone = c.author_role === 'docente' ? 'note note--warm' : 'note';
  return safe(html`<a class="${tone}" href="/editor.html?id=${c.section_id}" style="text-decoration:none;color:inherit">
    <strong>${c.section_name}</strong>
    <span style="line-height:1.5">“${c.body.length > 140 ? `${c.body.slice(0, 140)}…` : c.body}”</span>
    <span class="small muted">${who} · ${ago(c.created_at)}</span>
  </a>`);
}

function sideColumn(d) {
  const list = d.pending_comments.length
    ? d.pending_comments.map(commentNote)
    : emptyState('checkCircle', 'Sin comentarios pendientes', 'Están al día con la retroalimentación.');
  const more = d.pending_total > d.pending_comments.length
    ? safe(html`<p class="small muted">Y ${d.pending_total - d.pending_comments.length} más en otras secciones.</p>`) : '';
  const a = d.next_achievement;
  const next = a
    ? safe(html`<div class="row" style="flex-wrap:nowrap;gap:14px">
        <div class="badge-icon" style="width:52px;height:52px">${badgeIcon(a.icon, 26)}</div>
        <div><div style="font-weight:800;font-size:15px">${a.name}</div>
          <div class="muted">${a.progress.label} · +${a.points} puntos</div></div>
      </div>
      <div class="progress progress-sm" aria-label="Avance hacia ${a.name}: ${a.progress.pct}%"><span style="width:${a.progress.pct}%"></span></div>`)
    : safe(html`<p class="muted">¡Ganaron todas las insignias disponibles!</p>`);
  return safe(html`<aside class="side">
    <section class="card card-pad stack" aria-labelledby="pend">
      <h2 id="pend" class="card-title">${icon('message', 18)}Comentarios pendientes
        ${d.pending_total ? safe(html`<span class="pill pill--plain pill-devuelto" style="margin-left:auto">${d.pending_total}</span>`) : ''}</h2>
      ${list}${more}
    </section>
    <section class="card card-pad stack" aria-labelledby="prox">
      <div class="row between"><h2 id="prox" class="card-title">Próximo logro</h2><a class="small" href="/estudiante/logros.html">Ver todos</a></div>
      ${next}
    </section>
  </aside>`);
}

function render(d) {
  setMain(html`
    <div class="page-head">
      <div><h1 class="page-title">Tablero de niveles</h1>
        <p class="page-sub">Aprueben todas las secciones de un nivel para desbloquear el siguiente.</p></div>
      <a class="card row" href="/estudiante/logros.html" style="padding:10px 14px;font-weight:700;text-decoration:none;color:inherit;border-radius:12px">
        <span style="color:var(--gold)">${icon('star', 18)}</span>${d.points} puntos · ${d.badges} ${d.badges === 1 ? 'insignia' : 'insignias'}
      </a>
    </div>
    <ol class="grid grid-5" aria-label="Niveles del documento" style="list-style:none;margin:0;padding:0">
      ${d.levels.map((lv) => levelCard(lv, d.levels))}
    </ol>
    <div class="split">${currentLevel(d)}${sideColumn(d)}</div>`);
}

async function main() {
  await initLayout({ roles: ['estudiante'], active: 'tablero' });
  try {
    render(await get('/student/board'));
  } catch (err) {
    const noTeam = err.status === 404;
    setMain(html`<div class="page-head"><div><h1 class="page-title">Tablero de niveles</h1></div></div>
      <div class="card">${noTeam
        ? emptyState('users', 'Todavía no perteneces a un equipo', err.message)
        : emptyState('alert', 'No pudimos cargar el tablero', err.message,
          html`<button class="btn btn-outline" type="button" id="retry">${icon('refresh', 18)}Reintentar</button>`)}</div>`);
    document.getElementById('retry')?.addEventListener('click', () => location.reload());
  }
}

main();
