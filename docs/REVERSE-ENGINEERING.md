# VendePlay CRM — Informe de ingeniería inversa (front-end)

- **Objetivo:** `https://crm.vendeplay.com/login` (CRM propio/autorizado).
- **Método:** análisis **estático** del front-end público (SPA React/Vite) con **REA**
  (`analyze_javascript_application`) + extracción de strings del bundle.
- **Render en vivo (no autenticado):** la página de login se renderizó con Chromium
  → ver [`assets/login.png`](assets/login.png) y los campos del formulario confirmados
  desde el DOM.
- **Probes runtime (no autenticados) a la API:** se hicieron llamadas diagnósticas a
  `api.vendeplay.com` (login dummy, request sin token) que confirmaron el envelope de
  error, el shape de 401 y que `/auth/refresh` no existe (ver sección Runtime). No hubo
  captura **autenticada** (sin credenciales), así que las formas de los payloads de datos
  siguen sin observarse. El resto es estático / decompilación.

## Stack / build
- SPA **React + Vite**: un único bundle `index-Dh8Ent8G.js` (~3.1 MB) + `index-DnnQ7EOv.css`.
- Servido por **Caddy** (HTTP/2 + HTTP/3). `index.html` es una plantilla VendePlay genérica
  (con TODOs sin editar en título/og:title).
- Cliente HTTP: **axios** (dos instancias: CRM y gateway).
- Indicios de entorno **test/staging**: Stripe `pk_test…`, RevenueCat `rcb_sb…`. Clave
  pública de MercadoPago `APP_USR-…` embebida en el bundle (pública por diseño, no secreta).

## Dos superficies de API

### 1) API principal del CRM — auth Bearer
- Base: `https://api.vendeplay.com/streaming-head-seller/v1` (axios `at = create({baseURL: eTe})`).
- Auth: `Authorization: Bearer <accessToken>`.
- **Formulario de login (DOM en vivo + bundle):** campos `accountCode`, `username`, `password`.
  El submit envía `t = { accountCode: "ACC-"+numero, username, password }` (el `accountCode`
  se prefija con `ACC-`; el usuario tipea solo el número, p. ej. `12345`). La respuesta
  `data.data.user` incluye `{ accountCode, email, … }`. (Una conclusión previa de
  `{email,password}`, derivada solo de frecuencia de strings, quedó descartada por el DOM.)
- Contrato de login (decompilado):
  ```js
  login(t){ const i = await at.post("/auth/login", t);           // t = { accountCode, username, password }
            localStorage.setItem("auth_token", i.data.data.accessToken);
            if (i.data.data.user) localStorage.setItem("user_data", JSON.stringify(i.data.data.user));
            return i.data }
  logout(){ await at.post("/auth/logout"); localStorage.removeItem("auth_token"); localStorage.removeItem("user_data") }
  checkAuth(){ return localStorage.getItem("auth_token") ? (await at.post("/auth/me")).data.data : null }
  ```
  No se observó `refreshToken` en el login; `/auth/refresh` probablemente usa cookie httpOnly.

### 2) Gateway de mensajería (WhatsApp) — auth x-api-key
- Se descubre vía `getPlugins({name:"self.ws", status:"ACTIVE"})` →
  `at.get("/account-plugins", {params})` → `data[0]` = `{ url, referenceId, token }`.
- Instancia dedicada (decompilado):
  ```js
  $i(t){ return axios.create({ baseURL: t.url,
           headers: { "Content-Type":"application/json", "x-api-key": t.token } }) }
  ```
- Todas las llamadas pasan `session = referenceId`. Ej. confirmado:
  `$i(r).post("/sendText", { session: r.referenceId, chatId: t, text: e })`.
- `/contacts/all` y `/contacts/profile-picture` también viven en este gateway (con `session`).

## Inventario de endpoints (verbos observados)

### API principal (Bearer)
- **Auth:** `POST /auth/login`, `POST /auth/me`, `POST /auth/logout`
  (ojo: `/auth/refresh` **no existe** — 404 en runtime)
- **Accounts/billing:** `GET /account-plugins`, `GET /accounts/plans|subscription|billing-history`,
  `GET|POST /billing-rules`, `GET|PUT|DELETE /billing-rules/{id}`, `PATCH /billing-rules/{id}/toggle`,
  `POST /billing/mp/preference`, `GET /billing/mp/status`, `POST /billing/mp/cancel`,
  `GET /rcbilling/v1`, `GET /v1/subscribers`, `GET /v1/receipts`
