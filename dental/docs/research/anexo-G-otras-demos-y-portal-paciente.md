# Ronda 2: demos adicionales sin registro

**Fecha de exploración:** 2026-11-10
**Complementa a:** `INVESTIGACION_COMPETIDORES.md` §3 y §4 (DentalPin, Panel Dental, Odonto.ar, Dentrisoft)
**Capturas:** `capturas/` (19 nuevas, con los prefijos `boliviadental-`, `opendental-`, `mydentalpms-`, `agendapro-` y `doctoralia-`)

---

## 1. Resumen ejecutivo

- **Productos explorados a fondo:** 5 productos, con 6 superficies probadas:
  1. boliviadental.com: demostración interactiva de la página principal.
  2. Open Dental: Web Sched para paciente nuevo, Web Sched para paciente existente, y portal del paciente. Son demos oficiales con datos ficticios.
  3. MyDentalPMS: demo en vivo del panel y formulario de ingreso del paciente.
  4. AgendaPro: reserva pública de una clínica real, probada en el celular hasta el paso de datos.
  5. Doctoralia México: reserva pública de una dentista real, probada en el celular hasta la autenticación.
- **Hallazgo principal sobre boliviadental:** su "demostración interactiva" **no es una demo del software**. Es un widget de marketing dentro de la página principal:
  - La dirección `https://boliviadental.com/app/demo` que muestra es una barra de navegador simulada. La URL real pide inicio de sesión.
  - El odontograma tiene errores: todas las piezas se llaman "Primer Molar Sup.", el estado no se guarda por pieza y el presupuesto no cambia.
  - El QR es un dibujo decorativo, no un código escaneable.
  - El botón "Probar Envío Real" de WhatsApp abre un chat con el **número de ventas del proveedor**, no con el del paciente, y daña el emoji del mensaje.
  - Conclusión: en Bolivia, su ventaja hoy es el discurso comercial (Bs, QR Simple, COB), no la ejecución que se puede ver.
- **Mejor referencia del lado del paciente:** Open Dental Web Sched para **paciente existente**, en su versión nueva y adaptable al celular. El flujo es:
  1. Datos del paciente.
  2. Código de un solo uso (OTP) por SMS o correo.
  3. Confirmación del seguro.
  4. Motivo.
  5. Profesional y horario.
  6. **Pantalla de revisión.**
  7. Confirmación.
  El patrón (verificar identidad, revisar y confirmar) sirve para nuestro portal. A su confirmación le falta: agregar al calendario, dirección o mapa, y los enlaces para reprogramar o cancelar.
- **Patrones de reserva en LATAM (AgendaPro y Doctoralia):**
  - Hoja inferior en el celular, con foto del profesional, tira de días y total fijo abajo.
  - **Pago anticipado** ("Pagar y agendar").
  - En Doctoralia, una **cuenta obligatoria** para reservar (correo, Google o Apple).
  - Ninguno muestra QR boliviano. El pago con QR Simple sigue siendo un espacio libre para nosotros.
- **Errores comunes del lado del paciente que debemos evitar:**
  - Páginas que no se adaptan al celular: el Web Sched antiguo y el portal de Open Dental se ven a 980 px.
  - Validación con modales, de a un error por vez.
  - Horarios que no existen ("00:00" en Doctoralia) o días pasados reservables (demo de paciente nuevo de Open Dental).
  - Barra de progreso que retrocede (Doctoralia: 15 % y luego 0 %).
  - Saldo confuso en el portal.
  - Avisos de urgencia ("las horas podrían agotarse").

---

## 2. Método y reglas aplicadas

- **Navegador:** Chromium (Playwright) en dos tamaños:
  - Celular: 390×844, táctil.
  - Escritorio: 1366×850.
- **Datos ingresados:** solo datos ficticios ("Demo Ficticio", demo@example.com, 555-0100), y solo en demos marcadas explícitamente como demo (`DEMO=Y` de Open Dental y "live demo" de MyDentalPMS).
- **Formularios reales:** en AgendaPro y Doctoralia, que son negocios reales, **no se escribió ningún dato y nos detuvimos** en la pantalla de datos o de autenticación.
- **Formulario de MyDentalPMS:** se recorrió hasta el último paso y **no se pulsó** "Submit Registration".
- **Lo que no se hizo:** crear cuentas, pagar, aceptar términos, saltar el CAPTCHA, adivinar enlaces privados (por ejemplo, el `odentiva.app/p/a1b2c3` del material de Odentiva), inspeccionar seguridad ni copiar código o recursos.
- **Mensajes de WhatsApp:** el enlace de boliviadental solo se abrió para leer la URL de destino. La pestaña se cerró sin enviar nada.

---

## 3. Productos y nivel de acceso

| # | Producto | País o mercado | Nivel de acceso real | Qué se pudo hacer |
|---|---|---|---|---|
| 1 | **boliviadental.com** | Bolivia | Widget de marketing en la página principal; `/app/demo` pide inicio de sesión | Probadas las 3 pestañas del widget (odontograma, WhatsApp, QR), las preguntas frecuentes, los precios y la vista en celular |
| 2 | **Open Dental: Web Sched** | EE. UU. | **Demos públicas oficiales** con datos ficticios (`DEMO=Y`, clínica "Westside Chompers") | Probados los flujos de paciente nuevo y existente hasta "Appointment Booked"; los de recordatorio (*recall*) y ASAP solo en parte |
| 3 | **Open Dental: portal del paciente** | EE. UU. | **Credenciales demo publicadas** por el proveedor (usuario `demo`, cualquier clave) | Probadas 7 pestañas, el botón de pago (bloqueado en la demo) y la vista en celular |
| 4 | **MyDentalPMS** | EE. UU. (beta, "Early Access 2026") | **Demo en vivo sin inicio de sesión** | Probados los 9 módulos de navegación, la reserva rápida, los recordatorios, el formulario de ingreso de 5 pasos y la vista en celular |
| 5 | **AgendaPro** (marketplace) | Chile / LATAM | Página pública de reservas de un negocio real | Probado en el celular hasta "Tus datos / Pagar y agendar", sin enviar |
| 6 | **Doctoralia** | México / LATAM | Directorio público con reserva | Probado en el celular hasta "Continuar con tu correo", sin enviar |
| — | Odentiva | Multiclínica (español e inglés) | "Ver demo" lleva a capturas; el micrositio demo `odentiva.app/@clinica-demo` responde "Sitio no disponible" | Solo información pública (ver §4.7) |
| — | iDentSoft (CodeCanyon) | Global | El vendedor publica una demo con credenciales | **No accesible**: `ERR_TUNNEL_CONNECTION_FAILED` desde nuestro entorno |
| — | Módulos dentales de Odoo (`c_dental_clinic`, `pragtech_dental_management`, `dzental`) | Global | "Live Preview" lleva a un formulario comercial (genera contacto) | No probado: requería dejar datos |
| — | Medesk, Dentalink, Reservo, Encuadrado | LATAM | Demo comercial o prueba con registro; no se encontró una página demo pública | Solo búsqueda |

