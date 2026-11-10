# Marco legal y regulatorio boliviano para un SaaS de clínicas dentales (mapa preliminar)

- **Fecha de consulta:** 2026-11-10. Revisión 2 del mismo día: verificación contra textos oficiales.
- **Qué es este documento:** un mapa preliminar de investigación para que lo revise un abogado boliviano. **No es opinión legal ni una declaración de cumplimiento.**

## Marcadores de confianza (revisión 2)

| Marcador | Significado |
|---|---|
| **[Verificado-oficial]** | Leí el texto completo de la norma en un PDF descargado de un dominio oficial (gob.bo, BCB, SIN o la copia de la Gaceta). La copia local está en `scratchpad/norms/`. |
| **[Verificado-compilador]** | Leí el texto íntegro, pero en un compilador no oficial (Lexivox) o en una copia secundaria, porque el sitio oficial no respondió. |
| **[Confirmado-oficial]** | Solo vi un extracto o un listado en un dominio oficial, sin leer el texto completo. |
| **[Secundario]** | La fuente es un blog, prensa, un repositorio académico o un agregador. |
| **[No verificado]** | Lo conozco por contexto o la fuente no mostraba el texto. |

**Limitaciones de acceso en esta revisión:**

- **No respondieron:** minsalud.gob.bo (respuesta vacía), gacetaoficialdebolivia.gob.bo (DNS) y snis.minsalud.gob.bo (conexión cortada).
- **siatinfo.impuestos.gob.bo:** falló la verificación TLS y no la desactivé.
- **Caja Nacional de Salud (cns.gob.bo):** la descarga de la Norma Técnica del Expediente Clínico y de la norma de Consentimiento Informado devolvió error 500.
- **RD 079/2022 del BCB:** el PDF es escaneado y no hay OCR disponible. Leí visualmente las páginas 1-10 y 19-26.

---

## Resumen ejecutivo

1. **Datos personales:** no hay una ley general vigente.
   - El **PL N° 538/2025-2026** figura en diputados.gob.bo "en tratamiento" en la Comisión de Constitución, Legislación y Sistema Electoral (publicado el 22-jul-2026). La legislatura 2025-2026 se clausuró el 6-nov-2026.
   - El **DS 1793 art. 56** es más amplio de lo que se creía en la revisión 1. Su texto se refiere expresamente al "tratamiento técnico de datos personales en el **sector público y privado** en todas sus modalidades" y exige **consentimiento previo y expreso, por escrito u otro medio equiparable**, deber de informar, limitación de finalidad, consentimiento para transferir y medidas de seguridad. [Verificado-oficial]
   - El art. 56 está dentro del capítulo de firma y certificación digital, así que su alcance sigue siendo una cuestión para el abogado.
2. **Salud:**
   - El texto íntegro de la Ley 3131 y del DS 28562 se verificó en el compilador.
     - El expediente, la historia clínica y el consentimiento informado son documentos oficiales bajo custodia del establecimiento (Ley 3131, art. 10).
     - El médico debe informar antes al paciente o a sus responsables legales (art. 12).
     - La ley no reconoce expresamente un derecho a copia (art. 13).
     - El DS 28562 exige que la información dada quede registrada y **suscrita por el paciente o su representante** (art. 14).
   - Un documento oficial del SEDES La Paz confirma que la **Norma Técnica para el Manejo del Expediente Clínico fue aprobada por RM N° 0090 de 26-feb-2008**, y que la **Norma técnica administrativa y Manual de Aplicaciones Odontológicas es la RM N° 0715 de 26-sep-2017**.
   - El **Reglamento del SEDES La Paz** (primer nivel, público y privado, incluidos policonsultorios y consultorios vecinales) fija **10 años en archivo activo** y luego archivo pasivo. Exige que los sistemas automatizados **impidan modificar la historia clínica una vez guardada**.
3. **Facturación (RND 102100000011, verificada):**
   - Modalidades: Electrónica en Línea (firma digital), Computarizada en Línea (huella digital/hash) y Portal Web.
   - Un sistema "propio" no puede prestar servicio a terceros sin una **nueva autorización como Proveedor** (art. 19.II). La autorización dura **3 años**, y cada versión nueva requiere pruebas (art. 20). Hay **pruebas piloto por cliente** y una "asociación proveedor-cliente".
   - Vigencias: CUIS 365 días, CUFD 24 h. La factura en línea se emite el mismo día.
   - **RND 102600000038** (30-sep-2026): abrogó el calendario de los grupos 9 a 12 y ahora el SIN asigna la modalidad. Su motivo es la Ley 1733.
   - **RND 102600000034** (1-sep-2026): todo sistema propio o de proveedor debe cumplir el "Anexo Técnico Ley N° 1733 (En construcción)" para las pruebas piloto entre el **1-oct y el 16-nov-2026**.
   - **Ley 843 (texto ordenado del SIN al 30/09/2026):** no exime de IVA ni de IT a los servicios de salud privados. El IVA es del 13% (art. 15) y el IT del 3% (art. 75).
   - **Ley 1733:** IVA sobre precio neto y mostrado por separado, a partir del primer día del mes siguiente al DS reglamentario. **No localicé ese DS.**
4. **Pagos (RD BCB 079/2022, lectura visual):**
   - Las órdenes de pago electrónicas tienen **pleno valor probatorio** (art. 24).
   - El pago es **definitivo** cuando los fondos se depositan en la cuenta del beneficiario (art. 25) y las órdenes son irrevocables (art. 26).
   - Las entidades financieras deben verificar que quien contrata servicios de cobro electrónico tenga un **sistema de facturación autorizado por el SIN** (art. 27).
5. **Firma digital:**
   - Ley 164: tienen validez jurídica y probatoria el acto en documento digital con firma digital, el mensaje electrónico de datos y la firma digital (art. 78). Los documentos sin firma digital son "principio de prueba o indicios" y se valoran según su confiabilidad (art. 87). [Verificado-oficial]
   - Desde el DS 5519 de 2026, la AGETIC es la entidad certificadora pública.
6. **Residencia de datos:** no encontré restricciones para el sector privado de salud. Sí las hay para entidades públicas (DS 5322).

---

## 1. Protección de datos personales

### 1.1 Constitución Política del Estado (7-feb-2009)

