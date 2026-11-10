# Panel Dental (proyecciondigital.org): exploración de la demo pública

- **Fecha:** 2026-11-10
- **Producto:** Panel Dental, "CRM dental", operado por Proyección Digital (República Dominicana)
- **Fuentes:** web comercial https://dental.proyecciondigital.org/es/ (y subpáginas /funcionalidades/multi-clinica/, /funcionalidades/api/, /precios/), y la demo https://dental.proyecciondigital.org/login con las credenciales que el proveedor publica: `admin@demo.clinic / demo1234`.
- **Herramienta:** Playwright (Chromium headless). Escritorio a 1440x900; teléfono a 390x844 en 3 pantallas. Zona horaria del navegador: America/Santo_Domingo.
- **Cliente de referencia:** clínica con 5 sucursales.

## Cómo se trabajó y límites

- El acceso funcionó con las credenciales publicadas. Se usó **solo el rol Administrador** ("Carlos Rodríguez"). La web anuncia accesos como dentista, higienista, auxiliar y recepción con la misma contraseña, pero no los probé porque la consigna prohibía usar otras credenciales. Los permisos de otros roles solo se vieron en la pantalla de configuración.
- La demo tiene **2 sucursales** (Polanco y Anacaona), 7 módulos/sillones y 2 profesionales con agenda (Dra. María Pérez y Ana González). Con 5 sucursales no se pudo probar la escala.
- Casi todas las facturas, cobros y presupuestos de la demo son de abril y mayo de 2026. Por eso los informes del "mes actual" salen casi vacíos.
- **Registros ficticios que creé:**
  - 2 pacientes "Prueba Investigación" con teléfono +1 809 555 0199 (rango 555-01xx reservado para números ficticios). El segundo es un duplicado intencional.
  - 1 diagnóstico de caries en el diente 16.
  - 1 exploración periodontal en borrador.
  - El presupuesto PRES-2026-0004 (Obturación temporal, RD$ 40) con un cobro de RD$ 20 en efectivo.
  - 3 citas el 16/11/2026, **que luego cancelé**.
  - No borré ningún dato de la demo.
- **La demo intenta enviar WhatsApp reales.** Al crear las citas, el Historial WhatsApp registró 3 envíos "Real" de "Confirmación de cita" al número ficticio. Los 3 constan como fallidos. Conviene no usar teléfonos reales en esta demo.
- **La sesión caduca sola** (unos 25–30 min). Al navegar con la sesión vencida apareció una página "500 Internal Server Error" antes de pasar al login. Ocurrió 2 veces.
- No intenté saltarme ningún control ni probar la seguridad.

**Leyenda:** **[P] probado** = lo usé en la demo. **[V] visto** = lo vi en pantalla sin ejercerlo. **[A] anunciado** = solo lo dice la web comercial.

---

## 1. Panel de inicio y navegación

**Qué hice:** entré, revisé el Inicio con cada opción del selector (Polanco, Anacaona y "Todas las sucursales"), recorrí la barra lateral y abrí Informes.

**Qué observé:**
- [P] El Inicio muestra:
  - Indicadores: citas de hoy, "Ahora en clínica" y pagos vencidos (importe y número).
  - Una línea de tiempo de "Hoy" y la lista "Por confirmar mañana" con botón *Confirmar*.
  - El top de pagos vencidos, recordatorios (vencen esta semana, atrasados, conversión), pacientes recientes y "La semana en un vistazo" (citas, completadas y facturado de 7 días contra los 7 anteriores).
- [P] Los números consolidados cuadran:
  - Citas de hoy: Polanco 9 + Anacaona 10 = **19** en "Todas".
  - Pagos vencidos: 18 + 22 = **40** (RD$ 9,225.24 + RD$ 4,571.31 = RD$ 13,796.55).
