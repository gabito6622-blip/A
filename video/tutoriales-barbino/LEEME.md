# Tutoriales de Barbiño: fuentes

Capturas, guiones y herramientas para generar los videos tutoriales (datos 100 % ficticios).

- `tutoriales/NN.cjs`: pasos y narración de cada tutorial (los 10 están escritos).
- `out/NN/`: capturas grabadas del sistema real con la barbería de ejemplo + `steps.json`.
- `vo/`: voces ya generadas con ElevenLabs (caché, para no volver a pagarlas).
- `build.py NN --render`: genera voz, arma el video y lo mezcla con la música.
- `lib.cjs`, `stack.sh`, `reset.sh`, `base.dump`: para volver a grabar capturas con la base de ejemplo.
