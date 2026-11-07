# Bot de WhatsApp con la API oficial de Meta

Gabriel Store se conecta a la **WhatsApp Cloud API** oficial de Meta. Con eso:

- **El bot contesta solo, las 24 horas:** servicios y vencimientos, precios, cómo pagar, link de acceso, códigos de verificación y saldo.
- **Los avisos** (pedido confirmado, recordatorios de vencimiento, etc.) salen solos cada minuto.
- **Cuando un cliente pide hablar con una persona**, el bot se calla en esa charla y vos respondés desde el panel (**WhatsApp → Conversaciones**).
- **El cliente puede entrar a la tienda con un código** que le llega por WhatsApp, si cargás la plantilla `login_code`.

> El bot **nunca manda contraseñas ni PIN** por WhatsApp. Para eso manda un link personal, de un solo uso, a **Mis cuentas**.

---

## 0. Antes de empezar

| Necesitás | Por qué |
|---|---|
| **Tienda publicada con HTTPS** (Railway, Render, VPS o túnel) | Meta manda los mensajes a una dirección pública `https://…`. Con la tienda solo en tu PC sin túnel, el bot no recibe nada. |
| **Un número de teléfono para el bot** | Ese número pasa a usarse por la API. Usá uno aparte del de tu WhatsApp personal. Meta tiene una opción para compartir el número con la app WhatsApp Business: si te interesa, revisá en la documentación de Meta si está disponible para tu país. |
| **Cuenta de Meta Business** | Para crear la app y, si Meta lo pide, verificar el negocio. |

La tienda tiene que arrancar con **`GS_PUBLIC_ORIGIN=https://tu-dominio`**. Con eso se arman la URL del webhook y los links que manda el bot.

## 1. Crear la app en Meta

1. Entrá a <https://developers.facebook.com/apps> → **Crear app** → tipo **Empresa** (Business).
2. Agregá el producto **WhatsApp**.
3. En **WhatsApp → Configuración de la API**:
   - agregá y verificá tu número (te llega un código por SMS o llamada);
   - copiá el **Phone number ID**. Es un número largo y **no** es el número de teléfono.

## 2. Token permanente

El token que muestra la página de prueba vence en 24 horas. Para el bot hace falta uno permanente:

1. En <https://business.facebook.com> → **Configuración del negocio → Usuarios → Usuarios del sistema** → **Agregar**, con rol **Administrador**.
2. **Asignar activos:** tu app (control total) y tu cuenta de WhatsApp.
3. **Generar token:** elegí la app y marcá los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. Copiá el token (empieza con `EAA…`). **Guardalo bien: Meta no lo vuelve a mostrar.**

## 3. App Secret

En la app → **Configuración → Básica** → **Clave secreta de la app** → Mostrar. Son 32 caracteres.
Sirve para que Gabriel Store compruebe que cada mensaje viene de verdad de Meta (firma `X-Hub-Signature-256`).

## 4. Cargar todo en el panel

**Panel → WhatsApp → Bot y conexión con Meta:**
1. **Claves de Meta:** el token y el App Secret. Solo el dueño las carga.
   - Se guardan en una tabla aparte: no salen en exportaciones, ni en la auditoría, ni se vuelven a mostrar completas.
   - **Protegé el archivo `data/gabriel.db`:** quien lo tenga puede leerlas.
2. **Bot:** el Phone number ID (y la versión de la API, si Meta te indica otra).

## 5. Webhook

En la app → **WhatsApp → Configuración → Webhook → Editar**:
- **URL de devolución de llamada:** `https://tu-dominio/api/whatsapp/webhook`. El panel te la muestra con botón "Copiar".
- **Token de verificación:** el que muestra el panel.
- Tocá **Verificar y guardar**. Después, en **Campos del webhook**, suscribí **messages**.

## 6. Plantillas (para escribir fuera de las 24 horas)

WhatsApp solo deja mandar **texto libre** si el cliente te escribió en las **últimas 24 horas**. Para los avisos fuera de ese plazo hacen falta **plantillas aprobadas**.

En el panel, la tabla **Plantillas de avisos** tiene el texto exacto de cada una con `{{1}}`, `{{2}}`…:

1. Creá cada plantilla en **WhatsApp Manager → Plantillas de mensajes**, con idioma **Español** y la categoría indicada:
   - **Utilidad** para avisos de pedidos y vencimientos.
   - **Autenticación** para `login_code`, el código de acceso. Meta le agrega el botón "Copiar código".
2. Cuando Meta la apruebe, escribí su **nombre** en el panel y tocá **Guardar plantillas**.

Si un aviso no tiene plantilla y el cliente no escribió en 24 horas, queda **fallido con la explicación**, y lo podés mandar a mano desde **Avisos**.

## 7. Probar y encender

1. **Enviar prueba** manda `hello_world`, que viene aprobada en cuentas nuevas, al número que pongas.
   - Mientras la app esté en modo desarrollo, ese número tiene que estar en la lista de destinatarios de prueba de Meta.
2. Marcá **Bot encendido** → **Guardar**.
3. Desde otro teléfono, escribile "hola" al número del bot: tiene que contestar con el menú.

## Qué contesta el bot

| El cliente escribe | El bot responde |
|---|---|
| hola, menú o cualquier otra cosa | Saludo y menú |
| **1**, servicios, vence | Sus servicios con fecha y días que faltan, más un link a Mis cuentas |
| **2**, precios, catálogo | Productos disponibles con precio (de revendedor, si corresponde) |
| **3**, pagar, qr | Cómo pagar, tus datos de pago y la imagen del QR |
| **4**, entrar, clave | Link personal de un solo uso (24 horas) |
| **5**, código | Códigos de verificación de **sus** cuentas, de los últimos 30 minutos |
| **6**, saldo | Su saldo |
| renovar | Sus servicios, con el link para renovar |
| **0**, persona, asesor | Te avisa en Conversaciones y el bot se calla en esa charla (12 horas por defecto) |
| BAJA / ALTA | Deja de recibir o vuelve a recibir avisos automáticos |

Si alguien escribe muchísimos mensajes seguidos, el bot deja de contestarle un rato (máximo 8 respuestas cada 5 minutos por número).

## Costos

Meta cobra por las conversaciones o los mensajes con plantilla, según el país y la categoría. Las respuestas dentro de la ventana de 24 horas a un cliente que te escribió suelen ser gratis, y los precios cambian. **Revisá la tabla de precios vigente de Meta para Bolivia** antes de activar avisos masivos.

## Problemas comunes

| Mensaje | Qué hacer |
|---|---|
| *El token de acceso venció o es inválido* | Generá un token permanente (paso 2) y cargalo de nuevo. |
| *Pasaron más de 24 h… hace falta una plantilla* | Creá y cargá la plantilla de ese aviso (paso 6). |
| *La plantilla no existe o no está aprobada* | Revisá el nombre exacto y el idioma (`es`). |
| *Ese número no está en la lista de prueba* | Agregalo en Meta, o pasá la app a modo publicado. |
| El webhook no verifica | La URL tiene que ser `https://`, pública, y el token igual al del panel. |
| No llegan los mensajes | Revisá que el campo **messages** esté suscrito y que el App Secret sea el correcto. Si es incorrecto, el servidor rechaza la firma. |
