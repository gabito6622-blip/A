# Investigación de competidores — software de gestión odontológica

- **Fecha de consulta:** 10 de noviembre de 2026.
- **Cliente piloto:** clínica boliviana con 5 sucursales, varios odontólogos, recepción y administración.
- **Anexos con la evidencia completa** (en `docs/research/`):
  - Segunda ronda (§9): F — DentinCloud (solo información pública; no se pudo entrar a la cuenta de prueba), G — otras demos y el lado del paciente, H — DentalPin a fondo, I — Panel Dental a fondo.
  - A — fuentes públicas de 19 productos.
  - B — demo de DentalPin.
  - C — demo de Panel Dental.
  - D — demos de Odonto.ar y Dentrisoft.
  - E — marco legal boliviano.
  - Capturas de pantalla en `docs/research/capturas/`: 64 imágenes de demos públicas con datos ficticios, solo para uso interno de investigación; no se redistribuyen.

> **Cómo leer este informe**
> - **Probado**: lo hicimos en una demo pública, con datos ficticios.
> - **Visto**: aparece en la interfaz, pero no lo ejecutamos.
> - **Anunciado**: lo afirma el fabricante en su web; no lo comprobamos.
> - Las notas del 1 al 10 se dan **solo** para lo probado. El resto figura como *no evaluado*.

---

## 1. Resumen ejecutivo

1. **Nadie resuelve bien la operación multisucursal boliviana completa.** Ningún producto revisado anuncia a la vez:
   - multisede con panel consolidado;
   - cobro en bolivianos;
   - QR bancario con verificación;
   - facturación SIAT.

   Los productos bolivianos (Kilto, ASSILEM, boliviadental, OdontoDrive /bo) cobran en Bs, pero ninguno anuncia SIAT. Las suites más completas (Dentalink, DENTRIK) no cobran en Bs.
2. **La integridad de la agenda es una debilidad generalizada.**
   - En **DentalPin** y **Panel Dental** probamos guardar citas superpuestas (mismo profesional, mismo sillón, mismo paciente) y **se guardaron**. DentalPin solo mostró un aviso. Panel Dental no mostró ninguno.
   - En **Odonto.ar** la demo también permite superponer turnos y reservar días pasados.
   - Es la oportunidad de diferenciación más clara y verificable.
3. **Ninguna demo probada detectó pacientes duplicados** (mismo nombre y teléfono) en DentalPin y Panel Dental. Esto genera expedientes partidos.
4. **El odontograma es el punto fuerte del mercado.** DentalPin, Panel Dental y Odonto.ar tienen odontogramas FDI con superficies y estados; obtuvieron 8/10. El periodontograma solo estaba operativo en Panel Dental.
5. **La verificación de pagos por QR o transferencia no existe como flujo.** Ningún producto revisado separa "pago registrado" de "pago verificado en el banco". Esto es clave en Bolivia, donde el comprobante del paciente no prueba el ingreso.
6. **La IA ya es una expectativa**, pero:
   - suele cobrarse aparte (por tokens o créditos);
   - suele enviar datos a proveedores externos.

   El copiloto de DentalPin fue el mejor ejemplo probado: consultó la agenda real y pide confirmación antes de escribir.

**Recomendación:** construir sobre cuatro pilares verificables. Así se hizo en la primera entrega (ver `TEST_REPORT.md`).
- Integridad garantizada por la base de datos: agenda sin solapes, cobros idempotentes, registros clínicos inmutables.
- Multisede real con permisos por sucursal.
- Flujo boliviano de cobro con verificación dual.
- Asistente que solo usa datos reales y propone acciones en vez de ejecutarlas.

---

## 2. Método y limitaciones

| Paso | Herramienta | Resultado |
|---|---|---|
| Acceso a demos | Playwright (Chromium headless) desde el contenedor | La red bloqueaba los dominios. Se pidió y obtuvo permiso para habilitarlos y luego se navegaron las 4 demos públicas. |
| Páginas comerciales | Playwright y curl (solo GET; en los clics se bloquearon las peticiones distintas de GET) | Se verificaron los precios y las funciones anunciadas de 19 productos. |
| Código de DentalPin | `git clone` del repositorio público | Se revisó la arquitectura y la licencia. **No se reutilizó código** (ver §5). |
| Marco legal | Gaceta, SIN, BCB, SEDES La Paz, Lexivox | Mapa preliminar con marcadores de confianza (anexo E). |

