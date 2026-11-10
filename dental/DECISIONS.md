# Registro de decisiones (ADR resumidos)

Formato: contexto → decisión → consecuencias. Las decisiones con ⚠ requieren revisión humana o legal.

### D-01 · Carpeta `dental/` dentro del repositorio existente
- **Contexto:** el repositorio `A` contiene Gabriel Store, otro producto con su propio despliegue.
- **Decisión:** la plataforma odontológica vive en `dental/`, con su propio `package.json`, Dockerfile, CI y documentación. No se toca el código de Gabriel Store.
- **Consecuencia:** se despliega como un servicio separado en Railway (directorio raíz `dental`). Si crece, se puede mover a su propio repositorio sin cambios.

### D-02 · Node 22 + TypeScript + Fastify + zod
- **Por qué:** es el mismo lenguaje en el frontend y el backend, lo que da un solo equipo y tipos compartidos. Fastify es rápido y maduro. zod valida los datos y además genera el OpenAPI. El repositorio ya usaba Node 22.
- **Alternativa descartada:** FastAPI (Python). Es igual de válida, pero sumaba un segundo lenguaje sin beneficio claro para este equipo.

### D-03 · PostgreSQL con esquema compartido + Row Level Security + FK compuestas
- **Alternativas consideradas:**
  - una base por clínica: aislamiento fuerte, pero operación costosa con decenas de clínicas;
  - un esquema por clínica: las migraciones se multiplican.
- **Decisión:** esquema compartido con `clinic_id` en cada fila, RLS obligatorio con un rol sin BYPASSRLS y FK compuestas `(id, clinic_id)`.
- **Consecuencia:** un error de código no expone datos de otra clínica (está probado). Se puede migrar una clínica grande a su propia base en el futuro sin cambiar el modelo.

### D-04 · Sesiones opacas en cookie HttpOnly + token CSRF (no JWT en localStorage)
- **Por qué:** se pueden revocar al instante (al desactivar a alguien, cambiar la contraseña o cerrar sesión) y JavaScript no puede robarlas (XSS).
- **Costo:** una consulta a la base por petición. Es aceptable y se puede cachear más adelante.

### D-05 · scrypt de `node:crypto` para contraseñas
- **Por qué:** no requiere dependencias nativas y es resistente a GPU.
- **Parámetros:** N=32768. Las pruebas usan N=1024 por velocidad, configurable con `DENTAL_SCRYPT_N`.

### D-06 · Registros clínicos, cargos y auditoría de solo inserción
- **Contexto:** el reglamento del SEDES La Paz (anexo E) exige que el software no permita modificar registros guardados. La trazabilidad clínica y financiera es un requisito del cliente.
- **Decisión:**
  - las correcciones se registran como enmiendas o anulaciones que referencian el original;
  - se aplica con GRANT y triggers.
- **Consecuencia:** el historial completo siempre se reconstruye. "Borrar" un paciente significa archivarlo.

### D-07 · Pagos en dos estados (registrado → verificado) con control dual
- **Contexto:** en Bolivia la captura de un QR o un comprobante no prueba el ingreso del dinero (BCB RD 079/2022: el pago es final cuando se acredita).
- **Decisión:**
  - el efectivo queda confirmado al recibirlo;
  - transferencia, QR o tarjeta quedan `pending_verification` hasta que **otra persona** con permiso `payments.verify` lo confirme (el propietario está exceptuado);
  - la referencia bancaria es única.
- **Futuro:** conciliación automática con una fuente bancaria autorizada (backlog).

### D-08 · Agenda: exclusiones en PostgreSQL además de validaciones en la app
- **Por qué:** las validaciones de la aplicación tienen condiciones de carrera con varias recepciones a la vez. La restricción `EXCLUDE` es atómica.
- **Probado:** 4 reservas simultáneas → exactamente 1 éxito.

### D-09 · React + Vite con sistema de diseño propio
- **Por qué:** control total del estilo "clínico premium", sin la dependencia de una librería de UI pesada. Se compila a archivos estáticos que sirve el mismo servidor.

### D-10 · No reutilizar código de DentalPin ni de otros competidores ⚠
- **Contexto:** DentalPin usa BSL 1.1, que prohíbe ofrecer con él un SaaS comercial de gestión dental.
- **Decisión:**
  - solo inspiración funcional y principios generales (por ejemplo, la confirmación antes de escribir en el copiloto);
  - todo el código, la interfaz y los textos son originales;
  - las capturas de las demos son evidencia interna y no se distribuyen.

### D-11 · Asistente: herramientas + propuestas, sin escritura autónoma
Ver `ARCHITECTURE.md` §7. El modelo por defecto se configura con `ASSISTANT_MODEL`. Sin clave, el asistente se degrada a acciones rápidas en lugar de inventar respuestas.

### D-12 · WhatsApp en dos fases ⚠
- **Fase 1 (implementada):** enlaces `wa.me` que se envían manualmente, solo a pacientes con consentimiento, y mensajes sin datos clínicos.
- **Fase 2 (backlog):** WhatsApp Business Cloud API oficial, con plantillas aprobadas por Meta, opción de baja y registro de entregas. Requiere una cuenta de Meta verificada de la clínica y tiene costo por conversación, así que la decide el cliente.

### D-13 · Facturación SIAT a través de un proveedor autorizado ⚠
- **Contexto:** RND 102100000011. Ser "Proveedor" exige autorización del SIN, renovación cada 3 años y homologación de cada versión. Hay plazos de 2026: anexo técnico de la Ley 1733 y homologación del catálogo antes del 31-dic-2026.
- **Recomendación:** integrar primero un proveedor autorizado vía API. La decisión final es legal y comercial y queda pendiente de la clínica.