---

## 4. Fichas por producto

### 4.1 boliviadental.com (Bolivia)

- **URL:** https://boliviadental.com (la sección "DEMOSTRACIÓN INTERACTIVA" de la página principal)
- **Fecha:** 2026-11-10
- **Acceso:** widget público; `https://boliviadental.com/app/demo` muestra el formulario "Acceso seguro a la clínica" (correo y contraseña) con el texto "Los datos se protegen por clínica mediante Supabase RLS".
- **Mercado:** Bolivia (Bs, QR Simple, COB)

**Probado, paso a paso**
1. **Pestaña "Odontograma FDI"**
   - Hay 16 botones, solo de la arcada superior (18–28).
   - Hay un diente SVG con 5 caras y 5 estados: Caries, Resina, Endo, Corona e Implante.
   - Elegimos la pieza 24 y el estado Caries, y pulsamos las 5 caras. Después probamos Endo e Implante.
   - Resultados:
     - El color de las caras sí cambia (rojo para caries, azul para resina).
     - **El encabezado siempre dice "(Primer Molar Sup.)"**, sea la pieza 24, la 18 o la 11. Es un error de nomenclatura.
     - **El estado no se guarda por pieza:** al pasar de la pieza 24 a la 18, las caras conservan los mismos colores.
     - Volver a pulsar una cara no la borra.
     - Endo, Corona e Implante se aplican a una cara, cuando son estados de toda la pieza.
     - El "Presupuesto Automático Generado" **no cambia nunca**: siempre muestra "Resina Compuesta Fotocurable (Oclusal-Mesial) Bs 250 + Profilaxis Bs 180 = Bs 430", aunque se marque una caries o un implante.
   - Los botones "Ver Odontograma Completo" y "Ver Caso Clínico de Ortodoncia" llevan a `/registro`.
2. **Pestaña "WhatsApp 1-Clic"**
   - Campos editables: nombre (probamos con "Paciente Ficticio Demo") y fecha libre en texto ("Mañana a las 10:30 AM").
   - El mensaje con formato se actualiza en vivo y trae los datos del doctor y la clínica.
   - "Copiar Texto para WhatsApp" funciona.
   - **"Probar Envío Real"** abre `api.whatsapp.com/send/?phone=591719…` (el **número de ventas del proveedor**) con un texto **distinto** del que se muestra: quita "odontológica" y el nombre del doctor. Además, **el emoji 👋 llega dañado** (`%EF%BF%BD`, el carácter de reemplazo �).
   - El "1-Clic" es un enlace `wa.me` manual. No hay API, plantillas aprobadas ni consentimiento.
3. **Pestaña "Cobros QR (Bs.)"**
   - Montos fijos de Bs 150, 250, 350 y 500. No se puede escribir otro monto.
   - El "CÓDIGO QR SIMPLE" es un dibujo decorativo (cuadros), no un QR real.
   - No muestra vencimiento, referencia ni beneficiario.
   - "Simular Confirmación de Pago" cambia a "¡Pago Registrado en Caja!" sin ningún paso de verificación.
4. **Preguntas frecuentes, en orden:**
   - **Pago de la suscripción:** QR Simple y transferencia.
   - **Seguridad:** solo nombra "SSL/TLS" y el respaldo descargable.
   - **Multisede:** "El Plan Clínica Pro y el Plan Clínica Plus permiten trabajar con varios odontólogos y agendas en paralelo dentro de la misma cuenta". No menciona sucursales.
5. **Precios leídos con el selector:**
   - Mensual: Bs 99, 199 y 399.
   - Anual: Bs 990, 1.990 y 3.990.
   - Los planes cubren 1, hasta 3 y hasta 6 odontólogos.
6. **Celular (390 px):**
   - No hay desborde horizontal de la página; la fila de piezas se desplaza dentro de su caja (548 px de contenido en 288 px).
   - Solo un acordeón de preguntas abierto a la vez.

**Visto o anunciado (sin probar)**
- Recetario COB con matrícula y "firma digital".
- Ortodoncia: arcos, ligas, fotos y cuotas.
- Inventario de carpules y resinas con alertas.
- Liquidación por especialista.
- "Recibos oficiales".
- Odontograma "2D y 3D".
- "Reduce hasta un 70 % inasistencias".
- Calculadora de rentabilidad.
- Testimonios de La Paz, Santa Cruz y Cochabamba (no verificables).

**Fortalezas**
- Mensaje muy local: Bs, QR Simple de todos los bancos, COB y soporte por WhatsApp en Bolivia.
- Precios públicos y bajos.
- Interfaz visual cuidada.

**Problemas o errores**
- El widget del odontograma tiene 4 errores funcionales (nombre de pieza, estado por pieza, borrado, presupuesto estático).
- El envío de WhatsApp va al proveedor, con el texto distinto y el emoji dañado.
- El QR es falso y la confirmación de pago no tiene verificación.
- No hay demo real del sistema: el enlace "/app/demo" engaña.
- No hay multisede explícita.

