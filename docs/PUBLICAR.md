# Publicar Gabriel Store en internet

Hay tres formas. Las tres usan el mismo código; elegí una.

| Opción | Costo aprox. | Ventaja | Cuidado |
|---|---|---|---|
| **A. Render** | ~7 USD/mes + disco | Todo desde la web, HTTPS automático | El plan gratis **no** sirve: borra los datos al reiniciar |
| **B. Railway** | ~5 USD/mes | Muy simple, HTTPS automático | Hay que agregar un **volumen** en `/data` |
| **C. Tu PC + Cloudflare Tunnel** | Gratis (y tu dominio) | Los datos quedan en tu PC | La PC tiene que estar **prendida** para que la tienda funcione |

En todas:
- **`GS_PUBLIC_ORIGIN`** = la dirección final con `https://` (p. ej. `https://gabostore.lat`). Sin esto no funcionan el bot de WhatsApp ni los links de acceso.
- **`GS_OWNER_USER`** y **`GS_OWNER_PASSWORD`** (mín. 10 caracteres): crean el dueño **solo la primera vez**. Después podés borrarlas.
- Los datos (base, comprobantes y respaldos) viven en **`/data`**. Si esa carpeta no está en un disco persistente, **se pierde todo** al reiniciar.

---

## A. Render

1. Subí este repositorio a tu GitHub (ya está).
2. En <https://dashboard.render.com> → **New → Blueprint** → elegí el repositorio. Render lee `render.yaml`.
3. Completá las variables: `GS_PUBLIC_ORIGIN`, `GS_OWNER_USER`, `GS_OWNER_PASSWORD`.
4. Esperá a que diga **Live** y abrí `https://…onrender.com/panel`.
5. (Opcional) **Settings → Custom Domains** para usar tu dominio; actualizá `GS_PUBLIC_ORIGIN`.

## B. Railway

1. En <https://railway.com> → **New Project → Deploy from GitHub repo** → elegí el repositorio. Usa el `Dockerfile`.
   - **Rama:** en el servicio → **Settings → Source → Branch**, elegí la rama donde está la tienda (hoy `ccr-a0b95638-dpfc8j`). Cada vez que se actualiza esa rama, Railway vuelve a publicar solo.
   - Agregá la variable **`PORT=8080`** y usá ese puerto al generar el dominio.
   - Agregá también **`RAILWAY_RUN_UID=0`**: Railway monta el volumen como root y sin esto la tienda no puede escribir en `/data`.
2. En el servicio → **Volumes → New Volume**, ruta de montaje **`/data`**.
3. **Variables:** `GS_PUBLIC_ORIGIN`, `GS_OWNER_USER`, `GS_OWNER_PASSWORD`.
4. **Settings → Networking → Generate Domain** (o tu dominio). Copiá esa dirección en `GS_PUBLIC_ORIGIN` y volvé a desplegar.
5. Usá **una sola réplica**: la base de datos es un archivo y solo un proceso puede abrirla.

## C. Tu PC + Cloudflare Tunnel

Sirve si querés que la tienda siga en tu PC (la misma de `iniciar-tienda.bat`) pero con dirección pública y HTTPS.

1. Necesitás un dominio agregado a Cloudflare (gratis en Cloudflare; el dominio se paga aparte).
2. Instalá `cloudflared`: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
3. En una terminal:
   ```
   cloudflared tunnel login
   cloudflared tunnel create gabriel-store
   cloudflared tunnel route dns gabriel-store tienda.tu-dominio.com
   cloudflared tunnel run --url http://localhost:8080 gabriel-store
   ```
4. Arrancá la tienda con:
   ```
   set GS_PUBLIC_ORIGIN=https://tienda.tu-dominio.com
   set GS_TRUST_PROXY=1
   ```
   y luego `iniciar-tienda.bat`.
5. Para que arranque sola al prender la PC: `cloudflared service install` (ver guía de Cloudflare).

> **Túnel rápido** (`cloudflared tunnel --url http://localhost:8080`) da una dirección `trycloudflare.com` que **cambia cada vez**: sirve para probar, **no** para Meta ni para clientes.

## Docker en un VPS

```
docker build -t gabriel-store .
docker run -d --name gabriel-store --restart unless-stopped -p 8080:8080 \
  -v gabriel-datos:/data \
  -e GS_PUBLIC_ORIGIN=https://tu-dominio \
  -e GS_OWNER_USER=gabriel -e GS_OWNER_PASSWORD='una-clave-larga' \
  gabriel-store
```
Poné delante un proxy con HTTPS (Caddy o Nginx). La imagen ya trae `GS_TRUST_PROXY=1`.

## Después de publicar

1. Entrá a `/panel`, cambiá la contraseña del dueño y borrá `GS_OWNER_PASSWORD` de las variables.
2. Revisá **Configuración → Respaldos**: se hace uno por día; descargá uno y guardalo fuera del servidor.
3. Conectá WhatsApp: [`WHATSAPP_META.md`](WHATSAPP_META.md).

### `GS_TRUST_PROXY`
Ponela en `1` **solo** si la tienda está detrás de Render, Railway, Cloudflare o un proxy tuyo. Así los límites de intentos (login, códigos) usan la IP real del cliente. Si la tienda está expuesta directo, dejala apagada: si no, cualquiera podría falsear su IP.
