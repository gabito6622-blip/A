// 🏢 Mi oficina 2.0 (Premium 2.0, etapa 7): los 6 asistentes de la tienda en una sala nocturna, trabajando de verdad.
// Propuesta 1 «Oficina nocturna» (aprobada) + la línea de tiempo de la Propuesta 2. Todo sale de /api/admin/office:
// si un asistente trabajó hace poco su monitor «corre», si está apagado duerme, si encontró algo grave su anillo se
// pone rojo. Tocás uno y ves lo que hizo y lo prendés o apagás (solo el dueño). Se actualiza sola cada 20 s mientras
// la pantalla está abierta. No gasta crédito de Claude: solo muestra lo que ya pasó. Nunca inventa eventos.
import { api, esc, toast } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/oficina.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/oficina.css";
  document.head.appendChild(l);
}

/** Los 6 de la oficina: nombre, puesto, colores (paleta Premium) y qué hacen. */
export const CREW = {
  receipts: { name: "Rocío", role: "Revisora de comprobantes", emoji: "🧾", skin: "#f1c27d", hair: "#3b2416", shirt: "#2f6bff", acc: "#22d3ee", long: true, glasses: true,
    does: "Lee cada comprobante que suben y te dice si el monto y el número coinciden con el pedido. Nunca aprueba: aprobás vos.",
    idle: ["Esperando comprobantes…", "Lista para revisar 🧐", "Ningún comprobante nuevo"] },
  whatsapp: { name: "Wali", role: "Atención por WhatsApp", emoji: "💬", skin: "#c68642", hair: "#1b1b1b", shirt: "#10b981", acc: "#25d366", headset: true,
    does: "Responde por WhatsApp lo que el bot de palabras clave no entiende. Si no sabe algo, te pasa la charla a vos.",
    idle: ["Nadie escribió todavía", "Atento al WhatsApp 📱", "Esperando mensajes…"] },
  daily: { name: "Dani", role: "Asistente del dueño", emoji: "🧠", skin: "#e0ac69", hair: "#6b4423", shirt: "#8b5cf6", acc: "#f2c94c", tie: true,
    does: "Cada mañana a las 8 te arma el reporte del día y en Inicio le preguntás lo que quieras de tu negocio. Solo lee: nunca cambia nada.",
    idle: ["Juntando los números del día…", "Mañana a las 8 te mando el reporte", "Preguntame lo que quieras en Inicio"] },
  watch: { name: "Vico", role: "Vigilante de cuentas", emoji: "🚨", skin: "#8d5524", hair: "#2c2c2c", shirt: "#ef4444", acc: "#fb7185", cap: true,
    does: "Lee los correos de las plataformas y te avisa si a una cuenta le cambiaron la contraseña, el pago falló o la cancelaron. Con reglas siempre (gratis) y con IA para los correos raros.",
    idle: ["Todo tranquilo con las cuentas 👀", "Vigilando los correos…", "Ninguna cuenta en riesgo"] },
  codes: { name: "Coco", role: "Lector de códigos", emoji: "🔑", skin: "#ffdbac", hair: "#a0522d", shirt: "#7c3aed", acc: "#c084fc", beanie: true,
    does: "Lee tus buzones y guarda solos los códigos de acceso que mandan las plataformas. No usa IA: es gratis.",
    idle: ["Mirando los buzones…", "Ningún código nuevo", "Listo para el próximo código"] },
  cartero: { name: "Tito", role: "Cartero de avisos", emoji: "📬", skin: "#d6a06b", hair: "#4a3020", shirt: "#f97316", acc: "#fdba74", bag: true,
    does: "Cada mañana a las 9 manda solo los avisos de vencimiento al celular de los clientes que los activaron. No usa IA: es gratis.",
    idle: ["Mañana a las 9 reparto los avisos", "Esperando la hora de repartir…", "Hoy no vence nadie con avisos"] },
  // Lo que hiciste vos (aprobar, vender, renovar) también entra a la línea de tiempo, para que la oficina cuente el día completo.
  owner: { name: "Vos", role: "Dueño", emoji: "👤" },
};
const ORDER = ["receipts", "whatsapp", "daily", "watch", "codes", "cartero"];
const AI_KEYS = ["receipts", "whatsapp", "daily", "watch"];