**Notas (solo lo probado; es un widget, no el producto)**

| Área | Nota | Motivo |
|---|---|---|
| Odontograma | 3 | Nomenclatura errónea, sin estado por pieza, presupuesto estático |
| WhatsApp / reserva | 3 | Solo texto prearmado; el envío va al número del proveedor; codificación rota |
| Presupuestos / pagos (QR) | 3 | QR decorativo; confirmación simulada sin referencia |
| Móvil (página y widget) | 7 | Sin desborde horizontal; fila de piezas desplazable |

---

### 4.2 Open Dental: Web Sched (reserva online del paciente)

- **URLs:** https://www.opendental.com/site/websched.html. Desde allí:
  - `patientviewer.com/wsnpdemo.html`: paciente nuevo.
  - `wsep.patientviewer.com/?demo=y`: paciente existente.
  - `wsrdemo.html`: recordatorio (*recall*).
  - `wsasapdemo.html`: ASAP.
- **Fecha:** 2026-11-10
- **Acceso:** demo pública oficial, con `DEMO=Y` en la URL y la clínica ficticia "Westside Chompers".
- **Mercado:** EE. UU.

**Probado: paciente nuevo** (versión antigua en GWT, `26_3_10`), en el celular
1. Preguntas encadenadas: "¿Tuvo una cita antes?" No; "¿Mayor de 18?" Sí; motivo (Emergency/Tooth Pain o New Patient General); aseguradora (4 opciones, entre ellas "Blocked Insurance Inc." y "Other").
   - Cada respuesta **agrega la pregunta siguiente encima** de la anterior. El orden visual queda invertido.
2. Calendario mensual con selección automática del primer día con horarios (25 nov). A la derecha, los horarios del día.
3. **Se pueden elegir días pasados:** el 5 de noviembre (hoy es 10) ofrecía 3:30 PM y 10:00 PM.
   - Los horarios de demo son aleatorios e incluyen 12:30 AM y 4:30 AM. Lo tomamos como dato de demo, pero confirma que el motor de la demo no filtra el pasado.
4. Formulario en la misma página:
   - Nombre, apellido y correo.
   - Fecha de nacimiento en 3 casillas (AAAA, MM, DD).
   - Teléfono fijo y móvil, con "Igual que el fijo".
   - **Casilla separada de consentimiento para SMS**, con texto de STOP/HELP.
   - Bloque de datos del titular del seguro.
5. **Envío vacío:** aparece un modal con **un solo error**: "The birthdate year cannot be blank". Empieza por la fecha y no por el nombre.
6. Envío con datos ficticios: muestra "Appointment Booked! 11/12/26 1:00 AM". La pantalla final **solo muestra fecha y hora**; no hay profesional, dirección, ni opciones de agregar al calendario o cancelar.
7. **Celular:** la página no tiene `meta viewport`. Se dibuja a **980 px** y se reduce en pantalla, así que el texto queda diminuto (captura `opendental-02`).

**Probado: paciente existente** (versión nueva en Angular Material, `26.3.10`), en el celular
1. Pantalla "Patient Info" (nombre, apellido, fecha de nacimiento y, opcionales, correo y celular).
   - En la demo, un envío vacío lleva al paciente demo "John Smith".
2. **Verify Identity:** se elige entre correo o SMS (los datos aparecen parcialmente a la vista).
   - Pide un código de 6 dígitos, válido 15 minutos ("Demo code is 123456").
   - Con un código equivocado, el error dice **"Enter the code 123546"**: las cifras están invertidas respecto del texto de ayuda.
3. **Confirm Insurance:** datos precargados y editables.
4. **Reason for Visit:** el botón "Next" está **deshabilitado** hasta elegir un motivo. Es correcto.
5. **Schedule Visit:**
   - "Change Provider" abre una lista (Any Provider, Poppy Pomfrey DDS, George Hoppfer DDS) con el botón "Select".
   - El calendario solo habilita una ventana de unos 5 días (10–14 de noviembre); los días pasados aparecen grises.
   - Los horarios son rangos ("9:00am-9:30am").
   - Abajo hay una barra fija con Back, **puntos de progreso** y Next.
6. **Pantalla de revisión:** fecha, hora, profesional y motivo, con los botones Back y Confirm.
7. **Appointment Booked:** repite los datos y ofrece "Schedule Another Appointment".
   - **No ofrece** agregar al calendario, dirección o mapa, reprogramar, cancelar ni indicaciones.
8. **Celular:** tiene `meta viewport`, no hay desborde horizontal y los botones son grandes. Lo mejor que observamos en esta ronda.

**Probado en parte: recordatorio y ASAP** (GWT, escritorio)
- **Recordatorio:** el encabezado dice "Patient: John Age: 70"; hay selección de profesional, calendario y "Finalize Appt", con la casilla **"Notify me if an earlier appointment time becomes available"** (lista de espera).
  - "Finalize Appt" sin horario muestra un modal: "Please select a date and time".
- **ASAP** (versión 17.3, antigua): oferta de "New Appointment Times Available" con las opciones Accept, Decline, "Keep my 12/09/26… appointment" y "Do not notify me".
  - En la demo no aparecieron horarios ofrecidos (los días de nov. y dic. salieron vacíos).
  - Accept sin horario muestra un modal: "You must pick an available time slot".

**Fortalezas**
- OTP para el paciente existente, sin contraseñas.
- Pantalla de revisión antes de confirmar.
- Progreso visible.
- Selección de profesional opcional ("Any Provider").
- Consentimiento de SMS separado.
- Lista de espera (ASAP) y recordatorio con enlace directo a reservar.

