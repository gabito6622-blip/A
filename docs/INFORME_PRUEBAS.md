# Informe de pruebas

## 14/11/2026 · GaboHub simple (rama `hub-simple`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Uso real (solo lectura): 25 revendedores, 22 con cuentas, 9 con PIN, 2 entraron alguna vez, 1 anotó clientes, 0 compras desde el panel en 30 días | API con la llave del asistente | anotado |
| Inicio 360 px: 4 botones grandes en orden, «2 cuentas» por renovar, WhatsApp de la tienda, botones ≥ 44 px, sin scroll de costado; herramientas plegadas (PIN y Mi control no se ven hasta abrir) | `test/hub-inicio-simple.test.mjs`, Playwright, datos ficticios | pasa |
| «💳 Renovar» abre Mis cuentas con el filtro «Vencidas» | ídem | pasa |
| Dueño: «🔗 Link para entrar» arma el link `/hub#acceso=…` y el WhatsApp «Tocá acá y entrás directo»; el link deja adentro en otro navegador y el PIN de antes sigue sirviendo | ídem | pasa |
| Paraguay y Panamá siguen viendo su moneda arriba; Bolivia la ve en «Todas mis herramientas» | `test/afuera-completo.test.mjs` (ajustada) | pasa |
| Capturas antes/después (390 px, datos de ejemplo): alto del inicio 3.025 px → 1.243 px | Playwright | revisadas |
| Suite completa | `npm test` | **603 pasan, 0 fallan, 68 s** |

## 14/11/2026 · GaboHub: «Cerrar sesión» en «Más» (publicado el 14/11, PR #63)
| Qué | Cómo | Resultado |
|---|---|---|
| Revendedor en 360 px: «Más» muestra «🚪 Cerrar sesión» (≥ 44 px), el buscador lo encuentra con «salir», al tocarlo avisa «Cerraste sesión» y `/api/me` ya no tiene sesión | `test/hub-cerrar-sesion.test.mjs`, Playwright, datos ficticios | pasa |
| Suite completa | `npm test` | **602 pasan, 0 fallan, 64 s** |

## 14/11/2026 · Direcciones con mayúsculas (publicado el 14/11, PR #62)
| Qué | Cómo | Resultado |
|---|---|---|
| Causa: foto del dueño con `gabostore.lat/PANEL` mostrando la portada de GaboHub | lectura del enrutado: solo `/panel` | confirmado |
| `/PANEL`, `/Panel`, `/HUB`, `/Tienda/`, `/R/MauMau`, `/Codigos?x=1` → 301 a minúsculas; `/panel` responde el panel | `test/dominio.test.mjs` | pasa |
| `/c/AbC123xyz`, `/Shop.js`, `/api/Settings` no se redirigen | ídem | pasa |
| Suite completa | `npm test` | **601 pasan, 0 fallan, 71 s** |

## 13/11/2026 · Sin destello azul (publicado el 13/11, PR #61)
| Qué | Cómo | Resultado |
|---|---|---|
| Causa (solo lectura): la tienda real usa `#fcc42d` sobre `#070b16`; el HTML arrancaba con `#3984ff` (azul de fábrica) | `curl /api/settings` + lectura de `base.css` | confirmado |
| `/tienda/` y `/hub` traen `--s-blue:#fcc42d`, `--s-bg:#070b16`, barra del celular `#070b16` y `data-bg="glow" data-card="glass"`; ningún `#3984ff` | `test/sin-destello.test.mjs` | pasa |
| Página de revendedor con fondo blanco: sus colores, letras oscuras y `color-scheme:light`; sin el dorado de la tienda | ídem | pasa |
| Colores mal guardados no rompen la página (vuelven a los de fábrica) | ídem | pasa |
| Celular 360 px con la configuración colgada a propósito: el primer cuadro ya es dorado (logo y fondo) | ídem, Playwright | pasa |
| `panel.`/`admin.gabostore.lat` → `/panel`; `hub.` → `/hub` | `test/subdominios.test.mjs` | pasa |
| Suite completa | `npm test` | **593 pasan, 0 fallan, 58 s** (una corrida previa falló la prueba de elegir nombre porque escribía antes de que la pantalla terminara de dibujarse; ahora espera, 3 de 3 sola) |

## 13/11/2026 · Portada sin salto (publicado el 13/11, PR #61)
| Qué | Cómo | Resultado |
|---|---|---|
| Producción hoy (solo lectura): `gabostore.lat/` responde 302 a `/tienda/`; la tienda responde 200 | `curl` | confirmado (el servidor no muestra GaboHub; el salto es lo que se saca) |
| Cuadro por cuadro con navegador nuevo, datos de ejemplo, 360 px: ningún cuadro con GaboHub | Playwright, 37 capturas en 2,5 s | ninguno (lo que vio el dueño puede ser la página anterior que queda mientras salta, o algo guardado en su celular) |
| Portada 200 con `gs-mode=store`, sin `location`; `/hub` sin la marca | `test/dominio.test.mjs` | pasa |
| Celular 360 px: una sola navegación a `/`, es la tienda (barra de abajo y link «¿Sos revendedor?»), sin errores | ídem, Playwright | pasa |
| Suite completa | `npm test` | **587 pasan, 0 fallan, 56 s** |

## 13/11/2026 · Subdominios de revendedores (publicado el 13/11, PR #61)
| Qué | Cómo | Resultado |
|---|---|---|
| `daniel.gabostore.lat/` responde 200 con la página de Daniel, `<meta name="gs-shop">` y link de vista previa del subdominio; mayúsculas y `:443` no lo rompen | `test/subdominios.test.mjs` (host falso, datos ficticios) | pasa |
| `shop.js` y `/api/shops/daniel` desde el subdominio; la API pública no muestra costos | ídem | pasa |
| Subdominio desconocido, de página apagada, reservado (api, panel), con dos niveles o mal escrito → 302 a `https://gabostore.lat/` | ídem | pasa |
| Dominio principal, www y `/r/daniel` sin cambios; `test/dominio.test.mjs` sigue pasando | ídem | pasa |
| `shopDomain` solo con el interruptor y dominio propio (no con la dirección de Railway) | ídem | pasa |
| Celular 360 px: `daniel.gabostore.lat` abre «Daniel TV» con Netflix, sin errores, y la dirección queda en `/` | Playwright con el nombre apuntado a la máquina local | pasa |
| Suite completa | `npm test` | **586 pasan, 0 fallan, 57 s** |
| Celular 360 px: el revendedor abre Mi página, ve «lo que va antes de .gabostore.lat» y su link; escribe «Dani Strem» → queda `dani-strem` y el link cambia a `https://dani-strem.gabostore.lat`; letra ≥ 12 px, sin scroll de costado | `test/subdominios.test.mjs`, Playwright | pasa |
| Suite completa (con lo anterior y la portada sin salto) | `npm test` | **588 pasan, 0 fallan, 58 s** |
| No probado | El comodín real en Railway y Namecheap (falta crearlo) | pendiente |
## 13/11/2026 · Dominio gabostore.lat
| Qué | Cómo | Resultado |
|---|---|---|
| Registros DNS pedidos por Railway y estado de los certificados | API de Railway (solo lectura) | ambos dominios verificados, certificados VALID |
| Cambio de `GS_PUBLIC_ORIGIN` → `https://gabostore.lat` (respaldo del valor anterior fuera del repo) y redespliegue | API de Railway | despliegue SUCCESS en ~1 min |
| `gabostore.lat/` → 302 a `/tienda/` (título «Gabriel Store…»); `www.gabostore.lat/` → 301 a `gabostore.lat/`; `/hub` 200; `/api/health` 200; dirección de Railway sigue respondiendo | `curl` | OK |
| Datos antes y después, byte a byte: alquileres, clientes, revendedores, cuentas, finanzas | comparación de los JSON | **idéntico** |
| Link de renovación de prueba (Marcelo, no enviado) sale con `https://gabostore.lat/tienda/#renovar=…` | API | OK |

## 13/11/2026 · Atajos (publicado el 13/11, PR #61)
| Qué | Cómo | Resultado |
|---|---|---|
| «Ya le avisé»: sale de «por avisar» (4 → 2, 2 ya avisados al final); no cambia fecha ni pago; vale para ese vencimiento; a 2 días sigue marcado y el día antes vuelve a pedirse; al cambiar la fecha deja de contar; deshacer; un revendedor no puede marcar; a 360 px botón de 44 px | `test/secretaria-avise.test.mjs` (reglas + Playwright) | OK |
| Fila de envíos tras «Mover todos»: tarjeta «1 de 1» con correo y PIN nuevos, enlace wa.me del cliente, al tocarlo «¡Listo! … 1 de 1», Cerrar | `test/mover-cuenta-completa.test.mjs` | OK |
| «Cobrar» con link: tarjeta «Cobro listo», mensaje con correo, monto y «🔗 Renová vos mismo acá…» antes del cierre; el link creado abre la página pública de renovación (200) | `test/panel-reenviar-accesos.test.mjs` | OK |
| Resumen del mediodía: sin celular no hace nada; sin pendientes no avisa; 8:30 no, 12:30 sí («1 en cobro · 2 por avisar», abre secretaria, apodos); no repite en el día; lo ya avisado no cuenta; apagable; de noche no manda atrasado; el celular de Atención no lo recibe | `test/push-mediodia.test.mjs` (envío con doble, sin red) | OK |
| «Que vuelvan» del revendedor: solo los suyos que no renovaron (no quien volvió a comprar, no el que no venció); sin costos de la tienda, correos ni claves; otro revendedor no ve ni marca los de Ana; «Ya le escribí» 7 días y deshacer; ruta 401 sin sesión y 402 en plan Gratis | `test/revendedor-vuelvan-cierre.test.mjs`, `gabohub-tres-niveles` | OK |
| Cierre de mes del revendedor: nov Bs 115 vs oct Bs 110 (▲ +5 %), ganancia Bs 47 vs 42 (▲ +12 %), Kevin Bs 75 (debe Bs 30) y Ruthy Bs 40, app Netflix; primer mes incompleto y mes sin ventas: sin % | misma prueba (fórmulas + Playwright 360 px) | OK |
| Detalles: títulos «Revendedores / Notificaciones / Recordatorios» 124 px en caja de 128 px a 360 px; contraste del azul del panel sin fallas en Vender, Finanzas y Dashboard; `seguridad-plata` 12 de 12 | medición con Playwright, axe-core 4.10.2 | OK: 0 fallas de contraste en 13 pantallas (tienda incluida). El rótulo «EN VIVO» de Mi oficina sigue en una línea a propósito (es una marquesina) |
| Revisión de aislamiento (`/gabostore-aislamiento`) sobre los cambios | lectura del código + pruebas cruzadas | 1 hallazgo corregido: el resumen del mediodía iba a todos los celulares del staff; ahora solo dueño y admins |
| Suite completa | `npm test` | **584 pasan, 0 fallan, 61 s** |

## 13/11/2026 · «Mover todos a otra cuenta» (rama `mover-cuenta-completa`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Errores: misma cuenta 400; otra plataforma 400; destino con 2 libres para 3 clientes → 409 «2 perfil(es) libre(s) y hay que mover 3» y nadie se mueve | `test/mover-cuenta-completa.test.mjs` (API) | OK |
| 3 clientes de un Netflix caído (Perfil 1, 3 y 5, fechas distintas) a la cuenta nueva: fechas idénticas; Perfil 1 y 5 conservan su nombre; el 3 estaba ocupado y va a otro; un perfil apartado del destino también sirve; nota «↔️ …» delante de la nota anterior; viejos apartados; «Reenviar accesos» con correo y PIN nuevos | misma prueba | OK |
| Celular 360 px: la tarjeta de la cuenta ofrece solo destinos de Netflix con perfiles suficientes; al mover, confirma, pasa al Control filtrado por la cuenta nueva y el cliente quedó en el mismo nombre de perfil | misma prueba, Playwright | OK |
| Suite completa | `npm test` | **578 pasan, 0 fallan, 56 s** (una corrida previa marcó `seguridad-plata` por un «1777» dentro de una fecha-hora; sola pasa 2 de 2; anotado en el backlog) |

## 13/11/2026 · Publicación de «Cambiar de cuenta» (PR #59, squash `c0e7987`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, 149 cuentas, revendedores y finanzas | API con la llave del asistente | guardada |
| Rama de Railway vs #58: sin cambios; unión «ours» con árbol igual al probado; CI verde (2 trabajos) | `git diff --stat`, Actions | OK |
| Publicación: código nuevo en vivo a los ~40 s; salud, `/tienda/`, `/hub`, `/panel` 200; el `panel.js` servido trae «Cambiar de cuenta» | `curl` | OK |
| Datos después, byte a byte: alquileres, clientes, revendedores, cuentas y finanzas | comparación de los JSON antes/después | **idéntico** |

