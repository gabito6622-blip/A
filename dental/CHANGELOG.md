# Changelog

Formato basado en *Keep a Changelog*. Versionado semántico.

## [0.9.0] — 2026-11-12

Todo listo para publicar el día que la dueña lo autorice (sin publicar nada) y las mejoras opcionales del backlog. Migraciones 0031 y 0032.

### Agregado
- **Listo para publicar (B-100, parte técnica):**
  - la imagen trae las herramientas de respaldo (`pg_dump`/`pg_restore` 17) y la CI comprueba que funcionen dentro de la imagen, sin subirla a ningún lado;
  - `npm run preflight`: chequeo previo que dice qué falta en la configuración de producción, sin mostrar ningún secreto;
  - `npm run create-admin`: crea el administrador de la plataforma con contraseña temporal;
  - guía paso a paso `docs/PUBLICAR.md`, con listas de verificación y cómo volver atrás.
- **Agenda (B-074):**
  - cambiar la duración de una cita arrastrando su borde inferior (o con las flechas del teclado), en tramos de 15 min, con «Deshacer»;
  - «Deshacer» un movimiento ya no suma una reprogramación.
- **Inventario (B-072):**
  - anular una transferencia en tránsito con motivo: todo vuelve al stock de origen con su costo;
  - informe «Consumo real» frente al estándar de cada prestación, con exportación a Excel.
- **Laboratorio (B-073):** anular un pago mal registrado, con motivo; queda en el historial tachado y la orden vuelve a deberse.
- **Recetas (B-075):**
  - aviso orientativo de interacciones con la medicación actual, la marca de anticoagulantes, el embarazo y las otras líneas de la receta; no bloquea y queda anotado en la historia;
  - Configuración › Certificados: la clínica adapta el título y el texto de sus certificados y derivaciones, con historial de versiones y «Volver al texto original».
- **Periodontograma (B-066):** el orden de sondaje se guarda para toda la clínica (antes, en cada navegador).
- **Semilla demo (B-086):** cada tratamiento tiene su cita atendida con consultorio; la producción «sin sillón identificado» baja de 98,3 % a 0,9 %.

### Corregido
- Anular un pago a laboratorio fallaba por permisos de la base (lo detectaron las pruebas nuevas).
- El tope «no pagar más que el costo de la orden» contaba pagos anulados.
- Quien ve todas las sucursales no veía el botón «Anular» de una transferencia (aparecía solo como «Por recibir»).
- La comprobación de alergias de un paciente de otra clínica respondía vacío en vez de 404 (no exponía datos).
- La propietaria no veía la lista de textos de certificados (pedía permiso clínico).
- «Alergias: Ninguna» se mostraba en rojo como si fuera una alergia.
- En el celular, el nombre y el código de un insumo salían pegados en las tablas en tarjetas.
- El informe de consumo avisa cuando ningún tratamiento descontó materiales, para no leer −100 % como desperdicio.

## [0.8.0] — 2026-11-11

Los últimos pendientes que dependían solo de nosotros. Migraciones 0029 y 0030.

### Agregado
- **Mensajes reales seguros (B-070):**
  - con WhatsApp configurado, los mensajes salen desde una cola, después de guardar la operación, nunca dentro de ella: si algo falla a mitad de camino, no sale un mensaje sin registro;
  - errores pasajeros (WhatsApp ocupado, sin conexión) se reintentan solos con espera creciente;
  - un envío interrumpido no se repite para no duplicarlo: queda como fallido para reintentarlo a mano.
- **Bandeja «Respuestas» para recepción:**
  - lo que los pacientes contestan por WhatsApp, solo de las sucursales de cada persona y con contador en el menú;
  - se marca «atendida» con una nota, o se vuelve a pendiente;
  - las «BAJA» siguen procesándose solas.
- **Respaldos grandes (B-101):** subida por partes a la nube para respaldos de cualquier tamaño (antes, hasta 4,5 GB), sin cargar todo el archivo en memoria y sin dejar partes sueltas si algo falla.
- **Rentabilidad (B-097):**
  - «Cobrado» incluye lo que pagan las empresas de convenio, en la sucursal de cada tratamiento que cubren;
  - lo que se traslada al paciente libera el tope anual del convenio;
  - gastos fijos mensuales repartidos entre sucursales, con el borrador de cada mes repartido al centavo.

