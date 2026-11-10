---
name: gabostore-aislamiento
description: Revisar la separación entre la tienda, GaboHub y las páginas de revendedores de Gabriel Store: roles, precios de costo, datos de clientes, comprobantes y secretos.
---

# Revisión de aislamiento (dueño, staff, revendedores, clientes)

Fuentes: `src/store/auth.ts` (permisos por rol), `src/store/resellerShop.ts`, `src/store/portal.ts` y `src/server/app.ts`. No asumas que algo documentado está hecho: buscalo en el código y en `test/`.

1. Toda lectura o escritura resuelve quién es en el servidor (sesión → actor). Nunca confíes en `customerId`, rol, precio, total, descuento o cupón que mande el navegador.
2. Un revendedor solo ve y toca lo suyo: sus clientes, sus precios, su página y sus pedidos. Probá leer, crear, editar y borrar cruzado entre dos revendedores, y que `/api/shops/<slug>` nunca muestre precios de costo ni datos de otro.
3. Contraseñas de cuentas cifradas con `GS_DATA_KEY`; solo salen con `inventory.view_secrets` y quedan en auditoría. Comprobantes, logos y exportaciones con permiso.
4. Staff: vendedor, admin y dueño tienen permisos distintos (aprobar pagos, ajustar saldo, ver auditoría). Probalos con cada rol.
5. Límites y planes (página de revendedor, alquiler mensual, cupones por cliente) se validan en el servidor dentro de la transacción; un botón escondido no alcanza.
6. Nada de contraseñas, tokens ni datos personales en logs. No corras nada destructivo sobre datos reales.

Informá problemas por gravedad, con forma de reproducirlos y la prueba que los cubre. No afirmes "seguro" sin verificar.
