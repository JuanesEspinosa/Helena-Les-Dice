// Vista 04 · Logros e insignias del equipo (RF-11)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, badgeIcon, fmtDate, emptyState } from '../core/ui.js';

function hero(d) {
  const n = d.next;
  const caption = n
    ? `${n.progress.label} para «${n.name}» (+${n.points} puntos)`
    : '¡Ganaron todas las insignias disponibles!';
  const pct = n ? n.progress.pct : 100;
  return safe(html`<div class="hero row" style="flex:2 1 360px;gap:20px;flex-wrap:nowrap">
    <div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center;flex:none">${icon('trophy', 34)}</div>
    <div class="stack" style="flex:1;gap:8px;min-width:0;position:relative;z-index:1">
      <div style="font-weight:600;opacity:.9">Puntos del ${d.team.name}</div>
      <div style="font-size:40px;font-weight:800;line-height:1">${d.points}</div>
      <div class="progress progress-light" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"
        aria-label="Avance hacia la siguiente insignia"><span style="width:${pct}%"></span></div>
      <div>${caption}</div>
    </div>
  </div>`);
}

const counter = (label, value, total) => safe(html`<div class="card stat" style="flex:1 1 180px;justify-content:center;padding:24px">
  <div class="stat__label">${label}</div>
  <div class="stat__value" style="font-size:36px">${value} <span style="font-size:18px;color:var(--text-2);font-weight:600">de ${total}</span></div>
</div>`);

function badgeCard(a) {
  const earned = Boolean(a.earned_at);
  const tag = earned
    ? safe(html`<div class="small" style="margin-top:auto;font-weight:700;color:var(--st-ok)">Ganada el ${fmtDate(a.earned_at)} · +${a.points}</div>`)
    : safe(html`<div class="stack" style="margin-top:auto;gap:6px;width:100%">
        <div class="progress progress-sm" aria-hidden="true"><span style="width:${a.progress.pct}%;background:#9DAAA4"></span></div>
        <div class="small muted" style="font-weight:700">${a.progress.label} · +${a.points} al lograrlo</div></div>`);
  const style = earned ? '' : 'background:var(--surface-2);border-style:dashed;border-color:#B9C4BF;box-shadow:none';
  return safe(html`<article class="card card-pad stack" style="min-height:220px;align-items:flex-start;gap:10px;${style}"
      aria-label="${a.name}: ${earned ? 'ganada' : 'pendiente'}">
    <div class="badge-icon ${earned ? '' : 'badge-icon--locked'}" style="width:60px;height:60px;position:relative">
      ${earned ? badgeIcon(a.icon, 30) : icon('lock', 26)}
    </div>
    <h3 style="font-size:16px;font-weight:800">${a.name}</h3>
    <p style="line-height:1.5;color:#3E4A45">${a.description}</p>
    ${tag}
  </article>`);
}

function render(d) {
  const grid = d.achievements.length
    ? safe(html`<div class="grid grid-4">${d.achievements.map(badgeCard)}</div>`)
    : safe(html`<div class="card">${emptyState('medal', 'Aún no hay insignias', 'El administrador todavía no ha creado el catálogo de logros.')}</div>`);
  setMain(html`
    <div><h1 class="page-title">Logros e insignias</h1>
      <p class="page-sub">Las insignias se ganan en equipo al cumplir metas del documento.</p></div>
    <div class="row" style="gap:16px;align-items:stretch">
      ${hero(d)}
      ${counter('Insignias ganadas', d.badges_earned, d.badges_total)}
      ${counter('Niveles superados', d.levels_done, d.levels_total)}
    </div>
    <section aria-labelledby="ins" class="stack" style="gap:14px">
      <h2 id="ins" style="font-size:20px;font-weight:800">Insignias</h2>
      ${grid}
    </section>`);
}

async function main() {
  await initLayout({ roles: ['estudiante'], active: 'logros' });
  try {
    render(await get('/student/achievements'));
  } catch (err) {
    setMain(html`<div><h1 class="page-title">Logros e insignias</h1></div>
      <div class="card">${emptyState(err.status === 404 ? 'users' : 'alert',
        err.status === 404 ? 'Todavía no perteneces a un equipo' : 'No pudimos cargar los logros', err.message)}</div>`);
  }
}

main();
