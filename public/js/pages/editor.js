// Vista 03 · Editor de sección: la usan estudiantes y docentes (RF-06, RF-07, RF-10)
import { get, put, post } from '../core/api.js';
import { initLayout, setMain } from '../core/layout.js';
import {
  html, safe, esc, icon, pill, avatar, ago, fmtDateTime, toast, showError, clearErrors,
  withBusy, confirmDialog, emptyState, param,
} from '../core/ui.js';

const AUTOSAVE_MS = 2 * 60 * 1000;
const CLOCK_MS = 30 * 1000;
const STATUS_TEXT = { redaccion: 'En redacción', revision: 'En revisión', aprobado: 'Aprobado', devuelto: 'Devuelto con observaciones' };
const KIND_TEXT = { manual: 'Guardado manual', automatico: 'Guardado automático', enviada: 'Enviada a revisión' };
const ROLE_TEXT = { docente: 'Docente', administrador: 'Administrador' };

const state = {
  user: null, id: null, data: null,
  saved: '', dirty: false, saving: false, lastSave: null, lastSaveAuto: false, failed: false,
  quote: '', selection: '',
};

// ---------- Contenido del editor ----------
const area = () => document.getElementById('editor');

/** HTML del editor sin los resaltados de citas (solo existen en la vista, no se guardan). */
function editorContent() {
  const clone = area().cloneNode(true);
  clone.querySelectorAll('mark.highlight').forEach((m) => m.replaceWith(...m.childNodes));
  return clone.innerHTML;
}

function wordCount() {
  const text = area().innerText.trim();
  const n = text ? text.split(/\s+/).length : 0;
  document.getElementById('words').textContent = `${n} ${n === 1 ? 'palabra' : 'palabras'}`;
}

function markDirty() {
  state.dirty = editorContent() !== state.saved;
  wordCount();
  renderSaveStatus();
}

/** Envuelve en <mark> el primer fragmento del texto que coincide con la cita de cada comentario pendiente. */
function highlightQuotes() {
  const el = area();
  el.querySelectorAll('mark.highlight').forEach((m) => m.replaceWith(...m.childNodes));
  el.normalize();
  state.data.comments.filter((c) => c.quote && !c.resolved).forEach((c) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.nodeValue.indexOf(c.quote);
      if (at < 0 || node.parentElement.closest('mark')) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + c.quote.length);
      const mark = document.createElement('mark');
      mark.className = 'highlight';
      mark.dataset.comment = String(c.id);
      mark.title = 'Fragmento comentado';
      range.surroundContents(mark);
      break;
    }
  });
}

// ---------- Guardado (RF-06) ----------
function renderSaveStatus() {
  const box = document.getElementById('save-status');
  if (!box) return;
  let tone = 'var(--st-ok)'; let ic = 'checkCircle'; let text;
  if (state.saving) { tone = 'var(--text-2)'; ic = 'clock'; text = 'Guardando…'; }
  else if (state.failed) { tone = 'var(--danger)'; ic = 'alert'; text = 'No se pudo guardar. Tus cambios siguen aquí.'; }
  else if (state.dirty) { tone = 'var(--st-draft)'; ic = 'edit'; text = 'Cambios sin guardar'; }
  else if (state.lastSave) text = `${state.lastSaveAuto ? 'Guardado automáticamente' : 'Guardado'} · ${ago(state.lastSave).toLowerCase()}`;
  else text = 'Se guarda solo cada 2 minutos';
  box.style.color = tone;
  box.innerHTML = html`${icon(ic, 18)}<span>${text}</span>`;
}

async function save(auto) {
  if (state.saving || !state.data.permissions.canEdit) return true;
  const content = editorContent();
  state.saving = true;
  renderSaveStatus();
  try {
    const res = await put(`/sections/${state.id}`, { content, auto }, { background: auto });
    state.saved = content;
    state.failed = false;
    if (res.saved || !auto) { state.lastSave = res.updated_at || new Date(); state.lastSaveAuto = auto; }
    if (state.data.section.status === 'devuelto' && res.saved) updateStatus('redaccion');
    return true;
  } catch (err) {
    // El texto se queda en el editor: nunca se pierde por un error al guardar (RF-06)
    state.failed = true;
    toast(`${auto ? 'Guardado automático fallido: ' : ''}${err.message}`, 'error');
    return false;
  } finally {
    state.saving = false;
    state.dirty = editorContent() !== state.saved;
    renderSaveStatus();
  }
}

