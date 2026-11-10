# Panel Dental: segunda ronda (en profundidad)

- **Fecha:** 2026-11-10
- **Objetivo:** sacar requisitos funcionales concretos de las áreas que todavía no construimos. No repite lo del anexo C (`docs/research/anexo-C-demo-panel-dental.md`); cuando algo ya estaba allí, solo se cita.
- **Fuentes:** la demo https://dental.proyecciondigital.org/login con las credenciales que publica el proveedor (`admin@demo.clinic / demo1234`), y las páginas públicas `/es/funcionalidades/*` (API, periodontograma, agenda, recordatorios, plan de tratamiento, presupuestos, informes, historial clínico, facturación).
- **Herramienta:** Playwright (Chromium headless), 1440x900, zona horaria del navegador America/La_Paz. La página pública del presupuesto se abrió a 390x844 y sin sesión, como la vería un paciente.
- **Leyenda:** **[P] probado** = lo hice en la demo · **[V] visto** = lo vi en pantalla sin ejecutarlo · **[A] anunciado** = solo lo dice la web comercial.

## Cómo se trabajó y límites

- Usé solo el rol Administrador. Los demás roles los vi en la matriz de permisos, sin entrar con ellos.
- **No envié mensajes ni campañas**, no cobré nada y no cambié ninguna configuración global. Las pantallas de Configuración se abrieron solo para leer. Abrí el diálogo «Nuevo intervalo» de WhatsApp y lo cerré con *Cancelar*; nunca pulsé «Enviar prueba».
- **Solo creé una cita, y para un paciente ficticio sin teléfono** («ZZPerio Prueba Sintelefono»). La cancelé al terminar. No se generó ningún WhatsApp.
- No borré datos de la demo. Solo quité una línea duplicada de **mi** plan y no descarté nada ajeno.
- No leí el código de la página ni probé la seguridad. Todo lo observé como un usuario normal.
- La demo **no se había reiniciado**: seguían allí los datos de la primera ronda (el cobro de RD$ 20 y las citas canceladas del 16/11).
- **Privacidad:** el Historial WhatsApp y la lista de Recordatorios muestran números con aspecto de reales (+58…, +1 809…). No guardé capturas de esas pantallas y borré una que había hecho.

**Registros ficticios que creé en esta ronda** (para avisar o limpiar si hace falta):
- **Inventario:** 3 ítems «ZZ Prueba Investigación…». Los 3 llevan el mismo SKU `ZZ-PRUEBA-GUA-M`: el primero se guardó y no apareció en la lista, así que lo creé dos veces más. Además, el lote ZZ-LOTE-001 y sus movimientos (compra 10, transferencia de 2 a Anacaona, consumo 3, ajuste +1).
- **Compras:** la orden OC-2026-0001 (4 cajas), que quedó «Recibida en parte»: llegaron 2 en el lote ZZ-LOTE-002 y se rechazó 1.
- **Paciente** ZZPerio Prueba Sintelefono, sin teléfono ni correo:
  - una exploración periodontal cerrada;
  - un segundo borrador periodontal, que descarté;
  - una nota de diagnóstico hecha con plantilla;
  - el plan PLAN-2026-0005;
  - el presupuesto PRES-2026-0005, aceptado y firmado desde el enlace público con el código 4821;
  - un plan de pago de 4 cuotas;
  - una cita el 18/11, que cancelé.

---

## 1. Periodontograma

**Qué hice [P]:** abrí una exploración. Cargué el sondaje y el margen de los dientes 16, 11 y 36, marqué sangrado y placa, y recorrí los valores de movilidad, furca, pronóstico e implante. Probé el teclado, cerré la sesión, abrí una segunda y la descarté.

**Estructura de la pantalla**
- Ruta: Ficha → Clínico → Diagnóstico → sub-pestaña **Periodontograma** (al lado de Odontograma y Ortodoncia).
- Si no hay exploraciones, aparece un estado vacío con el botón «Iniciar exploración».
- Cabecera de la sesión:
  - una etiqueta de estado («Borrador en curso» o «Sesión cerrada»);
  - «Registrada el <fecha>»;
  - el indicador «Cambios guardados»;
  - los botones **Descartar borrador** y **Cerrar sesión**.
- Debajo, 4 indicadores: **SANGRADO %**, **PLACA %**, **CAL MEDIO (mm)** y **BOLSAS ≥5MM**.
- Dos bloques, SUPERIOR (18→28) e INFERIOR (48→38). Cada bloque tiene, en este orden:
  - filas por diente: Implante, Movilidad, Pronóstico, Furca V, Furca L/P y Anchura de encía;
  - filas por sitio de la cara vestibular: Sondaje V, Margen V, Placa V y Sangrado V;
  - un **gráfico** con el dibujo de las raíces en vestibular, y otro en palatino o lingual;
  - las mismas filas por sitio de la cara palatina o lingual.
- Con la sesión ya iniciada, arriba aparece **«Historial temporal»**: un deslizador con un punto por sesión.

**Sitios y valores** (tomados de las etiquetas accesibles de cada celda) [P]

| Dato | Ámbito | Tipo de control | Rango / valores | Unidad |
|---|---|---|---|---|
| Sondaje | 6 sitios: MV, V, DV, ML, L, DL | número | 0 a 15 | mm |
| Margen gingival | 6 sitios | número | **−5 a 10** (con signo) | mm |
| Placa | 6 sitios | interruptor | sí / no | — |
| Sangrado | 6 sitios | interruptor | sí / no | — |
| Movilidad | diente | ciclo por clics | · → 0 → 1 → 2 → 3 → · | Miller |
| Furca V y Furca L/P | diente | ciclo | · → 0 → I → II → III → · | grado |
| Pronóstico | diente | ciclo | · → B → M → D → ✕ → · | bueno / medio / dudoso / sin esperanza [A] |
| Implante | diente | interruptor | ● / · | — |
| Anchura de encía | diente | número | 0 a 20 | mm |

- Cada arcada tiene 208 campos numéricos: 16 de anchura más 4 filas × 48 sitios. En total, 416 campos.
- **Supuración: no existe en la pantalla**, aunque la web la anuncia por sitio [A]. **Tampoco hay forma de marcar un diente ausente** dentro del periodontograma. La web dice que los ausentes y los implantes se precargan desde el odontograma [A]; no lo comprobé.
- El orden de los sitios es siempre MV-V-DV de izquierda a derecha, en todos los cuadrantes. No se espeja hacia la línea media: en el diente 16, lo mesial queda a la izquierda [V].

**Gráfico [P]:**
- Una línea roja marca el margen y otra azul la profundidad, dibujadas sobre las raíces. Entre las dos se sombrea la bolsa.
- Bajo cada diente salen círculos con el sondaje, en colores: verde ≤3, amarillo 4, naranja 5 y rojo ≥6–7.
- **Fallo:** la línea une el 16 con el 11 atravesando los dientes 15 a 12, que no estaban medidos. Interpola donde no hay datos.