- **Clients:** `GET|POST /clients`, `GET|PUT /clients/{id}`, `POST /clients/import`, `GET /clients/export`
- **Suppliers:** `GET|POST /suppliers`, `GET|PUT /suppliers/{id}`, `POST /suppliers/import`,
  `GET /suppliers/export`, `GET|POST /suppliers/{id}/services`, `PUT /suppliers/{id}/services/{serviceId}`,
  `GET /suppliers/{id}/price-plans`
- **Streaming:** `GET|POST /streaming-accounts`, `GET|PUT /streaming-accounts/{id}`,
  `POST /streaming-accounts/import`, `GET /streaming-accounts/export`,
  `POST /streaming-accounts/{id}/slot/register`, `PUT /streaming-accounts/slot/{id}/update`,
  `GET|POST /streaming-services`, `GET|PUT /streaming-services/{id}`,
  `POST|PUT|DELETE /streaming-services/{id}/price-plans`
- **Subscriptions:** `GET|POST /subscriptions`, `GET|PUT /subscriptions/{id}`,
  `GET /subscriptions/client/{id}`, `PATCH /subscriptions/{id}/cancel|extend|transfer|supplier`,
  `GET /supplier-subscriptions`, `GET /supplier-payments`
- **Otros:** `GET|POST /combos`, `GET|PUT|DELETE /combos/{id}`, `GET|POST /payments`,
  `GET|PUT /payments/{id}`, `GET|POST /collaborators`, `GET|PUT /collaborators/{id}`,
  `GET|POST /templates`, `GET|PUT|DELETE /templates/{id}`, `POST /templates/{id}/send`,
  `GET /message-logs`, `POST /message-logs/send-manual`
- **Métricas:** `GET /metrics/dashboard|revenue|service-revenue|client-growth|plan-distribution|slot-occupancy|subscription-status`

### Gateway WhatsApp (x-api-key, base dinámica)
- `GET /sessions/{referenceId}`, `POST /sessions/{referenceId}/start|restart|logout`
- `GET /{referenceId}/auth/qr`
- `GET /{referenceId}/chats/overview`, `GET /{referenceId}/chats/{chatId}/messages`,
  `GET /{referenceId}/chats/{chatId}/messages/{messageId}`, `POST /{referenceId}/chats/{chatId}/messages/read`
- `GET /{referenceId}/lids/{id}`, `GET /{referenceId}/lids/pn/{phone}`
- `GET /contacts/all`, `GET /contacts/profile-picture`
- `POST /sendText|sendImage|sendVideo|sendVoice|sendFile`, `POST /startTyping|stopTyping`

## Integraciones de terceros (SDKs cargados)
MercadoPago (`sdk.mercadopago.com`, `/billing/mp/*`), RevenueCat (`api.revenuecat.com`,
`/rcbilling`, `/v1/subscribers`), Stripe (`js.stripe.com`), Paddle (`cdn.paddle.com`),
WhatsApp (`wa.me`), assets por CloudFront.

## Lectura funcional
CRM para **revendedores de cuentas de streaming**: gestiona clientes, proveedores,
cuentas/servicios de streaming, suscripciones y combos; cobra con MercadoPago/RevenueCat;
incluye un módulo de **mensajería WhatsApp** (gateway `self.ws`) y un panel de **métricas**.

## Runtime (contrato real — probes no autenticados a `api.vendeplay.com`)
- **Backend:** Express (`x-powered-by: Express`) tras Caddy; estilo de errores NestJS.
  `access-control-allow-origin: *`.
- **Envelope de error estándar:**
  ```json
  { "code": "BAD_REQUEST", "message": ["password is not strong enough"],
    "status": 400, "meta": { "traceId": "…" }, "data": ["…"] }
  ```
  `message` puede ser string o array (validación tipo class-validator).
- **`POST /auth/login`** con body inválido → **400** `BAD_REQUEST` (valida fuerza de password).
- **`GET /clients`** sin token → **401** `{ "code":"ERROR","message":"Unauthorized","status":401 }`.
- **`POST /auth/refresh`** → **404** `Cannot POST …/auth/refresh` → **no hay refresh**; un 401
  significa re-login. (El SDK se corrigió: en 401 limpia el token y notifica, sin reintentar.)

## Límites
- No hubo captura **autenticada** (sin credenciales): las formas de los payloads de datos
  (clients, suppliers, etc.) siguen inferidas, no observadas.
- Solo front-end + probes sin auth: no revela la lógica interna del backend.
- El grafo semántico de REA quedó parcial (heap de 1 GiB agotado en el bundle minificado).
- Las formas de payload (salvo login y sendText) son inferidas, no observadas en ejecución.
