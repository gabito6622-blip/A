// Tienda de prueba para el video «Desfile de estilos» de GaboHub: la revendedora de ejemplo «Ariana», pero con el
// CATÁLOGO REAL de la tienda (nombres, descripciones, precios públicos y logos, copiados con traer-catalogo.sh).
// Sin azar (siempre los mismos números). Los precios de revendedor existen solo para que la tienda funcione: el video
// no los muestra. Uso (desde la raíz, con npm run build hecho): node promo/gabohub-estilos/seed-estilos.mjs <carpeta-vacía>
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createApp } from "../../dist/server/app.js";

// Azar fijo: cada vez que se corre salen los mismos clientes, ventas y vencimientos.
let SEED = 20261111;
Math.random = () => ((SEED = (SEED * 1103515245 + 12345) % 2147483648) / 2147483648);

const dir = process.argv[2] ?? "data-video-gabohub";
if (existsSync(dir) && readdirSync(dir).length) { console.error(`La carpeta ${dir} ya tiene datos. Usá una vacía.`); process.exit(1); }

const DAY = 864e5;
const clock = { t: Date.now() - 182 * DAY, now() { return this.t; } };     // arrancamos hace ~6 meses
const adv = (days) => { clock.t += days * DAY; };
const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
const s = app.store;
app.bootstrapOwner("gabriel", "Gabriel", "demo-gabriel-2026");
const owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

// Como la tienda real: todo se muestra disponible, con nota de pago y WhatsApp cargados.
s.catalog.updateSettings(owner, { storeName: "Gabriel Store", alwaysAvailable: true, whatsapp: "59171234567",
  paymentNote: "Pagá con QR o con tu saldo. Apenas confirmamos, te llega la cuenta." });

// ---- Catálogo real (precios en centavos de Bs) ----
const CAT = JSON.parse(readFileSync(new URL("./catalogo-real/catalogo.json", import.meta.url), "utf8"));
for (const p of CAT) {
  s.catalog.upsertProduct(owner, { id: p.id, name: p.name, category: p.category, kind: p.kind, durationDays: p.durationDays, price: p.price,
    color: p.color, description: p.description, published: true, ...(p.comboParts ? { comboProductIds: p.comboParts } : {}) });
}
// Precio de revendedor: solo para que la tienda de prueba funcione (no aparece en el video)
s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: Object.fromEntries(CAT.map((p) => [p.id, Math.round(p.price * 0.75 / 100) * 100])) });
s.catalog.upsertSupplier(owner, { id: "andes", name: "Proveedor Andes", contact: "+591 70000001", active: true });

