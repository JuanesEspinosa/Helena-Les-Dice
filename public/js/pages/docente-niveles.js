// Vista 14 · Configuración de niveles: orden, datos del nivel y sus secciones (RF-04)
import { get, post, put, del } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import { html, safe, icon, emptyState, loading, toast, clearErrors, showError, withBusy, confirmDialog } from '../core/ui.js';

/** Fragmento HTML ya escapado para anidar dentro de otra plantilla. */
const h = (...args) => safe(html(...args));

const state = { levels: [], selectedId: null, draft: null, keySeq: 0 };

await initLayout({ roles: ['docente'], active: 'niveles' });
setMain(html`
  <div class="page-head">
    <div>
      <h1 class="page-title">Configurar niveles</h1>
      <p class="page-sub">Define cuántos niveles tiene el documento, en qué orden van y qué secciones forman cada uno.</p>
    </div>
    <button type="button" class="btn btn-outline" id="add-level">${icon('plus', 18)}Agregar nivel</button>
  </div>
  <div class="split" id="levels-root">${loading()}</div>`);

document.getElementById('add-level').addEventListener('click', (e) => addLevel(e.currentTarget));
await load();

async function load(keepId) {
  try {
    const { levels } = await get('/teacher/levels');
    applyLevels(levels, keepId);
  } catch (err) {
    document.getElementById('levels-root').innerHTML = emptyState('alert', 'No se pudieron cargar los niveles', err.message).value;
  }
}

/** Guarda la lista recibida del servidor y vuelve a pintar todo. */
function applyLevels(levels, keepId = state.selectedId) {
  state.levels = levels;
  state.selectedId = levels.some((l) => l.id === keepId) ? keepId : (levels[0] ? levels[0].id : null);
  state.draft = draftFrom(selected());
  renderAll();
}

const selected = () => state.levels.find((l) => l.id === state.selectedId) || null;

function draftFrom(level) {
  if (!level) return null;
  return {
    id: level.id,
    name: level.name,
    description: level.description,
    points: level.points,
    position: level.position,
    sections: level.sections.map((s) => ({ key: ++state.keySeq, id: s.id, name: s.name, teams_started: s.teams_started })),
  };
}

const comparable = (d) => d && JSON.stringify([d.name, d.description, Number(d.points), Number(d.position), d.sections.map((s) => [s.id, s.name])]);
const isDirty = () => state.draft && comparable(state.draft) !== comparable(draftFrom(selected()));

function renderAll() {
  const root = document.getElementById('levels-root');
  if (state.levels.length === 0) {
    root.innerHTML = html`<div class="card grow">${emptyState('layers', 'Todavía no hay niveles', 'Agrega el primer nivel del documento con el botón "Agregar nivel".')}</div>`;
    return;
  }
  root.innerHTML = html`
    <section class="card card-pad side" aria-labelledby="orden" style="padding:12px;flex:1 1 320px">
      <h2 id="orden" class="card-title" style="margin:8px 8px 4px">Orden de los niveles</h2>
      <p class="muted small" style="margin:0 8px 12px">Arrastra desde el asa o usa las flechas para cambiar el orden.</p>
      <ol class="sortable" id="level-list">${state.levels.map(levelItem)}</ol>
    </section>
    <section class="card grow" aria-labelledby="edit" id="edit-card" style="flex:999 1 520px">${editPanel()}</section>`;
  wireLevelList();
  wireEditPanel();
}

// ---------- Lista de niveles ----------

