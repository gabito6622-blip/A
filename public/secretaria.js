// "Mi secretaria": una pantalla del panel con todo lo pendiente (cobrar, cortar, quién debe, a quién avisar,
// qué desenlazar, qué está libre de verdad, qué está apartado) y lo último que pasó. Solo lee.
// Los mensajes de WhatsApp se arman listos (wa.me), pero los manda el dueño: nunca se envía nada solo.
import { api, esc, bs, fdt, fdate, waLink, toast, toCents, newKey } from "/common.js";
import { diaLine, cutTxt, supplierRenewHtml, cortadosSection } from "/dia.js";

const dm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }); // «13/01» (es-BO sin año daba «13/1»)
const usdTxt = (c) => `US$ ${(c / 100).toLocaleString("es-BO", { maximumFractionDigits: 2 })}`;
const itemMoney = (i) => (i.priceUsd !== undefined ? usdTxt(i.priceUsd) : bs(i.price));
const groupMoney = (g) => (g.usd && g.totalUsd !== undefined ? usdTxt(g.totalUsd) : bs(g.total));
const first = (name) => String(name).split(" · ").pop().split(" ")[0];
const when = (d) => (d < -1 ? `venció hace ${-d} días` : d === -1 ? "venció ayer" : d === 0 ? "vence hoy" : d === 1 ? "vence mañana" : `vence en ${d} días`);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/** Mensaje de WhatsApp listo para cada caso (lo manda el dueño). Si el dueño escribió el suyo en Configuración, se usa ese. */
let TPL = {};
let RL = false; // links de renovación prendidos (Configuración → Soporte)
function message(kind, g) {
  const lines = g.items.map((i) => `• ${i.email} (${i.days < 0 ? "venció" : "vence"} ${dm(i.expiresAt)})`).join("\n");
  const hi = `Hola ${first(g.name)} 👋`;
  const own = TPL[kind === "cobrar" || kind === "vencidas" ? "cobrar" : kind];
  if (own) return own.replace(/\{nombre\}/g, first(g.name)).replace(/\{cuentas\}/g, lines).replace(/\{total\}/g, groupMoney(g));
  if (kind === "deben") return `${hi} Te recuerdo que tengo pendiente el pago de estas cuentas:\n${lines}\nTotal: ${groupMoney(g)}. ¡Gracias! 🙌`;
  if (kind === "avisar") return `${hi} Te aviso que estas cuentas están por vencer:\n${lines}\nTotal para renovar: ${groupMoney(g)}. ¿Las renovás? 🙌`;
  return `${hi} Estas cuentas ya vencieron:\n${lines}\nTotal para renovar: ${groupMoney(g)}. ¿Las renovás? Si no, las tengo que dar de baja hoy.`;
}

