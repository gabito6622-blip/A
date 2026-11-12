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
| B-006 | ✅ v0.6 (falta probar con la muestra real anonimizada) Plantilla de importación acordada con la clínica | `dryRun` sin errores sobre los datos reales anonimizados de muestra |
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
| B-066 | ✅ v0.9 | Orden de sondaje del periodontograma configurable por clínica (guardado en el servidor; cambiarlo en una exploración vale solo para esa) |

## Nuevos pendientes detectados en v0.4
| ID | Prioridad | Ítem |
|---|---|---|
| B-070 | ✅ v0.8 | Mensajes: enviar al proveedor desde una cola fuera de la transacción de la clínica; bandeja de respuestas (no «BAJA») para recepción |
| B-071 | P1 | Revisión legal y clínica de las plantillas de recetas y certificados y de las posologías sugeridas |
| B-072 | ✅ v0.9 (parcial) | Inventario: informe de consumo real frente al estándar con Excel y anular una transferencia en tránsito, hechos. Queda B-110 (reponer materiales al anular un cargo, ⚠ decide la clínica) |
| B-073 | ✅ v0.9 (parcial) | Laboratorio: anular un pago (solo inserción, con motivo) hecho; el costo de laboratorio ya entra en la rentabilidad por sucursal (v0.6). Quedan B-111 (costo de un reenvío) y adjuntos reales |
| B-074 | ✅ v0.9 | Agenda: cambiar la duración arrastrando el borde (o con flechas), y «Deshacer» sin sumar una reprogramación. Prueba e2e del arrastre con puntero |
| B-075 | ✅ v0.9 | Recetas: aviso orientativo de interacciones (lista corta, ⚠ revisar con un profesional de la clínica: D-58); textos de certificados editables por clínica con versiones |
| B-076 | ✅ v0.5 | Laboratorio e inventario en el celular: tablas como tarjetas en lugar de desplazamiento horizontal dentro de la tarjeta |

## Nuevos pendientes detectados en v0.5
| ID | Prioridad | Ítem |
|---|---|---|
| B-080 | P1 | ⚠ Revisión legal: datos de salud en el estado de cuenta que recibe la empresa del convenio |
| B-081 | ✅ v0.6 | Volumen persistente para archivos clínicos en el despliegue; controlador S3 compatible; miniaturas generadas en el servidor; barrido de archivos huérfanos |
| B-082 | ✅ v0.6 | Convenios: pasar al paciente la porción impaga de la empresa; pagos de empresa en efectivo; empresas en Reportes y en cuentas por cobrar generales; honorarios «por cobro» con pagos de empresas |
| B-083 | ✅ v0.6 | Gastos compartidos entre sucursales con reparto por porcentaje y comprobante adjunto real |
| B-084 | ✅ v0.6 | Botón en pantalla para generar el enlace de encuesta a mano; aviso de llamada entrante (fase 2 de R2-42); contador de tareas en el menú |
| B-085 | ✅ v0.6 | Protección contra inyección de fórmulas en `payments.xlsx` (exportación antigua) |
| B-086 | ✅ v0.9 | Semilla demo: producción atribuida a sillones (de 98,3 % a 0,9 % «sin sillón identificado») |

## Nuevos pendientes detectados en v0.6
| ID | Prioridad | Ítem |
|---|---|---|
| B-090 | ✅ v0.7 | Bloqueo por intentos: no revelar que el correo existe y evitar que un tercero bloquee cuentas ajenas (p. ej. bloqueo por IP + cuenta y desbloqueo por correo) |
| B-091 | ✅ v0.7 | Tabla `users`: quitar al rol de la app la lectura del hash de contraseña fuera del inicio de sesión (función dedicada) |
| B-092 | ✅ v0.7 | `/api/docs` solo con sesión de plataforma en producción; `/api/messages` filtrado por sucursal |
| B-093 | ✅ v0.7 | Respuesta «BAJA» de WhatsApp asociada por número completo y clínica del mensaje original, no por los últimos 8 dígitos |
| B-094 | ✅ v0.7 | Claves separadas para cifrar los 2 pasos y para firmar enlaces (rotación independiente) |
| B-095 | ✅ v0.7 | Embudo de presupuestos: limitar la lista de vencidos (hoy ~2 s con 100 000 pacientes); exportación de pacientes en streaming (~4,7 s) |
| B-096 | ✅ v0.7.1 | Miniaturas para los archivos subidos antes de v0.6; botón «Marcar revisada» en plantillas de consentimiento; logo de la clínica |
| B-097 | ✅ v0.8 | Rentabilidad: «Cobrado» con los pagos de empresas; liberar el tope anual del convenio al trasladar al paciente; gastos fijos compartidos |