| Norma | Contenido | Confianza |
|---|---|---|
| CPE art. 21.2 | Derecho a la privacidad, intimidad, honra, honor, propia imagen y dignidad. | [Secundario] |
| CPE art. 25 | Inviolabilidad de las comunicaciones privadas. La Ley 164 (art. 89) remite a ella para el correo personal. | [Secundario]; la remisión de la Ley 164 es [Verificado-oficial] |
| CPE arts. 130-131 | Acción de Protección de Privacidad (hábeas data): conocer, objetar, eliminar o rectificar datos en bancos públicos o privados. Sigue el trámite del amparo. | [Secundario] |
| CPE art. 44 | Prohíbe intervenciones o exámenes médicos sin consentimiento propio o de terceros legalmente autorizados, salvo peligro inminente. | **[No verificado]** |
| CPE art. 39 | La cita como base legal el Reglamento del Expediente Clínico del SEDES La Paz. | [Verificado-oficial] (solo la cita) |

### 1.2 Ley general de datos personales: estado

- **No hay ley general vigente.** [Secundario: FES, Lex Mundi]
- **PL N° 538/2025-2026:** en el sitio oficial de la Cámara de Diputados aparece en el buscador del sitio con el término "datos personales". Tiene estado "en tratamiento", comisión de **Constitución, Legislación y Sistema Electoral**, legislatura 2025-2026 y fecha de publicación 22-jul-2026. [Confirmado-oficial]
  - **Advertencia:** la ficha individual se carga vacía, así que no pude leer el título ni el texto. Un agregador secundario lo identifica como "Ley de Protección de Datos Personales".
- En la misma comisión figuran como **archivados** el PL 605/2024-2025 y el PL 268/2023-2024, que también salieron con la búsqueda "datos personales". [Confirmado-oficial: metadatos del listado]
- **19-sep-2025:** la presidenta de esa comisión socializó el "proyecto de Ley de Protección de Datos Personales", con la AGETIC. El proyecto alcanza al sector público y al privado. [Confirmado-oficial: noticia de diputados.gob.bo]
- **6-nov-2026:** se clausuró la Legislatura 2025-2026 (noticia de diputados.gob.bo). **Hay que verificar si los proyectos en tratamiento pasan a la siguiente legislatura.**
- **Anteproyecto de la AGETIC (2024):** existe el documento de presentación. [Confirmado-oficial]
- **Proyecto de ley de violencia digital** (9-oct-2026; tipifica, entre otras cosas, la revelación no consentida de datos personales). [Secundario]

### 1.3 Ley N° 164 (8-ago-2011) [Verificado-oficial: copia de la Gaceta publicada por el BCB]

- **Art. 78 (validez jurídica):** tienen validez jurídica y probatoria:
  - I. el acto o negocio jurídico hecho en documento digital y aprobado por las partes con firma digital;
  - II. el mensaje electrónico de datos;
  - III. la firma digital.
- **Art. 79 (exclusiones):** no pueden celebrarse por medios electrónicos los actos de derecho de familia, los que exigen presencia física y los que requieren documento físico por ley **o por acuerdo expreso de partes**.
- **Art. 80:** los certificados extranjeros valen si los reconoce una entidad certificadora nacional autorizada.
- **Arts. 81-82:** la ATT autoriza y fiscaliza a las entidades certificadoras.
- **Art. 83:** asignaba la certificación pública a la ADSIB. Hoy esa función es de la AGETIC por el DS 5519 (ver §8).
- **Art. 87 (valoración):**
  - I. Los documentos digitales sin firma digital son admisibles "como principio de prueba o indicios".
  - II. Se valora la confiabilidad de su generación, archivo y comunicación, la integridad y la identificación del iniciador. **Esto respalda directamente el diseño de una bitácora de evidencias.**
- **Art. 89:** el correo personal equivale a la correspondencia postal y es inviolable.
- **Art. 90:** correo laboral.
- **Art. 91:** las comunicaciones comerciales publicitarias por correo electrónico **"o cualquier otro medio electrónico"** se rigen por reglamento, sin perjuicio de la normativa de publicidad y de protección al consumidor. *(Corrige la revisión 1: es el art. 91.)*

### 1.4 DS N° 1793 (13-nov-2013) [Verificado-oficial: "texto de consulta" de la Gaceta, publicado en firmadigital.bo]

- **Art. 3.V (definiciones):**
  - "Correo electrónico comercial": mensaje enviado "por cualquier medio electrónico" para difundir, ofertar o publicitar bienes o servicios.
  - "Correo electrónico no deseado": enviado periódicamente, sin consentimiento, a quien no tiene relación con el emisor.
- **Art. 4.II:** principios del tratamiento de datos (finalidad, veracidad, transparencia, seguridad, confidencialidad) para **entidades certificadoras**.
- **Art. 56 (protección de datos personales)**, dentro del capítulo "Tratamiento de los datos personales" del título de firma y certificación digital:
  - a) Respeto a los derechos fundamentales.
  - b) "El tratamiento técnico de datos personales **en el sector público y privado en todas sus modalidades** [...] requerirá del **conocimiento previo y el consentimiento expreso del titular**, el que será brindado **por escrito u otro medio equiparable**". El consentimiento es revocable con causa justificada y sin efecto retroactivo.
  - c) Hay que informar al titular, antes del tratamiento, sobre: la finalidad, los destinatarios, la identidad y domicilio del responsable, y los derechos de acceso, rectificación, actualización, cancelación, objeción y revocación. Los datos **no pueden usarse para finalidades distintas** de las declaradas.
  - d) Para comunicarlos o transferirlos a un tercero hace falta consentimiento previo u orden judicial escrita.
  - e) El responsable, público o privado, debe adoptar medidas técnicas y organizativas de seguridad según el estado de la tecnología, la naturaleza de los datos y los riesgos.
  - **Cambio respecto de la revisión 1:** el texto no se limita a las entidades certificadoras. Por su ubicación hay un debate de alcance que debe resolver el abogado. **Como criterio de diseño conviene tratarlo como aplicable.**
- **Art. 57 (comunicaciones comerciales publicitarias):** se aplica al correo electrónico "u otro medio de comunicación digital equivalente" de quien ejerce una actividad **profesional**, entre otras. Condiciones:
  - a) informar características, tarifas y aspectos legales, y los mecanismos de suscripción y de baja;
  - b) y c) las promociones deben estar claramente identificadas, con condiciones claras;
  - d) **indicar cómo puede el destinatario aceptar o rechazar futuros envíos**;
  - e) **identificar claramente al remitente**;
  - f) el simple registro en un sitio web no autoriza envíos posteriores: la suscripción tiene que ser **explícita**;
  - g) la información debe ser veraz.

### 1.5 Ley 1080 (Ciudadanía Digital) y AGETIC

- **Ley 1080 (11-jul-2018):** identidad digital para trámites con el Estado. Su relevancia para el SaaS es baja. [Confirmado-oficial]
- **DS 5519 (13-ene-2026):** cerró la ADSIB y pasó sus funciones a la AGETIC desde el 15-ene-2026. [Confirmado-oficial: el PDF está en agetic.gob.bo, no leído completo]

