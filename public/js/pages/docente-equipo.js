// Vista 06 · Detalle de equipo: avance, aportes, registro de actividad y revisión (RF-08, RF-09, RF-10)
import { get, post } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, avatar, pill, ago, fmtDateTime, emptyState, toast, clearErrors, showError, withBusy, param, fmtNumber, fmtPercent } from '../core/ui.js';
import { t, has } from '../core/i18n.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const teamId = Number(param('id'));
const state = { data: null, reviewId: null };

await initLayout({ roles: ['docente'], active: 'panel' });

if (!Number.isInteger(teamId) || teamId <= 0) {
  setMain(html`${emptyState('users', t('teacher.team.pickTitle'), t('teacher.team.pickText'), html`<a class="btn btn-primary" href="/docente/panel.html">${t('teacher.team.goToPanel')}</a>`)}`);
} else {
  await load();
}

async function load() {
  try {
    state.data = await get(`/teacher/teams/${teamId}`);
  } catch (err) {
    setMain(html`${emptyState('alert', t(err.status === 404 ? 'teacher.team.notFound' : 'teacher.team.loadError'), err.message,
      html`<a class="btn btn-outline" href="/docente/panel.html">${t('teacher.team.backToPanel')}</a>`)}`);
    return;
  }
  const ids = state.data.in_review.map((s) => s.id);
  if (!ids.includes(state.reviewId)) state.reviewId = ids[0] || null;
  render();
}