## Nuevos pendientes detectados en v0.7
| ID | Prioridad | Ítem |
|---|---|---|
| B-100 | P0 | ⚠ Producción (requiere autorización). **Parte técnica lista en v0.9:** `pg_dump`/`pg_restore` 17 en la imagen, guía `docs/PUBLICAR.md`, `npm run preflight` y `npm run create-admin`. Falta lo de la dueña: `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_ID` arrancan el despachador de mensajes; `pg_dump`/`pg_restore` en la imagen, servicio de cron para `backup:run` (diario) y `backup:verify` (semanal), dónde guardar los respaldos (otro bucket con bloqueo de objetos), `BACKUP_PASSPHRASE` guardada fuera del servidor, `DENTAL_MFA_KEY` y `DENTAL_LINK_KEY`, SMTP y quién recibe las alertas |
| B-101 | ✅ v0.8 | Subida por partes para respaldos de más de 4,5 GB |
| B-102 | P3 | Métricas compartidas entre réplicas (hoy por instancia, se pierden al reiniciar). Con una sola instancia en Railway no hace falta todavía |
| B-103 | ✅ soportado (`BACKUP_VERIFY_ADMIN_URL`, ver `docs/PUBLICAR.md`); falta tener ese segundo servidor al publicar | Simulacro de restauración en un servidor separado del de producción |
| B-104 | ✅ v0.9.1 (parcial) | Exportación de pacientes con 100 000: de 3,1 s a 1,5 s (el tiempo se iba en recalcular estilos, no en la compresión). La memoria todavía sube ~100 MB durante la descarga |
| B-105 | P3 | «Primeros pasos» marca «Prestaciones» como listo con una sola prestación propia (con aviso de cuántas siguen con el precio de ejemplo): decidir la regla con la clínica |
| B-106 | ✅ v0.7 | Tabla de Personal y comparación por sucursal a 1440 px: revisado con la semilla demo, sin desborde (no se reprodujo) |

## Nuevos pendientes detectados en v0.9
| ID | Prioridad | Ítem |
|---|---|---|
| B-110 | P2 | ⚠ Decide la clínica: al anular un cargo, ¿se devuelven los materiales descontados? Hoy no, porque una anulación puede ser solo una corrección de precio después de usar el material (D-57) |
| B-111 | ✅ v0.9.1 | Laboratorio: costo adicional de un reenvío o repetición, en su fecha, con correcciones (D-61) |
| B-112 | P2 | ⚠ Revisión clínica de la lista de interacciones de recetas por un profesional de la clínica antes del piloto (D-58) |
| B-113 | ✅ v0.9.1 | Textos de certificados: vista previa con un paciente de ejemplo antes de guardar la versión |

## P1

