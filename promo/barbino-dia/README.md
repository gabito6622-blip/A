# «Un día en Barbería Imperio» · Barbiño (sin voz)

Vertical 1080×1920, 30 fps, 47 s, sin voz, con música original sintetizada acá (sin copyright).
Archivo final: `barbino-un-dia.mp4` (portada: `portada.jpg`).

## La idea

Un día entero de una barbería contado con un **reloj dorado** que avanza de 08:00 a 21:30. En cada momento llega una
**notificación de Barbiño** al celular y se ve la **pantalla real** de ese momento. Entre momento y momento, un
**tijeretazo**: una línea dorada corta la pantalla en diagonal y las dos mitades se separan. Estilo negro y dorado
(como la página pública de la barbería), con un poste de barbería girando en el borde.

| Hora | Pantalla | Texto | Notificación |
|---|---|---|---|
| 07:59 → 08:00 | — | Un día en Barbería Imperio · con Barbiño | — |
| 08:00 | Inicio del panel | El día ya está armado. | 57 turnos para hoy · Bs 2.510 previstos |
| 08:05 | Avisos | Mientras dormías, reservaron solos. | Reserva nueva de Adrián |
| 10:15 | Comprobante → reserva confirmada | El anticipo llega por QR. | Comprobante de Carla → Anticipo verificado |
| 12:00 | Agenda del día | Cuatro sillas, cero turnos pisados. | Kevin · Diego · Luis · Bruno |
| 15:25 | «Ya llegué» | «Ya llegué», desde la puerta. | Ramiro llegó · le avisamos a Kevin |
| 20:30 | Cerrar caja | Cerrás la caja en un minuto. | Contás el efectivo y Barbiño compara |
| 21:00 | Reseñas | Y tus clientes te recomiendan. | ★ 4.8 · 40 reseñas |
| 21:30 | Página pública | Cerraste. Tu página sigue reservando. | Reservan de día o de noche |
| — | Logo | Barbiño · Tu barbería, al día desde el celular. · 14 días gratis · Sin tarjeta | — |

Cada número de las notificaciones sale de la pantalla que se ve en ese momento.

## De dónde sale

- `assets/`: capturas reales de Barbiño con la barbería de ejemplo «Barbería Imperio» (datos ficticios), las mismas
  de los tutoriales (`video/tutoriales-barbino/out/`).
- `fonts/`: Playfair Display (licencia libre OFL), para que el render no dependa de internet.
- `dia.html`: la animación. Abrila con `?play` para verla en el navegador.
- `music.py`: la música (104 BPM, groove soul/hip-hop, tic-tac en la intro y un «tijeretazo» en cada cambio).

```bash
cd promo/barbino-dia
python3 music.py music.wav
node render.cjs frames            # o --stills 5,11,37 para revisar segundos sueltos
ffmpeg -y -framerate 30 -i frames/f%05d.png -i music.wav \
  -c:v libx264 -preset slow -b:v 5200k -maxrate 7000k -bufsize 10000k -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest barbino-un-dia.mp4
```

## Para publicar

- Funciona sin sonido: todo se entiende por el texto y las notificaciones.
- Texto sugerido: «Así es un día con Barbiño 💈 Reservas solas, anticipo por QR, «Ya llegué» desde la puerta y la caja
  cerrada en un minuto. Probalo 14 días gratis. #barberia #barberos #bolivia #barbiño»
