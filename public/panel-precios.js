// 💲 Precios del día (16/11/2026), en Productos y precios. El dueño pone «Nueva» y «Renovación» de cada alquiler a
// revendedores; antes de aplicar ve quién cambia («Aracely: 65 → 69») y puede tildar «📌 mantener su precio».
// No toca a los clientes finales ni a los que pagan en dólares (US$ 7 sigue igual).
import { api, esc, bs, toCents, toast } from "/common.js";

let rerender = () => {};
let last = null; // { prices, preview }
export function initDayPrices(render) { rerender = render; }

const cents = (v) => { const s = String(v ?? "").trim(); return s ? toCents(s) : undefined; };
const plain = (c) => (c == null ? "" : String(c / 100).replace(/\.0+$/, ""));

/** La tarjeta (arriba de Productos y precios). */
export async function dayPricesCard() {
  const v = await api("GET", "/api/admin/day-prices").catch(() => null);
  if (!v?.products?.length) return "";
  return `<section class="card dprices" id="dpCard"><h2>💲 Precios del día (revendedores)</h2>
    <p class="muted" style="margin:0 0 8px">«Nueva»: lo que paga un revendedor por una cuenta nueva. «Renovación»: lo que paga al renovar. Antes de aplicar te muestro quién cambia. <b>No cambian</b> los clientes finales ni los que pagan en dólares${v.usdLists.length ? ` (${esc(v.usdLists.join(", "))})` : ""}.</p>
    <form id="dpForm" class="dpform">
      <div class="dphead"><span>Producto</span><span>Nueva (Bs)</span><span>Renovación (Bs)</span></div>
      ${v.products.map((p) => `<div class="dprow"><b>${esc(p.name.replace(/\s*\(alquiler revendedores\)/i, ""))}</b>
        <input name="n:${esc(p.id)}" inputmode="decimal" value="${esc(plain(p.nueva))}" aria-label="Nueva ${esc(p.name)}">
        <input name="r:${esc(p.id)}" inputmode="decimal" value="${esc(plain(p.renov))}" placeholder="—" aria-label="Renovación ${esc(p.name)}"></div>`).join("")}
      <button class="pbtn green" type="submit">👀 Ver qué cambia</button>
    </form>
    <div id="dpPrev"></div></section>${await bulkCard()}`;
}

// 🧮 Descuento por cantidad (20/11/2026): «si Aracely renueva 10 juntas, Bs 65 cada una». Por revendedor; solo en Bs.
async function bulkCard() {
  const L = await api("GET", "/api/admin/bulk-renew").catch(() => null);
  if (!L?.length) return "";
  const on = L.filter((x) => x.rule);
  return `<section class="card" id="bulkCard"><h2>🧮 Descuento por cantidad</h2>
    <p class="muted" style="margin:0 0 8px">Si el revendedor renueva <b>varias juntas</b> desde su panel, cada una le sale al precio rebajado. Ej.: Aracely, 10 o más → Bs 65 c/u.</p>
    ${on.length ? `<div class="bulklist">${on.map((x) => `<div class="bulkrow"><span><b>${esc(x.name.replace(/^[^·]*·\s*/, ""))}</b><br><small class="muted">${x.rule.min} o más juntas → ${bs(x.rule.price)} c/u</small></span><button class="pbtn sm" type="button" data-bulkoff="${esc(x.id)}">Quitar</button></div>`).join("")}</div>` : ""}
    <form id="bulkRenewForm" class="dpform">
      <label>Revendedor<select name="who">${L.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}</select></label>
      <div class="dprow"><label>Desde (cuentas)<input name="min" inputmode="numeric" placeholder="10"></label><label>Precio c/u (Bs)<input name="price" inputmode="decimal" placeholder="65"></label></div>
      <button class="pbtn green" type="submit">Guardar descuento</button>
    </form></section>`;
}

