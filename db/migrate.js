// Actualiza una BD existente al esquema actual sin borrar datos (db:init borra y recrea todo).
// Idempotente: se puede correr varias veces. Uso: npm run db:migrate
const { pool, tx } = require('../server/db');

const LANGS_SQL = "('es', 'en', 'pt', 'fr', 'de', 'it')";

const STEPS = [
  // Hoy solo puede haber 'es'/'en', así que no se pierde ningún valor
  `UPDATE users SET lang = 'es' WHERE lang NOT IN ${LANGS_SQL}`,
  `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_lang_check,
     ADD CONSTRAINT users_lang_check CHECK (lang IN ${LANGS_SQL})`,
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS msg_key VARCHAR(60),
     ADD COLUMN IF NOT EXISTS params JSONB NOT NULL DEFAULT '{}'`,
];

(async () => {
  try {
    await tx(async (client) => {
      for (const sql of STEPS) await client.query(sql);
    });
    console.log('Migración aplicada correctamente.');
  } catch (err) {
    console.error('No se pudo aplicar la migración:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
