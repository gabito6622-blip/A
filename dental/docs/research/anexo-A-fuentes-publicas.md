# Análisis competitivo público: software de gestión odontológica (mercado hispanohablante / Bolivia)

**Fecha de consulta:** 2026-11-10 (primera pasada con buscador; segunda pasada el mismo día, leyendo las páginas oficiales directamente).
**Cliente piloto de referencia:** clínica odontológica con 5 sucursales en Bolivia.
**Alcance:** solo páginas públicas. No se crearon cuentas, no se inició sesión, no se enviaron formularios ni se aceptaron términos.

---

## 0. Metodología y limitaciones (leer primero)

1. **Segunda pasada (verificación directa).** Las páginas oficiales se abrieron desde el contenedor con un navegador sin interfaz (Playwright/Chromium) y con curl. Se guardó el texto visible y los enlaces de cada página. Para los acordeones de preguntas frecuentes, los selectores de plan ("Soy odontólogo / Tengo una clínica", "Mensual / Anual") y los pasos de demos públicas, se hizo clic **bloqueando cualquier petición que no fuera GET**, de modo que nada se envió. Las únicas peticiones bloqueadas fueron balizas de analítica (Google Analytics, Clarity, etc.) y un evento de embudo automático de kilto.app. **No se rellenó ni se envió ningún formulario.**
2. **Marcadores usados:**
   - **"verificado en página oficial (Vn)"**: el dato se leyó directamente en esa página; cada producto define sus URL Vn.
   - **"solo buscador (no verificado)"**: dato de la primera pasada que no apareció en las páginas abiertas; se conserva con advertencia.
   - **"anunciado"**: es una afirmación del fabricante. **Nada fue probado** como usuario.
   - **"no encontrado"**: no aparece en las páginas abiertas, lo que no prueba que no exista.
3. **Correcciones importantes respecto de la primera pasada:**
   - DentinCloud: precios y planes distintos.
   - OdontoDrive /bo: los precios están en **bolivianos**.
   - Dentrisoft: el panel administrativo de la demo **requiere inicio de sesión**.
   - Kilto y ASSILEM: son productos **bolivianos** con precios en Bs.
   - DentalApp, DENTRIK y Odontosinc ahora tienen información completa.
   - Dentalink: `/comenzar` devuelve **404**.
   - Clinic Cloud y Dentally: precios actualizados.
4. **Panel Dental** publica credenciales de una demo (usuario y contraseña en su portada). **No se usaron**, por la regla de no iniciar sesión.
5. **Monedas:** USD = dólar estadounidense; Bs/BOB = boliviano; COP = peso colombiano; ARS = peso argentino; € = euro; £ = libra esterlina; VES = bolívar venezolano.

**Leyenda de las 12 áreas:**
(1) Dashboard/navegación · (2) Agenda y disponibilidad de doctores · (3) Sillones/consultorios y multisucursal · (4) Registro/ficha de pacientes · (5) Odontograma y periodontograma interactivos · (6) Historia clínica/diagnóstico/tratamientos · (7) Presupuestos/cuotas/pagos · (8) Inventario/materiales · (9) Finanzas/reportes/comisiones · (10) WhatsApp/reserva online/automatizaciones · (11) Seguridad/permisos/auditoría · (12) Experiencia móvil.

---

## 1. DentinCloud

- **Páginas verificadas:** V1 = https://www.dentincloud.com/es · V2 = https://www.dentincloud.com/en/pricing (redirige a /en#pricing).
- **Nivel de acceso: prueba con registro** (verificado en página oficial V1). "Empiece gratis" lleva al registro (`app.dentincloud.com/register`): gratis hasta 100 pacientes, sin límite de tiempo y sin tarjeta. También ofrece "Pida una demo por WhatsApp". No hay demo pública navegable.
- **País/mercado:** la empresa es **turca**: razón social Muhammed Mustafa Vanlı, oficina tributaria de Alanya, textos legales KVKK y pagos con iyzico. La interfaz está en 12 idiomas. (V1)
- **Precios (verificado en página oficial V1/V2):**
  - **España (EUR):** prueba gratuita 0 € hasta 100 pacientes (4 usuarios, 5 GB); **Mensual 34 €/mes**; **Anual 309 €/año**. Cada uno incluye 4 usuarios, 5 GB y pacientes ilimitados; usuarios y almacenamiento extra se venden aparte.
  - **EE. UU. (USD):** $0 / **$39/mes** / **$349/año**.
  - "Los precios… pueden variar según el país; al registrarse verá su propio precio."
  - **Corrección:** los planes Free/Starter $11/Pro $16/Enterprise de la primera pasada **ya no figuran**.
- **12 áreas** (anunciado; verificado en página oficial V1 salvo indicación):
  1. Informes de ingresos, cobros y citas; chat interno del equipo.
  2. Agenda con una columna de color por odontólogo, arrastrar y soltar, vistas día/semana/mes, y diente, tratamiento y precio en la cita.
  3. Multiclínica: "Con la misma cuenta puede acceder a varias clínicas y pasar de una a otra con un clic. Los datos de cada clínica se mantienen separados" (preguntas frecuentes). **No anuncia un consolidado entre sedes.** La frase "Run all your locations from one dashboard" de la primera pasada **no aparece** en las páginas actuales. Sillones: no encontrado.
  4. Ficha con anamnesis (lista de comprobación), documentos, notas y radiografías; informe del paciente en PDF.
  5. Odontograma junto al plan de tratamiento. Periodontograma: no encontrado.
  6. Plan de tratamiento sobre los dientes, con cada paso vinculado a una cita y seguimiento del avance. Aviso de alergia o anticoagulantes en la tarjeta de la agenda.
  7. Cuenta corriente del paciente, caja diaria y lista de deudores. Cuotas: no encontrado.
  8. Inventario: **no encontrado** en las páginas actuales (el dato de la primera pasada queda como solo buscador, no verificado).
  9. Informes. Comisiones: no encontrado.
  10. WhatsApp desde el número propio, conectado por QR: confirmación, recordatorios 1 día y 3 horas antes, seguimiento de inasistencias, indicaciones tras el tratamiento y cumpleaños; 9 plantillas editables. Reserva online: no encontrado.
  11. Roles de odontólogo, auxiliar, recepción y gerencia; base de datos independiente por clínica; HTTPS. Auditoría: no encontrado.
  12. Navegador en móvil, tablet y ordenador; la agenda se adapta a pantallas pequeñas.
- **Bolivia:** no encontrado (sin BOB, QR ni SIAT).
- **IA (verificado V1):** "Asistente IA": se le pregunta por las citas de hoy o se le pide un resumen del paciente; "con su aprobación, también crea la cita él mismo".
- **Fortalezas:** plan gratuito sin límite de tiempo; WhatsApp automático muy completo; asistente IA que agenda.
- **Brechas:** sin consolidado multisede (clínicas separadas); sin inventario, comisiones, periodontograma ni auditoría visibles; proveedor extranjero sin presencia local.
- **Diferenciación:** consolidado real de 5 sedes, más inventario y comisiones por sede.

---

## 2. NacarOS

- **Páginas verificadas:** V1 = https://www.nacaros.com/ (incluye las preguntas frecuentes en JSON-LD) · V2 = https://www.nacaros.com/precios · V3 = https://www.nacaros.com/seguridad · V4 = https://www.nacaros.com/alternativas/dentalink
- **Nivel de acceso: prueba con registro** (verificado V1/V2). 30 días de Pro sin tarjeta mediante `app.nacaros.com/register`; si no se paga, la cuenta pasa al Plan Básico gratuito. La inconsistencia 14/30/60 días de la primera pasada no se ve: las páginas actuales dicen **30 días**, más una garantía de reembolso de 30 días.
- **País/mercado:** LATAM. El pie lista Argentina, Chile, Colombia, Dominicana, Ecuador, México, Perú y Venezuela (**Bolivia no figura**). El soporte por WhatsApp es un número +58 (Venezuela). (V1)
- **Precios (USD, verificado V1/V2):**
  - **Plan Básico** $0 para siempre: 1 usuario, hasta 20 pacientes activos.
  - **Plan Pro** **$14,99/mes** o **$11,99/mes en pago anual** ($144/año): pacientes ilimitados y **4 usuarios (hasta 3 odontólogos + 1 asistente/recepción)**; los especialistas invitados no ocupan usuario.
  - "Programa Fundador": tarifa congelada de por vida.
  - Medios de pago: tarjeta, transferencia y USDT.