## [0.7.1] — 2026-11-11

Cierra B-096, lo último que dependía solo de nosotros. Migración 0028.

### Agregado
- **Logo de la clínica:**
  - se sube desde Configuración › Clínica: PNG o JPG; el navegador lo ajusta a 512 px y el servidor lo verifica por firma de bytes, tamaño y medidas;
  - se ve en la barra lateral, en los documentos PDF nuevos (recetas, recibos, presupuestos, consentimientos, estados de cuenta) y en la página de reservas;
  - quitarlo o cambiarlo queda en el historial y en la auditoría;
  - los documentos ya emitidos no cambian.
- **«Marcar revisada» en las plantillas de consentimiento:**
  - queda con quién, cuándo y una nota opcional, y es de solo inserción;
  - «Primeros pasos» la cuenta como revisada;
  - es una marca interna de la clínica: no declara validez legal.
- **Miniaturas de las imágenes antiguas:**
  - al abrir en el visor una imagen sin miniatura, se genera desde la imagen ya cargada, sin volver a descargar el original;
  - Configuración › Clínica muestra cuántas faltan y las genera todas con una barra de progreso.

## [0.7.0] — 2026-11-11

Lo que faltaba de nuestro lado antes del piloto: seguridad decidida, informes rápidos, copias de seguridad que se prueban solas y manuales para capacitar al personal. Migraciones 0025 y 0027. Sin despliegue: todo probado en local.

### Seguridad (B-090 a B-094)
- **Ingreso fallido:** misma respuesta y mismo tiempo exista o no el correo, esté bloqueado o deshabilitado.
- **Bloqueo por cuenta + origen:** 5 fallos desde una red bloquean solo esa red 15 minutos; un tercero ya no puede dejar fuera a la persona.
- **Ataques distribuidos:** 50 fallos en una hora bloquean la cuenta y le llega por correo un enlace de desbloqueo (firmado, de un solo uso, vence en 1 hora).
- **Desbloqueo por gerencia:** Configuración › Personal muestra «Ingreso bloqueado» y el botón «Desbloquear» (auditado).
- **Secretos fuera del alcance de la app:** el rol de la aplicación ya no puede leer el hash de la contraseña ni los secretos de los 2 pasos; el ingreso los verifica con funciones mínimas de la base.
- **Documentación de la API:** en producción, solo para la plataforma (al resto, 404).
- **Mensajes por sucursal:** la bandeja de mensajes y las respuestas recibidas se filtran por sucursal.
- **«BAJA» de WhatsApp:** se asocia por el número completo (con código de país) y la clínica que escribió a ese número, ya no por los últimos 8 dígitos.
- **Claves separadas con rotación:** `DENTAL_MFA_KEY` (2 pasos) y `DENTAL_LINK_KEY` (enlaces), cada una con `*_PREVIOUS` para cambiarla sin cortar a nadie; obligatorias y distintas en producción.

### Operación diaria
- **Respaldo programado** `npm run backup:run`:
  - cifrado obligatorio en producción, con los archivos clínicos incluidos;
  - se guarda en S3 bajo su propio prefijo o en una carpeta local;
  - retención 7 diarios / 4 semanales / 12 mensuales.
- **Simulacro de restauración** `npm run backup:verify`:
  - restaura el último respaldo en una base temporal;
  - comprueba integridad, clave, **firma del respaldo** (HMAC con la clave del respaldo: detecta un archivo alterado aunque alguien reescriba sus huellas), migraciones, conteos por tabla, saldos, RLS y archivos;
  - borra la base temporal al terminar.
- **Monitoreo:** `/api/ready`, métricas por ruta (sin datos personales) y panel «Estado del sistema» para la plataforma.
- **Alertas** por correo y webhook, sin repetirse:
  - respaldo viejo o fallido;
  - simulacro viejo o fallido;
  - pico de errores;
  - servicio no listo.

### Informes rápidos (B-095)
- **Seguimiento de presupuestos:**
  - las bandejas muestran por defecto los últimos 90 días (selector 30/90/180/todo), con aviso en pantalla;
  - tope de 100 por bandeja con «Ver más»;
  - p95 de 2 038 ms a 182 ms con 100 000 pacientes.
- **Exportación de pacientes a Excel por flujo:** empieza a bajar en 35 ms (antes había que esperar el archivo completo); misma protección contra fórmulas.