- [P] Barra lateral con 6 grupos y unas 30 entradas: Día a día, Clínico, Dinero, Equipo (tareas, asistencia, nómina), Inventario y compras, Administración. Arriba hay accesos a Chatwoot, estados "Cloud" y "QR" de WhatsApp, Ayuda, modo oscuro y vista compacta. También hay un botón flotante de IA.
- [P] Informes (/reports) tiene un tablero con caja cobrada, saldo a favor, producción, ticket medio, cobros por forma de pago, producción por doctor, pacientes nuevos, tasa de no-show y antigüedad de cuentas por cobrar. Hay pestañas de Facturación, Presupuestos, Agenda, Pacientes, Productividad y Cobros.

**Fricciones:**
- **No vi una comparativa lado a lado entre sucursales**. En "Todas" solo aparecen totales sumados. La web lo anuncia como "Métricas comparativas por sucursal" [A].
- Cifras de deuda que no cuadran entre pantallas para Polanco:
  - Inicio: "Pagos vencidos 18 · RD$ 9,225.24".
  - Informes: "Cuentas por cobrar RD$ 830.00 (2 pacientes)".
  - Usan definiciones distintas (facturas vencidas frente a tratamiento ejecutado no cobrado) y la pantalla no lo explica.
- En la línea de tiempo de "Hoy", las citas que se solapan se montan unas sobre otras y los textos se pisan.
- La barra lateral es larga (unas 30 entradas) y mezcla flujos diarios con módulos poco usados.
- Detalle menor: en la primera sesión, con el navegador en UTC, el marcador de "ahora" mostró 11:39 en una carga y 15:39 en la siguiente.

**Puntuación: 7/10.** Buen panel operativo y la vista consolidada funciona. Falta una comparativa por sucursal para el dueño.

## 2. Agenda y disponibilidad (prioridad)

**Qué hice:**
- Usé las vistas Semana, Día y Kanban en escritorio.
- Creé 3 citas el 16/11/2026, de 30 min cada una:
  - **A:** 07:00, Dra. María Pérez, Polanco · Módulo 1.
  - **B:** 07:15, **misma doctora**, Polanco · Módulo 2. Se solapa con A.
  - **C:** 07:00, Ana González, **mismo sillón** Polanco · Módulo 1. Se solapa con A, y además coincide con el mismo paciente.
- Revisé el horario por profesional, el horario de la clínica, el asistente de IA ("Huecos libres hoy") y la agenda en el móvil.
- Al final cancelé las 3 citas.

**Qué observé:**
- [P] **Las tres citas solapadas se guardaron sin aviso.** La API respondió 201 y apareció "Éxito · Cita creada". No hubo advertencia ni bloqueo por:
  - la misma doctora a la misma hora;
  - el mismo módulo/sillón a la misma hora;
  - el mismo paciente con dos citas simultáneas.
  - En la vista Día los solapes se dibujan en columnas estrechas lado a lado, sin marcar el conflicto (captura 09).
  - Los datos de la demo ya traen solapes. Ese mismo día, Ana González tenía 3 citas superpuestas entre 08:30 y 10:00.
- [A] La página de la API dice que la reserva externa sí devuelve «ocupado» si dos piden la misma hora. Esa regla **no se aplica al crear citas desde el panel**.
- [P] Formulario "Nueva cita":
  - Campos: paciente (con búsqueda y opción de crear uno), sucursal, motivo, fecha, hora, duración (15/30/45/60/90/120 min), módulo (o "Asignar después") y profesional opcional ("Sin asignar, se decide cuando llegue").
  - Si el paciente tiene tratamientos pendientes del plan, el formulario los muestra.
  - **No propone huecos libres** en escritorio: fecha y hora se escriben a mano.
