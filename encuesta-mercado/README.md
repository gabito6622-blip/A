# Estudio de mercado para revendedores de streaming — Gabriel Store

Un Google Apps Script que crea **en tu cuenta de Google**:

- una **carpeta nueva** en tu Google Drive llamada **Encuesta Gabriel Store**, donde queda todo lo demás;
- el **Google Forms** "Estudio de mercado para revendedores de streaming" (5 secciones, validaciones, barra de progreso y pensado para celular);
- el **Google Sheets** de respuestas, vinculado al formulario;
- las pestañas **Inicio** (enlaces y mensaje para WhatsApp), **Análisis** (panel con tablas y gráficos), **Informe** (las 7 respuestas para Gabriel Store) y **Pilotos (privado)**;
- disparadores que **actualizan el análisis solos** con cada respuesta y una vez por día.

El script **solo crea archivos nuevos** y solo modifica los que creó él (guarda sus IDs). No abre, cambia ni borra tus formularios, hojas, carpetas ni proyectos existentes. Si ya tenés una carpeta llamada "Encuesta Gabriel Store", no la toca: crea otra aparte y lo avisa en el registro.

Antes de crear el formulario definitivo, el script arma una **copia de prueba**, le envía una respuesta, comprueba que llegue a la hoja y que el análisis la procese, y manda esa copia a la papelera. El formulario definitivo arranca con **0 respuestas**.

| Archivo | Para qué sirve |
|---|---|
| `encuesta-gabriel-store.gs` | El script completo (lo pegás en Apps Script). |
| `imagenes/encabezado-formulario.png` | Encabezado de 1600×400 con tus colores para el tema del formulario. |
| `ANALISIS.md` | Procedimiento para analizar resultados reales (fase 3). |
| `analizar.mjs` | Analizador en Node del CSV anónimo (usa la misma lógica que el script). |
| `pruebas/` | Pruebas automáticas (`node --test encuesta-mercado/pruebas/encuesta.test.mjs`). |

---

## 1. Instalar (10 minutos, desde una computadora)

El editor de Apps Script no funciona bien en el celular. Usá una computadora con la cuenta de Google donde querés el formulario.

**Paso A — Crear un proyecto nuevo (no uses uno que ya tengas)**

1. Entrá a <https://script.google.com> con la cuenta de Google donde querés la encuesta.
2. Tocá **+ Nuevo proyecto**. Se abre un proyecto vacío llamado "Proyecto sin título". **No abras ni edites tus proyectos existentes**: este script va en un proyecto aparte.
3. Tocá "Proyecto sin título" (arriba a la izquierda) y renombralo `Encuesta Gabriel Store`.

**Paso B — Pegar el código**

4. Abrí [`encuesta-gabriel-store.gs`](encuesta-gabriel-store.gs) en GitHub y copiá **todo** el contenido (botón **Copy raw file**).
5. En el proyecto nuevo, en el archivo `Código.gs`, borrá las 3 líneas de ejemplo (`function myFunction() {}`) y pegá el código.
6. Guardá con el ícono del disquete o `Ctrl + S`.

**Paso C — Ejecutar y autorizar**

7. En la barra de arriba, el selector de funciones ya muestra **`instalar`** (es la primera función del archivo). Tocá **▷ Ejecutar**.
8. Aparece "Se requiere autorización" → **Revisar permisos** → elegí tu cuenta.
9. Como el script es tuyo y no está publicado, Google muestra "**Google no verificó esta app**". Tocá **Configuración avanzada** → **Ir a Encuesta Gabriel Store (no seguro)**. Es seguro porque el código es el que acabás de pegar y corre solo en tu cuenta.
10. Revisá la lista de permisos y tocá **Permitir**:

    | Permiso que muestra Google | Para qué lo usa |
    |---|---|
    | Ver, editar, crear y borrar tus formularios | Crear **este** formulario. |
    | Ver, editar, crear y borrar tus hojas de cálculo | Crear **esta** hoja y el panel. |
    | Ver, editar, crear y borrar tus archivos de Drive | Crear la carpeta, mover ahí los archivos nuevos, mandar a la papelera la copia de prueba y crear el CSV anónimo. |
    | Ejecutarse cuando no estás presente | Actualizar el análisis cuando llega una respuesta. |

    Google describe los permisos de forma amplia ("todos tus archivos"), pero el código solo usa los archivos que crea. Podés quitarle el acceso cuando quieras en <https://myaccount.google.com/permissions>.

**Paso D — Comprobar el resultado**

11. Esperá 1 a 2 minutos. En el **Registro de ejecución** tenés que ver, en este orden:
    - `0/4 Carpeta de Drive: Encuesta Gabriel Store → ...`
    - `Estructura OK: 22 preguntas en 5 secciones.` (aparece dos veces: en la prueba y en el definitivo)
    - `PRUEBA AISLADA: OK. ...`
    - `Listo. Formulario definitivo con 0 respuestas, guardado junto a la hoja en la carpeta "Encuesta Gabriel Store".`
    - `ENLACE PARA RESPONDER`, `ENLACE CORTO`, `ENLACE PARA EDITAR`, `GOOGLE SHEETS`, `CARPETA DE DRIVE`, `COMPARTIR POR WHATSAPP`.

    Si aparece `PRUEBA FALLIDA` o `ESTRUCTURA INCORRECTA`, **no se creó el formulario definitivo**. Copiá el mensaje completo y pasámelo.