function updateStatus(status) {
  state.data.section.status = status;
  document.getElementById('status-pill').innerHTML = pill(status, STATUS_TEXT[status]).value;
}

async function submitForReview(btn) {
  const ok = await confirmDialog({
    title: 'Enviar a revisión',
    message: `La sección pasará al revisor (${state.data.section.reviewer.name}) y no podrás editarla mientras la revisan.`,
    confirmText: 'Enviar a revisión',
  });
  if (!ok) return;
  await withBusy(btn, async () => {
    try {
      await post(`/sections/${state.id}/submit`, { content: editorContent() });
      state.dirty = false;
      toast('La sección se envió a revisión.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ---------- Barra de formato ----------
const TOOLS = [
  ['undo', 'Deshacer', 'undo'], ['redo', 'Rehacer', 'redo'], 'sep', 'block',
  ['bold', 'Negrita', 'bold'], ['italic', 'Cursiva', 'italic'], ['underline', 'Subrayado', 'underline'], 'sep',
  ['insertUnorderedList', 'Lista con viñetas', 'list'], ['insertOrderedList', 'Lista numerada', 'listOrdered'],
  ['table', 'Insertar tabla', 'table'], ['link', 'Insertar enlace', 'link'],
];

function toolbar(editable) {
  const items = editable ? TOOLS.map((t) => {
    if (t === 'sep') return safe('<span class="sep" aria-hidden="true"></span>');
    if (t === 'block') {
      return safe(html`<label class="sr-only" for="block-style">Estilo de párrafo</label>
        <select id="block-style" style="border:1px solid var(--line);background:#fff;font-weight:600">
          <option value="p">Párrafo</option><option value="h2">Título</option><option value="h3">Subtítulo</option></select>`);
    }
    return safe(html`<button type="button" data-cmd="${t[0]}" aria-label="${t[1]}" title="${t[1]}">${icon(t[2], 18)}</button>`);
  }) : [safe(html`<span class="row small muted">${icon('eye', 16)}Modo lectura</span>`)];
  return safe(html`<div class="toolbar" role="toolbar" aria-label="Formato de texto">${items}
    <span id="words" class="small muted" style="margin-left:auto" aria-live="polite"></span></div>`);
}

function runCommand(cmd) {
  area().focus();
  if (cmd === 'table') {
    document.execCommand('insertHTML', false,
      '<table><tbody><tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p><br></p>');
  } else if (cmd === 'link') {
    const url = window.prompt('Dirección del enlace (https://…)', 'https://');
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) { toast('El enlace debe empezar por http://, https:// o mailto:', 'error'); return; }
    document.execCommand('createLink', false, url.trim());
  } else {
    document.execCommand(cmd, false, null);
  }
  markDirty();
}

function wireEditor() {
  const el = area();
  el.addEventListener('input', markDirty);
  document.querySelectorAll('[data-cmd]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // conserva la selección del texto
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });
  const block = document.getElementById('block-style');
  if (block) {
    block.addEventListener('change', () => {
      area().focus();
      document.execCommand('formatBlock', false, block.value);
      markDirty();
    });
  }
  document.getElementById('save-btn')?.addEventListener('click', (e) => withBusy(e.currentTarget, async () => {
    if (await save(false)) toast('Borrador guardado.');
  }));
  document.getElementById('submit-btn')?.addEventListener('click', (e) => submitForReview(e.currentTarget));
}

// ---------- Comentarios (RF-10) ----------
function authorLabel(c) {
  const s = state.data.section;
  if (c.author_role !== 'estudiante') return ROLE_TEXT[c.author_role] || c.author_role;
  if (s.reviewer && c.author_id === s.reviewer.id) return 'Revisor';
  if (s.responsible && c.author_id === s.responsible.id) return 'Responsable';
  return 'Integrante';
}

function replyItem(r) {
  return safe(html`<div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:8px;padding-left:12px;border-left:2px solid var(--line)">
    ${avatar(r.author_name, 'avatar-sm avatar-gray')}
    <div class="stack" style="gap:2px;min-width:0"><div class="small"><strong>${r.author_name}</strong> · ${authorLabel(r)} · <span class="muted">${ago(r.created_at)}</span></div>
      <p style="line-height:1.55;overflow-wrap:anywhere">${r.body}</p></div>
  </div>`);
}

function commentCard(c) {
  const p = state.data.permissions;
  const cls = c.resolved ? 'note' : (c.author_role === 'docente' ? 'note note--warm' : 'note note--blue');
  const actions = [];
  if (p.canComment) actions.push(safe(html`<button type="button" class="btn btn-outline btn-sm" data-reply="${c.id}">${icon('reply', 16)}Responder</button>`));
  if (p.canResolve && !c.resolved) actions.push(safe(html`<button type="button" class="btn btn-sm" style="background:var(--green-soft);color:var(--green-dark)" data-resolve="${c.id}">${icon('check', 16)}Marcar como atendido</button>`));
  return safe(html`<article class="${cls}" style="gap:10px" data-thread="${c.id}">
    <div class="row" style="flex-wrap:nowrap">${avatar(c.author_name, c.author_role === 'docente' ? '' : 'avatar-gray')}
      <div style="min-width:0"><div style="font-weight:700">${c.author_name} · ${authorLabel(c)}</div><div class="small muted">${fmtDateTime(c.created_at)}</div></div></div>
    ${c.quote ? safe(html`<button type="button" class="small muted" data-goto="${c.id}" style="background:none;border:0;padding:0;text-align:left;cursor:pointer;font-style:italic;border-radius:4px">Sobre: “${c.quote.length > 90 ? `${c.quote.slice(0, 90)}…` : c.quote}”</button>`) : ''}
    <p style="line-height:1.55;overflow-wrap:anywhere">${c.body}</p>
    ${c.replies.length ? safe(html`<div class="stack" style="gap:8px">${c.replies.map(replyItem)}</div>`) : ''}
    ${c.resolved ? safe(html`<div class="row small" style="color:var(--st-ok);font-weight:600">${icon('checkCircle', 16)}Atendido${c.resolved_by_name ? ` por ${c.resolved_by_name}` : ''}</div>`) : ''}
    ${actions.length ? safe(html`<div class="row" style="gap:8px">${actions}</div>`) : ''}
    <form class="reply-form stack" data-parent="${c.id}" hidden style="gap:8px">
      <div class="field"><label class="sr-only" for="reply-${c.id}">Tu respuesta</label>
        <textarea class="textarea" id="reply-${c.id}" name="body" rows="2" placeholder="Escribe tu respuesta…" maxlength="2000"></textarea></div>
      <div class="row" style="gap:8px"><button class="btn btn-primary btn-sm" type="submit">Responder</button>
        <button class="btn btn-ghost btn-sm" type="button" data-cancel>Cancelar</button></div>
    </form>
  </article>`);
}

function commentsPanel() {
  const { comments, permissions: p } = state.data;
  const pending = comments.filter((c) => !c.resolved).length;
  const list = comments.length ? comments.map(commentCard) : [emptyState('message', 'Sin comentarios', 'Aún nadie ha comentado esta sección.')];
  const form = p.canComment ? safe(html`<form id="comment-form" class="stack" style="gap:8px" novalidate>
      <div id="quote-offer" class="small" hidden></div>
      <div id="quote-chip" class="note small" hidden></div>
      <div class="field"><label class="label" for="new-comment">Escribir un comentario</label>
        <textarea class="textarea" id="new-comment" name="body" rows="3" placeholder="Escribe aquí…" maxlength="2000"></textarea>
        <span class="hint">Selecciona texto en el editor para citarlo en tu comentario.</span></div>
      <div><button class="btn btn-primary btn-sm" type="submit">${icon('send', 16)}Comentar</button></div>
    </form>`) : '';
  return html`<div class="row between"><h2 id="coment" class="card-title">Comentarios</h2>
      ${pending ? pill('devuelto', `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}`) : ''}</div>
    ${list}${form}`;
}

function renderComments() {
  document.getElementById('comments').innerHTML = commentsPanel();
  wireComments();
  highlightQuotes();
}

async function refreshComments() {
  const fresh = await get(`/sections/${state.id}`);
  state.data.comments = fresh.comments;
  renderComments();
}

async function sendComment(form, payload) {
  clearErrors(form);
  const body = form.body.value.trim();
  if (!body) { showError(form, { field: 'body', message: 'El comentario es obligatorio.' }); return; }
  await withBusy(form.querySelector('[type=submit]'), async () => {
    try {
      await post(`/sections/${state.id}/comments`, { body, ...payload });
      state.quote = '';
      toast(payload.parent_id ? 'Respuesta publicada.' : 'Comentario publicado.');
      await refreshComments();
    } catch (err) {
      showError(form, err);
    }
  });
}

async function resolveComment(btn) {
  await withBusy(btn, async () => {
    try {
      await post(`/sections/comments/${btn.dataset.resolve}/resolve`);
      toast('Comentario marcado como atendido.');
      await refreshComments();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function renderQuote() {
  const chip = document.getElementById('quote-chip');
  const offer = document.getElementById('quote-offer');
  if (!chip) return;
  chip.hidden = !state.quote;
  chip.innerHTML = state.quote ? html`<span><em>Citando:</em> “${state.quote.slice(0, 160)}”</span>
    <button type="button" class="btn btn-ghost btn-sm" id="quote-clear" style="align-self:flex-start">${icon('x', 14)}Quitar cita</button>` : '';
  chip.querySelector('#quote-clear')?.addEventListener('click', () => { state.quote = ''; renderQuote(); });
  offer.hidden = !state.selection || state.selection === state.quote;
  offer.innerHTML = state.selection ? html`<button type="button" class="btn btn-outline btn-sm" id="quote-use">${icon('message', 14)}Citar el texto seleccionado</button>` : '';
  offer.querySelector('#quote-use')?.addEventListener('click', () => {
    state.quote = state.selection;
    renderQuote();
    document.getElementById('new-comment').focus();
  });
}

function wireComments() {
  const box = document.getElementById('comments');
  const form = document.getElementById('comment-form');
  form?.addEventListener('submit', (e) => { e.preventDefault(); sendComment(form, { quote: state.quote || undefined }); });
  box.querySelectorAll('.reply-form').forEach((f) => {
    f.addEventListener('submit', (e) => { e.preventDefault(); sendComment(f, { parent_id: Number(f.dataset.parent) }); });
    f.querySelector('[data-cancel]').addEventListener('click', () => { f.hidden = true; });
  });
  box.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => {
    const f = box.querySelector(`.reply-form[data-parent="${b.dataset.reply}"]`);
    f.hidden = false;
    f.querySelector('textarea').focus();
  }));
  box.querySelectorAll('[data-resolve]').forEach((b) => b.addEventListener('click', () => resolveComment(b)));
  box.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
    const mark = area().querySelector(`mark[data-comment="${b.dataset.goto}"]`);
    if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else toast('El fragmento citado ya no aparece en el texto actual.', 'error');
  }));
  renderQuote();
}

function watchSelection() {
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    const el = area();
    if (!el || !sel || sel.rangeCount === 0) return;
    const inside = el.contains(sel.anchorNode) && el.contains(sel.focusNode);
    if (!inside) return; // al pulsar el botón de citar se pierde la selección: se conserva la última
    const text = sel.toString().trim().replace(/\s+/g, ' ');
    if (text === state.selection) return;
    state.selection = text.slice(0, 500);
    renderQuote();
  });
}

