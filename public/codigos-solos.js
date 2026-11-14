// "📩 Mis clientes ven su código solos" (panel del revendedor) y "Ver códigos" de cada servicio en Mis cuentas.
// - Repartir perfiles: un interruptor por cuenta alquilada (apagado por defecto) y el contador del mes.
// - Mis cuentas propias: el mismo interruptor por cuenta, solo si su usuario es un correo; dice si ya llegan
//   códigos de ese correo (si no, su cliente ve "Pedile el código a tu vendedor"). 14/11: ya NO sugiere reenviar
//   sus correos a la tienda (el dueño los vería): GaboHub todavía no lee el correo propio del revendedor.
// - Mis cuentas (cliente con cuenta): "📩 Ver códigos" muestra ahí mismo los de ESE servicio.
// shop.js y ownstock.js solo llaman a estas funciones; la carga y los eventos están acá.
import { api, esc, toast } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/codigos-solos.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/codigos-solos.css"; document.head.append(l);
}

const CS = { data: null, loading: false, err: "", svc: {}, codes: null };
let RENDER = () => {};
/** shop.js le pasa su render() para redibujar después de cada cambio. */
export function initSelfCodes(render) { RENDER = render; }

export async function loadSelfCodes() {
  CS.loading = true;
  try { CS.data = await api("GET", "/api/me/self-codes"); CS.err = ""; }
  catch (e) { CS.err = e.message; }
  CS.loading = false;
}
/** Carga la primera vez que se dibuja (sin frenar la pestaña). */
const ready = () => {
  if (!CS.data && !CS.loading && !CS.err) loadSelfCodes().then(() => RENDER());
  return CS.data;
};

const sw = (attrs, on, text, hint) => `<label class="cs-sw"><input type="checkbox" role="switch" ${attrs} ${on ? "checked" : ""}><span><b>${text}</b>${hint ? `<small>${hint}</small>` : ""}</span></label>`;
const ownerOff = () => (CS.data && !CS.data.allowed ? `<small class="cs-off">La tienda todavía no lo activó: cuando lo active, empieza a funcionar.</small>` : "");

/** Arriba de Repartir perfiles: cuántos códigos vieron solos sus clientes este mes. */
export function selfCodesHead() {
  const d = ready();
  if (!d) return "";
  const n = d.month;
  return `<p class="cs-head" role="status">📩 ${n ? `Tus clientes vieron <b>${n}</b> código${n === 1 ? "" : "s"} solos este mes, sin escribirte.` : "Prendé “Mis clientes ven su código solos” en una cuenta y ellos lo ven en su link de cobro, sin escribirte."}</p>`;
}

/** Interruptor de una cuenta alquilada (Repartir perfiles). */
export function selfCodesRental(assignmentId) {
  const d = ready();
  if (!d) return "";
  const on = !!d.rentals.find((r) => r.assignmentId === assignmentId)?.on;
  return `<div class="cs-box">${sw(`data-csrental="${esc(assignmentId)}"`, on, "📩 Mis clientes ven su código solos", "En su link de cobro aparece “Ver mi código de acceso”. Ven solo el código de esta cuenta (nunca la contraseña).")}${on ? ownerOff() : ""}</div>`;
}

/** Interruptor de una cuenta propia (solo si el usuario es un correo). */
export function selfCodesOwn(account) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(account?.user ?? "").trim())) return "";
  const d = ready();
  if (!d) return "";
  const x = d.own.find((r) => r.accountId === account.id) ?? { on: false, readable: false };
  const state = !x.on ? "" : x.readable
    ? `<small class="cs-ok">✅ La tienda ya recibe los códigos de este correo.</small>`
    : `<small class="cs-off">⏳ GaboHub todavía no puede leer tu correo, así que no llegan códigos de esta cuenta. Tu cliente ve “Pedile el código a tu vendedor”: abrí el correo de esta cuenta en tu celular y pasale el código vos.</small>`;
  return `<div class="cs-box">${sw(`data-csown="${esc(account.id)}"`, x.on, "📩 Mis clientes ven su código solos", "Por ahora funciona solo con correos que ya lee la tienda. Conectar tu propio correo todavía no se puede.")}${state}${x.on ? ownerOff() : ""}</div>`;
}

/** «Mis códigos» del independiente: dice claro que los códigos de SUS cuentas propias no llegan acá (todavía). */
export function ownCodesNote() {
  return `<div class="sbox cs-ownnote" role="note"><b>📦 ¿Y los códigos de tus cuentas propias?</b><p class="empty" style="margin:0">Todavía no llegan acá: GaboHub no puede leer tu propio correo. Para sacar un código, abrí el correo de esa cuenta en tu celular. Acá ves los de cuentas compradas a la tienda y armás tu link de códigos para tus clientes.</p></div>`;
}

