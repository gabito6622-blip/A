// 🏢 Mi oficina: los asistentes de la tienda dibujados en 2D (pixel art propio), trabajando de verdad.
// Cada personaje muestra lo que su asistente HIZO (datos de /api/admin/office): si trabajó hace poco teclea,
// si está apagado duerme, si encontró algo grave prende su alarma. Tocás uno y ves lo que hizo y lo prendés
// o apagás (solo el dueño). Se actualiza sola cada 20 s mientras la pantalla está abierta.
// No gasta crédito de Claude: solo muestra lo que ya pasó.
import { api, esc, toast } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/oficina.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/oficina.css";
  document.head.appendChild(l);
}

/** Los 6 de la oficina: nombre, puesto, colores y qué hacen. */
export const CREW = {
  receipts: { name: "Rocío", role: "Revisora de comprobantes", emoji: "🧾", skin: "#f1c27d", hair: "#3b2416", shirt: "#2f6fd6", acc: "#27ae60", long: true,
    does: "Lee cada comprobante que suben y te dice si el monto y el número coinciden con el pedido. Nunca aprueba: aprobás vos.",
    idle: ["Esperando comprobantes…", "Lista para revisar 🧐", "Ningún comprobante nuevo"] },
  whatsapp: { name: "Wali", role: "Atención por WhatsApp", emoji: "💬", skin: "#c68642", hair: "#1b1b1b", shirt: "#1e9e57", acc: "#25d366",
    does: "Responde por WhatsApp lo que el bot de palabras clave no entiende. Si no sabe algo, te pasa la charla a vos.",
    idle: ["Nadie escribió todavía", "Atento al WhatsApp 📱", "Esperando mensajes…"] },
  daily: { name: "Dani", role: "Asistente del dueño", emoji: "🧠", skin: "#e0ac69", hair: "#6b4423", shirt: "#34495e", acc: "#f2c94c",
    does: "Cada mañana a las 8 te arma el reporte del día y en Inicio le preguntás lo que quieras de tu negocio. Solo lee: nunca cambia nada.",
    idle: ["Juntando los números del día…", "Mañana a las 8 te mando el reporte", "Preguntame lo que quieras en Inicio"] },
  watch: { name: "Vico", role: "Vigilante de cuentas", emoji: "🚨", skin: "#8d5524", hair: "#2c2c2c", shirt: "#b83227", acc: "#eb5757",
    does: "Lee los correos de las plataformas y te avisa si a una cuenta le cambiaron la contraseña, el pago falló o la cancelaron. Con reglas siempre (gratis) y con IA para los correos raros.",
    idle: ["Todo tranquilo con las cuentas 👀", "Vigilando los correos…", "Ninguna cuenta en riesgo"] },
  codes: { name: "Coco", role: "Lector de códigos", emoji: "🔑", skin: "#ffdbac", hair: "#a0522d", shirt: "#7d3c98", acc: "#bb6bd9",
    does: "Lee tus buzones y guarda solos los códigos de acceso que mandan las plataformas. No usa IA: es gratis.",
    idle: ["Mirando los buzones…", "Ningún código nuevo", "Listo para el próximo código"] },
  cartero: { name: "Tito", role: "Cartero de avisos", emoji: "📬", skin: "#d6a06b", hair: "#4a3020", shirt: "#d35400", acc: "#f2994a",
    does: "Cada mañana a las 9 manda solo los avisos de vencimiento al celular de los clientes que los activaron. No usa IA: es gratis.",
    idle: ["Mañana a las 9 reparto los avisos", "Esperando la hora de repartir…", "Hoy no vence nadie con avisos"] },
};
const ORDER = ["receipts", "whatsapp", "daily", "watch", "codes", "cartero"];
const AI_KEYS = ["receipts", "whatsapp", "daily", "watch"];