// ---------- Revisión (RF-07) ----------
function reviewPanel() {
  if (!state.data.permissions.canReview) return '';
  return safe(html`<section class="card card-pad" aria-labelledby="rev-title">
    <form id="review-form" class="stack" novalidate>
      <h2 id="rev-title" class="card-title">${icon('checkCircle', 18)}Revisar sección</h2>
      <div class="field"><label class="label" for="observation">Observación</label>
        <textarea class="textarea" id="observation" name="observation" rows="3" maxlength="5000" placeholder="Qué está bien y qué deben corregir…"></textarea>
        <span class="hint">Para devolver la sección la observación es obligatoria.</span></div>
      <div class="form-actions">
        <button class="btn btn-primary" type="submit" data-decision="aprobar">${icon('check', 18)}Aprobar</button>
        <button class="btn btn-danger-outline" type="submit" data-decision="devolver">${icon('reply', 18)}Devolver con observaciones</button>
      </div>
    </form></section>`);
}

function wireReview() {
  const form = document.getElementById('review-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const decision = btn.dataset.decision;
    const observation = form.observation.value.trim();
    clearErrors(form);
    if (decision === 'devolver' && !observation) {
      showError(form, { field: 'observation', message: 'Escribe una observación para devolver la sección.' });
      return;
    }
    await withBusy(btn, async () => {
      try {
        await post(`/sections/${state.id}/review`, { decision, observation });
        toast(decision === 'aprobar' ? 'Sección aprobada.' : 'Sección devuelta con observaciones.');
        await load();
      } catch (err) {
        showError(form, err);
      }
    });
  });
}