**Teclado** [P]
- Al escribir un dígito, el foco **no avanza solo**. Escribí «5», «6» y «4» seguidos y el mismo campo quedó en **«564»**, aunque el máximo es 15. **No hubo aviso.** Ese valor se perdió al recargar.
- *Tab* pasa al sitio siguiente (MV → V → DV …). *Enter* no hace nada.
- **Las flechas cambian el número en lugar de mover el foco.** Con ↓, el sitio V del 16 pasó a «0» y **ese 0 se guardó**.
- La web anuncia «edición tipo hoja de cálculo: navegas y editas cada celda» [A]. No es lo que pasa.
- Los campos de sondaje y margen miden **14 px de ancho**: son difíciles de tocar en una tableta y de leer.

**Guardado y estados** [P]

```
(sin exploraciones) --Iniciar exploración--> BORRADOR (guarda solo, "Cambios guardados")
BORRADOR --Cerrar sesión [nota opcional]--> CERRADA (solo lectura, "ya no se puede cambiar")
BORRADOR --Descartar borrador [confirmación: "No se puede deshacer"]--> eliminado
CERRADA --Abrir nueva sesión--> nuevo BORRADOR (vacío)
```

- El diálogo de cierre dice: «Una vez cerrada, la sesión ya no se puede cambiar… Para corregir algo tendrás que abrir una nueva sesión». Ofrece una «Nota (opcional)».
- **La nueva sesión empieza en blanco**: no copia los valores anteriores.

**Cálculos** [P] (con 18 sitios medidos de 192 posibles)
- **Sangrado:** 3 sitios marcados → **1,6 %** = 3/192.
- **Placa:** 1 sitio → **0,5 %** = 1/192.
- Los dos porcentajes **dividen entre los 192 sitios de la boca completa**, no entre los sitios medidos (18). Con una exploración parcial, el índice sale casi a cero.
- **CAL medio:** mostró **0,3–0,4 mm** cuando el promedio real de los sitios medidos ronda los 3–4 mm. Usa el mismo denominador de 192 sitios.
  - Además, **cambió de 0,4 mm en el borrador a 0,3 mm al cerrar** con los mismos datos.
  - La web dice que los índices se «computan y congelan al cerrar» [A].
- **Bolsas ≥5 mm:** marcó **2** con 4 sitios ≥5 mm (16-MV 5, 16-DV 6, 36-MV 7, 36-V 5). Cuenta dientes, o sitios >5. La etiqueta no aclara cuál.

**Comparar exploraciones** [P]
- El «Historial temporal» es un deslizador de 0 a 1, sin etiqueta accesible.
- Mis dos sesiones del mismo día aparecieron las dos como «Ahora». Con las flechas no cambió la vista.
- **No hay comparación lado a lado ni diferencias** (por ejemplo, Δ de sondaje por sitio o Δ de los índices).

**Otros fallos [P]:**
- La anchura de encía del 16 (3 mm), escrita justo antes de cerrar, **no apareció en la sesión cerrada**. Parece que el último cambio pendiente se pierde al cerrar.
- Las sesiones cerradas o descartadas **no quedan en el Historial de actividad**.

---

## 2. Inventario y compras

**Qué hice [P]:**
- Creé un ítem.
- Ingresé un lote con vencimiento cercano.
- Registré una transferencia, un consumo con FEFO, un ajuste y un consumo mayor que el stock.
- Hice una orden de compra completa: borrador → enviada → recibida en parte, con un rechazo.

**Estructura de la pantalla**
- Inventario tiene las pestañas **Resumen | Ítems | Lotes | Movimientos | Proveedores | Categorías** y los botones *Ingresar lote* y *Nuevo ítem*.
- El texto de la página dice: «Cada compra crea un lote; cada consumo descuenta del lote más cercano a vencer (FEFO)».
- **Resumen:**
  - indicadores: ítems activos, lotes activos, bajo stock y próximos a vencer;
  - listas «Próximos a vencer (n)» (lote · sucursal · cantidad · «vence en N día(s)») y «Bajo stock (n)» (ítem · sucursal · «2 caja / mín 5 caja»).
- **Ítems:**
  - columnas: Ítem, SKU, Categoría, Stock total («mín N»), Lotes, Próximo vencimiento y Acciones;
  - 3 iconos **sin texto ni nombre accesible**: ingresar lote, nuevo movimiento y editar.
- **Lotes:** Ítem, Lote, Sucursal, Restante, Inicial, Vence («en 59d»), Proveedor y Costo.
- **Movimientos:** Tipo, Ítem, Cantidad, Lote, Desde → Hacia, Cuándo («hace segundos») y Notas.

**Campos** [P]

| Formulario | Campos |
|---|---|
| **Nuevo ítem** | Nombre*, Código (SKU), Unidad (texto libre: «ampolla, caja…»), Descripción, Categoría, Proveedor habitual, Stock mínimo (número ≥0), Precio de referencia (0,01), Moneda (DOP/USD) y el interruptor «Se maneja por lotes con vencimiento» |
| **Ingresar lote** | Ítem*, Sucursal destino*, Número de lote*, Cantidad inicial* (paso 0,001), Fecha de vencimiento, Costo unitario, Moneda, Proveedor, Ubicación física («Estante A2, Caja roja…») y Notas. Genera un movimiento «Compra». |
| **Nuevo movimiento** | Tipo* (Consumo / Transferencia entre sucursales / Ajuste positivo / Descarte por vencimiento), Ítem*, Desde sucursal* o A sucursal*, Lote (opcional: vacío = FEFO; obligatorio en las transferencias; cada lote muestra «ZZ-LOTE-001 · 10 disp. · vence 25 nov 2026»), Cantidad* (0,001) y Notas |
| **Materiales por tratamiento** [V] | Tratamiento del catálogo, artículo, cantidad y la casilla «Por cada diente» («un sellante en 4 dientes gasta 4 veces»). Si no alcanza el stock, descuenta igual y deja un aviso. Hay una lista de «Descuentos de los últimos 30 días». |

**Movimientos y resultados** [P]
- **Transferencia de 2 unidades** de Polanco a Anacaona:
  - genera **dos movimientos**, «Salida transfer.» y «Entrada transfer.»;
  - crea en Anacaona un lote **con el mismo número** (ZZ-LOTE-001, inicial 2);
  - es inmediata: **no hay estado «en tránsito» ni confirmación de recepción**.
- El consumo de 3 descontó del único lote de Polanco, y la nota quedó en el movimiento.
- El **«Bajo stock» se calcula por sucursal**: Anacaona, con 2 frente a un mínimo de 5, salió en la alerta.
- **No existe un «ajuste negativo»** propiamente dicho: para sacar unidades hay que registrar un Consumo o un Descarte.

**Validaciones**
- «Nombre requerido» como aviso flotante [P].
- Si se guarda un lote o un movimiento **sin sucursal** (estando en «Todas las sucursales»), no se guarda y **no aparece ningún mensaje** [P].
- El consumo de 500 con 10 en stock no se registró, pero tampoco vi un mensaje claro [P].

