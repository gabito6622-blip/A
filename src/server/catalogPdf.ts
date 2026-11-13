// Catálogo PDF A4 (13/11/2026) en dos diseños, sobre el escritor propio (pdf.ts, sin dependencias):
//  - Premium: portada con los colores y el logo del negocio, productos por categoría en tarjetas, precios destacados.
//  - Clásico: blanco, letras grandes y precios claros, para quien compra por WhatsApp y lee en el celular o impreso.
// Siempre: fecha de generación, «los precios pueden cambiar», WhatsApp y link del negocio (clicable). Nada privado.
import { Pdf, type PdfFont } from "./pdf.js";
import { fdate, money, type CatalogData } from "./exportCenter.js";

export type CatalogDesign = "premium" | "clasico";

const hex = (h: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()) ?? /^#?([0-9a-f]{3})$/i.exec(h.trim()); if (!m) return [7, 11, 22]; const s = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1]; return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const lum = (h: string) => { const [r, g, b] = hex(h).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toHex = (rgb: number[]) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const mix = (a: string, b: string, t: number) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
/** Un acento legible sobre blanco: si es muy claro (amarillo), se oscurece. */
const inkAccent = (acc: string) => (lum(acc) > 0.55 ? mix(acc, "#000000", 0.45) : acc);
const dur = (days: number) => (days === 30 ? "1 mes" : days === 90 ? "3 meses" : days === 180 ? "6 meses" : days === 365 ? "1 año" : days === 1 ? "1 día" : `${days} días`);
const waPretty = (w: string) => (w ? `+${w.replace(/^(\d{3})(\d+)$/, "$1 $2")}` : "");

interface Ctx { p: Pdf; d: CatalogData; design: CatalogDesign; logo?: Buffer; y: number; page: number; acc: string; accInk: string; bg: string; onDark: boolean }
const M = 40, W = 595.28, H = 841.89;

function footer(c: Ctx) {
  const { p, d } = c;
  const y = H - 26;
  p.line(M, y - 14, W - M, y - 14, { color: "#e5e7eb", lineWidth: 0.6 });
  p.text(`${d.business.name} · ${fdate(d.generatedAt)} · Precios en ${d.currency.symbol}; pueden cambiar sin aviso.`, M, y, { size: 8.5, color: "#6b7280", maxWidth: W - 2 * M - 60 });
  p.text(`Pág. ${c.page}`, W - M, y, { size: 8.5, color: "#6b7280", align: "right" });
}
function header(c: Ctx) {
  const { p, d } = c;
  if (c.design === "premium") {
    p.rect(0, 0, W, 34, { fill: c.bg });
    p.rect(0, 34, W, 3, { fill: c.acc });
    p.text(d.business.name.toUpperCase(), M, 22, { font: "bold", size: 11, color: c.onDark ? "#ffffff" : "#111827" });
    p.text("CATÁLOGO", W - M, 22, { font: "bold", size: 11, color: c.acc, align: "right" });
    c.y = 62;
  } else {
    p.text(d.business.name, M, 30, { font: "bold", size: 14, color: "#111827" });
    p.text(`Catálogo · ${fdate(d.generatedAt)}`, W - M, 30, { size: 11, color: "#374151", align: "right" });
    p.line(M, 40, W - M, 40, { color: "#111827", lineWidth: 1.2 });
    c.y = 64;
  }
}
function newPage(c: Ctx) { c.p.addPage(); c.page++; header(c); footer(c); }
function ensure(c: Ctx, need: number) { if (c.y + need > H - 54) newPage(c); }