- [P] Horarios: el horario semanal de la Dra. Pérez estaba "Cerrado" todos los días y la plantilla de la clínica estaba vacía. Aun así tiene citas cada día, así que **el horario no limita la reserva**. Un turno solo admite hora de inicio y fin; **no se indica en qué sucursal trabaja ese turno**. Esto importa en una red donde los profesionales rotan entre locales.
- [P] Vista Día: una columna por profesional (con una columna "Sin asignar"), **no por sillón**. Se filtra con chips de módulo y de profesional.
- [P] Kanban: columnas "Por venir" (con aviso "retrasada X min"), Sala de espera, "En módulo" (ocupación de cada sillón: libre/ocupado y siguiente cita), Finalizadas y No asistió/Cancelada. Es útil para recepción.
- [P] Cancelar una cita: aparece "¿Cancelar esta cita? Se registrará en el historial." **No pide el motivo.** Los botones "Cancelar" y "Cancelar cita" se prestan a confusión.
- [P] En el móvil la agenda es otra vista, pensada para el teléfono:
  - Muestra los huecos libres ("2 h 30 min libre · Tocar para reservar") y tiene filtro por duración mínima (15/20/30/45/60+).
  - Totales "9 h libres" y "Próximo 13:30".
  - Es el único sitio donde vi disponibilidad calculada.
- [P] Al preguntar al asistente de IA por los huecos libres, respondió: "Libres con Ana González de 1:30 PM a 2:00 PM… La Dra. María Pérez no tiene horario hoy". Pero ese día ella sí tenía citas. Además, listó citas de las dos sucursales aunque el selector estaba en Polanco.
- [V] Configuración también ofrece días especiales y ausencias, llegada por QR y un enlace «Ya llegué».
- [A] La web anuncia una agenda con arrastrar y soltar. No lo probé.

**Fricciones:**
- No hay control de solapes ni aviso de ningún tipo.
- La disponibilidad no se aplica.
- La vista Semana de escritorio está muy apretada: los nombres se cortan en "P…" y "Pol…" (captura 05).
- Las fechas aparecen en formato ISO ("LUN 2026-11-09").

**Puntuación: 5/10.** Las vistas son ricas (Kanban y agenda móvil muy buenas), pero no hay control de conflictos ni disponibilidad que se haga cumplir. Es crítico para 5 sucursales.

## 3. Sillones y sucursales (prioridad)

**Qué hice:** cambié de sucursal en todas las pantallas clave, revisé Configuración → Sucursales, Módulos y Usuarios, y comparé la agenda, los informes, los gastos y el inventario en "Todas las sucursales".

**Qué observé:**
- [P] El selector de la barra superior ofrece "Todas las sucursales" y cada sucursal, con búsqueda. Aparece una franja "Operando en Sucursal X". Al cambiar se filtran el Inicio, la agenda, las facturas y los informes.
- [P] Los pacientes son globales para la clínica. La lista muestra la "sucursal habitual" de cada uno.
- [P] La facturación numera por sucursal (FAC-2026-0027-POL / -ANA). Aun así, el informe dice "la numeración de los recibos es una sola para todas las sucursales" y detecta huecos en FAC-2026 (faltan del 2 al 20).
- [P] Gastos tiene columna de sucursal, con la opción "Toda la clínica" para gastos compartidos.
- [V] El inventario lleva stock por sucursal, con lotes (LOT-ANA-…) y criterio FEFO.
- [V] Usuarios: cada usuario tiene asignadas las sucursales donde trabaja (en la demo, todos en las dos). Los módulos/sillones se nombran "Sucursal · Módulo N" y pueden tener especialidad (Ortodoncia, Periodoncia).
- [P] El informe de Agenda muestra la ocupación por módulo de todas las sucursales (horas reservadas por sillón).

**Fricciones:**
- En el formulario de cita, el desplegable de módulo **lista los sillones de todas las sucursales** aunque la sucursal elegida sea Polanco. Esto permite incoherencias.
- El informe de Facturación consolidado **no desglosa por sucursal**: solo filtra.
- Los turnos de los profesionales no indican sucursal.
- No hay vista de agenda con todas las sucursales y los sillones como columnas.

**Puntuación: 6/10.** El modelo de multi-sucursal es real y está bien pensado (pacientes globales y el resto separado). Le faltan comparativas y vistas por sillón para una red de 5 locales.

## 4. Pacientes (prioridad)

**Qué hice:** creé "Prueba Investigación" y luego otro paciente con **el mismo nombre y el mismo teléfono**. Recorrí la ficha y la búsqueda.

