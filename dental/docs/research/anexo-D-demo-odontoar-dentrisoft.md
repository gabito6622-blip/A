# Investigación competitiva: Odonto.ar y Dentrisoft (demos públicas)

**Fecha:** 2026-11-10
**Método:** Playwright (Chromium headless). Escritorio 1440x900 y teléfono 390x844 (isMobile + touch). Capturas JPEG calidad 60, deviceScaleFactor 1, en `capturas/`.
**Límites respetados:** no registré cuentas, no probé credenciales, no envié formularios con datos personales, no toqué "Confirmar Cita", no hice pruebas de seguridad. Solo usé los botones y campos visibles, como lo haría un visitante.

Convención: **[PROBADO]** = lo manejé yo en la demo. **[VISTO/ANUNCIADO]** = solo aparece en textos de marketing, preguntas frecuentes, políticas o imágenes publicitarias.

---

## Nivel de acceso

| Producto | Clasificación | Detalle |
|---|---|---|
| **Odonto.ar** | **Demostración interactiva** (guiada, datos ficticios, todo pasa en el navegador) | `/demo` es un recorrido de 7 pasos con datos de ejemplo. No pide registro. No es el producto real: varias acciones están desactivadas o son decorativas. Para el sistema completo hay **prueba con registro** (30 días, sin tarjeta, `/register`), que no usé. |
| **Dentrisoft** | Portal del paciente: **demo pública** (no funciona de punta a punta). Panel administrativo: **solo información pública** y **demostración comercial** (llamada por WhatsApp). | `/demo` dice "Sin registro requerido" y ofrece "Explorar panel admin", pero ese botón lleva a `/admin/login` (correo y contraseña) **sin credenciales de demo publicadas**. "Prueba Gratis" también lleva al login. Los botones de planes y "demo guiada" abren WhatsApp. |

---

# A) Odonto.ar: recorrido de 7 pasos

Arriba hay una barra de progreso con pasos numerados ("1/7 ~5 min restantes"). Abajo, una barra fija con "Anterior" y "Siguiente". "Siguiente" se activa solo después de hacer la acción que pide cada paso. Desde la carga inicial se puede saltar a cualquier paso con los números (probado en el teléfono: pasé directo a los pasos 3 y 5). La "X" lleva a la página de inicio.

### Paso 1: Turnos online ("El paciente reserva solo") [PROBADO]
- **Qué muestra:** un marco con la URL `odonto.ar/turnos/consultorio-sur` y una tarjeta de reserva de "Consultorio Sur, Dra. María López". La paciente ya está identificada ("Hola, Sofía"). Un aviso aclara: "En la app real, antes de llegar acá el paciente confirma su DNI y su teléfono".
- **Qué se puede hacer:** elegir el motivo (Control y limpieza 30 min, Me duele una muela 30 min, Arreglo/obturación 60 min). Después aparece el calendario ("En azul, los días con lugar") con flechas para cambiar de mes y un desplegable de horario. Hay barra de progreso de 5 segmentos y botón "Volver".
- **Qué pasa:** al elegir el horario, el turno queda reservado al instante, **sin pantalla de confirmación**. Aparece la tarjeta "Listo, Sofía. Sacale una foto a la tarjeta" y el aviso "Turno reservado, y nadie atendió el teléfono".
- **Observaciones y fricciones:**
  - **La tarjeta de confirmación no coincide con lo elegido.** Elegí vie 13/11 a las 14:00 y la tarjeta dijo "Martes, 10 De Noviembre 11:00". En otra corrida elegí mié 11/11 a las 13:00 y dijo "Martes 10, 10:00". En el paso 2, la agenda sí ubica el turno a las 13:00 del martes 10. La fecha elegida se ignora y la hora de la tarjeta cambia en cada corrida.
  - **Días pasados en azul y seleccionables.** Del 2 al 9 de noviembre aparecen "con lugar", aunque hoy es 10/11. Elegí el 3/11 y ofreció horarios.
  - Todos los días ofrecen los mismos 3 horarios (13:00, 13:30, 14:00).
  - "¿No sos Sofía?" no hace nada en la demo.
- Captura: `odontoar-01-turnos-motivo.jpg`, `odontoar-02-turno-confirmado.jpg`.