function logoBlock(c: Ctx, x: number, y: number, size: number, dark: boolean) {
  const { p, d } = c;
  const info = c.logo ? Pdf.imageSize(c.logo) : null;
  if (c.logo && info) {
    p.rect(x, y, size, size, { fill: "#ffffff", radius: size * 0.22 });
    const r = info.width / info.height, w = r >= 1 ? size - 8 : (size - 8) * r, h = r >= 1 ? (size - 8) / r : size - 8;
    try { p.image(c.logo, x + (size - w) / 2, y + (size - h) / 2, w, h); return; } catch { /* formato no soportado: inicial */ }
  }
  p.rect(x, y, size, size, { fill: c.acc, radius: size * 0.22 });
  p.text((d.business.name.trim()[0] ?? "T").toUpperCase(), x + size / 2, y + size * 0.68, { font: "bold", size: size * 0.5, color: dark || lum(c.acc) < 0.5 ? "#ffffff" : "#111827", align: "center" });
}

function cover(c: Ctx) {
  const { p, d } = c;
  p.addPage(); c.page++;
  p.rect(0, 0, W, H, { fill: c.bg });
  // Degradado simple con el segundo color (bandas), discreto.
  for (let i = 0; i < 24; i++) p.rect(0, H * 0.55 + i * (H * 0.45 / 24), W, H * 0.45 / 24 + 1, { fill: mix(c.bg, d.business.accent2, (i / 24) * 0.35) });
  p.rect(0, 0, W, 8, { fill: c.acc });
  const ink = c.onDark ? "#ffffff" : "#111827", soft = c.onDark ? "#cbd5e1" : "#374151";
  logoBlock(c, M, 120, 92, c.onDark);
  p.text("CATÁLOGO DE SUSCRIPCIONES", M, 250, { font: "bold", size: 11, color: c.acc });
  const title = p.wrap(d.business.name, 34, W - 2 * M, "bold").slice(0, 3);
  let y = 292;
  for (const l of title) { p.text(l, M, y, { font: "bold", size: 34, color: ink }); y += 40; }
  p.text(`Actualizado el ${fdate(d.generatedAt)}`, M, y + 6, { size: 12, color: soft });
  y += 44;
  if (d.business.announcement) { for (const l of p.wrap(d.business.announcement, 12, W - 2 * M, "italic").slice(0, 3)) { p.text(l, M, y, { font: "italic", size: 12, color: soft }); y += 16; } y += 6; }
  const total = d.categories.reduce((n, cat) => n + cat.items.length, 0);
  const chips = [`${total} servicio${total === 1 ? "" : "s"}`, `${d.categories.length} categoría${d.categories.length === 1 ? "" : "s"}`, ...(d.promos.length ? [`${d.promos.length} promo${d.promos.length === 1 ? "" : "s"}`] : [])];
  let cx = M;
  for (const ch of chips) { const w = p.textWidth(ch, 10, "bold") + 20; p.rect(cx, y, w, 24, { fill: mix(c.bg, c.acc, 0.25), radius: 12, stroke: c.acc, lineWidth: 0.6 }); p.text(ch, cx + 10, y + 16, { font: "bold", size: 10, color: ink }); cx += w + 8; }
  // Contacto, abajo.
  let cy = H - 150;
  p.rect(M, cy - 22, W - 2 * M, 1, { fill: mix(c.bg, ink, 0.25) });
  if (d.business.whatsapp) { p.text("Pedidos por WhatsApp", M, cy, { size: 10, color: soft }); p.text(waPretty(d.business.whatsapp), M, cy + 22, { font: "bold", size: 18, color: ink }); p.link(M, cy + 6, 220, 22, `https://wa.me/${d.business.whatsapp}`); }
  if (d.business.url) { p.text("Tienda en línea", W / 2, cy, { size: 10, color: soft }); const u = d.business.url.replace(/^https?:\/\//, ""); p.text(u, W / 2, cy + 22, { font: "bold", size: 13, color: ink, maxWidth: W / 2 - M }); p.link(W / 2, cy + 6, W / 2 - M, 22, d.business.url); }
  if (d.business.hours) p.text(`Horario: ${d.business.hours}`, M, cy + 48, { size: 10, color: soft, maxWidth: W - 2 * M });
  p.text(`Precios en ${d.currency.symbol}. Pueden cambiar sin aviso.`, M, H - 40, { size: 9, color: soft });
}

function categoryTitle(c: Ctx, name: string, count: number) {
  const { p } = c;
  ensure(c, 60);
  if (c.design === "premium") {
    p.rect(M, c.y - 2, 4, 18, { fill: c.acc, radius: 2 });
    p.text(name.toUpperCase(), M + 12, c.y + 12, { font: "bold", size: 13, color: "#111827" });
    p.text(`${count} ${count === 1 ? "opción" : "opciones"}`, W - M, c.y + 12, { size: 9, color: "#6b7280", align: "right" });
    c.y += 30;
  } else {
    p.text(name, M, c.y + 14, { font: "bold", size: 18, color: "#111827" });
    p.line(M, c.y + 20, W - M, c.y + 20, { color: "#111827", lineWidth: 1 });
    c.y += 34;
  }
}

function itemPremium(c: Ctx, it: CatalogData["categories"][number]["items"][number]) {
  const { p, d } = c;
  const sub = [it.kind === "own" || it.kind === "combo" ? "" : dur(it.durationDays), it.items?.length ? `Incluye ${it.items.join(" + ")}` : "", it.description].filter(Boolean).join(" · ");
  const priceTxt = money(it.price, d.currency), pw = p.textWidth(priceTxt, 13, "bold") + 22;
  const textW = W - 2 * M - pw - 36;
  const subLines = sub ? p.wrap(sub, 9, textW, "regular").slice(0, 2) : [];
  const h = 30 + subLines.length * 12;
  ensure(c, h + 6);
  p.rect(M, c.y, W - 2 * M, h, { fill: "#f8fafc", radius: 10, stroke: "#e5e7eb", lineWidth: 0.6 });
  p.rect(M, c.y, 5, h, { fill: it.color || c.acc, radius: 2.5 });
  p.text(it.name, M + 16, c.y + 19, { font: "bold", size: 12, color: "#111827", maxWidth: textW });
  let yy = c.y + 31;
  for (const l of subLines) { p.text(l, M + 16, yy, { size: 9, color: "#6b7280" }); yy += 12; }
  p.rect(W - M - pw - 10, c.y + (h - 24) / 2, pw, 24, { fill: mix("#ffffff", c.acc, 0.16), radius: 12 });
  p.text(priceTxt, W - M - 10 - pw / 2, c.y + (h - 24) / 2 + 16, { font: "bold", size: 13, color: c.accInk, align: "center" });
  c.y += h + 6;
}
function itemClasico(c: Ctx, it: CatalogData["categories"][number]["items"][number]) {
  const { p, d } = c;
  const priceTxt = money(it.price, d.currency), pw = p.textWidth(priceTxt, 17, "bold");
  const textW = W - 2 * M - pw - 24;
  const sub = [it.kind === "own" || it.kind === "combo" ? "" : dur(it.durationDays), it.items?.length ? `Incluye ${it.items.join(" + ")}` : "", it.description].filter(Boolean).join(" · ");
  const subLines = sub ? p.wrap(sub, 11, textW, "regular").slice(0, 2) : [];
  const h = 26 + subLines.length * 14;
  ensure(c, h + 4);
  p.text(it.name, M, c.y + 16, { font: "bold", size: 15, color: "#111827", maxWidth: textW });
  p.text(priceTxt, W - M, c.y + 16, { font: "bold", size: 17, color: "#111827", align: "right" });
  let yy = c.y + 31;
  for (const l of subLines) { p.text(l, M, yy, { size: 11, color: "#374151" }); yy += 14; }
  p.line(M, c.y + h, W - M, c.y + h, { color: "#d1d5db", lineWidth: 0.6 });
  c.y += h + 6;
}

function promos(c: Ctx) {
  const { p, d } = c;
  if (!d.promos.length) return;
  const lines = d.promos.flatMap((x) => p.wrap(`• ${x}`, 11, W - 2 * M - 28, "regular"));
  const h = 34 + lines.length * 15;
  ensure(c, h + 10);
  p.rect(M, c.y, W - 2 * M, h, { fill: c.design === "premium" ? mix("#ffffff", c.acc, 0.1) : "#f3f4f6", radius: 10, stroke: c.design === "premium" ? c.acc : "#111827", lineWidth: 0.8 });
  p.text(c.design === "premium" ? "PROMOCIONES VIGENTES" : "Promociones", M + 14, c.y + 20, { font: "bold", size: c.design === "premium" ? 11 : 14, color: c.design === "premium" ? c.accInk : "#111827" });
  let yy = c.y + 38;
  for (const l of lines) { p.text(l, M + 14, yy, { size: 11, color: "#111827" }); yy += 15; }
  c.y += h + 12;
}
function contactBox(c: Ctx) {
  const { p, d } = c;
  ensure(c, 86);
  const dark = c.design === "premium";
  p.rect(M, c.y, W - 2 * M, 70, { fill: dark ? c.bg : "#ffffff", radius: 12, stroke: dark ? c.bg : "#111827", lineWidth: 1 });
  const ink = dark ? (c.onDark ? "#ffffff" : "#111827") : "#111827";
  p.text("¿Cómo pedir?", M + 16, c.y + 22, { font: "bold", size: c.design === "premium" ? 12 : 15, color: ink });
  const msg = d.business.whatsapp ? `Escribinos por WhatsApp al ${waPretty(d.business.whatsapp)} con el nombre del servicio.` : "Escribinos por WhatsApp con el nombre del servicio.";
  p.text(msg, M + 16, c.y + 42, { size: c.design === "premium" ? 10.5 : 12, color: ink, maxWidth: W - 2 * M - 32 });
  if (d.business.whatsapp) p.link(M, c.y, W - 2 * M, 70, `https://wa.me/${d.business.whatsapp}`);
  if (d.business.url) { p.text(d.business.url.replace(/^https?:\/\//, ""), M + 16, c.y + 58, { size: 9.5, color: dark ? c.acc : "#2563eb", maxWidth: W - 2 * M - 32 }); }
  c.y += 82;
}

/** El catálogo en PDF. `logo` es el archivo del logo (PNG/JPEG) si existe. */
export function catalogPdf(d: CatalogData, design: CatalogDesign, logo?: Buffer): Buffer {
  const p = new Pdf({ title: `Catálogo ${d.business.name}`, author: d.business.name, subject: `Catálogo de suscripciones · ${fdate(d.generatedAt)}` });
  const bg = d.business.background || "#070b16";
  const acc = d.business.accent || "#fcc42d";
  const c: Ctx = { p, d, design, logo, y: 0, page: 0, acc, accInk: inkAccent(acc), bg, onDark: lum(bg) < 0.5 };
  if (design === "premium") cover(c);
  newPage(c);
  if (design === "clasico") {
    // Arriba de todo, grande: a quién pedir. La gente mayor busca eso primero.
    logoBlock(c, M, c.y - 6, 44, false);
    p.text(d.business.name, M + 56, c.y + 12, { font: "bold", size: 20, color: "#111827", maxWidth: W - 2 * M - 56 });
    p.text(d.business.whatsapp ? `WhatsApp: ${waPretty(d.business.whatsapp)}` : "Pedidos por WhatsApp", M + 56, c.y + 32, { font: "bold", size: 13, color: "#111827" });
    if (d.business.whatsapp) p.link(M + 56, c.y + 18, 220, 18, `https://wa.me/${d.business.whatsapp}`);
    c.y += 60;
    if (d.business.announcement) { for (const l of p.wrap(d.business.announcement, 12, W - 2 * M, "italic").slice(0, 2)) { p.text(l, M, c.y, { font: "italic", size: 12, color: "#374151" }); c.y += 16; } c.y += 4; }
  }
  const item = design === "premium" ? itemPremium : itemClasico;
  for (const cat of d.categories) { categoryTitle(c, cat.name, cat.items.length); for (const it of cat.items) item(c, it); c.y += 8; }
  if (!d.categories.length) { p.text("No hay productos publicados con precio.", M, c.y + 14, { size: 12, color: "#6b7280" }); c.y += 30; }
  promos(c);
  contactBox(c);
  return p.end();
}
