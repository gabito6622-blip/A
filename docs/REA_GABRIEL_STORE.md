# REA Gabriel Store — tres referencias

**Fecha:** 7 de noviembre de 2026
**Alcance:** comparar tres sistemas de referencia con lo que Gabriel Store necesita, separando con cuidado lo que se **vio** de lo que solo se **anuncia** o se **pide**.

## Cómo leer las etiquetas

| Etiqueta | Significa |
|---|---|
| **OBSERVADO** | Visto en capturas que mandó el dueño desde su propia sesión (6-nov-2026). |
| **OBSERVADO (ChatGPT)** | Lo informó ChatGPT en `docs/rea_import/REA_StreamingManager_A-H.md`. Nadie lo volvió a verificar acá. |
| **ANUNCIADO** | El proveedor dice que lo hace (web o textos de marketing). Nadie lo probó de punta a punta. |
| **REQUISITO DEL DUEÑO** | No hay evidencia pública. Es una función que pidió el dueño, tomando esa referencia como inspiración. |
| **NO VERIFICADO** | No hay forma de saberlo con lo que tenemos. |

**Límites de esta revisión:**
- Desde este entorno no se puede abrir `streaming-manager.cloud`: la red está bloqueada.
- Las búsquedas web del 7-nov-2026 no encontraron páginas públicas de **Mercado Streaming** ni de **StreamGestor**.
- Ninguna API, código o base de datos de las tres referencias fue inspeccionada.
- No se copia código, marca ni diseño de ninguna de ellas.

---

## 1. StreamingManager: gestión de cuentas, inventario, ventas, WhatsApp y códigos

### 1.1 Panel del vendedor (capturas de escritorio del dueño)

| Pantalla | Qué se vio | Etiqueta |
|---|---|---|
| Menú lateral | Vender, Renovar, Dashboard, Aprobación de Ventas, Recordatorios, Productos (Cuentas, Carga de Cuentas, Combos, Productos, Plataformas, Precios de Créditos), Panel de códigos, Proveedores, Historial, WhatsApp, Configuración, Usuarios, Referidos y Ayuda. Además: selector Claro/Oscuro/Sistema, recuadro de soporte por WhatsApp y Cerrar sesión. | OBSERVADO |
| Dashboard | Botones grandes "Registrar cuentas" y "Vender". Lista "Completa tu tienda" (Conecta tu WhatsApp, Sube tu QR de cobro). Video tutoriales. En otra captura: "Mis suscripciones", ingresos por moneda (BOB, USD, USDT, BTC) con % contra el período anterior, y los totales de Créditos vendidos, Ventas y Visitas a tienda. | OBSERVADO |
| Centro de Ayuda | Ventana emergente con buscador, accesos rápidos (Vender, Renovar), temas y "Hablar con soporte". | OBSERVADO |
| Cuentas | Filtros: plataforma, producto, estado, cliente y texto. Columnas: ID, Producto, Email, Perfil, Contraseña, PIN, Cliente, Ocupado hasta, Expiración, Estado (Asignada/Activa). Acciones: renovar, transferir y notas. | OBSERVADO |
| Clientes (`/users`) | Pestañas Usuarios, Movimientos, Aprobaciones Pendientes y Pagos de créditos. Columnas: nombre, teléfono, email, rol, créditos, suscripción activa y fecha de creación. Acciones: llave, entrar como cliente, editar, borrar. | OBSERVADO |
| Aprobación de Ventas (`/sells/approval`) | Columnas: ID, Cliente, Estado (Pagado), Total en BOB, Cuentas, Canal (Panel), Tipo (Venta/Renovación), Fecha. Acciones: ver, borrar. | OBSERVADO |
| Recordatorios (`/account-reminders`) | Filtros por cliente, plataforma, producto y rango de fechas, más "Filtrar por fecha de expiración". Tabla con casillas, fin de suscripción, precio de renovación, "Último recordatorio" y "Enviar Recordatorio". | OBSERVADO |
| Panel de códigos (`/code-panel`) | Link público para clientes (`/mails/<tienda>`), "Copiar" y "Ver como cliente". Pestañas Correos, Asuntos, Cuentas y Ajustes. Texto: "Un correo sirve para todas las cuentas cuyos códigos llegan ahí". | OBSERVADO |
| Chats de WhatsApp | Mensaje automático "¡Tu pago fue confirmado!" **con email, contraseña, perfil y código de correo en el texto**. | OBSERVADO |
| Producto "Cuenta Gemini" | Estados Publicada/Privado, interruptor "Mostrar tienda" y fechas de cliente y de proveedor separadas. | OBSERVADO (ChatGPT) |

### 1.2 Tienda y portal del cliente

| Elemento | Etiqueta |
|---|---|
| Portal "Mis cuentas" de una tienda de prueba: email, perfil, contraseña, plataforma, fecha de expiración, botón Renovar y saldo de créditos en la cabecera. | OBSERVADO |
| Checkout de Bs 12: pide teléfono, correo y referencia del depósito, muestra un QR, permite seguir por web o WhatsApp, y avisa que la revisión manual tarda 10–30 minutos. | OBSERVADO (ChatGPT) |
| Directorio `/shops` con una tienda de 33 productos y 12 combos en BOB. | OBSERVADO (ChatGPT) |
| Consulta de correos por IMAP. El cliente "ve solo los correos de su cuenta" y "nunca la contraseña del buzón". | ANUNCIADO (landing en celular, captura del dueño) |
| Entrega automática, bot de WhatsApp y prueba de 5 días. | ANUNCIADO |

