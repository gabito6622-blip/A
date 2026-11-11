# Informe de pruebas — v0.6

- **Fecha:** 11-nov-2026.
- **Entorno:** Node 22.23, PostgreSQL 16.15 y Chromium (Playwright 1.63). Todos los datos son **ficticios**.

## Resumen

| Suite | Comando | Resultado |
|---|---|---|
| Tipos (servidor + web) | `npm run typecheck` | ✅ sin errores |
| Unitarias + integración + respaldo (PostgreSQL real) | `npm test` | ✅ **604/604**, 42 archivos |
| End-to-end en navegador real (escritorio + celular) | `npm run test:e2e` | ✅ **54/54** |
| Recorrido automático de diseño (6 roles —propietaria, asistente, recepción, odontólogo, contabilidad y limpieza— × escritorio 1440 px y celular 390 px: todas las pantallas del menú, todas las pestañas de Configuración y de la ficha, más el portal a 360 px) | `walkall` (Playwright) | ✅ sin errores de consola, sin respuestas 403 ni 500 inesperadas y sin desborde horizontal |
| Guardas automáticas de seguridad | `tests/route-guard.test.ts`, `tests/db-hardening.test.ts` | ✅ todas las rutas de la API (401/403, lista de públicas) y toda la base (RLS, solo inserción, funciones revisadas) |
| Carga (100 000 pacientes, 600 960 citas, 1 M de auditoría) | `npm run perf:seed` + `npm run perf:bench` (fuera de CI) | ✅ pantallas diarias p95 < 300 ms; informes mensuales < 0,6 s (salvo embudo de presupuestos y exportación de pacientes, B-095) |
| Dependencias de producción | `npm audit --omit=dev` | ✅ 0 vulnerabilidades (`uuid` forzado a ≥11.1.1 para `exceljs`) |
| Cabeceras de seguridad | `curl -I` al servidor compilado | ✅ CSP `script-src 'self'`, `frame-ancestors 'none'`, HSTS, `nosniff`, `no-referrer`, `Cache-Control: no-store` en la API |
| Revisión visual | Playwright, 22 capturas (escritorio 1440 px y celular 390 px), 8 pantallas por rol | ✅ sin errores de consola, salvo el 401 esperado al cargar sin sesión |

Las pruebas de integración usan la API real (`fastify.inject`) contra una base PostgreSQL creada y migrada desde cero en cada ejecución (`tests/global-setup.ts`). No hay *mocks* de la base de datos.

## Áreas críticas pedidas y su evidencia

### Aislamiento entre clínicas (`tests/isolation.test.ts`, 9 pruebas)
- La API de la clínica A responde **404** para pacientes de B (no revela que existan); listar y editar tampoco funcionan.
- Una cita de A no puede referenciar un paciente o una sucursal de B (FK compuesta → 400).
- **SQL directo con el rol de la aplicación:**
  - con el contexto de A, las filas de B son invisibles;
  - sin contexto no se ve ningún paciente;
  - un INSERT con el `clinic_id` de B es rechazado por RLS;
  - un UPDATE cruzado afecta 0 filas.
- La aplicación nunca opera como dueño de las tablas (`current_user = dental_app`, sin BYPASSRLS).
- El superadministrador ve agregados sin datos personales. Un propietario común recibe 403 en la API de plataforma.

### Permisos por rol y sucursal (varias suites)
- Recepción de la sucursal 1 no agenda ni lista citas de la sucursal 2 (403).
- Un odontólogo no agenda en la agenda de otro (403). Solo administración agenda fuera de horario.
- Recepción no ve odontograma, evoluciones ni antecedentes (403), y en la ficha no recibe alertas médicas.
- El asistente puede ver el odontograma pero no modificarlo.
- Un propietario no profesional no accede a lo clínico.
- Recepción no marca tratamientos realizados, no verifica pagos ni anula cargos.
- Contabilidad verifica pagos y ve reportes financieros; recepción ve indicadores operativos de su sucursal, sin montos.
- Solo quien tiene `patients.export` exporta el padrón.