**Problemas**
- Dos generaciones de interfaz conviven, y la antigua no se adapta al celular.
- Validación de a un error por vez, en modales.
- Días pasados reservables en la demo de paciente nuevo.
- Texto del OTP incoherente.
- Confirmación pobre.
- Horarios de madrugada en los datos demo.

**Notas (lo probado)**

| Área | Nota | Motivo |
|---|---|---|
| WhatsApp / reserva online | 7 | Flujo de paciente existente: 8. Flujo de paciente nuevo: 5 (no se adapta, días pasados, validación en modales) |
| Seguridad / permisos (lado paciente) | 7 | OTP por SMS o correo, código de 15 min; error de texto en el código |
| Móvil | 6 | Versión nueva: 8. Versión antigua: 3 |

---

### 4.3 Open Dental: portal del paciente

- **URL:** https://www.patientviewer.com/pdemo.html (instrucciones en https://www.opendental.com/site/patientportal.html: "User Name: demo / Password: any text")
- **Fecha:** 2026-11-10
- **Acceso:** credenciales demo publicadas por el proveedor.
- **Mercado:** EE. UU.

**Probado**
1. **Inicio de sesión:**
   - El encabezado del portal dice literalmente **"Title / Subtitle"** (marcadores sin configurar en la demo).
   - Hay casilla "Remember User Name" y enlace "forgot password".
2. **Appointments:**
   - Lista de citas con paciente, fecha, profesional, estado y sede ("Westside Chompers - Oregon").
   - La demo marca como "Complete" citas **futuras** (12/9/2026) y muestra horarios de madrugada. Los datos se regeneran en cada ingreso.
3. **Action Needed (2):** "Recare/cleaning due as of 11/10/2026" con el botón "Schedule Appointment".
   - El botón abre en otra pestaña `http://patientviewer.com/wsrdemo.html`. Usa **HTTP sin cifrar** y no cargó desde nuestro entorno (que solo permite HTTPS), así que no pudimos verificarlo.
4. **Account:**
   - Muestra "Last Statement Balance" (US$ 231,97 en un ingreso y 384,68 en otro) y "Payments Since Last Statement" (US$ 2.788,41).
   - **No hay saldo actual neto**: con pagos mayores que el saldo, el paciente no sabe si debe o tiene a favor.
   - Movimientos (estados de cuenta y pagos en efectivo o cheque), con un asterisco y la nota "Payment Pending - May Not Be Reflected in Balance".
   - **Pay:** "Credit card payments are not supported in demo mode".
5. **Plan:**
   - Planes de tratamiento guardados, con fecha y nota ("Potential root canal needed").
   - Tabla con pieza, descripción y honorario, **dividido entre seguro y paciente**.
   - Advertencia: "reflect content at time each plan was saved". Es un buen principio de inmutabilidad.
6. **WebMail:** bandeja segura (Inbox, Sent, Secure Provider Messages), con correos ficticios, paciente relacionado y adjuntos. El botón Compose existe; no lo usamos.
7. **Summary:** resúmenes de atención de **Frodo y Bilbo**. Es **acceso familiar**: el titular de la cuenta ve a sus dependientes.
   - Aparece "XSL not viewable in demo mode".
   - Hay datos demo incoherentes (Frodo figura como "Female").
8. **Images:** documentos por paciente (consentimiento, plan de tratamiento, estado de cuenta) con fecha.
9. **Family:** enlace en la cabecera para cambiar entre miembros.
10. **Celular:** sin `meta viewport`; se dibuja a 980 px. Es **ilegible** en un teléfono (captura `opendental-08`).

**Fortalezas**
- Cobertura funcional completa: citas, acciones pendientes, cuenta con pago, planes con reparto de seguro, mensajería segura, documentos y familia.

**Problemas**
- No se adapta al celular.
- Saldo confuso.
- Enlace HTTP.
- Encabezado sin configurar.
- Datos demo incoherentes.
- No hay aceptación ni firma del plan desde el portal (no se vio).

**Notas (lo probado)**

| Área | Nota | Motivo |
|---|---|---|
| Pacientes (portal, vista familiar) | 6 | Familia y resumen correctos; datos demo incoherentes |
| Presupuestos / pagos | 5 | Plan con reparto de seguro; saldo confuso; pago no probable en la demo |
| Historia clínica (lo que ve el paciente) | 6 | Planes guardados de forma inmutable y documentos; sin odontograma |
| Móvil | 2 | Diseño de escritorio reducido |

---

### 4.4 MyDentalPMS (EE. UU., beta)

- **URL:** https://mydentalpms-site.pages.dev/demo.html y `/intake`
- **Fecha:** 2026-11-10
- **Acceso:** demo en vivo sin inicio de sesión ("You're viewing a live demo"). El sitio dice "Now in Beta — Early Access 2026".
- **Mercado:** EE. UU. (CDT, HIPAA)

**Probado**
1. **Dashboard:**
   - Indicadores de producción, cobranza, aceptación, recall y cuentas por cobrar por antigüedad.
   - Producción por profesional.
   - Alertas ("3 unconfirmed tomorrow — Send Reminders").
2. **Send Reminders:** aparece un `alert()` nativo: "Confirmation reminders sent! … 3 reminders sent successfully". Es simulado.
3. **Schedule:**
   - Columnas por sillón (Operatory 1–3) con celdas "Click to book".
   - Panel lateral **"Smart Fill"**: lista de espera con duración y preferencias ("Tue/Thu only") y "riesgo de inasistencia de mañana" (no confirmado, inasistencias previas).
   - El panel queda **abierto encima de todas las pantallas**.
4. **+ New Appointment → Quick Book:**
   - Campos: paciente, procedimiento con duración, profesional y sillón. **No tiene campo de fecha ni hora.**
   - Al pulsar Book vacío: `alert("Please fill in patient name and procedure type")`.
   - Con datos ficticios: `alert("Appointment booked! … Operatory: undefined")`. **La cita no aparece en la agenda.**
