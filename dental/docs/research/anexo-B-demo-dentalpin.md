# DentalPin: evaluación de la demo pública

- **Fecha de la prueba:** 2026-11-10, entre las 16:35 y las 17:10 aprox. (hora de Madrid, según el reloj de la propia demo).
- **URL:** https://demo.dentalpin.com, entrando con las credenciales públicas de demo que aparecen en la propia pantalla de login (admin@demo.clinic, rol Administrador).
- **Método:** Playwright con Chromium sin interfaz. Escritorio a 1440x900 y móvil a 390x844 (isMobile/touch). Leí sobre todo el texto de las páginas y miré capturas cuando importaba la maquetación. No usé APIs fuera de la interfaz, ni DevTools, ni otras credenciales.
- **Datos de prueba creados (todos ficticios):**
  - 2 pacientes "Prueba Investigación" (+34 600 000 001; el segundo es el duplicado intencionado).
  - Condiciones en el odontograma del diente 16.
  - El plan PLAN-2026-0004 "Plan prueba investigación".
  - El presupuesto PRES-2026-0004 (635 €), aceptado y con un cobro parcial de 100 € en efectivo.
  - 5 citas de prueba los días 12 y 13 de noviembre (una movida y luego cancelada).
  - La demo se reinicia periódicamente.
- **Contexto:** la demo es compartida. Hay registros de otros visitantes, como los pacientes "Urazbaev", "Cortes Garcia" o "Pereiro Gonzalez" y citas canceladas ajenas, así que algunos números pueden variar.

Leyenda:
- **[P] Probado:** ejecuté la acción y vi el resultado.
- **[V] Visto, no probado:** solo vi la pantalla o el texto.

---

## Resumen de puntuaciones

| # | Área | Nota (1-10) | Base |
|---|------|-------------|------|
| 1 | Dashboard, menú, navegación | **8** | Probado |
| 2 | Agenda y disponibilidad | **6** | Probado (crear, solapar, mover, cancelar) |
| 3 | Gabinetes y sedes | **4** | Gabinetes probados; multisede no existe en la UI |
| 4 | Pacientes (alta, ficha, duplicados) | **6** | Probado |
| 5 | Odontograma | **8** | Probado |
| 5b | Periodontograma | no evaluado | Módulo `periodontogram` disponible pero **no instalado** en la demo |
| 6 | Historia clínica, diagnósticos, planes | **7** | Probado |
| 7 | Presupuestos, plazos, cobros | **7** | Probado (sin fraccionamiento ni financiación) |
| 8 | Inventario y materiales | no evaluado | Módulo `inventory` no instalado |
| 9 | Finanzas, informes, comisiones | **6** | Informes vistos; comisiones no existen |
| 10 | WhatsApp, reserva online, recordatorios, automatizaciones | no evaluado | Canales sin configurar en la demo; solo vi los ajustes |
| 11 | Seguridad (roles, auditoría, MFA) | **4*** | *Solo inspección de pantallas, sin probar permisos con otros roles |
| 12 | Usabilidad móvil | **5** | 3 pantallas probadas |
| — | Copiloto IA | **8** | Una pregunta probada |

---

## 1. Dashboard, menú y navegación: 8/10

**Qué hice:** entré con las credenciales de la demo y recorrí todas las entradas del menú y los ajustes.

**[P] Observado:**
- La pantalla de login muestra el aviso "Demo pública — no introduzcas datos reales…" y las credenciales.
- El menú lateral tiene:
  - Inicio y Agenda.
  - **Clínica:** Pacientes, Recordatorios, Planes de tratamiento.
  - **Finanzas:** Presupuestos, Facturas, Cobros.
  - **Gestión:** Informes.
  - Ajustes en el engranaje del usuario.
- La barra superior tiene Ayuda, "Vista compacta", modo oscuro y Cerrar sesión. Los grupos del menú se pueden plegar.
- El inicio saluda ("Buenas tardes, Admin") y tiene:
  - Accesos rápidos "Nuevo paciente" y "Nueva cita".
  - Tarjetas: Citas hoy (2), Ahora en clínica (0) y Pagos vencidos (1 · 410 €, resaltada en rojo).
  - Una línea de tiempo de hoy con la hora actual.
  - Bloques "Por confirmar mañana", "Pagos vencidos", "Recordatorios" (4 vencen esta semana, 2 atrasados, 100 % de conversión) y "Pacientes recientes".
  - "La semana en un vistazo" (13 citas, +117 %; facturado 1330 €, +144 %).