### Paso 2: Agenda ("Turnos visuales") [PROBADO]
- **Qué muestra:** vista de día del martes 10/11 con columnas por profesional (Dra. María López y Dr. Carlos Ruiz), de 09:00 a 15:30 en tramos de 30 min. Hay leyenda de estados (Agendado, Confirmado, Completado, Cancelado, No asistió) y botones Hoy, No Laborables, Nuevo Turno, Buscar paciente, Día/Semana/Mes y Profesionales (2). El turno de Sofía aparece con un "globo azul" (reservado por internet). Cada tarjeta tiene íconos de estado y menú "⋮".
- **Qué se puede hacer:** arrastrar tarjetas a otro horario o a otro profesional. Moví a Pedro Díaz de López 15:00 a Ruiz 12:30 y aparece "Turno movido. Chau cuaderno".
- **Observaciones y fricciones:**
  - Los turnos **Completado** (Juan Pérez) y **No asistió** (Roberto Sánchez) están bloqueados para arrastrar. Buena regla.
  - **Permite superponer turnos sin aviso.** Laura Ruiz quedó de 09:00 a 10:00 encima de Lucía Fernández (09:30 a 10:30) en el mismo profesional, con las tarjetas pisadas.
  - En la demo, la barra de herramientas es decorativa: Semana, Mes, Nuevo Turno y No Laborables no responden, el buscador está desactivado y el menú "⋮" no abre nada.
  - Las franjas pasan de 15:30; la grilla tiene scroll interno.
- Captura: `odontoar-03-agenda-superposicion.jpg`.

### Paso 3: Odontograma ("Trazabilidad por diente") [PROBADO]
- **Qué muestra:** panel de herramientas con:
  - **Estado:** Realizado (rojo), Planificado (azul), A rehacer (violeta).
  - **Qué marco:** Cara, Corona, Extracción, Conducto, Implante, Perno, Fractura, Prótesis, Movilidad, Borrar.
  - **Material:** Sin especificar, Resina, Amalgama, Ionómero de vidrio, Provisoria.
  - **Vista** Anatómica (dibujo con raíces y nervio) o Clásica (cuadros de 5 caras).
  - **Dentición** Adulto, Infantil o Mixta (agrega 51–85).
  - **Ver:** Raíces, Nervio, Caras.
  - Contador "7 piezas con marcas" e **Historial de cambios**: "Registro inmutable: quién cambió qué diente, cuándo", con autor, fecha relativa y antes→después (por ejemplo "Pieza 16 — Material cara oclusal: Sin especificar → Resina").
- **Qué se puede hacer:** tocar la cara de la pieza 26 la marca al instante y agrega "Vos (recién) — Pieza 26 — Cara oclusal: Sin marcar → Realizado". También probé Planificado + Implante en la pieza 25 ("Implante: Sin marcar → Planificado"), la vista Clásica y la dentición Mixta.
- **Observaciones y fricciones:**
  - "Guardar Cambios" sigue desactivado después de marcar, pero el historial ya muestra el cambio. No queda claro si hay que guardar.
  - En escritorio el odontograma no entra completo: el contenedor tiene scroll horizontal y arranca desplazado. Las piezas 18–14 y 48–44 quedan ocultas a la izquierda.
  - La ayuda describe la 26 como "arcada superior derecha". En notación FDI, la 26 es superior izquierda del paciente: está a la derecha en pantalla.
  - **No vi periodontograma.**
- Capturas: `odontoar-04-odontograma-historial.jpg`, `odontoar-05-odontograma-clasica-mixta.jpg`.

### Paso 4: Obras Sociales ("Cálculo automático") [PROBADO, solo lectura]
- **Qué muestra:** grilla "OSDE — Precios por Plan (Plan 210)" con código, práctica, categoría y celda "Arancel / OS paga" (6 prácticas: 0101, 03.01, 03.02, 0301, 06.01, 40101). Los botones "Gestionar Planes", "Editar precios" y el buscador de prácticas están desactivados.
- **Qué se puede hacer:** tocar un precio abre el diálogo "Editar Precio": Arancel $135.000 ("Se edita desde el Nomenclador. Los cambios se propagan automáticamente"), "Monto fijo que paga la OS" $94.400 y Coseguro $40.600 (la cuenta es correcta).
- **Observaciones:** el campo es de solo lectura y "Guardar" está desactivado en la demo. Modelo visible: arancel por plan, monto fijo que paga la OS y coseguro calculado.
- Captura: `odontoar-06-obras-sociales-coseguro.jpg`.