### Capacitación
- **Manuales por puesto:** recepción, caja, odontólogo, asistente, limpieza, contabilidad, gerencia y dueña, más la guía del portal para pacientes y familias, cada uno con su hoja de una página para imprimir.
- **Pasos comprobados:** cada paso se verificó en un navegador real con datos ficticios.
- **Dentro de la app:** Ayuda › «Manual de mi puesto».

### Corregido
- «Pacientes nuevos» del Inicio contaba toda la clínica aunque la persona viera solo su sucursal.
- Porcentajes y fechas con el mismo formato en todas las pantallas («26,5 %», «01/11/2026»).
- La caja muestra el recuadro «Tarjeta» cuando hubo cobros con tarjeta.
- El panel lateral (por ejemplo «Cita» en la Agenda) se anuncia con su nombre a los lectores de pantalla.
- La guía «Liquidar honorarios» ya no le pide a contabilidad un botón que no tiene.
- En el celular, la primera columna de las tablas en tarjetas ya no pega la etiqueta al valor.
- Dos pruebas que fallaban por azar: el nombre de prueba de la clínica con «36» y el orden de un identificador aleatorio en la retención de S3. Una tercera fallaba por azar porque el cifrado del respaldo no detectaba un byte alterado según dónde cayera: se agregó la firma del respaldo.

## [0.6.0] — 2026-11-11

Preparación del piloto: que la clínica pueda arrancar sola, traer sus datos y operar con seguridad y velocidad a escala. Cuatro equipos en paralelo (migraciones 0021–0024) más la integración.

### Agregado
- **Puesta en marcha (B-006):**
  - «Primeros pasos» en el Inicio del propietario: lista calculada desde los datos reales (clínica y membrete, sucursales y consultorios, personal, horarios, precios con aviso si siguen los de ejemplo, tipos de cita, consentimientos revisados, verificación en dos pasos, pacientes), con progreso y enlace a cada pantalla;
  - «Ayuda» con guías por rol, buscador y botón «?» que abre la guía de la pantalla actual;
  - «Importar datos» desde Excel: pacientes, citas futuras (validadas con la agenda) y saldos iniciales; revisión sin guardar, importación con el número exacto confirmado, sin duplicar al reimportar, reporte de errores fila por fila y plantillas con ejemplos;
  - el saldo inicial es un movimiento de apertura de solo inserción que el saldo del paciente suma, sin contar como producción ni como cobro.
- **Archivos clínicos para producción (B-081):**
  - miniaturas generadas en el navegador: la galería ya no descarga ni audita originales;
  - almacenamiento S3 compatible (AWS, Cloudflare R2, Backblaze B2, MinIO) con firma SigV4 propia, cifrado AES256 y sin SDK;
  - barrido de huérfanos `npm run files:sweep` (simulación por defecto; `--apply` borra solo lo no referenciado con más de 24 h).
- **Uso diario (B-084):** «Enviar encuesta» o «Copiar enlace» desde la cita atendida, y contador de tareas pendientes en el menú.
- **Convenios y gastos (B-082, B-083):**
  - trasladar al paciente, con motivo y nunca automático, la porción que la empresa rechazó o no pagó en el plazo del convenio (reversible una vez);
  - pagos de empresa en efectivo que entran a la caja de quien los recibe;
  - cuentas por cobrar generales con antigüedad (0–30, 31–60, 61–90, +90 días), pacientes y empresas por separado, incluidos los saldos iniciales importados;
  - honorarios «por cobro» que cuentan los pagos de empresas, al centavo y sin doble conteo;
  - gastos repartidos entre sucursales por porcentaje y comprobante adjunto verificado.
- **Seguridad (auditoría interna):**
  - prueba automática que recorre **todas** las rutas de la API (sin sesión → 401, sin permiso → 403, lista explícita de rutas públicas) y la base (RLS, tablas de solo inserción, funciones `SECURITY DEFINER` revisadas);
  - todas las exportaciones a Excel pasan por `lib/xlsxSafe.ts` (protección contra fórmulas) y una prueba impide escribirlas de otra forma.
- **Rendimiento:** con 100 000 pacientes, 600 000 citas y 1 millón de registros de auditoría, las pantallas diarias responden por debajo de 300 ms (p95) y los informes mensuales por debajo de 0,6 s. Script de carga `npm run perf:seed` y `npm run perf:bench` (fuera de CI).