- Hay un botón flotante de IA en todas las pantallas.
- Los ajustes tienen buscador (⌘K) y están organizados por bloques: General, Espacio de trabajo, Personas, Clínica, Facturación e impuestos, Comunicaciones, Integraciones, Módulos y Cuenta.

**Problemas:**
- En la línea de tiempo del inicio, los bloques solo muestran la hora ("09:01", "11:30"). El nombre del paciente no se ve a simple vista.
- Los enlaces profundos no conservan la pestaña. Una URL con `?clinicalMode=plans&planId=…` abre la ficha en "Resumen".
- La sesión caducó a los ~35-40 min de uso: `auth/refresh` respondió 401 y la app cerró sesión sin avisar a mitad de una prueba.
- Incidencia en la automatización: si se pulsa Enter en el login antes de que la página termine de cargar el JavaScript, el formulario se envía como GET nativo y **email y contraseña quedan en la URL** (`/login?email=…&password=…`). No lo investigué más; lo anoto como observación.

## 2. Agenda y disponibilidad de doctores: 6/10

**Qué hice:**
- Recorrí las vistas Semana, Día y Kanban.
- Creé una cita (María García, jueves 12/11 10:00, 60 min, Gabinete 1).
- Creé una cita **solapada para la misma doctora** (10:30, Gabinete 2).
- Creé una cita de otro profesional en el mismo gabinete y a la misma hora que otra existente.
- Intenté citar en sábado (día cerrado) y en una franja de mañana de Carlos.
- Moví una cita arrastrándola y la cancelé.

**[P] Observado:**
- **Vistas:**
  - Semana de lunes a domingo, 09:00-20:00, con sábado/domingo y la franja de 14:00 sombreados como no disponibles.
  - Día con una columna por profesional.
  - **Kanban** con columnas Por venir / Sala de espera / En gabinete (ocupación por gabinete) / Finalizadas / No asistió-Cancelada. Marca "retrasada 460 min" en citas pasadas no atendidas.
  - Filtros por gabinete y por profesional.
- **Formulario de cita:**
  - Busca paciente por nombre o teléfono, con opción "Crear paciente" en línea.
  - Fecha y hora, con duraciones fijas: 15/30/45/60/90/120 min.
  - Gabinete opcional ("Asignar después") y profesional obligatorio.
  - Si el paciente tiene un plan, aparece "Añadir tratamiento del plan".
  - La hora por defecto era las 09:00 aunque ya eran las 16:39.
- **Solapamiento en el mismo doctor:** **se guarda.** Solo salen avisos (toasts) "Se detectaron solapamientos — El profesional tiene 1 cita(s) en este horario", que aparecen **mientras se editan los campos**. El mismo aviso salió dos veces y luego "Cita creada". No hay bloqueo ni confirmación explícita (captura 14).
- **Conflicto de gabinete con otro profesional:** también **se guarda**, con un aviso que combina profesional y gabinete. En la secuencia aparecen avisos intermedios confusos, como "El profesional tiene 2 cita(s)…", que corresponden al profesional que estaba seleccionado por defecto antes de cambiarlo (captura 24).
- **Fuera de disponibilidad** (sábado cerrado; Carlos un jueves a las 10:00): al pulsar "Guardar" **no pasa nada**. No hay petición, ni mensaje, y el diálogo sigue abierto. En cambio, Carlos a las 16:30 sí se guardó. Todo apunta a que el horario del profesional o de la clínica bloquea la cita **en silencio**.
- **Mover cita:** el arrastrar y soltar en la vista semanal funciona (PUT 200). Se guarda al momento, sin confirmar, aunque cree un nuevo solapamiento (solo aviso). La cita quedó a las 11:15, con ajuste aparente a intervalos de 15 min.
- **Cancelar:** "Cancelar cita" en el diálogo de edición, y luego una confirmación "¿Cancelar esta cita? Se registrará en el historial". No pide motivo. El copiloto IA genera después una tarjeta "Se canceló la cita de las 11:15 — se ha liberado un hueco · Revisar".
- Los cambios de estado (llegada, en gabinete) se ven en el Kanban. No probé a moverlos.

