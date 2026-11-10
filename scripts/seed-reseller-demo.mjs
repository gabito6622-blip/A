// Panel de revendedor DEMO, lleno de vida: como si Ariana llevara ~6 meses trabajando.
// Uso: node scripts/seed-reseller-demo.mjs ./data-reseller-demo
// Crea: catálogo, stock, la revendedora "Ariana" con su página (estilo boleto), ~28 clientes
// con servicios de vencimientos variados, 6 meses de historial de ventas y renovaciones,
// saldo con movimientos, combos y 2 referidos. Deja todo listo para entrar y recorrer.
import { existsSync, readdirSync } from "node:fs";
import { createApp } from "../dist/server/app.js";

const dir = process.argv[2] ?? "data-reseller-demo";
if (existsSync(dir) && readdirSync(dir).length) { console.error(`La carpeta ${dir} ya tiene datos. Usá una vacía.`); process.exit(1); }

const DAY = 864e5;
const clock = { t: Date.now() - 182 * DAY, now() { return this.t; } };     // arrancamos hace ~6 meses
const adv = (days) => { clock.t += days * DAY; };
const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
const s = app.store;
app.bootstrapOwner("gabriel", "Gabriel", "demo-gabriel-2026");
const owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

// ---- Catálogo (precios en centavos de Bs) ----
const P = [
  ["netflix", "Netflix", "Streaming", "profile", 3500, "#e50914", "Un perfil privado con PIN."],
  ["disney", "Disney+", "Streaming", "profile", 3000, "#113ccf", "Perfil con Marvel, Star Wars y más."],
  ["max", "Max (HBO)", "Streaming", "profile", 3000, "#9b5cf6", "Series y estrenos de HBO."],
  ["prime", "Prime Video", "Streaming", "profile", 2500, "#00a8e1", "Perfil de Amazon Prime Video."],
  ["spotify", "Spotify Premium", "Música", "invite", 2000, "#1db954", "Música sin anuncios."],
  ["youtube", "YouTube Premium", "Streaming", "invite", 2200, "#ff0000", "Sin anuncios y con música."],
  ["crunchy", "Crunchyroll", "Streaming", "profile", 2000, "#f47521", "Anime al día, sin anuncios."],
  ["chatgpt", "ChatGPT Plus", "IA", "full_account", 5000, "#10a37f", "Cuenta completa, modelos avanzados."],
  ["canva", "Canva Pro", "Diseño", "invite", 2000, "#7d2ae8", "Plantillas premium y kit de marca."],
];
for (const [id, name, category, kind, price, color, description] of P)
  s.catalog.upsertProduct(owner, { id, name, category, kind, durationDays: 30, price, color, description, published: true });
// Combos armados por el dueño
s.catalog.upsertProduct(owner, { id: "combo-cine", name: "Combo Cine", category: "Combos", kind: "combo", durationDays: 30, price: 8000, color: "#d6336c", description: "Netflix + Disney+ + Max.", comboProductIds: ["netflix", "disney", "max"], published: true });
s.catalog.upsertProduct(owner, { id: "combo-full", name: "Combo Todo", category: "Combos", kind: "combo", durationDays: 30, price: 9500, color: "#f59f00", description: "Netflix + Spotify + ChatGPT.", comboProductIds: ["netflix", "spotify", "chatgpt"], published: true });
// Precio de revendedor (lo que Ariana le paga a la tienda)
s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, disney: 2100, max: 2100, prime: 1700, spotify: 1300, youtube: 1500, crunchy: 1300, chatgpt: 3800, canva: 1300, "combo-cine": 6000, "combo-full": 7000 } });
s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", contact: "+591 70000001", active: true });

