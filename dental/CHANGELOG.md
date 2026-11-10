# Changelog

Formato basado en *Keep a Changelog*. Versionado semántico.

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