5. **Patients:** lista con seguro, último ingreso, saldo y estado ("Recall Due").
6. **Clinical:**
   - Odontograma con numeración Universal (1–32), leyenda de colores y tabla de hallazgos con código CDT, superficie, fecha y profesional.
   - Alergia destacada ("⚠ Penicillin").
   - Notas clínicas.
   - No probamos marcar piezas.
7. **Billing:** libro de cuenta por paciente con cargos, créditos y saldo acumulado. **Claims:** tablero de reclamos al seguro por estado y antigüedad. **Reports:** pronóstico, retención y "34 pacientes en riesgo". **Messages:** bandeja unificada (SMS, correo y portal), con reprogramación dentro del hilo y preferencias de contacto. **Settings:** pestañas de configuración. Todo esto solo se vio.
8. **Formulario de ingreso del paciente** (`/intake`), en el celular:
   - **Pasos:** 5 con indicador numérico:
     1. Datos personales y contacto de emergencia.
     2. Seguro.
     3. Historia médica: medicamentos, alergias con sugerencias y 15 casillas de condiciones (embarazo, anticoagulación…).
     4. Historia dental: motivo obligatorio y **escala de ansiedad con emojis**.
     5. Consentimientos: 3 casillas obligatorias, **firma con el dedo**, fecha y nombre impreso.
   - **Validación:** con el envío vacío del paso 1 aparecen **todos** los errores en línea ("Required"). Es correcto.
   - **Fallo de validación:** el paso 2 dejó avanzar con "Insurance Company *" vacío.
   - **Final:** nos detuvimos antes de "Submit Registration".
9. **Celular (panel):** el contenido queda **cortado a la derecha** y las tarjetas no se reorganizan. Un aviso flotante ("1 day login streak") tapa contenido. El saludo cambia entre "Good evening" y "Good afternoon" en la misma pantalla.

**Fortalezas**
- Ideas de producto valiosas: lista de espera con "Smart Fill", riesgo de inasistencia, bandeja unificada y un formulario de ingreso del paciente completo con firma.

**Problemas**
- Prototipo con datos fijos.
- La reserva no funciona.
- `alert()` nativos.
- Panel lateral invasivo.
- Panel no adaptado al celular.

**Notas (lo probado)**

| Área | Nota | Motivo |
|---|---|---|
| Agenda | 3 | Quick Book sin fecha ni hora; "Operatory: undefined"; la cita no se agrega |
| WhatsApp / reserva (formulario de ingreso) | 7 | 5 pasos, validación en línea, firma táctil; un campo obligatorio sin validar |
| Finanzas / reportes | No evaluado | Solo vistos (datos fijos) |
| Móvil | 3 | Panel cortado; el formulario sí se adapta (8) |

---

### 4.5 AgendaPro: página pública de reservas (Chile / LATAM)

- **URLs:**
  - https://agendapro.com/mp/cl (marketplace)
  - https://agendapro.com/mp/cl/clinicas-odontologicas-santiago
  - https://agendapro.com/site/cl/clinicamedface/209935
- **Fecha:** 2026-11-10
- **Acceso:** público. Es un negocio real, así que **no se escribieron datos ni se envió nada**.
- **Mercado:** Chile y LATAM (CLP, RUT)

**Probado (celular)**
1. **Calidad del directorio:**
   - "Clínicas Odontológicas en Santiago (9 resultados)" muestra **primero una barbería** y luego una clínica de estética.
   - El enlace a una "clínica odontológica" del menú de navegación devolvió un **404**.
2. **Ficha del negocio:**
   - Valoración (4,9, con 117 reseñas), dirección y "Abierto ahora".
   - Pestañas Servicios, Nosotros y Reseñas.
   - Servicios por categoría, con duración, precio en CLP y botón "Agendar".
3. **"Agendar"** abre una **hoja a pantalla completa** "Reserva de hora" con:
   - el servicio y la opción "+ Agregar otro servicio";
   - "Elige fecha y hora" con **tarjetas de profesional con foto**;
   - el **total fijo abajo** y el botón "Continuar".
4. Al elegir profesional aparecen:
   - el calendario del mes, con la leyenda "con hora / sin hora";
   - una **tira horizontal de días**;
   - los horarios (solo 16:10 disponible);
   - el aviso **"⚠️ Las horas disponibles podrían agotarse, ¡agenda lo antes posible!"**, que es un patrón de urgencia.
5. Continuar lleva a **"Tus datos"**:
   - Resumen (servicio, profesional, "Miércoles 11 de noviembre a las 16:10").
   - Campos: nombre, apellido, correo, teléfono con selector de país (Bolivia incluido), **RUT** y observaciones opcionales.
   - Texto de autorización de datos "solo para gestionar esta reserva".
   - reCAPTCHA.
   - Botón **"Pagar y agendar"**: pago anticipado obligatorio en esta clínica.
   - **Nos detuvimos aquí.**

**Fortalezas**
- Es la mejor experiencia de reserva en el celular de esta ronda: hoja inferior, fotos, tira de días, total visible y pocos pasos.
- Datos mínimos.
- Consentimiento acotado a la reserva.
- Antispam.

**Problemas**
- El marketplace mezcla rubros en "odontológicas" y tiene enlaces rotos.
- Mensaje de urgencia artificial.
- Usa el término local "RUT"; en Bolivia corresponde CI.
- No se ve política de cancelación antes de pagar (al menos hasta ese paso).

**Notas (lo probado)**

| Área | Nota | Motivo |
|---|---|---|
| WhatsApp / reserva online | 8 | Flujo corto y claro; pago anticipado; urgencia artificial |
| Móvil | 9 | Hoja inferior, objetivos táctiles grandes, total fijo |

---

### 4.6 Doctoralia México: reserva con dentista (LATAM)

- **URLs:** https://www.doctoralia.com.mx/dentista-odontologo/ciudad-de-mexico, que lleva a `/booking/seleccionar-fecha/…` y luego a `/booking/authentication/…`
- **Fecha:** 2026-11-10
- **Acceso:** público. Es una profesional real, así que **no se escribieron datos**.
- **Mercado:** México (también Colombia, Chile, Perú, Argentina y Brasil)