### Corregido (seguridad)
- **Alta:** detrás del proxy se confiaba en cualquier `X-Forwarded-For`, lo que permitía saltar los límites por IP (inicio de sesión, códigos, enlaces públicos). Ahora se confía en un número fijo de proxies (`TRUST_PROXY`, 1 por defecto en producción).
- **Media:** inyección de fórmulas en `payments.xlsx` (B-085), el libro de esterilización y otras exportaciones.
- **Media:** faltaba la verificación de sucursal al cambiar una entrada de la lista de espera y al cancelar un tratamiento; `/api/audit` mezclaba sucursales.
- **Media:** el detalle de auditoría mostraba datos clínicos (pieza, diagnóstico, motivos) a propietarios y administradores sin permiso clínico.
- **Media:** los registros del servidor incluían la consulta de búsqueda (nombres, CI), los tokens de enlaces públicos y el `detail` de PostgreSQL.
- **Baja:** las rutas del personal responden 401 antes de leer el cuerpo; las públicas aceptan como máximo 1 MB; el token del webhook se compara en tiempo constante.

### Integración
- Tres equipos cambiaron en paralelo la fórmula del saldo del paciente (saldos iniciales, traslados de la empresa y cálculo por lotes). Queda **una sola fórmula** en la vista `patient_money_v`, que usan `patient_money()` y los informes, con una prueba de referencia.
- La prueba de flujos de la agenda pide un horario libre a la agenda en lugar de usar una hora fija.

## [0.5.0] — 2026-11-11

Revisión de lo que todavía faltaba frente a la competencia ("lo que todo software dental tiene"). Cinco equipos más en paralelo (migraciones 0015–0019), más el trabajo del integrador (migración 0020, app instalable y menú).

### Agregado
- **Imágenes y archivos clínicos (B-012):**
  - pestaña en la ficha para radiografías periapicales y panorámicas, fotos intra y extraorales y documentos escaneados;
  - galería con filtros por tipo y pieza, visor con zoom, comparación lado a lado (antes/después), subida desde la cámara del celular o arrastrando;
  - el tipo se verifica por la firma del archivo (JPEG, PNG, WebP, PDF; DICOM solo descarga), sin duplicados por paciente (SHA-256);
  - enlaces firmados de 5 minutos atados a la persona y a su sesión; cada apertura queda auditada; archivar pide motivo y no borra;
  - recepción solo maneja documentos escaneados; desde el odontograma se llega a las imágenes de cada pieza;
  - los respaldos incluyen la carpeta de archivos (`DENTAL_FILES_DIR`).
- **Gestión del dueño y del gerente (R2-41, R2-43, B-017, B-033):**
  - rentabilidad mensual por sucursal y por sillón: producción, cobrado, laboratorio real, materiales, honorarios liquidados y gastos; cada número explica su fuente y muestra «sin datos» en lugar de suponer cero;
  - gastos por sucursal y categoría; los fijos mensuales se generan como borrador para confirmar, sin duplicar; anular pide motivo;
  - fichaje del personal desde el celular, sin ubicación; las marcas no se editan y gerencia corrige con motivo; informe mensual de horas;
  - el Panel suma un rango libre y la comparación con el período anterior; todos los informes se exportan a Excel con los mismos filtros y totales.
- **Coordinación del equipo (R2-36, R2-37, R2-42, R2-44, B-019, B-065):**
  - tareas internas asignadas a una persona o a un rol, con vencimiento, prioridad y vínculo a un paciente o cita; limpieza también las usa sin ver datos de pacientes;
  - botón «Llamar» y registro de llamadas desde la ficha y la cita;
  - diario de actividad en frases claras, sin datos clínicos, con filtros, Excel y paginación por cursor;
  - tarjetas en el Inicio: hueco liberado con candidatos (la persona confirma), citas pasadas sin cerrar, tareas vencidas y trabajos de laboratorio listos sin cita.
- **Experiencia del paciente y su familia (R2-31, R2-38, R2-39):**
  - relaciones familiares con tutor legal, tarjeta «Familia» con saldos y próximas citas, agendar a hermanos seguidos, aviso de duplicados que reconoce al familiar declarado; el tutor ve a sus menores en el portal;
  - etiquetas y segmentos guardados; campañas manuales sin datos clínicos solo para quien aceptó promociones (vista previa de excluidos, confirmación del número exacto, tope, 7 días entre campañas, horario de silencio, simulado fuera de producción);
  - encuesta de satisfacción (NPS) de un solo uso con panel por sucursal y profesional; **un detractor crea una tarea de seguimiento para gerencia**, y completarla registra el seguimiento;
  - llegada con QR en recepción (ventana −60/+30 min, idempotente, con límite de intentos y sin datos personales).
