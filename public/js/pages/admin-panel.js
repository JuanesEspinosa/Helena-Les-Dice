// Vista 15 · Panel del administrador (RF-16)
import { get } from '../core/api.js';
import { html, icon, safe, emptyState, ago, toast } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';

const ROLE_LABEL = { estudiante: 'Estudiante', docente: 'Docente', administrador: 'Administrador' };
const DIST = [
  { key: 'estudiante', label: 'Estudiantes', color: 'var(--green)' },
  { key: 'docente', label: 'Docentes', color: '#F2B33D' },
  { key: 'administrador', label: 'Administradores', color: 'var(--text)' },
];
const longDate = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const fmtLong = (d) => {
  const s = longDate.format(new Date(d));
  return s.charAt(0).toUpperCase() + s.slice(1);
};

await initLayout({ roles: ['administrador'], active: 'panel' });
try {
  render(await get('/admin/dashboard'));
} catch (err) {
  setMain(html`${head()}<div class="alert alert-error" role="alert">${icon('alert')}<div>${err.message}</div></div>`);
  toast(err.message, 'error');
}

function head() {
  return safe(html`<div class="page-head"><div>
    <h1 class="page-title">Panel del administrador</h1>
    <p class="page-sub">Resumen de las cuentas y del estado de la plataforma.</p>
  </div></div>`);
}

function render(d) {
  setMain(html`
    ${head()}
    <div class="grid grid-4">
      ${stat('Total de usuarios', d.total, 'users')}
      ${stat('Cuentas activas', d.active, 'checkCircle', 'color:var(--st-ok)')}
      ${stat('Cuentas inactivas', d.inactive, 'lock')}
      ${stat('Periodo activo', d.period || 'Ninguno', 'calendar')}
    </div>
    <div class="split">
      <div class="grow stack" style="gap:24px">
        ${quickLinks()}
        ${recentTable(d)}
      </div>
      <aside class="side">
        ${distribution(d)}
        ${platform(d.platform)}
      </aside>
    </div>`);
}

function stat(label, value, iconName, style = '') {
  return safe(html`<div class="card stat">
    <div class="stat__label"><span class="stat__icon">${icon(iconName, 18)}</span>${label}</div>
    <div class="stat__value" style="${style}">${value}</div>
  </div>`);
}

function quickLinks() {
  const links = [
    { href: '/admin/usuarios.html#nuevo', icon: 'users', title: 'Crear usuario', text: 'Estudiante, docente o administrador', primary: true },
    { href: '/admin/periodos.html#nuevo', icon: 'calendar', title: 'Nuevo periodo', text: 'Abrir el siguiente semestre' },
    { href: '/admin/backups.html', icon: 'database', title: 'Copia de seguridad', text: 'Generar y descargar ahora' },
  ];
  return safe(html`<section aria-labelledby="acc" class="stack">
    <h2 id="acc" class="card-title" style="font-size:18px">Accesos rápidos</h2>
    <div class="grid grid-3">
      ${links.map((l) => safe(html`<a class="quick ${l.primary ? 'quick--primary' : ''}" href="${l.href}">
        ${icon(l.icon, 26)}<span class="quick__title">${l.title}</span><span class="quick__text">${l.text}</span>
      </a>`))}
    </div>
  </section>`);
}

function recentTable(d) {
  const body = d.empty || d.recent.length === 0
    ? emptyState('users', 'Aún no hay otros usuarios', 'Crea la primera cuenta de estudiante o docente para empezar.',
      html`<a class="btn btn-primary" href="/admin/usuarios.html#nuevo">${icon('plus', 18)}Crear primer usuario</a>`)
    : safe(html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Nombre</th><th scope="col">Tipo</th><th scope="col">Creada</th></tr></thead>
        <tbody>${d.recent.map((u) => safe(html`<tr>
          <td><strong>${u.name}</strong><div class="muted small">${u.email}</div></td>
          <td><span class="tag">${ROLE_LABEL[u.role]}</span>${u.active ? '' : safe(' <span class="pill pill-inactivo">Inactiva</span>')}</td>
          <td class="muted">${ago(u.created_at)}</td>
        </tr>`))}</tbody>
      </table></div>`);
  return safe(html`<section class="card" aria-labelledby="rec">
    <div class="card-head"><h2 id="rec" class="card-title">Cuentas creadas recientemente</h2>
      <a href="/admin/usuarios.html" class="btn btn-ghost btn-sm">Ver todos${icon('chevronRight', 16)}</a></div>
    ${body}
  </section>`);
}

function distribution(d) {
  const total = DIST.reduce((n, r) => n + d.byRole[r.key], 0);
  const bar = total
    ? DIST.filter((r) => d.byRole[r.key] > 0).map((r) => safe(html`<span style="width:${(d.byRole[r.key] / total) * 100}%;background:${r.color}"></span>`))
    : '';
  return safe(html`<section class="card card-pad stack" aria-labelledby="dist">
    <h2 id="dist" class="card-title">Usuarios por tipo</h2>
    <div class="dist-bar" role="img" aria-label="${DIST.map((r) => `${r.label}: ${d.byRole[r.key]}`).join(', ')}">${bar}</div>
    <div class="stack" style="gap:8px">
      ${DIST.map((r) => safe(html`<div class="row" style="flex-wrap:nowrap">
        <span class="dist-dot" style="background:${r.color}"></span><span style="flex:1">${r.label}</span><strong>${d.byRole[r.key]}</strong>
      </div>`))}
    </div>
  </section>`);
}

function platform(p) {
  return safe(html`<section class="card card-pad stack" aria-labelledby="est">
    <h2 id="est" class="card-title">Estado de la plataforma</h2>
    <div class="row"><span class="dist-dot" style="background:var(--green);border-radius:50%"></span><span>${p.online ? 'Servicio en línea' : 'Servicio con fallas'}</span></div>
    <div class="row between"><span class="muted">Última copia automática</span><strong>${p.lastAutomatic ? fmtLong(p.lastAutomatic) : 'Aún no hay'}</strong></div>
    <div class="row between"><span class="muted">Próxima copia</span><strong>${p.nextAutomatic ? fmtLong(p.nextAutomatic) : 'En la próxima hora'}</strong></div>
    <a class="btn btn-outline btn-sm" href="/admin/backups.html" style="align-self:flex-start">${icon('history', 16)}Ver historial de copias</a>
  </section>`);
}
