# Logo de la plataforma

Status: done
stage: verified

## Alcance
Reemplazar los marcadores "LOGO" por el logo oficial (Imagenes/helena en svg.png) en toda la plataforma.

## Completed
- public/img/: logo.png (640px), logo-sm.png (320px), favicon.png (64px), apple-touch-icon.png (180px). Recortados al contenido y cuantizados (de 245 KB a 40 KB el mayor).
- js/core/layout.js: el header de las 17 vistas autenticadas muestra el logo (52px de alto) en vez de "LOGO" + texto "Helena les dice"; alt="Helena les dice".
- index.html y recuperar.html: el h1 del panel verde es ahora el logo (alt conserva el nombre); se quitó el marcador punteado de la fila del Politécnico.
- css/app.css: .logo pasa de caja punteada a imagen.
- Las 19 páginas HTML enlazan favicon y apple-touch-icon.

## Verify
- curl de /img/*.png -> 200 image/png.
- Chrome 1366px: login y tablero de estudiante, logo visible. 390px: header sin scroll horizontal, logo cargado (94x52).
- npm test: ver salida en la sesión.