---

## 2. Salud: expediente clínico y ejercicio profesional

### 2.1 Ley 3131 del Ejercicio Profesional Médico (8-ago-2005) [Verificado-compilador: texto íntegro en Lexivox; la copia de minsalud.gob.bo no respondió]

- **Art. 2:** se aplica al Sistema Nacional de Salud, sectores público, de seguridad social y privado con y sin fines de lucro.
- **Art. 3 y art. 4:** el secreto médico es inviolable salvo excepciones legales. Cubre toda la información del acto médico, incluso después de la muerte.
- **Art. 10 (documentos médicos oficiales):** "Bajo el resguardo y custodia del establecimiento de salud son de uso exclusivo del médico". Entre ellos están el expediente médico, la historia clínica, el **consentimiento informado**, los informes, certificados, interconsultas, la epicrisis y las **recetas**.
  - *Corrige la revisión 1:* el inciso c) sobre el "soporte documental del consentimiento" **no figura** en el texto de la ley. Venía de una fuente secundaria.
- **Art. 12 (deberes del médico):**
  - respetar el consentimiento expreso del paciente que rechaza un tratamiento;
  - atender sin consentimiento en peligro inminente de muerte;
  - **"Informar al paciente, o responsables legales, con anterioridad a su intervención, sobre los riesgos"**;
  - llenar los documentos médicos oficiales;
  - guardar el secreto.
- **Art. 13 (derechos del paciente):** confidencialidad, secreto médico, información adecuada y oportuna para decidir libremente, respeto a su intimidad, segunda opinión y negarse a participar en investigación o enseñanza.
  - **No hay un derecho expreso a obtener copia del expediente.** [Verificado-compilador]
- **Art. 17 (revelación del secreto):** se permite:
  - con autorización expresa del paciente o de su responsable legal;
  - a requerimiento forense;
  - en enfermedades notificables;
  - ante riesgo inminente para la familia o la comunidad;
  - cuando la ley lo disponga.
  - Inciso sobre **menores**: los padres o responsables "no podrán dar a conocer" la información sobre su estado médico, salvo cumplimiento legal.
- **Ámbito profesional:** la ley regula el ejercicio **médico**. Su aplicación directa a **odontólogos** sigue sin verificarse. Lo que sí está verificado es que el DS 28562 (art. 2) somete a **todo el Sistema Nacional de Salud** a las normas del Ministerio.

### 2.2 DS 28562, Reglamento de la Ley 3131 (22-dic-2005) [Verificado-compilador: texto íntegro en Lexivox]

- **Art. 2:** todo el Sistema Nacional de Salud se rige por la normativa del Ministerio. Autorizar el funcionamiento de los establecimientos es atribución del Ministerio, bajo responsabilidad de la **autoridad departamental (SEDES)**, que reglamenta los requisitos.
- **Art. 4:** las normas y protocolos nacionales son obligatorios, se **aprueban por Resolución Ministerial** y tienen vigencia de 3 años, con revisión.
- **Art. 6:** la **receta médica** debe incluir nombre del paciente, **nombre genérico**, forma, concentración, fecha, nombre, firma, matrícula y sello del profesional. Las indicaciones van en una hoja aparte.
- **Art. 12:** expediente médico = historia clínica + documentos del caso. Historia clínica = "conjunto de documentos escritos e iconográficos" de cada proceso asistencial.
- **Art. 14:**
  - El "consentimiento expreso" (rechazo de un tratamiento) se registra en la historia clínica, "debidamente respaldado por la firma del paciente o de su familiar o responsable legal".
  - Si el paciente es incapaz y no tiene representante, decide la institución según los protocolos.
  - **"Es obligación del médico registrar en la historia clínica, la información brindada al paciente respecto al diagnóstico, tratamiento y pronóstico [...]; este registro debe ser suscrito por el paciente, familiar, pariente o representante legal."**
- **Art. 17:** en el sector privado, la auditoría médica interna y externa compete a la autoridad departamental de salud. Se hace "mediante el análisis del expediente clínico".

### 2.3 Norma Técnica para el Manejo del Expediente Clínico

- **Aprobación:** **Resolución Ministerial N° 0090 de 26-feb-2008.** Está confirmado por el Reglamento oficial del SEDES La Paz (art. 7 y bibliografía). La misma RM aprobó también la norma **"Obtención del Consentimiento Informado"** y el Manual de Evaluación y Acreditación de primer nivel. [Confirmado-oficial]
- **Numeración:** fuentes secundarias la identifican como "Publicación N° 64". [Secundario]
- **Texto nacional no obtenido:** la CNS la publica junto con "Obtención del Consentimiento Informado", pero la descarga falló (HTTP 500). **Sigue pendiente leer su contenido, incluidos los plazos de conservación nacionales y el régimen electrónico.**

### 2.4 Reglamento del Manejo del Expediente Clínico para el Primer Nivel de Atención (SEDES La Paz, publicado en 2024) [Verificado-oficial: PDF de sedeslapaz.gob.bo]

- **Ámbito (arts. 1-3):** obligatorio para instituciones **públicas o privadas** de primer nivel del departamento de La Paz, incluidos "**policonsultorios** [...] **consultorios vecinales**". Se aplica sin perjuicio de la norma nacional.
- **Marco legal citado (art. 4):** CPE art. 39, Ley 3131, DS 28562, Ley 1737, DS 25235, RM 0090/2008 y **RM N° 0715 "Norma técnica administrativa y Manual de Aplicaciones Odontológicas", 26-sep-2017**, entre otras.
- **Consentimiento informado:**
  - Se obtiene "con la firma del paciente, **tutor o responsable**", en formularios de diseño variable según el procedimiento, conforme a la norma nacional de obtención del consentimiento.
  - Los formularios de la **odontología** prevén la firma o huella del paciente, la madre, el tutor o el apoderado.
- **Historia clínica odontológica:**
  - Datos generales.
  - Datos de quien da la información.
  - Antecedentes familiares y personales.
  - Examen extraoral.
  - Antecedentes bucodentales y de higiene.
  - Estado periodontal.
  - **Odontograma.**
  - Hoja de evolución en formato **SOAP**, con firma y sello del odontólogo con registro.
  - **Recetario-recibo odontológico** con su contenido mínimo.
