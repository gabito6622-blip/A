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

## Ronda 2 de investigación: nuevos ítems priorizados
Origen: anexos G, H e I (ver `INVESTIGACION_COMPETIDORES.md` §9).

| ID | Prioridad | Ítem | Criterio de aceptación |
|---|---|---|---|
| B-040 | ✅ v0.3 | **Controles ("volver a citar")**: intervalos por prestación; propuesta al marcar "atendido"; cola mensual por sucursal con intentos de contacto (canal y resultado); vínculo automático cita↔control (R2-04 a R2-08) | Al completar una profilaxis se propone un control a 6 meses; agendar al paciente lo marca "agendado"; 3 intentos fallidos pasan a "revisar"; pruebas |
| B-041 | ✅ v0.3 | **Tiempos de la cita e informe de calidad por sucursal**: espera, puntualidad, duración real; lista de citas pasadas sin cerrar (R2-01 a R2-03) | Mediana y P90 cuadran con los datos sembrados; ninguna cita se cierra sola |
| B-042 | ✅ v0.3 | **Periodontograma** (PE-01 a PE-05, reemplaza a B-011) | Captura por teclado con avance automático; rechazo con mensaje fuera de rango; índices sobre los sitios medidos; cierre inmutable |
| B-043 | ✅ v0.3 | **Caja por sucursal y cajero** con apertura, arqueo en Bs y cierre inmutable (FI-01) | No se cierra con diferencia sin motivo; no se abre otra con una pendiente |
| B-044 | ✅ v0.3 (costos de laboratorio: monto fijo por regla hasta que exista el módulo de laboratorio) | **Liquidación de honorarios** con reglas por profesional y categoría, base producción o cobro, descuento de laboratorio y materiales, períodos cerrados (FI-03, reemplaza a B-014) | Cierre inmutable; los ajustes van al período siguiente; Excel y PDF |
| B-045 | ✅ v0.3 (pendiente: actualizar el odontograma planificado al versionar; aprobación de descuentos por rol) | **Presupuesto v2:** descuento global prorrateado y versiones que reemplazan a la anterior; enlace público verificado con registro de "visto"; embudo con días en cada estado (R2-12 a R2-16) | Caso 60 + (60 − 10 %) cuadra al centavo; la v1 no se puede aceptar si existe una v2 |
| B-046 | ✅ v0.3 (pendiente: pago con QR real y proveedor de WhatsApp real) | **Portal del paciente y reserva online** (R1 a R11 y R17 a R21 del anexo G) | Embudo en el celular con el motor de la agenda; código de un solo uso; confirmación con .ics, mapa, reprogramar y cancelar; QR pendiente hasta verificarse |
| B-047 | ✅ v0.4 | **Inventario con la invariante lotes = stock**, transferencia en dos pasos, conteo físico y consumo por prestación (IN-01 a IN-06, amplía B-013) | Prueba de la invariante; SKU único; errores junto al campo |
| B-048 | ✅ v0.4 (pendiente: cuenta real de WhatsApp) | **WhatsApp con modo de pruebas obligatorio** y reglas sin duplicados al reprogramar (WA-01 a WA-06, amplía B-010) | Fuera de producción no sale ningún mensaje real; una reprogramación anula los avisos pendientes |
| B-049 | ✅ v0.4 | **Tipos de cita** con color y duración, y **línea de tiempo del paciente** (R2-18, R2-19) | Todas las operaciones aparecen en la línea de tiempo con la hora local |
| B-050 | ✅ v0.4 | **Guardas del asistente** (R2-20) | El servidor rechaza propuestas con IDs inexistentes; prueba |
| B-051 | ✅ v0.4–v0.5 (falta: tarjetas proactivas con bloqueos levantados) | Citas recurrentes, check-in con QR, laboratorio, tareas internas, segmentos, relaciones familiares, recetas que se congelan al emitir, exportar todos los informes (R2-30 a R2-44) | Según cada requisito del anexo H |

## Nuevos pendientes detectados en v0.3
| ID | Prioridad | Ítem |
|---|---|---|
| B-060 | P1 (adaptador y webhook listos en v0.4; falta la cuenta de Meta verificada de la clínica) | Proveedor real de WhatsApp Business (Cloud API) sobre la bandeja de mensajes: plantillas aprobadas, botones Confirmar/Reprogramar, entregas y baja (B-048) |
| B-061 | P1 | Pago con QR real: proveedor o banco con QR Simple, referencia única y conciliación (R17 y R18 del anexo G) |
| B-062 | ✅ v0.4 | Inventario por sucursal con la invariante lotes = stock (B-047) |
| B-063 | ✅ v0.4 | Laboratorio protésico; costos reales en la liquidación de honorarios |
| B-064 | ✅ v0.4 | PDF generados en el servidor con hash (presupuesto aceptado, consentimientos, recetas) |
| B-065 | ✅ v0.5 (Inicio) | "Citas pasadas sin cerrar" también en el Inicio; exportar los controles a Excel; indicador "no contactar" |
| B-066 | P2 | Orden de sondaje del periodontograma configurable por clínica (hoy se guarda en el navegador) |

