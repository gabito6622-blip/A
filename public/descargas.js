// 📁 Mis descargas (13/11/2026): el centro de exportaciones, compartido por el panel de la tienda y GaboHub.
// Tres acciones: catálogo PDF (premium o clásico), catálogo para WhatsApp (copiar todo, una categoría o abrir
// WhatsApp con el texto listo, sin mandarlo) y el Excel del negocio. La vista previa se arma con los mismos datos
// que el PDF y el texto (una sola fuente: /descargas/catalogo). Nada se manda solo.
import { api, esc, toast } from "/common.js";

const DL = { base: "/api/admin/descargas", btn: "pbtn", render: () => {}, data: null, wa: null, cats: null, design: "premium", period: "mes", from: "", to: "", loading: false, error: null };

export function initDescargas(opts) { Object.assign(DL, opts); }

const sel = () => (DL.cats ? [...DL.cats] : []);
const q = () => (DL.cats && DL.cats.size ? `?cats=${encodeURIComponent(sel().join(","))}` : "");
export async function descargasEnsure(force = false) {
  if (DL.data && !force) return;
  DL.loading = true; DL.error = null;
  try {
    DL.data = await api("GET", `${DL.base}/catalogo`);
    DL.wa = await api("GET", `${DL.base}/whatsapp${q()}`);
  } catch (e) { DL.error = e.message; }
  DL.loading = false;
}
async function reloadWa() { try { DL.wa = await api("GET", `${DL.base}/whatsapp${q()}`); } catch (e) { toast(e.message); } }

const money = (c, cur) => { const v = c / 100; const whole = cur.decimals === 0 || Math.abs(v - Math.round(v)) < 1e-9; return `${cur.symbol} ${new Intl.NumberFormat("es-BO", { minimumFractionDigits: whole ? 0 : cur.decimals, maximumFractionDigits: cur.decimals }).format(v)}`; };
const fdate = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
/** Rango del Excel: este mes, el mes pasado, 30 días o fechas propias (dd/mm en pantalla, AAAA-MM-DD por la API). */
export function periodRange() {
  const now = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (DL.period === "mes") return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), label: `este mes (${monthKey(now)})` };
  if (DL.period === "anterior") { const f = new Date(now.getFullYear(), now.getMonth() - 1, 1), t = new Date(now.getFullYear(), now.getMonth(), 0); return { from: iso(f), to: iso(t), label: `mes pasado (${monthKey(f)})` }; }
  if (DL.period === "30") { const f = new Date(now.getTime() - 30 * 864e5); return { from: iso(f), to: iso(now), label: "últimos 30 días" }; }
  return { from: DL.from || iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: DL.to || iso(now), label: "fechas elegidas" };
}