- **12 áreas** (anunciado; verificado V1 salvo indicación):
  1. Dashboard financiero: conversión de presupuestos, asistencia, ingresos, margen neto y antigüedad de cuentas por cobrar.
  2. Agenda con reserva online, lista de espera y sincronización con Google o Apple Calendar; si alguien cancela, el cupo se ofrece a la lista de espera.
  3. Multisucursal: **no anunciado**. El producto se dirige a clínicas de hasta 3 odontólogos (V1, V2). Sillones: no encontrado.
  4. Ficha del paciente; se puede crear pegando un mensaje de WhatsApp; importación desde Excel/CSV, contactos del teléfono o fotos de fichas en papel (con IA).
  5. **Odontograma con 35 estados FDI y 5 caras**, línea de tiempo e índices CPOD/ceod. **Periodontograma de 6 sitios por pieza con dictado por voz** y nivel de inserción calculado.
  6. Historia clínica con evolución CIE-10 y anamnesis que el paciente firma por enlace. Al marcar una cita como "Atendido", actualiza el odontograma, descuenta insumos, redacta la evolución SOAP y registra el tratamiento en finanzas. Módulos de ortodoncia (Angle), odontopediatría (Frankl, dosis por peso) y medición de radiografías calibradas en mm.
  7. **Presupuestos en cuotas**, abonos, cierre de caja, recibo PDF firmado y membresías dentales con cobro recurrente.
  8. **Inventario por receta clínica** (descuenta anestesia, resinas y agujas al guardar la evolución), con alerta de stock bajo.
  9. **Liquidación de honorarios/comisiones** por porcentaje, por categoría o tratamiento, sobre lo cobrado o lo producido, con PDF y enlace privado para cada profesional (Pro). El reporte de ingresos llega por WhatsApp.
  10. **WhatsApp IA 24/7**: consulta la agenda real, agenda, confirma, mueve y cancela, recuerda la cita el día anterior y hace seguimiento postoperatorio. Usa el número propio, sin costo por mensaje y solo responde a pacientes que escribieron primero. Página de reservas propia; campañas de cumpleaños, recall a 6 meses y cobro de saldos.
  11. **Seguridad (V3):** Row Level Security en las 84 tablas, TLS 1.3, AES-256 en reposo, respaldo diario cifrado en Amazon S3 en otra región, PIN de dispositivo, roles (la recepción no ve datos clínicos) y exportación en 13 archivos CSV más un ZIP de imágenes. Auditoría: no encontrada.
  12. PWA para Windows, Mac, iPad e iPhone, app en Google Play y **modo offline** con sincronización.
- **Bolivia:** no encontrado.
- **IA:** dictado por voz en 3 módulos, resumen IA del paciente antes de la cita, notas SOAP, WhatsApp IA e importación de fichas en papel por foto.
- **Fortalezas:** profundidad clínica (periodontograma por voz, inventario por receta); precio bajísimo y sin cobro por doctor; seguridad bien documentada.
- **Brechas:** **sin multisucursal** y tope de 3 odontólogos (descarta a una cadena de 5 sedes); sin Bolivia ni facturación fiscal.
- **Diferenciación:** igualar el flujo "Atendido → odontograma + inventario + finanzas", pero en multisede.

---

## 3. OdontoDrive (Bolivia)

- **Páginas verificadas:** V1 = https://www.odontodrive.com/bo · V2 = https://www.odontodrive.com/funciones
- **Nivel de acceso: prueba con registro** (verificado V1). "Probar Demo Real", "Empieza ahora" y "Seleccionar [plan]" llevan todos a `/register`, y el plan Gratis no pide tarjeta. No hay demo pública.
- **País/mercado:** página específica para Bolivia: "El Software Clínico #1 para Odontólogos en Bolivia" (afirmación del propio sitio).
- **Precios (BOB/mes, verificado V1). Corrección: en /bo están en bolivianos, no en USD.**

  | Plan | Precio | Almacenamiento | Incluye |
  |---|---|---|---|
  | Gratis | Bs 0 | 100 MB | Odontograma, historia clínica, agenda, presupuestos, 15 consentimientos |
  | Básico | **Bs 35** | 1 GB | Consentimientos ilimitados |
  | Estándar | **Bs 70** | 5 GB "DICOM" | Alerta de deudores |
  | Avanzado | **Bs 140** | 20 GB | **Gestión multi-sillón** |
  | Premium | **Bs 210** | 40 GB | Onboarding y agenda para secretaria |

  Los límites son por almacenamiento, no por doctor ni sucursal. Los pagos se procesan con Stripe o MercadoPago.
- **12 áreas** (anunciado; V1 y V2):
  1. "Datos y Analítica".
  2. Agenda día/semana/mes y agenda de secretaria (Premium).
  3. **Multi-sillón** (Avanzado). Multisucursal: no encontrado.
  4. Historial y antecedentes (alergias, enfermedades).
  5. Odontograma interactivo (piezas ausentes y deciduas). Periodontograma: no encontrado.
  6. Historia clínica electrónica, control de evolución, **módulo de ortodoncia** (mensualidades, fotos) y recetario con membrete.
  7. Cotizador con PDF de marca; caja e ingresos/egresos; recordatorios de pago.
  8. Inventario: no encontrado en las páginas oficiales.
  9. Caja, ingresos, egresos y **comisiones de odontólogos**; recibos automáticos (V2).
  10. **Recordatorios automáticos por WhatsApp** en la agenda (V2). Reserva online: no encontrado.
  11. Respaldos automáticos, "encriptación de grado bancario" y exportación de la ficha (V1). Roles y auditoría: no encontrado.
  12. Vista adaptable para móvil y tablet.
- **Bolivia:** **precios en BOB** (verificado V1). SIAT/SIN y cobro con QR: no encontrados.
- **IA (V1, V2):** "Comparador de radiografías con Inteligencia Artificial" y "análisis radiográfico y asistencia clínica".
- **Fortalezas:** precio en Bs muy bajo; multi-sillón; foco declarado en Bolivia.
- **Brechas:** sin multisucursal; límites por GB; sin SIAT ni QR; descripción de IA vaga.
- **Diferenciación:** multisede + SIAT + QR, con precio por sede en Bs.

---

## 4. DentalApp (tudentalapp.com)

- **Páginas verificadas:** V1 = https://www.tudentalapp.com/producto · V2 = https://www.tudentalapp.com/precios · V3 = https://www.tudentalapp.com/faq (acordeones expandidos)
- **Nivel de acceso: prueba con registro** (verificado V1/V2). 14 días gratis sin tarjeta mediante `app.tudentalapp.com/register`.
- **País/mercado:** **Venezuela** primero y luego LatAm: cobros en USD y VES y WhatsApp de contacto +58 (V1, V3).
- **Precios (USD, verificado V1/V2):**
  - **Clínica** **$39,99/mes**: 1 sede y hasta 4 doctores.
  - **Individual ("Doctor Portable")** $9,99/mes.
  - **Doctor Extra** $9,99/mes.
  - **Sede Adicional** **$19,99/mes**.
  - El pago anual da 2 meses gratis; sin contrato anual.
  - **Estimado para 5 sedes:** $39,99 + 4 × $19,99 = **≈ $119,95/mes**, más doctores extra a $9,99 por encima de 4 (cálculo propio con los precios publicados).
- **12 áreas** (anunciado; V1 y V3):
  1. Visibilidad centralizada; "Control operativo".
  2. Agenda compartida multi-doctor y sala de espera.
  3. **Multisede**: filtros por ubicación, doctores por sede, agenda por sede y visibilidad centralizada. Sillones: no encontrado.
  4. Expediente con documentos, radiografías y fotos (carga desde el teléfono).
  5. Odontograma digital interactivo con historial. Periodontograma: no encontrado.
  6. Planes de tratamiento con precios y estados.
  7. Presupuestos, abonos, saldos y **caja en USD/VES**.
  8. Inventario: no encontrado.
  9. Reportes operativos y **liquidaciones por doctor** según cobros reales.
  10. **Recordatorios y seguimientos automatizados por WhatsApp**. Reserva online: no encontrado.
  11. Expedientes accesibles "según permisos"; administración de usuarios y sedes. Auditoría: no encontrado.
  12. Experiencia móvil web optimizada; **no es app nativa** de tienda (V3).
