// Tests de la API de Helena les dice. Corren contra la BD helena_test, que se recrea en cada corrida.
// Uso: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startApp, client } = require('./helpers');

const ADMIN = 'admin@elpoli.edu.co';
const TEACHER = 'gladys.restrepo@elpoli.edu.co';
const STUDENT = 'laura.gomez@elpoli.edu.co';

let app;
let admin;
let teacher;
let student;

before(async () => {
  app = await startApp();
  admin = client(app.base);
  teacher = client(app.base);
  student = client(app.base);
  for (const [c, email] of [[admin, ADMIN], [teacher, TEACHER], [student, STUDENT]]) {
    const r = await c.login(email);
    assert.equal(r.status, 200, `login ${email}: ${JSON.stringify(r.data)}`);
  }
});

after(async () => {
  if (app) await app.stop();
});

/** Ids numéricos que aparecen en una respuesta (el tablero anida niveles y secciones). */
function idsIn(data) {
  return [...new Set([...JSON.stringify(data).matchAll(/"id":(\d+)/g)].map((m) => Number(m[1])))];
}

/** Primera sección del tablero del estudiante que cumple `predicate(respuestaDeLaSeccion)`. */
async function findSection(predicate) {
  const board = await student.get('/api/student/board');
  assert.equal(board.status, 200);
  for (const id of idsIn(board.data)) {
    const r = await student.get(`/api/sections/${id}`);
    if (r.status === 200 && predicate(r.data)) return r.data;
  }
  return null;
}

// ---------- Autenticación y control de acceso ----------

test('login con contraseña incorrecta responde 401 e indica los intentos restantes', async () => {
  const r = await client(app.base).login('camila.rios@elpoli.edu.co', 'mala');
  assert.equal(r.status, 401);
  assert.match(r.data.error, /intento/);
});

test('cinco intentos fallidos bloquean la cuenta (423)', async () => {
  const c = client(app.base);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await c.login('andres.perez@elpoli.edu.co', 'mala')).status);
  assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
  const blocked = await c.login('andres.perez@elpoli.edu.co');
  assert.equal(blocked.status, 423, 'con la cuenta bloqueada ni la contraseña correcta entra');
});

test('/auth/me devuelve el rol de cada usuario', async () => {
  assert.equal((await admin.get('/api/auth/me')).data.user.role, 'administrador');
  assert.equal((await teacher.get('/api/auth/me')).data.user.role, 'docente');
  assert.equal((await student.get('/api/auth/me')).data.user.role, 'estudiante');
});

test('cada rol solo entra a su área de la API', async () => {
  const cases = [
    [student, '/api/admin/users', 403],
    [student, '/api/teacher/dashboard', 403],
    [teacher, '/api/admin/dashboard', 403],
    [admin, '/api/student/summary', 403],
    [client(app.base), '/api/account/profile', 401],
    [admin, '/api/no-existe', 404],
  ];
  for (const [c, url, expected] of cases) assert.equal((await c.get(url)).status, expected, url);
});

