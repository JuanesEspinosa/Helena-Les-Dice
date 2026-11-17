// Estructura común de las pantallas internas: barra superior + menú lateral por rol (sección 1.3)
import { get, post, patch } from './api.js';
import { html, icon, esc, initials } from './ui.js';
import { t, initI18n, storeLang, langSelect, fmtPercent } from './i18n.js';

const INACTIVITY_MS = 30 * 60 * 1000;
const POLL_MS = 45 * 1000;

/** Menú lateral por tipo de usuario (sección 1.4 del documento de vistas). El texto sale de menu.<rol>.<key>. */
const MENUS = {
  estudiante: [
    { key: 'tablero', href: '/estudiante/tablero.html', icon: 'layers' },
    { key: 'integrantes', href: '/estudiante/integrantes.html', icon: 'users' },
    { key: 'logros', href: '/estudiante/logros.html', icon: 'medal' },
    { key: 'historial', href: '/estudiante/historial.html', icon: 'history' },
  ],
  docente: [
    { key: 'panel', href: '/docente/panel.html', icon: 'dashboard' },
    { key: 'equipos', href: '/docente/equipos.html', icon: 'users' },
    { key: 'niveles', href: '/docente/niveles.html', icon: 'layers' },
    { key: 'comentarios', href: '/docente/comentarios.html', icon: 'message' },
  ],
  administrador: [
    { key: 'panel', href: '/admin/panel.html', icon: 'dashboard' },
    { key: 'usuarios', href: '/admin/usuarios.html', icon: 'users' },
    { key: 'periodos', href: '/admin/periodos.html', icon: 'calendar' },
    { key: 'logros', href: '/admin/logros.html', icon: 'medal' },
    { key: 'backups', href: '/admin/backups.html', icon: 'database' },
  ],
};

/**
 * Monta la barra superior y el menú lateral, y verifica la sesión y el rol.
 * La página debe tener: <div class="app-body"><main id="main" class="main">…</main></div>
 *
 * @param {{ roles?: string[], active?: string }} opts
 * @returns {Promise<{ user: object, home: string, summary?: object }>}
 */
export async function initLayout({ roles, active } = {}) {
  let me;
  try {
    me = await get('/auth/me', { background: true });
  } catch {
    return new Promise(() => {}); // api.js ya redirige al login
  }
  const { user } = me;
  if (roles && !roles.includes(user.role)) {
    location.replace(me.home);
    return new Promise(() => {});
  }
  const lang = await initI18n(user.lang);
  storeLang(lang);
  const summary = user.role === 'estudiante' ? await get('/student/summary', { background: true }).catch(() => null) : null;

  const subtitle = user.role === 'estudiante'
    ? t('layout.subtitle', { subject: t('common.subject'), detail: summary && summary.team ? summary.team.name : t('layout.noTeam') })
    : user.role === 'docente'
      ? t('layout.subtitle', { subject: t('common.subject'), detail: t('layout.teacherPanel') })
      : t('layout.adminSubtitle');

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = html`
    <button class="btn btn-icon btn-ghost menu-toggle" type="button" aria-label="${t('layout.openMenu')}" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button>
    <a class="brand" href="${me.home}">
      <img class="logo" src="/img/logo-sm.png" alt="Helena les dice" width="95" height="52">
      <span style="min-width:0"><span class="brand-sub" style="display:block">${subtitle}</span></span>
    </a>
    <div class="header-actions">
      <span id="lang-slot"></span>
      <a class="btn btn-icon" href="/notificaciones.html" id="bell" aria-label="${t('layout.notifications')}">${icon('bell')}<span class="notif-count" hidden></span></a>
      <a class="user-chip" href="/perfil.html" title="${t('layout.myProfile')}">
        <span class="avatar" aria-hidden="true">${initials(user.name)}</span>
        <span class="user-chip__text"><span class="user-chip__name" style="display:block">${user.name}</span><span class="user-chip__role" style="display:block">${t(`roles.${user.role}`)}</span></span>
      </a>
      <button class="btn btn-ghost" type="button" id="logout-btn" aria-label="${t('layout.logout')}">${icon('logout', 18)}<span class="hide-sm">${t('layout.logout')}</span></button>
    </div>`;
  document.body.prepend(header);

  const bodyEl = document.querySelector('.app-body');
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.id = 'sidebar';
  nav.setAttribute('aria-label', t('layout.mainMenu'));
  nav.innerHTML = MENUS[user.role].map((m) => html`
    <a class="nav-link" href="${m.href}" aria-current="${m.key === active ? 'page' : 'false'}">${icon(m.icon)}${t(`menu.${user.role}.${m.key}`)}</a>`).join('')
    + (summary && summary.team ? html`
    <div class="card" style="margin-top:24px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <div class="eyebrow" style="color:var(--text-2)">${t('layout.progress')}</div>
      <div style="font-size:28px;font-weight:800">${fmtPercent(summary.pct)}</div>
      <div class="progress"><span style="width:${summary.pct}%"></span></div>
      <div class="muted small">${t('layout.approvedOf', { approved: summary.approved, count: summary.total })}</div>
    </div>` : '');
  bodyEl.prepend(nav);

  styleBadge();
  wireMenu(header, nav);
  wireLogout(header.querySelector('#logout-btn'));
  wireLang(header.querySelector('#lang-slot'), lang);
  pollNotifications(header.querySelector('#bell'));
  watchInactivity();

  return { user, home: me.home, summary };
}

