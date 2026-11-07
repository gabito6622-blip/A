# VendePlay SDK (reverse-engineered)

Toolkit para la API del CRM **VendePlay**, reconstruido por **ingeniería inversa** del
front-end público (`https://crm.vendeplay.com`, SPA React/Vite) con la herramienta
**REA** (análisis estático) + extracción de strings.

> ⚠️ **Procedencia y límites.** Las **rutas**, los **métodos HTTP** y los **esquemas de
> autenticación** fueron observados en el código del cliente. Los **cuerpos de
> request/response** NO se observaron en ejecución (la red del sandbox hacia la API
> estaba bloqueada), salvo los confirmados por decompilación: el **login**
> (`{accountCode,username,password}` → `{data:{accessToken,user}}`) y **sendText**
> (`{session,chatId,text}`). El resto es genérico (`unknown`). Material de uso
> propio/autorizado; validá contra tu backend antes de confiar en cada endpoint.

## Dos superficies de API
| Superficie | Base URL | Auth |
|---|---|---|
| **CRM principal** | `https://api.vendeplay.com/streaming-head-seller/v1` | `Authorization: Bearer <accessToken>` |
| **Gateway WhatsApp** | dinámica: `plugin.url` del plugin `self.ws` | header `x-api-key: <plugin.token>` |

El gateway se descubre con `GET /account-plugins?name=self.ws&status=ACTIVE` → `data[0]` =
`{ url, referenceId, token }`. Sus llamadas pasan además `session=<referenceId>`.

## Contenido
- `openapi.yaml` — OpenAPI 3.1 (validado): 81 paths / 107 operaciones, 2 servers, `bearerAuth` + `apiKeyAuth`.
- `postman_collection.json` — colección Postman generada del spec (`npm run gen:postman`).
- `src/` — SDK TypeScript:
  - `http.ts` — núcleo `fetch` + Bearer, refresh automático en 401, `TokenStore` (memoria o `localStorage` con clave `auth_token`).
  - `resources/crm.ts` — clientes, proveedores, streaming, suscripciones, combos, pagos, colaboradores, plantillas, métricas, facturación, message-logs.
  - `resources/whatsapp.ts` — `WhatsAppClient` del gateway (sesiones, QR, chats, contactos, envío).
  - `index.ts` — `VendePlayClient` con `login/logout/me/refresh` y `connectWhatsApp()`.
- `clients/python/vendeplay.py` — cliente Python equivalente (solo stdlib).
- `test/http.test.mjs` — tests del core con `fetch` simulado (`npm test`).
- `examples/demo.ts`, `scripts/gen-postman.mjs`.

## Uso (TypeScript)

```ts
import { VendePlayClient } from "vendeplay-sdk";

const client = new VendePlayClient();
await client.login({ accountCode: "12345", username: "...", password: "..." }); // accountCode se prefija ACC-

const dashboard = await client.metrics.dashboard();
const clients = await client.clients.list({ page: 1 });

// WhatsApp: se conecta resolviendo el plugin self.ws
const wa = await client.connectWhatsApp();
await wa.sessions.start();
await wa.sendText("<chatId>", "Hola 👋");   // { session, chatId, text }
```

En navegador, reutilizando la sesión del propio CRM:
```ts
import { VendePlayClient, localStorageTokenStore } from "vendeplay-sdk";
const client = new VendePlayClient({ tokens: localStorageTokenStore() }); // lee auth_token
```

Tipado a medida de respuestas:
```ts
interface Client { id: string; name: string }
const list = await client.clients.list<{ data: Client[] }>();
```

## Uso (Python)
```python
from vendeplay import VendePlayClient
c = VendePlayClient()
c.login("12345", "usuario", "secreto")
print(c.metrics_dashboard())
wa = c.connect_whatsapp()
wa.send_text("<chatId>", "Hola")
```

## Scripts
```bash
npm install
npm run build              # emite dist/
npm test                   # build + node --test  (7 tests del core)
npm run validate:openapi   # valida openapi.yaml
npm run gen:postman        # regenera postman_collection.json
python3 -c "import clients.python.vendeplay"   # (o importá el módulo directamente)
```

## Arquitectura observada (resumen RE)
- **Stack:** React + Vite, servido por Caddy (HTTP/2/3). Build parece test/staging
  (claves Stripe `pk_test`, RevenueCat `rcb_sb`); clave pública de MercadoPago
  `APP_USR-…` embebida (pública por diseño).
- **Backend:** Express/NestJS (envelope de error `{code,message,status,meta.traceId}`; `message` puede ser array; CORS `*`).
- **Auth principal:** `POST /auth/login` `{accountCode:"ACC-…",username,password}` → `{data:{accessToken,user}}`;
  `accessToken`→`localStorage["auth_token"]`, `user`→`localStorage["user_data"]`.
  `logout` borra ambas; `checkAuth`→`POST /auth/me`. **No hay endpoint de refresh**
  (`/auth/refresh` responde 404 en runtime): un 401 limpia el token y hay que re-loguear.
- **Gateway WhatsApp:** plugin `self.ws` con base propia + `x-api-key`.
- **Dominio:** reventa de cuentas de streaming (clientes, proveedores, cuentas/servicios,
  suscripciones, combos), mensajería WhatsApp y métricas; pagos MercadoPago + RevenueCat.

Detalle completo en [`docs/REVERSE-ENGINEERING.md`](docs/REVERSE-ENGINEERING.md).

## Siguiente paso (formas reales de payload)
Capturar request/response autenticados requiere, en una sesión con el MCP `rea` y navegador,
permitir la red hacia `api.vendeplay.com` y hacer login real → `capture_browser_scenario` →
`export_environment_bundle`.

## Licencia
MIT.

## Gabriel Store: núcleo de dominio (`vendeplay-sdk/store`)
Lógica de negocio real y probada para una tienda de cuentas digitales: inventario de cuentas y perfiles
con reservas atómicas, ventas con QR/saldo/efectivo, aprobación de comprobantes, asignaciones,
reemplazos, renovaciones (fecha del cliente separada de la del proveedor), saldo contable, portal de
clientes y revendedores, códigos de verificación, bandeja de WhatsApp con consentimiento y estadísticas.
Todo con control de acceso por rol y auditoría. Ver [`docs/REA_GABRIEL_STORE.md`](docs/REA_GABRIEL_STORE.md)
y [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). Pruebas: `test/store.test.mjs`.
