# Plan de implementación — Gabriel Store

## Qué hay hoy en el repositorio

| Parte | Ruta | Estado |
|---|---|---|
| SDK de VendePlay (existente) | `src/http.ts`, `src/resources/*`, `src/index.ts` | Sin cambios. Sus 7 pruebas siguen pasando. |
| **Núcleo de Gabriel Store (nuevo)** | `src/store/*` → `import … from "vendeplay-sdk/store"` | Lógica de negocio real, 33 pruebas. |
| Demo visual | `demo/tienda/gabriel-store.html` | Solo maqueta en el navegador: no usa el núcleo todavía. |
| Material de ChatGPT | `docs/rea_import/` | Referencia; no se ejecuta. |

### Módulos del núcleo

| Módulo | Responsabilidad | Controles |
|---|---|---|
| `engine.ts` | Estado, `tx()` con rollback total, ids, idempotencia, auditoría | La auditoría descarta campos `pass/pin/secret/token` |
| `auth.ts` | Matriz de permisos por rol (owner, admin, seller, reseller, customer, system) | Toda operación sensible llama a `authorize` |
| `catalog.ts` | Productos, grupos de precios, proveedores y clientes | El precio lo calcula el servidor; un revendedor solo crea clientes finales |
| `inventory.ts` | Cuentas, perfiles, reservas, carga masiva y stock | No se venden perfiles de cuentas vencidas con el proveedor; contraseñas ocultas sin permiso |
| `orders.ts` | Ventas, comprobantes, aprobación, rechazo, vencimiento de reservas, renovaciones, reemplazos, cierre de vencidos y recordatorios | El comprobante no es un pago; la referencia bancaria no se reusa; doble clic idempotente |
| `wallet.ts` | Libro contable, ajustes e historial | El saldo no puede quedar negativo; solo el dueño ajusta, con motivo |
| `portal.ts` | Vistas del cliente y del revendedor | Solo datos propios (o de sus clientes); se audita cada vista de credenciales |
| `codes.ts` | Buzón autorizado, ingesta y códigos por cliente | Asuntos permitidos, solo cuentas activas, solo desde la asignación y por 30 minutos |
| `notify.ts` | Bandeja de salida de WhatsApp con plantillas | Sin consentimiento no se envía; sin contraseñas, PIN ni códigos |
| `stats.ts` | Resumen, reporte de proveedores y auditoría | Separa ventas, caja y saldo adeudado |

**Cómo usarlo (ejemplo mínimo):**
```ts
import { createStore } from "vendeplay-sdk/store";
const s = createStore();
const owner = { id: "u1", role: "owner" } as const;
s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", active: true });
// … productos, cuentas, clientes; luego:
const order = s.orders.create({ id: "u9", role: "customer", customerId: "cus_1" },
  { customerId: "cus_1", items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr", idempotencyKey: "chk-1" });
```

## Próximas fases

Cada fase se entrega con pruebas. Las marcadas con 🔐 **no se activan sin autorización explícita del dueño.**

1. **Persistencia PostgreSQL.**
   - Se reemplaza el `Engine` en memoria por un repositorio con transacciones `SERIALIZABLE`.
   - La reserva de stock se hace con `SELECT … FOR UPDATE SKIP LOCKED`.
   - Restricción única sobre `orders.confirmed_reference` y sobre las claves de idempotencia.
   - Las mismas pruebas corren contra los dos adaptadores.
2. **API HTTP** (Fastify o Express) que llama al núcleo.
   - Sesiones para el staff, con segundo factor para owner y admin.
   - Login del cliente con código de un solo uso.
   - Límite de pedidos por IP y por cliente.
3. **Comprobantes.** Se suben a un almacenamiento privado mediante una URL temporal firmada. Se aceptan solo imágenes o PDF de hasta 5 MB.
4. **Secretos.** Las contraseñas de las cuentas se guardan cifradas (libsodium o KMS) y se descifran solo al mostrarlas en el portal.
5. **Conectar la demo** (`demo/tienda`) a la API real.
6. 🔐 **WhatsApp Cloud API** (implementación de `WhatsAppTransport`).
   - Requiere la cuenta Business verificada del dueño y plantillas aprobadas por Meta.
   - Requiere el consentimiento registrado de cada cliente.
7. 🔐 **Lector IMAP de códigos** (llama a `codes.ingest`).
   - Requiere un buzón propio de la tienda y una contraseña de aplicación entregada por el dueño.
   - Nunca se usan buzones de terceros.
8. 🔐 **Conciliación bancaria.** Al principio sigue siendo manual (aprobación con referencia). Solo con API o extracto oficial del banco se podría automatizar.
9. **Tareas programadas:**
   - `expireReservations`: cada 5 minutos.
   - `queueExpiryReminders`: una vez al día.
   - `closeExpired`: una vez al día.
   - `flush`: cada minuto, cuando haya transporte autorizado.

## Riesgos abiertos

- La garantía de no vender dos veces el mismo perfil depende del adaptador. En memoria está probada; en PostgreSQL hay que probarla con concurrencia real (fase 1).
- Las "bandejas inteligentes" no están definidas: hay que confirmar con el dueño.
- Hay que revisar los términos de uso de cada plataforma que se revende.
