# Informe de pruebas

## Tanda 11/11/2026 · Cobro de alquileres (#29) y cuentas completas (#30)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` en la rama `ccr-a0b95638-dpfc8j` (igual a producción + método de trabajo) | **314 / 314 ✅** en ~11 s |
| Renombrar perfil de cuenta completa no avisa | prueba en `test/store.test.mjs`; cambiar el PIN sí avisa | ✅ |
| Arreglo en la tienda real | respaldo previo → 1 perfil de prueba (cola de avisos 33 → 33) → todos | 54 renombrados, 28 retirados, 21 notas guardadas, 0 problemas |
| Verificación después | lectura del panel con la llave del asistente | 123 cuentas de alquiler con 1 perfil "Cuenta completa"; servicios activos 91 → 91; cola de avisos 33 → 33 |

**No se probó:** que los revendedores vean el nombre nuevo en su celular (se verificó por la API, no con su sesión).

# Informe de pruebas — Pulido GaboHub (11/11/2026)

Rama: `pulido-fix` (sin publicar). Todo con **datos ficticios** en copias locales; nada contra producción, sin pagos ni mensajes reales.

## 1. Cómo se probó
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` (node:test, 309 pruebas: núcleo, servidor, seguridad, permisos, números) | **309 / 309 ✅** |
| Recorrido en celular (390×844) | Playwright, 43 pantallas: 12 del dueño, 12 de Atención, 13 del revendedor, 6 del cliente | **0 errores de consola · 0 desbordes · 0 rechazos de permiso** |
| Aislamiento entre revendedores | Ariana pide sus datos (control, clientes, fiado, servicios, fallas, ganancias) y se busca algo de Bruno o costos del proveedor | **No aparece nada ajeno ✅** |
| Auditoría de seguridad | 120+ intentos cruzados Ariana↔Bruno + barrido de ids secuenciales 1..1300 (cus_, asg_, ord_, fia_, tik_) | **0 accesos ajenos ✅** (scripts en `pulido/seguridad/scripts`) |
| Peso de la tienda | `curl` con y sin gzip | shop.js **227 KB → 66 KB**; repetida con ETag → **304** (no se vuelve a bajar) |

## 2. Lo que se arregló, con su prueba
### 🔒 Seguridad
| Hallazgo | Prueba |
|---|---|
| **CRÍTICO:** registrarse con el correo de otra cuenta abría esa cuenta | `test/pulido-seguridad.test.mjs` "registrarse con el correo de una cuenta existente NO abre su sesión" |
| Dos clientes con el mismo correo | idem "no se puede crear un cliente con un correo que ya es de otro" |
| Atención veía costo de cuentas y proveedores; podía cambiar el costo | idem "Atención (seller) no ve costo…" (+ 403 al cambiar costo) |
| Atención podía alargar fechas sin cobrar, aprobar revendedores, dar PIN a revendedores | `test/pulido-panel.test.mjs` (permisos) |

### 👔 Dueño (números)
| Hallazgo | Antes → Después | Prueba |
|---|---|---|
| "Vas a cobrar" con precio público | Bs 1.382 → **Bs 975** (= suma de las Fichas: Ariana 908 + Bruno 67) | `pulido-panel.test.mjs` |
| "Te quedó" sin costo de cuentas | Bs 992 → **Bs −1.988 (estimado)** con aviso "56 cuentas sin anotar" | idem |
| Proveedores mezclaba períodos | Ingreso 1.301 (toda la historia) → **1.005 (30 días = Dashboard)** | idem |
| "Vencen en 7 días" distinto por pantalla | 6 / 7 → **6 en todas** | idem |
| Cobrar a clientes de revendedores con precio público | → "🏪 de Ariana" + "📣 Avisar a Ariana" | navegador |
| PIN nuevo sin confirmar / saldo con prompt | → confirmación + saldo antes→después | navegador (`panel-fix/shots/flow-*`) |
| Sin aviso si falta precio de revendedor o se pierde plata | → avisos en Notificaciones y en la carga masiva | `pulido-panel.test.mjs` |

### 🏪 Revendedor
| Hallazgo | Prueba |
|---|---|
| Número sin +591 → WhatsApp roto y clientes repetidos | `store.test.mjs` "No pagó → la libreta…" (+591, duplicado) + navegador (`wa.me/59170099111`) |
| Ganancias contaban lo no cobrado | `store.test.mjs` (vendiste 40, cobraste 0) |
| Quién me debe en Bs 0 mientras Mi control decía que le deben | `store.test.mjs` + navegador (No pagó → 25; Pagado → 0) |
| "Renovar" que fallaba por vencimiento del proveedor | navegador: 40 candados 🔒, 0 botones que fallan |
| Movimientos de saldo con códigos | `store.test.mjs` ("Netflix perfil para Rodrigo Paz") |
| Mi control interminable | navegador: 16.283 → **5.529 px** con 41 servicios |

### 🛒 Cliente
| Hallazgo | Prueba |
|---|---|
| Atrás sacaba de la tienda | navegador: Atrás cierra el carrito, el 2º Atrás vuelve a Inicio de la tienda |
| QR ofrecido sin QR / sin salida para pagar | `paymethods.test.mjs` + navegador (aviso y botón desactivado) |
| Acceso abría en correo | navegador (abre en número + PIN, "Olvidé mi PIN") |
| Asesor recomendaba agotados | navegador |

## 3. Lo que NO se probó (y por qué)
- **Producción:** no se tocó; se prueba al publicar con tu OK (salud del servidor + recorrido rápido).
- **Avisos al celular reales:** el envío se prueba con un servicio falso (`push.test.mjs`); no se mandó ninguna notificación real.
- **iPhone real:** se emuló Chromium móvil; instalar como app en iPhone depende de Safari.

## 4. Pendientes conocidos
Ver `docs/BACKLOG.md` (estado ⏳): Mis cuentas del revendedor largo, vista previa de Mi página en celular, primer precio lejos en el diseño "clásico", reubicar para Atención, liberar cuarentena por cuenta, "lo que te paga vs lo que cobra" el revendedor.