### 1.3 Decisión de diseño que **no** copiamos

StreamingManager manda la contraseña por WhatsApp (se vio en la captura). Gabriel Store **no** lo hace: el mensaje solo avisa que el pedido fue confirmado, y las credenciales se muestran únicamente en el portal privado, con auditoría de cada consulta. Las plantillas rechazan cualquier parámetro sensible, y el texto final se revisa contra todas las contraseñas del inventario.

---

## 2. Mercado Streaming: clientes, saldo, perfiles, reemplazos, renovaciones masivas, grupos de precios y bandejas inteligentes

**Evidencia:** ninguna. La búsqueda del 7-nov-2026 solo devolvió resultados de Mercado Pago y Mercado Play, que no tienen relación. Todo lo de esta sección es **REQUISITO DEL DUEÑO**.

| Función pedida | Cómo la resuelve Gabriel Store |
|---|---|
| Clientes y revendedores | `Customer.kind` y `resellerId`. Un revendedor crea solo clientes finales propios. |
| Recargas de saldo | Pedido de tipo `topup` con comprobante. Solo acredita un revisor que confirma la referencia bancaria. |
| Historial contable | Libro de movimientos (`ledger`). El saldo es la suma de los movimientos y nunca puede quedar negativo. |
| Perfiles | `Slot` por perfil, con etiqueta y PIN. |
| Reemplazos | `replaceAssignment`: conserva el vencimiento, pone el perfil viejo en cuarentena y guarda historial. `replaceAccount` mueve a todos los clientes de una cuenta caída. |
| Renovaciones masivas | `renewMany`: resultado ítem por ítem, sin renovar dos veces el mismo lote. |
| Grupos de precios | `PriceGroup` por producto. El precio siempre lo calcula el servidor. |
| Bandejas inteligentes | **Interpretación:** vistas filtradas de trabajo pendiente (pagos por revisar, servicios por vencer, perfiles en cuarentena, cuentas del proveedor por vencer). Hoy salen de `stats.summary` y `stats.suppliers`. **Hay que confirmar con el dueño qué esperaba.** |

---

## 3. StreamGestor: catálogo móvil, checkout, comprobantes y portal de autoservicio

**Evidencia:** ninguna. La búsqueda no encontró el producto. Todo lo de esta sección es **REQUISITO DEL DUEÑO**.

| Función pedida | Cómo la resuelve Gabriel Store |
|---|---|
| Catálogo móvil | `publicCatalog` (solo publicados, con precio del grupo del cliente y disponibilidad). La interfaz está en `demo/tienda/gabriel-store.html` (solo demo). |
| Checkout | `orders.create`: reserva el stock de forma atómica, con idempotencia del lado del cliente. |
| Comprobantes | `submitEvidence`: el pedido pasa a "en revisión" y la reserva se mantiene durante la revisión. |
| Autoservicio | Portal: servicios, pedidos, saldo, códigos y renovación con saldo, sin intervención del staff. |

---

## 4. Análisis de brechas (prioridades del dueño)

| # | Prioridad | Estado en este repo | Pendiente |
|---|---|---|---|
| 1 | Inventario transaccional de cuentas y perfiles | ✅ Núcleo + pruebas (`src/store/inventory.ts`) | Adaptador PostgreSQL con bloqueo de filas |
| 2 | Ventas, asignaciones, reemplazos y renovaciones | ✅ Núcleo + pruebas (`orders.ts`) | API HTTP |
| 3 | Portal privado de clientes y revendedores | ✅ Núcleo + pruebas (`portal.ts`) | Login real (OTP por WhatsApp o correo), sesiones |
| 4 | Saldo, recargas e historial contable | ✅ Núcleo + pruebas (`wallet.ts`) | Conciliación con el extracto bancario |
| 5 | Tienda móvil, QR y verificación de pagos | 🟡 Lógica lista; interfaz solo demo | Subida privada de comprobantes, QR real del banco |
| 6 | WhatsApp y códigos | 🟡 Outbox, plantillas, consentimiento y filtro de códigos listos | **Integraciones reales: requieren autorización del dueño** (ver plan) |
| 7 | Estadísticas, auditoría y proveedores | ✅ Núcleo + pruebas (`stats.ts`) | Exportar CSV/Excel, gráficos en el panel |

## 5. Lo que no sabemos y no se inventa

1. Cualquier endpoint, payload o modelo de datos de las tres referencias.
2. Si en StreamingManager el cliente necesita registrarse para comprar.
3. Cómo StreamingManager reserva el stock o maneja la concurrencia.
4. Qué hacen exactamente las "bandejas inteligentes" de Mercado Streaming.
5. Cómo son el checkout y el portal de StreamGestor.
6. **Si revender cada servicio está permitido por sus términos de uso.** Requiere revisión legal por plataforma antes de operar.
