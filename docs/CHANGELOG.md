# Cambios (CHANGELOG)

Formato: fecha · versión publicada (PR) · qué cambió para cada persona. Lo nuevo va arriba.
"Sin publicar" = listo en una rama, esperando el OK del dueño.

## 2026-11-11 · #30 Cuentas de alquiler: todas "Cuenta completa"
- **Dueño:** las 123 cuentas de alquiler (Disney con y sin ESPN, Prime, HBO) quedaron con **un solo perfil llamado "Cuenta completa"**. Se renombraron 54 perfiles ("pack", "Pack 15", "Perfil 1", "ENLAZAR"…) y se retiraron 28 perfiles libres que sobraban, que inflaban el stock. Las 21 notas viejas del Excel quedaron guardadas en Control como "Excel: …".
- **Revendedores:** no reciben ningún aviso por esto: renombrar el perfil de una cuenta completa ya no manda "cambió tu acceso", porque el acceso no cambia. Cambiar el PIN sí sigue avisando.

## 2026-11-11 · #29 Cobro de alquileres
- **Dueño:** "💰 Cobrar alquileres de la semana" en Revendedores: por revendedor, lo que le vence en 7 días (o ya venció) con el total a su precio, y un solo WhatsApp con la lista y cómo renovar; fila guiada que marca a quién ya avisaste.
- **Revendedor:** en Repartir perfiles, "🔄 Renovar cuenta" en cada alquiler y "Renovar las N que vencen" con su saldo (con candado 🔒 cuando la tienda debe renovar primero).

## 2026-11-11 · #28 Invitar a todos y Pegar mi lista
- **Dueño:** "📲 Invitar a tus revendedores": fila guiada que genera el PIN y deja listo el WhatsApp de cada uno (con el link a /hub y cómo usar Repartir perfiles). Por defecto solo a quienes no tienen PIN; a los que ya lo tienen no se les cambia. El panel ahora sabe quién tiene PIN y cuándo entró por última vez.
- **Revendedor:** "📋 Pegar mi lista" en cada cuenta alquilada: pega su lista de WhatsApp o cuaderno (nombre, perfil, número con o sin +591, fecha "15/12" o "3 de enero", precio "Bs15"/"15bs", "debe"/"no pagó") y la revisa antes de guardar. Pegar la misma lista dos veces no duplica.

## 2026-11-11 · #27 Repartir perfiles
- **Revendedor:** nueva pestaña "🧩 Repartir perfiles": en cada cuenta completa que alquila anota quién está en cada perfil (nombre, WhatsApp, vencimiento, precio, si pagó), avisa por WhatsApp, renueva +30 días y ve si le cubre lo que le cuesta la cuenta. Se suma a Avisar, Quién me debe, Mis ganancias, Tu día y al aviso diario al celular.
- **Privacidad:** el dueño no ve estos datos (ni en pantallas ni en respuestas de la API).

## 2026-11-11 · #26 Pulido 2
- **Revendedor:** Mis cuentas con correo y contraseña plegados (la lista entra en pocas pantallas); en Mi página la vista previa ya no tapa lo que editás (botón "👀 Ver cómo queda") y se puede **deshacer** una plantilla o combinación.
- **Dueño:** botón "✅ Liberar N en cuarentena" en cada cuenta.

## 2026-11-11 · #25 Revendedores ven solo lo de revendedores
- **Dueño:** ajuste "Qué compran tus revendedores". Activado en la tienda real con 4 alquileres: Disney + ESPN (Bs 69), Disney sin ESPN (Bs 34), Prime Video cuenta completa (Bs 20) y HBO Max cuenta completa (Bs 15), todos de 30 días.

## 2026-11-11 · #24 Pulido GaboHub · ver docs/INFORME_PRUEBAS.md
- **Seguridad:** cerrado el ingreso a cuentas ajenas por correo; correos únicos; Atención sin costos ni proveedores, sin alargar fechas gratis ni aprobar revendedores.
- **Dueño:** números reales en Dashboard/Control/Inicio (precio que paga el revendedor), Finanzas con costo de cuentas estimado, Proveedores en 30 días, "Tu mes" en Inicio, avisos de precio de revendedor y de pérdida, revendedores dormidos, PIN y saldo con confirmación, auditoría en palabras.
- **Atención:** "📲 Reenviar accesos" y respuesta lista para "no me entra", búsqueda por número con espacios/+591, sin pantallas que fallan por permisos.
- **Revendedor:** "Tu día", +591 automático, Mi control en filas compactas con candado cuando la tienda debe renovar, fiado sincronizado, ganancias "vendiste/cobraste", vender fiado, combos ordenados, afiche sin agotados, movimientos de saldo legibles, barra con Clientes.
- **Cliente:** Atrás dentro de la tienda, pago solo con métodos que existen, "Tu pedido en vivo", copiar datos, acceso con número y PIN, asesor sin agotados, tienda 3,4× más liviana (gzip).

## 2026-11-10 · #23 Dominio propio
- **Todos:** gabostore.lat muestra la tienda; GaboHub en /hub; www → dominio principal; links de acceso, guías y avisos apuntan a /hub.

## 2026-11-10 · #22 Herramientas de revendedores
- **Revendedor:** Mi control (tipo Excel), Quién me debe (fiado propio), Avisar a los que vencen, Mis ganancias, QR propio en su página, renovar varios, reportar falla, avisos al celular, afiches, link de códigos, instalar como app, 6 páginas listas y 595 combinaciones.
- **Dueño/atención:** pantalla "Fallas reportadas".

## 2026-11-10 · #14–#21 Panel tipo Excel y tienda
- **Dueño:** Control de alquileres como Excel (ordenar, filtros, totales, agrupar, editar en línea), fiado, ficha del revendedor, acceso del asistente, importar con Tipo y Precio, fechas de Bolivia.
- **Cliente:** tienda tipo ticket, SEO, términos con horario, comparador de combos, combos por QR, portada con logo.

## 2026-11-10 · #5–#13 Base de la plataforma
- Celular, seguridad del navegador (CSP), cupones, avisos al celular, cobro por país, oficina virtual con Claude, ganancia real, cupones de revendedores, portada GaboHub.