// ---------- Estructura de la página ----------
function personChip(label, p) {
  const me = p && p.id === state.user.id ? ' (tú)' : '';
  return safe(html`<div class="row card" style="gap:8px;padding:6px 12px 6px 6px;border-radius:999px;box-shadow:none">
    ${p ? avatar(p.name, `avatar-sm ${label === 'Revisor' ? 'avatar-gray' : ''}`) : avatar('?', 'avatar-sm avatar-gray')}
    <span><span class="muted">${label}:</span> <strong>${p ? p.name + me : 'Sin asignar'}</strong></span></div>`);
}

function readNotice() {
  const { section: s, permissions: p } = state.data;
  if (p.canEdit) return '';
  let msg;
  if (s.locked) msg = 'Este nivel todavía está bloqueado. Se podrá editar cuando aprueben todas las secciones del nivel anterior.';
  else if (s.status === 'revision') msg = 'La sección está en revisión. Nadie puede editarla hasta que la revisen.';
  else if (s.status === 'aprobado') msg = 'La sección ya fue aprobada y quedó cerrada.';
  else msg = 'Solo el responsable de la sección puede editarla. Tú la ves en modo lectura.';
  return safe(html`<div class="alert ${s.locked ? 'alert-warn' : 'alert-info'}" role="note">${icon(s.locked ? 'lock' : 'info', 20)}<div>${msg}</div></div>`);
}