**Qué observé:**
- [P] El alta es rápida en un diálogo: nombre, apellidos, tipo y número de documento (cédula o pasaporte), teléfono con prefijo de país más usuario de WhatsApp, email, fecha de nacimiento, género, ciudad, notas y sucursal habitual. Cada campo trae ayudas.
- [P] **Duplicado aceptado sin ningún aviso.** Se creó un segundo paciente con el mismo nombre y teléfono (API 201). Después, al buscar "Prueba Inv" en citas y presupuestos aparecen dos resultados iguales, imposibles de distinguir.
- [P] La ficha incluye:
  - Pestañas: Resumen, Info, Clínico, Administración, Galería y Actividad.
  - Tarjetas: plan activo, próxima cita, última visita, saldo, diagnósticos, historial médico, familia, recetas y laboratorio.
  - Acciones rápidas: cita, presupuesto, documento, recordatorio, receta y certificado.
  - Notas por tipo, "Generar reporte clínico" y la opción de archivar (no hay borrado).
- [P] Lista de pacientes: búsqueda por nombre o teléfono, filtros "Sólo no contactar" y "Con deuda", saldo visible, exportación CSV y paginación de 20 en 20.

**Fricciones:**
- No detecta duplicados.
- La lista pagina de 20 en 20 y no tiene filtro por sucursal a la vista.

**Puntuación: 6/10.** La ficha es completa y moderna, pero no detectar duplicados es un riesgo real en una red con varias recepciones.

## 5. Odontograma y periodontograma

**Qué hice:** registré una caries en la cara oclusal del diente 16 y abrí una exploración periodontal en borrador.

**Qué observé:**
- [P] El flujo es elegir la condición y luego tocar el diente. Se abre un selector de superficies (vista oclusal y lateral: M, D, V, L, O) y se confirma. Aparece "Tratamiento añadido" con opción **Deshacer**, y la condición pasa a "Condiciones diagnosticadas" con el botón "Crear Plan de Tratamiento".
- [V] Hay dentición permanente y temporal, y categorías Diagnóstico, Restauradora, Cirugía, Endodoncia, Ortodoncia, Preventivo y Odontopediatría. Diagnóstico incluye 12 condiciones (pulpitis, caries, fractura, periapical por tamaño, rotado, etc.).
- [P] El periodontograma registra:
  - sondaje, margen, placa y sangrado por cara;
  - furca, movilidad, pronóstico, implante y anchura de encía;
  - indicadores de % de sangrado, % de placa, CAL medio y bolsas de 5 mm o más (métricas SEPA);
  - guardado automático en borrador y "Cerrar sesión" para cerrar la exploración.
- [P] La pestaña "Histórico" muestra el odontograma en solo lectura en una fecha elegida, con la lista de cambios.

**Fricciones:**
- La ficha resumen siguió mostrando "Sin hallazgos pendientes" después de registrar la caries.
- El Histórico mostró "Estado a fecha 9/11/2026" y la caries con la marca "Completado", cuando el cambio era del 10/11 y era un diagnóstico. Puede ser un tema de zona horaria o de etiquetas; no lo confirmé.

**Puntuación: 8/10.** Es el módulo clínico más pulido de lo que probé.

## 6. Historia clínica y tratamientos

**Qué hice:** revisé la información médica, las notas y la línea de tiempo (Actividad) del paciente de prueba.

**Qué observé:**
- [V] Historial médico con enfermedades sistémicas, medicamentos, condiciones especiales y contacto de emergencia. El módulo `medical_reference` anuncia avisos de interacciones y contraindicaciones.
- [V] Notas clínicas por tipo (administrativa, diagnóstico, tratamiento, plan), con plantillas y adjuntos ligados a un diente.
- [V] Actividad del paciente filtrable por visitas, tratamientos, notas clínicas, financiero, historial médico, documentos y comunicaciones.
- [V] Hay módulos de planes de tratamiento (en Productividad: 6 activos, 12 cerrados y 4 borradores), ortodoncia, radiografías (visor DICOM), laboratorio, recetas y documentos clínicos.

**Puntuación: no evaluado.** No creé planes, notas ni historial médico; solo vi las pantallas.

