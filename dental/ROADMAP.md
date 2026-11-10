# Roadmap

Prioridades: **P0** bloquea el piloto · **P1** el piloto lo necesita en el primer trimestre · **P2** hace el producto comercializable · **P3** es diferencial.

## Etapa 0 — Investigación y base (✅ entregado en v0.1, 10-nov-2026)

- Investigación de 20 productos, con 4 demos públicas probadas, y mapa legal boliviano preliminar.
- Arquitectura multiempresa con RLS, roles por sucursal y auditoría inmutable.
- Pacientes, agenda, odontograma, historia clínica, presupuestos, cobros con verificación, panel por sucursal, reportes, importación y exportación Excel, asistente con herramientas, superadministrador, respaldos verificados.
- 97 pruebas automatizadas: 90 unitarias, de integración y de respaldo con PostgreSQL real, y 7 en navegador real.

## Etapa 1 — Piloto controlado en la clínica (objetivo: 4–6 semanas)

**P0**
1. **Revisión humana** de esta entrega: flujos, textos, permisos por rol y catálogo de prestaciones con precios reales.
2. **Despliegue de staging en Railway** (requiere autorización): base PostgreSQL gestionada, dominio con HTTPS, variables de entorno y copias diarias cifradas fuera de Railway.
3. **Importación real:**
   - plantilla de Excel acordada con la clínica;
   - limpieza de duplicados;
   - validación con `dryRun` antes de guardar.
4. **MFA (TOTP)** para propietario, administración y contabilidad. Recuperación de contraseña por correo con enlace de un solo uso.
5. **Consentimientos versionados:**
   - texto, versión, fecha y evidencia, por finalidad (atención, recordatorios, marketing);
   - consentimiento informado clínico firmado por procedimiento.
6. **Capacitación** por rol y manual corto en español.

**P1**
1. **WhatsApp Business Cloud API:**
   - plantillas de recordatorio con botones Confirmar o Reprogramar que actualizan la cita;
   - registro de entregas;
   - baja con un clic.
2. **Periodontograma:** profundidad de sondaje, recesión, sangrado y movilidad, con instantáneas comparables.
3. **Archivos clínicos** (radiografías y fotos) en almacenamiento privado con URL firmadas y auditoría de descargas.
4. **Inventario por sucursal:**
   - insumos, lotes y vencimientos;
   - consumo por prestación;
   - alertas de stock;
   - transferencias entre sucursales.
5. **Liquidación de honorarios:**
   - base configurable (producción o cobro);
   - períodos cerrados e inmutables;
   - exportación.
6. **Kanban de sala de espera** por sucursal (llegó → en sillón → atendido) y vista semanal de la agenda.
7. **Recetas e informes en PDF** con datos del profesional y matrícula.

## Etapa 2 — Producto comercializable (SaaS)

**P1–P2**
1. **Facturación SIAT** mediante un proveedor autorizado: emisión al cobrar, anulación, contingencias y reportes. Antes, una decisión legal (D-13).
2. **Conciliación bancaria:**
   - importar el extracto (CSV o Excel del banco) y emparejar por referencia y monto;
   - más adelante, API bancaria autorizada.
3. **Portal del paciente:**
   - reserva online con disponibilidad real;
   - confirmar o reprogramar;
   - ver presupuestos aprobados y pagos;
   - documentos autorizados.

   Requiere autenticación separada y el mismo aislamiento.
4. **Compras, proveedores y laboratorios protésicos:** órdenes, estados y costos por caso.
5. **Suscripciones SaaS:**
   - límites por plan (ya implementados);
   - facturación del servicio;
   - prueba gratuita;
   - incorporación guiada (*onboarding*).
6. **Prueba de penetración externa** y política de respuesta a incidentes.
7. **Observabilidad:** registros estructurados sin datos personales, métricas y alertas.

## Etapa 3 — Diferenciación

1. Asistente con IA activado: dictado de evoluciones con aprobación del profesional y resúmenes pre-cita (minimizados).
2. Modo sin conexión para sucursales con internet irregular (lectura de agenda y registro diferido de pagos).
3. App móvil (PWA instalable) para profesionales.
4. Analítica avanzada: retención de pacientes, rentabilidad por sillón y previsión de ingresos.
5. Interoperabilidad (FHIR) cuando se reglamente la Historia Clínica Única Digital (Plan Nacional de Salud 2026–2030).

## Criterio de avance entre etapas

Cada etapa termina solo con:
- pruebas automatizadas en verde;
- `TEST_REPORT.md` actualizado;
- revisión humana de los cambios sensibles (seguridad, cobros, registro clínico);
- `CHANGELOG.md` actualizado.
