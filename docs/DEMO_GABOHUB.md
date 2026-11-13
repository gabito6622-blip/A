# Demo de GaboHub como SaaS (datos ficticios)

Creada el 13/11/2026 (Optimización 1). Sirve para mostrar GaboHub a un revendedor o a un socio **sin tocar la tienda real**: el cobro mensual está prendido **solo en esta demo**; en producción sigue apagado.

## Cómo levantarla (2 minutos)
```
npm run build
node scripts/seed-gabohub-demo.mjs /tmp/gabohub-demo
GS_DATA_DIR=/tmp/gabohub-demo GS_STATIC_DIR=public PORT=8090 npm start
```
Panel: `http://localhost:8090/panel.html` · usuario `gabriel` · clave `demo-gabriel-2026`.

## Qué trae
| Quién | Situación | Para mostrar |
|---|---|---|
| **Ana Flores** | entró hace 3 días: está en los **15 días de prueba gratis**, plan Completo, 2 clientes | cómo arranca un revendedor nuevo sin pagar |
| **Beto Mamani** | eligió el **plan Básico (Bs 25)**, ya pagó su primer mes, 3 clientes | qué se pausa en el Básico (Mi control, Quién me debe, Mis ganancias, Afiches) y el botón «Pasar al Completo» |
| **Carla Quispe** | **plan Completo (Bs 49)**, página propia publicada en `/r/carla-streaming`, 6 clientes y una renovación | el panel completo y la página pública con su marca |
| **Paula Afuera** | revendedora de Panamá en US$, en prueba | los planes en dólares (US$ 5 / US$ 3) |

Ajustes del dueño: Revendedores → Ajustes (prueba 15 días, Completo Bs 49 / US$ 5, Básico Bs 25 / US$ 3) y el selector de plan en la tarjeta de cada revendedor.

## Cómo entrar como cada revendedor
En el panel, tarjeta del revendedor → «Nuevo PIN y acceso» genera su PIN y su link de acceso. En la demo podés abrirlos vos mismo; en la tienda real el link se manda por WhatsApp **solo cuando el dueño lo decida**.

## Lo que NO hace
No manda mensajes, no cobra nada real, no toca `data/`. Si la carpeta ya tiene datos, el guion se niega a correr.