## 7. Presupuestos, cuotas y cobros

**Qué hice:** desde la ficha → Administración → "Crear presupuesto", añadí "Obturación temporal" en el diente 16 (RD$ 40) y registré un cobro del 50% en efectivo. Después comprobé que se reflejaba en Informes.

**Qué observé:**
- [P] El presupuesto tiene validez desde/hasta (o sin caducidad), notas para el paciente y notas internas. Los tratamientos se buscan en el catálogo (con código y precio), con cantidad, diente, superficies (M/O/D/V/L/P/I), descuento y notas.
- [P] "Cobrar" ofrece botones de completo, 50% y 25%. Métodos: efectivo, tarjeta, transferencia, débito directo, seguro y otro. Muestra el aviso "Quedará pendiente RD$ 20.00", una barra de progreso del cobro y el historial de cobros. El Informe pasó a "Caja cobrada RD$ 20.00 · 1 cobro".
- [V] Botones "Enviar al paciente" (WhatsApp), "Compartir enlace" (enlace público para firmar) y "Rechazar". Hay versiones del presupuesto.
- [V] Planes de pago con cuotas (estados Activo, Completado, En mora y Cancelado). No había ninguno en la demo.
- [V] Recibos con NCF (DGII) y formatos 606 y 607. Es fiscalidad dominicana. [A] También anuncian Verifactu para España.

**Fricciones:**
- Al entrar desde la ficha, la URL lleva `patient_id`, pero **el paciente no viene precargado** y hay que buscarlo otra vez (además salía duplicado).
- Se puede cobrar un presupuesto **en Borrador** (sin aceptar). Puede ser deliberado (anticipos), pero no avisa.
- Mi presupuesto se numeró PRES-2026-0004, sin el sufijo de sucursal que llevan otros (PRES-POL-…).

**Puntuación: 7/10.** El flujo de cobro es muy ágil. No probé los planes de cuotas.

## 8. Inventario

**Qué hice:** revisé las pantallas de Inventario, Compras y Materiales por tratamiento.

**Qué observé:**
- [V] Stock por sucursal con lotes, vencimientos y trazabilidad FEFO. En la demo había 10 ítems, 10 lotes y 1 proveedor.
- [V] Órdenes de compra en PDF que entran solas al inventario de la sucursal. Reposición.
- [V] "Materiales por tratamiento": el material se descuenta del inventario de la sucursal al completar un tratamiento; si no alcanza, se descuenta igual y queda un aviso.

**Puntuación: no evaluado.** No hice movimientos.

## 9. Finanzas, informes y comisiones (prioridad)

**Qué hice:** revisé Gastos, Caja y bancos, Recibos y los informes de Facturación, Cobros, Agenda, Pacientes, Productividad y Presupuestos. También revisé la configuración de comisiones y generé el reporte de comisiones.

**Qué observé:**
- [P] Informes:
  - **Facturación:** facturado, cobrado, pendiente, vencidas, huecos de numeración, desglose por método de pago, ITBIS y por profesional. Aclara: "cuenta a quien creó la factura, no al profesional que atendió".
  - **Cobros:** cobrado neto y antigüedad de lo pendiente (0-30, 31-60, 61-90 y más de 90 días).
  - **Agenda:** total de citas, tasa de completado, no-shows, primeras visitas, horas por profesional y ocupación por módulo.
  - **Pacientes:** nuevos y recurrentes, edad, género y ciudad. Exporta CSV.
  - **Productividad:** citas completadas por profesional y por módulo.
- [P] Gastos: por categoría y subcategoría, con sucursal (o "Toda la clínica") y NCF para el formato 606.
- [V] Caja y bancos: cuentas de caja y banco a las que llegan solos los cobros, con transferencias, correcciones y cobros por ARS (seguros) pendientes de acreditar. En la demo no había cuentas creadas.
- [P] Comisiones:
  - Se configuran **por rol**: Odontólogo (disparo "Tratamiento realizado"), Recepción ("Cita agendada") y Gestor de citas ("Cita asistida").
  - Modalidad: porcentaje sobre el tratamiento o monto fijo por evento.
  - El reporte por rango de fechas tiene filtro de estado (pendientes, pagados, anulados). Salió "Sin comisiones en este rango" porque no hay configuración.
