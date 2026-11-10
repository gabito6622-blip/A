# Informe de pruebas — v0.1

- **Fecha:** 10-nov-2026.
- **Entorno:** Node 22.23, PostgreSQL 16.15 y Chromium (Playwright 1.63). Todos los datos son **ficticios**.

## Resumen

| Suite | Comando | Resultado |
|---|---|---|
| Tipos (servidor + web) | `npm run typecheck` | ✅ sin errores |
| Unitarias + integración + respaldo (PostgreSQL real) | `npm test` | ✅ **90/90**, 11 archivos |
| End-to-end en navegador real (escritorio + celular) | `npm run test:e2e` | ✅ **7/7** |
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

## Hallazgos durante las pruebas (y correcciones)

| Hallazgo | Corrección |
|---|---|
| La búsqueda difusa de pacientes devolvía coincidencias irrelevantes ("archivo prueba" encontraba "Niño Prueba") | Cada palabra debe aparecer, o se usa `word_similarity` > 0,7 |
| Un intento de login fallido no quedaba registrado (el `throw` hacía ROLLBACK del contador) | La respuesta 401 se envía sin excepción y el contador y la auditoría persisten |
| Las etiquetas de formulario no estaban asociadas a los campos (accesibilidad, detectado por e2e) | El componente `Field` envuelve el control; los grupos llevan `role=group` |
| Anular un cargo y volver a realizar el tratamiento violaba un índice único | Se reemplazó por un bloqueo de fila y una transición de estado; está probado |
| La caja del día no mostraba la referencia bancaria | Agregada |
| El pool del superadmin forzaba el rol de la app y no veía datos | El rol se fija solo en el pool de la app, como parámetro de conexión |

## Lo que NO está probado todavía (riesgo conocido)

- **Carga y rendimiento.** Probado solo con la demo (90 pacientes, ~1100 citas). Pendiente una prueba con 100 000 pacientes y 5 años de citas.
- **Idempotencia concurrente exacta** (B-007). Con dos envíos simultáneos con la misma clave, uno puede recibir 409 en lugar del pago existente. **No hay doble cobro**, pero la respuesta no es uniforme.
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