/* ---------------- Mis cuentas: los códigos de cada servicio ---------------- */
const KIND = { login: "🔓 Inicio de sesión", hogar: "🏠 Actualizar hogar", temporal: "⏱️ Acceso temporal", verificacion: "🛡️ Verificación", otro: "✉️ Código" };
const ago = (t) => { const m = Math.max(0, Math.floor((Date.now() - t) / 60_000)); return m < 1 ? "recién" : `hace ${m} min`; };

/** Botón "📩 Ver códigos" de un servicio (con correo) y, si está abierto, sus códigos ahí mismo. */
export function svcCodes(a) {
  const email = String(a?.access?.email ?? "").toLowerCase();
  if (!email || a.access.iptv) return `<button class="sbtn sm" type="button" data-s="codigos">Ver códigos</button>`;
  const id = a.assignmentId, open = CS.svc[id];
  const btn = `<button class="sbtn sm" type="button" data-svccodes="${esc(id)}" aria-expanded="${!!open}">📩 ${open ? "Ocultar códigos" : "Ver códigos"}</button>`;
  if (!open) return btn;
  const list = CS.codes === null ? `<p class="empty" style="margin:0">Buscando…</p>`
    : (CS.codes.filter((c) => c.to === email).map((c) => `<div class="cs-code"><span><span class="ktag k-${esc(c.kind || "otro")}">${KIND[c.kind] || KIND.otro}</span><small>${ago(c.receivedAt)}</small></span>
        <span class="cs-act">${c.code ? `<b>${esc(c.code)}</b><button class="sbtn sm" type="button" data-copy="${esc(c.code.replace(/\D/g, ""))}">Copiar</button>` : ""}${c.link ? `<a class="sbtn sm pri" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>` : ""}</span></div>`).join("")
      || `<p class="empty" style="margin:0">No llegó ningún código de esta cuenta en los últimos 30 minutos. Pedilo en la app: acá aparece solo en unos segundos.</p>`);
  svcAuto();
  return `${btn}<div class="cs-svc" role="region" aria-label="Códigos de esta cuenta">${list}<div class="rbtns"><button class="sbtn sm" type="button" data-svcreload="${esc(id)}">🔄 Actualizar</button></div></div>`;
}

// Mientras haya un «Ver códigos» abierto a la vista, se consulta cada 10 s y se redibuja solo si llegó algo nuevo.
let svcTimer = null;
const sigOf = (l) => (l ?? []).map((c) => `${c.to}|${c.receivedAt}|${c.code}|${c.link ?? ""}`).join(";");
function svcAuto() {
  if (svcTimer || typeof document === "undefined") return;
  svcTimer = setInterval(async () => {
    if (!document.querySelector(".cs-svc")) { clearInterval(svcTimer); svcTimer = null; return; }
    if (document.hidden || CS.codes === null) return;
    try { const l = await api("GET", "/api/me/codes"); if (sigOf(l) !== sigOf(CS.codes)) { CS.codes = l; RENDER(); } } catch { /* sin conexión: se reintenta en 10 s */ }
  }, 10_000);
}

async function loadCodes() {
  CS.codes = null; RENDER();
  try { CS.codes = await api("GET", "/api/me/codes"); } catch (e) { CS.codes = []; toast(e.message); }
  RENDER();
}

if (typeof document !== "undefined") {
  document.addEventListener("change", async (ev) => {
    const el = ev.target;
    const rid = el?.dataset?.csrental, oid = el?.dataset?.csown;
    if (!rid && !oid) return;
    ev.stopPropagation();
    el.disabled = true;
    try {
      const r = await api("POST", rid ? `/api/me/self-codes/rental/${encodeURIComponent(rid)}` : `/api/me/self-codes/own/${encodeURIComponent(oid)}`, { on: el.checked });
      toast(r.on ? "📩 Listo: tus clientes ven su código solos" : "Apagado: tus clientes te piden el código a vos");
      await loadSelfCodes();
    } catch (e) { el.checked = !el.checked; toast(e.message); }
    el.disabled = false;
    RENDER();
  }, true);
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-svccodes],[data-svcreload]");
    if (!b) return;
    ev.stopPropagation();
    if (b.dataset.svcreload) return loadCodes();
    const id = b.dataset.svccodes;
    CS.svc[id] = !CS.svc[id];
    if (CS.svc[id]) return loadCodes();
    RENDER();
  }, true);
}