**Problemas:**
- Los conflictos solo generan avisos (toasts) efímeros y repetidos, no un aviso dentro del formulario.
- El bloqueo por horario no dice nada.
- La confirmación de cancelación usa "Cancelar" frente a "Cancelar cita", que es ambiguo.
- No hay campo de motivo ni de tratamiento si el paciente no tiene plan.
- En el Kanban, la última columna queda cortada a 1440 px.

## 3. Gabinetes y sedes: 4/10

**[P]:**
- Hay 2 gabinetes ("Gabinete 1/2"), que se gestionan en Ajustes → Espacio de trabajo → Gabinetes (botón "Añadir").
- Se usan como filtro y en las citas, y la ocupación por gabinete aparece en el Kanban y en Informes → Agenda.

**[V]:**
- Hay "Horario de la clínica" (plantilla semanal y fechas especiales; ejemplo: "Christmas holiday 2026-12-25 → 26") y "Horarios de profesionales" con vacaciones.
- La plantilla semanal muestra "—" de lunes a viernes, pese a que hay citas y bloqueo por horario.

**Multisede:** no encontré selector de clínica. El nombre "Clínica Dental Demo" de la cabecera no abre nada. El texto de SMTP dice "Cada clínica puede tener su propia configuración", lo que sugiere multi-inquilino, pero en la interfaz no vi cómo gestionar varias sedes.

## 4. Pacientes: 6/10

**Qué hice:**
- Abrí "Nuevo paciente" y lo rellené con datos ficticios.
- Repetí el alta con el **mismo nombre y teléfono**.
- Busqué en el listado.
- Recorrí las pestañas de la ficha de un paciente con datos.

**[P] Observado:**
- **Formulario mínimo:** Nombre, Apellidos, Teléfono, Email, Documento de identidad, Fecha de nacimiento y Notas. "Guardar" se desactiva hasta tener nombre y apellidos, pero no hay asteriscos que indiquen campos obligatorios.
- **Duplicados:** **no se detectan.** El segundo "Prueba Investigación" con el mismo teléfono se creó sin aviso, y luego salen dos resultados idénticos en el buscador de citas.
- **Búsqueda:**
  - Funciona por nombre o teléfono ("600 000" → 2 resultados).
  - **Distingue acentos:** "sanchez" devuelve 1 resultado (por coincidencia en el email) y "Sánchez" devuelve 2; "investigacion" encuentra solo 1 de los 2 duplicados.
  - El listado tiene filtros: Estado, "Sólo no contactar", "Con deuda" y "Última visita", y muestra la deuda por paciente.
- **Ficha:**
  - Pestañas Resumen / Info / Clínico / Administración / Galería / Actividad.
  - Resumen: plan activo con % de avance, próxima y última cita, saldo, diagnósticos sin tratar, historial médico (alergias, enfermedades sistémicas, medicación), acciones rápidas (Cita, Presupuesto, Documento, Programar recordatorio) y **preferencias de notificación por canal (Email, WhatsApp, SMS) y por tipo de mensaje**.
  - Info: contacto de emergencia, datos fiscales ("Faltan datos") y "Archivar" en una "Zona peligrosa".
  - Galería por tipo: intraoral, extraoral, radiografía, antes/después.
  - Actividad: línea de tiempo filtrable con visitas, tratamientos, notas, finanzas, comunicaciones, etc.

**Problemas:**
- Sin control de duplicados.
- Búsqueda sensible a acentos.
- Las notas muestran códigos internos sin traducir: "root_canal_full (diente 36)", "filling_composite", "crown".
- La pestaña Actividad muestra errores técnicos en inglés: "Email is not configured… Set EMAIL_PROVIDER=smtp".
- Tras registrar una caries en el 16 (y una obturación existente en las mismas superficies), la tarjeta "Diagnósticos" seguía diciendo "Sin hallazgos pendientes". No lo verifiqué más.

## 5. Odontograma: 8/10 · Periodontograma: no evaluado