### D-14 · Migraciones SQL propias con checksum
- **Por qué:** SQL explícito y auditable (RLS, triggers, GRANT). Un ejecutor de 50 líneas evita un ORM o un framework de migraciones.
- **Regla:** una migración aplicada **no se modifica**; se crea una nueva. El ejecutor lo detecta y está probado.

### D-15 · Respaldos con privilegios incluidos
- **Decisión:** `pg_dump --no-owner` conserva los GRANT al rol `dental_app`. El script de restauración crea el rol si no existe.
- **Probado:** tras restaurar, RLS sigue aislando.

### D-16 · Verificación en dos pasos con TOTP propio y secreto cifrado fuera de la base
- **Por qué TOTP y no SMS:** no depende de operadores ni tiene costo por mensaje, funciona sin señal y no es vulnerable a la clonación de SIM.
- **Implementación:** ~60 líneas con `node:crypto`, verificada con los vectores del RFC 6238.
- **Clave en el entorno:** el secreto se cifra con `DENTAL_SECRET_KEY`. Un respaldo filtrado no permite generar códigos.
- ⚠ Si se pierde la clave, todos deben reactivar los 2 pasos. Guárdala en el gestor de secretos del proveedor y en un lugar seguro aparte.

### D-17 · Usuarios globales, credenciales protegidas entre clínicas
- **Contexto:** una persona (por ejemplo, un odontólogo) puede trabajar en varias clínicas con la misma cuenta.
- **Decisión:**
  - una clínica solo puede emitir una contraseña temporal a quien pertenece **únicamente** a ella;
  - quien está en varias usa "Olvidé mi contraseña";
  - quitar los 2 pasos lo hace solo el soporte de plataforma, con motivo auditado.

### D-18 · Consentimientos como documentos inmutables con copia del texto
- **Decisión:**
  - se guarda el texto exacto mostrado, no solo un identificador de plantilla, para probar qué se aceptó aunque la plantilla cambie;
  - el hash SHA-256 cubre texto, firmante, decisión, fecha y firma;
  - la firma en pantalla es una **firma electrónica simple**.
- ⚠ Según el anexo E (Ley 164, art. 78), solo la **firma digital** certificada tiene plena validez; la firma electrónica simple vale como indicio. Para documentos donde se requiera firma digital, evaluar la integración con la entidad certificadora (AGETIC). Pendiente de validación legal.

### D-19 · Desarrollo en paralelo con ramas aisladas e integración verificada
Cinco equipos trabajaron en ramas separadas (worktrees), cada uno con su propia base de pruebas y un número de migración asignado. El integrador fusionó rama por rama y corrió **todas** las pruebas y el recorrido de diseño después de cada fusión. Los conflictos se limitaron a líneas de registro (importaciones, rutas, menú).

### D-20 · Periodontograma en JSON validado
Una exploración (unos 1000 valores) se edita, se guarda sola y se congela como un todo. Por eso se guarda como **JSON validado** en una fila, y no como filas normalizadas. La API valida con zod y la base vuelve a validar con un `CHECK`. La inmutabilidad es un trigger sobre una sola fila.

### D-21 · Bandeja de mensajes con simulador obligatorio
Todo mensaje (códigos, recordatorios) pasa por `outbound_messages`. Fuera de producción el estado es `simulated` y nunca sale. En producción, sin proveedor configurado, queda `queued`. El proveedor real (WhatsApp Cloud API) se conecta por la interfaz `MessageProvider` (B-060).

### D-22 · Rol "Limpieza y apoyo" con mínimo privilegio
El personal de limpieza registra limpieza y esterilización sin ver pacientes, agenda ni dinero: los permisos `biosafety.*` son su único acceso. Así su trabajo queda documentado (útil ante inspecciones) sin exponer datos de salud.

### D-23 · Inventario: la base de datos garantiza que lotes = stock
Los saldos de lotes y de stock no se escriben desde la aplicación: solo cambian cuando se inserta un movimiento (de solo inserción), mediante un trigger `SECURITY DEFINER`. Un `CHECK >= 0` impide los negativos. Así la invariante no depende de que cada pantalla haga bien la cuenta; está probada con 220 movimientos al azar.

### D-24 · El consumo de materiales nunca bloquea la atención
Si al realizar un tratamiento falta stock, el tratamiento se registra igual y queda un «consumo pendiente» para que la sucursal lo regularice. Bloquear la atención por un error de inventario sería peor para el paciente.

### D-25 · PDF congelados al emitir
Se guarda el primer PDF generado y se sirve siempre ese mismo archivo. Así se entrega exactamente lo que recibió el paciente o la farmacia, aunque luego cambie la plantilla, la biblioteca o los datos. Se eligió `pdfkit` porque incrusta fuentes sin otra dependencia. ⚠ Las plantillas de recetas y certificados requieren revisión legal y clínica.

### D-26 · Mensajes automáticos: idempotencia por clave y simulador obligatorio
Cada aviso tiene una `dedupe_key` única (regla + cita + momento), así el programador puede correr cuantas veces sea sin duplicar. Una reprogramación anula los avisos pendientes y crea los nuevos. Las plantillas rechazan variables clínicas en la base de datos. Fuera de producción todo queda `simulated` (D-21). ⚠ El envío real por WhatsApp requiere la cuenta verificada de la clínica y plantillas aprobadas por Meta.

### D-27 · Citas recurrentes: revisión antes de guardar
La serie se calcula y se revisa completa (conflictos y hueco libre sugerido por cada cita) antes de guardar, y se guarda en una sola transacción. Máximo 52 citas para evitar series sin fin. «Solo esta / esta y las siguientes» siguen el modelo conocido de los calendarios.