### Agenda y solapamientos (`tests/agenda.test.ts`, 17 pruebas)
- Se rechaza el solape de **profesional**, de **consultorio** y de **paciente** (incluso en otra sucursal con otro profesional). Las citas contiguas sí se permiten.
- **Concurrencia:** 4 reservas simultáneas al mismo horario → exactamente 1 éxito y 3 respuestas 409.
- Una cita cancelada libera el horario.
- La idempotencia evita duplicar la cita en un doble clic.
- Se rechazan las transiciones de estado inválidas y las citas en el pasado, fuera de horario o en horarios bloqueados.
- La reprogramación valida el nuevo horario y lleva la cuenta de reprogramaciones.
- La disponibilidad y la búsqueda de huecos descuentan las citas y usan la duración de la prestación.
- La lista de espera respeta el turno preferido.
- Los recordatorios solo salen con consentimiento y el mensaje no incluye el motivo clínico.

### Exactitud financiera (`tests/billing.test.ts`, 17; `tests/reports.test.ts`, 4)
- Totales con descuentos y plan de cuotas que suma exactamente el total (centavos impares incluidos).
- Marcar un tratamiento como realizado genera **un solo** cargo, aun con dos solicitudes simultáneas.
- La transferencia queda pendiente y **no reduce el saldo** hasta que otra persona la verifica (control dual). Una segunda verificación da 409.
- Se rechazan: referencia bancaria duplicada, falta de referencia en QR o transferencia, sobrepago del presupuesto, y la misma clave de idempotencia con otros datos.
- Anular un cargo genera un asiento negativo, devuelve el tratamiento a pendiente y el saldo vuelve a 0. Un cargo no se anula dos veces.
- **Panel:** cobrado, producción, pendiente, cuentas por cobrar y comisión estimada **cuadran exactamente** con los movimientos sembrados.
- **Inmutabilidad:**
  - el rol de la app no puede modificar ni borrar pagos (permiso denegado);
  - ni siquiera el dueño de la base puede alterar un monto (trigger);
  - la auditoría y los cargos son de solo inserción.

### Registro clínico (`tests/clinical.test.ts`, 8 pruebas)
- Odontograma FDI con dientes permanentes y temporales, y validación de piezas inexistentes (19, 56) y de superficies obligatorias.
- Una anulación deja historial y no se puede repetir.
- Las evoluciones son **inmutables** (el UPDATE se rechaza a nivel de base) y se corrigen con enmiendas.
- Los antecedentes son versionados y generan alertas.
- Cada lectura del odontograma queda auditada.

### Otros
- **Autenticación (7 pruebas):**
  - mensaje genérico ante credenciales incorrectas;
  - cookie HttpOnly y SameSite;
  - bloqueo tras 5 intentos, con auditoría;
  - CSRF obligatorio;
  - el cierre de sesión revoca el token;
  - cambiar la contraseña cierra las demás sesiones;
  - una persona desactivada pierde el acceso al instante.
- **Pacientes (7):**
  - N° de ficha correlativo;
  - búsqueda sin tildes;
  - duplicados por documento, teléfono o nombre;
  - un menor requiere responsable;
  - fecha del consentimiento;
  - archivar sin borrar;
  - importación Excel con `dryRun` (2 correctos, 2 duplicados, 1 error, como se esperaba);
  - exportación que **neutraliza fórmulas** (`=HYPERLINK` sale como texto).
- **Asistente (5):** herramientas filtradas por rol; horarios reales para "limpieza" (profilaxis, 45 min); `proponer_cita` **no crea** la cita; sin clave de IA responde 503; queda auditado.
- **Migraciones (2):** son idempotentes y detectan una migración ya aplicada que fue modificada.
- **Respaldo (1):** respaldo cifrado (AES-256) → restauración en una base vacía → mismos conteos, y **RLS sigue aislando** tras restaurar.

### End-to-end (`e2e/`, navegador real con la clínica demo de 5 sucursales)
1. Credenciales incorrectas → mensaje genérico.
2. La propietaria ve el comparativo de las 5 sucursales.
3. Recepción registra un paciente nuevo desde la agenda. El sistema rechaza las 07:00 (fuera de horario) y agenda a las 12:00. Un segundo paciente en el mismo horario es rechazado por solape.
4. Una odontóloga registra una caries en la pieza 36 y una evolución firmada.
5. Recepción no ve la pestaña del odontograma. Registra un pago QR, que queda "por verificar"; contabilidad lo confirma y pasa a "Confirmado".
6. El asistente informa que la IA no está configurada y ofrece acciones rápidas.
7. **Celular (Pixel 7):** barra inferior, sin desborde horizontal en Inicio, Agenda, Pacientes y Caja.