**Límites respetados:**
- No se crearon cuentas, no se pagó nada y no se aceptaron contratos.
- No se usaron credenciales distintas de las publicadas por cada proveedor.
- No se eludieron controles.
- No se ingresaron datos reales.

**Limitaciones de cobertura:**
- Solo usamos el rol administrador de cada demo, así que los permisos por rol de los competidores quedan *no evaluados*.
- Panel Dental envía WhatsApp reales al crear citas. Usamos un número ficticio y los envíos constaron como fallidos.
- En DentalPin y Panel Dental quedaron registros ficticios llamados "Prueba Investigación". Las demos se reinician periódicamente.

---

## 3. Software investigado y nivel de acceso

| # | Producto | País o mercado | Nivel de acceso | Qué pudimos hacer |
|---|---|---|---|---|
| 1 | DentalPin | España / global (código BSL 1.1) | **Demo pública** (credenciales publicadas) + código publicado | Probado: ~35 min, 9 de 12 áreas |
| 2 | Panel Dental | España / Rep. Dominicana | **Demo pública** (credenciales publicadas) | Probado: 9 de 12 áreas |
| 3 | Odonto.ar | Argentina | **Demostración interactiva** (7 pasos) + prueba con registro | Probados los 7 pasos |
| 4 | Dentrisoft | Colombia | **Demo pública solo del portal del paciente**; el panel administrativo pide inicio de sesión | Probado el portal, sin enviar la reserva |
| 5 | DentinCloud | España / EE. UU. (empresa turca) | Prueba con registro | Solo información pública |
| 6 | NacarOS | LATAM | Prueba con registro (30 días) | Solo información pública |
| 7 | OdontoDrive /bo | Bolivia (página local) | Prueba con registro | Solo información pública |
| 8 | DentalApp | Venezuela | Prueba con registro (14 días) | Solo información pública |
| 9 | DENTRIK | LATAM | Prueba con registro + demostración comercial | Solo información pública |
| 10 | Odontosinc | Colombia | Prueba con registro (15 días) | Solo información pública |
| 11 | DENTIDESK | LATAM | Formulario de contacto + demostración comercial | Solo información pública |
| 12 | Dentalink | Chile / LATAM | Demostración comercial (`/comenzar` devolvía 404) | Solo información pública |
| 13 | Kilto | Bolivia (Santa Cruz) | Demostración comercial | Solo información pública |
| 14 | ASSILEM (Norvic) | Bolivia | Demostración comercial (WhatsApp) | Solo información pública |
| 15 | Open Dental | EE. UU. | **Instalación local** (prueba sin vencimiento, 30 pacientes, Windows) | Solo información pública |
| 16 | Doctocliq | LATAM | Prueba con registro + plan gratuito | Solo información pública |
| 17 | Clinic Cloud | España | Prueba con registro | Solo información pública |
| 18 | Dentally | Reino Unido | Demostración comercial | Solo información pública |
| 19 | Denticon | EE. UU. (DSO) | Demostración comercial | Solo información pública |
| 20 | boliviadental.com | Bolivia | Demostración interactiva + registro | Solo información pública |

Precios publicados, con su fuente (detalle en el anexo A):
- **Bolivia:**
  - OdontoDrive: Bs 0–210/mes.
  - boliviadental: Bs 99/mes.
  - ASSILEM: desde Bs 210/mes.
  - Kilto: desde Bs 450/mes; el módulo dental y las sucursales se cotizan aparte.
- **Referencias multisede:**
  - DENTRIK DOMINA: US$90 por 3 sedes, más US$15 por cada sede adicional (≈ US$120 por 5 sedes).
  - DentalApp: US$39,99 más US$19,99 por sede.
  - Open Dental: US$199 por sede.

---

## 4. Matriz de funcionalidades