**Probado (celular)**
1. **Listado:** tarjetas con insignias ("Pago seguro", "Pagos a meses"), número de opiniones, dirección, mapa, "Primera visita Odontología desde $760" y una **tira de días** (Hoy, Mañana, Jue…).
2. **"Agendar cita"** (hoja con pasos):
   - Dirección.
   - Servicio (desplegable).
   - Aseguradora ("No acepta aseguradoras").
   - "¿Es tu primera visita con este especialista?" Sí o No.
   - Grilla de 14 días con 4 horarios por día.
   - **Error:** se muestran celdas **"00:00"** visibles en cada día.
   - Al final: "Mostrar más horas".
3. **Clic en 10:00**, en la página de reserva:
   - **Barra de progreso al 15 %.**
   - Motivo con precio ($760) y opción "Cambiar".
   - Aseguradora y primera visita.
   - Resumen con médica, fecha y hora, **"Zona horaria: Zona Centro"** y "Cambiar la fecha".
   - Aviso "Pago en línea disponible en los siguientes pasos".
4. **Continuar** lleva a **"Continuar con tu correo electrónico"**:
   - Opciones: Google, Apple o correo.
   - Texto: "Si es tu primera cita, te crearemos una cuenta gratuita".
   - **La barra de progreso vuelve a 0 %.**
   - **Nos detuvimos aquí.**
5. El aviso de cookies tapa la mitad inferior de la hoja de reserva hasta que se cierra.

**Fortalezas**
- Zona horaria explícita.
- Pregunta de primera visita (cambia la duración y el precio).
- Precio visible desde el listado.
- Cambiar la fecha sin volver atrás.
- La cuenta permite gestionar citas y recibir recordatorios.

**Problemas**
- Horarios fantasma "00:00".
- La barra de progreso retrocede.
- Cuenta obligatoria para reservar (fricción).
- El aviso de cookies tapa el flujo.

**Notas (lo probado)**

| Área | Nota | Motivo |
|---|---|---|
| WhatsApp / reserva online | 7 | Pasos claros y zona horaria; "00:00"; obliga a autenticarse |
| Móvil | 7 | Se adapta bien; el aviso de cookies tapa la hoja |

---

### 4.7 Solo visto o anunciado: Odentiva

- **URLs:** https://odentiva-web.pages.dev/es/ y las páginas de funciones `portal-paciente`, `agendamiento-en-linea`, `micrositio` y `precios`.
  - La página `/es/` devolvía un **404** dentro de su propia plantilla.
- **Acceso:** solo información pública.
  - "Ver demo" lleva a `#capturas`.
  - El micrositio `odentiva.app/@clinica-demo` responde "Sitio no disponible".
- **Anunciado:**
  - Portal del paciente por **enlace privado sin contraseña**, donde la clínica decide **campo por campo** qué se comparte (todo apagado por defecto).
  - Reserva **como solicitud**: llega a una bandeja y la clínica la aprueba o rechaza.
  - Correos automáticos: acuse al paciente, aviso a la clínica y confirmación **con archivo .ics**.
  - Micrositio con 4 plantillas, horarios, mapa, galería, datos estructurados y tarjeta de vista previa para WhatsApp.
  - Plan Multiclínica con "aislamiento de datos por clínica" y "auditoría avanzada".
  - Plan gratis de 100 pacientes.
- **Por qué importa:** el modelo de solicitud con aprobación es una alternativa a la confirmación automática. Nos conviene permitir ambos por sucursal o servicio.

---

## 5. Matriz de notas de esta ronda (solo lo probado, 1–10)

| Área | boliviadental (widget) | Open Dental Web Sched | Open Dental portal | MyDentalPMS | AgendaPro (reserva) | Doctoralia (reserva) |
|---|---|---|---|---|---|---|
| Agenda | no evaluado | no evaluado | no evaluado | 3 | no evaluado | no evaluado |
| Pacientes | no evaluado | no evaluado | 6 (familia) | no evaluado | no evaluado | no evaluado |
| Odontograma / periodontograma | 3 / — | — | — | visto / — | — | — |
| Historia clínica | no evaluado | no evaluado | 6 (vista del paciente) | no evaluado | no evaluado | no evaluado |
| Presupuestos / pagos | 3 (QR simulado) | no evaluado | 5 | no evaluado | no evaluado (pago no ejecutado) | no evaluado |
| Inventario | no evaluado | — | — | — | — | — |
| Finanzas / reportes | no evaluado | — | — | visto (datos fijos) | — | — |
| WhatsApp / reserva online | 3 | 7 | no evaluado | 7 (formulario de ingreso) | 8 | 7 |
| Seguridad / permisos | no evaluado | 7 (OTP) | no evaluado | no evaluado | no evaluado (reCAPTCHA visto) | no evaluado |
| Móvil | 7 | 6 (8 nuevo / 3 antiguo) | 2 | 3 (formulario de ingreso: 8) | 9 | 7 |

---

## 6. Lado del paciente: comparación y lecciones

