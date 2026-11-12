# Instrucciones para Claude en este repositorio

Este archivo se lee solo al empezar cada sesión. Seguilo siempre, aunque el pedido sea corto («continuá», «sorprendeme»).

## Qué hay en el repositorio

| Proyecto | Dónde | Qué es | Pruebas |
|---|---|---|---|
| **Gabriel Store / GaboHub** | raíz: `src/store`, `src/server`, `public/`, `test/` | Tienda de suscripciones digitales para Bolivia (Bs) con panel del vendedor (GaboHub), revendedores con página propia `/r/<slug>`, saldo, QR con comprobante, códigos, WhatsApp oficial | `npm test`: compila y corre 484 pruebas en ~47 s |
| **Dentalia** | **no está en esta rama**: vive en `dental/` de la rama `claude/sharp-albattani-cc2tst` (con su propio `CLAUDE.md`) | SaaS odontológico multiclínica y multisucursal | ver `dental/CLAUDE.md` en esa rama |
| SDK VendePlay | `src/http.ts`, `src/resources`, `openapi.yaml`, `clients/python` | Cliente de la API de VendePlay, reconstruido por ingeniería inversa | `npm run validate:openapi` |

La CI (`.github/workflows/ci.yml`) corre en cada push dos trabajos:
- compilar, `npm test` y `npm run validate:openapi`;
- comprobar que el cliente Python se importe.

Otros scripts útiles en `scripts/`:
- `seed-demo.mjs`: datos de ejemplo de la tienda;
- `seed-reseller-demo.mjs`: un revendedor con meses de uso;
- `revision-celular.cjs` y `revision-accesibilidad.cjs`: capturas y revisión con Playwright contra el puerto 8090, o el de `BASE`.

## Reglas del dueño (no se negocian)

1. **Nada real:**
   - no mandes pagos, cobros, mensajes de WhatsApp, Telegram ni correos reales;
   - no crees cuentas de pago ni aceptes contratos.

   Todo lo externo va con dobles (`fetchImpl` falso, `otpSender` falso).
2. **Solo datos ficticios.** Nunca apuntes pruebas ni scripts a `data/`, a `data-demo/` ya en uso ni a una base de producción. Usá carpetas temporales (`mkdtempSync`).
3. **No publiques** ni toques producción (Railway, Render, dominio, DNS) sin un «Publicá» explícito del dueño en ese mismo momento. Una aprobación vieja no vale para otra publicación.

   Cómo se publica hoy:
   - Railway publica solo la rama `ccr-0b4be8d6-1sld7s`;
   - se abre un PR desde la rama de la sesión hacia esa rama y se fusiona con *squash*, solo después del «Publicá».

   Antes de cambiar datos reales del panel (con la llave del asistente), guardá un respaldo de lo que vas a tocar y probá primero con un solo registro.
4. **No digas «terminado» sin pruebas.** Corré `npm test` y mostrá el resultado. Si algo no se pudo probar, decilo.
5. **Separación entre revendedores:** un revendedor nunca ve los clientes, precios de costo, ganancias ni comprobantes de otro. Ante cualquier cambio en ese terreno, aplicá `/gabostore-aislamiento`.
6. **Secretos:**
   - no van al código ni al repositorio;
   - `GS_DATA_KEY` cifra las contraseñas de las cuentas: nunca la cambies ni la imprimas;
   - las contraseñas que el dueño comparta en el chat no se escriben en archivos, capturas ni informes.
7. **Licencias y marcas:**
   - no copies código ni interfaces de terceros;
   - nada de conectores de WhatsApp por QR no oficiales;
   - no afirmes cumplimiento legal sin verificación.
8. **No inventes:** ni funciones, ni datos, ni respuestas de una API que no viste. Si algo depende del dueño (precios, cuentas, decisiones), anotalo como pendiente y seguí con lo demás.

## Cómo se trabaja

1. **Antes de tocar:**
   - leé `git status`;
   - leé `docs/ESTADO_PARA_REVISION.md` (qué hace hoy la tienda) y `docs/IMPLEMENTATION_PLAN.md` (fases y riesgos);
   - leé la habilidad que encaje: tabla en `docs/HABILIDADES.md`.
2. **Celular primero:** la mayoría de los clientes y revendedores usa el celular. Seguí `/gabostore-ux-premium`:
   - botones de 44 px;
   - texto de 12 px o más;
   - fechas dd/mm;
   - voseo y español simple.
3. **Cambios chicos y probados:**
   - cada arreglo o función nueva lleva su prueba en `test/`;
   - corré primero el archivo afectado: `npm run build && node --test test/<archivo>.test.mjs`;
   - al final, `npm test` completo.
4. **Revisión visual** de lo que cambió, con datos de ejemplo:
   - preparar: `npm run build && node scripts/seed-demo.mjs <carpeta-temporal>`;
   - levantar: `GS_DATA_DIR=<carpeta> GS_STATIC_DIR=public PORT=8090 npm start`;
   - revisar: `node scripts/revision-celular.cjs <carpeta-temporal>` y `scripts/revision-accesibilidad.cjs`.

   Las capturas van fuera del repo.
5. **Trabajo grande (varias áreas a la vez):** usá `/gabostore-equipos`, que reparte el trabajo en equipos aislados, integra y prueba. Avisale al dueño antes que consume más uso de su cuenta.
6. **Al terminar cada tanda,** mantené al día en `docs/`:
   - `ROADMAP.md`: qué sigue;
   - `BACKLOG.md`: pendientes con prioridad;
   - `DECISIONES.md`: por qué se hizo así;
   - `CHANGELOG.md`: qué cambió;
   - `INFORME_PRUEBAS.md`: qué se probó, cómo y con qué resultado.

   Si alguno no existe todavía, crealo con lo que sepas de verdad, sin rellenar.
7. **Commits:**
   - mensajes en español que expliquen el porqué;
   - un tema por commit;
   - subí a la rama asignada a la sesión;
   - no abras pull requests salvo que el dueño lo pida.

## Cómo informar al dueño

El dueño no es programador:
- frases cortas y sin jerga;
- primero el resultado («Listo: …» o «No pude: …»), después lo que necesita decidir;
- números concretos: pruebas pasadas, tiempos medidos;
- lo que quedó pendiente por falta de algo suyo (cuentas, claves, decisiones) va en una lista aparte.