/* ---------------- dibujo (pixel art propio, 1 unidad = 1 pixel) ---------------- */
const BASE = [
  "...HHHHHH...",
  "..HHHHHHHH..",
  "..HSSSSSSH..",
  "..SSSSSSSS..",
  "..SSESSESS..",
  "..SSSSSSSS..",
  "...SSMMSS...",
  "....SSSS....",
  "..CCCCCCCC..",
  ".CCCCCCCCCC.",
  ".CCCCCCCCCC.",
  ".CCCCCCCCCC.",
];
/** Lo propio de cada uno: [x, y, color] encima del cuerpo. K = oscuro, W = blanco, A = su color. */
const EXTRA = {
  receipts: [[1, 2, "H"], [1, 3, "H"], [1, 4, "H"], [1, 5, "H"], [10, 2, "H"], [10, 3, "H"], [10, 4, "H"], [10, 5, "H"], [1, 6, "H"], [10, 6, "H"],
    [3, 4, "K"], [5, 4, "K"], [6, 4, "K"], [8, 4, "K"]], // pelo largo y lentes
  whatsapp: [[1, 2, "K"], [1, 3, "K"], [1, 4, "K"], [10, 2, "K"], [10, 3, "K"], [10, 4, "K"], [2, 0, "K"], [9, 0, "K"], [2, 5, "K"], [3, 6, "A"]], // auriculares con micrófono
  daily: [[4, 8, "W"], [7, 8, "W"], [5, 8, "A"], [6, 8, "A"], [5, 9, "A"], [6, 9, "A"], [5, 10, "A"], [6, 10, "A"]], // camisa y corbata
  watch: [[3, 0, "A"], [4, 0, "A"], [5, 0, "A"], [6, 0, "A"], [7, 0, "A"], [8, 0, "A"], [2, 1, "A"], [3, 1, "A"], [4, 1, "A"], [5, 1, "W"], [6, 1, "A"], [7, 1, "A"], [8, 1, "A"], [9, 1, "A"],
    [8, 2, "K"], [9, 2, "K"], [10, 2, "K"], [3, 9, "W"]], // gorra con visera y placa
  codes: [[3, 0, "A"], [4, 0, "A"], [5, 0, "A"], [6, 0, "A"], [7, 0, "A"], [8, 0, "A"], [2, 1, "W"], [3, 1, "W"], [4, 1, "W"], [5, 1, "W"], [6, 1, "W"], [7, 1, "W"], [8, 1, "W"], [9, 1, "W"], [5, -1, "W"], [6, -1, "W"]], // gorro de lana con pompón
  cartero: [[2, 1, "A"], [3, 1, "A"], [4, 1, "A"], [5, 1, "A"], [6, 1, "A"], [7, 1, "A"], [8, 1, "A"], [9, 1, "A"], [1, 2, "K"], [2, 2, "K"], [3, 2, "K"], [4, 2, "K"], [5, 2, "K"], [6, 2, "K"], [7, 2, "K"], [8, 2, "K"], [9, 2, "K"], [10, 2, "K"],
    [7, 9, "W"], [8, 9, "W"], [7, 10, "W"], [8, 10, "W"]], // gorra de cartero y sobre
};
/** Lo que tiene cada uno arriba del escritorio. */
const ITEM = {
  receipts: `<rect x="2" y="10" width="6" height="3" fill="#fff"/><rect x="2" y="9" width="6" height="1" fill="#e9eef5"/><rect x="3" y="11" width="4" height="0.5" fill="#9aa5b5"/><rect class="of-tick" x="7" y="7" width="2" height="2" fill="#27ae60"/>`,
  whatsapp: `<rect x="25" y="7" width="4" height="6" fill="#222"/><rect class="of-scr" x="25.5" y="8" width="3" height="4" fill="#25d366"/>`,
  daily: `<rect x="25" y="10" width="3" height="3" fill="#fff"/><rect x="28" y="11" width="1" height="1" fill="#fff"/><rect x="25.5" y="10" width="2" height="0.7" fill="#6b4423"/><rect class="of-steam" x="26" y="7" width="0.6" height="2" fill="#dfe6ee"/><rect class="of-steam s2" x="27" y="6.5" width="0.6" height="2" fill="#dfe6ee"/>`,
  watch: `<rect x="25" y="11" width="4" height="2" fill="#333"/><rect class="of-siren" x="25.5" y="8" width="3" height="3" fill="#eb5757"/>`,
  codes: `<rect x="2" y="10" width="3" height="3" fill="#f2c94c"/><rect x="3" y="11" width="1" height="1" fill="#9c6a3a"/><rect x="5" y="11" width="4" height="1" fill="#f2c94c"/><rect x="7" y="12" width="1" height="1" fill="#f2c94c"/><rect x="8.5" y="12" width="0.8" height="1" fill="#f2c94c"/>`,
  cartero: `<rect x="2" y="10" width="6" height="3" fill="#fff"/><path d="M2 10 L5 11.8 L8 10" stroke="#9aa5b5" stroke-width="0.4" fill="none"/><rect x="3" y="8.5" width="5" height="1.6" fill="#f6f1e6"/><rect class="of-tick" x="7.5" y="7" width="1.5" height="1.5" fill="#eb5757"/>`,
};

function sprite(id) {
  const c = CREW[id], col = { H: c.hair, S: c.skin, C: c.shirt, A: c.acc, K: "#23272f", W: "#ffffff", M: "#b5523b" };
  const px = new Map();
  BASE.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") px.set(`${x},${y}`, ch); }));
  for (const [x, y, k] of EXTRA[id]) px.set(`${x},${y}`, k);
  let out = "";
  for (const [k, ch] of px) {
    const [x, y] = k.split(",").map(Number);
    if (ch === "E") { out += `<rect class="of-eye" x="${x + 10}" y="${y + 2}" width="1" height="1" fill="#1b1b1b"/>`; continue; }
    out += `<rect x="${x + 10}" y="${y + 2}" width="1.02" height="1.02" fill="${col[ch]}"/>`;
  }
  return out;
}