| Aspecto | Mejor observado | Error observado |
|---|---|---|
| Identificar al paciente | Open Dental existente: datos y OTP de 6 dígitos por SMS o correo, sin contraseña | Doctoralia: cuenta obligatoria (correo, Google o Apple) |
| Elegir horario | AgendaPro: tarjetas de profesional con foto, tira de días y total fijo. Open Dental nuevo: "Any Provider" y rangos de hora | Días pasados (Open Dental, paciente nuevo); "00:00" (Doctoralia); horarios de madrugada |
| Revisar antes de confirmar | Open Dental existente: pantalla de revisión dedicada | Open Dental nuevo: confirma sin revisar |
| Confirmación | — (ninguno ofrece calendario, mapa, reprogramar y cancelar juntos). Odentiva anuncia el .ics | "Appointment Booked! 11/12/26 1:00 AM" sin más datos |
| Validación | MyDentalPMS: todos los errores en línea | Open Dental: modal de un error; MyDentalPMS: `alert()` |
| Consentimiento | Open Dental: casilla de SMS separada. AgendaPro: autorización "solo para esta reserva" | boliviadental: WhatsApp sin consentimiento |
| Pago y QR | AgendaPro: "Pagar y agendar" con el total siempre visible | boliviadental: QR decorativo, montos fijos y "pagado" sin verificar |
| Portal | Open Dental: citas, acciones pendientes (recall), cuenta, planes, mensajes, documentos y familia | Portal ilegible en el celular; saldo sin neto; enlace HTTP |
| Lista de espera | Open Dental: "avísame si se libera antes" (ASAP). MyDentalPMS: Smart Fill | — |
| Celular | AgendaPro, Open Dental nuevo, formulario de MyDentalPMS | Open Dental GWT y portal a 980 px |
| Tono | Mensajes claros y neutros | Urgencia artificial (AgendaPro); progreso que retrocede (Doctoralia) |

---

## 7. Filas sugeridas para `INVESTIGACION_COMPETIDORES.md` §3

| # | Producto | País o mercado | Nivel de acceso | Qué pudimos hacer |
|---|---|---|---|---|
| 21 | Open Dental: Web Sched y portal del paciente | EE. UU. | **Demos públicas oficiales** (`DEMO=Y`; usuario `demo` publicado) | Probados la reserva para paciente nuevo y existente, el portal (7 pestañas) y el celular |
| 22 | MyDentalPMS | EE. UU. (beta) | **Demo en vivo sin inicio de sesión** | Probados 9 módulos, la reserva rápida y el formulario de ingreso de 5 pasos (sin enviar) |
| 23 | AgendaPro (página pública) | Chile / LATAM | Reserva pública de un negocio real | Probado hasta "Pagar y agendar", sin enviar |
| 24 | Doctoralia | México / LATAM | Reserva pública de una profesional real | Probado hasta la autenticación, sin enviar |
| 25 | Odentiva | Multiclínica (ES y EN) | Prueba con registro; el micrositio demo no está disponible | Solo información pública |

Corrección propuesta para la fila 20 (boliviadental): cambiar "Demostración interactiva + registro" por **"Widget de marketing (3 pestañas con errores); `/app/demo` pide inicio de sesión"**, con "Probado: widget".

---

## 8. Requisitos sugeridos para nuestra plataforma

Son requisitos originales. Se inspiran en patrones generales y no copian diseños ni textos. Prioridad: **P1** para la primera versión del portal y la reserva; **P2** para la siguiente.

### 8.1 Reserva online del paciente

**P1**
- **R1. Hecho para el celular de verdad:**
  - `meta viewport`, sin desborde horizontal a 360 px;
  - objetivos táctiles de 44 px o más;
  - inputs de 16 px o más (evita el zoom de iOS);
  - una sola columna;
  - acción principal y total fijos abajo.
- **R2. Embudo corto en este orden:** sucursal (las 5, con dirección y enlace a mapa), luego servicio (duración y precio "desde" en Bs, si la clínica lo habilita), luego profesional o "cualquiera", luego día y hora.
  - El paso de sucursal se salta si el enlace ya trae la sucursal, por ejemplo desde el WhatsApp de esa sede.
- **R3. Disponibilidad calculada por el mismo motor de la agenda interna:**
  - mismos solapes por profesional, sillón y paciente;
  - mismos horarios, bloqueos y duración por servicio;
  - **nunca** días pasados, horas ya transcurridas ni horarios fantasma;
  - zona horaria `America/La_Paz` explícita;
  - **retención temporal** del horario elegido (por ejemplo, 5–10 minutos) para evitar dobles reservas al confirmar.
- **R4. Dos modos configurables por sucursal y servicio:**
  - **confirmación inmediata**;
  - **solicitud** que entra a una bandeja de recepción para aprobar o rechazar, con motivo.
- **R5. Pacientes:**
  - **Paciente existente:** CI y fecha de nacimiento, más un **código de un solo uso por WhatsApp o SMS** (6 dígitos, 10 minutos, intentos limitados, mensajes de error coherentes con el código real). Sin contraseñas.
  - **Paciente nuevo:** datos mínimos (nombres, CI, celular y fecha de nacimiento) y detección de duplicados en el servidor **sin revelar** si el paciente ya existe.
- **R6. Antes de confirmar:** pantalla de **revisión** que muestre servicio, profesional, sucursal, fecha, hora, duración, precio o anticipo, indicaciones y política de cancelación.
- **R7. Pantalla y mensaje de confirmación** con:
  - código de reserva;
  - todos los datos de la cita;
  - **agregar al calendario (.ics)**;
  - **cómo llegar** (mapa);
  - **reprogramar** y **cancelar**;
  - botón de WhatsApp de **la sucursal** (nunca un número genérico).
- **R8. Validación:**
  - en línea y **todos los errores a la vez**, junto al campo;
  - sin modales de un error y sin `alert()`;
  - el botón de avanzar se habilita solo cuando el paso es válido.
- **R9. Consentimientos separados y versionados:**
  - tratamiento de datos para la reserva;
  - recordatorios por WhatsApp (opcional);
  - comunicaciones de marketing (opcional, apagado por defecto).
  - Se guardan con fecha, versión del texto y canal.
- **R10. Protección del flujo anónimo:**
  - CAPTCHA o desafío invisible solo ante señales de abuso;
  - límite de solicitudes por IP y teléfono;
  - auditoría de cada reserva creada desde la web.
- **R11. Tono honesto:** sin urgencia artificial ("podrían agotarse") y con un indicador de progreso que **nunca retrocede**.