| ID | Ítem | Criterio |
|---|---|---|
| B-010 | → ver B-048 (✅ v0.4, modo de pruebas y reglas) y B-060 (falta la cuenta de Meta de la clínica). WhatsApp Cloud API (plantillas, botones, entregas, baja) | Confirmar desde WhatsApp actualiza la cita; sin consentimiento no se envía; pruebas con un simulador |
| B-011 | ✅ v0.3 (como B-042) Periodontograma | 6 sitios por pieza; instantáneas inmutables; comparación entre fechas |
| B-012 | ✅ v0.5 Archivos clínicos privados | URL firmadas de 5 min; la descarga queda auditada; límite de tamaño y tipo |
| B-013 | ✅ v0.4 (como B-047) Inventario por sucursal | Stock por lote y vencimiento; consumo al realizar un tratamiento; alertas; transferencias con doble registro |
| B-014 | ✅ v0.3 (como B-044) Liquidación de honorarios por período | Cierre inmutable; base producción o cobro; exportación Excel |
| B-015 | ✅ Sala de espera (v0.2) y vista semanal de la agenda (v0.4; arrastre de duración en v0.9) | Cambios de estado con arrastre y teclado; prueba e2e |
| B-016 | ✅ v0.4 (como B-064) Recetas e informes PDF | Plantilla con matrícula; registrado como nota clínica |
| B-017 | ✅ v0.5 Panel: rango libre de fechas y comparación con el período anterior | Variación en % por sucursal |
| B-018 | Parcial: recuperación de contraseña, desbloqueo y alertas por correo hechos; avisos de citas por correo pendientes (hoy van por WhatsApp). Falta SMTP real (B-100). Correos transaccionales (citas, recuperación) | Proveedor configurable; sin datos clínicos |
| B-019 | ✅ v0.5–v0.6 (diario; consultas reescritas para 100 000 pacientes) Paginación con cursor en auditoría y pagos | Más de 10 000 filas sin degradación |

## P2

| ID | Ítem | Criterio |
|---|---|---|
| B-020 | Facturación SIAT con un proveedor autorizado | Emitir, anular y contingencia; pruebas en el ambiente piloto del SIN; decisión legal previa |
| B-021 | ✅ v0.5 Conciliación bancaria por extracto | Emparejar referencia y monto; las diferencias quedan para revisión |
| B-022 | ✅ v0.3 (como B-046; falta el QR real, B-061) Portal del paciente y reserva online | Disponibilidad real, captcha o límite de solicitudes, confirmación por WhatsApp |
| B-023 | ✅ v0.4 (como B-063) Laboratorios protésicos | Órdenes con estado, fechas y costo vinculadas al presupuesto |
| B-024 | ✅ v0.4 Compras y proveedores | Orden de compra → recepción → stock |
| B-025 | Facturación del SaaS a las clínicas | Cobro recurrente; suspensión automática por impago con aviso |
| B-026 | Prueba de penetración externa | Informe sin hallazgos críticos abiertos |
| B-027 | ✅ v0.7 (métricas por instancia: ver B-102) Observabilidad | Registros JSON sin datos personales; métricas de latencia; alertas |

## P3

| ID | Ítem |
|---|---|
| B-030 | Dictado de evoluciones con IA (aprobación obligatoria del profesional) |
| B-031 | Modo sin conexión |
| B-032 | ✅ v0.5 PWA instalable |
| B-033 | Parcial: rentabilidad por sillón ✅ v0.5; analítica de retención pendiente |
| B-034 | Interoperabilidad FHIR / Historia Clínica Única |

## Hecho en v0.1

Autenticación con sesiones y CSRF · bloqueo por intentos · roles y sucursales · RLS y FK compuestas · clínicas, sucursales, consultorios, personal y horarios · catálogo de prestaciones · pacientes con duplicados, búsqueda sin tildes y archivo · antecedentes médicos versionados con alertas · agenda sin solapes con disponibilidad, búsqueda de huecos, estados, reprogramación, bloqueos, lista de espera y "recuperar huecos" · recordatorios con consentimiento por wa.me · odontograma FDI con historial e inmutabilidad · evoluciones con enmiendas · presupuestos con cuotas · tratamientos → cargos · pagos con verificación dual e idempotencia · anulaciones · caja diaria · panel por sucursal · producción, comisión y cuentas por cobrar · importación y exportación Excel · auditoría · superadministrador SaaS con planes y límites · asistente con herramientas y propuestas · respaldos cifrados con restauración probada · CI con PostgreSQL y e2e.