**Qué hice:**
- En la pestaña Clínico → Diagnóstico de mi paciente de prueba, seleccioné la condición "Caries", hice clic en el diente 16, marqué las superficies Oclusal y Mesial y confirmé.
- Añadí "Obturación composite" (16, O-M) como existente.
- Abrí la leyenda y cambié a dentición temporal.
- Revisé el odontograma de un paciente de la demo con muchos datos.

**[P] Observado:**
- **Numeración FDI** (18-11, 21-28, 48-41, 31-38).
- **Dentición temporal** con el conmutador Permanente/Temporal (55-51, 61-65, 85-81, 71-75). No vi dentición mixta en una sola vista.
- Dibujo anatómico doble: vista lateral con raíces y vista oclusal.
- **Superficies M, D, V, L, O** con un diálogo "Seleccionar Superficies" que tiene vista oclusal y lateral clicables y un contador de superficies.
- **Estados:**
  - La leyenda distingue "Existente" de "P = Planificado". En el modo plan los tratamientos salen con una "P" sobre el diente y la ventana del diente dice "PLANIFICADO" o "EXISTENTE".
  - Condiciones diagnósticas: pulpitis, caries, caries incipiente, pigmentación, fractura, ausente, periapical <2 / 2-4 / >4 mm, rotado, desplazado, no erupcionado.
  - Categorías de tratamiento: restauradora (29 tipos), cirugía, endodoncia (completa, 2/3, 1/2, perno), ortodoncia (bracket, tubo, banda, atache, retenedor), preventivo, periodoncia, odontopediatría y "Boca completa".
- El flujo es elegir la condición o tratamiento y luego el diente. Hay "Deshacer" en el aviso.
- El panel de Notas tiene plantillas (Caries, Lesión periapical), adjuntos y "Asociar al diente 16".

**Problemas:**
- La etiqueta "Arcada Inferior" se superpone a los dientes 41/31.
- El aviso dice "Tratamiento añadido" incluso al registrar un diagnóstico.
- Los datos de la demo muestran el diente 31 "Ausente" con "Fractura" y "Periapical" a la vez: no hay validación de estados contradictorios.

**Periodontograma:** en el odontograma no hay ninguno. En Módulos existe `periodontogram` (oficial, v0.1.0: "SEPA periodontal charting — snapshots, probing sites, BoP/PI/CAL indices") en estado **No instalado**. No lo instalé para no cambiar la configuración de la demo compartida.

## 6. Historia clínica, diagnósticos, tratamientos y planes: 7/10

**Qué hice:**
- Desde el odontograma, pulsé "Crear Plan de Tratamiento" con título y profesional.
- Añadí la obturación composite 16 (O, M) y la corona de zirconio 36.
- Confirmé el plan.

**[P] Observado:**
- El plan tiene 3 pasos: Planificar → Confirmar → En curso.
- La lista de tratamientos muestra precio y profesional. La corona de zirconio se desglosa en **2 sesiones con precio por sesión** (toma de medidas 200 € + colocación 350 €).
- Al confirmar, aparece "El plan pasará a Pendiente y se generará un presupuesto borrador para que recepción lo revise… los tratamientos quedan bloqueados". Esto **crea automáticamente PRES-2026-0004**.
- La lista "Planes de tratamiento" funciona como embudo comercial: Por presupuestar / Esperando paciente / Sin cita / Sin próxima cita / Cerrados.
- Historial médico estructurado (alergias, enfermedades sistémicas, medicación, condiciones especiales).
- Notas por tipo: administrativa, diagnóstico, tratamiento, plan, clínica.

**Problemas:**
- "Generar Presupuesto" está desactivado hasta confirmar el plan (tooltip "Disponible tras confirmar el plan"), pero al confirmar el presupuesto ya se genera solo, así que el botón es redundante.
- Formatos incoherentes: "635.00 €" con punto en el diálogo de confirmación frente a "635,00 €" en el resto, y "draft1210.00 €" sin traducir en la lista de planes.
- El precio de la obturación composite en catálogo es de 60 €, pero en el plan figuró a 85 € (dos superficies). Parece precio por superficie, pero no lo explica.

## 7. Presupuestos, plazos y cobros: 7/10

