---
name: gabostore-rendimiento
description: Mejorar la velocidad de la tienda, la portada y el panel de Gabriel Store midiendo antes y después, sin arriesgar stock, pagos ni la separación entre revendedores.
---

# Rendimiento basado en mediciones

1. Medí antes de tocar: tiempo de respuesta por ruta (`/api/...`), tamaño de `public/*.js` y `*.css`, peso de imágenes (logos, QR, comprobantes) y tiempo de pintado en un celular emulado con Playwright (red lenta 3G).
2. El estado vive en memoria y se guarda en SQLite en cada transacción: buscá recorridos completos repetidos (`Object.values(e.s.orders)` dentro de bucles), N+1 entre pedidos/perfiles/clientes y listas sin paginar.
3. Cambios de bajo riesgo primero: paginar listas largas del panel, caché HTTP para imágenes que no cambian, miniaturas, no repetir pedidos a la API al cambiar de vista, cortar trabajo del reloj de 60 s.
4. No caches stock, saldo, pagos, cupones, permisos ni datos de un revendedor que puedan verse en otro. La CSP y el `no-cache` de HTML/JS se mantienen.
5. Sin dependencias nuevas salvo justificación clara. Compará métricas antes/después y corré las pruebas afectadas (y todas si tocaste pedidos, saldo o inventario).

Informá una tabla corta: métrica antes, después, impacto, pruebas y riesgos que quedan.
