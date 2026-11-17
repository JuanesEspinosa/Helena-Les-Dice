// Vista 11 · Integrantes y asignación de secciones (RF-05, RF-08)
import { get, put } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, avatar, ago, pill, toast, showError, clearErrors, withBusy, emptyState, fmtNumber, fmtPercent } from '../core/ui.js';
import { t } from '../core/i18n.js';

let data = null;

function memberCard(m, max) {
  const pct = max ? Math.round((m.contributions / max) * 100) : 0;
  return safe(html`<article class="card card-pad stack" style="gap:12px">
    <div class="row" style="flex-wrap:nowrap;gap:12px">${avatar(m.name, 'avatar-lg')}
      <div style="min-width:0"><h2 style="font-size:16px;font-weight:800">${m.name}</h2>
        <div class="small muted">${m.last_activity ? t('student.members.activeAgo', { when: ago(m.last_activity).toLowerCase() }) : t('student.members.noActivity')}</div></div></div>
    <div class="row between" style="align-items:baseline"><span class="muted" style="font-weight:600">${t('student.members.contributions')}</span>
      <span style="font-size:22px;font-weight:800">${fmtNumber(m.contributions)}</span></div>
    <div class="progress" role="img" aria-label="${t('student.members.contributionsBar', { count: m.contributions, pct: fmtPercent(pct) })}"><span style="width:${pct}%"></span></div>
    <div class="row" style="gap:6px"><span class="tag">${t('student.members.writes', { count: m.writes })}</span><span class="tag">${t('student.members.reviews', { count: m.reviews })}</span></div>
  </article>`);
}

const options = (selected) => [safe(html`<option value="">${t('common.unassigned')}</option>`),
  ...data.members.map((m) => safe(html`<option value="${m.id}" ${safe(m.id === selected ? 'selected' : '')}>${m.name}</option>`))];

function assignmentRow(a) {
  const locked = a.status === 'aprobado';
  const dis = safe(locked ? 'disabled' : '');
  return safe(html`<tr style="vertical-align:top" data-section="${a.section_id}">
    <td style="padding-top:22px"><strong>${data.level.position}.${a.position} ${a.name}</strong>
      ${locked ? safe(html`<div class="small muted" style="margin-top:4px">${pill('aprobado')} ${t('student.members.cannotReassign')}</div>`) : ''}</td>
    <td><div class="field"><label class="sr-only" for="resp-${a.section_id}">${t('student.members.responsibleOf', { name: a.name })}</label>
      <select class="select" id="resp-${a.section_id}" name="resp-${a.section_id}" ${dis}>${options(a.responsible_id)}</select></div></td>
    <td><div class="field"><label class="sr-only" for="rev-${a.section_id}">${t('student.members.reviewerOf', { name: a.name })}</label>
      <select class="select" id="rev-${a.section_id}" name="rev-${a.section_id}" ${dis}>${options(a.reviewer_id)}</select></div></td>
  </tr>`);
}

/** Marca o limpia el error de "misma persona" en una fila. Devuelve true si la fila es válida. */
function checkRow(form, a) {
  const resp = form[`resp-${a.section_id}`];
  const rev = form[`rev-${a.section_id}`];
  const field = rev.closest('.field');
  const same = resp.value && resp.value === rev.value;
  field.classList.toggle('has-error', Boolean(same));
  if (same) rev.setAttribute('aria-invalid', 'true'); else rev.removeAttribute('aria-invalid');
  if (same) {
    let msg = field.querySelector('.field-error');
    if (!msg) { msg = document.createElement('div'); msg.className = 'field-error'; msg.setAttribute('role', 'alert'); field.appendChild(msg); }
    msg.innerHTML = html`${icon('alert', 16)}<span>${t('errors.SAME_PERSON')}</span>`;
  }
  return !same;
}

function collect(form) {
  const rows = [];
  for (const a of data.assignments.filter((x) => x.status !== 'aprobado')) {
    const resp = form[`resp-${a.section_id}`].value;
    const rev = form[`rev-${a.section_id}`].value;
    if (!resp || !rev) {
      showError(form, { field: !resp ? `resp-${a.section_id}` : `rev-${a.section_id}`, message: t('student.members.pickBoth') });
      return null;
    }
    rows.push({ section_id: a.section_id, responsible_id: Number(resp), reviewer_id: Number(rev) });
  }
  return rows;
}

async function saveAssignments(form, btn) {
  clearErrors(form);
  const editable = data.assignments.filter((a) => a.status !== 'aprobado');
  const invalid = editable.filter((a) => !checkRow(form, a));
  if (invalid.length) { form[`rev-${invalid[0].section_id}`].focus(); return; }
  const rows = collect(form);
  if (!rows) return;
  if (rows.length === 0) { toast(t('student.members.nothingToReassign'), 'error'); return; }
  await withBusy(btn, async () => {
    try {
      const { updated } = await put('/student/assignments', { assignments: rows });
      toast(updated ? t('student.members.saved', { count: updated }) : t('common.noChanges'));
      await load();
    } catch (err) {
      showError(form, err);
    }
  });
}

function render() {
  const max = Math.max(0, ...data.members.map((m) => m.contributions));
  const table = data.assignments.length
    ? safe(html`<div class="table-wrap"><table class="table" style="min-width:680px">
        <thead><tr><th scope="col">${t('common.section')}</th><th scope="col">${t('student.members.responsibleWrites')}</th><th scope="col">${t('common.reviewer')}</th></tr></thead>
        <tbody>${data.assignments.map(assignmentRow)}</tbody></table></div>`)
    : emptyState('file', t('student.members.noSections'));
  setMain(html`
    <div><h1 class="page-title">${t('menu.estudiante.integrantes')}</h1>
      <p class="page-sub">${t('student.members.lead', { team: data.team.name })}</p></div>
    <div class="grid grid-4">${data.members.map((m) => memberCard(m, max))}</div>
    <form class="card" id="assign-form" novalidate style="overflow:hidden" aria-labelledby="asig">
      <div class="card-head">
        <div><h2 id="asig" style="font-size:18px;font-weight:800">${t('student.members.assignTitle')}${data.level ? ` · ${t('common.levelN', { n: data.level.position })}` : ''}</h2>
          <p class="muted" style="margin-top:4px">${t('student.members.assignNote')}</p></div>
        <button class="btn btn-primary" type="submit" ${safe(data.assignments.length ? '' : 'disabled')}>${icon('save', 18)}${t('student.members.saveAssign')}</button>
      </div>
      <div class="form-alert" style="padding:0 24px"></div>
      ${table}
    </form>`);
  const form = document.getElementById('assign-form');
  form.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-section]');
    const a = tr && data.assignments.find((x) => x.section_id === Number(tr.dataset.section));
    if (a) checkRow(form, a);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); saveAssignments(form, e.submitter); });
}

async function load() {
  data = await get('/student/members');
  render();
}

async function main() {
  await initLayout({ roles: ['estudiante'], active: 'integrantes' });
  try {
    await load();
  } catch (err) {
    setMain(html`<div><h1 class="page-title">${t('menu.estudiante.integrantes')}</h1></div>
      <div class="card">${emptyState(err.status === 404 ? 'users' : 'alert',
        err.status === 404 ? t('student.noTeam') : t('student.members.loadError'), err.message)}</div>`);
  }
}

main();