/** Por qué no salió un recordatorio preparado. */
const PREP = { bot: "el bot está apagado", permiso: "no dio permiso de avisos", sin_numero: "no tiene WhatsApp", fallo: "falló el envío" };
const hm = (t) => new Date(t).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" });
const noticedTxt = (t, via) => `📣 ${via === "recordatorio" ? "recordatorio" : "avisado"} ${new Date(t).toDateString() === new Date().toDateString() ? `hoy ${hm(t)}` : dm(t)}`;
function groupCard(kind, g) {
  // «✅ Ya le avisé»: marca los que faltan de este grupo (no manda nada). Si ya están todos, ofrece deshacer.
  const pend = g.items.filter((i) => i.noticedAt === undefined), all = !pend.length;
  const msgG = all ? g : { ...g, items: pend, total: pend.reduce((s, i) => s + i.price, 0), ...(g.usd ? { totalUsd: pend.reduce((s, i) => s + (i.priceUsd ?? 0), 0) } : {}) };
  const wa = kind !== "cortar" && g.phone ? `<a class="pbtn sm" href="${esc(waLink(g.phone, message(kind, msgG)))}" target="_blank" rel="noopener">📲 Mensaje listo</a>` : "";
  const avise = kind === "cortar" ? "" : all
    ? `<button type="button" class="pbtn sm" data-secnotice="${esc(g.items.map((i) => i.assignmentId).join(","))}" data-off="1" title="Vuelve a la lista de pendientes">↩️ No le avisé</button>`
    : `<button type="button" class="pbtn sm green" data-secnotice="${esc(pend.map((i) => i.assignmentId).join(","))}" data-name="${esc(first(g.name))}">✅ Ya le avisé</button>`;
  // «Me pagó lo que debía» (venta fiada o pendiente) NO corre la fecha; «Me pagó y renueva» sí (revisión de 3 meses).
  const debt = (i) => i.payStatus === "pendiente" || i.payStatus === "no_pago";
  const payBtns = (i) => debt(i)
    ? `<span class="sec-paybtns"><button type="button" class="pbtn sm green sec-pay" data-secdebt="${esc(i.assignmentId)}" data-price="${i.price}">💵 Me pagó lo que debía</button><button type="button" class="pbtn sm sec-pay" data-secpay="${esc(i.assignmentId)}" title="Te pagó el mes siguiente: corre la fecha">🔄 Me pagó y renueva</button></span>`
    : `<button type="button" class="pbtn sm green sec-pay" data-secpay="${esc(i.assignmentId)}">💵 Me pagó</button>`;
  const items = g.items.map((i) => `<li data-secitem="${esc(i.assignmentId)}"><span class="sec-mail">${esc(i.email || i.product)}</span><span class="sec-meta">${esc(when(i.days))} · ${dm(i.expiresAt)} · ${itemMoney(i)}${i.payStatus === "pagado" && kind === "avisar" ? " · pagada" : debt(i) ? ` · <b class="sec-debt">debe</b>` : ""}${i.noticedAt !== undefined ? ` · <span class="sec-noticed">${noticedTxt(i.noticedAt, i.noticedVia)}</span>` : ""}${cutTxt(i.cutAt) ? ` · <span class="sec-cut">${cutTxt(i.cutAt)}</span>` : ""}</span>${i.prepared ? `<span class="sec-prep">📝 Aviso preparado, no salió (${esc(PREP[i.prepared.why] ?? "no salió")}): mandalo vos con «📲 Mensaje listo» y tocá «✅ Ya le avisé».</span>` : ""}${payBtns(i)}${RL && !i.viaReseller ? `<button type="button" class="pbtn sm sec-pay" data-seclink="${esc(i.assignmentId)}" title="Link para que renueve con QR o saldo">🔗 Link para renovar</button>` : ""}<div class="sec-pv" hidden></div></li>`).join("");
  return `<div class="sec-group${all && kind !== "cortar" ? " sec-done" : ""}">
    <div class="sec-gh"><b>${esc(g.name)}</b><span class="sec-tot">${plural(g.items.length, "cuenta", "cuentas")} · ${groupMoney(g)}</span></div>
    ${g.note ? `<small class="muted sec-rule">📝 ${esc(g.note)}</small>` : ""}
    <ul class="sec-items">${items}</ul>
    <div class="inline sec-actions">${wa}${avise}${!g.phone && kind !== "cortar" ? `<small class="muted">Sin número en su ficha</small>` : ""}</div></div>`;
}

/** Cuántos grupos se ven de entrada en cada sección; el resto, detrás de «Ver N más» (celular primero). */
const SHOW = 6;
/** Sección plegable: lo urgente abierto, lo demás cerrado con el número a la vista. Nada se quita. */
export function fold(id, title, n, body, open) {
  return `<details class="card sec-card sec-fold" id="${id}"${open ? " open" : ""}><summary><h2>${title}${n ? ` <span class="sec-n">${n}</span>` : ""}</h2></summary>${body}</details>`;
}
function section(id, title, hint, groups, kind) {
  if (!groups.length) return "";
  const cards = groups.map((g) => groupCard(kind, g));
  const body = `${hint ? `<p class="muted" style="margin:0">${hint}</p>` : ""}${cards.slice(0, SHOW).join("")}${cards.length > SHOW ? `<details class="sec-more sec-vermas"><summary>Ver ${cards.length - SHOW} más</summary>${cards.slice(SHOW).join("")}</details>` : ""}`;
  return fold(id, title, groups.reduce((s, g) => s + g.items.length, 0), body, true);
}

