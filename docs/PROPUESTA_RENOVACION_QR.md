# Propuesta: renovar con QR o saldo desde el aviso (sin activar)

Fecha: 13/11/2026 · Estado: **aprobada por el dueño e implementada APAGADA** en la rama `optimizacion-1` (Optimización 2). Se prende en Configuración → Soporte. Detalles en `docs/CHANGELOG.md` y `docs/PUBLICACION_Y_REVERSION.md`.

## El problema de hoy
Cuando a un cliente le vence un servicio, Tito le manda el aviso al celular (si lo activó) y el cliente te escribe por WhatsApp, te manda el comprobante, vos lo revisás, aprobás y renovás. Son 4 idas y vueltas por cada renovación; con 78 alquileres activos y 20 que vencen cada semana, es la mayor parte de tu trabajo diario.

## Qué ya existe (no hay que construirlo)
- **Renovar desde la tienda** (`POST /api/me/renew`): el cliente con sesión puede pedir la renovación de su servicio pagando con **saldo** (se entrega al instante) o con **QR + comprobante** (queda «En revisión» hasta que vos aprobás).
- **Aprobación humana** en Aprobar pagos, con los frenos de la etapa 1 (comprobante repetido, referencia normalizada, monto verificado).
- **Freno del proveedor:** no se renueva más allá de la fecha de la cuenta del proveedor.
- **Avisos de vencimiento** de Tito (web push) y los «Mensaje listo» de la secretaria (WhatsApp manual).
- **Link de acceso** del cliente (`login-link`) que lo deja adentro de su cuenta sin PIN.

## Lo que falta (la propuesta)
1. **Un link de renovación en el aviso.** El aviso de Tito y el «Mensaje listo» llevan un link corto que abre la tienda con el servicio ya elegido en «Renovar» (`/tienda/#renovar=<id>`), con sesión por link de acceso (válido 48 h, un solo servicio).
2. **Pantalla «Renovar» en la tienda:** muestra servicio, fecha actual, fecha nueva, precio (en Bs o US$ según su lista) y dos botones: **Pagar con saldo** (si alcanza, entrega al instante) o **Pagar con QR** (sube comprobante → En revisión).
3. **Aprobación humana donde corresponde:** con saldo no hace falta (la plata ya entró); con QR vos aprobás como siempre. Nada se entrega sin plata confirmada.
4. **Revendedores:** el mismo link sirve para que el revendedor renueve lo de sus clientes con su saldo de GaboHub (ya existe «renovar varios»); lo nuevo es llegar con un toque desde el aviso.
5. **Nada automático:** no se cobra solo, no se renueva solo, no se manda nada que hoy no se mande. Solo acorta el camino cuando el cliente ya quiere pagar.

## Reglas
- Un link = un servicio, 48 h, un solo uso para pagar (no da acceso a Mis cuentas completo si el dueño no quiere: modo «solo renovar»).
- El freno del proveedor se aplica antes de cobrar (hoy ya es así para QR).
- Si el cliente paga con QR dos veces, el segundo comprobante queda marcado «repetido» (etapa 1).
- Todo queda en Auditoría: quién renovó, con qué, cuándo.

## Riesgos y cómo se cubren
| Riesgo | Cobertura |
|---|---|
| Link reenviado a otra persona | 48 h, un servicio, pago únicamente; no muestra claves |
| Cliente paga y vos no aprobás a tiempo | la pantalla dice el horario y el tiempo estimado (ya existe) |
| Renovación que pasa la fecha del proveedor | freno existente antes de cobrar |
| Doble pago | comprobante repetido bloqueado; con saldo, idempotencia por pedido |

## Esfuerzo estimado
- Link + pantalla «Renovar» + prueba Playwright: **3–4 h**.
- Integrar el link en el aviso de Tito y en los «Mensaje listo»: **1 h**.
- Se puede publicar apagado (interruptor en Configuración) y prender cuando el dueño quiera.

## Qué necesito del dueño para arrancar
- OK a la propuesta y a que el link entre al aviso de Tito.
- Si quiere que el link también sirva para **Mis cuentas** completo o solo para renovar.
- Texto del mensaje (o uso el de la secretaria con `{link}`).
