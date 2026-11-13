# Módulo activo en el sidebar

Status: done
stage: verified

## Causa
layout.js interpolaba `aria-current="page"` completo dentro del tag `html`, que escapa los valores: el DOM recibía `aria-current="&quot;page&quot;"` y el selector `.nav-link[aria-current='page']` nunca coincidía. Ningún módulo se resaltaba en ningún rol.

## Completed
- public/js/core/layout.js: el atributo va literal en la plantilla y solo se interpola el valor (`page` | `false`).
- Sin cambios en páginas: todas ya pasaban `active`; el editor ya marca su módulo por rol.

## Verify
- Chrome: estudiante/integrantes -> "Integrantes" resaltado (captura).
- docente/equipos -> solo "Equipos" con aria-current=page, fondo rgb(230,243,236); el resto false/transparente.
- admin/backups -> solo "Copias de seguridad" resaltado.
