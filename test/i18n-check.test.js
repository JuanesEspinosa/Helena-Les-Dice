// Tests de scripts/i18n-check.js literals: se corre el CLI sobre archivos de prueba temporales.
// Uso: npm test
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'i18n-check.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-check-'));

after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Escribe `source` en un archivo temporal y corre `literals` sobre él. */
function literals(name, source) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, source);
  const r = spawnSync(process.execPath, [SCRIPT, 'literals', file], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout };
}

test('un texto en español con un signo < o > suelto se marca como literal', () => {
  const r = literals('angulos.js', "const a = 'Guardar cambios >';\nconst b = \"Menos < de 5 equipos\";\n");
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Guardar cambios >/);
  assert.match(r.out, /Menos < de 5 equipos/);
  assert.match(r.out, /2 literales/);
});

test('el marcado HTML de una plantilla no es texto de interfaz: etiquetas, clases, rutas y data-*', () => {
  const r = literals('marcado.js', [
    'const a = html`<del class="diff-del">${x}</del>`;',
    'const b = html`<a href="/docente/equipo.html?id=${id}">${t("x")}</a>`;',
    'const c = html`<button type="submit" data-decision="devolver">${t("y")}</button>`;',
    '',
  ].join('\n'));
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /0 literales/);
});

test('el texto visible y los atributos accesibles dentro del HTML de una plantilla sí se revisan', () => {
  const r = literals('visible.js', [
    'const a = html`<p>Cargando datos</p>`;',
    'const b = html`<button title="Cancelar envío">${icon("x")}</button>`;',
    '',
  ].join('\n'));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /2 literales/);
});

test('las cadenas, plantillas y comentarios siguen la regla del spec', () => {
  const r = literals('reglas.js', [
    "// 'Cerrar sesión' en un comentario no cuenta",
    "const clave = 'equipo';",
    "const ruta = '/estudiante/tablero.html';",
    "const texto = 'Sin datos';",
    'const plantilla = `equipo nuevo ${n}`;',
    '',
  ].join('\n'));
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /Sin datos/);
  assert.match(r.out, /equipo nuevo/);
  assert.match(r.out, /2 literales/);
});