/* ---------------- avatar vectorial propio (cabeza + cuerpo + accesorio) ---------------- */
function avatar(id) {
  const c = CREW[id], k = "#0f172a";
  const hairLong = c.long ? `<path d="M11 18 q-2 10 1 18 h4 v-14z M37 18 q2 10 -1 18 h-4 v-14z" fill="${c.hair}"/>` : "";
  const glasses = c.glasses ? `<g stroke="${k}" stroke-width="1.4" fill="none"><circle cx="18.5" cy="21" r="3.6"/><circle cx="29.5" cy="21" r="3.6"/><path d="M22.1 21h3.8"/></g>` : "";
  const headset = c.headset ? `<path d="M12 19 q0-10 12-10 q12 0 12 10" stroke="${k}" stroke-width="2.4" fill="none"/><rect x="10" y="18" width="4" height="7" rx="1.5" fill="${k}"/><rect x="34" y="18" width="4" height="7" rx="1.5" fill="${k}"/><path d="M14 25 q0 6 7 6" stroke="${k}" stroke-width="1.6" fill="none"/>` : "";
  const cap = c.cap ? `<path d="M12 17 q12-10 24 0 v2 h-26z" fill="${c.acc}"/><rect x="24" y="16" width="14" height="3" rx="1.5" fill="${c.acc}"/>` : "";
  const beanie = c.beanie ? `<path d="M13 18 q11-12 22 0 v1 h-22z" fill="${c.acc}"/><circle cx="24" cy="8.5" r="2.2" fill="#fff"/>` : "";
  const tie = c.tie ? `<path d="M24 32 l-2.5 3 2.5 9 2.5-9z" fill="${c.acc}"/>` : "";
  const bag = c.bag ? `<path d="M14 31 l6 14 h-9z" fill="${c.acc}"/>` : "";
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <defs><linearGradient id="of-g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.shirt}"/><stop offset="1" stop-color="${c.shirt}" stop-opacity=".55"/></linearGradient></defs>
    <path d="M8 48 v-8 q0-9 9-9 h14 q9 0 9 9 v8z" fill="url(#of-g-${id})"/>${tie}${bag}
    <rect x="18" y="26" width="12" height="7" rx="3" fill="${c.skin}"/>
    <circle cx="24" cy="20" r="10" fill="${c.skin}"/>
    <path d="M14 19 q1-10 10-10 q9 0 10 10 q-5-4-10-4 q-5 0-10 4z" fill="${c.hair}"/>${hairLong}${cap}${beanie}
    <circle class="of-eye" cx="20" cy="21" r="1.3" fill="${k}"/><circle class="of-eye" cx="28" cy="21" r="1.3" fill="${k}"/>
    <path d="M21 25.5 q3 2.2 6 0" stroke="#7c2d12" stroke-width="1.2" fill="none" stroke-linecap="round"/>${glasses}${headset}
  </svg>`;
}

/* ---------------- estado de cada uno ---------------- */
const MIN = 60_000;
function stateOf(a, now) {
  if (!a.on) return "off";
  const age = a.last ? now - a.last.at : Infinity;
  if (a.last?.tone === "bad" && age < 24 * 60 * MIN) return "alert";
  if (age < 15 * MIN) return "work";
  return "idle";
}
const STATE_TXT = { off: "💤 Durmiendo", work: "⌨️ Trabajando", alert: "🚨 ¡Ojo!", idle: "☕ Esperando" };
const ago = (t, now) => {
  const m = Math.max(0, Math.round((now - t) / MIN));
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `el ${ddmm(t)}`;
};
const hhmm = (t) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
const ddmm = (t) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(t));

function bubble(a, st, now, owner) {
  const c = CREW[a.id];
  if (st === "off") return `<span class="of-bub of-bub-off"><span class="of-btx">Zzz… Estoy apagad${c.long ? "a" : "o"}.${owner && a.ai ? " Tocame para prenderme." : ""}</span></span>`;
  if (a.last && now - a.last.at < 24 * 60 * MIN) return `<span class="of-bub of-t-${esc(a.last.tone)}"><span class="of-btx">${esc(a.last.text)}</span><small>${ago(a.last.at, now)}</small></span>`;
  const phr = c.idle[Math.floor(now / (5 * MIN)) % c.idle.length];
  return `<span class="of-bub of-bub-idle"><span class="of-btx">${esc(phr)}</span></span>`;
}

function desk(a, d, owner, hop) {
  const c = CREW[a.id], st = stateOf(a, d.now);
  const label = `${c.name}, ${c.role}: ${STATE_TXT[st].slice(2)}. ${a.last ? a.last.text : ""}`;
  return `<button type="button" class="of-desk of-${st}${hop ? " of-hop" : ""}${S.sel === a.id ? " of-sel" : ""}" data-ofsel="${a.id}" aria-label="${esc(label)}" aria-expanded="${S.sel === a.id}">
    ${bubble(a, st, d.now, owner)}
    <span class="of-scene"><span class="of-ring">${avatar(a.id)}${st === "off" ? `<span class="of-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>` : ""}${st === "alert" ? `<span class="of-bang" aria-hidden="true">!</span>` : ""}</span><span><span class="of-mon"></span><span class="of-bar"></span></span></span>
    <span class="of-who"><span><b>${c.emoji} ${esc(c.name)}</b><span>${esc(c.role)}</span></span><span class="of-kpi"><b>${a.today}</b><small>hoy</small></span></span>
    <span class="of-pill ${st}"><i></i>${STATE_TXT[st].slice(2)}</span>
  </button>`;
}

/** Pared: ventanas con el cielo de La Paz según la hora, reloj y resumen. */
function wall(d) {
  const h = d.hour, sky = h >= 7 && h < 17 ? "day" : (h >= 17 && h < 19) || (h >= 5 && h < 7) ? "dusk" : "night";
  const working = d.agents.filter((a) => { const s = stateOf(a, d.now); return s === "work" || s === "alert"; }).length;
  const alerts = d.agents.filter((a) => stateOf(a, d.now) === "alert").length;
  const on = d.agents.filter((a) => a.on).length, done = d.agents.reduce((t, a) => t + a.today, 0);
  const star = (l, t) => `<i style="left:${l}%;top:${t}%"></i>`;
  const last = d.feed.slice(0, 4).map((x) => `<b>${esc(CREW[x.a]?.name ?? "")}</b> ${esc(x.text.replace(/\.$/, ""))}`).join(" · ");
  return `<div class="of-wall of-${sky}">
    <div class="of-win" aria-hidden="true">${star(12, 30)}${star(40, 18)}${star(70, 40)}</div><div class="of-win" aria-hidden="true">${star(22, 24)}${star(66, 60)}${star(84, 22)}</div>
    <div class="of-clock" aria-label="Hora de Bolivia"><b id="ofClock">${hhmm(d.now)}</b><small>La Paz</small></div>
  </div>
  <div class="of-ticker" aria-live="polite">${last ? `🔴 <b>EN VIVO</b> · ${last}` : `🌙 Todo tranquilo · ${on} de 6 en su puesto`}</div>
  <p class="of-sum"><b>${on} de 6</b> en su puesto · <b>${working}</b> trabajando ahora${alerts ? ` · <b>${alerts}</b> alerta${alerts === 1 ? "" : "s"}` : ""} · <b>${done}</b> cosa${done === 1 ? "" : "s"} hecha${done === 1 ? "" : "s"} hoy</p>`;
}

function detail(d, owner) {
  const a = d.agents.find((x) => x.id === S.sel);
  if (!a) return "";
  const c = CREW[a.id], st = stateOf(a, d.now);
  let btn = "";
  if (AI_KEYS.includes(a.id) && owner && d.hasKey) {
    const isOn = a.id === "watch" ? a.aiOn : a.on;
    btn = a.id === "watch"
      ? `<button type="button" class="pbtn${isOn ? "" : " dark"}" data-oftoggle="watch" data-on="${isOn ? 0 : 1}">${isOn ? "Que use solo reglas (sin IA)" : "Que use IA para correos raros"}</button>`
      : `<button type="button" class="pbtn${isOn ? "" : " dark"}" data-oftoggle="${a.id}" data-on="${isOn ? 0 : 1}">${isOn ? `Apagar a ${esc(c.name)}` : `▶ Prender a ${esc(c.name)}`}</button>`;
  } else if (a.id === "codes") btn = `<button type="button" class="pbtn" data-go="codigos">Ir al Panel de códigos</button>`;
  else if (a.id === "cartero") btn = `<button type="button" class="pbtn" data-go="notificaciones">Ver Notificaciones</button>`;
  const list = a.recent.length ? `<ul class="of-log">${a.recent.map((x) => `<li class="of-t-${esc(x.tone)}"><time>${ddmm(x.at)} ${hhmm(x.at)}</time>${esc(x.text)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">Todavía no hizo nada esta semana.</p>`;
  return `<section class="card of-detail" id="ofDetail"><h2>${c.emoji} ${esc(c.name)} <small>${esc(c.role)} · ${STATE_TXT[st]}</small></h2>
    <p class="muted" style="margin:0">${esc(c.does)}</p>
    ${a.ai ? `<p class="muted" style="margin:0">${a.id === "watch" ? "Las reglas no gastan nada; la IA usa" : "Usa"} crédito de Claude${a.id === "watch" ? " (como mucho 30 correos por día)" : ""}.</p>` : `<p class="muted" style="margin:0">💚 Gratis: no usa IA.</p>`}
    <h3 style="margin:6px 0 0;font-size:15px">Lo que hizo esta semana</h3>${list}
    <div class="inline">${btn}<button type="button" class="pbtn" data-ofsel="${a.id}">Cerrar</button></div></section>`;
}

/** Línea de tiempo (Propuesta 2): lo de hoy, con hora; si hoy no pasó nada, lo último de la semana. */
function timeline(d) {
  const today = d.feed.filter((x) => ddmm(x.at) === ddmm(d.now));
  const rows = (today.length ? today : d.feed.slice(0, 10)).slice(0, 25);
  return `<section class="card"><h2>🕑 ${today.length ? "Lo que pasó hoy" : "Lo último que pasó"} <small class="muted" style="font-weight:500">se actualiza sola</small></h2>
    ${rows.length ? `<ol class="of-tl">${rows.map((x) => `<li class="of-t-${esc(x.tone)}"><time>${today.length ? "" : ddmm(x.at) + " "}${hhmm(x.at)}</time>${esc(x.text)}<small>${CREW[x.a]?.emoji ?? ""} ${esc(CREW[x.a]?.name ?? "")}</small></li>`).join("")}</ol>` : `<p class="muted" style="margin:0">Todavía nada esta semana. Cuando tus asistentes trabajen (o vos vendas, aprobés o renueves), lo vas a ver acá.</p>`}</section>`;
}

/** Para hoy: lo pendiente que ya calcula Mi secretaria (solo conteos), con el botón para abrirla. */
function todayCard(d) {
  const p = d.pendientes;
  if (!p) return "";
  const items = [p.cobrar && `🔔 Cobrar: ${p.cobrar}`, p.cortar && `✂️ Cortar: ${p.cortar}`, p.sinAnotar && `🗓️ Vencidas sin anotar: ${p.sinAnotar}`, p.avisar && `⏰ Avisar: ${p.avisar}`, p.claves && `🔑 Claves por cambiar: ${p.claves}`, p.desenlazar && `🔗 Desenlazar: ${p.desenlazar}`].filter(Boolean);
  return `<section class="card"><h2>📌 Para hoy</h2><div class="of-today">${items.length ? items.map((x) => `<div>${esc(x)}</div>`).join("") : `<div class="muted">Nada pendiente 🎉</div>`}<button type="button" class="pbtn dark" data-go="secretaria">🗂️ Abrir Mi secretaria</button></div></section>`;
}

function costCard(d) {
  if (!d.ai) return "";
  const pct = d.ai.limitUsd > 0 ? Math.min(100, Math.round((d.ai.spentUsd / d.ai.limitUsd) * 100)) : 0;
  return `<section class="card"><h2>💳 Claude este mes</h2><div class="of-costbar"><i style="width:${pct}%"></i></div>
    <p class="of-cost muted">US$ ${d.ai.spentUsd.toFixed(2)} de tu tope de US$ ${d.ai.limitUsd} (${pct} %) · ${d.ai.calls} consulta${d.ai.calls === 1 ? "" : "s"} · ${esc(d.ai.model)}</p></section>`;
}

/* ---------------- pantalla ---------------- */
const S = { sel: null, data: null, last: {}, timer: null, clock: null };

function html(d, hop = new Set()) {
  const owner = !!d.ai;
  return `<div class="of-wrap">
    ${wall(d)}
    ${!d.hasKey ? `<div class="pok" style="margin:8px 12px 0">Rocío, Wali y Dani necesitan la clave de Claude para trabajar. Se carga una sola vez en Configuración → Oficina virtual.</div>` : ""}
    <div class="of-floor">${ORDER.map((id) => desk(d.agents.find((a) => a.id === id), d, owner, hop.has(id))).join("")}</div>
  </div>
  ${detail(d, owner)}
  <div class="of-grid"><div>${timeline(d)}</div><div style="display:grid;gap:12px">${todayCard(d)}${costCard(d)}</div></div>`;
}

export async function officeView() {
  const d = await api("GET", "/api/admin/office");
  S.data = d;
  S.last = Object.fromEntries(d.agents.map((a) => [a.id, a.last?.at ?? 0]));
  return `<div id="ofRoot">${html(d)}</div>`;
}

/** Después de pintar: reloj, actualización cada 20 s y clics. */
export function officeMount(isOpen) {
  clearInterval(S.timer); clearInterval(S.clock);
  const tick = async () => {
    if (!isOpen()) { clearInterval(S.timer); clearInterval(S.clock); return; }
    if (document.hidden) return;
    const d = await api("GET", "/api/admin/office").catch(() => null);
    const root = document.getElementById("ofRoot");
    if (!d || !root) return;
    const hop = new Set(d.agents.filter((a) => (a.last?.at ?? 0) > (S.last[a.id] ?? 0)).map((a) => a.id));
    S.last = Object.fromEntries(d.agents.map((a) => [a.id, a.last?.at ?? 0]));
    const feedChanged = (d.feed[0]?.at ?? 0) !== (S.data?.feed?.[0]?.at ?? 0);
    S.data = d;
    if (hop.size || feedChanged || ORDER.some((id) => d.agents.find((a) => a.id === id)?.on !== S.prevOn?.[id])) root.innerHTML = html(d, hop);
    S.prevOn = Object.fromEntries(d.agents.map((a) => [a.id, a.on]));
  };
  S.prevOn = S.data ? Object.fromEntries(S.data.agents.map((a) => [a.id, a.on])) : {};
  S.timer = setInterval(tick, 20_000);
  S.clock = setInterval(() => { const c = document.getElementById("ofClock"); if (c) c.textContent = hhmm(Date.now()); }, 30_000);
}

if (typeof document !== "undefined") document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-ofsel],[data-oftoggle]");
  if (!b || !document.getElementById("ofRoot") || !S.data) return;
  const root = document.getElementById("ofRoot");
  if (b.dataset.ofsel) {
    S.sel = S.sel === b.dataset.ofsel ? null : b.dataset.ofsel;
    root.innerHTML = html(S.data);
    if (S.sel) document.getElementById("ofDetail")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
    else root.querySelector(`[data-ofsel="${b.dataset.ofsel}"]`)?.focus();
    return;
  }
  const k = b.dataset.oftoggle, on = b.dataset.on === "1";
  b.disabled = true;
  try {
    await api("POST", "/api/admin/ai", { enabled: { [k]: on } });
    S.data = await api("GET", "/api/admin/office");
    root.innerHTML = html(S.data);
    toast(on ? `${CREW[k].name} ya está trabajando ✓` : `${CREW[k].name} se fue a dormir 💤`);
  } catch (e) { toast(e.message); b.disabled = false; }
});