function previewHtml(pv) {
  const name = (n) => esc(String(n).replace(/^[^·]*·\s*/, ""));
  const range = (items) => { const f = [...new Set(items.map((x) => x.from))].sort((a, b) => a - b); return f.map((x) => bs(x)).join(", "); };
  const rows = pv.payers.map((g) => {
    const to = [...new Set(g.items.map((x) => x.to))].map((x) => bs(x)).join(", ");
    const ch = g.changes;
    return `<label class="dpp${ch ? "" : " same"}"><span><b>${name(g.name)}</b> <small class="muted">${g.items.length} cuenta${g.items.length === 1 ? "" : "s"}</small><br>
      ${ch ? `${esc(range(g.items))} → <b>${esc(to)}</b>` : `<small class="muted">ya está en ${esc(to)}</small>`}</span>
      <span class="dpkeep"><input type="checkbox" data-dpkeep="${esc(g.payerId)}"${g.fixed ? " checked" : ""}> 📌 mantener su precio</span></label>`;
  }).join("");
  const n = pv.payers.reduce((t, g) => t + g.changes, 0);
  return `<div class="dpprev" role="region" aria-label="Qué cambia">
    <h3>Así quedaría la próxima renovación</h3>
    ${rows || `<p class="muted">Ningún revendedor tiene alquileres de esos productos.</p>`}
    <p class="muted" style="margin:6px 0">${pv.skipped.finales ? `${pv.skipped.finales} cuenta(s) de clientes finales y ` : ""}${pv.skipped.usd ? `${pv.skipped.usd} en dólares ` : ""}${pv.skipped.finales || pv.skipped.usd ? "no cambian." : ""} Tildá «📌 mantener su precio» para quien siga con el suyo.</p>
    <button class="pbtn green big" type="button" data-dpapply="1">✅ Aplicar precios del día${n ? ` (${n} cuenta${n === 1 ? "" : "s"} cambian)` : ""}</button></div>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.("#bulkRenewForm");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const min = Math.round(Number(f.min.value)), price = cents(f.price.value);
    if (!(min >= 2) || !price || Number.isNaN(price)) return toast("Poné desde cuántas cuentas (2 o más) y el precio de cada una");
    try { await api("POST", `/api/admin/bulk-renew/${encodeURIComponent(f.who.value)}`, { min, price }); toast("🧮 Descuento guardado"); rerender(); } catch (e) { toast(e.message); }
  }, true);
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-bulkoff]");
    if (!b) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (!confirm("¿Quitar el descuento por cantidad de este revendedor?")) return;
    try { await api("POST", `/api/admin/bulk-renew/${encodeURIComponent(b.dataset.bulkoff)}`, {}); toast("Descuento quitado"); rerender(); } catch (e) { toast(e.message); }
  }, true);
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.("#dpForm");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const prices = {};
    try {
      for (const el of f.querySelectorAll("input[name]")) {
        const [k, pid] = el.name.split(":");
        const c = cents(el.value);
        if (c !== undefined && (Number.isNaN(c) || c <= 0)) throw new Error("Escribí el precio solo con números (por ejemplo 69)");
        (prices[pid] ??= {})[k === "n" ? "nueva" : "renov"] = c;
      }
      const pv = await api("POST", "/api/admin/day-prices/preview", { prices });
      last = { prices, pv };
      document.getElementById("dpPrev").innerHTML = previewHtml(pv);
      document.querySelector("#dpPrev [data-dpapply]")?.scrollIntoView({ block: "nearest" });
    } catch (e) { toast(e.message); }
  }, true);
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-dpapply]");
    if (!b || !last) return;
    const keep = [...document.querySelectorAll("#dpPrev [data-dpkeep]:checked")].map((x) => x.dataset.dpkeep);
    b.disabled = true;
    try {
      const r = await api("POST", "/api/admin/day-prices", { prices: last.prices, keep });
      last = null;
      toast(`✅ Precios del día guardados · ${r.changed} cuenta${r.changed === 1 ? "" : "s"} con precio nuevo${r.kept ? ` · ${r.kept} mantienen su precio` : ""}`);
      rerender();
    } catch (e) { b.disabled = false; toast(e.message); }
  });
}