**Fallos y fricciones [P]:**
- **Los ítems sin lotes no aparecen en la vista de una sucursal.** El ítem nuevo solo se ve en «Todas las sucursales», y por eso lo creé 3 veces.
- **El SKU se puede duplicar**: 3 ítems con el mismo SKU, sin aviso.
- **El stock cuadra mal:**
  - los 20 ítems de la demo marcan «Stock total 0» aunque sus lotes tienen restante (por ejemplo, 12,78);
  - tras el ajuste +1, el ítem marcaba 8 y la suma de lotes era 7 (5 + 2). El ajuste sumó al ítem pero no a ningún lote.
- Con stock 0 frente a un mínimo de 10, los ítems de la demo **no salen en «Bajo stock»**.
- La alerta de vencimiento de Anacaona aparece en el Resumen aunque el selector esté en Polanco.
- La unidad es texto libre: **no hay conversión** de caja a unidades.

**Compras** [P]

```
BORRADOR --Marcar como enviada--> ENVIADA --Registrar lo que llegó--> RECIBIDA EN PARTE --(más entregas)--> RECIBIDA
BORRADOR: Editar · Descargar PDF · Cancelar la orden · Borrar borrador
ENVIADA: Volver a borrador · Cancelar · Descargar PDF
RECIBIDA EN PARTE: Registrar lo que llegó · Cerrar con lo recibido
```

- **La orden** pide:
  - el proveedor;
  - la sucursal de llegada (obligatoria, aunque **no siempre se marcó como tal** en «Todas»);
  - la entrega prevista;
  - las condiciones de pago, que «se copian del proveedor»;
  - líneas con artículo, cantidad, precio sin ITBIS e ITBIS (18 %);
  - notas para el proveedor.

  Calcula importe, subtotal, ITBIS y total: 4 × 300 = 1.200 + 216 = RD$ 1.416. El número se asigna solo (OC-2026-0001).
- **La recepción** pide:
  - el número de factura o conduce del proveedor;
  - por cada línea, «Llegó bien», «Rechazado» y «Motivo del rechazo»;
  - el número de lote y el vencimiento.

  Lo aceptado entra al inventario como un lote nuevo. El rechazo «sigue pendiente». La orden muestra Pedido, Recibido, Rechazado y Pendiente por línea, y cada entrega queda con fecha, documento y quién la recibió.
- **Reposición** [V]: «ítems por debajo del mínimo… sin contar lo ya pedido» → crea **órdenes en borrador, una por proveedor**.
- **Proveedores** [V]: % de entregas a tiempo, % rechazado (calculado de las órdenes) y una valoración de 1 a 5 con comentario.
- **Auditoría:** ningún movimiento de inventario ni de compras aparece en el Historial de actividad [P].

---

## 3. Finanzas

**Caja y bancos** [V, formularios abiertos y cancelados]
- **No hay apertura ni cierre de caja, ni arqueo.** El modelo es de «cuentas» de efectivo o de banco con saldo = saldo inicial + cobros − gastos pagados ± transferencias ± correcciones.
- Regla de destino: el cobro entra en la cuenta que declare su método. Si ninguna lo declara, entra en la caja de la sucursal, que se crea sola («Caja Sucursal Polanco»). Mi cobro de RD$ 20 de la primera ronda está allí.
- **Nueva cuenta:**
  - Nombre;
  - Tipo (Efectivo (caja) / Banco);
  - Sucursal (Toda la clínica / sucursal);
  - Saldo inicial («los cobros de antes no se importan»);
  - «Métodos de cobro que entran aquí» (Efectivo, Tarjeta, Transferencia, Débito directo, ARS / Seguro, Otro).
- **Corregir saldo:** tipo (entrada / salida), monto y **concepto obligatorio**.
- **Transferir** entre cuentas: no se pudo abrir con una sola cuenta.
- **ARS (seguros):** los cobros por ARS no suman a ninguna cuenta hasta que se marcan como «Acreditado por la ARS», con fecha y cuenta.

**Gastos** [V]
- Campos:
  - Categoría (10: Local, Personal, Insumos y compras, Comunicación y tecnología, Publicidad, Transporte, Vehículo, Gastos financieros, Comida y bebida, Otros);
  - Subcategoría (por ejemplo, Insumos y materiales dentales, Laboratorio dental, Equipos…);
  - Nota;
  - Monto;
  - Fecha (hoy por defecto);
  - Sucursal (o Toda la clínica);
  - «Pagado desde» (una cuenta, o «No descontar de ninguna cuenta»);
  - interruptor de NCF para el formato 606.

**Cobros** [V]
- Paciente, importe, método (Efectivo / Tarjeta / Transferencia / Seguro / Más opciones), fecha (Hoy) y «Opciones avanzadas».
- La lista distingue cobros «A presupuesto» y «A cuenta», y se filtra por método, fechas, paciente, «Con reembolsos» y «Sin asignar».

**Comisiones y liquidación** [V]
- **Comisiones:** ya vistas en la primera ronda. Son 3 bloques por rol (Odontólogo, Recepción, Gestor de citas), cada uno con interruptor, Modalidad, Porcentaje (0–100, paso 0,5) y Evento gatillo. El reporte tiene rango de fechas y estado (Todos / Pendientes / Pagados / Anulados). No hay configuración por profesional ni por tratamiento.
- **Nómina:**
  - Perfil: miembro del personal, Tipo de pago (**Mensual / Por horas**), Moneda, Importe base, Cuenta bancaria y RNC/Cédula.
  - Períodos: «Abrir período»; estaban vacíos.
  - Informes: mensual y anual.
  - **No vi relación entre comisiones y nómina.**
- **Fichaje:** entrada y salida por persona, con nota y hora manual («para una salida olvidada»), y horas trabajadas del día.

**Informes** [P]
- Facturación del 1/4 al 31/5/2026:
  - facturado RD$ 8.446,44 (17 facturas);
  - desglose «IVA 18,0 %» (la etiqueta dice IVA, no ITBIS);
  - «por profesional», que cuenta a quien creó la factura;
  - facturas vencidas y huecos de numeración;
  - **2 botones «Descargar CSV»**.
- **Total cobrado RD$ 0,00 y «Por método de pago: sin datos»**, aunque en ese período hay muchos cobros «a cuenta» con tarjeta en la lista de Cobros. Los cobros que no se aplican a una factura no entran en el informe de facturación, y la pantalla no lo explica.
- No hay estado de resultados ni un desglose por sucursal en columnas (confirmado en esta ronda).

---

## 4. Automatizaciones y WhatsApp (solo lectura)

**Estructura** [V]: Configuración → Comunicaciones → *Mensajes de WhatsApp*, con 5 secciones:

| Sección | Mensaje | Disparo | Tiempo por defecto | Modo |
|---|---|---|---|---|
| Avisos de cita | 24 horas antes | automático | 1 día antes | QR (texto) |
| | 2 horas antes | automático | 2 h antes | QR |
| | Confirmación al crear | automático | inmediato (0) | QR |
| Presupuestos | Envío del presupuesto | botón | — | QR |
| | Recordatorio del presupuesto | automático | **a los 7 y 14 días del envío, a las 10:00**, si sigue sin respuesta | QR |
| Informe clínico | Envío del informe (enlace al PDF con caducidad) | botón | — | QR |
| Después de la cita | Reseña de Google | automático | 3 días después de completar la cita | QR |
| | Post-operatorio | automático, solo tratamientos marcados «post-operatorio» en el catálogo | 7 días después | QR |
| Rellamadas | Limpieza, Chequeo anual, Control de ortodoncia, Control de implante, Seguimiento de tratamiento y Otro motivo | automático si la rellamada se programó con «Enviar automáticamente por WhatsApp» | según el motivo | QR |

