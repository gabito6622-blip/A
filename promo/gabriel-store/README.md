# Publicidad Gabriel Store (TikTok, vertical 1080×1920)

| Archivo | Qué es |
|---|---|
| `gabriel-store-40s.mp4` | Publicidad completa (38,5 s) |
| `gabriel-store-15s.mp4` | Versión corta (15,5 s) |
| `portada-tiktok.jpg` | Portada para TikTok |
| `gabriel-store-40s.srt`, `gabriel-store-15s.srt` | Subtítulos sincronizados con la voz |
| `voces/` | Pruebas de casting de voz |

## Datos verificados

Precios leídos de la tienda publicada (`tienda-production-8c7b.up.railway.app/api/catalog`) el 10/11/2026, por 30 días:

| Plataforma | En la tienda | En el video |
|---|---|---|
| Netflix | Netflix Premium HD 4K · Bs 40 | desde Bs 40 |
| Gemini | Invitación Gemini · Bs 18 | Gemini Pro · Bs 18 (precio elegido por el dueño) |
| Disney+ | sin ESPN Bs 17 · con ESPN Bs 35 | desde Bs 17 |
| Prime Video | Bs 20 | Bs 20 |
| Max | HBO Max · Bs 15 | Bs 15 |
| ChatGPT | ChatGPT Premium · Bs 40 | Bs 40 |
| Canva | Canva EduPro · Bs 5 | Bs 5 |
| CapCut | CapCut Pro · Bs 35 | Bs 35 |

- Duolingo y Zoom Pro **no** están en la tienda: no aparecen en el video.
- Los paquetes Creador, IA Profesional y Full Premium no aparecen.
- «Pagá con QR bancario»: la tienda cobra con QR BCP.
- WhatsApp del cierre: +591 69047715 (el de la tienda).
- La tienda no tiene un logo cargado: el monograma «G» y el logotipo GABRIEL STORE se diseñaron para esta pieza.
- Las plataformas se muestran con su nombre en nuestra tipografía y sus colores; no se usan logotipos ni imágenes de series o películas.

## Voz

- Locutor: **José** (ElevenLabs Voice Library, voz original, no es clon de nadie), modelo **Eleven v4**.
- Para que diga «Ga-bri-ÉL stor», el texto hablado usa «Gabriél Stor». En pantalla y subtítulos se escribe «Gabriel Store».
- La clave de ElevenLabs no está en el repositorio: la agrega el proxy del entorno.
- Créditos usados en todo el proceso: 746 (pruebas 407 + narración completa 247 + corta 92).

## Rehacer (proyecto editable)

```bash
python3 narracion.py full && python3 narracion.py short     # voz + tiempos (gasta créditos)
python3 music.py full audio/musica-full.wav && python3 music.py short audio/musica-short.wav
bash mezcla.sh full && bash mezcla.sh short                  # voz + música, -14 LUFS
python3 subtitulos.py full && python3 subtitulos.py short
node render.cjs full frames-full && node render.cjs short frames-short && node render.cjs cover .
ffmpeg -framerate 30 -i frames-full/f%05d.png -i audio/mezcla-full.wav -c:v libx264 -crf 20 -preset slow \
  -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -shortest gabriel-store-40s.mp4
```

`publicidad.html` es la animación (abrila con `?v=full&play` para verla en el navegador). Los tiempos de cada escena están al principio del script.
