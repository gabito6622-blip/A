# Backlog priorizado

Estados: `pendiente` · `en curso` · `hecho (v0.1)`. Cada ítem tiene un criterio de aceptación verificable.

## P0 — Antes del piloto

| ID | Ítem | Criterio de aceptación |
|---|---|---|
| B-001 | ✅ (v0.2) MFA TOTP con política por rol (recomendado: owner, admin, accountant) | Login en 2 pasos; códigos de recuperación de un solo uso; prueba de integración |
| B-002 | ✅ (v0.2) Recuperar contraseña por correo | Enlace de un solo uso que caduca a los 30 min; no revela si el correo existe; prueba |
| B-003 | ✅ (v0.2) Tabla `consents` versionada | Texto, versión, finalidad, fecha, quién registró y evidencia; la ficha muestra la vigente; revocar no borra el historial |
| B-004 | ✅ (v0.2) Consentimiento informado por procedimiento con firma; impresión desde el navegador. Pendiente: vínculo automático al aceptar un presupuesto | El presupuesto aceptado genera un documento firmado; queda inmutable y descargable con auditoría |
| B-005 | Despliegue de staging en Railway | **Requiere autorización.** HTTPS, `NODE_ENV=production`, copias diarias fuera del proveedor, restauración probada |
| B-006 | Plantilla de importación acordada con la clínica | `dryRun` sin errores sobre los datos reales anonimizados de muestra |
| B-007 | ✅ (v0.2) Idempotencia concurrente de pagos | Dos envíos simultáneos con la misma clave → ambos responden con el mismo pago (verificado en v0.2) |
| B-008 | Revisión de textos y catálogo con la clínica | Precios reales, nombres de prestaciones y horarios cargados |

## P0 restantes
B-005 (staging en Railway, requiere autorización), B-006 (plantilla de importación con la clínica) y B-008 (revisión de textos y catálogo con la clínica). Las tres dependen de decisiones o datos de la clínica.

## P1

| ID | Ítem | Criterio |
|---|---|---|
| B-010 | WhatsApp Cloud API (plantillas, botones, entregas, baja) | Confirmar desde WhatsApp actualiza la cita; sin consentimiento no se envía; pruebas con un simulador |
| B-011 | Periodontograma | 6 sitios por pieza; instantáneas inmutables; comparación entre fechas |
| B-012 | Archivos clínicos privados | URL firmadas de 5 min; la descarga queda auditada; límite de tamaño y tipo |
| B-013 | Inventario por sucursal | Stock por lote y vencimiento; consumo al realizar un tratamiento; alertas; transferencias con doble registro |
| B-014 | Liquidación de honorarios por período | Cierre inmutable; base producción o cobro; exportación Excel |
| B-015 | Sala de espera (✅ v0.2) y vista semanal de la agenda (pendiente) | Cambios de estado con arrastre y teclado; prueba e2e |
| B-016 | Recetas e informes PDF | Plantilla con matrícula; registrado como nota clínica |
| B-017 | Panel: rango libre de fechas y comparación con el período anterior | Variación en % por sucursal |
| B-018 | Correos transaccionales (citas, recuperación) | Proveedor configurable; sin datos clínicos |
| B-019 | Paginación con cursor en auditoría y pagos | Más de 10 000 filas sin degradación |

## P2

| ID | Ítem | Criterio |
|---|---|---|
| B-020 | Facturación SIAT con un proveedor autorizado | Emitir, anular y contingencia; pruebas en el ambiente piloto del SIN; decisión legal previa |
| B-021 | Conciliación bancaria por extracto | Emparejar referencia y monto; las diferencias quedan para revisión |
| B-022 | Portal del paciente y reserva online | Disponibilidad real, captcha o límite de solicitudes, confirmación por WhatsApp |
| B-023 | Laboratorios protésicos | Órdenes con estado, fechas y costo vinculadas al presupuesto |
| B-024 | Compras y proveedores | Orden de compra → recepción → stock |
| B-025 | Facturación del SaaS a las clínicas | Cobro recurrente; suspensión automática por impago con aviso |
| B-026 | Prueba de penetración externa | Informe sin hallazgos críticos abiertos |
| B-027 | Observabilidad | Registros JSON sin datos personales; métricas de latencia; alertas |

## P3

| ID | Ítem |
|---|---|
| B-030 | Dictado de evoluciones con IA (aprobación obligatoria del profesional) |
| B-031 | Modo sin conexión |
| B-032 | PWA instalable |
| B-033 | Analítica de retención y rentabilidad por sillón |
| B-034 | Interoperabilidad FHIR / Historia Clínica Única |

## Hecho en v0.1

Autenticación con sesiones y CSRF · bloqueo por intentos · roles y sucursales · RLS y FK compuestas · clínicas, sucursales, consultorios, personal y horarios · catálogo de prestaciones · pacientes con duplicados, búsqueda sin tildes y archivo · antecedentes médicos versionados con alertas · agenda sin solapes con disponibilidad, búsqueda de huecos, estados, reprogramación, bloqueos, lista de espera y "recuperar huecos" · recordatorios con consentimiento por wa.me · odontograma FDI con historial e inmutabilidad · evoluciones con enmiendas · presupuestos con cuotas · tratamientos → cargos · pagos con verificación dual e idempotencia · anulaciones · caja diaria · panel por sucursal · producción, comisión y cuentas por cobrar · importación y exportación Excel · auditoría · superadministrador SaaS con planes y límites · asistente con herramientas y propuestas · respaldos cifrados con restauración probada · CI con PostgreSQL y e2e.