### 4.1 Notas de lo probado (1–10, solo con evidencia)

| Área | DentalPin | Panel Dental | Odonto.ar | Dentrisoft | **Nuestra plataforma (v0.1)** |
|---|---|---|---|---|---|
| 1. Dashboard y navegación | 8 | 7 | no evaluado | no evaluado | Panel consolidado por sucursal (probado) |
| 2. Agenda y disponibilidad | 6 (guarda solapes con aviso; fuera de horario falla sin mensaje) | 5 (guarda solapes sin aviso; el horario no limita) | 7 (permite solapes y días pasados) | 2 (los horarios no cargan) | Solapes imposibles por profesional, sillón y paciente; horario y bloqueos validados (89+7 pruebas) |
| 3. Consultorios y sucursales | 4 (sin multisede) | 6 (consolidado suma bien; sin comparativa) | no evaluado | no evaluado | 5 sucursales, permisos por sucursal y comparativo |
| 4. Pacientes | 6 (sin detección de duplicados; la búsqueda distingue tildes) | 6 (sin detección de duplicados) | no evaluado | no evaluado | Duplicados por CI, teléfono y nombre; búsqueda sin tildes |
| 5. Odontograma / periodontograma | 8 / no evaluado (no instalado) | 8 / 8 | 8 / no existe | no evaluado | FDI permanente y temporal, 5 superficies, estados, historial inmutable / periodontograma pendiente |
| 6. Historia clínica y tratamientos | 7 | no evaluado | no evaluado | no evaluado | Evoluciones inmutables con enmiendas y antecedentes versionados |
| 7. Presupuestos, cuotas y cobros | 7 (sin plan de cuotas) | 7 (permite cobrar un presupuesto en borrador) | 6 (montos cortados en el móvil) | no evaluado | Cuotas, sin sobrepago, idempotencia y verificación dual |
| 8. Inventario | no evaluado (no instalado) | no evaluado | no evaluado | no evaluado | Pendiente (backlog P1) |
| 9. Finanzas, reportes y comisiones | 6 (falló el informe de cobros) | 6 | 5 (filtros inoperantes) | no evaluado | Cobrado, producción, por cobrar y comisión estimada |
| 10. WhatsApp y reservas | no evaluado | 7 (envío automático real) | 7 (turnos online) | 3 (es solo una solicitud) | Recordatorios con consentimiento por wa.me; API oficial pendiente |
| 11. Seguridad, permisos y auditoría | 4* (solo inspección) | no evaluado (solo administrador) | no evaluado | no evaluado | RLS, roles por sucursal, CSRF, bloqueo y auditoría inmutable (probado) |
| 12. Móvil | 5 (agenda ilegible) | 7 | 6 | 5 | Barra inferior, sin desborde horizontal (prueba e2e) |
| IA | 8 (una pregunta; respondió con datos reales) | no evaluado | — | — | Herramientas con permisos; propone en vez de ejecutar |

### 4.2 Capacidades anunciadas (sin probar)

Marcas: ✓ anunciado · ✗ no aparece en las páginas leídas (no prueba que no exista) · $ con costo extra · ? sin dato

