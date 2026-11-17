#!/usr/bin/env node
// Verificación de la internacionalización (sin dependencias).
//   node scripts/i18n-check.js keys                 mismo juego de claves en los 6 idiomas
//   node scripts/i18n-check.js literals [archivos…] ningún texto en español escrito en el código
//   node scripts/i18n-check.js untranslated         pt/fr/de/it no repiten el valor de es
//   node scripts/i18n-check.js codes                todo code/msgKey del código tiene traducción
//   node scripts/i18n-check.js locales              ningún locale fijo fuera de core/i18n.js
//   node scripts/i18n-check.js                      keys + literals (todo public/) + codes + locales
// Sale con 1 y lista los fallos.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const I18N = path.join(PUBLIC, 'js', 'i18n');
const LANGS = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const BASE = 'es';
const EXTRA = ['pt', 'fr', 'de', 'it'];
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

const ACCENTS = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const WORDS = ('guardar cancelar cerrar eliminar editar buscar cargando equipo equipos nivel niveles seccion '
  + 'secciones correo contrasena usuario usuarios periodo enviar aprobar devolver comentario comentarios '
  + 'hace ayer hoy sin con de del para').split(' ');
// "Palabra completa": sin letras, dígitos, "_" ni "-" alrededor (así "sin-datos" o "nivel_id" no cuentan)
const WORD_RE = new RegExp(`(?<![\\p{L}\\p{N}_-])(${WORDS.join('|')})(?![\\p{L}\\p{N}_-])`, 'iu');

const allowlist = JSON.parse(fs.readFileSync(path.join(I18N, 'allowlist.json'), 'utf8'));
const ALLOWED_LITERALS = new Set(allowlist.literals);

/** Regla de literales del spec: tildes/¿¡, o una palabra de la lista con espacio o mayúscula inicial. */
function isSpanish(text) {
  const value = text.trim();
  if (!value || ALLOWED_LITERALS.has(value)) return false;
  if (ACCENTS.test(value)) return true;
  return WORD_RE.test(value) && (/\s/.test(value) || /^\p{Lu}/u.test(value));
}

// ---------- Diccionarios ----------