function levelItem(l, i) {
  const n = state.levels.length;
  return h`
    <li class="lv-item" data-id="${l.id}" aria-current="${l.id === state.selectedId}">
      <span class="grip" title="Arrastrar para reordenar" aria-hidden="true">${icon('grip', 18)}</span>
      <button type="button" class="lv-item__select" data-select="${l.id}">
        <span class="lv-num">${l.position}</span>
        <span class="lv-item__text"><strong>${l.name}</strong><span class="muted">${l.sections.length} ${l.sections.length === 1 ? 'sección' : 'secciones'} · ${l.points} puntos${l.teams_started ? ` · ${l.teams_started} equipo(s) trabajando` : ''}</span></span>
      </button>
      <span class="move-btns">
        <button type="button" class="btn btn-sm" data-move="${l.id}" data-dir="-1" aria-label="Subir el nivel ${l.name}" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp', 16)}</button>
        <button type="button" class="btn btn-sm" data-move="${l.id}" data-dir="1" aria-label="Bajar el nivel ${l.name}" ${i === n - 1 ? 'disabled' : ''}>${icon('arrowDown', 16)}</button>
      </span>
    </li>`;
}

function wireLevelList() {
  const list = document.getElementById('level-list');
  list.addEventListener('click', async (e) => {
    const sel = e.target.closest('[data-select]');
    if (sel) return selectLevel(Number(sel.dataset.select));
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const ids = state.levels.map((l) => l.id);
      const from = ids.indexOf(Number(mv.dataset.move));
      await reorderLevels(moveItem(ids, from, from + Number(mv.dataset.dir)), Number(mv.dataset.move));
    }
  });
  makeSortable(list, async (from, to) => {
    const ids = state.levels.map((l) => l.id);
    await reorderLevels(moveItem(ids, from, to));
  });
}

async function selectLevel(id) {
  if (id === state.selectedId) return;
  if (isDirty()) {
    const ok = await confirmDialog({ title: 'Descartar cambios', message: 'Tienes cambios sin guardar en este nivel. ¿Quieres descartarlos?', confirmText: 'Descartar', danger: true });
    if (!ok) return;
  }
  state.selectedId = id;
  state.draft = draftFrom(selected());
  renderAll();
  document.querySelector(`[data-select="${id}"]`)?.focus();
}

/** Mensaje RF-04 cuando hay equipos trabajando en los niveles afectados. */
function startedWarning(levels) {
  const busy = levels.filter((l) => l.teams_started > 0);
  if (busy.length === 0) return null;
  const max = Math.max(...busy.map((l) => l.teams_started));
  return busy.length === 1
    ? `${max} ${max === 1 ? 'equipo ya está trabajando' : 'equipos ya están trabajando'} en el nivel "${busy[0].name}".`
    : `Hay equipos trabajando en ${busy.length} de los niveles que cambian de lugar (hasta ${max} por nivel).`;
}

