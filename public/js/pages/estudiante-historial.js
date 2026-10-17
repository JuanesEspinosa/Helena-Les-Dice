// Vista 12 · Historial de versiones de una sección (RF-06)
import { get } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, ago, fmtDateTime, emptyState, loading, param } from '../core/ui.js';

const KIND_TEXT = { manual: 'Guardado manual', automatico: 'Guardado automático', enviada: 'Enviada a revisión' };
const state = { sections: [], sectionId: null, versions: [], selected: null };

const sectionLabel = (s) => `${s.level_position}.${s.position} ${s.name}`;

function versionButton(v) {
  const on = v.number === state.selected;
  const style = on ? 'background:var(--green-soft);border-color:var(--green)' : 'background:var(--surface);border-color:transparent';
  return safe(html`<li><button type="button" class="btn" data-version="${v.number}" aria-pressed="${on ? 'true' : 'false'}"
      style="width:100%;flex-direction:column;align-items:flex-start;gap:4px;padding:12px 14px;min-height:0;height:auto;border-width:2px;text-align:left;white-space:normal;font-weight:400;${style}">
    <span class="row between" style="width:100%;flex-wrap:nowrap"><strong>Versión ${v.number}</strong>
      <span class="muted small" style="font-weight:600;white-space:nowrap">${ago(v.created_at)}</span></span>
    <span style="color:#3E4A45">${v.author_name} · ${v.number === 1 ? 'Primer borrador' : KIND_TEXT[v.kind]}</span>
  </button></li>`);
}

function versionList() {
  const n = state.versions.length;
  const body = n
    ? safe(html`<ol class="stack" style="list-style:none;margin:0;padding:0;gap:4px">${state.versions.map(versionButton)}</ol>`)
    : emptyState('history', 'Sin versiones', 'Esta sección todavía no se ha guardado.');
  return safe(html`<h2 id="lista" style="margin:8px 8px 12px;font-size:16px;font-weight:800">${n} ${n === 1 ? 'versión' : 'versiones'}</h2>${body}`);
}

/** Texto de la comparación: lo agregado en verde y lo eliminado en rojo tachado. */
function diffHtml(parts) {
  return parts.map((p) => {
    if (p.added) return safe(html`<ins class="diff-add" style="text-decoration:none">${p.value}</ins>`);
    if (p.removed) return safe(html`<del class="diff-del">${p.value}</del>`);
    return p.value;
  });
}

async function showDiff() {
  const box = document.getElementById('compare');
  if (!state.selected) {
    box.innerHTML = html`${emptyState('history', 'Elige una versión', 'Selecciona una versión de la lista para ver qué cambió.')}`;
    return;
  }
  box.innerHTML = loading().value;
  try {
    const d = await get(`/sections/${state.sectionId}/versions/${state.selected}/diff`);
    const v = d.version;
    const title = d.previous ? `Versión ${v.number} comparada con la versión ${d.previous.number}` : `Versión ${v.number} · primera versión`;
    const changed = d.diff.some((p) => p.added || p.removed);
    box.innerHTML = html`<div class="card-head">
        <div><h2 id="ver" style="font-size:18px;font-weight:800">${title}</h2>
          <div class="muted" style="margin-top:2px">${v.author_name} · ${fmtDateTime(v.created_at)} · ${KIND_TEXT[v.kind]}</div></div>
        <div class="row small" style="gap:12px;font-weight:600">
          <span class="row" style="gap:6px"><span class="diff-add" style="display:inline-block;width:14px;height:14px"></span>Agregado</span>
          <span class="row" style="gap:6px"><span class="diff-del" style="display:inline-block;width:14px;height:14px"></span>Eliminado</span></div>
      </div>
      <article class="editor-area" style="min-height:240px;white-space:pre-wrap;max-width:820px">${d.diff.length
        ? diffHtml(d.diff) : safe(html`<span class="muted">Esta versión no tiene texto.</span>`)}</article>
      ${changed || !d.previous ? '' : safe(html`<div class="alert alert-info" style="margin:0 24px 16px">${icon('info', 18)}<div>No hay cambios de texto frente a la versión anterior (pudo cambiar solo el formato).</div></div>`)}`;
  } catch (err) {
    box.innerHTML = html`${emptyState('alert', 'No se pudo cargar la comparación', err.message)}`;
  }
}

async function loadSection() {
  const list = document.getElementById('versions');
  list.innerHTML = loading().value;
  try {
    const d = await get(`/sections/${state.sectionId}/versions`);
    state.versions = d.versions;
    state.selected = d.versions.length ? d.versions[0].number : null;
  } catch (err) {
    state.versions = [];
    state.selected = null;
    list.innerHTML = html`${emptyState('alert', 'No se pudo cargar el historial', err.message)}`;
    return;
  }
  list.innerHTML = versionList().value;
  await showDiff();
}

function render() {
  setMain(html`
    <div class="page-head">
      <div><h1 class="page-title">Historial de versiones</h1>
        <p class="page-sub">Cada guardado crea una versión con su autor y su fecha.</p></div>
      <div class="field" style="min-width:min(320px,100%)"><label class="label" for="sec">Sección</label>
        <select class="select" id="sec" style="font-weight:600">${state.sections.map((s) => safe(html`<option value="${s.id}"
          ${safe(s.id === state.sectionId ? 'selected' : '')}>${sectionLabel(s)}</option>`))}</select></div>
    </div>
    <div class="split">
      <section class="card side" id="versions" aria-labelledby="lista" style="padding:12px;gap:0"></section>
      <section class="card grow" aria-labelledby="ver" style="overflow:hidden">
        <div id="compare" aria-live="polite"></div>
        <div class="row" style="padding:14px 24px;background:var(--bg);border-top:1px solid var(--line-soft);color:#3E4A45">
          ${icon('lock', 18)}Solo lectura. Las versiones guardadas no se pueden modificar.</div>
      </section>
    </div>`);
  document.getElementById('sec').addEventListener('change', (e) => {
    state.sectionId = Number(e.target.value);
    history.replaceState(null, '', `?section=${state.sectionId}`);
    loadSection();
  });
  document.getElementById('versions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-version]');
    if (!b) return;
    state.selected = Number(b.dataset.version);
    document.getElementById('versions').innerHTML = versionList().value;
    showDiff();
  });
}

async function main() {
  await initLayout({ roles: ['estudiante'], active: 'historial' });
  try {
    state.sections = (await get('/student/history-sections')).sections;
  } catch (err) {
    setMain(html`<div><h1 class="page-title">Historial de versiones</h1></div>
      <div class="card">${emptyState(err.status === 404 ? 'users' : 'alert',
        err.status === 404 ? 'Todavía no perteneces a un equipo' : 'No pudimos cargar el historial', err.message)}</div>`);
    return;
  }
  if (!state.sections.length) {
    setMain(html`<div><h1 class="page-title">Historial de versiones</h1></div>
      <div class="card">${emptyState('file', 'Tu equipo aún no tiene secciones')}</div>`);
    return;
  }
  const wanted = Number(param('section'));
  const pre = state.sections.find((s) => s.id === wanted)
    || state.sections.filter((s) => s.versions > 0).pop() || state.sections[0];
  state.sectionId = pre.id;
  render();
  await loadSection();
}

main();
