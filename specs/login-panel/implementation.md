# Rediseño del panel izquierdo del login

Status: done
stage: verified

## Alcance
Solo el panel verde (`.auth__brand`) de index.html y recuperar.html (idénticos). El formulario derecho no se tocó.

## Completed
- Ruta de los 5 niveles (Introducción → Anexos) bajo el texto, como `<ol>` con aria-label; números en los colores del logo.
- Beneficios: tarjetas con ícono (amarillo/rosado/cian), título y una línea de descripción.
- Barra amarilla junto al nombre del Politécnico (reemplaza el hueco del marcador anterior).
- Tokens `--logo-*` en :root; estilos del panel movidos de los `<style>` duplicados de ambos HTML a `css/app.css`.
- Móvil (≤900px): se ocultan ruta y beneficios; logo a 220px.

## Verify
- Chrome 1366px: index.html y recuperar.html (capturas), panel sin huecos, tarjetas legibles.
- Chrome 390px: sin scroll horizontal; ruta oculta (display:none); h1 conserva alt "Helena les dice".
- Nota: durante la prueba PostgreSQL (servicio postgresql-x64-17) estaba detenido; las pantallas de acceso se verificaron en un contexto sin cookie. No relacionado con este cambio.
