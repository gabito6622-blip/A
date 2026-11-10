# Encargo: grabar tutoriales de Barbiño (pasos + narración)

Barbiño es un sistema para barberías (Next.js, repo en /workspace/gabo-barber, rama actual;
documentación útil: docs/ingreso-barberias.md y docs/arquitectura.md §4, §6, §25–§30).
Estamos haciendo una serie de tutoriales en video, verticales, para que Gabriel (el dueño de
Barbiño, que los vende) se los muestre a barberos. Cada tutorial = una lista de PASOS; cada paso
es una captura del celular (390×844) del sistema REAL corriendo con datos FICTICIOS, un
recuadro opcional sobre el elemento a tocar, un título corto y la narración que dice el locutor.
Yo (el coordinador) después genero la voz y el video: VOS NO GENERÁS VOZ NI VIDEO.

## Herramienta
Carpeta: /tmp/claude-0/-workspace-A/54aab0e5-b810-5a8a-a381-3dd90d647a94/scratchpad/tut
- `lib.cjs`: leela. Ejecutá con `BARBINO_URL=http://localhost:<TU_PUERTO> node lib.cjs <NN>`.
  Lee `tutoriales/<NN>.cjs` y escribe `out/<NN>/steps.json` + `stepXX.png`.
- `python3 sheet.py <NN>` arma `out/<NN>/sheet.jpg` (todas las capturas con el recuadro en rojo): miralo con Read para verificar.
- `tutoriales/01.cjs` es el EJEMPLO terminado: copiá su estilo (estructura, tono, largo de los textos).
- API de T: `T.go(path)`, `T.login()` (dueño Andrés), `T.step({title, text, hl, scrollY, long, keepBanners})`,
  `T.tap(locator)`, `T.fill(locator, valor)`, `T.text("…")`, `T.label("…")`, `T.role(r, name)`, `T.page` (Playwright).
  - `hl`: locator del elemento a señalar (se dibuja un recuadro y un dedo). Usalo cuando el texto dice "tocás X".
  - `long: 2400` = captura larga (alto en px CSS) que se desliza durante el paso; úsala para pantallas largas.
  - `keepBanners: true` = no esconder el aviso "Sin PIN de gerencia" (por defecto se esconde).
  - Las direcciones web (localhost, http…) se desenfocan solas: igual, NO muestres pantallas cuyo protagonista sea un enlace.
- Tu copia AISLADA del sistema: puerto y base indicados abajo. Para volver a los datos iniciales:
  `bash stack.sh reset <tu-nombre>`. No toques otros puertos/bases ni la 3000. No modifiques /workspace/gabo-barber.
- Si tu servidor se cae: `bash stack.sh up <tu-nombre> <tu-puerto>`.

## Datos ficticios de la copia
Barbería «Barbería Imperio» (dirección corta `imperio`, Santa Cruz, Bs). Dueño: Andrés Rojas
(andres@imperio.test / DemoBarber2026!, sin PIN de gerencia creado todavía). Barberos: Kevin, Diego, Luis, Bruno
(sin cuentas de acceso). Servicios: Corte clásico Bs 40, Degradado (fade) Bs 50, Corte + barba Bs 70,
Perfilado de barba Bs 25, Diseño / líneas Bs 15, Corte niño Bs 30. ~124 clientes, ~30 días de turnos,
turnos hoy, caja abierta con 10 ventas, 40 reseñas, anticipo activado al 25 %, sin productos, sin WhatsApp del local cargado.
Si necesitás imágenes (logo, QR del banco, comprobante, foto de servicio) generalas con PIL en tu carpeta
de trabajo, claramente de ejemplo (ej. un QR falso con texto "EJEMPLO"). Nada de datos reales.

## Reglas de contenido (importantes)
- Habla Gabriel, en español boliviano/rioplatense con VOSEO ("tocás", "ponés", "fijate"), cálido, simple,
  como explicándole a un barbero sin experiencia en sistemas. Nada de palabras técnicas (no "RLS", "servidor", "base de datos", "URL").
- Cada tutorial responde lo que un barbero preguntaría ("¿y si…?", "¿se puede…?"). Metelas como preguntas en la narración.
- SOLO contá lo que el sistema hace DE VERDAD: verificalo leyendo el código de esa pantalla
  (src/app/[slug]/panel/..., src/server/...). Si algo depende del plan, decilo ("según tu plan").
  Si una función no se puede mostrar en la copia (ej. avisos al celular sin claves), explicala igual sin inventar pantallas.
- Nunca digas ni muestres una dirección web/dominio. Decí "tu página", "el enlace", "el QR".
- Largo: 12 a 18 pasos por tutorial; la suma de los `text` de un tutorial entre 2.600 y 3.400 caracteres
  (la voz es cara: no te pases de 3.400). Cada `text` idealmente 120–300 caracteres. Números escritos como se dicen
  ("veinticinco por ciento", "Bs 50" está bien). Títulos de paso: 1–4 palabras.
- El primer paso saluda corto y dice qué vamos a ver; el último cierra ("…cualquier duda, me escribís por WhatsApp. ¡Nos vemos en el próximo tutorial!").
- `learn`: 3–5 ítems cortos (se muestran en la portada del video). `number` y `title` exactos como te los paso.
- Cada captura debe mostrar algo concreto y relacionado con lo que se dice (no repitas la misma pantalla 4 veces seguidas).
- El guion debe funcionar desde los datos iniciales: antes de tu corrida FINAL hacé `bash stack.sh reset <tu-nombre>`
  y corré cada tutorial (en orden). Si un tutorial crea cosas, que las cree él mismo.

## Entrega
Por cada tutorial: `tutoriales/NN.cjs` y la corrida final en `out/NN/` (sin errores, revisada con sheet.jpg).
Al terminar, respondé breve: por tutorial, cantidad de pasos y de caracteres, y cualquier cosa que no pudiste mostrar
o que dudás si es cierta. No generes voz, no llames a build.py, no uses la API de ElevenLabs.
