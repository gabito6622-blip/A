---
name: gabostore-whatsapp
description: Trabajar en WhatsApp de Gabriel Store: envío manual con wa.me, bot oficial de Meta (Cloud API) y avisos, aclarando riesgos y sin mandar mensajes reales.
---

# WhatsApp responsable

Hoy hay dos caminos y ya están hechos: (a) `wa.me` con el texto armado para que el dueño lo mande a mano, y (b) la API oficial de Meta (Cloud API) con webhook firmado, plantillas y bot (`src/server/whatsapp.ts`, `src/server/bot.ts`, `docs/WHATSAPP_META.md`).

1. No implementes conexiones por QR de WhatsApp Web ni librerías no oficiales: rompen las reglas de WhatsApp y pueden suspender el número. Si el dueño lo pide, primero explicá riesgos y alternativas.
2. Tokens y secretos solo en el servidor (secretos de la base o variables), nunca en el repo ni en el navegador.
3. Envíos automáticos: consentimiento del cliente, plantillas fuera de la ventana de 24 h, horario de Bolivia, webhooks verificados, cola sin duplicados, reintentos con límite y registro de enviados/fallidos.
4. Nunca mandes recordatorios de algo cancelado o ya renovado, ni dos veces el mismo aviso. La aprobación de pagos por QR sigue siendo manual (salvo Binance Pay con webhook firmado).
5. En pruebas, siempre `fetchImpl` falso y `metaBaseUrl` de prueba: ningún mensaje real.
6. El bot responde precios, estado de pedidos y derivación a una persona; si se suma IA, tiene que poder pasar a humano.

Primero proponé opciones, costos y riesgos; implementá solo lo que el dueño apruebe.