- **Particularidad:** "Doctor Portable": el doctor conserva su espacio profesional propio aunque cambie de clínica.
- **Bolivia/IA:** no encontrado.
- **Fortalezas:** precio por sede transparente y barato; multimoneda; modelo doctor/clínica separado.
- **Brechas:** sin inventario, periodontograma ni IA visibles; sin app nativa; orientado a Venezuela.
- **Diferenciación:** precio por sede comparable, más BOB/QR/SIAT e inventario.

---

## 5. DENTRIK

- **Páginas verificadas:** V1 = https://dentrik.com/ · V2 = https://dentrik.com/precios/ (incluye la pestaña "Tengo una clínica" y las preguntas frecuentes expandidas) · V3 = https://dentrik.com/seguridad/
- **Nivel de acceso: prueba con registro** (verificado V1/V2). "Probar gratis" lleva a `/checkout/?plan=automatiza`: 14 días del plan AUTOMATIZA y "No hay conversión automática a un plan pagado". Para clínicas se ofrece además una **demostración comercial** mediante un formulario (nombre, WhatsApp y número de odontólogos), que no se envió.
- **País/mercado:** hispanohablante; precios en USD. El país no se declara; el metadato `inLanguage` es "es-EC" (Ecuador, indicio débil).
- **Precios (USD/mes, verificado V2; anual = pagas 10 meses y usas 12):**
  - **Para odontólogos:**
    - **DIGITALIZA** $5: 50 pacientes activos, 1 odontólogo.
    - **ORGANIZA** $10: pacientes ilimitados, cartera, presupuestos PDF y plantillas de WhatsApp.
    - **HABLA** $15: dictado clínico, 1 especialidad y 1 usuario de recepción.
    - **AUTOMATIZA** $25: Copilot, todas las especialidades, recordatorios y reagendamiento.
  - **Para clínicas:**
    - **CONTROLA $50**: 3 odontólogos, 1 recepción y 1 sede; multiagenda y **multisillón**; caja, **comisiones y producción por profesional**; **producción por sillón**; dashboard del propietario.
    - **DOMINA $90**: 7 odontólogos, recepción ilimitada y **hasta 3 sedes**; dashboard, caja y cartera **multisede**; comparación de productividad entre sedes; **permisos jerárquicos**; **Copilot multisede y auditoría global**.
    - Extras: **+$5/mes por odontólogo adicional** y **+$15/mes por sede adicional** a partir de la cuarta.
  - **Estimado para 5 sedes:** DOMINA $90 + 2 × $15 = **≈ $120/mes** con 7 odontólogos, más $5 por cada odontólogo adicional (cálculo propio).
- **12 áreas** (anunciado; V1 y V2):
  1. Dashboard del propietario, rentabilidad y "Siguiente Paso Global".
  2. Agenda clínica con profesionales y disponibilidad; multiagenda.
  3. **Multisillón** y **multisede** (DOMINA), con comparación entre sedes.
  4. Ficha centrada en el paciente.
  5. Odontograma (manual en DIGITALIZA; por dictado en planes superiores). Periodontograma: no mencionado explícitamente; los "módulos de especialidad" no se detallan.
  6. Diagnósticos, plan de tratamiento, evolución y consentimientos.
  7. Presupuestos, pagos, abonos, saldos y cartera.
  8. Inventario: no encontrado.
  9. Caja, comisiones, producción por profesional y por sillón, cartera consolidada multisede.
  10. Plantillas de WhatsApp (ORGANIZA); recordatorios, seguimiento, reagendamiento y reactivación (AUTOMATIZA). Reserva online: no encontrado.
  11. Roles y permisos, separación por organización, **trazabilidad**, permisos jerárquicos y **auditoría global** (DOMINA). La página V3 es genérica, sin detalles técnicos.
  12. Acceso web, tablet y móvil.
- **Bolivia:** no encontrado.
- **IA (V1/V2):** dictado clínico en español que DENTRIK convierte en una sugerencia estructurada (odontograma, diagnóstico, plan, evolución) que el odontólogo **aprueba**; "Motor Siguiente Paso"; Copilot (multisede en DOMINA).
- **Fortalezas:** **el modelo de precios más alineado con una cadena de 5 sedes** (≈ $120/mes); auditoría y permisos jerárquicos; IA de voz con aprobación humana.
- **Brechas:** sin inventario visible; sin localización boliviana; país y empresa no identificados; página de seguridad vacía de detalles.
- **Diferenciación:** igualar su capa multisede a un precio similar y sumar SIAT/QR/BOB, inventario por sede y soporte local.

---

## 6. Odontosinc

- **Páginas verificadas:** V1 = https://www.odontosinc.com/ (preguntas frecuentes expandidas) · V2 = https://www.odontosinc.com/precios
- **Nivel de acceso: prueba con registro** (verificado V1/V2). 15 días gratis con todas las funciones y sin tarjeta mediante `/registro`. "Ver la demo" solo baja a una sección con capturas (`#demo`); no es una demo navegable. También ofrece una demostración por formulario de contacto (no se envió).
- **País/mercado:** **Colombia** (V1).
- **Precios (COP/mes, verificado V2; trimestral −10 %, anual −20 %; pago con Wompi: PSE, Nequi o tarjeta):**
  - **Básico $149.000**: 3 profesionales, hasta 500 pacientes.
  - **Pro $229.000**: 6 profesionales incluidos, +$20.000 por cada profesional adicional; pacientes ilimitados; WhatsApp Business opcional por +$89.000/mes.
  - **Premium $519.000**: 15 profesionales; WhatsApp Business, **asistente IA por WhatsApp**, reportes avanzados y **multi-sede**.
- **12 áreas** (anunciado; V1 y V2):
  1. Reportes y analítica avanzada (Premium).
  2. Agenda por profesional (día y semana) en tiempo real.
  3. **Multi-sede** (Premium). Sillones: no encontrado.
  4. Antecedentes, alergias y búsqueda instantánea.
  5. **Odontograma y periodontograma en todos los planes** (FDI, temporal y permanente, estado por superficie con historial).
  6. Evolución por sesión con CIE-10 y radiografías; planes de tratamiento desde el odontograma.
  7. Facturación, abonos, descuentos y saldo; cierre de caja.
  8. **Inventario con alertas** de escasez y de **vencimiento** (Pro).
  9. Cierre de caja y reportes. Comisiones: no encontrado.
  10. Recordatorios por WhatsApp, recordatorios en lote y campañas (Premium); **reservas online** con agenda pública (Pro).
  11. Datos aislados por clínica, acceso por rol (admin, odontólogo, recepción) y cifrado en tránsito. Auditoría: no encontrada.
  12. Funciona en computador, tablet y celular.
- **Extra destacable:** **módulo de esterilización** (ciclos de autoclave e indicadores químico y biológico **trazables hasta el paciente**). Cumplimiento: RIPS (Colombia).
- **Bolivia:** no aplica / no encontrado.
- **IA:** asistente con IA que responde por WhatsApp (Premium).
- **Fortalezas:** periodontograma en todos los planes; trazabilidad de esterilización; inventario con vencimientos.
- **Brechas:** multisede solo en el plan más caro (≈ COP 519.000); foco regulatorio en Colombia.
- **Diferenciación:** trazabilidad de esterilización, pero adaptada a las normas bolivianas, y multisede desde un plan medio.

---

## 7. DENTIDESK

- **Páginas verificadas:** V1 = https://www.dentidesk.com/ · V2 = https://www.dentidesk.com/dentidesk/feature · V3 = https://www.dentidesk.com/dentidesk/contact
- **Nivel de acceso: prueba con registro mediante formulario de contacto y demostración comercial** (verificado V1/V3).
  - "Prueba DENTIDESK gratis por 15 días": el botón "Comienza tu prueba gratuita" lleva a un **formulario de contacto** (nombre, correo, país —Bolivia está en la lista—, cantidad de doctores, mensaje).
  - "Solicitar demo gratis" abre WhatsApp (+56).
  - No hay autoservicio.
