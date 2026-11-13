# Plan: soporte completo de inglés (i18n)

stage: planned (no iniciado — pospuesto por decisión del usuario, 2026-10-23)

## Estado actual
- Ya existe: columna `users.lang` (es|en), `PATCH /account/lang` con validación, botón ES/EN del header que guarda y recarga, header + sidebar traducidos (`public/js/core/layout.js`, objetos `T` y `MENUS`).
- Falta: las 19 vistas (~4.000 líneas) tienen el español escrito en el código; el selector del login es solo visual (`wireLangToggle` en `login.js`); ~100 mensajes de error del servidor están en español; fechas relativas ("Hace 5 días") en español.

## Enfoque
- Módulo `public/js/core/i18n.js`: diccionarios `es`/`en`, `t('clave', vars)`, `getLang()` (usuario autenticado → `user.lang`; acceso → localStorage `helena.lang`), formateo de fechas con `Intl.RelativeTimeFormat`/`Intl.DateTimeFormat`.
- Diccionarios por área en `public/js/i18n/` (acceso, estudiante, docente, admin, comun) para no tener un archivo gigante.
- Servidor: añadir un `code` estable a `HttpError` (p. ej. `LANG_INVALID`) manteniendo `message` en español; el front traduce por `code` y cae al `message` si no hay traducción. No cambia BD ni autenticación.
- `<html lang>` se actualiza según el idioma activo (accesibilidad).

## Fases (cada una se verifica sola)
1. Infraestructura + acceso: `i18n.js`, login y recuperar (el selector deja de ser solo visual), mover `T`/`MENUS` de layout.js al diccionario.
2. Estudiante: tablero, integrantes, logros, historial, editor.
3. Docente: panel, equipos, equipo, niveles, comentarios.
4. Administrador: panel, usuarios, periodos, logros, backups + perfil y notificaciones.
5. Servidor y detalles: códigos de error, fechas relativas, textos de correos/notificaciones generados en backend.

## Verificación por fase
- Cambiar a EN y recorrer cada vista de la fase: ningún texto fijo en español (revisión visual + grep de cadenas con tildes en los archivos migrados).
- `npm test` en verde (15/15 o más).
- Volver a ES: sin regresiones.