**Diálogo «Nuevo intervalo»** [V]
- Título visible, con el consejo: «cambia el título cada vez que ajustes el tiempo (no se actualiza automático)». Es una fricción.
- Descripción interna.
- **Tiempo antes** (número; 0 = inmediato) y **Unidad** (Minutos / Horas / Días).
- **Canal:** WhatsApp (vía Evolution). Email y SMS figuran «próximamente».
- **Enviar por:** QR (texto normal) / Cloud API (texto normal) / Cloud API (plantilla oficial).
- Editor con B, I, S y `{}`, botones «Insertar variable» y vista previa.
- «Enviar prueba» y el interruptor «Activo (se enviará al crear citas)».

**Variables** [V]
- `{patient_name}`, `{patient_first_name}`, `{patient_last_name}` y `{patient_full_name}`.
- `{appointment_date}`, `{appointment_time}` y `{appointment_date_time}`.
- `{treatment}`, `{clinic_name}` y `{sucursal_sufijo}`; el editor también ofrece «Nombre sucursal».
- En presupuestos e informes: `{budget_number}`, `{total_currency}`, `{public_url}`, `{expires_date}` y `{retention_days}`.
- [A] La web también menciona `{professional_name}`, que no vi en la lista del panel.

**Confirmación**
- Con QR, el texto pide «Responde SÍ / NO» [V]. Con la plantilla oficial vienen dos botones fijos, «SÍ, voy a ir» / «NO, cancelar la cita», aprobados por Meta [A].
- No vi cómo una respuesta cambia el estado de la cita.

**Estado de entrega** [V]
- El Historial WhatsApp muestra el estado (entregado, leído o falló), el tipo (**Real / Prueba**), el teléfono, la plantilla, el mensaje y cuándo se envió.
- Se actualiza «cuando Evolution notifica el cambio».

**Opt-out**
- Solo vi el filtro «Sólo no contactar» en Pacientes (primera ronda).
- **No vi un mecanismo de baja** («responde BAJA»), ni horario de silencio, ni que el envío dependa de un consentimiento por finalidad.

**Rellamadas** [V]
- La lista mensual tiene filtros (motivo, estado, prioridad, «mostrar atrasados»), los botones Llamar / WhatsApp y exportación CSV.
- **Intervalos por motivo:** Higiene, Revisión, Revisión de ortodoncia y Revisión de implante en meses; Postoperatorio y Valoración/reseña en días; Seguimiento de tratamiento y Otro en meses.
- **Mapa de categorías de tratamiento a motivo:** cirugía → postoperatorio (7 d), implantes → revisión de implante (6 m), preventivo → higiene (6 m), ortodoncia → revisión mensual.
- «Sugerir recordatorio al completar un tratamiento» y «Vincular la cita al recordatorio existente al agendar».
- Borrado automático de los recordatorios completados tras N días.

**Lección para nosotros:** en la demo, el «modo demo» manda mensajes **Reales**. Hace falta un modo de pruebas que no salga hacia afuera.

---

## 5. Roles y permisos (solo lectura) [V]

- **Granularidad:**
  - **36 áreas** en 6 grupos;
  - **3 niveles** por área (Sin acceso / Solo ver / Ver y editar);
  - **por rol** (7 ajustables), **no por usuario ni por sucursal**;
  - con «Predeterminado (…)» y el botón «Volver a lo predeterminado».
- Administrador, Dueño o socio y Gerente lo ven todo y no se pueden ajustar.
- Los cambios se aplican cuando la persona recarga el panel.
- **No hay permisos por acción.** Por ejemplo, no se puede separar «aplicar descuento», «anular cobro», «cerrar sesión periodontal» o «exportar».
- **No hay ocultación por campo**, como ver la agenda sin los datos médicos o sin los precios.
- **Corrección a la primera ronda:** al abrir la pantalla, la pestaña Odontólogo pinta por un momento «Predeterminado (Sin acceso)» en Odontograma y Periodontograma. Al terminar de cargar, muestra «Ver y editar». Es un fallo de carga, no el valor real.

Matriz por defecto (VE = ver y editar, V = solo ver, – = sin acceso):

| Área | Odont. | Higien. | Auxil. | Recep. | Gestor citas | Contable | Especial. |
|---|---|---|---|---|---|---|---|
| Agenda y citas | VE | VE | VE | VE | VE | – | VE |
| Pacientes | VE | V | VE | VE | VE | V | VE |
| Historia clínica (datos médicos) | VE | V | VE | **VE** | – | – | VE |
| Notas clínicas | VE | VE | VE | **VE** | – | – | VE |
| Odontograma / Periodontograma | VE | VE | V | – | – | – | VE |
| Planes de tratamiento | VE | V | VE | VE | – | – | VE |
| Documentos clínicos | VE | – | V | – | – | – | VE |
| Presupuestos | VE | V | VE | VE | VE | V | VE |
| Facturas / Cobros | VE | V | VE | VE | – | VE | VE |
| Gastos / Caja y bancos / 606-607 / Nómina | – | – | – | – | – | VE | – |
| Inventario, planes de pago y etiquetas | VE | V | VE | VE | V | VE | VE |
| Compras a proveedores | V | – | VE | VE | – | VE | V |
| Materiales por tratamiento | VE | V | VE | – | – | – | VE |
| Informes | V | V | V | V | – | V | V |
| Protección de datos | V | V | V | VE | – | – | V |
| Mensajes de WhatsApp | V | V | V | VE | – | – | V |

Por defecto, recepción **puede editar los datos médicos y las notas clínicas**. Para nuestra política de confidencialidad, eso es demasiado permiso.

---

## 6. Agenda

**Vistas [P]:**
- Solo hay **Semana, Día y Kanban**.
- **No hay vista de mes, ni de lista, ni de recursos por sillón, ni lista de espera.**
- En la vista Día hay una columna por profesional más «Sin asignar».
- Las horas fuera del horario del profesional se ven **rayadas en gris**.
- El navegador de días muestra «Día +8» (relativo a hoy), lo que confunde.

**Filtros [P]:**
- Chips por módulo (cada uno con su color: azul, verde, naranja o violeta) y por profesional (con iniciales).
- La sucursal se elige con el selector global.

**Colores [V]:** las tarjetas toman el color del módulo o del profesional. **No vi colores por estado ni por tipo de tratamiento.** La web anuncia «duración y color auto desde el catálogo» [A].