### Paso 5: Presupuesto ("PDF profesional") [PROBADO]
- **Qué muestra:** "Nuevo Presupuesto" para Fernández, Lucía, IOMA Plan Básico. Cada práctica trae pieza, precio de lista, arancel convenido, cobertura en %, monto y copago. Al final: Costo total, Cobertura Obra Social y Total paciente paga.
- **Qué se puede hacer:** el buscador "Buscar práctica…" muestra 3 opciones. Agregué Profilaxis y los totales pasaron de $481.313 / −$249.800 / $231.513 a $536.313 / −$297.800 / $238.513. Revisé las sumas y son correctas. Cada línea se puede quitar con "x".
- **Observaciones y fricciones:**
  - "Descargar PDF" no hizo nada (no hubo descarga ni pestaña nueva) y "Guardar Presupuesto" está desactivado.
  - El copago se calcula sobre el precio de lista. Por eso "Cobertura (100%)" de Profilaxis igual deja $7.000 de copago, lo que se presta a confusión.
  - Los montos "OS paga" de IOMA en este paso son idénticos a los de OSDE en el paso 4. Es incoherente como dato de demo.
  - **En el teléfono, la columna de montos queda cortada fuera de la pantalla.** El total queda en x≈481 px con 390 px de ancho, se recorta y no se puede ver.
- Captura: `odontoar-07-presupuesto.jpg`.

### Paso 6: Reportes ("La clínica en números") [PROBADO]
- **Qué muestra:**
  - Filtros de período (30 días, 60 días, 3, 6 y 12 meses) y de profesional.
  - 7 gráficos: Facturación por mes, Facturación por profesional, Prácticas más realizadas, Cancelaciones/No-show (%), Nuevos pacientes por mes, Cobros por obra social y "Deuda pendiente total $890k (−12% en cobros)".
- **Qué se puede hacer:** elegí "Dr. Carlos Ruiz": cambiaron la escala de Facturación por mes y la deuda ($356k). Con eso se completa el paso.
- **Fricciones:**
  - Los botones de período no cambian nada: "12 meses" sigue marcado después de tocar "30 días".
  - El filtro de profesional **no** recalcula 5 de los 7 gráficos, aunque la ayuda dice que se recalculan todos.
  - El eje muestra "Nov, Dic, Ene, Feb, Mar, Nov" con "12 meses" marcado: son 6 barras y la secuencia salta.
- Captura: `odontoar-08-reportes-filtro-profesional.jpg`.

### Paso 7: Tu clínica (cierre) [VISTO/ANUNCIADO]
- Resume lo recorrido y lista "Y además incluye": Historia clínica con más de 70 campos, Importación desde Excel en 3 pasos, Permisos granulares por rol, Seguridad con aislamiento real de datos (RLS), Radiografías y estudios, **Recordatorios semi automáticos por WhatsApp**, Mensajería interna, Soporte con tickets y Chatbot con IA.
- Llamados a la acción: "Crear mi cuenta gratis" (`/register`) y "Prefiero una demo personalizada" (`/#contacto`).
- Detalle visual: en el teléfono, el texto "$450k" del paso anterior queda suelto al final de la página.
- Captura: `odontoar-09-cierre-tu-clinica.jpg`.

### Información pública de Odonto.ar (inicio y preguntas frecuentes) [VISTO/ANUNCIADO]
- **Precios:** prueba de 30 días ($0, 3 usuarios). Individual USD 29 (1 usuario), Profesional USD 49 (5 usuarios, permisos por persona, mensajería) y Clínica USD 99 (10 usuarios). Todas las funciones en todos los planes. Se paga en pesos por Mercado Pago, sin débito automático.
- **Turnos online:** "Vos definís la disponibilidad… con cuánta anticipación", duración por motivo y reglas de cancelar o reprogramar.
- **Agenda:** día, semana o mes, compartida con el equipo.
- **Importación:** Excel o CSV de pacientes (datos personales, obra social y saldo). Odontogramas e historias clínicas **no** se importan. Las listas de precios de obras sociales se importan desde Excel con vista previa de cambios.
- **Seguridad:** datos cifrados en tránsito y en reposo, aislamiento por clínica, servidores fuera de Argentina, copias de seguridad periódicas. Si la suscripción vence, los datos quedan en modo lectura. Al cerrar la cuenta se puede pedir una copia dentro de 30 días.
- **Dispositivos:** PC, tablet y celular, sin instalar nada. Algunas tareas, como importar, se hacen desde computadora.