function versionsPanel() {
  const { versions } = state.data;
  const isStudent = state.user.role === 'estudiante';
  const items = versions.length
    ? safe(html`<ol class="stack" style="list-style:none;margin:0;padding:0;gap:10px">${versions.map((v) => safe(html`<li class="row between" style="flex-wrap:nowrap">
        <span><strong>v${v.number}</strong> · ${v.kind === 'enviada' ? 'Enviada a revisión' : v.author_name}<span class="sr-only"> (${KIND_TEXT[v.kind]})</span></span>
        <span class="muted small" style="white-space:nowrap">${ago(v.created_at)}</span></li>`))}</ol>`)
    : safe(html`<p class="muted">Todavía no hay versiones guardadas.</p>`);
  return safe(html`<section class="card card-pad stack" aria-labelledby="vers">
    <div class="row between"><h2 id="vers" class="card-title">Versiones</h2>
      ${isStudent ? safe(html`<a href="/estudiante/historial.html?section=${state.id}" style="font-weight:700">Ver todas</a>`) : ''}</div>
    ${items}</section>`);
}

function header() {
  const { section: s, permissions: p } = state.data;
  const isStudent = state.user.role === 'estudiante';
  const crumbs = isStudent
    ? safe(html`<a href="/estudiante/tablero.html">Tablero de niveles</a>`)
    : safe(html`<a href="/docente/panel.html">Panel de seguimiento</a><span aria-hidden="true">/</span><a href="/docente/equipo.html?id=${s.team.id}">${s.team.name}</a>`);
  const submitAttrs = p.canSubmit ? '' : 'disabled title="Asignen un revisor antes de enviar la sección a revisión."';
  const actions = p.canEdit ? safe(html`<span id="save-status" class="row" role="status" aria-live="polite" style="gap:6px;font-weight:600"></span>
      <button class="btn btn-outline" type="button" id="save-btn">${icon('save', 18)}Guardar borrador</button>
      <button class="btn btn-primary" type="button" id="submit-btn" ${safe(submitAttrs)}>${icon('send', 18)}Enviar a revisión</button>`) : '';
  return safe(html`<div>
      <nav class="crumbs" aria-label="Ruta">${crumbs}<span aria-hidden="true">/</span>
        <span>Nivel ${s.level.position} · ${s.level.name}</span><span aria-hidden="true">/</span><span style="color:var(--text)" aria-current="page">${s.name}</span></nav>
    </div>
    <div class="page-head" style="align-items:flex-start">
      <div class="stack" style="gap:10px">
        <div class="row" style="gap:12px"><h1 class="page-title">${s.level.position}.${s.position} ${s.name}</h1>
          <span id="status-pill">${pill(s.status, STATUS_TEXT[s.status])}</span></div>
        <div class="row">${personChip('Responsable', s.responsible)}${personChip('Revisor', s.reviewer)}</div>
      </div>
      <div class="row">${actions}</div>
    </div>`);
}