**Formulario de cita [P]:**
- Lo nuevo frente a la primera ronda: **el aviso «Fuera del horario configurado: … ¿Crear la cita de todos modos?»**, con *Cancelar* / *Crear de todos modos*. Es un aviso suave, no un bloqueo.
- **No hay cita recurrente**, ni tipo de cita, ni color.
- Ofrece «Añadir al calendario».
- No deja cambiar el paciente de una cita: «para dar este horario a otro paciente, cancela esta cita y crea una nueva».

**Arrastrar y soltar [P]:**
- Moví mi cita de 08:00 a **09:15**; ajusta en pasos de 15 min.
- **Quedó encima de otra cita de la misma doctora (09:00–10:30) sin ningún aviso.**
- **Tampoco salió el aviso de «fuera de horario»** que sí da el formulario.
- La web anuncia «Drag & drop con validación… te avisa antes de que choquen» [A]. No lo hace.
- La Auditoría registró «Cita movida: de 08:00 a 09:15». Las tarjetas tienen un tirador para cambiar la duración [V].

**Estados [P]:**
- Menú «Acciones de la cita»: Marcar llegada / Marcar como confirmada / Marcar no asistencia / Cancelar cita.
- Al cancelar, sale «¿Cancelar esta cita? Se registrará en el historial.» **Sigue sin pedir el motivo.**
- Después de confirmar la cita, el menú de acciones dejó de abrirse desde la tarjeta y tuve que cancelar desde el formulario.

---

## 7. Historia clínica

**Historial médico [P]** (diálogo con secciones desplegables):

| Sección | Campos |
|---|---|
| Alergias | Nombre (lista de referencia), **Gravedad (Baja / Media / Alta / Crítica)**, Reacción («urticaria, dificultad para respirar»), Notas |
| Medicamentos | Nombre, Dosis, Frecuencia |
| Enfermedades sistémicas | Nombre, Tipo (**Controlada / Crítica**) |
| Condiciones especiales | Interruptores: Embarazada, Lactancia, Anticoagulantes, Reacción a anestesia, Bruxismo |
| Estilo de vida | Fumador; Consumo de alcohol (No consume / Ocasional / Moderado / Frecuente) |
| Historial quirúrgico | Procedimiento, fecha |

**Notas clínicas [P]:**
- Tipos: Administrativa, Diagnóstico, Tratamiento, Plan y Clínica.
- Hay **plantillas** de un clic. Por ejemplo, «Caries» rellena: Hallazgo / Profundidad / Síntomas / Prueba de vitalidad / Tratamiento sugerido.
- Se pueden adjuntar una foto o un documento.
- **La nota se guardó con la plantilla sin completar**: no hay campos obligatorios.
- Quedó en Auditoría como «Diagnóstico escrito».
- Dentro del plan, las notas se dividen en Plan, Tratamiento y Visita.

**Recetas [V]:**
- «Borrador de receta» con líneas de medicamento (dosis, unidad, vía, frecuencia, duración e indicaciones).
- Indicaciones generales.
- **«Guardar como plantilla».**
- El vademécum de la clínica y los datos del recetante («Exequátur y colegiatura») se configuran aparte.

**Documentos clínicos [V]:**
- Certificado médico, carta de referencia y solicitud de estudios radiográficos.
- Campos: título, diagnóstico, descripción, recomendaciones, y **reposo desde / hasta**.
- Se generan en PDF con membrete.

**Galería [V]:** categorías Intraoral, Extraoral, Radiografía, Antes/Después y Otra.

**Radiografías [V]:**
- Visor que mide y anota; acepta DICOM, JPG, PNG, WebP, TIFF, BMP y PDF.
- **Cola del sensor RVG:**
  - estados pendientes, aprobadas, rechazadas y fallidas;
  - al aprobar, el código de paciente del sensor queda vinculado y las siguientes imágenes entran solas.
- **Informe clínico en PDF** con un enlace que caduca (días de retención configurables).

---

## 8. Plan de tratamiento y presupuesto

**Plan [P]**

```
Crear plan (título, profesional, notas) → PLANIFICAR → Confirmar plan → (presupuesto borrador) → CONFIRMAR → [presupuesto enviado/aceptado] → EN CURSO (plan bloqueado)
Bandeja de planes: Por presupuestar · Esperando paciente · Sin cita · Sin próxima cita · Cerrados · Listado (con "N d en estado", "Marcar contactado")
```

- Los tratamientos se añaden con una barra de categorías: Restauradora, Cirugía, Endodoncia, Ortodoncia y **Boca completa**. Esta última incluye Diagnóstico, Preventivo, Periodoncia, Estética y Prótesis.
- Con un tratamiento por diente, se toca el diente y se eligen las **superficies** (M, D, O, V, L).
  - **El precio cambia con las superficies:** 1 superficie RD$ 60, 2 superficies RD$ 85.
  - Hay una casilla «Por cada diente» en los materiales.
- Cada línea muestra:
  - número de orden;
  - **profesional por línea** (iniciales);
  - las acciones «Arrastrar para reordenar», «Notas del tratamiento (n)», «Programar recordatorio», «Marcar como completado» y «Eliminar del plan» (pide confirmación: «No se puede deshacer»).
- **Duplicado sin aviso:** añadí dos veces «Obturación composite – diente 16».
- **No hay fases ni sesiones.** La web anuncia «sesiones cobrables» [A]; no las vi.
- Al confirmar, sale un resumen («PLAN-2026-0005 · 2 tratamientos · RD$ 145,00») y se crea un **presupuesto en borrador enlazado**: mientras sigue en borrador, los cambios del plan se reflejan en él.
- Cuando el presupuesto se envía o se acepta, el plan pasa a **«Plan bloqueado»** (con «Reabrir» si sigue pendiente) y el odontograma queda en solo lectura.

**Presupuesto [P]**
- Cabecera: número, **versión (v1)** y estado.
- Acciones: Enviar al paciente / Compartir enlace / Rechazar / Ver presupuesto / Editar, más un menú con **Aceptar presupuesto** (a mano), **Descargar PDF**, **Crear nueva versión**, **Definir código** y **Cancelar presupuesto**.
- Las líneas «se gestionan desde el plan»: no se editan en el presupuesto.
- **Edición:**
  - Válido desde / hasta (por defecto, hoy + 30 días);
  - **Tipo de descuento global (Porcentaje / Absoluto)** y su valor;
  - notas para el paciente y notas internas.
- El descuento global **se reparte por línea** («−RD$ 6,00 (Descuento global)»).
- **Fallo grave: un descuento del 150 % se aceptó y dejó el total en RD$ −72,50**, sin ningún aviso. Lo corregí a 10 %, que da RD$ 130,50.
- **Ese cambio de descuento no quedó en la Auditoría.**

**Enlace público y aceptación [P]**
- El enlace es `/p/budget/<uuid>` y pide verificar un dato: teléfono, fecha de nacimiento o, si el paciente no tiene ninguno, un **código** que se le dice de palabra.
- La página se mostró **en inglés** («Verify your identity», «QUOTE», «VAT», «Accept and sign»), con los tratamientos traducidos («Dental Cleaning», «Composite filling»). La clínica y el navegador estaban en español.
- **Diálogo de aceptación:**
  - «Your full name *»;
  - «Sign here (optional)», un lienzo con botón Clear;
  - la casilla «I accept this quote and authorise the described treatment»;
  - Confirm acceptance.
  - **La firma dibujada es opcional.**
  - También está la opción «Not interested».