const isPlural = (v) => v && typeof v === 'object' && Object.keys(v).length > 0
  && Object.keys(v).every((k) => PLURAL_FORMS.has(k));

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !isPlural(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function loadLang(lang) {
  const dir = path.join(I18N, lang);
  const out = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    Object.assign(out, flatten(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))));
  }
  return out;
}

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const placeholders = (value) => [...new Set(
  (isPlural(value) ? Object.values(value) : [value]).flatMap((s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
)].sort().join(',');

/** Diferencias de forma con el español: marcadores {x} distintos, o plural sin "other" o donde no toca. */
function shapeProblems(baseValue, value) {
  const problems = [];
  if (isPlural(baseValue) !== isPlural(value)) problems.push(isPlural(baseValue) ? 'debería ser plural' : 'no debería ser plural');
  else if (isPlural(value) && !own(value, 'other')) problems.push('plural sin "other"');
  if (placeholders(baseValue) !== placeholders(value)) {
    problems.push(`marcadores {${placeholders(value)}} en vez de {${placeholders(baseValue)}}`);
  }
  return problems;
}

function checkKeys({ quiet = false } = {}) {
  const base = loadLang(BASE);
  const baseKeys = Object.keys(base);
  let failed = Object.entries(base).some(([k, v]) => {
    const bad = isPlural(v) && !own(v, 'other');
    if (bad) console.log(`FAIL es\n  ${k}: plural sin "other"`);
    return bad;
  });
  for (const lang of LANGS.filter((l) => l !== BASE)) {
    const dict = loadLang(lang);
    const missing = baseKeys.filter((k) => !own(dict, k));
    const extra = Object.keys(dict).filter((k) => !own(base, k));
    const shapes = baseKeys.filter((k) => own(dict, k))
      .flatMap((k) => shapeProblems(base[k], dict[k]).map((p) => `${k}: ${p}`));
    if (missing.length || extra.length || shapes.length) {
      failed = true;
      console.log(`FAIL ${lang}`);
      missing.forEach((k) => console.log(`  falta: ${k}`));
      extra.forEach((k) => console.log(`  sobra: ${k}`));
      shapes.forEach((s) => console.log(`  forma: ${s}`));
    } else if (!quiet) {
      console.log(`OK ${lang} (${baseKeys.length} claves)`);
    }
  }
  return { failed, count: baseKeys.length };
}

function checkUntranslated() {
  const base = loadLang(BASE);
  // "*": claves que solo tienen marcadores (iguales en todo idioma); "<idioma>": palabras que ese idioma comparte con el español
  const allowedFor = (lang) => new Set([...(allowlist.untranslated['*'] || []), ...(allowlist.untranslated[lang] || [])]);
  const failures = [];
  for (const lang of EXTRA) {
    const dict = loadLang(lang);
    const allowed = allowedFor(lang);
    for (const [key, value] of Object.entries(base)) {
      if (!allowed.has(key) && JSON.stringify(dict[key]) === JSON.stringify(value)) failures.push(`${lang}: ${key}`);
    }
  }
  failures.forEach((f) => console.log(`  sin traducir: ${f}`));
  console.log(failures.length ? `untranslated FAIL (${failures.length})` : 'untranslated OK (0)');
  return failures.length > 0;
}

// ---------- Literales en JS ----------

const REGEX_PREV = /[(,=:[!&|?{};+\-*%<>~^]|^$|\breturn$|\btypeof$/;

/** Devuelve [{ text, line }] con los literales de cadena y las partes fijas de las plantillas. */
function jsLiterals(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let prev = ''; // último token significativo, para distinguir regex de división
  const braces = []; // pila: 'tpl' si la llave abre una expresión ${…} de plantilla

  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) if (src[i++] === '\n') line++;
  };
  const readTemplateChunk = () => { // desde justo después de ` o de }, hasta ` o ${
    let text = '';
    const start = line;
    while (i < src.length) {
      if (src[i] === '\\') { text += src[i + 1]; advance(2); continue; }
      if (src[i] === '`') { advance(); out.push({ text, line: start }); prev = 'str'; return; }
      if (src[i] === '$' && src[i + 1] === '{') { advance(2); out.push({ text, line: start }); braces.push('tpl'); prev = '{'; return; }
      text += src[i]; advance();
    }
  };

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') advance(); continue; }
    if (c === '/' && n === '*') { advance(2); while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance(); advance(2); continue; }
    if (c === '\'' || c === '"') {
      const start = line;
      let text = '';
      advance();
      while (i < src.length && src[i] !== c && src[i] !== '\n') {
        if (src[i] === '\\') { text += src[i + 1]; advance(2); continue; }
        text += src[i]; advance();
      }
      advance();
      out.push({ text, line: start });
      prev = 'str';
      continue;
    }
    if (c === '`') { advance(); readTemplateChunk(); continue; }
    if (c === '/' && REGEX_PREV.test(prev)) { // literal de regex: se salta entero
      advance();
      let inClass = false;
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\') { advance(2); continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        advance();
      }
      advance();
      while (/[a-z]/i.test(src[i] || '')) advance();
      prev = 'regex';
      continue;
    }
    if (c === '{') { braces.push('code'); prev = '{'; advance(); continue; }
    if (c === '}') {
      advance();
      if (braces.pop() === 'tpl') readTemplateChunk();
      else prev = '}';
      continue;
    }
    if (/\s/.test(c)) { advance(); continue; }
    if (/[\w$]/.test(c)) {
      let word = '';
      while (i < src.length && /[\w$]/.test(src[i])) { word += src[i]; advance(); }
      prev = word === 'return' || word === 'typeof' ? word : 'id';
      continue;
    }
    prev = c;
    advance();
  }
  return out;
}

// ---------- Literales en HTML ----------

const blank = (m) => m.replace(/[^\n]/g, ' ');
const ATTRS_RE = /\b(?:title|aria-label|placeholder|alt)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/**
 * Textos de un fragmento con HTML, con la misma regla que los archivos .html: el texto visible y
 * los valores de title, aria-label, placeholder y alt. Las etiquetas, clases, rutas y atributos de
 * datos (<del>, href="/docente/equipo.html", data-decision="devolver") no son texto de interfaz.
 * Un trozo de plantilla puede empezar o terminar a mitad de una etiqueta.
 */
// Una etiqueta empieza por "<" + letra, "/" o "!"; un "<" suelto ("Menos < de 5") no es marcado
const TAG_RE = /<\/?[a-zA-Z!][^>]*>/g;
const TAG_OPEN_AT_END_RE = /<\/?[a-zA-Z!][^>]*$/;
// Trozo que empieza dentro de una etiqueta: cierra un atributo ("), sigue con otro (` x=`) o cierra (`>`)
const TAG_TAIL_RE = /^(?:["']|\s*\/?>|\s+[\w:-]+=)/;

function htmlTexts(fragment) {
  const texts = [...fragment.matchAll(ATTRS_RE)].map((m) => m[2] ?? m[3]);
  let visible = fragment.replace(TAG_RE, ' ').replace(TAG_OPEN_AT_END_RE, ' ');
  if (TAG_TAIL_RE.test(visible)) visible = visible.replace(/^[^<]*?>/, ' ');
  texts.push(visible.replace(/&nbsp;|&middot;|&amp;|&[a-z]+;/g, ' '));
  return texts;
}

/** Un literal de JS que contiene marcado HTML se revisa como HTML; si no (p. ej. un "<" suelto), entero. */
const isHtmlFragment = (text) => /<\/?[a-zA-Z!]/.test(text) || (TAG_TAIL_RE.test(text) && text.includes('>'));
const jsLiteralIsSpanish = (text) => (isHtmlFragment(text) ? htmlTexts(text).some(isSpanish) : isSpanish(text));

function htmlLiterals(src) {
  const cleaned = src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank);
  const out = [];
  cleaned.split('\n').forEach((raw, idx) => {
    if (/data-i18n(-attr)?\s*=/.test(raw)) return;
    htmlTexts(raw).filter(isSpanish).forEach((text) => out.push({ text: text.trim(), line: idx + 1 }));
  });
  return out;
}

function checkLiterals(files) {
  const failures = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, path.resolve(file));
    const found = file.endsWith('.html') ? htmlLiterals(src) : jsLiterals(src).filter((l) => jsLiteralIsSpanish(l.text));
    found.forEach((l) => failures.push(`${rel}:${l.line}: ${l.text.trim().slice(0, 100)}`));
  }
  failures.forEach((f) => console.log(`  ${f}`));
  return failures.length;
}

