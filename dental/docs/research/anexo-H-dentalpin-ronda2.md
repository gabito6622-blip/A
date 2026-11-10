# DentalPin, ronda 2: inmersión funcional en lo que aún no tenemos

- **Fecha:** 2026-11-10, aprox. 18:15–19:15 hora de la demo (Madrid, UTC+1).
- **Acceso:** https://demo.dentalpin.com con las credenciales públicas que publica el propio fabricante en el login (rol Administrador). Además leí el manual de usuario público en español (docs.dentalpin.com/user-manual/es/…) para los módulos que la demo no tiene instalados.
- **Método:** Playwright/Chromium sin interfaz, 1440x900 en escritorio y 390x844 para la vista pública del presupuesto. Leí el texto de la interfaz y las peticiones que hace la propia interfaz (método, ruta y código HTTP) para confirmar si una acción se guardó. No llamé a la API por fuera de la interfaz, no usé otras cuentas, no instalé módulos, no cambié ajustes globales y no leí código fuente.
- **Complementa** a `anexo-B-demo-dentalpin.md` (ronda 1). Aquí no repito lo que ya está allí salvo para corregirlo.

**Leyenda:**
- **[P] Probado:** ejecuté la acción en la demo y vi el resultado.
- **[V] Visto:** solo vi la pantalla, el ajuste o el manual público.

**Datos ficticios creados o modificados en esta ronda.** No se envió ningún mensaje: email y SMS no están configurados en la demo, y ningún botón de WhatsApp se pulsó.
- Una cita hoy a las 18:30 (Carlos, Gabinete 2) para "Prueba Investigación" (paciente duplicado de la ronda 1, sin email). La llevé por todo el flujo: confirmada → llegada → en gabinete → completada.
- Un recall "Higiene" para mayo de 2027 en ese mismo paciente.
- En PLAN-2026-0004, la sesión "Toma de medidas" de la corona marcada como realizada. Esto generó un cargo de 200 €.
- PRES-2026-0005: presupuesto suelto de 2 líneas con descuento de línea y descuento global. Lo marqué como "enviado" de forma manual, sin mensaje, y luego le creé una v2.
- Abrí como visitante anónimo dos enlaces públicos de presupuesto. En uno verifiqué con los 4 últimos dígitos del teléfono ficticio (0001). **No acepté ni rechacé nada.**
- 4 conversaciones con el copiloto. Ninguna acción de escritura confirmada.

**Aviso sobre la demo compartida:** otro visitante dejó configurado el "Idioma de comunicaciones" en **árabe**. Por eso la vista pública del presupuesto se mostró en árabe y de derecha a izquierda, sea cual sea el idioma del navegador. No es un fallo del producto, pero demuestra que un ajuste de la clínica cambia toda la cara pública sin que el personal lo vea.

**Capturas:** 20 imágenes `dentalpin2-NN-*.jpg` en `capturas/`; el índice está al final. Durante la sesión se habían confirmado en git unas capturas provisionales con otros nombres, y las he sustituido por este conjunto final.

---

## Resumen ejecutivo

1. **La agenda es una máquina de estados con marca de tiempo en cada paso.** Programada → Confirmada → En sala de espera → En gabinete → Completada, con las salidas No asistió y Cancelada. El menú de cada tarjeta solo ofrece las transiciones válidas. Gracias a esas marcas, el informe de Agenda saca **tiempo de espera, puntualidad del paciente y duración real frente a la planificada**. Esto es lo más aprovechable de la ronda.
2. **No hay tipos de cita con color, ni citas recurrentes, ni lista de espera.** El color de la agenda es el del gabinete. El "motivo" de la cita son los tratamientos del plan, y si no hay plan queda "Consulta".
3. **El recall está bien resuelto como cola de llamadas mensual:**
   - motivo, mes objetivo, prioridad y registro de intentos con canal y resultado;
   - la cita se enlaza sola al recall;
   - al completar una cita se pregunta "¿cuándo deberíamos llamarle?";
   - intervalos por motivo y un mapa de categoría de tratamiento → motivo.
4. **Del plan al cobro, por sesiones:**
   - un tratamiento del catálogo puede llevar una plantilla de sesiones con importe por paso;
   - marcar una sesión genera el cargo de esa sesión;
   - los descuentos del presupuesto se reparten entre las sesiones.

   Fallos:
   - la factura parcial va por cantidad de línea, no por sesión;
   - la producción de esa sesión se atribuyó a "Sin doctor asignado";
   - la ficha muestra totales contradictorios (0 € pagado en una pestaña y 100 € en otra).
5. **El enlace público del presupuesto** pide los 4 últimos dígitos del teléfono (o la fecha de nacimiento) antes de mostrar nada. Muestra el precio neto con el original tachado y botones "Acepto y firmo" / "No me interesa", y registra "Presupuesto visto por el paciente" en la línea de tiempo. Riesgo: al crear una v2, la v1 sigue "Enviada" y se puede aceptar.
6. **El copiloto usa datos reales mediante herramientas, pero falla en cosas básicas:**
   - en "Resume la agenda de hoy" dio las horas **1 hora antes** (en UTC);
   - no supo emparejar "Carlos López Martínez" con el profesional del mismo nombre que él mismo listó;
   - desde una tarjeta proactiva "se ha liberado un hueco" propuso **cancelar una cita con ID 000…000**.

   Lo positivo: las escrituras se detienen en una tarjeta roja de confirmación, y no confirmé ninguna.
7. **Hay unos 60 módulos.** Los que no tenemos y valen para la clínica:
   - leads (formulario web → solicitudes o recall si ya es paciente);
   - pedidos a laboratorio con color Vita y fechas;
   - inventario con consumo por tratamiento, compras y reposición;
   - tareas de relevo del equipo;
   - fichaje de asistencia;
   - nómina por periodos cerrados, gastos, tesorería;
   - telefonía CTI, segmentos (etiquetas) de pacientes, relaciones familiares;
   - diario de actividad del personal inmutable;
   - catálogo de medicamentos y recetas que se congelan al emitir.

---

## 1. Agenda: vista semanal y kanban

### 1.1 Vista semanal [P]
- **Estructura:**
  - cabecera con el conmutador Semana / Día / Kanban y "Nueva cita";
  - chips de filtro por Gabinete y por Profesional;
  - navegación ‹ Hoy ›;
  - rejilla de lunes a domingo, 09:00–20:00, con el día actual resaltado y sombreados a rayas para el día cerrado y la pausa de 14:00–16:00.
- **Tarjeta:**
  - apellidos del paciente truncados;
  - "Gabinete N · tratamiento" si hay tratamiento;
  - avatar con las iniciales del profesional;
  - un icono de estado delante del nombre (✓ para completada, otro icono para "en sala");
  - un tirador inferior para cambiar la duración.

  No hay tooltip al pasar el ratón.