12. En Google Drive vas a ver la carpeta **Encuesta Gabriel Store** con el formulario y la hoja de respuestas. La copia de prueba queda en la papelera (se borra sola a los 30 días).
13. Si volvés a ejecutar `instalar`, no crea nada nuevo: solo vuelve a mostrar los enlaces. Para verlos en cualquier momento ejecutá `mostrarEnlaces`. También están en la pestaña **Inicio** de la hoja.

> ¿Querés la versión corta? Antes del paso 5, cambiá `VERSION_CORTA: false` por `VERSION_CORTA: true` (cerca del inicio del archivo). Ver la sección 3.

## 2. Aplicar los colores (2 minutos, manual)

Google no permite cambiar el tema del formulario desde un script, así que este paso es manual:

1. Abrí el **enlace para editar** y tocá el ícono de la paleta (**Personalizar tema**).
2. **Encabezado → Elegir imagen → Subir**: subí [`imagenes/encabezado-formulario.png`](imagenes/encabezado-formulario.png).
3. **Color**: tocá **+** (color personalizado) y escribí `#19223B` (azul marino). Botones y barra de progreso quedan en azul con texto blanco, que es lo que mejor se lee.
4. **Fondo**: elegí el tono más claro (casi blanco).
5. **Estilo de fuente**: dejá la fuente básica (se lee mejor en celular) y el tamaño por defecto.

El amarillo dorado `#FFCC33` está en el encabezado y en las pestañas de la hoja. No se usa para texto sobre blanco porque se lee mal.

## 3. Por qué estas preguntas (y la versión corta)

Son las 20 preguntas que pediste, con cuatro ajustes para que el análisis funcione mejor:

- **País y ciudad** son dos preguntas: país con opciones (se puede contar) y ciudad escrita.
- **Lo que te gusta / lo que te molesta** son dos preguntas abiertas, opcionales: así se puede saber qué molesta de cada sistema.
- **Tres mayores problemas** y **funciones más valoradas** aceptan **hasta 3** (no exactamente 3), para no obligar a inventar un tercer problema.
- Todas las preguntas abiertas son **opcionales**, salvo el nombre del sistema actual (se puede escribir "Ninguno").

Total: 22 preguntas, unos 5 a 7 minutos. **Versión corta** (`VERSION_CORTA: true`): 18 preguntas, unos 4 minutos. Quita ventas por mes, "qué te gusta", tiempo diario y modalidad de pago. Conserva todo lo indispensable para priorizar funciones, fijar precios, encontrar el mejor segmento y detectar pilotos. Mi recomendación: **usá la versión completa** si la vas a mandar a contactos que te conocen; **usá la corta** para grupos grandes donde nadie te conoce.

Validaciones incluidas:

| Pregunta | Validación |
|---|---|
| WhatsApp | Opcional. Si se escribe, debe empezar con `+` y código de país (ej. `+591 71234567`). |
| Nombre / ciudad / sistema | Largo máximo (80 / 60 / 150 caracteres). |
| Problemas y funciones | Máximo 3 opciones. |
| Respuestas abiertas | Máximo 600 caracteres. Aviso de no escribir contraseñas ni datos de clientes. |

El formulario **no pide correo**, no exige iniciar sesión en Google (para no perder respuestas) y no deja editar después de enviar.

## 4. Probar sin ensuciar los resultados

- La prueba automática ya se hizo durante `instalar` en una copia que fue a la papelera. Podés repetirla cuando quieras ejecutando `probarEnEntornoAislado` (tampoco toca el formulario definitivo).
- Si querés probarlo vos desde el celular en el formulario real, **escribí tu nombre empezando con `[PRUEBA]`** (ej. `[PRUEBA] Gabriel`). Esa respuesta queda en la hoja pero **no se cuenta** en el análisis, el informe ni los pilotos.
- Para borrar una respuesta de prueba de la hoja: eliminá su fila en la pestaña **Respuestas**. (En el formulario: **Respuestas → ⋮ → Eliminar todas las respuestas** solo si todavía no compartiste el enlace.)

Revisión en celular antes de compartir:

1. Abrí el enlace corto en tu teléfono.
2. Respondé completo con nombre `[PRUEBA] ...`. Probá un WhatsApp sin `+` para ver que avisa el error.
3. Comprobá que la respuesta aparezca en la pestaña **Respuestas** y que el panel **no** la cuente.

## 5. Compartir por WhatsApp

En la pestaña **Inicio** tenés el **mensaje sugerido** y el enlace **Compartir por WhatsApp** (`https://wa.me/?text=...`): al abrirlo desde el celular, WhatsApp abre con el mensaje listo para elegir a quién mandarlo.

Mensaje sugerido (el script le agrega el enlace corto real):

