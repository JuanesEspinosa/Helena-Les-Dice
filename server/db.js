// Conexión a PostgreSQL y utilidades de consulta
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el archivo .env (mira .env.example)');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

pool.on('error', (err) => console.error('[db] error inesperado en el pool:', err.message));

/** Ejecuta una consulta parametrizada y devuelve las filas. */
async function query(text, params = []) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Devuelve la primera fila o null. */
async function one(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

/**
 * Ejecuta `fn(client)` dentro de una transacción.
 * Si algo falla se hace ROLLBACK: así una acción nunca queda sin su registro de actividad (RF-08).
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, one, tx };