### Celular 390x844 (Odonto.ar) [PROBADO]
- Recorrí los 7 pasos en el teléfono. **No hay scroll horizontal de página** (scrollWidth = 390).
- **Turnos:** muy bien resuelto. Botones de motivo de 324x54, días de 42x42 y tarjeta legible. El primer motivo queda casi al final de la primera pantalla por el texto explicativo de la demo.
- **Agenda:** muestra 2 columnas con nombres truncados ("Lucía Ferná…"). El **arrastre táctil funciona** (lo probé con eventos táctiles reales). Si la tarjeta queda bajo la barra fija de "Siguiente", no se puede agarrar. La barra de herramientas (Nuevo Turno, Día/Semana) no se ve en el teléfono.
- **Odontograma:** cada diente mide unos 30 px y la cara central unos 10x10 px, muy por debajo de 44 px de área táctil. Funciona con toques precisos. La fila de herramientas tiene scroll lateral ("Conduc…" cortado).
- **Obras sociales:** la tabla tiene scroll horizontal interno (651/308 px).
- **Presupuesto:** los importes y el total quedan cortados y no se ven. Es un error importante.
- **Reportes:** se adaptan bien.
- Capturas: `odontoar-10-movil-turnos-y-agenda.jpg`, `odontoar-11-movil-odontograma-os-presupuesto-reportes.jpg`.

---

# B) Dentrisoft

### `/demo` (página de la demo) [VISTO]
- Dos caminos: "Portal del Paciente" (agendamiento 24/7 desde el celular, elección de especialidad y horario, confirmación automática por email, página con la marca de la clínica) y "Panel Administrativo — COMPLETO" (dashboard, historia clínica y odontograma, cartera y abonos, honorarios y liquidaciones, RIPS Res. 2706/2025).
- Las preguntas frecuentes afirman: "La demo es 100% en navegador, sin instalación ni registro" y "La demo del administrador muestra el panel de gestión completo". Pero **"Explorar panel admin" lleva a `/admin/login`** con correo y contraseña (texto de ejemplo "admin@clinica.com"), sin credenciales de demo ni enlace de registro.
- Precios en COP: Starter $89.900 (1 dentista, recordatorios por WhatsApp, dominio propio), Professional $169.900 (hasta 5 dentistas, cartera, planes de pago, reportes, RIPS, multi-sede) y Enterprise a medida (API, SLA 99,9%). "14 días gratis sin tarjeta" convive en el inicio con "Garantía de 14 días… te devolvemos tu dinero".
- Capturas: `dentrisoft-01-pagina-demo.jpg`, `dentrisoft-03-movil-pagina-demo.jpg`, `dentrisoft-06-login-admin.jpg`.

### `/u/demo-clinica`: portal del paciente "Clínica Dental Sonrisas" [PROBADO hasta antes de confirmar]
- **Qué muestra:** encabezado "Agenda tu Cita — Completa el formulario y te contactaremos en menos de 2 horas", aviso "Primera consulta completamente GRATIS" y "¿Cómo funciona?" en 4 pasos (formulario → contacto en 2 h → confirmación según disponibilidad → listo). Es más una **solicitud de cita** que una reserva inmediata.
- **Campos:**
  1. **Datos personales:** nombre*, email*, teléfono/WhatsApp*, edad y documento de identidad*.
  2. **Cita:** servicio* (10 opciones: Blanqueamiento, Cirugía/Extracción, Consulta General, Endodoncia, Implantes, Limpieza, Ortodoncia, Prótesis, Resinas, Urgencia), profesional (opcional), fecha* (selector nativo, mínimo = hoy), hora* ("Primero selecciona fecha y servicio"), primera visita* (Sí/No) y motivo (texto libre).
  3. **Adicional:** "¿Cómo nos conociste?" (Google, Instagram, Facebook, TikTok, Referido, Pasaba por la zona, Otro). Si se elige Referido u Otro aparece un campo condicional; lo probé y funciona.
  4. Casilla de aceptación de la política de privacidad* y botón "Confirmar Cita".
  5. Abajo: tarjetas "Llámanos" (tel 3001234567) y "Escríbenos por WhatsApp" (wa.me/573001234567, número de ejemplo).
