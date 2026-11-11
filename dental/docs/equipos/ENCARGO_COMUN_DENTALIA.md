# Encargo común para los equipos de Dentalia (léelo completo)

> Plantilla usada en v0.4 a v0.7. Antes de usarla, actualizá la versión base y el rango de migraciones congeladas.

Trabajas en **Dentalia**, una plataforma SaaS odontológica multiempresa y multisucursal (clínica piloto: 5 sucursales en Bolivia). El producto vive en `dental/` dentro de tu copia de trabajo (worktree) del repositorio. Estás en tu propia rama: **no** trabajes en `/workspace/A` (es la copia del integrador), solo en tu worktree.

**PRIMER PASO OBLIGATORIO:** tu worktree puede haberse creado desde `main` (que no tiene `dental/`). Antes de nada, ejecuta en la raíz del worktree:

```
git reset --hard claude/sharp-albattani-cc2tst
```

Así partes de la versión 0.6 integrada. Tu rama no tiene trabajo propio todavía, así que no pierdes nada. Verifica que existan `dental/server/migrations/0024_agreements_expenses_v2.sql` y `dental/CHANGELOG.md` con la sección 0.6.0.

## Antes de programar, lee
- `dental/ARCHITECTURE.md`, `dental/DECISIONS.md`, `dental/BACKLOG.md` (sección "Ronda 2") e `dental/INVESTIGACION_COMPETIDORES.md` §9.
- El anexo de investigación que te indique tu encargo (`dental/docs/research/anexo-*.md`), sobre todo su sección "Requisitos sugeridos".
- Código base: `server/src/lib/{http,db,rbac,audit,errors,slots}.ts`; migraciones `server/migrations/0001_core.sql` y `0002_*.sql`; los módulos parecidos al tuyo en `server/src/modules/`; `tests/helpers.ts` y una prueba similar; `web/src/components/ui.tsx`, `web/src/styles.css`, `web/src/lib/*` y una página parecida en `web/src/pages/`.

## Convenciones obligatorias
- **Idioma:** toda la interfaz, los mensajes de error y la documentación de las rutas van en español de Bolivia. Los montos se guardan en **centavos** (bigint) y se muestran con `bs()`. Las fechas y horas se manejan en la zona de la clínica (`America/La_Paz`) con los helpers existentes.
- **Rutas:**
  - siempre con `route({...})` de `lib/http.ts`, con zod, `perm` y `summary`, sin excepciones;
  - toda escritura llama a `audit(...)`;
  - las operaciones por sucursal llaman a `requireBranch` y los listados se filtran con `allowedBranches`.
- **Multiempresa:**
  - cada tabla nueva lleva `clinic_id`;
  - `UNIQUE (id, clinic_id)` y **claves foráneas compuestas** `(x_id, clinic_id)`;
  - **RLS** con la política `tenant_isolation`;
  - **GRANT** mínimos al rol `dental_app`.
  - Los registros que no deben cambiar (historias, cierres, intentos, eventos) son **de solo inserción**, con el trigger `forbid_mutation()` o una guarda equivalente.