- **País/mercado:** **Chile** (Providencia, Santiago); LATAM; con presencia también en República Dominicana. (V1, V3)
- **Precios:** no publicados en las páginas verificadas.
- **12 áreas** (anunciado; V1 y V2):
  1. Resumen de agenda, atenciones y lo recaudado por período.
  2. Agenda personalizable y reprogramación.
  3. Campo "Sucursal" en la configuración (V2). "Multisucursal" y "usuarios administrativos ilimitados": **solo buscador (no verificado)**. Sillones: no encontrado.
  4. Pacientes: datos personales, anamnesis, examen odontológico, tratamiento, imágenes, informes y documentos.
  5. Odontograma con nomenclatura chilena, internacional o universal configurable por profesional (noticia del 13-08-2026, V1). Ficha de periodoncia (no se confirma un periodontograma gráfico).
  6. Fichas de especialidad (ortodoncia, cirugía ortognática, periodoncia), interconsultas y derivaciones.
  7. Presupuestos, pagos y facturación (configuración). Firma digital de consentimientos informados (banner de V1).
  8. **Insumos** (Administrador) (V2).
  9. Reportes de producción, recaudación, morosos y prestaciones; **liquidaciones de sueldo**; encuesta de satisfacción (V2).
  10. Agendamiento online como integración. **WhatsApp automático: "una de las próximas alternativas"** (noticia del 13-08-2026, V1), es decir, aún no disponible.
  11. Usuarios y **permisos** (V2). Auditoría: no encontrada.
  12. Apps en Google Play y App Store (V1).
- **Facturación (V1):** integración con el SII (Chile) e integración con Alegra para la DGII (República Dominicana, 14-05-2026). Reporte REMASEP (Minsal de Chile). **Bolivia/SIAT: no encontrado.**
- **IA:** no encontrada.
- **Fortalezas:** trayectoria de 10 años; fichas de especialidad; apps nativas.
- **Brechas:** WhatsApp no automatizado; sin IA; precios ocultos; sin localización boliviana.
- **Diferenciación:** WhatsApp automático e IA desde el primer día; precio público.

---

## 8. Dentalink

- **URL indicada:** https://softwaredentalink.com/comenzar → **404 "This page could not be found"** (verificado). Se registra como limitación.
- **Páginas verificadas:** V1 = https://www.softwaredentalink.com/ · V2 = https://www.softwaredentalink.com/planes
- **Nivel de acceso: demostración comercial** (verificado V2). La página de planes muestra un formulario "Cotiza o pide una demo gratis" (Bolivia figura en la lista de países), que no se envió. Preguntas frecuentes: "¿Es posible ver una demo? Sí, puedes coordinar una demo con el equipo de ventas." No hay prueba autoservicio.
- **País/mercado:** LATAM (Healthatom); "+15.000 clientes", "+20 países" (V2).
- **Precios:**
  - **La página LATAM no publica precios**: se cotiza; pago mensual, semestral o anual (V2).
  - **Contact Center IA: USD 50/mes**, hasta 80 conversaciones mensuales, solo para consultorios de un profesional (verificado V1).
  - Precios de México y Colombia (desde $800 MXN y desde $115.000 COP): **solo buscador (no verificado)**; esas páginas no se abrieron en esta pasada.
- **Planes (V2):**
  - **Esencial:** agenda, historia clínica, odontograma, presupuestos y control de pagos.
  - **Pro:** + gastos e inventario, **comisiones y multicentro**, informes de gestión, análisis de pacientes.
  - **Titanium:** + encuestas y campañas por email, panel de tareas críticas, ortodoncia.
- **12 áreas** (anunciado; V2):
  1. Reportes gráficos y en Excel.
  2. Control de agenda, confirmación de citas y agendamiento online.
  3. **Multicentro** (Pro). Sillones: no encontrado.
  4. Historia clínica, carga de imágenes y documentos, carga masiva de pacientes.
  5. **Odontograma y periodontograma.**
  6. Plantillas, consentimientos informados, ortodoncia, estética facial y videos educativos 3D.
  7. Pagos presenciales y en línea, créditos en línea, **cobro en cuotas**, gestión de convenios.
  8. **Gestión de inventario** (Pro) y laboratorios.
  9. Control de caja, gastos y **cálculo de pago a odontólogos**.
  10. Confirmación y agendamiento online; tareas automáticas de citas, morosidad y control; Contact Center IA (adicional).
  11. Usuarios ilimitados con **permisos por rol**; alojamiento en AWS; exportación de datos. Auditoría: no encontrada. Tras 15 días sin pago se bloquea el acceso, y a los 30 días **se elimina la cuenta**.
  12. Acceso desde PC, tablet y móvil (Windows, Mac, Linux).
- **Bolivia:** Bolivia aparece en el formulario de países (V2). SIAT, BOB y QR: no encontrados.
- **IA (V2):** "Todos los planes incluyen IA: dictado por voz, resumen clínico, simulador de sonrisa y Contralor IA, con 70 tokens en Esencial, 170 en Pro y 300 en Titanium". Adicionales: Contact Center IA, Análisis de RX con IA, Reportes IA y API. Clinical Copilot: "Próximamente".
- **Fortalezas:** el más completo de LATAM; IA incluida en todos los planes; multicentro con comisiones e inventario.
- **Brechas:** sin precio público para LATAM; IA medida en tokens y conversaciones; cuenta eliminada a los 30 días de impago; sin localización boliviana.
- **Diferenciación:** precio público por sede en Bs; política de datos más amable (sin borrado a los 30 días).

---

## 9. Kilto (Bolivia)

- **Páginas verificadas:** V1 = https://kilto.app/clinicas · V2 = https://kilto.app/ (precios y preguntas frecuentes expandidas) · V3 = https://kilto.app/funciones · V4 = https://kilto.app/demo
- **Nivel de acceso: demostración comercial** (verificado V1/V4). "Pedir mi demo" abre un formulario (nombre, negocio, celular, rubro, tamaño), que no se envió: "Una demo con sus propios datos y una semana de configuración gratis. Recién entonces empieza su mes." No hay prueba autoservicio.
- **País/mercado:** **Bolivia**: oficina en Av. Tropical, 4.º anillo, Equipetrol, **Santa Cruz de la Sierra**; empresa Virtus International LLC (Wyoming, EE. UU.). Es un producto **multirrubro** (clínicas dentales, consultorios, salones, barberías, gimnasios, academias, tiendas) con un módulo de odontología. (V1, V2)
- **Precios (BOB, verificado V2):**
  - "Desde **Bs 450/mes**": **Kilto Core** (agenda, clientes y cobros) con **5 operadores incluidos**.
  - Módulos: **Cuotas Bs 250/mes**; **Comisiones Bs 300/mes**. WhatsApp tiene precio publicado según el sitio, pero la cifra no quedó capturada.
  - "Más módulos, como **odontología, inventario, sucursales** o sitio web: **consulte precio**."
  - Ejemplo del sitio: Core + Comisiones = Bs 750/mes, o Bs 7.500/año (2 meses gratis).
  - Las funciones de IA consumen **créditos de IA** que se recargan aparte (V3).
- **12 áreas** (anunciado; V1 y V3):
  1. "Los números de todas [las sedes] en un panel"; resumen de finanzas exportable a CSV.
  2. **Agenda por profesional y por sala**, sin choques de horario.
  3. **Salas** + **varias sucursales** (módulo adicional): cada sede con su agenda, sus salas y su equipo, más un panel consolidado.
  4. Ficha de cliente con campos y etiquetas propios; **área de clientes** con usuario y contraseña.
  5. **Odontograma interactivo** y **periodontograma** (módulo adicional).
  6. Planes de tratamiento, historia clínica y alergias, notas, recetas, radiografías, cirugías e indicaciones, citas de control, expediente en PDF (módulo adicional).
  7. **Cobros con QR**, efectivo y transferencia; **planes de pago en cuotas**; membresías; anulaciones y devoluciones.
  8. **Stock** por producto, entradas y salidas, ajustes, mínimo de reposición.
  9. Reportes por profesional y **por sucursal**; **comisiones** automáticas con liquidaciones.
  10. **WhatsApp por la API oficial de Meta**: confirmaciones, recordatorios, bandeja compartida, agendar desde el chat, envíos programados. **IA que responde, agenda y reagenda** y deriva a una persona. Reservas en línea y sitio web con reservas.
  11. **Roles y permisos**; **registro de actividad** ("Quién hizo qué y cuándo, exportable"), es decir, auditoría.
  12. App móvil: cada profesional ve lo suyo en su teléfono; **funciona sin internet** y sincroniza al volver la señal.
