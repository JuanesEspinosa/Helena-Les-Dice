// Vista 11 · Integrantes y asignación de secciones (RF-05, RF-08)
import { get, put } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, avatar, ago, pill, toast, showError, clearErrors, withBusy, emptyState } from '../core/ui.js';

const SAME_PERSON = 'El responsable y el revisor no pueden ser la misma persona.';
let data = null;

function memberCard(m, max) {
  const pct = max ? Math.round((m.contributions / max) * 100) : 0;
  return safe(html`<article class="card card-pad stack" style="gap:12px">
    <div class="row" style="flex-wrap:nowrap;gap:12px">${avatar(m.name, 'avatar-lg')}
      <div style="min-width:0"><h2 style="font-size:16px;font-weight:800">${m.name}</h2>
        <div class="small muted">${m.last_activity ? `Activo · ${ago(m.last_activity).toLowerCase()}` : 'Sin actividad todavía'}</div></div></div>
    <div class="row between" style="align-items:baseline"><span class="muted" style="font-weight:600">Aportes</span>
      <span style="font-size:22px;font-weight:800">${m.contributions}</span></div>
    <div class="progress" role="img" aria-label="${m.contributions} aportes, ${pct}% del integrante con más aportes"><span style="width:${pct}%"></span></div>
    <div class="row" style="gap:6px"><span class="tag">Redacta ${m.writes}</span><span class="tag">Revisa ${m.reviews}</span></div>
  </article>`);
}

const options = (selected) => [safe('<option value="">Sin asignar</option>'),
  ...data.members.map((m) => safe(html`<option value="${m.id}" ${safe(m.id === selected ? 'selected' : '')}>${m.name}</option>`))];

function assignmentRow(a) {
  const locked = a.status === 'aprobado';
  const dis = safe(locked ? 'disabled' : '');
  return safe(html`<tr style="vertical-align:top" data-section="${a.section_id}">
    <td style="padding-top:22px"><strong>${data.level.position}.${a.position} ${a.name}</strong>
      ${locked ? safe(html`<div class="small muted" style="margin-top:4px">${pill('aprobado')} No se puede reasignar</div>`) : ''}</td>
    <td><div class="field"><label class="sr-only" for="resp-${a.section_id}">Responsable de ${a.name}</label>
      <select class="select" id="resp-${a.section_id}" name="resp-${a.section_id}" ${dis}>${options(a.responsible_id)}</select></div></td>
    <td><div class="field"><label class="sr-only" for="rev-${a.section_id}">Revisor de ${a.name}</label>
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
    msg.innerHTML = html`${icon('alert', 16)}<span>${SAME_PERSON}</span>`;
  }
  return !same;
}

function collect(form) {
  const rows = [];
  for (const a of data.assignments.filter((x) => x.status !== 'aprobado')) {
    const resp = form[`resp-${a.section_id}`].value;
    const rev = form[`rev-${a.section_id}`].value;
    if (!resp || !rev) {
      showError(form, { field: !resp ? `resp-${a.section_id}` : `rev-${a.section_id}`, message: 'Elige un responsable y un revisor.' });
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
  if (rows.length === 0) { toast('No hay secciones que se puedan reasignar en este nivel.', 'error'); return; }
  await withBusy(btn, async () => {
    try {
      const { updated } = await put('/student/assignments', { assignments: rows });
      toast(updated ? `Se guardaron ${updated} ${updated === 1 ? 'asignación' : 'asignaciones'}.` : 'No había cambios por guardar.');
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
        <thead><tr><th scope="col">Sección</th><th scope="col">Responsable (redacta)</th><th scope="col">Revisor</th></tr></thead>
        <tbody>${data.assignments.map(assignmentRow)}</tbody></table></div>`)
    : emptyState('file', 'No hay secciones en este nivel');
  setMain(html`
    <div><h1 class="page-title">Integrantes</h1>
      <p class="page-sub">Quién hace qué en el ${data.team.name}, y cuánto ha aportado cada persona.</p></div>
    <div class="grid grid-4">${data.members.map((m) => memberCard(m, max))}</div>
    <form class="card" id="assign-form" novalidate style="overflow:hidden" aria-labelledby="asig">
      <div class="card-head">
        <div><h2 id="asig" style="font-size:18px;font-weight:800">Asignación de secciones${data.level ? ` · Nivel ${data.level.position}` : ''}</h2>
          <p class="muted" style="margin-top:4px">La docente puede consultar y corregir estas asignaciones.</p></div>
        <button class="btn btn-primary" type="submit" ${safe(data.assignments.length ? '' : 'disabled')}>${icon('save', 18)}Guardar asignaciones</button>
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
    setMain(html`<div><h1 class="page-title">Integrantes</h1></div>
      <div class="card">${emptyState(err.status === 404 ? 'users' : 'alert',
        err.status === 404 ? 'Todavía no perteneces a un equipo' : 'No pudimos cargar los integrantes', err.message)}</div>`);
  }
}

main();