**P2**
- **R12. Lista de espera:** "avísame si se libera un horario antes". Si alguien cancela, se ofrece el horario por WhatsApp con un enlace que caduca; el primero que acepta, lo toma.
- **R13. Recordatorio (recall) con enlace directo:** "Te toca tu limpieza o control de ortodoncia". El enlace lleva prellenados el servicio y el profesional habitual.
- **R14. Micrositio por sucursal** con servicios, horarios, mapa, fotos, preguntas frecuentes, datos estructurados y vista previa al compartir por WhatsApp (Open Graph), con el botón de reserva incorporado.
- **R15. Preguntas de admisión según el servicio:** primera visita, urgencia o dolor, menor de edad con tutor. Las respuestas cambian la duración y el profesional sugerido.
- **R16. Anticipo opcional** por servicio o paciente (por ejemplo, primera consulta o pacientes con inasistencias), con política visible antes de pagar.

### 8.2 Pago con QR (lado del paciente)

**P1**
- **R17. QR real** de un proveedor o banco con QR Simple interoperable:
  - monto exacto en Bs;
  - **referencia única** ligada a la cita, cuota o presupuesto;
  - nombre del beneficiario (la razón social de la clínica);
  - **vencimiento visible** con cuenta regresiva;
  - opción de descargar o compartir la imagen del QR para pagar desde otro teléfono.
- **R18. Estados del pago:** pendiente, en verificación, confirmado, vencido o rechazado.
  - **Nunca "pagado"** sin confirmación del banco (webhook o consulta) o una verificación manual doble en caja, que se registra en la auditoría.
  - Pago idempotente: el mismo QR o la misma referencia no se aplica dos veces.
- **R19. Comprobante descargable (PDF)** en el portal y por WhatsApp, con el saldo resultante.

**P2**
- **R20. Pago de cuotas de ortodoncia o presupuestos** desde el portal, eligiendo la cuota o un monto parcial (con límite al saldo, sin sobrepago).

### 8.3 Portal del paciente

**P1**
- **R21. Acceso sin contraseña:**
  - **enlace mágico firmado** enviado por WhatsApp o SMS, por cita o por sesión, que expira y se puede revocar;
  - o código de un solo uso.
  - La sesión es corta en dispositivos compartidos.
- **R22. Inicio:**
  - próxima cita con confirmar, reprogramar y cancelar (según las reglas de anticipación de cada sucursal);
  - historial de citas con estados **coherentes** (una cita futura nunca aparece "completada");
  - acciones pendientes (control, firma o pago).
- **R23. Estado de cuenta claro:**
  - **saldo actual neto** ("Debes Bs X" o "Tienes a favor Bs Y");
  - total del tratamiento, pagado y pendiente;
  - próximas cuotas con fecha;
  - pagos "en verificación" separados del saldo.
- **R24. Presupuestos:**
  - ver los planes guardados de forma **inmutable**, por pieza, en lenguaje simple;
  - **aceptar con firma o aceptación registrada** (fecha, IP o dispositivo, versión);
  - descargar en PDF.
- **R25. Control fino de lo que se comparte:** la clínica decide por sucursal o paciente qué secciones ve el paciente (citas, presupuestos, pagos, documentos, odontograma simplificado). Notas clínicas internas nunca.
- **R26. Grupo familiar o tutor:**
  - un responsable gestiona a menores o dependientes;
  - permisos explícitos y con fecha de vencimiento;
  - el cambio de titular queda en la auditoría.
- **R27. Documentos:** consentimientos firmados, recetas y comprobantes descargables.
- **R28. Seguridad y auditoría:**
  - todo por HTTPS;
  - aislamiento por paciente;
  - registro de cada acceso al portal (quién, cuándo y qué vio);
  - sin datos clínicos en las URL ni en las vistas previas de WhatsApp.

**P2**
- **R29. Formulario previo a la cita**, por pasos y con guardado parcial:
  - antecedentes, alergias y medicamentos (con alerta visible para el profesional);
  - embarazo y anticoagulantes;
  - escala de ansiedad;
  - consentimientos con firma táctil.
  - Alimenta la historia clínica versionada **solo después** de que la recepción lo valida.
- **R30. Mensajería con la sucursal** (o un traspaso ordenado a su WhatsApp), ligada al paciente y a la cita, con plantillas de respuesta rápida en recepción.
- **R31. Indicaciones antes y después del tratamiento** según el procedimiento (por ejemplo, después de una extracción), enviadas y visibles en el portal.
- **R32. Accesibilidad AA:** contraste, lector de pantalla, texto ampliable; probado a 360 px y en Android de gama baja con conexión 3G.

---

## 9. Fuentes (consultadas el 2026-11-10)

- https://boliviadental.com, https://boliviadental.com/app/demo y https://boliviadental.com/registro
- https://www.opendental.com/site/websched.html y https://www.opendental.com/site/patientportal.html
- https://www.patientviewer.com/wsnpdemo.html, https://wsep.patientviewer.com/?demo=y, https://www.patientviewer.com/wsrdemo.html, https://www.patientviewer.com/wsasapdemo.html y https://www.patientviewer.com/pdemo.html
- https://mydentalpms-site.pages.dev/, /demo.html y /intake
- https://odentiva-web.pages.dev/funciones/portal-paciente/, /agendamiento-en-linea/, /micrositio/ y /precios/
- https://agendapro.com/mp/cl, https://agendapro.com/mp/cl/clinicas-odontologicas-santiago y https://agendapro.com/site/cl/clinicamedface/209935
- https://www.doctoralia.com.mx/dentista-odontologo/ciudad-de-mexico
- No accesibles o no probados: https://identsoft.ambitiousit.net (fallo de túnel), https://apps.odoo.com/apps/modules/19.0/c_dental_clinic y https://apps.odoo.com/apps/modules/16.0/pragtech_dental_management ("Live Preview" lleva a un formulario comercial)

**Capturas nuevas (19):**
- `boliviadental-01…05`
- `opendental-01…08`
- `mydentalpms-01, 02`
- `agendapro-01, 02`
- `doctoralia-01, 02`