- **Bolivia:** **BOB**, **cobros con QR**, oficina y soporte presencial en Santa Cruz. **SIAT/SIN: no encontrado.**
- **IA (V3):** asistente con IA dentro del sistema; respuestas IA por WhatsApp; **agentes de voz con IA** que hacen y atienden llamadas; campañas de marketing con IA; muro del equipo con IA.
- **Fortalezas:** **competidor local directo y fuerte**: Bs, QR, offline, multisucursal con panel, auditoría y IA; onboarding presencial.
- **Brechas:** no está especializado en odontología (el módulo dental se cotiza aparte); los precios de sucursales y odontología no son públicos; el costo total para 5 sedes es opaco; sin SIAT.
- **Diferenciación:** especialización dental profunda (periodontograma, flujo clínico-financiero) con precio público para 5 sedes y SIAT.

---

## 10. ASSILEM (Bolivia, Norvic Software)

- **Páginas verificadas:** V1 = https://norvicsoftware.com/assilem/precios/ (preguntas frecuentes expandidas) · V2 = https://norvicsoftware.com/assilem/ · V3 = https://norvicsoftware.com/assilem/software-dental-bolivia/ (artículo del 22-10-2026)
- **Nivel de acceso: demostración comercial** (verificado V1/V2). "Pedir una demostración gratuita" lleva a WhatsApp (+591 76980507). Preguntas frecuentes: "¿Puedo probar ASSILEM antes de contratarlo? Sí. Puedes pedir una demostración gratuita por WhatsApp".
- **País/mercado:** **Bolivia** (Norvic Software, empresa boliviana); también atiende a otros países de LATAM. Nació en Arauco Odontología SRL. Clínicas citadas: Arauco Odontología, Toco's Odontología, Vallejos Ugarte Odontología, Aledent. (V2, V3)
- **Precios (BOB, verificado V1):**
  - Sin precio fijo: depende de la **cantidad de consultorios, la cantidad de doctores y los módulos adicionales**.
  - **Por servicio**: cuota mensual fija **desde Bs 210/mes**.
  - **Venta directa**: pago único, a cotizar.
  - Módulos con costo extra: **asistente de IA (chat)**, **gestión de imágenes clínicas** e **inventarios**.
- **12 áreas** (anunciado; V1, V2 y V3):
  1. Estados financieros y reportes en PDF.
  2. Citas por **doctor, consultorio y horario**; horarios de trabajo por consultorio y doctor; estados (confirmada, atendida, no asistida).
  3. **Consultorios** como recurso con **utilidad (aprovechamiento) por consultorio**. **Multisede:** "Varias sedes, una sola información… todos trabajan sobre los mismos pacientes, la misma agenda y la misma caja" (V3).
  4. Registro con búsqueda avanzada; kardex del paciente.
  5. Odontograma digital y evolución. Periodontograma: no encontrado.
  6. Historial clínico; tratamientos **proyectados frente a ejecutados**; imágenes (radiografías, fotos y 3D, como módulo extra).
  7. **Presupuestos, contratos y planes de pago**; **anticipos**; cuentas por cobrar; kardex económico.
  8. **Inventarios** (módulo con costo extra).
  9. Producción por doctor y tratamiento; **utilidad por doctor y consultorio**; evolución patrimonial y flujo de caja (V3).
  10. **Recordatorios de citas por WhatsApp** automáticos. Reserva online: no encontrado.
  11. **Roles y permisos** con protección de datos clínicos; copias de seguridad automáticas. Auditoría: no encontrada.
  12. Navegador del celular, sin app (V3).
- **Bolivia:** **BOB** y soporte local. SIAT/SIN y cobro con QR: **no encontrados.**
- **IA:** chat en lenguaje natural sobre los datos de la clínica (módulo extra).
- **Fortalezas:** competidor local con referencias bolivianas reales; finanzas fuertes (contratos, anticipos, proyectado frente a ejecutado); multisede anunciada; opción de pago único.
- **Brechas:** precio opaco más allá de "desde Bs 210"; IA, imágenes e inventario como extras; sin SIAT, QR ni app.
- **Diferenciación:** precio público por sede con IA e inventario incluidos; SIAT y QR.

---

## 11. Open Dental (prueba)

- **Páginas verificadas:** V1 = https://www.opendental.com/trial.html (redirige a https://opendental.com/site/trial.html) · V2 = https://opendental.com/site/order.html
- **Nivel de acceso: instalación local** (verificado V1).
  - Instalador para Windows `TrialDownload-25-3-48.exe`; instala Open Dental, MySQL/MariaDB y la carpeta de imágenes en un servidor, con estaciones de trabajo opcionales.
  - La prueba **no expira**, está **limitada a 30 pacientes** e incluye una base vacía y una base demo con pacientes ficticios.
  - Sin códigos CDT, sin API y sin eServices.
- **País/mercado:** EE. UU. (y Canadá).
- **Precios (USD, verificado V2):** **$199/mes por sede u oficina** (contrato de 12 meses). Cubre todas las computadoras de la sede y **hasta 3 dentistas**; incluye soporte telefónico, actualizaciones, módulo de imágenes, formularios web, portal del paciente y recordatorios por email. Fuera de EE. UU. se remite a otra página de tarifas. La capacitación se cobra aparte. **Estimado para 5 sedes con tarifa de EE. UU.: ≈ $995/mes** (cálculo propio).
- **12 áreas:** las páginas verificadas solo describen la prueba y el pedido. Portal del paciente, recordatorios por email e imágenes: anunciados (V2). El resto no se verificó.
- **Bolivia/IA:** no encontrado.
- **Fortalezas:** prueba ilimitada en tiempo con base demo; producto maduro.
- **Brechas:** instalación en servidor Windows; enfoque en EE. UU. (CDT, seguros); precio por sede alto; en inglés.
- **Diferenciación:** nube, español y normativa boliviana, sin servidor propio.

---

## 12. Panel Dental (dental.proyecciondigital.org)

- **Páginas verificadas:** V1 = https://dental.proyecciondigital.org/es/ · V2 = …/es/funcionalidades/periodontograma/ · V3 = …/es/funcionalidades/ai-ready/ · V4 = …/es/funcionalidades/facturacion/
- **Nivel de acceso: demo pública con credenciales publicadas** (verificado V1). La portada ofrece "Prueba Panel Dental ahora. Sin pedir nada, sin tarjeta" y **publica usuario y contraseña de demo**: una clínica con 2 sucursales, 60 pacientes y 6 meses de agenda, recorrible como administrador, doctor, higienista o recepcionista. **No se inició sesión** (regla del encargo), así que solo se describe la página de marketing.
- **País/mercado:** España (€, Verifactu) y República Dominicana (NCF). Es un CRM de una agencia de marketing ("Soporte directo con la agencia que opera tu marketing").
- **Precios (verificado V1):** **el núcleo cuesta 0 € para siempre** ("Sin cuotas por sillón, dentista o paciente"). Es **código abierto** (repositorio github.com/panel-dental) y se **instala en servidor propio**. La versión gestionada en la nube está anunciada como "Próximamente". Algunos módulos opcionales podrían ser de pago en el futuro.
- **12 áreas** (anunciado; V1–V4):
  1. Dashboard con KPIs **por sucursal y por profesional**.
  2. Agenda con arrastrar y soltar, **sucursales** y solapes.
  3. **Multiclínica con varias sucursales** (agenda y stock por sucursal; profesionales que rotan entre locales; selector global).
  4. Ficha con perfil médico, alergias y alertas.
  5. Odontograma con superficies. **Periodontograma SEPA** de 6 sitios, movilidad de Miller, furca, pronóstico por diente, histórico inmutable con comparador e índices calculados al cerrar (V2).
  6. Historial clínico por fecha; plan de tratamiento con sesiones cobrables.
  7. Presupuestos línea a línea **firmables en línea** por enlace público; **planes de pago con cuotas** (V4).
  8. Stock por sucursal.
  9. Facturación por series con edición auditada; **comisiones automáticas**; reportes.
  10. **WhatsApp por la API oficial de Meta**: confirmación al crear la cita, recordatorios a 24 h y 2 h con botones Sí/No; integración con Chatwoot y Evolution API; API REST con webhooks.
  11. Edición auditada (facturación) y permisos por usuario (agente IA).
  12. Uso desde móvil y tablet (navegador).