- **Colores [P]:** el fondo y el borde de la tarjeta **dependen del gabinete** (Gabinete 1 azul y Gabinete 2 verde, medido en los estilos calculados). No dependen del tipo de cita ni del estado (captura 01).
- **Crear [V, manual]:** se crea pulsando o arrastrando sobre un hueco, y profesional y gabinete se preseleccionan según la columna. Mover y redimensionar con arrastre funciona (ya probado en la ronda 1). Si el servidor rechaza un solape con 409, la tarjeta vuelve a su sitio.
- **Fricción:**
  - no hay línea de "ahora" en la semana;
  - los nombres se cortan a unos 10 caracteres;
  - no aparece motivo ni teléfono.

### 1.2 Kanban: cómo mueve recepción al paciente entre estados [P]
- **Columnas:**
  - **Por venir:** muestra "N citas" y "retrasada X min" o "empieza en 9 min".
  - **Sala de espera:** "1 esperando · media 0 min" y "esperando N min" por tarjeta.
  - **En gabinete:** una sub-tarjeta por gabinete con "Libre / Siguiente a las HH:MM" u ocupado con "0/30 min", es decir, el minutero frente a la duración planificada.
  - **Finalizadas.**
  - **No asistió / Cancelada.**

  Encima hay chips de profesionales con un punto de presencia.
- **Cómo se mueve:** con el **menú "Acciones de la cita"** de cada tarjeta, que es arrastrable. Cada transición es un POST de la interfaz con `{to_status, note}`, y el menú cambia según el estado (capturas 02 y 03):

  | Estado actual | Acciones ofrecidas |
  |---|---|
  | Programada | QR de registro · Marcar llegada · Marcar como confirmada · Marcar no asistencia · Cancelar cita |
  | Confirmada | QR de registro · Marcar llegada · Marcar no asistencia · Cancelar cita |
  | En sala de espera | Pasar a gabinete · Cancelar cita |
  | En gabinete | Finalizar cita · Cancelar cita |
  | Completada | (sin menú; la tarjeta deja de ser arrastrable) |

- **Al finalizar** se abre el modal "Acciones tras finalizar la cita: *¿cuándo deberíamos llamarle?*" con **Programar recordatorio**, **Ahora no** y **Cobrar** (captura 04). Engancha el recall y el cobro justo en el momento natural.
- **QR de registro [P parcial]:** un diálogo con el QR, que "caduca 15 minutos después de crearse", y "Copiar enlace de registro". Según el manual [V]:
  - la página pública registra la llegada sin iniciar sesión;
  - desde un enlace de recordatorio exige pulsar un botón, para que los pre-lectores de correo no hagan check-in;
  - solo funciona desde 2 h antes del inicio hasta 1 h después del fin.

  No lo escaneé porque habría cambiado el estado de una cita ajena.
- **El manual menciona un estado "cobrada"** que no vi en la interfaz.
- **Bugs y fricción observados:**
  - Las citas de las 09:00 y 11:30 seguían en "Por venir" con "retrasada 558 min" a las 18:20. No hay paso automático a "no asistió" ni un aviso agrupado.
  - "En gabinete → Gabinete 1: Libre · Siguiente a las 09:00" a las 18:20: la "siguiente" es una cita pasada.
  - "Finalizadas · 1 citas" (fallo de plural), y la tarjeta completada no aparecía en la columna en la captura.
  - Tras completar la cita, la ficha del paciente mostraba "PRÓXIMA CITA: Hoy 18:30" y "ÚLTIMA VISITA: Hoy 18:30" a la vez.
  - La cancelación desde el kanban no pide motivo, igual que en la ronda 1.
  - En el diálogo de la cita hay un botón "Enviar mensaje" (no lo pulsé).

### 1.3 Encontrar un hueco libre rápido
- **Escritorio [P]:** no hay buscador de huecos. Hay que mirar la rejilla. El horario del profesional bloquea **en silencio**: María a las 19:00 no se guardó y no hubo mensaje. Su horario es L–J 09–14 y 16–19, y V 09–14 [P, leído en Ajustes → Horarios de profesionales].
- **Corrección de la ronda 1:** la "plantilla semanal" no está vacía. Los "—" eran campos de hora cuyo valor no se ve como texto. Las vacaciones se cargan como "fechas especiales" (ej. "Summer vacation 2026-08-03 → 2026-08-14").
- **Móvil [P en la ronda 1]:** la agenda se convierte en un buscador de huecos ("Tocar para reservar").
- **Copiloto [P]:** "¿Qué huecos libres hay mañana?" llama a `schedules.find_free_slots` y responde por profesional (ver §5).
- **Desde un plan [P]:** "Programar cita" abre la cita con el paciente y **todos** los tratamientos pendientes del plan ya cargados, con su diente y precio. Se cargan los tratamientos completos aunque falte solo una sesión.

### 1.4 Tipos de cita y colores [P]
- **No existen tipos de cita configurables.** El color va por gabinete.
- El "motivo" es la lista de tratamientos del plan vinculados a la cita. El manual [V] dice que los tratamientos de un presupuesto aún no aceptado llevan la etiqueta "Presupuesto sin aceptar" (reloj de arena) y que se pueden agendar a propósito.
- Sin plan, la cita queda como "Consulta" (así figura en la línea de tiempo) y sin duración por tipo. Las duraciones son fijas: 15/30/45/60/90/120.

### 1.5 Citas recurrentes [P/V]
- **No existen.** El formulario no tiene ninguna opción de repetición y el manual no las menciona.
- Para los controles mensuales de ortodoncia, el módulo `orthodontics` [V] usa "próximo control" y mensualidades, no citas repetidas.

### 1.6 Lista de espera [P/V]
- **No existe** como tal. "Sala de espera" es la columna de pacientes que ya llegaron a la clínica.
- El sustituto es el flujo del copiloto **"Cubrir un hueco"**: tras una cancelación, propone pacientes de la lista de rellamadas, los agenda y registra el intento. Al probarlo falló (§5).
- **Nosotros ya tenemos lista de espera y "recuperar huecos"**, así que aquí llevamos ventaja.

### 1.7 Recall ("volver a citar") [P]
- **Alta**, desde la ficha (acción rápida), desde el modal tras finalizar o desde el plan (botón por tratamiento) (captura 05). La pantalla "Programar recordatorio — Marca al paciente para una llamada futura" pide:
  - **Motivo:** Higiene, Revisión, Revisión ortodoncia, Revisión implante, Postoperatorio, Seguimiento de tratamiento u Otro.
  - **Cuándo:** chips +1m/+3m/+6m/+12m que fijan un **mes objetivo** (+6m desde noviembre da mayo de 2027), o "Elegir día concreto".
  - **Prioridad:** Baja, Normal o Alta.
  - **Nota interna** opcional, con el ejemplo "Revisar empaste 47".

  La petición que envía la interfaz incluye además profesional asignado y tratamiento vinculado (opcionales).
