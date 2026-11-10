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

En `test/fixtures/agentes/` hay 40 mensajes de WhatsApp (con errores de tipeo, enojos, intentos de engañar al bot), 12 comprobantes (bien, con otro monto, otro número, editados, borrosos, USDT, Yappy) y 12 correos de plataformas, cada uno con lo que tiene que pasar.

```bash
npm run build
node scripts/evaluar-agentes.mjs                     # simulado: gratis, prueba conexiones y comparaciones
ANTHROPIC_API_KEY=... node scripts/evaluar-agentes.mjs --real --modelo=claude-haiku-5-5 --tope=2
```

El modo **simulado** confirma que todo está conectado y que las comparaciones del sistema (monto, número de operación, reglas de correos) son correctas; **no mide la calidad de Claude**. El modo **real** usa Claude de verdad (cuesta centavos; `--tope` corta en ese gasto) y deja `informe.md` con cada caso que falló y qué respondió. Hay que correr el modo real antes de prender los agentes para clientes, y otra vez si se cambia de modelo o de instrucciones.