| Producto | Multisede consolidado | Inventario | Periodontograma | Comisiones / liquidación | WhatsApp automático | IA | Bs | QR | SIAT | Auditoría |
|---|---|---|---|---|---|---|---|---|---|---|
| DentinCloud | ✗ | ✗ | ? | ✗ | ✓ | ✓ | ✗ | ✗ | ✗ | ? |
| NacarOS | ✗ | ✓ | ✓ (voz) | ✓ | ✓ (IA) | ✓ | ✗ | ✗ | ✗ | ? |
| OdontoDrive /bo | ✗ | ? | ? | ✓ | ? | ✓ (vaga) | ✓ | ✗ | ✗ | ? |
| DentalApp | ✓ | ✗ | ✗ | ✓ | ? | ✗ | ✗ | ✗ | ✗ | ? |
| DENTRIK | ✓ (comparación) | ✗ | ? | ? | ? | ✓ | ✗ | ✗ | ✗ | ✓ |
| Odontosinc | ✓ (Premium) | ✓ | ✓ | ? | ✓ (Premium) | ✓ | ✗ | ✗ | ✗ | ? |
| DENTIDESK | ? | ? | ? | ✓ | ✗ (próximamente) | ✗ | ✗ | ✗ | ✗ | ? |
| Dentalink | ✓ | ✓ | ? | ✓ | ✓ $ | ✓ (tokens) | ✗ | ✗ | ✗ | ? |
| Kilto | ✓ (a cotizar) | ? | ? | ✓ $ | ✓ | ✓ (créditos) | ✓ | ✓ | ✗ | ✓ |
| ASSILEM | ✓ | ✓ $ | ? | ? | ? | ✓ $ | ✓ | ✗ | ✗ | ? |
| Dentrisoft | ✓ (plan medio) | ✗ | ? | ✓ | ? | ✗ | ✗ | ✗ | ✗ | ✓ |
| Doctocliq | ✓ $ | ? | ? | ? | ? | ✓ $ | ✗ | ✗ | ✗ | ? |
| boliviadental | ✗ | ✓ | ? | ✓ | ✗ (manual) | ✗ | ✓ | ✓ | ✗ | ? |

---

## 5. Análisis del código de DentalPin y su licencia

- **Stack:**
  - backend en FastAPI, SQLAlchemy asíncrono y Alembic, con migraciones por módulo;
  - frontend en Nuxt 4 con Nuxt UI;
  - ~60 módulos instalables con un registro de permisos y un bus de eventos;
  - 30 ADR documentados.
- **Multiempresa:** filtran por `clinic_id` en la aplicación. Su postura documentada es que "una consulta solo por id es un bug de seguridad". **No usan RLS en la base de datos.** Nosotros sí: es nuestra segunda capa (ver `DECISIONS.md`, D-03).
- **Copiloto:**
  - reverifica el RBAC en cada herramienta;
  - enmascara los datos de salud antes de enviarlos al proveedor de IA;
  - pide confirmación antes de escribir.

  Tomamos estos **principios**, no el código.
- **Licencia: BSL 1.1.** El "Additional Use Grant" prohíbe usarlo para ofrecer un SaaS comercial de gestión de clínicas dentales cuyo valor provenga sustancialmente del software. Pasa a Apache 2.0 a los 4 años de cada publicación. **Conclusión: no se copió ni se adaptó código, recursos ni interfaz de DentalPin.** Toda la implementación de este repositorio es original. Si en el futuro conviniera usar su código, haría falta una licencia comercial del titular.

---

## 6. Hallazgos para el diseño

### 6.1 Mejores flujos observados (inspiración funcional)
- **Kanban de sala de espera** (DentalPin, Panel Dental): agendada → llegó → en sillón → atendida.
- **Plan de tratamiento → presupuesto → aceptación con firma → facturación parcial por tratamiento** (DentalPin).
- **Historial "inmutable" por diente** (Odonto.ar) y **odontograma con estados existente/planificado** (DentalPin).
- **Copiloto con datos reales y confirmación previa** (DentalPin).
- **Confirmación por WhatsApp con botones** (Panel Dental, Kilto).
- **Demo guiada de 7 pasos** (Odonto.ar): la mejor experiencia de venta del mercado.

### 6.2 Funciones indispensables para la clínica piloto
1. Agenda multisucursal sin solapes, con horario por profesional y sucursal.
2. Ficha de paciente única para toda la red, con detección de duplicados.
3. Odontograma FDI con historial e inmutabilidad (requisito del reglamento del SEDES La Paz).
4. Presupuesto con cuotas → tratamiento realizado → cargo → cobro, y saldo exacto.
5. Cobros en Bs: efectivo confirmado, y transferencia o QR verificados por otra persona.
6. Panel comparativo por sucursal y permisos por rol y sucursal.
7. Recordatorios solo con consentimiento y sin datos clínicos en el mensaje.