- **Lista de llamadas (/recalls)** (captura 06):
  - **KPIs:** vencen esta semana, atrasados, citados este mes y **conversión** (citas programadas / recalls vencidos del mes).
  - **Filtros:** mes, motivo, estado (por defecto "Pendiente") y prioridad, más el conmutador "Mostrar atrasados". El manual dice que los filtros viajan en la URL.
  - "Exportar CSV".
  - **Cada fila:**
    - nombre, prioridad, motivo, estado, mes y teléfono;
    - la nota;
    - "Llamar" (enlace `tel:`);
    - iconos "No contesta", "Registrar intento" y "Agendar cita";
    - un menú ⋮ con Posponer, Marcar como hecho y Cancelar.
  - **Registrar intento:** canal (Teléfono / WhatsApp / SMS / Email), resultado (No contesta / Buzón de voz / Cita agendada / Rechaza / Número incorrecto) y nota.
  - **Agendar cita** abre la agenda con `patient_id` y `recall_id`. Al guardar, el recall se enlaza y pasa a contactado/programado [V, manual]. Si el paciente tiene un único recall activo, el enlace se hace solo.
  - **Exclusiones [V]:** los pacientes archivados o marcados "no contactar" pasan a la cola "Necesita revisión", sin borrarse.
- **Ajustes → Clínica → Recordatorios [V, solo lectura]** (captura 07):
  - **Intervalos por defecto (meses):** Higiene 6, Revisión 12, Revisión ortodoncia 1, Revisión implante 6, Postoperatorio 1, Seguimiento 3, Otro 3.
  - **Mapa tratamiento → motivo:** Cirugía → Postoperatorio, implantes → Revisión implante, Ortodoncia → Revisión ortodoncia, Preventivo → Higiene.
  - Interruptores "Sugerir recordatorio al completar un tratamiento" y "Vincular cita al recordatorio existente al agendar".
- **Fricción:**
  - el recall en sí no envía mensajes (lo dice el propio manual): solo organiza la cola;
  - con "Mostrar atrasados" activo la lista se quedó en "No hay recordatorios pendientes este mes", lo que confunde;
  - la conversión salía al 100 % con muy pocos datos.

---

## 2. Plan de tratamiento → presupuesto → aceptación → cobro

### 2.1 Bandeja de planes [P]
Es un embudo comercial con pestañas (captura de la ronda 1, más esto):

| Pestaña | Contenido observado |
|---|---|
| **Por presupuestar** | Planes pendientes con presupuesto borrador |
| **Esperando paciente** | Presupuesto enviado ("sent 135.00 €", 27 d en estado) |
| **Sin cita** | Plan activo (presupuesto aceptado) sin ninguna cita |
| **Sin próxima cita** | Plan activo con tratamientos hechos pero sin cita futura |
| **Cerrados** | Con motivo ("Rechazado por paciente") |
| **Listado** | Todos los planes con el filtro "Todos los estados" |

Cada fila muestra: paciente, número, estado, tratamientos hechos/total, presupuesto (estado + importe), **"N d en estado"** y la cita.

**Fallos:**
- los estados del presupuesto aparecen sin traducir y pegados al importe ("draft1210.00 €", "sent135.00 €");
- PLAN-2026-0004 figuraba como "Sin cita" aunque el paciente tenía cita el jueves (la cita no estaba vinculada a tratamientos del plan).

**Estados del plan [V, manual]:** borrador → pendiente → activo → completado. Se cierra con motivo (rechazado, expirado, cancelado, abandono u otro) y se puede reactivar.
- Reactivar devuelve el plan a borrador y, al reconfirmar, genera un presupuesto nuevo.
- Un plan cerrado por rechazo vuelve solo a "en curso" si el paciente acepta una nueva versión.
- Hay un historial de **"contactos"** (toques de recepción) mientras el plan está pendiente.

### 2.2 Tratamientos de varias sesiones [P]
- La "Corona zirconio" (550 €) se desglosa en "1. Toma de medidas 200 €" y "2. Colocación 350 €", con el contador "0/2 sesiones" (captura 08).
- Cada sesión tiene los botones "Marcar sesión realizada" y "Cancelar sesión". El tratamiento tiene "Marcar como completado", "Programar recordatorio" y "Notas del tratamiento".
- **Marcar la sesión** (una petición que respondió 200, **sin confirmación ni deshacer**) dejó el contador en "1/2 sesiones" con la fecha, y **generó un cargo de 200 €**: "Tratamiento realizado · Toma de medidas" en la pestaña Pagos.
- **Reglas [V, manual]:**
  - solo se pueden completar sesiones con el plan "En curso", es decir, con el presupuesto aceptado (antes, la API responde 400);
  - el tratamiento se cierra solo al completar la última sesión;
  - los descuentos aceptados **reescalan** las sesiones pendientes;
  - si se marca el tratamiento entero desde el odontograma, el cargo completo se registra por esa vía y las sesiones pendientes se cancelan, para no cobrar dos veces;
  - cada tratamiento lleva su **propio doctor** (un chip de color, reasignable mientras está pendiente). Al cambiar el doctor del plan se pregunta si reasignar los pendientes.
- **Bugs de cálculo y atribución [P]:**
  - **Informes → Producción por doctor:** apareció "Sin doctor asignado · 1 tratamiento · 200 €". Era mi sesión, aunque el tratamiento tenía asignada a María (MG).
  - En la ficha, **Administración → Facturación** decía "TRABAJO COMPLETADO 0 €, TOTAL PAGADO 0 €", mientras que **Administración → Pagos** decía "Tratamiento ejecutado 200 €, Total pagado 100 €, Adeuda 100 €". Son dos verdades distintas en la misma ficha (captura 15).
  - En los movimientos, el cargo realizado aparece con la etiqueta "Planificado".

### 2.3 Descuentos [P]
Presupuesto suelto PRES-2026-0005 (creado desde "Nuevo presupuesto", que pide paciente, validez, notas para el paciente y notas internas):
- **Línea:**
  - catálogo con buscador (código y precio);
  - cantidad, número de diente y superficies M/O/D/V/L/P/I;
  - tipo de descuento (— / Porcentaje / Absoluto) con su valor y notas;
  - la vista previa "Total línea" en vivo pasó de 60,00 € a 54,00 € con un 10 %.
- **Global:** desde "Editar" (en la propia página): tipo (— / Porcentaje / Absoluto), valor, validez y notas.
- **Cálculo observado [P]:**
  - limpieza 60 € y composite 60 € con -10 % = 54 €, lo que da un neto de 114 €;
  - global de 10 € prorrateado según el neto: **-5,26 €** a la limpieza (60/114·10) y **-4,74 €** al composite (54/114·10);
  - resultado: subtotal 120 €, descuento total -16 €, **total 104 €**;
  - cada línea muestra el precio tachado y el neto, con el desglose "(Descuento global)" (captura 09).
- El manual [V] dice que el IVA se calcula sobre la base ya descontada y que las facturas heredan el descuento prorrateado.
- **Incoherencia de precios [P]:** el mismo "Obturación composite" de 2 superficies costó **60 €** en el presupuesto suelto y **85 €** en el plan creado desde el odontograma. El precio por superficie solo se aplica en el plan, sin explicarlo.
- En un presupuesto vinculado a un plan, las líneas no se añaden ni se quitan en el presupuesto (409), solo en el plan. Sí se puede cambiar precio, descuento e IVA [V].