- **Evidencia interna («Ver firma»):** firmado por, fecha y hora, método («Firma manuscrita»), relación («Paciente») y **hash SHA-256 del PDF**, con «Descargar PDF firmado». **No muestra IP ni dispositivo.**
- La Auditoría registró «El paciente (por el enlace) · Presupuesto aceptado · RD$ 130,50».
- El presupuesto pasó a «Aceptado» con «Reenviar», y el plan a «En curso».

**Plan de pago (cuotas) [P]**
- Campos:
  - Paciente;
  - Monto total;
  - Anticipo;
  - Moneda;
  - Cantidad de cuotas (1–60);
  - Frecuencia (Mensual; la web anuncia también semanal y quincenal [A]);
  - Fecha de la primera cuota;
  - Notas.
- Muestra una vista previa: «4 cuotas de RD$ 25,00 (mensual) + anticipo de RD$ 30,50 · Total financiado RD$ 100,00 sobre RD$ 130,50».
- Detalle: una tabla con número, vencimiento, esperado, pagado, estado y el botón «Pagar» por cuota. Estados del plan: Activo / Completado / En mora / Cancelado.
- **El plan no queda enlazado al presupuesto**: se crea con un monto libre.
- **El anticipo desaparece**: no es una fila y no cuenta como pendiente («Pendiente RD$ 100,00»).
- **No hay interés ni recargo por mora.**
- Configuración relacionada [V]: validez del presupuesto (7–180 días) y auto-cierre del plan tras N días caducado (7–180).

---

## 9. API (solo la página pública) [A]

- **Autenticación:** cabecera `X-API-TOKEN` con prefijo `PDT_`.
  - Una llave por herramienta y por clínica, con **7 permisos de lectura o acción**.
  - Cada llave tiene límite por minuto, caducidad opcional, «último uso» visible y revocación inmediata.