- [V] Nómina con perfiles, períodos e informes (vacía) y asistencia (fichaje).

**Fricciones:**
- Cada informe filtra el periodo de forma distinta: un desplegable "Periodo", campos "Período" con Desde/Hasta y "Actualizar", y un selector "Fechas". Por defecto es "este mes", y como los datos de la demo son antiguos casi todo sale a cero.
- **No vi un informe de resultados** (ingresos menos gastos) ni una comparación por sucursal.
- Las comisiones no se pueden configurar por profesional ni por tratamiento; solo por rol.
- Las cifras de deuda entre Inicio e Informes no cuadran a simple vista (ver área 1).

**Puntuación: 6/10.** La cobertura es amplia y está adaptada a la RD (NCF, 606/607, ITBIS, ARS). Para un dueño de varias sucursales le faltan el informe de resultados, la vista por sucursal y comisiones más finas.

## 10. WhatsApp, reserva online y automatizaciones (prioridad)

**Qué hice:**
- Al crear las 3 citas de prueba, comprobé en el Historial WhatsApp que se dispararon las confirmaciones automáticas.
- Revisé las plantillas, las instancias conectadas, los recordatorios y rellamadas, la API y los webhooks.
- Probé una consulta al asistente de IA.

**Qué observé:**
- [P] **La confirmación al crear la cita es inmediata y automática.** Hubo 3 envíos "Real" con el texto completo: "¡Hola Prueba! 👋 Tu cita en *Clinica Sonrisas* — Sucursal Polanco quedó *confirmada* ✅ …". Constan como fallidos (icono rojo) por ser un número ficticio. Se ve el estado de entrega en tiempo real (entregado, leído o falló).
- [V] Mensajes de WhatsApp:
  - Intervalos configurables: 24 h antes, 2 h antes y confirmación al crear, y se pueden añadir más.
  - Cada mensaje elige canal: QR (Baileys/Evolution) o Cloud API oficial de Meta con plantilla aprobada.
  - Hay variables, entre ellas `{sucursal_sufijo}`.
  - Pestañas: Avisos de cita, Presupuestos, Informe clínico, Después de la cita y Rellamadas.
- [V] Había 3 instancias conectadas (una QR y dos Cloud API). El panel muestra el estado "Cloud" y "QR" en la barra superior.
- [V] El texto de las plantillas en modo QR pide "Responde SÍ/NO". [A] La web anuncia botones "Sí asisto / No puedo" con la Cloud API; no lo pude comprobar.
- [V] Recordatorios y seguimientos: rellamadas por motivo (higiene, postoperatorio…), lista mensual con botones Llamar y WhatsApp, pestaña "Recordatorios automáticos (WhatsApp)" y exportación CSV.
- [V] Integración con Chatwoot (bandeja de conversaciones) desde la barra superior.
- [V] **Reserva online:** **no encontré un widget ni página de reserva para pacientes** en el panel.
  - [A] La reserva se hace por API: `GET /integrations/public/availability`, `POST /integrations/public/bookings` y tokens con permisos.
  - [V] Webhooks firmados para cita agendada o cancelada, paciente nuevo y presupuesto. Tokens de API con documentación descargable.
  - [A] Reserva desde agentes de IA o n8n.
- [P] El asistente de IA respondió a "Huecos libres hoy" (con la incoherencia de horario ya contada en el área 2).
- [V] [A] Hay módulos de Google Calendar y Contactos, y un puente "Panel Ads" para leads.

**Fricciones:**
- La reserva online exige montar algo propio (formulario, n8n o agente) sobre la API.
- En la demo los envíos son reales.

**Puntuación: 7/10** para los recordatorios por WhatsApp (verifiqué el disparo automático). La reserva online del paciente queda **no evaluada**: solo está por API y no la probé.

## 11. Seguridad, permisos y auditoría

