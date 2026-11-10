# Auditoría nocturna — Gabriel Store & GaboHub

**Rama de trabajo:** `pulido-nocturno` (creada desde el commit de producción `7c5b528`, sin tocar `ccr-0b4be8d6-1sld7s` ni producción)
**Fecha:** 2026-11-10
**Alcance autorizado:** inspeccionar, probar, mejorar y corregir en una rama aislada. Sin despliegue a producción, sin cambiar DNS, sin tocar datos reales ni operaciones financieras.

Este documento resume lo que se encontró, lo que se corrigió (con evidencia) y lo que queda pendiente.

---

## 1. Resumen ejecutivo

El proyecto llegó a la auditoría en muy buen estado: base responsiva sólida, 163 pruebas verdes, cero dependencias de producción y controles de acceso correctos. El trabajo de la noche se concentró en **pulido visual real con evidencia** (no recomendaciones) y en **verificar los 12 estilos y la seguridad**.

- **2 bugs visuales reales corregidos** (nombres largos que deformaban tarjetas; muescas del "boleto de cine" desalineadas en celular).
- **Los 7 estilos de tarjeta y los temas probados y verificados**: aplican bien y **0 desbordes horizontales** en 360/390/430/768/1440 px, tienda y tienda de revendedor.
- **Seguridad verificada con pruebas**: rutas privadas exigen sesión (401), aislamiento entre clientes (403), rutas públicas sólo las previstas (200).
- **8 alertas de dependencias = todas de herramientas de desarrollo** (no viajan a la tienda). 0 vulnerabilidades de producción.

---

## 2. Qué se encontró y qué se corrigió

### 2.1 Tarjetas de producto — nombres largos y productos sin imagen (CORREGIDO)
**Hallazgo:** un nombre de producto muy largo (ej.: *"Plataforma Premium Internacional de Streaming 4K Ultra HD Multipantalla"*) se expandía a 4 líneas e inflaba la tarjeta, desalineando su fila. Los productos sin imagen ya mostraban una inicial de color (bien), pero el nombre no estaba acotado.
**Corrección (`public/shop.css`):** el nombre (`.pbody h3`) y la descripción (`.pbody .d`) se recortan a **2 líneas con elipsis** (`-webkit-line-clamp`) y `overflow-wrap:anywhere`. Las tarjetas de una fila quedan parejas sin importar el largo del nombre.

### 2.2 Estilo "boleto de cine" — muescas desalineadas en celular (CORREGIDO)
**Hallazgo:** las dos muescas redondas laterales estaban posicionadas con un píxel fijo (`top:140px`), igual al alto del logo en escritorio. En celular el logo mide **120px**, así que las muescas quedaban **20px por debajo** de la línea de perforación.
**Corrección (`public/shop.css`):** las muescas se anclan ahora al borde superior de `.pbody` (la línea de perforación real), con `top:-1px; translateY(-50%)`. Quedan alineadas con el corte **en cualquier ancho y con cualquier alto de logo**.

### 2.3 Otros estados ya correctos (verificados, sin cambios necesarios)
- **Sin stock:** el botón "Añadir +" aparece deshabilitado con etiqueta "Agotado"; stock bajo muestra "Últimas N unidades". ✔
- **Checkout invitado:** se puede agregar al carrito y avanzar al pago **sin login obligatorio**; muestra el descuento por combo ("Sumá otro servicio y ahorrá Bs 5") y el total. ✔
- **Tema claro (fondos claros):** contraste correcto (texto oscuro, botones y precios legibles). ✔

---

## 3. Prueba de los 12 estilos (evidencia)

Se levantó un servidor de auditoría con datos ficticios (incluyendo a propósito un producto de **nombre larguísimo y sin imagen**) y se probó con Playwright la tienda de revendedor `/r/<slug>` aplicando cada estilo de tarjeta y verificando que **realmente se aplicara** (se leyó el `data-card` renderizado) antes de medir.

