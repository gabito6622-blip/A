# Publicidad de Pardo Barber Club · «Tu turno en 4 toques»

Vertical 1080×1920, 30 fps, 42 s, sin voz, con música original sintetizada acá (sin copyright).
Archivo final: `pardo-reserva-online.mp4` (portada: `portada.jpg`). Es para que **Pardo** la publique para sus clientes.

> **Ojo antes de publicar:** los precios, barberos (Camilo, Diego, Mateo, Luis), la dirección (Calle Libertad 245),
> el horario y las reseñas son **datos de ejemplo**, los mismos del primer video de Barbiño. Si Pardo es real,
> hay que cambiarlos por los de verdad y volver a sacar las capturas (ver «Rehacer»).

## Guion (98 BPM, 1 compás = 2,45 s)

| Tiempo | Escena |
|---|---|
| 0:00 – 0:04.9 | **Gancho:** «¿Todavía pedís turno por mensaje?» · el chat («Hola!», «¿Tenés turno hoy a la tarde?», «Para un degradado») queda en *Visto* → «Ya no hace falta.» |
| 0:04.9 – 0:07.3 | **Logo:** Pardo Barber Club · «Ahora reservás online, en 1 minuto.» |
| 0:07.3 – 0:26.9 | **Los 4 toques**, con número gigante y un dedo que toca la pantalla real: 1 Elegí tu corte · 2 Elegí tu barbero · 3 Elegí día y hora · 4 Dejá tu nombre (sin crear cuenta) |
| 0:26.9 – 0:31.8 | **¡Turno reservado!** con el QR del anticipo (Bs 18) y el resto en el local |
| 0:31.8 – 0:36.7 | **Conocé a tu barbero:** perfil de Camilo, ★ 4.9 · 60 reseñas |
| 0:36.7 – 0:42.2 | **Cierre:** logo · «Reservá desde el link de la bio» · dirección y horario · «Reservas con Barbiño» |

La música va sincronizada: un «pop» por cada mensaje del chat y un clic en cada toque del dedo.

## Cómo se arma

- `seed-pardo.mjs`: los datos de ejemplo de Pardo (los del primer video) en una base **local** de Barbiño (gabo-barber).
- `vestir/gen.cjs` + `vestir/cargar.py`: logo, portada, imágenes de servicios, retratos de barberos (monograma con su
  herramienta) y un QR que dice «EJEMPLO». Todo ilustración propia, nada de fotos ni logos de terceros.
- `capturas.cjs`: recorre la página y la reserva como un cliente y guarda las pantallas en `assets/`, más dónde toca
  el dedo (`assets/taps.js`).
- `pardo.html`: la animación (`?play` para verla). `music.py`: la música.

```bash
# 1) Barbiño local con Pardo (en /workspace/gabo-barber, con Postgres corriendo y npm run build hecho)
npx prisma migrate deploy && npx prisma db seed
MIGRATION_DATABASE_URL=postgresql://gabo_owner:gabo_owner_dev@localhost:5432/gabo node /ruta/a/promo/pardo/seed-pardo.mjs
node promo/pardo/vestir/gen.cjs promo/pardo/vestir/png && python3 promo/pardo/vestir/cargar.py /workspace/gabo-barber
OFFSET_MS=<ms hasta las 10:30> NODE_OPTIONS="--require /ruta/a/promo/pardo/vestir/reloj-falso.cjs" npx next start -p 3000   # «Abierto ahora»
node promo/pardo/capturas.cjs

# 2) video
cd promo/pardo
python3 music.py music.wav
node render.cjs frames
ffmpeg -y -framerate 30 -i frames/f%05d.png -i music.wav \
  -c:v libx264 -preset slow -b:v 5200k -maxrate 7000k -bufsize 10000k -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest pardo-reserva-online.mp4
```

## Para publicar (desde la cuenta de Pardo)

- Texto sugerido: «¿Todavía pedís turno por mensaje? 💈 Ahora reservás en Pardo Barber Club en 1 minuto: elegís tu
  corte, tu barbero y la hora, y listo. Link en la bio. #barberia #santacruz #bolivia #degradado»
- El link de reservas va en la bio de Instagram/TikTok de Pardo (el video no muestra ninguna dirección web).