- **Permisos:** reutiliza los de `lib/rbac.ts`. Agrega uno nuevo solo si es indispensable, y avísalo en tu informe.
- **Migración:** usa **solo** el número de archivo que te asigné. No modifiques las migraciones existentes (0001–0024).
- **Dependencias npm:** no agregues paquetes, salvo que tu encargo lo autorice explícitamente.
- **Excel:** toda exportación pasa por `server/src/lib/xlsxSafe.ts`.
- **Diálogos:** para pedir un motivo o una confirmación usa `useAsk()` de `components/ui.tsx`, nunca `window.prompt` ni `window.confirm`.
- **Saldo del paciente:** siempre con la función SQL `patient_money(patient)` o la vista `patient_money_v` (una sola fórmula; no la redefinas).
- **Mensajes salientes:** siempre por `server/src/lib/messaging.ts` (bandeja `outbound_messages`, simulador fuera de producción); si son automáticos, como regla del módulo `server/src/modules/messaging/` (consentimiento por finalidad, horario de silencio, sin datos clínicos).
- **Tareas internas:** si tu módulo necesita que alguien haga un seguimiento, crea una tarea con `createTask` de `server/src/modules/coordination/tasks.ts` (o, si la crea el sistema, imita `createDetractorTask` de `experience/surveys.ts`).
- **PDF:** si tu módulo genera documentos, usa `server/src/lib/pdf.ts` (ya existe, con huella y código de verificación).
- **Historial del paciente:** si tu módulo crea eventos del paciente, agrégalos como fuente en `server/src/modules/patientTimeline.ts` respetando el permiso de lectura correspondiente.
- **Archivos compartidos:** en `server/src/app.ts`, `web/src/App.tsx`, `web/src/components/Layout.tsx`, `server/src/cli/seed.ts` y `server/src/lib/rbac.ts`, haz **cambios mínimos** (una importación y una línea de registro o ruta). La lógica va en archivos nuevos propios de tu módulo.
- **No edites** `CHANGELOG.md`, `TEST_REPORT.md`, `BACKLOG.md`, `ROADMAP.md`, `README.md`, `ARCHITECTURE.md` ni `DECISIONS.md`. Lo que corresponda documentar lo pones en tu informe final y el integrador lo incorpora.
- **Interfaz:**
  - celular primero (360–390 px sin desborde horizontal) y botones de 40 px o más; en el celular las tablas largas se muestran como **tarjetas apiladas** con la clase `cards-sm` en la tabla (ver `web/src/lib/tableCards.ts`), no con desplazamiento horizontal;
  - el menú (`Layout.tsx`) está agrupado: cada ítem nuevo lleva `group` (`day`, `patients`, `money`, `clinic`, `manage`, `settings`); en el celular aparece solo en «Más»;
  - usa el sistema de diseño existente (`card`, `table`, `btn`, `badge`, `Field`, `Dialog`, `Tabs`, `StatusBadge`, `useToast`, `Empty`, `Loading`);
  - accesible: etiquetas con `Field` y `Field group` cuando hay varios controles, botones reales, foco visible;
  - **no** uses `window.alert` ni `window.prompt` para validar: errores **junto al campo** o en `alert` dentro del diálogo;
  - textos claros para personal no técnico;
  - nada de urgencias falsas.
- **Seguridad:**
  - ninguna lectura cruzada entre clínicas: las pruebas deben demostrarlo para tus tablas nuevas;
  - entradas validadas en el servidor, rechazos con mensaje claro y sin truncar en silencio;
  - nada de secretos en el código;
  - **nunca** envíes mensajes, correos ni pagos reales, ni llames a servicios externos reales.

## Entorno y pruebas
- PostgreSQL ya está corriendo en `127.0.0.1:5432`, usuario `postgres`, clave `postgres`. **No** lo detengas, no lo reconfigures y no toques bases que no sean tuyas.
- Instala dependencias en tu worktree: `cd dental && npm ci`.
- Usa **tus** bases y puerto (te los asigno en tu encargo) con las variables `TEST_DATABASE_URL`, `E2E_DATABASE_URL` y `E2E_PORT`.
- Pruebas de integración: `TEST_DATABASE_URL=... npx vitest run --exclude tests/backup.test.ts`. La prueba de respaldo usa una base fija y la corre el integrador.
- **Las e2e no pueden depender de la fecha del día:** la semilla demo genera citas relativas a hoy. Si necesitas un horario libre, pídelo a `/api/availability` o busca un día con huecos; nunca uses una hora fija.
- Si PostgreSQL no responde (el contenedor puede reiniciarse), arráncalo con `pg_ctlcluster 16 main start` sin cambiar su configuración.
- End-to-end: `npm run build:web && E2E_DATABASE_URL=... E2E_PORT=... npx playwright test --trace off`. Chromium y Playwright están preinstalados: **no** ejecutes `playwright install`.
- Tipos: `npm run typecheck`.

## Definición de terminado
1. Migración, servidor, interfaz y semilla demo (datos **ficticios**) del módulo.
2. **Pruebas de integración** que cubran:
   - el camino feliz;
   - los permisos por rol;
   - el aislamiento entre clínicas en las tablas nuevas;
   - la integridad y los casos límite.

   Además, **al menos 1 prueba end-to-end** del flujo principal en el navegador.
3. `npm run typecheck`, **todas** las pruebas de vitest (salvo la de respaldo) y **todas** las e2e en verde en tu worktree. Las pruebas ya existentes no se pueden romper.
4. Revisión visual propia con Playwright (escritorio 1440 px y celular 390 px) de tus pantallas, sin errores de consola.
5. **Commit** en tu rama con un mensaje en español que termine con estas dos líneas:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01GXt79CBcri6ZLsGT1iJJRQ
   ```
   **No hagas push.**
6. **Informe final** (menos de 400 palabras):
   - nombre de tu rama y hash del commit;
   - archivos tocados, marcando los compartidos;
   - migración;
   - permisos nuevos, si los hay;
   - pruebas agregadas y resultados (números);
   - qué quedó pendiente;
   - un párrafo listo para el CHANGELOG.