**Qué hice:**
- Abrí PRES-2026-0004 y revisé "Editar" y el menú "…".
- Acepté el presupuesto.
- Registré un **cobro parcial de 100 € en efectivo**.
- Abrí "Crear factura desde presupuesto" sin emitir la factura.

**[P] Observado:**
- **Estados del presupuesto:** Borrador, Enviado, Aceptado, Rechazado, Completado. Tiene versiones (v1 y "Crear nueva versión"), "Descargar PDF" y "Cancelar presupuesto".
- **Edición:** validez desde/hasta, **descuento global** (porcentaje o absoluto), notas para el paciente y notas internas. Las líneas se gestionan desde el plan.
- **Aceptación:** diálogo "Firmado por / Email / Relación (Paciente, Tutor legal, Representante)". Con los campos vacíos se aceptó y tomó al paciente como firmante. "Ver firma" muestra "Aceptación con un clic", fecha y hora, PDF firmado y **hash** que vincula la firma al PDF.
- **Cobro:**
  - Importe con atajos (Completo / 50 % / 25 %).
  - Métodos: Efectivo, Tarjeta, Transferencia, Domiciliación, Seguro, Otro.
  - Fecha y referencia.
  - Antes de confirmar avisa: "100,00 € se imputarán al presupuesto. Quedará pendiente 535,00 €".
  - Después la barra muestra 100 € / 635 € (16 %) con historial.
- **Factura desde presupuesto:** permite **facturar solo algunos tratamientos y cantidades parciales**, avisa de "Faltan datos" fiscales del paciente, y tiene plazo de pago y notas. Crea un borrador.
- La lista de Cobros admite cobros "A cuenta" y anticipos, filtros "Con reembolsos" y "Sin asignar", y saldo a favor.
- Ajustes: series de facturación, tipos de IVA (los tratamientos están "Exento"), caducidad de presupuestos, recordatorios automáticos a 7 y 14 días, enlace público del presupuesto con verificación (teléfono o fecha de nacimiento) y membrete.

**Lo que no existe en la UI:** un **plan de pagos o fraccionamiento** con cuotas y vencimientos, y financiación. Solo hay cobros parciales libres. Hay un módulo `payment_gateways` sin instalar.

**Problemas:**
- La aceptación sin rellenar el firmante es demasiado permisiva.
- En el detalle, "Ver presupuesto" es un título, no un enlace, y confunde.
- En los listados, los cobros de facturas aparecen como "A cuenta".

## 8. Inventario y materiales: no evaluado

**[V]:** no hay menú de inventario. Los módulos `inventory` (comunidad, v0.2.0: stock, costes, movimientos, consumo automático), `inventory_reorder`, `purchase_orders`, `suppliers`, `supplier_items`, `treatment_consumables` y `lab_orders` están en Módulos como **No instalado**.

## 9. Finanzas, informes y comisiones: 6/10

**[P]:** abrí Informes y sus 4 subinformes.
- **Dashboard** (rango 2026-11-01 → 10): caja cobrada 2397,50 €, producción 2495 €, ticket medio, cobros por forma de pago, **producción por doctor**, pacientes nuevos, no-show y cuentas por cobrar por antigüedad.
- **Facturación:** facturado y cobrado, pendiente, desglose de IVA, por profesional, antigüedad y emitido por mes.
- **Presupuestos:** tasa de aceptación 87,5 %, por profesional y tratamientos más presupuestados.
- **Agenda:** tasa de completado, no-shows, primeras visitas, horas trabajadas y ocupación por gabinete y día.
- **Cobros:** neto, devoluciones, saldo a favor y evolución.

**Problemas:**
- El informe de Cobros mostró el error **"No se pudo cargar el informe de cobros · Reintentar"** junto a datos parciales.
- Hay cifras de "pendiente" difíciles de cuadrar: 97,50 € (tratamiento ejecutado no cobrado) frente a 477,50 € en Facturación.
- En Facturación, "Por profesional" atribuye los 1740 € a la recepcionista (quien emite la factura), no al doctor.
- Estado sin traducir: "sent".
- **No hay comisiones ni liquidación a profesionales** en la UI (solo "producción por doctor"). Los módulos `payroll`, `treasury`, `expenses`, `accounting_export` y `verifactu` (AEAT) existen pero no están instalados.