| Estilo de tarjeta | Aplica | Overflow 390px |
|---|---|---|
| solid | ✅ | no |
| glass | ✅ | no |
| outline | ✅ | no |
| neon | ✅ | no |
| ticket (boleto) | ✅ | no |
| lista (horizontal) | ✅ | no |
| poster | ✅ | no |

Barrido de anchos **360 / 390 / 430 / 768 / 1440** sobre tienda y tienda de revendedor: **0 desbordes horizontales** (`scrollWidth == viewport` en todos los casos). Evidencia: `scratchpad/cards/verify.json` y capturas `scratchpad/cards/card-*.png` (entregadas en el chat).

> Nota de método: en la primera corrida los cambios de tema no se aplicaban porque la revendedora de prueba no tenía PIN y los `PUT /api/me/shop` devolvían 401; al detectarlo se fijó el PIN y se re-ejecutó con verificación de `data-card`. Esto se deja documentado para no dar por buena una medición que no cambió el estilo.

**No se alteró ninguna configuración de tiendas existentes.** Las pruebas se hicieron sobre una tienda de demo en una carpeta de datos aparte.

---

## 4. Experiencia móvil

Probado a 360, 390, 430, 768 y 1440 px. Sin scroll horizontal accidental, sin controles superpuestos. La navegación inferior, el catálogo, las tarjetas, el carrito (drawer con pasos 1·Carrito → 2·Pago → 3·Listo) y las preguntas frecuentes se ven y se pulsan bien. El nombre largo ya no rompe la grilla (sección 2.1).

---

## 5. Pruebas funcionales

- **Pruebas automáticas existentes:** `npm test` → **163/163 verdes** (incluye el núcleo de dominio y e2e de servidor en Node).
- **Flujos verificados en navegador (Playwright, datos ficticios):**
  - Catálogo público e invitado: carga, buscador, filtros por categoría. ✔
  - **Carrito invitado:** agregar producto, ver total y descuento por combo, "Continuar al pago" sin login. ✔
  - Stock: "Agotado" deshabilita la compra; "Últimas N" en stock bajo. ✔
- **Límite de compra invitado (documentado):** el invitado coordina por WhatsApp/QR; el pago con **saldo** y el "pagá al instante" requieren entrar con número + PIN (el saldo es de clientes registrados). Esto es por diseño, no un error.

No se hicieron compras reales ni se consumió inventario real (todo en datos de demo).

---

## 6. Seguridad y rendimiento (con evidencia)

### 6.1 Dependencias (las "8 alertas")
`npm audit` reporta 8 vulnerabilidades (3 moderadas, 5 altas) en **lodash, uuid y yaml**, todas **transitivas de `devDependencies`** (`openapi-to-postmanv2`, `@apidevtools/swagger-parser`), usadas sólo para generar documentación/Postman en desarrollo.

- **`npm audit --omit=dev` → 0 vulnerabilidades.** La app de producción tiene **`dependencies: {}`** (cero dependencias en runtime), así que **nada de esto viaja a la tienda ni a los clientes**.
- No se aplicó `npm audit fix --force` porque obliga a un cambio mayor de una herramienta de desarrollo y el usuario pidió explícitamente no forzar updates que puedan romper. **Recomendación (opcional, bajo riesgo):** subir `openapi-to-postmanv2` a la mayor arreglada y correr `scripts/gen-postman.mjs` para verificar; es dev-only, se puede hacer con calma.

### 6.2 Autenticación, autorización y aislamiento (verificado)
Pruebas contra el servidor de auditoría:

- Rutas privadas **sin sesión** → **401**: `/api/me/services`, `/api/me/customers`, `/api/me/referrals`, `/api/admin/customers`, `/api/admin/orders`, `/api/admin/finance`.
- Rutas públicas (por diseño) → **200**: `/api/settings`, `/api/catalog`, `/api/shops/<slug>`, `/api/resellers/program`.
- **Aislamiento entre clientes:** una revendedora pidiendo datos de un cliente que no es suyo (`/api/me/codes?customerId=<ajeno>`) → **403**; los suyos → **200**.

El aislamiento se apoya en `requireActFor`/`canActFor` y `visibleCustomers` (un cliente ve lo suyo; un revendedor ve lo suyo y lo de sus clientes). Contraseñas de cuentas sólo se listan con permiso explícito y queda en auditoría.