// ---- Stock abundante (para 6 meses de ventas) ----
let em = 0;
const acc = (productId, n, costPerProfile = 1000) => s.inventory.addAccount(owner, {
  productId, supplierId: "andes", email: `${productId.replace(/[^a-z0-9]/g, "")}.perfiles${String(++em).padStart(2, "0")}@gabostore.lat`,
  password: ["Cine", "Serie", "Play", "Star", "Luna", "Sol"][em % 6] + "2026*" + String(10 + Math.floor(Math.random() * 89)), supplierExpiresAt: clock.now() + 200 * DAY, cost: costPerProfile * (n || 1),
  profiles: n === 1 ? [{ label: "Cuenta completa" }] : Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}`, pin: String(1000 + i * 1111) })),
});
for (const p of CAT) {
  if (p.kind === "combo") continue;
  if (p.kind === "profile") for (let i = 0; i < 6; i++) acc(p.id, 5);
  else if (p.kind === "invite") for (let i = 0; i < 4; i++) acc(p.id, 6);
  else for (let i = 0; i < 14; i++) acc(p.id, 1, 3000);
}

// ---- La revendedora: Ariana ----
const ariana = s.catalog.createCustomer(owner, { name: "Ariana Flores", phone: "+591 71234567", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true, email: "ariana.flores@gabostore.lat" });
const AR = { id: "u_" + ariana.id, role: "reseller", customerId: ariana.id };
s.shops.setPage(owner, ariana.id, true);                 // plan "página propia"
s.shops.setupFor(owner, ariana.id, { slug: "ariana-streaming", title: "Ariana Streaming", enabled: true });
// Ariana personaliza su página: estilo boleto de cine, colores, textos
s.shops.update(AR, {
  cardStyle: "ticket", bgStyle: "glow", accentColor: "#ff2e88", accent2Color: "#00d4ff", backgroundColor: "#0b0b16",
  headingFont: "bricolage", fontFamily: "figtree", corners: "round", layout: "catalogo",
  heroTitle: "Tus plataformas favoritas,", heroHighlight: "al mejor precio", heroText: "Netflix, Disney+, HBO Max, Spotify y más. Pedí por WhatsApp y te lo activo al toque.",
  heroChip: "✦ Entrega inmediata", heroTicks: "Atención 24/7, Garantía total, Precios en Bs",
  storeHours: "Todos los días de 8:00 a 23:00",
});
// Precios de venta de Ariana a SUS clientes (define su ganancia)
// (de ejemplo: un poco más que el precio público de la tienda)
s.portal.setPrices(AR, Object.fromEntries(CAT.map((p) => [p.id, p.price + (p.durationDays > 30 ? 1000 : 500)])));
// Combos propios de Ariana en su página
s.shops.update(AR, { combos: [
  { name: "Dúo Series", productIds: ["netflix", "disney"], price: 6000 },
  { name: "Pack Música", productIds: ["spotify", "youtube"], price: 6900 },
] });
// Descuento por cantidad y cupones propios de Ariana (el dueño los habilita)
s.shops.update(AR, { comboDiscounts: [300, 500, 800] });
s.shops.setCouponsAllowed(owner, true);
s.shops.saveCoupon(AR, { code: "AMIGOS10", type: "percent", value: 10 });
s.shops.saveCoupon(AR, { code: "PRIMERA", type: "fixed", value: 500 });

// ---- 6 meses de trabajo: recargas, clientes y ventas repartidas en el tiempo ----
const NAMES = ["Camila Rojas","Diego Mamani","Valeria Soto","Jhon Vargas","Daniela Pérez","Kevin Flores","Fernanda Gutiérrez","Brayan Choque","Melissa Torrez","Sergio Ramírez","Lucía Villca","Marco Ticona","Gabriela Nina","Josué Apaza","Noelia Quispe","Álvaro Céspedes","Paola Mendoza","Ronaldo Cruz","Antonella Ríos","Mateo Herrera","Sofía Gutiérrez","Luis Ovando","Andrea Salinas","Erick Zabala","Carla Montaño","Dylan Poma","Rebeca Alanoca","Iván Córdova"];
const PHONES = new Set();
const phone = () => { let p; do { p = "+5916" + Math.floor(1000000 + Math.random() * 8999999); } while (PHONES.has(p)); PHONES.add(p); return p; };
const SELLABLE = ["netflix","disney","disney-espn","prime","hbo","paramount","spotify","youtube","crunchyroll","chatgpt","canva","combo31","combo41"];

let sold = 0, renewed = 0;
const clients = [];
// Recarga inicial grande (como si hubiera comprado créditos al por mayor)
s.wallet.adjust(owner, ariana.id, 250000, "Recarga de saldo por QR");

// Reparte la creación de clientes y ventas a lo largo de ~175 días
for (let week = 0; week < 25; week++) {
  // cada 3 semanas recarga saldo
  if (week % 3 === 0 && week > 0) s.wallet.adjust(owner, ariana.id, 120000, "Recarga de saldo por QR");
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
s.wallet.adjust(owner, ariana.id, 180000, "Recarga de saldo por QR");
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

// ---- Opiniones de revendedores (página del programa) ----
s.shops.setTestimonials(owner, [
  { name: "Ariana Flores", business: "Ariana Streaming", rating: 5, text: "Antes anotaba todo en un cuaderno. Ahora veo quién vence y renuevo con un toque." },
  { name: "Bruno Ledesma", business: "Bruno Play", rating: 5, text: "Compro con saldo y la cuenta llega al instante. Mis clientes ni se enteran del proveedor." },
  { name: "Keila Ríos", business: "Keila Series", rating: 5, text: "Mi página con mi logo vende sola. Me escriben directo por WhatsApp." },
]);

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