- **Archivo y conservación (arts. 20-21):**
  - Área restringida, solo personal autorizado. El responsable de admisión es el custodio.
  - b) El archivo "puede utilizar medios físicos o técnicos como computadoras".
  - c) **"Los programas automatizados que se utilicen para el manejo del expediente clínico [...] deben estar provistos de mecanismos de seguridad que imposibiliten la incorporación de modificaciones a la Historia Clínica una vez se registren y guarden los datos."**
  - d) Proteger la reserva y evitar la destrucción accidental o provocada.
  - e) **"Tiempo de conservación: Los expedientes clínicos deben ser conservados durante 10 años en archivo activo. Una vez pasado este tiempo pasarán al archivo pasivo."**
  - No fija un plazo de destrucción.
- **Implicancia:** es la norma con requisitos de software más concretos que encontré. Rige solo en La Paz. **Hay que buscar reglamentos equivalentes en otros SEDES** (Santa Cruz, Cochabamba y otros).

### 2.5 Plazo de conservación (estado actualizado)

- **La Paz, primer nivel:** 10 años en archivo activo y luego archivo pasivo, sin plazo de eliminación. [Verificado-oficial, departamental]
- **Nacional:** sin verificar (RM 0090/2008 no leída). Una tesis de la UMSA afirma que la norma nacional no regula el ciclo vital del documento. [Secundario]
- **Datos de clientes en entidades financieras:** mínimo 10 años (RD BCB 079/2022, art. 7 j). Es solo una referencia análoga y no se aplica a clínicas.
- **Prescripción tributaria:** la Ley 1733 modifica los **arts. 59-60 de la Ley 2492 (Código Tributario)**: de 8 a **4 años** para fiscalizar y determinar. [Confirmado-oficial: folleto oficial del SIN sobre la Ley 1733]
  - *Corrige la revisión 1:* no se modifica el art. 5 de la Ley 843.

### 2.6 Odontología

- **Colegio de Odontólogos de Bolivia:** Decreto Ley 10131 (18-feb-1972). [Confirmado-oficial]
- **RM 0715 (26-sep-2017):** Norma técnica administrativa y Manual de Aplicaciones Odontológicas. [Confirmado-oficial: cita del SEDES La Paz; texto no leído]
- No encontré una ley específica del ejercicio odontológico. [Búsqueda negativa]

### 2.7 Medicamentos y recetas

- Ley 1737 (17-dic-1996) y DS 25235 (30-nov-1998). [Secundario/Confirmado-oficial: citados por el SEDES La Paz]
- Requisitos de la receta del DS 28562, art. 6. [Verificado-compilador]
- Recetario-recibo odontológico del SEDES La Paz. [Verificado-oficial]
- Receta electrónica: **sin verificar.**

### 2.8 SNIS-VE

- Formularios 301a y 301b. [Confirmado-oficial por extracto; el sitio snis.minsalud.gob.bo no respondió]
- Obligación de los consultorios privados de reportar: **sin verificar.**

### 2.9 Tendencias

- **Plan Nacional de Salud 2026-2030:** SUIS, Historia Clínica Única Digital interoperable entre los sectores público y privado, y nueva Ley General de Salud. [Confirmado-oficial: OPS]

---

## 3. Consentimiento informado

| Aspecto | Hallazgo | Confianza |
|---|---|---|
| Deber de informar | Antes de la intervención, sobre los riesgos, al paciente o a sus responsables legales (Ley 3131, art. 12). | [Verificado-compilador] |
| Registro firmado | La información dada sobre diagnóstico, tratamiento y pronóstico se registra en la historia clínica y la **suscribe el paciente, familiar, pariente o representante legal** (DS 28562, art. 14). | [Verificado-compilador] |
| Rechazo | Se registra y lo firma el paciente, su familiar o su responsable legal (DS 28562, art. 14). | [Verificado-compilador] |
| Formularios | Por procedimiento. Firma del paciente, tutor o responsable. Odontología: paciente, madre, tutor o apoderado, con firma o huella (SEDES La Paz). | [Verificado-oficial, departamental] |
| Norma nacional | "Obtención del Consentimiento Informado", RM 0090/2008. | [Confirmado-oficial; texto no leído] |
| Incapaces sin representante | Decide la institución según los protocolos (DS 28562, art. 14). | [Verificado-compilador] |
| Urgencia | Atención sin consentimiento ante peligro inminente de muerte (Ley 3131, art. 12). | [Verificado-compilador] |
| Menores | La firma la hace el tutor o responsable. Edad para consentir y asentimiento del adolescente (Ley 548): **sin verificar.** Confidencialidad frente a padres: Ley 3131, art. 17. | Mixto |
| Medio electrónico | La Ley 164 permite actos en documento digital con firma digital (art. 78), salvo las exclusiones del art. 79, que incluyen los casos en que las partes pacten el documento físico. Sin firma digital, el documento es indicio (art. 87). **No hay norma de salud que lo regule expresamente.** | [Verificado-oficial] (Ley 164) |

---

## 4. Tributación y facturación

### 4.1 RND N° 102100000011, Sistema de Facturación (11-ago-2021; compilada por el SIN al 16-jun-2025) [Verificado-oficial]

- **Modificaciones incluidas en la compilación:** RND 102100000017, 102100000021, 102200000003, 102300000003, 102300000034 y 102500000017.
- **Modificaciones posteriores:** RND 102500000041 (anulaciones; [Secundario]) y **RND 102600000026** (15-jul-2026, art. 25.IX: tipo de cambio oficial del BCB en operaciones en moneda extranjera; [Verificado-oficial]).
- **Modalidades:**
  - **Art. 7, Electrónica en Línea:** documentos "con firma digital" por un sistema autorizado (propio o de proveedor). Además existe el sistema de escritorio del SIN, de única versión y sin emisión masiva.
  - **Art. 8, Computarizada en Línea:** documentos "con Hash de Huella Digital", usando las credenciales del contribuyente en un sistema autorizado (propio, de proveedor o del SIN).
  - **Art. 9, Portal Web en Línea.**
  - Arts. 4-6: Manual, Prevalorada y Computarizada SFV (esta última transitoria y de contingencia).
- **Art. 10:** el SIN impone las modalidades en línea mediante RND, con criterios como actividad, volumen y comportamiento tributario. Mientras no se asigne una nueva modalidad, se puede seguir con la actual. La adopción voluntaria es posible tras completar las pruebas.
- **Art. 11:** para que se autorice la emisión hacen falta datos actualizados en el RNC, declaraciones juradas al día de los últimos 3 periodos y no tener marcas de control.
- **Art. 17, tipos de sistema:**
  - de Escritorio (del SIN);
  - **Propio:** "para uso exclusivo" del contribuyente ("Propietario");
  - **Proveedor:** desarrollado por un tercero y autorizado; puede usarlo uno o varios contribuyentes que contraten con él.