function publicFiles(dir = PUBLIC) {
  return fs.readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) return full === I18N ? [] : publicFiles(full);
    return /\.(html|js)$/.test(f) ? [full] : [];
  });
}

// ---------- Códigos del servidor y locales fijos ----------

const SERVER = path.join(ROOT, 'server');
const CORE_I18N = path.join(PUBLIC, 'js', 'core', 'i18n.js');
const jsFiles = (dir) => fs.readdirSync(dir).flatMap((f) => {
  const full = path.join(dir, f);
  if (fs.statSync(full).isDirectory()) return full === I18N ? [] : jsFiles(full);
  return f.endsWith('.js') ? [full] : [];
});
const rel = (file) => path.relative(ROOT, file);

/**
 * Todo `code: 'X'` del servidor y del front tiene errors.X, y todo msgKey del servidor tiene
 * notif.<msgKey>.title y .body. Si faltara, el front caería en silencio al español del servidor.
 */
function checkCodes() {
  const base = loadLang(BASE);
  const failures = [];
  for (const file of [...jsFiles(SERVER), ...jsFiles(path.join(PUBLIC, 'js'))]) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\bcode: '([A-Z_]+)'/g)) {
        if (!own(base, `errors.${m[1]}`)) failures.push(`${rel(file)}:${i + 1}: errors.${m[1]}`);
      }
      if (!/\bmsgKey:/.test(line)) return;
      for (const m of line.matchAll(/'([a-z]+\.[a-zA-Z]+)'/g)) {
        ['title', 'body'].filter((part) => !own(base, `notif.${m[1]}.${part}`))
          .forEach((part) => failures.push(`${rel(file)}:${i + 1}: notif.${m[1]}.${part}`));
      }
    });
  }
  failures.forEach((f) => console.log(`  sin traducción: ${f}`));
  console.log(failures.length ? `codes FAIL (${failures.length})` : 'codes OK (0)');
  return failures.length > 0;
}

/**
 * Ningún archivo del front fija un locale ('es-CO', "en-US"…). La única excepción son las entradas
 * `locale: "…"` de la tabla LANGS en core/i18n.js; un formato de ese mismo archivo no se libra.
 */
function checkLocales() {
  const failures = [];
  for (const file of jsFiles(path.join(PUBLIC, 'js'))) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(locale:\s*)?['"`]([a-z]{2}-[A-Z]{2})['"`]/g)) {
        if (!(file === CORE_I18N && m[1])) failures.push(`${rel(file)}:${i + 1}: ${m[2]}`);
      }
    });
  }
  failures.forEach((f) => console.log(`  locale fijo: ${f}`));
  console.log(failures.length ? `locales FAIL (${failures.length})` : 'locales OK (0)');
  return failures.length > 0;
}

// ---------- CLI ----------

function main([cmd, ...args]) {
  if (cmd === 'keys') return checkKeys().failed ? 1 : 0;
  if (cmd === 'untranslated') return checkUntranslated() ? 1 : 0;
  if (cmd === 'codes') return checkCodes() ? 1 : 0;
  if (cmd === 'locales') return checkLocales() ? 1 : 0;
  if (cmd === 'literals') {
    if (!args.length) { console.log('Uso: i18n-check.js literals <archivos…>'); return 1; }
    const n = checkLiterals(args);
    console.log(`${n} literales`);
    return n ? 1 : 0;
  }
  if (cmd === undefined) {
    const keys = checkKeys({ quiet: true });
    console.log(keys.failed ? 'keys FAIL' : `keys OK (${LANGS.length} idiomas, ${keys.count} claves)`);
    const n = checkLiterals(publicFiles());
    console.log(n ? `literals FAIL (${n})` : 'literals OK (0)');
    const codesFailed = checkCodes();
    const localesFailed = checkLocales();
    return keys.failed || n || codesFailed || localesFailed ? 1 : 0;
  }
  console.log(`Subcomando desconocido: ${cmd}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
