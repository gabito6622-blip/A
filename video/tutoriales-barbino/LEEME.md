# Tutoriales de Barbiño: fuentes

Capturas, guiones y herramientas para generar los videos tutoriales (datos 100 % ficticios).

- `tutoriales/NN.cjs`: pasos y narración de cada tutorial (los 10 están escritos).
- `out/NN/`: capturas grabadas del sistema real con la barbería de ejemplo + `steps.json`.
- `vo/`: voces ya generadas con ElevenLabs (caché, para no volver a pagarlas).
- `build.py NN --render`: genera voz (solo las que no están en `vo/`), arma el video y lo mezcla con la música.
- `musica.py`: música de fondo original (90 BPM, bucle sin corte). `build.py` la crea sola si falta `bmusic.wav`.
- Videos terminados: `video/Barbino_Tutorial_01.mp4` a `video/Barbino_Tutorial_10.mp4` (3 a 4 min cada uno, unos 38 min en total).
- `lib.cjs`, `stack.sh`, `reset.sh`, `base.dump`: para volver a grabar capturas con la base de ejemplo.