- **Facturación fiscal:** NCF (República Dominicana) y Verifactu (España) como módulos activables. **Bolivia/SIAT: no.**
- **IA (V3):** "Agente de IA" por texto o voz que busca pacientes y huecos libres, agenda, mueve, cancela y registra cobros, **pidiendo confirmación** antes de actuar. Inconsistencia: la sección de módulos de V1 dice "Asistente de IA — PRÓXIMAMENTE".
- **Fortalezas:** multiclínica de verdad; código abierto y núcleo gratuito; periodontograma avanzado; WhatsApp con botones.
- **Brechas:** se instala en servidor propio (requiere técnico); enfoque España/RD; soporte de agencia; madurez desconocida.
- **Diferenciación:** misma capacidad multisede, pero en nube gestionada con soporte boliviano.

---

## 13. Odonto.ar

- **Páginas verificadas:** V1 = https://odonto.ar/ (preguntas frecuentes expandidas) · V2 = https://odonto.ar/demo (los 7 pasos se recorrieron)
- **Nivel de acceso: demostración interactiva** (verificado V2), además de prueba con registro: 30 días gratis, 3 usuarios, sin tarjeta, mediante `/register`.
- **Demo interactiva de 7 pasos (~5 min), con datos ficticios, recorrida sin enviar nada:**
  1. **Turnos online:** la paciente "Sofía" elige motivo (control y limpieza de 30 min, dolor de muela, obturación de 60 min), día y hora en `odonto.ar/turnos/consultorio-sur`. En la app real el paciente confirma DNI y teléfono.
  2. **Agenda:** vista día/semana/mes con 2 profesionales; turnos que se arrastran entre horarios y profesionales; estados (agendado, confirmado, completado, cancelado, no asistió).
  3. **Odontograma:** estados (realizado, planificado, a rehacer); tipos de marca (cara, corona, extracción, conducto, implante, perno, fractura, prótesis, movilidad); material; vista clásica o anatómica; dentición adulta, infantil o mixta; **historial inmutable de quién cambió qué diente y cuándo**.
  4. **Obras sociales:** grilla de precios por plan (p. ej. OSDE 210) con lo que paga la obra social y el coseguro del paciente.
  5. **Presupuesto:** prácticas por pieza con cobertura calculada (IOMA), copago, total y descarga en PDF.
  6. **Reportes:** facturación por mes y por profesional, prácticas más realizadas, cancelaciones y no-show, pacientes nuevos, cobros por obra social y deuda pendiente.
  7. **Resumen:** historia clínica con más de 70 campos, importación desde Excel, **permisos granulares por rol**, aislamiento de datos (RLS), radiografías, **recordatorios "semi automáticos" por WhatsApp**, mensajería interna, tickets y **chatbot con IA para ayudar** al usuario.
- **País/mercado:** Argentina.
- **Precios (USD/mes, cobrados en ARS por Mercado Pago, verificado V1). Corrección: aparece un plan Individual que la primera pasada no recogía:**
  - **Individual $29** (1 usuario, ≈ ARS 45.240).
  - **Profesional $49** (5 usuarios, permisos por persona, mensajería interna).
  - **Clínica $99** (10 usuarios).
  - La renovación es manual: si no se renueva, los datos quedan en solo lectura.
- **12 áreas:** las anteriores, más (11) datos cifrados, servidores fuera de Argentina y copias periódicas, y (12) PC, tablet y celular. **Multisucursal, inventario y comisiones: no encontrados.**
- **Bolivia:** no aplica.
- **Fortalezas:** **la mejor demo pública del grupo** (guiada, sin registro); trazabilidad por diente; convenios y coberturas.
- **Brechas:** sin multisede ni inventario; WhatsApp solo semiautomático; centrado en Argentina.
- **Diferenciación:** demo guiada similar con datos de una cadena boliviana; convenios con cajas de salud y seguros privados de Bolivia.

---

## 14. Dentrisoft

- **Páginas verificadas:** V1 = https://dentrisoft.com/ (preguntas frecuentes expandidas) · V2 = https://dentrisoft.com/demo · V3 = https://dentrisoft.com/u/demo-clinica · V4 = https://dentrisoft.com/admin/login
- **Nivel de acceso: demo pública, solo del portal del paciente** (verificado V2/V3).
  - V2 dice "Demo disponible ahora · Sin registro requerido", **pero el botón "Explorar panel admin" lleva a `/admin/login`** (V4): un formulario de correo y contraseña **sin credenciales publicadas**. **El panel administrativo no es público.**
  - La parte pública (V3) es la página "Clínica Dental Sonrisas": un **formulario de solicitud de cita** (datos personales, documento, servicio, profesional, fecha y hora preferidas, primera visita). Promete que "Te contactaremos en máximo 2 horas", así que no es un calendario en vivo. El pie dice "Powered by DentalApp" (observación; no se sabe la relación con tudentalapp.com).
  - Prueba de 14 días: los botones de V2 abren WhatsApp y los de V1 llevan al login. Demo guiada de 30 minutos por WhatsApp.
- **País/mercado:** **Colombia** (Ibagué; desarrollado por Enkrevolt).
- **Precios (COP/mes, verificado V1/V2):**
  - **Starter $89.900**: 1 doctor, recordatorios por WhatsApp, dominio personalizado.
  - **Professional $169.900**: hasta 5 doctores, cartera inteligente, **planes de pago con interés configurable**, reportes financieros, RIPS y **multi-sede**.
  - **Enterprise**: personalizado, doctores ilimitados, API, capacitación presencial, SLA 99,9 %.
- **12 áreas** (anunciado; V1 y V2):
  1. Dashboard unificado con resumen del día.
  2. Agenda multi-dentista con filtros por dentista, estado y servicio; confirmación por WhatsApp.
  3. **Multi-sede** (Professional). Sillones: no encontrado.
  4. Importación de pacientes desde Excel.
  5. **Odontograma interactivo.** Periodontograma: no encontrado.
  6. Historia clínica, evoluciones, consentimientos con firma digital, validación de CUPS y CIE-10.
  7. **Cartera por antigüedad** con alertas, abonos, planes de pago con interés.
  8. Inventario: no encontrado.
  9. **Liquidación automática de honorarios** por dentista, período y porcentaje "con auditoría completa"; margen por dentista; reportes PDF.
  10. Recordatorios por WhatsApp; portal de reservas (en la demo es un formulario de solicitud).
  11. Encriptado, backups automáticos y datos conservados 30 días tras cancelar. Roles: no detallados.
  12. Celular, tablet y computador.
- **Bolivia:** no aplica. **IA:** no encontrada ("agenda inteligente" es solo una frase de marketing).
- **Fortalezas:** cartera y honorarios muy desarrollados; multi-sede en un plan medio; precio transparente.
- **Brechas:** la demo "sin registro" es en realidad solo un formulario de paciente; tope de 5 doctores en Professional; sin inventario ni IA.
- **Diferenciación:** una demo administrativa realmente pública; inventario e IA.

---

## Productos adicionales relevantes

### 15. Doctocliq (LATAM)

- **Página verificada:** V1 = https://www.doctocliq.com/planes-y-precios
- **Nivel de acceso: prueba con registro** (verificado V1): plan Gratis sin límite de tiempo y **7 días de prueba del plan Avanzado sin tarjeta**. También hay un botón "Solicitar demo".
- **Mercado:** LATAM (Perú y México con teléfonos de ventas; funciones exclusivas de Perú).
- **Precios (USD/mes, verificado V1; anual = 2 meses gratis; impuestos incluidos solo en Perú y México):**

  | Plan | Precio | Límites | Destacados |
  |---|---|---|---|
  | Gratis | $0 | 30 pacientes o citas al mes | — |
  | Individual | **$19** | 50 pacientes/mes, 1 GB | Agendamiento en línea |
  | Básico | **$29** | Pacientes ilimitados, 5 GB | Caja básica, consentimientos, firma electrónica, ortodoncia |
  | Avanzado | **$49** | 20 GB | Caja avanzada, **permisos de seguridad**, **multicajas**, **inventario**, órdenes de laboratorio, estadísticas |

  - Usuarios doctores "según contratación"; 8 usuarios gratuitos para personal administrativo o doctores temporales.
  - **Sucursales o sedes adicionales:** "Adicional" en Básico y Avanzado (con costo extra).
  - **Soyla IA**, **Marketing** y **Facturación electrónica** (Ecuador, Perú, México, Colombia y RD) se contratan aparte.
  - Recordatorios de WhatsApp gratis (50 o 100 al mes) solo en planes semestrales o anuales.
