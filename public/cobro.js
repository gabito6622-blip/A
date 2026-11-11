// Página del link de cobro (/c/<token>): el cliente de un revendedor ve cuándo vence su perfil, cuánto es,
// el QR del revendedor y un botón para avisarle por WhatsApp que ya pagó. No manda nada sola.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = location.pathname.split("/").filter(Boolean)[1] ?? "";
const DAY = 86_400_000;

/** Días de calendario que faltan con la fecha del celular (0 = hoy, -1 = ayer). */
const daysLeft = (t) => {
  const a = new Date(t), b = new Date();
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY);
};
const ddmm = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
const money = (cents, cur) => `${cur} ${(cents / 100).toLocaleString("es-BO", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (n) => (n > 1 ? `faltan ${n} días` : n === 1 ? "falta 1 día" : n === 0 ? "vence hoy" : n === -1 ? "venció ayer" : `venció hace ${-n} días`);
const wa = (digits, text) => `https://wa.me/${String(digits).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

function fail(title, text, retry = false) {
  $("#app").innerHTML = `<div class="card center"><p style="font-size:40px;margin:0" aria-hidden="true">🔗</p><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p>
    ${retry ? `<button class="btn btn-ghost" type="button" id="retry">Probar de nuevo</button>` : ""}</div>`;
  $("#retry")?.addEventListener("click", load);
}

/** Lo que dice el botón "Ya pagué" (el cliente lo puede cambiar antes de mandarlo en su WhatsApp). */
export function paidMessage(v) {
  const amount = v.price != null && v.price > 0 ? money(v.price, v.currency) : "";
  const what = amount
    ? `${amount} ${v.label ? `del perfil ${v.label} de` : "de"} ${v.product}`
    : v.label ? `el perfil ${v.label} de ${v.product}` : `mi ${v.product}`;
  return `Hola, soy ${v.name}. Pagué ${what}. Te mando el comprobante.`;
}

function view(v) {
  const n = daysLeft(v.expiresAt);
  const paid = v.pay === "pagado";
  const upToDate = paid && n > 5;
  const pill = upToDate ? `<span class="pill p-ok">Al día</span>`
    : !paid ? `<span class="pill ${v.pay === "no_pago" ? "p-bad" : "p-warn"}">Falta pagar</span>`
    : `<span class="pill p-warn">${n < 0 ? "Para renovar" : "Vence pronto"}</span>`;
  const who = v.seller || "quien te vendió";
  document.title = `${v.product} · ${who}`;
  // Logo de la app (Disney, Prime…) si la tienda lo cargó; si no, la inicial en un cuadrito de color.
  const initial = `<span class="plogo pini" aria-hidden="true">${esc((v.product || "?").trim()[0]?.toUpperCase() ?? "?")}</span>`;
  const logo = v.hasLogo ? `<img class="plogo" src="/api/cobro/${encodeURIComponent(token)}/logo" alt="" width="44" height="44">` : initial;
  const info = `<section class="card" aria-label="Tu perfil"><div class="top"><span class="prodw">${logo}<span class="prod">${esc(v.product)}</span></span>${pill}</div>
    <dl>${v.label ? `<dt>Perfil</dt><dd>${esc(v.label)}</dd>` : ""}<dt>Vence</dt><dd>${ddmm(v.expiresAt)} · ${when(n)}</dd></dl></section>`;
  if (upToDate) {
    $("#app").innerHTML = `<h1>Hola ${esc(v.name)} 👋</h1>
      <section class="card ok-big"><b>Estás al día ✅ hasta ${ddmm(v.expiresAt)}</b><p class="muted">No tenés nada para pagar por ahora.</p></section>
      ${info}
      ${v.sellerWhatsapp ? `<a class="btn btn-ghost" href="${wa(v.sellerWhatsapp, `Hola, soy ${v.name}. Te escribo por mi perfil de ${v.product}.`)}" target="_blank" rel="noopener noreferrer">💬 Escribirle a ${esc(who)}</a>` : ""}
      <p class="foot">Este resumen te lo mandó ${esc(who)}.</p>`;
    return;
  }
  const head = !paid ? "Te falta pagar" : n < 0 ? "Para renovar" : `Para seguir después del ${ddmm(v.expiresAt)}`;
  const amount = v.price != null && v.price > 0
    ? `<section class="card amount" aria-label="Monto"><small>${esc(head)}</small><b>${esc(money(v.price, v.currency))}</b></section>`
    : `<section class="card amount" aria-label="Monto"><small>${esc(head)}</small><p>Consultale el monto a ${esc(who)}.</p></section>`;
  const qr = v.hasQr ? `<section class="card qr" aria-label="QR para pagar"><img src="/api/cobro/${encodeURIComponent(token)}/qr" alt="QR para pagarle a ${esc(who)}" width="260" height="260">
      <p class="muted">Pagá escaneando este QR con la app de tu banco.<br><b>Mantené apretado para guardar</b> la imagen.</p></section>` : "";
  $("#app").innerHTML = `<h1>Hola ${esc(v.name)} 👋</h1>
    ${info}${amount}${qr}
    ${v.sellerWhatsapp ? `<a class="btn btn-wa" id="paid" href="${wa(v.sellerWhatsapp, paidMessage(v))}" target="_blank" rel="noopener noreferrer">✅ Ya pagué, avisar a ${esc(who)}</a>
    <p class="foot">Se abre tu WhatsApp con el mensaje listo. Mandale también la foto del comprobante.</p>` : `<p class="foot">Cuando pagues, avisale a ${esc(who)} y mandale el comprobante.</p>`}`;
  // Si la imagen no carga, se saca el recuadro (sin mostrar una imagen rota).
  $(".qr img")?.addEventListener("error", () => $(".qr")?.remove());
  $("img.plogo")?.addEventListener("error", (ev) => { ev.target.outerHTML = initial; });
}

async function load() {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return fail("Este link ya no sirve", "Pedile uno nuevo a quien te vendió.");
  try {
    const r = await fetch(`/api/cobro/${encodeURIComponent(token)}`, { credentials: "omit" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return fail("Este link ya no sirve", "Pedile uno nuevo a quien te vendió.");
    if (!r.ok) return fail("No pudimos abrirlo", j.message || "Probá de nuevo en un rato.", true);
    view(j);
  } catch {
    fail("No pudimos abrirlo", "Revisá tu conexión a internet y probá de nuevo.", true);
  }
}
load();