- **Convenios y conciliación (R2-32, B-021):**
  - convenios con empresas, colegios y asociaciones: precios especiales o % por categoría y parte que paga la empresa (% con tope anual por paciente);
  - cada cargo separa la parte del paciente y la de la empresa; el saldo del paciente ya no incluye la de la empresa;
  - estado de cuenta por empresa (pantalla, Excel y PDF verificable) y pagos de la empresa aplicados a varios cargos con verificación dual;
  - «Pendiente de facturar» por línea o sesión, a nombre del paciente, la empresa u otra persona (no es una factura fiscal);
  - conciliación bancaria con extracto Excel o CSV: emparejamiento exacto y sugerido, siempre confirmado por una persona, sin duplicar al reimportar.
- **App instalable (B-032):** manifiesto, íconos y service worker que nunca guarda datos de la API; tarjeta «Aplicación en este dispositivo» en Mi cuenta; aviso cuando se pierde la conexión.
- **Menú por secciones** (Día a día, Pacientes, Dinero, Clínica, Gestión, Ajustes) con desplazamiento, y botón **«Más»** en el celular con el menú completo.
- **Tablas como tarjetas en el celular** (clase `cards-sm`) en laboratorio e inventario (B-076).

### Corregido
- En el celular no había forma de llegar a las pantallas que no estaban en la barra inferior (Tareas, Laboratorio, Gestión, Configuración…).
- Con más de 20 opciones, el menú lateral cortaba las últimas en pantallas bajas.
- Los datos de ejemplo tenían muy poca producción frente a gastos realistas: la rentabilidad de la demo daba −600 %. Ahora la semilla genera unos dos meses de actividad.

### Permisos nuevos
- `tasks.use` (todos los roles) y `timeclock.punch` (todos los roles; además cada persona debe tener el fichaje activado).

## [0.4.0] — 2026-11-10

Cinco equipos más en paralelo (ramas aisladas, migraciones 0010–0014), integrados uno por uno con todas las pruebas en verde después de cada fusión.

### Agregado
- **Inventario por sucursal y compras (B-062, B-047, B-024):**
  - catálogo con SKU único por clínica y conversión de la unidad de compra a la unidad de uso;
  - lotes con vencimiento y una invariante probada: el stock de la sucursal es la suma de sus lotes y de sus movimientos, y nunca queda negativo. La garantiza la base de datos: los saldos solo cambian al insertar movimientos de solo inserción;
  - consumo FEFO o con lote elegido, ajustes con motivo, transferencias en dos pasos con diferencias registradas y conteo físico con aprobación;
  - consumo estándar por prestación al realizarla: nunca bloquea la atención, y si falta stock queda un consumo pendiente;
  - órdenes de compra con recepción parcial por lote y rechazo con motivo; proveedores con % a tiempo y % rechazado; sugerencia de reposición según el consumo de 60 días;
  - valorización por lote, costo de materiales por tratamiento y alertas por sucursal (bajo mínimo, vence en 30/60/90 días, vencido, consumo pendiente);
  - permisos nuevos `inventory.read`, `inventory.write` e `inventory.manage`.
- **Laboratorio protésico (B-063, R2-34):**
  - órdenes por paciente, profesional y sucursal, vinculables a un tratamiento del presupuesto, con piezas FDI, color Vita, tipo de impresión, instrucciones, fechas y costo;
  - estados borrador → enviado → en proceso → recibido → (ajuste con motivo) → entregado/cancelado, con historial inmutable; el costo queda fijo al recibir;
  - alertas de órdenes atrasadas y de trabajos recibidos sin cita de colocación; tarjeta en la ficha; aviso al agendar («Trabajo de laboratorio listo: corona 11»); orden imprimible con iniciales y N° de ficha;
  - «Por pagar al laboratorio» con pagos de solo inserción, estado de cuenta por período y Excel;
  - en honorarios, la opción «usar costo real de laboratorio» descuenta el costo de las órdenes vinculadas.