### 2.4 Envío, versiones y estados [P]
- **Enviar al paciente:** el diálogo ofrece "Enviar por email" o **"Marcar como enviado"** ("se marcará como enviado sin enviar ningún mensaje", para un presupuesto impreso o entregado en mano). Elegí este último: la interfaz registró `send_method: manual` y el presupuesto pasó a "Enviado".
- **Las acciones cambian según el estado:**
  - Borrador: Enviar, Rechazar, Aceptar, Editar, y en "Más acciones" Descargar PDF, Crear nueva versión y Cancelar.
  - Enviado: Compartir enlace, Rechazar, Aceptar.
  - Aceptado: Compartir enlace, Ver firma, Crear factura desde presupuesto y Cobrar.
- **Crear nueva versión [P]:** crea **al instante, sin confirmación**, la v2 (borrador, mismo número PRES-2026-0005, mismas líneas y descuentos).
  - **La v1 sigue "Enviada"** y su enlace público sigue permitiendo "Acepto y firmo".
  - En el listado aparecen dos filas con el mismo número.
  - No vi ninguna pantalla de "historial de versiones", aunque el manual la menciona (captura 13).
- **El manual distingue [V]:**
  - "Renegociar": nueva versión de un presupuesto vivo; exige permiso propio.
  - "Reenviar": nueva versión de uno rechazado, caducado o cancelado; el plan pasa a la nueva.
- **Caducidad [V, ajustes]:** validez por defecto de 30 días (rango 7–180) y **auto-cierre del plan** 30 días después de caducar el presupuesto. Recordatorios automáticos por email a los 7 y 14 días sin respuesta (interruptor).

### 2.5 Firma con hash [P en la ronda 1 / V en el manual]
- La aceptación guarda la firma (quién, email, relación: Paciente, Tutor legal o Representante) y un **PDF firmado con su SHA-256** como sello.
- Hay dos descargas: el PDF sin firmar y el firmado.
- Existe un permiso aparte, "aceptar en clínica", que abre una **firma dibujada en tablet**.
- El acceso al PDF firmado está limitado (10 por minuto por enlace) y se registra cada descarga.

### 2.6 Factura parcial por tratamiento [P, sin emitir]
"Crear desde presupuesto" (captura 14) incluye:
- casillas por línea con "Todos / Ninguno" y "Cantidad a facturar";
- IVA por línea ("Exento 0%");
- la tarjeta de datos de facturación (nombre, NIF y email, con el aviso "Faltan datos" y "Editar datos del paciente");
- plazo de pago (30 días por defecto) y fecha de vencimiento;
- notas públicas e internas, y un resumen.

El resultado es "Crear borrador".

- **Límite importante [P]:** la unidad facturable es la **cantidad de la línea**. Con la sesión de 200 € ya realizada, solo se podía facturar la corona entera (550 €), no la sesión.
- **[V, manual]:** se puede poner un **pagador distinto** (empresa, seguro o familiar). Si el presupuesto está cobrado al 100 %, la factura sale sin vencimiento. Superar la cantidad pendiente se rechaza.

### 2.7 Lo que ve el paciente en el enlace público [P, solo como visitante]
- **"Compartir enlace":** URL `/p/budget/<token>`, botones "Copiar enlace", "Previsualizar" y "Abrir en WhatsApp" (un `wa.me` con el texto ya escrito; no lo pulsé). El aviso dice: "Le pediremos un dato de verificación antes de mostrarle el presupuesto" (captura 10).
- Los textos de la vista pública que cito aquí son mi traducción del árabe en que se mostraron.
- **Pantalla 1 (sin datos personales):** "Verifica tu identidad — para proteger tu información, confirma un dato" con el campo **"Últimos 4 dígitos de tu teléfono"** (teclado numérico) y "Continuar". Según los ajustes, también puede pedir la fecha de nacimiento, y se puede desactivar (captura 11).
- **Pantalla 2 (tras verificar)** (captura 12, en móvil):
  - cabecera con el nombre y la dirección de la clínica, y el número del presupuesto;
  - "Tu presupuesto · tu plan de tratamiento personalizado" y "Válido hasta";
  - el "Mensaje de la clínica" (las notas para el paciente);
  - la lista numerada de tratamientos (diente, "1 × 60,00 €", neto con el original tachado);
  - subtotal, descuento, IVA y total destacado;
  - las insignias "Conexión segura · Datos cifrados · Firma con validez legal";
  - la tarjeta "¿Necesitas ayuda? Contacta con la clínica" (teléfono y email);
  - una barra fija con **"Acepto y firmo"** y "No me interesa" (el rechazo pide motivo, según el manual).
- **Si ya está aceptado:** "Ya aceptaste este presupuesto. La clínica te contactará para agendar tu primera cita" y "Descargar PDF firmado".
- **Trazabilidad [P]:** en la línea de tiempo del paciente apareció **"Presupuesto visto por el paciente"** (se registra solo la primera vez, según el manual). Tras varios intentos fallidos el enlace se bloquea y la clínica lo desbloquea desde el detalle [V].
- **Fricción:**
  - el estado "aceptado" se ve sin verificar;
  - los importes salieron con punto decimal ("60.00 €") en la vista pública y con coma en la interna.

---

## 3. Documentos y recetas
- **En la demo [P]:** los módulos `documents`, `prescriptions`, `medication_catalog` y `medical_reference` **no están instalados**.
  - La acción rápida "Documento" de la ficha solo abre **Galería → Añadir foto** (Intraoral, Extraoral, Radiografía, Antes/Después, Otra).
  - Administración → Documentos es un repositorio de archivos subidos ("Subir primer documento").
  - Sí existe Ajustes → Facturación → **Membrete de documentos** (nombre, dirección, teléfono, email, número de colegiado o registro, logotipo).
- **Según el manual [V]:**
  - **Documentos:** 4 tipos con campos propios, cada uno con ciclo borrador → generado → archivado:
    - receta: medicamentos con dosis, frecuencia y duración;
    - certificado médico: diagnóstico, descripción y periodo de validez;
    - carta de derivación: profesional de destino, especialidad y resumen;
    - solicitud de radiología: examen, región y pregunta clínica.

    El PDF lleva el membrete. El documento generado sale en la línea de tiempo. Archivar es un borrado lógico.
  - **Recetas:**
    - borrador con líneas libres o desde plantillas favoritas, con campo de vía;
    - **"Emitir" congela** la receta con una instantánea del prescriptor (nombre y matrícula);
    - las correcciones son "anular + reemitir", nunca edición;
    - emitir y anular piden confirmación;
    - si falta la matrícula hay un aviso, no un bloqueo;
    - el **aviso de alergias e interacciones** avisa sin bloquear;
    - el PDF marca BORRADOR o CANCELADA;
    - no hay envío por email en la v1.
  - **Catálogo de medicamentos:**
    - nombre, dosis, unidad, forma y "requiere receta";
    - un conjunto inicial de 56 medicamentos dentales que se carga sin duplicar;
    - nombres únicos sin distinguir mayúsculas;
    - los inactivos se mantienen para el historial.
  - **`medical_reference`:** listas gestionadas de alergias, medicación, enfermedades y cirugías, con avisos de contraindicación.
- **Consentimientos:** no hay plantillas de consentimiento informado clínico en la demo. Solo el módulo `gdpr` (no instalado: consentimientos, derechos y brechas). **Aquí nosotros ya estamos por delante** (consentimientos versionados y firmados).