function preview(d) {
  const cats = d.categories.filter((c) => !DL.cats || !DL.cats.size || DL.cats.has(c.name));
  const logo = d.business.hasLogo ? `<img src="${DL.base}/logo" alt="" class="dl-logo">` : `<span class="dl-logo dl-ini" style="background:${esc(d.business.accent)}">${esc((d.business.name || "T")[0])}</span>`;
  return `<div class="dl-prev ${DL.design}" style="--dl-acc:${esc(d.business.accent)};--dl-acc2:${esc(d.business.accent2)};--dl-bg:${esc(d.business.background)}">
    <div class="dl-cover">${logo}<div><b>${esc(d.business.name)}</b><small>Catálogo · ${fdate(d.generatedAt)}</small></div></div>
    ${cats.length ? cats.map((c) => `<section class="dl-cat"><h4>${esc(c.name)}</h4>${c.items.map((it) => `<div class="dl-it"><span><b>${esc(it.name)}</b>${it.items?.length ? `<small>incluye ${esc(it.items.join(" + "))}</small>` : it.description ? `<small>${esc(it.description)}</small>` : ""}</span><b class="dl-p">${esc(money(it.price, d.currency))}</b></div>`).join("")}</section>`).join("") : `<p class="dl-empty">Elegí al menos una categoría.</p>`}
    ${d.promos.length ? `<section class="dl-cat dl-promo"><h4>Promos</h4>${d.promos.map((p) => `<div class="dl-it"><span>${esc(p)}</span></div>`).join("")}</section>` : ""}
    <div class="dl-foot">${d.business.whatsapp ? `📲 WhatsApp +${esc(d.business.whatsapp)}` : ""}${d.business.url ? ` · 🌐 ${esc(d.business.url.replace(/^https?:\/\//, ""))}` : ""}<br><small>Precios en ${esc(d.currency.symbol)}; pueden cambiar sin aviso.</small></div>
  </div>`;
}

export function descargasView() {
  const B = DL.btn, d = DL.data;
  if (DL.loading && !d) return `<section class="card sbox"><p class="muted empty">Preparando tus descargas…</p></section>`;
  if (DL.error && !d) return `<section class="card sbox"><div class="err">${esc(DL.error)}</div></section>`;
  if (!d) return "";
  const total = d.categories.reduce((n, c) => n + c.items.length, 0);
  const allCats = d.categories.map((c) => c.name);
  const on = (name) => !DL.cats || !DL.cats.size || DL.cats.has(name);
  const pr = periodRange();
  const pdfUrl = `${DL.base}/catalogo.pdf?design=${DL.design}${DL.cats && DL.cats.size ? `&cats=${encodeURIComponent(sel().join(","))}` : ""}`;
  const xlsUrl = `${DL.base}/reporte.xlsx?from=${pr.from}&to=${pr.to}`;
  const waText = DL.wa?.text ?? "";
  return `<section class="card sbox dl-head"><div class="sec-h" style="margin:0"><div><span class="chip">Centro de exportaciones</span><h2 style="margin:4px 0">📁 Mis descargas</h2><p class="muted" style="margin:0">Tu catálogo listo para compartir y el Excel de tu negocio. ${total} producto${total === 1 ? "" : "s"} publicado${total === 1 ? "" : "s"} con precio. Solo lo tuyo: nunca costos, claves ni clientes.</p></div></div></section>
  <div class="dl-grid">
    <section class="card sbox dl-card"><h3>📄 Catálogo PDF</h3><p class="muted">A4, para compartir e imprimir. Con tu logo, tus precios y tu WhatsApp.</p>
      <div class="dl-designs"><button type="button" class="dl-design ${DL.design === "premium" ? "on" : ""}" data-dldesign="premium"><b>Premium</b><small>Portada, colores de tu marca, productos por categoría</small></button><button type="button" class="dl-design ${DL.design === "clasico" ? "on" : ""}" data-dldesign="clasico"><b>Clásico</b><small>Letras grandes y precios claros, ideal para WhatsApp</small></button></div>
      <a class="${B} dl-big" href="${esc(pdfUrl)}" download>📄 Descargar catálogo PDF</a></section>
    <section class="card sbox dl-card"><h3>📋 Catálogo para WhatsApp</h3><p class="muted">Texto ordenado, sin que tu cliente entre a ninguna página.</p>
      <div class="dl-acts"><button type="button" class="${B} dl-big" data-dlcopy="*">📋 Copiar catálogo completo</button><a class="${B} dl-big" href="https://wa.me/?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener" data-dlwa="1">💬 Abrir WhatsApp con el mensaje</a></div>
      <details class="dl-det"><summary>Copiar una sola categoría</summary><div class="dl-acts">${(DL.wa?.categories ?? []).map((c) => `<button type="button" class="${B}" data-dlcopy="${esc(c.name)}">📋 ${esc(c.name)}</button>`).join("") || `<span class="muted">Sin categorías elegidas.</span>`}</div></details>
      <details class="dl-det"><summary>Ver el texto</summary><pre class="dl-pre">${esc(waText)}</pre></details></section>
    <section class="card sbox dl-card"><h3>📊 Excel de mi negocio</h3><p class="muted">Portada con indicadores, ventas e ingresos, por producto, cobros y deudas, vencimientos y clientes. Con gráficos y filtros.</p>
      <div class="dl-periods">${[["mes", "Este mes"], ["anterior", "Mes pasado"], ["30", "30 días"], ["custom", "Fechas"]].map(([k, t]) => `<button type="button" class="dl-chip ${DL.period === k ? "on" : ""}" data-dlperiod="${k}">${t}</button>`).join("")}</div>
      ${DL.period === "custom" ? `<div class="dl-dates"><label>Desde<input type="date" data-dlfrom="1" value="${esc(DL.from || pr.from)}"></label><label>Hasta<input type="date" data-dlto="1" value="${esc(DL.to || pr.to)}"></label></div>` : ""}
      <a class="${B} dl-big" href="${esc(xlsUrl)}" download>📊 Descargar Excel · ${esc(pr.label)}</a></section>
  </div>
  <section class="card sbox dl-card"><h3>👀 Vista previa y qué incluir</h3>
    <div class="dl-cats">${allCats.map((n) => `<label class="dl-chk"><input type="checkbox" data-dlcat="${esc(n)}" ${on(n) ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>
    ${preview(d)}</section>`;
}

/** Clics del centro de descargas. Devuelve true si lo atendió (y vuelve a dibujar cuando hace falta). */
export async function descargasClick(d, el) {
  if (d.dldesign) { DL.design = d.dldesign; DL.render(); return true; }
  if (d.dlperiod) { DL.period = d.dlperiod; DL.render(); return true; }
  if (d.dlcopy !== undefined) {
    const txt = d.dlcopy === "*" ? DL.wa?.text : DL.wa?.categories.find((c) => c.name === d.dlcopy)?.text;
    if (!txt) { toast("No hay nada para copiar"); return true; }
    try { await navigator.clipboard.writeText(txt); toast(d.dlcopy === "*" ? "📋 Catálogo copiado: pegalo en WhatsApp" : `📋 ${d.dlcopy} copiado`); }
    catch { toast("No se pudo copiar: abrí «Ver el texto» y copialo a mano"); }
    return true;
  }
  if (d.dlwa) { return false; } // es un link normal a wa.me: se abre WhatsApp con el texto; no se manda nada
  return false;
}
/** Cambios en casillas y fechas (se engancha una vez por página). */
export function descargasBind(root = document) {
  root.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t?.dataset?.dlcat !== undefined) {
      const all = DL.data?.categories.map((c) => c.name) ?? [];
      const cur = new Set(DL.cats && DL.cats.size ? DL.cats : all);
      if (t.checked) cur.add(t.dataset.dlcat); else cur.delete(t.dataset.dlcat);
      DL.cats = cur.size === all.length ? null : cur;
      await reloadWa(); DL.render();
    }
    if (t?.dataset?.dlfrom) { DL.from = t.value; DL.render(); }
    if (t?.dataset?.dlto) { DL.to = t.value; DL.render(); }
  });
}
