// Tests del núcleo de traducción del front (public/js/core/i18n.js) en Node, con fetch y un DOM mínimos.
// Uso: npm test
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const I18N_DIR = path.join(__dirname, '..', 'public', 'js', 'i18n');
const MODULE_URL = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'core', 'i18n.js')).href;

let i18n;

/** Elemento falso con lo que usa applyI18n: dataset, textContent y setAttribute. */
function fakeElement(dataset, textContent = '', attrs = {}) {
  return { dataset, textContent, attrs: { ...attrs }, setAttribute(name, value) { this.attrs[name] = value; } };
}

/** Documento falso: querySelectorAll devuelve los elementos que tienen el data-* pedido. */
function fakeDocument(elements) {
  return {
    documentElement: { lang: '' },
    querySelectorAll(selector) {
      if (selector === '[data-i18n]') return elements.filter((e) => e.dataset.i18n);
      if (selector === '[data-i18n-attr]') return elements.filter((e) => e.dataset.i18nAttr);
      return [];
    },
  };
}

/** fetch que sirve los diccionarios reales desde public/js/i18n/<idioma>/<área>.json. */
async function servingFetch(url) {
  const file = path.join(I18N_DIR, ...url.replace('/js/i18n/', '').split('/'));
  if (!fs.existsSync(file)) return { ok: false, json: async () => ({}) };
  return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
}

const failingFetch = async () => { throw new TypeError('Failed to fetch'); };

before(async () => {
  globalThis.document = fakeDocument([]);
  i18n = await import(MODULE_URL);
});

test('si los diccionarios no cargan, el HTML conserva su texto en español en vez de mostrar la clave', async () => {
  const title = fakeElement({ i18n: 'access.login.title' }, 'Iniciar sesión');
  const button = fakeElement({ i18nAttr: 'aria-label:access.showPassword' }, '', { 'aria-label': 'Mostrar contraseña' });
  globalThis.document = fakeDocument([title, button]);
  globalThis.fetch = failingFetch;

  await i18n.initI18n('en');

  assert.equal(title.textContent, 'Iniciar sesión');
  assert.equal(button.attrs['aria-label'], 'Mostrar contraseña');
});

test('sin conexión antes de cargar el diccionario, el error no se muestra como una clave', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = failingFetch;
  await i18n.initI18n('en');

  const text = i18n.tError({ code: 'OFFLINE' });

  assert.doesNotMatch(text, /^errors\./);
  assert.ok(text.length > 0);
});

test('con los diccionarios cargados, el HTML se traduce al idioma elegido', async () => {
  const title = fakeElement({ i18n: 'access.login.title' }, 'Iniciar sesión');
  globalThis.document = fakeDocument([title]);
  globalThis.fetch = servingFetch;

  await i18n.initI18n('de');

  assert.equal(title.textContent, 'Anmelden');
  assert.equal(globalThis.document.documentElement.lang, 'de-DE');
});

test('las claves solo existen si están en el diccionario: nombres del prototipo como constructor no cuentan', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = servingFetch;
  await i18n.initI18n('es');

  assert.equal(i18n.has('errors.constructor'), false);
  assert.equal(i18n.has('errors.__proto__'), false);
  assert.equal(i18n.t('errors.toString'), 'errors.toString');
  assert.equal(i18n.has('errors.SESSION_IDLE'), true);
});

test('un plural elige la forma según count y el idioma, y "zero" solo cuando existe', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = servingFetch;
  await i18n.initI18n('en');

  assert.equal(i18n.t('student.editor.words', { count: 1 }), '1 word');
  assert.equal(i18n.t('student.editor.words', { count: 3 }), '3 words');
  assert.equal(i18n.t('admin.achievements.wonBy', { count: 0 }), 'earned by no team yet');
});

test('fechas y números salen en el formato del idioma activo, no fijos en es-CO', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = servingFetch;
  const date = new Date(2026, 2, 5, 14, 30); // 5 de marzo de 2026, 14:30 (hora local)

  await i18n.initI18n('de');
  const de = { date: i18n.fmtDate(date), number: i18n.fmtNumber(1234.5) };
  await i18n.initI18n('en');
  const en = { date: i18n.fmtDate(date), number: i18n.fmtNumber(1234.5) };

  assert.equal(de.date, '5. März 2026');
  assert.equal(de.number, '1.234,5');
  assert.equal(en.date, 'Mar 5, 2026');
  assert.equal(en.number, '1,234.5');
});

test('una clave que falta en el diccionario cargado se muestra en español', async () => {
  globalThis.document = fakeDocument([]);
  // en llega completo salvo common.save; es sí la tiene ("Guardar")
  globalThis.fetch = async (url) => {
    const res = await servingFetch(url);
    if (!url.endsWith('/en/common.json')) return res;
    const data = await res.json();
    const { save, ...common } = data.common;
    return { ok: true, json: async () => ({ ...data, common }) };
  };

  await i18n.initI18n('en');

  assert.equal(i18n.t('common.save'), 'Guardar');
  assert.equal(i18n.t('common.cancel'), 'Cancel');
});

test('el mensaje de un error traducido incluye sus datos variables (params)', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = servingFetch;
  await i18n.initI18n('en');

  const text = i18n.tError({ code: 'ACCOUNT_LOCKED', params: { minutes: 7 }, message: 'Tu cuenta está bloqueada…' });

  assert.equal(text, 'Your account is locked due to failed attempts. Try again in 7 minutes.');
  assert.doesNotMatch(text, /\{minutes\}/);
});

test('un error con un código sin traducción muestra el mensaje del servidor', async () => {
  globalThis.document = fakeDocument([]);
  globalThis.fetch = servingFetch;
  await i18n.initI18n('en');

  const text = i18n.tError({ code: 'CODIGO_SIN_TRADUCCION', message: 'Mensaje del servidor en español.' });

  assert.equal(text, 'Mensaje del servidor en español.');
});