const accRows = (list, extra) => `<ul class="sec-items">${list.map((a) => `<li><span class="sec-mail">${esc(a.email)}</span><span class="sec-meta">${esc(a.product)}${extra ? ` · ${extra(a)}` : ""}</span></li>`).join("")}</ul>`;

/**
 * Pantalla completa. `activity(list)` arma las filas de "lo que pasó" con el mismo texto que la Auditoría
 * (lo pone panel.js, que tiene los nombres); si no hay permiso llega `null` y la sección no aparece.
 */
export async function secretaryView(activity) {
  const r = await api("GET", "/api/admin/secretaria");
  TPL = r.templates ?? {};
  RL = !!r.renewLinks;
  const c = r.counts;
  const todo = (r.cortados?.length ?? 0) + (c.proveedores ?? 0) + c.cobrar + c.cortar + c.deben + c.sinAnotar + c.avisar + c.desenlazar + c.apartadas + c.faltaFecha + (c.claves ?? 0) + (c.debitos ?? 0);
  const resumen = [
    diaLine(r.dia), r.cortados?.length && `✂️ <b>${r.cortados.length}</b> se cortaron solos (podés reactivarlos)`, c.cobrar && `🔔 <b>${c.cobrar}</b> en cobro`, c.cortar && `✂️ <b>${c.cortar}</b> por cortar`, c.sinAnotar && `🗓️ <b>${c.sinAnotar}</b> vencidas sin anotar`,
    c.proveedores && `🏷️ <b>${c.proveedores}</b> proveedor${c.proveedores === 1 ? "" : "es"} por renovar`, c.deben && `💸 <b>${c.deben}</b> sin pagar`, c.avisar && `⏰ <b>${c.avisar}</b> por avisar (vencen en ${r.aheadDays} días)`, c.avisados && `📣 <b>${c.avisados}</b> ya avisados`, c.desenlazar && `🔗 <b>${c.desenlazar}</b> por desenlazar`,
    c.apartadas && `⏸️ <b>${c.apartadas}</b> apartadas`, c.claves && `🔑 <b>${c.claves}</b> claves por cambiar`, c.debitos && `💳 <b>${c.debitos}</b> débitos de tarjeta`, `✅ <b>${c.libres}</b> libres listas`,
  ].filter(Boolean);
  // Avisos automáticos: si no salen, se dice en una línea (antes figuraban «avisados» aunque el bot estuviera apagado).
  const av = r.avisosAuto ?? {};
  const botLine = av.enabled && av.bot === false ? `<p class="sec-botoff" role="status">⚠️ Los avisos automáticos no salen: el bot está apagado.${c.preparados ? ` Tenés <b>${c.preparados}</b> preparado${c.preparados === 1 ? "" : "s"} para mandar vos.` : ""}</p>`
    : c.preparados ? `<p class="sec-botoff" role="status">⚠️ <b>${c.preparados}</b> aviso${c.preparados === 1 ? "" : "s"} no salió (sin permiso del cliente o sin WhatsApp): mandalos vos.</p>` : "";
  const hero = `<section class="card sec-hero"><h2>🗂️ Mi secretaria <small>revisé tu panel ${fdt(r.at)}</small></h2>
    ${botLine}
    <p style="margin:0">${todo ? "Esto es lo que tenés pendiente:" : "🎉 Todo al día: no tenés nada pendiente ahora."}</p>
    <ul class="sec-sum">${resumen.map((x) => `<li>${x}</li>`).join("")}</ul>
    <div class="inline"><button class="pbtn dark" type="button" data-go="secretaria">🔄 Revisar de nuevo</button></div>
    <small class="muted">Solo leo tu panel: no cambio nada ni mando mensajes. Los botones «Mensaje listo» abren tu WhatsApp con el texto armado; lo mandás vos.</small></section>`;

  // Lo que no es de hoy va plegado (con el número a la vista): así lo urgente queda arriba en el celular.
  const nLibres = r.libres.listas.length + r.libres.faltaFecha.length;
  const libres = nLibres ? fold("sec-libres", "✅ Libres de verdad", nLibres, `
      ${r.libres.listas.length ? `<p class="muted" style="margin:0">Listas para vender:</p>${accRows(r.libres.listas, (a) => (a.free > 1 ? `${a.free} perfiles libres` : "libre"))}` : ""}
      ${r.libres.faltaFecha.length ? `<p class="muted" style="margin:0">Libres, pero el proveedor figura vencido: poné la fecha nueva para poder venderlas.</p>${accRows(r.libres.faltaFecha, (a) => `proveedor ${dm(a.supplierExpiresAt)}`)}` : ""}`, false) : "";
  const desen = r.desenlazar.length ? fold("sec-desenlazar", "🔗 Desenlazar del correo del revendedor", r.desenlazar.length, `
      <p class="muted" style="margin:0">Antes de venderlas otra vez, sacalas del correo del revendedor anterior.</p>${accRows(r.desenlazar, (a) => esc(a.note.replace(/^.*?(DESENLAZAR[^.]*)\.?.*$/i, "$1")))}`, false) : "";
  // Apartadas: de quién era cada perfil y «✅ Liberar» de a uno (1 toque + confirmación).
  const apart = r.apartadas.length ? fold("sec-apartadas", "⏸️ Apartadas (en cuarentena)", r.apartadas.reduce((s, a) => s + a.count, 0), `
      <p class="muted" style="margin:0">No se venden hasta que las revises (por ejemplo, cambiar la clave). Cuando esté lista, tocá «✅ Liberar».</p>
      <ul class="sec-items">${r.apartadas.map((a) => `<li><span class="sec-mail">${esc(a.email)}</span><span class="sec-meta">${esc(a.product)}${a.note ? ` · ${esc(a.note.slice(0, 120))}` : ""}</span>
        ${(a.slots ?? []).map((sl) => `<div class="sec-slot"><span class="sec-meta"><b>${esc(sl.label)}</b>${sl.exName ? ` · era de <b>${esc(sl.exName)}</b>${sl.exAt ? ` (${dm(sl.exAt)})` : ""}` : ""}</span><button type="button" class="pbtn sm green" data-secfree="${esc(sl.slotId)}" data-what="${esc(`${a.email} · ${sl.label}${sl.exName ? ` (era de ${sl.exName})` : ""}`)}">✅ Liberar</button></div>`).join("")}</li>`).join("")}</ul>`, false) : "";
  const claves = r.claves?.length ? fold("sec-claves", "🔑 Claves por cambiar", r.claves.length, `
      <p class="muted" style="margin:0">La nota pide cambiar la clave o hacer seguimiento. Cambiala desde Cuentas con «Cambié la clave»: queda la fecha y se avisa a sus clientes.</p>${accRows(r.claves, (a) => `${a.clients ? `${a.clients} cliente${a.clients === 1 ? "" : "s"} · ` : ""}${a.passwordChangedAt ? `última clave ${dm(a.passwordChangedAt)}` : "nunca cambiada acá"}`)}`, false) : "";
  const debitos = r.debitos?.length ? fold("sec-debitos", "💳 Débitos de tarjeta", r.debitos.length, `
      <p class="muted" style="margin:0">Cuentas con autopago que se cobran estos días. Cuando veas el débito, anotalo en Cuentas con «Pagué la renovación»: así Finanzas y el vencimiento quedan bien.</p>${accRows(r.debitos, (a) => `se debita el ${dm(a.supplierExpiresAt)}${a.costUsd ? ` · US$ ${(a.costUsd / 100).toFixed(2)}` : a.cost ? ` · ${bs(a.cost)}` : ""}`)}`, false) : "";
  // Decisión (b): cobros anotados que pasan la fecha del proveedor. Arriba y abierto si alguno vence en 3 días o menos.
  const soon = (r.proveedores ?? []).some((x) => x.supplierExpiresAt - Date.now() <= 3 * 864e5);
  const prov = r.proveedores?.length ? fold("sec-proveedores", "🏷️ Proveedores por renovar", r.proveedores.length, `
      <p class="muted" style="margin:0">Anotaste cobros que pasan la fecha del proveedor: renová estas cuentas antes de esa fecha, si no tus clientes se quedan sin servicio.</p>
      <ul class="sec-items">${r.proveedores.map((x) => `<li><span class="sec-mail">${esc(x.email)}</span><span class="sec-meta">${esc(x.product)} · <b class="sec-cut">renová antes del ${dm(x.supplierExpiresAt)}</b> · ${plural(x.clients.length, "cliente va", "clientes van")} hasta el ${dm(x.until)}</span><span class="sec-meta">${x.clients.slice(0, 4).map((c) => esc(c.name)).join(", ")}${x.clients.length > 4 ? ` y ${x.clients.length - 4} más` : ""}</span><button type="button" class="pbtn sm sec-pay" data-go="cuentas">🔑 Ir a Cuentas («Pagué la renovación»)</button></li>`).join("")}</ul>`, soon) : "";
  const act = r.actividad ? `<section class="card sec-card" id="sec-actividad"><h2>🕑 Lo que pasó en las últimas 24 horas</h2>
      ${r.actividad.length ? `<details class="sec-more"><summary>Ver los ${r.actividad.length} movimientos</summary>${activity(r.actividad)}</details>` : `<p class="muted" style="margin:0">No hubo movimientos.</p>`}</section>` : "";

  return hero
    + (soon ? prov : "")
    + section("sec-cobrar", "🔔 Cobrar ahora", "Están en cobro: si no pagan, se cortan.", r.cobrar, "cobrar")
    + section("sec-cortar", "✂️ Cortar", "No pagaron. Cortalas, cambiá la clave y anotala libre.", r.cortar, "cortar")
    + cortadosSection(r.cortados)
    + section("sec-vencidas", "🗓️ Vencidas sin anotar", "Ya vencieron y no tienen nota: ¿renovaron, las cobrás o las cortás?", r.sinAnotar, "vencidas")
    + section("sec-deben", "💸 Te deben", "Siguen activas pero figuran sin pagar.", r.deben, "deben")
    + section("sec-avisar", `⏰ Avisar: vencen en los próximos ${r.aheadDays} días`, "Mirá la regla de cada uno (📝) para saber cuándo avisarle.", r.avisar, "avisar")
    + (soon ? "" : prov) + debitos + desen + libres + apart + claves + act;
}