## 10. WhatsApp, reserva online, recordatorios y automatizaciones: no evaluado (solo visto)

**[V]:**
- **Ajustes → Notificaciones:**
  - Canal preferido Email, con respaldo opcional en otro canal y límite diario de SMS.
  - Matriz de 9 tipos de mensaje (confirmación, cancelación, recordatorio "h antes", envío de presupuesto, presupuesto aceptado, bienvenida, factura, recordatorio de presupuesto, recordatorio de revisión), cada uno activo y automático o manual.
  - Aviso: "WhatsApp no está disponible hasta conectar el número de la clínica. Conectar WhatsApp (Kapso)". SMS requiere proveedor. "Email deshabilitado" porque falta SMTP.
- **Módulos sin instalar:** `whatsapp_kapso` (Meta Cloud API), `whatsapp_webhook` (Zapier, Make, n8n), `sms_gateway`, `recall_reminders`, `integrations` (webhooks) y `leads` (formularios externos).
- **No vi reserva online de citas para pacientes** (ni página pública ni módulo con ese nombre).

**[P] parcial:**
- La lista de llamadas de "Recordatorios" funciona: KPIs, filtros por mes, motivo, estado y prioridad; botón "Llamar" (tel:) y "Exportar CSV".
- Los envíos automáticos se intentan, pero fallan en la demo ("Email fallido: appointment_confirmation" en Actividad).

## 11. Seguridad: 4/10 (provisional, solo inspección)

**[V]:**
- Ajustes → Personas → Usuarios: **5 roles fijos** (Administrador, Odontólogo, Higienista, Auxiliar, Recepcionista) y la casilla "Ejerce como profesional".
- El alta de usuario puede generar un "enlace de acceso para enviar por WhatsApp o email" si se deja la contraseña vacía.
- **No vi una matriz de permisos editable.**
- En "Cuenta → Perfil" no hay opción de **MFA/2FA** (solo perfil e idioma).
- Auditoría: hay una línea de tiempo por paciente (Actividad), pero el registro global de actividad del personal (`activity_journal`) y el módulo `gdpr` (consentimientos, derechos ARCO, brechas) **no están instalados**.
- Hay firma de presupuesto con hash y enlace público del presupuesto con verificación.

**No probado:** cómo se comportan los permisos con otros roles (no usé otras cuentas, por las normas de la prueba).

## 12. Usabilidad móvil: 5/10

**[P]** a 390x844, sin scroll horizontal de página:
- **Inicio:** correcto. Las tarjetas se apilan y la línea de tiempo se ve bien (captura 20).
- **Agenda:** cambia a un "buscador de huecos": huecos libres, mínimo de 15-60+ min y "Tocar para reservar". Es una buena idea, pero **la tira de días de la semana se superpone y no se lee** ("LMXJ…" amontonado) y el panel de profesionales queda cortado. No se ven las citas del día, solo los huecos (captura 21).
- **Ficha y odontograma:** las pestañas quedan truncadas ("R.", "A…") y el odontograma **se recorta**: no se ven los dientes 18-16 ni 26-28. Hay una barra inferior fija útil con Cita / Cobrar / Nota (captura 22).

## Copiloto IA: 8/10 (una prueba)

**[P]:**
- Abrí el botón "Abrir IA" (panel lateral con pestañas "Pendientes" y "Chat").
- Ofrece flujos sugeridos: Briefing del día, Preparar una visita, Cubrir un hueco, Buscar o resumir paciente, Huecos libres, Agendar cita, Rellamadas, Presupuestos sin respuesta, Registrar un cobro, Cobros del mes y Resumen de agenda.
- A la pregunta "¿Cuántas citas hay hoy?" **respondió con datos reales**: ejecutó la herramienta `agenda.get_day_overview`, mostró las 2 citas (09:01 Rosa Martínez, 11:30 Javier Sánchez, ambas "Programada", Gabinete 1) y contestó "Hoy hay 2 citas."
- Muestra avisos proactivos ("Se canceló la cita de las 11:15 — se ha liberado un hueco · Revisar").

**[V]:** en Ajustes → Integraciones → Copilot:
- Motor: proveedor **openai**, modelo **gpt-5.4-mini**, "Anonimización de datos (PHI): Activada".
- Briefing matinal por email.
- Métricas de uso (aparecían a 0 aunque acababa de usarlo).