- **Art. 18:** la solicitud declara la modalidad, el tipo (propio o proveedor), el nombre del software, la versión y los contactos. **Se cancela de oficio si no termina en 90 días** (prorrogables 60 una vez).
- **Art. 19, requisitos del Propietario o Proveedor:**
  - estar en el RNC y en el **Régimen General**;
  - tener **domicilio fiscal en el país**;
  - datos actualizados;
  - no tener marcas de control.
  - **II. Si un propietario quiere prestar servicios a terceros, necesita una "nueva Autorización como Proveedor".**
- **Art. 20, proceso:**
  - a) plan de pruebas en ambiente de pruebas;
  - b) autorización, **válida 3 años**, con renovación previa; **cada modificación requiere nuevas pruebas** y la autorización de la nueva versión; el proveedor debe prever la continuidad del servicio;
  - c) **pruebas piloto por cliente**;
  - d) "Autorización de Asociación proveedor-cliente";
  - e) "Solicitud de Inicio de Facturación".
  - Las modificaciones o el mal uso del sistema son responsabilidad del contribuyente que lo usa, sin perjuicio de acciones contra el proveedor.
- **Art. 21, códigos:**
  - **CUIS**, vigencia 365 días; en Electrónica en Línea exige **firma digital vigente**;
  - **CUFD**, vigencia **24 h**, se puede pedir varias veces al día;
  - **CUF**, por factura;
  - **CAFC**, para contingencias.
- **Art. 25:** obligación de emitir factura al perfeccionarse el hecho imponible.
  - No hay obligación por debajo de **Bs 5**, salvo que el comprador la pida. Esas ventas se consolidan como "VENTAS MENORES DEL DÍA" con NIT 99003.
  - Hasta Bs 1.000, si el comprador no da sus datos, se pone "S/N" y NIT 0.
- **Arts. 29-30, contingencias:** corte de internet, caída del servicio del SIN, falla de software o hardware, corte de energía y otras. Se emite fuera de línea según el Anexo Técnico.
- **Art. 32:** en las modalidades en línea, la factura se emite el **mismo día**. La factura de contingencia tiene un plazo de 360 días. Quien emite en Electrónica y Computarizada para terceros debe usar **solo la modalidad Electrónica** para sus propias operaciones.
- **Art. 34, emisión por terceros:** el contribuyente puede usar el sistema de un proveedor. **Sigue siendo responsable ante el Fisco.**
- **Art. 52, firma digital:** certificado otorgado por la autoridad competente. Con firma revocada o suspendida no se puede emitir. La validación se hace al pedir el CUFD.
- **Art. 53:** el XML firmado o con huella, enviado y registrado, es un Documento Fiscal Digital "con validez jurídica y probatoria".
- **Art. 56:** seguridad de la información. El usuario es responsable de sus credenciales.
- **Documento sector de salud:** **no hay** disposiciones específicas para clínicas ni salud en la RND 11 (búsqueda en el texto completo). La tabla de "documento sector" vive en el Anexo Técnico, que no se revisó.

### 4.2 RND 2026 relevantes [Verificado-oficial: listado RND 2026 de impuestos.gob.bo]

- **RND 102600000007** (23-mar-2026): prorrogó al 30-sep-2026 la transición de los grupos 9 a 12.
- **RND 102600000034** (1-sep-2026), "Ajustes al Sistema de Facturación":
  - Publica el **"Anexo Técnico Ley N° 1733 (En construcción)" v0.0**, con nuevos formatos de notas fiscales según el tipo de actividad y cambios al proceso de autorización de sistemas propios y de proveedor.
  - **Art. 2:** todos los sistemas propios o de proveedor deben cumplir ese anexo para las pruebas en ambiente piloto y la posterior autorización **desde el 1-oct hasta el 16-nov-2026**.
  - Hasta que se dicte la nueva RND, la RND 11 sigue plenamente vigente.
- **RND 102600000038** (30-sep-2026):
  - Abroga las RND 102400000004, 102400000005, 102400000012 y 102400000025 y sus modificaciones, que designaban a los grupos 9 a 12.
  - **II.** El SIN "asignará periódicamente una modalidad de facturación en línea" a los sujetos del IVA que aún no tengan ninguna.
  - Motivo: aplicar de forma automatizada y verificable la Ley 1733 (IVA sobre precio neto, mostrado por separado).
- **RND 102600000042** (28-oct-2026): prorroga hasta el **31-dic-2026** la **homologación de productos de los sistemas de facturación con las actividades económicas del RNC** (RND 102500000018 de 22-abr-2025). Esto afecta al catálogo de productos y servicios del SaaS.
- **Pendiente:** RND 102600000012 y 102600000030 ("Registro de Compras y Ventas") no se analizaron en detalle.

### 4.3 IVA e IT de los servicios odontológicos

**Ley 843, texto ordenado y complementado por el SIN, actualizado al 30/09/2026** [Verificado-oficial]:

- **Art. 1 b):** el IVA grava "los contratos de obras, de prestación de servicios y toda otra prestación".
- **Art. 14:** las exenciones de IVA son los bienes de diplomáticos y las mercaderías "bonafide" de viajeros, más disposiciones relacionadas (titularización, fideicomisos públicos, oro, hidrocarburos, libros y otras). **Ninguna alcanza a los servicios de salud privados.**
- **Art. 15:** alícuota del **13%**.
- **Art. 72:** el IT alcanza el ejercicio de "profesión, oficio [...] servicios".
- **Art. 75:** alícuota del **3%**.
- **Art. 76:** las exenciones de IT incluyen, en el inciso d), los servicios prestados por el **Estado**, departamentos y municipios (no las empresas públicas), además de otras ajenas a la salud. **No hay exención para la salud privada.**
- **Art. 5 en el texto ordenado al 30/09/2026:** todavía dice que el IVA "forma parte integrante del precio [...] no se mostrará por separado". Es coherente con que la reforma de la Ley 1733 aún no esté vigente.
- **Conclusión preliminar:** no encontré exención de IVA ni de IT para los servicios odontológicos privados. **La debe confirmar un tributarista**, revisando también normas especiales fuera de la Ley 843 y el tratamiento de los servicios cubiertos por la seguridad social o el SUS.

**Ley N° 1733 de Alivio Tributario (27-may-2026)** [Confirmado-oficial: folleto oficial del SIN y considerandos de las RND 102600000034 y 102600000038]:

- IVA: la base es el precio neto antes de impuestos, y el impuesto "**se mostrará por separado** en la factura".
- Vigencia del cambio de IVA: desde el primer día del mes siguiente a la publicación del **DS reglamentario**, que **no localicé**.
- Prescripción: de 8 a 4 años (Ley 2492, arts. 59-60).
- El régimen simplificado de 5% **no aparece** en el folleto oficial. Hay que verificar el texto de la ley.