/** Escritorio completo: personaje, manos, laptop, cosas y mueble. */
function deskSvg(id) {
  const c = CREW[id];
  return `<svg class="of-svg" viewBox="0 0 32 22" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
    <g class="of-chr">${sprite(id)}</g>
    <rect class="of-hl" x="11" y="12" width="2" height="1.5" fill="${c.skin}"/><rect class="of-hr" x="19" y="12" width="2" height="1.5" fill="${c.skin}"/>
    <rect x="12" y="8" width="8" height="6" fill="#cfd6e0"/><rect x="12" y="8" width="8" height="0.6" fill="#e6ebf2"/>
    <rect class="of-logo" x="15" y="10" width="2" height="2" fill="${c.acc}"/>
    ${ITEM[id]}
    <rect x="0" y="14" width="32" height="2" fill="#c58b4f"/><rect x="0" y="14" width="32" height="0.5" fill="#dca266"/>
    <rect x="1" y="16" width="30" height="6" fill="#9c6a3a"/><rect x="3" y="17" width="11" height="3.5" fill="#8a5c31"/><rect x="8" y="18.4" width="2" height="0.8" fill="#e0b070"/>
    <rect x="18" y="17" width="11" height="3.5" fill="#8a5c31"/><rect x="23" y="18.4" width="2" height="0.8" fill="#e0b070"/>
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
  const d = new Date(t);
  return `el ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
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
    <span class="of-scene">${deskSvg(a.id)}${st === "off" ? `<span class="of-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span>` : ""}${st === "alert" ? `<span class="of-bang" aria-hidden="true">!</span>` : ""}</span>
    <span class="of-plate"><b>${c.emoji} ${esc(c.name)}</b><small>${esc(c.role)}</small><span class="of-st">${STATE_TXT[st]}${a.today ? ` · hoy ${a.today}` : ""}</span></span>
  </button>`;
}

/** Ventana con el cielo de La Paz según la hora: día, tarde o noche. */
function wall(d) {
  const h = d.hour, sky = h >= 7 && h < 17 ? "day" : h >= 17 && h < 19 ? "dusk" : h >= 5 && h < 7 ? "dusk" : "night";
  const working = d.agents.filter((a) => { const s = stateOf(a, d.now); return s === "work" || s === "alert"; }).length;
  const on = d.agents.filter((a) => a.on).length, done = d.agents.reduce((t, a) => t + a.today, 0);
  return `<div class="of-wall">
    <div class="of-win of-${sky}" aria-hidden="true"><span class="of-sun"></span><span class="of-cloud"></span><span class="of-cloud c2"></span><span class="of-stars"></span><span class="of-mtn"></span></div>
    <div class="of-sign"><b>GABRIEL STORE</b><small>oficina virtual</small></div>
    <div class="of-clock" aria-label="Hora de Bolivia"><b id="ofClock">${hhmm(d.now)}</b><small>La Paz</small></div>
  </div>
  <p class="of-sum"><b>${on} de 6</b> en su puesto · <b>${working}</b> trabajando ahora · <b>${done}</b> cosa${done === 1 ? "" : "s"} hecha${done === 1 ? "" : "s"} hoy</p>`;
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

function feed(d) {
  const today = d.feed.filter((x) => ddmm(x.at) === ddmm(d.now));
  const rows = (today.length ? today : d.feed.slice(0, 10)).slice(0, 20);
  return `<section class="card"><h2>📜 ${today.length ? "Lo que pasó hoy" : "Lo último que pasó"}</h2>
    ${rows.length ? `<ul class="of-log">${rows.map((x) => `<li class="of-t-${esc(x.tone)}"><time>${today.length ? "" : ddmm(x.at) + " "}${hhmm(x.at)}</time><b>${CREW[x.a].emoji} ${esc(CREW[x.a].name)}:</b> ${esc(x.text)}</li>`).join("")}</ul>` : `<p class="muted" style="margin:0">Todavía nada esta semana. Cuando tus asistentes trabajen, lo vas a ver acá.</p>`}</section>`;
}

/* ---------------- pantalla ---------------- */
const S = { sel: null, data: null, last: {}, timer: null, clock: null };

function html(d, hop = new Set()) {
  const owner = !!d.ai;
  return `<div class="of-wrap">
    ${wall(d)}
    ${!d.hasKey ? `<div class="pok">Rocío, Wali y Dani necesitan la clave de Claude para trabajar. Se carga una sola vez en Configuración → Oficina virtual.</div>` : ""}
    <div class="of-floor">${ORDER.map((id) => desk(d.agents.find((a) => a.id === id), d, owner, hop.has(id))).join("")}</div>
  </div>
  ${detail(d, owner)}
  ${feed(d)}
  ${d.ai ? `<p class="muted of-cost">Claude este mes: <b>US$ ${d.ai.spentUsd.toFixed(2)}</b> de tu tope de US$ ${d.ai.limitUsd} · ${d.ai.calls} consulta${d.ai.calls === 1 ? "" : "s"} · ${esc(d.ai.model)}</p>` : ""}`;
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
    S.data = d;
    if (hop.size || ORDER.some((id) => d.agents.find((a) => a.id === id)?.on !== S.prevOn?.[id])) root.innerHTML = html(d, hop);
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
