---
name: gabostore-lanzamiento
description: Preparar la publicación o una actualización de Gabriel Store / GaboHub con respaldos, variables, pruebas en celular y lista de verificación, sin publicar ni tocar producción sin permiso.
---

# Preparar la salida, sin publicar por sorpresa

1. Revisá `git status`, la rama (se trabaja en ramas, no en `main`), `npm test` completo, `scripts/revision-celular.cjs` y `scripts/revision-accesibilidad.cjs`. Pasar pruebas no prueba estabilidad real.
2. Inventario de producción (ver `docs/PUBLICAR.md`): dominio y HTTPS, `GS_PUBLIC_ORIGIN`, `GS_DATA_KEY` guardada aparte, volumen persistente en `/data`, `GS_TRUST_PROXY`, claves opcionales (WhatsApp/Meta, Telegram, Binance, VAPID). Ninguna clave en el repo.
3. Respaldos: confirmá el respaldo diario y la copia al Gmail; probá restaurar un respaldo con datos de prueba, nunca sobre la base real. Escribí el plan para volver atrás antes de cambios de datos.
4. Pruebas de punta a punta en celular: compra con QR → comprobante → aprobación → entrega en Mis cuentas; compra con saldo; venta manual con cupón; revendedor con su página `/r/<slug>`; vista previa al compartir por WhatsApp.
5. Seguridad: CSP sin scripts en línea, cookies seguras con HTTPS, 2FA del dueño, auditoría activa, webhooks firmados (Meta, Binance).
6. No hagas push a `main`, merge, despliegue en Railway, cambios de DNS, cobros ni mensajes reales sin que el dueño lo diga con todas las letras ("Publicá").

Entregá una lista con bloqueantes, evidencia y opcionales. No digas "listo para vender" con bloqueantes abiertos.