**Profesionales independientes:** RC-IVA desde 2023 y DS 5563 (2-mar-2026). [Secundario]

---

## 5. Pagos

**BCB RD N° 079/2022 (6-sep-2022), Reglamento de Servicios de Pago, Instrumentos Electrónicos de Pago, Compensación y Liquidación.**

- **Fuente:** PDF oficial del BCB, escaneado. Leí visualmente las páginas 1-10 y 19-26. [Verificado-oficial, salvo detalles finos por la baja resolución de las páginas 19-26]
- Vigencia "a partir de la fecha de su publicación". El comunicado CP63/2022 del BCB indica que rige desde el 21-sep-2022.
- Deja sin efecto las RD 069/2021 y 129/2021.
- **Art. 2:** se aplica, entre otros, a las entidades de intermediación financiera, las empresas de servicios de pago, las cámaras de compensación y "las personas naturales y jurídicas que [aceptan instrumentos electrónicos de pago]".
- **Art. 4:**
  - Define las **pasarelas de pago**: "Agregador" (recibe y transfiere fondos al comercio) y "Facilitador" (los fondos van directo a la cuenta del aceptante).
  - Define el **QR** como código bidimensional para procesar transferencias electrónicas de fondos.
- **Art. 7:**
  - j) Las entidades deben conservar la información de los clientes por un **mínimo de 10 años** y solo divulgarla con autorización escrita del titular o en los casos del art. 473 de la Ley 393.
  - w) Deben adecuar sus sistemas para garantizar la respuesta a las órdenes de pago con **QR** que cumplan las características de **interoperabilidad**.
  - x) Deben publicar los estándares de mensajería y de generación de QR para la interoperabilidad.
  - y) Las pasarelas de pago deben cumplir la normativa del BCB y de la ASFI.
- **Art. 24:** "Las [órdenes de pago generadas con instrumentos electrónicos] tendrán **pleno valor probatorio** y los mismos efectos legales y judiciales que los archivos y registros físicos".
- **Art. 25:** "Una vez que los fondos sean depositados en la cuenta del beneficiario [...] la [orden de pago] se considerará **definitiva y concluida**".
- **Art. 26:** las órdenes de pago son irrevocables. Las correcciones se hacen con una nueva orden.
- **Art. 27 (emisión de factura para pagos electrónicos):**
  - Antes de prestar servicios de cobro por banca electrónica, banca móvil o billetera, la entidad financiera debe **verificar que la empresa tenga un Sistema de Facturación autorizado por el SIN** que permita enviar la transacción en XML y la representación gráfica del documento fiscal digital.
  - **Implicancia directa:** para obtener cobros QR o electrónicos del banco, la clínica necesita una modalidad de facturación en línea.
- **Implicancias sobre la prueba de pago:**
  - Un pago es definitivo cuando se acredita en la cuenta del beneficiario (art. 25).
  - Los registros de la entidad financiera tienen pleno valor probatorio (art. 24).
  - Una captura de pantalla enviada por el paciente no es un registro de la entidad. Como documento digital sin firma, sería indicio (Ley 164, art. 87).
  - **El sistema debe conciliar contra la confirmación del banco o de la pasarela.**
- **APIs públicas de conciliación:** no encontré. [Búsqueda negativa]
- **RD 137/2019:** se mantiene como [Secundario].

---

## 6. WhatsApp, recordatorios y marketing

- **DS 1793, art. 57 y art. 3.V:** verificados en §1.4. La expresión "otro medio de comunicación digital equivalente" y la definición de correo comercial "enviado por cualquier medio electrónico" hacen **muy probable** que se apliquen a WhatsApp y SMS. La interpretación final la confirma el abogado.
  - **Obligaciones:** identificar al remitente, ofrecer un mecanismo de aceptar o rechazar en cada comunicación, suscripción explícita y veracidad.
- **Ley 164, art. 91:** verificado. Remite también a las normas de publicidad y de protección al usuario.
- **DS 1793, art. 56 c):** los datos solo pueden usarse para la finalidad informada al recolectarlos. Usar el teléfono del paciente para marketing exige que esa finalidad se haya informado y consentido.
- **Secreto médico** (Ley 3131, arts. 3, 4, 12 y 13): **no incluir información clínica en los recordatorios.**
- **Ley 453 (4-dic-2013), art. 25:** prohíbe la publicidad engañosa. [Confirmado-oficial por extracto]

---

## 7. Residencia de datos y hosting

- **Sector privado:** no encontré restricciones de localización. [Búsqueda negativa]
- **DS 1793, art. 56 e):** exige medidas de seguridad proporcionales a la naturaleza de los datos y a los riesgos. [Verificado-oficial]
- **Entidades públicas:** el PISLEA (DS 5322 de 23-ene-2025) restringe guardar datos no públicos del Estado fuera del país. [Confirmado-oficial]

---

## 8. Firma electrónica y digital

- **Ley 164, arts. 78-87:** verificados en §1.3. La firma digital tiene validez plena. Sin ella, el documento es indicio y se valora por la confiabilidad de cómo se generó, archivó y conservó.
- **DS 1793, art. 4.I:** principios de autenticidad, integridad y no repudio de los documentos con firma digital. [Verificado-oficial]
- **RND 11, art. 52:** las facturas electrónicas se firman con un certificado de la autoridad competente. [Verificado-oficial]
- **AGETIC:** es la entidad certificadora pública tras el DS 5519. [Confirmado-oficial]
- **Entidades privadas autorizadas por la ATT:** sin verificar.

---

## 9. Recomendaciones de diseño (no son requisitos legales confirmados)

1. **Consentimiento de datos** (DS 1793, art. 56):
   - Aviso previo con finalidad, destinatarios, identidad y domicilio del responsable, y los derechos.
   - Consentimiento **expreso, por escrito o por un medio equiparable**, con versión del texto, fecha y hora, y evidencia.
   - Finalidades separadas: atención clínica, recordatorios y marketing.
   - Revocación registrada y sin efecto retroactivo.
   - Registro de transferencias a terceros, incluidos los proveedores del SaaS y de mensajería.
2. **Consentimiento clínico y registro de la información dada** (DS 28562, art. 14):
   - Formulario por procedimiento.
   - Firma del paciente, tutor o responsable (también huella digital o equivalente para quien no firma).
   - Registro de la información sobre diagnóstico, tratamiento y pronóstico, **suscrito** por el paciente o su representante.
   - Flujo de **rechazo firmado**.