- **Áreas anunciadas (V1):** odontograma y periodontograma en todos los planes; app para iOS y Android; agendamiento en línea; presupuesto por fases; formulario de registro de pacientes por QR o enlace.
- **IA:** "Soyla IA: la asistente… responderá tus chats 24/7 y agendará citas" (adicional).
- **Aporte diferencial:** freemium agresivo y módulos a la carta; facturación electrónica en 5 países (Bolivia no está).

### 16. Clinic Cloud (España, multiespecialidad)

- **Página verificada:** V1 = https://clinic-cloud.com/tarifas
- **Nivel de acceso:** **prueba con registro** ("Alta gratuita" en la comparativa de V1); Enterprise mediante contacto comercial.
- **Precios (EUR/mes + IVA, oferta Black Friday vigente, verificado V1). Corrección: la primera pasada traía cifras de 14,5/24,5/39,5 €.**
  - **Mini** 24,5 € (antes 49 €).
  - **Pro** 39,5 € (antes 79 €): presupuestos, liquidaciones, stock y reportes.
  - **Max** 54,5 € (antes 109 €): incluye el **módulo de odontograma**.
  - **Enterprise**: a convenir, para franquicias y grupos.
  - **Noa Notes**: 20 €/mes por usuario.
- **Áreas anunciadas (V1):** agendas 1/3/5/ilimitadas según plan; permisos por niveles de seguridad; odontograma y periodontograma; facturación electrónica (TicketBai, Verifactu); recordatorios; reserva online con Doctoralia.
- **IA:** Noa Notes, Noa Summary y Noa Evidence.
- **Caso Dentix (más de 100 clínicas) y "aplicación central para franquicias":** solo buscador y mención en V1 como funcionalidad extra; no verificado en detalle.

### 17. Dentally (Reino Unido, nube; Henry Schein One)

- **Página verificada:** V1 = https://www.dentally.com/en-gb/pricing
- **Nivel de acceso: demostración comercial** (formulario "Book a demo"; no se envió).
- **Precios (Reino Unido, por sede, con 3 gabinetes, sin IVA, verificado V1). Corrección: la primera pasada daba £134/£238/£346.**
  - **Starter £285/mes**, **Essentials £410/mes**, **Pro £551/mes**.
  - El precio se ajusta con un control deslizante por número de gabinetes (1 a 9).
- **Áreas anunciadas:** usuarios ilimitados; "Multi-site capability"; Dentally Portal (formularios digitales, reserva online, kiosco).
- **IA:** notas clínicas con IA: prueba limitada en Starter, 45 transcripciones por gabinete al mes en Essentials y 90 en Pro (no disponible en Irlanda ni Irlanda del Norte).
- **Aporte:** precio por sede y por gabinete, un modelo de referencia para cadenas.

### 18. Denticon (Planet DDS, EE. UU., DSO/multisede)

- **Página verificada:** V1 = https://www.planetdds.com/denticon/
- **Nivel de acceso: demostración comercial** (enlace "GET STARTED" a una página de reserva de demo).
- **Precios:** no se ven en V1. "Desde ~US$795/mes" y las tarifas de los agentes IA (US$0,25–0,33/min por sede) son **solo buscador (no verificado)**.
- **IA (verificado V1):** AI Voice Perio y AI Voice Restorative Charting (charting por voz); AI Assist; **DentalOS AI Agents**, que "make outbound calls… to confirm appointments and schedule overdue patients — automatically, across every location"; recordatorios automáticos de saldo.
- **Aporte:** referencia de gestión empresarial multisede con agentes de voz por sede.

### 19. boliviadental.com (Bolivia)

- **Páginas verificadas:** V1 = https://boliviadental.com/ (preguntas frecuentes expandidas, simulador recorrido y selector "Pago Mensual" activado)
- **Nivel de acceso: demostración interactiva** (verificado V1), además de registro (`/registro`, "Crear cuenta y probar gratis"). La portada incluye un simulador público de 3 pestañas (recorrido sin enviar nada):
  - **Odontograma FDI:** clic en las 5 caras de una pieza y elección de estado (caries, resina, endodoncia, corona, implante). Genera un **presupuesto automático en Bs con "Precios Sugeridos COB"**, p. ej. resina Bs 250 y profilaxis Bs 180.
  - **WhatsApp 1-Clic:** genera un mensaje de recordatorio para copiar o enviar. Es manual; **no hay envío automático**.
  - **Cobros QR (Bs):** simula un **QR Simple** interoperable (Banco Unión, BCP, BNB, Mercantil Santa Cruz, FIE, Sol) y su confirmación de pago.
- **Precios (BOB, verificado V1):**

  | Plan | Odontólogos | Anual | Mensual |
  |---|---|---|---|
  | Plan Profesional | 1 | **Bs 990/año** | **Bs 99/mes** |
  | Clínica Pro | hasta 3 | **Bs 1.990/año** | ≈ Bs 199/mes (deducido del ahorro anual de Bs 398) |
  | Clínica Plus | hasta 6 | **Bs 3.990/año** | ≈ Bs 399/mes (deducido del ahorro de Bs 798) |

  El pago se hace por QR Simple o transferencia.
- **Áreas anunciadas (V1):**
  - Odontograma FDI en 2D y 3D con historial.
  - Ortodoncia con arcos, fotos y **cuotas mensuales**.
  - Caja, recibos y **planes de pago fraccionados por etapas**.
  - **Liquidación por especialista**.
  - **Recetario COB** con matrícula y firma digital.
  - **Inventario** (carpules, resinas) con alertas.
  - Reportes y métricas; seguimiento de pacientes sin próxima cita.
  - SSL, backups descargables; navegador en celular.
  - Multi-consultorio: "El Plan Clínica Pro y el Plan Clínica Plus permiten trabajar con varios odontólogos y agendas en paralelo dentro de la misma cuenta". **No anuncia multisede.**
- **Bolivia:** **BOB, QR Simple, COB** y soporte e inducción por WhatsApp en Bolivia. **SIAT: no encontrado** (emite "recibos", no facturas).
- **IA:** no encontrada.
- **Aporte:** el producto más "boliviano" en lo visual y en el cobro; tope de 6 odontólogos y sin multisede.

### Contexto SIAT (Bolivia)