> ¡Hola! Estoy haciendo un estudio para revendedores de streaming (Netflix, Disney+, Prime, HBO Max y más). Quiero saber qué herramientas usás y qué te complica el día a día. Son 5 a 7 minutos y no te pido contraseñas ni datos de tus clientes. ¿Me ayudás respondiendo? [enlace] ¡Gracias! — Gabriel Store

Recomendaciones:

- Mandalo **uno a uno** a revendedores que conocés y en **grupos de revendedores** donde tengas permiso para publicar. No lo mandes a listas compradas ni a gente que no te conoce.
- Pedile a cada **distribuidor/mayorista** que lo reenvíe a sus revendedores: es la forma más rápida de llegar a otros segmentos.
- Publicalo en tu **Estado** de WhatsApp.
- Mandá **un solo recordatorio** a las 48 horas a quien no respondió.
- Anotá **dónde** lo compartiste (grupo, distribuidor, estado). Si una fuente domina las respuestas, los resultados se inclinan hacia ese tipo de revendedor.

## 6. Actualizar el análisis

- **Automático**: cada respuesta nueva actualiza Análisis, Informe y Pilotos. Además se actualiza todos los días a las 7:00 (hora de Bolivia).
- **A mano**: en Apps Script elegí `actualizarAnalisis` y tocá **Ejecutar**.
- **Pilotos**: en la pestaña **Pilotos (privado)** completá las columnas amarillas (**Contactado, Demo realizada, Prueba iniciada, Pagó o dejó anticipo, Notas**) **solo cuando el hecho ocurra de verdad**. Esas marcas son las que convierten una intención "declarada" en "verificada". Se conservan en cada actualización.
- No cambies los títulos de las preguntas en el formulario. Si lo hacés, cambiá el mismo título en `PREGUNTAS` dentro del script, o el panel mostrará "Columnas no encontradas".

## 7. Privacidad

- **No compartas** la hoja de respuestas, ni las pestañas **Respuestas** o **Pilotos (privado)**: tienen teléfonos.
- Para mostrar resultados a otra persona ejecutá `crearReporteParaCompartir`: crea **otra hoja** solo con Análisis e Informe, sin nombres ni teléfonos (los pilotos aparecen como P01, P02...).
- El panel y el informe nunca muestran teléfonos. Las citas de respuestas abiertas se limpian de números, correos y enlaces.
- No compartas el **enlace para editar**.

## 8. Funciones del script

| Función | Qué hace |
|---|---|
| `instalar` | Prueba aislada + crea formulario, hoja, pestañas y disparadores. Solo la primera vez. |
| `mostrarEnlaces` | Muestra los enlaces reales en el registro. |
| `probarEnEntornoAislado` | Repite la prueba en una copia que va a la papelera. |
| `actualizarAnalisis` | Recalcula Análisis, Informe y Pilotos. |
| `crearReporteParaCompartir` | Hoja nueva sin datos personales, dentro de la carpeta. |
| `exportarCsvAnonimo` | CSV sin nombre, teléfono ni ciudad, dentro de la carpeta (para el análisis de la fase 3). |

## 9. Problemas comunes

| Síntoma | Solución |
|---|---|
| El enlace dice que el formulario no está publicado o no acepta respuestas | Abrí el enlace para editar y tocá **Publicar** (arriba a la derecha). Revisá en **Configuración → Respuestas** que cualquiera con el enlace pueda responder. |
| `Ya está instalado` | Es normal: no duplica nada. Ejecutá `mostrarEnlaces`. |
| `PRUEBA FALLIDA: La respuesta de prueba no llegó a la hoja` | Google tardó más de 60 segundos. Ejecutá `instalar` de nuevo; la copia anterior ya fue a la papelera. |
| El panel dice "Columnas no encontradas" | Se cambió el título de una pregunta. Igualá el título en `PREGUNTAS` dentro del script. |
| El panel no se actualizó | Ejecutá `actualizarAnalisis`. Si da error, revisá en Apps Script → **Activadores** que existan `alEnviarRespuesta` y `actualizacionDiaria`. |

## 10. Qué se verificó y qué no

Verificado en este repositorio:

- Todas las llamadas a Google (FormApp, SpreadsheetApp, DriveApp, ScriptApp, Charts...) se comprobaron contra las definiciones oficiales `@types/google-apps-script`.
- `instalar()` se ejecutó de punta a punta en una **simulación en memoria** de Forms/Sheets/Drive (`pruebas/google-falso.mjs`): crea la carpeta nueva y guarda ahí todo lo que genera; un formulario, una hoja y una carpeta "Encuesta Gabriel Store" que ya existían quedan exactamente igual; la prueba aislada pasa y va a la papelera, el formulario definitivo queda con 0 respuestas, el análisis cuenta bien (incluidas opciones con comas), excluye `[PRUEBA]`, no muestra teléfonos, conserva las marcas manuales de Pilotos, el reporte compartible y el CSV anónimo no tienen datos personales, y un texto como `=IMPORTXML(...)` escrito por un encuestado se guarda como texto y no como fórmula.

**No verificado aquí**: la ejecución real en Google. Esa la hace `probarEnEntornoAislado()` dentro de tu cuenta durante `instalar()`, y el diseño visual del tema se aplica a mano (sección 2).