- **Documentos PDF con huella, recetas y certificados (B-064, R2-40):**
  - PDF generados en el servidor con el membrete de la sucursal; el pie lleva número, fecha, emisor con matrícula, huella SHA-256, código de verificación y QR;
  - recetas con catálogo de medicamentos por clínica y aviso de alergias (no bloquea, pero exige marcar «Revisé la alergia»); certificados de atención y reposo, constancias de tratamiento y derivaciones;
  - al emitir, el documento se congela con su PDF; para corregirlo se anula con motivo y se reemite;
  - PDF del presupuesto aceptado, del consentimiento firmado y del recibo de pago («no es una factura fiscal»); cada descarga queda auditada;
  - página pública `/verificar/:código` que confirma si el documento existe, está íntegro y vigente, sin mostrar datos del paciente.
- **Mensajes automáticos (B-048, B-060):**
  - reglas por clínica y sucursal (al agendar, antes de la cita, después de la visita, control pendiente, presupuesto sin respuesta) con plantillas versionadas. Las variables se validan al guardar y nunca llevan datos clínicos;
  - programador idempotente: no duplica; una reprogramación anula y recrea los avisos; una cancelación los anula;
  - horario de silencio (20:00–08:00), tope diario por paciente y envío solo con el consentimiento de esa finalidad; la baja se hace con un clic en el portal o respondiendo «BAJA»;
  - enlace de un solo uso `/c/:token` para confirmar la cita o pedir reprogramar;
  - adaptador de WhatsApp Cloud API (solo en producción y con credenciales) y webhook firmado; panel de entregas con filtros y reintento. Fuera de producción todo queda simulado.
- **Agenda y paciente (B-049, B-015, R2-18, R2-19, R2-30):**
  - tipos de cita por clínica (color, duración, prestación sugerida) que precargan la cita;
  - vista semanal por sucursal con filtros, mini calendario con ocupación y color por tipo, profesional o consultorio;
  - arrastrar y soltar en día y semana (también con pulsación larga en pantallas táctiles), con reversión ante conflicto y «Deshacer» por 8 s;
  - citas recurrentes cada N semanas o meses (máx. 52) con revisión previa de conflictos, hueco libre sugerido, guardado en una transacción y acciones «solo esta / esta y las siguientes»;
  - historial del paciente (línea de tiempo) con citas, notas, odontograma, presupuestos, cobros, documentos, controles y mensajes, filtrado según el rol.
- **Asistente:** herramientas nuevas para controles, sala de espera, estado de cajas y alertas de bioseguridad. El servidor rechaza proponer citas en el pasado o en horarios que la agenda no acepta (B-050).

### Corregido
- Dos pruebas e2e dependían de la fecha del día (la semilla demo ocupaba el horario que usaban). La semilla deja libre 12:00–14:30 y la prueba de arrastre busca un día con huecos.

### Dependencias
- `pdfkit` 0.17 (generación de PDF con fuentes incrustadas). Fuente Inter en subconjunto latino, licencia OFL incluida en `server/assets/fonts/`.

## [0.3.0] — 2026-11-10

Etapa construida por cinco equipos en paralelo (ramas aisladas integradas con todas las pruebas en verde) más el integrador. Se basa en la segunda ronda de investigación (`INVESTIGACION_COMPETIDORES.md` §9).

### Agregado
- **Controles "volver a citar" (B-040):**
  - al marcar una cita como atendida se propone el próximo control según la prestación (profilaxis 6 meses, ortodoncia 1, implante 6, endodoncia 12; editable en Prestaciones);
  - página **Controles** por sucursal y mes, con contadores (vencen esta semana, atrasados, agendados, conversión);
  - intentos de contacto de solo inserción; 3 sin éxito pasan a "Revisar";
  - WhatsApp manual solo con consentimiento y sin datos clínicos;
  - vínculo automático entre cita y control.
- **Tiempos de la cita y calidad de la atención (B-041):**
  - cada cambio de estado queda registrado de forma inmutable;
  - informe por sucursal y profesional: espera (media, mediana, P90), puntualidad, duración real frente a la planificada, inasistencia y cancelación, con exportación;
  - "Citas pasadas sin cerrar" en la sala de espera, que nunca se cierran solas.