function render() {
  const { section: s, permissions: p } = state.data;
  document.title = `${s.name} · Helena les dice`;
  setMain(html`${header()}${readNotice()}
    <div class="split">
      <section class="card grow" aria-label="Editor" style="overflow:hidden">
        ${toolbar(p.canEdit)}
        <div id="editor" class="editor-area" contenteditable="${p.canEdit ? 'true' : 'false'}" role="textbox" aria-multiline="true"
          aria-label="Contenido de ${s.name}" ${safe(p.canEdit ? '' : 'aria-readonly="true"')}
          data-placeholder="${p.canEdit ? 'Empieza a redactar la sección…' : 'Esta sección todavía no tiene contenido.'}">${safe(s.content)}</div>
      </section>
      <aside class="side">
        ${reviewPanel()}
        <section class="card card-pad stack" id="comments" aria-labelledby="coment"></section>
        ${versionsPanel()}
      </aside>
    </div>`);
  state.saved = editorContent();
  state.dirty = false;
  state.failed = false;
  state.lastSave = null;
  wireEditor();
  wireReview();
  renderComments();
  wordCount();
  renderSaveStatus();
}

async function load() {
  try {
    state.data = await get(`/sections/${state.id}`);
    render();
  } catch (err) {
    setMain(html`<div class="card">${emptyState('alert', 'No se pudo abrir la sección', err.message,
      html`<a class="btn btn-outline" href="${state.user.role === 'estudiante' ? '/estudiante/tablero.html' : '/docente/panel.html'}">${icon('arrowLeft', 18)}Volver</a>`)}</div>`);
  }
}

async function main() {
  const { user } = await initLayout({});
  state.user = user;
  // Marca la opción del menú que corresponde al rol (la página es compartida)
  const activeHref = user.role === 'estudiante' ? '/estudiante/tablero.html' : '/docente/panel.html';
  document.querySelector(`.nav-link[href="${esc(activeHref)}"]`)?.setAttribute('aria-current', 'page');
  state.id = Number(param('id'));
  if (!Number.isInteger(state.id) || state.id <= 0) {
    setMain(html`<div class="card">${emptyState('file', 'Falta indicar la sección', 'Abre la sección desde el tablero de niveles.')}</div>`);
    return;
  }
  await load();
  watchSelection();
  setInterval(() => { if (state.dirty && state.data?.permissions.canEdit) save(true); }, AUTOSAVE_MS);
  setInterval(renderSaveStatus, CLOCK_MS);
  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

main();