---

## Arquitectura modular (dato relevante para comparar)

- Ajustes → Módulos lista unos 60 módulos "Oficial" o "Comunidad", con versión 0.x y dependencias, que se instalan y desinstalan desde la interfaz.
- **Instalados:** agenda, billing, budget, catalog, clinical_notes, copilot, media, notifications, odontogram, patient_timeline, patients, patients_clinical, payments, recalls, reports, schedules, treatment_plan.
- **Disponibles sin instalar:** periodontogram, inventory, gdpr, activity_journal, documents (recetas y certificados), prescriptions, orthodontics, imaging_viewer (DICOM), imaging_ai, verifactu, accounting_export, whatsapp_kapso, sms_gateway, leads, telephony, payroll, treasury, migration_import, módulos fiscales de India, Italia y Hungría, etc.
- Las descripciones de los módulos están en inglés.
- El catálogo trae 129 tratamientos con código, precio, IVA y duración.

## Capturas (en capturas/)

| Archivo | Descripción |
|---|---|
| dentalpin-01-login.jpg | Login con aviso de demo pública y credenciales visibles |
| dentalpin-02-dashboard.jpg | Inicio: KPIs del día, línea de tiempo, pagos vencidos, pacientes recientes |
| dentalpin-03-agenda-semana.jpg | Agenda semanal con filtros de gabinete y profesional, horas no laborables sombreadas |
| dentalpin-04-agenda-dia.jpg | Vista Día con columnas por profesional |
| dentalpin-05-nueva-cita-form.jpg | Formulario "Nueva cita" (paciente, fecha, duración, gabinete, profesional) |
| dentalpin-06-nuevo-paciente-form.jpg | Formulario de alta de paciente (campos mínimos) |
| dentalpin-07-ficha-paciente.jpg | Ficha del paciente de prueba recién creado (Resumen y preferencias de notificación) |
| dentalpin-08-odontograma.jpg | Odontograma FDI anatómico de un paciente de la demo con muchos hallazgos |
| dentalpin-09-odontograma-superficies.jpg | Diálogo de selección de superficies (M/D/V/L/O) para caries en el 16 |
| dentalpin-10-plan-tratamiento.jpg | Plan de tratamiento: dientes planificados (P), sesiones y precios |
| dentalpin-11-presupuesto.jpg | Presupuesto borrador generado automáticamente desde el plan |
| dentalpin-12-cobro-form.jpg | Diálogo de cobro (atajos 100/50/25 %, métodos de pago) |
| dentalpin-13-presupuesto-cobro-parcial.jpg | Presupuesto aceptado con cobro parcial de 100 € y 535 € pendientes |
| dentalpin-14-cita-solapada.jpg | Cita solapada guardada para la misma doctora, con avisos "Se detectaron solapamientos" |
| dentalpin-15-cita-detalle.jpg | Diálogo de edición de cita (notas y "Cancelar cita") |
| dentalpin-16-usuarios-roles.jpg | Usuarios de la clínica con 5 roles fijos |
| dentalpin-17-modulos.jpg | Catálogo de módulos instalables (instalados y no instalados) |
| dentalpin-18-copilot-ia.jpg | Copiloto IA respondiendo "Hoy hay 2 citas" con la herramienta de agenda |
| dentalpin-19-informes.jpg | Informe de facturación (IVA, por profesional, antigüedad) |
| dentalpin-20-movil-inicio.jpg | Móvil: inicio bien adaptado |
| dentalpin-21-movil-agenda.jpg | Móvil: agenda como buscador de huecos; tira de días superpuesta |
| dentalpin-22-movil-ficha.jpg | Móvil: ficha clínica con pestañas truncadas y odontograma recortado |
| dentalpin-23-agenda-kanban.jpg | Kanban del día (Por venir, Sala de espera, En gabinete…), última columna cortada |
| dentalpin-24-aviso-solapamiento-formulario.jpg | Avisos de solapamiento apilados mientras se edita una cita con conflicto de gabinete |
| dentalpin-25-odontograma-temporal.jpg | Odontograma en dentición temporal (51-85) |