**Qué hice:** revisé Usuarios, Permisos por rol, Historial de actividad y Protección de datos, con el rol Administrador únicamente.

**Qué observé:**
- [V] Hay 7 roles ajustables: Odontólogo, Higienista, Auxiliar, Recepcionista, Gestor de citas, Contable y Especialista. Cada permiso puede ser "Sin acceso", "Solo ver" o "Ver y editar", área por área (unas 35 áreas). Administrador, Dueño o socio y Gerente lo ven todo y no se ajustan.
  - Llamó la atención que, en la pestaña Odontólogo, Odontograma y Periodontograma aparecían "Predeterminado (Sin acceso)". No lo verifiqué entrando con ese rol.
- [V] Usuarios con sucursales asignadas.
- [P] Historial de actividad: "no se puede editar ni borrar", con filtros por fechas, persona y tipo. Registró mi alta de pacientes, las citas agendadas y el cobro, con sucursal y hora local.
  - **No registró** el diagnóstico del odontograma ni la creación del presupuesto.
  - Tampoco vi registro de inicios de sesión ni de consultas de fichas.
- [V] Protección de datos (estilo RGPD): solicitudes, consentimientos, conservación y brechas. Respaldos ZIP descargables.
- [P] La sesión caduca. Al volver con la sesión vencida apareció una página 500 antes del login.

**Puntuación: no evaluado.** No pude probar otros roles (consigna) y la auditoría solo la vi parcialmente.

## 12. Móvil

**Qué hice:** abrí Inicio, Agenda y Ficha de paciente a 390x844 y comprobé que no hubiera desplazamiento horizontal (scrollWidth = 390 en las 3 pantallas).

**Qué observé:**
- [P] Diseño responsive real:
  - Las tarjetas del Inicio se apilan.
  - La agenda móvil es una vista distinta: días en tira, Profesional o Módulo, **huecos libres "Tocar para reservar"** y filtro por duración mínima.
  - La ficha tiene una barra inferior fija con Cita, Cobrar y Nota.
- [A] La web habla de "app", pero es web responsive. No vi app nativa.

**Fricciones:**
- En la ficha, las pestañas se cortan ("R.", "A…").
- El aviso de demo y la franja de sucursal ocupan unos 100 px.
- En el móvil, el selector de sucursal es un icono de edificio, sin nombre visible (salvo en la franja).
- El botón flotante de IA tapa contenido.

**Puntuación: 7/10.**

---

## Tabla de puntuaciones

| # | Área | Nivel de prueba | Puntuación |
|---|---|---|---|
| 1 | Panel de inicio y navegación | Probado | 7 |
| 2 | Agenda y disponibilidad | Probado (citas solapadas creadas) | 5 |
| 3 | Sillones y sucursales | Probado (2 sucursales) | 6 |
| 4 | Pacientes | Probado (alta + duplicado) | 6 |
| 5 | Odontograma y periodontograma | Probado | 8 |
| 6 | Historia clínica y tratamientos | Visto | no evaluado (no creé planes ni notas) |
| 7 | Presupuestos, cuotas y cobros | Probado (sin cuotas) | 7 |
| 8 | Inventario | Visto | no evaluado (sin movimientos) |
| 9 | Finanzas, informes y comisiones | Probado parcialmente | 6 |
| 10 | WhatsApp, reserva y automatizaciones | Recordatorios probados; reserva solo anunciada | 7 (WhatsApp); reserva no evaluada |
| 11 | Seguridad, permisos y auditoría | Visto (solo Administrador) | no evaluado (otros roles no permitidos) |
| 12 | Móvil | Probado (3 pantallas) | 7 |

## Conclusiones para una clínica de 5 sucursales

**Puntos fuertes:**
- Modelo real de multi-sucursal: pacientes globales, y agenda, facturas, gastos e inventario por sucursal, con vista consolidada.
- Recordatorios automáticos por WhatsApp (confirmación inmediata + 24 h + 2 h) con estado de entrega.
- Odontograma y periodontograma muy pulidos.
- Kanban de recepción y agenda móvil con huecos libres.
- Amplia fiscalidad dominicana (NCF, 606, 607, ITBIS, ARS).
- API y webhooks.
- Código bajo licencia BSL 1.1 que pasa a Apache 2.0 en 4 años, y despliegue propio gratuito.