### Módulos de v0.3 (pruebas escritas por cada equipo y re-ejecutadas juntas tras integrar)
| Archivo | Pruebas | Qué verifica |
|---|---|---|
| `recalls.test.ts`, `visit-quality.test.ts` | 31 | Ciclo de vida de los controles, vínculo automático, regla de 3 intentos, eventos inmutables, métricas de espera, puntualidad y duración que cuadran exactamente con los datos sembrados |
| `cash-sessions.test.ts`, `fees.test.ts` | 24 | Arqueo exacto al centavo, una caja abierta por cajero, inmutabilidad de lo cerrado, exigencia de caja abierta, liquidación en ambas bases, ajustes en el período siguiente |
| `perio-unit.test.ts`, `perio.test.ts` | 34 | Índices sobre lo medido (18 sitios → 16,7 %, no 1,6 %), rechazo del "564", inmutabilidad, enmiendas, comparación, conflicto de revisión |
| `budgets-v2.test.ts` | 25 | Prorrateo exacto, nunca total negativo, sesiones, versiones, enlace público (verificación, bloqueo, nada visible antes de verificar), saldo único |
| `portal.test.ts` | 27 | Código sin enumeración, límites, retención del horario, concurrencia (dos pacientes, un horario → uno gana), modo solicitud, datos solo de la familia, 404 con la reserva desactivada |
| `biosafety.test.ts`, `myday.test.ts` | 10 | El rol de limpieza no ve pacientes ni agenda, limpiezas pendientes por consultorio, numeración correlativa de ciclos, alertas, inmutabilidad, aislamiento entre clínicas |

Todas incluyen pruebas de **aislamiento entre clínicas** para sus tablas nuevas.

### Módulos de v0.4 (escritos por cada equipo y re-ejecutados juntos tras cada fusión)
| Archivo | Pruebas | Qué verifica |
|---|---|---|
| `inventory.test.ts` | 25 | Invariante lotes = stock = movimientos como propiedad (220 movimientos al azar más conteos), FEFO, nunca negativos, transferencia en tránsito, aprobación del conteo, compra con recepción parcial y rechazo, consumo automático con falta de stock, permisos y aislamiento en las 16 tablas |
| `lab.test.ts` | 19 | Transiciones de estado válidas e inválidas, costo fijo al recibir, pagos sin exceder el costo ni pagar órdenes no recibidas, honorarios con costo real al centavo, aislamiento por API, SQL y RLS |
| `documents.test.ts` | 16 | Texto real del PDF (lector propio), huella y verificación pública sin datos personales, inmutabilidad, anulación y reemisión, aviso de alergia, descargas auditadas, permisos y aislamiento |
| `messaging.test.ts` | 25 | Variables clínicas rechazadas, idempotencia del programador, reprogramar anula y recrea, horario de silencio, tope diario, consentimiento por finalidad, baja por «BAJA» y por el portal, token de un solo uso, firma del webhook, aislamiento |
| `agenda-plus.test.ts` | 25 | Recurrencia como función pura, conflictos de serie con hueco sugerido, límite de 52, «solo esta / esta y las siguientes», tipos de cita, historial sin datos clínicos para recepción, cursor y hora local, aislamiento |

End-to-end nuevos: `inventario.spec.ts` (3, incluido el celular), `laboratorio.spec.ts`, `documentos.spec.ts`, `mensajes-automaticos.spec.ts` (aviso simulado → `/c/:token` → cita confirmada) y `agenda-semana.spec.ts` (3: serie con conflicto, arrastre con conflicto y Deshacer, historial con filtros).

