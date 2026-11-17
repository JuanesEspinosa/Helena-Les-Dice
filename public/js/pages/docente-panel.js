// Vista 05 · Panel de seguimiento de la docente (RF-09)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, ago, emptyState, loading, param, fmtNumber, fmtPercent, fmtTime } from '../core/ui.js';
import { t, getLocale } from '../core/i18n.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const REFRESH_MS = 45 * 1000; // RNF-03: el panel se actualiza solo

const state = { level: param('level') || '', period: param('period') || '', data: null, timer: null };

await initLayout({ roles: ['docente'], active: 'panel' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">${t('menu.docente.panel')}</h1>
      <p class="page-sub">${t('teacher.panel.lead')}</p>
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
      if (note) note.textContent = t('teacher.panel.refreshFailed');
    } else {
      document.getElementById('dash').innerHTML = emptyState('alert', t('teacher.panel.loadError'), err.message).value;
    }
  }
  clearTimeout(state.timer);
  state.timer = setTimeout(() => load(true), REFRESH_MS);
}

function renderFilters({ periods, period, levels }) {
  const box = document.getElementById('filters');
  if (box.contains(document.activeElement)) return; // no interrumpir a quien está eligiendo
  box.innerHTML = html`
    <label class="sr-only" for="f-period">${t('teacher.academicPeriod')}</label>
    <select class="select" id="f-period" name="period">
      ${periods.map((p) => h`<option value="${p.id}" ${period && p.id === period.id ? 'selected' : ''}>${t(p.active ? 'teacher.periodActive' : 'teacher.periodN', { name: p.name })}</option>`)}
    </select>
    <label class="sr-only" for="f-level">${t('teacher.panel.filterLevel')}</label>
    <select class="select" id="f-level" name="level">
      <option value="">${t('teacher.panel.allLevels')}</option>
      ${levels.map((l) => h`<option value="${l.id}" ${String(l.id) === state.level ? 'selected' : ''}>${t('common.levelNamed', { n: l.position, name: l.name })}</option>`)}
    </select>
    <a class="btn btn-primary" href="/docente/equipos.html#crear">${icon('plus', 18)}${t('teacher.createTeam')}</a>`;
}

function renderDash(d) {
  const el = document.getElementById('dash');
  el.innerHTML = html`
    <div class="stack" style="gap:24px">
      ${statsRow(d.indicators)}
      <div class="split">
        <section class="grow stack" aria-labelledby="eqs" style="gap:14px">
          <div class="row between">
            <h2 id="eqs" style="font-size:20px;font-weight:800">${d.period ? t('teacher.panel.teamsOfPeriod', { name: d.period.name }) : t('menu.docente.equipos')}</h2>
            <span class="refresh-note" id="refresh-note" aria-live="polite">${t('teacher.panel.updatedAt', { time: fmtTime(new Date()) })}</span>
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
        <div class="stat__label">${t('teacher.panel.activeTeams')}</div>
        <div class="stat__value">${fmtNumber(ind.teams)}</div>
        <div class="stat__hint">${t('teacher.panel.students', { count: ind.students })}</div>
      </div>
      <div class="card stat">
        <div class="stat__label">${t('teacher.panel.globalProgress')}</div>
        <div class="stat__value">${fmtPercent(ind.avg_pct)}</div>
        <div class="progress progress-sm" role="img" aria-label="${t('teacher.panel.globalProgress')} ${fmtPercent(ind.avg_pct)}"><span style="width:${ind.avg_pct}%"></span></div>
      </div>
      <div class="card stat">
        <div class="stat__label">${t('student.board.pendingComments')}</div>
        <div class="stat__value ${ind.pending_comments ? 'stat__value--back' : ''}">${fmtNumber(ind.pending_comments)}</div>
        <div class="stat__hint"><a href="/docente/comentarios.html">${t('teacher.panel.unaddressed')}</a></div>
      </div>
      <div class="card stat">
        <div class="stat__label">${t('teacher.panel.awaitingReview')}</div>
        <div class="stat__value ${ind.in_review ? 'stat__value--review' : ''}">${fmtNumber(ind.in_review)}</div>
        <div class="stat__hint">${t('teacher.panel.submittedSections')}</div>
      </div>
    </div>`;
}

function teamsGrid({ teams, period }) {
  if (!period) return emptyState('calendar', t('teacher.noPeriodsTitle'), t('teacher.noPeriodsText'));
  if (teams.length === 0) {
    const filtered = Boolean(state.level);
    return h`<div class="card">${emptyState('users',
      filtered ? t('teacher.panel.noTeamAtLevel') : t('teacher.noTeamsInPeriod'),
      filtered ? t('teacher.panel.tryOtherLevel') : t('teacher.createFirstTeam'),
      filtered ? '' : h`<a class="btn btn-primary" href="/docente/equipos.html#crear">${icon('plus', 18)}${t('teacher.createTeam')}</a>`)}</div>`;
  }
  return h`<div class="grid grid-2">${teams.map(teamCard)}</div>`;
}

