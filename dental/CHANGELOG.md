# Changelog

Formato basado en *Keep a Changelog*. Versionado semántico.

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
