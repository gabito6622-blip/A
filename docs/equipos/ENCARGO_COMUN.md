# Encargo común para los equipos de Gabriel Store / GaboHub (leelo completo)

Sos un equipo de trabajo dentro de una sesión de Claude Code: otra copia de Claude te asignó un encargo y va a integrar tu trabajo. Trabajás en **tu propia copia del repositorio** (worktree), en tu propia rama. Nunca trabajes en la copia principal.

## Primer paso obligatorio
Tu worktree puede haber salido de otra rama. Antes de nada, en la raíz del worktree:
```
git reset --hard <RAMA_BASE>
```
`<RAMA_BASE>` te la da tu encargo. Verificá que `npm test` pase antes de cambiar nada, y anotá cuántas pruebas había.

## Leé antes de programar
- `CLAUDE.md` de la raíz: las reglas del dueño, que valen igual para vos.
- `docs/ESTADO_PARA_REVISION.md` (qué hace hoy la tienda) y `docs/IMPLEMENTATION_PLAN.md` (fases y riesgos).
- La habilidad de tu tema en `.claude/skills/gabostore-*/SKILL.md`. Si tu encargo toca revendedores, precios, clientes o comprobantes, siempre también `gabostore-aislamiento`.
- El código parecido a lo que vas a hacer:
  - `src/store/auth.ts`: permisos por rol (`authorize`);
  - el módulo de `src/store/` más cercano: toda acción pasa por `authorize(actor, …)` y deja `e.audit(…)`;
  - `src/server/app.ts`: rutas;
  - `test/` del tema.

## Cómo está hecho (respetalo)
- **Núcleo de negocio en `src/store/`** (TypeScript):
  - el estado vive en memoria y cada transacción confirmada se guarda en SQLite (`src/server/db.ts`) **antes** de responder;
  - toda operación sensible: `authorize(actor, permiso)` y `audit`.

  Si necesitás un permiso nuevo, agregalo a la matriz de `auth.ts` y avisalo en tu informe.
- **Servidor sin frameworks en `src/server/`.**
- **Tienda (`public/index.html`, `shop.js`) y panel GaboHub (`panel.html`, `panel.js`):** HTML, CSS y JS sin frameworks, con una CSP estricta (`test/csp.test.mjs`). Nada de scripts en línea ni de CDN nuevos.
- **Archivos calientes**, los que tocan todos los equipos:
  - `src/store/types.ts`, `src/server/app.ts`, `public/panel.js`, `public/shop.js`.

  Ahí hacé **cambios mínimos** (un tipo, un import, una ruta, un llamado). Tu lógica va en **archivos nuevos** de tu tema.
- **Plata:**
  - montos en **centavos enteros** (tipo `Cents` de `src/store/types.ts`); se muestran como `Bs 12.50` solo al final;
  - un perfil nunca se vende dos veces;
  - el saldo de un cliente siempre se explica por sus movimientos.
- **Revendedores:**
  - un revendedor no ve clientes, costos, ganancias ni comprobantes de otro;
  - las páginas `/r/<slug>` nunca muestran costos.

## Interfaz
- **Celular primero** (360 y 390 px sin desborde):
  - botones de 44 px;
  - texto de 12 px o más;
  - fechas dd/mm;
  - voseo y español simple, sin jerga técnica.
- **Modo claro y oscuro:** revisá los dos.
- **Accesible:** etiquetas en todos los campos, botones reales y foco visible.
- **Mensajes:** los errores van junto al campo, no con `alert()`. Nada de urgencias falsas.

## Pruebas (obligatorias)
- `npm test` compila y corre todo `test/`.
- Para iterar: `npm run build && node --test test/<archivo>.test.mjs`.
- Las pruebas usan:
  - carpetas temporales (`mkdtempSync`);
  - `createApp({ jobs: false })`;
  - dobles para todo lo externo: `fetchImpl` falso para Meta, Telegram, Binance y Web Push, y `otpSender` falso.

  **Nunca** `data/` ni nada real.
- **Cubrí:**
  - el camino feliz;
  - los permisos por rol (dueño, admin, vendedor, revendedor, cliente);
  - la **separación entre revendedores** si tocás algo de ellos;
  - la plata, si aplica: el saldo cuadra, no hay doble venta y el stock vuelve al rechazar;
  - los casos límite.
- **Revisión visual** de tus pantallas:
  - `npm run build && node scripts/seed-demo.mjs <tmp>`;
  - `GS_DATA_DIR=<tmp> GS_STATIC_DIR=public PORT=<tu puerto> npm start`;
  - `node scripts/revision-celular.cjs <tmp-capturas>`.

  Las capturas y `scan.json` van **fuera** del repo.

## Lo que no hacés
- No edites `README.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md`, `docs/DECISIONES.md`, `docs/CHANGELOG.md` ni `docs/INFORME_PRUEBAS.md`. Lo que haya que documentar va en tu informe y lo incorpora el integrador.
- No agregues dependencias npm, salvo que tu encargo lo autorice.
- No publiques nada, no mandes mensajes, cobros ni correos reales y no crees cuentas.
- No toques `dental/`: es otro proyecto.

## Definición de terminado
1. Lo pedido funciona, con pruebas nuevas.
2. `npm test` en verde, con todas las pruebas que había antes más las tuyas.
3. Revisión visual a 360 y 390 px, en claro y oscuro, sin desborde ni errores de consola.
4. Commit en tu rama con mensaje en español. Sin push: lo integra quien te lanzó.
5. **Informe final:**
   - qué hiciste;
   - qué archivos ajenos tocaste y por qué;
   - pruebas antes y después;
   - riesgos;
   - lo que no pudiste probar;
   - texto propuesto para CHANGELOG, DECISIONES y BACKLOG.
