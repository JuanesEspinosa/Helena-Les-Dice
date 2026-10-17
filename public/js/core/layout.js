// Estructura común de las pantallas internas: barra superior + menú lateral por rol (sección 1.3)
import { get, post, patch } from './api.js';
import { html, icon, esc, initials } from './ui.js';

const INACTIVITY_MS = 30 * 60 * 1000;
const POLL_MS = 45 * 1000;

const ROLE_LABEL = {
  es: { estudiante: 'Estudiante', docente: 'Docente', administrador: 'Administrador' },
  en: { estudiante: 'Student', docente: 'Teacher', administrador: 'Administrator' },
};

/** Menú lateral por tipo de usuario (sección 1.4 del documento de vistas). */
const MENUS = {
  estudiante: [
    { key: 'tablero', href: '/estudiante/tablero.html', icon: 'layers', es: 'Tablero de niveles', en: 'Level board' },
    { key: 'integrantes', href: '/estudiante/integrantes.html', icon: 'users', es: 'Integrantes', en: 'Members' },
    { key: 'logros', href: '/estudiante/logros.html', icon: 'medal', es: 'Logros e insignias', en: 'Achievements' },
    { key: 'historial', href: '/estudiante/historial.html', icon: 'history', es: 'Historial de versiones', en: 'Version history' },
  ],
  docente: [
    { key: 'panel', href: '/docente/panel.html', icon: 'dashboard', es: 'Panel de seguimiento', en: 'Tracking panel' },
    { key: 'equipos', href: '/docente/equipos.html', icon: 'users', es: 'Equipos', en: 'Teams' },
    { key: 'niveles', href: '/docente/niveles.html', icon: 'layers', es: 'Configurar niveles', en: 'Configure levels' },
    { key: 'comentarios', href: '/docente/comentarios.html', icon: 'message', es: 'Comentarios', en: 'Comments' },
  ],
  administrador: [
    { key: 'panel', href: '/admin/panel.html', icon: 'dashboard', es: 'Panel', en: 'Dashboard' },
    { key: 'usuarios', href: '/admin/usuarios.html', icon: 'users', es: 'Usuarios', en: 'Users' },
    { key: 'periodos', href: '/admin/periodos.html', icon: 'calendar', es: 'Periodos académicos', en: 'Academic periods' },
    { key: 'logros', href: '/admin/logros.html', icon: 'medal', es: 'Catálogo de logros', en: 'Achievement catalog' },
    { key: 'backups', href: '/admin/backups.html', icon: 'database', es: 'Copias de seguridad', en: 'Backups' },
  ],
};

const T = {
  es: { logout: 'Cerrar sesión', notif: 'Notificaciones', menu: 'Abrir menú', progress: 'Avance del documento', approvedOf: (a, t) => `${a} de ${t} secciones aprobadas`, lang: 'Cambiar idioma' },
  en: { logout: 'Sign out', notif: 'Notifications', menu: 'Open menu', progress: 'Document progress', approvedOf: (a, t) => `${a} of ${t} sections approved`, lang: 'Change language' },
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
  const lang = user.lang === 'en' ? 'en' : 'es';
  const t = T[lang];
  const summary = user.role === 'estudiante' ? await get('/student/summary', { background: true }).catch(() => null) : null;

  const subtitle = user.role === 'estudiante'
    ? `Gestión de proyectos TI · ${summary && summary.team ? summary.team.name : 'Sin equipo'}`
    : user.role === 'docente' ? 'Gestión de proyectos TI · Panel docente' : 'Administración de la plataforma';

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML = html`
    <button class="btn btn-icon btn-ghost menu-toggle" type="button" aria-label="${t.menu}" aria-expanded="false" aria-controls="sidebar">${icon('menu')}</button>
    <a class="brand" href="${me.home}">
      <span class="logo" aria-hidden="true">LOGO</span>
      <span style="min-width:0"><span class="brand-name" style="display:block">Helena les dice</span><span class="brand-sub" style="display:block">${subtitle}</span></span>
    </a>
    <div class="header-actions">
      <button class="btn btn-outline btn-sm hide-sm" type="button" id="lang-btn" aria-label="${t.lang}" style="min-height:44px">${icon('globe', 18)}${lang.toUpperCase()}</button>
      <a class="btn btn-icon" href="/notificaciones.html" id="bell" aria-label="${t.notif}">${icon('bell')}<span class="notif-count" hidden></span></a>
      <a class="user-chip" href="/perfil.html" title="Mi perfil">
        <span class="avatar" aria-hidden="true">${initials(user.name)}</span>
        <span class="user-chip__text"><span class="user-chip__name" style="display:block">${user.name}</span><span class="user-chip__role" style="display:block">${ROLE_LABEL[lang][user.role]}</span></span>
      </a>
      <button class="btn btn-ghost" type="button" id="logout-btn">${icon('logout', 18)}<span class="hide-sm">${t.logout}</span></button>
    </div>`;
  document.body.prepend(header);

  const bodyEl = document.querySelector('.app-body');
  const nav = document.createElement('nav');
  nav.className = 'sidebar';
  nav.id = 'sidebar';
  nav.setAttribute('aria-label', 'Menú principal');
  nav.innerHTML = MENUS[user.role].map((m) => html`
    <a class="nav-link" href="${m.href}" ${m.key === active ? 'aria-current="page"' : ''}>${icon(m.icon)}${m[lang]}</a>`).join('')
    + (summary && summary.team ? html`
    <div class="card" style="margin-top:24px;padding:16px;display:flex;flex-direction:column;gap:10px">
      <div class="eyebrow" style="color:var(--text-2)">${t.progress}</div>
      <div style="font-size:28px;font-weight:800">${summary.pct}%</div>
      <div class="progress"><span style="width:${summary.pct}%"></span></div>
      <div class="muted small">${t.approvedOf(summary.approved, summary.total)}</div>
    </div>` : '');
  bodyEl.prepend(nav);

  styleBadge();
  wireMenu(header, nav);
  wireLogout(header.querySelector('#logout-btn'));
  wireLang(header.querySelector('#lang-btn'), lang);
  pollNotifications(header.querySelector('#bell'), t);
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

export async function logout(reason) {
  try { await post('/auth/logout'); } catch { /* si ya expiró, se redirige igual (RF-15) */ }
  location.href = reason ? `/index.html?expirada=${encodeURIComponent(reason)}` : '/index.html';
}

function wireLogout(btn) {
  btn.addEventListener('click', () => logout());
}

function wireLang(btn, lang) {
  btn.addEventListener('click', async () => {
    await patch('/account/lang', { lang: lang === 'es' ? 'en' : 'es' }).catch(() => {});
    location.reload();
  });
}

async function pollNotifications(bell, t) {
  const badge = bell.querySelector('.notif-count');
  const refresh = async () => {
    try {
      const { unread } = await get('/account/notifications/count', { background: true });
      badge.hidden = unread === 0;
      badge.textContent = unread > 99 ? '99+' : String(unread);
      bell.setAttribute('aria-label', unread ? `${t.notif}, ${unread} sin leer` : t.notif);
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
    if (Date.now() - last > INACTIVITY_MS) logout('Tu sesión se cerró por 30 minutos de inactividad.');
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
