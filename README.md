# VendePlay SDK (reverse-engineered)

Toolkit para la API del CRM **VendePlay**, reconstruido por **ingeniería inversa** del
front-end público (`https://crm.vendeplay.com`, SPA React/Vite) con la herramienta
**REA** (análisis estático) + extracción de strings.

> ⚠️ **Procedencia y límites.** Las **rutas**, los **métodos HTTP** y el **esquema de
> autenticación** fueron observados en el código del cliente. Los **cuerpos de
> request/response** y los **parámetros** NO se observaron en ejecución: son genéricos
> (`unknown` / `Record<string, unknown>`) y pueden no coincidir con el backend real.
> Esto es material de uso propio/autorizado sobre tu propia infraestructura, no la
> documentación oficial. Validá contra tu backend antes de confiar en cada endpoint.

## Contenido
- `openapi.yaml` — especificación OpenAPI 3.1 con todos los endpoints descubiertos.
- `src/` — SDK TypeScript:
  - `http.ts` — núcleo: `fetch` + `Authorization: Bearer`, refresh automático en 401,
    y `TokenStore` (memoria o `localStorage` con la clave `auth_token` del front).
  - `resources/crm.ts` — clientes, proveedores, cuentas/servicios de streaming,
    suscripciones, combos, pagos, colaboradores, plantillas, métricas, facturación.
  - `resources/whatsapp.ts` — gateway de mensajería (sesiones, QR, chats, envío).
  - `index.ts` — `VendePlayClient` con `login/logout/me/refresh`.
- `examples/demo.ts` — ejemplo de login + métricas + listado de clientes.

## Uso

```ts
import { VendePlayClient } from "vendeplay-sdk";

const client = new VendePlayClient(); // baseURL por defecto: la API de streaming-head-seller/v1

await client.login({ email: "...", password: "..." }); // campos de login no verificados
const dashboard = await client.metrics.dashboard();
const clients = await client.clients.list({ page: 1 });

// WhatsApp
await client.whatsapp.sessions.start("mi-reference-id");
await client.whatsapp.sendText({ /* chatId, text, ... */ });
```

En navegador, para reutilizar la sesión del propio CRM:

```ts
import { VendePlayClient, localStorageTokenStore } from "vendeplay-sdk";
const client = new VendePlayClient({ tokens: localStorageTokenStore() }); // lee auth_token
```

### Tipado de respuestas
Cada método acepta un genérico para que pongas tu propio tipo a medida que verificás las formas:

```ts
interface Client { id: string; name: string; /* … */ }
const list = await client.clients.list<{ data: Client[] }>();
```

## Build
```bash
npm install
npm run typecheck   # o: npm run build
```

## Arquitectura observada (resumen RE)
- **Stack:** React + Vite, servido por Caddy (HTTP/2/3). Build parece test/staging
  (claves Stripe `pk_test`, RevenueCat `rcb_sb`).
- **API base:** `https://api.vendeplay.com/streaming-head-seller/v1` (axios).
- **Auth (confirmado por decompilación):** `POST /auth/login` con `{ email, password }` →
  `{ data: { accessToken, user } }`; guarda `accessToken` en `localStorage["auth_token"]` y
  `user` en `localStorage["user_data"]`. `Authorization: Bearer`. `logout` borra ambas claves.
  `checkAuth` usa `POST /auth/me` → `data.data`. El login **no** guarda refreshToken
  (el refresh por `/auth/refresh` es probablemente por cookie httpOnly; en el SDK va best-effort
  con `credentials: "include"`).
- **Pagos:** MercadoPago (`/billing/mp/*`), RevenueCat (`/rcbilling`, `/v1/subscribers`),
  y SDKs de Stripe/Paddle cargados en el front.
- **Dominio:** reventa de cuentas de streaming (clientes, proveedores, cuentas/servicios,
  suscripciones, combos), mensajería WhatsApp y métricas.

## Siguiente paso (análisis completo)
Para capturar las **formas reales** de request/response y el comportamiento autenticado,
usar REA con captura de navegador en una sesión con el MCP `rea` activo:
login real → `capture_browser_scenario` → `export_environment_bundle` (AgentEnv).

## Licencia
MIT.