### Módulos de v0.5 (escritos por cada equipo y re-ejecutados juntos tras cada fusión)
| Archivo | Pruebas | Qué verifica |
|---|---|---|
| `clinical-files.test.ts` | 20 | Rechazo por firma aunque la extensión mienta, límite de tamaño, duplicado por hash, enlace vencido o de otra persona o clínica, auditoría de cada entrega, recepción solo con documentos escaneados, aislamiento por API y RLS |
| `management.test.ts` | 22 | Rentabilidad por sucursal y por sillón al centavo, «sin datos» en vez de cero, gastos fijos sin duplicar, anulación con motivo, fichaje no editable, recepción y odontólogo sin acceso, exportaciones con los mismos totales que la pantalla |
| `coordination.test.ts` | 14 | Ciclo de vida y permisos de tareas, limpieza sin datos del paciente, llamadas en el historial, diario sin datos clínicos, cursor estable con 10 500 filas de auditoría, tarjetas por rol y sucursal |
| `family-segments.test.ts`, `feedback-checkin.test.ts` | 32 | Relaciones bidireccionales, campañas que excluyen a quien no consintió o se dio de baja, NPS correcto, token de encuesta de un solo uso sin datos clínicos, **detractor → tarea para gerencia** (sin el comentario; cerrar uno cierra el otro), llegada con QR fuera de ventana, idempotencia y límites |
| `agreements.test.ts` | 28 | Precio de convenio copiado en la línea, copago al centavo con impares, paciente + empresa = total, pago de empresa a varios cargos, no facturar más de lo pendiente, conciliación exacta y sugerida sin verificación automática, reimportación sin duplicar |

End-to-end nuevos: `imagenes.spec.ts` (2), `gestion.spec.ts` y `fichaje-movil.spec.ts` (4), `coordinacion.spec.ts` (3), `experiencia.spec.ts` (3), `convenios-conciliacion.spec.ts`, `app-movil.spec.ts` (2: instalable, caché sin datos de la API, aviso sin conexión y tablas como tarjetas) y en `movil.spec.ts` el botón «Más» con el menú completo.

### v0.6: puesta en marcha, archivos, convenios, seguridad y carga
| Archivo | Pruebas | Qué verifica |
|---|---|---|
| `onboarding.test.ts` | 11 | Primeros pasos derivados de datos (cambian al completar y reaparecen si algo falta), importación de pacientes, citas (solapes, fuera de horario, inexistentes) y saldos iniciales que cuadran con el saldo, idempotencia, inyección de fórmulas, aislamiento |
| `files-s3.test.ts`, `files-thumbs.test.ts` | 27 | Vectores oficiales de SigV4, S3 falso que valida la firma (subir, leer, borrar, firma inválida, reloj desfasado, cifrado), miniaturas rechazadas si son enormes o no son imagen, la galería no audita originales, barrido seco y con `--apply` |
| `daily-pending.test.ts` | 6 | Contador de tareas por rol y sucursal, encuesta desde la cita con permiso y consentimiento |
| `agreements-expenses-v2.test.ts` | 27 | Traslado al paciente (saldos cuadran, plazo, sin dobles ni en paralelo, reversión), efectivo de empresa en la caja, antigüedad con límites exactos **y con saldos iniciales**, honorarios con pagos de empresa al centavo, reparto de gastos, comprobantes |
| `route-guard.test.ts`, `db-hardening.test.ts`, `security-audit.test.ts` | 33 | Ver «Guardas automáticas»; además, regresión de cada hallazgo de la auditoría (IP falsificada, fórmulas, sucursal, auditoría clínica, registros sin datos) |
| `perf-rewrites.test.ts` | 5 | La vista del saldo da lo mismo que la fórmula de referencia (con saldos iniciales y traslados); la búsqueda indexada da los mismos resultados y no cruza clínicas |

### Carga (antes → después, p95 en ms, 10 repeticiones)
| Ruta | Antes | Después |
|---|---:|---:|
| Búsqueda de pacientes (nombre / CI) | 612 / 482 | 76 / 44 |
| Historial del paciente | 579 | 18 |
| Tarjetas del Inicio | 313 | 14 |
| Presupuestos presentados | 899 | 77 |
| Diario de actividad | 1 774 | 44 |
| Panel del mes / con comparación | 1 973 / 4 013 | 302 / 597 |
| Cuentas por cobrar | 784 | 220 |
| Exportar pacientes a Excel | 7 826 | 4 744 |
| Embudo de presupuestos | 1 992 | 2 038 (B-095) |

