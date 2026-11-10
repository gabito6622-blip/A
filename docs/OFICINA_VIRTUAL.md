# Oficina virtual

Cuatro agentes con Claude más reglas automáticas. Los agentes arrancan **apagados**: se prenden en el panel →
Configuración → *Oficina virtual* (solo el dueño), con la clave `ANTHROPIC_API_KEY` cargada en el servidor.
Ninguno aprueba pagos, entrega cuentas, hace devoluciones ni mueve plata.

| Agente | Qué hace | Límites |
|---|---|---|
| 💬 Atención por WhatsApp | El único que habla con clientes. Responde lo que el bot de palabras clave no entiende: precios, cómo pagar, accesos, códigos, renovaciones. | Los códigos, links de acceso, QR y listas los manda **el sistema** (acciones fijas), nunca los escribe la IA. Si la cuenta del cliente tiene problemas o hay reclamo, pasa a una persona y el bot se pausa en ese chat. No conoce claves ni PIN. |
| 🧾 Revisor de comprobantes | Lee la foto o el PDF y extrae monto, número, fecha y destino. El **servidor** compara con el pedido. | Solo sugiere (parece bien / revisalo / no coincide). Aprueba una persona. |
| 🧠 Asistente del dueño | Reporte del día (8 h, por Telegram y en Inicio) y respuestas a preguntas sobre el negocio. | Solo lee una "foto" de los datos (sin contraseñas). Máximo 30 preguntas por hora. |
| 🚨 Vigilante de cuentas (IA) | Clasifica los correos raros de las plataformas que las reglas no reconocen. | Máximo 30 por día. Solo correos de cuentas cargadas. |

**Reglas automáticas (sin IA, sin costo, siempre prendidas):**
- Comprobante repetido: si la misma imagen ya se usó en otro pedido, se marca en *Aprobar pagos* y en Notificaciones.
- Vigilante de cuentas: los correos de "cambió la contraseña/el correo", "pago rechazado/en espera" o "cancelada" que llegan a cuentas cargadas generan un aviso en *Cuentas* y en Notificaciones (Telegram y celular, si están prendidos). Solo ve los correos que llegan al Gmail conectado al Panel de códigos.
- Recordatorios de vencimiento, stock bajo, cuentas que vencen con el proveedor (ya existían).
- El reporte del día suma revendedores que no compran hace 14 días y perfiles libres que se pierden si no se venden.

**Costo:** se elige el modelo (Opus 5.5, Sonnet 5.5 o Haiku 5.5) y un tope mensual en dólares. Al llegar al tope, los agentes se pausan hasta el mes siguiente. El panel muestra lo gastado.

## Banco de pruebas

Los casos están en `src/server/agent-bank.ts`: 40 mensajes de WhatsApp (con errores de tipeo, enojos, intentos de engañar al bot), 12 correos de plataformas y 12 comprobantes (bien, con otro monto, otro número, editados, borrosos, USDT, Yappy), cada uno con lo que tiene que pasar.

**Desde el panel (recomendado):** Configuración → Oficina virtual → *🧪 Probar la oficina*. Con la clave cargada en el servidor, corre los 40 mensajes y los 12 correos contra Claude real (tope 2 dólares; con los créditos de API incluidos en el plan Max no se paga aparte), en segundo plano, y muestra qué contestó en cada caso y qué falló. No le escribe a ningún cliente. Se puede repetir con otro modelo para comparar.

**Desde la terminal:**

```bash
npm run build
node scripts/evaluar-agentes.mjs                     # simulado: gratis, prueba conexiones y comparaciones
ANTHROPIC_API_KEY=... node scripts/evaluar-agentes.mjs --real --modelo=claude-haiku-5-5 --tope=2
```

El modo simulado confirma que todo está conectado y que las comparaciones del sistema son correctas; **no mide la calidad de Claude**. El modo real también prueba los 12 comprobantes (los dibuja con Playwright, que en el servidor no está). Hay que correr la prueba real antes de prender los agentes para clientes y cada vez que se cambie de modelo o de instrucciones.

**Créditos:** los planes Max, Ultra y Team de Claude traen créditos mensuales de API (Max: 100 dólares por mes) que se reclaman en claude.ai → Settings → Billing → API credits → Link organization. Esos créditos sirven para la clave de API que usa la tienda. No cubren el uso interactivo de Claude Code ni el uso extra de la app.