3. **Historia clínica odontológica:** como mínimo los campos del Reglamento del SEDES La Paz: datos generales, informante, antecedentes, examen extraoral, antecedentes bucodentales y de higiene, estado periodontal, **odontograma** y evoluciones **SOAP** con firma y sello o registro del odontólogo.
4. **Inmutabilidad** (SEDES La Paz, art. 21 c):
   - Una vez guardado, el registro clínico no se puede modificar.
   - Las correcciones se hacen solo como **adendas versionadas**, con autor, fecha y motivo.
   - Sellado o hash de cada nota.
   - Bitácora de accesos y cambios **append-only**.
   - Esto también fortalece el valor de indicio según la Ley 164, art. 87.II.
5. **Retención:**
   - Por defecto, no eliminar.
   - Como mínimo, **10 años en "activo"** y luego un estado "pasivo" archivado y consultable (criterio de La Paz), configurable por departamento.
   - Para la información tributaria, como mínimo la prescripción de 4 años (Ley 2492 modificada). Hay que verificar si otra norma exige más.
6. **Acceso:**
   - Roles con mínimo privilegio.
   - Acceso solo para personal autorizado (SEDES, art. 21 a y d).
   - Separación entre clínicas (multi-tenant).
   - MFA.
   - Registro de cada lectura.
7. **Copia o exportación al paciente:** la Ley 3131 no reconoce un derecho expreso a copia. Aun así, la CPE (art. 130) y el DS 1793 (art. 56 c) prevén el acceso. Ofrecer la exportación como un flujo controlado por la clínica, con registro.
8. **Menores:** representante obligatorio para firmar. Controles de confidencialidad según la Ley 3131, art. 17.
9. **Facturación:**
   - Decidir entre convertirse en **Proveedor** autorizado o integrarse con un proveedor existente.
   - Si es Proveedor: cumplir el art. 19 (RNC, Régimen General, domicilio fiscal en Bolivia), renovar cada 3 años, homologar cada versión, hacer pruebas piloto por clínica y la asociación proveedor-cliente.
   - Implementar el Anexo Técnico de la Ley 1733 (IVA por separado). La ventana de pruebas termina el **16-nov-2026**.
   - Homologar el catálogo de productos con las actividades del RNC antes del **31-dic-2026**.
   - Gestionar CUIS y CUFD, contingencias y CAFC, y la firma digital por NIT.
10. **Pagos:**
    - Confirmar el pago solo con el evento del banco o de la pasarela (art. 25 de la RD 079/2022).
    - El comprobante del paciente queda como evidencia provisional.
    - Guardar el identificador de la orden de pago.
    - Recordar que el banco exigirá a la clínica tener un sistema de facturación autorizado (art. 27).
11. **Mensajería:**
    - Identificación del remitente.
    - Opción de baja en cada mensaje de marketing.
    - Suscripción explícita.
    - Plantillas sin datos clínicos.

---

## 10. Pendiente de verificación legal

1. El texto, el título y el estado real del **PL 538/2025-2026** (la ficha está vacía en el sitio). Qué pasa con los proyectos "en tratamiento" tras la clausura de la Legislatura 2025-2026 (6-nov-2026).
2. El **alcance del DS 1793, art. 56**: ¿es general para responsables públicos y privados, como dice su texto, o se limita al título de certificación digital por su ubicación?
3. El texto oficial de la **CPE** (arts. 21, 25, 39, 44, 130 y 131).
4. Si la **Ley 3131 y el DS 28562** se aplican directamente a los odontólogos. Cotejar la copia de Lexivox con la Gaceta.
5. El texto de la **RM 0090/2008** (Norma Técnica del Expediente Clínico y "Obtención del Consentimiento Informado"): plazos nacionales, expediente electrónico, entrega de copias y formularios modelo.
6. El texto de la **RM 0715/2017** (Manual de Aplicaciones Odontológicas).
7. **Reglamentos de expediente clínico de otros SEDES** y su aplicación a consultorios privados fuera de La Paz. Si existe un plazo de eliminación tras el archivo pasivo.
8. El **consentimiento de menores** y el asentimiento del adolescente (Ley 548, Código Civil).
9. Si la firma electrónica simple sirve para consentimientos clínicos (Ley 164, arts. 79 y 87).
10. La obligación de los consultorios privados de reportar al **SNIS 301a**.
11. La **receta electrónica** y la prescripción odontológica (Ley 1737, DS 25235, AGEMED).
12. Confirmar con un tributarista que **no hay exención de IVA ni de IT** para los servicios odontológicos privados (normas fuera de la Ley 843, servicios a la seguridad social o al SUS).
13. El **DS reglamentario de la Ley 1733** y la fecha efectiva del IVA por separado. El texto final de la ley (régimen de 5%).
14. El **Anexo Técnico de la Ley 1733** y la RND definitiva que reemplace o modifique la RND 11. Los nuevos requisitos de autorización de proveedores.
15. Si existe un **documento sector** específico para servicios de salud (Anexo Técnico del SIAT). La vigencia de las RND 10-0015-14 y 10-0017-14 ("Software de Clínicas").
16. La lectura nítida de la **RD BCB 079/2022** (arts. 7, 24-27) y de la normativa de la ASFI que la complementa.
17. Las entidades certificadoras privadas autorizadas por la ATT.
18. Las restricciones de alojamiento de datos de salud fuera de Bolivia, sobre todo si se atiende a entidades públicas o a la CNS.
19. La Ley 453 sobre "servicios médicos" y la publicidad de clínicas.
20. El tipo penal de revelación de secreto profesional (Código Penal).
21. Los requisitos del SEDES para habilitar consultorios odontológicos privados (DS 28562, art. 2).

---

## 11. Fuentes

### Textos verificados en revisión 2 (copias locales en `(copias de trabajo locales de la sesión de investigación, no incluidas) norms/`)

**Facturación y tributos (SIN):**
- https://www.impuestos.gob.bo/wp-content/uploads/2025/10/RND11.pdf (oficial): RND 102100000011 compilada al 16-06-2025, arts. 4-34, 52-56.
- https://www.impuestos.gob.bo/wp-content/uploads/2026/09/RND-102600000038-Abrogaci%C3%B3n.pdf (oficial): RND 102600000038.
- https://www.impuestos.gob.bo/index.php/rnd-2026/ (oficial): listado de las RND 2026. Usadas: RND 102600000007, 102600000026, 102600000034 y 102600000042, en `norms/rnd2026/`.
- https://www.impuestos.gob.bo/wp-content/uploads/2026/10/1.-LEY-N%C2%B0-843-09-26-1.pdf (oficial): Ley 843, texto ordenado al 30/09/2026, arts. 1, 5, 14, 15, 72, 75 y 76.
- https://www.impuestos.gob.bo/wp-content/uploads/2026/09/LEY-ALIVIO-1.pdf (oficial): folleto del SIN sobre la Ley 1733 (IVA y prescripción).
- https://www.impuestos.gob.bo/wp-content/uploads/2025/10/electronica-en-linea.pdf (oficial): folleto de la modalidad Electrónica en Línea.