Agenda del día y de la semana, disponibilidad, ficha y «mi día» ya estaban por debajo de 100 ms. La máquina se compartía con otros equipos, así que los números tienen ruido.

### Seguridad y consentimientos (v0.2, `tests/security.test.ts` con 15 pruebas, más 4 end-to-end)
- **TOTP:** cumple los vectores oficiales del RFC 6238 (T=59 s → 287082; T=1111111109 → 081804) y tolera ±30 s. Se rechazan los códigos viejos.
- **Cifrado AES-256-GCM:** con otra clave o con datos alterados, falla.
- **Activación de 2 pasos:**
  - pide la contraseña;
  - el secreto queda cifrado en la base;
  - un código incorrecto se rechaza;
  - entrega 10 códigos de recuperación.
- **Ingreso posterior:** sin el código, la API responde `mfa_required`. Un código de recuperación funciona **una sola vez**. 5 códigos incorrectos anulan la sesión y se audita `auth.mfa_locked`.
- **Política por rol:** solo el propietario la cambia (el administrador recibe 403). Una recepcionista queda bloqueada (`mfa_enrollment_required`) hasta activar los 2 pasos.
- **"Olvidé mi contraseña":**
  - misma respuesta para un correo existente o inexistente, y solo se envía correo al existente;
  - el enlace es de un solo uso y vence a los 30 minutos;
  - rechaza contraseñas débiles;
  - cierra las sesiones anteriores.
- **Contraseña temporal emitida por administración:**
  - obliga a cambiarla (`password_change_required`) antes de usar el sistema;
  - **se rechaza** si la persona pertenece a otra clínica (`multi_clinic_user`).
- **Consentimientos:**
  - la firma en pantalla es obligatoria si se elige ese método;
  - el texto se copia con los datos ya completados y el hash se verifica (`integrityOk`);
  - el consentimiento de recordatorios actualiza la ficha y la revocación también;
  - el documento es **inmutable** a nivel de base;
  - un menor no firma por sí mismo;
  - una versión vieja de la plantilla se rechaza;
  - un asistente no puede firmar consentimientos informados;
  - los cambios hechos desde la ficha quedan registrados como "registrado por el personal".
- **Idempotencia concurrente (B-007 resuelto):** dos pagos simultáneos con la misma clave responden **ambos 200 con el mismo pago**.
- **End-to-end:**
  - la gerente activa los 2 pasos con el QR e ingresa con el código de la app (un código incorrecto muestra el error);
  - una recepcionista con contraseña temporal es obligada a cambiarla;
  - firma con el mouse en el lienzo → "Integridad verificada";
  - en la sala de espera, "Llegó" mueve la tarjeta a la columna de espera.

## Hallazgos durante las pruebas (y correcciones)

