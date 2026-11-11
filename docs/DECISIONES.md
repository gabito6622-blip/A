# Decisiones (registro)

Cada decisión: fecha · qué se decidió · por qué · alternativas descartadas. Lo nuevo va arriba.

## 2026-11-11 · Pulido de GaboHub en 4 miradas + seguridad
- **Qué:** auditar con datos ficticios desde 5 lugares (cliente que compra, revendedor, quien atiende el panel, dueño, aislamiento entre revendedores) y arreglar por impacto.
- **Por qué:** el dueño pidió "ponete en el lugar de cada uno". Separar miradas evita que un arreglo para el dueño rompa al revendedor.
- **Límite:** nada de pagos, cuentas ni mensajes reales; no se publica sin permiso del dueño.

## 2026-11-10 · Dominio propio: tienda en la portada, GaboHub en /hub
- **Qué:** con `GS_PUBLIC_ORIGIN=https://gabostore.lat`, `gabostore.lat/` lleva a la tienda, `www` redirige al dominio principal y GaboHub vive en `/hub`. El link de Railway sigue mostrando GaboHub en `/`.
- **Por qué:** el plan Hobby de Railway permite 2 dominios propios por servicio (raíz + www); los clientes finales son la mayoría del tráfico.
- **Descartado:** subdominio `hub.gabostore.lat` (necesita un 3er dominio en Railway).

## 2026-11-10 · Avisos al celular separados por persona
- **Qué:** las suscripciones de clientes/revendedores (`push_csubs`) están aparte de las del equipo (`push_subs`). Un revendedor nunca recibe avisos del panel. En la tienda publicada con https, las claves VAPID se generan solas y quedan guardadas.
- **Por qué:** privacidad y cero configuración para el dueño.

## 2026-11-10 · Fiado: una libreta por acreedor
- **Qué:** el fiado del dueño y el de cada revendedor son libretas distintas (`creditorId`). El revendedor solo anota a SUS clientes. "Mi control" del revendedor usa `rcontrol`, separado del Control del dueño.
- **Por qué:** un revendedor nunca debe ver lo que le deben a otro ni tocar el Control del dueño.

## 2026-11-10 · Fallas con estados y aviso al que reportó
- **Qué:** Recibido → Revisando → Solucionado; responde el equipo (rol `customer.manage`); al cambiar de estado se avisa al celular de quien reportó. El revendedor ve email/perfil de la cuenta de SU cliente, nunca datos internos (quién reportó, id de cuenta).

## 2026-11-10 · Mensajes por WhatsApp siempre manuales (wa.me)
- **Qué:** los avisos a clientes ("vence", "te debo", "ya quedó") se arman listos pero los manda una persona con un toque.
- **Por qué:** sin riesgo de bloqueo de número ni mensajes no deseados; el bot oficial de Meta es aparte y opcional.

## 2026-11-10 · Fechas en hora de Bolivia
- **Qué:** `TZ=America/La_Paz` en el servidor y formato con zona La Paz en el navegador; "vence en X días" cuenta días de calendario.