- **Qué hice:** elegí servicio (Limpieza, Consulta General, Urgencia, Ortodoncia) y fecha (hoy, jue 12, vie 13 y dom 15). **No completé datos personales y no toqué "Confirmar Cita".** La página no dice en ningún lado que sea una demo o un entorno de pruebas, y promete contacto humano en 2 h.
- **Qué pasó:**
  - **El desplegable de hora siempre muestra "Error al cargar horarios"**, con cualquier servicio y fecha.
  - El selector de profesional solo ofrece "Cualquiera disponible": no hay dentistas cargados.
  - La consulta de disponibilidad que hace la página respondió 400 "Faltan parámetros: … dentist_id". Con "Cualquiera disponible" no se envía dentista.
  - Resultado: **el flujo no se puede completar desde la interfaz**, porque la hora es obligatoria.
- **Otras observaciones:**
  - El formulario tiene `novalidate`, así que la validación depende de JavaScript. No la probé.
  - Escribiendo a mano, el campo de fecha acepta una fecha pasada: el valor queda inválido, pero la página igual intenta pedir horarios.
  - El pie dice "Powered by **DentalApp**", no Dentrisoft.
  - El enlace de privacidad va a `/privacidad`, la política de Dentrisoft/Enkrevolt. No hay una política propia de la clínica.
- Capturas: `dentrisoft-02-portal-paciente-escritorio.jpg`, `dentrisoft-04-error-horarios.jpg`.

### Celular 390x844 (portal del paciente) [PROBADO]
- **Bien resuelto:**
  - Sin scroll horizontal.
  - Campos de 292x48–52 px con letra de 16 px (iOS no hace zoom al tocar).
  - Botón "Confirmar Cita" de 292x60 y botones de teléfono y WhatsApp de 48 px de alto.
- **Fricciones:**
  - Página larga (unos 3.300 px) con 13 campos, 7 de ellos obligatorios contando la casilla de privacidad.
  - Casilla de privacidad de 13x20 px y radios de 16x20 px, chicos para el dedo.
  - Sin `autocomplete` ni `inputmode` en nombre, email y documento (el teléfono sí usa `type=tel`).
  - Pide documento de identidad antes de mostrar si hay disponibilidad, y la disponibilidad falla igual.
- Captura: `dentrisoft-05-movil-formulario.jpg`.

### Panel administrativo: solo información pública [VISTO/ANUNCIADO]
- **Inicio (`/`):**
  - Agenda multi-dentista con confirmación por WhatsApp.
  - Historia clínica con odontograma interactivo, consentimientos con firma digital y planes de tratamiento con presupuesto.
  - Cartera por antigüedad con alertas y planes de pago con interés configurable.
  - Liquidación automática de honorarios por dentista, período y porcentaje.
  - Reportes financieros exportables en PDF.
  - RIPS Res. 2706/2025 con validación CUPS/CIE10.
  - Multi-sede, colores y marca personalizables.
  - Cifras de marketing: "−32% inasistencias", "+18% cartera" y otras.
- **Imágenes publicitarias:** el inicio no muestra capturas reales legibles del panel, solo fotos de stock y mockups. El mockup de celular deja ver una navegación inferior (Dashboard, Citas, Pacientes, Honorarios), filtros de citas con exportación a Excel, pestañas de Historia Clínica y Odontograma, "Evoluciones Médicas", antecedentes y signos vitales. Captura: `dentrisoft-08-mockup-movil-publicitario.jpg`, `dentrisoft-07-home-plataforma.jpg`.
- **Política de seguridad (`/legal/seguridad`, v1.0, 31-mar-2026):**
  - Infraestructura Supabase + Netlify, TLS 1.3, AES-256 en reposo, bcrypt.
  - JWT con expiración y **RBAC de 3 roles** (Propietario, Recepcionista, Odontólogo).
  - Aislamiento multi-tenant con RLS.
  - **Auditoría de eventos críticos** (accesos, datos sensibles, liquidaciones).
  - Copias de seguridad diarias con retención de 7 días en otra región.
- **Inconsistencias públicas:**
  - Disponibilidad declarada en tres valores distintos: 99,5% ("garantizado" en `/nosotros`), 99,8% (pie) y SLA 99,9% (Enterprise).
  - El teléfono que se muestra en el pie (+57 310 227 8592) no es el del enlace de WhatsApp (573115216290).