| Hallazgo | Corrección |
|---|---|
| La búsqueda difusa de pacientes devolvía coincidencias irrelevantes ("archivo prueba" encontraba "Niño Prueba") | Cada palabra debe aparecer, o se usa `word_similarity` > 0,7 |
| Un intento de login fallido no quedaba registrado (el `throw` hacía ROLLBACK del contador) | La respuesta 401 se envía sin excepción y el contador y la auditoría persisten |
| Las etiquetas de formulario no estaban asociadas a los campos (accesibilidad, detectado por e2e) | El componente `Field` envuelve el control; los grupos llevan `role=group` |
| Anular un cargo y volver a realizar el tratamiento violaba un índice único | Se reemplazó por un bloqueo de fila y una transición de estado; está probado |
| La caja del día no mostraba la referencia bancaria | Agregada |
| (v0.2) Un código TOTP incorrecto cerraba la pantalla de verificación (cualquier 401 se trataba como sesión vencida) | Solo el código `unauthenticated` cierra la sesión en la interfaz |
| (v0.2) El texto de ayuda de un campo formaba parte de su nombre accesible ("Nueva contraseña Mínimo 10…") | La ayuda queda fuera de la etiqueta |
| (v0.2) La plantilla de recordatorios no nombraba al paciente | Las plantillas comienzan con "Yo, {paciente}" |
| (v0.2, CI) El `pg_dump` del servidor de CI era más nuevo que PostgreSQL 16 y la restauración fallaba | CI con PostgreSQL 17 y requisito de versión documentado |
| (v0.6) Tres equipos cambiaron a la vez la fórmula del saldo: al integrar, la migración de carga habría fallado o los informes habrían ignorado saldos iniciales y traslados | Una sola fórmula en `patient_money_v` con prueba de referencia (D-33) |
| (v0.6) La antigüedad de saldos no contaba los saldos iniciales importados | Incluidos, con prueba |
| (v0.6) Auditoría interna: 8 hallazgos (1 alto, 5 medios, 2 bajos) | Corregidos con prueba de regresión; los que requieren decisión, en B-090 a B-095 |
| (v0.5) En el celular no había forma de llegar a pantallas fuera de la barra inferior; con 22 opciones el menú lateral cortaba las últimas (lo detectó una e2e que no encontraba «Configuración») | Menú por secciones con desplazamiento y botón «Más» en el celular, con prueba |
| (v0.5) La demo mostraba una rentabilidad de −600 % (gastos realistas frente a muy poca producción de ejemplo) | La semilla genera unos dos meses de actividad |
| (v0.5) Encuestas y tareas se hicieron en paralelo y el detractor solo quedaba como aviso | Migración 0020: el detractor crea una tarea de seguimiento para gerencia |
| (v0.4) Dos pruebas e2e fallaban según el día: la semilla demo ocupaba el horario que usaban | La semilla deja libre 12:00–14:30 y la prueba de arrastre busca un día con huecos libres |
| (v0.4) Equipo D detectó que «60.00» se interpretaba como 6000 Bs | Corregido el analizador de montos, con prueba |
| El pool del superadmin forzaba el rol de la app y no veía datos | El rol se fija solo en el pool de la app, como parámetro de conexión |

## Lo que NO está probado todavía (riesgo conocido)

- **Carga y rendimiento.** Probado solo con la demo (90 pacientes, ~1100 citas). Pendiente una prueba con 100 000 pacientes y 5 años de citas.
- **Correo real.** El envío por SMTP no se probó contra un servidor; las pruebas usan un buzón en memoria.
- **Impresión de documentos.** Los PDF del servidor sí están probados (se lee su texto), pero la ventana de impresión del navegador no.
- **WhatsApp real.** El adaptador de Cloud API y el webhook están probados con firmas y respuestas simuladas; no se envió ningún mensaje real (no hay cuenta de la clínica).
- **Arrastre táctil** en la agenda: implementado, sin prueba automática.
- **Archivos clínicos en Railway:** sin un volumen persistente montado en `/data`, se perderían al redeplegar. No se probó en un despliegue real.
- **Conciliación con extractos reales:** probada con un extracto de ejemplo (`docs/extracto-ejemplo.csv`); cada banco boliviano tiene su formato y habrá que mapear las columnas con un extracto real anonimizado.
- **Asistente con IA real.** No hay clave en este entorno, así que el flujo del chat con el modelo no se ejecutó. Sí están probadas las herramientas, los permisos y la degradación sin clave.
- **Pantallas de Configuración, Reportes, Asistente y Plataforma.** Están compiladas y revisadas visualmente, pero sin e2e propios. Su API sí está probada.
- **Navegadores** distintos de Chromium (Safari iOS, Firefox).
- **Prueba de penetración externa** (B-026).
- **Imagen Docker.** El daemon de Docker no estaba disponible en este entorno, así que el `Dockerfile` no se construyó aquí; lo cubre la CI con el mismo procedimiento de compilación.

## Cómo reproducir

```bash
cd dental
npm ci
npm run typecheck
npm test
npm run test:e2e
```

Requisitos: PostgreSQL local con el usuario `postgres`/`postgres`, o las variables `TEST_DATABASE_URL` y `E2E_DATABASE_URL`. Las pruebas **crean y borran** las bases `dental_test`, `dental_e2e` y `dental_restore_test`, y se niegan a usar una base cuyo nombre no contenga `test` o `e2e`.
