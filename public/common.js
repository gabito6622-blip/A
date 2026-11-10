// Utilidades compartidas por la tienda y el panel.

/** Llama a la API. Lanza un Error con `.code` y `.status` si la respuesta no es OK. */
export async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* respuesta sin cuerpo */ }
  if (!r.ok) throw Object.assign(new Error(data.message || `Error ${r.status}`), { code: data.error, status: r.status });
  return data;
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Símbolo de moneda (configurable por la tienda; por defecto "Bs"). */
let CUR_SYM = "Bs";
/** La tienda y el panel lo fijan al cargar la configuración (ej.: "US$", "$", "₲"). */
export const setCurrency = (sym) => { const s = String(sym ?? "").trim(); if (s) CUR_SYM = s.slice(0, 6); };
export const currencySym = () => CUR_SYM;
/** Centavos → "Bs 25" / "US$ 25,50" según el símbolo configurado. */
export const bs = (cents) => `${CUR_SYM} ` + (cents / 100).toLocaleString("es-BO", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
/** "25", "25,50", "1.000" o "1.000,50" → centavos (el punto de los miles no cuenta). */
export const toCents = (v) => {
  let s = String(v ?? "").trim().replace(/^bs\.?\s*/i, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
  return Math.round(parseFloat(s.replace(",", ".")) * 100);
};

export const fdate = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
export const fdt = (t) => new Date(t).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** Días de calendario que faltan (0 = vence hoy, -1 = venció ayer), con la fecha del celular. */
export const daysLeft = (t) => {
  const a = new Date(t), b = new Date();
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000);
};

export const icon = (name, cls = "i") => `<svg class="${cls}"><use href="/icons.svg#i-${name}"/></svg>`;

let toastTimer;
export function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

/** Lee un archivo del input como base64 (sin el prefijo data:). Máx. 5 MB. */
export function fileToBase64(file) {
  return new Promise((ok, fail) => {
    if (!file) return fail(new Error("Elegí el archivo del comprobante"));
    if (file.size > 5 * 1024 * 1024) return fail(new Error("El archivo pesa más de 5 MB"));
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = () => fail(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

export const waLink = (phoneDigits, text) => `https://wa.me/${String(phoneDigits).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

// "Logo" por servicio: monograma con el color de la marca (no es el logo oficial).
const BRANDS = [
  [/netflix/, "#E50914", "N"], [/disney/, "#0C3FC4", "D+"], [/spotify/, "#1DB954", "♫"],
  [/\bmax\b|hbo/, "#7B2FF7", "M"], [/prime|amazon/, "#00A8E1", "P"], [/paramount/, "#0064FF", "P+"],
  [/crunchy/, "#F47521", "C"], [/youtube|yt\b/, "#FF0000", "▶"], [/star/, "#C9A227", "★"],
  [/vix/, "#F80032", "V"], [/deezer/, "#A238FF", "♫"], [/plex/, "#E5A00D", "P"],
  [/canva/, "#00C4CC", "C"], [/chatgpt|openai|gpt/, "#10A37F", "AI"], [/apple/, "#1d1d1f", ""],
];
export function brand(name) {
  const n = String(name ?? "").toLowerCase();
  for (const [re, color, mark] of BRANDS) if (re.test(n)) return { color, mark: mark || (String(name ?? "?")[0] || "?").toUpperCase() };
  return null;
}
export const brandBadge = (name, color, cls = "svbadge") => {
  const b = brand(name), c = b?.color ?? color ?? "#3984ff", m = b?.mark ?? (String(name ?? "?")[0] || "?").toUpperCase();
  // Letra blanca o negra, la que se lea sobre el color de la marca.
  const ink = /^#[0-9a-f]{6}$/i.test(c) ? readableOn([c]) : "#fff";
  return `<span class="${cls}" style="background:${c};color:${ink}">${esc(m)}</span>`;
};

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export const STATUS_TEXT = {
  awaiting_payment: "Esperando pago", payment_review: "En revisión", fulfilled: "Entregado",
  rejected: "Rechazado", expired: "Vencido", cancelled: "Cancelado",
};
export const KIND_TEXT = { sale: "Compra", renewal: "Renovación", topup: "Recarga" };

/* ---------------- Estilos de tienda (compartido: tienda, panel y páginas de revendedores) ---------------- */
export const FONT_LIST = [
  ["figtree", "Figtree", "Pro / limpia"], ["bricolage", "Bricolage Grotesque", "Pro / títulos"],
  ["inter", "Inter", "Moderna"], ["poppins", "Poppins", "Redondeada"], ["montserrat", "Montserrat", "Elegante"], ["nunito", "Nunito", "Amigable"],
  ["dmsans", "DM Sans", "Limpia"], ["outfit", "Outfit", "Actual"], ["bebas", "Bebas Neue", "Títulos altos"], ["orbitron", "Orbitron", "Futurista"],
  ["righteous", "Righteous", "Retro"], ["pacifico", "Pacifico", "Manuscrita"], ["playfair", "Playfair Display", "Lujo"], ["bungee", "Bungee", "Gamer"],
  ["fredoka", "Fredoka", "Divertida"], ["lobster", "Lobster", "Cursiva"], ["russo", "Russo One", "Deportiva"], ["system", "", "La del celular"],
];
export const BG_LIST = [["solid", "Liso"], ["glow", "Brillo arriba"], ["gradient", "Degradado"], ["aurora", "Aurora"], ["live", "Animado ✨"], ["dots", "Puntitos"], ["grid", "Cuadrícula"]];
export const CARD_LIST = [["solid", "Sólidas"], ["glass", "Vidrio"], ["outline", "Solo borde"], ["neon", "Neón"], ["ticket", "Boleto de cine 🎟️"], ["lista", "Lista (horizontal) ▭"], ["poster", "Póster (imagen grande) 🖼️"]];
export const LAYOUT_LIST = [
  ["clasico", "🖥️ Clásico", "Portada con texto y una tarjeta al lado, después los productos."],
  ["vitrina", "✨ Vitrina", "Portada grande y centrada, bien llamativa, con productos destacados abajo."],
  ["catalogo", "🛒 Catálogo", "Va directo a los productos, para que compren rápido."],
  ["minimal", "⬜ Minimal", "Limpio y sobrio, sin tanto adorno."],
];
/* ---------------- Contraste de colores (WCAG) ----------------
   El dueño y los revendedores eligen cualquier color. Estas funciones garantizan que el texto
   se lea (4,5:1 como mínimo, lo que pide WCAG AA para texto normal). */
export const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || "");
/** Mezcla dos colores #RRGGBB (t = proporción del segundo). */
export function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function relLum(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Contraste entre dos colores (1 a 21). Texto normal necesita 4,5 o más. */
export function contrast(a, b) {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
export const INK_LIGHT = "#ffffff", INK_DARK = "#0d1117";
/** Blanco o casi negro: el que mejor se lee sobre TODOS los colores dados (ej. las dos puntas de un degradado). */
export function readableOn(bgs) {
  const worst = (t) => Math.min(...bgs.map((b) => contrast(t, b)));
  return worst(INK_LIGHT) >= worst(INK_DARK) ? INK_LIGHT : INK_DARK;
}
/** Acerca `color` a negro o blanco (lo justo) hasta leerse sobre todos los `surfaces`. */
export function ensureContrast(color, surfaces, target = 4.5) {
  const worst = (c) => Math.min(...surfaces.map((s) => contrast(c, s)));
  if (worst(color) >= target) return color;
  // Probamos hacia negro y hacia blanco; gana la que llega con menos cambio (el tono se nota menos).
  let best = null;
  for (const toward of ["#000000", "#ffffff"]) {
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = mixHex(color, toward, t);
      if (worst(c) >= target) { if (!best || t < best.t) best = { c, t }; break; }
    }
  }
  if (best) return best.c;
  // Fondo de tono medio donde nada llega a 4,5: el polo que mejor se lee.
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}
/** Colores derivados de un estilo, con contraste garantizado:
 *  on = texto sobre el color principal, btnA/btnB = degradado del botón (ajustado si hiciera falta),
 *  text = el color principal usado como texto (precios, links) sobre el fondo y las tarjetas. */
export function lookColors({ accentColor, accent2Color, backgroundColor, cardColor }) {
  const ac = isHex(accentColor) ? accentColor : "#3984ff";
  const bg = isHex(backgroundColor) ? backgroundColor : "#090e1d";
  const light = relLum(bg) > 0.45;
  const sky = isHex(accent2Color) ? accent2Color : mixHex(ac, light ? "#000000" : "#ffffff", light ? 0.18 : 0.35);
  const on = readableOn([ac, sky]);
  const worstOn = (a, b) => Math.min(contrast(on, a), contrast(on, b));
  let btnA = ac, btnB = sky;
  const toward = on === INK_LIGHT ? "#000000" : "#ffffff";
  for (let t = 0.04; worstOn(btnA, btnB) < 4.5 && t <= 0.8; t += 0.04) { btnA = mixHex(ac, toward, t); btnB = mixHex(sky, toward, t); }
  const card = isHex(cardColor) ? cardColor : mixHex(bg, "#ffffff", light ? 0.75 : 0.05);
  const text = ensureContrast(ac, [bg, card]);
  return { light, sky, on, btnA, btnB, text, onRatio: worstOn(btnA, btnB), accentRatio: contrast(ac, bg), textRatio: Math.min(contrast(text, bg), contrast(text, card)) };
}

/** Aviso para el dueño/revendedor al elegir colores: ¿se lee el color principal sobre el fondo? */
export function contrastNote(look) {
  const c = lookColors(look);
  const r = c.accentRatio.toFixed(1).replace(".", ",");
  const bg = isHex(look.backgroundColor) ? look.backgroundColor : "#090e1d";
  // Fondo de tono medio: ni blanco ni negro se leen bien encima. Eso no se arregla con el color principal.
  if (Math.max(contrast("#ffffff", bg), contrast("#000000", bg)) < 5) return { cls: "warn", text: "⚠️ Tu color de fondo es de tono medio: cuesta leer cualquier texto encima. Elegí un fondo bastante más oscuro o más claro." };
  if (c.accentRatio >= 4.5) return { cls: "ok", text: `✅ Se lee bien: el color principal tiene ${r}:1 de contraste con el fondo.` };
  const hacia = c.light ? "más oscuro" : "más claro";
  return { cls: "warn", text: `⚠️ Este color se lee poco sobre tu fondo (${r}:1; lo recomendado es 4,5:1). Lo ajustamos solo en textos y botones para que se lea, pero conviene elegir uno ${hacia}.` };
}

/** Estilos listos: un toque y la página queda armada; después se puede cambiar todo. */
export const THEMES = [
  { id: "neon", name: "Neón Cyber", look: { backgroundColor: "#07070d", accentColor: "#00e5ff", accent2Color: "#ff2bd6", bgStyle: "aurora", cardStyle: "neon", headingFont: "orbitron", fontFamily: "inter", corners: "round" } },
  { id: "violeta", name: "Violeta Premium", look: { backgroundColor: "#0d0a1a", accentColor: "#8b5cf6", accent2Color: "#ec4899", bgStyle: "glow", cardStyle: "glass", headingFont: "poppins", fontFamily: "poppins", corners: "round" } },
  { id: "gamer", name: "Gamer", look: { backgroundColor: "#050b07", accentColor: "#22ff88", accent2Color: "#00b3ff", bgStyle: "grid", cardStyle: "neon", headingFont: "russo", fontFamily: "outfit", corners: "square" } },
  { id: "oro", name: "Oro y Negro", look: { backgroundColor: "#0a0907", accentColor: "#d4af37", accent2Color: "#f5e6b3", bgStyle: "gradient", cardStyle: "outline", headingFont: "playfair", fontFamily: "montserrat", corners: "soft" } },
  { id: "rojo", name: "Rojo Streaming", look: { backgroundColor: "#0b0505", accentColor: "#e50914", accent2Color: "#ff6a3d", bgStyle: "glow", cardStyle: "solid", headingFont: "bebas", fontFamily: "inter", corners: "soft" } },
  { id: "atardecer", name: "Atardecer", look: { backgroundColor: "#140a1f", accentColor: "#ff7a18", accent2Color: "#ff2e63", bgStyle: "gradient", cardStyle: "glass", headingFont: "righteous", fontFamily: "nunito", corners: "round" } },
  { id: "oceano", name: "Océano", look: { backgroundColor: "#04121f", accentColor: "#00b4d8", accent2Color: "#4ade80", bgStyle: "aurora", cardStyle: "glass", headingFont: "outfit", fontFamily: "outfit", corners: "round" } },
  { id: "rosa", name: "Rosa Pastel", look: { backgroundColor: "#fff0f6", accentColor: "#ff4f9a", accent2Color: "#a78bfa", bgStyle: "dots", cardStyle: "solid", headingFont: "fredoka", fontFamily: "nunito", corners: "round" } },
  { id: "menta", name: "Menta Fresca", look: { backgroundColor: "#effcf6", accentColor: "#10b981", accent2Color: "#06b6d4", bgStyle: "dots", cardStyle: "solid", headingFont: "poppins", fontFamily: "poppins", corners: "round" } },
  { id: "minimal", name: "Minimal Blanco", look: { backgroundColor: "#f7f7f9", accentColor: "#111827", accent2Color: "#6366f1", bgStyle: "solid", cardStyle: "outline", headingFont: "dmsans", fontFamily: "dmsans", corners: "soft" } },
  { id: "lujo-rosa", name: "Glam", look: { backgroundColor: "#170812", accentColor: "#f472b6", accent2Color: "#fbbf24", bgStyle: "glow", cardStyle: "glass", headingFont: "lobster", fontFamily: "montserrat", corners: "round" } },
  { id: "galaxia", name: "Galaxia", look: { backgroundColor: "#060318", accentColor: "#6366f1", accent2Color: "#22d3ee", bgStyle: "aurora", cardStyle: "glass", headingFont: "bungee", fontFamily: "dmsans", corners: "round" } },
  { id: "aurora-viva", name: "Aurora Viva ✨", look: { backgroundColor: "#050914", accentColor: "#38bdf8", accent2Color: "#a855f7", bgStyle: "live", cardStyle: "glass", headingFont: "outfit", fontFamily: "outfit", corners: "round" } },
  { id: "neon-vivo", name: "Neón Vivo ✨", look: { backgroundColor: "#06040f", accentColor: "#ff2bd6", accent2Color: "#00e5ff", bgStyle: "live", cardStyle: "neon", headingFont: "orbitron", fontFamily: "inter", corners: "round" } },
  { id: "fuego", name: "Fuego ✨", look: { backgroundColor: "#120604", accentColor: "#ff6a00", accent2Color: "#ffd000", bgStyle: "live", cardStyle: "neon", headingFont: "bebas", fontFamily: "outfit", corners: "soft" } },
  { id: "esmeralda", name: "Esmeralda ✨", look: { backgroundColor: "#03140f", accentColor: "#10e0a0", accent2Color: "#38bdf8", bgStyle: "live", cardStyle: "glass", headingFont: "poppins", fontFamily: "poppins", corners: "round" } },
  { id: "oro-azul", name: "Oro y Azul ⭐", look: { backgroundColor: "#14213d", accentColor: "#ffc93c", accent2Color: "#ffd96b", bgStyle: "glow", cardStyle: "solid", headingFont: "bricolage", fontFamily: "figtree", corners: "soft", layout: "catalogo" } },
];
/** Muestra en miniatura de un estilo (para elegir con un toque). */
export const themeSwatch = (t) => {
  const L = t.look;
  return `<span class="tsw" style="background:${L.backgroundColor}"><i style="background:linear-gradient(135deg,${L.accentColor},${L.accent2Color})"></i><b style="color:${ensureContrast(L.accentColor, [L.backgroundColor], 3)}">Aa</b></span>`;
};

/* ---------------- Aviso de software protegido ----------------
   Lo ve quien abre las herramientas de desarrollador del navegador. También advierte del
   "pegá esto en la consola", una estafa común para robar cuentas. */
let noticeShown = false;
export function softwareNotice() {
  if (noticeShown) return;
  noticeShown = true;
  try {
    console.log("%cGaboHub · software protegido", "font:800 20px system-ui,sans-serif;color:#3984ff");
    console.log("%cEste software es una obra protegida por la Ley 1322 de Derecho de Autor de Bolivia, el DS 24582 y la Decisión 351 de la CAN. Copiarlo, descompilarlo o reutilizar su código sin autorización escrita está prohibido. Más info: /terminos#software", "font:14px system-ui,sans-serif");
    console.log("%c⚠️ Si alguien te pidió pegar algo acá, no lo hagas: puede darle acceso a tu cuenta.", "font:700 14px system-ui,sans-serif;color:#c92a2a");
  } catch { /* consola no disponible */ }
}

/** Selector de archivo en español ("Elegir imagen" en vez de "Choose File"). Lo usan la tienda y el panel. */
export function enhanceFiles(root = document) {
  for (const inp of root.querySelectorAll('input[type="file"]:not([data-fp])')) {
    if (inp.closest(".dropzone")) continue;
    inp.dataset.fp = "1";
    const isImg = /image/.test(inp.accept || "");
    // Si ya está dentro de una etiqueta, no anidamos otra (sería HTML inválido): esa etiqueta ya abre el selector.
    const wrap = document.createElement(inp.closest("label") ? "span" : "label");
    wrap.className = "filepick";
    const btn = document.createElement("span");
    btn.className = "fp-btn";
    btn.textContent = isImg ? "📷 Elegir imagen" : "📎 Elegir archivo";
    const name = document.createElement("span");
    name.className = "fp-name";
    name.textContent = "Ningún archivo elegido";
    inp.parentNode.insertBefore(wrap, inp);
    wrap.append(btn, name, inp);
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0];
      name.textContent = f ? f.name : "Ningún archivo elegido";
      wrap.classList.toggle("has", !!f);
    });
  }
}