function styleBadge() {
  if (document.getElementById('layout-style')) return;
  const s = document.createElement('style');
  s.id = 'layout-style';
  s.textContent = `.notif-count{position:absolute;top:-6px;right:-6px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--warn);color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center;box-shadow:0 0 0 2px #fff}`;
  document.head.appendChild(s);
}

function wireMenu(header, nav) {
  const btn = header.querySelector('.menu-toggle');
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('open') && !nav.contains(e.target) && !btn.contains(e.target)) {
      nav.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}

/** Cierra la sesión. `reason` es un código de errors.json que el login muestra (?expirada=CODIGO). */
export async function logout(reason) {
  try { await post('/auth/logout'); } catch { /* si ya expiró, se redirige igual (RF-15) */ }
  location.href = reason ? `/index.html?expirada=${encodeURIComponent(reason)}` : '/index.html';
}

function wireLogout(btn) {
  btn.addEventListener('click', () => logout());
}

/** Selector de idioma del header: guarda la preferencia en la cuenta y recarga la página. */
function wireLang(slot, lang) {
  slot.appendChild(langSelect({
    id: 'lang-select',
    value: lang,
    onChange: async (next) => {
      try {
        await patch('/account/lang', { lang: next });
        storeLang(next);
      } catch { /* sin conexión: se recarga igual con el idioma guardado */ }
      location.reload();
    },
  }));
}

async function pollNotifications(bell) {
  const badge = bell.querySelector('.notif-count');
  const refresh = async () => {
    try {
      const { unread } = await get('/account/notifications/count', { background: true });
      badge.hidden = unread === 0;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      bell.setAttribute('aria-label', unread ? t('layout.notificationsUnread', { count: unread }) : t('layout.notifications'));
    } catch { /* sin conexión: se intenta en el siguiente ciclo */ }
  };
  await refresh();
  setInterval(refresh, POLL_MS);
  window.addEventListener('notifications:changed', refresh);
}

/** Cierre automático en el navegador tras 30 minutos sin actividad (RNF-09). */
function watchInactivity() {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => window.addEventListener(ev, bump, { passive: true }));
  setInterval(() => {
    if (Date.now() - last > INACTIVITY_MS) logout('SESSION_IDLE');
  }, 30 * 1000);
}

/** Atajo para escribir el contenido principal de la página. */
export function setMain(content) {
  const main = document.getElementById('main');
  main.innerHTML = content;
  main.classList.add('fade-in');
  return main;
}

export { esc };
