---
name: gabostore-ux-premium
description: Diseñar y revisar pantallas de la tienda, GaboHub y el panel de Gabriel Store: celular primero, en español simple, accesibles y coherentes entre vistas.
---

# Diseño de producto, celular primero

Gabriel Store vende suscripciones (Netflix, Disney+, IPTV…) a clientes y revendedores de Bolivia, Panamá y Paraguay. Otras plataformas son referencia de funciones, no de diseño para copiar.

1. Celular primero: el dueño tiene que poder vender, aprobar un pago, renovar y mandar accesos por WhatsApp en pocos toques; el cliente, comprar y ver sus accesos sin ayuda.
2. Reglas de la casa: nada cortado ni pegado a los bordes; fechas dd/mm; letra mínima 12 px; botones y enlaces de 44 px; secciones largas en tarjetas plegables; textos en voseo y frases simples (la auditoría también).
3. Estados completos: vacío, cargando, error con qué hacer, éxito y confirmación clara en todo lo que mueve plata (pagos, saldo, devoluciones, cupones).
4. Contraste AA (4,5:1; 3:1 en texto grande), foco visible, etiquetas en todos los campos, uso con teclado. Los colores que elige cada tienda pasan por `lookColors`/`ensureContrast` de `public/common.js`.
5. Montos con el símbolo configurado (`currencySym()`/`bs()`), nombres largos, varios países. El estilo de cada revendedor no se filtra a otra página.
6. Usá los componentes y clases que ya existen (`.card`, `.pbtn`, `.pp`, `table()`); nada de librerías de diseño nuevas. No copies logos, código ni diseños de terceros.
7. Verificá con `scripts/revision-celular.cjs` y `scripts/revision-accesibilidad.cjs` y mostrá capturas antes/después.

Mostrá qué flujo mejoraste, capturas y criterios verificables en celular y computadora.