## 4. Informes [P]
Hay 5 pantallas: Dashboard, Facturación, Presupuestos, Agenda y Cobros.

| Informe | Contenido (además de lo visto en la ronda 1) | Filtros |
|---|---|---|
| Dashboard | Caja cobrada, saldo a favor, producción (2695 €, 23 tratamientos), ticket medio, cobros por día, por forma de pago (clicables), producción por doctor, pacientes nuevos (12, 60 %), no-show, cuentas por cobrar por tramo | Periodo: Hoy, Últimos 7 días, Últimos 30 días, Este mes, Trimestre, Año, Desde/Hasta |
| Facturación | Facturado, cobrado, pendiente, vencidas (con días de retraso), por método, desglose de IVA, por profesional, antigüedad (no vencidas, 0-30, 31-60, 61-90, 90+), emitido por mes | Este mes, Este trimestre, Este año, Mes anterior, Trimestre anterior, Año anterior, Rango personalizado |
| Presupuestos | Creados, aceptados, tasa de aceptación, valor medio, por estado, **tasa de aceptación por profesional**, tratamientos más presupuestados (apariciones, cantidad, total) | Igual |
| Agenda | Total de citas, % completado, no-shows, primeras visitas. Tres pestañas: **Resumen** (horas trabajadas por profesional, ocupación por gabinete, por día de la semana); **Actividad** (embudo de estados); **Calidad** (ver abajo) | Periodo, Gabinete, Profesional |
| Cobros | Neto, devoluciones, saldo a favor, tasa de devoluciones, evolución por día/semana/mes, por método, por profesional, antigüedad | Fechas |

- **Calidad (captura 16):**
  - **tiempo de espera** de la llegada al gabinete: media, mediana, P90 y tramos 0-5, 5-10, 10-20 y 20+ min;
  - **puntualidad del paciente**: diferencia entre la hora agendada y la llegada real; temprano < -5, puntual ±5, tarde 5-15, tarde > 15;
  - **duración planificada frente a real**: sobrepaso medio y citas pasadas o por debajo del tiempo.

  Mi cita de prueba aportó 1 muestra: espera de 0,4 min, llegada 8,3 min antes y -98,8 % de duración.
- **Exportación:** **ningún informe tiene botón de exportar** (ni CSV ni Excel ni PDF). Solo la lista de recalls exporta CSV.
- **Fallos:**
  - El informe de Cobros volvió a mostrar "No se pudo cargar el informe de cobros · Reintentar" junto a datos que sí cargaron.
  - "Por profesional" en Cobros dice "Tratamiento ejecutado, no cobrado", pero muestra la producción total.
  - En Facturación, la producción va a quien emite la factura (la recepcionista).
  - Hay estados sin traducir ("sent").
  - Los porcentajes salen con punto ("87.5%").

## 5. Copiloto IA [P]
Panel lateral con las pestañas "Pendientes" (tarjetas proactivas) y "Chat", y chips de flujos. Cada llamada a una herramienta se muestra como una tarjeta plegable ("agenda.get_day_overview completado") con los datos devueltos.

| # | Pregunta | ¿Datos reales? | Calidad y observaciones |
|---|---|---|---|
| 1 | "¿Qué huecos libres hay mañana?" | Sí: `agenda.list_professionals` + 2 × `schedules.find_free_slots` | Respuesta final correcta para María (09:00–09:45, 10:45–12:00, 12:45–14:00, 16:00–19:00), comprobado contra la agenda. Pero **las tarjetas de la herramienta muestran las horas en UTC** (08:00–08:45…) e incluyen franjas que la respuesta omite: Carlos 16:15–19:00 no aparece y la respuesta dice "09:00–14:00". Imposible de auditar para recepción. |
| 2 | "¿Qué presupuestos llevan más de 7 días sin respuesta?" | Sí: `budget.list_budgets` | **Honesta:** dijo que solo veía la fecha de creación y no la de envío, así que no podía confirmar los 7 días, y listó los 2 "enviados". La tarjeta muestra IDs internos (UUID) y **"Total 2,00 €"**: el número de resultados formateado como dinero. |
| 3 | "Resume la agenda de hoy" | Sí: `agenda.get_day_overview` + `recalls.list_due_recalls` + `budget.list_budgets` | Útil por estructura (citas, rellamadas vencidas, presupuestos sin respuesta), pero **las horas están mal**: "08:00–08:30 Rosa", "10:30 Javier" y "17:30 Prueba", cuando la agenda y el inicio dicen 09:00, 11:30 y 18:30 (captura 17). Además, los estados salen sin traducir ("scheduled", "contacted_no_answer"). |
| 4 | "Busca al paciente Prueba" | Sí: `patients.search_patients` | Correcta: 2 coincidencias con ID, teléfono y email, y tarjetas "Ver ficha". No señaló que fueran duplicados probables. |
| 5 | "Agenda una cita para … con Carlos López, 16:00, 30 min" (sin confirmar después) | Sí (búsqueda y profesionales) | Detectó el teléfono duplicado (bien) pero **no reconoció a "Carlos López Martínez"** aunque lo acababa de listar, ni siquiera cuando le di el nombre exacto y el ID del paciente. Nunca llegó a proponer la reserva. **Hipótesis:** la "anonimización de datos (PHI)" activada sustituye los nombres antes de que el modelo los vea, y por eso no puede emparejar nombres. |
| 6 | Tarjeta proactiva "Se canceló la cita de las 10:15 — se ha liberado un hueco · Revisar" | — | Envió por sí sola "Busca pacientes de rellamada que puedan ocupar ese hueco" y **propuso "La IA quiere cancelar una cita · Cita 00000000-0000-0000-0000-000000000000 · Esta acción no se puede deshacer · Cancelar / Confirmar"** (captura 18). La acción es errónea y el ID es nulo. **No confirmé.** |

- **Confirmación de escrituras:**
  - [P] existe una tarjeta "Confirmar acción" con el aviso en rojo para lo irreversible;
  - [V, manual] "toda acción que modifica datos (crear, mover, cancelar, cobrar, enviar) se detiene y muestra una tarjeta de confirmación";
  - el copiloto "nunca hace nada que tu usuario no pueda hacer".

  El mecanismo protege, pero en el caso 6 dejó a un clic una acción absurda.
- **Valoración:** las lecturas son buenas y rápidas, con datos reales. Pero la zona horaria, el emparejamiento de nombres y el flujo proactivo fallan. La nota baja de 8 (ronda 1) a **5/10**.

## 6. Configuración de recalls y recordatorios (solo lectura) [V]
- **Recordatorios (recalls):** ver §1.7: intervalos por motivo, mapa de categorías y 2 interruptores.
- **Notificaciones** (ronda 1): matriz de 9 tipos de mensaje × automático/manual.
  - El **recordatorio de revisión** es uno de esos tipos.
  - Para que el recall envíe mensajes hace falta el módulo `recall_reminders` (no instalado), que "avisa al paciente cuando se crea un recall".
