# Matriz de GaboHub (panel del revendedor)

Cada función de antes → dónde está ahora → qué prueba lo cubre. Regla del dueño: ninguna función se pierde.
Foto de controles antes y después (Ariana con página propia y un revendedor «solo panel», 390 px): todas las
pantallas y todos los botones y formularios de adentro son iguales. Solo cambió la navegación.

## Etapa 1 (12/11/2026, rama `hub-etapa1`): la forma del panel del dueño

| Antes | Ahora | Prueba |
|---|---|---|
| Barra de abajo: Inicio · Clientes · Comprar · Cuentas · Códigos | Inicio · Clientes · **Vender** · **Inventario** · **Más** | `hub-navegacion` |
| Comprar (precios de revendedor) | Vender → «Ver precios y comprar», Más → Saldo y compras, Inicio, barra de arriba (PC) | `hub-navegacion`, `revendedor-pantallas` |
| Cuentas (Mis cuentas y pedidos) | Inventario → «📺 Cuentas de la tienda» | `hub-navegacion`, `revendedor-pantallas` |
| Códigos | Más → Inventario, Inicio, barra de arriba (PC) | `revendedor-pantallas` |
| Saldo / Recargar | Vender, Más → Saldo y compras, Inicio, barra de arriba (PC) | `revendedor-pantallas` |
| Reportar falla | Más → Ayuda, Inicio | `revendedor-pantallas` |
| Mis clientes → fila de 10 pestañas (había que correrla de costado) | 3 grupos, cada uno con su fila completa a la vista: | |
| · Clientes y ventas, Mi control, Quién me debe, Mis ganancias | Clientes (abajo) → **Mi negocio** | `hub-navegacion`, `revendedor-pantallas` |
| · Repartir perfiles, Mis cuentas propias | Inventario (abajo) → junto a Cuentas de la tienda | `hub-navegacion`, `cuentas-propias` |
| · Mi página, Mis combos y descuentos, Mis cupones, Afiches | Más → **Mi vitrina** (y «🏪 Mi página» del Inicio) | `hub-navegacion`, `afuera-completo` |
| Atajos del Inicio («Tu negocio, sin Excel», «Tu día», Avisarles) | Iguales; llevan a la pestaña dentro de su grupo | `hub-navegacion`, `revendedor-pantallas` |
| — | **Vender**: elegir qué vender (cuenta de la tienda, cuenta propia, perfil de cuenta completa, renovar, comprar) | `hub-navegacion` |
| — | **Más**: todo el panel por áreas, con buscador sin tildes | `hub-navegacion` |
| Guía de los botones, Mi país y moneda | Inicio (igual) y Más → Ayuda | `hub-navegacion` |
