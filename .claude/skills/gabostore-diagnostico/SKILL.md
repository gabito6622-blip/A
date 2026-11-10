---
name: gabostore-diagnostico
description: Diagnosticar Gabriel Store / GaboHub cuando el servidor no arranca, el panel o la tienda quedan en blanco, se cierra la sesión o una pantalla carga sin fin.
---

# Diagnóstico de la tienda y el panel

Trabajá sobre evidencia, no supongas la causa. Leé primero `README.md`, `src/server/main.ts` (variables de entorno) y solo los archivos del síntoma.

1. Ubicá el síntoma exacto: el proceso no arranca (Node 22, `npm run build`), puerto ocupado, HTTP 4xx/5xx de `/api/...`, sesión vencida (401), CSP que bloquea algo (consola: "Refused to"), o error de JavaScript en `public/*.js`.
2. Probá por separado el servidor (`curl -sI http://localhost:8090/api/health`) y el navegador. Para el navegador usá Playwright (ya viene instalado) y juntá errores de consola y `pageerror`; no adivines desde el código.
3. Los datos viven en la carpeta de `GS_DATA_DIR` (`gabriel.db` + `uploads/`). Para reproducir, copiá `data-demo` a una carpeta temporal y levantá otro puerto. Nunca borres ni edites la base real, los comprobantes ni los respaldos; si hay que tocar algo, primero respaldo.
4. Sin `GS_DATA_KEY` correcta no se leen las contraseñas de las cuentas: si "desaparecen", revisá esa variable antes que el código.
5. Reproducí una vez, aislá la causa, aplicá el cambio mínimo y verificá tienda (`/tienda/`), portada (`/`), una página `/r/<slug>` y el panel (`/panel.html`, login demo) sin alterar datos.
6. No reinicies servicios de producción (Railway), no cambies variables ni puertos en producción y no abras túneles sin permiso del dueño.

Entregá diagnóstico, evidencia, arreglo, verificación y pendientes en máximo ocho líneas, salvo que pidan detalle.
