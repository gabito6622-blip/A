// "Mi secretaria": una pantalla del panel con todo lo pendiente (cobrar, cortar, quién debe, a quién avisar,
// qué desenlazar, qué está libre de verdad, qué está apartado) y lo último que pasó. Solo lee.
// Los mensajes de WhatsApp se arman listos (wa.me), pero los manda el dueño: nunca se envía nada solo.
import { api, esc, bs, fdt, waLink } from "/common.js";

const dm = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
const usdTxt = (c) => `US$ ${(c / 100).toLocaleString("es-BO", { maximumFractionDigits: 2 })}`;
const itemMoney = (i) => (i.priceUsd !== undefined ? usdTxt(i.priceUsd) : bs(i.price));
const groupMoney = (g) => (g.usd && g.totalUsd !== undefined ? usdTxt(g.totalUsd) : bs(g.total));
const first = (name) => String(name).split(" · ").pop().split(" ")[0];
const when = (d) => (d < -1 ? `venció hace ${-d} días` : d === -1 ? "venció ayer" : d === 0 ? "vence hoy" : d === 1 ? "vence mañana" : `vence en ${d} días`);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

/** Mensaje de WhatsApp listo para cada caso (lo manda el dueño). Si el dueño escribió el suyo en Configuración, se usa ese. */
let TPL = {};
function message(kind, g) {
  const lines = g.items.map((i) => `• ${i.email} (${i.days < 0 ? "venció" : "vence"} ${dm(i.expiresAt)})`).join("\n");
  const hi = `Hola ${first(g.name)} 👋`;
  const own = TPL[kind === "cobrar" || kind === "vencidas" ? "cobrar" : kind];
  if (own) return own.replace(/\{nombre\}/g, first(g.name)).replace(/\{cuentas\}/g, lines).replace(/\{total\}/g, groupMoney(g));
  if (kind === "deben") return `${hi} Te recuerdo que tengo pendiente el pago de estas cuentas:\n${lines}\nTotal: ${groupMoney(g)}. ¡Gracias! 🙌`;
  if (kind === "avisar") return `${hi} Te aviso que estas cuentas están por vencer:\n${lines}\nTotal para renovar: ${groupMoney(g)}. ¿Las renovás? 🙌`;
  return `${hi} Estas cuentas ya vencieron:\n${lines}\nTotal para renovar: ${groupMoney(g)}. ¿Las renovás? Si no, las tengo que dar de baja hoy.`;
}

function groupCard(kind, g) {
  const wa = kind !== "cortar" && g.phone ? `<a class="pbtn sm" href="${esc(waLink(g.phone, message(kind, g)))}" target="_blank" rel="noopener">📲 Mensaje listo</a>` : "";
  const items = g.items.map((i) => `<li><span class="sec-mail">${esc(i.email || i.product)}</span><span class="sec-meta">${esc(when(i.days))} · ${dm(i.expiresAt)} · ${itemMoney(i)}${i.payStatus === "pagado" && kind === "avisar" ? " · pagada" : ""}</span></li>`).join("");
  return `<div class="sec-group">
    <div class="sec-gh"><b>${esc(g.name)}</b><span class="sec-tot">${plural(g.items.length, "cuenta", "cuentas")} · ${groupMoney(g)}</span></div>
    ${g.note ? `<small class="muted sec-rule">📝 ${esc(g.note)}</small>` : ""}
    <ul class="sec-items">${items}</ul>
    <div class="inline sec-actions">${wa}${!g.phone && kind !== "cortar" ? `<small class="muted">Sin número en su ficha</small>` : ""}</div></div>`;
}

function section(id, title, hint, groups, kind) {
  if (!groups.length) return "";
  return `<section class="card sec-card" id="${id}"><h2>${title}</h2>${hint ? `<p class="muted" style="margin:0">${hint}</p>` : ""}${groups.map((g) => groupCard(kind, g)).join("")}</section>`;
}

const accRows = (list, extra) => `<ul class="sec-items">${list.map((a) => `<li><span class="sec-mail">${esc(a.email)}</span><span class="sec-meta">${esc(a.product)}${extra ? ` · ${extra(a)}` : ""}</span></li>`).join("")}</ul>`;

/**
 * Pantalla completa. `activity(list)` arma las filas de "lo que pasó" con el mismo texto que la Auditoría
 * (lo pone panel.js, que tiene los nombres); si no hay permiso llega `null` y la sección no aparece.
 */