- El SIAT es la plataforma de facturación del SIN. Existen proveedores autorizados con API (https://factura.bo/ , https://cucu.bo/ ; norma: https://www.impuestos.gob.bo/wp-content/uploads/2025/10/RND11.pdf). Estas fuentes son de la primera pasada (buscador); no se reabrieron.
- **En la segunda pasada se buscó "SIAT", "Impuestos Nacionales" y "factura electrónica" en todas las páginas descargadas: ningún producto anuncia integración con el SIAT.** Los que facturan electrónicamente lo hacen para Chile, República Dominicana, España, Colombia (RIPS) y los países de Doctocliq.

---

## Resumen de la cobertura Bolivia-específica (verificado)

| Producto | SIAT/SIN | BOB | QR | Presencia en Bolivia |
|---|---|---|---|---|
| Kilto | No encontrado | **Sí** (desde Bs 450/mes) | **Sí** | Oficina en Santa Cruz; soporte presencial |
| ASSILEM | No encontrado | **Sí** (desde Bs 210/mes) | No encontrado | Empresa boliviana; clientes bolivianos citados |
| boliviadental.com | No encontrado | **Sí** (Bs 99/mes) | **Sí (QR Simple)** | Recetario COB; soporte por WhatsApp |
| OdontoDrive | No encontrado | **Sí** (Bs 0–210/mes) | No encontrado | Página /bo |
| Dentalink | No encontrado | No | No | Bolivia en el formulario de cotización |
| DENTIDESK | No encontrado | No | No | Bolivia en el formulario de contacto |
| Resto | No | No | No | — |

## Resumen de IA anunciada (verificado salvo indicación)

| Producto | IA anunciada |
|---|---|
| DentinCloud | Asistente IA: citas del día, resumen del paciente, crea citas con aprobación |
| NacarOS | Voz para odontograma y periodontograma, resumen pre-cita, notas SOAP, WhatsApp IA, importación de fichas en papel |
| DENTRIK | Dictado en español → sugerencia estructurada aprobada por el odontólogo; Copilot (multisede en DOMINA) |
| Dentalink | Dictado, resumen clínico, simulador de sonrisa y Contralor IA en todos los planes (por tokens); Contact Center IA, IA en RX y Reportes IA como extras |
| Kilto | Asistente interno, IA en WhatsApp, agentes de voz, campañas IA (por créditos) |
| ASSILEM | Chat IA sobre los datos de la clínica (módulo extra) |
| OdontoDrive | Comparador y análisis de radiografías con IA (descripción vaga) |
| Odontosinc | Asistente IA por WhatsApp (Premium) |
| Panel Dental | Agente IA por voz o texto que agenda y cobra con confirmación (marcado "próximamente" en otra sección) |
| Odonto.ar | Chatbot IA de ayuda al usuario |
| Doctocliq | Soyla IA (adicional) |
| Clinic Cloud / Dentally / Denticon | Notas clínicas IA / transcripción IA / voz, RX IA y agentes de llamadas |
| DENTIDESK, Dentrisoft, DentalApp, boliviadental, Open Dental | No encontrada |

---

## Ideas de diferenciación (síntesis para el cliente piloto de 5 sucursales)

1. **SIAT nativo** (mediante un proveedor autorizado) + **BOB** + **QR Simple** con conciliación por sucursal. Nadie tiene los tres: Kilto y boliviadental tienen BOB y QR, pero ninguno tiene SIAT.
2. **Multisede con consolidado y precio público por sede.** Hoy las referencias son DENTRIK (≈ US$120/mes para 5 sedes) y DentalApp (≈ US$120/mes). Kilto y ASSILEM cotizan las sucursales en privado.
3. **Sillones y consultorios como recurso agendable con producción y utilidad por sillón** (lo anuncian DENTRIK, ASSILEM, Kilto y OdontoDrive).
4. **WhatsApp automático incluido** por la API oficial, con botones Sí/No (como Panel Dental y Kilto), frente al "1-Clic" manual de boliviadental o el "próximamente" de DENTIDESK.
5. **Flujo clínico-financiero en un clic** ("Atendido" → odontograma + inventario + evolución + cobro, como NacarOS), funcionando en multisede.
6. **Auditoría visible** (Kilto, DENTRIK DOMINA y Odonto.ar por diente) y permisos jerárquicos por sede.
7. **Modo offline** (Kilto, NacarOS) para sedes con conectividad irregular.
8. **Demo pública guiada** (como la de 7 pasos de Odonto.ar) con una cadena boliviana ficticia de 5 sedes.
9. **Trazabilidad de esterilización** (Odontosinc) y **recetario COB** (boliviadental), como cumplimiento local.
10. **IA incluida sin tokens ni créditos** (Dentalink cobra por tokens; Kilto por créditos): voz para el charting y analítica comparativa entre sedes.

---

## Tabla resumen final

| Producto | Nivel de acceso (verificado) | Resumen de precios | Top 3 fortalezas | Principales brechas |
|---|---|---|---|---|
| DentinCloud | Prueba con registro (gratis hasta 100 pacientes) | 34 €/mes o 309 €/año (España); $39/mes o $349/año (EE. UU.); 4 usuarios | WhatsApp automático completo; asistente IA que agenda; plan gratuito sin límite de tiempo | Clínicas separadas sin consolidado; sin inventario ni comisiones; proveedor turco sin presencia local |
| NacarOS | Prueba con registro (30 días Pro) | Básico $0 (20 pacientes); Pro US$14,99/mes (11,99 anual), 3 odontólogos + 1 recepción | Periodontograma por voz; inventario por receta y honorarios; seguridad (RLS, AES-256, offline) | **Sin multisede**; tope de 3 odontólogos; sin Bolivia |
| OdontoDrive (BO) | Prueba con registro | **Bs 0 / 35 / 70 / 140 / 210 por mes** (según GB) | Precio en Bs; multi-sillón; comisiones y ortodoncia | Sin multisede; sin SIAT ni QR; IA vaga |
| DentalApp | Prueba con registro (14 días) | Clínica US$39,99 (1 sede, 4 doctores) + US$19,99 por sede + US$9,99 por doctor | Multisede barata; multimoneda USD/VES; liquidaciones por doctor | Sin inventario, IA ni periodontograma; no es app nativa; foco en Venezuela |
| DENTRIK | Prueba con registro (14 días); demostración comercial para clínicas | Odontólogo $5–25; CONTROLA $50; **DOMINA $90 (3 sedes, 7 odontólogos)**; +$15 por sede y +$5 por odontólogo | Multisede con comparación entre sedes; auditoría y permisos jerárquicos; IA de voz con aprobación | Sin inventario; país y empresa no identificados; sin Bolivia |
| Odontosinc | Prueba con registro (15 días) | COP 149.000 / 229.000 / 519.000 (multi-sede solo en Premium) | Periodontograma en todos los planes; esterilización trazable; inventario con vencimientos | Multisede cara; foco en Colombia |
| DENTIDESK | Prueba con registro mediante formulario de contacto + demostración comercial | No publicado | Fichas de especialidad; apps nativas; liquidación de sueldos | WhatsApp automático "próximamente"; sin IA; sin precio público |
| Dentalink | Demostración comercial (/comenzar = 404) | Sin precio LATAM; Contact Center IA USD 50 (1 profesional) | Suite más completa; IA en todos los planes; multicentro con comisiones e inventario | Precio opaco; IA por tokens; cuenta borrada a los 30 días de impago |
| Kilto | Demostración comercial | Core desde **Bs 450/mes** (5 operadores); Cuotas Bs 250; Comisiones Bs 300; odontología y sucursales a cotizar | Bs + QR + offline; multisucursal con auditoría; IA y agentes de voz; soporte en Santa Cruz | Multirrubro (dental como módulo); costo total opaco; sin SIAT |
| ASSILEM | Demostración comercial (WhatsApp) | Desde **Bs 210/mes** o pago único; IA, imágenes e inventario con costo extra | Empresa boliviana con referencias; contratos, anticipos, proyectado frente a ejecutado; multisede anunciada | Precio opaco; extras de pago; sin SIAT, QR ni app |
| Open Dental | Instalación local (prueba sin vencimiento, 30 pacientes) | US$199/mes por sede (hasta 3 dentistas, contrato de 12 meses) | Prueba ilimitada con base demo; madurez; portal del paciente | Servidor Windows; foco en EE. UU.; en inglés; caro para 5 sedes |
| Panel Dental | Demo pública con credenciales publicadas (no usadas) | Núcleo 0 € (código abierto, en servidor propio); nube "próximamente" | Multiclínica real; periodontograma SEPA; WhatsApp con botones y agente IA | Requiere servidor y técnico; foco en España y RD; madurez incierta |
| Odonto.ar | **Demostración interactiva** (7 pasos) + prueba de 30 días | US$29 / 49 / 99 por mes (1 / 5 / 10 usuarios), pagado en ARS | La mejor demo pública; trazabilidad por diente; obras sociales | Sin multisede ni inventario; WhatsApp semiautomático |
| Dentrisoft | Demo pública **solo del portal del paciente** (el panel admin pide login) | COP 89.900 (1 doctor) / 169.900 (5 doctores, multi-sede) / Enterprise | Cartera y honorarios con auditoría; multi-sede en plan medio; RIPS | Demo admin no pública; sin inventario ni IA; foco en Colombia |
| Doctocliq | Prueba con registro (7 días + plan gratis) | US$0 / 19 / 29 / 49; sedes, IA y facturación como adicionales | Freemium; facturación electrónica en 5 países; apps nativas | Sedes e IA con costo extra; sin Bolivia |
| Clinic Cloud | Prueba con registro ("alta gratuita") | 24,5 / 39,5 / 54,5 € + IVA (oferta); Enterprise a convenir | Notas clínicas IA (Noa); permisos por niveles; facturación fiscal en España | Odontograma solo en Max; foco en España |
| Dentally | Demostración comercial | £285 / 410 / 551 al mes por sede (3 gabinetes) | Precio por sede y gabinete; portal del paciente; notas IA | Reino Unido; sin español |
| Denticon | Demostración comercial | No publicado en la página (≈ US$795/mes solo buscador) | Gestión empresarial multisede; voz y agentes IA por sede | Caro; EE. UU.; sin español |
| boliviadental.com | **Demostración interactiva** + registro | **Bs 99/mes** o Bs 990 / 1.990 / 3.990 al año (1 / 3 / 6 odontólogos) | BOB + QR Simple; recetario COB; inventario y liquidación por especialista | Sin SIAT; tope de 6 odontólogos; sin multisede; WhatsApp manual |

*Todas las funciones son "anunciadas" por los fabricantes. Las marcadas como verificadas se leyeron en la página oficial indicada el 2026-11-10; ninguna se probó como usuario.*
