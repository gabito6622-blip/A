---
name: gabostore-pruebas-eficientes
description: Resolver pruebas fallidas de Gabriel Store y verificar cambios con poco consumo de tokens, sin tocar datos reales ni mandar mensajes o cobros reales.
---

# Calidad con contexto mínimo

1. Leé `package.json` antes de correr nada: `npm test` compila (`tsc`) y corre `node --test` sobre `test/*.mjs`. No inventes comandos. Mirá `git status` y no pises trabajo sin guardar.
2. Corré primero la prueba que falla o la relacionada (`node --test test/<archivo>.mjs` después de `npm run build`), con salida corta (`grep -E "^# (pass|fail)|not ok"`). Buscá la causa y corregí lo mínimo; no reescribas el módulo.
3. Las pruebas usan carpetas temporales (`mkdtempSync`) y `createApp({ jobs: false })`. Nunca apuntes una prueba a `data/`, `data-demo/` ni a la base de producción.
4. Para cambios sensibles agregá pruebas de regresión: perfiles que no se venden dos veces, saldo y movimientos, aprobación de pagos, cupones, permisos por rol, aislamiento entre revendedores, cifrado de contraseñas y CSP.
5. Todo lo externo va con dobles: `fetchImpl` falso para WhatsApp/Meta, Telegram, Binance y Web Push; `otpSender` falso. Nada de mensajes, cobros ni avisos reales.
6. Para lo visual: `scripts/revision-celular.cjs` (360/390/768, claro y oscuro) y `scripts/revision-accesibilidad.cjs` (axe-core bajado aparte). Las capturas y `scan.json` van a una carpeta temporal, no al repo.
7. Resumí conteos y nombres de fallos; leé logs completos solo del fallo concreto. No corras agentes en paralelo sobre los mismos archivos.

Entrega: pruebas corridas, aprobadas/fallidas, causa corregida, archivos tocados y riesgos pendientes. No digas "listo" sin haberlas corrido.
