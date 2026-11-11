# Promo TikTok · GaboHub «Para revendedores» (con voz)

Vertical 1080×1920, 30 fps, 46 s, con voz en off (locutor Marco, ElevenLabs Eleven v4), subtítulos y música original
sintetizada acá (sin copyright). Mismo estilo que el primer video de Barbiño.

| Archivo | Qué es |
|---|---|
| `gabohub-revendedores.mp4` | El video final |
| `portada.jpg` | Portada para TikTok |
| `gabohub-revendedores.srt` | Subtítulos sincronizados con la voz (los mismos van grabados en el video) |

## Guion (125 BPM, 1 compás = 1,92 s)

| Tiempo | Escena | Voz |
|---|---|---|
| 0:00 – 0:05.8 | **Gancho:** «¿Vendés streaming?» → cuaderno, proveedor, reclamos, «¿cuánto gané?» tachados → «Esto se terminó.» | ¿Vendés streaming y anotás todo en un cuaderno? Esto se terminó. |
| 0:05.8 – 0:09.6 | **Logo:** GaboHub · PARA REVENDEDORES | Con GaboHub, vendés streaming con tu propia marca. |
| 0:09.6 – 0:13.4 | 01 Precios de mayorista | Comprás a precio de revendedor, con tu saldo. |
| 0:13.4 – 0:17.3 | 02 Entrega al instante | La cuenta te llega al instante, sin esperar. |
| 0:17.3 – 0:21.1 | 03 Tus clientes | Ves tus clientes y quién vence esta semana. |
| 0:21.1 – 0:25.0 | 04 Renovar | Renovás en un toque, y le avisás por WhatsApp. |
| 0:25.0 – 0:28.8 | 05 Tu tienda | Tenés tu propia tienda, con tu logo y tus colores. |
| 0:28.8 – 0:32.6 | 06 Combos | Armás tus combos… y la ganancia es tuya. |
| 0:32.6 – 0:36.5 | 07 Referidos | Y si traés a otro revendedor, ganás saldo. |
| 0:36.5 – 0:40.3 | **«Y además…»:** 16 funciones más, una por corchea | ¡Y todavía hay mucho más! |
| 0:40.3 – 0:46.1 | **Cierre:** GaboHub · precios de mayorista · entrega al instante · tu propia tienda · Bolivia | GaboHub. Escribinos y empezá hoy. |

No lleva enlaces ni números de contacto: se agregan en el texto de la publicación.

## La tienda que se ve

Todo sale de una copia **local** de la tienda con datos **ficticios** (nunca de la tienda real):

- `seed-video.mjs`: la revendedora de prueba «Ariana Streaming» con 6 meses de uso (28 clientes, 48 servicios).
  Sin azar: siempre salen los mismos números. La tienda en «siempre disponible», como la real.
- `vestir-tienda.cjs`: íconos propios para cada producto (diseñados acá, sin logos de las marcas), logo y portada
  de la tienda y de Ariana, y un **QR de ejemplo** (`vestir/qr-ejemplo.png`, no es una cuenta real).
- `capturas.cjs`: saca las 7 pantallas del celular (390 px ×3) y avisa si algo se ve a medio armar
  («Agotado», «A pedido», «todavía no cargó…»). Cambia «http://localhost:8090» por «gabohub» en lo que se ve.

Arreglado en la app para este video: los combos sin imagen (también los propios del revendedor) muestran los íconos
de sus apps, y la franja de apps usa la imagen de cada producto en vez de la letra inicial.
Para recapturar una sola pantalla: `ONLY=tienda node promo/gabohub/capturas.cjs`.

## Voz

- Locutor **Marco** (ElevenLabs Voice Library), modelo **Eleven v4**. Una frase por escena, cada una en su segundo.
- En el texto hablado dice «Gabo Jab» para que suene bien; en pantalla y subtítulos se escribe «GaboHub».
- La clave de ElevenLabs no está en el repositorio: la agrega el proxy del entorno.
- `narracion.py` avisa si una frase no entra en su escena («⚠ NO ENTRA»): ahí se acorta el texto y se rehace solo esa
  (`python3 narracion.py F3`).
- Créditos usados: unos 420 (las frases largas se rehicieron más cortas).

## Rehacer

```bash
# 1) tienda de prueba + capturas (desde la raíz del repo)
npm run build
node promo/gabohub/seed-video.mjs /tmp/gh-video          # carpeta vacía
GS_DATA_DIR=/tmp/gh-video PORT=8090 node dist/server/main.js &
node promo/gabohub/vestir-tienda.cjs
node promo/gabohub/capturas.cjs

# 2) audio (desde promo/gabohub)
cd promo/gabohub
python3 music.py audio/musica.wav
python3 narracion.py            # gasta créditos de ElevenLabs solo en las frases que faltan
bash mezcla.sh                  # voz + música (la música baja cuando habla), -14 LUFS
python3 subtitulos.py           # captions.js + .srt

# 3) video
node render.cjs frames          # o --stills 11,27 para revisar segundos sueltos
ffmpeg -y -framerate 30 -i frames/f%05d.png -i audio/mezcla.wav \
  -c:v libx264 -preset slow -b:v 5200k -maxrate 7000k -bufsize 10000k -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest gabohub-revendedores.mp4
# portada: el segundo 8,2 de promo.html sin subtítulo (captura con Playwright, ver historial de la rama)
```

`promo.html` es la animación (abrila con `?play` para verla en el navegador; con audio no, el sonido va en el MP4).
Con `-crf 16` el MP4 pasa los 100 MB por el grano de la imagen y GitHub no lo acepta: por eso va a 5,2 Mbps.

## Para publicar en TikTok

- Los textos y subtítulos quedan fuera de las zonas que tapa TikTok (abajo y a la derecha).
- Texto sugerido: «¿Vendés Netflix, Disney+ o Spotify? 📺 Con GaboHub comprás a precio de revendedor, la cuenta te llega al
  instante y tenés tu propia tienda con tu marca. Escribinos y empezá hoy. #revendedores #streaming #emprendimiento #bolivia #gabohub»