### 6.3 Problemas observados en la competencia (a evitar)
- **Solapes de citas guardados** (DentalPin, Panel Dental, Odonto.ar).
- **Duplicados de pacientes sin aviso** (DentalPin, Panel Dental).
- **Fallos silenciosos:** una cita fuera de horario no se guarda y no aparece ningún mensaje (DentalPin).
- **Textos sin traducir y errores técnicos en inglés** (DentalPin); **página de error 500** al vencer la sesión (Panel Dental).
- **Móvil:**
  - agenda ilegible (DentalPin);
  - montos cortados (Odonto.ar).
- **Auditoría incompleta:** no registra cambios del odontograma ni presupuestos (Panel Dental).
- **Cobrar un presupuesto en borrador** (Panel Dental).
- **Seguridad del login:** en una ocasión el correo y la contraseña quedaron en la URL de DentalPin, cuando se envió antes de que cargara la página.
- **Precios opacos o extras por módulo** (Kilto, ASSILEM, Dentalink).

### 6.4 Oportunidades de diferenciación
1. **Integridad garantizada por la base de datos**, demostrable en una venta: "intenta superponer dos citas".
2. **Flujo boliviano de cobro:** QR o transferencia **pendiente → verificado por otra persona**, sin referencias bancarias duplicadas, con caja diaria por sucursal y conciliación bancaria futura.
3. **SIAT a través de un proveedor autorizado.** Ningún competidor lo anuncia (ver anexo E, plazos del SIN de 2026).
4. **Multisede con precio público por sede** y comparativo real: ingresos, producción, ocupación, inasistencia y conversión de presupuestos.
5. **"Recuperar huecos":** cruzar la lista de espera con los horarios libres del día. No lo vimos en ningún competidor.
6. **IA incluida y prudente:** solo datos reales, minimización de datos, propuestas que la persona confirma y sin diagnóstico.
7. **Cumplimiento local visible:**
   - consentimientos versionados;
   - registro de lecturas del expediente;
   - retención de 10 años o más;
   - enmiendas en lugar de ediciones.

### 6.5 Funciones que faltan en el mercado
- Verificación de pagos con control dual y bloqueo de referencias bancarias duplicadas.
- Cruce automático de lista de espera con huecos libres.
- Alertas médicas (alergias, anticoagulantes) en la cabecera de la ficha, separadas de los datos administrativos que ve recepción.
- Registro de **quién vio** cada expediente.
- Facturación SIAT integrada en un software dental.

---

## 7. Recomendación

1. Seguir con la plataforma propia (TypeScript + PostgreSQL), **sin código de terceros con licencia restrictiva**.
2. Prioridades del roadmap (`ROADMAP.md`):
   - (P0) puesta en marcha controlada del piloto con importación de datos y capacitación;
   - (P1) WhatsApp Cloud API con consentimiento, inventario por sucursal, periodontograma, consentimientos firmados y MFA;
   - (P1) facturación SIAT a través de un proveedor autorizado, tras una decisión legal y comercial;
   - (P2) portal del paciente y reserva online, conciliación bancaria y app móvil.
3. Antes de vender a terceros:
   - validación legal (anexo E, lista "Pendiente de verificación legal");
   - prueba de penetración externa;
   - piloto de 4–6 semanas en las 5 sucursales.

## 8. Fuentes

Todas las URL, fechas y evidencias están en los anexos A–E. Las capturas de las demos públicas están en `docs/research/capturas/`; el nombre de cada archivo indica producto, número y tema.

---

## 9. Segunda ronda (10-nov-2026): demos a fondo y lado del paciente

| Anexo | Producto | Acceso | Qué se probó |
|---|---|---|---|
| H | DentalPin | Demo pública | Agenda semanal y tablero de estados, recall, planes por sesiones, presupuesto con descuentos y versiones, enlace público al paciente, copiloto (5 preguntas), informes, módulos |
| I | Panel Dental | Demo pública | Periodontograma, inventario y compras, finanzas y comisiones, presupuesto y firma, agenda con arrastre, permisos, auditoría; WhatsApp solo en lectura (la demo envía mensajes reales) |
| G | boliviadental.com | El widget de la portada (la "demo" real pide inicio de sesión) | Odontograma, simulación de QR y WhatsApp |
| G | Open Dental | Demos oficiales de reserva online y portal del paciente | Reserva de paciente existente y nuevo, portal completo |
| G | AgendaPro (Chile), Doctoralia (México) | Reserva pública real, detenida antes de enviar datos | Experiencia de reserva en el celular |
| G | MyDentalPMS | Demo beta sin inicio de sesión | Lista de espera, riesgo de inasistencia, ficha de ingreso |
| F | DentinCloud | Cuenta de prueba aportada por el usuario | **No se pudo entrar**: pide código de clínica, teléfono y verificación humana de Cloudflare. Solo información pública |