- **Caja por cajero y honorarios (B-043, B-044):**
  - apertura con fondo; los cobros en efectivo entran a la caja de quien los recibe;
  - movimientos con motivo, de solo inserción;
  - cierre con arqueo de billetes y monedas en Bs, diferencia calculada y motivo obligatorio;
  - una caja cerrada es inmutable, y la revisa gerencia o contabilidad;
  - la clínica puede exigir caja abierta para cobrar en efectivo.
  - **Honorarios:** reglas por profesional y categoría (porcentaje o monto fijo, base producción o cobrado, descuento de laboratorio); liquidaciones de borrador a cerradas e inmutables; los ajustes van al período siguiente; exportación a Excel; resultado por sucursal.
- **Periodontograma (B-042):**
  - carga con el teclado y avance automático, con atajos y teclado en pantalla para tabletas;
  - rechazo de valores fuera de rango, también en la base de datos;
  - índices calculados solo sobre los sitios medidos, mostrando el denominador;
  - borrador con guardado automático, cierre inmutable y enmiendas;
  - comparación por sitio, gráfico y resumen para el paciente.
- **Presupuestos v2 (B-045):**
  - descuento por línea y global prorrateado exacto al centavo; nunca total negativo;
  - prestaciones de varias sesiones con un cargo por sesión;
  - versiones: la anterior deja de poder aceptarse;
  - **enlace para el paciente** verificado (4 últimos dígitos del celular o fecha de nacimiento), con bloqueo tras 5 intentos; aceptación con firma opcional y registro de "visto";
  - embudo con días en cada estado;
  - **una sola función de saldo** (`patient_money`) en todas las vistas.
- **Reserva online y portal del paciente (B-046):**
  - `/reservar/:slug` en el celular, con el mismo motor de la agenda;
  - identificación con código de 6 dígitos sin contraseña y retención del horario;
  - modo inmediato o solicitud por sucursal, con la bandeja "Solicitudes web";
  - `/mi-cuenta/:slug`: citas (reprogramar y cancelar dentro del plazo), saldo, pagos, presupuestos y menores a cargo.
  - **Bandeja de mensajes:** fuera de producción ningún mensaje sale del sistema.
- **Bioseguridad (integrador):**
  - rol **"Limpieza y apoyo"** que solo accede a este módulo;
  - limpieza por consultorio (entre pacientes, apertura, cierre, desinfección), con los pendientes según los pacientes atendidos;
  - ciclos de autoclave numerados por equipo, con indicador químico y biológico y alertas si fallan;
  - **libro de esterilización en Excel**; todo de solo inserción.
- **"Mis pacientes de hoy" (integrador):** el inicio del odontólogo muestra sus pacientes del día con alertas médicas, la primera visita y los tratamientos pendientes.

### Cambiado
- Se reemplazaron todos los `window.prompt` y `window.confirm` por diálogos accesibles con validación junto al campo (`useAsk`).
- Las grillas permiten que su contenido se encoja, y la historia clínica se apila en el celular: no queda desborde horizontal en ninguna pantalla para ningún rol (verificado con un recorrido automático de 5 roles × 2 tamaños).
- Corregida la lectura de montos con punto decimal en los formularios ("60.00" se leía como 6.000 Bs).
- Se eliminó la función de saldo duplicada de la migración 0007 (migración 0009).

### Pruebas
- 256 pruebas unitarias y de integración (22 archivos) y 20 end-to-end.

## [0.2.0] — 2026-11-10

### Agregado
- **Verificación en dos pasos (TOTP, RFC 6238):**
  - funciona con cualquier app autenticadora;
  - el secreto se cifra con AES-256-GCM usando una clave fuera de la base (`DENTAL_SECRET_KEY`);
  - 10 códigos de recuperación de un solo uso;
  - 5 códigos incorrectos anulan la sesión;
  - la clínica decide qué roles deben usarla (Configuración → Seguridad), y solo el propietario cambia esa política;
  - el soporte de plataforma puede quitarla, con motivo auditado.
- **Recuperación de contraseña por correo:**
  - enlace de un solo uso válido 30 min;
  - la respuesta es idéntica exista o no el correo;
  - máximo 3 solicitudes por hora;
  - cierra todas las sesiones.
