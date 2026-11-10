# Promo TikTok · Barbiño «Próximamente»

Video vertical 1080×1920, 30 fps, 40 s, con música original (sintetizada acá, sin copyright).
Archivo final: `barbino-proximamente.mp4` (portada: `portada.jpg`).

## Guion (sincronizado a 125 BPM, 1 compás = 1,92 s)

| Tiempo | Escena |
|---|---|
| 0:00 – 0:03.8 | **Gancho:** «¿Tenés una barbería?» → cuaderno, chats, clientes que no vienen, caja que no cuadra… tachados → «Esto se terminó.» |
| 0:03.8 – 0:07.7 | **Logo:** monograma «b» + Barbiño + «Tu barbería, al día desde el celular.» + PRÓXIMAMENTE |
| 0:07.7 – 0:30.7 | **12 funciones**, una por compás, con capturas reales de la app en un celular: reservas online 24/7, anticipo con QR, agenda por barbero, caja, clientes, recordatorios por WhatsApp, fila de espera en la tele, finanzas, comisiones, inventario, reseñas y página propia |
| 0:30.7 – 0:34.6 | **Ráfaga «Y además…»:** 16 funciones más, una por corchea |
| 0:34.6 – 0:40.3 | **Cierre:** Barbiño · PRÓXIMAMENTE · 14 días gratis · Sin tarjeta · Bolivia · «Seguinos y enterate primero» |

## Cómo se arma

- `promo.html`: la animación. Abrila con `?play` para verla en el navegador.
- `music.py`: la música (numpy). `python3 music.py music.wav`
- `render.cjs`: captura cada cuadro con Playwright. `node render.cjs frames`
- `assets/`: capturas reales del panel de Barbiño con **datos ficticios** (barbería «Pardo Barber Club» de prueba).
- `seed-video.mjs`: carga esos datos ficticios en una base **local** de gabo-barber para volver a sacar capturas.

```bash
python3 music.py music.wav
node render.cjs frames
ffmpeg -y -framerate 30 -i frames/f%05d.png -i music.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest barbino-proximamente.mp4
```

## Para publicar en TikTok

- Los textos importantes quedan fuera de las zonas que tapa TikTok (abajo y a la derecha).
- Texto sugerido: «Tu barbería, al día desde el celular 💈 Barbiño llega pronto. Reservas, anticipos por QR, caja, clientes y WhatsApp en una sola app. #barberia #barberos #bolivia #santacruz #barbiño»