- **Inventario:** no aparece mencionado en ningún lado.

---

## Evaluación por área (1 a 10 solo si se probó lo suficiente)

### Odonto.ar

| # | Área | Qué hice | Qué observé | Fricción UX | Puntaje |
|---|---|---|---|---|---|
| 1 | Dashboard / navegación | Recorrí el stepper de 7 pasos | La demo no incluye un dashboard del producto. Navegación del recorrido clara (progreso, tiempo restante, salto a pasos) | Se puede saltar pasos sin hacerlos | **no evaluado** (no hay dashboard en la demo; el recorrido es bueno) |
| 2 | Agenda y disponibilidad | Arrastré turnos entre horas y profesionales; probé la barra de herramientas | Columnas por profesional, 5 estados, turnos completados bloqueados, origen online marcado | Superposición sin aviso; barra de herramientas decorativa; disponibilidad del paciente fija (3 horarios) | **7** |
| 3 | Sillones y sedes | — | Un solo "Consultorio Sur"; sin sillones ni sedes | — | **no evaluado** (no se ve ni se anuncia) |
| 4 | Pacientes | — | Solo nombres dentro de otros módulos | — | **no evaluado** (anunciado: HC con más de 70 campos, importación Excel/CSV) |
| 5 | Odontograma / periodontograma | Marqué cara, implante; vistas Clásica/Anatómica; dentición Mixta | Muy completo: 3 estados, 10 marcas, materiales, historial con antes→después | Recortado en escritorio; botón Guardar ambiguo; sin periodontograma | **8** (odontograma) / periodontograma **no evaluado** (no visto) |
| 6 | Historia clínica / tratamientos | — | Solo el historial del odontograma | — | **no evaluado** (anunciado) |
| 7 | Presupuestos / pagos / obras sociales | Agregué una práctica; abrí la edición de precio de OS | Cálculo OS/copago correcto y automático | PDF no hace nada; edición de solo lectura; copago "100%" confuso; montos cortados en el teléfono; sin cobros ni pagos | **6** |
| 8 | Inventario | — | No aparece | — | **no evaluado** (ni visto ni anunciado) |
| 9 | Finanzas / reportes | Probé período y profesional | 7 gráficos y KPI de deuda | Período no responde; 5 de 7 gráficos no se filtran; eje raro | **5** |
| 10 | WhatsApp / turnos online / automatizaciones | Reservé el turno completo | Flujo de 3 toques, muy limpio, y el turno aparece en la agenda | La confirmación muestra otra fecha y hora; días pasados reservables; sin paso de confirmación | Turnos online **7**; WhatsApp **no evaluado** (anunciado "semi automáticos") |
| 11 | Seguridad / permisos / auditoría | Vi el registro de cambios del odontograma | Trazabilidad "inmutable" por diente con autor | — | **no evaluado** (permisos, roles y RLS solo anunciados; la auditoría se ve solo en el odontograma) |
| 12 | UX en celular | Recorrí los 7 pasos a 390 px | Reserva excelente; arrastre táctil funciona | Odontograma con objetivos de unos 10 px; presupuesto cortado; tabla de OS con scroll | **6** |

### Dentrisoft

