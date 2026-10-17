// Vista 10 · Notificaciones (RF-12): avisos de revisiones, comentarios, niveles e insignias
import { get, post } from '../core/api.js';
import { html, safe, icon, ago, toast, withBusy, emptyState, loading } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** Ícono y texto accesible por tipo de aviso; el color sale de .notif__icon--<tipo>. */
const TYPES = {
  devuelta: { icon: 'undo', label: 'Sección devuelta' },
  comentario: { icon: 'message', label: 'Comentario nuevo' },
  aprobada: { icon: 'checkCircle', label: 'Sección aprobada' },
  nivel: { icon: 'layers', label: 'Nivel desbloqueado' },
  insignia: { icon: 'medal', label: 'Insignia ganada' },
  revision: { icon: 'eye', label: 'Sección en revisión' },
};

const state = { filter: 'all', items: [], unread: 0 };

/** Solo se navega a rutas internas de la app ("/..."), nunca a otro dominio. */
const safeLink = (link) => (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : '');

const changed = () => window.dispatchEvent(new Event('notifications:changed'));

/** Agrupa en Hoy, Esta semana (últimos 7 días) y Anteriores. */
function groupByDate(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = new Date(today.getTime() - (WEEK_DAYS - 1) * DAY_MS);
  const groups = [
    { title: 'Hoy', items: [] },
    { title: 'Esta semana', items: [] },
    { title: 'Anteriores', items: [] },
  ];
  items.forEach((n) => {
    const d = new Date(n.created_at);
    const idx = d >= today ? 0 : d >= weekStart ? 1 : 2;
    groups[idx].items.push(n);
  });
  return groups.filter((g) => g.items.length > 0);
}

function notifItem(n) {
  const type = TYPES[n.type] || { icon: 'bell', label: 'Aviso' };
  const href = safeLink(n.link);
  const inner = html`
    <span class="notif__icon notif__icon--${n.type}" role="img" aria-label="${type.label}">${icon(type.icon, 20)}</span>
    <span class="notif__text">
      <span class="notif__title">${n.title}</span>
      ${n.body ? safe(html`<span class="notif__body">${n.body}</span>`) : ''}
      <span class="notif__when">${ago(n.created_at)}</span>
    </span>
    ${n.read ? '' : safe('<span class="notif__dot" role="img" aria-label="No leída"></span>')}`;
  const cls = `notif${n.read ? '' : ' notif--unread'}`;
  return href
    ? safe(html`<a class="${cls}" href="${href}" data-id="${n.id}">${safe(inner)}</a>`)
    : safe(html`<button type="button" class="${cls}" data-id="${n.id}">${safe(inner)}</button>`);
}

function listHtml() {
  if (state.items.length === 0) {
    return state.filter === 'unread'
      ? emptyState('checkCircle', 'Estás al día', 'No tienes avisos sin leer.')
      : emptyState('bell', 'Todavía no tienes notificaciones', 'Aquí verás las revisiones, los comentarios y los logros de tu equipo.');
  }
  return safe(groupByDate(state.items).map((g, i) => html`
    <section class="notif-group" aria-labelledby="g${i}">
      <h2 class="notif-group__title" id="g${i}">${g.title}</h2>
      ${g.items.map(notifItem)}
    </section>`).join(''));
}

function paint() {
  const filters = [['all', 'Todas'], ['unread', state.unread ? `No leídas (${state.unread})` : 'No leídas']];
  document.getElementById('filters').innerHTML = filters
    .map(([key, label]) => html`<button type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}</button>`)
    .join('');
  document.getElementById('read-all').disabled = state.unread === 0;
  document.getElementById('list').innerHTML = html`${listHtml()}`;
}

async function load() {
  document.getElementById('list').innerHTML = html`${loading()}`;
  try {
    const [{ notifications }, { unread }] = await Promise.all([
      get(`/account/notifications?filter=${state.filter}`),
      get('/account/notifications/count'),
    ]);
    state.items = notifications;
    state.unread = unread;
    paint();
  } catch (err) {
    document.getElementById('list').innerHTML = html`<div class="alert alert-error" role="alert">${icon('alert', 20)}<div>${err.message}</div></div>`;
  }
}

/** Al hacer clic: se marca como leída y luego se abre la pantalla relacionada. */
async function onItemClick(event) {
  const el = event.target.closest('.notif');
  if (!el) return;
  const n = state.items.find((x) => String(x.id) === el.dataset.id);
  if (!n) return;
  const href = el.tagName === 'A' ? el.getAttribute('href') : '';
  if (href) event.preventDefault();
  if (!n.read) {
    try {
      await post(`/account/notifications/${n.id}/read`);
      changed();
    } catch (err) {
      if (!href) return toast(err.message, 'error');
    }
  }
  if (href) {
    location.href = href;
    return;
  }
  await load();
}

async function onReadAll(event) {
  const button = event.currentTarget;
  await withBusy(button, async () => {
    try {
      const { updated } = await post('/account/notifications/read-all');
      changed();
      toast(updated ? 'Marcaste todos los avisos como leídos.' : 'No tenías avisos sin leer.');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function onFilterClick(event) {
  const button = event.target.closest('[data-filter]');
  if (!button || button.dataset.filter === state.filter) return;
  state.filter = button.dataset.filter;
  load();
}

async function main() {
  const { home, user } = await initLayout({});
  const back = user.role === 'estudiante' ? 'Volver al tablero' : 'Volver al panel';
  setMain(html`
    <div class="notif-page">
      <div class="page-head">
        <div>
          <a class="back-link" href="${home}">${icon('arrowLeft', 18)}${back}</a>
          <h1 class="page-title" style="margin-top:6px">Notificaciones</h1>
        </div>
        <button type="button" class="btn btn-outline" id="read-all" disabled>${icon('check', 18)}Marcar todas como leídas</button>
      </div>
      <div class="segmented" id="filters" style="align-self:flex-start" role="group" aria-label="Filtrar notificaciones"></div>
      <div id="list" class="stack" style="gap:20px"></div>
    </div>`);
  document.getElementById('filters').addEventListener('click', onFilterClick);
  document.getElementById('read-all').addEventListener('click', onReadAll);
  document.getElementById('list').addEventListener('click', onItemClick);
  paint();
  await load();
}

main();