// ---- Stock abundante (para 6 meses de ventas) ----
let em = 0;
const acc = (productId, n, costPerProfile = 1000) => s.inventory.addAccount(owner, {
  productId, supplierId: "andes", email: `${productId}${String(++em).padStart(2, "0")}@proveedor.lat`,
  password: "Prov#" + Math.random().toString(36).slice(2, 8), supplierExpiresAt: clock.now() + 200 * DAY, cost: costPerProfile * (n || 1),
  profiles: n === 1 ? [{ label: "Cuenta completa" }] : Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}`, pin: String(1000 + i * 1111) })),
});
for (let i = 0; i < 8; i++) acc("netflix", 5);
for (let i = 0; i < 5; i++) { acc("disney", 6); acc("max", 6); acc("prime", 6); acc("crunchy", 5); }
for (let i = 0; i < 6; i++) { acc("spotify", 6); acc("youtube", 6); acc("canva", 6); }
for (let i = 0; i < 10; i++) acc("chatgpt", 1, 3500);

// ---- La revendedora: Ariana ----
const ariana = s.catalog.createCustomer(owner, { name: "Ariana Flores", phone: "+591 71234567", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true, email: "ariana.demo@gabostore.lat" });
const AR = { id: "u_" + ariana.id, role: "reseller", customerId: ariana.id };
s.shops.setPage(owner, ariana.id, true);                 // plan "página propia"
s.shops.setupFor(owner, ariana.id, { slug: "ariana-streaming", title: "Ariana Streaming", enabled: true });
// Ariana personaliza su página: estilo boleto de cine, colores, textos
s.shops.update(AR, {
  cardStyle: "ticket", bgStyle: "glow", accentColor: "#ff2e88", accent2Color: "#00d4ff", backgroundColor: "#0b0b16",
  headingFont: "bricolage", fontFamily: "figtree", corners: "round", layout: "catalogo",
  heroTitle: "Tus plataformas favoritas,", heroHighlight: "al mejor precio 🎬", heroText: "Netflix, Disney+, Max, Spotify y más. Pedí por WhatsApp y te lo activo al toque.",
  heroChip: "✦ Entrega inmediata", heroTicks: "Atención 24/7, Garantía total, Precios en Bs",
  storeHours: "Todos los días de 8:00 a 23:00",
});
// Precios de venta de Ariana a SUS clientes (define su ganancia)
s.portal.setPrices(AR, { netflix: 4000, disney: 3500, max: 3500, prime: 3000, spotify: 2500, youtube: 2800, crunchy: 2500, chatgpt: 6000, canva: 2500, "combo-cine": 9500, "combo-full": 11000 });
// Combos propios de Ariana en su página
s.shops.update(AR, { combos: [
  { name: "Dúo Series", productIds: ["netflix", "disney"], price: 6500 },
  { name: "Pack Estudiante", productIds: ["spotify", "canva"], price: 4200 },
] });

// ---- 6 meses de trabajo: recargas, clientes y ventas repartidas en el tiempo ----
const NAMES = ["Camila Rojas","Diego Mamani","Valeria Soto","Jhon Vargas","Daniela Pérez","Kevin Flores","Fernanda Gutiérrez","Brayan Choque","Melissa Torrez","Sergio Ramírez","Lucía Villca","Marco Ticona","Gabriela Nina","Josué Apaza","Noelia Quispe","Álvaro Céspedes","Paola Mendoza","Ronaldo Cruz","Antonella Ríos","Mateo Herrera","Sofía Gutiérrez","Luis Ovando","Andrea Salinas","Erick Zabala","Carla Montaño","Dylan Poma","Rebeca Alanoca","Iván Córdova"];
const PHONES = new Set();
const phone = () => { let p; do { p = "+5916" + Math.floor(1000000 + Math.random() * 8999999); } while (PHONES.has(p)); PHONES.add(p); return p; };
const SELLABLE = ["netflix","disney","max","prime","spotify","youtube","crunchy","chatgpt","canva","combo-cine","combo-full"];

let sold = 0, renewed = 0;
const clients = [];
// Recarga inicial grande (como si hubiera comprado créditos al por mayor)
s.wallet.adjust(owner, ariana.id, 250000, "Recarga de saldo (demo)");

// Reparte la creación de clientes y ventas a lo largo de ~175 días
for (let week = 0; week < 25; week++) {
  // cada 3 semanas recarga saldo
  if (week % 3 === 0 && week > 0) s.wallet.adjust(owner, ariana.id, 120000, "Recarga de saldo (demo)");
  // 1-2 clientes nuevos por semana al principio, luego menos
  const nuevos = week < 12 ? 2 : (week % 2 === 0 ? 1 : 0);
  for (let k = 0; k < nuevos && clients.length < NAMES.length; k++) {
    const name = NAMES[clients.length];
    const c = s.catalog.createCustomer(AR, { name, phone: phone(), whatsappConsent: Math.random() < 0.8 });
    if (Math.random() < 0.3) s.portal.updateClient(AR, c.id, { note: rnd(["Paga puntual 👍","Cliente del trabajo","Me lo recomendó Camila","Prefiere pago por QR","Amiga de la familia"]) });
    clients.push(c);
    // le vende 1-2 servicios al dar de alta
    const howMany = Math.random() < 0.35 ? 2 : 1;
    const picks = [...SELLABLE].sort(() => Math.random() - 0.5).slice(0, howMany);
    for (const pid of picks) {
      try { s.orders.create(AR, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: `seed-${c.id}-${pid}-${week}` }); sold++; } catch { /* sin stock de ese, probamos otro */ }
    }
  }
  // algunas renovaciones de clientes existentes
  if (week > 4) {
    const active = Object.values(s.engine.s.assignments).filter((a) => a.status === "active" && clients.some((c) => c.id === a.customerId));
    for (const a of active.sort(() => Math.random() - 0.5).slice(0, 2)) {
      if (Math.random() < 0.5) { try { s.orders.renew(AR, a.id, { paymentMethod: "balance", idempotencyKey: `seed-renew-${a.id}-${week}` }); renewed++; } catch { /* saldo o stock */ } }
    }
  }
  adv(7);
}

// Cierra los servicios viejos que ya vencieron durante estos 6 meses (libera los cupos),
// como haría una revendedora ordenada. El historial de ventas queda para las Finanzas.
s.orders.closeExpired(owner, 0);

// ---- "Hoy": cada cliente tiene su servicio al día, con vencimientos variados y realistas ----
clock.t = Date.now();
// Recarga fresca para que arranque el mes con saldo sano
s.wallet.adjust(owner, ariana.id, 180000, "Recarga de saldo (demo)");
const freshFor = (cid, pid, key) => {
  try {
    const o = s.orders.create(AR, { customerId: cid, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: key });
    const exp = Math.random() < 0.12 ? -(1 + Math.floor(Math.random() * 4))        // ~12% vencidos (para cobrar)
      : Math.random() < 0.22 ? (1 + Math.floor(Math.random() * 6))                 // algunos vencen esta semana
      : (9 + Math.floor(Math.random() * 20));                                       // la mayoría, sanos
    for (const aid of (o.assignmentIds ?? [])) s.orders.setExpiry(owner, aid, Date.now() + exp * DAY);
    return true;
  } catch { return false; }
};
let cur = 0;
clients.forEach((c, i) => {
  const howMany = Math.random() < 0.4 ? 2 : 1;
  const picks = [...SELLABLE].sort(() => Math.random() - 0.5).slice(0, howMany);
  picks.forEach((pid, j) => { if (freshFor(c.id, pid, `now-${c.id}-${pid}-${j}`)) cur++; });
});
// Un par de servicios para la propia Ariana (los usa ella)
freshFor(ariana.id, "netflix", "now-ariana-nf");
freshFor(ariana.id, "spotify", "now-ariana-sp");

// ---- Referidos: Ariana trajo 2 revendedores (premio activo) ----
s.catalog.updateSettings(owner, { referralBonus: 2000, resellerMarginPct: 35 });
for (const [nm, ph] of [["Bruno Ledesma", "+591 71770001"], ["Keila Ríos", "+591 71770002"]]) {
  s.shops.apply({ name: nm, phone: ph, ref: ariana.id });
}
for (const a of s.shops.apps(owner).filter((x) => x.status === "pending")) s.shops.approve(owner, a.id);

await app.close();
const near = Object.values(s.engine.s.assignments).filter((a) => a.status === "active");
const venc = near.filter((a) => a.customerExpiresAt < Date.now()).length;
const pronto = near.filter((a) => { const d = (a.customerExpiresAt - Date.now()) / DAY; return d >= 0 && d <= 7; }).length;
console.log(JSON.stringify({ dir, reseller: { name: ariana.name, phone: ariana.phone, id: ariana.id }, clients: clients.length, services: near.length, sold, renewed, vencidos: venc, porVencer7d: pronto, saldo: s.wallet.balance(ariana.id) }, null, 2));
