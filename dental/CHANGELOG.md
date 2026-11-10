# Changelog

Formato basado en *Keep a Changelog*. Versionado semántico.

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