> No se afirma que el sistema sea "100% seguro". Se afirma, con las pruebas de arriba, que **estos controles concretos funcionan**. Una revisión de seguridad completa (fuzzing, rate-limit bajo carga, pentest) excede la ventana de la noche y queda recomendada.

### 6.3 Rendimiento / accesibilidad
- Base liviana: sin frameworks ni dependencias en runtime; estáticos servidos con `Cache-Control` adecuado (no-cache para `.html/.js/.css`, cacheable para imágenes).
- Imágenes de producto con `loading="lazy"`.
- **Pasada de contraste (WCAG) hecha con un medidor propio** sobre la tienda y tiendas de revendedor en temas claros y oscuros. Hallazgos reales y **corregidos**:
  - En temas claros, el **precio** (color de acento sobre tarjeta clara) quedaba en ~2.4:1. Ahora se oscurece el acento solo en temas claros (`.shop[data-light] .price`), manteniendo el tono.
  - El **texto de stock/ganancia** (verde/rojo) quedaba justo por debajo de 4.5:1 en temas claros; se oscurecieron un poco los colores de estado (`--s-ok/--s-warn/--s-bad`) para temas claros.
  - El **contador del carrito** (número blanco sobre acento) fallaba con acentos claros (dorado, celeste), en temas claros y oscuros; ahora el fondo del badge usa el acento oscurecido de forma universal.
  - Se agregó sombra sutil al texto blanco de botones/cintas de acento en temas claros, para legibilidad.
  - *Nota honesta:* el medidor propio no sabe leer fondos con degradado, así que los botones primarios (texto blanco sobre degradado de acento) salen como falsos positivos; el patrón "texto blanco sobre botón de marca" es estándar y se reforzó con sombra. Un Lighthouse/axe-core formal sigue recomendado para un puntaje auditable.

---

## 7. Archivos modificados

| Archivo | Cambio |
|---|---|
| `public/shop.css` | Recorte de nombre/descr. a 2 líneas; muescas del boleto ancladas a la perforación. |
| `docs/AUDITORIA_NOCTURNA.md` | Este informe. |

Commits en `pulido-nocturno`:
- `Pulido tienda: nombres largos a 2 líneas y muescas del boleto alineadas`
- `docs: auditoría nocturna`

---

## 8. Lo que quedó pendiente (y por qué)

- **Lighthouse / axe-core con puntajes adjuntos:** no se alcanzó a correrlos formalmente dentro de la ventana; se dejó la verificación visual y de overflow. Siguiente paso natural.
- **Suite e2e de navegador dentro del repo:** se corrieron flujos con Playwright (pre-instalado en el entorno de auditoría), pero **no se agregó Playwright como dependencia del proyecto** para conservar la propiedad de "cero dependencias en runtime". Si se quiere una suite e2e permanente, conviene decidirlo aparte (agrega una devDependency pesada).
- **Upgrade dev de openapi/yaml/lodash:** dejado como recomendación opcional (dev-only, sin impacto en la tienda).

---

## 9. Cómo revisar sin afectar producción

1. Los cambios están **solo en la rama `pulido-nocturno`**, que **no** es la que despliega Railway (`ccr-0b4be8d6-1sld7s`). Producción no cambió.
2. Para ver el diff:
   ```bash
   git fetch origin
   git log --oneline origin/ccr-0b4be8d6-1sld7s..origin/pulido-nocturno
   git diff origin/ccr-0b4be8d6-1sld7s..origin/pulido-nocturno
   ```
3. Para probarlo localmente sin tocar datos reales (datos de demo en carpeta aparte):
   ```bash
   npm run build && node scripts/seed-reseller-demo.mjs ./data-demo
   GS_DATA_DIR=./data-demo GS_STATIC_DIR=public npm start   # abrí /tienda/ y /r/ariana-streaming
   ```
4. Si todo conforma, recién ahí se fusiona `pulido-nocturno` → la rama de producción y Railway despliega. **Nada se publica solo.**
