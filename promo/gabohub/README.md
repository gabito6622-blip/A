# Promo TikTok · GaboHub «Para revendedores»

Mismo formato que el primer video de Barbiño (`promo/barbino/` en la rama `claude/barbino-promo-video-w0zm2j`):
vertical 1080×1920, 30 fps, 40 s, música original sintetizada acá (sin copyright).
Archivo final: `gabohub-revendedores.mp4` (portada: `portada.jpg`).

## Guion (sincronizado a 125 BPM, 1 compás = 1,92 s)

| Tiempo | Escena |
|---|---|
| 0:00 – 0:03.8 | **Gancho:** «¿Vendés streaming?» → vencimientos en un cuaderno, esperando al proveedor, clientes reclamando, «¿cuánto gané? ni idea»… tachados → «Esto se terminó.» |
| 0:03.8 – 0:07.7 | **Logo:** «G» + GaboHub + «Vendé streaming con tu propia marca.» + PARA REVENDEDORES |
| 0:07.7 – 0:30.7 | **12 funciones**, una por compás, con capturas reales de GaboHub en un celular: precios de mayorista, entrega al instante, saldo, panel, vencimientos, renovar con saldo, inicio, tienda propia, estilos, combos propios, directorio de tiendas y referidos |
| 0:30.7 – 0:34.6 | **Ráfaga «Y además…»:** 16 funciones más, una por corchea |
| 0:34.6 – 0:40.3 | **Cierre:** GaboHub · PARA REVENDEDORES · precios de mayorista · entrega al instante · tu propia tienda · Bolivia · «Escribinos y empezá hoy» |

No lleva enlaces ni números de contacto: se agregan en el texto de la publicación.

## Cómo se arma

- `promo.html`: la animación. Abrila con `?play` para verla en el navegador.
- `music.py`: la música (numpy), Do mayor C–G–Am–F. `python3 music.py music.wav`
- `render.cjs`: captura cada cuadro con Playwright. `node render.cjs frames` (o `--stills 9,24.5` para revisar segundos sueltos).
- `assets/`: capturas reales de GaboHub con **datos ficticios** (revendedora de prueba «Ariana Streaming»).
- `capturas.cjs`: vuelve a sacar esas capturas desde una copia **local** de la tienda.

```bash
# capturas (opcional, ya están en assets/)
npm run build
node scripts/seed-reseller-demo.mjs /tmp/gh-demo
GS_DATA_DIR=/tmp/gh-demo PORT=8090 node dist/server/main.js &
node promo/gabohub/capturas.cjs

# video
cd promo/gabohub
python3 music.py music.wav
node render.cjs frames
ffmpeg -y -framerate 30 -i frames/f%05d.png -i music.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest gabohub-revendedores.mp4
```

Notas de las capturas:
- La semilla de demo arma clientes al azar, así que los números de los textos (28 clientes, 39 servicios, 10 vencen esta
  semana…) corresponden a las capturas guardadas en `assets/`. Si las sacás de nuevo, revisá esos textos en `promo.html`.
- Antes de capturar se cargaron 6 cuentas de ChatGPT Plus de prueba para que no aparezca «Agotado».
- `capturas.cjs` cambia «http://localhost:8090» por «gabohub», saca las tarjetas «Agotado» (los combos) y el aviso de
  «la tienda todavía no cargó su QR», que solo pasan en la demo local.

## Para publicar en TikTok

- Los textos importantes quedan fuera de las zonas que tapa TikTok (abajo y a la derecha).
- Texto sugerido: «¿Vendés Netflix, Disney+ o Spotify? 📺 Con GaboHub comprás a precio de revendedor, la cuenta te llega al
  instante y tenés tu propia tienda con tu marca. Escribinos y empezá hoy. #revendedores #streaming #emprendimiento #bolivia #gabohub»