/* ---------------- «Me pagó» con vista previa (optimización 1) ---------------- */
// 1) Tocás «Me pagó» → se pide la vista previa al servidor y se muestra debajo: cliente, cuenta, monto, período y fecha nueva.
// 2) Si hay un freno (período ya cobrado, pasa la fecha del proveedor) no hay botón de confirmar.
// 3) «Confirmar» guarda una sola vez (llave de idempotencia) y vuelve a dibujar la secretaria.
const money = (pv) => (pv.priceUsd !== undefined ? `${usdTxt(pv.priceUsd)} (≈ ${bs(pv.price)})` : bs(pv.price));
function previewHtml(pv, key) {
  const rows = [["Cliente", `${esc(pv.customer.name)}${pv.payer.id !== pv.customer.id ? ` · paga ${esc(pv.payer.name)}${pv.payer.isReseller ? " (revendedor)" : ""}` : ""}`],
    ["Cuenta", `<span class="sec-mail">${esc(pv.email)}</span>${pv.profile ? ` · ${esc(pv.profile)}` : ""} · ${esc(pv.product)}`],
    ["Monto", `<b>${money(pv)}</b> por ${pv.periods} período${pv.periods === 1 ? "" : "s"} (${pv.days} días)`],
    ["Período", `del <b>${fdate(pv.from)}</b> al <b>${fdate(pv.to)}</b>${pv.expiredDays ? ` <small class="muted">(venció hace ${pv.expiredDays} d: arranca hoy)</small>` : ""}`],
    ["Fecha nueva", `<b>${fdate(pv.to)}</b> <small class="muted">· proveedor: ${pv.supplierNoDate ? "sin fecha" : fdate(pv.supplierExpiresAt)}</small>`]];
  return `<div class="sec-pvbox">
    <table class="sec-pvt">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
    ${pv.blockers.map((b) => `<p class="sec-block">⛔ ${esc(b)}</p>`).join("")}${pv.warnings.map((w) => `<p class="sec-warn">⚠️ ${esc(w)}</p>`).join("")}
    ${pv.supplierWarn ? `<p class="sec-warn sec-supwarn">${esc(pv.supplierWarn.text)}</p>` : ""}
    ${pv.doubleCharge ? `<p class="sec-block sec-double">🔁 ${esc(pv.doubleCharge.text)}</p><label class="chk sec-otro"><input type="checkbox" name="otro"> Sí, es otro mes: anotarlo igual</label>` : ""}
    ${supplierRenewHtml(pv)}
    <div class="inline sec-pvact">${pv.ok ? `<label class="sec-price">Cobré (${pv.priceUsd !== undefined ? "Bs, lo que llegó" : "Bs"})<input name="price" inputmode="decimal" value="${(pv.price / 100).toFixed(2)}"></label>
      <button type="button" class="pbtn green" data-secpayok="${esc(pv.assignmentId)}" data-key="${esc(key)}">✅ Confirmar: me pagó</button>` : ""}<button type="button" class="pbtn" data-secpayno="1">Cancelar</button></div></div>`;
}
if (typeof document !== "undefined") document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-secpay],[data-secpayok],[data-secpayno],[data-seclink],[data-secnotice],[data-secdebt],[data-secdebtok],[data-secfree]");
  if (!b) return;
  if (b.dataset.secfree) {
    // «✅ Liberar» un perfil apartado: 1 toque + confirmación. Vuelve a estar libre para vender.
    if (!confirm(`¿Liberar ${b.dataset.what}?\n\nVuelve a estar libre para vender. Hacelo solo si ya le cambiaste la clave o lo revisaste.`)) return;
    b.disabled = true;
    try {
      await api("POST", `/api/admin/slots/${b.dataset.secfree}/free`, { reason: "revisado en Mi secretaria" });
      toast("✅ Perfil libre para vender");
      document.querySelector('[data-go="secretaria"]')?.click();
    } catch (e) { toast(e.message); b.disabled = false; }
    return;
  }
  if (b.dataset.secdebt) {
    // «Me pagó lo que debía»: confirma el monto; la fecha NO cambia.
    const li = b.closest("li[data-secitem]"), box = li?.querySelector(".sec-pv");
    if (!box) return;
    const exp = li.querySelector(".sec-meta")?.textContent.match(/\d{2}\/\d{2}/)?.[0] ?? "";
    box.innerHTML = `<div class="sec-pvbox"><p style="margin:0">Marca como <b>pagado</b> lo que debía. <b>La fecha no cambia</b>${exp ? `: sigue venciendo el ${exp}` : ""}.</p>
      <div class="inline sec-pvact"><label class="sec-price">Me pagó (Bs)<input name="price" inputmode="decimal" value="${(+b.dataset.price / 100).toFixed(2)}"></label>
      <button type="button" class="pbtn green" data-secdebtok="${esc(b.dataset.secdebt)}" data-key="${esc(newKey())}">✅ Confirmar: pagó lo que debía</button><button type="button" class="pbtn" data-secpayno="1">Cancelar</button></div></div>`;
    box.hidden = false;
    return;
  }
  if (b.dataset.secdebtok) {
    const box = b.closest(".sec-pv");
    const price = toCents(box?.querySelector('[name="price"]')?.value || "0");
    b.disabled = true;
    try {
      const r = await api("POST", `/api/admin/assignments/${b.dataset.secdebtok}/pay-debt`, { price, idempotencyKey: b.dataset.key });
      toast(`💵 ${r.customer.name} pagó lo que debía (${bs(r.saved.price)}). Sigue venciendo el ${fdate(r.saved.expiresAt)}`);
      document.querySelector('[data-go="secretaria"]')?.click();
    } catch (e) { toast(e.message); b.disabled = false; }
    return;
  }
  if (b.dataset.secnotice) {
    b.disabled = true;
    try {
      const off = b.dataset.off === "1";
      const r = await api("POST", "/api/admin/assignments/notified", { ids: b.dataset.secnotice.split(","), ...(off ? { off: true } : {}) });
      toast(off ? "Vuelve a pendientes" : `📣 Anotado: ya le avisaste${b.dataset.name ? ` a ${b.dataset.name}` : ""} (${r.ids.length} cuenta${r.ids.length === 1 ? "" : "s"})`);
      document.querySelector('[data-go="secretaria"]')?.click();
    } catch (e) { toast(e.message); b.disabled = false; }
    return;
  }
  if (b.dataset.seclink) {
    b.disabled = true;
    try {
      const r = await api("POST", `/api/admin/assignments/${b.dataset.seclink}/renew-link`, {});
      let copied = false;
      try { await navigator.clipboard.writeText(r.url); copied = true; } catch { /* sin permiso: se muestra para copiar a mano */ }
      const box = b.closest("li[data-secitem]")?.querySelector(".sec-pv");
      if (box) { box.innerHTML = `<p class="sec-warn" style="overflow-wrap:anywhere">🔗 ${copied ? "Link copiado" : "Link"} (vale hasta el ${fdt(r.expiresAt)}): <code>${esc(r.url)}</code> <button type="button" class="pbtn sm" data-copy="${esc(r.url)}">Copiar</button></p>`; box.hidden = false; }
      toast(copied ? "Link copiado: pegalo en el WhatsApp del cliente" : "Link generado");
    } catch (e) { toast(e.message); } finally { b.disabled = false; }
    return;
  }
  const li = b.closest("li[data-secitem]"); const box = li?.querySelector(".sec-pv");
  if (!box) return;
  if (b.dataset.secpayno) { box.hidden = true; box.innerHTML = ""; return; }
  if (b.dataset.secpay) {
    b.disabled = true;
    try {
      const pv = await api("GET", `/api/admin/assignments/${b.dataset.secpay}/pay-preview`);
      box.innerHTML = previewHtml(pv, newKey()); box.hidden = false;
      box.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (e) { toast(e.message); } finally { b.disabled = false; }
    return;
  }
  // Confirmar
  const price = toCents(box.querySelector('[name="price"]')?.value || "0");
  const otro = box.querySelector('[name="otro"]');
  if (otro && !otro.checked) { otro.closest("label")?.classList.add("need"); otro.focus(); toast("Ya hay un cobro en este período: marcá «Sí, es otro mes» si te pagó otro mes"); return; }
  b.disabled = true;
  try {
    const r = await api("POST", `/api/admin/assignments/${b.dataset.secpayok}/pay`, { periods: 1, price, idempotencyKey: b.dataset.key, ...(otro?.checked ? { confirmOther: true } : {}) });
    toast(`💵 Cobro guardado: ${r.customer.name} hasta el ${fdate(r.saved.to)} (${bs(r.saved.price)})${r.saved.supplierWarn ? " · ⚠️ renová el proveedor" : ""}`);
    document.querySelector('[data-go="secretaria"]')?.click();
  } catch (e) { toast(e.message); b.disabled = false; }
});
