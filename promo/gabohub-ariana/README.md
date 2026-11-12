# «La historia de Ariana» · GaboHub para revendedores (con voz)

Vertical 1080×1920, 30 fps, 50,6 s, con voz en off (Marco, ElevenLabs Eleven v4), subtítulos y música original
sintetizada acá (sin copyright). Archivo final: `historia-de-ariana.mp4` (portada: `portada.jpg`).

## La idea

Un mini comercial con historia: una revendedora (de ejemplo) que empezó con **un cuaderno y cuarenta chats** y hoy tiene
**su propia tienda**. El recurso visual: el celular flota en 3D y los pedazos importantes de cada pantalla **salen hacia la
cámara** (el saldo, la cuenta que llega, lo que vence, el combo, el premio por referido). Estética neón rosa y celeste
(los colores de la tienda de Ariana), piso de neón y un manifiesto final: «Tu marca. Tus precios. Tus clientes.»

| Tiempo | Escena | Voz |
|---|---|---|
| 0:00 | Un cuaderno lleno de tachones y 14 chats que se amontonan | Ariana empezó con un cuaderno… y cuarenta chats sin responder. |
| 0:05 | Su tienda: sale la portada «Ariana Streaming» y el combo | Hoy tiene su propia tienda. Con su nombre y sus colores. |
| 0:10 | Precios de revendedor: sale la tarjeta de Netflix | Compra a precio de revendedor, con su saldo. |
| 0:15 | Mis cuentas: sale la cuenta con sus datos ⚡ | Y la cuenta le llega al instante. Sin esperar a nadie. |
| 0:20 | Panel: salen los números y lo que vence | Ve quién vence esta semana… y renueva con un toque. |
| 0:25 | Toca «Avisarle» y aparece el mensaje real | Le avisa por WhatsApp, con el mensaje ya escrito. |
| 0:30 | Mis combos 💸 | Arma sus combos, pone sus precios… y la ganancia es suya. |
| 0:35 | Referí y ganá: 2 referidos · Bs 40 | Y si trae a otro revendedor, también gana. |
| 0:40 | TU MARCA. TUS PRECIOS. TUS CLIENTES. | Tu marca. Tus precios. Tus clientes. |
| 0:45 | GaboHub · Para revendedores · «Escribinos y empezá tu historia» | GaboHub. Escribinos… y empezá tu historia hoy. |

Todo lo que se ve sale de la tienda **local** de prueba (`promo/gabohub/seed-video.mjs` + `vestir-tienda.cjs`), con
datos ficticios. El mensaje de WhatsApp es el que arma GaboHub de verdad al tocar «Avisarle». Al final se aclara:
«Historia, nombres y números de ejemplo».

## Archivos

- `capturas.cjs`: saca las pantallas y anota dónde está cada pedazo que sale flotando (`assets/recortes.js`).
- `narracion.py` (voz, una frase por escena) · `music.py` (pop electrónico, 96 BPM) · `mezcla.sh` · `subtitulos.py`.
- `ariana.html`: la animación (`?play` para verla). `render.cjs`: la captura cuadro a cuadro.

```bash
# tienda de prueba en el puerto 8090 (ver promo/gabohub/README.md) y después:
node promo/gabohub-ariana/capturas.cjs
cd promo/gabohub-ariana
python3 music.py audio/musica.wav && python3 narracion.py && bash mezcla.sh && python3 subtitulos.py
node render.cjs frames
ffmpeg -y -framerate 30 -i frames/f%05d.png -i audio/mezcla.wav \
  -c:v libx264 -preset slow -b:v 5200k -maxrate 7000k -bufsize 10000k -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest historia-de-ariana.mp4
```

Voz: unos 230 créditos de ElevenLabs. Las voces quedan en `audio/` para no volver a pagarlas.

## Para publicar

Texto sugerido: «Ariana empezó con un cuaderno y 40 chats. Hoy tiene su propia tienda de streaming 💜 Con GaboHub comprás a
precio de revendedor, la cuenta llega al instante y vos ponés tus precios. Escribinos y empezá tu historia.
#revendedores #streaming #emprendimiento #bolivia #gabohub»
