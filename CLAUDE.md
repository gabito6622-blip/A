# Notas para Claude

## Videos promocionales (Gabriel Store, GaboHub, Barbiño)

Pedido del dueño: los videos tienen que mostrar una tienda **bonita y bien armada**, no la demo pelada.
Antes de sacar capturas, prepará la copia local de prueba para que parezca una tienda real con meses de uso:

- **Logo y marca:** logo de la tienda y de la revendedora cargados (no la letra sola), banner, colores y textos propios.
- **Productos con imagen:** cada app con su imagen o logo propio (diseño original, sin copiar logos de terceros);
  nada de cuadrados con una letra («C», «D», «N»).
- **Todo con stock:** combos incluidos. Ninguna tarjeta «Agotado» ni «A pedido» en pantalla.
- **Pagos completos:** QR de cobro cargado (uno de ejemplo), métodos de pago y nota de pago llenos.
  Que no aparezca ningún aviso de «todavía no cargó…».
- **Secciones llenas:** reseñas o testimonios, combos con descuento, cupones, códigos recibidos en la bandeja,
  movimientos de saldo con textos claros (sin ids tipo `cus_01164`).
- **Datos creíbles:** nombres, correos y montos realistas, siempre ficticios. Nada de «localhost», «demo» ni
  «proveedor.lat» a la vista.
- **Revisá cada pantalla** antes de renderizar (capturas sueltas con `--stills`) y corregí lo que se vea vacío o a medio armar.

El formato base está en `promo/gabohub/` (README con guion, capturas, música y render).