- **Presupuestos:** recordatorios automáticos a los 7 y 14 días (solo email); caducidad de 30 días y auto-cierre del plan a los 30 días; enlace público con verificación (desactivable, "asume el riesgo si el link se reenvía").
- **Idioma de comunicaciones:** se fija por clínica para la vista pública, los emails y WhatsApp, y es independiente del idioma de cada usuario. En la demo estaba en árabe.
- **Preferencias por paciente** (ficha): canales (Email, WhatsApp, SMS), tipos de mensaje y baja por canal ("bloquea ese canal incluso en envíos forzosos").

## 7. Módulos disponibles [P en el listado, V en lo que dicen hacer]
El listado tiene 3 páginas, unos 60 módulos marcados "Oficial" o "Comunidad", v0.x, con dependencias. Las descripciones están en inglés. Lo relevante que **nosotros no tenemos**:

| Módulo (estado en la demo) | Qué dice hacer |
|---|---|
| `leads` (no inst.) | Recoge las consultas del formulario web (con clave y límite diario) o las que apunta recepción a mano. Si el teléfono o email ya es de un paciente, **no crea un lead sino un recall** con el texto de la consulta. Estados: Nueva, Contactada, Convertida, Descartada (nunca se borran). Muestra una tira semanal de **disponibilidad para llamar** (mañana, tarde o noche). El panel de conversión precarga la ficha y avisa si hay un teléfono duplicado, sin bloquear porque hay familias que lo comparten. |
| `lab_orders` + `contacts` (no inst.) | Trabajos de laboratorio por paciente: laboratorio (contacto de tipo lab), tipo (corona, puente, prótesis, implante, carilla, ortodoncia, reparación, otro), diente o referencia, tipo de impresión, antagonista, **color Vita Classical**, fecha de envío y de retorno esperada, y notas. Estados desde "Enviado" hasta "Recibido". |
| `inventory` (no inst.) | Artículos con stock actual y mínimo, alerta de stock bajo, ajustes rápidos +/-, registro de movimientos y costes. |
| `treatment_consumables` | Tratamiento del catálogo → artículos y cantidades, con **descuento automático** al registrar la realización. |
| `suppliers`, `supplier_items`, `purchase_orders`, `inventory_reorder`, `supplier_ratings` | Proveedores, artículos por proveedor con SKU y precio, pedidos con recepción y control de calidad y PDF, **sugerencias de reposición según el consumo de 90 días y el plazo del proveedor**, valoraciones automáticas más una nota manual del 1 al 5. |
| `staff_tasks` (no inst.) | Tablero de relevos internos: "llamar al paciente X", "preparar kit". Estados Abierta → Reclamada → Hecha / Cancelada. |
| `staff_attendance` | Fichaje de entrada y salida, estado actual e informe diario. |
| `payroll` | Perfiles con datos bancarios y fiscales cifrados (enmascarados), periodos AAAA-MM borrador → cerrado → pagado (cerrado bloquea), apuntes bruto, deducciones y neto validados, informes mensuales y anuales. No calcula impuestos. |
| `expenses` | Gastos fijos y recurrentes por categoría (alquiler, suministros, salarios…), total mensual, importación CSV con prueba previa. Solo admin. |
| `treasury` | Cuentas de caja y banco, transferencias entre ellas y correcciones manuales. |
| `telephony` | CTI: aviso en pantalla de la llamada entrante y registro de llamadas, alimentado por una centralita o plataforma mediante un webhook firmado. |
| `patient_segments` | Etiquetas de paciente propias de cada clínica para agrupar y hacer campañas. |
| `patient_relationships` | Relaciones familiares entre pacientes. |
| `activity_journal` | Diario del personal, acumulativo e inmutable: cada evento (cita, presupuesto, factura, pago, recall, laboratorio…) con autor, paciente y datos. Filtros por tipo y fechas. Solo admin. |
| `orthodontics` | Expediente de ortodoncia: controles por visita (arcos, procedimientos), fotos de evolución, próximo control, **mensualidades con un único presupuesto** (cuota inicial + N meses). |
| `periodontogram`, `imaging_viewer` (DICOM), `imaging_ai` | Periodontograma SEPA; visor DICOM; segmentación por IA bajo demanda. |
| `documents`, `prescriptions`, `medication_catalog`, `medical_reference` | Ver §3. |
| `integrations`, `whatsapp_kapso`, `whatsapp_webhook`, `sms_gateway`, `recall_reminders`, `payment_gateways` | Webhooks REST, canales de mensajería, pasarela de pago neutral respecto al proveedor. |
| `migration_import` | Importa pacientes, citas, presupuestos, pagos y documentos desde un paquete generado por su herramienta de migración. |
| Fiscales por país | `verifactu` (ES), `sdi_it` y `sistema_ts` (IT), `nav_online` (HU), `india_gst`, `razorpay`. Nada para Bolivia (SIAT). |

## 8. Línea de tiempo del paciente (pestaña Actividad) [P]
- **Filtros:** Todas, Visitas, Tratamientos, Notas clínicas, Financiero, Historial médico, Documentos y Comunicaciones. Hay un contador ("9 entradas") y "Fin del historial". También hay una barra inferior fija con Cita, Cobrar y Nota (captura 20).
- **Eventos vistos:**
  - cita programada, confirmada, "Paciente llegó a la clínica", "Paciente en gabinete", completada y cancelada;
  - presupuesto enviado (con el total y "Vía manual"), **presupuesto visto por el paciente** y presupuesto aceptado;
  - "Email fallido: appointment_confirmation", con el error técnico en inglés.
- **Problemas:**
  - **Horas en UTC y mezcladas:** cada evento muestra la fecha del evento ("Hoy") con la hora de inicio de la cita en UTC. Una cita del jueves a las 10:00 aparece como "Hoy · 09:00", y mi cita de las 18:30 como "Hoy · 17:30".
  - **Faltan eventos financieros:** la sesión realizada (cargo de 200 €) y el cobro de 100 € no aparecen. "Financiero" solo mostraba "Presupuesto aceptado".
  - **Ruido:** 15 entradas idénticas de "Email fallido" en otro paciente, sin agrupar.
  - Todas las citas se llaman "Consulta" (no hay tipo de cita).

## 9. Otras cosas valiosas que no tenemos
1. **Panel "Por confirmar mañana"** en el inicio, y KPIs de la semana frente a la anterior (ronda 1). Un buen inicio para recepción.
2. **Modal tras finalizar la cita** que encadena el recall y el cobro. Es un patrón de "siguiente paso" en el momento justo.
3. **Métricas de calidad operativa** (espera, puntualidad, sobrepaso) derivadas solo de las marcas de tiempo de los estados.
4. **Embudo de planes con "días en estado"** y pestañas accionables (esperando paciente, sin cita, sin próxima cita).
5. **"Marcar como enviado" sin mensaje**, para el presupuesto impreso o entregado en mano, que es habitual en Bolivia.
6. **Check-in con QR** y ventana horaria válida.
7. **Tarjetas proactivas de IA**, como "se ha liberado un hueco". La idea es buena; la ejecución falló.
8. **Preferencias de comunicación por paciente**, por canal y por tipo de mensaje.

---

## Requisitos sugeridos para nuestra plataforma