function teamCard(team) {
  const levelLabel = team.current
    ? t('teacher.panel.levelOf', { n: team.current.position, total: team.levels.length })
    : t('teacher.panel.allLevelsDone');
  const comments = team.pending_comments === 0 ? t('student.board.noPendingTitle')
    : t('teacher.pendingComments', { count: team.pending_comments });
  return h`
    <article class="card team-card ${team.inactive ? 'team-card--quiet' : ''}" aria-labelledby="t-${team.id}">
      <div class="row between" style="align-items:flex-start;flex-wrap:nowrap">
        <div style="min-width:0">
          <h3 id="t-${team.id}" style="font-size:17px;font-weight:800">${team.name}</h3>
          <div class="muted">${team.project || t('teacher.noProject')}</div>
        </div>
        <div class="team-card__pct" aria-label="${t('teacher.progressPct', { pct: fmtPercent(team.pct) })}">${fmtPercent(team.pct)}</div>
      </div>
      <div class="stack" style="gap:6px">
        <div class="sub-label"><span>${t('teacher.panel.progressByLevel')}</span><span>${levelLabel}</span></div>
        <div class="lv-bars">
          ${team.levels.map((l) => {
            const w = l.total ? Math.round((l.approved / l.total) * 100) : 100;
            return h`<div class="lv-bar ${l.state === 'done' ? 'lv-bar--done' : ''}" role="img" aria-label="${t('teacher.panel.levelBar', { n: l.position, approved: l.approved, count: l.total })}" title="${t('teacher.panel.levelBarTitle', { n: l.position, name: l.name, approved: l.approved, total: l.total })}"><span style="width:${w}%"></span></div>`;
          })}
        </div>
      </div>
      <div class="stack" style="gap:8px">
        <div class="sub-label"><span>${t('teacher.panel.participation')}</span></div>
        ${team.members.length === 0 ? h`<p class="muted small">${t('teacher.noMembersYet')}</p>` : team.members.map(memberRow)}
      </div>
      <div class="card-foot">
        <div class="row" style="gap:8px">
          <span class="pill pill--plain ${team.pending_comments ? 'pill-devuelto' : 'pill-aprobado'}">${comments}</span>
          ${team.inactive
            ? h`<span class="pill pill--plain pill-warn">${icon('clock', 14)}${t('teacher.panel.noRecentActivity')}</span>`
            : h`<span class="muted">${ago(team.last_activity)}</span>`}
        </div>
        <a class="btn btn-outline btn-sm" href="/docente/equipo.html?id=${team.id}">${t('teacher.panel.seeDetail')}${icon('chevronRight', 16)}</a>
      </div>
    </article>`;
}

function memberRow(m) {
  return h`
    <div class="part ${m.low ? 'part--low' : ''}">
      <span class="part__name" title="${m.name}">${m.name}</span>
      <div class="progress ${m.low ? 'progress-warn' : ''}" role="img" aria-label="${t(m.low ? 'teacher.panel.memberShareLow' : 'teacher.panel.memberShare', { name: m.name, pct: fmtPercent(m.pct) })}"><span style="width:${m.pct}%"></span></div>
      <span class="part__pct">${fmtPercent(m.pct)}</span>
    </div>`;
}

function reviewList(items) {
  return h`
    <section class="card card-pad stack" aria-labelledby="rev">
      <h2 id="rev" class="card-title">${t('teacher.panel.awaitingReview')} <span class="tag">${fmtNumber(items.length)}</span></h2>
      ${items.length === 0
        ? h`<p class="muted">${t('teacher.panel.nothingToReview')}</p>`
        : items.map((r) => h`
          <a class="review-link" href="${r.link}">
            <span style="font-weight:700">${r.code} ${r.name}</span>
            <span class="muted">${r.team_name} · ${t('teacher.panel.submittedAgo', { when: ago(r.updated_at).toLowerCase() })}</span>
          </a>`)}
    </section>`;
}

function alertsCard(teams) {
  const quiet = teams.filter((t) => t.inactive);
  const unequal = teams.filter((t) => t.unequal && !t.inactive);
  if (quiet.length === 0 && unequal.length === 0) {
    return h`<section class="card card-pad stack" aria-labelledby="alerta">
      <h2 id="alerta" class="card-title">${icon('checkCircle', 18)}${t('teacher.panel.noAlerts')}</h2>
      <p class="muted">${t('teacher.panel.noAlertsText')}</p>
    </section>`;
  }
  return h`
    <section class="card card-pad stack alerts-card" aria-labelledby="alerta">
      <h2 id="alerta" class="card-title">${icon('warning', 18)}${t('teacher.panel.alerts')}</h2>
      ${quiet.map((team) => h`<p><a href="/docente/equipo.html?id=${team.id}"><strong>${team.name}</strong></a>: ${team.last_activity
        ? t('teacher.panel.quietSince', { when: ago(team.last_activity).toLowerCase() })
        : t('teacher.panel.quietNever')}</p>`)}
      ${unequal.map((team) => {
        const low = team.members.filter((m) => m.low);
        const names = new Intl.ListFormat(getLocale(), { type: 'conjunction' }).format(low.map((m) => m.name));
        return h`<p><a href="/docente/equipo.html?id=${team.id}"><strong>${team.name}</strong></a>: ${t('teacher.panel.lowParticipation', { names, count: low.length })}</p>`;
      })}
    </section>`;
}