export async function secretaryView(activity) {
  const r = await api("GET", "/api/admin/secretaria");
  TPL = r.templates ?? {};
  const c = r.counts;
  const todo = c.cobrar + c.cortar + c.deben + c.sinAnotar + c.avisar + c.desenlazar + c.apartadas + c.faltaFecha + (c.claves ?? 0) + (c.debitos ?? 0);
  const resumen = [
    c.cobrar && `🔔 <b>${c.cobrar}</b> en cobro`, c.cortar && `✂️ <b>${c.cortar}</b> por cortar`, c.sinAnotar && `🗓️ <b>${c.sinAnotar}</b> vencidas sin anotar`,
    c.deben && `💸 <b>${c.deben}</b> sin pagar`, c.avisar && `⏰ <b>${c.avisar}</b> vencen en ${r.aheadDays} días`, c.desenlazar && `🔗 <b>${c.desenlazar}</b> por desenlazar`,
    c.apartadas && `⏸️ <b>${c.apartadas}</b> apartadas`, c.claves && `🔑 <b>${c.claves}</b> claves por cambiar`, c.debitos && `💳 <b>${c.debitos}</b> débitos de tarjeta`, `✅ <b>${c.libres}</b> libres listas`,
  ].filter(Boolean);
  const hero = `<section class="card sec-hero"><h2>🗂️ Mi secretaria <small>revisé tu panel ${fdt(r.at)}</small></h2>
    <p style="margin:0">${todo ? "Esto es lo que tenés pendiente:" : "🎉 Todo al día: no tenés nada pendiente ahora."}</p>
    <ul class="sec-sum">${resumen.map((x) => `<li>${x}</li>`).join("")}</ul>
    <div class="inline"><button class="pbtn dark" type="button" data-go="secretaria">🔄 Revisar de nuevo</button></div>
    <small class="muted">Solo leo tu panel: no cambio nada ni mando mensajes. Los botones «Mensaje listo» abren tu WhatsApp con el texto armado; lo mandás vos.</small></section>`;

  const libres = r.libres.listas.length || r.libres.faltaFecha.length ? `<section class="card sec-card" id="sec-libres"><h2>✅ Libres de verdad</h2>
      ${r.libres.listas.length ? `<p class="muted" style="margin:0">Listas para vender:</p>${accRows(r.libres.listas, (a) => (a.free > 1 ? `${a.free} perfiles libres` : "libre"))}` : ""}
      ${r.libres.faltaFecha.length ? `<p class="muted" style="margin:0">Libres, pero el proveedor figura vencido: poné la fecha nueva para poder venderlas.</p>${accRows(r.libres.faltaFecha, (a) => `proveedor ${dm(a.supplierExpiresAt)}`)}` : ""}</section>` : "";
  const desen = r.desenlazar.length ? `<section class="card sec-card" id="sec-desenlazar"><h2>🔗 Desenlazar del correo del revendedor</h2>
      <p class="muted" style="margin:0">Antes de venderlas otra vez, sacalas del correo del revendedor anterior.</p>${accRows(r.desenlazar, (a) => esc(a.note.replace(/^.*?(DESENLAZAR[^.]*)\.?.*$/i, "$1")))}</section>` : "";
  const apart = r.apartadas.length ? `<section class="card sec-card" id="sec-apartadas"><h2>⏸️ Apartadas (en cuarentena)</h2>
      <p class="muted" style="margin:0">No se venden hasta que las revises (por ejemplo, cambiar la clave).</p>${accRows(r.apartadas, (a) => esc((a.note || "sin nota").slice(0, 120)))}</section>` : "";
  const claves = r.claves?.length ? `<section class="card sec-card" id="sec-claves"><h2>🔑 Claves por cambiar</h2>
      <p class="muted" style="margin:0">La nota pide cambiar la clave o hacer seguimiento. Cambiala desde Cuentas con «Cambié la clave»: queda la fecha y se avisa a sus clientes.</p>${accRows(r.claves, (a) => `${a.clients ? `${a.clients} cliente${a.clients === 1 ? "" : "s"} · ` : ""}${a.passwordChangedAt ? `última clave ${dm(a.passwordChangedAt)}` : "nunca cambiada acá"}`)}</section>` : "";
  const debitos = r.debitos?.length ? `<section class="card sec-card" id="sec-debitos"><h2>💳 Débitos de tarjeta</h2>
      <p class="muted" style="margin:0">Cuentas con autopago que se cobran estos días. Cuando veas el débito, anotalo en Cuentas con «Pagué la renovación»: así Finanzas y el vencimiento quedan bien.</p>${accRows(r.debitos, (a) => `se debita el ${dm(a.supplierExpiresAt)}${a.costUsd ? ` · US$ ${(a.costUsd / 100).toFixed(2)}` : a.cost ? ` · ${bs(a.cost)}` : ""}`)}</section>` : "";
  const act = r.actividad ? `<section class="card sec-card" id="sec-actividad"><h2>🕑 Lo que pasó en las últimas 24 horas</h2>
      ${r.actividad.length ? `<details class="sec-more"><summary>Ver los ${r.actividad.length} movimientos</summary>${activity(r.actividad)}</details>` : `<p class="muted" style="margin:0">No hubo movimientos.</p>`}</section>` : "";

  return hero
    + section("sec-cobrar", "🔔 Cobrar ahora", "Están en cobro: si no pagan, se cortan.", r.cobrar, "cobrar")
    + section("sec-cortar", "✂️ Cortar", "No pagaron. Cortalas, cambiá la clave y anotala libre.", r.cortar, "cortar")
    + section("sec-vencidas", "🗓️ Vencidas sin anotar", "Ya vencieron y no tienen nota: ¿renovaron, las cobrás o las cortás?", r.sinAnotar, "vencidas")
    + section("sec-deben", "💸 Te deben", "Siguen activas pero figuran sin pagar.", r.deben, "deben")
    + section("sec-avisar", `⏰ Avisar: vencen en los próximos ${r.aheadDays} días`, "Mirá la regla de cada uno (📝) para saber cuándo avisarle.", r.avisar, "avisar")
    + debitos + desen + libres + apart + claves + act;
}
