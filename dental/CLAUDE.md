# Dentalia: instrucciones para Claude

Rigen además las reglas del dueño del `CLAUDE.md` de la raíz. Este archivo agrega lo propio de Dentalia, el SaaS odontológico de `dental/`.

## Antes de tocar
- Leé `ARCHITECTURE.md`, `DECISIONS.md` (D-01 en adelante) y `BACKLOG.md` (pendientes por versión).
- Leé el último bloque de `CHANGELOG.md`.
- Lo que espera decisión del dueño o de la clínica está marcado con ⚠ en el BACKLOG: no lo decidas vos.

## Reglas propias
- **Sin datos clínicos reales.** La semilla demo (`server/src/cli/seed.ts`) es ficticia; la contraseña de todos los usuarios demo es `Demo2026dental`.
- **Sin despliegue:** Railway sigue sin autorización.
- **Sin afirmaciones legales:** recetas, consentimientos, SIAT y datos de salud quedan para revisión legal.
- **Multiclínica:**
  - toda tabla nueva lleva `clinic_id`, RLS `tenant_isolation`, claves foráneas compuestas `(x_id, clinic_id)` y GRANT mínimos a `dental_app`;
  - los registros que no deben cambiar son de solo inserción (`forbid_mutation()`).

  Las pruebas `tests/db-hardening.test.ts` y `tests/route-guard.test.ts` fallan si alguien se olvida de esto.
- **Rutas:**
  - siempre con `route({ perm, summary, zod })`;
  - toda escritura llama a `audit()`;
  - por sucursal, con `requireBranch` y `allowedBranches`.
- **Una sola fórmula del saldo:** `patient_money()` o la vista `patient_money_v`.
- **Dinero en centavos.** Las fechas van en la zona de la clínica (`America/La_Paz`).
- **Excel:** solo por `server/src/lib/xlsxSafe.ts` (`xlsxBuffer` o `streamXlsx`).
- **Migraciones:** numeración correlativa en `server/migrations/`; nunca edites una ya publicada en la rama.
- **Interfaz:**
  - español de Bolivia, celular primero;
  - las tablas largas usan `cards-sm`;
  - el menú tiene `group`;
  - los diálogos usan `useAsk()`, nunca `window.prompt`;
  - porcentajes con `pct()` y fechas sin hora con `fmtDay()`.

## Probar
- `npm run typecheck`
- `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/dental_test npx vitest run` (unas 650 pruebas, ~2 min)
- `npm run build:web && E2E_DATABASE_URL=…/dental_e2e E2E_PORT=<puerto libre> npx playwright test --trace off`:
  - es obligatorio el `--trace off`;
  - no instales Playwright;
  - las e2e no pueden depender de la fecha: pedí horarios a `/api/availability`.
- **Carga:** `npm run perf:seed` / `npm run perf:bench`, sobre una base cuyo nombre contenga «perf».
- **PostgreSQL caído:** `pg_ctlcluster 16 main start`.

## Al cerrar una versión
Actualizá:
- `CHANGELOG.md`;
- `TEST_REPORT.md` (totales y carga);
- `DECISIONS.md`;
- `BACKLOG.md`;
- `README.md` y `ARCHITECTURE.md` si cambió la operación.

La guía para trabajar con equipos en paralelo es la habilidad `gabostore-equipos` (sirve para los dos proyectos), con el encargo común de `docs/equipos/ENCARGO_COMUN_DENTALIA.md`.
