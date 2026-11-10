# Revisión de accesibilidad

Revisión automática con [axe-core](https://github.com/dequelabs/axe-core) 4.10.2 (reglas WCAG 2.0, 2.1 y 2.2, niveles A y AA)
sobre la tienda, la portada de GaboHub, las páginas legales, la recuperación de contraseña y **todas** las vistas del panel.

- Anchos: **375, 768 y 1440 px**, en **modo claro y oscuro** (222 pantallas por pasada).
- También revisa estados con ventanas abiertas: el carrito con un producto y la ventana de acceso de la tienda.
- En el panel abre las tarjetas plegadas, para revisar también lo que está adentro.

## Cómo correrla

axe-core **no** es dependencia del proyecto: se baja aparte, una sola vez.

```bash
npm pack axe-core@4.10.2 && tar xzf axe-core-4.10.2.tgz   # deja package/axe.min.js
npm run build && npm run seed:demo                          # datos de ejemplo
# levantá la tienda de ejemplo en el puerto 8090 y después:
AXE_JS=package/axe.min.js node scripts/revision-accesibilidad.cjs salida-axe
```

Deja `salida-axe/axe.json` con todo el detalle y muestra un resumen por regla.
Variables: `BASE`, `WIDTHS`, `THEMES`, `VIEWS`, `GS_USER`, `GS_PASS`.

## Resultado

| | Reglas con fallas | Elementos con fallas |
|---|---|---|
| Antes | 2 (`label`, `color-contrast`) | 377 |
| Después | **0** | **0** |

## Qué se corrigió

**Campo sin etiqueta (crítico)**
- Apariencia → “Segundo color”: el selector de color no tenía nombre para lectores de pantalla. Ahora tiene `aria-label`.

**Contraste de colores (serio)** — ~370 textos, por unas 15 causas que se repetían:

| Dónde | Antes | Después |
|---|---|---|
| Etiquetas verdes (“Publicado”, “1 libre”, “Activo”, avisos verdes) | verde `#0f8a4f` sobre verde claro: 3,8:1 | `#0a7040`: 5,3:1 |
| Botones azules en modo oscuro | blanco sobre `#5c7cfa`: 3,7:1 | `#4263eb`: 5,0:1 |
| Textos y enlaces azules en modo oscuro (menú de abajo, “Editar”, “Transferir”) | `#5c7cfa` sobre la tarjeta: 4,5:1 justo | color propio para texto `#8da2fb`: 6,8:1 |
| Estado “ACTIVO” en Control | blanco sobre `#22c55e`: 2,3:1 | `#15803d`: 5,0:1 |
| Botones verdes de WhatsApp (revendedores) | blanco sobre `#128c4a`: 4,3:1 | `#0f7a40`: 5,4:1 |
| Gris suave sobre fondos de color (claro) | `#5f6b7d`: 4,5:1 justo | `#4f5a6b`: 5,8:1 |
| Calendario de Inicio y tarjetas de Control en modo oscuro | fondos claritos con letra clara (1,4:1) | fondos oscurecidos con el color del estado |
| Ganancia y “mejor mes” en Finanzas/Dashboard, porcentaje de estrés | verdes claros sobre blanco: 2,5–2,6:1 | color de “ok” del tema |
| Marca del servicio (“AI”, “N”…) | siempre letra blanca (3,2:1 en ChatGPT) | blanca o negra, la que se lea sobre el color de la marca |
| “Aa” de las muestras de estilo (Rosa, Menta) | 2,4–2,8:1 | se ajusta solo hasta 3:1 (texto grande) |
| Términos, Privacidad (modo claro) | enlaces `#0b8ad8`: 3,5:1 | `#0369a1`: 5,6:1 |
| Recuperar contraseña / códigos | botón blanco sobre `#3984ff`: 3,6:1 | `#2563eb`: 5,2:1 |
| Portada GaboHub: “Mandar por WhatsApp” | blanco sobre `#1faa59`: 3,0:1 | `#15803d`: 5,0:1 |

Las pruebas `test/contrast.test.mjs` cuidan que las marcas y las muestras de estilo sigan leyéndose.

## Lo que una revisión automática no ve

axe encuentra más o menos un tercio de los problemas de accesibilidad. Falta revisar a mano, de vez en cuando:

- Usar el panel y la tienda **solo con teclado** (Tab, Enter, Escape) y que siempre se vea dónde está el foco.
- Probar con un **lector de pantalla** (TalkBack en Android, VoiceOver en iPhone) la compra completa y la venta manual.
- Que los textos de ayuda y los mensajes de error se entiendan (lenguaje simple).
- Zoom al 200 % en la computadora: que nada se corte.
