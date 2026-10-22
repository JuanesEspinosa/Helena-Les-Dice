// Utilidades de los tests: BD de prueba aislada, servidor en un puerto libre y cliente HTTP con cookie
require('dotenv').config();
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const TEST_DB = 'helena_test';
const PASSWORD = 'Helena2026';
const STARTUP_TIMEOUT_MS = 15000;

/** URL de la BD de prueba: TEST_DATABASE_URL o la de .env con otro nombre de base. */
function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en .env');
  const url = new URL(process.env.DATABASE_URL);
  if (url.pathname.slice(1) === TEST_DB) throw new Error('DATABASE_URL ya apunta a la BD de prueba');
  url.pathname = '/' + TEST_DB;
  return url.toString();
}

/** Crea la BD de prueba si no existe. */
async function ensureDatabase(dbUrl) {
  const url = new URL(dbUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

/** Corre un script de db/ contra la BD de prueba y falla si termina con error. */
function runDbScript(script, env) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'db', script)], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`db/${script} falló:\n${r.stdout}\n${r.stderr}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

/** Recrea esquema + datos semilla en helena_test y arranca el servidor. Devuelve { base, stop }. */
async function startApp() {
  const dbUrl = testDatabaseUrl();
  await ensureDatabase(dbUrl);
  const port = await freePort();
  const env = { ...process.env, DATABASE_URL: dbUrl, PORT: String(port), APP_URL: `http://localhost:${port}` };
  runDbScript('init.js', env);
  runDbScript('seed.js', env);

  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { env });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${output}`)), STARTUP_TIMEOUT_MS);
    const onData = (d) => {
      output += d;
      if (output.includes('escuchando')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`El servidor terminó (${code}):\n${output}`)); });
  });
  child.removeAllListeners('exit');

  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
  return { base: `http://localhost:${port}`, stop, output: () => output };
}

/** Cliente con su propia cookie de sesión. */
function client(base) {
  let cookie = '';
  async function request(method, url, body) {
    const headers = { Cookie: cookie };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (url) => request('GET', url),
    post: (url, body = {}) => request('POST', url, body),
    put: (url, body = {}) => request('PUT', url, body),
    // Igual que public/js/core/api.js: el servidor exige JSON en toda petición que modifica datos
    del: (url) => request('DELETE', url, {}),
    login: (email, password = PASSWORD) => request('POST', '/api/auth/login', { email, password }),
  };
}

module.exports = { startApp, client, PASSWORD };