## 13/11/2026 · Cambio real pedido por el dueño: Dani strem de …+rclad a …+md1 (hecho a mano, antes de publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Respaldo de las dos cuentas y del alquiler (sin claves) | JSON fuera del repo | guardado |
| Clave de md1 cargada; perfil de md1 pasado a disponible; fecha de proveedor de md1 puesta 1 h adelante (para que el reemplazo automático la eligiera) y restaurada al instante; reemplazo del alquiler; nota del Control «↔️ 13/11/2026: de …rclad a …md1 (cuenta renovada, misma fecha)» | API con la llave del asistente, un solo registro | Dani strem en md1, vence 12/12/2026, pagado; rclad apartada; fecha de proveedor de md1 igual que antes |

## 13/11/2026 · «Cambiar de cuenta» (rama `cambiar-cuenta`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Errores: cuenta de otra plataforma 400 «otra plataforma»; perfil ocupado 409 «no está libre»; el mismo perfil 400 «ya tiene» | `test/cambiar-cuenta.test.mjs` (API) | OK |
| Cambio real a una cuenta apartada: correo nuevo, vencimiento idéntico (12/12/2026), nota «↔️ fecha: de vieja a nueva · nota anterior», perfil nuevo asignado, viejo apartado, «Reenviar accesos» con el correo nuevo y sin el viejo | misma prueba | OK |
| Celular 360 px: la tarjeta del Control muestra «↔️ Cambiar de cuenta» solo con cuentas libres de la misma plataforma (no la propia, no las ocupadas); al mover, el alquiler queda en la elegida con la misma fecha; sin desborde ni errores de JS | misma prueba, Playwright | OK |
| Suite completa | `npm test` | **577 pasan, 0 fallan, 58 s** |

## 13/11/2026 · Publicación: refresco de códigos + Reenviar accesos + Cobrar (PR #58, squash `576567c`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, 25 revendedores, finanzas del mes, cobro apagado | API con la llave del asistente | guardada |
| Rama de Railway vs #57: sin cambios; unión «ours» con árbol igual al probado; CI verde (2 trabajos) | `git diff --stat`, Actions | OK |
| Publicación: código nuevo en vivo a los ~40 s; salud, `/tienda/`, `/hub`, `/panel` 200; `shop.js`, `codigos-solos.js` y `panel.js` servidos traen los cambios | `curl` | OK |
| Datos después, byte a byte: alquileres, clientes, revendedores y finanzas | comparación de los JSON antes/después | **idéntico** |

## 13/11/2026 · «Reenviar accesos» y mensaje de «Cobrar» (rama `codigos-refresco`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Panel → Control a 360 px: «📲 Reenviar accesos» abre la tarjeta con fondo del tema (no transparente) y adentro de `.app`; cierra con ✕, con Escape y tocando afuera; «Copiar todo» copia el mensaje con el correo | `test/panel-reenviar-accesos.test.mjs`, Playwright | OK |
| «💰 Cobrar» de un alquiler de revendedor: «Hola Oby 👋 te recuerdo tu alquiler: / 📺 Disney Premium + ESPN / 📧 correo / 📅 Vence el dd/mm/aaaa (en 30 días) / 💰 Monto: Bs 69 / ¿Renovamos?…»; sin «Cuenta completa» como perfil | misma prueba | OK |
| Captura de la tarjeta corregida en oscuro | fuera del repo | enviada al dueño |
| Suite completa | `npm test` | **576 pasan, 0 fallan, 54 s** |

## 13/11/2026 · Refresco automático de códigos (rama `codigos-refresco`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Bandeja vacía → llega un código de Disney al correo de su cuenta → a los 10 s aparece «847 213» sin tocar nada; una sola consulta por tick; sin novedades no se redibuja | `test/codigos-refresco.test.mjs`, Playwright 360 px con reloj simulado | OK |
| «Ver códigos» abierto en Mis cuentas → llega un segundo código (Netflix, inicio de sesión) → aparece solo a los 10 s; quedan 2 | misma prueba | OK |
| Al volver al Inicio, 30 s sin ninguna consulta a `/api/me/codes`; sin errores de JS ni desborde | misma prueba | OK |
| Lector de códigos con correos de ejemplo de Disney («código de acceso único» 847 213), Max («código de verificación» 391 804) y Netflix (inicio de sesión 5521 y enlace de «actualizar tu Hogar») | semilla del revendedor + inyección por `codes.ingest` (sin correo real) | los 4 se guardan y clasifican bien; capturas de la bandeja y de «Ver códigos» fuera del repo |
| Pruebas relacionadas `codigos-solos` (9) y `hub-navegacion` (1); suite completa | `node --test` / `npm test` | **575 pasan, 0 fallan, 54 s** |

## 13/11/2026 · Publicación de los tres niveles de GaboHub (PR #57, squash `6a4ad6a`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, 25 revendedores, finanzas del mes, ajuste del cobro (apagado, Bs 49 / Básico Bs 28) | API con la llave del asistente, guardada fuera del repo | guardada |
| Rama de Railway vs lo fusionado en #56: sin cambios; unión «ours» con árbol igual al probado; CI verde en el commit de unión (2 trabajos) | `git diff --stat`, Actions | OK |
| Publicación: nuevo código en vivo a los ~50 s; salud, `/tienda/`, `/hub` y `/panel` 200; el `shop.js` y el `panel.js` servidos traen los tres planes | `curl` | OK |
| Datos después, byte a byte: alquileres, clientes y finanzas idénticos; ajuste del cobro idéntico; los 25 revendedores con el mismo id y la misma ficha, todos en Negocio (plan elegido y plan de hoy) | comparación de los JSON antes/después | **idéntico** |

## 13/11/2026 · GaboHub en tres niveles (rama `gabohub-tres-niveles`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Cobro apagado (como la tienda real): rige Negocio para todos; ninguna ruta devuelve 402; no se cobra nada; el `basicPrice` viejo se guarda como `sellerPrice`; `hubPlan` viejo "basic"/"full" se lee como Vendedor/Negocio | `test/gabohub-tres-niveles.test.mjs` (datos ficticios en carpeta temporal) | OK |
| Cobro prendido, plan Gratis: 40 días sin cobro ni pausa; servicios, pedidos, precios, catálogo WhatsApp y PDF 200; Mi día, Control, Quién me debe, Ganancias y Excel 402 `HUB_PLAN` «plan Negocio»; editar página y cupones 402 «plan Vendedor»; su página pública 404; «pagar» da error claro | misma prueba | OK |
| Pasar a Vendedor: se cobran Bs 28 en el momento y vence en 30 días; página editable y visible; Mi día y Excel siguen 402. Pasar a Negocio: sin cobro extra; Mi día 200; al mes siguiente cobra Bs 49. Vendedor más caro que Negocio: ajuste inválido; sin precio Vendedor no se puede elegir | misma prueba | OK |
| Sin pagar: tras 3 días de gracia rige Gratis (Control 402 `HUB_UNPAID` «hoy estás en Gratis … plan Negocio», catálogo 200, página 404; el panel ve plan Negocio / hoy Gratis). Elige Gratis: deja de deber y 60 días después sigue sin cobro. Quiere Negocio sin saldo: vence hoy, 4 días después vuelve a Gratis. Recarga y paga: Negocio al instante, saldo Bs 1 | misma prueba | OK |
| Celular 360 px: en Gratis, Mi día muestra el candado «plan Negocio», Bs 49, botones de 44 px, sin desborde; el Inicio dice «plan Gratis» con botones a Vendedor y Negocio; sin errores de JS | Playwright, capturas fuera del repo | OK |
| Pruebas viejas adaptadas: `gabohub-planes` (3), `exportaciones` (6: el catálogo sale aun pausado; el Excel 402), `suscripcion-gabohub` (2), `revendedor-mi-dia` (5), `link-cobro-clientes` (4) | `node --test` por archivo | OK |
| Suite completa | `npm test` | **574 pasan, 0 fallan, 63 s** (local, 13/11 10:10 UTC) |
| Demo de GaboHub con los nombres nuevos (`scripts/seed-gabohub-demo.mjs`): Beto en Vendedor pagando Bs 28, Carla en Negocio, Ana y Paula en prueba | correr la semilla en carpeta temporal; capturas del panel a 360 px | OK |

## 13/11/2026 · Publicación logos + catálogo público + Promos y combos (PR #56, squash `c01587c`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, cierre nov Bs 4.490,60 | API con la llave del asistente | guardada |
| Rama de Railway vs lo fusionado en #55: solo docs; unión «ours» con árbol igual al probado; CI verde en `f5a3380` | `git diff --stat` | OK |
| Publicación: nuevo código en vivo a los ~20 s. Después: salud, `/tienda/`, `/hub` 200; el `shop.js` servido trae el botón; `GET /api/catalogo.pdf` público 200 (5 páginas, 315 KB, 105 imágenes incrustadas, «PROMOS Y COMBOS», «ahorrás hasta Bs 34»); página de revendedor inexistente 404; 78 alquileres y 34 clientes idénticos byte a byte; cierre igual (Bs 4.490,60) | PR #56 · `curl` + pdfinfo/pdfimages/pdftotext + comparación JSON | OK |

## 13/11/2026 · Catálogo público + Promos y combos (publicado en #56)
| Qué | Cómo | Resultado |
|---|---|---|
| Ahorro calculado: Dúo Bs 70 vs 40 + 35 → Bs 5 en el JSON, en el WhatsApp «(ahorrás Bs 5)» y en el PDF «Ahorrás Bs 5» y «ahorrás hasta Bs 5»; Pack Familia de Ana con SUS precios 45 + 38 vs 75 → Bs 8 | `test/exportaciones.test.mjs` | OK |
| Público: `GET /api/catalogo.pdf` 200 sin sesión con el nombre del archivo de la tienda; segunda bajada idéntica (memoria); `GET /api/shops/ana-tv/catalogo.pdf` 200 con Ana TV y sin Gabriel Store; `/api/shops/no-existe/catalogo.pdf` 404 | misma prueba | OK |
| Navegador 360 px (demo): botón «📄 Catálogo en PDF» de 44 px en la portada de `/tienda` y en `/r/carla-streaming`; las dos descargas públicas responden 200 con su archivo | Playwright + fetch, fuera del repo | OK |
| Catálogo real con «Promos y combos»: 11 combos con ahorro, máximo Bs 34 | script fuera del repo | revisado |
| Tanda completa | `npm test` | **570/570** en 55 s (dos corridas previas bajo carga fallaron una prueba de navegador distinta cada vez, `tarjeta` y `hub-inventario`; las dos pasan solas; anotado M19) |

## 13/11/2026 · Catálogo PDF con logos (rama `exportaciones-premium`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Un PNG RGBA de 64×64 subido a Netflix por la API; el PDF premium lleva imágenes incrustadas en la página de productos (`pdfimages -list`); el JSON de la vista previa trae `hasImage` y no el archivo | `test/exportaciones.test.mjs` | OK |
| Catálogo REAL con los 35 logos de la tienda, armado localmente con el código nuevo a partir de lecturas públicas (catálogo, logos) y la llave del asistente (nombre, WhatsApp): premium 5 páginas / 315 KB, clásico 4 páginas / 307 KB; logos nítidos a 160 px; combos con los logos de sus apps | script fuera del repo + pdftoppm | revisado |
| Tanda completa | `npm test` | **570/570** |

## 13/11/2026 · Publicación Centro de exportaciones (PR #55, squash `fd0e410`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, cierre nov Bs 4.490,60 | API con la llave del asistente | guardada |
| CI del primer commit roja: la prueba del Excel pedía `openpyxl`, que la CI no tiene. Se corrigió la prueba (revisa el XML del ZIP y la portada con el lector propio; con openpyxl suma lo fino) y se quitó «Gabriel Store» de las propiedades del archivo (ahora «GaboHub»). CI verde en `e6cf127`; `npm test` local 570/570 | GitHub Actions + local | OK |
| Rama de Railway vs lo fusionado en #54: idéntico; unión «ours» con árbol igual al probado | `git diff --stat` vacío | OK |
| Publicación automática y verificación posterior | PR #55 · `curl` | ver fila siguiente |
| Después (a los ~15 s): salud, `/hub`, `/panel.html` 200; `/api/me/descargas/catalogo` sin sesión 401; el catálogo real de la tienda se arma (6 categorías, 35 productos, 1 promo); el PDF premium real abre (A4, 5 páginas, 54 KB) y el Excel real abre (7 hojas, 3 gráficos, 147 KB); 78 alquileres y 34 clientes idénticos byte a byte; cierre igual (Bs 4.490,60) | `curl` + pdfinfo + openpyxl + comparación JSON | OK |
| Nada escrito en producción (los archivos se generan en memoria y se borran de la carpeta temporal) | — | ✅ |