- **Contraseña temporal emitida por administración**, que obliga a cambiarla al ingresar. Está bloqueada para personas que trabajan en más de una clínica. Las cuentas nuevas también deben cambiar la contraseña temporal.
- **Consentimientos versionados y documentos firmados:**
  - plantillas por tipo (datos, recordatorios, promociones, consentimiento informado) con versiones;
  - firma en pantalla (dedo, lápiz o mouse) o en papel;
  - copia del texto exacto y hash SHA-256 con verificación de integridad;
  - registros de solo inserción;
  - los menores firman por su representante;
  - impresión del documento.
  - Los cambios de consentimiento hechos desde la ficha también quedan registrados.
- **Sala de espera por sucursal:** tablero Por llegar → En sala → En atención → Atendidos, con retraso y tiempo de espera.
- **Página "Mi cuenta":** cambio de contraseña y verificación en dos pasos.
- **Superadministrador:** búsqueda de usuario por correo para soporte.

### Cambiado
- La idempotencia de pagos y citas es uniforme con envíos simultáneos: todos reciben la misma respuesta (B-007).
- Las ayudas de los formularios ya no forman parte del nombre accesible del campo.
- Los datos demo reflejan estados realistas para el día actual.

### Pruebas
- 105 de integración y unitarias (15 nuevas: vectores del RFC 6238, cifrado, flujos de 2 pasos, recuperación, consentimientos).
- 11 end-to-end (4 nuevas: activar 2 pasos e ingresar con código, contraseña temporal obligatoria, firma de consentimiento, sala de espera).

## [0.1.0] — 2026-11-10

### Agregado
- **Investigación:** informe de competidores (20 productos, 4 demos públicas probadas), matriz de funcionalidades y mapa legal boliviano preliminar (`INVESTIGACION_COMPETIDORES.md`, `RESEARCH.md`, anexos A–E).
- **Plataforma multiempresa:**
  - PostgreSQL con Row Level Security por clínica;
  - claves foráneas compuestas;
  - rol de aplicación sin BYPASSRLS;
  - migraciones SQL con checksum.
- **Seguridad:**
  - sesiones HttpOnly con CSRF;
  - scrypt;
  - bloqueo por intentos y límites de solicitudes;
  - CSP estricta;
  - auditoría de solo inserción;
  - registro de lecturas del expediente.
- **Roles por sucursal:** propietario, administrador, recepción, odontólogo, asistente y contabilidad. Todos los permisos se validan en el servidor.
- **Clínica:** sucursales con horario, consultorios, personal (contraseña temporal), horarios por profesional y sucursal, bloqueos, y catálogo de prestaciones en Bs con 18 prestaciones de referencia.
- **Pacientes:**
  - ficha con N° correlativo;
  - búsqueda sin tildes;
  - detección de duplicados;
  - responsable para menores;
  - consentimientos de recordatorios y marketing;
  - archivo sin borrado;
  - importación y exportación Excel.
- **Agenda:**
  - sin solapes de profesional, consultorio o paciente, garantizado por la base;
  - disponibilidad real y búsqueda de huecos;
  - estados y reprogramación;
  - lista de espera y "recuperar huecos";
  - recordatorios por WhatsApp (wa.me) solo con consentimiento.
- **Clínico:**
  - odontograma FDI permanente y temporal con 5 superficies y estados;
  - historial inmutable y anulaciones;
  - evoluciones con enmiendas;
  - antecedentes versionados con alertas.
- **Cobros:**
  - presupuestos con cuotas;
  - tratamientos realizados → cargo + odontograma;
  - pagos idempotentes;
  - QR y transferencia con verificación dual y referencia única;
  - anulaciones con asiento inverso;
  - caja diaria.
- **Reportes:** panel por sucursal (cobrado, producción, ocupación, inasistencia, conversión), producción y comisión estimada, cuentas por cobrar, pacientes sin próxima cita, exportación de pagos.
- **Superadministrador SaaS:** planes con límites, clínicas, estados y métricas agregadas.
- **Asistente administrativo:** 7 herramientas con permisos, propuestas que se confirman y chat opcional con Claude.
- **Interfaz** React responsive (escritorio, tablet y celular) en español.
- **Operación:** respaldos cifrados con restauración probada, Dockerfile, configuración de Railway (sin desplegar) y job de CI con PostgreSQL y e2e.
- **Datos de demostración ficticios** (`npm run seed`): 5 sucursales, 7 odontólogos y 90 pacientes.
- **Pruebas:** 90 de integración, unitarias y de respaldo, y 7 end-to-end.
