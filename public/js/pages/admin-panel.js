// Vista 15 · Panel del administrador (RF-16)
import { get } from '../core/api.js';
import { html, icon, safe, emptyState, ago, toast, fmtNumber } from '../core/ui.js';
import { initLayout, setMain } from '../core/layout.js';
import { t, getLocale } from '../core/i18n.js';

// El texto de cada grupo sale de admin.panel.byRole.<key>
const DIST = [
  { key: 'estudiante', color: 'var(--green)' },
  { key: 'docente', color: '#F2B33D' },
  { key: 'administrador', color: 'var(--text)' },
];
const distLabel = (r) => t(`admin.panel.byRole.${r.key}`);
const fmtLong = (d) => {
  const s = new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
  return s.charAt(0).toLocaleUpperCase(getLocale()) + s.slice(1);
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
    <h1 class="page-title">${t('admin.panel.title')}</h1>
    <p class="page-sub">${t('admin.panel.lead')}</p>
  </div></div>`);
}

function render(d) {
  setMain(html`
    ${head()}
    <div class="grid grid-4">
      ${stat(t('admin.panel.totalUsers'), fmtNumber(d.total), 'users')}
      ${stat(t('admin.panel.activeAccounts'), fmtNumber(d.active), 'checkCircle', 'color:var(--st-ok)')}
      ${stat(t('admin.panel.inactiveAccounts'), fmtNumber(d.inactive), 'lock')}
      ${stat(t('admin.panel.activePeriod'), d.period || t('admin.panel.none'), 'calendar')}
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
    { href: '/admin/usuarios.html#nuevo', icon: 'users', title: t('admin.panel.quick.userTitle'), text: t('admin.panel.quick.userText'), primary: true },
    { href: '/admin/periodos.html#nuevo', icon: 'calendar', title: t('admin.panel.quick.periodTitle'), text: t('admin.panel.quick.periodText') },
    { href: '/admin/backups.html', icon: 'database', title: t('admin.panel.quick.backupTitle'), text: t('admin.panel.quick.backupText') },
  ];
  return safe(html`<section aria-labelledby="acc" class="stack">
    <h2 id="acc" class="card-title" style="font-size:18px">${t('admin.panel.quickLinks')}</h2>
    <div class="grid grid-3">
      ${links.map((l) => safe(html`<a class="quick ${l.primary ? 'quick--primary' : ''}" href="${l.href}">
        ${icon(l.icon, 26)}<span class="quick__title">${l.title}</span><span class="quick__text">${l.text}</span>
      </a>`))}
    </div>
  </section>`);
}

function recentTable(d) {
  const body = d.empty || d.recent.length === 0
    ? emptyState('users', t('admin.panel.noUsersTitle'), t('admin.panel.noUsersText'),
      html`<a class="btn btn-primary" href="/admin/usuarios.html#nuevo">${icon('plus', 18)}${t('admin.panel.createFirstUser')}</a>`)
    : safe(html`<div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">${t('fields.name')}</th><th scope="col">${t('admin.type')}</th><th scope="col">${t('admin.panel.created')}</th></tr></thead>
        <tbody>${d.recent.map((u) => safe(html`<tr>
          <td><strong>${u.name}</strong><div class="muted small">${u.email}</div></td>
          <td><span class="tag">${t(`roles.${u.role}`)}</span>${u.active ? '' : safe(html` <span class="pill pill-inactivo">${t('admin.inactive')}</span>`)}</td>
          <td class="muted">${ago(u.created_at)}</td>
        </tr>`))}</tbody>
      </table></div>`);
  return safe(html`<section class="card" aria-labelledby="rec">
    <div class="card-head"><h2 id="rec" class="card-title">${t('admin.panel.recent')}</h2>
      <a href="/admin/usuarios.html" class="btn btn-ghost btn-sm">${t('admin.panel.seeAll')}${icon('chevronRight', 16)}</a></div>
    ${body}
  </section>`);
}

function distribution(d) {
  const total = DIST.reduce((n, r) => n + d.byRole[r.key], 0);
  const bar = total
    ? DIST.filter((r) => d.byRole[r.key] > 0).map((r) => safe(html`<span style="width:${(d.byRole[r.key] / total) * 100}%;background:${r.color}"></span>`))
    : '';
  return safe(html`<section class="card card-pad stack" aria-labelledby="dist">
    <h2 id="dist" class="card-title">${t('admin.panel.usersByType')}</h2>
    <div class="dist-bar" role="img" aria-label="${DIST.map((r) => `${distLabel(r)}: ${fmtNumber(d.byRole[r.key])}`).join(', ')}">${bar}</div>
    <div class="stack" style="gap:8px">
      ${DIST.map((r) => safe(html`<div class="row" style="flex-wrap:nowrap">
        <span class="dist-dot" style="background:${r.color}"></span><span style="flex:1">${distLabel(r)}</span><strong>${fmtNumber(d.byRole[r.key])}</strong>
      </div>`))}
    </div>
  </section>`);
}

function platform(p) {
  return safe(html`<section class="card card-pad stack" aria-labelledby="est">
    <h2 id="est" class="card-title">${t('admin.panel.platform')}</h2>
    <div class="row"><span class="dist-dot" style="background:var(--green);border-radius:50%"></span><span>${t(p.online ? 'admin.panel.online' : 'admin.panel.degraded')}</span></div>
    <div class="row between"><span class="muted">${t('admin.panel.lastAuto')}</span><strong>${p.lastAutomatic ? fmtLong(p.lastAutomatic) : t('admin.panel.noneYet')}</strong></div>
    <div class="row between"><span class="muted">${t('admin.panel.nextBackup')}</span><strong>${p.nextAutomatic ? fmtLong(p.nextAutomatic) : t('admin.panel.withinHour')}</strong></div>
    <a class="btn btn-outline btn-sm" href="/admin/backups.html" style="align-self:flex-start">${icon('history', 16)}${t('admin.panel.backupHistory')}</a>
  </section>`);
}
