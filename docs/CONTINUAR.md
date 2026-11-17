# Para continuar en una sesión nueva (traspaso del 17/11/2026)

Leé esto, `CLAUDE.md`, `docs/BACKLOG.md` (arriba de todo) y `docs/CHANGELOG.md` (las 5 primeras entradas). Con eso alcanza:
no hace falta el historial de la sesión anterior.

## Dónde se trabaja
- Rama de trabajo: `ocultar-montos` (tiene todo lo publicado hasta el PR #92).
- Railway publica la rama `ccr-0b4be8d6-1sld7s`. Tienda: https://gabostore.lat

## Reglas del dueño que siguen vigentes (además de CLAUDE.md)
- Prohibido quitar funciones, botones, módulos, rutas, permisos, registros o información sin su autorización explícita.
- Prohibido borrar o reiniciar datos, tocar `/data` en producción, cambiar `GS_DATA_KEY`, correr seeds sobre datos reales,
  reemplazar módulos por demostraciones, o publicar sin su «Publicá» de ese momento.
- Antes de tocar datos reales: respaldo actualizado de lo que se va a tocar y probar con un solo registro.
- Nunca escribir en archivos las contraseñas que comparta en el chat. No poner teléfonos ni datos personales en `docs/`.

## Cómo se publica (solo con «Publicá»)
1. `npm test` en verde (las que fallan por tiempo con la máquina cargada se corren solas: ver «Pruebas inestables»).
2. `git fetch origin ccr-0b4be8d6-1sld7s ocultar-montos`; comprobar que el árbol de producción es igual al de un commit
   de `ocultar-montos` (`git rev-parse origin/ccr-0b4be8d6-1sld7s^{tree}` contra `git log --format='%h %T'`).
3. `git merge -s ours origin/ccr-0b4be8d6-1sld7s` (sin cambiar archivos) y push.
4. Foto de los datos reales antes: GET de `/api/admin/{assignments,customers,accounts,resellers,products}` en
   `https://tienda-production-8c7b.up.railway.app` con `authorization: Bearer gsa_dummy` (la llave del asistente la pone el proxy).
5. PR de `ocultar-montos` hacia `ccr-0b4be8d6-1sld7s`, fusionar con *squash* y `expectedHeadSha`.
6. Esperar el despliegue de Railway (estado SUCCESS del commit fusionado).
7. Foto después y comparar (mismas cantidades, ningún campo cambiado); páginas `/`, `/tienda/`, `/panel.html`, `/hub/` en 200.
8. Anotar «PR #N publicado» en `CHANGELOG.md` y `BACKLOG.md`.

## Pruebas inestables (pasan solas; fallan a veces con la máquina cargada)
`ficha`, `hub-inicio-simple`, `codigos-solos`, `mes-calendario` («entra en 360 px»), `revendedor-cuaderno-pantallas`.

## Pendientes del dueño (no se pueden hacer sin él)
- Banco: cuál recibe los pagos por QR y un correo de ejemplo de su aviso de pago (con datos tapados), para el
  «Paso 1: ✅ Llegó al banco» (marcar el pedido) y después, quizá, aprobar solo con monto único y remitente verificado.
- WhatsApp oficial (Meta): hoy apagado; falta la clave de acceso y la clave secreta de la app. 13 mensajes en espera.
- Invitar a los revendedores sin PIN (Inicio → «▶ Invitarlos ahora») y revisar el Gmail con error del Panel de códigos.
- Aplicar los precios del día (Productos → «💲 Precios del día»), cambiar claves de las cuentas apartadas.

## Avisos diarios programados
«Avisos diarios de vencimientos» y «Secretaria: resumen del mediodía»: solo leen la tienda real y arman mensajes de
WhatsApp sin mandarlos.
