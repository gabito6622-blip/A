// "🔔 Avisarme antes de que venza": la tarjeta de "Mis cuentas" (cliente con cuenta), las marcas del
// revendedor (quiénes de sus clientes reciben avisos solos) y la línea de invitación para su WhatsApp.
// Los avisos los manda el servidor una vez por día (3 días antes, 1 día antes y el día que vence).
// shop.js, sublinks.js y ownstock.js solo llaman a estas funciones: la lógica está acá.
import { api, esc, toast } from "/common.js";

export const pushOk = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const b64u = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

/** La suscripción de ESTE navegador (o null). */
export async function currentSub() {
  if (!pushOk()) return null;
  try { const reg = await navigator.serviceWorker.getRegistration("/"); return reg ? await reg.pushManager.getSubscription() : null; } catch { return null; }
}
/** Pide permiso y suscribe este navegador (reusa la suscripción si ya había una). */
export async function subscribeHere(publicKey) {
  if (await Notification.requestPermission() !== "granted") throw new Error("Sin permiso no te podemos avisar. Activalo en los ajustes del navegador (candado → Notificaciones).");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(publicKey) });
}
/** Para el iPhone: la página tiene que poder agregarse a inicio como app (sin esto, Safari no da avisos). */
export function ensureManifest(href) {
  if (typeof document === "undefined" || document.querySelector('link[rel="manifest"]')) return;
  document.head.insertAdjacentHTML("beforeend", `<link rel="manifest" href="${esc(href)}"><link rel="apple-touch-icon" href="/app-icon-192.png">`);
}

/** Qué le mostramos a quien no puede activar avisos en este navegador. "" si sí puede. */
export function cantText(where) {
  if (pushOk()) return typeof Notification !== "undefined" && Notification.permission === "denied"
    ? "Bloqueaste los avisos de esta página. Activalos en los ajustes del navegador (candado → Notificaciones) y volvé a tocar el botón." : "";
  if (isIOS() && !standalone()) return `En iPhone: abrí ${where} en Safari, tocá Compartir ⬆️ y después «Agregar a inicio». Entrá desde ese ícono nuevo y tocá de nuevo «Avisarme antes de que venza».`;
  return "Este navegador no permite avisos. Abrí esta página en Chrome (Android) o en Safari (iPhone).";
}

/* ---------------- Cliente con cuenta: tarjeta en "Mis cuentas" ---------------- */
const A = { cfg: null, on: false, busy: false, err: "" };
/** Se llama al cargar "Mis cuentas" (solo clientes, no revendedores). */
export async function loadAlertsCard() {
  A.cfg = await api("GET", "/api/me/push").catch(() => null);
  A.on = !!(A.cfg?.mine && await currentSub());
  A.err = "";
  if (isIOS() && !standalone()) ensureManifest("/tienda.webmanifest");
}
export function alertsCard() {
  if (!A.cfg?.configured) return "";
  const cant = cantText("la tienda");
  return `<div class="sbox avisos" id="avisos"><h2>🔔 Avisarme antes de que venza</h2>
    <p class="empty" style="margin:0">Te llega un aviso a este celular 3 días antes, 1 día antes y el día que vence. Gratis y sin WhatsApp. Nunca lleva tus contraseñas.</p>
    ${A.on ? `<div class="rbtns"><span class="spill sp-ok">✓ Activado en este celular</span><button class="sbtn sm" type="button" data-avisos="off" ${A.busy ? "disabled" : ""}>Dejar de avisarme</button></div>`
      : cant && !pushOk() ? `<p class="empty" style="margin:0">${esc(cant)}</p>`
      : `<button class="sbtn pri" type="button" data-avisos="on" style="justify-self:start" ${A.busy ? "disabled" : ""}>🔔 Avisarme antes de que venza</button>${cant ? `<p class="err" role="alert" style="margin:0">${esc(cant)}</p>` : ""}`}
    ${A.err ? `<p class="err" role="alert" style="margin:0">${esc(A.err)}</p>` : ""}</div>`;
}
/** Botones de la tarjeta. Devuelve true si atendió el clic. */
export async function alertsClick(d, render) {
  if (!d.avisos || A.busy) return !!d.avisos;
  A.busy = true; A.err = ""; render();
  try {
    if (d.avisos === "on") {
      const sub = await subscribeHere(A.cfg.publicKey);
      await api("POST", "/api/me/push/subscribe", { subscription: sub.toJSON() });
      A.on = true; A.cfg.mine = (A.cfg.mine ?? 0) + 1;
      toast("🔔 Listo: te avisamos antes de que venza");
    } else {
      const sub = await currentSub();
      if (sub) await api("POST", "/api/me/push/unsubscribe", { endpoint: sub.endpoint });
      A.on = false;
      toast("Ya no te avisamos en este celular");
    }
  } catch (e) { A.err = e.message || "No pudimos cambiar los avisos. Probá de nuevo."; }
  A.busy = false; render();
  return true;
}

/* ---------------- Revendedor: quiénes de sus clientes reciben avisos solos ---------------- */
const L = { subs: new Set(), own: new Set(), count: 0 };
/** Lee cuáles de SUS links de cobro tienen avisos (solo ids suyos). */
export async function loadLinkAlerts() {
  const r = await api("GET", "/api/me/link-alerts").catch(() => null);
  L.subs = new Set(r?.subs ?? []); L.own = new Set(r?.own ?? []); L.count = r?.count ?? 0;
}
const TAG = `<span class="spill sp-ok avtag">🔔 avisos automáticos activados</span>`;
export const subAlertOn = (aid, sid) => L.subs.has(`${aid}|${sid}`);
export const subAlertTag = (aid, sid) => (subAlertOn(aid, sid) ? ` ${TAG}` : "");
export const ownAlertTag = (saleId) => (L.own.has(saleId) ? ` ${TAG}` : "");
/** "N de tus clientes reciben avisos solos" (o cómo activarlo, si todavía nadie). */
export function alertsSummary() {
  return L.count
    ? `<p class="empty avsum" style="margin:0">🔔 <b>${L.count === 1 ? "1 de tus clientes recibe" : `${L.count} de tus clientes reciben`} avisos solos</b> antes de que les venza.</p>`
    : `<p class="empty avsum" style="margin:0">🔔 Tus clientes pueden recibir avisos solos antes de que les venza: mandales su link de cobro y que toquen «Avisarme antes de que venza».</p>`;
}
/** Renglón para el WhatsApp de cobro o recordatorio (si ese cliente todavía no activó los avisos). */
export const INVITE = "\n🔔 En el link tocá «Avisarme antes de que venza» y te llega un aviso solo antes de que se venza.";
export const inviteSub = (sid) => ([...L.subs].some((k) => k.endsWith(`|${sid}`)) ? "" : INVITE);
export const inviteOwn = (saleId) => (L.own.has(saleId) ? "" : INVITE);
