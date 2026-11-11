# Habilidades (skills) para agentes de programación

Son **instrucciones para el agente que programa** (Claude Code o Codex), no partes de la tienda: no se instalan,
no cambian cómo funciona la app y no gastan nada mientras no se usan. Están adaptadas de las de Gabiño
(rama `chore/gabino-agent-skills` del repo gabo-barber) a este proyecto: Node sin frameworks, SQLite,
`npm test`, los scripts de revisión de celular y accesibilidad, y revendedores en lugar de barberías.

Van duplicadas para que las lean los dos agentes:
- Claude Code: `.claude/skills/<nombre>/SKILL.md`
- Codex: `.agents/skills/<nombre>/SKILL.md`

Si editás una, copiá el cambio a la otra.

| Habilidad | Para qué | Viene de |
|---|---|---|
| `gabostore-diagnostico` | El servidor no arranca, pantallas en blanco, sesión que se cierra, CSP que bloquea | gabino-diagnostico |
| `gabostore-pruebas-eficientes` | Arreglar pruebas que fallan y verificar sin gastar de más ni tocar datos reales | gabino-pruebas-eficientes |
| `gabostore-rendimiento` | Hacer más rápida la tienda o el panel midiendo antes y después | gabino-rendimiento |
| `gabostore-lanzamiento` | Lista para publicar o actualizar, sin publicar sin permiso | gabino-lanzamiento |
| `gabostore-ux-premium` | Pantallas celular primero, con las reglas de la casa (44 px, 12 px, dd/mm, voseo) | gabino-ux-premium |
| `gabostore-aislamiento` | Separación entre dueño, staff, revendedores y clientes | gabino-saas-aislamiento |
| `gabostore-whatsapp` | wa.me, bot oficial de Meta y avisos, sin conexiones no oficiales | gabino-whatsapp |
| `gabostore-equipos` | Trabajo grande repartido en equipos de Claude en paralelo (cada uno en su copia aislada), con integración, pruebas completas y revisión en celular; sirve también para Dentalia | método usado en Dentalia v0.4–v0.7 |

## Qué cambió respecto de Gabiño

- **Diagnóstico:** sin Next.js ni Codespaces; se revisa Node 22, `/api/health`, la CSP, `GS_DATA_DIR` y `GS_DATA_KEY`.
- **Pruebas:** `npm test` (compila + `node --test`), dobles para Meta, Telegram, Binance y Web Push; capturas fuera del repo.
- **Rendimiento:** el estado está en memoria y se guarda en SQLite; lo que más pesa son los recorridos completos repetidos.
- **Lanzamiento:** Railway con volumen en `/data`, respaldos al Gmail y la regla de no publicar sin un "Publicá" del dueño.
- **UX:** suma las reglas que se aplicaron en la revisión de celular y la revisión de accesibilidad.
- **Aislamiento:** en vez de Postgres RLS por barbería, permisos por rol (`src/store/auth.ts`) y páginas `/r/<slug>` que nunca muestran costos.
- **WhatsApp:** acá ya existen `wa.me` y la API oficial; la habilidad cuida que no se agreguen conectores por QR no oficiales.

## Instrucciones generales

`CLAUDE.md` (raíz) tiene las reglas del dueño y cómo se trabaja; Claude lo lee solo al empezar cada sesión. `dental/CLAUDE.md` agrega lo propio de Dentalia. Los encargos comunes de los equipos están en `docs/equipos/ENCARGO_COMUN.md` (tienda) y `dental/docs/equipos/ENCARGO_COMUN_DENTALIA.md`.

## Uso

En Claude Code, escribí por ejemplo `/gabostore-diagnostico` o `/gabostore-pruebas-eficientes`. También pueden activarse solas cuando el trabajo encaja.
