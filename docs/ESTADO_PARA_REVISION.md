# Gabriel Store: estado actual para revisión

**Fecha:** noviembre de 2026
**Código:** https://github.com/gabito6622-blip/a/tree/ccr-a0b95638-dpfc8j (repositorio público)
**Qué es:** una tienda de suscripciones digitales para Bolivia (precios en Bs), con un panel para el vendedor. Funciona **de verdad**: tiene servidor, base de datos, inicio de sesión y pagos por QR con comprobante que se verifican a mano. Todavía no está publicada en internet.

> **Para quien revise (ChatGPT u otra persona):** las capturas de `capturas/` son de la aplicación real funcionando con datos de ejemplo. Al final hay preguntas concretas.

---

## 1. Cómo está armado

| Parte | Carpeta | Tecnología |
|---|---|---|
| Reglas del negocio | `src/store/` | TypeScript. Toda acción revisa el rol de quien la hace y queda registrada. |
| Servidor y API | `src/server/` | Node.js 22 sin frameworks. SQLite incluido en Node; cada cambio se guarda en disco antes de responder. |
| Tienda (cliente) | `public/index.html`, `public/shop.js` | HTML, CSS y JS, pensada primero para celular |
| Panel (vendedor) | `public/panel.html`, `public/panel.js` | HTML, CSS y JS, con modo claro, oscuro o sistema |
| Pruebas | `test/` | 60 pruebas automáticas, todas pasan |
| Arranque en Windows | `iniciar-tienda.bat` | Doble clic: instala, compila y arranca |
| Informes | `docs/REA_GABRIEL_STORE.md`, `docs/IMPLEMENTATION_PLAN.md` | Referencias y plan |

## 2. Qué hace hoy

### Tienda (lo que ve el cliente)
- **Inicio** personalizable: título, texto, colores, logo y aviso.
- **Catálogo** con categorías, buscador, stock disponible y precios. El revendedor ve sus propios precios.
- **Carrito en 3 pasos.** Pago **con saldo** (entrega al instante) o **con QR + foto del comprobante + número de operación** (queda "En revisión").
- **Mis cuentas:** accesos (correo, contraseña, perfil, PIN), días que faltan para vencer, renovación con saldo o QR, pedidos pendientes, reintento de subir el comprobante y cancelación.
- **Códigos:** los códigos de verificación que llegan al correo de su cuenta, visibles por 30 minutos.
- **Saldo:** pedir recargas con comprobante, ver movimientos y saldo acumulado.
- **Revendedor:** puede cargar sus propios clientes y comprarles con su saldo, a su precio.
- **Acceso:**
  - **Link de un solo uso** que manda la tienda por WhatsApp. Es lo que funciona hoy.
  - **Código por WhatsApp:** está programado, pero apagado hasta tener WhatsApp Business API.

### Panel (vendedor)
- **Usuarios y roles:**
  - **Dueño:** hace todo.
  - **Admin:** aprueba pagos y maneja inventario.
  - **Vendedor:** vende, renueva y carga clientes.
  - Desactivar a alguien le cierra la sesión al instante.
- **Dashboard:** ventas de 30 días, dinero que entró, pagos por revisar, vencimientos próximos, saldo que se les debe a los clientes, stock por producto y lista "Completá tu tienda".
- **Vender:** venta manual a un cliente. Asigna un perfil libre y deja el aviso listo.
- **Aprobación de ventas:**
  - Ver el comprobante y aprobar **escribiendo la referencia del banco**, que no se puede repetir.
  - Rechazar con motivo: el stock vuelve a quedar libre.
- **Renovar:**
  - De a uno o varios juntos.
  - Mueve solo la fecha del cliente. **No deja pasarse de la fecha en que vence la cuenta con el proveedor.**
