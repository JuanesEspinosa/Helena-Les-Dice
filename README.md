# Helena les dice

Plataforma web educativa, por niveles y con gamificación, para la asignatura **Gestión de proyectos TI**
(Politécnico Colombiano Jaime Isaza Cadavid). Implementa los RF-01 a RF-19 del SRS (IEEE 830).

- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL
- **Frontend:** HTML, CSS y JavaScript sin frameworks

## Requisitos

- Node.js 18 o superior
- PostgreSQL 14 o superior (probado con la 17)

## Instalación

```bash
# 1. Dependencias
npm install

# 2. Crear una base de datos dedicada (pide la contraseña del usuario postgres)
createdb -U postgres helena
#    o desde pgAdmin: clic derecho en Databases → Create → Database… → "helena"

# 3. Configuración
cp .env.example .env
#    edita DATABASE_URL con tu contraseña y cambia SESSION_SECRET

# 4. Crear las tablas y cargar los datos de ejemplo
npm run db:reset

# 5. Arrancar
npm start          # o: npm run dev (se reinicia al guardar)
```

Abre http://localhost:3000

> ⚠️ `npm run db:reset` borra y recrea todas las tablas de la aplicación. Úsalo solo sobre la base `helena`.

## Tests

```bash
npm test
```

Prueban la API de punta a punta (login y bloqueo, permisos por rol, flujo de una sección con autoguardado, envío, devolución y aprobación, comentarios, administración de usuarios y reordenar niveles). Usan `node:test`, sin dependencias extra (requieren Node 21 o superior).

Corren contra una base aparte, `helena_test`, que se crea sola si no existe y se **borra y recrea en cada corrida**; tu base `helena` no se toca. Para usar otra base define `TEST_DATABASE_URL`.

No cubren los gestos del navegador (arrastrar con el mouse, el temporizador de 2 minutos): sí cubren los endpoints que esos gestos llaman.

## Cuentas de ejemplo

Todas usan la contraseña **`Helena2026`**.

| Rol | Correo |
|---|---|
| Administrador | admin@elpoli.edu.co |
| Docente | gladys.restrepo@elpoli.edu.co |
| Estudiante (Equipo 3) | laura.gomez@elpoli.edu.co · camila.rios@… · andres.perez@… · mateo.torres@… |

## Estructura

```
db/
  schema.sql        tablas, restricciones y trigger del registro inmodificable
  init.js           ejecuta schema.sql
  seed.js           datos de ejemplo
server/
  index.js          servidor, sesiones, cierre por inactividad, manejo de errores
  db.js             conexión y transacciones
  http.js           errores HTTP y validaciones
  middleware/       autenticación y roles
  services/         lógica de negocio (avance, secciones, logros, actividad, copias)
  routes/           API: auth, account, sections, student, teacher, admin
public/
  css/app.css       sistema visual (colores POLI, Open Sans, componentes)
  js/core/          cliente de la API, utilidades de interfaz y estructura común
  js/pages/         lógica de cada pantalla
  *.html            login, recuperar, perfil, notificaciones, editor
  estudiante/ docente/ admin/   pantallas por rol
backups/            copias de seguridad generadas (.sql.gz)
```

## Idiomas

La interfaz está en español (por defecto), inglés, portugués de Brasil, francés, alemán e italiano. Antes de iniciar sesión el idioma se guarda en el navegador; después, en la cuenta (`users.lang`). Si falta una clave en un idioma, se muestra en español.

- **Diccionarios:** `public/js/i18n/<idioma>/<área>.json` (áreas `common`, `access`, `student`, `teacher`, `admin`, `errors`, `notif`). El español (`es`) es la fuente de verdad.
- **Añadir una clave:** escríbela en `es` y en los otros cinco idiomas, y úsala con `t('área.vista.clave', { variable })` (o `data-i18n="clave"` en el HTML). Los plurales son objetos `{ "one": "…", "other": "…" }` que se eligen por `count`.
- **Errores del servidor:** cada error lleva un `code` estable; su texto vive en `errors.json` (`errors.<CODE>`). El mensaje en español del servidor queda como respaldo.
- **Añadir un idioma:** agrega su código y locale en `LANGS` (`public/js/core/i18n.js`) y en el `CHECK` de `users.lang` (`db/schema.sql` y `db/migrate.js`), y crea su carpeta de diccionarios.
- **Verificar:** `npm run i18n:check` revisa que los 6 idiomas tengan las mismas claves, con los mismos marcadores `{x}` y plurales con `other`; que no haya texto en español escrito en el código; que cada `code` y `msgKey` del código tenga traducción; y que ningún formato fije un locale fuera de la tabla `LANGS`. `node scripts/i18n-check.js untranslated` lista lo que quedó igual al español (las excepciones por idioma están en `public/js/i18n/allowlist.json`).
- **Base de datos existente:** `npm run db:migrate` aplica el `CHECK` de idiomas y las columnas nuevas de avisos sin borrar datos (se puede correr varias veces).

## Notas

- **Recuperación de contraseña (RF-13):** no hay servidor de correo configurado, así que el enlace de
  recuperación se imprime en la consola del servidor. Para enviarlo por correo, integra un servicio SMTP
  (por ejemplo, nodemailer) en `server/routes/auth.js`.
- **Copias de seguridad (RF-19, RNF-17):** se hacen con un volcado SQL en JavaScript comprimido con gzip,
  sin depender de `pg_dump`. Para restaurar una copia: crea una base vacía, ejecuta `db/schema.sql` y luego
  el archivo descomprimido.
- **Registro de actividad (RF-08, RNF-08):** un trigger de PostgreSQL impide modificar o borrar sus filas.
- **HTTPS (RNF-06):** lo da el hosting (Render, Railway, etc.). Define `NODE_ENV=production` para que la
  cookie de sesión sea segura.