function render() {
  const { team, summary, members } = state.data;
  document.title = `${team.name} · Helena les dice`;
  const levelText = summary.current
    ? t('teacher.panel.levelOf', { n: summary.current.position, total: summary.levels_count })
    : t('teacher.panel.allLevelsDone');
  setMain(html`
    <div>
      <nav class="crumbs" aria-label="${t('common.breadcrumb')}"><a href="/docente/panel.html">${t('menu.docente.panel')}</a><span aria-hidden="true">/</span><span>${team.name}</span></nav>
      <div class="page-head">
        <div>
          <h1 class="page-title">${team.name}${team.project ? ` · ${team.project}` : ''}</h1>
          <p class="page-sub">${t('teacher.teams.memberCount', { count: members.length })} · ${levelText} · ${t('teacher.team.docApproved', { pct: fmtPercent(summary.pct) })} · ${t('teacher.periodN', { name: team.period_name })}</p>
        </div>
        ${team.period_active ? h`<a class="btn btn-outline" href="/docente/equipos.html?editar=${team.id}">${icon('edit', 18)}${t('teacher.team.editTeam')}</a>` : ''}
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
      <h2 id="niv" class="card-title" style="font-size:18px">${t('teacher.panel.progressByLevel')}</h2>
      ${state.data.levels.length === 0 ? h`<p class="muted">${t('teacher.team.noLevels')}</p>` : state.data.levels.map((l) => {
        const locked = l.state === 'locked';
        const cap = locked ? t('student.board.locked') : t('teacher.team.ofTotal', { approved: l.approved, total: l.total });
        return h`
          <div class="lv-row ${locked ? 'lv-row--locked' : ''}">
            <span style="font-weight:700">${l.position} · ${l.name}</span>
            <div class="progress" role="img" aria-label="${t('teacher.panel.levelBar', { n: l.position, approved: l.approved, count: l.total })}"><span style="width:${l.pct === 100 && l.total === 0 ? 0 : l.pct}%"></span></div>
            <span class="lv-row__cap">${cap}${l.in_review ? h` <span class="tag" title="${t('teacher.team.inReviewTitle')}">${t('teacher.team.inReviewShort', { count: l.in_review })}</span>` : ''}</span>
          </div>`;
      })}
    </section>`;
}

function membersCard() {
  const { members } = state.data;
  return h`
    <section class="card" aria-labelledby="int">
      <div class="card-head"><h2 id="int" class="card-title" style="font-size:18px">${t('teacher.team.contribByMember')}</h2></div>
      ${members.length === 0 ? emptyState('users', t('teacher.team.noMembersTitle'), t('teacher.team.noMembersText')) : h`
      <div class="table-wrap">
        <table class="table" style="min-width:680px">
          <thead><tr><th scope="col">${t('student.editor.member')}</th><th scope="col">${t('common.responsible')}</th><th scope="col">${t('common.reviewer')}</th><th scope="col" class="num">${t('student.members.contributions')}</th><th scope="col">${t('teacher.team.lastActivity')}</th><th scope="col" style="width:190px">${t('teacher.team.participation')}</th></tr></thead>
          <tbody>
            ${members.map((m) => h`
              <tr>
                <td><div class="person">${avatar(m.name, 'avatar-sm')}<strong>${m.name}</strong></div></td>
                <td>${t('teacher.team.sections', { count: m.responsible })}</td>
                <td>${t('teacher.team.sections', { count: m.reviewer })}</td>
                <td class="num" style="font-weight:700">${fmtNumber(m.contributions)}</td>
                <td class="muted">${m.last_activity ? ago(m.last_activity) : t('teacher.panel.noRecentActivity')}</td>
                <td><div class="part-cell ${m.low ? 'low' : ''}">
                  <div class="progress ${m.low ? 'progress-warn' : ''}" role="img" aria-label="${t(m.low ? 'teacher.team.shareLow' : 'teacher.team.share', { pct: fmtPercent(m.pct) })}"><span style="width:${m.pct}%"></span></div>
                  <span>${fmtPercent(m.pct)}</span></div></td>
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
        <h2 id="act" class="card-title" style="font-size:18px">${t('teacher.team.activityLog')}</h2>
        <span class="muted small row" style="gap:6px">${icon('lock', 14)}${t('teacher.team.activityReadOnly', { count: activity.length })}</span>
      </div>
      ${activity.length === 0 ? h`<p class="muted">${t('teacher.team.noActivity')}</p>` : h`
        <div class="log-scroll">
          ${activity.map((a) => h`
            <div class="log-item">
              <span><strong>${a.is_system ? t('teacher.team.system') : a.user_name}</strong> ${actionText(a)} ${a.target ? h`<strong>${a.target}</strong>` : ''}</span>
              <time class="log-item__when" datetime="${a.created_at}" title="${fmtDateTime(a.created_at)}">${ago(a.created_at)}</time>
            </div>`)}
        </div>`}
    </section>`;
}

/** Frase de una acción del registro: activity.<action>, con respaldo en la etiqueta del servidor. */
// Declaración de función (no const): el módulo usa await de primer nivel y la llama antes de esta línea
function actionText(a) {
  return has(`activity.${a.action}`) ? t(`activity.${a.action}`) : a.label;
}

function reviewCard() {
  const list = state.data.in_review;
  if (list.length === 0) {
    return h`<section class="card card-pad stack" aria-labelledby="revisar">
      <h2 id="revisar" class="card-title">${t('student.editor.reviewTitle')}</h2>
      <p class="muted">${t('teacher.team.nothingToReview')}</p>
    </section>`;
  }
  const s = list.find((x) => x.id === state.reviewId) || list[0];
  return h`
    <section class="card card-pad stack review-card" aria-labelledby="revisar" style="gap:14px">
      <div class="row between">
        <h2 id="revisar" class="card-title">${t('student.editor.reviewTitle')}</h2>
        ${pill('revision')}
      </div>
      ${list.length > 1 ? h`
        <div class="field">
          <label class="label" for="rev-pick">${t('teacher.team.sectionsInReview', { count: list.length })}</label>
          <select class="select" id="rev-pick">
            ${list.map((x) => h`<option value="${x.id}" ${x.id === s.id ? 'selected' : ''}>${x.code} ${x.name}</option>`)}
          </select>
        </div>` : ''}
      <div>
        <div style="font-size:17px;font-weight:800">${s.code} ${s.name}</div>
        <div class="muted">${t('student.editor.chip.responsible')} ${s.responsible_name || t('common.unassigned')} · ${t('student.editor.chip.reviewer')} ${s.reviewer_name || t('common.unassigned')}</div>
        <div class="muted small">${t('teacher.team.submittedAgo', { when: ago(s.updated_at).toLowerCase() })}</div>
      </div>
      <div class="excerpt">${s.excerpt || t('teacher.team.noText')}</div>
      <a href="${s.link}" class="row" style="gap:6px;font-weight:700">${t('teacher.comments.openInEditor')} ${icon('chevronRight', 16)}</a>
      <form id="review-form" class="stack" novalidate>
        <div class="form-alert"></div>
        <div class="field">
          <label class="label" for="obs">${t('teacher.team.commentForTeam')}</label>
          <textarea class="textarea" id="obs" name="observation" rows="4" maxlength="5000" placeholder="${t('teacher.team.obsPlaceholder')}" aria-describedby="obs-hint"></textarea>
          <span class="hint" id="obs-hint">${t('teacher.team.obsHint')}</span>
        </div>
        <div class="review-actions">
          <button type="submit" class="btn btn-primary" data-decision="aprobar">${icon('check', 18)}${t('student.editor.approve')}</button>
          <button type="submit" class="btn btn-return" data-decision="devolver">${icon('undo', 18)}${t('student.editor.returnWithNotes')}</button>
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
      showError(form, { field: 'observation', message: t('student.editor.observationRequired') });
      return;
    }
    try {
      await withBusy(button, () => post(`/teacher/sections/${state.reviewId}/review`, { decision, observation }));
      toast(t(decision === 'aprobar' ? 'teacher.team.approvedToast' : 'teacher.team.returnedToast'));
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
      <h2 id="pend2" class="card-title">${t('teacher.comments.pendingTitle')} <span class="tag">${fmtNumber(list.length)}</span></h2>
      ${list.length === 0 ? h`<p class="muted">${t('teacher.team.allAddressed')}</p>` : list.map((c) => h`
        <a class="note note--warm" href="${c.link}" style="color:inherit;text-decoration:none">
          <strong>${c.code} ${c.section_name}</strong>
          ${c.quote ? h`<span class="muted small">${t('student.editor.about', { quote: c.quote })}</span>` : ''}
          <span style="line-height:1.5">“${c.body}”</span>
          <span class="muted small">${c.author_name} · ${ago(c.created_at)}</span>
        </a>`)}
    </section>`;
}
