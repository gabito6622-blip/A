// Ayudas chicas para el cliente final de la tienda (revisión «en el lugar del cliente», 20/11/2026).
//  - Error del pago junto al campo que falta: antes salía arriba de todo del carrito, fuera de la pantalla, y al
//    tocar «Finalizar pedido» parecía que no pasaba nada (y cada toque sumaba otro cartel rojo).
//  - Botones de la bandeja de códigos con el nombre del servicio («Netflix · nf02») y no solo «nf02», que el cliente no reconoce.
//  - Número de WhatsApp de la tienda legible: «+591 70000000» en vez de «+59170000000».
// Sin imports: se prueba también fuera del navegador.

/**
 * Muestra un solo error, junto al campo que falta (o arriba del botón de enviar si no hay campo), y lo trae a la vista.
 * `field`: el campo con problema (queda marcado con aria-invalid hasta que lo cambien).
 */
export function formError(form, msg, field = null) {
  if (!form) return null;
  form.querySelectorAll("[data-ferr]").forEach((x) => x.remove());
  form.querySelectorAll('[aria-invalid="true"]').forEach((x) => x.removeAttribute("aria-invalid"));
  const doc = form.ownerDocument;
  const box = doc.createElement("div");
  box.className = "err";
  box.setAttribute("role", "alert");
  box.dataset.ferr = "1";
  box.id = "ferr-" + (form.id || "form");
  box.textContent = msg;
  const spot = field?.closest?.("label") ?? field;
  if (spot && form.contains(spot)) {
    spot.after(box);
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", box.id);
    const clear = () => { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); box.remove(); };
    field.addEventListener("change", clear, { once: true });
    field.addEventListener("input", clear, { once: true });
  } else {
    const btn = form.querySelector('[type="submit"]');
    if (btn) btn.before(box); else form.append(box);
  }
  try { box.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* navegador viejo */ }
  return box;
}

/**
 * Nombre de cada botón de la bandeja de códigos. El cliente reconoce «Netflix», no «nf02»: va el servicio y, al lado,
 * el principio del correo (el mismo que ve en «Mis cuentas», y distingue dos cuentas del mismo servicio).
 * Sin servicio conocido, solo el principio del correo. `services`: [{ product, access: { email } }]; `codes`: [{ to, product }].
 */
export function mailChipLabels(mails, services = [], codes = []) {
  const clean = (p) => String(p ?? "").replace(/ \(alquiler revendedores\)/, "").trim();
  const prodOf = (e) => clean(services.find((a) => (a.access?.email ?? "").toLowerCase() === e)?.product ?? codes.find((c) => (c.to ?? "").toLowerCase() === e)?.product);
  return mails.map((e) => { const p = prodOf(e), u = e.split("@")[0]; return p ? `${p} · ${u}` : u; });
}

/** «59170000000» → «+591 70000000» (el código del país aparte, como se escribe en Bolivia); otros países, «+» y los números tal cual. */
export function prettyPhone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  const m = /^591(\d{8})$/.exec(d);
  return m ? `+591 ${m[1]}` : `+${d}`;
}