Son requisitos propios, redactados para nuestra clínica de 5 sucursales en Bolivia (Bs, zona horaria America/La_Paz, WhatsApp como canal principal, sin SIAT por ahora). Se marcan los que extienden algo que ya tenemos (v0.2: agenda sin solapes con búsqueda de huecos, lista de espera, sala de espera, presupuestos con cuotas, consentimientos, asistente con propuestas).

### P1: necesarios en el primer trimestre del piloto

| ID | Requisito | Criterio de aceptación |
|---|---|---|
| R2-01 | **Marcas de tiempo por estado de cita** (confirmada, llegó, en sillón, atendida) guardadas en una tabla de transiciones con usuario y sucursal; solo se ofrecen las transiciones válidas | Cada cambio crea una fila inmutable; la interfaz muestra solo las acciones permitidas para el estado actual; prueba de la máquina de estados |
| R2-02 | **Informe de calidad operativa por sucursal**: espera (llegada→sillón: media, mediana, P90), puntualidad del paciente y duración real frente a la planificada por profesional y prestación | Los valores cuadran con un conjunto de citas de prueba; filtros de sucursal, profesional y periodo; exportación a Excel |
| R2-03 | **Citas vencidas sin cerrar:** al final del día, lista de citas pasadas aún "programadas" o "confirmadas" con resolución en un clic (no asistió / atendida / reprogramar); nunca automática sin revisión | La sala de espera no muestra "retrasada 500 min"; la lista aparece en el inicio a partir de la hora de cierre de la sucursal |
| R2-04 | **Paso siguiente al atender:** al marcar "atendida" se propone cobrar el saldo del día y programar el control según la prestación realizada (con el intervalo ya calculado) | Se ofrece en todos los cierres de cita; "Ahora no" queda registrado; prueba e2e |
| R2-05 | **Cola de controles ("volver a citar")**, con motivo, mes objetivo y prioridad, separada de los recordatorios de cita. Lista mensual por sucursal con contadores (vencen esta semana, atrasados, agendados, conversión) | La conversión se define como agendados / vencidos del mes; filtros en la URL; exportación a Excel |
| R2-06 | **Registro de intentos de contacto** (canal: llamada, WhatsApp manual o SMS; resultado: no contesta, buzón, agendó, rechaza, número errado; nota) con historial por paciente | 3 intentos sin éxito pasan a "revisar"; los pacientes con "no contactar" o archivados salen solos de la cola |
| R2-07 | **Intervalos por prestación**: cada prestación del catálogo define si genera un control y a cuántos meses (limpieza 6, implante 6, ortodoncia 1…), con la opción de proponerlo al completarla | Al completar una prestación con intervalo aparece la sugerencia; editable por el administrador de la clínica |
| R2-08 | **Enlace automático cita↔control:** al agendar a un paciente con un único control pendiente compatible, se vincula y pasa a "agendado"; al atender la cita, a "hecho" | Con 2 o más controles candidatos se pide elegir; prueba de integración |
| R2-09 | **Prestaciones de varias sesiones**: la prestación del catálogo puede tener una plantilla de sesiones con nombre e importe; el cargo se genera por sesión realizada y el tratamiento se cierra con la última | La suma de las sesiones es igual al precio neto de la línea (incluido el descuento); realizarla desde el odontograma no cobra dos veces; la sesión conserva el profesional asignado para la producción y la comisión |
| R2-10 | **Atribución de producción** siempre al profesional del tratamiento o la sesión, nunca a quien registra o factura | Ningún cargo queda "sin profesional" si el tratamiento lo tiene; prueba contra el informe de producción y comisiones |
| R2-11 | **Un solo saldo del paciente**: presupuestado, realizado, cobrado, a cuenta y deuda calculados por una única función y mostrados igual en todas las pestañas | Prueba que compara los valores de todas las vistas de la ficha con el informe de cuentas por cobrar |
| R2-12 | **Descuento por línea (% o monto) y descuento global prorrateado según el neto**, con redondeo a 2 decimales cuyo residuo va a la última línea, y precio original tachado en el PDF | Caso de prueba: 60 + (60 − 10 %) con 10 Bs de descuento global da 104,00 exacto, con un reparto de 5,26 y 4,74 |
| R2-13 | **Versiones de presupuesto**: crear una nueva versión pide confirmación y **reemplaza** la anterior; la versión anterior deja de poder aceptarse y su enlace muestra "hay una versión más reciente" | Con 2 versiones del mismo número, solo una se puede aceptar; historial de versiones visible con las diferencias de líneas y totales |
| R2-14 | **Entrega del presupuesto sin mensaje** ("entregado impreso/en mano") además del envío por WhatsApp; ambos dejan registro de canal, fecha y usuario | El estado "entregado" no requiere email; el evento aparece en la línea de tiempo |
| R2-15 | **Enlace público del presupuesto** con token de un solo presupuesto, verificación (últimos 4 dígitos del celular o fecha de nacimiento), bloqueo tras N intentos, ningún dato antes de verificar (ni siquiera el estado), aceptar con nombre y relación (paciente, tutor, representante), rechazar con motivo | Se registra "visto" la primera vez; el PDF aceptado lleva su hash SHA-256 guardado; prueba de que sin verificar no se filtra ni el importe ni el estado |
| R2-16 | **Embudo de presupuestos y planes** con "días en este estado" y bandejas: entregado sin respuesta, aceptado sin cita, en curso sin próxima cita; caducidad configurable y seguimiento a los 7 y 14 días como tarea de recepción (no como envío automático) | Las bandejas cuadran con los estados; la caducidad es configurable por clínica |
| R2-17 | **Zona horaria única y explícita**: toda hora que se muestra (agenda, línea de tiempo, asistente, informes) se convierte a la zona de la sucursal; la línea de tiempo muestra la hora del evento y, aparte, la hora de la cita | Prueba que crea una cita a las 09:00 en La Paz y verifica 09:00 en la agenda, la ficha, el asistente y la exportación |
| R2-18 | **Línea de tiempo del paciente** que incluya cargos, pagos, anulaciones, sesiones, documentos firmados, cambios de estado de cita y contactos; con filtros por tipo y agrupación de eventos repetidos | Cada operación de billing y agenda genera su evento; los errores técnicos se muestran en español y para el usuario |
| R2-19 | **Tipos de cita configurables** (primera vez, control, urgencia, ortodoncia, cirugía…) con color, duración por defecto y prestación sugerida; el color de la agenda se puede elegir por tipo, profesional o sillón | El formulario precarga la duración del tipo; leyenda de colores visible; filtros por tipo |
| R2-20 | **Guardas del asistente**: ninguna escritura sin una tarjeta de confirmación que muestre los datos legibles (paciente, fecha y hora locales, profesional); el servidor rechaza IDs nulos o inexistentes antes de proponer; las horas siempre van en la zona local | Prueba: una propuesta con un ID inexistente no llega a mostrarse; las respuestas de agenda coinciden con la agenda |
| R2-21 | **Solicitudes entrantes (leads)**: alta manual o desde el formulario web/WhatsApp, con disponibilidad para llamar (días y franja); si el celular ya es de un paciente, se crea un contacto pendiente en su ficha en vez de un lead; conversión a paciente con aviso de duplicado | Una solicitud se convierte una sola vez; los descartes se conservan; límite diario anti-spam en el formulario público |