- **Endpoints que muestra** (dice que hay «+12 más»):

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/integrations/public/availability` | huecos libres reales (horario de la clínica y del profesional, módulos libres de la sede, citas ya agendadas, en la hora de la clínica) |
| POST | `/api/v1/integrations/public/bookings` | reserva en un paso: busca al paciente por teléfono o lo crea; el segundo que pide la misma hora recibe «ocupado»; **Idempotency-Key** |
| GET | `/api/v1/integrations/public/patients` | «¿ya es paciente?» por teléfono, correo o cédula, normalizando guiones, espacios y el +1 |
| POST | `/api/v1/patients` | alta de paciente |
| GET / PUT | `/api/v1/agenda/appointments`, `/{id}` | listar y modificar citas |
| GET | `/api/v1/branches` | sucursales |
| POST | `/api/v1/recalls` | crear rellamadas |

- **Webhooks:**
  - eventos: cita agendada, cancelada, completada y no asistida; paciente nuevo; presupuesto enviado, aceptado y rechazado;
  - **firmados con HMAC-SHA256**, con reintentos, registro de cada envío y botón de prueba.
- La guía de cada permiso se puede descargar en Markdown.

---

## 10. Otras cosas valiosas que a nosotros nos faltan

1. **Compras con recepción parcial y rechazo con motivo**, la reposición sugerida («bajo mínimo menos lo ya pedido» → una orden por proveedor) y una **valoración del proveedor** calculada (% a tiempo y % rechazado).
2. **Cola de radiografías del sensor** con aprobación y vínculo automático entre el código del sensor y el paciente.
3. **Bandeja del plan de tratamiento por etapa** («Esperando paciente», «Sin cita», «Sin próxima cita», con días en estado y «Marcar contactado»). Convierte los planes en una lista de trabajo para recepción.
4. **Rellamadas que se sugieren al completar un tratamiento**, según su categoría.
5. **Mensajes después de la cita**: reseña a los 3 días y control post-operatorio a los 7 días, solo para tratamientos marcados.
6. **Plantillas de receta** y de notas clínicas con un clic.
7. **Firma con hash del PDF**, más versiones del presupuesto.
8. **Precio por número de superficies** en las restauraciones.

---

## Tabla resumen de fallos observados

| # | Área | Fallo | Gravedad para nosotros |
|---|---|---|---|
| 1 | Presupuesto | Un descuento del 150 % deja el total negativo, sin aviso y sin auditoría | Alta (dinero) |
| 2 | Agenda | El arrastre crea solapes sin aviso y se salta el aviso de fuera de horario | Alta |
| 3 | Perio | Los índices dividen entre 192 sitios aunque solo se midieran 18 → % y CAL subestimados; CAL cambia al cerrar | Alta (clínica) |
| 4 | Perio | Sin avance automático; las flechas cambian valores (se guardó un 0 no deseado); «564» aceptado en un campo de máximo 15 | Media |
| 5 | Perio | No hay supuración, no se marcan ausentes, no hay comparación entre sesiones | Media |
| 6 | Inventario | Stock del ítem distinto de la suma de lotes; ajuste que no toca el lote; ítems de la demo en 0 sin alerta | Alta |
| 7 | Inventario | Ítems sin lotes ocultos en la vista de sucursal; SKU duplicable; validaciones sin mensaje | Media |
| 8 | Auditoría | No registra inventario, compras, perio, planes, cambios de descuento ni planes de pago | Alta |
| 9 | Finanzas | Informe «Total cobrado 0» con cobros «a cuenta» en el período; no hay apertura ni cierre de caja | Media |
| 10 | Público | La página del presupuesto sale en inglés en una clínica hispanohablante | Media |
| 11 | Cuotas | El plan no se enlaza al presupuesto y el anticipo no queda registrado | Media |
| 12 | Permisos | Por defecto, recepción edita datos médicos; no hay permisos por acción ni por sucursal | Media |

---

## Capturas (carpeta `docs/research/capturas/`)

| Archivo | Qué muestra |
|---|---|
| paneldental2-01-inventario-resumen.jpg | Resumen del inventario: indicadores y estado sin alertas |
| paneldental2-02-inventario-lotes.jpg | Lotes de la demo con restante, inicial, vencimiento («en 59d») y costo |
| paneldental2-03-inventario-nuevo-movimiento.jpg | Diálogo «Nuevo movimiento» (consumo FEFO, lote opcional) |
| paneldental2-04-inventario-movimientos.jpg | Movimientos: compra, salida y entrada de la transferencia, consumo y ajuste del ítem de prueba |
| paneldental2-05-compras-orden-recibida-en-parte.jpg | OC-2026-0001 «Recibida en parte»: pedido, recibido, rechazado y pendiente, y la entrega registrada |
| paneldental2-06-compras-registrar-llegada.jpg | Recepción: factura o conduce, llegó bien, rechazado con motivo, lote y vencimiento |
| paneldental2-07-perio-borrador-datos.jpg | Periodontograma en borrador con datos, gráfico y círculos de colores; se ve la línea que cruza dientes sin medir |
| paneldental2-08-perio-sesion-cerrada.jpg | Sesión cerrada en solo lectura, con «Historial temporal» |
| paneldental2-09-caja-nueva-cuenta.jpg | Nueva cuenta de caja o banco, con los métodos de cobro que entran en ella |
| paneldental2-10-informe-facturacion.jpg | Informe de facturación (abril y mayo): huecos de numeración, «IVA 18 %», CSV |
| paneldental2-11-whatsapp-nuevo-intervalo.jpg | Diálogo «Nuevo intervalo»: tiempo y unidad, canal, QR o Cloud API, variables (cancelado sin guardar) |
| paneldental2-12-permisos-recepcionista.jpg | Matriz de permisos del rol Recepcionista |
| paneldental2-13-agenda-aviso-fuera-horario.jpg | Aviso «Fuera del horario configurado… ¿Crear de todos modos?» |
| paneldental2-14-agenda-dia-solape-tras-arrastre.jpg | Vista Día: horas fuera de horario rayadas; la cita de prueba antes del arrastre que la solapó |
| paneldental2-15-historial-medico.jpg | Historial médico: alergias con gravedad, condiciones especiales, estilo de vida |
| paneldental2-16-plan-tratamiento.jpg | Plan con líneas (profesional por línea, reordenar, completar) y la barra de tratamientos |
| paneldental2-17-presupuesto-aceptado-descuento.jpg | Presupuesto aceptado con el 10 % de descuento global repartido por línea |
| paneldental2-18-presupuesto-publico-firma.jpg | Página pública (en inglés) con el diálogo «Accept and sign» |
| paneldental2-19-presupuesto-evidencia-firma.jpg | «Ver firma»: quién, cuándo, método y hash SHA-256 del PDF |
| paneldental2-20-plan-de-pago-cuotas.jpg | Plan de pago de 4 cuotas mensuales, sin fila para el anticipo |

---

## Requisitos sugeridos para nuestra plataforma

Son requisitos propios, pensados para una red de 5 sucursales en Bolivia (Bs, zona America/La_Paz, IVA 13 % y SIAT más adelante). No copian su interfaz: corrigen lo que allí falla y cubren lo que falta. **P1** = primer trimestre del piloto; **P2** = antes de vender el producto. Donde encaja, se cita el ítem del backlog.

### Periodontograma (B-011)

**P1**
- **PE-01:** Captura **pensada para el teclado y el pedal**:
  - un dígito llena el sitio y salta solo al siguiente, siguiendo un orden de sondaje configurable (por ejemplo, 18→28 vestibular y vuelta por palatino);
  - las flechas mueven el foco y nunca cambian el valor;
  - un atajo marca sangrado o supuración en el sitio activo;
  - campos de al menos 32 px de ancho, pensados para tabletas.
- **PE-02:** Por sitio: sondaje (0–15), **recesión o margen con una convención de signo explícita y visible**, sangrado, **supuración** y placa. Por diente: movilidad (0–3), furca por entrada (0–III), implante, **ausente** y pronóstico. Los ausentes y los implantes se toman del odontograma y se pueden cambiar.
- **PE-03:** Fuera de rango, el sistema **rechaza el valor y lo dice** junto al campo («máximo 15 mm»). Nunca lo trunca ni lo descarta en silencio.
- **PE-04:** Índices **sobre los sitios medidos de los dientes presentes**, mostrando el denominador:
  - % de sangrado, % de placa y CAL medio (con CAL = sondaje + recesión);
  - número de **sitios** y de **dientes** con bolsa de 4 o más y de 6 o más mm, con la etiqueta exacta;
  - el mismo cálculo en el borrador y al cerrar.
- **PE-05:** Estados borrador → cerrado (instantánea inmutable). Antes de cerrar se guardan todos los cambios pendientes; si alguno falla, el cierre se bloquea. Para corregir se añade una enmienda, sin borrar nada. Abrir, cerrar y descartar queda en la auditoría.

**P2**
- **PE-06:** **Comparación entre dos exploraciones** elegidas por fecha y hora:
  - diferencia por sitio con colores (mejoró, empeoró, sin cambio);
  - diferencias de los índices;
  - un informe en PDF para el paciente.
- **PE-07:** Una nueva exploración puede partir de la anterior: copia movilidad, implantes y ausentes, pero no los sondajes.
- **PE-08:** Gráfico que corta la línea en los dientes no medidos o ausentes.

### Inventario y compras (B-013, B-024)

**P1**
- **IN-01:** **Invariante** de stock: el stock de un ítem en una sucursal es siempre la suma de sus lotes. Cada movimiento afecta a un lote (o a un lote «sin lote» cuando el ítem no se maneja por lotes). Lo comprueba una prueba automática.
- **IN-02:** Catálogo único de insumos para toda la red, con SKU **único** por empresa, umbrales mínimos **por sucursal** y **conversión de unidades**: se compra en «caja de 100» y se consume en «unidad».
- **IN-03:** Tipos de movimiento:
  - entrada por compra;
  - consumo (FEFO automático o con lote elegido);
  - **ajuste positivo o negativo con motivo obligatorio** (conteo, rotura, vencimiento);
  - **transferencia en dos pasos** (enviada → recibida por la sucursal destino, con diferencias registradas).
- **IN-04:** **Conteo físico** por sucursal: se genera una hoja, se carga lo contado y el sistema propone los ajustes de diferencia para aprobarlos.
- **IN-05:** Consumo estándar por prestación (cantidad por diente o por superficie). Al marcar la prestación como realizada se descuenta en la sucursal de la cita. Si falta stock, se registra igual y queda una alerta. Hay un informe de consumo real frente al estándar.
- **IN-06:** Alertas por sucursal (bajo mínimo, vence en 30, 60 o 90 días, vencido) visibles **solo en la sucursal que corresponde** y consolidadas para el dueño. Errores de validación siempre junto al campo.

**P2**
- **IN-07:** Orden de compra borrador → enviada → recibida en parte o recibida → cerrada, con recepción por lote y vencimiento y **rechazo con motivo**. Lo recibido genera el lote y el costo. Hay una sugerencia de reposición que descuenta lo ya pedido.
- **IN-08:** Costo valorizado por lote; costo de materiales por prestación, que alimenta la rentabilidad. Indicadores de proveedor (% a tiempo y % rechazado).
- **IN-09:** Todo movimiento de inventario y de compras queda en la auditoría inmutable.

### Finanzas, caja y honorarios (B-014, B-017, B-021)

**P1**
- **FI-01:** **Sesión de caja por sucursal y por cajero:**
  - apertura con fondo inicial;
  - los cobros en efectivo quedan dentro de la sesión;
  - **cierre con arqueo por billetes y monedas en Bs**: el sistema calcula la diferencia contra lo esperado y exige un motivo si no es cero;
  - una sesión cerrada no se puede editar;
  - una nueva sesión no se abre si hay otra pendiente.
- **FI-02:** Métodos de cobro configurables (efectivo, QR Simple, transferencia, tarjeta, seguro u otro), cada uno con su cuenta de destino. Un cobro siempre se aplica a una deuda o queda como «saldo a favor» visible. Los informes de cobro **cuentan todos los cobros** e indican cuánto falta aplicar.
- **FI-03:** **Liquidación de honorarios por profesional:**
  - regla por profesional y por categoría de prestación: % o monto fijo, base **producción** o **cobro efectivo**;
  - se pueden descontar el costo de laboratorio y de materiales;
  - períodos que se **cierran y quedan inmutables** (los ajustes posteriores van al período siguiente);
  - exportación a Excel y PDF por profesional.
- **FI-04:** **Estado de resultados por sucursal** (ingresos cobrados y producidos, gastos por categoría, honorarios, margen) en columnas lado a lado, más el consolidado; comparación con el período anterior.

**P2**
- **FI-05:** Gastos por sucursal o compartidos, con reparto entre sucursales por porcentaje; adjunto del comprobante; cuenta de origen.
- **FI-06:** Conciliación de cuentas bancarias contra un extracto (ver B-021).

### Automatizaciones y WhatsApp (B-010)

**P1**
- **WA-01:** **Modo de pruebas obligatorio fuera de producción**: los mensajes se guardan en un simulador interno y no salen nunca. Lista blanca de números de prueba.
- **WA-02:** Reglas de envío relativas a la cita (al crear, N días u horas antes), en hora de America/La_Paz, con **horario de silencio** y **sin duplicados**: una reprogramación anula los avisos pendientes de la hora anterior.
- **WA-03:** Plantillas con variables validadas **antes de guardar** (variable desconocida = error), vista previa con datos ficticios y versión de cada plantilla.
- **WA-04:** Botones **Confirmar / Reprogramar / Cancelar**. La respuesta cambia el estado de la cita y queda en su historial. Las respuestas que no se entienden van a una bandeja de recepción.
- **WA-05:** No se envía nada sin un consentimiento vigente para esa finalidad (recordatorios o marketing). Una **baja** con una palabra clave o un botón queda registrada y bloquea los envíos siguientes de esa finalidad.
- **WA-06:** Pantalla de entregas: estado por mensaje (en cola, enviado, entregado, leído, falló con motivo), reintento manual y filtros por sucursal.

**P2**
- **WA-07:** Rellamadas por regla (por ejemplo, higiene cada 6 meses desde la última profilaxis), con una lista de trabajo, conversión medida (rellamada → cita) y envío automático opcional.
- **WA-08:** Mensajes después de la cita, configurables por prestación (control post-operatorio, encuesta).

### Roles y permisos

**P1**
- **RP-01:** Permisos por **acción**, además de por pantalla:
  - aplicar un descuento mayor que el umbral del rol;
  - anular un cobro;
  - cerrar la caja;
  - cerrar una exploración clínica;
  - exportar datos;
  - ver los datos médicos.
- **RP-02:** Alcance **por sucursal** en cada asignación de usuario.
- **RP-03:** Valores por defecto con el mínimo de acceso necesario: recepción no edita datos médicos ni notas clínicas.
- **RP-04:** Los cambios de permisos quedan auditados y se aplican al instante, sin esperar a que la persona recargue.

### Agenda (B-015)

**P1**
- **AG-01:** **Una sola regla de conflictos** para el formulario, el arrastre, la API y la reserva en línea:
  - mismo profesional, mismo sillón, mismo paciente y fuera de horario;
  - se bloquea, o se pide **motivo y permiso** para forzar;
  - lo forzado queda auditado.
- **AG-02:** Vistas de semana, de mes, de **recursos (sillones como columnas, con varias sucursales a la vez)** y de lista. Color por estado y una marca por tipo de prestación.
- **AG-03:** Cancelar y reprogramar exige un motivo de una lista. Mover una cita con avisos ya enviados pide confirmación y reprograma los avisos.

**P2**
- **AG-04:** Citas **recurrentes** (controles de ortodoncia), con edición de una cita o de toda la serie.
- **AG-05:** **Lista de espera** (ya tenemos `waitlist_entries`) que propone candidatos cuando se libera un hueco.

### Historia clínica (B-012, B-016)

**P1**
- **HC-01:** Anamnesis estructurada:
  - alergias con gravedad y reacción;
  - medicación con dosis;
  - enfermedades con estado;
  - banderas como anticoagulantes, embarazo o reacción a la anestesia, que salen como **aviso fijo** en la ficha y en la cita.
- **HC-02:** Notas de evolución con plantillas que tienen **campos obligatorios** configurables. La nota se firma y queda bloqueada; las correcciones se hacen como **adenda**.
- **HC-03:** Recetas con plantillas y con los datos del profesional (matrícula), en PDF. Quedan registradas en la historia.

**P2**
- **HC-04:** Documentos (certificado, derivación, solicitud de estudios) con plantillas; galería por categoría; importación desde el sensor de radiografías con aprobación.

### Plan de tratamiento y presupuesto (B-004, B-023)

**P1**
- **PT-01:** Plan con **fases ordenadas** (por ejemplo, urgencia → higiene y periodoncia → restauración → prótesis), profesional por línea y precio por superficie o por pieza. Se avisa si la misma prestación se repite en el mismo diente y superficie.
- **PT-02:** Descuentos por línea y global con **validación**:
  - entre 0 y 100 % y nunca mayor que el subtotal;
  - por encima del umbral del rol, hace falta aprobación;
  - cada cambio queda en la auditoría con el valor anterior.
- **PT-03:** El presupuesto tiene versiones. Al enviarlo se congelan los precios. **Al aceptarlo se guarda la evidencia**: nombre, fecha y hora, IP o dispositivo, versión y hash del PDF, y el consentimiento informado (B-004). **La página pública sale en el idioma de la clínica**, con verificación por un dato o un código.
- **PT-04:** Un **plan de cuotas ligado al presupuesto aceptado**, con el anticipo como primera fila, cuotas con vencimiento, estado «en mora» automático y cobro por cuota que actualiza el saldo del presupuesto.

**P2**
- **PT-05:** Las líneas aceptadas se convierten en citas propuestas, con la duración sugerida del catálogo. Hay una bandeja de planes por etapa («aceptado sin cita», «sin próxima cita», días en estado).
- **PT-06:** Sesiones cobrables para prestaciones largas: la endodoncia o la corona se reparten en varias citas con cobro parcial.

### API e integraciones (P2)

- **API-01:** Llaves por clínica con permisos de lectura o acción, límite por minuto, caducidad, último uso y revocación.
- **API-02:** Disponibilidad y reserva **con la misma regla de conflictos (AG-01)**, Idempotency-Key y búsqueda de paciente por teléfono o CI normalizados.
- **API-03:** Webhooks firmados con HMAC para cita, paciente, presupuesto y cobro, con reintentos y un registro de entregas.

### Auditoría (transversal, P1)

- **AU-01:** Toda acción que cambia dinero, stock o datos clínicos queda en el registro inmutable con el valor anterior y el nuevo:
  - descuentos, cobros y cuotas;
  - movimientos de inventario y compras;
  - cierre de exploraciones;
  - planes y presupuestos.

  Es exactamente lo que en Panel Dental no se registra.