| # | Área | Qué hice | Qué observé | Fricción UX | Puntaje |
|---|---|---|---|---|---|
| 1 | Dashboard / navegación | Intenté entrar a "Explorar panel admin" | Lleva al login sin credenciales | Promesa de "demo sin registro" no cumplida | **no evaluado** (sin acceso) |
| 2 | Agenda y disponibilidad | Probé 4 servicios y 4 fechas en el portal del paciente | "Error al cargar horarios" siempre; no hay dentistas cargados | Imposible elegir hora | **2** (lado paciente); agenda admin **no evaluado** |
| 3 | Sillones y sedes | — | "Multi-sede" anunciado en Professional | — | **no evaluado** |
| 4 | Pacientes | — | Anunciado: importación Excel | — | **no evaluado** |
| 5 | Odontograma / periodontograma | — | Anunciado "odontograma interactivo"; pestaña visible en el mockup | — | **no evaluado** |
| 6 | Historia clínica / tratamientos | — | Anunciado: evoluciones, consentimientos con firma digital, CUPS/CIE10 | — | **no evaluado** |
| 7 | Presupuestos / pagos / cartera | — | Anunciado: cartera por antigüedad, abonos, planes de pago con interés | — | **no evaluado** |
| 8 | Inventario | — | No anunciado | — | **no evaluado** |
| 9 | Finanzas / reportes / RIPS / honorarios | — | Anunciado: RIPS 2706, honorarios, reportes en PDF | — | **no evaluado** |
| 10 | WhatsApp / reservas online / automatizaciones | Formulario del paciente sin enviar | Solicitud con contacto humano en 2 h, no reserva inmediata; botón wa.me con número de ejemplo | Formulario largo; pide documento; disponibilidad rota | Reservas online **3**; recordatorios por WhatsApp **no evaluado** (anunciados) |
| 11 | Seguridad / permisos / auditoría | Leí `/legal/seguridad` | Política pública detallada: 3 roles, RLS, auditoría, copias de seguridad | Cifras de disponibilidad inconsistentes | **no evaluado** (solo documentación) |
| 12 | UX en celular | Formulario del paciente y `/demo` a 390 px | Diseño correcto, campos de 48 px, letra de 16 px | Casilla y radios chicos; página de unos 3.300 px; sin autocomplete; flujo bloqueado | **5** |

---

## Capturas

| Archivo | Descripción |
|---|---|
| `odontoar-01-turnos-motivo.jpg` | Paso 1: elección del motivo en la tarjeta de reserva (escritorio) |
| `odontoar-02-turno-confirmado.jpg` | Paso 1: tarjeta "Listo, Sofía". Muestra mar 10/11 11:00 aunque se eligió vie 13/11 14:00 |
| `odontoar-03-agenda-superposicion.jpg` | Paso 2: agenda por profesional; turno arrastrado que queda encima de otro (09:00–10:00 sobre 09:30–10:30) |
| `odontoar-04-odontograma-historial.jpg` | Paso 3: pieza 26 marcada como Realizado y entrada "Vos (recién)" en el historial |
| `odontoar-05-odontograma-clasica-mixta.jpg` | Paso 3: vista Clásica, dentición Mixta, implante planificado en 25 (vista recortada a la izquierda) |
| `odontoar-06-obras-sociales-coseguro.jpg` | Paso 4: diálogo "Editar Precio" de OSDE Plan 210 con coseguro calculado (solo lectura) |
| `odontoar-07-presupuesto.jpg` | Paso 5: presupuesto IOMA con Profilaxis agregada y totales recalculados |
| `odontoar-08-reportes-filtro-profesional.jpg` | Paso 6: reportes filtrados por Dr. Carlos Ruiz ("12 meses" sigue activo) |
| `odontoar-09-cierre-tu-clinica.jpg` | Paso 7: resumen y funciones extra anunciadas |
| `odontoar-10-movil-turnos-y-agenda.jpg` | Celular: introducción, calendario, confirmación y agenda en 2 columnas |
| `odontoar-11-movil-odontograma-os-presupuesto-reportes.jpg` | Celular: odontograma con dientes chicos, diálogo de OS, presupuesto con montos cortados y reportes |
| `dentrisoft-01-pagina-demo.jpg` | `/demo` en escritorio: "Sin registro requerido", Portal del paciente y Panel administrativo |
| `dentrisoft-02-portal-paciente-escritorio.jpg` | Portal "Clínica Dental Sonrisas", formulario completo (página entera) |
| `dentrisoft-03-movil-pagina-demo.jpg` | `/demo` en el celular |
| `dentrisoft-04-error-horarios.jpg` | Hora preferida: "Error al cargar horarios" tras elegir servicio y fecha |
| `dentrisoft-05-movil-formulario.jpg` | Portal del paciente en el celular: encabezado, bloque de cita con error y final con casilla y "Confirmar Cita" |
| `dentrisoft-06-login-admin.jpg` | `/admin/login`, destino de "Explorar panel admin" (sin credenciales de demo) |
| `dentrisoft-07-home-plataforma.jpg` | Inicio: sección "Plataforma" con foto de stock y tarjetas, sin capturas reales del panel |
| `dentrisoft-08-mockup-movil-publicitario.jpg` | Mockup publicitario de la app en el celular (navegación inferior, citas, historia clínica) |

Scripts usados: `(copias de trabajo locales de la sesión de investigación, no incluidas) od/`
