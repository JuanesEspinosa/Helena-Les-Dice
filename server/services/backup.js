// Copias de seguridad (RF-19, RNF-17): volcado SQL en JS puro, comprimido con gzip
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { pool, one } = require('../db');
const { HttpError } = require('../http');

const gzip = promisify(zlib.gzip);

const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');
const MIN_FREE_BYTES = 50 * 1024 * 1024; // 50 MB
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000; // revisa cada hora
const NO_SPACE_MSG = 'Espacio insuficiente en el servidor para generar el archivo comprimido.';

/** Tablas de la aplicación en orden de dependencias (db/schema.sql). Se excluye `session`. */
const TABLES = [
  'users', 'password_resets', 'periods', 'teams', 'team_members', 'levels', 'level_sections',
  'sections', 'section_versions', 'comments', 'activity_log', 'notifications', 'achievements',
  'team_achievements', 'backups',
];

const RAW_TYPES = new Set(['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision']);

const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Convierte un valor (leído como texto) en literal SQL según el tipo de la columna. */
function literal(client, value, type) {
  if (value === null) return 'NULL';
  if (type === 'boolean') return value === 't' || value === 'true' ? 'TRUE' : 'FALSE';
  if (RAW_TYPES.has(type) && /^-?\d+(\.\d+)?$/.test(value)) return value;
  return client.escapeLiteral(value); // texto, fechas, enums: PostgreSQL convierte el literal al insertar
}

async function tableColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

/** Genera los INSERT de una tabla. Los valores se leen como texto para no perder precisión ni zona horaria. */
async function dumpTable(client, table) {
  const cols = await tableColumns(client, table);
  const names = cols.map((c) => client.escapeIdentifier(c.column_name));
  const select = cols.map((c) => `t.${client.escapeIdentifier(c.column_name)}::text`).join(', ');
  const order = cols.some((c) => c.column_name === 'id') ? ' ORDER BY t.id' : ''; // t.id: el id numérico, no su texto
  const { rows } = await client.query({ text: `SELECT ${select} FROM ${client.escapeIdentifier(table)} t${order}`, rowMode: 'array' });
  const head = `INSERT INTO ${client.escapeIdentifier(table)} (${names.join(', ')}) VALUES `;
  const lines = rows.map((r) => `${head}(${r.map((v, i) => literal(client, v, cols[i].data_type)).join(', ')});`);
  return [`-- Tabla ${table}: ${rows.length} filas`, ...lines, ''].join('\n');
}

/** Ajusta cada secuencia al mayor id restaurado. */
async function sequenceLines(client) {
  const out = [];
  for (const table of TABLES) {
    const cols = await tableColumns(client, table);
    if (!cols.some((c) => c.column_name === 'id')) continue;
    out.push(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false);`);
  }
  return out;
}

/** Volcado completo dentro de una transacción de solo lectura (instantánea coherente). */
async function buildDump() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query(`SET LOCAL DateStyle = 'ISO, YMD'`);
    await client.query(`SET LOCAL TimeZone = 'UTC'`);
    const parts = [
      `-- Copia de seguridad de Helena les dice`,
      `-- Generada: ${new Date().toISOString()}`,
      `-- Se restaura sobre un esquema recién creado con db/schema.sql (psql -f db/schema.sql y luego este archivo).`,
      '',
      'BEGIN;',
      "SET client_encoding = 'UTF8';",
      "SET TimeZone = 'UTC';",
      '',
    ];
    for (const table of TABLES) parts.push(await dumpTable(client, table));
    parts.push('-- Secuencias', ...(await sequenceLines(client)), '', 'COMMIT;', '');
    await client.query('COMMIT');
    return parts.join('\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Lanza ENOSPC si el disco tiene menos de 50 MB libres (cuando fs.statfs existe). */
async function checkFreeSpace() {
  if (typeof fs.promises.statfs !== 'function') return;
  const st = await fs.promises.statfs(BACKUP_DIR);
  if (Number(st.bavail) * Number(st.bsize) < MIN_FREE_BYTES) {
    const err = new Error(NO_SPACE_MSG);
    err.code = 'ENOSPC';
    throw err;
  }
}

async function recordBackup({ kind, userId, filename = null, size = null, status, error = null }) {
  return one(
    `INSERT INTO backups (kind, created_by, filename, size_bytes, status, error)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [kind, userId || null, filename, size, status, error]
  );
}

/**
 * Genera una copia y registra la fila en `backups`.
 * @param {{ kind: 'manual'|'automatica', userId?: number }} opts
 * @returns {Promise<{ id: number, filename: string, size_bytes: number }>}
 */
async function createBackup({ kind, userId = null }) {
  const filename = `helena-${kind}-${stamp()}.sql.gz`;
  const file = path.join(BACKUP_DIR, filename);
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    await checkFreeSpace();
    const data = await gzip(Buffer.from(await buildDump(), 'utf8'));
    await fs.promises.writeFile(file, data, { flag: 'wx' });
    const row = await recordBackup({ kind, userId, filename, size: data.length, status: 'exitosa' });
    return { id: row.id, filename, size_bytes: data.length };
  } catch (err) {
    await fs.promises.rm(file, { force: true }).catch(() => {});
    const noSpace = err.code === 'ENOSPC';
    const message = noSpace ? NO_SPACE_MSG : `No se pudo generar la copia: ${err.message}`;
    await recordBackup({ kind, userId, status: 'fallida', error: message }).catch((e) => console.error('[backup] no se pudo registrar el fallo:', e.message));
    if (noSpace) throw new HttpError(507, NO_SPACE_MSG);
    throw err;
  }
}

/** Ruta absoluta de un archivo de copia, o null si el nombre no es seguro o no existe. */
function backupFilePath(filename) {
  if (typeof filename !== 'string' || !/^[\w.-]+\.sql\.gz$/.test(filename) || path.basename(filename) !== filename) return null;
  const file = path.join(BACKUP_DIR, filename);
  return fs.existsSync(file) ? file : null;
}

/** Fecha de la última copia automática exitosa (o null). */
async function lastAutomatic() {
  const row = await one(`SELECT MAX(created_at) AS at FROM backups WHERE kind = 'automatica' AND status = 'exitosa'`);
  return row && row.at ? new Date(row.at) : null;
}

let running = false;
async function runIfDue() {
  if (running) return;
  running = true;
  try {
    const last = await lastAutomatic();
    if (!last || Date.now() - last.getTime() > WEEK_MS) await createBackup({ kind: 'automatica' });
  } catch (err) {
    console.error('[backup] la copia automática falló:', err.message);
  } finally {
    running = false;
  }
}

/** Copia automática semanal: revisa al arrancar y luego cada hora. Nunca tumba el servidor. */
function scheduleWeekly() {
  setTimeout(runIfDue, 10 * 1000).unref();
  setInterval(runIfDue, CHECK_EVERY_MS).unref();
}

module.exports = { createBackup, scheduleWeekly, backupFilePath, lastAutomatic, BACKUP_DIR, WEEK_MS };