## 13/11/2026 · Centro de exportaciones (publicado en #55)
| Qué | Cómo | Resultado |
|---|---|---|
| Catálogo WhatsApp de la tienda: marca, precios públicos, combo con sus partes, promos (combo + cupón NOV10), sin ocultos, sin «solo revendedores», sin costos ni ids; filtro por categoría | `test/exportaciones.test.mjs` | OK |
| Catálogo de la revendedora Ana: su nombre, su WhatsApp, su link `/r/ana-tv`, sus precios (Netflix Bs 45, no el costo 30 ni el público 40), su combo «Pack Familia», sus descuentos; nada de la tienda ni de Beto; Beto solo con lo que tiene precio y sin link (página no publicada) | misma prueba | OK |
| Permisos: sin sesión 401; GaboHub pausado → 402; plan Básico sí exporta el catálogo; Excel en Básico → 402 | misma prueba | OK |
| PDF premium: 2 páginas A4 (portada + productos), `pdftotext` trae nombre, productos, precios, combo, cupón, WhatsApp, aviso de precios; nada oculto ni correos. Clásico con 1 categoría: 1 página, solo esa categoría. El de Ana con sus datos y sin los de la tienda | misma prueba (pdfinfo/pdftotext) | OK |
| Excel: 7 hojas, 1 gráfico en Resumen y 2 en Por producto, filtros, la portada suma Ventas con fórmula, una fila por ingreso y la suma = `incomeEvents` del sistema, total con SUM; sin correos ni claves; Ana: solo su venta (vendió 45, pagó 30), sin clientes directos ni Beto ni costos de cuentas | misma prueba (openpyxl) | OK |
| Navegador 360 px (GaboHub): Más → Mis descargas, vista previa con Ana TV y Pack Familia, sin desborde, links de PDF y Excel, cambiar diseño, copiar al portapapeles (texto empieza con «🛒 *ANA TV*»), sacar una categoría quita Spotify de la vista previa; sin errores | misma prueba (Playwright) | OK |
| Escritor PDF: 12 pruebas (pdfinfo A4, pdftotext con acentos, pypdf estricto, imágenes PNG+JPEG, link, emojis no rompen) | `test/pdf-writer.test.mjs` | 12/12 |
| Escritor Excel pro: estilos, fórmulas, combinadas, filtro, panel fijo, 3 gráficos; LibreOffice abre sin reparar y calcula los totales | `test/xlsx-pro.test.mjs` | 7/7 |
| Archivos de ejemplo con la demo (Gabriel Store y Carla Streaming): 4 PDF (premium/clásico × 2) y 2 Excel; abiertos con poppler y LibreOffice; cifras del Excel = sistema (tienda Bs 281 en 12 movimientos; Carla vendió Bs 263, pagó Bs 166, le quedó Bs 97) | scripts fuera del repo | OK |
| Nada tocado en producción | — | ✅ |
| Tanda completa | `npm test` | **570/570** en ~59 s (545 + 25 nuevas; `panel-ordenado`, `hub-navegacion` ajustadas por la pantalla nueva; `renovar-link` corregida porque dependía de la hora del día) |

## 13/11/2026 · Publicación link de cobro + recordatorio «Tu día» (PR #54, squash `1694a77`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, cierre nov Bs 4.490,60 (incluye el cobro de ANDROID anotado hoy) | API con la llave del asistente | guardada |
| Rama de Railway vs lo fusionado en #53: idéntico; unión «ours» con árbol igual al probado; CI verde | `git diff --stat` vacío | OK |
| Publicación automática de Railway | PR #54 | nuevo código en vivo a los ~10 s (`sublinks.js` servido trae el link de clientes) |
| Después: salud 200, `/hub` 200, `POST /api/me/control/x/link` sin sesión 401, token falso de `/api/cobro` 404, 78 alquileres y 34 clientes idénticos byte a byte, cierre igual (Bs 4.490,60) | `curl` + comparación JSON | OK |
| Nada escrito en producción | — | ✅ |

## 13/11/2026 · Link de cobro de clientes registrados + recordatorio «Tu día» (publicado en #54)
| Qué | Cómo | Resultado |
|---|---|---|
| Crear link: token de 32+, pedirlo de nuevo da el mismo; vista pública = `{name:"Marisel", label:"", product:"Netflix perfil", expiresAt, price:4000, pay, seller:"Ana TV", sellerWhatsapp, hasQr:false, currency:"Bs", hasLogo:false, codes:"off"}`; sin correo, clave, teléfono, ids ni costo (2500) | `test/link-cobro-clientes.test.mjs` | OK |
| Solo el revendedor del cliente: otro revendedor, el dueño y un cliente directo → FORBIDDEN | misma prueba | OK |
| Mi control y Mi día traen `linkToken`; revocar → 404 y el nuevo es distinto; cliente pasado a otro revendedor → 404 y vuelve al volver; sobrevive a `initialState` (reinicio); link creado en transacción deshecha no vive | misma prueba | OK |
| Texto del recordatorio: «☀️ Tu día: 1 para cobrar», «Marisel. Tocá para abrir Mi día.», `/hub#dia`; null sin pendientes; sin saldo agrega «Te falta saldo … (tenés 0, necesitás 25)» | misma prueba | OK |
| API: sin sesión 401; `POST …/link` → url `/c/…`; `GET /api/cobro/<token>` 200 con lo mínimo y `alerts:false`; `/qr` 404 sin QR; Mi control trae el token; revocar → 404 | misma prueba, servidor efímero | OK |
| Tito a las 9 (push falso): un solo aviso al revendedor suscrito, título «☀️ Tu día: 1 para cobrar», url `/hub#dia`; mismo día no repite; en plan Básico no manda el resumen | misma prueba | OK |
| Navegador (demo de Carla, 360 px): página `/c/` del cliente registrado (Hola Ruthy · Disney+ · Bs 38 · Ya pagué); recuadro «Link de cobro» en Mi control; `/hub#dia` abre la pestaña Mi día; sin desborde | Playwright, capturas fuera del repo | OK |
| Nada tocado en producción | — | ✅ |
| Tanda completa | `npm test` | **545/545** en ~53 s (541 + 4 nuevas; `afuera-completo` ajustada porque el aviso de la mañana ahora es el resumen de Mi día). Una corrida bajo carga (76 s) falló `tarjeta` (panel del dueño, sin relación) por tiempo de espera; sola pasa 2 de 2 y en la corrida limpia pasó |

## 13/11/2026 · Publicación «Mi día» (PR #53, squash `c7bb327`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa (solo lectura): 78 alquileres, 34 clientes, cierre nov Bs 4.452,60 | API con la llave del asistente | guardada |
| Rama de Railway vs lo fusionado en #52: contenido idéntico; unión «ours» con árbol igual al probado | `git diff --stat` vacío | OK |
| Publicación automática de Railway | PR #53 | nuevo código en vivo a los ~20 s (`/api/me/dia` existe; `shop.js` servido trae «Mi día») |
| Después: salud 200, `/hub` 200, alquileres y clientes idénticos byte a byte, cierre igual | `curl` + comparación JSON | OK |
| Nada escrito en producción | — | ✅ |

## 13/11/2026 · «Mi día» del revendedor (publicado en #53)
| Qué | Cómo | Resultado |
|---|---|---|
| Grupos: Marisel (venció hace 2 d) y Lucía (perfil «Mamá», venció ayer) en Cobrar; Ruthy (2 d) en Avisar; José (pendiente, 20 d) y Mario (perfil, debe, 10 d) en Me deben; totales Bs 55 / 40 / 60; `cost` = lo que le cuesta renovar; el perfil trae su link de cobro | `test/revendedor-mi-dia.test.mjs` | OK |
| Aislamiento: nada del otro revendedor ni del cliente directo de la tienda; sin correos ni claves; el dueño (staff) → FORBIDDEN; mirar un servicio ajeno → NOT_FOUND | misma prueba | OK |
| «Me pagó» en perfil repartido vencido: fecha +30 días desde hoy y pagado; misma llave no corre dos veces; perfil que no vence: solo pagado y precio corregido | misma prueba | OK |
| «Me pagó» en cliente registrado con renovar: pagado en Mi control, saldo baja Bs 25 una vez (idempotente), fecha nueva; sin vencer: no se ofrece renovar y se salda su libreta (Quién me debe = 0); sin saldo: cobro anotado y motivo | misma prueba | OK |
| API: sin sesión 401; con sesión de revendedor 200 con sus grupos; plan Básico → 402 `HUB_PLAN`; de vuelta al Completo 200 | misma prueba, servidor efímero | OK |
| Navegador a 360 px: desde Inicio → «Mi día» → Cobrar hoy 1 · Marisel · Venció hace 2 d · Bs 40; sin correo; sin scroll horizontal; botón ≥ 44 px; «Me pagó» abre la vista previa con «Renovar ahora con mi saldo · Bs 25» marcada; confirmar → «Todo al día acá ✅», control pagado, alquiler renovado 30 días, saldo con una sola renovación; sin errores de consola | misma prueba (Playwright) | OK |
| Capturas con la demo de Carla (Inicio, lista, vista previa) | Playwright, demo local, fuera del repo | revisadas |
| Nada tocado en producción | — | ✅ |
| Tanda completa | `npm test` | **541/541** en ~54 s (536 + 5 nuevas; `hub-navegacion` y `hub-clientes-unidos` ajustadas porque «Clientes» ahora abre en «Mi día») |