- **Reemplazar perfil:** el cliente conserva su fecha y el perfil viejo queda en cuarentena.
- **Cuenta caída:** mueve a todos sus clientes a otra cuenta y la retira.
- **Recordatorios:** prepara avisos para quienes vencen en 1, 3, 7 o 15 días, máximo uno por día.
- **Cuentas:** inventario con el estado de cada perfil. Las contraseñas están ocultas y verlas queda registrado.
- **Carga de cuentas:** de a una o pegando una lista.
- **Productos y precios:** categoría, color, descripción, duración, precio y precio de revendedor, y si se muestra o no en la tienda.
- **Proveedores:** costo, ingreso, margen y cuentas que vencen con el proveedor.
- **Clientes:**
  - Búsqueda, alta y saldo con historial.
  - Ajustes de saldo, solo el dueño y con motivo.
  - Botón **"Link de acceso"** con **"Mandar por WhatsApp"**.
- **WhatsApp (modo manual):** cada aviso trae los botones "Abrir WhatsApp" y "Marcar enviado". **Ningún mensaje lleva contraseñas.**
- **Apariencia:** colores, fondo, logo, textos y aviso, con vista previa en computadora y celular.
- **Configuración:** nombre, WhatsApp, datos de pago, QR de cobro y cambio de contraseña.
- **Auditoría:** quién hizo qué. Solo la ve el dueño.

### Seguridad
- **Contraseñas del panel:** se guardan cifradas (scrypt).
- **Sesiones:** cookie que el navegador no deja leer a otros scripts ni enviar desde otros sitios (HttpOnly y SameSite=Strict).
- **Ataques desde otras páginas:** se rechazan las operaciones que vienen de otros sitios web.
- **Límites:** de intentos de inicio de sesión y de tamaño de lo que se envía.
- **Comprobantes:** se verifica el tipo real de archivo (JPG, PNG, WEBP o PDF, máximo 5 MB) y solo los ve quien revisa pagos.
- **Pedidos y pagos:** el stock se reserva mientras se revisa el pago (nunca se vende dos veces el mismo perfil), y apretar un botón dos veces no duplica el pedido.

## 3. Lo que todavía NO tiene (lo sabemos)

Comparado con lo que se vio en las capturas de StreamingManager y con lo que pidió el dueño:

1. **WhatsApp automático (bot / API oficial).** Hoy es manual, con un toque por mensaje.
2. **Lectura automática de correos (IMAP)** para los códigos. Las reglas están hechas, pero falta conectarlo a un buzón real.
3. **Ingresos en varias monedas** (USD, USDT, BTC). Hoy solo hay bolivianos.
4. **Exportar a Excel o CSV** y **cargar clientes desde Excel**.
5. **Historial** y **Referidos** como secciones propias.
6. **Combos** con varias cuentas adentro. Hoy un combo es un producto con su propio inventario.
7. **"Plataformas"** como agrupador aparte de los productos.
8. **Precios de paquetes de créditos** configurables. Hoy los montos de recarga son fijos.
9. **Transferir un perfil** de un cliente a otro, y **notas** en cuentas o clientes.
10. **Editar cliente** (nombre o teléfono) desde el panel.
11. **Gráficos** de ventas por mes o por plataforma.
12. **Video tutoriales y centro de ayuda** dentro del panel.
13. **Directorio público de tiendas** (`/shops`) o varias tiendas en un mismo sistema.
14. **Publicación en internet** con dominio y HTTPS (Railway, Render o VPS).

## 4. Preguntas para la revisión

1. Comparando con **StreamingManager** (y si podés, con **Mercado Streaming** y **StreamGestor**): ¿qué pantallas o funciones importantes **faltan**, además de las de la lista de arriba?
2. ¿Qué cambiarías del **flujo de compra** (tienda → pago → aprobación → entrega) para que sea más rápido para el cliente boliviano?
3. ¿Qué cambiarías del **diseño** de la tienda y del panel? Sé concreto: pantalla, qué se ve mal y cómo debería verse.
4. De lo que falta, ¿en qué **orden** lo harías para empezar a vender cuanto antes?
5. ¿Ves algún **riesgo** (seguridad, pagos, términos de uso de las plataformas) que no esté cubierto?

**Formato de respuesta que sirve:** una lista numerada de cambios. Cada uno con: pantalla, qué falta o qué está mal, cómo debería quedar y prioridad (alta, media o baja). Así se lo puedo pasar a Claude para que lo programe.
