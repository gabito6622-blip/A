# Ronda 2 — DentinCloud (cuenta de prueba del usuario)

Fecha: 2026-11-10 · Producto: DentinCloud (https://www.dentincloud.com/es) · App: https://app.dentincloud.com

## Resumen

**No se pudo entrar a la aplicación, así que no se evaluó ningún módulo por dentro.** El enlace "Iniciar sesión" del sitio lleva a `https://app.dentincloud.com/login`. Ese formulario **no acepta correo electrónico**. Pide tres datos:

1. **Clínica**: un "código de clínica".
2. **Número de teléfono**: el prefijo predeterminado es +1 (EE. UU.).
3. **Contraseña**.

Además, tiene una **verificación humana de Cloudflare Turnstile** ("Verifique que es un ser humano").

Con los datos recibidos (correo y contraseña) no se puede completar el formulario: falta el código de clínica y el teléfono con el que se registró la cuenta. La contraseña **no se llegó a enviar ni una vez**: no hubo intento fallido ni bloqueo de la cuenta.

Tampoco correspondía intentar la verificación humana de forma automática. Por reglas propias no se resuelven ni se esquivan CAPTCHAs, y además el proxy de salida no pudo conectar con `challenges.cloudflare.com`. Siguiendo las instrucciones, no se probaron variantes, no se registró una cuenta nueva y no se usó "¿Olvidaste tu contraseña?", porque enviaría un correo.

Por eso este informe solo recoge lo **visto** en el sitio público y en las pantallas de inicio de sesión, registro y recuperación, que se abrieron sin enviar nada. **No hay nada "probado" dentro de la aplicación.** No se crearon registros.

### Qué haría falta para la ronda 2 real

- El **código de clínica** y el **número de teléfono** de la cuenta de prueba del usuario.
- Que **una persona** complete la verificación de Cloudflare. Una opción es que el usuario inicie sesión en un navegador que él controle, como el navegador integrado de la app de escritorio o Claude en Chrome, y desde ahí se haga la evaluación.

## Pasos realizados

| # | Paso | Resultado | Tipo |
|---|------|-----------|------|
| 1 | Abrir `dentincloud.com/es` y buscar el enlace de inicio de sesión | "Iniciar sesión" lleva a `app.dentincloud.com/login`; "Pruébelo gratis" lleva a `/register` | visto |
| 2 | Abrir la página de inicio de sesión | Campos: código de clínica, teléfono (+1 por defecto), contraseña, "Recuérdame" y Turnstile. No hay campo de correo ni acceso con Google | visto (captura 01) |
| 3 | Intentar completar el formulario con el correo | No es posible: no hay campo de correo. Se detuvo antes de escribir la contraseña o enviar el formulario | — |
| 4 | Abrir `/forgot-password` (sin enviar) | También pide código de clínica y teléfono, y manda el enlace por correo. No se envió | visto |
| 5 | Abrir `/register` (sin enviar) | Nombre, apellido, nombre de clínica, teléfono, correo, contraseña ×2 y un único checkbox que agrupa contrato, privacidad **y consentimiento de comunicaciones comerciales**. Texto: "úsalo gratis hasta **250** pacientes" | visto |
| 6 | Leer el sitio público: funciones, precios, preguntas frecuentes, "Quiénes somos" y comparativas | Ver tabla por áreas | visto (captura 02) |

Capturas (sin correo ni contraseña visibles, revisadas):

- `capturas/dentincloud-01-login.jpg`
- `capturas/dentincloud-02-precios-publicos.jpg`

## Evaluación por área

Ninguna área se probó dentro de la aplicación, así que **todas quedan "no evaluado"**. La columna "Visto en el sitio público" recoge solo lo que DentinCloud **afirma**, sin verificar.

| # | Área | Puntaje | Visto en el sitio público (afirmaciones, sin verificar) |
|---|------|---------|------------------------------------------------|
| 1 | Panel y navegación | no evaluado | Interfaz en 12 idiomas; chat interno del equipo con presencia (quién está conectado) |
| 2 | Agenda y disponibilidad | no evaluado | Columna por odontólogo con color; crear la cita tocando una hora libre; arrastrar para mover; vistas de día, semana y mes; diente, tratamiento y precio en la cita; aviso de alergia o anticoagulantes en la tarjeta de la cita. **No se pudo probar el solape.** |
| 3 | Sillones y sucursales | no evaluado | "Con la misma cuenta puede acceder a varias clínicas y pasar de una a otra con un clic". Parecen **clínicas separadas** (una base de datos por clínica), no sucursales de una misma clínica con pacientes compartidos. No se mencionan sillones ni consultorios |
| 4 | Pacientes | no evaluado | Ficha con anamnesis (lista de comprobación), documentos y notas, e informe del paciente en PDF. **No se pudieron probar duplicados ni búsqueda sin tildes** |
| 5 | Odontograma y periodontograma | no evaluado | Odontograma con plan de tratamiento en la misma pantalla. **No se menciona periodontograma** |
| 6 | Historia clínica y tratamientos | no evaluado | Plan de tratamiento sobre los dientes, con cada paso vinculado a una cita y seguimiento del avance; historial de tratamientos; radiografías como adjuntos |
| 7 | Presupuestos, cuotas y pagos | no evaluado | Cuenta corriente del paciente, "cobre en dos clics", caja diaria y lista de deudores. No se mencionan presupuestos con cuotas ni QR. La suscripción se cobra solo con tarjeta vía iyzico |
| 8 | Inventario | no evaluado | No se menciona |
| 9 | Finanzas, informes y comisiones | no evaluado | Informes de ingresos, cobros y citas. No se mencionan comisiones |
| 10 | WhatsApp, reserva en línea y automatizaciones | no evaluado | WhatsApp conectado **escaneando un QR desde el número de la clínica**, no con la API oficial de Meta. 9 plantillas editables: confirmación, recordatorio 1 día y 3 h antes, inasistencia, indicaciones tras el tratamiento y cumpleaños. **No se menciona página de reserva en línea** |
| 11 | Seguridad, roles, auditoría y 2FA | no evaluado | Roles de odontólogo, auxiliar, recepción y gerencia. Base de datos propia por clínica y HTTPS. No se mencionan 2FA ni auditoría. El acceso es con código de clínica, teléfono y contraseña, más Turnstile |
| 12 | Móvil (390×844) | no evaluado | "Funciona en el navegador del móvil; la agenda se adapta" |
| 13 | Asistente IA | no evaluado | "Pregúntele por las citas de hoy o pídale un resumen del paciente. **Con su aprobación**, también crea la cita él mismo". Es decir, afirman que pide confirmación antes de escribir |
| 14 | Límites del plan gratuito | no evaluado | Sitio: gratis **hasta 100 pacientes**, sin límite de tiempo, 4 usuarios y 5 GB. Pago: 34 €/mes o 309 €/año (precios de España; "varían según país"), con pacientes ilimitados y usuarios o almacenamiento extra de pago |

## Hallazgos, errores y fricciones (vistos sin entrar)

- **Límite del plan gratuito contradictorio:** el sitio dice "hasta 100 pacientes" y la página de registro dice "gratis hasta 250 pacientes".
- **Acceso poco intuitivo:** se entra con código de clínica y teléfono, no con correo. El usuario tenía correo y contraseña y no podía saber qué poner. El prefijo +1 por defecto no sirve para Bolivia (+591).
- **Recuperar contraseña también exige el código de clínica.** Si se olvida el código, no hay vía visible salvo el soporte por WhatsApp a un número de Turquía.
- **Consentimiento agrupado en el registro:** un solo checkbox acepta a la vez contrato, privacidad, transferencia de datos y **comunicaciones comerciales**. El marketing no es opcional.
- **Operador y marco legal:** persona física en Alanya, Turquía, con textos KVKK (ley turca). Precios en EUR y cobro con tarjeta vía iyzico. Para una clínica boliviana: sin moneda Bs ni QR visibles, y soporte en otra zona horaria.
- **WhatsApp por QR, no por API oficial:** depende de vincular el teléfono de la clínica (sesión tipo WhatsApp Web), con riesgo de bloqueo del número y de desconexiones.
- **5 sucursales:** con 4 usuarios incluidos y un modelo de "varias clínicas" separadas, una red de 5 sedes probablemente necesite usuarios extra y no tenga pacientes compartidos entre sedes. Es una inferencia sin verificar.

## Comparación breve con nuestra plataforma (según CHANGELOG 0.1.0–0.2.0)

| Tema | DentinCloud (afirmado) | Nosotros (implementado) |
|------|------------------------|-------------------------|
| Varias sucursales | Clínicas separadas, cambio con un clic | Sucursales dentro de una clínica, roles por sucursal, RLS por clínica |
| Solapes de agenda | No verificado | Sin solapes de profesional, consultorio ni paciente, garantizado por la base |
| Pacientes | Ficha, anamnesis y documentos | N° correlativo, búsqueda sin tildes, duplicados, responsable de menores, importar y exportar Excel |
| Odontograma | Sí, con plan | FDI permanente y temporal, 5 superficies, historial inmutable |
| Cobros | Cuenta corriente y caja diaria | Presupuestos con cuotas, pagos idempotentes (Bs) |
| WhatsApp | Envío automático vía QR, 9 plantillas | Recordatorios por wa.me solo con consentimiento, sin envío automático |
| Seguridad | Roles y Turnstile | 2FA TOTP, auditoría de solo inserción, registro de lecturas del expediente, CSRF, bloqueo por intentos |
| Consentimientos | Agrupados en el registro | Versionados, firmados, con hash SHA-256 |
| Sala de espera | No mencionada | Tablero por sucursal |
| IA | Asistente que consulta y crea citas con aprobación | No tenemos |
| Chat interno | Sí | No tenemos |

## Requisitos sugeridos para nuestra plataforma

Requisitos originales, basados en lo visto y en las brechas detectadas. No copian la implementación de DentinCloud.

**P1**

- **R2-01 Ingreso simple y recuperable:** entrar con correo o teléfono boliviano (+591 por defecto) sin pedir un "código de clínica". Si el usuario trabaja en varias clínicas, que elija después de ingresar. La recuperación de contraseña solo debe pedir el correo o el teléfono.
- **R2-02 Consentimientos separados en el alta:** términos y privacidad obligatorios; comunicaciones comerciales en un checkbox aparte y opcional. Ya tenemos consentimientos versionados: aplicar el mismo criterio al registro de la clínica.
- **R2-03 Límites de plan coherentes y visibles:** un solo valor publicado (pacientes, usuarios, almacenamiento), mostrado igual en el sitio, el registro y la app, con un contador de uso dentro del producto.
- **R2-04 Recordatorios automáticos opcionales con proveedor oficial:** además del wa.me manual, envío automático (confirmación, víspera, horas antes, inasistencia) mediante la API oficial de WhatsApp Business. Siempre con consentimiento previo y plantillas editables.
- **R2-05 Alertas clínicas en la tarjeta de la cita:** mostrar en la agenda un ícono de alergias o anticoagulantes a partir de los antecedentes versionados que ya existen.
- **R2-06 Precios y cobros locales:** suscripción y cobros a pacientes en Bs, con QR interbancario boliviano como método de pago.

**P2**

- **R2-07 Asistente de consulta con confirmación explícita:** preguntas en lenguaje natural sobre la agenda y los pacientes, limitadas a los permisos del rol. Toda escritura (crear o mover citas) como propuesta que el usuario confirma, y cada acción registrada en la auditoría.
- **R2-08 Chat interno por sucursal** con presencia, sin datos clínicos en mensajes libres (o con registro de acceso).
- **R2-09 Plan de tratamiento vinculado a citas:** cada etapa del plan enlazada a su cita, con el avance visible en la ficha.
- **R2-10 Informe del paciente en PDF** (resumen clínico y de cuenta) con registro de quién lo generó.
- **R2-11 Selector de idioma por usuario** (al menos es, en, pt), útil para profesionales extranjeros.

## Registros de prueba creados y limpieza

- **Registros creados en DentinCloud: ninguno.** No se pudo iniciar sesión, así que no se crearon pacientes, citas, presupuestos ni otros datos, y no hay nada que borrar.
- No se enviaron SMS, WhatsApp ni correos. No se usaron el registro ni la recuperación de contraseña, y no se cambió nada de la cuenta.
- La contraseña nunca se envió al servidor. Se guardó temporalmente en un archivo local con permisos 600, que **ya se borró**. Se verificó que no aparece en ningún archivo del scratchpad ni en las capturas.
- Los scripts de exploración siguen en `(copia de trabajo local) dic/` y no contienen la contraseña.