test('las peticiones que modifican datos deben ser JSON', async () => {
  const r = await fetch(app.base + '/api/auth/login', { method: 'POST', body: 'email=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.notEqual(r.status, 200);
});

// ---------- Lecturas de cada vista ----------

test('todos los endpoints de lectura responden 200', async () => {
  const reads = [
    ...['/api/account/profile', '/api/account/notifications', '/api/account/notifications/count'].flatMap((u) => [[admin, u], [teacher, u], [student, u]]),
    ...['summary', 'board', 'members', 'achievements', 'history-sections'].map((p) => [student, `/api/student/${p}`]),
    ...['dashboard', 'teams', 'teams/1', 'students?q=a', 'levels', 'comments'].map((p) => [teacher, `/api/teacher/${p}`]),
    ...['dashboard', 'users', 'periods', 'achievements', 'backups'].map((p) => [admin, `/api/admin/${p}`]),
  ];
  for (const [c, url] of reads) {
    const r = await c.get(url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.data).slice(0, 200)}`);
  }
});

test('las 19 páginas se sirven', async () => {
  const pub = path.join(__dirname, '..', 'public');
  const walk = (d) => fs.readdirSync(d).flatMap((f) => (fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
  const pages = walk(pub).filter((f) => f.endsWith('.html'));
  assert.equal(pages.length, 19);
  for (const f of pages) {
    const url = '/' + path.relative(pub, f).replace(/\\/g, '/');
    assert.equal((await fetch(app.base + url)).status, 200, url);
  }
});

// ---------- Editor: autoguardado, envío y revisión ----------

test('flujo completo de una sección: autoguardado, envío, devolución y aprobación', async () => {
  const found = await findSection((d) => d.permissions.canEdit && d.permissions.canSubmit);
  assert.ok(found, 'el seed debe tener una sección editable con revisor asignado para Laura');
  const id = found.section.id;
  const url = `/api/sections/${id}`;

  // Autoguardado sin cambios no crea versión (el editor lo llama cada 2 minutos)
  const same = await student.put(url, { content: found.section.content, auto: true });
  assert.equal(same.status, 200);
  assert.equal(same.data.saved, false);

  // Autoguardado con cambios crea una versión "automatico" y limpia el HTML peligroso
  const auto = await student.put(url, { content: '<p>Texto del autoguardado</p><script>alert(1)</script>', auto: true });
  assert.equal(auto.status, 200);
  assert.equal(auto.data.saved, true);
  const afterAuto = await student.get(url);
  assert.doesNotMatch(afterAuto.data.section.content, /<script/);
  assert.equal(afterAuto.data.versions[0].kind, 'automatico');
  assert.equal(afterAuto.data.versions[0].number, auto.data.version);

  // Guardado manual y diff entre versiones
  const manual = await student.put(url, { content: '<p>Texto del guardado manual</p>' });
  assert.equal(manual.data.version, auto.data.version + 1);
  const diff = await student.get(`${url}/versions/${manual.data.version}/diff`);
  assert.equal(diff.status, 200);
  assert.ok(diff.data.diff.some((p) => p.added) && diff.data.diff.some((p) => p.removed));

  // Enviar a revisión bloquea la edición
  assert.equal((await student.post(`${url}/submit`)).status, 200);
  assert.equal((await student.get(url)).data.section.status, 'revision');
  assert.equal((await student.put(url, { content: '<p>otra</p>' })).status, 409);

  // Devolver exige observación
  const noNote = await teacher.post(`${url}/review`, { decision: 'devolver' });
  assert.equal(noNote.status, 400);
  assert.equal(noNote.data.field, 'observation');
  assert.equal((await teacher.post(`${url}/review`, { decision: 'devolver', observation: 'Falta el alcance.' })).status, 200);
  const returned = await student.get(url);
  assert.equal(returned.data.section.status, 'devuelto');
  assert.ok(returned.data.comments.some((c) => c.body === 'Falta el alcance.'));

  // Corregir, reenviar y aprobar
  assert.equal((await student.put(url, { content: '<p>Corregido con el alcance</p>' })).status, 200);
  assert.equal((await student.post(`${url}/submit`)).status, 200);
  assert.equal((await teacher.post(`${url}/review`, { decision: 'aprobar' })).status, 200);
  assert.equal((await student.get(url)).data.section.status, 'aprobado');
  assert.equal((await student.put(url, { content: '<p>x</p>' })).status, 409, 'una sección aprobada no se edita');
});

test('un estudiante que no es responsable no puede editar la sección', async () => {
  const other = await findSection((d) => !d.permissions.canEdit && !d.section.locked);
  assert.ok(other, 'debe existir una sección desbloqueada que Laura no puede editar');
  const r = await student.put(`/api/sections/${other.section.id}`, { content: '<p>intruso</p>' });
  assert.ok([403, 409].includes(r.status), `esperado 403/409, llegó ${r.status}`);
});

test('comentarios: validación, creación y marcado como atendido', async () => {
  const s = await findSection((d) => d.permissions.canComment);
  const url = `/api/sections/${s.section.id}/comments`;

  const empty = await teacher.post(url, { body: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.field, 'body');

  const created = await teacher.post(url, { body: 'Revisen la redacción.', quote: 'texto citado' });
  assert.equal(created.status, 201);
  const cid = created.data.comment.id;

  assert.equal((await teacher.post(`/api/sections/comments/${cid}/resolve`)).status, 403, 'la docente no marca como atendido');
  assert.equal((await student.post(`/api/sections/comments/${cid}/resolve`)).status, 200);
  assert.equal((await student.post(`/api/sections/comments/${cid}/resolve`)).status, 409, 'no se marca dos veces');
});

test('los avisos se pueden marcar como leídos', async () => {
  assert.equal((await student.post('/api/account/notifications/read-all')).status, 200);
  const count = await student.get('/api/account/notifications/count');
  assert.equal(count.data.unread, 0);
});

// ---------- Administración ----------

test('admin crea, valida duplicados y elimina un usuario', async () => {
  const created = await admin.post('/api/admin/users', { name: 'Usuario Prueba', email: 'prueba.test@elpoli.edu.co', role: 'estudiante' });
  assert.equal(created.status, 201);
  assert.ok(created.data.tempPassword.length >= 8);

  const dup = await admin.post('/api/admin/users', { name: 'Otro', email: 'PRUEBA.TEST@elpoli.edu.co', role: 'docente' });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.field, 'email');

  assert.equal((await admin.del(`/api/admin/users/${created.data.user.id}`)).status, 200);
  assert.equal((await admin.del(`/api/admin/users/${created.data.user.id}`)).status, 404);
});

test('una cuenta que ya inició sesión no se borra, solo se desactiva', async () => {
  const created = await admin.post('/api/admin/users', { name: 'Con Acceso', email: 'acceso.test@elpoli.edu.co', role: 'estudiante' });
  const login = await client(app.base).login('acceso.test@elpoli.edu.co', created.data.tempPassword);
  assert.equal(login.status, 200, 'la contraseña temporal sirve para entrar');

  const id = created.data.user.id;
  assert.equal((await admin.del(`/api/admin/users/${id}`)).status, 409);
  assert.equal((await admin.post(`/api/admin/users/${id}/deactivate`)).status, 200);
  assert.equal((await client(app.base).login('acceso.test@elpoli.edu.co', created.data.tempPassword)).status === 200, false,
    'una cuenta desactivada no entra');
});

test('un periodo con fecha de fin anterior al inicio se rechaza', async () => {
  const r = await admin.post('/api/admin/periods', { name: '2099-1', start_date: '2099-06-01', end_date: '2099-01-01' });
  assert.equal(r.status, 400);
  assert.equal(r.data.field, 'end_date');
});

// ---------- Docente: reordenar niveles (lo que hace el arrastre) ----------

test('reordenar niveles guarda el nuevo orden y rechaza órdenes incompletos', async () => {
  const before = (await teacher.get('/api/teacher/levels')).data.levels;
  const ids = before.map((l) => l.id);
  const swapped = [ids[1], ids[0], ...ids.slice(2)];

  const r = await teacher.put('/api/teacher/levels/order', { ids: swapped });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.levels.map((l) => l.id), swapped);
  assert.deepEqual(r.data.levels.map((l) => l.position), swapped.map((_, i) => i + 1));

  const incomplete = await teacher.put('/api/teacher/levels/order', { ids: ids.slice(1) });
  assert.equal(incomplete.status, 400);

  // Restaura el orden original
  assert.equal((await teacher.put('/api/teacher/levels/order', { ids })).status, 200);
});
