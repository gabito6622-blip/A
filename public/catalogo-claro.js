// 🛍️ Catálogo claro (revisión «en el lugar de ~30 clientes», 14/11/2026). Que cualquiera entienda QUÉ compra, si HAY
// o es A PEDIDO, cuánto dura y cuánto ahorra, y que confíe en la tienda. Todo sale de los datos del producto (tipo,
// duración, precio, stock) o de lo que el dueño cargó en el panel («Para quién / cuántas pantallas», horario,
// opiniones). Nada inventado: si un dato no está, no se muestra.
//
// shop.js le pasa sus ayudantes con initCatalogoClaro(() => ({ … })): este archivo solo arma HTML y no guarda estado.
import { esc, bs, waLink, icon, periodText } from "/common.js";
import { norm } from "/buscar.js";

let C = () => ({ S: { settings: {}, catalog: [] } });
export function initCatalogoClaro(ctx, mode) {
  C = ctx; // se llama recién al dibujar (shop.js todavía está definiendo sus ayudantes)
  // En el celular se ve el ícono de persona arriba (solo en la tienda: el panel del revendedor tiene su propio menú).
  if (typeof document !== "undefined" && mode === "store") document.body?.classList.add("cc-store");
}

/* ---------------- Buscador que perdona errores y tildes ---------------- */
// «disney+» → «disney plus»; sin tildes ni signos.
const clean = (s) => norm(s).replace(/\+/g, " plus ").replace(/[^a-z0-9ñ]+/g, " ").trim();
/** Distancia entre dos palabras (cambios, faltas, sobras y letras dadas vuelta), cortando apenas pasa de `max`. */
export function dist(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}
/** Una palabra buscada «se parece» a una del producto: 1 error hasta 6 letras, 2 desde 7. Las de 3 letras o menos, exactas. */
const near = (w, x) => {
  if (w.length < 4) return false;
  const tol = w.length >= 7 ? 2 : 1;
  if (dist(w, x, tol) <= tol) return true;
  // Mientras escribe: «crunchyrol» ≈ el comienzo de «crunchyroll».
  return x.length > w.length && dist(w, x.slice(0, w.length), tol) <= tol;
};
/** ¿El texto tiene todo lo buscado? Acepta errores chicos («netflx», «disnei»), partes («crunchy») y sin tildes. */
export function ccMatch(q, text) {
  const words = clean(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const h = clean(text), hw = h.split(" ");
  return words.every((w) => h.includes(w) || hw.some((x) => near(w, x)));
}
/** Texto donde se busca un producto: nombre, descripción, categoría y qué es. */
export const ccSearchText = (p) => `${p.name} ${p.description ?? ""} ${p.category ?? ""} ${KIND[p.kind]?.[1] ?? ""} ${p.forWhom ?? ""}`;

/* ---------------- ¿Hay o es a pedido? ---------------- */
/** now = hay stock · order = a pedido (se agrega al carrito) · ask = a pedido por WhatsApp · out = agotado. */
export function stockOf(p) {
  const c = C();
  if (!p) return "out";
  if (p.available > 0) return "now";
  if (c.onDemand(p)) return "order";
  if (c.askWa(p)) return "ask";
  return "out";
}
const STOCK = {
  now: ["✅", "Hay: entrega al instante"],
  order: ["📦", "A pedido: te confirmamos antes de que pagues"],
  ask: ["📦", "A pedido: preguntanos por WhatsApp"],
  out: ["⏳", "Agotado por ahora"],
};
/** La misma etiqueta en la tarjeta, en la ficha y en el carrito. En la página de un revendedor «Hay» sin «al instante» (entrega por WhatsApp). */
export function stockTag(p) {
  const k = stockOf(p);
  const t = k === "now" && C().SLUG ? "Hay disponible" : STOCK[k][1];
  return `<p class="ccstock cc-${k}"><span aria-hidden="true">${STOCK[k][0]}</span> ${t}</p>`;
}
/** Botón de compra según el stock. `big`: el de la ficha. */
export function buyBtn(p, big = false, n = 1) {
  const st = stockOf(p), cls = big ? "sbtn pri" : "tkbtn";
  if (st === "now" || st === "order") return n > 1
    ? `<button class="${cls}" type="button" data-add="${esc(p.id)}" data-n="${n}" aria-label="Agregar ${esc(p.name)} para ${n} dispositivos al carrito">Agregar ${n} al carrito · ${bs(p.price * n)}</button>`
    : `<button class="${cls}" type="button" data-add="${esc(p.id)}" aria-label="Agregar ${esc(p.name)} al carrito">Agregar${big ? " al carrito" : ""}</button>`;
  if (st === "ask") return `<a class="${cls}" href="${C().askWa(p)}" target="_blank" rel="noopener">${icon("wa")}Preguntar</a>`;
  return `<button class="${cls}" type="button" disabled>Agotado</button>`;
}

/* ---------------- ¿Qué recibís? ---------------- */
// Del TIPO de producto que eligió el dueño (no se adivina nada de la plataforma).
const KIND = {
  // «Perfil propio con tu nombre» prometía de más (el dueño, 15/11): los perfiles se cargan «Perfil 1, Perfil 2…» y la
  // web no les cambia el nombre. Es 1 perfil asignado; en la entrega se dice cuál.
  profile: ["👤", "1 perfil asignado"],
  // «Cuenta completa» confundía (el dueño, 14/11: «ChatGPT es 1 dispositivo»): es un acceso con correo y clave.
  full_account: ["🔑", "Acceso con correo y contraseña"],
  invite: ["✉️", "Invitación a tu correo"],
  iptv: ["📺", "TV en vivo por internet"],
  combo: ["🎁", "Combo"],
  own: ["⭐", "Suscripción"],
};
/** «1 mes» / «3 meses» o, si la tienda cuenta por días, «30 días» (mesModo.ts). */
export const durText = (d) => periodText(d);
/** Plataformas de un combo: las que cargó el dueño, las de la página del revendedor, o las del texto («A + B · …»). */
export function comboList(p) {
  if (p?.kind !== "combo") return [];
  const c = C(), cat = c.S.catalog ?? [];
  if (p.comboParts?.length) return p.comboParts.map((id) => cat.find((x) => x.id === id)?.name ?? id);
  if (p.items?.length) return p.items;
  const head = (p.description || "").split("·")[0];
  return head.includes(" + ") ? head.split(/\s\+\s/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean) : [];
}
/** «1 perfil asignado · 1 mes» (o «· 30 días» si la tienda cuenta por días), «3 plataformas en un solo pago · 1 mes».
 *  La duración es la del plan elegido (Mensual / 3 meses cambian el producto). */
export function getLine(p) {
  const n = comboList(p).length;
  const what = p.kind === "combo" ? (n ? `${n} plataformas en un solo pago` : "Combo en un solo pago") : (KIND[p.kind] ?? KIND.own)[1];
  return `${what} · ${durText(p.durationDays)}`;
}
const kindIcon = (p) => (KIND[p.kind] ?? KIND.own)[0];
/** Nombre corto de la plataforma para explicar el perfil: «Netflix Premium HD 4K» → «Netflix». */
export const appName = (p) => p.name.replace(/^Amazon\s+/i, "").split(/\s*(?:·|\s-\s)\s*|\s+(?=(?:Premium|Perfil|con|sin|Plan)\b)/i)[0].trim() || p.name;
/* ---------------- ¿Para cuántos dispositivos? ---------------- */
// Casi todo lo de la tienda es para 1 dispositivo (el dueño, 14/11/2026). Si cargó «Para quién / cuántas pantallas»
// en el panel, se muestra eso; si no, «Para 1 dispositivo». Las invitaciones van a tu correo: no se dice nada.
export function devLine(p) {
  if (p.forWhom) return p.forWhom;
  if (p.kind === "invite") return "";
  return p.kind === "combo" ? "Para 1 dispositivo en cada plataforma" : "Para 1 dispositivo";
}
/** Cuántos puede llevar de una vez (hasta 3): lo que hay, o 3 si es a pedido. */
const devMax = (p) => Math.min(3, stockOf(p) === "order" ? 3 : Math.max(0, p.available ?? 0));
const canMore = (p) => p.kind !== "invite" && (stockOf(p) === "now" || stockOf(p) === "order");
/** Línea de la tarjeta: «📱 Para 1 dispositivo · ¿Para 2 o más?» (abre la ficha, donde elige cuántos). */
const forWhom = (p) => {
  const t = devLine(p);
  if (!t) return "";
  const ico = p.forWhom ? "👥" : "📱";
  return canMore(p)
    ? `<button class="ccfor ccdev" type="button" data-det="${esc(p.id)}" aria-label="${esc(t)}. Elegir para 2 o más dispositivos"><span aria-hidden="true">${ico}</span> ${esc(t)} · <u>¿Para 2 o más?</u></button>`
    : `<p class="ccfor"><span aria-hidden="true">${ico}</span> ${esc(t)}</p>`;
};
/** Cuántos eligió en la ficha (1 si no tocó nada). */
export const devN = (p) => Math.max(1, Math.min(devMax(p) || 1, C().S.devn?.[p.id] ?? 1));
const unitWord = (p) => (p.kind === "profile" ? "perfil" : p.kind === "combo" ? "combo" : "acceso");
/** Botones «1 dispositivo Bs 40» / «2 dispositivos Bs 80» / «3 dispositivos Bs 120» en la ficha. */
export function devPicker(p) {
  if (!canMore(p)) return "";
  const n = devN(p), max = devMax(p);
  const opt = (k) => `<button type="button" class="ccopt" data-devn="${k}" data-id="${esc(p.id)}" aria-pressed="${k === n}"${k > max ? " disabled" : ""}><b>${k} dispositivo${k > 1 ? "s" : ""}</b><small class="ccdevp">${bs(p.price * k)}</small></button>`;
  const w = unitWord(p);
  return `<h3 class="ccfsub" id="ccdevT">¿En cuántos dispositivos lo vas a usar?</h3>
    <div class="ccdur ccdevs" role="group" aria-labelledby="ccdevT">${[1, 2, 3].map(opt).join("")}</div>
    <p class="empty ccdevnote">Cada dispositivo es ${p.kind === "profile" ? "1 perfil asignado más" : `un ${w} más`} (${bs(p.price)} c/u).${max < 3 ? ` Ahora hay ${max === 1 ? "1 solo" : max}.` : ""} ¿Más de 3? Escribinos.</p>`;
}

/* ---------------- Duración: Mensual / 3 meses con «ahorrás» ---------------- */
/** Mismo producto en otras duraciones (misma categoría y mismo nombre sin «· 3 meses»). */
export function groupOf(p) {
  const c = C();
  const base = c.tkBase(p);
  return (c.S.catalog ?? []).filter((x) => x.category === p.category && c.tkBase(x) === base && x.kind === p.kind).sort((a, b) => a.durationDays - b.durationDays);
}
/** Ahorro REAL frente a pagar mes a mes (0 si no hay plan mensual o no conviene). */
export function saving(x, g) {
  const m = g.find((y) => y.durationDays === 30);
  if (!m || m.id === x.id || x.durationDays % 30 !== 0) return 0;
  const s = m.price * (x.durationDays / 30) - x.price;
  return s > 0 ? s : 0;
}
/** Botones grandes «Mensual Bs 40» / «3 meses Bs 120 · ahorrás Bs 0». `mode` "tk": cambia la fila; "det": abre esa ficha. */
export function durPicker(g, cur, mode, key = "") {
  if (g.length < 2) return "";
  const opt = (x) => {
    const s = saving(x, g);
    const attrs = mode === "det" ? `data-det="${esc(x.id)}"` : `data-tkpick="${esc(key)}" data-id="${esc(x.id)}"`;
    return `<button type="button" class="ccopt" ${attrs} aria-pressed="${x.id === cur.id}"><b>${x.durationDays === 30 ? "Mensual" : durText(x.durationDays)} ${bs(x.price)}</b>${s ? `<small>ahorrás ${bs(s)}</small>` : ""}</button>`;
  };
  return `<div class="ccdur" role="group" aria-label="Elegí cuánto tiempo de ${esc(C().tkBase(cur))}">${g.map(opt).join("")}</div>`;
}

/* ---------------- Fila del diseño «Lista tipo ticket» ---------------- */
export function ccTicketRow({ k, g }) {
  const c = C();
  const p = g.find((x) => x.id === c.S.tkv?.[k]) ?? g[0];
  const apps = c.comboApps(p);
  const save = c.comboSave(p);
  const appsHtml = apps.length ? `<div class="tkapps">${apps.map((x) => `<span class="tkapp">${c.miniMark(x)}${esc(c.appShort(x))}</span>`).join("")}</div>${save ? `<span class="tksave">Ahorrás Bs ${esc(save)}</span>` : ""}` : "";
  return `<article class="tk cc${apps.length ? " tkcombo" : ""}"><button class="tklogo" type="button" data-det="${esc(p.id)}" aria-label="Ver qué incluye ${esc(p.name)}">${apps.length ? c.comboIcon(apps) : c.mark(p)}</button>
    <div class="tkmid"><h3>${esc(c.tkBase(p))}</h3><p class="ccget"><span aria-hidden="true">${kindIcon(p)}</span> ${esc(getLine(p))}</p>${forWhom(p)}${stockTag(p)}${appsHtml}</div>
    ${durPicker(g, p, "tk", k)}
    <div class="tkend"><b>${bs(p.price)}</b><button class="ccmore" type="button" data-det="${esc(p.id)}">Ver qué incluye</button>${buyBtn(p)}</div></article>`;
}

/* ---------------- Tarjeta de los otros diseños (clásico, vitrina, catálogo…) ---------------- */
export function ccCard(p, badge) {
  const c = C(), s = p.available;
  const rib = badge ? `<span class="prib">${esc(badge)}</span>` : (s && s <= 2 ? `<span class="prib hot">🔥 Últimas</span>` : "");
  const sv = saving(p, groupOf(p));
  return `<article class="pc cc"><div class="pimg" style="--c:${esc(p.color)}"><div class="pbadges"><span class="tag">${esc(p.category)}</span>${rib}</div>${c.mark(p)}</div>
  <div class="pbody"><h3>${esc(p.name)}</h3><p class="ccget"><span aria-hidden="true">${kindIcon(p)}</span> ${esc(getLine(p))}</p>${forWhom(p)}${stockTag(p)}<p class="d" style="margin:0">${esc(p.description)}</p>
  <div class="price">${bs(p.price)}<small>/ ${durText(p.durationDays)}</small>${c.usdtHint(p.price)}${p.wholesale && p.publicPrice > p.price ? `<small class="pub">público ${bs(p.publicPrice)}</small>` : ""}</div>${sv ? `<p class="ccsave">Ahorrás ${bs(sv)} frente a pagar mes a mes</p>` : ""}
  <div class="pbtns"><button class="sbtn sm det" type="button" data-det="${esc(p.id)}">Ver qué incluye</button>${buyBtn(p).replace('class="tkbtn"', 'class="sbtn sm pri"')}</div></div></article>`;
}

/* ---------------- Ficha «Qué incluye» ---------------- */
export function ccFicha(p) {
  const c = C(), st = stockOf(p), g = groupOf(p), wa = c.S.settings?.whatsapp;
  const apps = comboList(p);
  const url = `${location.origin}${location.pathname}#p=${encodeURIComponent(p.id)}`;
  const rows = [
    [kindIcon(p), getLine(p).split(" · ")[0]],
    p.kind === "profile" && ["👉", `En la entrega te decimos cuál es tu perfil de ${appName(p)} (por ejemplo «Perfil 3»): entrá siempre a ese. La web no le cambia el nombre.`],
    apps.length && ["📋", `Incluye: ${apps.join(" + ")}.`],
    devLine(p) && [p.forWhom ? "👥" : "📱", devLine(p)],
    ["🗓️", `Dura ${durText(p.durationDays)}${p.durationDays % 30 === 0 && durText(p.durationDays).includes("mes") ? " (del mismo día al mismo día)" : ""}. La fecha de vencimiento te queda en Mis cuentas.`],
    ["📲", c.SLUG ? "Te lo pasamos por WhatsApp cuando confirmes tu pedido."
      : st === "now" ? "En la tienda: con saldo aparece al instante en «Mis cuentas»; con QR, apenas revisamos tu comprobante. Sin cuenta: te lo pasamos por WhatsApp."
      : "A pedido: primero consultá si hay. Cuando te confirmemos y pagues, aparece en «Mis cuentas» (sin cuenta: por WhatsApp)."],
  ].filter(Boolean);
  // A pedido (15/11): «Consultar disponibilidad» va primero y grande; «Agregar al carrito» queda como segunda opción.
  const ask = (st === "order" || st === "ask") && wa ? `<a class="sbtn pri ccdispo" data-dispo="${esc(p.id)}" href="${waLink(wa, dispoMessage([{ p, qty: devN(p) }]))}" target="_blank" rel="noopener">${icon("wa")}Consultar disponibilidad</a>` : "";
  return `<div role="dialog" aria-modal="true" aria-labelledby="ccfT" class="ccficha">
    <div class="ccfhead"><span class="ccflogo">${p.kind === "combo" && c.comboApps(p).length ? c.comboIcon(c.comboApps(p)) : c.mark(p)}</span><h2 id="ccfT">${esc(p.name)}</h2><button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></div>
    ${stockTag(p)}
    <h3 class="ccfsub">Qué recibís</h3>
    <ul class="ccinc">${rows.map(([e, t]) => `<li><span aria-hidden="true">${e}</span><span>${esc(t)}</span></li>`).join("")}</ul>
    ${p.description ? `<p class="empty">${esc(p.description)}</p>` : ""}
    ${durPicker(g, p, "det")}
    ${devPicker(p)}
    <div class="price">${bs(p.price * devN(p))}<small>/ ${durText(p.durationDays)}${devN(p) > 1 ? ` · ${devN(p)} dispositivos` : ""}</small>${c.usdtHint(p.price * devN(p))}</div>
    <div class="ccfbtns">${ask ? `${ask}${buyBtn(p, true, devN(p)).replace('class="sbtn pri"', 'class="sbtn"')}` : buyBtn(p, true, devN(p))}<button class="sbtn" type="button" data-close="1">Cerrar</button></div>
    <button class="sbtn ccshare" type="button" data-copy="${esc(url)}">🔗 Copiar el link de este producto</button></div>`;
}
/** Abre la ficha en la ventana de siempre (#modal). «Atrás» del celular la cierra. */
export function openFicha(id) {
  const c = C(), p = (c.S.catalog ?? []).find((x) => x.id === id);
  if (!p) return false;
  c.markSheet?.();
  const m = document.querySelector("#modal");
  document.querySelector("#drawer").hidden = true;
  m.innerHTML = ccFicha(p);
  m.hidden = false; document.querySelector("#scrim").hidden = false;
  m.querySelector("[data-add], a.sbtn")?.focus({ preventScroll: true });
  return true;
}

/* ---------------- Link directo a un producto: /tienda/#p=netflix ---------------- */
const slugOf = (s) => clean(s).replace(/ /g, "-");
/** El producto del link (por id, o por nombre: #p=netflix-premium-hd-4k). */
export function productFromHash(hash, catalog) {
  const m = /^#p=([^&#]+)$/.exec(hash || "");
  if (!m) return null;
  let want = m[1];
  try { want = decodeURIComponent(want); } catch { /* link roto: se usa tal cual */ }
  want = want.toLowerCase();
  return catalog.find((p) => p.id.toLowerCase() === want) ?? catalog.find((p) => slugOf(p.name) === slugOf(want)) ?? null;
}
/** Si la dirección es #p=…: deja la tienda en su lugar y abre la ficha. Devuelve true si la abrió. */
export function ccOpenFromHash() {
  const c = C();
  const p = productFromHash(location.hash, c.S.catalog ?? []);
  if (!/^#p=/.test(location.hash)) return false;
  history.replaceState(null, "", `${location.pathname}${location.search}#${c.S.view || "inicio"}`);
  if (!p) return false;
  return openFicha(p.id);
}

/** Mensaje de «Consultar disponibilidad»: qué plan, cuánto y por cuánto tiempo. `items`: [{ p, qty }]. */
export function dispoMessage(items) {
  const L = items.map(({ p, qty = 1 }) => `• ${qty > 1 ? `${qty} × ` : ""}${p.name} · ${durText(p.durationDays)} · ${bs(p.price * qty)}`);
  return `Hola 👋 Antes de pagar, ¿tienen disponible?\n${L.join("\n")}\n¿Cuándo me lo podrían pasar?`;
}

/* ---------------- Carrito: aviso de «a pedido» ANTES de pagar ---------------- */
export function ccCartNotice() {
  const c = C();
  if (c.MODE === "store") return ""; // en la tienda, lo a pedido va en su propia sección del carrito (shop.js)
  const items = (c.S.cart ?? []).map((l) => ({ l, p: (c.S.catalog ?? []).find((x) => x.id === l.productId) })).filter(({ l, p }) => p && l.qty > (p.available ?? 0) && c.onDemand(p));
  if (!items.length) return "";
  const names = items.map(({ p }) => p.name);
  const wa = c.S.settings?.whatsapp;
  return `<div class="ccorder" role="note"><b>📦 A pedido: ${esc(names.join(", "))}</b><span>Ahora no lo tenemos listo para entregar. Antes de pagar, escribinos y te confirmamos que hay y cuándo te lo pasamos.</span>${wa ? `<a class="sbtn" href="${waLink(wa, `Hola, quiero ${names.join(", ")}. ¿Me confirmás si hay antes de pagar?`)}" target="_blank" rel="noopener">${icon("wa")}Preguntar si hay</a>` : ""}</div>`;
}

/* ---------------- Confianza en la portada ---------------- */
/** «8:00 a 22:00» sacado del horario que cargó el dueño; si no tiene horas, el texto tal cual. */
export function hoursText(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = /(\d{1,2})(?:[:.h](\d{2}))?\s*(?:a|-|–|hasta)\s*(\d{1,2})(?:[:.h](\d{2}))?/i.exec(s);
  return m ? `atendemos de ${m[1]}:${m[2] ?? "00"} a ${m[3]}:${m[4] ?? "00"}` : s;
}
/** Línea de arriba: «Tienda boliviana · atendemos de 8:00 a 22:00 · garantía de reposición · Términos». */
export function ccTrustTop() {
  const c = C();
  if (c.SLUG) return "";
  const st = c.S.settings ?? {};
  const bo = (st.currencySymbol || "Bs").trim() === "Bs";
  const parts = [bo && "Tienda boliviana", hoursText(st.storeHours)].filter(Boolean).map(esc);
  return `<p class="cctrust">${[...parts, `<a href="/terminos#garantias">garantía de reposición</a>`, `<a href="/terminos">Términos</a>`].join(" · ")}</p>`;
}
/** Los 3 pasos (los mismos en todos los diseños). */
export function ccSteps(recibi) {
  const steps = C().SLUG
    ? [["1", "Elegí", "Agregá al carrito lo que te gusta."], ["2", "Pedí", "Mandame tu pedido por WhatsApp con un toque."], ["3", "Disfrutá", "Te paso tus accesos al toque."]]
    : [["1", "Elegí", "Agregá al carrito lo que necesitás."], ["2", "Pagá", "Con QR y comprobante, o al instante con tu saldo."], ["3", "Recibí", recibi || "Tus accesos aparecen en Mis cuentas y te avisamos por WhatsApp."]];
  return `<section class="sbox ccsteps" style="grid-template-columns:repeat(auto-fit,minmax(min(200px,100%),1fr));gap:18px">${steps.map(([k, t, d]) => `<div style="display:grid;gap:4px"><span class="chip">Paso ${k}</span><b style="font-size:18px">${t}</b><span class="empty">${d}</span></div>`).join("")}</section>`;
}
/** Sin resultados: qué hacer (otra palabra o preguntar). */
export function ccNoResults(q) {
  const wa = C().S.settings?.whatsapp;
  return `<div class="sbox ccnone"><p class="empty" style="margin:0">No encontramos “${esc(q)}”. Probá con otra palabra (por ejemplo: Netflix, Disney, Spotify) o tocá «Todos».</p>${wa ? `<a class="sbtn" href="${waLink(wa, `Hola, busco ${q}. ¿Lo tienen?`)}" target="_blank" rel="noopener">${icon("wa")}Preguntar por WhatsApp</a>` : ""}</div>`;
}

/* ---------------- Entrar ---------------- */
/** Texto de arriba al tocar «Soy nuevo» u «Olvidé mi PIN» (los dos siguen con el número de WhatsApp). */
export function ccLoginWhy(why) {
  if (why === "new") return `<p class="cchint">👋 <b>Crear tu cuenta</b>: solo necesitás tu número de WhatsApp.</p>`;
  if (why === "forgot") return `<p class="cchint">🔑 <b>¿Olvidaste tu PIN?</b> Escribí tu número de WhatsApp y te ayudamos a entrar de nuevo.</p>`;
  return "";
}
/** Botones de abajo del ingreso con número y PIN. */
// En la tienda, «Soy nuevo» abre «Crear mi cuenta» (nombre + número + PIN, sin códigos; 15/11). En otras páginas, como antes.
export const ccLoginAlt = () => `<div class="cclogin"><button class="sbtn" type="button" ${C().MODE === "store" ? 'data-loginstep="signup"' : 'data-loginstep="phone" data-loginwhy="new"'}>🆕 Soy nuevo: crear cuenta</button><button class="sbtn" type="button" data-loginstep="phone" data-loginwhy="forgot">🔑 Olvidé mi PIN</button></div>
      <button class="sbtn ccghost" type="button" data-loginstep="email">Entrar con correo y contraseña</button>`;
/** «Crear mi cuenta» (15/11, el dueño): nombre, número de WhatsApp y un PIN que elige el cliente. Sin códigos. */
export const ccSignup = (phone = "") => `<p class="cchint">👋 <b>Creá tu cuenta en 1 minuto.</b> Con tu cuenta subís el comprobante acá mismo y tus accesos quedan guardados en «Mis cuentas».</p>
      <label>Tu nombre<input name="name" required autocomplete="name" maxlength="80" placeholder="Ej.: Ana Quispe"></label>
      <label>Tu número de WhatsApp<input name="phone" required inputmode="tel" value="${esc(phone || "+591 ")}" autocomplete="tel"></label>
      <label>Elegí un PIN de 4 números<input name="pin" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="new-password" class="pinbox" placeholder="••••"></label>
      <label>Repetí el PIN<input name="pin2" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="new-password" class="pinbox" placeholder="••••"></label>
      <p class="empty ccpinhint">Con tu número y este PIN entrás desde cualquier celular. No uses 1234 ni 4 números iguales, y no se lo pases a nadie.</p>
      ${ccConsent()}
      <button class="sbtn pri" type="submit">Crear mi cuenta</button>
      <button class="sbtn" type="button" data-loginstep="pin">Ya tengo cuenta: entrar</button>`;
/** Casilla de avisos: NUNCA marcada sola, y dice para qué es. */
export const ccConsent = () => `<label class="chk ccconsent"><input type="checkbox" name="consent"> <span>Quiero avisos por WhatsApp de mi pedido y de cuándo vence.<small>Solo para tu pedido. Nada de publicidad. <a href="/privacidad" target="_blank" rel="noopener">Privacidad</a></small></span></label>`;
