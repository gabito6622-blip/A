# Dentalia — plataforma odontológica multisucursal (SaaS)

Software de gestión para clínicas odontológicas, pensado para una red de 5 sucursales en Bolivia y comercializable como SaaS multiempresa.

> **Estado: v0.1 (desarrollo).** No está desplegado en producción. Usa solo datos ficticios hasta completar la revisión legal y de seguridad (ver `ROADMAP.md`).

## Qué incluye

- Agenda sin solapes.
- Pacientes.
- Odontograma FDI e historia clínica inmutable.
- Presupuestos y cobros en Bs con verificación de QR y transferencias.
- Panel comparativo por sucursal y reportes.
- Controles "volver a citar", calidad de la atención, sala de espera.
- Caja por cajero con arqueo y liquidación de honorarios.
- Periodontograma.
- Presupuestos v2 con enlace para el paciente.
- Reserva online y portal del paciente.
- Bioseguridad (limpieza y esterilización).
- Inventario por sucursal con lotes, vencimientos, transferencias, conteos y compras.
- Laboratorio protésico con costos que se descuentan en los honorarios.
- Recetas, certificados y documentos PDF con huella y verificación pública.
- Mensajes automáticos (simulados fuera de producción) con confirmación por enlace.
- Vista semanal, tipos de cita, citas recurrentes e historial del paciente.
- Asistente con herramientas.
- Superadministrador SaaS.

El detalle está en `CHANGELOG.md` y `ARCHITECTURE.md`.

## Puesta en marcha (desarrollo, Codespaces o local)

Requisitos: Node 22 y PostgreSQL 14 o superior.

```bash
cd dental
npm ci
cp .env.example .env    # ajusta DATABASE_URL
npm run seed            # migra y crea la clínica demo (datos ficticios)
npm run dev:server      # API en http://localhost:3100  (docs: /api/docs)
npm run dev:web         # interfaz en http://localhost:5173
```

Usuarios demo (contraseña `Demo2026dental`, **solo para desarrollo**):

| Correo | Rol |
|---|---|
| `propietaria@demo.local` | Propietaria, todas las sucursales |
| `gerente@demo.local` | Administrador |
| `contabilidad@demo.local` | Contabilidad |
| `recepcion.lpz@demo.local` | Recepción La Paz Centro (también `.sur`, `.eal`, `.cbb`, `.scz`) |
| `dr.mendoza@demo.local` | Odontólogo (La Paz Centro y La Paz Sur); `dra.vargas@demo.local` y otros |
| `limpieza.lpz@demo.local` | Limpieza y apoyo (solo Bioseguridad) |
| `superadmin@demo.local` | Superadministrador SaaS |

Lado del paciente (demo): `http://localhost:5173/reservar/sonrisa-andina-demo` y `/mi-cuenta/sonrisa-andina-demo`. En desarrollo, los códigos de verificación se ven en **Configuración → Mensajes** (nunca se envían).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run typecheck` | Verifica los tipos del servidor y de la interfaz |
| `npm test` | Pruebas unitarias, de integración y de respaldo contra PostgreSQL real (crea y borra `dental_test`) |
| `npm run test:e2e` | Pruebas en navegador real (crea y borra `dental_e2e`) |
| `npm run build` y `npm start` | Compila y sirve la API y la interfaz en un solo puerto |
| `npm run migrate` | Aplica las migraciones pendientes |
| `npm run backup -- ./backups` | Respaldo `pg_dump`, cifrado si se define `BACKUP_PASSPHRASE` |
| `TARGET_DATABASE_URL=… npm run restore -- archivo` | Restaura en una base vacía |

## Despliegue (requiere autorización)

`Dockerfile` y `railway.json` están listos para un servicio de Railway con directorio raíz `dental` y una base PostgreSQL. Variables:
- `DATABASE_URL`;
- `NODE_ENV=production`;
- opcionales: `ANTHROPIC_API_KEY` para el chat del asistente, `SESSION_TTL_HOURS`.

Las migraciones se aplican al arrancar. **No se desplegó nada todavía.**

## Documentación

`INVESTIGACION_COMPETIDORES.md` · `RESEARCH.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `ROADMAP.md` · `BACKLOG.md` · `TEST_REPORT.md` · `CHANGELOG.md`