### P2: hacen el producto comercializable

| ID | Requisito | Criterio de aceptación |
|---|---|---|
| R2-30 | **Citas recurrentes** (cada N semanas o meses, hasta una fecha o N veces), sobre todo para ortodoncia y controles, con verificación de disponibilidad de cada ocurrencia y lista de conflictos antes de guardar | Ninguna ocurrencia se guarda con solape; editar "esta o todas las siguientes" |
| R2-31 | **Check-in del paciente con QR** en el mostrador de cada sucursal, válido solo en una ventana alrededor de la cita, sin datos personales en la página | El escaneo fuera de la ventana muestra la hora de la cita; reescanear es idempotente |
| R2-32 | **Facturación parcial por sesión o cantidad** desde el presupuesto aceptado, con pagador distinto (empresa, seguro, familiar), preparada para el futuro SIAT | No se puede facturar más de lo pendiente; las líneas guardan una copia del precio y del descuento |
| R2-33 | **Firma dibujada en tableta** para aceptar el presupuesto y el consentimiento en el sillón, con un permiso propio | Se guarda la imagen de la firma y el hash del PDF resultante |
| R2-34 | **Pedidos a laboratorio** vinculados al paciente y al tratamiento: laboratorio, tipo de trabajo, pieza, color (guía Vita), impresión, fechas de envío y de retorno, costo; estados enviado → en proceso → recibido → instalado; alerta de retraso; el costo alimenta la rentabilidad | La cita de colocación no se agenda antes de la fecha de retorno sin un aviso |
| R2-35 | **Inventario por sucursal** con consumo por prestación, mínimos y reposición sugerida por consumo; transferencias entre sucursales (ya está en el backlog como B-013: añadir la sugerencia de reposición y las valoraciones de proveedor) | El consumo se descuenta al realizar la prestación; las alertas aparecen por sucursal |
| R2-36 | **Tablero de tareas internas** (relevos entre recepción, asistentes y doctores) con estados abierta → tomada → hecha, que se puede vincular a un paciente o a una cita | Se asigna por rol o persona; las vencidas se ven en el inicio |
| R2-37 | **Diario de actividad del personal** consultable por el administrador (quién hizo qué y cuándo), por encima de nuestra auditoría técnica; filtros por usuario, tipo y fechas | Inmutable; exportable; no se puede borrar |
| R2-38 | **Etiquetas y segmentos de pacientes** (por ejemplo "ortodoncia activa", "empresa X", "VIP") para filtrar listas y campañas manuales por WhatsApp con consentimiento | Los segmentos se calculan por filtros guardados; se respeta la baja por canal |
| R2-39 | **Relaciones familiares** (tutor, hijo, cónyuge) para compartir el celular sin falsos duplicados y aceptar presupuestos como tutor | El aviso de duplicado distingue "mismo celular, familiar declarado" |
| R2-40 | **Recetas, certificados y derivaciones en PDF** con membrete de la sucursal y matrícula; emitir congela el documento y corregir es anular y reemitir; catálogo de medicamentos con aviso de alergias (no bloqueante). Amplía B-016 | El documento emitido no se puede editar; aparece en la línea de tiempo |
| R2-41 | **Fichaje del personal por sucursal** y gastos fijos por categoría, como base de una rentabilidad por sillón (B-033) | Informe mensual por sucursal: producción − gastos − costo de laboratorio |
| R2-42 | **Telefonía básica:** botón de llamar y registro de la llamada en la ficha; más adelante, aviso de llamada entrante si la central lo permite | La llamada se registra con resultado y duración manual |
| R2-43 | **Exportación de todos los informes** (Excel), con los mismos filtros que la pantalla | Cada informe tiene su botón de exportar; los totales coinciden con la pantalla |
| R2-44 | **Tarjetas proactivas** en el inicio ("se liberó un hueco a las 10:15 → candidatos de la lista de espera y de controles"), con la acción final siempre confirmada por una persona | La propuesta usa nuestra lista de espera; nunca propone cancelar como reacción a un hueco |

---

## Índice de capturas (`capturas/`)

| Archivo | Contenido |
|---|---|
| dentalpin2-01-agenda-semana-colores-gabinete.jpg | Semana: el color va por gabinete; iconos de estado; pausa y fin de semana sombreados |
| dentalpin2-02-kanban-menu-acciones.jpg | Kanban: menú "Acciones de la cita" (QR, llegada, confirmar, no asistencia, cancelar) |
| dentalpin2-03-kanban-en-gabinete.jpg | Paciente "En gabinete" con el minutero 0/30 min y el otro gabinete libre |
| dentalpin2-04-modal-tras-finalizar.jpg | "Acciones tras finalizar la cita": Programar recordatorio / Ahora no / Cobrar |
| dentalpin2-05-recall-formulario.jpg | Programar recordatorio: motivo, +1/3/6/12 meses, prioridad, nota |
| dentalpin2-06-lista-llamadas.jpg | Lista de llamadas con KPIs, filtros y acciones por fila |
| dentalpin2-07-ajustes-recalls.jpg | Intervalos por motivo, mapa tratamiento → motivo e interruptores |
| dentalpin2-08-plan-sesiones.jpg | Plan con la corona en 2 sesiones; 1/2 realizada |
| dentalpin2-09-presupuesto-descuentos.jpg | Descuento de línea (-10 %) y global prorrateado (-5,26 / -4,74); total 104 € |
| dentalpin2-10-compartir-enlace.jpg | "Enlace para el paciente": copiar, previsualizar, abrir en WhatsApp |
| dentalpin2-11-publico-verificacion.jpg | Vista pública (móvil): verificación con los 4 últimos dígitos del teléfono (en árabe por un ajuste de otro visitante) |
| dentalpin2-12-publico-presupuesto.jpg | Vista pública tras verificar: líneas netas, totales, Acepto y firmo / No me interesa |
| dentalpin2-13-presupuesto-v2.jpg | v2 creada al instante; la v1 sigue "Enviada" |
| dentalpin2-14-factura-parcial.jpg | Factura desde presupuesto: selección por línea y cantidad, datos fiscales, plazo |
| dentalpin2-15-paciente-pagos.jpg | Pagos del paciente: ejecutado 200 €, pagado 100 €, adeuda 100 € |
| dentalpin2-16-informe-agenda-calidad.jpg | Informe de agenda → Calidad: espera, puntualidad, duración real |
| dentalpin2-17-copilot-agenda-hoy.jpg | El copiloto da 08:00 y 10:30, mientras el inicio muestra 09:00 y 11:30 |
| dentalpin2-18-copilot-confirmacion-erronea.jpg | La tarjeta proactiva lleva a "cancelar cita 0000…" con confirmación en rojo (no confirmada) |
| dentalpin2-19-modulos.jpg | Catálogo de módulos, página 2 |
| dentalpin2-20-timeline-paciente.jpg | Actividad del paciente: llegada, en gabinete, presupuesto visto, horas en UTC |
