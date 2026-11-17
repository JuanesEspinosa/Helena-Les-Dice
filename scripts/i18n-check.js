#!/usr/bin/env node
// Verificación de la internacionalización (sin dependencias).
//   node scripts/i18n-check.js keys                 mismo juego de claves en los 6 idiomas
//   node scripts/i18n-check.js literals [archivos…] ningún texto en español escrito en el código
//   node scripts/i18n-check.js untranslated         pt/fr/de/it no repiten el valor de es
//   node scripts/i18n-check.js                      keys + literals sobre todo public/
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

function checkKeys({ quiet = false } = {}) {
  const base = loadLang(BASE);
  const baseKeys = Object.keys(base);
  let failed = false;
  for (const lang of LANGS.filter((l) => l !== BASE)) {
    const dict = loadLang(lang);
    const missing = baseKeys.filter((k) => !(k in dict));
    const extra = Object.keys(dict).filter((k) => !(k in base));
    if (missing.length || extra.length) {
      failed = true;
      console.log(`FAIL ${lang}`);
      missing.forEach((k) => console.log(`  falta: ${k}`));
      extra.forEach((k) => console.log(`  sobra: ${k}`));
    } else if (!quiet) {
      console.log(`OK ${lang} (${baseKeys.length} claves)`);
    }
  }
  return { failed, count: baseKeys.length };
}

function checkUntranslated() {
  const base = loadLang(BASE);
  const allowed = new Set(allowlist.untranslated);
  const failures = [];
  for (const lang of EXTRA) {
    const dict = loadLang(lang);
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

function htmlLiterals(src) {
  const cleaned = src
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/<style\b[\s\S]*?<\/style>/gi, blank)
    .replace(/<script\b[\s\S]*?<\/script>/gi, blank);
  const out = [];
  cleaned.split('\n').forEach((raw, idx) => {
    if (/data-i18n(-attr)?\s*=/.test(raw)) return;
    const texts = [...raw.matchAll(ATTRS_RE)].map((m) => m[2] ?? m[3]);
    const visible = raw.replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, ' ').replace(/^[^<]*>/, ' ');
    texts.push(visible.replace(/&nbsp;|&middot;|&amp;|&[a-z]+;/g, ' '));
    texts.filter(isSpanish).forEach((text) => out.push({ text: text.trim(), line: idx + 1 }));
  });
  return out;
}

function checkLiterals(files) {
  const failures = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, path.resolve(file));
    const found = file.endsWith('.html') ? htmlLiterals(src) : jsLiterals(src).filter((l) => isSpanish(l.text));
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

// ---------- CLI ----------

function main([cmd, ...args]) {
  if (cmd === 'keys') return checkKeys().failed ? 1 : 0;
  if (cmd === 'untranslated') return checkUntranslated() ? 1 : 0;
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
    return keys.failed || n ? 1 : 0;
  }
  console.log(`Subcomando desconocido: ${cmd}`);
  return 1;
}

process.exitCode = main(process.argv.slice(2));