## Nuevos pendientes detectados en v0.4
| ID | Prioridad | Ítem |
|---|---|---|
| B-070 | P1 | Mensajes: enviar al proveedor desde una cola fuera de la transacción de la clínica; bandeja de respuestas (no «BAJA») para recepción |
| B-071 | P1 | Revisión legal y clínica de las plantillas de recetas y certificados y de las posologías sugeridas |
| B-072 | P2 | Inventario: informe de consumo real frente al estándar, exportar a Excel, anular una transferencia en tránsito, reponer materiales al anular un cargo |
| B-073 | P2 | Laboratorio: anular un pago, costo de un reenvío, adjuntos reales, costo de laboratorio en la rentabilidad por sucursal |
| B-074 | P2 | Agenda: cambiar la duración arrastrando el borde; prueba automática del arrastre táctil; «Deshacer» sin sumar una reprogramación |
| B-075 | P2 | Recetas: aviso de interacciones con la medicación actual; plantillas de certificados editables por clínica |
| B-076 | ✅ v0.5 | Laboratorio e inventario en el celular: tablas como tarjetas en lugar de desplazamiento horizontal dentro de la tarjeta |

## Nuevos pendientes detectados en v0.5
| ID | Prioridad | Ítem |
|---|---|---|
| B-080 | P1 | ⚠ Revisión legal: datos de salud en el estado de cuenta que recibe la empresa del convenio |
| B-081 | P1 | Volumen persistente para archivos clínicos en el despliegue; controlador S3 compatible; miniaturas generadas en el servidor; barrido de archivos huérfanos |
| B-082 | P2 | Convenios: pasar al paciente la porción impaga de la empresa; pagos de empresa en efectivo; empresas en Reportes y en cuentas por cobrar generales; honorarios «por cobro» con pagos de empresas |
| B-083 | P2 | Gastos compartidos entre sucursales con reparto por porcentaje y comprobante adjunto real |
| B-084 | P2 | Botón en pantalla para generar el enlace de encuesta a mano; aviso de llamada entrante (fase 2 de R2-42); contador de tareas en el menú |
| B-085 | P2 | Protección contra inyección de fórmulas en `payments.xlsx` (exportación antigua) |
| B-086 | P3 | Semilla demo: producción atribuida a sillones (hoy mucha queda «sin sillón identificado») |

## P1

| ID | Ítem | Criterio |
|---|---|---|
| B-010 | WhatsApp Cloud API (plantillas, botones, entregas, baja) | Confirmar desde WhatsApp actualiza la cita; sin consentimiento no se envía; pruebas con un simulador |
| B-011 | Periodontograma | 6 sitios por pieza; instantáneas inmutables; comparación entre fechas |
| B-012 | ✅ v0.5 Archivos clínicos privados | URL firmadas de 5 min; la descarga queda auditada; límite de tamaño y tipo |
| B-013 | Inventario por sucursal | Stock por lote y vencimiento; consumo al realizar un tratamiento; alertas; transferencias con doble registro |
| B-014 | Liquidación de honorarios por período | Cierre inmutable; base producción o cobro; exportación Excel |
| B-015 | Sala de espera (✅ v0.2) y vista semanal de la agenda (pendiente) | Cambios de estado con arrastre y teclado; prueba e2e |
| B-016 | Recetas e informes PDF | Plantilla con matrícula; registrado como nota clínica |
| B-017 | ✅ v0.5 Panel: rango libre de fechas y comparación con el período anterior | Variación en % por sucursal |
| B-018 | Correos transaccionales (citas, recuperación) | Proveedor configurable; sin datos clínicos |
| B-019 | ✅ v0.5 (diario de actividad) Paginación con cursor en auditoría y pagos | Más de 10 000 filas sin degradación |

## P2

| ID | Ítem | Criterio |
|---|---|---|
| B-020 | Facturación SIAT con un proveedor autorizado | Emitir, anular y contingencia; pruebas en el ambiente piloto del SIN; decisión legal previa |
| B-021 | ✅ v0.5 Conciliación bancaria por extracto | Emparejar referencia y monto; las diferencias quedan para revisión |
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
| B-032 | ✅ v0.5 PWA instalable |
| B-033 | Analítica de retención y rentabilidad por sillón |
| B-034 | Interoperabilidad FHIR / Historia Clínica Única |

## Hecho en v0.1

Autenticación con sesiones y CSRF · bloqueo por intentos · roles y sucursales · RLS y FK compuestas · clínicas, sucursales, consultorios, personal y horarios · catálogo de prestaciones · pacientes con duplicados, búsqueda sin tildes y archivo · antecedentes médicos versionados con alertas · agenda sin solapes con disponibilidad, búsqueda de huecos, estados, reprogramación, bloqueos, lista de espera y "recuperar huecos" · recordatorios con consentimiento por wa.me · odontograma FDI con historial e inmutabilidad · evoluciones con enmiendas · presupuestos con cuotas · tratamientos → cargos · pagos con verificación dual e idempotencia · anulaciones · caja diaria · panel por sucursal · producción, comisión y cuentas por cobrar · importación y exportación Excel · auditoría · superadministrador SaaS con planes y límites · asistente con herramientas y propuestas · respaldos cifrados con restauración probada · CI con PostgreSQL y e2e.