## 13/11/2026 · Publicación Optimización 1 + 2 (PR #52, squash `5a86b5f`)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto previa de la tienda real (solo lectura, llave del asistente): alquileres, clientes, cierre de noviembre | `GET /api/admin/assignments`, `/customers`, `/finance/cierre?month=2026-11` | 78 · 34 · Bs 4.452,60 (66 cobros del Control) |
| Conflicto de ramas: la rama de Railway tenía Premium 2.0 como squash (#51); el código era idéntico al de `premium-2.0` (solo 4 docs distintos) | `git diff --stat premium-2.0 origin/ccr-0b4be8d6-1sld7s`; unión con estrategia «ours» y comprobación de árbol idéntico al probado | árbol igual: sí |
| Fusión con squash y publicación automática de Railway | PR #52 | nuevo código en vivo a los 65 s |
| Verificación de solo lectura después: salud, alquileres y clientes idénticos byte a byte a la foto previa, cierre igual, `renewLink` apagado en Configuración, token falso → 404, secretaria sin botón de link (`renewLinks:false`), tienda 200 | `curl` + comparación JSON | todo OK |
| Semáforo en la tienda real | `GET /api/admin/accounts` | 4 rojas, 106 amarillas, 7 verdes, 32 «dada de baja» (antes rojas) de 149 |
| Nada escrito en producción | — | ✅ |

## 13/11/2026 · Optimización 2 · Renovar por link (publicado en #52, apagado)
| Qué | Cómo | Resultado |
|---|---|---|
| Apagado de fábrica: Configuración dice `{enabled:false, access:"renew", hours:48}`; generar link → 409 `RENEW_LINKS_OFF`; token cualquiera → 404 (GET y POST) | `test/renovar-link.test.mjs` | OK |
| Ajuste validado: horas 0 → 400, acceso «root» → 400; se guarda y se lee; `/api/settings` público no lo expone | misma prueba | OK |
| Prendido: generar sin sesión → 401; cliente de revendedor → 409 `VIA_RESELLER`; el link vale 48 h; la vista trae nombre, producto, precio Bs 35, 30 días, fecha nueva, saldo; **no trae correo, clave ni teléfono** | misma prueba | OK |
| Saldo: renueva al instante (`fulfilled`, Bs 35), la fecha corre exactamente un período, el saldo baja una vez, el link queda usado (404), auditoría `renewal.create` con actor `renewlink:…` | misma prueba | OK |
| QR: pedido `awaiting_payment` sin correr la fecha; segundo pedido → 409 `ALREADY_PENDING`; comprobante → `payment_review` y el link cumplió (404); el dueño aprueba → `fulfilled` y recién ahí corre la fecha un período | misma prueba | OK |
| Proveedor: cuenta que vence en 10 días → `supplierOk:false`; pagar con saldo → 409 `SUPPLIER_EXPIRY_EXCEEDED` y el saldo no se toca | misma prueba | OK |
| «Entrar» con acceso «renew» → 403; con «full» → 200 y sesión del cliente (`/api/me` loggedIn); a las 49 h → 404; apagar el interruptor → los links vivos dan 404 | misma prueba | OK |
| Tito: con el servicio venciendo mañana, apagado → `url=/tienda/#cuentas`; prendido → `url` con `#renovar=`; el camino real genera un token válido | misma prueba (push con doble, nada real) | OK |
| Navegador a 360 px: abre el link, el token no queda en la barra (`#renovar`), se ve Marisel / Netflix perfil / Nueva fecha / 35.00, sin correo, sin scroll horizontal, botón ≥ 44 px; «Pagar con mi saldo» → pantalla «✅ ¡Renovado! … ahora vence el dd/mm/aaaa»; en la secretaria aparece «🔗 Link para renovar» para el cliente directo y **no** para el del revendedor; sin errores de consola | misma prueba (Playwright) | OK |
| Capturas a 360 px (antes / renovado) | Playwright, demo local, fuera del repo | revisadas: fichas legibles, botones de 44 px, sin desborde |
| Capturas del panel a 360 px: «🔗 Link para renovar» en la secretaria (link copiado, con fecha de vencimiento) y el interruptor en Configuración → Soporte (apagado de fábrica); sin desborde | Playwright, demo local | revisadas |
| Nada tocado en producción | — | ✅ |
| Tanda completa | `npm test` | **536/536** en ~55 s (527 anteriores + 9 nuevas; `soporte` ajustada por el campo nuevo) |

## 13/11/2026 · Optimización 1 (rama `optimizacion-1`, sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Semáforo: cuenta con el único perfil dado de baja → «dada de baja» (no roja), sigue activa y el perfil retirado; cuenta viva con nota CAÍDA sigue roja; la lista trae `risk.inactive` | `test/optimizacion-1.test.mjs` (núcleo, datos ficticios) | OK |
| «Me pagó»: vista previa con cliente/pagador, cuenta, producto, Bs 66, período 30 días desde hoy (venció hace 2 días), fecha nueva; Atención no puede; 13 períodos → inválido; guardar corre la fecha, marca pagado, limpia «EN COBRO», anota 1 cobro y Finanzas suma 66 una vez; misma llave = mismo resultado; 1 min después frena («hace 1 min»); 2 h después el período siguiente arranca donde termina el pagado; 3 períodos pasan al proveedor → frena sin tocar la fecha; precio corregido a 65 → segundo cobro anotado y sumado; la secretaria ya no la lista en Cobrar | misma prueba | OK (encontró que un segundo cobro consecutivo no se anotaba porque el Control solo anota al PASAR a pagado; se pasa por «pendiente» después de correr la fecha) |
| Cierre: tienda que arranca el 22/10 → octubre incompleto, sin %, «datos desde 22/10»; con historia desde antes del 1/10 el % vuelve | misma prueba | OK |
| API: `pay-preview` 200 con los datos; `pay` 200 e idempotente; segundo cobro a los segundos → 400; sin sesión 401 | misma prueba, servidor en puerto efímero | OK |
| Navegador a 360 px: «💵 Me pagó» en la secretaria abre la vista previa con Rodbol, dis2@x.lat, Bs 69, Período, Fecha nueva y «Confirmar»; sin desborde; botones/campos de 44 px; al confirmar el alquiler queda pagado y sale de la lista | misma prueba, Playwright | OK |
| Detalles visuales: botón WhatsApp de la FAQ en PC = 44 px; landing de revendedores sin letra < 12 px, sin desborde ni recortes en los 3 celulares de muestra (cel y PC) | medición con Playwright en demo local | OK |
| Demo GaboHub: Ana (prueba), Beto (Básico, pagó Bs 25), Carla (Completo, pagó Bs 49, página `/r/carla-streaming`), Paula (US$, prueba); hubs de los 4, Mi control de Beto, página de Carla, Revendedores y Ajustes del dueño en cel y PC: sin desborde, sin errores, letra ≥ 12 px, botones de 44 px en celular | `scripts/seed-gabohub-demo.mjs` + capturas (fuera del repo) | OK |
| Nada tocado en producción; tienda real solo leída | — | ✅ |
| Tanda completa | `npm test` | **527/527** en ~59 s |

## 13/11/2026 · Publicación Premium 2.0 (PR #51)
| Qué | Cómo | Resultado |
|---|---|---|
| Antes de publicar | lectura en vivo de la tienda real | 78 alquileres activos; `/api/admin/inicio` no existía (404) |
| Después (30 s tras el squash) | lectura en vivo, solo GET | `/api/admin/inicio` 200 con los mismos 78 alquileres y 0 pagos por revisar; `/api/admin/cortes` 200; secretaria con conteos nuevos (claves 9, débitos 0); tienda y panel 200; `tema.css` servido |
| Datos | ninguno tocado: los campos nuevos son opcionales | ✅ |

## 13/11/2026 · Premium 2.0 · Etapa 9 «Finanzas pro»
| Qué | Cómo | Resultado |
|---|---|---|
| Noviembre: entró Bs 182 (132 por pedidos + 50 del Control) = el mismo número de Finanzas; 1 venta, 1 renovación, 1 cobro del Control; gastos Bs 30; te quedó Bs 152; octubre Bs 101 / 20 / 81; +80 % vs. octubre; ARIt pagó todo; Disney primera; 12 meses listados; estimado de cuentas solo en el mes en curso | `test/finanzas-pro.test.mjs` (reloj controlado, datos ficticios) | OK |
| Octubre cerrado: sin estimado, comparado con septiembre, empieza y termina en hora de Bolivia; mes futuro o mal escrito → el actual; Atención no entra | misma prueba | OK |
| API: `/api/admin/finance/cierre` 200 con los datos; `/cierre.xlsx` 200, nombre `cierre-AAAA-MM.xlsx`, archivo .xlsx válido (empieza en PK); sin sesión 401 | misma prueba, servidor en puerto efímero | OK |
| Pantalla Finanzas a 360 px con la tarjeta de cierre: sin desborde, botones de 44 px, letra ≥ 12 px, sin errores de JS | captura con datos de ejemplo (fuera del repo) + medición en la página | OK |
| Tanda completa | `npm test` | **522/522** en ~58 s. Además se hizo robusta la prueba intermitente «Mis clientes» (`hub-clientes-unidos`): ahora espera por la API y recarga la pantalla en vez de depender del redibujado en vivo; 2/2 sola y verde en la tanda completa |

## 13/11/2026 · Premium 2.0 · Etapa 8 «Automatización y soporte»
| Qué | Cómo | Resultado |
|---|---|---|
| Fallas: a las 2 h espera 2 h (no tarde); a las 25 h, tarde; resuelta: tardó 25 h y ya no está tarde; el cliente ve lo mismo | `test/soporte.test.mjs` (reloj controlado, datos ficticios) | OK |
| Respuestas guardadas: más de 10, vacías o de más de 200 letras → inválido; mensajes de más de 500 letras → inválido; Atención no puede; se guardan recortadas; un mensaje vacío no se guarda; la secretaria devuelve `templates` | misma prueba | OK |
| Débitos: autopago en 2 días y autopago debitado ayer entran (ordenados por fecha, con US$ 9 cuando está anotado); uno a 10 días y uno sin autopago no; 3 días después solo queda el de ayer; al otro día ninguno | misma prueba | OK (la primera expectativa olvidaba la ventana «desde ayer»; corregida la prueba, no el producto) |
| API: guardar soporte → 200; `/api/admin/settings/soporte` lo devuelve; sin sesión 401; el `/api/settings` público no lo trae; respuesta de 300 letras → 400 | misma prueba, servidor en puerto efímero | OK |
| La secretaria mantiene sus conteos (más `debitos`) | `test/secretaria.test.mjs` | OK |
| Tanda completa | `npm test` | **520/520** (segunda corrida, ~65 s). En la primera falló solo `hub-clientes-unidos` («Mis clientes»), la intermitente bajo carga: sola pasa |

## 13/11/2026 · Premium 2.0 · Etapa 7 «Mi Oficina 2.0»
| Qué | Cómo | Resultado |
|---|---|---|
| API: 6 asistentes; `pendientes` con los conteos de la secretaria (1 clave por cambiar); la línea de tiempo trae «Aprobaste el pago de Ana (Netflix Premium)» y «Vendiste Netflix Premium a Ana»; ningún texto con apellido, clave, correo, número de operación ni costo | `test/oficina-2.test.mjs` (servidor en puerto efímero, datos ficticios) | OK (la primera versión del filtro buscaba «2000» en todo el JSON y lo encontraba dentro de una fecha; se acotó a los textos) |
| Navegador a 360 px, claro y oscuro: 6 escritorios, 6 anillos con avatar, 6 monitores, línea de tiempo con eventos, «Para hoy», ticker; sin desborde; botones de 44 px; letra ≥ 12 px; los 6 globitos ≥ 4,5:1 | misma prueba, Playwright | OK (encontró que el ticker en una sola línea ensanchaba la página a 551 px: se acotó `#ofRoot` y las columnas con `minmax(0,1fr)`) |
| La prueba anterior de la oficina (7 pruebas: arranque, permisos, Rocío, Wali, Vico/Coco, privacidad de lo anotado, navegador) | `test/oficina.test.mjs` | OK sin cambios |
| Revisión visual | capturas a 360 px con datos de ejemplo (fuera del repo) | OK: el monitor salía aplastado (`span` en línea) y el puesto se cortaba «comprobante s»; corregidos |
| Tanda completa | `npm test` | **516/516** en ~57 s |

## 12/11/2026 · Premium 2.0 · Etapa 6 «GaboHub alquilable»
| Qué | Cómo | Resultado |
|---|---|---|
| Prueba de 15 días: al prender el cobro los 2 revendedores arrancan en prueba sin descuento; día 10 nada; día 16 se cobra Bs 49 al que tiene saldo y sale de la prueba; quien ya pagó no vuelve a tener prueba | `test/gabohub-planes.test.mjs` (reloj controlado, datos ficticios) | OK |
| Planes: Básico más caro que el Completo → inválido; prueba de 91 días → inválido; sin precio Básico no se puede elegir Básico; otro revendedor no cambia tu plan; plan «oro» → inválido; Básico cobra Bs 25 y deja las herramientas premium pausadas (`lockReason: plan`); en US$ cobra US$ 3 fijos; volver al Completo destraba ya y el mes siguiente cobra Bs 49; auditoría solo de los cambios que entraron | misma prueba | OK |
| API: `/api/me/shop` trae plan/prueba/precios; con Básico `/api/me/control` → 402 `HUB_PLAN`; sus pedidos siguen 200; el dueño cambia el plan por `/api/admin/resellers/:id/plan`; un revendedor no puede usar esa ruta (403) | misma prueba, servidor en puerto efímero | OK |
| La suscripción de antes no cambió (Bs 49 / US$ 5, gracia, pausa y vuelta al pagar): solo se sumó `trials: 0` al conteo | `test/suscripcion-gabohub.test.mjs` | OK |
| Menú del panel y navegación del hub sin cambios | `panel-ordenado`, `hub-navegacion` | OK |
| Revisión visual a 360 px: Inicio del revendedor («Tu suscripción… plan Completo · Tenés 15 días de prueba gratis» y botón «Pasar al Básico») y Ajustes del dueño con los 3 campos nuevos | capturas con datos de ejemplo (fuera del repo) | OK (el botón de plan iba dentro del texto: se pasó a su propia fila) |
| Tanda completa | `npm test` | **514/514** en ~65 s |

## 12/11/2026 · Premium 2.0 · Etapa 5 «Tienda premium»
| Qué | Cómo | Resultado |
|---|---|---|
| Rechazo: motivo vacío → error; se guarda recortado; el cliente lo ve en sus pedidos; el cliente de un revendedor no ve el motivo (ni el monto) del pago del revendedor; el revendedor sí | `test/tienda-premium.test.mjs` (núcleo) | OK |
| Estilo «Premium 2.0» primero en la lista, fondo y cian de tema.css, botón y texto ≥ 4,5:1; todos los estilos siguen pasando la prueba de contraste | misma prueba + `test/contrast.test.mjs` | OK |
| Tienda a 360 px, clienta con 4 pedidos (esperando pago, en revisión, rechazado con motivo, entregado): «Mis cuentas» dice cada estado y el motivo; «Saldo» guía en 3 pasos; sin desborde, botones de 44 px, letra ≥ 12 px, sin errores de JS | misma prueba, Playwright | OK (encontró los dos «Copiar» de 32 px; corregidos a 44) |
| Dashboard del panel en claro y oscuro: «7/30/90 días» y las letras de «Resumen por servicio» ≥ 4,5:1 (medido contra la punta más oscura del pastel) | misma prueba, Playwright a 360 px | OK |
| La tienda de la etapa 0 (portada, catálogo, carrito, pago) sigue bien | `test/base-segura.test.mjs` | OK |
| Revisión visual | capturas a 360 px del historial (Entregado / Rechazado con motivo / En revisión) y de la recarga en 3 pasos (fuera del repo) | OK: se lee claro, sin cortes |
| Tanda completa | `npm test` | **511/511** en ~50 s |

## 12/11/2026 · Premium 2.0 · Etapa 4 «Inventario inteligente»
| Qué | Cómo | Resultado |
|---|---|---|
| Correo normalizado («  NetGB.117@GMAIL.com » → «netgb.117@gmail.com»); repetida para la misma plataforma: rechazada (también con mayúsculas/espacios); misma dirección en otra plataforma: entra; editar hacia un correo que ya existe: rechazado; retirada la vieja, se puede cargar de nuevo; «gmaik.com» avisa sin frenar | `test/inventario-inteligente.test.mjs` (núcleo, datos ficticios) | OK (encontró que la validación del correo corría antes de normalizar: un espacio al final daba «Email inválido»; corregido) |
| Semáforo: verde; clave pendiente → amarillo; proveedor en 5 días → amarillo; en 1 día con cliente → rojo; vencida con cliente → rojo; «POR CORTAR» → rojo; «SEGUIMIENTO» → amarillo; perfil apartado → amarillo; aviso grave sin ver → rojo y visto → verde; clave de más de 90 días → amarillo | misma prueba | OK |
| Cortes: 3 clientes (22/11, 22/11, 02/12) → corte sugerido 22/11, diferencia 10 días, Ana 0 / Beto 0 / Carla +10; la cuenta completa de Disney no entra; alinear a Carla deja la cuenta alineada; sin claves en la respuesta; Atención no entra | misma prueba | OK |
| Cambié la clave: muy corta / igual a la anterior → rechazada; Atención no puede; admin sí: clave nueva, fecha, 2 avisos en cola (ninguno real), auditoría sin la clave; la secretaria deja de pedirla y a los 8 días vuelve | misma prueba | OK |
| API: cargar con «gmaik.com» → 200 con `warning`; repetida → 400 «ya está cargada»; `GET /api/admin/cortes` 200 (1 cuenta) y 401 sin sesión; `POST …/password` 200 con `notified: 1`; la lista sigue sin mostrar la clave | misma prueba, servidor en puerto efímero | OK |
| El menú suma «Cortes» para dueño y admin (no para Atención) y no pierde pantallas | `test/panel-ordenado.test.mjs` | OK |
| La secretaria mantiene sus conteos (más `claves`) | `test/secretaria.test.mjs` | OK |
| Revisión visual a 360 px: pantalla Cortes (vacía y con una cuenta desalineada: 3 clientes, corte 12/12, diferencia 10 d, filas por perfil) y Cuentas (filtros) sin desborde, botones de 44 px, letra ≥ 12 px, sin errores de JS | capturas con datos de ejemplo (fuera del repo) | OK. La pastilla 🟡/🔴 en la tarjeta de cada cuenta no se alcanzó a capturar (las tarjetas se abren por plataforma); queda cubierta por la prueba de `risk` en la lista |
| Tanda completa | `npm test` | **506/507**: volvió a fallar solo `hub-clientes-unidos` («Mis clientes») bajo carga: Playwright veía «inestable» el botón «Guardar en mis clientes» porque la lista se redibuja al abrir el desplegable. Se cambió ese clic a JS en la prueba (no cambia el producto); sola pasa |

## 12/11/2026 · Premium 2.0 · Etapa 3 «Panel rápido y oscuro»
| Qué | Cómo | Resultado |
|---|---|---|
| `/api/admin/inicio` = alquileres, pagos por revisar, finanzas, agentes, revendedores sin PIN y notificaciones de los endpoints sueltos; admin sin finanzas ni reporte diario; cliente 401/403; sin sesión 401 | `test/panel-rapido.test.mjs` (servidor en puerto efímero, datos ficticios) | OK |
| Navegador a 390 px: Inicio hace 1 llamada a `/api/admin/inicio` y ninguna a assignments/ai/resellers/finance; 7 pedidos en total (antes 12) | misma prueba, Playwright contando pedidos `/api/*` | OK |
| Tema: arranca oscuro, `--bg` del panel = `#070b16` (tema.css), elegir Claro se guarda y sobrevive a recargar | misma prueba | OK |
| Control: la lista se pide 1 vez; cambiar de pestaña 2 veces no vuelve a pedirla; tras guardar una nota (POST) se vuelve a pedir | misma prueba | OK (encontró que un POST a `/api/admin/assignments/:id/control` contaba como lectura en mi regex: corregido en la prueba) |
| Nada se rompió en las pantallas con navegador: panel-ordenado, pulido-panel, secretaria, hub-navegacion, oficina, como-van, winback, base-segura, guiado, hub-clientes-unidos | `node --test` de esos archivos | OK (guiado y hub-clientes fallaron con la primera versión de la caché, que también guardaba `/api/settings` y sobrevivía al cambio de pantalla; se acotó a las listas del panel y se vacía al cambiar de pantalla) |
| Revisión visual del oscuro a 360 px (Inicio, Control, Dashboard): sin desborde; contraste de textos medido | capturas con datos de ejemplo (fuera del repo) + medición en la página | Inicio y Control sin textos bajo 4,5:1. Dashboard: «30 días» y «Ver primeros pasos» dan 4,49:1 (borde), y las letras de los avatares de colores («N», «G») 2,5–3,7:1: queda anotado para la pasada visual de la etapa 5 |
| Tanda completa | `npm test` | **501/502** en ~62 s: la que falló fue `hub-clientes-unidos` (Mis clientes), que ya era intermitente bajo carga; corrida sola 3 veces seguidas: 3/3 OK |

## 12/11/2026 · Premium 2.0 · Etapa 2 «Números que coinciden»
| Qué | Cómo | Resultado |
|---|---|---|
| Inicio, Finanzas, resumen y Cómo van dan el mismo ingreso (Bs 217 del mes): venta, venta a cliente final, renovación y un cobro del Control; la recarga (Bs 40) queda aparte; la marca sobre un alquiler con pedido cerca no suma; lo importado no suma (su marca vieja cuenta en octubre) | `test/numeros-coinciden.test.mjs` (reloj controlado, datos ficticios) | OK |
| Mes y día de Bolivia: venta del 31/10 23:30 La Paz cae en octubre y en el día 31 en Finanzas, gráfico de 12 meses, serie por día, `byDay` y gastos; «vencen en 14 días» arranca a las 00:00 de Bolivia | misma prueba | OK |
| Costo en US$: cuenta a US$ 9 con tasa 12 → Bs 108 en el estimado del mes, el margen por perfil y el costo del proveedor; el costo en Bs anotado no se toca | misma prueba | OK (encontró que `costUsd` no se podía anotar al cargar la cuenta; corregido) |
| Fiado: revendedor en US$ debe Bs 70 = US$ 7 (`owedUsd`, `rate`); con tasa 14 la libreta sigue en Bs 70 y el ≈ pasa a US$ 5; cliente en Bs sin `owedUsd`; la libreta del revendedor no cambia | misma prueba | OK |
| Cómo van no cambió de números al pasar a la fuente única | `test/como-van.test.mjs` (12 pruebas) | OK |
| Gráfico por día en fecha de Bolivia aunque el proceso corra en UTC | `test/pulido-panel.test.mjs` (clave fija «2026-11-11») | OK (antes la prueba calculaba la clave con la zona del proceso) |
| Datos de ejemplo: los tres endpoints devuelven el mismo número (Bs 60, 0 del Control) | `seed-demo` + `/api/admin/dashboard`, `/api/admin/finance`, `/api/admin/stats` | OK |
| Tanda completa | `npm test` | **500/500** en ~51 s |

## 12/11/2026 · Premium 2.0 · Etapa 1 «Plata segura»
| Qué | Cómo | Resultado |
|---|---|---|
| Comprobante repetido: bloqueado; admin no fuerza; dueño sin motivo no; dueño con motivo sí y auditado; tras rechazo se aprueba normal | `test/plata-segura.test.mjs` (núcleo, datos ficticios) | OK |
| Referencias «0012-345» / « 12 345 » / «12.345» = mismo pago; otra distinta pasa; se guarda como la escribieron | misma prueba | OK |
| Número de operación ya visto: marcado y auditado, sin bloquear | misma prueba | OK |
| Recarga: monto verificado (Bs 100 declarados → Bs 80 acreditados), auditoría de → a; menos de Bs 10 rechazado; igual monto no audita | misma prueba | OK |
| Recarga: misma llave = una sola; 4ª en revisión rechazada; aprobada una, entra otra | misma prueba | OK |
| Consentimiento: origen panel/cliente/whatsapp/registro/revendedor con fecha; auditoría con `via` | misma prueba | OK |
| «Enviado a mano» sin permiso: NO_CONSENT; admin no fuerza; dueño con motivo sí, auditado | misma prueba | OK |
| Binance: webhook firmado (RSA de prueba) con pedido sin perfil → no se entrega, queda en la bandeja; con stock nuevo «Reintentar» entrega (1 asignación) y la bandeja queda vacía | misma prueba, servidor real en puerto efímero, Binance simulado con `fetchImpl` | OK (encontró que un pedido sin perfil se entregaba vacío; corregido) |
| Por la API: recarga con llave repetida = una; misma imagen → 409 `DUPLICATE_EVIDENCE`; `force` + motivo + `verifiedAmount` → 200 con el monto corregido | misma prueba | OK |
| Nada se rompió: store, binance, usdt-manual, avisos-solos, server | `node --test` de esos archivos: 161/161 | OK |
| Tanda completa | `npm test` | **496/496** en ~51 s |
| Revisión visual del panel: Aprobación a 360 px con una recarga repetida (avisos «Comprobante repetido» y «Número de operación ya visto», campo «Llegaron Bs», casilla del dueño y motivo) | captura con datos de ejemplo (fuera del repo), medición: sin desborde, campos de 44 px, letra ≥ 12 px, sin errores de JS | OK (se agregó la etiqueta «Llegaron Bs» porque el campo solo no se entendía) |

## 12/11/2026 · Premium 2.0 · Etapa 0 «Base segura»
| Qué | Cómo | Resultado |
|---|---|---|
| tema.css cargado por tienda y panel; fuentes con `media="print"` + `data-font`; sin manejadores en línea; «Sofi» fuera del buscador | `test/base-segura.test.mjs` | OK |
| Tito: misma hora en dos lecturas seguidas; sin hora guardada usa las 9 de Bolivia; con `lastAt` usa esa | misma prueba, `/api/admin/office` | OK |
| Tienda a 360 px: portada, catálogo, carrito y paso de pago sin desborde, botones de 44 px, letra de 12 px o más (se excluyen adornos `.pt` y `.tkgrid`) | misma prueba, Playwright | OK (encontró y se corrigieron 3 textos de 11 px y un botón de 36 px) |
| `avisos-solos`: las estadísticas del cartero ahora traen `lastAt` | 2 comparaciones exactas actualizadas | OK |
| Tanda completa | `npm test` | **487/487** en ~46 s |

## 12/11/2026 · Botón «Mi secretaria» en el panel
| Qué | Cómo | Resultado |
|---|---|---|
| Separa cobrar, cortar, vencidas sin anotar, deudas, avisos (≤3 días), desenlazar, libres listas, libres con proveedor vencido y apartadas | `test/secretaria.test.mjs` (datos ficticios, núcleo) | OK |
| Solo lee; el dueño ve «lo que pasó», el admin no, un revendedor no entra | misma prueba | OK |
| Botón en Inicio ≥ 44 px, pantalla a 360 px sin desborde, letra ≥ 12 px, «Mensaje listo» con cuentas y total, sin mensaje en «Cortar», «lo que pasó» plegado | misma prueba, Playwright a 360 px (WhatsApp bloqueado) | OK |
| El menú no pierde ninguna pantalla (se suma «Mi secretaria» para dueño y admin) | `test/panel-ordenado.test.mjs` | OK |
| Tanda completa | `npm test` | **484/484** en ~47 s (una corrida previa tuvo 1 falla intermitente en `hub-clientes-unidos`, que pasó sola y en la corrida completa siguiente) |
| Revisión visual | captura a 360 px de Inicio y de la pantalla, con datos de ejemplo (fuera del repo) | Se ve clara; sin cortes |

## 12/11/2026 · Ponerse al día con Disney: rodbol (datos reales, con OK del dueño)
| Qué | Cómo | Resultado |
|---|---|---|
| Respaldo | Sus 11 alquileres y su ficha, guardados antes de tocar (fuera del repo) | ✅ |
| Nombre | Solo cambió el nombre; teléfono, saldo y sus 11 cuentas iguales | ✅ |
| 3 cuentas | Primero una sola (gabito6626+8ene), revisada; después las otras 2. Las 3: vencen 04/12, pago pendiente; precio a Bs 66 (primero una, después las otras 2): Bs 198 | ✅ |
| Nada más | Los otros 79 alquileres idénticos; cola de avisos 75 (no salió ningún mensaje) | ✅ |
| 2 cuentas pasadas a rodbol | Respaldo sin contraseñas; primero 2np y revisada, después 9dp. Las 2: de rodbol, 30/10 → 30/11, pagadas, Bs 66; contraseña confirmada con la vista de contraseñas (sin mostrarla); correo de 9dp corregido. Otros 80 alquileres iguales | ✅ |
| Avisos | 4 avisos nuevos para rodbol quedaron «no enviado (sin permiso)» | ✅ |
| Corrección | La primera comparación de contraseña de 2np se hizo con la contraseña oculta (no era válida); se rehízo con la vista de contraseñas | ⚠️ → ✅ |

## 12/11/2026 · Después de publicar #49 (suscripción GaboHub)
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real | Servicios 82, cola 75, clientes 28, cuentas 125, productos 39 y pedidos 92: idénticos antes y después | ✅ |
| Cobro | Sigue igual que antes: apagado, Bs 30, «gratis si compra Bs 200», 3 días de gracia, solo con página. Saldos y estado de los 23 revendedores, iguales | ✅ |
| Páginas | /tienda/ y /hub sin errores; panel del dueño → Cuentas con 125 tarjetas y 0 errores | ✅ |
| Configuración con OK del dueño | Respaldo de la anterior guardado; quedó Bs 49, US$ 5, sin «gratis si compra», 3 días de gracia, para todos y APAGADA. Los demás ajustes, los saldos y el estado de los 23 revendedores, iguales; cola 75 (no salió ningún mensaje) | ✅ |

## 12/11/2026 · GaboHub etapa 5: suscripción (publicado en #49)
| Qué | Cómo | Resultado |
|---|---|---|
| Cobro | `test/suscripcion-gabohub.test.mjs`: apagada no cobra; prendida para todos cobra Bs 49 al de solo panel, US$ 5 fijos al de dólares y arranca la gracia al que no tiene saldo; a los 3 días se pausa; paga y vuelve; no se cobra dos veces el mismo mes; apagar limpia las pausas; si arma su página, lo pagado pasa a la página; «solo con página» no toca a los de solo panel | ✅ |
| Pausa en el servidor | Pausado: control, fiados y ganancias responden 402; servicios, clientes, página, cuentas propias y precios responden 200; anotar un fiado sigue funcionando | ✅ |
| En el celular (360 px) | Aviso en el Inicio, candado con «Pagar» en Mi control (botones de 44 px); paga y se reactiva | ✅ |
| Lo de antes | Las pruebas del alquiler de página (`store`) siguen pasando sin cambios | ✅ |
| Revisión visual | Ajustes del dueño (el selector «¿Quién paga?» se cortaba en el celular: textos acortados, entra a 360 px) y aviso del revendedor | ✅ |
| Prueba inestable | `hub-clientes-unidos` falló 1 vez en 4 corridas completas (máquina cargada): más margen en sus esperas | ✅ |
| Pruebas automáticas | `npm test`: 482 / 482 (52 s) | ✅ |

## 12/11/2026 · Después de publicar #48 (GaboHub etapas 3 y 4)
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real | Servicios 82, cola 75, clientes 28, cuentas 125, productos 39 y pedidos 92: idénticos antes y después | ✅ |
| Páginas | /hub, /tienda/, /panel.html y ownstock.js responden 200; /tienda/ y /hub sin errores ni scroll de costado | ✅ |
| No revisado en la tienda real | El panel por dentro de un revendedor (la llave del asistente le gana a su sesión); revisado con el mismo código en la tienda de prueba | ⚠️ |

## 12/11/2026 · GaboHub etapa 4 (publicado en #48)
| Qué | Cómo | Resultado |
|---|---|---|
| Clientes con todo lo suyo | `test/hub-clientes-unidos.test.mjs` a 360 px: Rosa con 3 servicios (tienda, propia por su ficha, perfil por su WhatsApp); Beto solo en lo propio aparece suelto y «Guardar» lo deja con ficha; buscador por app y por teléfono; nada del otro revendedor | ✅ |
| Hallazgo 1 | Por un instante, antes de que llegara la lista, un cliente con ficha aparecía como «no está en tu lista»: ahora los sueltos se muestran recién con la lista completa | ❌ → ✅ |
| Hallazgo 2 | Los botones «Ver en…» usaban la misma marca que las pestañas y se confundían con ellas: ahora usan la de los atajos | ❌ → ✅ |
| Prueba inestable evitada | La prueba esperaba 450 ms fijos al buscador; ahora espera al resultado (falló 1 vez en una corrida completa, después 5 de 5 bien) | ✅ |
| Foto de controles (contra la etapa 3) | Ninguna pantalla con controles de menos | ✅ |
| Pruebas automáticas | `npm test`: 480 / 480 (49 s) | ✅ |

## 12/11/2026 · GaboHub etapa 3 (publicado en #48)
| Qué | Cómo | Resultado |
|---|---|---|
| Cuentas propias en el negocio | `test/hub-propias-negocio.test.mjs` a 360 px: Mi control muestra solo la que vence en 2 días y 🔄 Renovó le suma 30 días; Quién me debe muestra la pendiente y 💵 Me pagó la marca pagada; Mis ganancias: 2 clientes, Bs 55 por mes. La venta de otro revendedor nunca aparece. Botones de 44 px, sin scroll de costado | ✅ |
| Hallazgo | Con la libreta vacía decía «Nadie te debe nada» aunque le debieran por una cuenta propia (y ya pasaba con perfiles sin pagar): ahora dice «No tenés fiados anotados» | ❌ → ✅ |
| Foto de controles (contra la etapa 2) | Ninguna pantalla con controles de menos; se suman Cobrar y Me pagó en Quién me debe | ✅ |
| Pruebas automáticas | `npm test`: 479 / 479 (50 s) | ✅ |

## 12/11/2026 · Después de publicar #47 (GaboHub etapas 1 y 2)
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real | Servicios 82, cola 75, clientes 28, cuentas 125, productos 39 y pedidos 92: idénticos antes y después | ✅ |
| Páginas | /hub, /tienda/, /panel.html y estilos responden 200; /tienda/ y /hub cargan sin errores ni scroll de costado; la barra de la tienda de clientes no cambió | ✅ |
| Panel del dueño (solo mirando) | Cuentas: 4 grupos, 125 tarjetas, 0 errores | ✅ |
| No revisado en la tienda real | El panel por dentro de un revendedor: desde acá la llave del asistente le gana a la sesión del revendedor. Se revisó con el mismo código en la tienda de prueba (pruebas y capturas) | ⚠️ |

## 12/11/2026 · GaboHub etapa 2 (publicado en #47)
| Qué | Cómo | Resultado |
|---|---|---|
| Inventario por plataforma | `test/hub-inventario.test.mjs` a 360 px: 3 apps (Disney+ completa con 2 perfiles, Flujo TV propio sin cupos, Netflix de la tienda + propio), totales 7 · 3 · 1 · 1, «Ver» a la pantalla correcta, 44 px, sin scroll de costado | ✅ |
| Hallazgo | La cuenta completa de Disney salía 2 veces (como servicio de la tienda y como cuenta completa): ahora se cuenta una sola vez | ❌ → ✅ |
| Separación | La cuenta propia de otro revendedor nunca aparece | ✅ |
| Foto de controles (contra la etapa 1) | Ninguna pantalla con controles de menos; solo se suman «Por plataforma» y sus «Ver» | ✅ |
| Arreglo de la etapa 1 | La carga de cupones había quedado en medio de un «si… si no» existente; quedó como era, más los cupones | ✅ |
| Pruebas automáticas | `npm test`: 478 / 478 (48 s) | ✅ |

## 12/11/2026 · GaboHub etapa 1 (publicado en #47)
| Qué | Cómo | Resultado |
|---|---|---|
| Foto de controles antes y después | Ariana (con página, demo de 6 meses) y un revendedor «solo panel», 390 px: 15 y 13 pantallas antes, 17 y 15 después. Dentro de cada pantalla, botones y formularios iguales; solo cambian las pestañas de navegación. La foto sale igual 2 veces seguidas | ✅ |
| Navegación nueva | `test/hub-navegacion.test.mjs` a 360 px: barra de abajo, grupos, Vender (5 caminos), Más con todos los destinos y buscador, atajos del Inicio, «solo panel» sin Mi página. Todo de 44 px o más y sin scroll de costado | ✅ |
| Pruebas adaptadas | `revendedor-pantallas`, `afuera-completo` y `cuentas-propias` llegaban a las pestañas por la fila completa; ahora llegan por su grupo o por Más. Lo que revisan (desborde, logos, errores) no cambió | ✅ |
| Arreglo hallado | «Mis cupones» abierto desde Más no cargaba sus cupones: ahora se cargan igual que desde la pestaña | ✅ |
| Pruebas automáticas | `npm test`: 477 / 477 (48 s) | ✅ |

## 12/11/2026 · Después de publicar #46
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real después de #46 | Servicios 82, cola 75, clientes 27, cuentas 125, productos 39 y pedidos 92: idénticos antes y después | ✅ |
| Cuentas en la tienda real (solo mirando) | Disney + ESPN dice «16 vencidas» y ya no «vencen ≤ 7 d»; 4 grupos, 125 tarjetas, 0 renglones pisados, sin scroll de costado, 0 errores | ✅ |

## 12/11/2026 · Después de publicar #45 y arreglo de «vencidas» (publicado en #46)
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real después de #45 | Servicios 82, cola 75, clientes 27, cuentas 125, productos 39 y pedidos 92: idénticos antes y después | ✅ |
| Cuentas en la tienda real (solo mirando) | 4 grupos con las 125 tarjetas; las 16 caídas se ven sin renglones pisados (0); sin scroll de costado; 0 errores | ✅ |
| Hallazgo en la captura | Disney decía «16 vencen ≤ 7 d», pero esas 16 ya vencieron | ❌ → ✅ |
| Arreglo | `test/inventario-plataforma.test.mjs` agrega una cuenta vencida: sin el arreglo falla con el mismo texto que se vio en la tienda; con el arreglo pasa | ✅ |
| Pruebas automáticas | `npm test`: 476 / 476 (44 s) | ✅ |
| Para revisar | En la tienda real, «Disney+ sin ESPN» muestra el logo vacío (cuadro negro). Ya pasaba en la vista clásica; no es de esta etapa | ⚠️ |

## 12/11/2026 · Cuentas por plataforma, etapa 7 (rama `panel-inventario`)
| Qué | Cómo | Resultado |
|---|---|---|
| Mismos botones | `test/inventario-plataforma.test.mjs` a 360 px: toma la lista de botones y formularios de cada tarjeta en «Por plataforma» y en «Vista clásica», y las compara. Son idénticas | ✅ |
| Contadores | Disney: 2 cuentas · 5 libres · 0 ocupados · 1 vence ≤ 7 d. Netflix: 1 cuenta · 3 libres · 1 ocupado (después de una venta) | ✅ |
| Celular | Sin scroll de costado y los encabezados de grupo miden 44 px o más | ✅ |
| Se recuerda | Un grupo abierto sigue abierto al redibujar; la vista elegida sigue al recargar; al buscar, el grupo con resultados se abre solo | ✅ |
| Foto del panel (30 pantallas, datos de ejemplo) | 29 iguales; en Cuentas, 1 botón más (el de cambiar de vista) y 0 de menos; 0 errores | ✅ |
| Pruebas automáticas | `npm test`: 476 / 476 | ✅ |
| Revisión visual | Captura de celular con los datos de ejemplo: grupos legibles, la tarjeta de adentro igual a la de antes | ✅ |

## 12/11/2026 · Después de publicar #44 y arreglo de renglones (rama `panel-caidas-fix`)
| Qué | Cómo | Resultado |
|---|---|---|
| Tienda real después de #44 | Servicios 82, clientes 27, cuentas 125, pedidos 92 y cola 75: iguales. Solo mirando, en Cuentas: la tarjeta lista las 16 cuentas caídas, todas marcadas, con sus 2 botones; 0 errores | ✅ |
| Hallazgo en la captura | Con 16 cuentas y nombres largos, el texto de los renglones se pisaba. La prueba no lo veía porque usaba 3 cuentas con un nombre corto | ❌ → ✅ |
| Arreglo | `test/cuentas-caidas.test.mjs` ahora usa 13 cuentas con el nombre real: sin el arreglo daba 13 renglones pisados, con el arreglo 0 | ✅ |
| Pruebas automáticas | `npm test`: 475 / 475 en 2 corridas seguidas | ✅ |
| Para revisar | `avisos-solos` falló 1 vez en una corrida completa. Después pasó 3 veces sola y 2 completas. No tiene que ver con este arreglo (queda en BACKLOG) | ⚠️ |

## 12/11/2026 · Cuentas pagadas en dólares con tarjeta (publicado en #44)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **473 → 475 / 475 ✅** |
| Datos | `test/tarjeta.test.mjs`. Cubre: costo en US$ (hasta US$ 1000, no negativo); el pago guarda US$, tasa y Bs; dólares sin tasa → no; 2 meses mantiene el costo por mes; sin dólares funciona como antes; se puede quitar el costo en dólares | ✅ |
| Navegador a 360 px | Editar «15,49» → 1549. «Pagué la renovación» propone 15,49 × 11,71 = 181,39; con 2 meses 30,98 → 362,78; con tasa 12 → 371,76; el gasto queda anotado así. Finanzas muestra el cobro de los próximos 30 días (US$ 10,00 ≈ Bs 117,10) o avisa que no hay; sin desborde | ✅ |
| Foto antes / después | 30 pantallas idénticas (con los datos de ejemplo ninguna cuenta se cobra en dólares) | ✅ |
| No probado | Tus cuentas reales; la tasa de tu banco (por eso se puede cambiar a mano) | ⚠️ |

## 12/11/2026 · Cuentas caídas sin clientes (publicado en #44)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **472 → 473 / 473 ✅** |
| Cuentas caídas | `test/cuentas-caidas.test.mjs`, con navegador a 360 px. Con 5 cuentas: lista solo las 3 vencidas sin clientes (no la que tiene un cliente ni la que está al día); si se destilda 1 y se confirma, retira solo las otras 2; «Dejarlas como propias» deja la que quedaba en Propias, sin vencimiento y otra vez a la venta (+1 en stock); ningún cliente cambia; botones de 44 px sin desborde | ✅ |
| Foto antes / después | 30 pantallas idénticas (con los datos de ejemplo no hay cuentas caídas, así que la tarjeta no aparece) | ✅ |
| Contexto | La sesión no pudo retirar las 16 cuentas con la llave del asistente (las acciones que no se pueden deshacer necesitan permiso). Por eso el dueño pidió el botón para hacerlo él | ℹ️ |

## 12/11/2026 · Cambio de datos reales: cuentas de Disney sin proveedor (con OK del dueño)
| Qué | Cómo | Resultado |
|---|---|---|
| Respaldo | Antes de tocar: id, producto, proveedor, fecha y perfiles libres de las 124 cuentas de Disney (sin contraseñas), guardado fuera del repositorio y entregado al dueño | ✅ |
| Prueba con 1 cuenta | Fecha nueva guardada; su cliente pasa a poder renovarse; la fecha del cliente y los perfiles de la cuenta no cambian | ✅ |
| Las otras 107 | 107 de 107 sin fallas. En las 125 cuentas, los perfiles quedaron iguales; los 82 servicios conservan su fecha; las 16 cuentas dejadas para decidir siguen igual; clientes frenados por el proveedor: 81 → 0 | ✅ |
| «Proveedor Disney» → «Propias» | Botón del panel: 125 cuentas movidas. Servicios 82, cuentas 125, clientes 27, pedidos 92 y cola 75: iguales antes y después | ✅ |

## Tanda 12/11/2026 · Pestañas de Avisos y de Plata, etapa 6 (publicado en #43)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **471 → 472 / 472 ✅** |
| Pestañas | `test/bandejas.test.mjs`, con navegador a 360 px. Cubre: las 4 pestañas de cada grupo; cada una lleva a su pantalla y marca la actual; «Mensajes por enviar» abre WhatsApp en Avisos; en Conversaciones, Aprobar pagos y Vender no aparecen; Atención ve solo Fiado y Pagos por revisar; botones de 44 px, sin desborde | ✅ |
| Arreglo | Las pestañas se ven en dos filas: en una sola, dos quedaban escondidas en el celular | ✅ |
| Prueba vieja más firme | La del buscador fallaba a veces: miraba también el «Reemplazar» de la ficha | ✅ |
| Foto antes / después | 25 pantallas idénticas. Las 5 con pestañas tienen 4 botones más (las pestañas) y nada menos | ✅ |
| **Después de publicar (#43), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. Con la llave del asistente (rol admin) a 390 px: Recordatorios y Que vuelvan con 4 pestañas, Fiado y Reportes con 3 (Caja del mes es solo del dueño); las pestañas navegan; sin desborde; 0 errores | ✅ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Ver antes de confirmar, etapa 5 (publicado en #42)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **470 → 471 / 471 ✅** |
| Lo que se ve antes = lo que pasa después | `test/guiado.test.mjs`, con navegador a 360 px. Cubre: el «Automático» de Vender nombra el mismo perfil que después entrega el servidor; la fecha de «Si renovás» es la que queda después de renovar; la confirmación muestra «dd/mm → dd/mm»; el aviso del proveedor aparece antes y, si igual se intenta, el servidor frena y la fecha no cambia; «Hay 3 perfiles libres» y «No hay perfiles libres» coinciden con el stock | ✅ |
| Pruebas viejas más firmes | `oficina` y `buscador` fallaban a veces por casualidad: buscaban «777» o «4321» en ids y fechas. Ahora miran solo los textos que se muestran | ✅ |
| Foto antes / después | Las 30 pantallas idénticas | ✅ |
| **Después de publicar (#42), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. Solo mirando: las fichas y Renovar muestran la vista previa, sin desborde y con 0 errores | ✅ |
| Hallazgo | 81 de los 82 servicios muestran «se pasaría de la fecha del proveedor». Es correcto: son alquileres de Disney cuya cuenta vence con el proveedor el mismo día que el cliente o antes (40 de 81). El servidor ya frenaba esas renovaciones; ahora se ve antes. Para renovarlos: primero «Pagué la renovación» de la cuenta en Cuentas (mueve la fecha del proveedor) y después renovar al cliente | ℹ️ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Ficha 360°, etapa 4 (publicado en #41)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **469 → 470 / 470 ✅** |
| Ficha | `test/ficha.test.mjs`, con navegador a 360 px. Cubre: servicios, pedidos y fallas del cliente; sin contraseña ni costo; pestañas; botones de 44 px sin desborde. «Pagado», «Renovar» (+30 días) y «Reemplazar» (otro perfil) cambian lo mismo que en sus pantallas y la ficha queda abierta. Atención (en oscuro) ve la ficha y Renovar, sin Reemplazar | ✅ |
| Foto antes / después | Las 30 pantallas idénticas: mismos botones, formularios y enlaces | ✅ |
| Revisión visual | 390 px, claro y oscuro, con datos de ejemplo: 0 desbordes, 0 errores | ✅ |
| **Después de publicar (#41), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. A 390 px, solo mirando y sin tocar botones de acción, se abrieron las fichas de 3 clientes reales (11, 16 y 5 servicios) con sus 3 pestañas: 0 desbordes, 0 errores | ✅ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Buscador del panel, etapa 3 (publicado en #40)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **464 → 469 / 469 ✅** |
| Buscador | `test/buscador.test.mjs` (5): sin tildes, por teléfono, por correo de cuenta, por referencia del banco y por número de pedido; buscar por la contraseña no encuentra nada y ningún resultado trae contraseña, PIN ni costo; Atención sin cuentas ni pedidos; cliente y sin sesión → no; menos de 2 letras no busca; navegador a 360 px en claro y oscuro (botón arriba, tecla /, Esc, resultado → ficha abierta, Inicio → «Ver todo en el Control») | ✅ |
| Foto antes / después | Mismo guion y mismos datos: 28 pantallas idénticas; Inicio y Mi oficina tienen 1 botón menos cada una, por Sofi (sacada por decisión del dueño) | ✅ |
| **Después de publicar (#40), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75. Búsquedas reales («disney», «gmail»): resultados sin datos sensibles. A 390 px: 6 resultados, sin desborde, el resultado abre su pantalla sin error, 0 errores | ✅ |
| Para tener en cuenta | Un teléfono se busca con 4 números o más («591» solo no alcanza). Las cuentas se buscan por correo, no por producto | ℹ️ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Panel ordenado, etapas 1 y 2 (publicado en #39)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` (sin las 13 de Sofi, que se sacó) | **464 / 464 ✅** |
| Ninguna pantalla perdida | `test/panel-ordenado.test.mjs`: por rol (dueño, admin, atención) compara el menú nuevo con la foto del anterior (30, 26 y 16 pantallas) y abre cada una sin error; buscador con permisos; barra de abajo; «Más»; pendientes de Inicio = Notificaciones; 360 px, 44 px, sin desborde | ✅ |
| Foto antes / después | Mismo guion y mismos datos de ejemplo: 27 pantallas idénticas, 0 con menos botones, formularios o enlaces. Inicio tiene 1 botón más (el pendiente); Usuarios cambia porque la prueba creó 2 usuarios | ✅ |
| Revisión visual | 390 px, claro y oscuro: menú completo en una pantalla, búsqueda e Inicio. 0 errores | ✅ |
| **Después de publicar (#39), tienda real** | Servicios 82 → 82, clientes 27 → 27, cuentas 125 → 125, pedidos 92 → 92, cola 75 → 75 (antes y después de publicar). Con la llave del asistente (rol admin) a 390 px: el menú tiene las mismas 26 pantallas que antes y todas abren sin error ni desborde; barra de abajo correcta; 5 pendientes en Inicio; 0 errores. El respaldo automático diario existe en el código, pero la llave no puede verlo | ✅ |
| No probado | Celular físico | ⚠️ |

## Tanda 12/11/2026 · Sofi, la secretaria (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar | **463 → 476 / 476 ✅** (~29 s) |
| Secretaria | `test/ordenes.test.mjs` (13), con Claude falso. Cubre: cada consulta con datos reales; lo enviado a Claude no lleva contraseña, código, correo completo ni costo; los planes no cambian nada hasta confirmar; usado, vencido o de otro → error; Cancelar; ambigüedad con botones; falta de forma de pago; permisos (atención 403, cliente no); apagada, sin clave o en el tope → mensaje claro; 429; navegador a 360 px | ✅ |
| Revisión visual | 360 y 390 px, claro y oscuro: caja en Inicio, elegir cliente, plan con confirmación y Sofi en Mi oficina. 0 desbordes, 44 px, 12 px | ✅ |
| No probado | Claude real con textos dictados de verdad; el micrófono del teclado; un celular físico | ⚠️ |

## Tanda 11/11/2026 · Mi oficina (publicado en #38)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **456 → 463 / 463 ✅** (~31 s) |
| Mi oficina | `test/oficina.test.mjs` (7), con Claude y Meta falsos. Cubre: los 6 en su puesto; permisos (dueño y admin sí, vendedor 403, cliente no, gasto solo el dueño); el comprobante revisado se anota con el primer nombre, sin apellido, contraseña, correo ni número de operación; WhatsApp respondido y pase a una persona; la alarma de Vico se apaga al ver el aviso; Coco se despierta con un código que nunca se muestra; no va en el estado ni en la exportación; tope de 80; navegador a 360 px en claro y oscuro | ✅ |
| Revisión visual | Datos de ejemplo a 360, 390 y 1280 px: 0 desbordes, botones de 44 px, letra de 12 px o más, 0 errores. Video corto grabado para el dueño | ✅ |
| **Después de publicar (#38), tienda real** | Servicios 85 → 85; cola 33 → 33; `/api/admin/office` responde con los 6 (5 en su puesto, Wali apagado); panel `#oficina` a 390 px: 6 escritorios, 0 desbordes, 0 errores | ✅ |
| No probado | Revisión con axe (falta `axe-core` en este entorno) | ⚠️ |

## Tanda 11/11/2026 · Avisos solos + códigos solos (publicado en #37)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar los 2 equipos | **435 → 456 / 456 ✅** (~26 s) |
| Avisos solos | `test/avisos-solos.test.mjs` (12), con reloj controlado y push falso. Cubre 3 días, 1 día y el mismo día; uno por día sin repetir; agrupado; cliente de revendedor sin precio; link `/c/`: alta, baja y borrado al revocar, al borrar el perfil o al liberar el cupo; 410/404 borran; aislamiento; nada en el panel ni en las exportaciones. Navegador a 360 px | ✅ |
| Códigos solos | `test/codigos-solos.test.mjs` (9). Cubre la cuenta correcta; nada de más de 30 min ni de antes de entrar; interruptores del dueño y del revendedor; link revocado o borrado → 404; la respuesta no trae correo, contraseña ni cuerpo del mail; auditoría solo con ids; 429; cuentas propias. Navegador a 360 px | ✅ |
| Al integrar | Choques de imports en 5 archivos (se conservaron los dos lados). La lista cerrada de `/api/cobro` quedó con `alerts` y `codes` en las 3 pruebas que la comprueban | ✅ |
| Revisión en celular | `revision-celular.cjs` con `seed-reseller-demo` a 360/390/768, claro y oscuro: 0 desbordes y 0 textos cortados. Los botones y textos chicos que marca están en pantallas que esta tanda no tocó. Los equipos revisaron sus pantallas nuevas a 360/390 sin desborde ni errores | ✅ |
| **Después de publicar (#37), tienda real** | Servicios 85 → 85; cola de mensajes 33 → 33; USDT y tasa 11,71 sin cambios; conteo de avisos responde (0 enviados hoy, encendido); `/api/cobro/<link falso>/codes` → 404; tienda, /hub, /c/ y panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes y 0 errores. `/r/streaming-gabo` dice "no existe o no está publicada" porque esa página no está publicada (ya era así; #37 no la tocó) | ✅ |
| No probado | Recibir un aviso real en un Android o un iPhone (el navegador de prueba no se suscribe a Google ni a Apple); el lector IMAP real con códigos de verdad; la revisión de accesibilidad con axe, que no pudo correr (falta `axe-core` en el entorno) | ⚠️ |

## Tanda 11/11/2026 · Cargar sus cuentas + seguridad y plata + renovar con su revendedor (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar 2 equipos y los arreglos | **400 → 425 / 425 ✅** |
| Cargar sus cuentas | `test/cargar-vendidas.test.mjs` (10): vista previa con todos los casos, no cobra ni avisa, no duplica, no dice de quién es una cuenta ajena, revendedor en dólares → "Te paga US$", permisos, navegador a 360 px | ✅ |
| Seguridad y plata | `test/seguridad-plata.test.mjs` (12): todas las rutas `/api/me*` leídas del código y recorridas como cliente final en Bs y en US$; 16 intentos cruzados entre revendedores; precio en US$; monedas | ✅ (11 de 12 fallaban con el código anterior) |
| Ficha en US$ | `test/ficha-usd.test.mjs` | ✅ |
| Renovar con su revendedor | `test/renovar-con-revendedor.test.mjs` (2) + navegador: la clienta de Ariana ve "Renovar con Ariana Streaming" y "Ver su página", sin precio, 0 errores | ✅ |
| Afuera completo | `test/afuera-completo.test.mjs` (9): "7.300", Panamá, avisos a 3 días, aislamiento de cuentas propias, aviso diario con push falso (1 por día), Argentina en wa.me, navegador a 360 px para Paraguay, Panamá y Bolivia | ✅ (434/434 integrado) |
| **Después de publicar (#35), tienda real** | Servicios 85 → 85; cola 33 → 33; los 3 de afuera siguen en US$; tasa del BCB 11,71 (11/11); vista previa de "Cargar sus cuentas" responde (sin guardar); tienda, /hub y panel a 390 px: 0 desbordes, 0 errores | ✅ |
| Final integrado | Paraguay en la lista US$ a 360 px ve el aviso del tipo de cambio, sin desborde; panel del dueño sin desborde; tarjeta de la tasa en Inicio; 0 errores | ✅ |
| Al integrar | 1 choque de imports en `panel.js` (se conservaron los dos). Cruces arreglados: ficha en Bs para revendedor en US$; precio en US$ como nota | ✅ |


## Tanda 11/11/2026 · Lista en dólares + tasa del Banco Central (sin publicar)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` después de integrar el equipo y la tasa del BCB | **383 → 400 / 400 ✅** |
| Lista en dólares | `test/lista-dolares.test.mjs` (15): precios en US$, recarga USDT → US$, compra con saldo US$ 20 → 13, total en Bs con la tasa, la tasa cambia y el saldo no, renovaciones, devolución y "Era una prueba" en US$, ajuste del dueño, dashboard sin mezclar monedas, cambio de lista con saldo rechazado, sin tasa rechazado, permisos, navegador | ✅ |
| Tasa del BCB | `test/tasa-bcb.test.mjs` (2) con una copia de la página; además la página real de hoy da 11,71 (11/11/2026) y se leyó en vivo desde el panel de prueba | ✅ |
| Al integrar | sin choques. Corregido: productos a pedido decían "pagás con QR" a revendedores de afuera | ✅ |
| **Después de publicar (#34), tienda real** | Tasa del BCB prendida: 11,71 (11/11). Lista US$ creada; 1 revendedor primero y después 2 más. Cola 33 → 33, servicios 85 → 85. Recorrido de tienda, /hub y panel: 0 desbordes, 0 errores | ✅ |
| Celular | revendedor de Panamá en la lista US$ a 360 px: ve US$ 7 y recarga 20 USDT → US$ 20, sin QR, 0 desbordes, 0 errores | ✅ |


## Tanda 11/11/2026 · Otro país, cuentas propias, IPTV, USDT y revendedores cómodos (2 equipos + integración)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` antes de lanzar y después de integrar | **347 → 382 / 382 ✅** (0 saltadas) |
| Otro país | `test/otro-pais.test.mjs` (11): teléfonos +595 en todas sus formas, Bolivia igual que antes, ₲ sin decimales, ninguna cifra con dos monedas, `/r/` con y sin tipo de cambio, `/c/` en ₲ | ✅ |
| Cuentas propias | `test/cuentas-propias.test.mjs` (9): lista pegada con vista previa, sin doble asignación, renovar/liberar/pagado, contraseñas cifradas en el archivo de la base, permisos por HTTP, el dueño/admin/vendedor no ven nada (rutas `/api/admin/*`, Excel, auditoría), IPTV y prueba de 24 h | ✅ |
| USDT | `test/usdt-afuera.test.mjs`: recarga USDT solo si está configurado, se acredita en Bs; en el navegador Paraguay ve USDT primero, montos en USDT, sin QR; Bolivia igual que antes | ✅ |
| Vista previa y logos | `test/vista-previa.test.mjs` (8) + `test/revendedor-pantallas.test.mjs` (navegador): etiquetas por ruta, `/r/` no publicada genérica, `/c/` sin datos, escape, sin caché cruzada, logos en las pantallas | ✅ |
| Era una prueba | `test/era-prueba.test.mjs` (4) | ✅ |
| Dólar flexible | `test/usdt-afuera.test.mjs`: `rateAt` solo cambia si cambia la tasa; recarga en USDT calcula Bs con la tasa de hoy; cambiar la tasa no mueve lo ya pedido; compra en USDT fija su cotización; tarjeta de Inicio cambia la tasa con coma | ✅ 383/383 |
| Al integrar | 4 choques en `shop.js`, `app.ts` y `subLinks.ts` (logos de un equipo + moneda del otro en la misma línea): se conservaron los dos lados | 382/382 |
| Celular | Barrida del equipo: 166 → 0 problemas en las pantallas del revendedor; Paraguay a 360/390 claro y oscuro sin desborde; panel del dueño (Inicio, Control, Revendedores, Cómo van, Que vuelvan) sin desborde. Arreglado al integrar: botones de Control a 44 px y etiqueta a 12 px | ✅ (queda el deslizador del asesor de la tienda, que ya estaba) |

**Después de publicar (#33), tienda real:**
- "Era una prueba" se usó primero en 1 servicio (la cola de avisos siguió en 33) y después en los otros 4 pedidos: 6 servicios cerrados, Bs 100 fuera de los números.
- Servicios activos 91 → 85 (los 85 alquileres). La cuenta Disney de 7 perfiles y la Prime de 5 quedaron todas libres.
- Cómo van, este mes: Bs 241 → Bs 207.
- Recorrido de la tienda, /hub, /c/ inválido y el panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes, 0 errores.
- Vista previa de una /r/ no publicada: genérica ("Streaming hub").

**No se probó:** celular real, WhatsApp mostrando la vista previa (solo las etiquetas en el HTML), un pago real en USDT, `revision-accesibilidad.cjs` completo (el equipo lo corrió con axe en sus pantallas).


## Tanda 11/11/2026 · Cómo van cuenta los cobros del Control
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` | **347 / 347 ✅** (1 nueva) |
| Cobros del Control | `test/como-van.test.mjs` "cuenta lo marcado 💵 cobrado…": marca vieja en el inicio del período; marca nueva con fecha y monto; volver a pendiente la borra; mismo período una vez; con pedido no duplica; marca de octubre va al mes pasado; sin % gigante | ✅ |
| El revendedor no ve los cobros anotados | revisión de código: sus pantallas (`portal.ts`, `resellerTools.ts`) solo leen `control.price` | ✅ |
| Celular | `revision-celular.cjs` Cómo van a 360 y 390, claro y oscuro | 0 desbordes; únicos avisos en el asesor de la tienda (ya estaban) |
| Estimado con los datos reales (copia de solo lectura) | 27 alquileres marcados pagado | ~Bs 207 este mes (3) y ~Bs 1.537 en meses anteriores; los 57 sin marca no suman |
| **Después de publicar (#32), tienda real, solo lectura** | Cómo van por API y recorrido del panel a 390 px | Te pagaron este mes **Bs 34 → Bs 241**; mes pasado **Bs 0 → Bs 1.424** (menos que el estimado: no se duplicaron los que ya tenían pedido); Bs 948 de 30 días vienen del Control. Servicios 91 → 91, cola de avisos 33 → 33. Sin `paidLog`, `subs` ni contraseñas en la respuesta. 0 desbordes, 0 errores |


## Tanda 11/11/2026 · Vender más (3 equipos en paralelo)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` antes de lanzar y después de integrar los 3 equipos + el arreglo de transferencia | **315 → 346 / 346 ✅** (31 nuevas, 0 saltadas) |
| Que vuelvan | `test/winback.test.mjs` (15: cada caso que entra y no entra, 7/60 días con reloj, métrica, permisos por HTTP, sin costos ni correos) + `winback-panel.test.mjs` (navegador) | ✅ |
| Cómo van | `test/como-van.test.mjs` (7: borde de mes en hora de Bolivia, sin doble conteo, cada estado, permisos, JSON sin datos de clientes del revendedor) | ✅ |
| Link de cobro | `test/link-cobro.test.mjs` (8: camino feliz, aislamiento entre revendedores, 60+ respuestas del panel y 6 Excel sin el cuaderno ni tokens, revocar/borrar/renovar, límite por IP, navegador) | ✅ |
| Transferir no pasa el cuaderno | prueba en `link-cobro`: **falla sin el arreglo, pasa con él** | ✅ |
| Revisión en celular (integrado) | `revision-celular.cjs`, dueño: Inicio, Que vuelvan, Cómo van y Revendedores a 360/390/768, claro y oscuro; Atención: Inicio, Que vuelvan, Revendedores | Pantallas nuevas: **0 desbordes, 0 botones chicos, 0 textos chicos**. Revendedores: avisos que ya estaban (BACKLOG V11) |
| Por rol (integrado) | Playwright con datos de ejemplo: admin ve Cómo van y Que vuelvan; Atención no ve Cómo van; revendedora crea su link y la página /c/… se ve a 360/390 claro y oscuro; cliente final en la tienda | 0 errores de consola, 0 desbordes |

**Después de publicar (#31), en la tienda real y solo leyendo:** servicios 91 → 91, cuentas 125 → 125, revendedores 22 (16 sin PIN), cola de avisos 33 → 33. Tienda, /hub, link de cobro inválido (muestra "Este link ya no sirve") y panel (Inicio, Que vuelvan, Cómo van, Revendedores, Control) a 390 px: 0 desbordes, 0 errores. Las respuestas de Que vuelvan y Cómo van no traen `subs`, `rcontrol`, contraseñas ni costos de cuentas.

**No se probó:** celular real (guardar el QR manteniendo apretado, que abra WhatsApp), un QR bancario real, `revision-accesibilidad.cjs` (falta axe-core), datos reales de producción.

## Tanda 11/11/2026 · Cobro de alquileres (#29) y cuentas completas (#30)
| Qué | Cómo | Resultado |
|---|---|---|
| Pruebas automáticas | `npm test` en la rama `ccr-a0b95638-dpfc8j` (igual a producción + método de trabajo) | **314 / 314 ✅** en ~11 s |
| Renombrar perfil de cuenta completa no avisa | prueba en `test/store.test.mjs`; cambiar el PIN sí avisa | ✅ |
| Arreglo en la tienda real | respaldo previo → 1 perfil de prueba (cola de avisos 33 → 33) → todos | 54 renombrados, 28 retirados, 21 notas guardadas, 0 problemas |
| Verificación después | lectura del panel con la llave del asistente | 123 cuentas de alquiler con 1 perfil "Cuenta completa"; servicios activos 91 → 91; cola de avisos 33 → 33 |

| Invitar desde Inicio | `test/invitar-inicio.test.mjs` con navegador (Playwright): tarjeta con el número correcto, botón arma la fila, PIN, link de WhatsApp al número correcto, avanza sola, Anterior conserva el PIN, a quien no tocaste no se le genera PIN, Atención no la ve, 0 errores. WhatsApp bloqueado en la prueba | ✅ (en la CI se salta: no tiene navegador) |
| Revisión en celular | 360 y 390 px, claro y oscuro, datos de ejemplo | sin desborde ni errores |
| Total | `npm test` | **315 / 315 ✅** |

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