async function reorderLevels(ids, focusId) {
  const before = state.levels.map((l) => l.id);
  if (ids.join() === before.join()) return;
  const moved = state.levels.filter((l) => before.indexOf(l.id) !== ids.indexOf(l.id));
  const warning = startedWarning(moved);
  if (warning) {
    const ok = await confirmDialog({ title: 'Cambiar el orden de los niveles', message: `${warning} Si cambias el orden, el cambio les llegará de inmediato.`, confirmText: 'Cambiar orden' });
    if (!ok) return;
  }
  try {
    const pending = state.draft && isDirty() ? { ...state.draft } : null;
    const { levels } = await put('/teacher/levels/order', { ids });
    applyLevels(levels);
    if (pending) { state.draft = { ...pending, position: selected().position }; renderAll(); }
    toast('Se actualizó el orden de los niveles.');
    if (focusId) document.querySelector(`[data-move="${focusId}"]`)?.focus();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function addLevel(button) {
  if (isDirty()) {
    const ok = await confirmDialog({ title: 'Descartar cambios', message: 'Tienes cambios sin guardar en el nivel actual. ¿Quieres descartarlos?', confirmText: 'Descartar', danger: true });
    if (!ok) return;
  }
  try {
    const { level } = await withBusy(button, () => post('/teacher/levels', { name: `Nivel ${state.levels.length + 1}`, description: '', points: 100 }));
    await load(level.id);
    toast('Se agregó el nivel al final. Ponle nombre y secciones.');
    document.querySelector('#level-form [name="name"]')?.select();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Panel de edición ----------

function editPanel() {
  const d = state.draft;
  const lv = selected();
  if (!d) return emptyState('layers', 'Elige un nivel', 'Selecciónalo en la lista para editarlo.');
  const code = (i) => `${lv.position}.${i + 1}`;
  return h`
    <form id="level-form" class="card-body stack" style="gap:18px;padding:24px" novalidate>
      <h2 id="edit" style="font-size:20px;font-weight:800">Editar nivel ${lv.position}</h2>
      ${lv.teams_started > 0 ? h`
        <div class="alert alert-warn" role="alert">${icon('warning', 20)}
          <div><strong>${lv.teams_started} ${lv.teams_started === 1 ? 'equipo ya está trabajando' : 'equipos ya están trabajando'} en este nivel.</strong> Si cambias sus secciones, el cambio les llegará de inmediato.</div>
        </div>` : ''}
      <div class="form-alert"></div>
      <div class="edit-grid">
        <div class="field span-2">
          <label class="label" for="n-name">Nombre del nivel</label>
          <input class="input" id="n-name" name="name" maxlength="120" value="${d.name}" required>
        </div>
        <div class="field">
          <label class="label" for="n-pos">Orden</label>
          <input class="input" id="n-pos" name="position" type="number" min="1" max="${state.levels.length}" step="1" value="${d.position}">
        </div>
        <div class="field span-2">
          <label class="label" for="n-desc">Descripción</label>
          <textarea class="textarea" id="n-desc" name="description" rows="3" maxlength="2000">${d.description}</textarea>
        </div>
        <div class="field">
          <label class="label" for="n-pts">Puntos al superarlo</label>
          <input class="input" id="n-pts" name="points" type="number" min="0" max="10000" step="10" value="${d.points}">
        </div>
      </div>
      <div class="stack" style="gap:10px">
        <div class="row between">
          <h3 style="font-size:16px;font-weight:800">Secciones del nivel</h3>
          <button type="button" class="btn btn-sm btn-add-soft" id="add-section">${icon('plus', 16)}Agregar sección</button>
        </div>
        <div class="field"><input type="hidden" name="sections"><div class="field-error"></div></div>
        ${d.sections.length === 0 ? h`<p class="muted">Este nivel todavía no tiene secciones. Un nivel sin secciones se da por superado.</p>` : ''}
        <ol class="sortable" id="sec-list">
          ${d.sections.map((s, i) => h`
            <li class="sec-item" data-key="${s.key}">
              <span class="grip" title="Arrastrar para reordenar" aria-hidden="true">${icon('grip', 18)}</span>
              <span class="sec-item__code">${code(i)}</span>
              <label class="sr-only" for="sec-${s.key}">Nombre de la sección ${code(i)}</label>
              <input class="input" id="sec-${s.key}" data-sec-name="${s.key}" maxlength="160" value="${s.name}" placeholder="Nombre de la sección">
              ${s.teams_started ? h`<span class="tag sec-item__used" title="Equipos con contenido en esta sección">${s.teams_started} eq.</span>` : ''}
              <span class="move-btns">
                <button type="button" class="btn btn-sm" data-sec-move="${s.key}" data-dir="-1" aria-label="Subir ${s.name || 'la sección'}" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp', 16)}</button>
                <button type="button" class="btn btn-sm" data-sec-move="${s.key}" data-dir="1" aria-label="Bajar ${s.name || 'la sección'}" ${i === d.sections.length - 1 ? 'disabled' : ''}>${icon('arrowDown', 16)}</button>
              </span>
              <button type="button" class="btn btn-icon btn-ghost btn-sm" style="border:0;width:36px" data-sec-remove="${s.key}" aria-label="Quitar sección ${s.name}"
                ${s.teams_started ? h`aria-disabled="true" title="${s.teams_started} equipo(s) ya tienen contenido en esta sección"` : ''}>${icon('trash', 18)}</button>
            </li>`)}
        </ol>
      </div>
      <div class="form-actions" style="padding-top:6px">
        <button type="submit" class="btn btn-primary">${icon('save', 18)}Guardar cambios</button>
        <button type="button" class="btn btn-outline" id="cancel-level">Cancelar</button>
        <button type="button" class="btn btn-danger-outline" id="delete-level" style="margin-left:auto" ${lv.teams_started ? safe('aria-disabled="true" title="Hay equipos trabajando en este nivel"') : ''}>${icon('trash', 18)}Eliminar nivel</button>
      </div>
    </form>`;
}

/** Copia los valores escritos en el formulario al borrador antes de volver a pintar. */
function syncDraft(form) {
  const d = state.draft;
  d.name = form.querySelector('[name="name"]').value;
  d.position = form.querySelector('[name="position"]').value;
  d.description = form.querySelector('[name="description"]').value;
  d.points = form.querySelector('[name="points"]').value;
  d.sections = d.sections.map((s) => ({ ...s, name: form.querySelector(`[data-sec-name="${s.key}"]`)?.value ?? s.name }));
}

function repaintEdit(focusSelector) {
  document.getElementById('edit-card').innerHTML = editPanel().value;
  wireSections();
  if (focusSelector) document.querySelector(focusSelector)?.focus();
}

function wireEditPanel() {
  const card = document.getElementById('edit-card');
  if (!card) return;
  card.addEventListener('click', onEditClick);
  card.addEventListener('submit', onSave);
  wireSections();
}

function wireSections() {
  const list = document.getElementById('sec-list');
  if (!list) return;
  makeSortable(list, (from, to) => {
    syncDraft(document.getElementById('level-form'));
    state.draft.sections = moveItem(state.draft.sections, from, to);
    repaintEdit();
  });
}

async function onEditClick(e) {
  const form = document.getElementById('level-form');
  if (!form) return;
  const d = state.draft;
  if (e.target.closest('#add-section')) {
    syncDraft(form);
    const key = ++state.keySeq;
    d.sections = [...d.sections, { key, id: null, name: '', teams_started: 0 }];
    repaintEdit(`[data-sec-name="${key}"]`);
    return;
  }
  const mv = e.target.closest('[data-sec-move]');
  if (mv) {
    syncDraft(form);
    const from = d.sections.findIndex((s) => s.key === Number(mv.dataset.secMove));
    d.sections = moveItem(d.sections, from, from + Number(mv.dataset.dir));
    repaintEdit(`[data-sec-move="${mv.dataset.secMove}"][data-dir="${mv.dataset.dir}"]`);
    return;
  }
  const rm = e.target.closest('[data-sec-remove]');
  if (rm) {
    const s = d.sections.find((x) => x.key === Number(rm.dataset.secRemove));
    if (s.teams_started) {
      toast(`No se puede quitar "${s.name}": ${s.teams_started} equipo(s) ya tienen contenido en ella.`, 'error');
      return;
    }
    syncDraft(form);
    d.sections = d.sections.filter((x) => x.key !== s.key);
    repaintEdit('#add-section');
    return;
  }
  if (e.target.closest('#cancel-level')) {
    state.draft = draftFrom(selected());
    repaintEdit();
    toast('Se descartaron los cambios.');
    return;
  }
  if (e.target.closest('#delete-level')) await deleteLevel();
}

function validate(form) {
  const d = state.draft;
  if (!d.name.trim()) return { field: 'name', message: 'El nombre del nivel es obligatorio.' };
  const pos = Number(d.position);
  if (!Number.isInteger(pos) || pos < 1 || pos > state.levels.length) return { field: 'position', message: `El orden debe ser un número entre 1 y ${state.levels.length}.` };
  const pts = Number(d.points);
  if (d.points === '' || !Number.isInteger(pts) || pts < 0 || pts > 10000) return { field: 'points', message: 'Los puntos deben ser un número entero entre 0 y 10000.' };
  const empty = d.sections.find((s) => !s.name.trim());
  if (empty) {
    form.querySelector(`[data-sec-name="${empty.key}"]`)?.focus();
    return { message: 'Cada sección necesita un nombre. Escríbelo o quita la sección vacía.' };
  }
  return null;
}

async function onSave(e) {
  e.preventDefault();
  const form = e.target;
  syncDraft(form);
  clearErrors(form);
  form.querySelector('.form-alert').innerHTML = '';
  const invalid = validate(form);
  if (invalid) { showError(form, invalid); return; }
  const lv = selected();
  const d = state.draft;
  if (lv.teams_started > 0) {
    const ok = await confirmDialog({
      title: 'Guardar cambios del nivel',
      message: `${lv.teams_started} ${lv.teams_started === 1 ? 'equipo ya está trabajando' : 'equipos ya están trabajando'} en este nivel. Si cambias sus secciones, el cambio les llegará de inmediato.`,
      confirmText: 'Guardar de todos modos',
    });
    if (!ok) return;
  }
  const button = form.querySelector('[type="submit"]');
  try {
    let { levels } = await withBusy(button, () => put(`/teacher/levels/${d.id}`, {
      name: d.name.trim(), description: d.description.trim(), points: Number(d.points),
      sections: d.sections.map((s) => ({ id: s.id, name: s.name.trim() })),
    }));
    const pos = Number(d.position);
    if (pos !== lv.position) {
      const ids = moveItem(levels.map((l) => l.id), levels.findIndex((l) => l.id === d.id), pos - 1);
      ({ levels } = await put('/teacher/levels/order', { ids }));
    }
    applyLevels(levels, d.id);
    toast('Se guardaron los cambios del nivel.');
  } catch (err) {
    showError(document.getElementById('level-form') || form, err);
  }
}

async function deleteLevel() {
  const lv = selected();
  if (lv.teams_started > 0) {
    toast(`No se puede eliminar: ${lv.teams_started} equipo(s) ya están trabajando en este nivel.`, 'error');
    return;
  }
  const ok = await confirmDialog({
    title: `Eliminar el nivel ${lv.position}`,
    message: `Se eliminará "${lv.name}" con sus ${lv.sections.length} secciones. Los niveles siguientes subirán un lugar.`,
    confirmText: 'Eliminar nivel',
    danger: true,
  });
  if (!ok) return;
  try {
    const { levels } = await del(`/teacher/levels/${lv.id}`);
    applyLevels(levels, null);
    toast('Se eliminó el nivel.');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- Utilidades de reordenamiento ----------

/** Devuelve una copia de la lista con el elemento movido de `from` a `to`. */
function moveItem(list, from, to) {
  if (from < 0 || to < 0 || to >= list.length || from === to) return list.slice();
  const copy = list.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/**
 * Arrastrar y soltar con HTML5 sobre los <li> de una lista. El arrastre empieza solo desde el asa
 * (.grip) para no interferir con los campos de texto. Llama a onMove(desde, hasta).
 */
function makeSortable(list, onMove) {
  let fromIndex = -1;
  const items = () => [...list.children];
  const clearMarks = () => items().forEach((li) => li.classList.remove('drop-before', 'drop-after', 'dragging'));
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('li');
    if (li && e.target.closest('.grip')) li.draggable = true;
  });
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest('li');
    fromIndex = items().indexOf(li);
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(fromIndex));
  });
  list.addEventListener('dragover', (e) => {
    const li = e.target.closest('li');
    if (fromIndex < 0 || !li) return;
    e.preventDefault();
    const after = e.clientY > li.getBoundingClientRect().top + li.offsetHeight / 2;
    items().forEach((x) => x.classList.remove('drop-before', 'drop-after'));
    li.classList.add(after ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('drop', (e) => {
    const li = e.target.closest('li');
    if (fromIndex < 0 || !li) return;
    e.preventDefault();
    let to = items().indexOf(li);
    if (li.classList.contains('drop-after')) to += 1;
    if (to > fromIndex) to -= 1;
    const from = fromIndex;
    fromIndex = -1;
    clearMarks();
    onMove(from, to);
  });
  list.addEventListener('dragend', (e) => {
    const li = e.target.closest('li');
    if (li) li.draggable = false;
    fromIndex = -1;
    clearMarks();
  });
}