**Puntos débiles:**
- **No hay control de solapes ni aviso en la agenda interna** (doctor, sillón ni paciente).
- Los horarios de los profesionales no restringen la reserva y no se asignan a una sucursal.
- No detecta pacientes duplicados.
- No vi comparativa ni informe de resultados por sucursal.
- Las comisiones solo se configuran por rol.
- La auditoría deja fuera acciones clínicas y de presupuestos.
- La reserva online del paciente solo existe por API.

**Modelo comercial [A]:** la página de Precios dice a la vez "Gratis self-hosted" y "servicio gestionado por la agencia, planes en preparación, onboarding con acuerdo y pago". El plan Cloud figura como "Próximamente".

---

## Capturas

Carpeta: `capturas/`

| Archivo | Qué muestra |
|---|---|
| paneldental-01-landing.jpg | Web comercial: "El CRM dental que sí entiende WhatsApp y multi-clínica". |
| paneldental-02-inicio-sucursal.jpg | Inicio (página completa) operando en Sucursal Polanco: citas hoy, pagos vencidos, timeline, por confirmar mañana, recordatorios. |
| paneldental-03-selector-sucursal.jpg | Selector de sucursal abierto (Todas / Polanco / Anacaona); se ven los solapes en la línea de tiempo de "Hoy". |
| paneldental-04-inicio-todas-sucursales.jpg | Inicio consolidado "Todas las sucursales" (19 citas, 40 vencidos). |
| paneldental-05-agenda-semana.jpg | Agenda semanal: bloques comprimidos, solapes lado a lado y citas sin profesional ("?"). |
| paneldental-06-agenda-dia-profesionales.jpg | Vista Día con columnas por profesional (Sin asignar / Dra. Pérez / Ana González). |
| paneldental-07-agenda-kanban.jpg | Kanban: Por venir (retrasadas), Sala de espera, En módulo (ocupación de sillones), Finalizadas. |
| paneldental-08-nueva-cita-form.jpg | Formulario de cita: sucursal, duración rápida, módulo "Asignar después", profesional opcional. |
| paneldental-09-citas-solapadas.jpg | Las 3 citas de prueba solapadas (misma doctora; mismo sillón) aceptadas sin aviso el 16/11. |
| paneldental-10-horarios-profesionales.jpg | Horario semanal de un profesional: turnos solo con hora, sin sucursal; días "Cerrado". |
| paneldental-11-pacientes-lista.jpg | Lista de pacientes globales con sucursal habitual, saldo y filtros. |
| paneldental-12-ficha-paciente.jpg | Ficha del paciente de prueba (tarjetas de resumen y acciones rápidas). |
| paneldental-13-odontograma.jpg | Odontograma con la caries oclusal registrada en el diente 16 y el aviso con "Deshacer". |
| paneldental-14-periodontograma.jpg | Periodontograma en borrador: indicadores SEPA y cuadrícula de sondaje, margen, placa y sangrado. |
| paneldental-15-presupuesto.jpg | Presupuesto PRES-2026-0004: línea por diente, panel de cobros, enviar/compartir enlace. |
| paneldental-16-permisos-rol.jpg | Matriz de permisos por rol (Sin acceso / Solo ver / Ver y editar). |
| paneldental-17-historial-whatsapp.jpg | Historial WhatsApp: 3 confirmaciones automáticas "Real" de las citas de prueba (fallidas por número ficticio). |
| paneldental-18-historial-actividad.jpg | Historial de actividad (auditoría) con alta de pacientes, citas y cobro. |
| paneldental-19-movil-agenda.jpg | Agenda en el móvil (390 px) con huecos libres "Tocar para reservar" y filtro de duración. |
| paneldental-20-movil-ficha.jpg | Ficha en el móvil: pestañas cortadas y barra inferior Cita / Cobrar / Nota. |