### 9.1 Errores confirmados en la competencia (que nuestra plataforma debe evitar, y en parte ya evita)

| Hallazgo | Dónde | Nuestra plataforma |
|---|---|---|
| Al arrastrar una cita se superpone con otra de la misma doctora, sin aviso | Panel Dental | Imposible: restricción en la base de datos (probado) |
| Descuento del 150 % aceptado: total negativo, sin auditoría | Panel Dental | El descuento no puede superar el importe (restricción y validación); todo cambio queda auditado |
| Al crear la v2 de un presupuesto, la v1 sigue aceptable | DentalPin | Pendiente: R2-13 |
| Saldo del paciente distinto según la pestaña (0 € y 100 €) | DentalPin | Un solo cálculo del saldo; pendiente una prueba que compare todas las vistas (R2-11) |
| Producción "sin doctor" al registrar una sesión | DentalPin | El cargo lleva siempre al profesional que realizó el tratamiento |
| Horas del asistente desplazadas una hora (UTC); propuesta de cancelar una cita con ID nulo | DentalPin | Zona de la clínica en todas las herramientas; las propuestas se validan en el servidor (reforzar con R2-20) |
| Índices periodontales calculados sobre 192 sitios aunque se midan 18; acepta "564" en un campo de máximo 15 | Panel Dental | A construir con los índices sobre lo medido (PE-03, PE-04) |
| El stock no coincide con la suma de los lotes; SKU repetido | Panel Dental | A construir con esa invariante probada (IN-01, IN-02) |
| Sin apertura ni cierre de caja ni arqueo | Panel Dental | A construir (FI-01) |
| La auditoría no registra inventario, periodontograma ni descuentos | Panel Dental | Auditoría de todas las operaciones (principio vigente) |
| QR dibujado; "Simular pago" lo marca como cobrado sin verificar | boliviadental | Pago pendiente → verificado por otra persona (probado) |
| Reserva en días pasados; error de código "123546" frente a "123456" | Open Dental | Disponibilidad con el mismo motor de la agenda (no ofrece el pasado) |
| La reserva rápida no agrega la cita ("Operatory: undefined") | MyDentalPMS | — |
| Urgencia artificial ("podrían agotarse") y una barbería en el directorio dental | AgendaPro | Tono honesto (R11) |

### 9.2 Lo mejor que vimos (inspiración funcional, sin copiar)
- **Tiempos de la cita:** llegó, en sillón, terminada. Con ellos se mide la espera, la puntualidad y la duración real (DentalPin).
- **Recall:** cola de llamadas por mes con motivo, prioridad e intentos. Al terminar una cita se ofrece programar el control (DentalPin).
- **Planes por sesiones:** cada sesión realizada genera su cargo (DentalPin).
- **Enlace público del presupuesto** con verificación por los 4 últimos dígitos del celular y registro de "visto" (DentalPin).
- **Compras con recepción parcial y rechazo con motivo; lotes con vencimiento y consumo del más próximo a vencer** (Panel Dental).
- **Periodontograma** de 6 sitios con borrador y cierre (Panel Dental).
- **Reserva en el celular:** hoja inferior, fotos de los profesionales y "pagar y agendar" (AgendaPro). Portal del paciente completo: citas, saldo, planes, documentos y familia (Open Dental).

### 9.3 Requisitos resultantes
Están en los anexos G (R1–R32), H (R2-01 a R2-44) e I (PE, IN, FI, WA, RP). Se resumen y priorizan en `BACKLOG.md` (sección "Ronda 2").