**TIC y firma digital:**
- https://www.bcb.gob.bo/webdocs/normativa/2011%20-%20LEY%200164%20-%20Telecomunicaciones%20y%20Tecnolog%C3%ADas%20de%20la%20Informaci%C3%B3n.pdf (oficial, copia de la Gaceta): Ley 164, arts. 78-91.
- https://firmadigital.bo/assets/DS-1793.pdf (oficial, texto de consulta de la Gaceta): DS 1793, arts. 3, 4, 56 y 57.

**Pagos (BCB):**
- https://www.bcb.gob.bo/webdocs/01_resoluciones/RD%20079%202022.pdf (oficial, escaneado): RD 079/2022, arts. 1-4, 7, 24-27.
- https://www.bcb.gob.bo/webdocs/11_comunicados/cp_pasarelas_pago.pdf (oficial): comunicado CP63/2022.

**Salud:**
- https://www.sedeslapaz.gob.bo/wp-content/uploads/2024/10/REGLAMENTO-DEL-MANEJO-DEL-EXPEDIENTE-CLII%C2%81NICO-PARA-EL-PRIMER-NIVEL-DE-ATENCIOI%C2%81N.pdf (oficial): Reglamento del SEDES La Paz (RM 0090/2008, RM 0715/2017, consentimiento, historia clínica odontológica, art. 21).
- https://www.lexivox.org/norms/BO-L-3131.html (compilador): texto íntegro de la Ley 3131.
- https://www.lexivox.org/norms/BO-DS-28562.html (compilador): texto íntegro del DS 28562.
- https://www.cns.gob.bo/Site/normassalud (oficial): listado que incluye la "Norma Técnica para el Manejo del Expediente Clínico" y "Obtención del Consentimiento Informado". La descarga falló.

**Proyecto de ley de datos personales (Diputados):**
- https://diputados.gob.bo/?s=datos+personales (oficial): resultados con PL 538/2025-2026 (en tratamiento, Comisión de Constitución), PL 605/2024-2025 y PL 268/2023-2024 (archivados).
- https://diputados.gob.bo/leyes/pl-no-538-2025-2026/ (oficial): ficha sin contenido visible.
- https://diputados.gob.bo/noticias/diputada-guachalla-socializa-leyes-estrategicas-sobre-el-cancer-y-la-proteccion-de-datos-de-la-ciudadania/ (oficial): socialización del proyecto de ley de datos personales (19-09-2025).

### Fuentes de la revisión 1 (extractos de búsqueda, se mantienen)

**Datos personales y AGETIC:**
- https://agetic.gob.bo/wp-content/uploads/2024/08/DATOS-PERSONALES-PRESENTACION-ANTEPROYECTO-DE-LEY-2024-firmado.pdf: anteproyecto de la AGETIC (2024).
- https://www.offlist.me/what-is-bolivia-data-protection: PL 538 como pendiente (secundario).
- https://library.fes.de/pdf-files/bueros/bolivien/16242.pdf: ausencia de una ley general.
- https://cursos.internetbolivia.org/wp-content/uploads/2024/10/cartilla-derecho-privacidad.pdf: CPE arts. 21 y 130.
- https://agetic.gob.bo/sites/default/files/2026-01/Decreto%20Supremo%205519.pdf: DS 5519.
- https://firmadigital.bo/quienes-somos/entidad-certificadora-publica/: la AGETIC como entidad certificadora pública.
- https://web.senado.gob.bo/sites/default/files/LEY%20N%C2%B01080-2018.PDF: Ley 1080.
- https://www.ferrere.com/es/novedades/bolivia-los-contratos-electronicos-las-firmas-electronicas-y-las-firmas-digitales-como-alternativas-para-facilitar-negocios-en-t: firma simple como indicio.

**Salud:**
- https://repositorio.umsa.bo/handle/123456789/33900: tesis sobre la Norma Técnica.
- https://web.senado.gob.bo/sites/default/files/declaraciones/D.%20C.%20%20N%C2%B0%20616-2022-2023.PDF: DL 10131 del Colegio de Odontólogos.
- https://snis.minsalud.gob.bo/instrumentos/consolidacion: formularios 301a y 301b.
- https://www.paho.org/es/noticias/3-9-2026-bolivia-presenta-brasilia-su-plan-nacional-salud-2026-2030-enfocado-reingenieria: Plan Nacional de Salud 2026-2030.
- https://www.pixilegal.com/normativa/ley-548-2014-07-17: Ley 548.
- https://www.agemed.gob.bo/reg-far/doc_reg_far/T-N-2-DS-25235-REG_LM.pdf: DS 25235.

**Tributos:**
- https://www.impuestos.gob.bo/wp-content/uploads/2026/03/RND-102600000007.pdf: prórroga de los grupos 9 a 12.
- https://bolivia.vlex.com/vid/resolucion-n-102500000041-servicio-1098865105: RND 102500000041.
- https://boliviaimpuestos.com/b/wJ: RND 10-0015-14 y 10-0017-14 ("Software de Clínicas").
- https://www.vision360.bo/noticias/2026/03/04/40945-paso-a-paso-como-deben-pagar-sus-impuestos-los-profesionales-independientes-segun-el-ds-5563: DS 5563.
- https://www.ferrere.com/es/novedades/profesionales-independientes-son-incluidos-en-el-regimen-rc-iva/: profesionales independientes en el RC-IVA.

**Pagos:**
- https://www.bcb.gob.bo/webdocs/files_noticias/CP-44%20LANZAMIENTO%20OPENBCB%20_OK.pdf y https://www.bcb.gob.bo/webdocs/files_noticias/NP%20QR%20BCB.pdf: OpenBCB y QR BCB.
- https://dialnet.unirioja.es/descarga/articulo/9508944.pdf: RD 137/2019.

**Consumidor:**
- https://www.bcb.gob.bo/webdocs/normativa/2013%20-%20LEY%200453%20-%20Derechos%20Usuarios%20y%20Consumidores.pdf: Ley 453.

**Datos en el sector público:**
- https://agetic.gob.bo/wp-content/uploads/2025/01/ANEXO-DS-5322.pdf: PISLEA (DS 5322).
