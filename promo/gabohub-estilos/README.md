# «Desfile de estilos» · GaboHub para revendedores (con voz)

Vertical 1080×1920, 30 fps, 48,6 s, voz en off (Marco, ElevenLabs Eleven v4), subtítulos y música original
(house de pasarela, 120 BPM). Archivo final: `desfile-de-estilos.mp4` (portada: `portada.jpg`).

**No muestra precios ni stock de la tienda:** en cada tarjeta dice «Tu precio» (el revendedor pone el suyo), los cupones
van en porcentaje y el mensaje de WhatsApp sale sin monto (`sin-precios.cjs` se aplica en cada captura). Tampoco habla de
comprar: muestra lo que el revendedor puede hacer con su tienda y su panel.

## Guion

| Tiempo | Escena | Voz |
|---|---|---|
| 0:00 | Pregunta | ¿Tenés una tienda de streaming? |
| 0:01.5 | **Desfile:** la tienda cambia de estilo en cada golpe («LOOK 05/17 · Neón Cyber»…), con clic de cámara; cada estilo nombrado aparece justo cuando la voz lo dice | Elegí cómo se ve. Neón… oro… gamer… pastel… |
| 0:07 | **Mosaico** con los 17 estilos | ¡diecisiete estilos listos! |
| 0:10 | Tu logo y tu portada | Subís tu logo, tu portada… y tus colores. |
| 0:14 | Tipo de tienda, fondos y tarjetas | Elegís el fondo, las tarjetas y las letras. |
| 0:18 | Publicada, con su link, en el directorio | Y tu tienda queda publicada, con tu propio link. |
| 0:22 | Panel: clientes y vencen en 7 días | En tu panel tenés a todos tus clientes. |
| 0:26 | Toca «Avisarle» y aparece el mensaje real | Ves quién vence, y le avisás por WhatsApp con un toque. |
| 0:30 | Combos y descuentos por cantidad | Armás tus combos y tus descuentos. |
| 0:34 | Cupones y link de códigos | Creás cupones, y tus clientes ven sus códigos solos. |
| 0:38 | TU TIENDA. TU ESTILO. TUS CLIENTES. | Tu tienda. Tu estilo. Tus clientes. |
| 0:42 | GaboHub · Para revendedores · «Escribinos y armá tu tienda» | GaboHub. Armá tu tienda hoy. |

## De dónde sale

- **Catálogo real**: `traer-catalogo.sh` copia (solo lectura) los 35 productos públicos de la tienda real, con sus
  logos, a `catalogo-real/`. No cambia nada en la tienda real.
- `seed-estilos.mjs`: tienda **local** de prueba con ese catálogo y la revendedora de ejemplo «Ariana» (28 clientes,
  sus precios de venta de ejemplo, combos, descuentos y 2 cupones). `vestir.cjs`: carga los logos reales y su marca.
- `capturas-estilos.cjs`: la tienda en los 17 estilos (`assets/estilos/`). `capturas-panel.cjs`: el panel y dónde está
  cada pedazo que sale flotando (`assets/recortes.js`).
- `narracion.py` · `music.py` · `mezcla.sh` · `subtitulos.py` · `estilos.html` (la animación) · `render.cjs`.

```bash
npm run build
node promo/gabohub-estilos/seed-estilos.mjs /tmp/gh-estilos
GS_DATA_DIR=/tmp/gh-estilos PORT=8091 node dist/server/main.js &
node promo/gabohub-estilos/vestir.cjs
node promo/gabohub-estilos/capturas-estilos.cjs && node promo/gabohub-estilos/capturas-panel.cjs
cd promo/gabohub-estilos
python3 music.py audio/musica.wav && python3 narracion.py && bash mezcla.sh && python3 subtitulos.py
node render.cjs frames
ffmpeg -y -framerate 30 -i frames/f%05d.png -i audio/mezcla.wav \
  -c:v libx264 -preset slow -b:v 5200k -maxrate 7000k -bufsize 10000k -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest desfile-de-estilos.mp4
```

Voz: unos 300 créditos de ElevenLabs (quedan guardadas en `audio/`).

## Ojo

- Los **logos** de Netflix, Disney+, etc. son marcas de sus dueños (se aclara al final del video). Algunas redes pueden
  limitar publicaciones con marcas ajenas.
- Los **cupones propios** del revendedor funcionan solo si el dueño los habilita en su panel.

## Para publicar

Texto sugerido: «Tu tienda de streaming, con tu estilo 💅 17 diseños listos, tu logo, tus colores, tus combos y tus
clientes en un solo panel. GaboHub, para revendedores. Escribinos y armá tu tienda hoy. #revendedores #streaming
#emprendimiento #bolivia #gabohub»
