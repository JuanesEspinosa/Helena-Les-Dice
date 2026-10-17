// Crea (o recrea) todas las tablas ejecutando db/schema.sql
const fs = require('fs');
const path = require('path');
const { pool } = require('../server/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Esquema creado correctamente.');
  } catch (err) {
    console.error('No se pudo crear el esquema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
